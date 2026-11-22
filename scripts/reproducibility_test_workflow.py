"""Scoring Reproducibility Test Workflow (10 diverse videos x 3 independent runs = 30 scorings).

Strictly READ-ONLY against TiDB Cloud and SQLite. Writes ONLY to analysis/reproducibility_10x3.json.
"""
import json
import os
import pathlib
import re
import shutil
import statistics
import subprocess
import sys

sys.path.insert(0, r"E:\iketeru-creative-studio")
sys.path.insert(0, r"E:\iketeru-eizou\scripts")
from audit_video_media import inspect_video

REPO_ROOT = pathlib.Path(r"E:\iketeru-eizou")
TARGETS_FILE = REPO_ROOT / "analysis" / "_repro_10_targets.json"
OUT_FILE = REPO_ROOT / "analysis" / "reproducibility_10x3.json"
WORK_TMP = REPO_ROOT / "analysis" / "_repro_tmp"

BANDS = {
    "S+": (97, 100), "S": (93, 96), "S-": (90, 92),
    "A+": (86, 89),  "A": (82, 85), "A-": (78, 81),
    "B+": (73, 77),  "B": (68, 72), "B-": (63, 67),
    "C+": (57, 62),  "C": (51, 56), "C-": (45, 50),
    "D+": (35, 44),  "D": (20, 34), "D-": (0, 19),
}

def score_to_grade(score):
    for g, (lo, hi) in BANDS.items():
        if lo <= score <= hi:
            return g
    return "B"

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

def extract_excerpt(ai_analysis: str) -> str:
    txt = str(ai_analysis or "").strip()
    if not txt:
        return "(既存AI分析なし)"
    return txt[:2200]

phase("1. Fetch 10 target videos read-only from TiDB Cloud and build contact sheets once")
picked = json.loads(TARGETS_FILE.read_text(encoding="utf-8"))
env = dict(os.environ)
env["PATH"] = r"C:\Program Files\nodejs;" + env.get("PATH", "")

targets = []
WORK_TMP.mkdir(parents=True, exist_ok=True)
for p in picked:
    vid = str(p["id"])
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
        raise RuntimeError(f"No contact sheets generated for {vid}: {info}")
    row["media"] = info
    targets.append(row)

log(f"Prepared {len(targets)} videos with contact sheets.")

phase("2. Run 3 independent scorings per video (30 total agent calls, read-only)")
jobs = []
for t in targets:
    for run_idx in (1, 2, 3):
        jobs.append({"item": t, "run_idx": run_idx})

async def score_one(job):
    item = job["item"]
    run_idx = job["run_idx"]
    vid = str(item["id"])
    m = item["media"]
    sheets = m["sheets"]
    o_r = item["overall_rating"] or "B"
    d_r = item["direction_rating"] or "B"
    t_r = item["technique_rating"] or "B"
    excerpt = extract_excerpt(item.get("ai_analysis") or "")
    media_summary = json.dumps(
        {k: m.get(k) for k in ("status", "duration_sec", "width", "height", "fps", "mean_volume_db", "max_volume_db", "real_cuts")},
        ensure_ascii=False,
    )
    sheet_instr = "まず以下の静止画コンタクトシート画像を必ず `read_file` で確認してください:\n" + "\n".join(f"- {s}" for s in sheets)
    prompt = f"""あなたは映像ディレクター兼品質監査官です。
対象動画の静止画コンタクトシート・実測データ・既存AI分析を突き合わせ、**現行ランクに縛られず客観的プロ基準（Cannes Lions Film Craft / D&AD Pencil / ACC基準）で独立採点**し、最後に必ず `finish` ツールでJSON結果を返してください。

【対象動画】
- video_id: {vid}
- タイトル: {item['title']}
- URL: {item['video_url']}
- 参考（既存DBランク・変更可）: 総合={o_r} / 演出={d_r} / 技術={t_r}

【計測データ（ffprobe + ffmpeg scdet実カット検出）】
{media_summary}

【静止画コンタクトシート確認】
{sheet_instr}

【採点ガイドライン（厳守）】
- **ランク据え置き禁止（独立採点）**: 既存DBランクに引っ張られず、演出5観点（各0〜20点）・技術5観点（各0〜20点）を客観基準で採点すること。
- **ランク変更時の理由必須**: 算出された新ランクが既存DBランクと異なる場合は、`grade_change_reason` に具体的理由を必ず記載すること。
- **確認不能な観点で減点しない（重要）**: 静止画コンタクトシートでは確認できない観点（音響ミックス `soundAndMix` や 30fps/60fps モーションの滑らかさ等）を「確認できないから慎重に低めにする」という理由で減点してはならない。確認できない観点は既存のランク水準を維持するか、確認できた観点の水準を基準に換算すること。
- **最重要**: 必ず `finish` ツールを呼び出してJSONオブジェクトを返却すること。

【既存AI分析抜粋】
{excerpt}
"""
    res = await agent(prompt, schema=AUDIT_SCHEMA, role=f"Repro {vid} run#{run_idx}")
    d_score = sum(max(0, min(20, int(v))) for v in res["direction"].values())
    t_score = sum(max(0, min(20, int(v))) for v in res["technique"].values())
    adj = max(-5, min(5, int(res["synergyAdjustment"])))
    o_score = max(0, min(100, round(d_score * 0.55 + t_score * 0.45) + adj))
    return {
        "video_id": vid,
        "run_idx": run_idx,
        "overall": o_score,
        "direction": d_score,
        "technique": t_score,
        "synergy": adj,
        "overall_grade": score_to_grade(o_score),
        "direction_grade": score_to_grade(d_score),
        "technique_grade": score_to_grade(t_score),
        "grade_change_reason_empty": not bool(str(res.get("grade_change_reason") or "").strip()),
    }

all_runs = []
for i in range(0, len(jobs), 10):
    batch = jobs[i : i + 10]
    batch_res = await parallel(batch, score_one)
    all_runs.extend([r for r in batch_res if isinstance(r, dict)])
    log(f"Completed {len(all_runs)} / {len(jobs)} scorings")

phase("3. Compute dispersion statistics and write reproducibility_10x3.json (NO DB writes)")
by_vid = {}
for r in all_runs:
    by_vid.setdefault(r["video_id"], []).append(r)

per_video = []
all_o_ranges, all_d_ranges, all_t_ranges = [], [], []
all_o_stds, all_d_stds, all_t_stds = [], [], []
videos_with_overall_grade_change = 0
total_grade_change_pairs = 0

for t in targets:
    vid = str(t["id"])
    runs = sorted(by_vid.get(vid, []), key=lambda x: x["run_idx"])
    os_ = [r["overall"] for r in runs]
    ds_ = [r["direction"] for r in runs]
    ts_ = [r["technique"] for r in runs]
    o_grades = [r["overall_grade"] for r in runs]
    d_grades = [r["direction_grade"] for r in runs]
    t_grades = [r["technique_grade"] for r in runs]

    o_range = max(os_) - min(os_)
    d_range = max(ds_) - min(ds_)
    t_range = max(ts_) - min(ts_)
    o_std = round(statistics.pstdev(os_), 2)
    d_std = round(statistics.pstdev(ds_), 2)
    t_std = round(statistics.pstdev(ts_), 2)
    o_grade_varied = len(set(o_grades)) > 1
    if o_grade_varied:
        videos_with_overall_grade_change += 1
    # Count distinct grade transitions among the 3 runs (0, 1, or 2 distinct changes)
    grade_changes_in_3 = len(set(o_grades)) - 1
    total_grade_change_pairs += grade_changes_in_3

    all_o_ranges.append(o_range); all_d_ranges.append(d_range); all_t_ranges.append(t_range)
    all_o_stds.append(o_std); all_d_stds.append(d_std); all_t_stds.append(t_std)

    per_video.append({
        "video_id": vid,
        "title": t["title"],
        "db_overall_rating": t["overall_rating"],
        "runs": runs,
        "overall": {"scores": os_, "range_max_minus_min": o_range, "pstdev": o_std, "grades": o_grades, "grade_changed_across_runs": o_grade_varied},
        "direction": {"scores": ds_, "range_max_minus_min": d_range, "pstdev": d_std, "grades": d_grades},
        "technique": {"scores": ts_, "range_max_minus_min": t_range, "pstdev": t_std, "grades": t_grades},
    })

max_range_overall = max(all_o_ranges)
max_range_direction = max(all_d_ranges)
max_range_technique = max(all_t_ranges)
exceeds_plus_minus_2 = any(x > 4 for x in (all_o_ranges + all_d_ranges + all_t_ranges))

report = {
    "note": "Read-only scoring reproducibility test (10 videos x 3 independent runs = 30 scorings). Zero writes to TiDB or SQLite.",
    "summary": {
        "videos_tested": len(per_video),
        "runs_per_video": 3,
        "overall_mean_range": round(statistics.mean(all_o_ranges), 2),
        "overall_max_range": max_range_overall,
        "overall_mean_pstdev": round(statistics.mean(all_o_stds), 2),
        "direction_mean_range": round(statistics.mean(all_d_ranges), 2),
        "direction_max_range": max_range_direction,
        "direction_mean_pstdev": round(statistics.mean(all_d_stds), 2),
        "technique_mean_range": round(statistics.mean(all_t_ranges), 2),
        "technique_max_range": max_range_technique,
        "technique_mean_pstdev": round(statistics.mean(all_t_stds), 2),
        "videos_where_overall_grade_varied_across_3_runs": videos_with_overall_grade_change,
        "exceeds_plus_minus_2_points_threshold": exceeds_plus_minus_2,
    },
    "multi_run_proposal": (
        "ばらつきが±2点（レンジ4点）を超えたため、本番再採点では『同一動画を独立2回採点し、差が3点以内なら平均値を採用・4点以上なら3回目を実行して中央値を採用する（2+1適応アンサンブル方式）』を推奨。"
        if exceeds_plus_minus_2
        else "全項目が±2点（レンジ4点）以内に収まったため、単回採点でも再現性は許容範囲。"
    ),
    "per_video": per_video,
}

OUT_FILE.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
shutil.rmtree(WORK_TMP, ignore_errors=True)
log("Reproducibility test complete:", json.dumps(report["summary"], ensure_ascii=False))
