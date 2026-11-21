import json
import sqlite3
import sys
sys.path.insert(0, r"E:\iketeru-creative-studio")
from iketeru_studio.indexer import KnowledgeIndex

idx = KnowledgeIndex()
con = sqlite3.connect(str(idx.db_path))
prov_with_recipes = [
    r[0]
    for r in con.execute(
        "SELECT DISTINCT c.video_id FROM craft_recipes c JOIN videos v ON v.id = c.video_id "
        "WHERE json_extract(v.score_breakdown_json, '$.analysisStatus') = 'provisional' "
        "OR json_extract(v.score_breakdown_json, '$.isProvisional') = 1"
    ).fetchall()
]
con.close()

search_res = idx.search_craft_recipes(min_technique_rating="D-", limit=40)
leaked = [r["video_id"] for r in search_res if r["video_id"] in prov_with_recipes]
sample_prov = prov_with_recipes[0] if prov_with_recipes else None
got_recipe = idx.get_craft_recipe(sample_prov) if sample_prov else None
got_playbook = idx.get_video_playbook(sample_prov, live_fetch=False) if sample_prov else None

# Also find top non-provisional Blender / 3DCG / Motion craft recipes for #10
blender_cands = idx.search_craft_recipes(query="Blender", min_technique_rating="A", limit=10)
mg_cands = idx.search_craft_recipes(min_technique_rating="S-", v2_only=True, limit=10)

print(json.dumps({
    "provisional_videos_with_craft_recipes_in_db": len(prov_with_recipes),
    "search_craft_recipes_returned": len(search_res),
    "leaked_in_search_craft_recipes": len(leaked),
    "sample_provisional_id": sample_prov,
    "get_craft_recipe_returned_none": got_recipe is None,
    "get_video_playbook_returned_none": got_playbook is None,
    "top_blender_recipes": [
        {"video_id": r["video_id"], "title": r["video_title"], "cut_title": r["cut_title"], "rating": r["technique_rating"], "duration_sec": r["duration_sec"], "is_v2": r["is_v2"], "software": r["software_stack"]}
        for r in blender_cands[:5]
    ],
    "top_v2_recipes": [
        {"video_id": r["video_id"], "title": r["video_title"], "cut_title": r["cut_title"], "rating": r["technique_rating"], "duration_sec": r["duration_sec"], "primary_tool": r["primary_tool"], "software": r["software_stack"]}
        for r in mg_cands[:5]
    ],
}, ensure_ascii=False, indent=2))
