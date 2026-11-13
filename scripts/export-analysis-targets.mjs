import mysql from "mysql2/promise";
import { writeFile } from "node:fs/promises";

const outputPath = process.argv[2] || "/home/ubuntu/iketeru-eizou/analysis/analysis_targets.json";
const excludedId = "0v78WbIc4BM";

const connection = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const [rows] = await connection.execute(
    `SELECT id, platform, title, videoUrl, channelTitle, source, sourceLabel,
            genres, products, directions, tones, allTags, purposes, expressions,
            toneEmotions, toneVisuals, toneTechniques, productions
     FROM videos
     WHERE id <> ?
     ORDER BY addedDate DESC, id ASC`,
    [excludedId]
  );

  const targets = rows.map((row) => ({
    id: String(row.id),
    platform: String(row.platform || "external"),
    title: String(row.title || ""),
    videoUrl: String(row.videoUrl || ""),
    channelTitle: String(row.channelTitle || ""),
    source: String(row.source || ""),
    sourceLabel: String(row.sourceLabel || ""),
    existingMetadata: {
      genres: row.genres || "[]",
      products: row.products || "[]",
      directions: row.directions || "[]",
      tones: row.tones || "[]",
      allTags: row.allTags || "[]",
      purposes: row.purposes || "[]",
      expressions: row.expressions || "[]",
      toneEmotions: row.toneEmotions || "[]",
      toneVisuals: row.toneVisuals || "[]",
      toneTechniques: row.toneTechniques || "[]",
      productions: row.productions || "[]",
    },
  }));

  await writeFile(outputPath, JSON.stringify({
    exportedAt: new Date().toISOString(),
    excludedId,
    targetCount: targets.length,
    targets,
  }, null, 2));
  console.log(JSON.stringify({ outputPath, targetCount: targets.length }));
} finally {
  await connection.end();
}

process.exit(0);
