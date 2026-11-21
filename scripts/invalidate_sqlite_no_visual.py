import json
import re
import sqlite3
from pathlib import Path

ids = [str(x["video_id"]) for x in json.loads(Path(r"E:\iketeru-eizou\analysis\visual_redo_queue.json").read_text(encoding="utf-8"))]
con = sqlite3.connect(r"E:\iketeru-creative-studio\data\iketeru_knowledge.db")
bd = json.dumps({
    "version": 2,
    "source": "invalidated_no_visual",
    "visualChecked": False,
    "invalidatedNoVisual": True,
    "status": "invalidated_no_visual_redo_required",
    "note": "静止画未確認（0枚）のためスコアおよび第11章を無効化しました。再実施が必要です。",
}, ensure_ascii=False)
ch11_re = re.compile(r"(?:\r?\n)*## 11\. 実映像ビジュアル監査・実測補正[\s\S]*?(?=\r?\n## |\Z)")
updated = 0
for vid in ids:
    row = con.execute("SELECT ai_analysis FROM videos WHERE id = ?", (vid,)).fetchone()
    if row is None:
        continue
    ana = ch11_re.sub("", row[0] or "").rstrip()
    con.execute(
        "UPDATE videos SET overall_score_100=NULL, direction_score_100=NULL, technique_score_100=NULL, score_breakdown_json=?, ai_analysis=? WHERE id=?",
        (bd, ana, vid),
    )
    updated += 1
con.commit()
ph = ",".join(["?"] * len(ids))
v = con.execute(
    f"SELECT COUNT(*), "
    f"SUM(CASE WHEN overall_score_100 IS NOT NULL OR direction_score_100 IS NOT NULL OR technique_score_100 IS NOT NULL THEN 1 ELSE 0 END), "
    f"SUM(CASE WHEN ai_analysis LIKE '%## 11.%' THEN 1 ELSE 0 END) "
    f"FROM videos WHERE id IN ({ph})",
    ids,
).fetchone()
con.close()
print(json.dumps({"sqliteUpdated": updated, "totalMatched": v[0], "stillHasScore": v[1], "stillHasCh11": v[2]}, ensure_ascii=False, indent=2))
