import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const reaudit537Ids = new Set(
  JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "reaudit_queue_537.json"), "utf8")).map((x) => String(x.id))
);
const doneIds = new Set();
for (const line of fs.readFileSync(path.join(REPO_ROOT, "analysis", "full_audit_progress.jsonl"), "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  const o = JSON.parse(line);
  if (o.video_id) doneIds.add(String(o.video_id));
}

const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});
const [rows] = await conn.query(
  `SELECT id, platform, title, aiOverallRating
     FROM videos
    WHERE platform = 'youtube'
      AND (embedStatus IS NULL OR embedStatus != 'restricted')
      AND CHAR_LENGTH(aiAnalysis) >= 1000
      AND aiOverallRating IN ('A+', 'A', 'A-', 'B+', 'B')
    ORDER BY id ASC
    LIMIT 400`
);
await conn.end();

const picked = [];
for (const r of rows) {
  const id = String(r.id);
  if (doneIds.has(id) || reaudit537Ids.has(id)) continue;
  picked.push(id);
  if (picked.length >= 10) break;
}

const pilotDoc = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "_wave43_pilot_20_ids.json"), "utf8"));
pilotDoc.skipped_unavailable_vimeo_10 = pilotDoc.from_normal_unaudited_10;
pilotDoc.from_normal_unaudited_10 = picked;
pilotDoc.all_20_ids = [...pilotDoc.from_reaudit_537_10, ...picked];
fs.writeFileSync(path.join(REPO_ROOT, "analysis", "_wave43_pilot_20_ids.json"), JSON.stringify(pilotDoc, null, 2), "utf8");
console.log(JSON.stringify(picked));
