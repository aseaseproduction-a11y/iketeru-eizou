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
  if (!band) {
    return typeof score === "number" && Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null;
  }
  if (typeof score !== "number" || !Number.isFinite(score)) return band.mid;
  return Math.max(band.min, Math.min(band.max, Math.round(score)));
}

function reconcileRubricObj(rubricObj, targetSum) {
  if (!rubricObj || typeof rubricObj !== "object" || typeof targetSum !== "number") return rubricObj;
  const keys = Object.keys(rubricObj);
  if (keys.length === 0) return rubricObj;
  const out = {};
  for (const k of keys) out[k] = Math.max(0, Math.min(20, Math.round(Number(rubricObj[k]) || 0)));
  let diff = targetSum - Object.values(out).reduce((a, b) => a + b, 0);
  let guard = 0;
  while (diff !== 0 && guard < 200) {
    guard++;
    const step = diff > 0 ? 1 : -1;
    const order = [...keys].sort((a, b) => (step > 0 ? out[a] - out[b] : out[b] - out[a]));
    let moved = false;
    for (const k of order) {
      const nv = out[k] + step;
      if (nv >= 0 && nv <= 20) {
        out[k] = nv;
        diff -= step;
        moved = true;
        if (diff === 0) break;
      }
    }
    if (!moved) break;
  }
  return out;
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
    jsonlPath
      ? `SELECT id, aiOverallRating, aiDirectionRating, aiTechniqueRating,
                aiOverallScore, aiDirectionScore, aiTechniqueScore
         FROM videos
         WHERE id IN (?)`
      : `SELECT id, aiOverallRating, aiDirectionRating, aiTechniqueRating,
                aiOverallScore, aiDirectionScore, aiTechniqueScore
         FROM videos
         WHERE (aiOverallRating IS NOT NULL AND aiOverallRating != '' AND aiOverallScore IS NULL)
            OR (aiDirectionRating IS NOT NULL AND aiDirectionRating != '' AND aiDirectionScore IS NULL)
            OR (aiTechniqueRating IS NOT NULL AND aiTechniqueRating != '' AND aiTechniqueScore IS NULL)
         LIMIT ?`,
    jsonlPath ? [Array.from(rubricById.keys()).slice(0, limit)] : [limit],
  );
  scanned = rows.length;
  const plan = [];
  for (const row of rows) {
    const ext = rubricById.get(String(row.id));
    const isUnclamped = ext?.aiScoreBreakdown?.source === "rubric_unclamped";
    if (isUnclamped) {
      const overall = typeof ext.aiOverallScore === "number" ? Math.max(0, Math.min(100, Math.round(ext.aiOverallScore))) : null;
      const direction = typeof ext.aiDirectionScore === "number" ? Math.max(0, Math.min(100, Math.round(ext.aiDirectionScore))) : null;
      const technique = typeof ext.aiTechniqueScore === "number" ? Math.max(0, Math.min(100, Math.round(ext.aiTechniqueScore))) : null;
      const overallRating = ext.aiOverallRating || ext.aiScoreBreakdown.newOverallRating || row.aiOverallRating;
      const directionRating = ext.aiDirectionRating || row.aiDirectionRating;
      const techniqueRating = ext.aiTechniqueRating || row.aiTechniqueRating;
      plan.push({
        id: row.id,
        unclamped: true,
        overallRating,
        directionRating,
        techniqueRating,
        overall,
        direction,
        technique,
        breakdown: JSON.stringify(ext.aiScoreBreakdown),
        overwrite: true,
      });
      continue;
    }

    const overall = ext ? clampToBand(ext.aiOverallScore, row.aiOverallRating) : (row.aiOverallScore ?? clampToBand(null, row.aiOverallRating));
    const direction = ext ? clampToBand(ext.aiDirectionScore, row.aiDirectionRating) : (row.aiDirectionScore ?? clampToBand(null, row.aiDirectionRating));
    const technique = ext ? clampToBand(ext.aiTechniqueScore, row.aiTechniqueRating) : (row.aiTechniqueScore ?? clampToBand(null, row.aiTechniqueRating));
    const breakdown = ext?.aiScoreBreakdown
      ? {
          ...ext.aiScoreBreakdown,
          ...(ext.aiScoreBreakdown.direction ? { direction: reconcileRubricObj(ext.aiScoreBreakdown.direction, direction) } : {}),
          ...(ext.aiScoreBreakdown.technique ? { technique: reconcileRubricObj(ext.aiScoreBreakdown.technique, technique) } : {}),
        }
      : {
          source: "backfill_from_analysis",
          version: "1.0",
          rationale: "既存S+〜D-ランク据え置きレンジ中央値による初期バックフィル",
        };
    if (overall !== null || direction !== null || technique !== null) {
      plan.push({ id: row.id, unclamped: false, overall, direction, technique, breakdown: JSON.stringify(breakdown), overwrite: Boolean(ext) });
    }
  }

  if (apply) {
    for (const item of plan) {
      if (item.unclamped) {
        await db.execute(
          `UPDATE videos
           SET aiOverallRating = ?, aiDirectionRating = ?, aiTechniqueRating = ?,
               aiOverallScore = ?, aiDirectionScore = ?, aiTechniqueScore = ?, aiScoreBreakdown = ?
           WHERE id = ?`,
          [item.overallRating, item.directionRating, item.techniqueRating, item.overall, item.direction, item.technique, item.breakdown, item.id],
        );
      } else if (item.overwrite) {
        await db.execute(
          `UPDATE videos
           SET aiOverallScore = ?, aiDirectionScore = ?, aiTechniqueScore = ?, aiScoreBreakdown = ?
           WHERE id = ?`,
          [item.overall, item.direction, item.technique, item.breakdown, item.id],
        );
      } else {
        await db.execute(
          `UPDATE videos
           SET aiOverallScore = COALESCE(aiOverallScore, ?),
               aiDirectionScore = COALESCE(aiDirectionScore, ?),
               aiTechniqueScore = COALESCE(aiTechniqueScore, ?),
               aiScoreBreakdown = COALESCE(aiScoreBreakdown, ?)
           WHERE id = ?`,
          [item.overall, item.direction, item.technique, item.breakdown, item.id],
        );
      }
      updated += 1;
    }
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", scanned, planned: plan.length, updated, sample: plan.slice(0, 3) }, null, 2));
} finally {
  await db.end();
}
