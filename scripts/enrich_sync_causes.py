import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(r"E:\iketeru-eizou")
SQLITE_DB = Path(r"E:\iketeru-creative-studio\data\iketeru_knowledge.db")

analysis_path = REPO / "analysis" / "db_sync_cause_analysis.json"
analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
tidb_detail = json.loads((REPO / "analysis" / "_sample_tidb_detail.json").read_text(encoding="utf-8"))

prog_map = {}
for line in (REPO / "analysis" / "full_audit_progress.jsonl").read_text(encoding="utf-8").splitlines():
    if line.strip():
        o = json.loads(line)
        prog_map[str(o.get("video_id"))] = o

con = sqlite3.connect(str(SQLITE_DB))
con.row_factory = sqlite3.Row
sq_map = {}
for vid in tidb_detail:
    row = con.execute(
        "SELECT id, platform, source, overall_rating, direction_rating, technique_rating, overall_score_100, updated_at, substr(ai_analysis, 1, 220) AS analysis_head, score_breakdown_json FROM videos WHERE id = ?",
        (vid,),
    ).fetchone()
    if row:
        sq_map[vid] = dict(row)
con.close()

def fmt_epoch(ts):
    if not ts:
        return None
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
    except Exception:
        return str(ts)

cause_and_proposals = {
    "D_tidb_higher_provisional_vimeo_or_yt": {
        "why_it_differs": "TiDB側には実動画の尺・解像度・音圧を含む詳細分析と高めランクが入っている一方、SQLite側には古い公開メタデータのみの一次分析（低めランク）が残っており、goal_visual_audit_workflow.py がSQLiteから読み込んでTiDBへ書き込んだため両DBのランクと本文が食い違った。",
        "responsible_scripts_or_events": [
            "Manus移行時の初期Vimeoバッチ投入（TiDB側 createdAt/updatedAt に記録）",
            "backfill-100pt-scores.mjs（TiDB側の旧暫定ランク帯に点数をクランプしたため高め維持）",
            "iketeru_studio/indexer.py の sync_database が全件上書きではなく差分更新だったためSQLite側が旧値のまま残留",
        ],
        "proposed_source_of_truth": "NEITHER_KEEP_PROVISIONAL（どちらも確定値にしない）",
        "proposed_sync_action": "未視聴の暫定評価なのでTiDBの高めランクでSQLiteを上書きしない。両DBとも analysisStatus='provisional' を維持し、ローカルMP4キャッシュ462本から順に静止画確認再分析して確定値で上書きする。",
    },
    "A_tidb_empty_sqlite_has_rating_provisional": {
        "why_it_differs": "Vimeo未視聴動画249件について、TiDB側では初期登録時にランク未設定（空）のまま置かれた一方、ローカルSQLite側では過去のローカル簡易一次評価バッチが暫定ランクを書き込んだがTiDBへ書き戻されなかったため。",
        "responsible_scripts_or_events": [
            "初期Vimeoインポート（TiDB側は aiOverallRating='' で登録）",
            "過去のローカルSQLite簡易一次評価スクリプト（TiDB未反映）",
        ],
        "proposed_source_of_truth": "TiDB（未採点＝空）を正とする",
        "proposed_sync_action": "未視聴のままローカルで付いた暫定ランクを本番TiDBへ昇格させない。SQLite側も暫定扱い（再分析待ち）のまま維持し、静止画確認後に両DBへ同時に確定ランクを書く。",
    },
    "C_tidb_has_rating_sqlite_empty": {
        "why_it_differs": "主に vimeo|eizo100（59件）について、TiDB側で後から評価（またはManus/GAS更新）が追加されたが、SQLite側の sync_database が再実行されず空のまま残ったため。",
        "responsible_scripts_or_events": [
            "TiDB側への後追い評価更新（eizo100 / manual / notion）",
            "SQLite sync_database 未実行",
        ],
        "proposed_source_of_truth": "非暫定はTiDBを正／暫定は再分析待ち",
        "proposed_sync_action": "analysisStatus='full_analysis' のレコードのみTiDBからSQLiteへ同期。provisional のレコードは再分析完了まで保留。",
    },
    "J_overall_same_only_direction_or_technique_diff": {
        "why_it_differs": "総合ランクは一致しているが、演出・技術ランクの1段階差（主にVimeo暫定評価）がTiDB側更新後にSQLiteへ未同期のため。",
        "responsible_scripts_or_events": [
            "TiDB側の評価微修正またはbackfill後の未同期",
        ],
        "proposed_source_of_truth": "非暫定はTiDBを正／暫定は再分析待ち",
        "proposed_sync_action": "full_analysis 分のみTiDB基準でSQLiteへ同期。provisional 分は再分析で確定。",
    },
    "G_sqlite_higher_provisional": {
        "why_it_differs": "Vimeo未視聴の暫定評価32件で、SQLite側の旧一次評価がTiDBより高いまま残存したため。",
        "responsible_scripts_or_events": [
            "過去のローカル一次評価とTiDB側暫定評価の世代差",
        ],
        "proposed_source_of_truth": "NEITHER_KEEP_PROVISIONAL（どちらも確定値にしない）",
        "proposed_sync_action": "両DBとも暫定維持し、静止画確認による再分析後に確定値で揃える。",
    },
    "E_tidb_higher_audited_wave_not_synced_to_sqlite": {
        "why_it_differs": "goal_visual_audit_workflow.py で監査済み（full_audit_progress.jsonl あり）の notion 由来動画13件について、過去Waveでは TiDB の旧ランク帯にクランプした backfill-100pt-scores.mjs の結果がTiDBに入り、SQLite側には別の旧ランクが残ったため。",
        "responsible_scripts_or_events": [
            "goal_visual_audit_workflow.py（旧仕様: SQLiteのランク列を更新せず点数のみ書いていた時期）",
            "backfill-100pt-scores.mjs（TiDBの旧ランクをそのまま保持）",
        ],
        "proposed_source_of_truth": "13件を個別確認の上、最新の静止画確認結果（rubric）を正とする",
        "proposed_sync_action": "13件のみ少数なので個別確認し、確定したランクをTiDB・SQLite双方へ反映する。",
    },
    "H_sqlite_higher_audited": {
        "why_it_differs": "上記Eと同じ旧Wave仕様により、notion由来2件のみSQLite側が高くTiDB側が低い状態で食い違った。",
        "responsible_scripts_or_events": [
            "goal_visual_audit_workflow.py（旧仕様）とTiDB旧ランクの不一致",
        ],
        "proposed_source_of_truth": "2件を個別確認の上、最新の静止画確認結果を正とする",
        "proposed_sync_action": "Eの13件と合わせて計15件を個別確認し、両DBを一致させる。",
    },
    "only_in_tidb_66": {
        "why_it_differs": "2026-11にスプレッドシート（upsert-new-videos.mjs で39件）および新規収集（27件）でTiDBへ追加されたが、SQLiteへの同期が未実施のため。",
        "responsible_scripts_or_events": [
            "scripts/upsert-new-videos.mjs（2026-11-21 実行）",
            "新規収集バッチ（2026-11）",
        ],
        "proposed_source_of_truth": "TiDBを正とする",
        "proposed_sync_action": "承認後、不足66件をTiDBからSQLiteへ追加（これによりSQLiteのunverifiable_no_log 38件・invalidated 1件の差も解消）。",
    },
    "only_in_sqlite_48": {
        "why_it_differs": "過去に本番TiDBから削除・重複統合された48件が、差分追記型のSQLiteからパージされずに残留したため。",
        "responsible_scripts_or_events": [
            "本番TiDBでの手動削除・重複整理",
            "SQLite sync_database が削除同期（パージ）を行わない仕様",
        ],
        "proposed_source_of_truth": "TiDBを正とする",
        "proposed_sync_action": "承認後、本番に存在しない48件をSQLiteから削除する。",
    },
}

enriched_samples = {}
for cat, slist in (analysis.get("samples") or {}).items():
    enriched_samples[cat] = []
    for s in slist:
        vid = str(s["id"])
        td = tidb_detail.get(vid, {})
        sq = sq_map.get(vid, {})
        pr = prog_map.get(vid)
        t_bd = {}
        try:
            t_bd = json.loads(td.get("aiScoreBreakdown") or "{}")
        except Exception:
            pass
        enriched_samples[cat].append({
            "id": vid,
            "platform": td.get("platform") or s.get("platform"),
            "source": td.get("source") or s.get("source"),
            "tidb_history": {
                "ratings": f"{td.get('aiOverallRating')}/{td.get('aiDirectionRating')}/{td.get('aiTechniqueRating')}",
                "score100": td.get("aiOverallScore"),
                "createdAt": str(td.get("createdAt") or ""),
                "updatedAt": str(td.get("updatedAt") or ""),
                "addedDate": td.get("addedDate"),
                "breakdown_source": t_bd.get("source"),
                "analysisStatus": t_bd.get("analysisStatus"),
                "visualVerificationStatus": t_bd.get("visualVerificationStatus"),
                "analysis_head": (td.get("analysisHead") or "").replace("\n", " ")[:120],
            },
            "sqlite_history": {
                "ratings": f"{sq.get('overall_rating')}/{sq.get('direction_rating')}/{sq.get('technique_rating')}",
                "score100": sq.get("overall_score_100"),
                "updated_at_utc": fmt_epoch(sq.get("updated_at")),
                "analysis_head": (sq.get("analysis_head") or "").replace("\n", " ")[:120],
            },
            "in_full_audit_progress": bool(pr),
            "audit_progress_ratings": pr.get("ratings") if pr else None,
        })

analysis["sync_status"] = "PAUSED_AWAITING_USER_APPROVAL"
analysis["root_cause_and_proposals"] = cause_and_proposals
analysis["samples_with_update_history"] = enriched_samples

analysis_path.write_text(json.dumps(analysis, ensure_ascii=False, indent=2), encoding="utf-8")
(REPO / "analysis" / "_sample_tidb_detail.json").unlink(missing_ok=True)
print("Enriched db_sync_cause_analysis.json successfully with root causes, update histories, and per-category proposals.")
