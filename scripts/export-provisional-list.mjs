import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const CACHE_DIR = "D:\\マイドライブ\\iketeru_videos";
const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

// Scan local video cache filenames
const cachedIds = new Set();
if (fs.existsSync(CACHE_DIR)) {
  for (const name of fs.readdirSync(CACHE_DIR)) {
    if (name.toLowerCase().endsWith(".mp4")) {
      cachedIds.add(path.basename(name, path.extname(name)));
    }
  }
}

const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});

const [rows] = await conn.query(`
  SELECT id, platform, title, videoUrl, aiOverallRating, aiOverallScore,
         CASE
           WHEN aiAnalysis LIKE '%一次評価%' THEN '一次評価'
           WHEN aiAnalysis LIKE '%暫定評価%' THEN '暫定評価'
           WHEN aiAnalysis LIKE '%未視聴%' THEN '未視聴'
           WHEN aiAnalysis LIKE '%簡易分析済(要完全版)%' THEN '簡易分析済(要完全版)'
           WHEN aiScoreBreakdown LIKE '%"needs_full_analysis"%' THEN 'needs_full_analysis'
           ELSE 'other'
         END AS matchReason
  FROM videos
  WHERE aiAnalysis LIKE '%一次評価%'
     OR aiAnalysis LIKE '%暫定評価%'
     OR aiAnalysis LIKE '%未視聴%'
     OR aiAnalysis LIKE '%簡易分析済(要完全版)%'
     OR aiScoreBreakdown LIKE '%"needs_full_analysis"%'
  ORDER BY platform, id
`);

await conn.end();

const byPlatform = {};
const byReason = {};
const byRating = {};
let inLocalCache = 0;
let notInLocalCache = 0;

const items = rows.map((r) => {
  const cached = cachedIds.has(String(r.id));
  if (cached) inLocalCache++;
  else notInLocalCache++;
  byPlatform[r.platform] = (byPlatform[r.platform] || 0) + 1;
  byReason[r.matchReason] = (byReason[r.matchReason] || 0) + 1;
  const rt = r.aiOverallRating || "(none)";
  byRating[rt] = (byRating[rt] || 0) + 1;
  return {
    id: r.id,
    platform: r.platform,
    title: r.title,
    videoUrl: r.videoUrl,
    aiOverallRating: r.aiOverallRating,
    aiOverallScore: r.aiOverallScore,
    matchReason: r.matchReason,
    hasLocalMp4Cache: cached,
  };
});

const out = {
  generatedAt: new Date().toISOString(),
  totalProvisionalCount: items.length,
  byPlatform,
  byReason,
  byRating,
  localCacheDirCount: cachedIds.size,
  inLocalCache,
  notInLocalCache,
  items,
};

fs.writeFileSync(
  path.join(REPO_ROOT, "analysis", "provisional_unwatched_list.json"),
  JSON.stringify(out, null, 2),
  "utf8"
);

console.log(JSON.stringify({
  totalProvisionalCount: out.totalProvisionalCount,
  byPlatform,
  byReason,
  byRating,
  inLocalCache,
  notInLocalCache,
}, null, 2));
