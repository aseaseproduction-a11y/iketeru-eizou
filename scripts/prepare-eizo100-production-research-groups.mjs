import { mkdirSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const db = await mysql.createConnection(process.env.DATABASE_URL);
let rows;
try {
  [rows] = await db.execute("SELECT id, title, videoUrl, sourceLabel, channelTitle, awards, curationNote FROM videos WHERE awards LIKE '%映像作家100人%' AND (productions IS NULL OR productions = '' OR productions = '[]')");
} finally {
  await db.end();
}
const targets = rows.map((row) => {
  let awards = [];
  let note = null;
  try { awards = JSON.parse(row.awards || "[]"); } catch { awards = []; }
  try { note = JSON.parse(row.curationNote || ""); } catch { note = null; }
  const eizoAwards = awards.filter((award) => award.name === "映像作家100人");
  return {
    id: String(row.id),
    title: row.title,
    videoUrl: row.videoUrl,
    sourceLabel: row.sourceLabel,
    channelTitle: row.channelTitle || "",
    eizoAwards,
    sourceUrls: [...new Set([...(note?.sourceUrls || []), ...eizoAwards.map((award) => award.sourceUrl)])],
  };
});
const groupCount = 20;
const groups = Array.from({ length: groupCount }, () => []);
targets.forEach((row, index) => groups[index % groupCount].push(row));
const outputDir = "/home/ubuntu/eizo100-production-research-groups";
mkdirSync(outputDir, { recursive: true });
groups.forEach((group, index) => writeFileSync(`${outputDir}/group-${String(index + 1).padStart(2, "0")}.json`, `${JSON.stringify(group, null, 2)}\n`));
writeFileSync(`${outputDir}/manifest.json`, `${JSON.stringify({ total: targets.length, groupCount, groupSizes: groups.map((group) => group.length) }, null, 2)}\n`);
console.log(JSON.stringify({ total: targets.length, groupCount, groupSizes: groups.map((group) => group.length) }, null, 2));
