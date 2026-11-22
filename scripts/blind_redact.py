"""Shared blind-scoring redaction and fail-closed leak assertion.

Used identically by both production `goal_visual_audit_workflow.py` and
`reproducibility_blind_workflow.py` so no existing grade or numeric score
can leak into blind evaluation prompts.
"""
from __future__ import annotations

import re

AUDIT_CH11_RE = re.compile(r"(?:\r?\n)*## 11\. 実映像ビジュアル監査・実測補正[\s\S]*?(?=\r?\n## |\Z)")

# Order matters: strip broadest structured patterns first, then inline patterns.
_REDACT_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # Markdown bold/backtick score lines e.g. **総合評価** `スコア: S` or `スコア: A+`
    (re.compile(r"`[^`\n]*スコア\s*[:：=＝][^`\n]*`"), "[既存評価非表示]"),
    (re.compile(r"(?:総合|演出|ディレクション|技術|AI)?(?:評価|ランク|スコア)\s*[:：=＝]\s*[`「『（(\[]*\s*[SABCD][+-]?(?:\s*[（(][^）)\n]{0,20}[）)])?\s*[`」』）)\]]*"), "[既存評価非表示]"),
    # 総合/演出/技術 = 90/90/86 or S/A+/A
    (re.compile(r"(?:総合|演出|技術)(?:/(?:総合|演出|技術)){1,2}\s*[=:：＝]\s*[`「『]?\s*[SABCD0-9+/\-]+\s*[`」』]?"), "[既存評価非表示]"),
    # Explicit grade + suffix: S+ランク, A-評価, B+帯, S級, A+水準, S-クラス, Sランク相当
    (re.compile(r"[`「『（(\[]?[SABCD][+-]?[`」』）)\]]?\s*(?:ランク|評価|帯|水準|級|クラス)(?:相当|上位|中位|下位|上限|下限)?"), "[既存評価非表示]"),
    # Backticked standalone grade letter e.g. `S+`, `A-`, `B+`
    (re.compile(r"`\s*[SABCD][+-]?\s*`"), "[既存評価非表示]"),
    # Standalone score patterns: 100点満点中85点, 85/100点, 85点, 20点満点, 18/20点
    (re.compile(r"\d{1,3}\s*点満点(?:中\s*\d{1,3}\s*点)?"), "[点数非表示]"),
    (re.compile(r"\d{1,3}\s*/\s*(?:100|20)\s*点?"), "[点数非表示]"),
    (re.compile(r"(?<![A-Za-z0-9])\d{1,3}(?:\.\d+)?\s*点(?![A-Za-z0-9])"), "[点数非表示]"),
    # Any remaining "スコア:" / "スコア：" followed by anything on the phrase
    (re.compile(r"スコア\s*[:：=＝]\s*[^\s、。,）)\]`\n]+"), "[既存評価非表示]"),
    (re.compile(r"スコア\s*[:：=＝]"), "[既存評価非表示]"),
    # Parenthesized standalone grade e.g. （S+）, (A-), 【B+】, 「S-」
    (re.compile(r"[（(【「『\[]\s*[SABCD][+-]\s*[）)】」』\]]"), "[既存評価非表示]"),
    # Grade arrow transitions e.g. A+ → S, B+ -> A-
    (re.compile(r"(?<![A-Za-z0-9])[SABCD][+-]?\s*(?:→|->|⇒)\s*[SABCD][+-]?(?![A-Za-z0-9])"), "[既存評価非表示]"),
]

# Fail-closed leak detectors (if ANY of these matches the final excerpt, abort before sending!)
_LEAK_DETECTORS: list[tuple[str, re.Pattern[str]]] = [
    ("score_colon", re.compile(r"スコア\s*[:：=＝]")),
    ("labeled_grade", re.compile(r"(?:総合|演出|ディレクション|技術|AI)?(?:評価|ランク)\s*[:：=＝]\s*[`「『（(\[]?[SABCD][+-]?")),
    ("grade_suffix", re.compile(r"[SABCD][+-]?\s*(?:ランク|評価|帯|水準|級|クラス)")),
    ("backtick_grade", re.compile(r"`\s*[SABCD][+-]?\s*`")),
    ("numeric_points", re.compile(r"(?<![A-Za-z0-9])\d{1,3}\s*点(?![A-Za-z0-9])")),
    ("score_slash_100", re.compile(r"\d{1,3}\s*/\s*100")),
]


def strip_audit_ch11(text: str) -> str:
    return AUDIT_CH11_RE.sub("", str(text or "")).strip()


def redact_for_blind_scoring(ai_analysis: str, max_chars: int = 2200) -> str:
    txt = strip_audit_ch11(ai_analysis)
    if not txt:
        return "(既存AI分析なし)"
    txt = txt[:max_chars]
    for pat, repl in _REDACT_PATTERNS:
        txt = pat.sub(repl, txt)
    return txt


def find_rating_leaks(excerpt: str) -> list[dict[str, str]]:
    leaks: list[dict[str, str]] = []
    for name, pat in _LEAK_DETECTORS:
        m = pat.search(excerpt)
        if m:
            leaks.append({"detector": name, "match": m.group(0)})
    return leaks


def assert_no_rating_leak(excerpt: str, video_id: str = "") -> None:
    leaks = find_rating_leaks(excerpt)
    if leaks:
        raise ValueError(f"BLIND_LEAK_DETECTED [{video_id}]: {leaks}")
