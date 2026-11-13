import { writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const db = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const [rows] = await db.execute("SELECT id, allTags FROM videos WHERE products IS NULL OR products = '[]'");
  const counts = new Map();
  for (const row of rows) {
    try {
      const tags = JSON.parse(row.allTags || "[]");
      if (!Array.isArray(tags)) continue;
      for (const tag of tags) {
        const key = String(tag).trim();
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
      }
    } catch {
      // 破損したタグJSONは分類候補に使わない。
    }
  }
  const tags = [...counts.entries()]
    .map(([tag, usageCount]) => ({ tag, usageCount }))
    .sort((a, b) => b.usageCount - a.usageCount || a.tag.localeCompare(b.tag, "ja"));
  const outputPath = "/home/ubuntu/iketeru-eizou/analysis/missing_product_tag_frequency.json";
  writeFileSync(outputPath, `${JSON.stringify({ totalVideos: rows.length, tags }, null, 2)}\n`);
  console.log(JSON.stringify({ totalVideos: rows.length, distinctTags: tags.length, topTags: tags.slice(0, 100), outputPath }, null, 2));
} finally {
  await db.end();
}
