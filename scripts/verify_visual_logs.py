import json
import os
import re
from pathlib import Path

BRAIN_ROOT = Path(r"C:\Users\t1257\.gemini\antigravity\brain")
PROGRESS_JSONL = Path(r"E:\iketeru-eizou\analysis\full_audit_progress.jsonl")
REDO_QUEUE_JSON = Path(r"E:\iketeru-eizou\analysis\visual_redo_queue.json")
REPORT_JSON = Path(r"E:\iketeru-eizou\analysis\visual_log_verification.json")

img_ext_re = re.compile(r"\.(?:jpg|jpeg|png|webp)$", re.IGNORECASE)
audit_dir_re = re.compile(r"_audit_tmp[\\/]+([^\\/]+)[\\/]+[^\\/]+\.(?:jpg|jpeg|png|webp)$", re.IGNORECASE)
vid_prompt_re1 = re.compile(r"動画ID:\s*([A-Za-z0-9_-]+)")
vid_prompt_re2 = re.compile(r"video_id[\":\s]+([A-Za-z0-9_-]+)")

# Load full_audit_progress.jsonl — keep LATEST progress record per video_id
recs: dict[str, dict] = {}
with open(PROGRESS_JSONL, "r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        obj = json.loads(line)
        vid = str(obj.get("video_id") or "")
        if vid:
            recs[vid] = obj

# Scan all worker transcripts and track EACH run individually with its timestamp (NO max() across old runs!)
worker_txs = 0
latest_run_by_vid: dict[str, dict] = {}

for p in BRAIN_ROOT.glob("*/.system_generated/logs/transcript.jsonl"):
    try:
        txt = p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        continue
    if "audit_findings" not in txt:
        continue
    worker_txs += 1
    vid = None
    img_calls = 0
    img_loaded = 0
    run_ts = ""
    for line in txt.splitlines():
        try:
            step = json.loads(line)
        except Exception:
            continue
        ts = str(step.get("created_at") or "")
        if ts and ts > run_ts:
            run_ts = ts
        if step.get("type") == "USER_INPUT" and not vid:
            content = str(step.get("content", ""))
            m = vid_prompt_re1.search(content) or vid_prompt_re2.search(content)
            if m:
                vid = m.group(1)
        if step.get("media"):
            for med in step["media"]:
                if str(med.get("mime_type", "")).startswith("image/"):
                    img_loaded += 1
        for tc in step.get("tool_calls") or []:
            if tc.get("name") == "read_file":
                raw_p = str((tc.get("args") or {}).get("Path") or "")
                if raw_p.startswith('"') and raw_p.endswith('"'):
                    try:
                        path_str = json.loads(raw_p)
                    except Exception:
                        path_str = raw_p.strip('"')
                else:
                    path_str = raw_p
                path_str = path_str.replace("\\\\", "\\")
                if img_ext_re.search(path_str):
                    img_calls += 1
                    if not vid:
                        m_dir = audit_dir_re.search(path_str)
                        if m_dir:
                            vid = m_dir.group(1)
    if not vid:
        continue
    mtime = os.path.getmtime(p)
    sort_key = (run_ts, mtime)
    prev = latest_run_by_vid.get(vid)
    if prev is None or sort_key > prev["sort_key"]:
        latest_run_by_vid[vid] = {
            "sort_key": sort_key,
            "run_ts": run_ts,
            "transcript": str(p.parent.parent.parent.name),
            "img_calls": img_calls,
            "img_loaded": img_loaded,
        }

matched = [v for v in latest_run_by_vid if v in recs]
true_with_img = []
true_no_img = []
false_with_img = []
false_no_img = []

for v in matched:
    run = latest_run_by_vid[v]
    has_img = run["img_calls"] > 0 and run["img_loaded"] > 0
    self_vc = recs[v].get("visual_checked") is True
    if self_vc and has_img:
        true_with_img.append(v)
    elif self_vc and not has_img:
        true_no_img.append(v)
    elif (not self_vc) and has_img:
        false_with_img.append(v)
    else:
        false_no_img.append(v)

no_tx_on_disk = [v for v in recs if v not in latest_run_by_vid]
no_tx_self_false = [v for v in no_tx_on_disk if recs[v].get("visual_checked") is not True]
no_tx_self_true = [v for v in no_tx_on_disk if recs[v].get("visual_checked") is True]

# Update visual_redo_queue.json:
# - Remove IDs whose LATEST run is now log_verified (true_with_img)
# - Add IDs whose LATEST run had 0 images despite self-reporting true (true_no_img)
existing_redo = json.loads(REDO_QUEUE_JSON.read_text(encoding="utf-8")) if REDO_QUEUE_JSON.exists() else []
verified_set = set(true_with_img)
updated_redo = [x for x in existing_redo if str(x.get("video_id")) not in verified_set]
existing_ids = {str(x.get("video_id")) for x in updated_redo}

added_from_log = 0
for v in true_no_img:
    if v not in existing_ids:
        run = latest_run_by_vid[v]
        updated_redo.append({
            "video_id": v,
            "title": recs[v].get("title", ""),
            "reason": "latest_worker_transcript_zero_image_reads_despite_self_reported_true",
            "latest_transcript_id": run["transcript"],
            "latest_run_ts": run["run_ts"],
            "log_read_file_calls": run["img_calls"],
            "log_media_images_loaded": run["img_loaded"],
        })
        existing_ids.add(v)
        added_from_log += 1

REDO_QUEUE_JSON.write_text(json.dumps(updated_redo, ensure_ascii=False, indent=2), encoding="utf-8")

summary = {
    "matching_policy": "latest_transcript_paired_with_latest_progress_record_per_video",
    "worker_transcripts_found": worker_txs,
    "progress_jsonl_unique_videos": len(recs),
    "matched_in_worker_transcripts": len(matched),
    "self_true_and_log_verified_img_gt_0": len(true_with_img),
    "self_true_but_log_img_eq_0": len(true_no_img),
    "self_false_and_log_img_eq_0": len(false_no_img),
    "self_false_but_log_img_gt_0": len(false_with_img),
    "no_transcript_on_disk_total": len(no_tx_on_disk),
    "no_transcript_on_disk_self_true": len(no_tx_self_true),
    "no_transcript_on_disk_self_false": len(no_tx_self_false),
    "redo_queue_total_after_log_check": len(updated_redo),
    "added_from_log_check": added_from_log,
    "self_true_but_log_img_eq_0_ids": sorted(true_no_img),
    "log_verified_ids": sorted(true_with_img),
    "unverifiable_no_log_self_true_ids": sorted(no_tx_self_true),
    "unverifiable_no_log_self_false_ids": sorted(no_tx_self_false),
}

REPORT_JSON.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({k: v for k, v in summary.items() if not k.endswith("_ids")}, ensure_ascii=False, indent=2))
