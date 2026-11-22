import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const CACHE_DIR = "D:\\マイドライブ\\iketeru_videos";
const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const cachedIds = new Set(
  fs.readdirSync(CACHE_DIR)
    .filter((f) => f.toLowerCase().endsWith(".mp4"))
    .map((f) => path.basename(f, path.extname(f)))
);

const reaudit537 = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "reaudit_queue_537.json"), "utf8"));
const reaudit537Ids = new Set(reaudit537.map((x) => String(x.id)));

const doneIds = new Set();
for (const line of fs.readFileSync(path.join(REPO_ROOT, "analysis", "full_audit_progress.jsonl"), "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  const o = JSON.parse(line);
  if (o.video_id) doneIds.add(String(o.video_id));
}

// 1. Pick 10 from reaudit_queue_537 that are in local mp4 cache
const from537 = reaudit537
  .filter((x) => cachedIds.has(String(x.id)))
  .slice(0, 10)
  .map((x) => String(x.id));

// 2. Pick 10 normal unaudited videos (not in doneIds, not in reaudit537Ids) — prefer local cache first, then playable non-restricted
const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});
const [rows] = await conn.query(
  `SELECT id, platform, title, aiOverallRating, embedStatus
     FROM videos
    WHERE (embedStatus IS NULL OR embedStatus != 'restricted')
      AND CHAR_LENGTH(aiAnalysis) >= 800
    ORDER BY id ASC`
);
await conn.end();

const normalCached = [];
const normalVimeoOther = [];
for (const r of rows) {
  const id = String(r.id);
  if (doneIds.has(id) || reaudit537Ids.has(id)) continue;
  if (cachedIds.has(id)) normalCached.push(id);
  else if (r.platform === "vimeo") normalVimeoOther.push(id);
}

const fromNormal = [...normalCached, ...normalVimeoOther].slice(0, 10);

const out = {
  from_reaudit_537_10: from537,
  from_normal_unaudited_10: fromNormal,
  normal_cached_count: Math.min(10, normalCached.length),
  all_20_ids: [...from537, ...fromNormal],
};
fs.writeFileSync(path.join(REPO_ROOT, "analysis", "_wave43_pilot_20_ids.json"), JSON.stringify(out, null, 2), "utf8");
console.log(JSON.stringify(out, null, 2));
