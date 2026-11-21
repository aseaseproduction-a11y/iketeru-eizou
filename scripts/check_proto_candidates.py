import json
import sqlite3
import sys
sys.path.insert(0, r"E:\iketeru-creative-studio")
from iketeru_studio.indexer import KnowledgeIndex

idx = KnowledgeIndex()
con = sqlite3.connect(str(idx.db_path))
rows = con.execute(
    "SELECT c.video_id, v.title, v.overall_rating, v.technique_rating, c.title, c.software_json, "
    "json_extract(v.score_breakdown_json, '$.visualVerificationStatus') "
    "FROM craft_recipes c JOIN videos v ON v.id = c.video_id "
    "WHERE json_extract(v.score_breakdown_json, '$.visualVerificationStatus') = 'log_verified' "
    "AND COALESCE(json_extract(v.score_breakdown_json, '$.analysisStatus'), '') != 'provisional' "
    "AND c.software_json LIKE '%Blender%' "
    "ORDER BY c.technique_score DESC LIMIT 10"
).fetchall()
con.close()

print("=== LOG_VERIFIED BLENDER RECIPES ===")
print(json.dumps(rows, ensure_ascii=False, indent=2))

# Also inspect all cuts of tvs9OLtw8Ao
rec = idx.get_craft_recipe("tvs9OLtw8Ao")
print("=== tvs9OLtw8Ao CUTS SUMMARY ===")
if rec:
    for c in rec["cuts"]:
        et = c.get("easing_and_timing") or {}
        tb = c.get("transition_bridge") or {}
        tel = (c.get("media") or {}).get("telemetry") or {}
        print(json.dumps({
            "cut_index": c.get("cut_index"),
            "title": c.get("title"),
            "easing_source": et.get("source"),
            "easing_verified": et.get("verified"),
            "easing_curve": et.get("ease_curve"),
            "transition_bridge_source": tb.get("source"),
            "telemetry_available": tel.get("available"),
            "palette_hex": c.get("color_palette_hex"),
        }, ensure_ascii=False))
