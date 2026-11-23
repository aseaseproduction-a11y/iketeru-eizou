#!/usr/bin/env python3
r"""Verify numeric values in a technique dictionary Markdown file against private OCR pages.

This script reads:
  1. A technique dictionary Markdown file inside the repository (summaries + page citations + tool supplements)
  2. A private OCR JSONL file strictly OUTSIDE the repository (e.g. E:\技術書_index\ocr_private\*.jsonl)

For each entry (both the top summary table row AND the detailed `### \`ID\`` section), it:
  - Parses cited PDF page ranges (`PDF p.XX–YY` or `PDF p.XX–YY, AA–BB`)
  - Extracts numeric claims (%, IRE, 度, 比率, bit/bpc, px, 範囲, 小数, 仕様数値等) separately for:
      * `table`      : top cross-check summary table row
      * `book`       : entry title + "本書の記述" section
      * `supplement` : "再現方法の補足" (tool-by-tool supplement) section
  - Checks whether each numeric claim appears in the cited PDF pages of the private OCR:
      * `FOUND_EXACT`     : verbatim normalized match in cited OCR pages
      * `FOUND_OCR_GLYPH` : match only after narrow, deterministic Japanese OCR digit-misread normalization
                            (e.g. `1` misread as `一`/`ー` next to digits/units, `100` as `I()O`, `ビット` as `ピット`)
      * `UNLISTED_MARKED` : not in cited OCR pages, AND explicitly marked as `本書に記載なし` / `補足目安`
      * `NOT_FOUND`       : not in cited OCR pages and NOT marked (fails `--strict`)
  - Never copies OCR body text into stdout or JSON reports (numeric tokens & page numbers only).

Reusable for Books 1 through 5.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from typing import Dict, List, Set, Tuple


NUM_TOKEN_RE = re.compile(
    r"""
    (?<![A-Za-z0-9_.])
    (?:
        \d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?(?:\s*:\s*\d+(?:\.\d+)?)?
        |
        -?\d+(?:\.\d+)?\s*[–—〜~\-]\s*-?\d+(?:\.\d+)?\s*(?:%|％|IRE|bit|bpc|px|K|度|時|fps|Hz|dB|mV|mm|cm|m|倍)?
        |
        -?\d+(?:\.\d+)?\s*(?:%|％|IRE|bit|bpc|px|K|度|時|fps|Hz|dB|mV|mm|cm|m|倍)
        |
        (?:Gamma|BT\.|ITU-R)\s*\d+(?:\.\d+)?
        |
        \d+\.\d+
        |
        (?<!p\.)(?<!Ch\.)(?<!第)(?<!Appendix\s)(?<!COLOR-)(?<!AE-)(?<!BL-)(?<!ADDON-)(?<!DIY-)\b\d{2,4}\b
    )
    """,
    re.VERBOSE | re.IGNORECASE,
)

IGNORED_TOKENS = {
    re.compile(r"^0[1-8]$"),
    re.compile(r"^(?:709|2020)$"),  # inside Rec.709 / Rec.2020
    re.compile(r"^(?:202[0-9])$"),  # creation year
}


def normalize_text(text: str) -> str:
    s = unicodedata.normalize("NFKC", text)
    s = s.replace("−", "-").replace("–", "-").replace("—", "-").replace("―", "-").replace("〜", "~")
    return s


def normalize_ocr_glyphs(text: str) -> str:
    """Narrow, deterministic normalization for known Windows Japanese OCR digit glitches.

    Only used as a secondary check (`FOUND_OCR_GLYPH`), never silently conflated with `FOUND_EXACT`.
    """
    s = normalize_text(text)
    s = s.replace("ピット", "ビット").replace("ヒ・プト", "ビット").replace("ピノト", "ビット")
    s = re.sub(r"I\(\)O|l\(\)O|I\(\)0", "100", s)
    s = re.sub(r"l\(\)", "10", s)
    # `一 00` / `ー 00` -> `100`
    s = re.sub(r"[一ー]\s*00\b", "100", s)
    # `一 0 ビット` -> `10 ビット`, `ー 2 ビット` -> `12 ビット`, `一 6 ~ 235` -> `16 ~ 235`
    s = re.sub(r"[一ー]\s*(\d)\s*(?=ビット|~|-|%)", r"1\1", s)
    # `2 ー %` -> `21%`
    s = re.sub(r"(\d)\s*[一ー]\s*(?=%|%|~|-)", r"\g<1>1", s)
    # `1 10 %` -> `110%`
    s = re.sub(r"\b1\s+10\s*%", "110%", s)
    # `い 0 ー ~ い 0` / `い 0 ー ~ ロ 0 %` -> superwhite `101~110%`
    s = re.sub(r"い\s*0\s*[一ー]\s*~\s*(?:い|ロ)\s*0", "101~110", s)
    return s


def parse_pdf_pages(citation_text: str) -> List[int]:
    norm = normalize_text(citation_text)
    m = re.search(r"PDF\s*p\.\s*([0-9,\s\-~]+)", norm, flags=re.IGNORECASE)
    if not m:
        return []
    spec = m.group(1)
    pages: List[int] = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        rm = re.match(r"^(\d+)\s*[-~]\s*(\d+)$", part)
        if rm:
            a, b = int(rm.group(1)), int(rm.group(2))
            if a <= b:
                pages.extend(range(a, b + 1))
        else:
            sm = re.match(r"^(\d+)$", part)
            if sm:
                pages.append(int(sm.group(1)))
    return sorted(set(pages))


def load_ocr_pages(ocr_jsonl: pathlib.Path) -> Tuple[Dict[int, str], Dict[int, str]]:
    exact_pages: Dict[int, str] = {}
    glyph_pages: Dict[int, str] = {}
    with ocr_jsonl.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            pno = int(rec.get("pdf_page") or rec.get("page") or 0)
            if pno > 0:
                raw = rec.get("text", "")
                exact_pages[pno] = normalize_text(raw)
                glyph_pages[pno] = normalize_ocr_glyphs(raw)
    return exact_pages, glyph_pages


def strip_non_claim_metadata(text: str) -> str:
    """Remove structural citations, node IDs, and book edition markers before extracting numeric claims."""
    s = normalize_text(text)
    # Remove full citation line `- **出典**: ...`
    s = re.sub(r"^\s*-\s*\*\*出典\*\*.*$", "", s, flags=re.MULTILINE)
    # Remove inline page/chapter references
    s = re.sub(r"本書\s*p\.[0-9,\s\-~]+", "", s)
    s = re.sub(r"PDF\s*p\.[0-9,\s\-~]+", "", s)
    s = re.sub(r"Ch\.\d+(?:\.\d+)?(?:[\-,〜~]\s*\d+(?:\.\d+)?)*", "", s)
    s = re.sub(r"Appendix\s*[A-Z]\.\d+(?:[\-,〜~]\s*[A-Z]?\.\d+)*", "", s)
    s = re.sub(r"図\s*\d+(?:\.\d+)?", "", s)
    s = re.sub(r"\b(?:COLOR|AE|BL|ADDON|DIY)-\d{3}\b", "", s)
    s = re.sub(r"Rec\.709|BT\.709|Rec\.2020", "", s, flags=re.I)
    s = re.sub(r"第\d+版", "", s)
    s = re.sub(r"`0\d\s+[A-Z0-9\s/]+`", "", s)
    s = re.sub(r"`0\d[\-~]0\d`", "", s)
    return s


def extract_numeric_claims(text: str) -> List[Tuple[str, bool]]:
    cleaned = strip_non_claim_metadata(text)
    results: List[Tuple[str, bool]] = []
    seen: Set[str] = set()
    for m in NUM_TOKEN_RE.finditer(cleaned):
        tok = m.group(0).strip()
        if not tok:
            continue
        if any(p.match(tok) for p in IGNORED_TOKENS):
            continue
        if tok in seen:
            continue
        seen.add(tok)
        start = max(0, m.start() - 45)
        end = min(len(cleaned), m.end() + 65)
        window = cleaned[start:end]
        marked_unlisted = (
            ("本書に記載なし" in window)
            or ("補足目安" in window)
            or ("固有設定" in window)
            or ("現行版" in window)
        )
        results.append((tok, marked_unlisted))
    return results


def build_search_variants(token: str) -> List[str]:
    t = normalize_text(token).strip()
    if ":" in t:
        compact = re.sub(r"\s*", "", t)
        return [compact, compact.replace(":", " : ")]

    rm = re.match(r"^(-?\d+(?:\.\d+)?)\s*[-~]\s*(-?\d+(?:\.\d+)?)\s*(.*)$", t)
    if rm:
        return [f"RANGE::{rm.group(1)}::{rm.group(2)}::{rm.group(3).strip()}"]

    um = re.match(r"^(-?\d+(?:\.\d+)?)\s*(%|IRE|bit|bpc|px|K|度|時|fps|Hz|dB|mV|mm|cm|m|倍)$", t, re.I)
    if um:
        num, unit = um.group(1), um.group(2)
        ul = unit.lower()
        if ul == "bit":
            return [f"{num}bit", f"{num} bit", f"{num}-bit", f"{num}ビット", f"{num} ビット"]
        if ul == "bpc":
            return [f"{num}bpc", f"{num} bpc"]
        if ul == "%":
            return [f"{num}%", f"{num} %", f"{num}パーセント"]
        if ul == "ire":
            return [f"{num}IRE", f"{num} IRE", f"{num}% IRE", f"{num} % IRE"]
        return [f"{num}{unit}", f"{num} {unit}"]

    gm = re.match(r"^(Gamma|BT\.|ITU-R)\s*(\d+(?:\.\d+)?)$", t, re.I)
    if gm:
        prefix, num = gm.group(1), gm.group(2)
        if prefix.lower() == "gamma":
            return [f"Gamma {num}", f"ガンマ{num}", f"ガンマ {num}", num]
        return [f"{prefix}{num}", f"{prefix} {num}"]

    return [t]


def search_in_pages(token: str, cited_pages: List[int], pages_map: Dict[int, str]) -> List[int]:
    variants = build_search_variants(token)
    matched: List[int] = []

    if len(variants) == 1 and variants[0].startswith("RANGE::"):
        _, a, b, unit = variants[0].split("::")
        ul = unit.lower()
        for p in cited_pages:
            txt = pages_map.get(p, "")
            if not txt:
                continue
            a_ok = re.search(rf"(?<!\d){re.escape(a)}(?!\d)", txt) is not None
            b_ok = re.search(rf"(?<!\d){re.escape(b)}(?!\d)", txt) is not None
            if not (a_ok and b_ok):
                continue
            if ul == "ire" and "ire" not in txt.lower():
                continue
            if ul == "%" and ("%" not in txt and "パーセント" not in txt):
                continue
            if ul == "px" and ("px" not in txt.lower() and "ピクセル" not in txt):
                continue
            matched.append(p)
        return matched

    for p in cited_pages:
        txt = pages_map.get(p, "")
        if not txt:
            continue
        txt_low = txt.lower()
        for v in variants:
            vl = v.lower()
            if re.match(r"^-?\d", vl):
                pat = rf"(?<!\d){re.escape(vl)}"
                if re.search(r"\d$", vl):
                    pat += r"(?!\d)"
                if re.search(pat, txt_low):
                    matched.append(p)
                    break
            elif vl in txt_low:
                matched.append(p)
                break
    return matched


@dataclass
class TokenResult:
    token: str
    section: str  # "table" | "book" | "supplement"
    status: str   # "FOUND_EXACT" | "FOUND_OCR_GLYPH" | "UNLISTED_MARKED" | "NOT_FOUND"
    found_pages: List[int]
    marked_unlisted: bool


@dataclass
class EntryReport:
    entry_id: str
    title: str
    cited_pdf_pages: List[int]
    tokens: List[TokenResult] = field(default_factory=list)


def parse_summary_table(md_text: str) -> Dict[str, Tuple[List[int], str]]:
    r"""Parse top cross-check table rows: `| \`COLOR-001\` | name | pages | summary |`."""
    rows: Dict[str, Tuple[List[int], str]] = {}
    row_re = re.compile(r"^\|\s*`([A-Z]+-\d{3})`\s*\|([^|]+)\|([^|]+)\|([^|]+)\|", re.MULTILINE)
    for m in row_re.finditer(md_text):
        eid = m.group(1)
        name = m.group(2).strip()
        pages_cell = m.group(3).strip()
        summary = m.group(4).strip()
        rows[eid] = (parse_pdf_pages(pages_cell), f"{name}\n{summary}")
    return rows


def parse_dictionary_entries(md_text: str) -> List[Tuple[str, str, List[int], str, str]]:
    pattern = re.compile(r"^###\s+`([A-Z]+-\d{3})`\s+(.+)$", re.MULTILINE)
    matches = list(pattern.finditer(md_text))
    entries = []
    for idx, m in enumerate(matches):
        entry_id = m.group(1)
        title = m.group(2).strip()
        start = m.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(md_text)
        body = md_text[start:end].strip()

        cite_m = re.search(r"^\s*-\s*\*\*出典\*\*.*$", body, flags=re.MULTILINE)
        cite_line = cite_m.group(0) if cite_m else body.splitlines()[0]
        pdf_pages = parse_pdf_pages(cite_line)

        sup_m = re.search(
            r"^(?:-\s*\*\*ツール別再現方法\*\*|####\s+.*再現方法の補足.*)",
            body,
            flags=re.MULTILINE,
        )
        if sup_m:
            book_part = title + "\n" + body[: sup_m.start()]
            sup_part = body[sup_m.start() :]
        else:
            book_part = title + "\n" + body
            sup_part = ""

        entries.append((entry_id, title, pdf_pages, book_part, sup_part))
    return entries


def evaluate_token(
    entry_id: str,
    tok: str,
    marked: bool,
    section: str,
    cited_pages: List[int],
    exact_pages: Dict[int, str],
    glyph_pages: Dict[int, str],
    image_verified_map: Dict[Tuple[str, str], List[int]],
) -> TokenResult:
    exact_hits = search_in_pages(tok, cited_pages, exact_pages)
    if exact_hits:
        return TokenResult(tok, section, "FOUND_EXACT", exact_hits, marked)
    glyph_hits = search_in_pages(tok, cited_pages, glyph_pages)
    if glyph_hits:
        return TokenResult(tok, section, "FOUND_OCR_GLYPH", glyph_hits, marked)
    norm_tok = normalize_text(tok).replace("~", "-")
    iv_pages = [p for p in image_verified_map.get((entry_id, norm_tok), []) if p in cited_pages]
    if iv_pages:
        return TokenResult(tok, section, "VERIFIED_BY_IMAGE", iv_pages, marked)
    if marked and section == "supplement":
        return TokenResult(tok, section, "UNLISTED_MARKED", [], marked)
    return TokenResult(tok, section, "NOT_FOUND", [], marked)


def load_image_verified_map(meta_path: pathlib.Path | None) -> Dict[Tuple[str, str], List[int]]:
    iv_map: Dict[Tuple[str, str], List[int]] = {}
    if not meta_path or not meta_path.exists():
        return iv_map
    data = json.loads(meta_path.read_text(encoding="utf-8"))
    for rec in data.get("image_verified_numbers", []):
        eid = str(rec.get("entry_id", "")).strip()
        tok = normalize_text(str(rec.get("token", "")).strip()).replace("~", "-")
        pno = int(rec.get("pdf_page", 0))
        if eid and tok and pno > 0:
            iv_map.setdefault((eid, tok), []).append(pno)
    return iv_map


def main() -> int:
    ap = argparse.ArgumentParser(description="Verify numeric values in technique dictionary against private OCR.")
    ap.add_argument("--dict", required=True, help="Path to technique dictionary .md file")
    ap.add_argument("--ocr", required=True, help="Path to private OCR .jsonl file (outside repo)")
    ap.add_argument("--meta", help="Optional path to companion .json metadata containing image_verified_numbers (auto-detected if sibling .json exists)")
    ap.add_argument("--out", help="Optional path to save structured JSON verification report (no OCR text)")
    ap.add_argument("--strict", action="store_true", help="Exit non-zero if any NOT_FOUND token exists")
    args = ap.parse_args()

    md_path = pathlib.Path(args.dict)
    ocr_path = pathlib.Path(args.ocr)
    meta_path = pathlib.Path(args.meta) if args.meta else md_path.with_suffix(".json")
    image_verified_map = load_image_verified_map(meta_path if meta_path.exists() else None)
    md_text = md_path.read_text(encoding="utf-8")
    exact_pages, glyph_pages = load_ocr_pages(ocr_path)

    table_rows = parse_summary_table(md_text)
    parsed = parse_dictionary_entries(md_text)
    reports: List[EntryReport] = []

    counts = {
        "FOUND_EXACT": 0,
        "FOUND_OCR_GLYPH": 0,
        "VERIFIED_BY_IMAGE": 0,
        "UNLISTED_MARKED": 0,
        "NOT_FOUND_TABLE": 0,
        "NOT_FOUND_BOOK": 0,
        "NOT_FOUND_SUPPLEMENT": 0,
    }

    for entry_id, title, pdf_pages, book_part, sup_part in parsed:
        er = EntryReport(entry_id=entry_id, title=title, cited_pdf_pages=pdf_pages)
        sections_to_check: List[Tuple[str, str, List[int]]] = []
        if entry_id in table_rows:
            t_pages, t_text = table_rows[entry_id]
            sections_to_check.append(("table", t_text, t_pages or pdf_pages))
        sections_to_check.append(("book", book_part, pdf_pages))
        sections_to_check.append(("supplement", sup_part, pdf_pages))

        for sec_name, sec_text, sec_pages in sections_to_check:
            for tok, marked in extract_numeric_claims(sec_text):
                tr = evaluate_token(entry_id, tok, marked, sec_name, sec_pages, exact_pages, glyph_pages, image_verified_map)
                er.tokens.append(tr)
                if tr.status in ("FOUND_EXACT", "FOUND_OCR_GLYPH", "VERIFIED_BY_IMAGE", "UNLISTED_MARKED"):
                    counts[tr.status] += 1
                else:
                    counts[f"NOT_FOUND_{sec_name.upper()}"] += 1
        reports.append(er)

    print(f"Dictionary: {md_path}")
    print(f"Entries checked: {len(reports)} (table rows: {len(table_rows)})")
    print(f"FOUND_EXACT: {counts['FOUND_EXACT']}")
    print(f"FOUND_OCR_GLYPH: {counts['FOUND_OCR_GLYPH']}")
    print(f"VERIFIED_BY_IMAGE: {counts['VERIFIED_BY_IMAGE']}")
    print(f"UNLISTED_MARKED (supplement): {counts['UNLISTED_MARKED']}")
    print(f"NOT_FOUND (table): {counts['NOT_FOUND_TABLE']}")
    print(f"NOT_FOUND (book): {counts['NOT_FOUND_BOOK']}")
    print(f"NOT_FOUND (supplement): {counts['NOT_FOUND_SUPPLEMENT']}")
    print("-" * 105)
    for er in reports:
        if not er.tokens:
            p_rng = f"{er.cited_pdf_pages[0]}..{er.cited_pdf_pages[-1]}" if er.cited_pdf_pages else "-"
            print(f"{er.entry_id} | (数値なし) | cited PDF: {p_rng}")
            continue
        for tr in er.tokens:
            pages_str = (
                f"PDF p.{tr.found_pages[:6]}" + ("..." if len(tr.found_pages) > 6 else "")
                if tr.found_pages
                else "-"
            )
            print(f"{er.entry_id} | {tr.section:10s} | {tr.token:16s} | {tr.status:15s} | {pages_str}")

    if args.out:
        out_data = {
            "dictionary": str(md_path.name),
            "entries_checked": len(reports),
            "table_rows_checked": len(table_rows),
            "summary": counts,
            "entries": [
                {
                    "id": er.entry_id,
                    "title": er.title,
                    "cited_pdf_pages": [er.cited_pdf_pages[0], er.cited_pdf_pages[-1]] if er.cited_pdf_pages else [],
                    "tokens": [
                        {
                            "token": tr.token,
                            "section": tr.section,
                            "status": tr.status,
                            "found_pdf_pages": tr.found_pages[:10],
                            "marked_unlisted": tr.marked_unlisted,
                        }
                        for tr in er.tokens
                    ],
                }
                for er in reports
            ],
        }
        pathlib.Path(args.out).write_text(json.dumps(out_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    total_not_found = (
        counts["NOT_FOUND_TABLE"] + counts["NOT_FOUND_BOOK"] + counts["NOT_FOUND_SUPPLEMENT"]
    )
    if args.strict and total_not_found > 0:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
