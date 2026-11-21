import json
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

worker_txs = 0
vid_in_prompt: dict[str, int] = {}
vid_read_calls: dict[str, int] = {}
vid_media_loaded: dict[str, int] = {}

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
    for line in txt.splitlines():
        try:
            step = json.loads(line)
        except Exception:
            continue
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
    if vid:
        vid_in_prompt[vid] = vid_in_prompt.get(vid, 0) + 1
        vid_read_calls[vid] = max(vid_read_calls.get(vid, 0), img_calls)
        vid_media_loaded[vid] = max(vid_media_loaded.get(vid, 0), img_loaded)

matched = [v for v in vid_in_prompt if v in recs]
true_with_img = [v for v in matched if recs[v].get("visual_checked") is True and vid_read_calls[v] > 0 and vid_media_loaded[v] > 0]
true_no_img = [v for v in matched if recs[v].get("visual_checked") is True and (vid_read_calls[v] == 0 or vid_media_loaded[v] == 0)]
false_with_img = [v for v in matched if recs[v].get("visual_checked") is not True and vid_read_calls[v] > 0 and vid_media_loaded[v] > 0]
false_no_img = [v for v in matched if recs[v].get("visual_checked") is not True and (vid_read_calls[v] == 0 or vid_media_loaded[v] == 0)]
no_tx_on_disk = [v for v in recs if v not in vid_in_prompt]
no_tx_self_false = [v for v in no_tx_on_disk if recs[v].get("visual_checked") is not True]
no_tx_self_true = [v for v in no_tx_on_disk if recs[v].get("visual_checked") is True]

# Update visual_redo_queue.json with any self_true_but_log_zero entries
existing_redo = json.loads(REDO_QUEUE_JSON.read_text(encoding="utf-8")) if REDO_QUEUE_JSON.exists() else []
existing_ids = {str(x.get("video_id")) for x in existing_redo}
added_from_log = 0
for v in true_no_img:
    if v not in existing_ids:
        existing_redo.append({
            "video_id": v,
            "title": recs[v].get("title", ""),
            "reason": "log_verified_zero_image_reads_despite_self_reported_true",
            "log_read_file_calls": vid_read_calls[v],
            "log_media_images_loaded": vid_media_loaded[v],
        })
        existing_ids.add(v)
        added_from_log += 1

if added_from_log > 0:
    REDO_QUEUE_JSON.write_text(json.dumps(existing_redo, ensure_ascii=False, indent=2), encoding="utf-8")

summary = {
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
    "redo_queue_total_after_log_check": len(existing_redo),
    "added_from_log_check": added_from_log,
    "self_true_but_log_img_eq_0_ids": true_no_img,
    "log_verified_ids": sorted(true_with_img),
    "unverifiable_no_log_self_true_ids": sorted(no_tx_self_true),
    "unverifiable_no_log_self_false_ids": sorted(no_tx_self_false),
}

REPORT_JSON.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False, indent=2))
