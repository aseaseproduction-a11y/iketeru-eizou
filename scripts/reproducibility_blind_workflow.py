"""Blind Scoring Reproducibility Test Workflow (Same 10 videos x 3 independent runs = 30 scorings).

- NO existing DB rating or score in prompt or excerpt (strictly blind).
- Records audit_run_token + worker_conversation_id for every single run and verifies
  actual read_file + image/jpeg media loading directly in worker transcripts.
- Strictly READ-ONLY against TiDB Cloud and SQLite. Writes ONLY to analysis/reproducibility_blind_10x3.json.
"""
from datetime import datetime, timezone
import json
import os
import pathlib
import re
import shutil
import statistics
import subprocess
import sys
import uuid

sys.path.insert(0, r"E:\iketeru-creative-studio")
sys.path.insert(0, r"E:\iketeru-eizou\scripts")
from audit_video_media import inspect_video

REPO_ROOT = pathlib.Path(r"E:\iketeru-eizou")
BRAIN_ROOT = pathlib.Path(r"C:\Users\t1257\.gemini\antigravity\brain")
PRIOR_REPRO = REPO_ROOT / "analysis" / "reproducibility_10x3.json"
OUT_FILE = REPO_ROOT / "analysis" / "reproducibility_blind_10x3.json"
WORK_TMP = REPO_ROOT / "analysis" / "_repro_blind_tmp"

BANDS = {
    "S+": (97, 100), "S": (93, 96), "S-": (90, 92),
    "A+": (86, 89),  "A": (82, 85), "A-": (78, 81),
    "B+": (73, 77),  "B": (68, 72), "B-": (63, 67),
    "C+": (57, 62),  "C": (51, 56), "C-": (45, 50),
    "D+": (35, 44),  "D": (20, 34), "D-": (0, 19),
}

AUDIT_CH11_RE = re.compile(r"(?:\r?\n)*## 11\. 実映像ビジュアル監査・実測補正[\s\S]*?(?=\r?\n## |\Z)")
IMG_EXT_RE = re.compile(r"\.(?:jpg|jpeg|png|webp)$", re.IGNORECASE)

def score_to_grade(score):
    for g, (lo, hi) in BANDS.items():
        if lo <= score <= hi:
            return g
    return "B"

def is_near_grade_boundary(score: int) -> bool:
    for _g, (lo, hi) in BANDS.items():
        if lo <= score <= hi:
            return ((lo > 0) and (score == lo)) or ((hi < 100) and (score == hi))
    return False

def strip_rating_anchors(text: str) -> str:
    cleaned = AUDIT_CH11_RE.sub("", str(text or "")).strip()
    cleaned = re.sub(
        r"(?:総合|演出|ディレクション|技術|AI)(?:評価|ランク)\s*[:：=＝]\s*[SABCD][+-]?(?:\s*[（(]\d+点[）)])?",
        "[既存ランク非表示]",
        cleaned,
    )
    cleaned = re.sub(r"\b[SABCD][+-]?\s*ランク\b", "[既存ランク非表示]", cleaned)
    return cleaned

def verify_transcript_by_conv_id(conv_id: str, expected_vid: str, expected_token: str) -> dict:
    if not conv_id:
        return {"log_verified": False, "reason": "missing_conv_id", "img_read_calls": 0, "img_media_loaded": 0}
    tx_path = BRAIN_ROOT / conv_id / ".system_generated" / "logs" / "transcript.jsonl"
    if not tx_path.exists():
        return {"log_verified": False, "reason": "transcript_not_found", "img_read_calls": 0, "img_media_loaded": 0}
    txt = tx_path.read_text(encoding="utf-8", errors="ignore")
    vid_ok = (expected_vid in txt)
    token_ok = (f"AuditRunToken: {expected_token}" in txt)
    img_calls = 0
    img_loaded = 0
    for line in txt.splitlines():
        try:
            step = json.loads(line)
        except Exception:
            continue
        if step.get("media"):
            for med in step["media"]:
                if str(med.get("mime_type", "")).startswith("image/"):
                    img_loaded += 1
        for tc in step.get("tool_calls") or []:
            if tc.get("name") == "read_file":
                raw_p = str((tc.get("args") or {}).get("Path") or "").strip('"')
                if IMG_EXT_RE.search(raw_p):
                    img_calls += 1
    verified = bool(vid_ok and token_ok and img_calls > 0 and img_loaded > 0)
    return {
        "log_verified": verified,
        "vid_matched": vid_ok,
        "token_matched": token_ok,
        "img_read_calls": img_calls,
        "img_media_loaded": img_loaded,
    }

AUDIT_SCHEMA = {
    "type": "object",
    "required": [
        "video_id", "visual_checked", "analysis_verdict", "audit_findings",
        "grade_change_reason", "direction", "technique", "synergyAdjustment", "rationale",
    ],
    "properties": {
        "video_id": {"type": "string"},
        "visual_checked": {"type": "boolean"},
        "analysis_verdict": {"type": "string", "enum": ["accurate", "minor_fix", "major_fix", "needs_full_analysis"]},
        "audit_findings": {"type": "string"},
        "grade_change_reason": {"type": "string", "description": "各観点の点数の具体的根拠（空欄不可）"},
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
        "rationale": {"type": "string"},
    },
}

phase("1. Load exact same 10 videos from prior reproducibility test (read-only) & build contact sheets")
prior_doc = json.loads(PRIOR_REPRO.read_text(encoding="utf-8"))
prior_vids = [v["video_id"] for v in prior_doc["per_video"]]

env = dict(os.environ)
env["PATH"] = r"C:\Program Files\nodejs;" + env.get("PATH", "")

targets = []
WORK_TMP.mkdir(parents=True, exist_ok=True)
for vid in prior_vids:
    raw = subprocess.check_output(
        ["node", "scripts/fetch-audit-targets-tidb.mjs", f"--video-id={vid}"],
        cwd=str(REPO_ROOT),
        env=env,
        text=True,
        encoding="utf-8",
    )
    row = json.loads(raw)[0]
    out_d = WORK_TMP / re.sub(r"[^A-Za-z0-9_-]", "_", vid)
    info = inspect_video(vid, str(row["video_url"]), out_d)
    if not info.get("sheets"):
        raise RuntimeError(f"No contact sheets generated for {vid}")
    row["media"] = info
    targets.append(row)

log(f"Prepared {len(targets)} videos for BLIND reproducibility test.")

phase("2. Run 3 independent BLIND scorings per video (30 agent calls, with AuditRunToken + log verification)")
jobs = [{"item": t, "run_idx": run_idx} for t in targets for run_idx in (1, 2, 3)]

async def score_one_blind(job):
    item = job["item"]
    run_idx = job["run_idx"]
    vid = str(item["id"])
    m = item["media"]
    sheets = m["sheets"]
    excerpt = strip_rating_anchors(item.get("ai_analysis") or "")[:2200]
    media_summary = json.dumps(
        {k: m.get(k) for k in ("status", "duration_sec", "width", "height", "fps", "mean_volume_db", "max_volume_db", "real_cuts")},
        ensure_ascii=False,
    )
    sheet_instr = "まず以下の静止画コンタクトシート画像を必ず `read_file` で確認してください:\n" + "\n".join(f"- {s}" for s in sheets)
    audit_run_token = uuid.uuid4().hex[:12]
    audit_started_at = datetime.now(timezone.utc).isoformat()

    prompt = f"""あなたは映像ディレクター兼品質監査官です。
対象動画の静止画コンタクトシート・実測データ・既存AI分析（既存ランク非表示）を突き合わせ、**ブラインド独立採点として客観的プロ基準（Cannes Lions Film Craft / D&AD Pencil / ACC基準）で採点**し、最後に必ず `finish` ツールでJSON結果を返してください。

【対象動画】
- AuditRunToken: {audit_run_token}
- video_id: {vid}
- タイトル: {item['title']}
- URL: {item['video_url']}

【計測データ（ffprobe + ffmpeg scdet実カット検出）】
{media_summary}

【静止画コンタクトシート確認】
{sheet_instr}

【採点ガイドライン（厳守）】
- **ブラインド独立採点**: 演出5観点（各0〜20点）・技術5観点（各0〜20点）を客観プロ基準で独立採点すること。
- **各観点の点数の根拠を必須記載**: `grade_change_reason` 欄には「各観点の点数の根拠（なぜこの水準・点数にしたか）」を具体的に必ず記載すること（空欄不可）。
- **確認不能な観点で減点しない（重要）**: 静止画コンタクトシートでは確認できない観点（音響ミックス `soundAndMix` や 30fps/60fps モーションの滑らかさ等）を「確認できないから慎重に低めにする」という理由で減点してはならない。確認できた観点の水準を基準に換算し、未確認である事実のみ `audit_findings` に記載すること。
- **最重要**: 必ず `finish` ツールを呼び出してJSONオブジェクトを返却すること。

【既存AI分析抜粋（既存ランク非表示）】
{excerpt}
"""
    res = await agent(prompt, schema=AUDIT_SCHEMA, role=f"BlindRepro {vid} run#{run_idx}")
    # Deterministically locate worker_conversation_id via unique AuditRunToken
    worker_conv_id = ""
    start_epoch = datetime.fromisoformat(audit_started_at).timestamp() - 5.0
    token_marker = f"AuditRunToken: {audit_run_token}"
    for p_tx in BRAIN_ROOT.glob("*/.system_generated/logs/transcript.jsonl"):
        if p_tx.stat().st_mtime < start_epoch:
            continue
        head = p_tx.read_text(encoding="utf-8", errors="ignore")[:4000]
        if token_marker in head:
            worker_conv_id = p_tx.parent.parent.parent.name
            break

    log_check = verify_transcript_by_conv_id(worker_conv_id, vid, audit_run_token)

    d_score = sum(max(0, min(20, int(v))) for v in res["direction"].values())
    t_score = sum(max(0, min(20, int(v))) for v in res["technique"].values())
    adj = max(-5, min(5, int(res["synergyAdjustment"])))
    o_score = max(0, min(100, round(d_score * 0.55 + t_score * 0.45) + adj))
    return {
        "video_id": vid,
        "run_idx": run_idx,
        "audit_run_token": audit_run_token,
        "audit_started_at": audit_started_at,
        "worker_conversation_id": worker_conv_id,
        "log_verification": log_check,
        "overall": o_score,
        "direction": d_score,
        "technique": t_score,
        "synergy": adj,
        "overall_grade": score_to_grade(o_score),
        "direction_grade": score_to_grade(d_score),
        "technique_grade": score_to_grade(t_score),
        "grade_boundary": is_near_grade_boundary(o_score),
        "rationale_present": bool(str(res.get("grade_change_reason") or "").strip()),
    }

all_runs = []
for i in range(0, len(jobs), 10):
    batch = jobs[i : i + 10]
    batch_res = await parallel(batch, score_one_blind)
    all_runs.extend([r for r in batch_res if isinstance(r, dict)])
    log(f"Completed {len(all_runs)} / {len(jobs)} blind scorings")

phase("3. Compare blind vs anchored (prior) reproducibility and write reproducibility_blind_10x3.json")
by_vid = {}
for r in all_runs:
    by_vid.setdefault(r["video_id"], []).append(r)

prior_by_vid = {v["video_id"]: v for v in prior_doc["per_video"]}
prior_matched_db_grade_runs = 0
for v in prior_doc["per_video"]:
    for r in v["runs"]:
        if r["overall_grade"] == v["db_overall_rating"]:
            prior_matched_db_grade_runs += 1

per_video = []
all_o_ranges, all_d_ranges, all_t_ranges = [], [], []
all_o_stds, all_d_stds, all_t_stds = [], [], []
videos_with_grade_variation = 0
blind_matched_db_grade_runs = 0
log_verified_runs = 0
boundary_median_videos = 0

for t in targets:
    vid = str(t["id"])
    runs = sorted(by_vid.get(vid, []), key=lambda x: x["run_idx"])
    os_ = [r["overall"] for r in runs]
    ds_ = [r["direction"] for r in runs]
    ts_ = [r["technique"] for r in runs]
    o_grades = [r["overall_grade"] for r in runs]

    for r in runs:
        if r["overall_grade"] == t["overall_rating"]:
            blind_matched_db_grade_runs += 1
        if r["log_verification"]["log_verified"]:
            log_verified_runs += 1

    o_range = max(os_) - min(os_)
    d_range = max(ds_) - min(ds_)
    t_range = max(ts_) - min(ts_)
    o_std = round(statistics.pstdev(os_), 2)
    d_std = round(statistics.pstdev(ds_), 2)
    t_std = round(statistics.pstdev(ts_), 2)
    o_med = int(round(statistics.median(os_)))
    med_boundary = is_near_grade_boundary(o_med)
    if med_boundary:
        boundary_median_videos += 1
    if len(set(o_grades)) > 1:
        videos_with_grade_variation += 1

    all_o_ranges.append(o_range); all_d_ranges.append(d_range); all_t_ranges.append(t_range)
    all_o_stds.append(o_std); all_d_stds.append(d_std); all_t_stds.append(t_std)

    pv = prior_by_vid[vid]
    per_video.append({
        "video_id": vid,
        "title": t["title"],
        "db_overall_rating": t["overall_rating"],
        "prior_anchored_overall": pv["overall"],
        "blind_overall": {
            "scores": os_,
            "median": o_med,
            "median_grade": score_to_grade(o_med),
            "median_grade_boundary": med_boundary,
            "range_max_minus_min": o_range,
            "pstdev": o_std,
            "grades": o_grades,
            "grade_changed_across_runs": len(set(o_grades)) > 1,
        },
        "blind_direction": {"scores": ds_, "range_max_minus_min": d_range, "pstdev": d_std},
        "blind_technique": {"scores": ts_, "range_max_minus_min": t_range, "pstdev": t_std},
        "runs": runs,
    })

report = {
    "note": "Read-only BLIND scoring reproducibility test (exact same 10 videos x 3 independent runs = 30 scorings). Zero writes to TiDB or SQLite.",
    "comparison_anchored_vs_blind": {
        "anchored_prior": {
            "overall_mean_range": prior_doc["summary"]["overall_mean_range"],
            "overall_max_range": prior_doc["summary"]["overall_max_range"],
            "overall_mean_pstdev": prior_doc["summary"]["overall_mean_pstdev"],
            "direction_mean_range": prior_doc["summary"]["direction_mean_range"],
            "technique_mean_range": prior_doc["summary"]["technique_mean_range"],
            "videos_with_grade_variation": prior_doc["summary"]["videos_where_overall_grade_varied_across_3_runs"],
            "runs_matching_db_grade_out_of_30": prior_matched_db_grade_runs,
        },
        "blind_current": {
            "overall_mean_range": round(statistics.mean(all_o_ranges), 2),
            "overall_max_range": max(all_o_ranges),
            "overall_mean_pstdev": round(statistics.mean(all_o_stds), 2),
            "direction_mean_range": round(statistics.mean(all_d_ranges), 2),
            "direction_max_range": max(all_d_ranges),
            "direction_mean_pstdev": round(statistics.mean(all_d_stds), 2),
            "technique_mean_range": round(statistics.mean(all_t_ranges), 2),
            "technique_max_range": max(all_t_ranges),
            "technique_mean_pstdev": round(statistics.mean(all_t_stds), 2),
            "videos_with_grade_variation": videos_with_grade_variation,
            "runs_matching_db_grade_out_of_30": blind_matched_db_grade_runs,
            "log_verified_runs_out_of_30": log_verified_runs,
            "median_on_grade_boundary_videos": boundary_median_videos,
        },
    },
    "per_video": per_video,
}

OUT_FILE.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
shutil.rmtree(WORK_TMP, ignore_errors=True)
log("Blind reproducibility test complete:", json.dumps(report["comparison_anchored_vs_blind"], ensure_ascii=False))
