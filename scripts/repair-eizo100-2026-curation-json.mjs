import { readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const plan = JSON.parse(readFileSync("/home/ubuntu/eizo100-2026-import/exception_plan.json", "utf8"));
const repairs = [...plan.existingUpdates, plan.collision];
const db = await mysql.createConnection(process.env.DATABASE_URL);
const repaired = [];
for (const item of repairs) {
  const [result] = await db.execute(
    "UPDATE videos SET curationNote = ? WHERE id = ? AND title = ? AND videoUrl = ?",
    [JSON.stringify(item.curationNote), item.videoId, item.workTitle, item.normalizedUrl],
  );
  if (result.affectedRows !== 1) throw new Error(`Expected one repaired row for ${item.videoId}, got ${result.affectedRows}`);
  repaired.push({ id: item.videoId, title: item.workTitle });
}
await db.end();
writeFileSync("/home/ubuntu/eizo100-2026-import/curation_json_repair_result.json", `${JSON.stringify({ repairedAt: new Date().toISOString(), repaired }, null, 2)}\n`);
console.log(JSON.stringify({ repaired: repaired.length, ids: repaired.map((item) => item.id) }, null, 2));
