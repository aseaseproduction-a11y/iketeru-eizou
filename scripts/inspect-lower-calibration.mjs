import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const cal = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "human_calibration_30.json"), "utf8"));
const lowerItems = cal.items.filter((x) => ["B-", "C+", "C", "C-", "D+", "D", "D-"].includes(x.currentAiOverallRating));
console.log("=== CURRENT B- AND BELOW IN CALIBRATION 30 ===");
console.log(JSON.stringify(lowerItems.map((x) => ({
  id: x.id,
  rating: x.currentAiOverallRating,
  platform: x.platform,
  title: x.title,
  videoUrl: x.videoUrl,
})), null, 2));

const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});

const [cands] = await conn.query(`
  SELECT id, platform, title, videoUrl, genres, products, directions, aiOverallRating, aiOverallScore, aiDirectionRating, aiTechniqueRating
  FROM videos
  WHERE (embedStatus IS NULL OR embedStatus != 'restricted')
    AND aiOverallRating IN ('B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-')
    AND COALESCE(aiScoreBreakdown, '') NOT LIKE '%"analysisStatus":"provisional"%'
    AND COALESCE(aiScoreBreakdown, '') NOT LIKE '%"isProvisional":true%'
    AND COALESCE(aiScoreBreakdown, '') NOT LIKE '%"invalidated_no_visual"%'
  ORDER BY FIELD(aiOverallRating, 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-'), id
`);
await conn.end();

// Filter out news / how-to / tutorial / comedy / meme / podcast / lecture / gameplay
const nonWorkRe = /ニュース|news|解説|講座|チュートリアル|tutorial|how to|ハウツー|作り方|ネタ|コント|漫才|大喜利|あるある|vlog|切り抜き|配信|生放送|実況|対談|インタビュー|講演|セミナー|講義|まとめ|ランキング|比較|レビュー|検証|雑学|クイズ|news|shorts.*ネタ/i;
const workRe = /CM|広告|PV|MV|Music Video|ミュージックビデオ|ブランド|企業|採用|リクルート|会社紹介|サービス紹介|プロモーション|PR|WebCM|モーショングラフィックス|アニメーション|タイトル|オープニング|映像|フィルム|Film|Commercial|Brand|Trailer|トレーラー|Teaser|ティザー|キャンペーン/i;

const filtered = cands.filter((r) => {
  const txt = `${r.title} ${r.genres} ${r.products}`;
  return !nonWorkRe.test(txt) && workRe.test(txt);
});

const byGrade = {};
for (const r of filtered) {
  byGrade[r.aiOverallRating] = byGrade[r.aiOverallRating] || [];
  if (byGrade[r.aiOverallRating].length < 8) {
    byGrade[r.aiOverallRating].push({
      id: r.id,
      rating: r.aiOverallRating,
      score: r.aiOverallScore,
      platform: r.platform,
      title: r.title,
      videoUrl: r.videoUrl,
      genres: r.genres,
    });
  }
}

console.log("=== CREATIVE WORK CANDIDATES (B- AND BELOW) ===");
console.log(JSON.stringify(byGrade, null, 2));
