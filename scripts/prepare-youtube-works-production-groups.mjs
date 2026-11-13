import { mkdirSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const db = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await db.execute(`
  SELECT id, title, videoUrl, sourceLabel, channelTitle, allTags, curationNote
  FROM videos
  WHERE source = 'youtube_works_awards_2026'
    AND (productions IS NULL OR productions = '[]')
  ORDER BY title, id
`);
await db.end();

const outputDir = "/home/ubuntu/iketeru-eizou/analysis/youtube_works_production_research_inputs";
mkdirSync(outputDir, { recursive: true });
const groupCount = 20;
const groups = Array.from({ length: groupCount }, () => []);
for (const [index, row] of rows.entries()) groups[index % groupCount].push(row);
const manifest = groups.map((items, index) => {
  const path = `${outputDir}/group-${String(index + 1).padStart(2, "0")}.json`;
  writeFileSync(path, `${JSON.stringify(items, null, 2)}\n`);
  return { group: index + 1, path, count: items.length };
});
const manifestPath = `${outputDir}/manifest.json`;
writeFileSync(manifestPath, `${JSON.stringify({ total: rows.length, groups: manifest }, null, 2)}\n`);
console.log(JSON.stringify({ total: rows.length, groups: manifest.length, manifestPath, manifest }, null, 2));
