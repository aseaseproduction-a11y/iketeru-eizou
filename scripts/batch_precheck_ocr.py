#!/usr/bin/env python3
"""
Batch local ffmpeg + RapidOCR award-badge precheck for Phase 2 candidates.

- Downloads each candidate into an isolated temporary directory via yt-dlp (height<=720 mp4).
- Runs local precheck_award_badge_ocr.check_video_file() (zero LLM/VLM video inspection).
- Deletes the temporary video immediately after OCR completes.
- Appends every result (including keyword_matched, timestamp_sec, matched_text, confidence)
  to --log-jsonl, supporting safe resume (skips video_ids already in log unless --force).
- Prints a complete summary including total excluded count and per-video hit details.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import precheck_award_badge_ocr as ocr_mod


def load_existing_ids(log_path: Path) -> set[str]:
    if not log_path.exists():
        return set()
    ids: set[str] = set()
    for line in log_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
            if obj.get("video_id") and not obj.get("download_error"):
                ids.add(str(obj["video_id"]))
        except Exception:
            pass
    return ids


def download_temp_video(url: str, tmp_dir: Path, video_id: str) -> Path:
    out_tpl = str(tmp_dir / f"{video_id}.%(ext)s")
    cmd = [
        "yt-dlp",
        "--no-warnings",
        "--no-playlist",
        "-f",
        "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b",
        "--merge-output-format",
        "mp4",
        "-o",
        out_tpl,
        url,
    ]
    subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=180)
    matches = sorted(tmp_dir.glob(f"{video_id}.*"))
    mp4s = [p for p in matches if p.suffix.lower() in {".mp4", ".mkv", ".webm"} and p.stat().st_size > 0]
    if not mp4s:
        raise RuntimeError(f"yt-dlp produced no video file for {video_id}")
    return mp4s[0]


def main() -> int:
    parser = argparse.ArgumentParser(description="Batch local OCR award-badge precheck")
    parser.add_argument("--candidates", required=True, help="JSON array of {video_id, url, ...}")
    parser.add_argument("--log-jsonl", required=True, help="Output JSONL audit log path")
    parser.add_argument("--conf-threshold", type=float, default=ocr_mod.DEFAULT_CONF_THRESHOLD)
    parser.add_argument("--check-watermark", action="store_true")
    parser.add_argument("--force", action="store_true", help="Re-check even if already in log")
    args = parser.parse_args()

    candidates: list[dict[str, Any]] = json.loads(Path(args.candidates).read_text(encoding="utf-8"))
    log_path = Path(args.log_jsonl)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    already = set() if args.force else load_existing_ids(log_path)

    ocr = ocr_mod.RapidOCR()
    processed = 0
    excluded = 0
    errors = 0

    for idx, c in enumerate(candidates, 1):
        vid = str(c["video_id"])
        url = str(c["url"])
        if vid in already:
            continue
        with tempfile.TemporaryDirectory(prefix="iketeru_p2_ocr_") as tmp:
            tmp_dir = Path(tmp)
            try:
                vpath = download_temp_video(url, tmp_dir, vid)
                rec = ocr_mod.check_video_file(
                    video_id=vid,
                    video_path=vpath,
                    ocr=ocr,
                    conf_threshold=args.conf_threshold,
                    check_watermark=args.check_watermark,
                )
                rec["input_path"] = "<temp_deleted>"
                rec["url"] = url
                rec["stratum"] = c.get("stratum")
                rec["genre"] = c.get("genre")
                rec["label_rule_id"] = c.get("label_rule_id")
                processed += 1
                if rec["award_badge_ocr_hit"]:
                    excluded += 1
            except Exception as err:
                errors += 1
                rec = {
                    "video_id": vid,
                    "url": url,
                    "stratum": c.get("stratum"),
                    "genre": c.get("genre"),
                    "label_rule_id": c.get("label_rule_id"),
                    "ocr_engine": ocr_mod.OCR_ENGINE_NAME,
                    "ocr_engine_version": ocr_mod.OCR_ENGINE_VERSION,
                    "download_error": str(err)[:400],
                    "award_badge_ocr_hit": None,
                    "checked_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                }
        with log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        status = "ERR" if rec.get("download_error") else ("EXCLUDED_HIT" if rec["award_badge_ocr_hit"] else "CLEAN")
        print(f"[{idx}/{len(candidates)}] {vid} ({c.get('genre')}/{c.get('stratum')}) -> {status}", flush=True)

    # Final summary from full log
    all_recs = [json.loads(l) for l in log_path.read_text(encoding="utf-8").splitlines() if l.strip()]
    latest: dict[str, dict[str, Any]] = {}
    for r in all_recs:
        if r.get("video_id"):
            latest[str(r["video_id"])] = r
    total_clean = sum(1 for r in latest.values() if r.get("award_badge_ocr_hit") is False)
    total_hit = sum(1 for r in latest.values() if r.get("award_badge_ocr_hit") is True)
    total_err = sum(1 for r in latest.values() if r.get("download_error"))
    print(
        json.dumps(
            {
                "summary": {
                    "newly_processed": processed,
                    "total_unique_in_log": len(latest),
                    "clean_pass": total_clean,
                    "auto_excluded_ocr_hit": total_hit,
                    "download_errors": total_err,
                },
                "excluded_videos": [
                    {
                        "video_id": r["video_id"],
                        "genre": r.get("genre"),
                        "stratum": r.get("stratum"),
                        "hit_count": r.get("hit_count"),
                        "hits": r.get("hits", []),
                    }
                    for r in latest.values()
                    if r.get("award_badge_ocr_hit") is True
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
