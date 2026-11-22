#!/usr/bin/env python3
"""Unit tests for scripts/precheck_award_badge_ocr.py."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import precheck_award_badge_ocr as mod


class TestPrecheckAwardBadgeOcr(unittest.TestCase):
    def test_sample_timestamps_short_video(self) -> None:
        ts = mod.compute_sample_timestamps(10.0)
        self.assertGreaterEqual(len(ts), 10)
        self.assertEqual(ts[0], 0.0)
        self.assertLessEqual(ts[-1], 9.9)
        # Strictly increasing, unique
        self.assertEqual(ts, sorted(set(ts)))

    def test_sample_timestamps_long_video_schedule(self) -> None:
        # 120s video: 0..15s at 1fps (16), middle 20..95s at 0.2fps (16), tail 100..119.9 at 1fps (21)
        ts = mod.compute_sample_timestamps(120.0)
        self.assertIn(0.0, ts)
        self.assertIn(15.0, ts)
        self.assertIn(20.0, ts)
        self.assertIn(25.0, ts)
        self.assertNotIn(22.0, ts)  # middle must be 5s interval, not 1s
        self.assertIn(100.0, ts)
        self.assertIn(115.0, ts)
        self.assertIn(119.9, ts)

    def test_match_ocr_lines_confidence_and_regex(self) -> None:
        sample = [
            [[], "ADFEST 2016 WINNER", 0.85],
            [[], "Cannes Lions Grand Prix", 0.55],  # below 60% threshold -> ignored
            [[], "Normal Commercial Brand", 0.99],
            [[], "文化庁メディア芸術祭 受賞", 0.92],
        ]
        hits = mod.match_ocr_lines(sample, timestamp_sec=304.0, conf_threshold=60.0)
        keywords = [h["keyword_matched"].lower() for h in hits]
        self.assertIn("adfest", keywords)
        self.assertIn("メディア芸術祭", keywords)
        self.assertIn("受賞", keywords)
        self.assertNotIn("cannes", keywords)  # filtered by conf < 60
        for h in hits:
            self.assertEqual(h["timestamp_sec"], 304.0)
            self.assertGreaterEqual(h["confidence"], 60.0)

    def test_synthetic_mp4_detects_badge_and_logs_jsonl(self) -> None:
        with tempfile.TemporaryDirectory(prefix="iketeru_ocr_test_") as tmp:
            tmp_dir = Path(tmp)
            # Create a 3-second synthetic MP4 with "ADFEST 2016" rendered onto frame
            badge_img = tmp_dir / "badge.png"
            img = Image.new("RGB", (1280, 720), color=(15, 15, 15))
            d = ImageDraw.Draw(img)
            d.text((120, 280), "ADFEST 2016 GOLD WINNER", fill=(255, 255, 255))
            img.save(badge_img)

            badge_mp4 = tmp_dir / "badge.mp4"
            subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-loop",
                    "1",
                    "-i",
                    str(badge_img),
                    "-t",
                    "2",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    "-y",
                    str(badge_mp4),
                ],
                check=True,
            )

            # Create a clean 2-second synthetic MP4 with NO award text
            clean_img = tmp_dir / "clean.png"
            img2 = Image.new("RGB", (1280, 720), color=(20, 30, 40))
            d2 = ImageDraw.Draw(img2)
            d2.text((120, 280), "SPRING COFFEE NEW RELEASE", fill=(255, 255, 255))
            img2.save(clean_img)

            clean_mp4 = tmp_dir / "clean.mp4"
            subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-loop",
                    "1",
                    "-i",
                    str(clean_img),
                    "-t",
                    "2",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    "-y",
                    str(clean_mp4),
                ],
                check=True,
            )

            log_jsonl = tmp_dir / "ocr_precheck_log.jsonl"
            ocr = mod.RapidOCR()

            rec_badge = mod.check_video_file("test_badge", badge_mp4, ocr)
            rec_clean = mod.check_video_file("test_clean", clean_mp4, ocr)

            self.assertTrue(rec_badge["award_badge_ocr_hit"])
            self.assertGreaterEqual(rec_badge["hit_count"], 1)
            self.assertEqual(rec_badge["ocr_engine"], mod.OCR_ENGINE_NAME)
            self.assertFalse(rec_clean["award_badge_ocr_hit"])
            self.assertEqual(rec_clean["hit_count"], 0)

            # CLI test + JSONL logging
            proc = subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).resolve().parent / "precheck_award_badge_ocr.py"),
                    "--video-id",
                    "cli_badge",
                    "--input",
                    str(badge_mp4),
                    "--log-jsonl",
                    str(log_jsonl),
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            parsed = json.loads(proc.stdout)
            self.assertTrue(parsed["award_badge_ocr_hit"])
            lines = [json.loads(line) for line in log_jsonl.read_text(encoding="utf-8").splitlines() if line.strip()]
            self.assertEqual(len(lines), 1)
            self.assertEqual(lines[0]["video_id"], "cli_badge")


if __name__ == "__main__":
    unittest.main(verbosity=2)
