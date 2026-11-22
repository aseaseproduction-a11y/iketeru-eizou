import hashlib
import json
import os
import re
import sqlite3
import subprocess
from pathlib import Path

REPO = Path(r"E:\iketeru-eizou")
SQLITE_DB = Path(r"E:\iketeru-creative-studio\data\iketeru_knowledge.db")
PILOT_IDS_DOC = json.loads((REPO / "analysis" / "_wave43_pilot_20_ids.json").read_text(encoding="utf-8"))
ALL_20 = PILOT_IDS_DOC["all_20_ids"]
SET_537 = set(PILOT_IDS_DOC["from_reaudit_537_10"])

AUDIT_CH11_RE = re.compile(r"## 11\. 実映像ビジュアル監査・実測補正[\s\S]*?(?=\r?\n## |\Z)")

# Latest progress record per video_id
prog_by_id = {}
for line in (REPO / "analysis" / "full_audit_progress.jsonl").read_text(encoding="utf-8").splitlines():
    if line.strip():
        o = json.loads(line)
        if o.get("video_id"):
            prog_by_id[str(o["video_id"])] = o

log_rep = json.loads((REPO / "analysis" / "visual_log_verification.json").read_text(encoding="utf-8"))
log_verified_set = set(log_rep.get("log_verified_ids") or [])

env = dict(os.environ)
env["PATH"] = r"C:\Program Files\nodejs;" + env.get("PATH", "")

# Fetch TiDB rows for the 20 pilot IDs
node_code = (
    "const fs=require('fs'), mysql=require('mysql2/promise');"
    "(async()=>{"
    "const u=fs.readFileSync('.env','utf8').replace(/^\\uFEFF/,'').match(/^DATABASE_URL=(.+)$/m)[1].trim();"
    "const ids=JSON.parse(process.argv[1]);"
    "const c=await mysql.createConnection({uri:u,ssl:{minVersion:'TLSv1.2',rejectUnauthorized:true}});"
    "const [rows]=await c.query('SELECT id, title, aiOverallRating, aiDirectionRating, aiTechniqueRating, aiOverallScore, aiDirectionScore, aiTechniqueScore, aiScoreBreakdown, aiAnalysis FROM videos WHERE id IN (?)',[ids]);"
    "await c.end();"
    "process.stdout.write(JSON.stringify(rows));"
    "})().catch(e=>{console.error(e);process.exit(1);});"
)
tidb_rows = {
    str(r["id"]): r
    for r in json.loads(
        subprocess.check_output(["node", "-e", node_code, json.dumps(ALL_20)], cwd=str(REPO), env=env, text=True, encoding="utf-8")
    )
}

con = sqlite3.connect(str(SQLITE_DB))
con.row_factory = sqlite3.Row
sq_rows = {
    str(r["id"]): dict(r)
    for r in con.execute(
        f"SELECT id, overall_rating, direction_rating, technique_rating, overall_score_100, direction_score_100, technique_score_100, score_breakdown_json, ai_analysis FROM videos WHERE id IN ({','.join(['?']*len(ALL_20))})",
        ALL_20,
    ).fetchall()
}
con.close()

items = []
for vid in ALL_20:
    tr = tidb_rows.get(vid, {})
    sr = sq_rows.get(vid, {})
    pr = prog_by_id.get(vid, {})
    bd = json.loads(tr.get("aiScoreBreakdown") or "{}") if isinstance(tr.get("aiScoreBreakdown"), str) else (tr.get("aiScoreBreakdown") or {})

    t_ana = tr.get("aiAnalysis") or ""
    s_ana = sr.get("ai_analysis") or ""
    t_hash = hashlib.sha256(t_ana.encode("utf-8")).hexdigest()
    s_hash = hashlib.sha256(s_ana.encode("utf-8")).hexdigest()
    m_ch11 = AUDIT_CH11_RE.search(t_ana)

    items.append({
        "video_id": vid,
        "group": "reaudit_537" if vid in SET_537 else "normal_unaudited",
        "title": tr.get("title", ""),
        "ensemble_mode": bd.get("ensembleMode") or pr.get("ensemble_mode"),
        "ensemble_runs": bd.get("ensembleRuns") or [],
        "final_scores": f"{tr.get('aiOverallScore')}/{tr.get('aiDirectionScore')}/{tr.get('aiTechniqueScore')}",
        "final_ratings": f"{tr.get('aiOverallRating')}/{tr.get('aiDirectionRating')}/{tr.get('aiTechniqueRating')}",
        "grade_boundary": bool(bd.get("gradeBoundary")),
        "analysis_status": bd.get("analysisStatus"),
        "visual_verification_status": bd.get("visualVerificationStatus"),
        "log_verified_in_report": vid in log_verified_set,
        "worker_conversation_ids": bd.get("workerConversationIds") or pr.get("worker_conversation_ids") or [],
        "ch11_appended": m_ch11.group(0).strip() if m_ch11 else "",
        "tidb_analysis_sha256": t_hash,
        "sqlite_analysis_sha256": s_hash,
        "sqlite_exists": bool(sr),
        "sqlite_body_hash_matched": bool(sr) and (t_hash == s_hash),
    })

report = {
    "pilot_wave": 43,
    "target_count": len(ALL_20),
    "audited_in_pilot_count": sum(1 for x in items if x["ensemble_runs"]),
    "log_verified_count": sum(1 for x in items if x["visual_verification_status"] == "log_verified"),
    "two_run_mean_count": sum(1 for x in items if x["ensemble_mode"] == "2_run_mean"),
    "three_run_median_count": sum(1 for x in items if x["ensemble_mode"] == "3_run_median"),
    "sqlite_body_hash_matched_count": sum(1 for x in items if x["sqlite_body_hash_matched"]),
    "items": items,
}

out_path = REPO / "analysis" / "wave43_pilot_20_report.json"
out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({k: v for k, v in report.items() if k != "items"}, ensure_ascii=False, indent=2))
