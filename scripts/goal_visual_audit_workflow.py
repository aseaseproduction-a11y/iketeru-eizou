"""Parallel Visual Audit & Precision 5x20 Rubric Scoring Workflow (Antigravity run_workflow).

For each batch of videos:
  1. Downloads lightweight proxy via yt-dlp -> generates 4x4 timestamped contact sheets
     + measures real cut pacing (ffmpeg scdet) & audio loudness -> deletes raw video.
  2. Fans out parallel `flash` agents that visually inspect the contact sheet JPG(s)
     via `read_file`, audit the existing `aiAnalysis` for factual/timing/visual errors,
     and produce verified 5x20 rubric 100pt scores + rationale.
  3. Persists results to resumable JSONL logs, updates local SQLite DB, and pushes
     scores & breakdowns live to TiDB Cloud.
"""
import concurrent.futures
from datetime import datetime, timezone
import hashlib
import json
import os
import pathlib
import re
import shutil
import sqlite3
import statistics
import subprocess
import sys
import time
import uuid

sys.path.insert(0, r"E:\iketeru-creative-studio")
sys.path.insert(0, r"E:\iketeru-eizou\scripts")
from audit_video_media import inspect_video
from blind_redact import assert_no_rating_leak, redact_for_blind_scoring, strip_audit_ch11

REPO_ROOT = pathlib.Path(r"E:\iketeru-eizou")
SQLITE_DB = pathlib.Path(r"E:\iketeru-creative-studio\data\iketeru_knowledge.db")
PROGRESS_JSONL = REPO_ROOT / "analysis" / "full_audit_progress.jsonl"
RUBRIC_JSONL = REPO_ROOT / "analysis" / "rubric_100pt.jsonl"
CORRECTIONS_JSONL = REPO_ROOT / "analysis" / "analysis_corrections.jsonl"
WORK_TMP = REPO_ROOT / "analysis" / "_audit_tmp"

BANDS = {
    "S+": (97, 100, 98),
    "S":  (93, 96,  94),
    "S-": (90, 92,  91),
    "A+": (86, 89,  87),
    "A":  (82, 85,  83),
    "A-": (78, 81,  79),
    "B+": (73, 77,  75),
    "B":  (68, 72,  70),
    "B-": (63, 67,  65),
    "C+": (57, 62,  60),
    "C":  (51, 56,  53),
    "C-": (45, 50,  47),
    "D+": (35, 44,  40),
    "D":  (20, 34,  27),
    "D-": (0,  19,  10),
}

AUDIT_SCHEMA = {
    "type": "object",
    "required": [
        "video_id",
        "visual_checked",
        "analysis_verdict",
        "audit_findings",
        "grade_change_reason",
        "direction",
        "technique",
        "synergyAdjustment",
        "rationale",
    ],
    "properties": {
        "video_id": {"type": "string"},
        "visual_checked": {"type": "boolean"},
        "analysis_verdict": {"type": "string", "enum": ["accurate", "minor_fix", "major_fix", "needs_full_analysis"]},
        "audit_findings": {"type": "string", "description": "静止画コンタクトシートと既存分析・実測値の照合結果（確認できた範囲と未確認の限界を明記）"},
        "grade_change_reason": {"type": "string", "description": "既存DBランクからランクを上下に変更する場合の必須理由（変更なしなら空文字）"},
        "direction": {
            "type": "object",
            "required": ["hookAndStructure", "originality", "rhythmAndSync", "worldAndSubject", "intentAchievement"],
            "properties": {
                "hookAndStructure": {"type": "integer", "minimum": 0, "maximum": 20},
                "originality": {"type": "integer", "minimum": 0, "maximum": 20},
                "rhythmAndSync": {"type": "integer", "minimum": 0, "maximum": 20},
                "worldAndSubject": {"type": "integer", "minimum": 0, "maximum": 20},
                "intentAchievement": {"type": "integer", "minimum": 0, "maximum": 20},
            },
        },
        "technique": {
            "type": "object",
            "required": ["cinematographyAndArt", "editingAndMotion", "colorAndLook", "soundAndMix", "polishAndFinish"],
            "properties": {
                "cinematographyAndArt": {"type": "integer", "minimum": 0, "maximum": 20},
                "editingAndMotion": {"type": "integer", "minimum": 0, "maximum": 20},
                "colorAndLook": {"type": "integer", "minimum": 0, "maximum": 20},
                "soundAndMix": {"type": "integer", "minimum": 0, "maximum": 20},
                "polishAndFinish": {"type": "integer", "minimum": 0, "maximum": 20},
            },
        },
        "synergyAdjustment": {"type": "integer", "minimum": -5, "maximum": 5},
        "rationale": {"type": "string", "description": "実映像と分析を踏まえた、同一ランク内でこの点数（上限/中央/下限）とした具体的根拠（1文）"},
    },
}


def score_to_grade(score):
    for g, (lo, hi, _mid) in BANDS.items():
        if lo <= score <= hi:
            return g
    return "B"


def clamp_band(val, grade):
    band = BANDS.get(str(grade or "").strip())
    if not band:
        return None
    lo, hi, mid = band
    if val is None:
        return mid
    return max(lo, min(hi, int(round(val))))


def reconcile_rubric_to_score(rubric: dict, target_score: int | None) -> dict:
    """Ensure 5-item rubric values sum cleanly to target_score (each 0..20) when band clamping occurs."""
    out = {k: max(0, min(20, int(v))) for k, v in rubric.items()}
    if target_score is None:
        return out
    keys = list(out.keys())
    diff = int(target_score) - sum(out.values())
    idx = 0
    while diff != 0 and idx < 200:
        k = keys[idx % len(keys)]
        if diff > 0 and out[k] < 20:
            out[k] += 1
            diff -= 1
        elif diff < 0 and out[k] > 0:
            out[k] -= 1
            diff += 1
        idx += 1
    return out


def is_near_grade_boundary(score: int) -> bool:
    """True if score is within 1 point of an adjacent grade band (i.e. at lo or hi edge, excluding 0/100)."""
    for _g, (lo, hi, _mid) in BANDS.items():
        if lo <= score <= hi:
            near_lower = (lo > 0) and (score - lo == 0)
            near_upper = (hi < 100) and (hi - score == 0)
            return near_lower or near_upper
    return False


def extract_excerpt(ai_analysis: str, video_id: str = "") -> str:
    txt = redact_for_blind_scoring(ai_analysis, max_chars=2200)
    assert_no_rating_leak(txt, video_id=video_id)
    return txt


def load_done_ids() -> set[str]:
    done = set()
    if PROGRESS_JSONL.exists():
        for line in PROGRESS_JSONL.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
                if obj.get("video_id"):
                    done.add(str(obj["video_id"]))
            except Exception:
                pass
    return done


AUDIT_CH11_RE = re.compile(r"(?:\r?\n)*## 11\. 実映像ビジュアル監査・実測補正[\s\S]*?(?=\r?\n## |\Z)")


def strip_audit_ch11(text: str) -> str:
    return AUDIT_CH11_RE.sub("", str(text or "")).strip()


def sha256_text(text: str) -> str:
    return hashlib.sha256(str(text or "").encode("utf-8")).hexdigest()


def _build_node_env() -> dict:
    env = dict(os.environ)
    env["PATH"] = r"C:\Program Files\nodejs;" + env.get("PATH", "")
    env_file = REPO_ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8-sig").splitlines():
            if line.strip().startswith("DATABASE_URL="):
                env["DATABASE_URL"] = line.strip().split("=", 1)[1].strip()
    return env


wave_size = int(args.get("wave_size", 12))
chunk_size = int(args.get("chunk_size", 6))
ratings_filter = args.get("ratings")  # optional list like ["S+", "S"]
single_video_id = str(args.get("video_id") or "").strip()
explicit_video_ids = [str(x).strip() for x in (args.get("video_ids") or []) if str(x).strip()]

phase("1. Select next un-audited videos directly from TiDB Cloud (single source of truth)")
done_ids = load_done_ids()
fetch_cmd = ["node", "scripts/fetch-audit-targets-tidb.mjs"]
if explicit_video_ids:
    fetch_cmd.append("--video-ids=" + ",".join(explicit_video_ids))
elif single_video_id:
    fetch_cmd.append(f"--video-id={single_video_id}")
elif ratings_filter:
    fetch_cmd.append("--ratings=" + ",".join(ratings_filter))
fetch_proc = subprocess.run(
    fetch_cmd,
    cwd=str(REPO_ROOT),
    env=_build_node_env(),
    capture_output=True,
    text=True,
    encoding="utf-8",
    errors="replace",
    timeout=120.0,
)
if fetch_proc.returncode != 0:
    raise RuntimeError(f"TiDB target fetch failed: {fetch_proc.stderr}")
all_rows = json.loads(fetch_proc.stdout)

local_cache_only = bool(args.get("local_cache_only", False))
cached_ids = set()
if local_cache_only:
    cdir = pathlib.Path(r"D:\マイドライブ\iketeru_videos")
    if cdir.exists():
        cached_ids = {p.stem for p in cdir.iterdir() if p.is_file() and p.suffix.lower() in (".mp4", ".mov", ".mkv", ".webm", ".m4v")}

if explicit_video_ids:
    targets = [dict(r) for r in all_rows][:wave_size]
elif single_video_id:
    targets = [dict(r) for r in all_rows][:1]
else:
    targets = [
        dict(r) for r in all_rows
        if str(r["id"]) not in done_ids and (not local_cache_only or str(r["id"]) in cached_ids)
    ][:wave_size]

for t in targets:
    t["base_analysis_sha256"] = sha256_text(strip_audit_ch11(t.get("ai_analysis") or ""))
log(f"Loaded from TiDB Cloud | Already visually audited: {len(done_ids)} | Selected this wave: {len(targets)}")

if not targets:
    log("No remaining targets for this filter!")
else:
    phase("2. Download lightweight proxies, generate contact sheets & measure real cuts")
    WORK_TMP.mkdir(parents=True, exist_ok=True)
    media_map = {}

    media_workers = max(1, int(args.get("media_workers", 1)))
    media_delay = float(args.get("media_delay_sec", 2.5))

    def _fetch_one(t):
        vid = str(t["id"])
        out_d = WORK_TMP / re.sub(r"[^A-Za-z0-9_-]", "_", vid)
        try:
            info = inspect_video(vid, str(t["video_url"]), out_d)
        except Exception as exc:
            info = {"video_id": vid, "status": "unavailable", "error": str(exc)[:300], "sheets": []}
        if media_delay > 0 and info.get("source") != "local_cache":
            time.sleep(media_delay)
        return vid, info

    consec_bot_blocks = 0
    if media_workers == 1:
        for t in targets:
            vid, info = _fetch_one(t)
            media_map[vid] = info
            err_l = (info.get("error") or "").lower()
            if info.get("status") != "ok" and ("not a bot" in err_l or "sign in to confirm" in err_l):
                consec_bot_blocks += 1
                if consec_bot_blocks >= 5:
                    raise RuntimeError("YouTube anti-bot block detected (5 consecutive) — stopping wave before agent scoring.")
            else:
                consec_bot_blocks = 0
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=media_workers) as ex:
            for vid, info in ex.map(_fetch_one, targets):
                media_map[vid] = info
    ok_cnt = sum(1 for v in media_map.values() if v.get("status") == "ok")
    log(f"Media inspection complete: ok={ok_cnt}, unavailable={len(targets) - ok_cnt}")

    phase("3. Parallel visual audit & precision 5x20 rubric scoring")
    all_results = []
    for start in range(0, len(targets), chunk_size):
        chunk = targets[start : start + chunk_size]

        async def make_agent(item):
            vid = str(item["id"])
            m = media_map[vid]
            sheets = m.get("sheets") or []
            if not sheets:
                log(f"Skip {vid}: 0 contact-sheet images available (invalidated, not scoring blind)")
                return None
            o_r = item["overall_rating"] or "B"
            d_r = item["direction_rating"] or "B"
            t_r = item["technique_rating"] or "B"
            excerpt = extract_excerpt(item.get("ai_analysis") or "", video_id=vid)
            # Fail-closed pre-send assertion: abort if any rating/score text leaked into excerpt
            assert_no_rating_leak(excerpt, video_id=vid)
            media_summary = json.dumps(
                {k: m.get(k) for k in ("status", "duration_sec", "width", "height", "fps", "mean_volume_db", "max_volume_db", "real_cuts", "error")},
                ensure_ascii=False,
            )
            sheet_instr = (
                "まず以下の静止画コンタクトシート画像を必ず `read_file` で確認してください:\n"
                + "\n".join(f"- {s}" for s in sheets)
            )

            def _calc_scores(res_obj):
                d_d = {k: max(0, min(20, int(v))) for k, v in res_obj["direction"].items()}
                t_d = {k: max(0, min(20, int(v))) for k, v in res_obj["technique"].items()}
                ds = sum(d_d.values())
                ts = sum(t_d.values())
                adj = max(-5, min(5, int(res_obj["synergyAdjustment"])))
                os_ = max(0, min(100, round(ds * 0.55 + ts * 0.45) + adj))
                return os_, ds, ts, adj, d_d, t_d

            async def _run_single_blind_pass(run_num: int):
                audit_run_token = uuid.uuid4().hex[:12]
                prompt = f"""あなたは映像ディレクター兼品質監査官です。
対象動画の静止画コンタクトシート・実測データ・既存AI分析（既存ランク非表示）を突き合わせ、**ブラインド独立採点として客観的プロ基準（Cannes Lions Film Craft / D&AD Pencil / ACC基準）で採点**し、最後に必ず `finish` ツールでJSON結果を返してください。

【対象動画】
- AuditRunToken: {audit_run_token}
- video_id: {vid}
- タイトル: {item['title']}
- URL: {item['video_url']}

【計測データ（ffprobe + ffmpeg scdet実カット検出）】
{media_summary}

【静止画コンタクトシート確認タスク】
{sheet_instr}

【採点ガイドライン（厳守）】
- **ブラインド独立採点**: 演出5観点（各0〜20点）・技術5観点（各0〜20点）を客観プロ基準で独立採点すること。
- **各観点の点数の根拠を必須記載**: `grade_change_reason` 欄には「各観点の点数の根拠（なぜこの水準・点数にしたか）」を具体的に必ず記載すること（空欄不可）。
- **確認不能な観点で減点しない（重要）**: 静止画コンタクトシートでは確認できない観点（音響ミックス `soundAndMix` や 30fps/60fps モーションの滑らかさ等）を「確認できないから慎重に低めにする」という理由で減点してはならない。確認できた観点の水準を基準に換算し、未確認である事実のみ `audit_findings` に記載すること。
- 既存分析に事実誤認・尺ズレ・色彩/構図の誤描写・未分析がある場合は `analysis_verdict` を `minor_fix` / `major_fix` / `needs_full_analysis` にし、`audit_findings` へ具体的に記載すること。
- **最重要**: 分析と採点が完了したらテキスト応答だけで終了せず、必ず `finish` ツールを呼び出してJSONオブジェクトを返却すること。

【既存AI分析抜粋（既存ランク非表示）】
{excerpt}
"""
                for attempt in range(3):
                    try:
                        audit_started_at = datetime.now(timezone.utc).isoformat()
                        out = await agent(
                            prompt,
                            schema=AUDIT_SCHEMA,
                            role=f"Audit {vid} r{run_num}" + (f" [retry {attempt}]" if attempt else ""),
                        )
                        if isinstance(out, dict):
                            reason_tmp = str(out.get("grade_change_reason") or "").strip()
                            if not reason_tmp:
                                log(f"Rejected {vid} r{run_num} (attempt {attempt + 1}/3): empty scoring rationale; retrying.")
                                if attempt == 2:
                                    return None
                                continue
                            worker_conv_id = str(out.get("_conversation_id") or out.get("conversation_id") or "")
                            if not worker_conv_id:
                                try:
                                    brain_root = pathlib.Path(r"C:\Users\t1257\.gemini\antigravity\brain")
                                    start_epoch = datetime.fromisoformat(audit_started_at).timestamp() - 5.0
                                    token_marker = f"AuditRunToken: {audit_run_token}"
                                    for p_tx in brain_root.glob("*/.system_generated/logs/transcript.jsonl"):
                                        if p_tx.stat().st_mtime < start_epoch:
                                            continue
                                        head = p_tx.read_text(encoding="utf-8", errors="ignore")[:4000]
                                        if token_marker in head:
                                            worker_conv_id = p_tx.parent.parent.parent.name
                                            break
                                except Exception:
                                    pass
                            out["_audit_run_token"] = audit_run_token
                            out["_audit_started_at"] = audit_started_at
                            out["_worker_conversation_id"] = worker_conv_id
                        return out
                    except Exception as exc:
                        msg = str(exc)
                        if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
                            raise
                        log(f"Agent error on {vid} r{run_num} (attempt {attempt + 1}/3): {msg[:160]}")
                        if attempt == 2:
                            return None

            # 2+1 Adaptive Ensemble: run 2 independent blind passes; if any axis differs by >= 4 pts, run a 3rd pass and take median
            r1 = await _run_single_blind_pass(1)
            r2 = await _run_single_blind_pass(2)
            if not isinstance(r1, dict) or not isinstance(r2, dict):
                return None
            o1, d1, t1, adj1, dd1, td1 = _calc_scores(r1)
            o2, d2, t2, adj2, dd2, td2 = _calc_scores(r2)

            VERDICT_SEVERITY = {"needs_full_analysis": 3, "major_fix": 2, "minor_fix": 1, "accurate": 0}

            def _merge_verdict_and_findings(run_objs):
                strictest = max(run_objs, key=lambda x: VERDICT_SEVERITY.get(str(x.get("analysis_verdict") or ""), 0))
                strictest_verdict = strictest.get("analysis_verdict") or "accurate"
                strict_findings = [
                    str(x.get("audit_findings") or "").strip()
                    for x in run_objs
                    if x.get("analysis_verdict") == strictest_verdict and str(x.get("audit_findings") or "").strip()
                ]
                merged_findings = strict_findings[0] if strict_findings else str(strictest.get("audit_findings") or "")
                return strictest_verdict, merged_findings

            if abs(o1 - o2) <= 3 and abs(d1 - d2) <= 3 and abs(t1 - t2) <= 3:
                ensemble_mode = "2_run_mean"
                runs_list = [r1, r2]
                final_d = int(round((d1 + d2) / 2))
                final_t = int(round((t1 + t2) / 2))
                final_adj = int(round((adj1 + adj2) / 2))
                final_o = max(0, min(100, round(final_d * 0.55 + final_t * 0.45) + final_adj))
                avg_d_rub = {k: round((dd1[k] + dd2[k]) / 2) for k in dd1}
                avg_t_rub = {k: round((td1[k] + td2[k]) / 2) for k in td1}
                merged = dict(r1)
                merged["direction"] = reconcile_rubric_to_score(avg_d_rub, final_d)
                merged["technique"] = reconcile_rubric_to_score(avg_t_rub, final_t)
                merged["synergyAdjustment"] = final_adj
            else:
                r3 = await _run_single_blind_pass(3)
                if not isinstance(r3, dict):
                    return None
                ensemble_mode = "3_run_median"
                runs_list = [r1, r2, r3]
                o3, d3, t3, adj3, dd3, td3 = _calc_scores(r3)
                final_d = int(round(statistics.median([d1, d2, d3])))
                final_t = int(round(statistics.median([t1, t2, t3])))
                final_adj = int(round(statistics.median([adj1, adj2, adj3])))
                # Recalculate overall from median direction/technique/synergy so overall & breakdown always agree (#4)
                final_o = max(0, min(100, round(final_d * 0.55 + final_t * 0.45) + final_adj))
                scored_runs = [(abs(o1 - final_o), r1, dd1, td1), (abs(o2 - final_o), r2, dd2, td2), (abs(o3 - final_o), r3, dd3, td3)]
                scored_runs.sort(key=lambda x: x[0])
                _, med_run, med_dd, med_td = scored_runs[0]
                merged = dict(med_run)
                merged["direction"] = reconcile_rubric_to_score(med_dd, final_d)
                merged["technique"] = reconcile_rubric_to_score(med_td, final_t)
                merged["synergyAdjustment"] = final_adj

            # Apply strict verdict precedence across all runs in the ensemble (#5)
            strict_verdict, strict_findings = _merge_verdict_and_findings(runs_list)
            merged["analysis_verdict"] = strict_verdict
            merged["audit_findings"] = strict_findings

            merged["_ensemble_mode"] = ensemble_mode
            merged["_ensemble_final_overall"] = final_o
            merged["_ensemble_runs"] = [
                {
                    "run": idx + 1,
                    "overall": _calc_scores(rr)[0],
                    "direction": _calc_scores(rr)[1],
                    "technique": _calc_scores(rr)[2],
                    "worker_conversation_id": rr.get("_worker_conversation_id", ""),
                    "audit_run_token": rr.get("_audit_run_token", ""),
                }
                for idx, rr in enumerate(runs_list)
            ]
            merged["_worker_conversation_ids"] = [rr.get("_worker_conversation_id", "") for rr in runs_list]
            merged["_audit_run_tokens"] = [rr.get("_audit_run_token", "") for rr in runs_list]
            merged["visual_checked"] = all(bool(rr.get("visual_checked")) for rr in runs_list)
            return merged

        chunk_raw = await parallel(chunk, make_agent)
        chunk_out = [r for r in chunk_raw if isinstance(r, dict) and r.get("video_id")]
        all_results.extend(chunk_out)

        # Checkpoint persist after every chunk so zero progress is ever lost
        PROGRESS_JSONL.parent.mkdir(parents=True, exist_ok=True)
        by_id_chunk = {str(t["id"]): t for t in chunk}
        c_prog, c_rub, c_corr, c_sql = [], [], [], []
        for res in chunk_out:
            vid = str(res["video_id"])
            item = by_id_chunk[vid]
            m = media_map[vid]
            d_dict = {k: max(0, min(20, int(v))) for k, v in res["direction"].items()}
            t_dict = {k: max(0, min(20, int(v))) for k, v in res["technique"].items()}
            dir_score = sum(d_dict.values())
            tech_score = sum(t_dict.values())
            adj = max(-5, min(5, int(res["synergyAdjustment"])))
            overall_score = int(res.get("_ensemble_final_overall")) if res.get("_ensemble_final_overall") is not None else max(0, min(100, round(dir_score * 0.55 + tech_score * 0.45) + adj))
            new_o_grade = score_to_grade(overall_score)
            new_d_grade = score_to_grade(dir_score)
            new_t_grade = score_to_grade(tech_score)
            rec_dir = d_dict
            rec_tech = t_dict
            grade_changed = (new_o_grade != item["overall_rating"])
            change_reason = (res.get("grade_change_reason") or "").strip()
            if not change_reason:
                log(f"Skipping {vid} at persist: empty scoring rationale (grade_change_reason).")
                continue
            grade_boundary = is_near_grade_boundary(overall_score)
            is_needs_full = (res.get("analysis_verdict") == "needs_full_analysis")
            is_provisional = (not bool(res.get("visual_checked"))) or is_needs_full
            audit_run_token = str(res.get("_audit_run_token") or "")
            audit_started_at = str(res.get("_audit_started_at") or "")
            worker_conv_id = str(res.get("_worker_conversation_id") or "")
            worker_conv_ids = res.get("_worker_conversation_ids") or ([worker_conv_id] if worker_conv_id else [])
            audit_run_tokens = res.get("_audit_run_tokens") or ([audit_run_token] if audit_run_token else [])
            ensemble_mode = str(res.get("_ensemble_mode") or "single")
            ensemble_runs = res.get("_ensemble_runs") or []
            base_hash = str(item.get("base_analysis_sha256") or "")
            breakdown = {
                "source": "rubric_unclamped",
                "version": "2.2",
                "blindScoring": True,
                "ensembleMode": ensemble_mode,
                "ensembleRuns": ensemble_runs,
                "gradeBoundary": grade_boundary,
                "model": "antigravity-contact-sheet-audit",
                "analysisStatus": "provisional" if is_provisional else "full_analysis",
                "isProvisional": is_provisional,
                "visualVerificationStatus": "unverified_pending" if res.get("visual_checked") else "invalidated_no_visual",
                "visualChecked": bool(res.get("visual_checked")),
                "auditRunToken": audit_run_token,
                "auditRunTokens": audit_run_tokens,
                "auditStartedAt": audit_started_at,
                "workerConversationId": worker_conv_id,
                "workerConversationIds": worker_conv_ids,
                "baseAnalysisSha256": base_hash,
                "inspectionMethod": "contact_sheet_static_frames",
                "analysisVerdict": res.get("analysis_verdict"),
                "auditFindings": res.get("audit_findings", ""),
                "previousOverallRating": item["overall_rating"],
                "previousDirectionRating": item["direction_rating"],
                "previousTechniqueRating": item["technique_rating"],
                "newOverallRating": new_o_grade,
                "gradeChangeReason": change_reason,
                "realCuts": m.get("real_cuts") if m.get("status") == "ok" else None,
                "direction": rec_dir,
                "technique": rec_tech,
                "synergyAdjustment": adj,
                "rationale": res["rationale"],
            }
            rubric_obj = {
                "id": vid,
                "aiOverallRating": new_o_grade,
                "aiDirectionRating": new_d_grade,
                "aiTechniqueRating": new_t_grade,
                "aiOverallScore": overall_score,
                "aiDirectionScore": dir_score,
                "aiTechniqueScore": tech_score,
                "aiScoreBreakdown": breakdown,
            }
            prog_obj = {
                "video_id": vid,
                "title": item["title"],
                "ensemble_mode": ensemble_mode,
                "grade_boundary": grade_boundary,
                "audit_run_token": audit_run_token,
                "audit_run_tokens": audit_run_tokens,
                "audit_started_at": audit_started_at,
                "worker_conversation_id": worker_conv_id,
                "worker_conversation_ids": worker_conv_ids,
                "base_analysis_sha256": base_hash,
                "previous_ratings": f"{item['overall_rating']}/{item['direction_rating']}/{item['technique_rating']}",
                "ratings": f"{new_o_grade}/{new_d_grade}/{new_t_grade}",
                "scores100": f"{overall_score}/{dir_score}/{tech_score}",
                "media_status": m.get("status"),
                "visual_checked": bool(res.get("visual_checked")),
                "analysis_verdict": res.get("analysis_verdict"),
                "audit_findings": res.get("audit_findings", ""),
                "grade_change_reason": change_reason,
                "real_cuts": m.get("real_cuts"),
                "rationale": res["rationale"],
            }
            c_prog.append(json.dumps(prog_obj, ensure_ascii=False))
            c_rub.append(json.dumps(rubric_obj, ensure_ascii=False))
            if res.get("analysis_verdict") != "accurate" or grade_changed:
                c_corr.append(json.dumps(prog_obj, ensure_ascii=False))
            rating_order = ["S+", "S", "S-", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-"]
            rank_int = lambda g: (len(rating_order) - rating_order.index(g)) if g in rating_order else 0
            c_sql.append((
                new_o_grade,
                new_d_grade,
                new_t_grade,
                rank_int(new_o_grade),
                rank_int(new_d_grade),
                rank_int(new_t_grade),
                overall_score,
                dir_score,
                tech_score,
                json.dumps(breakdown, ensure_ascii=False),
                vid,
            ))

        with PROGRESS_JSONL.open("a", encoding="utf-8") as f:
            f.write("\n".join(c_prog) + "\n")
        with RUBRIC_JSONL.open("a", encoding="utf-8") as f:
            f.write("\n".join(c_rub) + "\n")
        if c_corr:
            with CORRECTIONS_JSONL.open("a", encoding="utf-8") as f:
                f.write("\n".join(c_corr) + "\n")
        # Note: Do NOT write to SQLite here before TiDB commit & log verification;
        # SQLite is updated strictly as a one-way mirror at the end of Phase 4.
        log(f"Checkpointed chunk {start + 1}..{start + len(chunk)} / {len(targets)} (total audited: {len(done_ids) + len(all_results)})")

    phase("4. Sync wave to TiDB Cloud, verify worker logs, patch current-wave aiAnalysis, and clean temp sheets")
    batch_rubric_file = WORK_TMP / "_batch_rubric.jsonl"
    batch_progress_file = WORK_TMP / "_batch_progress.jsonl"
    wave_ids = {str(t["id"]) for t in targets}
    wave_rub_lines = [l for l in RUBRIC_JSONL.read_text(encoding="utf-8").splitlines() if l.strip() and json.loads(l).get("id") in wave_ids]
    wave_prog_lines = [l for l in PROGRESS_JSONL.read_text(encoding="utf-8").splitlines() if l.strip() and json.loads(l).get("video_id") in wave_ids]
    batch_rubric_file.write_text("\n".join(wave_rub_lines) + "\n", encoding="utf-8")
    batch_progress_file.write_text("\n".join(wave_prog_lines) + "\n", encoding="utf-8")

    # Push to TiDB Cloud
    env = _build_node_env()
    def _run_node_retry(cmd_args, label, attempts=3):
        last_proc = None
        for att in range(1, attempts + 1):
            last_proc = subprocess.run(
                cmd_args,
                cwd=str(REPO_ROOT),
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=120.0,
            )
            if last_proc.returncode == 0:
                log(f"{label} exit: 0", last_proc.stdout.strip()[:300])
                return last_proc
            log(f"{label} attempt {att}/{attempts} failed (exit {last_proc.returncode}): {last_proc.stderr.strip()[:180]}")
            time.sleep(3 * att)
        return last_proc

    proc = _run_node_retry(
        ["node", "scripts/backfill-100pt-scores.mjs", f"--from-jsonl={batch_rubric_file}", "--apply"],
        "TiDB update",
    )
    if proc.returncode != 0:
        raise RuntimeError(f"TiDB backfill failed: {proc.stderr}")

    # 1) Cross-check worker transcripts FIRST before applying any Ch.11 patches, and fail loudly on any error.
    for cmd_args, label in (
        ([sys.executable, "scripts/verify_visual_logs.py"], "Worker transcript log verification"),
        (["node", "scripts/stamp-structured-status.mjs"], "TiDB structured status & invalidation"),
    ):
        step_proc = _run_node_retry(cmd_args, label)
        if step_proc.returncode != 0:
            raise RuntimeError(f"Post-wave step failed [{label}] (exit {step_proc.returncode}): {step_proc.stderr}")

    # 2) Only after log verification & invalidation, patch CURRENT WAVE aiAnalysis (log_verified + hash-verified only)
    patch_proc = _run_node_retry(
        ["node", "scripts/apply-audit-patches.mjs", f"--from-jsonl={batch_progress_file}", "--apply"],
        "TiDB current-wave aiAnalysis patch",
    )
    if patch_proc.returncode != 0:
        raise RuntimeError(f"TiDB aiAnalysis patch failed: {patch_proc.stderr}")
    _run_node_retry(["node", "scripts/repair-metadata-from-analysis.mjs", "--apply"], "TiDB metadata repair")

    # 3) One-way mirror: copy the finalized TiDB rows (ratings, scores, breakdown, AND aiAnalysis with ## 11.) into SQLite
    mirror_proc = _run_node_retry(
        [sys.executable, "scripts/mirror_wave_tidb_to_sqlite.py", "--ids=" + ",".join(sorted(wave_ids))],
        "TiDB -> SQLite one-way wave mirror",
    )
    if mirror_proc.returncode != 0:
        raise RuntimeError(f"TiDB -> SQLite mirror failed: {mirror_proc.stderr}")

    shutil.rmtree(WORK_TMP, ignore_errors=True)

    verdicts = {}
    for r in all_results:
        v = r.get("analysis_verdict", "unknown")
        verdicts[v] = verdicts.get(v, 0) + 1
    log(f"Wave finished! Total audited now: {len(done_ids) + len(all_results)} | Verdicts this wave: {verdicts}")
