"""Shared blind-scoring redaction and independent broad leak detector (v3).

Used identically by production `goal_visual_audit_workflow.py`,
`reproducibility_blind_workflow.py`, and `retest_2plus1_independent.py`.
"""
from __future__ import annotations

import re

AUDIT_CH11_RE = re.compile(r"(?:\r?\n)*## 11\. 実映像ビジュアル監査・実測補正[\s\S]*?(?=\r?\n## |\Z)")

# Grade token with optional markdown bold/backtick/bracket wrappers: e.g. **A+**, `S`, （B+）, A-
_G = r"(?:\*\*|\*|`|[「『（(\[【])*\s*[SABCD][+-]?\s*(?:\*\*|\*|`|[」』）)\]】])*"

# Musical structure terms that must NEVER be redacted (e.g. Aメロ, Bメロ, Cメロ, Aサビ, Bサビ)
_PROTECT_MUSIC_RE = re.compile(r"(?<![A-Za-z0-9])([ABC])(メロ|サビ)")

# 1. Whole-line removals for rating/verdict summary lines
_REMOVE_LINE_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"^.*評価判定.*$", re.MULTILINE),
    re.compile(r"^.*ランク決定理由.*$", re.MULTILINE),
    re.compile(r"^\s*[-*•・]?\s*\*{0,2}(?:AI)?(?:総合|演出|ディレクション|技術)(?:評価|ランク|スコア)\*{0,2}\s*[:：=＝].*$", re.MULTILINE),
]

# 2. Inline redaction patterns
_REDACT_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # Unconditional +/- grade tokens anywhere (S+, S-, A+, A-, B+, B-, C+, C-, D+, D-), excluding C++ and A-1 / S-Log
    (re.compile(r"(?<![A-Za-z0-9])[SABCD][+-](?![A-Za-z0-9+-])"), "[既存評価非表示]"),
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
    # Bare grade followed by verdict/quality phrasing: A作品, Bが妥当, Sに相応しい, Aの到達点, Bとした, A品質, Sに値
    (re.compile(r"(?<![A-Za-z0-9])" + _G + r"(?=\s*(?:と判定|と評価|とした|とする|とみなす|相当|ランク|評価|帯|水準|級|クラス|作品|品質|に値|が妥当|に相応しい|の到達点|の傑作|の秀作|の佳作|の記念碑|の金字塔|の極致|の頂点|の領域|の出来|の完成度))"), "[既存評価非表示]"),
    # Chained grades separated by ・ / ／ / / / 、 near [既存評価非表示]
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
    # Sentence-ending standalone grade after ため / で / 。: e.g. "欠けるためB。" / "±0でB。" / "限定的。B。"
    (re.compile(r"((?:ため|で|。)\s*)[SABCD](?=\s*[。\n]|$)"), r"\1[既存評価非表示]"),
    # Grade transitions: A+ → S, B+ -> A-
    (re.compile(r"(?<![A-Za-z0-9])[SABCD][+-]?\s*(?:→|->|⇒)\s*[SABCD][+-]?(?![A-Za-z0-9])"), "[既存評価非表示]"),
]

# 3. INDEPENDENT broad leak detector (decoupled from redaction patterns!)
_EVAL_CONTEXT_RE = re.compile(r"(?:総合|演出|ディレクション|技術|評価|ランク|判定|スコア|格付|水準)")
_PLUS_MINUS_GRADE_RE = re.compile(r"(?<![A-Za-z0-9])[SABCD][+-](?![A-Za-z0-9+-])")
_STANDALONE_GRADE_RE = re.compile(r"(?<![A-Za-z0-9])[SABCD][+-]?(?![A-Za-z0-9])")
_BARE_GRADE_QUALITY_RE = re.compile(
    r"(?<![A-Za-z0-9])[SABCD](?=\s*(?:作品|品質|とした|に値|が妥当|に相応しい|の到達点|と判定|と評価))"
)
# Allowlisted non-grade Japanese/English expressions where single-letter A/B/C/D/S is clearly NOT a rating
_NON_GRADE_SUFFIX_RE = re.compile(
    r"^(?:メロ|サビ|パート|案|面|ロール|カメ|カメラ|カット|チーム|ライン|パターン|タイプ|グループ|ブロック|シーン|フレーム|サイズ|級ではない|社|氏|さん|駅|館|棟|街|区|道|線|番|号|盤|側|端|軸|方向|地点|空間|世界|物語|視点|構成|形式|方式|テスト|比較|検証|構造|設計|表現|技法|系|字|型|列|群|層|段|部|編|章|節|項|版|種|類|曲|音|調|波|光|色|像|画|図|表|欄|枠|帯域|領域|区間|範囲|要素|成分|値|率|比|差|和|積|商|対|vs|VS|or|OR|and|AND)"
)
_ENGLISH_ARTICLE_A_RE = re.compile(r"^\s+[a-z]")

_HARD_LEAK_DETECTORS: list[tuple[str, re.Pattern[str]]] = [
    ("eval_verdict_word", re.compile(r"評価判定")),
    ("rank_reason_word", re.compile(r"ランク決定理由")),
    ("score_colon", re.compile(r"スコア\s*[:：=＝]")),
    ("numeric_points", re.compile(r"(?<![A-Za-z0-9])\d{1,3}\s*点(?![A-Za-z0-9])")),
    ("score_slash_100", re.compile(r"\d{1,3}\s*/\s*100")),
    ("plus_minus_grade_anywhere", _PLUS_MINUS_GRADE_RE),
    ("bare_grade_quality_phrase", _BARE_GRADE_QUALITY_RE),
    ("sentence_end_standalone_grade", re.compile(r"(?:ため|で|。)\s*[SABCD](?=\s*[。\n]|$)")),
]


def strip_audit_ch11(text: str) -> str:
    return AUDIT_CH11_RE.sub("", str(text or "")).strip()


def redact_for_blind_scoring(ai_analysis: str, max_chars: int = 2200) -> str:
    txt = strip_audit_ch11(ai_analysis)
    if not txt:
        return "(既存AI分析なし)"
    for lpat in _REMOVE_LINE_PATTERNS:
        txt = lpat.sub("", txt)
    txt = re.sub(r"\n{3,}", "\n\n", txt).strip()
    txt = txt[:max_chars]

    # Protect Aメロ / Bメロ / Cメロ / Aサビ / Bサビ from accidental redaction AFTER truncation
    txt = _PROTECT_MUSIC_RE.sub(lambda m: f"__KEEP_MUSIC_{m.group(1)}_{m.group(2)}__", txt)

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

    txt = _mask_residual(txt)
    txt = _mask_residual(txt)

    # Restore protected musical terms (Aメロ, Bメロ, Cメロ, Aサビ, Bサビ)
    txt = re.sub(r"__KEEP_MUSIC_([ABC])_(メロ|サビ)__", r"\1\2", txt)
    return txt


def find_rating_leaks(excerpt: str) -> list[dict[str, str]]:
    """Independent broad detector: flags +/- grades anywhere, quality-phrase bare grades, hard patterns, or proximity grades."""
    leaks: list[dict[str, str]] = []
    for name, pat in _HARD_LEAK_DETECTORS:
        m = pat.search(excerpt)
        if m:
            leaks.append({"detector": name, "match": m.group(0), "context": excerpt[max(0, m.start() - 20) : m.end() + 20].replace("\n", " ")})

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
