import json
import sqlite3
from pathlib import Path

REPO = Path(r"E:\iketeru-eizou")
SQLITE_DB = Path(r"E:\iketeru-creative-studio\data\iketeru_knowledge.db")

prov_ids = {str(x["id"]) for x in json.loads((REPO / "analysis" / "provisional_unwatched_list.json").read_text(encoding="utf-8"))["items"]}
log_rep = json.loads((REPO / "analysis" / "visual_log_verification.json").read_text(encoding="utf-8"))
log_verified_ids = {str(x) for x in log_rep["log_verified_ids"]}
unverifiable_ids = {str(x) for x in log_rep["unverifiable_no_log_self_true_ids"]}
invalidated_ids = {str(x["video_id"]) for x in json.loads((REPO / "analysis" / "visual_redo_queue.json").read_text(encoding="utf-8"))}

con = sqlite3.connect(str(SQLITE_DB))
rows = con.execute("SELECT id, ai_analysis, score_breakdown_json FROM videos").fetchall()
updated = 0
counts = {"provisional": 0, "log_verified": 0, "unverifiable_no_log": 0, "invalidated_no_visual": 0}

for vid, ana, raw_bd in rows:
    vid = str(vid)
    ana = ana or ""
    try:
        bd = json.loads(raw_bd) if raw_bd else {}
    except Exception:
        bd = {}
    is_prov = (
        vid in prov_ids
        or "一次評価" in ana
        or "暫定評価" in ana
        or "未視聴" in ana
        or "簡易分析済(要完全版)" in ana
        or bd.get("analysisVerdict") == "needs_full_analysis"
        or bd.get("analysisStatus") == "provisional"
    )
    changed = False
    if is_prov:
        bd["analysisStatus"] = "provisional"
        bd["isProvisional"] = True
        counts["provisional"] += 1
        changed = True
    elif bd.get("analysisStatus") != "verified":
        bd["analysisStatus"] = "verified"
        bd["isProvisional"] = False
        changed = True

    if vid in invalidated_ids:
        bd["visualVerificationStatus"] = "invalidated_no_visual"
        counts["invalidated_no_visual"] += 1
        changed = True
    elif vid in log_verified_ids:
        bd["visualVerificationStatus"] = "log_verified"
        counts["log_verified"] += 1
        changed = True
    elif vid in unverifiable_ids:
        bd["visualVerificationStatus"] = "unverifiable_no_log"
        counts["unverifiable_no_log"] += 1
        changed = True

    if changed:
        con.execute("UPDATE videos SET score_breakdown_json = ? WHERE id = ?", (json.dumps(bd, ensure_ascii=False), vid))
        updated += 1

con.commit()
con.close()
print(json.dumps({"sqliteUpdated": updated, "counts": counts}, ensure_ascii=False, indent=2))
