import json
import re
import sqlite3
import sys
from pathlib import Path

REPO = Path(r"E:\iketeru-eizou")
SQLITE_DB = Path(r"E:\iketeru-creative-studio\data\iketeru_knowledge.db")
INITIAL_MIGRATION = "--initial-migration" in sys.argv
ALIGN_UNAUDITED = "--align-unaudited" in sys.argv

RATING_ORDER = ["S+", "S", "S-", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-"]
rank_int = lambda g: (len(RATING_ORDER) - RATING_ORDER.index(g)) if g in RATING_ORDER else 0
ch11_re = re.compile(r"(?:\r?\n)*## 11\.[\s\S]*$")

prov_ids = {str(x["id"]) for x in json.loads((REPO / "analysis" / "provisional_unwatched_list.json").read_text(encoding="utf-8"))["items"]}
log_rep = json.loads((REPO / "analysis" / "visual_log_verification.json").read_text(encoding="utf-8"))
log_verified_ids = {str(x) for x in log_rep["log_verified_ids"]}
unverifiable_ids = {str(x) for x in log_rep["unverifiable_no_log_self_true_ids"]}
invalidated_ids = {str(x["video_id"]) for x in json.loads((REPO / "analysis" / "visual_redo_queue.json").read_text(encoding="utf-8"))}

con = sqlite3.connect(str(SQLITE_DB))
rows = con.execute("SELECT id, overall_rating, direction_rating, technique_rating, ai_analysis, score_breakdown_json FROM videos").fetchall()
updated = 0

for vid, cur_o, cur_d, cur_t, cur_ana, raw_bd in rows:
    vid = str(vid)
    try:
        bd = json.loads(raw_bd) if raw_bd else {}
    except Exception:
        bd = {}
    before = json.dumps(bd, ensure_ascii=False)

    is_latest_reanalysis = bd.get("source") == "rubric_unclamped"
    is_needs_full = bd.get("analysisVerdict") == "needs_full_analysis"

    if is_latest_reanalysis:
        bd["analysisStatus"] = "provisional" if is_needs_full else "full_analysis"
        bd["isProvisional"] = bd["analysisStatus"] == "provisional"
    elif INITIAL_MIGRATION or not bd.get("analysisStatus") or bd.get("analysisStatus") == "verified":
        if vid in prov_ids or is_needs_full:
            bd["analysisStatus"] = "provisional"
            bd["isProvisional"] = True
        else:
            bd["analysisStatus"] = "full_analysis"
            bd["isProvisional"] = False

    is_invalidated = (vid in invalidated_ids) or (bd.get("visualVerificationStatus") == "invalidated_no_visual")
    if is_invalidated:
        bd["visualVerificationStatus"] = "invalidated_no_visual"
        bd["invalidatedNoVisual"] = True
        bd["visualChecked"] = False
    elif vid in log_verified_ids:
        bd["visualVerificationStatus"] = "log_verified"
        bd.pop("invalidatedNoVisual", None)
    elif bd.get("visualVerificationStatus") != "log_verified":
        if is_latest_reanalysis and bd.get("visualChecked") is True:
            if not bd.get("visualVerificationStatus"):
                bd["visualVerificationStatus"] = "unverified_pending"
        elif INITIAL_MIGRATION or not bd.get("visualVerificationStatus"):
            if vid in unverifiable_ids:
                bd["visualVerificationStatus"] = "unverifiable_no_log"
            elif ALIGN_UNAUDITED:
                bd["visualVerificationStatus"] = "not_audited"

    after = json.dumps(bd, ensure_ascii=False)
    if is_invalidated:
        next_o = bd.get("previousOverallRating") or cur_o or ""
        next_d = bd.get("previousDirectionRating") or cur_d or ""
        next_t = bd.get("previousTechniqueRating") or cur_t or ""
        next_ana = ch11_re.sub("", cur_ana or "").rstrip()
        con.execute(
            "UPDATE videos SET overall_rating=?, direction_rating=?, technique_rating=?, "
            "overall_score=?, direction_score=?, technique_score=?, "
            "overall_score_100=NULL, direction_score_100=NULL, technique_score_100=NULL, "
            "ai_analysis=?, score_breakdown_json=? WHERE id=?",
            (next_o, next_d, next_t, rank_int(next_o), rank_int(next_d), rank_int(next_t), next_ana, after, vid),
        )
        updated += 1
    elif after != before:
        con.execute("UPDATE videos SET score_breakdown_json = ? WHERE id = ?", (after, vid))
        updated += 1

con.commit()

verify = con.execute("""
SELECT
  COUNT(*) AS totalVideos,
  SUM(CASE WHEN json_extract(score_breakdown_json, '$.analysisStatus') = 'provisional' THEN 1 ELSE 0 END) AS provisionalCount,
  SUM(CASE WHEN json_extract(score_breakdown_json, '$.analysisStatus') = 'full_analysis' THEN 1 ELSE 0 END) AS fullAnalysisCount,
  SUM(CASE WHEN json_extract(score_breakdown_json, '$.visualVerificationStatus') = 'log_verified' THEN 1 ELSE 0 END) AS logVerifiedCount,
  SUM(CASE WHEN json_extract(score_breakdown_json, '$.visualVerificationStatus') = 'unverifiable_no_log' THEN 1 ELSE 0 END) AS unverifiableNoLogCount,
  SUM(CASE WHEN json_extract(score_breakdown_json, '$.visualVerificationStatus') = 'unverified_pending' THEN 1 ELSE 0 END) AS unverifiedPendingCount,
  SUM(CASE WHEN json_extract(score_breakdown_json, '$.visualVerificationStatus') = 'invalidated_no_visual' THEN 1 ELSE 0 END) AS invalidatedNoVisualCount,
  SUM(CASE WHEN json_extract(score_breakdown_json, '$.visualVerificationStatus') = 'not_audited' THEN 1 ELSE 0 END) AS notAuditedCount,
  SUM(CASE WHEN json_extract(score_breakdown_json, '$.visualVerificationStatus') IS NULL THEN 1 ELSE 0 END) AS nullVvsCount
FROM videos
""").fetchone()
con.close()

keys = ["totalVideos", "provisionalCount", "fullAnalysisCount", "logVerifiedCount", "unverifiableNoLogCount", "unverifiedPendingCount", "invalidatedNoVisualCount", "notAuditedCount", "nullVvsCount"]
print(json.dumps({"sqliteUpdated": updated, "sqliteVerify": dict(zip(keys, verify))}, ensure_ascii=False, indent=2))
