import json
import os
import random
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, r"E:\iketeru-eizou\scripts")
from blind_redact import find_rating_leaks, redact_for_blind_scoring, strip_audit_ch11

REPO = Path(r"E:\iketeru-eizou")
env = dict(os.environ)
env["PATH"] = r"C:\Program Files\nodejs;" + env.get("PATH", "")

subprocess.run(["node", "scripts/export-tidb-bodies.mjs"], cwd=str(REPO), env=env, check=True)
rows = json.loads((REPO / "analysis" / "_tidb_all_bodies.json").read_text(encoding="utf-8"))
(REPO / "analysis" / "_tidb_all_bodies.json").unlink(missing_ok=True)

PLUS_MINUS_RE = re.compile(r"(?<![A-Za-z0-9])[SABCD][+-](?![A-Za-z0-9+-])")
MELO_RE = re.compile(r"(?<![A-Za-z0-9])[AB]メロ")

total = len(rows)
non_empty_rows = [r for r in rows if (r.get("analysis") or "").strip()]
leaked = []
plus_minus_remaining = []
melo_overredacted = []
redacted_map = {}

for r in rows:
    ana = r.get("analysis") or ""
    raw_head = strip_audit_ch11(ana)[:2200]
    excerpt = redact_for_blind_scoring(ana, max_chars=2200)
    redacted_map[r["id"]] = excerpt

    hits = find_rating_leaks(excerpt)
    if hits:
        leaked.append({"id": r["id"], "hits": hits})

    if PLUS_MINUS_RE.search(excerpt):
        plus_minus_remaining.append(r["id"])

    # Check if Aメロ/Bメロ was over-redacted into [既存評価非表示]メロ
    if "[既存評価非表示]メロ" in excerpt or "[既存評価非表示]サビ" in excerpt:
        melo_overredacted.append({"id": r["id"]})

flagged_ids = ["_jWNIcbt-ac", "_ZBz2CPRyJA", "1ST54X7sotc", "92IAMsrCloQ", "4sr8LDdc-uA", "qROogTC60pI", "BHCOvooEdy8", "eFxxe7YIH-k", "UNEW2GulsrE", "XZOOP9QUvas"]
flagged_check = {}
for fid in flagged_ids:
    ex = redacted_map.get(fid, "")
    flagged_check[fid] = {
        "leaks": find_rating_leaks(ex),
        "has_plus_minus": bool(PLUS_MINUS_RE.search(ex)),
        "has_melo": MELO_RE.findall(ex),
        "snippet": ex[:240].replace("\n", " "),
    }

report = {
    "total_tidb_videos": total,
    "non_empty_analysis_videos": len(non_empty_rows),
    "leaked_excerpts_count": len(leaked),
    "plus_minus_grade_remaining_count": len(plus_minus_remaining),
    "melo_overredacted_count": len(melo_overredacted),
    "leaked_samples": leaked[:10],
    "melo_overredacted_samples": melo_overredacted[:10],
    "flagged_examples_check": flagged_check,
}

(REPO / "analysis" / "blind_redaction_verification_5653.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(json.dumps({
    "total_tidb_videos": total,
    "non_empty_analysis_videos": len(non_empty_rows),
    "leaked_excerpts_count": len(leaked),
    "plus_minus_grade_remaining_count": len(plus_minus_remaining),
    "melo_overredacted_count": len(melo_overredacted),
    "melo_overredacted_samples": melo_overredacted[:5],
    "flagged_examples_check": flagged_check,
}, ensure_ascii=False, indent=2))
