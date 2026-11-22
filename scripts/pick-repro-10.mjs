import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const CACHE_DIR = "D:\\マイドライブ\\iketeru_videos";
const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const cachedIds = fs.readdirSync(CACHE_DIR)
  .filter((f) => f.toLowerCase().endsWith(".mp4"))
  .map((f) => path.basename(f, path.extname(f)));

const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});

const [rows] = await conn.query(
  `SELECT id, platform, title, videoUrl, aiOverallRating, aiDirectionRating, aiTechniqueRating,
          JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.analysisStatus')) AS analysisStatus
     FROM videos
    WHERE id IN (?)
      AND aiOverallRating IS NOT NULL AND aiOverallRating != ''
      AND CHAR_LENGTH(aiAnalysis) >= 800`,
  [cachedIds]
);
await conn.end();

// Pick 1 video per tier across diverse tiers (preferring full_analysis first)
const targetTiers = ["S", "S-", "A+", "A", "A-", "B+", "B", "B-", "C+", "C"];
const picked = [];
const used = new Set();

for (const tier of targetTiers) {
  const cands = rows
    .filter((r) => r.aiOverallRating === tier && !used.has(r.id))
    .sort((a, b) => (a.analysisStatus === "full_analysis" ? 0 : 1) - (b.analysisStatus === "full_analysis" ? 0 : 1));
  if (cands.length > 0) {
    picked.push(cands[0]);
    used.add(cands[0].id);
  }
}

// If fewer than 10 (e.g. C not in local cache), fill from remaining distinct tiers/videos
for (const r of rows) {
  if (picked.length >= 10) break;
  if (!used.has(r.id) && r.analysisStatus === "full_analysis") {
    picked.push(r);
    used.add(r.id);
  }
}

fs.writeFileSync(
  path.join(REPO_ROOT, "analysis", "_repro_10_targets.json"),
  JSON.stringify(picked, null, 2),
  "utf8"
);
console.log(JSON.stringify(picked.map((r) => ({ id: r.id, tier: r.aiOverallRating, status: r.analysisStatus, platform: r.platform, title: r.title.slice(0, 50) })), null, 2));
