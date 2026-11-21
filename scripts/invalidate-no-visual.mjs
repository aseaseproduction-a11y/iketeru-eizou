import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const redoList = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "visual_redo_queue.json"), "utf8"));
const redoIds = redoList.map((x) => String(x.video_id));

const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});

let invalidatedOnDb = 0;
for (let i = 0; i < redoIds.length; i += 100) {
  const slice = redoIds.slice(i, i + 100);
  const placeholders = slice.map(() => "?").join(",");
  const [rows] = await conn.query(`SELECT id, aiScoreBreakdown FROM videos WHERE id IN (${placeholders})`, slice);
  for (const r of rows) {
    let bd = {};
    try { bd = r.aiScoreBreakdown ? JSON.parse(r.aiScoreBreakdown) : {}; } catch {}
    bd.visualChecked = false;
    bd.invalidatedNoVisual = true;
    bd.status = "invalidated_no_visual_redo_required";
    await conn.query("UPDATE videos SET aiScoreBreakdown = ? WHERE id = ?", [JSON.stringify(bd), r.id]);
    invalidatedOnDb++;
  }
}
await conn.end();
console.log(JSON.stringify({ redoQueueCount: redoIds.length, invalidatedOnDb }));
