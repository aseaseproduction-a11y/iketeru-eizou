import json
import os
import random
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, r"E:\iketeru-eizou\scripts")
from blind_redact import find_rating_leaks, redact_for_blind_scoring

REPO = Path(r"E:\iketeru-eizou")
env = dict(os.environ)
env["PATH"] = r"C:\Program Files\nodejs;" + env.get("PATH", "")

subprocess.run(["node", "scripts/export-tidb-bodies.mjs"], cwd=str(REPO), env=env, check=True)
rows = json.loads((REPO / "analysis" / "_tidb_all_bodies.json").read_text(encoding="utf-8"))
(REPO / "analysis" / "_tidb_all_bodies.json").unlink(missing_ok=True)

total = len(rows)
non_empty_rows = [r for r in rows if (r.get("analysis") or "").strip()]
leaked = []
redacted_map = {}

for r in rows:
    ana = r.get("analysis") or ""
    excerpt = redact_for_blind_scoring(ana, max_chars=2200)
    redacted_map[r["id"]] = excerpt
    hits = find_rating_leaks(excerpt)
    if hits:
        leaked.append({"id": r["id"], "hits": hits})

# Also check the 3 specific examples flagged by External Review #13
flagged_ids = ["9qkpcLK422o", "h3RVeVOkR-I", "__sbOxfr6Nc", "1119375393", "1046889896"]
flagged_check = {}
for fid in flagged_ids:
    ex = redacted_map.get(fid, "")
    flagged_check[fid] = {
        "leaks": find_rating_leaks(ex),
        "snippet": ex[:260].replace("\n", " "),
    }

# Pick 20 random non-empty excerpts (fixed seed for reproducibility) with context around [既存評価非表示]
rng = random.Random(20261122)
sample_rows = rng.sample(non_empty_rows, min(20, len(non_empty_rows)))
random_20 = []
for r in sample_rows:
    ex = redacted_map[r["id"]]
    idx = ex.find("[既存評価非表示]")
    if idx != -1:
        ctx = ex[max(0, idx - 35) : min(len(ex), idx + 65)].replace("\n", " ")
    else:
        ctx = ex[:120].replace("\n", " ")
    random_20.append({
        "id": r["id"],
        "db_rating": r.get("rating", ""),
        "leaks_count": len(find_rating_leaks(ex)),
        "redacted_context": ctx,
    })

report = {
    "total_tidb_videos": total,
    "non_empty_analysis_videos": len(non_empty_rows),
    "leaked_excerpts_count": len(leaked),
    "leaked_samples": leaked[:10],
    "flagged_examples_check": flagged_check,
    "random_20_excerpts": random_20,
}

(REPO / "analysis" / "blind_redaction_verification_5653.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(json.dumps({
    "total_tidb_videos": total,
    "non_empty_analysis_videos": len(non_empty_rows),
    "leaked_excerpts_count": len(leaked),
    "leaked_samples": leaked[:5],
    "flagged_examples_check": flagged_check,
}, ensure_ascii=False, indent=2))
