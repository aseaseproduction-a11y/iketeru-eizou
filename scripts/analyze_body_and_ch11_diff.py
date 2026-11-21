import json
import re
import sqlite3
from collections import Counter
from pathlib import Path

REPO = Path(r"E:\iketeru-eizou")
SQLITE_DB = Path(r"E:\iketeru-creative-studio\data\iketeru_knowledge.db")

ch11_re = re.compile(r"(?:\r?\n)*## 11\.[\s\S]*$")
ws_re = re.compile(r"\s+")

def strip_ch11(text: str) -> str:
    return ch11_re.sub("", text or "").strip()

def norm(text: str) -> str:
    return ws_re.sub(" ", text).strip()

tidb_rows = {r["id"]: r for r in json.loads((REPO / "analysis" / "_tidb_all_bodies.json").read_text(encoding="utf-8"))}

prog_map = {}
for line in (REPO / "analysis" / "full_audit_progress.jsonl").read_text(encoding="utf-8").splitlines():
    if line.strip():
        o = json.loads(line)
        prog_map[str(o.get("video_id"))] = o

con = sqlite3.connect(str(SQLITE_DB))
con.row_factory = sqlite3.Row
sq_rows = {str(r["id"]): dict(r) for r in con.execute(
    "SELECT id, overall_rating, ai_analysis, updated_at, score_breakdown_json FROM videos"
).fetchall()}
con.close()

common_ids = sorted(set(tidb_rows) & set(sq_rows))

body_same = 0
body_diff_minor = 0   # first 120 chars same, minor trailing/formatting diff
body_diff_major = 0   # completely different document (first 120 chars differ or one is empty)
body_diff_one_empty = 0

ch11_on_tidb_total = 0
ch11_on_different_base_body_major = 0
ch11_on_different_base_body_any = 0
ch11_diff_samples = []

audited_rating_mismatch = 0
audited_matched_sqlite_at_audit_time = 0

for vid in common_ids:
    tr = tidb_rows[vid]
    sr = sq_rows[vid]
    t_full = tr["analysis"] or ""
    s_full = sr["ai_analysis"] or ""
    t_has_ch11 = "## 11." in t_full
    if t_has_ch11:
        ch11_on_tidb_total += 1

    t_base = norm(strip_ch11(t_full))
    s_base = norm(strip_ch11(s_full))

    if t_base == s_base:
        body_same += 1
        diff_kind = "same"
    elif (not t_base) != (not s_base):
        body_diff_one_empty += 1
        diff_kind = "one_empty"
    elif t_base[:120] == s_base[:120]:
        body_diff_minor += 1
        diff_kind = "minor"
    else:
        body_diff_major += 1
        diff_kind = "major"

    if t_has_ch11 and diff_kind != "same":
        ch11_on_different_base_body_any += 1
        if diff_kind in ("major", "one_empty"):
            ch11_on_different_base_body_major += 1
            if len(ch11_diff_samples) < 10:
                ch11_diff_samples.append({
                    "id": vid,
                    "tidb_rating": tr["rating"],
                    "sqlite_rating": sr["overall_rating"] or "",
                    "tidb_createdAt": tr["createdAt"][:10],
                    "tidb_analysis_status": tr["analysisStatus"],
                    "diff_kind": diff_kind,
                    "tidb_base_head": t_base[:100],
                    "sqlite_base_head": s_base[:100],
                })

    if vid in prog_map:
        pr = prog_map[vid]
        pr_o = str(pr.get("ratings") or "").split("/")[0]
        if (tr["rating"] or "") != (sr["overall_rating"] or ""):
            audited_rating_mismatch += 1
            if pr_o == (sr["overall_rating"] or ""):
                audited_matched_sqlite_at_audit_time += 1

body_diff_total = body_diff_minor + body_diff_major + body_diff_one_empty

result = {
    "common_videos_checked": len(common_ids),
    "a_body_comparison": {
        "identical_base_body": body_same,
        "different_base_body_total": body_diff_total,
        "breakdown": {
            "different_document_major_head_diff": body_diff_major,
            "one_side_empty": body_diff_one_empty,
            "same_head_minor_diff": body_diff_minor,
        },
    },
    "b_ch11_appended_to_different_tidb_body": {
        "tidb_videos_with_ch11_total": ch11_on_tidb_total,
        "ch11_on_any_different_base_body": ch11_on_different_base_body_any,
        "ch11_on_major_different_or_empty_base_body": ch11_on_different_base_body_major,
        "samples": ch11_diff_samples,
    },
    "audited_rating_mismatch_verification": {
        "audited_videos_with_tidb_vs_sqlite_rating_diff": audited_rating_mismatch,
        "audit_progress_matched_sqlite_rating": audited_matched_sqlite_at_audit_time,
    },
    "c_workflow_single_db_fix_proposal": {
        "root_cause_confirmed": (
            "goal_visual_audit_workflow.py read target video ratings and ai_analysis excerpts from local SQLite "
            "(iketeru_knowledge.db), while Phase 4 (backfill-100pt-scores.mjs / apply-audit-patches.mjs) wrote "
            "scores and '## 11.' patches to TiDB Cloud. Because SQLite and TiDB already held different ratings "
            "and different aiAnalysis documents on hundreds of Vimeo/provisional records, Ch.11 patches generated "
            "against SQLite's text were appended onto TiDB's different document."
        ),
        "proposed_architecture_fix": [
            "1. Unify read & write on TiDB Cloud as the single canonical DB inside goal_visual_audit_workflow.py (replace Phase 1 SQLite SELECT with a Node/Python query reading id, ratings, aiAnalysis directly from TiDB Cloud).",
            "2. Have Phase 4 write scores, ratings, and '## 11.' patches ONLY to TiDB Cloud first.",
            "3. Update local SQLite strictly as a one-way mirror AFTER TiDB commit succeeds (copying the exact TiDB row that was just written, never reading SQLite as input for auditing).",
            "4. Before running any new audit wave, add a pre-flight hash check verifying the target video's aiAnalysis hash matches between read time and patch time (abort patch if mismatched).",
        ],
    },
}

# Update db_sync_cause_analysis.json cleanly (removing contradicted 2026-04 speculation)
cause_path = REPO / "analysis" / "db_sync_cause_analysis.json"
cause_doc = json.loads(cause_path.read_text(encoding="utf-8"))
cause_doc["sync_status"] = "PAUSED_AWAITING_USER_APPROVAL"
cause_doc["verified_root_cause_correction"] = {
    "retracted_claim": "前回の『2026-04頃にSQLite側で別の一次評価が入った』という推測は、1003005012（TiDB作成2026-11-19）等の実データと矛盾するため撤回。",
    "confirmed_root_cause": (
        "1) goal_visual_audit_workflow.py が読み込み元をローカルSQLite、書き込み先をTiDB Cloudという別々のDBにしていた。"
        "2) 両DBでは既に別の分析本文・別ランク（特にVimeo暫定評価）が入っており、SQLiteから読んだ本文・ランクを前提に生成した監査結果と『## 11.』が、TiDB側の別本文へ追記された。"
    ),
}
cause_doc["body_and_ch11_divergence"] = result
cause_path.write_text(json.dumps(cause_doc, ensure_ascii=False, indent=2), encoding="utf-8")

(REPO / "analysis" / "_tidb_all_bodies.json").unlink(missing_ok=True)
print(json.dumps(result, ensure_ascii=False, indent=2))
