#!/usr/bin/env node
/**
 * Backfill `videos.calibratedScoreAxes` in TiDB from verified Phase 3 / API raw scoring logs.
 *
 * Safety & Idempotency Guarantees:
 *  - Default mode (`--dry-run` or omitting `--apply`): STRICTLY READ-ONLY (`SELECT` / `SHOW COLUMNS` only).
 *  - Targets ONLY rows where `calibratedScore IS NOT NULL AND calibratedScoreAxes IS NULL`.
 *    Re-running `--apply` produces the exact same DB state (0 rows updated on subsequent runs).
 *  - Multi-PC write serialization: `--apply` REQUIRES active `analysis/claims/_apply_lock.json`
 *    (`status === "locked"`, matching `worker` and `run_id`). Supports `--lock-git-ref <ref>`
 *    (e.g. `origin/main`) when executing from a feature branch while the lock lives on `main`.
 *  - SQL UPDATE touches ONLY `calibratedScoreAxes` and preserves `updatedAt = updatedAt`.
 *  - Never modifies any of the 40 Pre-D original columns or the 8 legacy score columns.
 *  - Rows whose `raw_scores.jsonl` is not present locally are safely skipped and reported.
 *  - Every candidate row MUST satisfy `|sum(axes) - calibratedScore| < 0.001` (fail-closed).
 *  - Post-apply verification checks:
 *      1. 5-axis sum === `calibratedScore` across ALL rows with `calibratedScoreAxes IS NOT NULL`
 *      2. Per-row `updatedAt` and `MAX(updatedAt)` strictly unchanged
 *      3. Pre-D original 40-column diff audit = 0 unapproved mismatches
 *
 * Rules:
 *  - Phase 3 (Antigravity, `calibrationVersion = 'phase2_v1'`):
 *      - `source = "phase3"`, `offsetPerAxis = 0` (Phase 3 is the reference scale)
 *      - `mean_of_2` (2 runs): each axis = mean of the 2 runs (sum === calibratedScore)
 *      - `median_of_3` (3 runs, tiebreaker): uses the median-total run (or mean of
 *        runs tied at the median total) so sum(axes) === calibratedScore exactly.
 *  - Gemini API URL (`source = "api"`):
 *      - `offsetPerAxis = 0.45` (= 2.25 / 5), subtracting 0.45 from each axis's 2-run mean
 *        so sum(axes) === mean(r1, r2) - 2.25 === calibratedScore.
 *
 * Usage:
 *   node scripts/backfill-calibrated-score-axes.mjs [--dry-run] [--samples 10]
 *   node scripts/backfill-calibrated-score-axes.mjs --apply --worker <name>
 *     [--lock-run-id <run_id>] [--lock-git-ref <git_ref>]
 *     [--pre-d-backup <path>] [--v3-store <dir>] [--approved-overrides <path>]
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_APPROVED_OVERRIDES_PATH,
  auditOriginalColumnsAgainstPreD,
  loadApprovedTidbOverrides,
  loadV3CanonicalManifestMap,
} from "./approved-tidb-overrides.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");
const RUNS_DIR = path.join(REPO_ROOT, "analysis", "runs");
const APPLY_LOCK_PATH = path.join(REPO_ROOT, "analysis", "claims", "_apply_lock.json");
const BACKUP_MANIFEST_PATH = path.join(REPO_ROOT, "analysis", "phase3_pre_d_backup_manifest.json");
export const DEFAULT_LOCK_RUN_ID = "backfill_calibrated_score_axes";

export const AXES = [
  "direction",
  "visual_craft",
  "editing_rhythm",
  "sound_integration",
  "originality_finish",
];

const LEGACY_SCORE_COLUMNS = new Set([
  "aiOverallScore",
  "aiDirectionScore",
  "aiTechniqueScore",
  "aiScoreBreakdown",
  "aiOverallRating",
  "aiDirectionRating",
  "aiTechniqueRating",
  "aiAnalysis",
]);

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function sumAxes(axes) {
  return round2(AXES.reduce((acc, k) => acc + axes[k], 0));
}

function hasValid5Axes(scores) {
  if (!scores || typeof scores !== "object") return false;
  return AXES.every((k) => typeof scores[k] === "number" && Number.isFinite(scores[k]) && scores[k] >= 0 && scores[k] <= 20);
}

function getFlagValue(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return null;
  const next = argv[idx + 1];
  if (!next || next.startsWith("--")) {
    throw new Error(`Flag ${flag} requires a value`);
  }
  return next;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(1024 * 1024);
  try {
    while (true) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function serializeDate(v) {
  if (v instanceof Date) return v.toISOString();
  if (v === null || v === undefined) return null;
  return String(v);
}

export function resolveV3StoreDir(argDir) {
  if (argDir) return argDir;
  if (process.env.IKETERU_ANALYSIS_V3_DIR) return process.env.IKETERU_ANALYSIS_V3_DIR;
  for (const candidate of ["G:\\マイドライブ\\iketeru_analysis_v3", "D:\\マイドライブ\\iketeru_analysis_v3"]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "D:\\マイドライブ\\iketeru_analysis_v3";
}

export function verifyApplyLockState(lock, { worker, expectedRunId }) {
  const errors = [];
  if (!worker || !String(worker).trim()) {
    errors.push("Worker name is required (--worker <name> or IKETERU_WORKER_NAME)");
  }
  if (!lock || lock.status !== "locked") {
    errors.push(`Apply lock is not active (status=${String(lock?.status ?? "missing")})`);
  } else {
    if (String(lock.worker || "") !== String(worker || "")) {
      errors.push(`Apply lock worker mismatch: lock.worker="${lock.worker}" != "${worker}"`);
    }
    if (expectedRunId && String(lock.run_id || "") !== String(expectedRunId)) {
      errors.push(`Apply lock run_id mismatch: lock.run_id="${lock.run_id}" != "${expectedRunId}"`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function loadApplyLock({ lockGitRef = null } = {}) {
  if (lockGitRef) {
    const raw = execFileSync("git", ["show", `${lockGitRef}:analysis/claims/_apply_lock.json`], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return JSON.parse(raw);
  }
  if (!fs.existsSync(APPLY_LOCK_PATH)) {
    return { schema_version: 1, status: "unlocked", worker: null, run_id: null, started_at: null };
  }
  return JSON.parse(fs.readFileSync(APPLY_LOCK_PATH, "utf8"));
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

/**
 * Partition NULL-target calibrated rows into ready-to-apply updates, skipped (missing raw_scores),
 * and sum-mismatch failures (which fail closed).
 */
export function planBackfillUpdates(targetRows, rawIndex) {
  const ready = [];
  const skippedMissingRaw = [];
  const singleRunOnly = [];
  const sumMismatches = [];

  for (const row of targetRows) {
    const res = buildCalibratedScoreAxesForRow(row, rawIndex);
    if (res.status === "no_runs") {
      skippedMissingRaw.push({
        id: row.id,
        calibratedRunId: row.calibratedRunId ?? null,
        calibratedRoute: row.calibratedRoute ?? null,
        calibratedScore: Number(row.calibratedScore),
      });
      continue;
    }
    if (res.status === "single_run_only") {
      singleRunOnly.push({
        id: row.id,
        calibratedRunId: row.calibratedRunId ?? null,
        calibratedScore: Number(row.calibratedScore),
        sum_axes: res.sum_axes,
        diff: res.diff,
      });
      continue;
    }
    if (res.diff === null || Math.abs(res.diff) >= 0.001) {
      sumMismatches.push({
        id: row.id,
        calibratedRunId: row.calibratedRunId ?? null,
        calibratedScore: Number(row.calibratedScore),
        sum_axes: res.sum_axes,
        diff: res.diff,
        status: res.status,
      });
      continue;
    }
    ready.push({
      id: row.id,
      title: String(row.title || "").slice(0, 48),
      analysisVersion: row.analysisVersion || "legacy",
      calibratedScore: Number(row.calibratedScore),
      calibratedRank: row.calibratedRank ?? null,
      calibratedRunId: row.calibratedRunId ?? null,
      status: res.status,
      sum_axes: res.sum_axes,
      diff: res.diff,
      payload: res.payload,
    });
  }

  return { ready, skippedMissingRaw, singleRunOnly, sumMismatches };
}

export const BACKFILL_UPDATE_SQL =
  "UPDATE `videos` SET `calibratedScoreAxes` = ?, `updatedAt` = `updatedAt` WHERE `id` = ? AND `calibratedScoreAxes` IS NULL";

async function runPreD40ColumnAudit(conn, { preDBackupPath, approvedOverridesPath, v3StoreDir }) {
  const manifest = JSON.parse(fs.readFileSync(BACKUP_MANIFEST_PATH, "utf8"));
  const resolvedBackupPath =
    preDBackupPath || process.env.IKETERU_PRE_D_BACKUP_PATH || manifest.tidb.jsonl_path;
  if (!fs.existsSync(resolvedBackupPath)) {
    throw new Error(`Pre-D baseline backup not found: ${resolvedBackupPath}`);
  }
  const actualSha = sha256File(resolvedBackupPath);
  if (actualSha !== manifest.tidb.jsonl_sha256) {
    throw new Error(
      `Pre-D backup SHA-256 mismatch: expected ${manifest.tidb.jsonl_sha256}, got ${actualSha}`,
    );
  }

  const originalColumns = manifest.tidb.columns;
  const backupMap = new Map();
  for (const line of fs.readFileSync(resolvedBackupPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    backupMap.set(String(obj.id), obj);
  }

  const colSelect = originalColumns.map((c) => `\`${c}\``).join(", ");
  const [liveRows] = await conn.query(`SELECT ${colSelect} FROM \`videos\` ORDER BY id ASC`);
  const approvedOverrides = loadApprovedTidbOverrides(approvedOverridesPath || DEFAULT_APPROVED_OVERRIDES_PATH);
  const v3Store = loadV3CanonicalManifestMap(resolveV3StoreDir(v3StoreDir));

  const audit = auditOriginalColumnsAgainstPreD({
    liveRows,
    backupMap,
    originalColumns,
    legacyScoreColumns: LEGACY_SCORE_COLUMNS,
    approvedOverrideMap: approvedOverrides.active_map,
    v3ManifestMap: v3Store.valid_map,
  });

  return {
    pre_d_backup_path: resolvedBackupPath,
    pre_d_backup_sha256_verified: true,
    v3_store_dir: v3Store.store_dir,
    v3_store_valid_count: v3Store.valid_map.size,
    ...audit,
  };
}

async function main() {
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
  const mysql = require("mysql2/promise");

  const applyMode = process.argv.includes("--apply");
  const sampleLimit = process.argv.includes("--samples")
    ? Math.max(1, Number(getFlagValue(process.argv, "--samples")) || 10)
    : 10;
  const workerArg = getFlagValue(process.argv, "--worker");
  const lockRunId = getFlagValue(process.argv, "--lock-run-id") || DEFAULT_LOCK_RUN_ID;
  const lockGitRef = getFlagValue(process.argv, "--lock-git-ref");
  const preDBackupArg = getFlagValue(process.argv, "--pre-d-backup");
  const v3StoreArg = getFlagValue(process.argv, "--v3-store");
  const approvedOverridesArg = getFlagValue(process.argv, "--approved-overrides");

  const worker = String(workerArg || process.env.IKETERU_WORKER_NAME || "").trim();

  if (applyMode) {
    const lock = loadApplyLock({ lockGitRef });
    const lockCheck = verifyApplyLockState(lock, { worker, expectedRunId: lockRunId });
    if (!lockCheck.ok) {
      throw new Error(`Apply lock check FAILED:\n - ${lockCheck.errors.join("\n - ")}`);
    }
  }

  const { index: rawIndex, files } = loadPhase3RawScoresIndex();

  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });

  try {
    const [colCheck] = await conn.query("SHOW COLUMNS FROM `videos` LIKE 'calibratedScoreAxes'");
    const columnExists = colCheck.length > 0;
    if (applyMode && !columnExists) {
      throw new Error("Column `videos.calibratedScoreAxes` does not exist yet. Execute DDL first.");
    }

    const [totals] = await conn.query(`
      SELECT
        COUNT(*) AS total_videos,
        SUM(calibratedScore IS NOT NULL) AS calibrated_total,
        ${columnExists ? "SUM(calibratedScore IS NOT NULL AND calibratedScoreAxes IS NOT NULL)" : "0"} AS already_populated,
        ${columnExists ? "SUM(calibratedScore IS NOT NULL AND calibratedScoreAxes IS NULL)" : "SUM(calibratedScore IS NOT NULL)"} AS target_null_count,
        MAX(updatedAt) AS max_updated_at
      FROM \`videos\`
    `);
    const beforeTotals = {
      total_videos: Number(totals[0].total_videos),
      calibrated_total: Number(totals[0].calibrated_total),
      already_populated: Number(totals[0].already_populated),
      target_null_count: Number(totals[0].target_null_count),
      max_updated_at: serializeDate(totals[0].max_updated_at),
    };

    const targetWhere = columnExists
      ? "calibratedScore IS NOT NULL AND calibratedScoreAxes IS NULL"
      : "calibratedScore IS NOT NULL";
    const [targetRows] = await conn.query(`
      SELECT id, title, calibratedScore, calibratedRank, calibratedRoute, calibratedRunId, calibrationVersion, analysisVersion, calibratedBreakdown, updatedAt
      FROM \`videos\`
      WHERE ${targetWhere}
      ORDER BY id ASC
    `);

    const plan = planBackfillUpdates(targetRows, rawIndex);

    const ready2 = plan.ready.filter((r) => r.status === "ready_2runs").length;
    const ready3 = plan.ready.filter((r) => r.status === "ready_3runs_median").length;

    const summary = {
      mode: applyMode ? "apply" : "dry_run",
      column_exists: columnExists,
      worker: worker || null,
      lock_run_id: applyMode ? lockRunId : null,
      lock_git_ref: applyMode ? lockGitRef || "working_tree" : null,
      before: beforeTotals,
      target_null_rows: targetRows.length,
      ready_2runs: ready2,
      ready_3runs_median: ready3,
      ready_total: plan.ready.length,
      skipped_missing_raw_scores: plan.skippedMissingRaw.length,
      single_run_only: plan.singleRunOnly.length,
      sum_mismatches: plan.sumMismatches.length,
      raw_score_files_scanned: files.length,
    };

    if (!applyMode) {
      const samplesV3 = plan.ready.filter((r) => r.analysisVersion === "v3").slice(0, 3);
      const samples3 = plan.ready
        .filter((r) => r.status === "ready_3runs_median" && !samplesV3.includes(r))
        .slice(0, 3);
      const samples2 = plan.ready
        .filter((r) => r.status === "ready_2runs" && !samplesV3.includes(r))
        .slice(0, sampleLimit);
      const samples = [...samplesV3, ...samples3, ...samples2].slice(0, sampleLimit).map((r) => ({
        id: r.id,
        title: r.title,
        analysisVersion: r.analysisVersion,
        calibratedScore: r.calibratedScore,
        calibratedRank: r.calibratedRank,
        calibratedRunId: r.calibratedRunId,
        sum_axes: r.sum_axes,
        diff: r.diff,
        calibratedScoreAxes: r.payload,
      }));
      console.log(
        JSON.stringify(
          {
            summary,
            skipped_missing_raw_scores_list: plan.skippedMissingRaw,
            sum_mismatch_examples: plan.sumMismatches.slice(0, 10),
            samples,
          },
          null,
          2,
        ),
      );
      return;
    }

    // Fail closed if any matched row has a sum mismatch
    if (plan.sumMismatches.length > 0) {
      throw new Error(
        `REFUSED: ${plan.sumMismatches.length} rows failed sum(axes) === calibratedScore check: ` +
          JSON.stringify(plan.sumMismatches.slice(0, 5)),
      );
    }

    // Capture per-row updatedAt before writing
    const preUpdatedAtById = new Map();
    for (const row of targetRows) {
      preUpdatedAtById.set(String(row.id), serializeDate(row.updatedAt));
    }

    // Apply in 100-row batches inside transactions
    let updatedRows = 0;
    const CHUNK = 100;
    for (let i = 0; i < plan.ready.length; i += CHUNK) {
      const slice = plan.ready.slice(i, i + CHUNK);
      await conn.beginTransaction();
      try {
        for (const item of slice) {
          const [res] = await conn.execute(BACKFILL_UPDATE_SQL, [
            JSON.stringify(item.payload),
            item.id,
          ]);
          updatedRows += Number(res.affectedRows || 0);
        }
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      }
    }

    // Post-apply verification:
    // 1. Re-read ALL populated calibratedScoreAxes rows and verify sum(axes) === calibratedScore
    const [postPopulated] = await conn.query(`
      SELECT id, calibratedScore, calibratedScoreAxes, updatedAt
      FROM \`videos\`
      WHERE calibratedScore IS NOT NULL AND calibratedScoreAxes IS NOT NULL
      ORDER BY id ASC
    `);
    let postSumExact = 0;
    let postSumMismatches = 0;
    const postMismatchSamples = [];
    let updatedAtDiffs = 0;
    for (const row of postPopulated) {
      const parsed =
        typeof row.calibratedScoreAxes === "string"
          ? JSON.parse(row.calibratedScoreAxes)
          : row.calibratedScoreAxes;
      const sum = parsed?.axes ? sumAxes(parsed.axes) : NaN;
      const score = Number(row.calibratedScore);
      if (Number.isFinite(sum) && Math.abs(sum - score) < 0.001) {
        postSumExact++;
      } else {
        postSumMismatches++;
        if (postMismatchSamples.length < 10) {
          postMismatchSamples.push({ id: row.id, score, sum });
        }
      }
      if (preUpdatedAtById.has(String(row.id))) {
        if (serializeDate(row.updatedAt) !== preUpdatedAtById.get(String(row.id))) {
          updatedAtDiffs++;
        }
      }
    }

    const [afterTotalsRows] = await conn.query(`
      SELECT
        COUNT(*) AS total_videos,
        SUM(calibratedScore IS NOT NULL) AS calibrated_total,
        SUM(calibratedScore IS NOT NULL AND calibratedScoreAxes IS NOT NULL) AS populated_count,
        SUM(calibratedScore IS NOT NULL AND calibratedScoreAxes IS NULL) AS remaining_null_count,
        MAX(updatedAt) AS max_updated_at
      FROM \`videos\`
    `);
    const afterTotals = {
      total_videos: Number(afterTotalsRows[0].total_videos),
      calibrated_total: Number(afterTotalsRows[0].calibrated_total),
      populated_count: Number(afterTotalsRows[0].populated_count),
      remaining_null_count: Number(afterTotalsRows[0].remaining_null_count),
      max_updated_at: serializeDate(afterTotalsRows[0].max_updated_at),
    };

    // 2. Full Pre-D 40-column audit
    const preDAudit = await runPreD40ColumnAudit(conn, {
      preDBackupPath: preDBackupArg,
      approvedOverridesPath: approvedOverridesArg,
      v3StoreDir: v3StoreArg,
    });

    const result = {
      summary,
      applied_rows: updatedRows,
      skipped_missing_raw_scores_list: plan.skippedMissingRaw,
      after: afterTotals,
      post_verification: {
        populated_checked: postPopulated.length,
        sum_exact_matches: postSumExact,
        sum_mismatches: postSumMismatches,
        mismatch_examples: postMismatchSamples,
        updated_at_row_diffs: updatedAtDiffs,
        max_updated_at_unchanged: afterTotals.max_updated_at === beforeTotals.max_updated_at,
        pre_d_40_col_audit: {
          passed: preDAudit.passed,
          rows_compared: preDAudit.rows_compared,
          columns_compared_per_row: preDAudit.columns_compared_per_row,
          total_cells_compared: preDAudit.total_cells_compared,
          all_40_original_columns_mismatches: preDAudit.all_40_original_columns_mismatches,
          legacy_8_score_columns_mismatches: preDAudit.legacy_8_score_columns_mismatches,
          updated_at_row_mismatches: preDAudit.updated_at_row_mismatches,
          v3_manifest_matched_count: preDAudit.v3_manifest_matched_count,
          approved_overrides_matched_count: preDAudit.approved_overrides_matched_count,
          sample_mismatches: preDAudit.sample_mismatches,
        },
        all_passed:
          postSumMismatches === 0 &&
          updatedAtDiffs === 0 &&
          afterTotals.max_updated_at === beforeTotals.max_updated_at &&
          preDAudit.passed === true,
      },
    };

    console.log(JSON.stringify(result, null, 2));
    if (!result.post_verification.all_passed) {
      process.exitCode = 1;
    }
  } finally {
    await conn.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("[backfill-calibrated-score-axes] ERROR:", err);
    process.exit(1);
  });
}
