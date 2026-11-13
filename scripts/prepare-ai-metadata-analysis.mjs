import { mkdirSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const outputDir = "/home/ubuntu/iketeru-eizou/analysis/ai_metadata_completion";
const limit = Number(process.env.AI_ANALYSIS_LIMIT || "0");
const offset = Number(process.env.AI_ANALYSIS_OFFSET || "0");
const parse = (raw, fallback) => {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
};
const empty = (raw) => !Array.isArray(parse(raw, [])) || parse(raw, []).length === 0;
const missingFields = (row) => [
  ...(empty(row.genres) ? ["genres"] : []),
  ...(empty(row.products) ? ["products"] : []),
  ...(empty(row.directions) ? ["directions"] : []),
  ...(empty(row.tones) ? ["tones"] : []),
  ...(empty(row.purposes) ? ["purposes"] : []),
  ...(empty(row.expressions) ? ["expressions"] : []),
  ...(!row.privateRating ? ["privateRating"] : []),
  ...(!row.aiOverallRating ? ["aiOverallRating"] : []),
  ...(!row.aiDirectionRating ? ["aiDirectionRating"] : []),
  ...(!row.aiTechniqueRating ? ["aiTechniqueRating"] : []),
  ...(!row.aiAnalysis ? ["aiAnalysis"] : []),
  ...(!row.curationNote ? ["curationNote"] : []),
];

mkdirSync(outputDir, { recursive: true });
const db = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await db.query("SELECT id, platform, title, videoUrl, thumbnail, source, sourceLabel, channelTitle, allTags, CAST(curationNote AS CHAR) AS curationNote, CAST(metadataClassificationAudit AS CHAR) AS metadataClassificationAudit, CAST(genres AS CHAR) AS genres, CAST(products AS CHAR) AS products, CAST(directions AS CHAR) AS directions, CAST(tones AS CHAR) AS tones, CAST(purposes AS CHAR) AS purposes, CAST(expressions AS CHAR) AS expressions, privateRating, aiOverallRating, aiDirectionRating, aiTechniqueRating, aiAnalysis FROM videos ORDER BY id");
await db.end();
const candidates = rows
  .map((row) => ({ row, missing: missingFields(row) }))
  .filter(({ row, missing }) => missing.length > 0 && !parse(row.metadataClassificationAudit, {}).aiMetadataCompletion)
  .sort((a, b) => (a.row.id === "t5jPgM_VKZo" ? -1 : b.row.id === "t5jPgM_VKZo" ? 1 : b.missing.length - a.missing.length));
const selected = candidates.slice(offset, limit > 0 ? offset + limit : undefined).map(({ row, missing }) => ({
  id: row.id,
  platform: row.platform,
  title: row.title,
  videoUrl: row.videoUrl,
  thumbnail: row.thumbnail || "",
  source: row.source || "",
  sourceLabel: row.sourceLabel || "",
  channelTitle: row.channelTitle || "",
  tags: parse(row.allTags, []).slice(0, 40),
  curationNote: parse(row.curationNote, {}),
  existing: {
    genres: parse(row.genres, []), products: parse(row.products, []), directions: parse(row.directions, []), tones: parse(row.tones, []), purposes: parse(row.purposes, []), expressions: parse(row.expressions, []), privateRating: row.privateRating || "", aiOverallRating: row.aiOverallRating || "", aiDirectionRating: row.aiDirectionRating || "", aiTechniqueRating: row.aiTechniqueRating || "", aiAnalysis: row.aiAnalysis || "",
  },
  missing,
}));
writeFileSync(`${outputDir}/inputs_${offset}_${selected.length}.json`, `${JSON.stringify(selected, null, 2)}\n`);
writeFileSync(`${outputDir}/manifest_${offset}_${selected.length}.json`, `${JSON.stringify({ createdAt: new Date().toISOString(), totalMissing: candidates.length, offset, selected: selected.length, ids: selected.map((item) => item.id) }, null, 2)}\n`);
console.log(JSON.stringify({ totalMissing: candidates.length, offset, selected: selected.length, input: `${outputDir}/inputs_${offset}_${selected.length}.json` }, null, 2));
process.exit(0);
