import json
import sqlite3
from collections import Counter
from pathlib import Path

SQLITE_DB = Path(r"E:\iketeru-creative-studio\data\iketeru_knowledge.db")
TIDB_SNAP = Path(r"E:\iketeru-eizou\analysis\_tidb_snapshot_ratings.json")
DIFF_OUT = Path(r"E:\iketeru-eizou\analysis\db_sync_diff.json")

rating_order = ["S+", "S", "S-", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-"]
rank_int = lambda g: (len(rating_order) - rating_order.index(g)) if g in rating_order else 0

con = sqlite3.connect(str(SQLITE_DB))
con.row_factory = sqlite3.Row

# 1. Restore 3 test videos on SQLite to match TiDB restored values
restores = [
    ("1154382470", "S-", "S-", "A+", 90, 90, 86, json.dumps({"version": 2, "source": "rubric", "analysisStatus": "provisional", "isProvisional": True}, ensure_ascii=False)),
    ("UvGwIFVUK7M", "A", "A", "A", 83, 83, 83, json.dumps({"version": 2, "source": "backfill_from_analysis", "analysisStatus": "verified", "isProvisional": False}, ensure_ascii=False)),
    ("Z_lbVlhO9HE", "A+", "A+", "A", 87, 88, 84, json.dumps({"version": 2, "source": "rubric", "analysisStatus": "verified", "isProvisional": False}, ensure_ascii=False)),
]
for vid, o, d, t, os100, ds100, ts100, bd in restores:
    con.execute(
        "UPDATE videos SET overall_rating=?, direction_rating=?, technique_rating=?, overall_score=?, direction_score=?, technique_score=?, overall_score_100=?, direction_score_100=?, technique_score_100=?, score_breakdown_json=? WHERE id=?",
        (o, d, t, rank_int(o), rank_int(d), rank_int(t), os100, ds100, ts100, bd, vid),
    )
con.commit()

restored_rows = [dict(r) for r in con.execute(
    "SELECT id, overall_rating, direction_rating, technique_rating, overall_score_100, direction_score_100, technique_score_100 FROM videos WHERE id IN ('1154382470','UvGwIFVUK7M','Z_lbVlhO9HE') ORDER BY id"
).fetchall()]
print("=== SQLITE RESTORED ===")
print(json.dumps(restored_rows, ensure_ascii=False, indent=2))

# 2. Diff TiDB vs SQLite
tidb_rows = {str(r["id"]): r for r in json.loads(TIDB_SNAP.read_text(encoding="utf-8"))}
sqlite_rows = {str(r["id"]): dict(r) for r in con.execute(
    "SELECT id, overall_rating, direction_rating, technique_rating, overall_score_100, direction_score_100, technique_score_100 FROM videos"
).fetchall()}
con.close()

only_in_tidb = sorted(set(tidb_rows) - set(sqlite_rows))
only_in_sqlite = sorted(set(sqlite_rows) - set(tidb_rows))
common = sorted(set(tidb_rows) & set(sqlite_rows))

rating_diffs = []
score100_diffs = []
tidb_dist = Counter()
sqlite_dist = Counter()

for r in tidb_rows.values():
    tidb_dist[r["aiOverallRating"] or "(none)"] += 1
for r in sqlite_rows.values():
    sqlite_dist[r["overall_rating"] or "(none)"] += 1

for vid in common:
    tr = tidb_rows[vid]
    sr = sqlite_rows[vid]
    t_o = tr["aiOverallRating"] or ""
    s_o = sr["overall_rating"] or ""
    if t_o != s_o or (tr["aiDirectionRating"] or "") != (sr["direction_rating"] or "") or (tr["aiTechniqueRating"] or "") != (sr["technique_rating"] or ""):
        rating_diffs.append({
            "id": vid,
            "tidb": {"o": t_o, "d": tr["aiDirectionRating"] or "", "t": tr["aiTechniqueRating"] or "", "s100": tr["aiOverallScore"]},
            "sqlite": {"o": s_o, "d": sr["direction_rating"] or "", "t": sr["technique_rating"] or "", "s100": sr["overall_score_100"]},
        })
    elif tr["aiOverallScore"] != sr["overall_score_100"]:
        score100_diffs.append({
            "id": vid,
            "rating": t_o,
            "tidb_score100": tr["aiOverallScore"],
            "sqlite_score100": sr["overall_score_100"],
        })

all_grades = rating_order + ["(none)"]
dist_comparison = {g: {"tidb": tidb_dist.get(g, 0), "sqlite": sqlite_dist.get(g, 0), "delta_sqlite_minus_tidb": sqlite_dist.get(g, 0) - tidb_dist.get(g, 0)} for g in all_grades if tidb_dist.get(g, 0) or sqlite_dist.get(g, 0)}

diff_report = {
    "source_of_truth": "TiDB Cloud (production)",
    "tidb_total": len(tidb_rows),
    "sqlite_total": len(sqlite_rows),
    "only_in_tidb_count": len(only_in_tidb),
    "only_in_sqlite_count": len(only_in_sqlite),
    "rating_mismatch_count": len(rating_diffs),
    "score100_only_mismatch_count": len(score100_diffs),
    "distribution_comparison": dist_comparison,
    "only_in_tidb_sample": only_in_tidb[:20],
    "only_in_sqlite_sample": only_in_sqlite[:20],
    "rating_diffs": rating_diffs,
}
DIFF_OUT.write_text(json.dumps(diff_report, ensure_ascii=False, indent=2), encoding="utf-8")
TIDB_SNAP.unlink(missing_ok=True)
print("=== TIDB VS SQLITE DIFF SUMMARY ===")
print(json.dumps({k: v for k, v in diff_report.items() if k != "rating_diffs"}, ensure_ascii=False, indent=2))
