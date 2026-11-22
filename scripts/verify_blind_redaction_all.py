import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, r"E:\iketeru-eizou\scripts")
from blind_redact import find_rating_leaks, redact_for_blind_scoring

REPO = Path(r"E:\iketeru-eizou")
env = dict(os.environ)
env["PATH"] = r"C:\Program Files\nodejs;" + env.get("PATH", "")

# Export all TiDB aiAnalysis texts cleanly
subprocess.run(["node", "scripts/export-tidb-bodies.mjs"], cwd=str(REPO), env=env, check=True)
rows = json.loads((REPO / "analysis" / "_tidb_all_bodies.json").read_text(encoding="utf-8"))
(REPO / "analysis" / "_tidb_all_bodies.json").unlink(missing_ok=True)

total = len(rows)
non_empty = 0
leaked = []

for r in rows:
    ana = r.get("analysis") or ""
    if ana.strip():
        non_empty += 1
    excerpt = redact_for_blind_scoring(ana, max_chars=2200)
    hits = find_rating_leaks(excerpt)
    if hits:
        leaked.append({"id": r["id"], "hits": hits})

print(json.dumps({
    "total_tidb_videos": total,
    "non_empty_analysis_videos": non_empty,
    "leaked_excerpts_count": len(leaked),
    "leaked_samples": leaked[:10],
}, ensure_ascii=False, indent=2))
