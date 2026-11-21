import json
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(r"E:\iketeru-eizou")
SQLITE_DB = Path(r"E:\iketeru-creative-studio\data\iketeru_knowledge.db")

RATING_ORDER = ["S+", "S", "S-", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-"]
rank_int = lambda g: (len(RATING_ORDER) - RATING_ORDER.index(g)) if g in RATING_ORDER else 0

ids_arg = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--ids=")), "")
ids = [x.strip() for x in ids_arg.split(",") if x.strip()]
if not ids:
    print(json.dumps({"ok": True, "mirrored": 0}))
    sys.exit(0)

# Fetch finalized rows from TiDB Cloud (including ratings, scores, aiScoreBreakdown, and aiAnalysis with ## 11.)
node_code = (
    "const fs=require('fs'), mysql=require('mysql2/promise');"
    "(async()=>{"
    "const u=process.env.DATABASE_URL || fs.readFileSync('.env','utf8').replace(/^\\uFEFF/,'').match(/^DATABASE_URL=(.+)$/m)[1].trim();"
    "const ids=JSON.parse(process.argv[1]);"
    "const c=await mysql.createConnection({uri:u,ssl:{minVersion:'TLSv1.2',rejectUnauthorized:true}});"
    "const [rows]=await c.query('SELECT id, aiOverallRating, aiDirectionRating, aiTechniqueRating, aiOverallScore, aiDirectionScore, aiTechniqueScore, aiScoreBreakdown, aiAnalysis FROM videos WHERE id IN (?)',[ids]);"
    "await c.end();"
    "process.stdout.write(JSON.stringify(rows));"
    "})().catch(e=>{console.error(e);process.exit(1);});"
)

import os
env = dict(os.environ)
env["PATH"] = r"C:\Program Files\nodejs;" + env.get("PATH", "")
proc = subprocess.run(
    ["node", "-e", node_code, json.dumps(ids)],
    cwd=str(REPO_ROOT),
    env=env,
    capture_output=True,
    text=True,
    encoding="utf-8",
    errors="replace",
    timeout=60.0,
)
if proc.returncode != 0:
    raise RuntimeError(f"TiDB mirror fetch failed: {proc.stderr}")

rows = json.loads(proc.stdout)
con = sqlite3.connect(str(SQLITE_DB), timeout=30.0)
con.execute("PRAGMA busy_timeout=30000")
mirrored = 0
for r in rows:
    vid = str(r["id"])
    o_r = r.get("aiOverallRating") or ""
    d_r = r.get("aiDirectionRating") or ""
    t_r = r.get("aiTechniqueRating") or ""
    bd_raw = r.get("aiScoreBreakdown")
    bd_str = bd_raw if isinstance(bd_raw, str) else (json.dumps(bd_raw, ensure_ascii=False) if bd_raw is not None else None)
    con.execute(
        """
        UPDATE videos
           SET overall_rating = ?,
               direction_rating = ?,
               technique_rating = ?,
               overall_score = ?,
               direction_score = ?,
               technique_score = ?,
               overall_score_100 = ?,
               direction_score_100 = ?,
               technique_score_100 = ?,
               score_breakdown_json = ?,
               ai_analysis = ?
         WHERE id = ?
        """,
        (
            o_r,
            d_r,
            t_r,
            rank_int(o_r),
            rank_int(d_r),
            rank_int(t_r),
            r.get("aiOverallScore"),
            r.get("aiDirectionScore"),
            r.get("aiTechniqueScore"),
            bd_str,
            r.get("aiAnalysis") or "",
            vid,
        ),
    )
    mirrored += 1
con.commit()
con.close()
print(json.dumps({"ok": True, "requested": len(ids), "mirrored": mirrored}))
