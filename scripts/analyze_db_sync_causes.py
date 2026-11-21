import json
import sqlite3
from collections import Counter
from pathlib import Path

REPO = Path(r"E:\iketeru-eizou")
SQLITE_DB = Path(r"E:\iketeru-creative-studio\data\iketeru_knowledge.db")

rating_order = ["S+", "S", "S-", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-"]
rank_val = {g: len(rating_order) - i for i, g in enumerate(rating_order)}

diff = json.loads((REPO / "analysis" / "db_sync_diff.json").read_text(encoding="utf-8"))
meta_blob = json.loads((REPO / "analysis" / "_tidb_mismatch_meta.json").read_text(encoding="utf-8"))
tidb_meta = meta_blob["tidbMeta"]
all_tidb_meta = meta_blob["allTidbMeta"]

prog_ids = set()
for line in (REPO / "analysis" / "full_audit_progress.jsonl").read_text(encoding="utf-8").splitlines():
    if line.strip():
        prog_ids.add(str(json.loads(line).get("video_id")))

con = sqlite3.connect(str(SQLITE_DB))
con.row_factory = sqlite3.Row
sq_all = {str(r["id"]): dict(r) for r in con.execute(
    "SELECT id, platform, source, overall_rating, direction_rating, technique_rating, overall_score_100, updated_at, score_breakdown_json, length(ai_analysis) AS ana_len FROM videos"
).fetchall()}
con.close()

categories = Counter()
sub_breakdown = {}
samples = {}

for item in diff["rating_diffs"]:
    vid = str(item["id"])
    tm = tidb_meta.get(vid, {})
    sm = sq_all.get(vid, {})
    to = item["tidb"]["o"]
    so = item["sqlite"]["o"]
    in_audit = vid in prog_ids
    is_prov = tm.get("analysisStatus") == "provisional"
    tv = rank_val.get(to, 0)
    sv = rank_val.get(so, 0)

    if not to and so:
        cat = "A_tidb_empty_sqlite_has_rating_provisional" if is_prov else "B_tidb_empty_sqlite_has_rating_nonprovisional"
    elif to and not so:
        cat = "C_tidb_has_rating_sqlite_empty"
    elif tv > sv:
        delta = tv - sv
        if is_prov:
            cat = "D_tidb_higher_provisional_vimeo_or_yt"
        elif in_audit:
            cat = "E_tidb_higher_audited_wave_not_synced_to_sqlite"
        else:
            cat = "F_tidb_higher_unaudited_manus_or_sheet_or_manual"
    elif sv > tv:
        if is_prov:
            cat = "G_sqlite_higher_provisional"
        elif in_audit:
            cat = "H_sqlite_higher_audited"
        else:
            cat = "I_sqlite_higher_unaudited"
    else:
        cat = "J_overall_same_only_direction_or_technique_diff"

    categories[cat] += 1
    sub_breakdown.setdefault(cat, Counter())[f"platform={tm.get('platform')}|source={tm.get('source')}|bdSource={tm.get('bdSource')}"] += 1
    if len(samples.setdefault(cat, [])) < 3:
        samples[cat].append({
            "id": vid,
            "platform": tm.get("platform"),
            "source": tm.get("source"),
            "tidb_o": to,
            "sqlite_o": so,
            "tidb_updated": str(tm.get("updatedAt", ""))[:10],
            "bdSource": tm.get("bdSource"),
            "analysisStatus": tm.get("analysisStatus"),
            "in_audit_progress": in_audit,
        })

# Classify only_in_tidb (66) and only_in_sqlite (48)
only_tidb_ids = sorted(set(all_tidb_meta) - set(sq_all))
only_sq_ids = sorted(set(sq_all) - set(all_tidb_meta))
only_tidb_by_source = Counter(f"{all_tidb_meta[i].get('platform')}|{all_tidb_meta[i].get('source')}|{str(all_tidb_meta[i].get('createdAt',''))[:7]}" for i in only_tidb_ids)
only_sq_by_source = Counter(f"{sq_all[i].get('platform')}|{sq_all[i].get('source')}" for i in only_sq_ids)

report = {
    "rating_mismatch_total": len(diff["rating_diffs"]),
    "categories": dict(categories.most_common()),
    "category_top_sources": {k: dict(v.most_common(5)) for k, v in sub_breakdown.items()},
    "samples": samples,
    "only_in_tidb_count": len(only_tidb_ids),
    "only_in_tidb_by_source_month": dict(only_tidb_by_source.most_common(10)),
    "only_in_sqlite_count": len(only_sq_ids),
    "only_in_sqlite_by_source": dict(only_sq_by_source.most_common(10)),
}

(REPO / "analysis" / "db_sync_cause_analysis.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
(REPO / "analysis" / "_tidb_mismatch_meta.json").unlink(missing_ok=True)
print(json.dumps({k: v for k, v in report.items() if k != "samples"}, ensure_ascii=False, indent=2))
