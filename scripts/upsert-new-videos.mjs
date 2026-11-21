import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const arg = process.argv.find((a) => a.startsWith("--input="));
if (!arg) throw new Error("Usage: node scripts/upsert-new-videos.mjs --input=<json_path>");
const inputPath = arg.slice("--input=".length);
const records = JSON.parse(fs.readFileSync(inputPath, "utf8"));

const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});

const today = new Date().toISOString().slice(0, 10);
let upserted = 0;

for (const r of records) {
  const id = String(r.id);
  const platform = r.platform || ( /^\d+$/.test(id) ? "vimeo" : "youtube" );
  const embedUrl =
    platform === "youtube"
      ? `https://www.youtube.com/embed/${id}`
      : `https://player.vimeo.com/video/${id}`;
  const allTags = [
    ...(r.genres || []).map((x) => x.name),
    ...(r.products || []).map((x) => x.name),
    ...(r.directions || []).map((x) => x.name),
    ...(r.tones || []).map((x) => x.name),
  ];

  await conn.query(
    `INSERT INTO videos (
      id, platform, title, thumbnail, videoUrl, embedUrl, source, sourceLabel,
      channelId, channelTitle,
      genres, products, directions, tones, allTags,
      purposes, expressions, productions, productionCredits, curationNote,
      aiOverallRating, aiDirectionRating, aiTechniqueRating,
      aiOverallScore, aiDirectionScore, aiTechniqueScore, aiScoreBreakdown,
      aiAnalysis, embedStatus, addedDate
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?
    )
    ON DUPLICATE KEY UPDATE
      title = VALUES(title),
      thumbnail = COALESCE(NULLIF(VALUES(thumbnail), ''), thumbnail),
      channelId = COALESCE(NULLIF(VALUES(channelId), ''), channelId),
      channelTitle = COALESCE(NULLIF(VALUES(channelTitle), ''), channelTitle),
      genres = VALUES(genres),
      products = VALUES(products),
      directions = VALUES(directions),
      tones = VALUES(tones),
      allTags = VALUES(allTags),
      purposes = VALUES(purposes),
      expressions = VALUES(expressions),
      productions = VALUES(productions),
      productionCredits = VALUES(productionCredits),
      curationNote = VALUES(curationNote),
      aiOverallRating = VALUES(aiOverallRating),
      aiDirectionRating = VALUES(aiDirectionRating),
      aiTechniqueRating = VALUES(aiTechniqueRating),
      aiOverallScore = VALUES(aiOverallScore),
      aiDirectionScore = VALUES(aiDirectionScore),
      aiTechniqueScore = VALUES(aiTechniqueScore),
      aiScoreBreakdown = VALUES(aiScoreBreakdown),
      aiAnalysis = VALUES(aiAnalysis),
      embedStatus = VALUES(embedStatus)`,
    [
      id,
      platform,
      r.title,
      r.thumbnail || "",
      r.videoUrl,
      embedUrl,
      "manual_sheet",
      "イケ動自動分析シート",
      r.channelId || "",
      r.channelTitle || "",
      JSON.stringify(r.genres || []),
      JSON.stringify(r.products || []),
      JSON.stringify(r.directions || []),
      JSON.stringify(r.tones || []),
      JSON.stringify(allTags),
      JSON.stringify(r.purposes || []),
      JSON.stringify(r.expressions || []),
      JSON.stringify(r.productions || []),
      JSON.stringify(r.productionCredits || []),
      JSON.stringify({
        purpose: "",
        background: "",
        evaluation: "",
        sourceUrls: [],
        ...(r.curationNote || {}),
        sourceUrls: Array.isArray(r.curationNote?.sourceUrls) ? r.curationNote.sourceUrls : [],
      }),
      r.aiOverallRating,
      r.aiDirectionRating,
      r.aiTechniqueRating,
      r.aiOverallScore,
      r.aiDirectionScore,
      r.aiTechniqueScore,
      JSON.stringify(r.aiScoreBreakdown || {}),
      r.aiAnalysis,
      r.embedStatus || "available",
      today,
    ]
  );
  upserted++;
}

await conn.end();
console.log(JSON.stringify({ ok: true, upserted }));
