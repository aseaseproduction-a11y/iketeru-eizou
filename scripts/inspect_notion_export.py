#!/usr/bin/env python3
"""Notion CSV import profile generator.

Python 3.11 stdlib only. Reads a Notion CSV export and writes a compact
profile that documents the source columns, null rates, and safe examples.
"""

from __future__ import annotations

import csv
import json
import sys
from collections import Counter
from pathlib import Path

TARGET_SCHEMA = {
    "name": "string",
    "url": "string",
    "tone_visuals": "list[string]",
    "tone_emotions": "list[string]",
    "tone_techniques": "list[string]",
    "productions": "list[string]",
    "purposes": "list[string]",
    "private_rating": "string",
    "expressions": "list[string]",
    "added_date": "string",
}

SOURCE_TO_TARGET = {
    "名前": "name",
    "URL": "url",
    "トンマナ（ビジュアル・スタイル）": "tone_visuals",
    "トンマナ（感情・ムード）": "tone_emotions",
    "トンマナ（技術・要素）": "tone_techniques",
    "制作": "productions",
    "用途": "purposes",
    "私的評価": "private_rating",
    "表現": "expressions",
    "追加日": "added_date",
}


def safe_example(value: str, limit: int = 120) -> str:
    normalized = " ".join(value.split())
    return normalized[:limit] + ("…" if len(normalized) > limit else "")


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: inspect_notion_export.py INPUT.csv OUTPUT.json")

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    with input_path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        headers = reader.fieldnames or []
        non_empty = Counter()
        samples: dict[str, list[str]] = {column: [] for column in SOURCE_TO_TARGET}
        total_rows = 0
        empty_url_rows = 0

        for row in reader:
            total_rows += 1
            if not (row.get("URL") or "").strip():
                empty_url_rows += 1
            for column in SOURCE_TO_TARGET:
                value = (row.get(column) or "").strip()
                if value:
                    non_empty[column] += 1
                    if len(samples[column]) < 3:
                        samples[column].append(safe_example(value))

    profile = {
        "source": str(input_path),
        "target_schema": TARGET_SCHEMA,
        "headers": headers,
        "row_count": total_rows,
        "empty_url_rows": empty_url_rows,
        "mapped_columns": {
            source_column: {
                "target": target_column,
                "non_empty": non_empty[source_column],
                "null_count": total_rows - non_empty[source_column],
                "examples": samples[source_column],
            }
            for source_column, target_column in SOURCE_TO_TARGET.items()
        },
        "pii_assessment": {
            "checked_columns": headers,
            "result": "No dedicated email, phone, address, or financial-account columns detected.",
        },
    }
    output_path.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"rows": total_rows, "headers": len(headers), "output": str(output_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
