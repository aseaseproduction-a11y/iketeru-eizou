#!/usr/bin/env python3
"""
Gentle, unauthenticated 1-by-1 OCR retry script for YouTube rate-limited candidates.

Policy (strictly enforced):
- NEVER passes cookies or login credentials (--cookies / --cookies-from-browser forbidden).
- NEVER attempts any bot-check / CAPTCHA bypass.
- Downloads strictly 1 video at a time with a 75-105s delay between downloads.
- Immediately aborts on the first YouTube bot-check error so the IP can cool down.
- Deletes temporary video files immediately after RapidOCR v1.2.3 finishes.
"""

import argparse
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from rapidocr_onnxruntime import RapidOCR
from precheck_award_badge_ocr import check_video_file


BOT_CHECK_MARKERS = (
    "confirm you're not a bot",
    "confirm you\u2019re not a bot",
    "sign in to confirm",
)


def is_bot_check_error(stderr: str) -> bool:
    low = (stderr or "").lower()
    return any(m in low for m in BOT_CHECK_MARKERS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", required=True, help="Path to phase2_candidates_verified.json")
    ap.add_argument("--ocr-log", required=True, help="Path to phase2_ocr_precheck_log.jsonl")
    ap.add_argument("--min-delay-sec", type=int, default=75)
    ap.add_argument("--max-delay-sec", type=int, default=105)
    ap.add_argument("--max-videos", type=int, default=50)
    ap.add_argument("--stratum", default="", help="Optional filter e.g. non_tier2_low")
    ap.add_argument("--skip-ids", default="", help="Comma-separated video IDs to skip")
    args = ap.parse_args()

    skip_set = {x.strip() for x in args.skip_ids.split(",") if x.strip()}
    cands = json.loads(Path(args.candidates).read_text(encoding="utf-8"))
    log_path = Path(args.ocr_log)
    existing = {}
    if log_path.exists():
        for line in log_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            existing[obj["video_id"]] = obj

    queue = []
    for c in cands:
        if args.stratum and c.get("stratum") != args.stratum:
            continue
        vid = c["video_id"]
        if vid in skip_set:
            continue
        prev = existing.get(vid)
        already_ok = (
            prev is not None
            and not prev.get("download_error")
            and not prev.get("ocr_error")
            and int(prev.get("frames_checked") or 0) > 0
        )
        if not already_ok:
            queue.append(c)

    # Prioritize tier2_award -> non_tier2_pro -> non_tier2_low
    prio = {"tier2_award": 0, "non_tier2_pro": 1, "non_tier2_low": 2}
    queue.sort(key=lambda x: (prio.get(x.get("stratum"), 9), x.get("genre", "")))
    queue = queue[: args.max_videos]
    print(f"Pending OCR queue: {len(queue)} videos (delay {args.min_delay_sec}-{args.max_delay_sec}s, unauthenticated, abort-on-bot-check)", flush=True)

    ocr = RapidOCR()
    completed = 0
    aborted = False
    for idx, c in enumerate(queue):
        vid = c["video_id"]
        url = c["url"]
        tmp_dir = tempfile.mkdtemp(prefix=f"p2_slow_ocr_{vid}_")
        out_mp4 = os.path.join(tmp_dir, f"{vid}.mp4")
        try:
            cmd = [
                "yt-dlp",
                "--no-warnings",
                "--no-playlist",
                "-f",
                "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[height<=720]",
                "--merge-output-format",
                "mp4",
                "-o",
                out_mp4,
                url,
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0 or not os.path.exists(out_mp4):
                err_msg = (proc.stderr or proc.stdout or f"returncode={proc.returncode}").strip()
                if is_bot_check_error(err_msg):
                    print(f"[{idx+1}/{len(queue)}] ABORT on {vid}: YouTube bot-check active. Stopping immediately.", flush=True)
                    aborted = True
                    break
                existing[vid] = {
                    "video_id": vid,
                    "url": url,
                    "stratum": c.get("stratum"),
                    "genre": c.get("genre"),
                    "label_rule_id": c.get("label_rule_id"),
                    "ocr_engine": "rapidocr_onnxruntime",
                    "ocr_engine_version": "1.2.3",
                    "download_error": err_msg[:400],
                    "award_badge_ocr_hit": None,
                    "checked_at": datetime.now(timezone.utc).isoformat(),
                }
                print(f"[{idx+1}/{len(queue)}] DL_ERROR {vid}: {err_msg[:120]}", flush=True)
            else:
                res = check_video_file(video_id=vid, video_path=Path(out_mp4), ocr=ocr, check_watermark=True)
                res["input_path"] = "<temp_deleted>"
                res["url"] = url
                res["stratum"] = c.get("stratum")
                res["genre"] = c.get("genre")
                res["label_rule_id"] = c.get("label_rule_id")
                existing[vid] = res
                completed += 1
                print(
                    f"[{idx+1}/{len(queue)}] OK {vid} ({c.get('stratum')}/{c.get('genre')}): "
                    f"frames={res.get('frames_checked')} hit={res.get('award_badge_ocr_hit')}",
                    flush=True,
                )
                # Persist immediately after every completed video (LF line endings for cross-platform SHA-256 integrity)
                with log_path.open("w", encoding="utf-8", newline="\n") as f:
                    f.write("\n".join(json.dumps(v, ensure_ascii=False) for v in existing.values()) + "\n")
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

        if idx + 1 < len(queue):
            delay = random.randint(args.min_delay_sec, args.max_delay_sec)
            print(f"Sleeping {delay}s before next video...", flush=True)
            time.sleep(delay)

    print(json.dumps({"completed": completed, "aborted_due_to_bot_check": aborted, "remaining": len(queue) - completed}), flush=True)


if __name__ == "__main__":
    main()
