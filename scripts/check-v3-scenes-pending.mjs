#!/usr/bin/env node
/**
 * Read-only TiDB inspection: count and list `videos WHERE analysisVersion = 'v3'`
 * whose `videoScenes` rows are still legacy or missing.
 *
 * Usage:
 *   node scripts/check-v3-scenes-pending.mjs [--out <path>]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = process.env.IKETERU_REPO_ROOT || path.resolve(__dirname, "..");

export function parseArgs(argv) {
  const opts = { outPath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") opts.outPath = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
  const mysql = require("mysql2/promise");

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set in environment or .env");
  }

  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
    connectTimeout: 30000,
  });

  let v3Rows;
  let sceneAgg;
  let overallScenes;
  try {
    [v3Rows] = await conn.query(
      "SELECT id, title, analysisVersion, analysisGeneratedAt FROM videos WHERE analysisVersion = 'v3' ORDER BY id ASC"
    );
    [sceneAgg] = await conn.query(`
      SELECT
        videoId,
        COUNT(*) AS total_rows,
        SUM(CASE WHEN analysisVersion = 'v3' THEN 1 ELSE 0 END) AS v3_rows,
        SUM(CASE WHEN analysisVersion != 'v3' OR analysisVersion IS NULL THEN 1 ELSE 0 END) AS non_v3_rows
      FROM videoScenes
      GROUP BY videoId
    `);
    [overallScenes] = await conn.query(
      "SELECT analysisVersion, COUNT(*) AS rows_cnt, COUNT(DISTINCT videoId) AS vids_cnt FROM videoScenes GROUP BY analysisVersion"
    );
  } finally {
    await conn.end();
  }

  const aggMap = new Map();
  for (const r of sceneAgg) {
    aggMap.set(String(r.videoId), {
      total: Number(r.total_rows),
      v3: Number(r.v3_rows),
      nonV3: Number(r.non_v3_rows),
    });
  }

  const pendingLegacy = [];
  const pendingZero = [];
  const alreadyV3 = [];

  for (const v of v3Rows) {
    const id = String(v.id);
    const st = aggMap.get(id);
    if (!st || st.total === 0) pendingZero.push(id);
    else if (st.nonV3 > 0) pendingLegacy.push(id);
    else alreadyV3.push(id);
  }

  const pendingAll = [...pendingLegacy, ...pendingZero].sort();
  const report = {
    tidb_v3_videos_total: v3Rows.length,
    overall_videoScenes_by_version: overallScenes,
    v3_videos_already_synced_count: alreadyV3.length,
    v3_videos_pending_total: pendingAll.length,
    v3_videos_pending_with_legacy_rows: pendingLegacy.length,
    v3_videos_pending_with_zero_rows: pendingZero.length,
    pending_ids_sample_first10: pendingAll.slice(0, 10),
    pending_ids_sample_last10: pendingAll.slice(-10),
    pending_ids_all: pendingAll,
  };

  if (opts.outPath) {
    fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
    fs.writeFileSync(opts.outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  }
  console.log(
    JSON.stringify(
      {
        ...report,
        pending_ids_all: opts.outPath
          ? `[${pendingAll.length} IDs saved to ${opts.outPath}]`
          : pendingAll.slice(0, 30),
      },
      null,
      2
    )
  );
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(`[check-v3-scenes-pending] ERROR:`, err?.message || err);
    process.exit(1);
  });
}
