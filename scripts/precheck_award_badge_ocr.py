#!/usr/bin/env python3
"""
Deterministic local ffmpeg + RapidOCR award-badge / laurel / trophy text precheck.

Strictly adheres to docs/CALIBRATION_PHASE2_DESIGN.md (v3-frozen, Section 3.1):
- Zero LLM / VLM / Antigravity video inspection.
- Extracts frames via ffmpeg:
    - First 15.0s at 1.0 fps
    - Last 20.0s at 1.0 fps
    - Middle body (15.0s .. max(15.0, duration - 20.0)) at 0.2 fps (every 5.0s)
    - Scaled to height=720 (scale=-2:720), PNG
- Runs local offline RapidOCR (rapidocr_onnxruntime) on every extracted frame.
- Matches OCR text with confidence >= 60.0 (0-100 scale) against the frozen award keyword regex.
- If >= 1 frame hits, marks `award_badge_ocr_hit: true` (auto-exclude).
- Logs every checked video and every hit (keyword, timestamp_sec, matched_text, confidence) to JSONL.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from importlib import metadata as importlib_metadata
import rapidocr_onnxruntime
from rapidocr_onnxruntime import RapidOCR

OCR_ENGINE_NAME = "rapidocr_onnxruntime"
try:
    OCR_ENGINE_VERSION = importlib_metadata.version("rapidocr-onnxruntime")
except Exception:
    OCR_ENGINE_VERSION = getattr(rapidocr_onnxruntime, "__version__", "unknown")
DEFAULT_CONF_THRESHOLD = 60.0  # 0-100 scale

# Frozen regex from CALIBRATION_PHASE2_DESIGN.md v3-frozen Section 3.1
AWARD_KEYWORD_PATTERN = re.compile(
    r"(?:"
    r"cannes|lions|d\s*&\s*ad|pencil|ciclope|aicp|british\s*arrows|"
    r"acc\s*tokyo|ukmva|sxsw|annecy|siggraph|ars\s*electronica|adfest|"
    r"vimeo\s*staff\s*pick|staff\s*pick|shortlist|grand\s*prix|"
    r"gold\s*lion|silver\s*lion|bronze\s*lion|palme\s*d['’]?or|"
    r"academy\s*award|oscar|emmy|webby|clio|new\s*york\s*festivals|"
    r"motion\s*awards|space\s*shower|"
    r"メディア芸術祭|新千歳|受賞|最優秀|グランプリ|金賞|銀賞|銅賞|入賞|"
    r"オフィシャルセレクション|official\s*selection|award\s*winner"
    r")",
    re.IGNORECASE,
)

# Optional R-LOW-04 free-tool watermark regex (informational / R-LOW-04 metadata verification)
WATERMARK_KEYWORD_PATTERN = re.compile(
    r"(?:"
    r"made\s*with\s*clipchamp|created\s*with\s*powtoon|filmora|renderforest|"
    r"animoto|invideo|vyond|animaker|powtoon|capcut\s*template"
    r")",
    re.IGNORECASE,
)


def compute_sample_timestamps(duration_sec: float) -> list[float]:
    """
    Deterministic frame sampling schedule:
      - First 15.0s: 1.0 fps (0.0, 1.0, ..., <= min(15.0, dur))
      - Last 20.0s: 1.0 fps (max(0.0, dur - 20.0), ..., < dur)
      - Middle body: 0.2 fps (every 5.0s between 15.0 and dur - 20.0)
    Returns sorted unique timestamps clamped safely inside [0.0, max(0.0, dur - 0.1)].
    """
    if duration_sec <= 0:
        return [0.0]

    max_ts = max(0.0, duration_sec - 0.1)
    stamps: set[int] = set()  # integer tenths of a second for exact dedup

    def add_ts(t: float) -> None:
        clamped = min(max(0.0, t), max_ts)
        stamps.add(int(round(clamped * 10)))

    # First 15s at 1.0 fps
    head_end = min(15.0, duration_sec)
    t = 0.0
    while t <= head_end + 1e-6:
        add_ts(t)
        t += 1.0

    # Middle at 0.2 fps (every 5.0s)
    tail_start = max(0.0, duration_sec - 20.0)
    if tail_start > 15.0:
        t = 20.0
        while t < tail_start - 1e-6:
            add_ts(t)
            t += 5.0

    # Last 20s at 1.0 fps
    t = math.floor(tail_start)
    while t <= max_ts + 1e-6:
        add_ts(t)
        t += 1.0
    add_ts(max_ts)

    return sorted(s / 10.0 for s in stamps)


def probe_duration_sec(video_path: Path) -> float:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(video_path),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return float(res.stdout.strip())


def extract_frames(video_path: Path, timestamps: list[float], out_dir: Path) -> list[tuple[float, Path]]:
    """
    Extract frames via ffmpeg using fast input-seeking (-ss before -i) per timestamp.
    """
    frames: list[tuple[float, Path]] = []
    for idx, ts in enumerate(timestamps):
        out_path = out_dir / f"frame_{idx:04d}_{int(round(ts * 10)):06d}.png"
        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{ts:.2f}",
            "-i",
            str(video_path),
            "-frames:v",
            "1",
            "-vf",
            "scale=-2:720",
            "-y",
            str(out_path),
        ]
        subprocess.run(cmd, capture_output=True, check=False)
        if out_path.exists() and out_path.stat().st_size > 0:
            frames.append((ts, out_path))
    return frames


def match_ocr_lines(
    ocr_result: list[Any] | None,
    timestamp_sec: float,
    conf_threshold: float = DEFAULT_CONF_THRESHOLD,
    pattern: re.Pattern[str] = AWARD_KEYWORD_PATTERN,
) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    if not ocr_result:
        return hits
    for item in ocr_result:
        # RapidOCR item format: [box, text, score]
        if not isinstance(item, (list, tuple)) or len(item) < 3:
            continue
        text = str(item[1] or "").strip()
        try:
            score_raw = float(item[2])
        except (TypeError, ValueError):
            continue
        conf_100 = score_raw * 100.0 if score_raw <= 1.0 else score_raw
        if conf_100 < conf_threshold or not text:
            continue
        for m in pattern.finditer(text):
            hits.append(
                {
                    "timestamp_sec": round(timestamp_sec, 2),
                    "keyword_matched": m.group(0),
                    "matched_text": text,
                    "confidence": round(conf_100, 2),
                }
            )
    return hits


def check_video_file(
    video_id: str,
    video_path: Path,
    ocr: RapidOCR,
    conf_threshold: float = DEFAULT_CONF_THRESHOLD,
    check_watermark: bool = False,
) -> dict[str, Any]:
    duration_sec = probe_duration_sec(video_path)
    timestamps = compute_sample_timestamps(duration_sec)
    all_hits: list[dict[str, Any]] = []
    watermark_hits: list[dict[str, Any]] = []
    frames_checked = 0

    with tempfile.TemporaryDirectory(prefix="iketeru_ocr_") as tmp:
        tmp_dir = Path(tmp)
        frames = extract_frames(video_path, timestamps, tmp_dir)
        frames_checked = len(frames)
        for ts, frame_path in frames:
            res, _ = ocr(str(frame_path))
            hits = match_ocr_lines(res, ts, conf_threshold=conf_threshold, pattern=AWARD_KEYWORD_PATTERN)
            all_hits.extend(hits)
            if check_watermark:
                wm_hits = match_ocr_lines(
                    res, ts, conf_threshold=conf_threshold, pattern=WATERMARK_KEYWORD_PATTERN
                )
                watermark_hits.extend(wm_hits)

    record: dict[str, Any] = {
        "video_id": video_id,
        "input_path": str(video_path),
        "duration_sec": round(duration_sec, 2),
        "ocr_engine": OCR_ENGINE_NAME,
        "ocr_engine_version": OCR_ENGINE_VERSION,
        "conf_threshold": conf_threshold,
        "frames_scheduled": len(timestamps),
        "frames_checked": frames_checked,
        "award_badge_ocr_hit": len(all_hits) > 0,
        "hit_count": len(all_hits),
        "hits": all_hits,
        "checked_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    if check_watermark:
        record["watermark_ocr_hit"] = len(watermark_hits) > 0
        record["watermark_hits"] = watermark_hits
    return record


def main() -> int:
    parser = argparse.ArgumentParser(description="Local ffmpeg + RapidOCR award-badge precheck")
    parser.add_argument("--video-id", required=True, help="Unique video ID")
    parser.add_argument("--input", required=True, help="Local video file path")
    parser.add_argument("--log-jsonl", help="Optional JSONL log path to append result")
    parser.add_argument(
        "--conf-threshold",
        type=float,
        default=DEFAULT_CONF_THRESHOLD,
        help="Minimum OCR confidence on 0-100 scale (default: 60.0)",
    )
    parser.add_argument(
        "--check-watermark",
        action="store_true",
        help="Also record R-LOW-04 free-tool watermark hits (informational)",
    )
    args = parser.parse_args()

    video_path = Path(args.input)
    if not video_path.exists():
        print(json.dumps({"error": f"Input file not found: {video_path}"}), file=sys.stderr)
        return 2

    ocr = RapidOCR()
    record = check_video_file(
        video_id=args.video_id,
        video_path=video_path,
        ocr=ocr,
        conf_threshold=args.conf_threshold,
        check_watermark=args.check_watermark,
    )

    if args.log_jsonl:
        log_path = Path(args.log_jsonl)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(json.dumps(record, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
