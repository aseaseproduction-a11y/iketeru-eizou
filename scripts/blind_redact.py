"""Shared blind-scoring redaction and independent broad leak detector.

Used identically by production `goal_visual_audit_workflow.py`,
`reproducibility_blind_workflow.py`, and `retest_2plus1_independent.py`.
"""
from __future__ import annotations

import re

AUDIT_CH11_RE = re.compile(r"(?:\r?\n)*## 11\. 実映像ビジュアル監査・実測補正[\s\S]*?(?=\r?\n## |\Z)")

# Grade token with optional markdown bold/backtick/bracket wrappers: e.g. **A+**, `S`, （B+）, A-
_G = r"(?:\*\*|\*|`|[「『（(\[【])*\s*[SABCD][+-]?\s*(?:\*\*|\*|`|[」』）)\]】])*"

# 1. Whole-line removals for rating/verdict summary lines
_REMOVE_LINE_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"^.*評価判定.*$", re.MULTILINE),
    re.compile(r"^\s*[-*•・]?\s*\*{0,2}(?:AI)?(?:総合|演出|ディレクション|技術)(?:評価|ランク|スコア)\*{0,2}\s*[:：=＝].*$", re.MULTILINE),
]

# 2. Inline redaction patterns (applied iteratively so chained forms like "総合B・演出B・技術Bと評価する" are completely stripped)
_REDACT_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # Slash-separated 2-3 grade tuples: S/S/S, A/A/A-, S+/S/S-, A+/A
    (re.compile(r"(?<![A-Za-z0-9])[SABCD][+-]?\s*[／/]\s*[SABCD][+-]?(?:\s*[／/]\s*[SABCD][+-]?)?(?![A-Za-z0-9]|テスト|比較)"), "[既存評価非表示]"),
    # Comma-separated grade lists: A+, A, A- or S+, S, S-
    (re.compile(r"(?<![A-Za-z0-9])[SABCD][+-]?\s*,\s*[SABCD][+-]?(?:\s*,\s*[SABCD][+-]?)?(?![A-Za-z0-9])"), "[既存評価非表示]"),
    # Backticked score expressions: `スコア: S`, `スコア: A+`
    (re.compile(r"`[^`\n]*スコア\s*[:：=＝][^`\n]*`"), "[既存評価非表示]"),
    # "AI総合 **A+**" / "総合 **S-**" / "演出 **A+**" / "技術 **A**" / "総合B" / "技術B+" / "総合評価をB+"
    (re.compile(r"(?:AI)?(?:総合|演出|ディレクション|技術)(?:評価|ランク|スコア)?(?:は|を|が|の|[:：=＝])?\s*" + _G + r"(?![A-Za-z0-9])"), "[既存評価非表示]"),
    # "評価: A+" / "ランク: S-" / "スコア: A+"
    (re.compile(r"(?:評価|ランク|スコア)\s*[:：=＝]\s*" + _G + r"(?![A-Za-z0-9])"), "[既存評価非表示]"),
    # Grade before と判定 / と評価 / と位置づけ / 相当 / ランク / 評価 / 帯 / 水準 / 級 / クラス
    (re.compile(r"(?<![A-Za-z0-9])" + _G + r"(?=\s*(?:と判定|と評価|とする|とみなす|相当|ランク|評価|帯|水準|級|クラス))"), "[既存評価非表示]"),
    # Chained grades separated by ・ / ／ / / / 、 near 評価 or 判定: e.g. "[既存評価非表示]・B+・Aと評価"
    (re.compile(r"(\[既存評価非表示\]\s*[・／/,、]\s*)" + _G + r"(?![A-Za-z0-9])"), r"\1[既存評価非表示]"),
    # Explicit grade + suffix: S+ランク, A-評価, B+帯, S級, A+水準, Sクラス
    (re.compile(r"(?<![A-Za-z0-9])" + _G + r"(?:ランク|評価|帯|水準|級|クラス)(?:相当|上位|中位|下位|上限|下限)?"), "[既存評価非表示]"),
    # Backticked standalone grade: `S+`, `A-`, `B`
    (re.compile(r"`\s*[SABCD][+-]?\s*`"), "[既存評価非表示]"),
    # Parenthesized/bracketed standalone grade: （S+）, (A-), 【B+】, 「S-」
    (re.compile(r"[（(【「『\[]\s*\*{0,2}[SABCD][+-]?\*{0,2}\s*[）)】」』\]]"), "[既存評価非表示]"),
    # Bold standalone grade: **S+**, **A-**, **B+**
    (re.compile(r"\*\*\s*[SABCD][+-]?\s*\*\*"), "[既存評価非表示]"),
    # Numeric points / scores: 100点満点中85点, 85/100点, 85点, 18/20
    (re.compile(r"\d{1,3}\s*点満点(?:中\s*\d{1,3}\s*点)?"), "[点数非表示]"),
    (re.compile(r"\d{1,3}\s*/\s*(?:100|20)\s*点?"), "[点数非表示]"),
    (re.compile(r"(?<![A-Za-z0-9])\d{1,3}(?:\.\d+)?\s*点(?![A-Za-z0-9])"), "[点数非表示]"),
    # Any remaining スコア: ...
    (re.compile(r"スコア\s*[:：=＝]\s*[^\s、。,）)\]`\n]+"), "[既存評価非表示]"),
    (re.compile(r"スコア\s*[:：=＝]"), "[既存評価非表示]"),
    # Grade transitions: A+ → S, B+ -> A-
    (re.compile(r"(?<![A-Za-z0-9])[SABCD][+-]?\s*(?:→|->|⇒)\s*[SABCD][+-]?(?![A-Za-z0-9])"), "[既存評価非表示]"),
]

# 3. INDEPENDENT broad leak detector (decoupled from redaction patterns!)
_EVAL_CONTEXT_RE = re.compile(r"(?:総合|演出|ディレクション|技術|評価|ランク|判定|スコア|格付|水準)")
# Standalone S/A/B/C/D (with optional +/-), NOT part of an English word or alphanumeric code like 3D, 2D, C4D, B2B
_STANDALONE_GRADE_RE = re.compile(r"(?<![A-Za-z0-9])[SABCD][+-]?(?![A-Za-z0-9])")
# Allowlisted non-grade Japanese/English expressions where single-letter A/B/C/D/S is clearly NOT a rating
_NON_GRADE_SUFFIX_RE = re.compile(
    r"^(?:メロ|パート|案|面|ロール|カメ|カメラ|カット|チーム|ライン|パターン|タイプ|グループ|ブロック|シーン|フレーム|サイズ|級ではない|社|氏|さん|駅|館|棟|街|区|道|線|番|号|盤|側|端|軸|方向|地点|空間|世界|物語|視点|構成|形式|方式|テスト|比較|検証|構造|設計|表現|技法|系|字|型|列|群|層|段|部|編|章|節|項|版|種|類|曲|音|調|波|光|色|像|画|図|表|欄|枠|帯域|領域|区間|範囲|要素|成分|値|率|比|差|和|積|商|対|vs|VS|or|OR|and|AND)"
)
# Exclude single-letter English article "A " or "a " (uppercase A followed by space + lowercase word)
_ENGLISH_ARTICLE_A_RE = re.compile(r"^\s+[a-z]")

_HARD_LEAK_DETECTORS: list[tuple[str, re.Pattern[str]]] = [
    ("eval_verdict_word", re.compile(r"評価判定")),
    ("score_colon", re.compile(r"スコア\s*[:：=＝]")),
    ("numeric_points", re.compile(r"(?<![A-Za-z0-9])\d{1,3}\s*点(?![A-Za-z0-9])")),
    ("score_slash_100", re.compile(r"\d{1,3}\s*/\s*100")),
]


def strip_audit_ch11(text: str) -> str:
    return AUDIT_CH11_RE.sub("", str(text or "")).strip()


def redact_for_blind_scoring(ai_analysis: str, max_chars: int = 2200) -> str:
    txt = strip_audit_ch11(ai_analysis)
    if not txt:
        return "(既存AI分析なし)"
    # Apply line removals first so removed lines don't eat into max_chars
    for lpat in _REMOVE_LINE_PATTERNS:
        txt = lpat.sub("", txt)
    txt = re.sub(r"\n{3,}", "\n\n", txt).strip()
    txt = txt[:max_chars]
    # Run inline redaction twice to catch chained tokens
    for _ in range(2):
        for pat, repl in _REDACT_PATTERNS:
            txt = pat.sub(repl, txt)
    # Final proximity sweep: mask any remaining standalone grade token within ±34 chars of an evaluation word
    def _mask_residual(text: str) -> str:
        out = []
        last = 0
        for m in _STANDALONE_GRADE_RE.finditer(text):
            start, end = m.span()
            tok = m.group(0)
            after = text[end : end + 12]
            if tok == "A" and _ENGLISH_ARTICLE_A_RE.match(after):
                continue
            if len(tok) == 1 and _NON_GRADE_SUFFIX_RE.match(after):
                continue
            window = text[max(0, start - 34) : min(len(text), end + 34)]
            if _EVAL_CONTEXT_RE.search(window):
                out.append(text[last:start])
                out.append("[既存評価非表示]")
                last = end
        out.append(text[last:])
        return "".join(out)

    # Run twice because masking inserts "[既存評価非表示]" which itself contains "評価"
    txt = _mask_residual(txt)
    txt = _mask_residual(txt)
    return txt


def find_rating_leaks(excerpt: str) -> list[dict[str, str]]:
    """Independent broad detector: flags hard patterns OR any standalone S/A/B/C/D(+/-) within ±30 chars of eval words."""
    leaks: list[dict[str, str]] = []
    for name, pat in _HARD_LEAK_DETECTORS:
        m = pat.search(excerpt)
        if m:
            leaks.append({"detector": name, "match": m.group(0), "context": excerpt[max(0, m.start() - 20) : m.end() + 20]})

    for m in _STANDALONE_GRADE_RE.finditer(excerpt):
        start, end = m.span()
        tok = m.group(0)
        after = excerpt[end : end + 12]
        if tok == "A" and _ENGLISH_ARTICLE_A_RE.match(after):
            continue
        if len(tok) == 1 and _NON_GRADE_SUFFIX_RE.match(after):
            continue
        window = excerpt[max(0, start - 30) : min(len(excerpt), end + 30)]
        if _EVAL_CONTEXT_RE.search(window):
            leaks.append({
                "detector": "broad_proximity_grade",
                "match": tok,
                "context": window.replace("\n", " "),
            })
            break
    return leaks


def assert_no_rating_leak(excerpt: str, video_id: str = "") -> None:
    leaks = find_rating_leaks(excerpt)
    if leaks:
        raise ValueError(f"BLIND_LEAK_DETECTED [{video_id}]: {leaks}")
