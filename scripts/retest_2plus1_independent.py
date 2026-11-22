"""Independent 2x(2+1) Re-test Workflow (ZERO DB writes).

1. Re-tests the 2 upper-tier videos that previously leaked `スコア: S`/`A+` (1119375393, 1046889896)
   using the hardened blind_redact.py (with assert_no_rating_leak).
2. Runs the 2+1 Adaptive Ensemble INDEPENDENTLY TWICE (Group A vs Group B, no shared runs)
   across 4 videos (1119375393, 1046889896, 1044346460, 1056287464) to measure true
   2+1 final-grade stability without same-pool overestimation.
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
from blind_redact import assert_no_rating_leak, redact_for_blind_scoring

REPO_ROOT = pathlib.Path(r"E:\iketeru-eizou")
BRAIN_ROOT = pathlib.Path(r"C:\Users\t1257\.gemini\antigravity\brain")
OUT_FILE = REPO_ROOT / "analysis" / "independent_2plus1_retest.json"
WORK_TMP = REPO_ROOT / "analysis" / "_retest_2plus1_tmp"

TARGET_VIDS = ["1119375393", "1046889896", "1044346460", "1056287464"]

BANDS = {
    "S+": (97, 100), "S": (93, 96), "S-": (90, 92),
    "A+": (86, 89),  "A": (82, 85), "A-": (78, 81),
    "B+": (73, 77),  "B": (68, 72), "B-": (63, 67),
    "C+": (57, 62),  "C": (51, 56), "C-": (45, 50),
    "D+": (35, 44),  "D": (20, 34), "D-": (0, 19),
}
IMG_EXT_RE = re.compile(r"\.(?:jpg|jpeg|png|webp)$", re.IGNORECASE)
VERDICT_SEVERITY = {"needs_full_analysis": 3, "major_fix": 2, "minor_fix": 1, "accurate": 0}

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

def verify_tx(conv_id: str, vid: str, token: str) -> bool:
    if not conv_id:
        return False
    p = BRAIN_ROOT / conv_id / ".system_generated" / "logs" / "transcript.jsonl"
    if not p.exists():
        return False
    txt = p.read_text(encoding="utf-8", errors="ignore")
    if vid not in txt or f"AuditRunToken: {token}" not in txt:
        return False
    img_calls, img_loaded = 0, 0
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
                if IMG_EXT_RE.search(str((tc.get("args") or {}).get("Path") or "").strip('"')):
                    img_calls += 1
    return img_calls > 0 and img_loaded > 0

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
        "grade_change_reason": {"type": "string"},
        "direction": {
            "type": "object",
            "required": ["hookAndStructure", "originality", "rhythmAndSync", "worldAndSubject", "intentAchievement"],
            "properties": {k: {"type": "integer", "minimum": 0, "maximum": 20} for k in ("hookAndStructure", "originality", "rhythmAndSync", "worldAndSubject", "intentAchievement")},
        },
        "technique": {
            "type": "object",
            "required": ["cinematographyAndArt", "editingAndMotion", "colorAndLook", "soundAndMix", "polishAndFinish"],
            "properties": {k: {"type": "integer", "minimum": 0, "maximum": 20} for k in ("cinematographyAndArt", "editingAndMotion", "colorAndLook", "soundAndMix", "polishAndFinish")},
        },
        "synergyAdjustment": {"type": "integer", "minimum": -5, "maximum": 5},
        "rationale": {"type": "string"},
    },
}

phase("1. Load 4 videos read-only from TiDB, redact with assert_no_rating_leak, and build contact sheets")
env = dict(os.environ)
env["PATH"] = r"C:\Program Files\nodejs;" + env.get("PATH", "")
WORK_TMP.mkdir(parents=True, exist_ok=True)

targets = []
for vid in TARGET_VIDS:
    raw = subprocess.check_output(
        ["node", "scripts/fetch-audit-targets-tidb.mjs", f"--video-id={vid}"],
        cwd=str(REPO_ROOT),
        env=env,
        text=True,
        encoding="utf-8",
    )
    row = json.loads(raw)[0]
    excerpt = redact_for_blind_scoring(row.get("ai_analysis") or "", max_chars=2200)
    assert_no_rating_leak(excerpt, video_id=vid)
    row["redacted_excerpt"] = excerpt
    out_d = WORK_TMP / re.sub(r"[^A-Za-z0-9_-]", "_", vid)
    info = inspect_video(vid, str(row["video_url"]), out_d)
    if not info.get("sheets"):
        raise RuntimeError(f"No contact sheets for {vid}")
    row["media"] = info
    targets.append(row)

phase("2. Execute 2+1 Adaptive Ensemble INDEPENDENTLY TWICE (Group A & Group B) per video")

async def run_one_pass(item, label: str):
    vid = str(item["id"])
    m = item["media"]
    sheets = m["sheets"]
    excerpt = item["redacted_excerpt"]
    assert_no_rating_leak(excerpt, video_id=vid)
    media_summary = json.dumps(
        {k: m.get(k) for k in ("status", "duration_sec", "width", "height", "fps", "mean_volume_db", "max_volume_db", "real_cuts")},
        ensure_ascii=False,
    )
    sheet_instr = "まず以下の静止画コンタクトシート画像を必ず `read_file` で確認してください:\n" + "\n".join(f"- {s}" for s in sheets)
    token = uuid.uuid4().hex[:12]
    started = datetime.now(timezone.utc).isoformat()
    prompt = f"""あなたは映像ディレクター兼品質監査官です。
対象動画の静止画コンタクトシート・実測データ・既存AI分析（既存ランク非表示）を突き合わせ、**ブラインド独立採点として客観的プロ基準（Cannes Lions Film Craft / D&AD Pencil / ACC基準）で採点**し、最後に必ず `finish` ツールでJSON結果を返してください。

【対象動画】
- AuditRunToken: {token}
- video_id: {vid}
- タイトル: {item['title']}
- URL: {item['video_url']}

【計測データ（ffprobe + ffmpeg scdet実カット検出）】
{media_summary}

【静止画コンタクトシート確認】
{sheet_instr}

【採点ガイドライン（厳守）】
- **ブラインド独立採点**: 演出5観点（各0〜20点）・技術5観点（各0〜20点）を客観プロ基準で独立採点すること。
- **各観点の点数の根拠を必須記載**: `grade_change_reason` 欄には「各観点の点数の根拠」を具体的に必ず記載すること（空欄不可）。
- **確認不能な観点で減点しない（重要）**: 静止画コンタクトシートでは確認できない観点（音響ミックス・モーションの滑らかさ等）を理由に減点せず、確認できた観点の水準を基準に換算すること。
- **最重要**: 必ず `finish` ツールを呼び出してJSONオブジェクトを返却すること。

【既存AI分析抜粋（既存ランク非表示）】
{excerpt}
"""
    res = await agent(prompt, schema=AUDIT_SCHEMA, role=f"Indep2p1 {vid} {label}")
    conv_id = ""
    start_epoch = datetime.fromisoformat(started).timestamp() - 5.0
    for p_tx in BRAIN_ROOT.glob("*/.system_generated/logs/transcript.jsonl"):
        if p_tx.stat().st_mtime < start_epoch:
            continue
        if f"AuditRunToken: {token}" in p_tx.read_text(encoding="utf-8", errors="ignore")[:4000]:
            conv_id = p_tx.parent.parent.parent.name
            break
    d = sum(max(0, min(20, int(v))) for v in res["direction"].values())
    t = sum(max(0, min(20, int(v))) for v in res["technique"].values())
    adj = max(-5, min(5, int(res["synergyAdjustment"])))
    o = max(0, min(100, round(d * 0.55 + t * 0.45) + adj))
    return {
        "label": label,
        "overall": o,
        "direction": d,
        "technique": t,
        "synergy": adj,
        "verdict": res["analysis_verdict"],
        "token": token,
        "conv_id": conv_id,
        "log_verified": verify_tx(conv_id, vid, token),
    }

async def run_2plus1_group(job):
    item = job["item"]
    grp = job["group"]
    r1 = await run_one_pass(item, f"{grp}-r1")
    r2 = await run_one_pass(item, f"{grp}-r2")
    if abs(r1["overall"] - r2["overall"]) <= 3 and abs(r1["direction"] - r2["direction"]) <= 3 and abs(r1["technique"] - r2["technique"]) <= 3:
        mode = "2_run_mean"
        runs = [r1, r2]
        fd = int(round((r1["direction"] + r2["direction"]) / 2))
        ft = int(round((r1["technique"] + r2["technique"]) / 2))
        fadj = int(round((r1["synergy"] + r2["synergy"]) / 2))
    else:
        r3 = await run_one_pass(item, f"{grp}-r3")
        mode = "3_run_median"
        runs = [r1, r2, r3]
        fd = int(round(statistics.median([r["direction"] for r in runs])))
        ft = int(round(statistics.median([r["technique"] for r in runs])))
        fadj = int(round(statistics.median([r["synergy"] for r in runs])))
    # #4: always compute final overall from final d/t/adj
    fo = max(0, min(100, round(fd * 0.55 + ft * 0.45) + fadj))
    strict_v = max(runs, key=lambda r: VERDICT_SEVERITY.get(r["verdict"], 0))["verdict"]
    return {
        "video_id": str(item["id"]),
        "group": grp,
        "mode": mode,
        "final_overall": fo,
        "final_direction": fd,
        "final_technique": ft,
        "final_grade": score_to_grade(fo),
        "grade_boundary": is_near_grade_boundary(fo),
        "strict_verdict": strict_v,
        "all_runs_log_verified": all(r["log_verified"] for r in runs),
        "runs": runs,
    }

group_jobs = [{"item": t, "group": g} for t in targets for g in ("A", "B")]
group_results = await parallel(group_jobs, run_2plus1_group)

by_vid = {}
for gr in group_results:
    by_vid.setdefault(gr["video_id"], {})[gr["group"]] = gr

per_video = []
matched_grade_count = 0
total_runs = 0
total_verified = 0
for t in targets:
    vid = str(t["id"])
    ga = by_vid[vid]["A"]
    gb = by_vid[vid]["B"]
    same_grade = (ga["final_grade"] == gb["final_grade"])
    if same_grade:
        matched_grade_count += 1
    for r in ga["runs"] + gb["runs"]:
        total_runs += 1
        if r["log_verified"]:
            total_verified += 1
    per_video.append({
        "video_id": vid,
        "title": t["title"],
        "db_overall_rating": t["overall_rating"],
        "group_A": ga,
        "group_B": gb,
        "overall_delta_abs": abs(ga["final_overall"] - gb["final_overall"]),
        "final_grade_matched": same_grade,
    })

report = {
    "note": "Independent 2x(2+1) re-test using leak-free blind_redact.py (ZERO DB writes). Group A and Group B share zero runs.",
    "summary": {
        "videos_tested": len(per_video),
        "final_grade_matched_count": matched_grade_count,
        "max_final_overall_delta": max(v["overall_delta_abs"] for v in per_video),
        "mean_final_overall_delta": round(statistics.mean(v["overall_delta_abs"] for v in per_video), 2),
        "total_runs": total_runs,
        "log_verified_runs": total_verified,
    },
    "per_video": per_video,
}
OUT_FILE.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
shutil.rmtree(WORK_TMP, ignore_errors=True)
log("Independent 2x(2+1) re-test complete:", json.dumps(report["summary"], ensure_ascii=False))
