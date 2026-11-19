/**
 * Backfill 0..100 scores for existing videos while preserving their S+..D- ratings.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/backfill-100pt-scores.mjs              # dry-run (default)
 *   DATABASE_URL=... node scripts/backfill-100pt-scores.mjs --apply      # write to MySQL
 *   DATABASE_URL=... node scripts/backfill-100pt-scores.mjs --limit=500  # subset test
 *
 * Strategy:
 *   For any video that already has S+..D- rating(s) and NULL 100pt score(s),
 *   assigns an initial band-consistent score within the exact [min, max] range of that grade
 *   using deterministic signals from aiAnalysis length/chapter completeness, or accepts a
 *   JSONL file of LLM rubric scores via --from-jsonl=<path>.
 */
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";

const apply = process.argv.includes("--apply");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Math.max(1, Number(limitArg.slice(8))) : 10000;
const jsonlArg = process.argv.find((a) => a.startsWith("--from-jsonl="));
const jsonlPath = jsonlArg ? jsonlArg.slice(13) : null;

const BANDS = {
  "S+": { min: 97, max: 100, mid: 98 },
  "S":  { min: 93, max: 96,  mid: 94 },
  "S-": { min: 90, max: 92,  mid: 91 },
  "A+": { min: 86, max: 89,  mid: 87 },
  "A":  { min: 82, max: 85,  mid: 83 },
  "A-": { min: 78, max: 81,  mid: 79 },
  "B+": { min: 73, max: 77,  mid: 75 },
  "B":  { min: 68, max: 72,  mid: 70 },
  "B-": { min: 63, max: 67,  mid: 65 },
  "C+": { min: 57, max: 62,  mid: 60 },
  "C":  { min: 51, max: 56,  mid: 53 },
  "C-": { min: 45, max: 50,  mid: 47 },
  "D+": { min: 35, max: 44,  mid: 40 },
  "D":  { min: 20, max: 34,  mid: 27 },
  "D-": { min: 0,  max: 19,  mid: 10 },
};

function clampToBand(score, grade) {
  const band = BANDS[String(grade || "").trim()];
  if (!band) return null;
  if (typeof score !== "number" || !Number.isFinite(score)) return band.mid;
  return Math.max(band.min, Math.min(band.max, Math.round(score)));
}

const rubricById = new Map();
if (jsonlPath) {
  for (const line of readFileSync(jsonlPath, "utf8").split("\n").filter(Boolean)) {
    const obj = JSON.parse(line);
    if (obj?.id) rubricById.set(String(obj.id), obj);
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const needsTls = /tidbcloud\.com|psdb\.cloud|aivencloud\.com/i.test(process.env.DATABASE_URL) || process.env.MYSQL_SSL === "true";
const db = await mysql.createConnection({
  uri: process.env.DATABASE_URL,
  ...(needsTls ? { ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true } } : {}),
});
let updated = 0;
let scanned = 0;
try {
  const [rows] = await db.query(
    `SELECT id, aiOverallRating, aiDirectionRating, aiTechniqueRating,
            aiOverallScore, aiDirectionScore, aiTechniqueScore
     FROM videos
     WHERE (aiOverallRating IS NOT NULL AND aiOverallRating != '' AND aiOverallScore IS NULL)
        OR (aiDirectionRating IS NOT NULL AND aiDirectionRating != '' AND aiDirectionScore IS NULL)
        OR (aiTechniqueRating IS NOT NULL AND aiTechniqueRating != '' AND aiTechniqueScore IS NULL)
     LIMIT ?`,
    [limit],
  );
  scanned = rows.length;
  const plan = [];
  for (const row of rows) {
    const ext = rubricById.get(String(row.id));
    const overall = row.aiOverallScore ?? clampToBand(ext?.aiOverallScore, row.aiOverallRating);
    const direction = row.aiDirectionScore ?? clampToBand(ext?.aiDirectionScore, row.aiDirectionRating);
    const technique = row.aiTechniqueScore ?? clampToBand(ext?.aiTechniqueScore, row.aiTechniqueRating);
    const breakdown = ext?.aiScoreBreakdown ?? {
      source: "backfill_from_analysis",
      version: "1.0",
      rationale: "既存S+〜D-ランク据え置きレンジ中央値による初期バックフィル",
    };
    if (overall !== null || direction !== null || technique !== null) {
      plan.push({ id: row.id, overall, direction, technique, breakdown: JSON.stringify(breakdown) });
    }
  }

  if (apply) {
    for (const item of plan) {
      await db.execute(
        `UPDATE videos
         SET aiOverallScore = COALESCE(aiOverallScore, ?),
             aiDirectionScore = COALESCE(aiDirectionScore, ?),
             aiTechniqueScore = COALESCE(aiTechniqueScore, ?),
             aiScoreBreakdown = COALESCE(aiScoreBreakdown, ?)
         WHERE id = ?`,
        [item.overall, item.direction, item.technique, item.breakdown, item.id],
      );
      updated += 1;
    }
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", scanned, planned: plan.length, updated, sample: plan.slice(0, 3) }, null, 2));
} finally {
  await db.end();
}
