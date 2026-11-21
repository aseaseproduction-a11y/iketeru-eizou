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
import json
import os
import pathlib
import re
import shutil
import sqlite3
import subprocess
import sys
import time

sys.path.insert(0, r"E:\iketeru-creative-studio")
sys.path.insert(0, r"E:\iketeru-eizou\scripts")
from audit_video_media import inspect_video

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


def extract_excerpt(ai_analysis: str) -> str:
    txt = str(ai_analysis or "").strip()
    if not txt:
        return "(既存AI分析なし)"
    secs = re.split(r"(?=^## \d+\.)", txt, flags=re.MULTILINE)
    picked = []
    has_ch8_improve = False
    for s in secs:
        st = s.strip()
        if re.match(r"^## [045]\.", st):
            picked.append(st[:450])
        elif re.match(r"^## 8\.", st):
            head = st.splitlines()[0] if st else ""
            if "データベース登録情報" not in head:
                picked.append(st[:450])
                has_ch8_improve = True
    if not has_ch8_improve:
        for s in secs:
            st = s.strip()
            if re.match(r"^## 7\.", st):
                picked.append(st[:450])
                break
    return "\n\n".join(picked)[:1900] if picked else txt[:1800]


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


wave_size = int(args.get("wave_size", 12))
chunk_size = int(args.get("chunk_size", 6))
ratings_filter = args.get("ratings")  # optional list like ["S+", "S"]

phase("1. Select next un-audited videos")
done_ids = load_done_ids()
conn = sqlite3.connect(str(SQLITE_DB), timeout=30.0)
conn.row_factory = sqlite3.Row
if ratings_filter:
    ph = ",".join("?" for _ in ratings_filter)
    sql = f"""
    SELECT id, platform, title, video_url, overall_rating, direction_rating, technique_rating, ai_analysis
    FROM videos
    WHERE overall_rating IN ({ph})
    ORDER BY overall_score DESC, direction_score DESC, technique_score DESC, id ASC
    """
    all_rows = conn.execute(sql, list(ratings_filter)).fetchall()
else:
    all_rows = conn.execute(
        """
        SELECT id, platform, title, video_url, overall_rating, direction_rating, technique_rating, ai_analysis
        FROM videos
        ORDER BY overall_score DESC, direction_score DESC, technique_score DESC, id ASC
        """
    ).fetchall()
conn.close()

local_cache_only = bool(args.get("local_cache_only", False))
cached_ids = set()
if local_cache_only:
    cdir = pathlib.Path(r"D:\マイドライブ\iketeru_videos")
    if cdir.exists():
        cached_ids = {p.stem for p in cdir.iterdir() if p.is_file() and p.suffix.lower() in (".mp4", ".mov", ".mkv", ".webm", ".m4v")}

targets = [
    dict(r) for r in all_rows
    if str(r["id"]) not in done_ids and (not local_cache_only or str(r["id"]) in cached_ids)
][:wave_size]
log(f"Already visually audited: {len(done_ids)} | Selected this wave: {len(targets)}")

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
            excerpt = extract_excerpt(item.get("ai_analysis") or "")
            media_summary = json.dumps(
                {k: m.get(k) for k in ("status", "duration_sec", "width", "height", "fps", "mean_volume_db", "max_volume_db", "real_cuts", "error")},
                ensure_ascii=False,
            )
            sheet_instr = (
                "まず以下の静止画コンタクトシート画像を必ず `read_file` で確認してください:\n"
                + "\n".join(f"- {s}" for s in sheets)
            )
            prompt = f"""あなたは映像ディレクター兼品質監査官です。
対象動画の静止画コンタクトシート・実測データ・既存AI分析を突き合わせ、**現行ランクに縛られず客観的プロ基準（Cannes Lions Film Craft / D&AD Pencil / ACC基準）で独立採点**し、最後に必ず `finish` ツールでJSON結果を返してください。

【対象動画】
- video_id: {vid}
- タイトル: {item['title']}
- URL: {item['video_url']}
- 参考（既存DBランク・変更可）: 総合={o_r} / 演出={d_r} / 技術={t_r}

【計測データ（ffprobe + ffmpeg scdet実カット検出）】
{media_summary}

【静止画コンタクトシート確認タスク】
{sheet_instr}

【採点ガイドライン（厳守）】
- **ランク据え置き禁止（独立採点）**: 既存DBランクに引っ張られず、演出5観点（各0〜20点）・技術5観点（各0〜20点）を客観基準で採点すること。
- **ランク変更時の理由必須**: 算出された新ランクが既存DBランクと異なる場合は、`grade_change_reason` に「どの観点で既存評価が過大/過小だったか」を具体的に必ず記載すること（同一ランクの場合は空文字可）。
- **限界の明示**: 静止画コンタクトシートで確認できない動きの滑らかさ・音響ミックス等は推測で断定せず、確認できた範囲と未確認の限界を正直に記載すること。
- 既存分析に事実誤認・尺ズレ・色彩/構図の誤描写・未分析がある場合は `analysis_verdict` を `minor_fix` / `major_fix` / `needs_full_analysis` にし、`audit_findings` へ具体的に記載すること。
- **最重要**: 分析と採点が完了したらテキスト応答だけで終了せず、必ず `finish` ツールを呼び出してJSONオブジェクトを返却すること。

【既存AI分析抜粋】
{excerpt}
"""
            for attempt in range(2):
                try:
                    return await agent(
                        prompt,
                        schema=AUDIT_SCHEMA,
                        role=f"Audit {vid} ({o_r})" + (" [retry]" if attempt else ""),
                    )
                except Exception as exc:
                    msg = str(exc)
                    if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
                        raise
                    log(f"Agent error on {vid} (attempt {attempt + 1}/2): {msg[:160]}")
                    if attempt == 1:
                        return None

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
            overall_score = max(0, min(100, round(dir_score * 0.55 + tech_score * 0.45) + adj))
            new_o_grade = score_to_grade(overall_score)
            new_d_grade = score_to_grade(dir_score)
            new_t_grade = score_to_grade(tech_score)
            rec_dir = d_dict
            rec_tech = t_dict
            grade_changed = (new_o_grade != item["overall_rating"])
            change_reason = (res.get("grade_change_reason") or "").strip()
            if grade_changed and not change_reason:
                change_reason = f"ルーブリック合計変更（{item['overall_rating']} -> {new_o_grade}: {res['rationale'][:120]}）"
            is_needs_full = (res.get("analysis_verdict") == "needs_full_analysis")
            is_provisional = (not bool(res.get("visual_checked"))) or is_needs_full
            breakdown = {
                "source": "rubric_unclamped",
                "version": "2.0",
                "model": "antigravity-contact-sheet-audit",
                "analysisStatus": "provisional" if is_provisional else "full_analysis",
                "isProvisional": is_provisional,
                "visualVerificationStatus": "unverified_pending" if res.get("visual_checked") else "invalidated_no_visual",
                "visualChecked": bool(res.get("visual_checked")),
                "inspectionMethod": "contact_sheet_static_frames",
                "analysisVerdict": res.get("analysis_verdict"),
                "auditFindings": res.get("audit_findings", ""),
                "previousOverallRating": item["overall_rating"],
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
        conn_c = sqlite3.connect(str(SQLITE_DB), timeout=30.0)
        conn_c.execute("PRAGMA busy_timeout=30000")
        conn_c.executemany(
            "UPDATE videos SET overall_rating=?, direction_rating=?, technique_rating=?, overall_score=?, direction_score=?, technique_score=?, overall_score_100=?, direction_score_100=?, technique_score_100=?, score_breakdown_json=? WHERE id=?",
            c_sql,
        )
        conn_c.commit()
        conn_c.close()
        log(f"Checkpointed chunk {start + 1}..{start + len(chunk)} / {len(targets)} (total audited: {len(done_ids) + len(all_results)})")

    phase("4. Sync wave to TiDB Cloud, patch aiAnalysis, and clean temp sheets")
    batch_rubric_file = WORK_TMP / "_batch_rubric.jsonl"
    # Collect just this wave's rubric records from RUBRIC_JSONL tail
    wave_ids = {str(t["id"]) for t in targets}
    wave_rub_lines = [l for l in RUBRIC_JSONL.read_text(encoding="utf-8").splitlines() if l.strip() and json.loads(l).get("id") in wave_ids]
    batch_rubric_file.write_text("\n".join(wave_rub_lines) + "\n", encoding="utf-8")

    # Push to TiDB Cloud
    env_file = REPO_ROOT / ".env"
    env = dict(os.environ)
    env["PATH"] = r"C:\Program Files\nodejs;" + env.get("PATH", "")
    for line in env_file.read_text(encoding="utf-8-sig").splitlines():
        if line.strip().startswith("DATABASE_URL="):
            env["DATABASE_URL"] = line.strip().split("=", 1)[1].strip()
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

    _run_node_retry(["node", "scripts/apply-audit-patches.mjs", "--apply"], "TiDB aiAnalysis patch")
    _run_node_retry(["node", "scripts/repair-metadata-from-analysis.mjs", "--apply"], "TiDB metadata repair")

    # Immediately cross-check worker transcripts before Antigravity prunes old logs, then promote unverified_pending -> log_verified
    # Fail the wave loudly if any of these 3 post-wave steps fails.
    for cmd_args, label in (
        ([sys.executable, "scripts/verify_visual_logs.py"], "Worker transcript log verification"),
        (["node", "scripts/stamp-structured-status.mjs"], "TiDB structured status promotion"),
        ([sys.executable, "scripts/stamp_sqlite_status.py"], "SQLite structured status promotion"),
    ):
        step_proc = _run_node_retry(cmd_args, label)
        if step_proc.returncode != 0:
            raise RuntimeError(f"Post-wave step failed [{label}] (exit {step_proc.returncode}): {step_proc.stderr}")

    shutil.rmtree(WORK_TMP, ignore_errors=True)

    verdicts = {}
    for r in all_results:
        v = r.get("analysis_verdict", "unknown")
        verdicts[v] = verdicts.get(v, 0) + 1
    log(f"Wave finished! Total audited now: {len(done_ids) + len(all_results)} | Verdicts this wave: {verdicts}")
