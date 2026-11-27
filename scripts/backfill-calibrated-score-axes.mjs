#!/usr/bin/env node
/**
 * Dry-run Backfill Planner for `videos.calibratedScoreAxes` (READ-ONLY).
 *
 * This script NEVER writes to TiDB. It inspects all rows in TiDB `videos`
 * with `calibratedScore IS NOT NULL`, cross-matches them against Phase 3
 * raw scoring logs (`analysis/runs/<run_id>/raw_scores.jsonl`) and existing
 * `calibratedBreakdown`, builds the `calibratedScoreAxes` JSON payload, and
 * verifies that `sum(axes) === calibratedScore` for every matched video.
 *
 * Rules:
 *  - Phase 3 (Antigravity, `calibrationVersion = 'phase2_v1'`):
 *      - `source = "phase3"`, `offsetPerAxis = 0` (Phase 3 is the reference scale)
 *      - `mean_of_2` (2 runs): each axis = mean of the 2 runs (sum === calibratedScore)
 *      - `median_of_3` (3 runs, tiebreaker): uses the median-total run (or mean of
 *        runs tied at the median total) so sum(axes) === calibratedScore exactly.
 *  - Gemini API URL (`source = "api"`, not yet applied to TiDB):
 *      - `offsetPerAxis = 0.45` (= 2.25 / 5), subtracting 0.45 from each axis's 2-run mean
 *        so sum(axes) === mean(r1, r2) - 2.25 === calibratedScore.
 *
 * Usage:
 *   node scripts/backfill-calibrated-score-axes.mjs [--dry-run] [--samples 10]
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const RUNS_DIR = path.join(REPO_ROOT, "analysis", "runs");

const AXES = [
  "direction",
  "visual_craft",
  "editing_rhythm",
  "sound_integration",
  "originality_finish",
];

function round2(n) {
  return Math.round(n * 100) / 100;
}

function sumAxes(axes) {
  return round2(AXES.reduce((acc, k) => acc + axes[k], 0));
}

function hasValid5Axes(scores) {
  if (!scores || typeof scores !== "object") return false;
  return AXES.every((k) => typeof scores[k] === "number" && Number.isFinite(scores[k]) && scores[k] >= 0 && scores[k] <= 20);
}

function loadPhase3RawScoresIndex() {
  const index = new Map(); // `${runId}::${videoId}` -> Array<entry>
  const files = [];
  if (!fs.existsSync(RUNS_DIR)) return { index, files };

  for (const dirName of fs.readdirSync(RUNS_DIR).sort()) {
    const fp = path.join(RUNS_DIR, dirName, "raw_scores.jsonl");
    if (!fs.existsSync(fp)) continue;
    const lines = fs.readFileSync(fp, "utf8").split(/\r?\n/).filter(Boolean);
    let validCount = 0;
    for (const line of lines) {
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj.audit_valid !== true || obj.score_json_valid !== true) continue;
      if (!hasValid5Axes(obj.scores)) continue;
      validCount++;
      const key = `${dirName}::${obj.video_id}`;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(obj);
    }
    files.push({
      run_id: dirName,
      file: `analysis/runs/${dirName}/raw_scores.jsonl`,
      total_lines: lines.length,
      valid_5axis_lines: validCount,
    });
  }
  return { index, files };
}

/**
 * Compute `calibratedScoreAxes` payload for a single calibrated video.
 */
export function buildCalibratedScoreAxesForRow(row, rawIndex) {
  const calibratedScore = Number(row.calibratedScore);
  const runId = String(row.calibratedRunId || "");
  const route = String(row.calibratedRoute || "");
  const isApi = route === "gemini_api_youtube_url_v1" || row.calibrationVersion === "gemini_api_youtube_url_v1";
  const offsetPerAxis = isApi ? 0.45 : 0;
  const source = isApi ? "api" : "phase3";

  let breakdown = null;
  try {
    breakdown = row.calibratedBreakdown ? JSON.parse(row.calibratedBreakdown) : null;
  } catch {
    breakdown = null;
  }

  const expectedMode = route === "contact_sheet" ? "contact_sheet" : "video";
  const rawEntries = (rawIndex.get(`${runId}::${row.id}`) || []).filter((e) => e.mode === expectedMode);
  const byAttempt = new Map();
  for (const e of rawEntries) byAttempt.set(e.attempt, e);
  const runs = [...byAttempt.values()].sort((a, b) => a.attempt - b.attempt);

  if (runs.length === 0) {
    return {
      status: "no_runs",
      runs_found: 0,
      payload: null,
      sum_axes: null,
      diff: null,
    };
  }

  if (runs.length === 1) {
    const axes = {};
    for (const k of AXES) axes[k] = round2(runs[0].scores[k] - offsetPerAxis);
    const sum = sumAxes(axes);
    return {
      status: "single_run_only",
      runs_found: 1,
      payload: { v: 1, axes, runs: 1, source, offsetPerAxis },
      sum_axes: sum,
      diff: round2(sum - calibratedScore),
    };
  }

  const ensembleRule = breakdown?.ensembleRule || (runs.length === 2 ? "mean_of_2" : "median_of_3");

  if (runs.length === 2 || ensembleRule === "mean_of_2") {
    const chosen = runs.slice(0, 2);
    const axes = {};
    for (const k of AXES) {
      axes[k] = round2((chosen[0].scores[k] + chosen[1].scores[k]) / 2 - offsetPerAxis);
    }
    const sum = sumAxes(axes);
    return {
      status: "ready_2runs",
      runs_found: chosen.length,
      payload: {
        v: 1,
        axes,
        runs: 2,
        source,
        offsetPerAxis,
        ensembleRule: "mean_of_2",
      },
      sum_axes: sum,
      diff: round2(sum - calibratedScore),
    };
  }

  // Tiebreaker (3 runs, median_of_3): calibratedScore is the median of the 3 run totals.
  // Pick the run(s) whose total equals the median total (average if 2 runs tie at median)
  // so that sum(axes) === calibratedScore with 0.00 error.
  const withTotal = runs.map((r) => ({
    entry: r,
    total: typeof r.total_score === "number" ? r.total_score : sumAxes(r.scores),
  }));
  withTotal.sort((a, b) => a.total - b.total);
  const medianTotal = withTotal[Math.floor(withTotal.length / 2)].total;
  const medianRuns = withTotal.filter((item) => item.total === medianTotal).map((item) => item.entry);

  const axes = {};
  for (const k of AXES) {
    const meanVal = medianRuns.reduce((acc, r) => acc + r.scores[k], 0) / medianRuns.length;
    axes[k] = round2(meanVal - offsetPerAxis);
  }
  const sum = sumAxes(axes);

  return {
    status: "ready_3runs_median",
    runs_found: runs.length,
    payload: {
      v: 1,
      axes,
      runs: runs.length,
      source,
      offsetPerAxis,
      ensembleRule: "median_of_3_median_run",
    },
    sum_axes: sum,
    diff: round2(sum - calibratedScore),
  };
}

async function main() {
  if (process.argv.includes("--apply")) {
    console.error("REFUSED: This script is dry-run only until DDL and backfill are explicitly approved by Chiba-san.");
    process.exit(2);
  }

  const samplesIdx = process.argv.indexOf("--samples");
  const sampleLimit = samplesIdx !== -1 ? Math.max(1, Number(process.argv[samplesIdx + 1]) || 10) : 10;

  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
  const mysql = require("mysql2/promise");

  const { index: rawIndex, files } = loadPhase3RawScoresIndex();

  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });

  let rows;
  try {
    [rows] = await conn.query(`
      SELECT id, title, calibratedScore, calibratedRank, calibratedRoute, calibratedRunId, calibrationVersion, analysisVersion, calibratedBreakdown
      FROM videos
      WHERE calibratedScore IS NOT NULL
      ORDER BY id ASC
    `);
  } finally {
    await conn.end();
  }

  const summary = {
    mode: "dry_run_only",
    tidb_calibrated_videos: rows.length,
    ready_2runs: 0,
    ready_3runs_median: 0,
    ready_total: 0,
    single_run_only: 0,
    no_runs: 0,
    sum_exact_matches: 0,
    sum_mismatches: 0,
    mismatch_examples: [],
    raw_score_files_scanned: files.length,
  };

  const samples2 = [];
  const samples3 = [];
  const samplesV3 = [];

  for (const row of rows) {
    const res = buildCalibratedScoreAxesForRow(row, rawIndex);
    if (res.status === "ready_2runs") {
      summary.ready_2runs++;
      summary.ready_total++;
    } else if (res.status === "ready_3runs_median") {
      summary.ready_3runs_median++;
      summary.ready_total++;
    } else if (res.status === "single_run_only") {
      summary.single_run_only++;
    } else {
      summary.no_runs++;
    }

    if (res.diff !== null && Math.abs(res.diff) < 0.001) {
      summary.sum_exact_matches++;
    } else {
      summary.sum_mismatches++;
      if (summary.mismatch_examples.length < 10) {
        summary.mismatch_examples.push({
          id: row.id,
          calibratedScore: Number(row.calibratedScore),
          sum_axes: res.sum_axes,
          diff: res.diff,
          status: res.status,
        });
      }
    }

    const record = {
      id: row.id,
      title: String(row.title || "").slice(0, 48),
      analysisVersion: row.analysisVersion || "legacy",
      calibratedScore: Number(row.calibratedScore),
      calibratedRank: row.calibratedRank,
      calibratedRunId: row.calibratedRunId,
      sum_axes: res.sum_axes,
      diff: res.diff,
      calibratedScoreAxes: res.payload,
    };

    if (row.analysisVersion === "v3" && samplesV3.length < 3) {
      samplesV3.push(record);
    } else if (res.status === "ready_3runs_median" && samples3.length < 3) {
      samples3.push(record);
    } else if (res.status === "ready_2runs" && samples2.length < sampleLimit) {
      samples2.push(record);
    }
  }

  // Compose 10 representative samples: v3 + 3-run tiebreaker + 2-run standard
  const samples = [...samplesV3, ...samples3, ...samples2].slice(0, sampleLimit);

  console.log(JSON.stringify({ summary, samples }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("[backfill-calibrated-score-axes] ERROR:", err);
    process.exit(1);
  });
}
