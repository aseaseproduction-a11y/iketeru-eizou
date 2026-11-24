#!/usr/bin/env node
/**
 * Tag unwatched / metadata-only / unverified-short aiAnalysis records in TiDB `videos`
 * using a dedicated non-destructive column `analysisObservationScope VARCHAR(40) NULL DEFAULT NULL`.
 *
 * Guarantees:
 *  - NEVER modifies `aiAnalysis`, legacy 8 score columns, any of the 40 original columns,
 *    or any of the 10 Phase 3 `calibrated*` / `calibrationStatus` columns.
 *  - Preserves `updatedAt = updatedAt`.
 *  - Default mode (`--dry-run` or omitting `--apply`): STRICTLY SELECT-ONLY against TiDB.
 *  - Real write (`--apply`):
 *      1. Requires `analysis/claims/_apply_lock.json` locked with `run_id === "tag_unwatched_analysis_scope"`
 *         and `worker === resolveWorkerName(...)` (NO OS hostname fallback).
 *      2. Verifies Pre-D baseline backup SHA-256 on disk.
 *      3. Takes a fresh local pre-apply TiDB snapshot BEFORE any ALTER/UPDATE.
 *      4. Post-apply verifies 5,653 rows x 40 original columns = 0 diffs AND calibrated counts unchanged.
 *
 * Usage:
 *   node scripts/tag-unwatched-analysis-scope.mjs --dry-run [--worker <name>]
 *   node scripts/tag-unwatched-analysis-scope.mjs --apply --worker <name> [--pre-d-backup <path>] [--backup-dir <dir>]
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BACKUP_MANIFEST_PATH = path.join(REPO_ROOT, "analysis", "phase3_pre_d_backup_manifest.json");
const APPLY_LOCK_PATH = path.join(REPO_ROOT, "analysis", "claims", "_apply_lock.json");
const AUDIT_JSON_PATH = path.join(REPO_ROOT, "analysis", "craft_calibration_pilot", "unwatched_analysis_audit.json");
const DRYRUN_OUT_PATH = path.join(REPO_ROOT, "analysis", "craft_calibration_pilot", "unwatched_tag_dryrun.json");
const APPLY_REPORT_OUT_PATH = path.join(REPO_ROOT, "analysis", "craft_calibration_pilot", "unwatched_tag_apply_verification.json");
const LOCK_RUN_ID = "tag_unwatched_analysis_scope";

// Exact classification regexes matching unwatched_analysis_audit.json (zero false positives)
const RE_B1_PRIMARY_META = /公式公開メタデータ・クレジット完全精査|公開公式メタデータ・公式制作解説・クレジット・サムネイルURLに基づく一次完全評価|未視聴のタイムコード捏造を禁止/;
const RE_B2_NO_SHEET = /前処理コンタクトシート未生成|動画本体が取得できないため|コンタクトシート未生成のため確認不能|コンタクトシートなし/;
const RE_C_TRIAGE = /【1次速報診断レポート/;
const RE_VIDEO_PROBE = /fps|実測\s*mean|\d+×\d+|\d+x\d+|シート\d|コンタクトシート|\d{2}:\d{2}|#01|dB/;
const RE_BOILERPLATE_C = /標準的な映像構成であり、破綻はないものの作家性や強い演出フックは控えめ|独創的なビジュアルコンセプトと卓越したカッティングが同居しており|演出コンセプトの切れ味が極限まで研ぎ澄まされており/;

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

function getFlagValue(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return null;
  const next = argv[idx + 1];
  if (!next || next.startsWith("--")) return null;
  return next;
}

function loadDotenv() {
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
}

function resolveWorkerName(argWorker) {
  loadDotenv();
  const name = String(argWorker || process.env.IKETERU_WORKER_NAME || "").trim();
  if (!name) {
    throw new Error(
      "Worker name is required: pass --worker <name> or set IKETERU_WORKER_NAME in .env / environment. " +
        "(OS hostname fallback is disabled.)"
    );
  }
  return name;
}

function loadApplyLock() {
  if (!fs.existsSync(APPLY_LOCK_PATH)) {
    return { schema_version: 1, status: "unlocked", worker: null, run_id: null, started_at: null };
  }
  return JSON.parse(fs.readFileSync(APPLY_LOCK_PATH, "utf8"));
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

function serializeValue(v) {
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return v.toString("utf8");
  return v;
}

function localTimestampStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function classifyObservationScope(aiAnalysisText) {
  const t = String(aiAnalysisText || "").trim();
  if (!t) return null; // empty / unanalyzed — left NULL
  if (RE_B1_PRIMARY_META.test(t)) return "metadata_only_unwatched";
  if (RE_B2_NO_SHEET.test(t)) return "missing_video_unwatched";
  if (RE_C_TRIAGE.test(t)) {
    if (RE_VIDEO_PROBE.test(t)) return null; // watched triage with real video probe
    if (RE_BOILERPLATE_C.test(t)) return "triage_boilerplate_unwatched";
    return "triage_unverified_short";
  }
  return null; // watched / standard analysis
}

async function dumpFreshPreApplyBackup(conn, backupRoot) {
  const stamp = localTimestampStamp();
  const dir = path.join(backupRoot, `phase3_pre_apply_${LOCK_RUN_ID}_${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, "tidb_videos_pre_apply.jsonl");

  const [rows] = await conn.query("SELECT * FROM videos ORDER BY id ASC");
  const fd = fs.openSync(outPath, "w");
  try {
    for (const row of rows) {
      const obj = {};
      for (const [k, v] of Object.entries(row)) obj[k] = serializeValue(v);
      fs.writeSync(fd, JSON.stringify(obj) + "\n", null, "utf8");
    }
  } finally {
    fs.closeSync(fd);
  }
  const stat = fs.statSync(outPath);
  const sha = sha256File(outPath);
  const meta = {
    created_at: new Date().toISOString(),
    purpose: `Fresh local pre-apply TiDB snapshot before ${LOCK_RUN_ID}`,
    row_count: rows.length,
    jsonl_path: outPath,
    jsonl_bytes: stat.size,
    jsonl_sha256: sha,
  };
  fs.writeFileSync(path.join(dir, "pre_apply_backup_meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");
  return meta;
}

async function main() {
  loadDotenv();
  const applyMode = process.argv.includes("--apply");
  const dryRun = !applyMode || process.argv.includes("--dry-run");
  const worker = resolveWorkerName(getFlagValue(process.argv, "--worker"));
  const preDBackupArg = getFlagValue(process.argv, "--pre-d-backup");
  const backupDirArg = getFlagValue(process.argv, "--backup-dir");

  const lock = loadApplyLock();
  const lockMatches = lock.status === "locked" && lock.run_id === LOCK_RUN_ID && lock.worker === worker;
  if (!dryRun && !lockMatches) {
    throw new Error(
      `Refusing to write to TiDB without active write lock! Expected status="locked", worker="${worker}", run_id="${LOCK_RUN_ID}", ` +
        `found=${JSON.stringify({ status: lock.status, worker: lock.worker, run_id: lock.run_id })}. ` +
        `Acquire and push lock first: node scripts/claim-phase3-batch.mjs --acquire-apply-lock ${LOCK_RUN_ID} --worker ${worker}`
    );
  }

  const backupManifest = JSON.parse(fs.readFileSync(BACKUP_MANIFEST_PATH, "utf8"));
  const backupJsonlPath = preDBackupArg || process.env.IKETERU_PRE_D_BACKUP_PATH || backupManifest.tidb.jsonl_path;
  const actualBackupSha = sha256File(backupJsonlPath);
  if (actualBackupSha !== backupManifest.tidb.jsonl_sha256) {
    throw new Error(`Pre-D backup SHA-256 mismatch! expected=${backupManifest.tidb.jsonl_sha256} actual=${actualBackupSha}`);
  }

  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  const mysql = require("mysql2/promise");
  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });

  try {
    const [colRows] = await conn.query("SHOW COLUMNS FROM videos LIKE 'analysisObservationScope'");
    const columnExists = colRows.length > 0;

    const [rows] = await conn.query(`
      SELECT id, platform, title, aiAnalysis, calibrationStatus, calibratedScore
      FROM videos
      ORDER BY id ASC
    `);

    const updates = [];
    const countsByScope = {};
    const countsByPlatform = {};
    let calibratedOverlap = 0;

    for (const r of rows) {
      const scope = classifyObservationScope(r.aiAnalysis);
      if (!scope) continue;
      countsByScope[scope] = (countsByScope[scope] || 0) + 1;
      const plat = String(r.platform || "unknown");
      countsByPlatform[plat] = (countsByPlatform[plat] || 0) + 1;
      if (r.calibratedScore != null) calibratedOverlap++;
      updates.push({
        id: String(r.id),
        platform: plat,
        scope,
        title: String(r.title || "").slice(0, 80),
      });
    }

    const [calBeforeRows] = await conn.query(`
      SELECT COALESCE(calibrationStatus, '(NULL)') AS status, COUNT(*) AS cnt
      FROM videos GROUP BY calibrationStatus ORDER BY cnt DESC
    `);
    const calStatusBefore = Object.fromEntries(calBeforeRows.map((r) => [r.status, Number(r.cnt)]));

    // Cross-check against craft_recipes 439 source videos via audit JSON if present
    let craftRecipesOverlap = 0;
    if (fs.existsSync(AUDIT_JSON_PATH)) {
      const auditDoc = JSON.parse(fs.readFileSync(AUDIT_JSON_PATH, "utf8"));
      craftRecipesOverlap = (auditDoc.craft_recipes_439_audit?.confirmed_unwatched_in_tidb || []).length;
    }

    const dryRunSummary = {
      executed_at: new Date().toISOString(),
      mode: dryRun ? "dry_run_select_only" : "apply",
      worker,
      apply_lock_status: lock,
      pre_d_backup_sha256_verified: actualBackupSha,
      tidb_total_rows: rows.length,
      column_analysisObservationScope_exists: columnExists,
      planned_ddl: columnExists
        ? null
        : "ALTER TABLE `videos` ADD COLUMN `analysisObservationScope` VARCHAR(40) NULL DEFAULT NULL AFTER `calibrationGenreBucket`",
      planned_updates_total: updates.length,
      counts_by_scope: countsByScope,
      counts_by_platform: countsByPlatform,
      overlap_with_phase3_calibrated_rows: calibratedOverlap,
      overlap_with_craft_recipes_439_sources: craftRecipesOverlap,
      tidb_calibration_status_snapshot: calStatusBefore,
      non_destructive_guarantees: [
        "aiAnalysis / legacy 8 score columns / all 40 original columns: ZERO modifications",
        "10 Phase 3 calibrated* / calibrationStatus columns: ZERO modifications",
        "updatedAt = updatedAt preserved on every updated row",
      ],
      sample_updates: updates.slice(0, 12),
    };

    if (dryRun) {
      fs.mkdirSync(path.dirname(DRYRUN_OUT_PATH), { recursive: true });
      fs.writeFileSync(DRYRUN_OUT_PATH, JSON.stringify(dryRunSummary, null, 2) + "\n", "utf8");
      console.log("DRY-RUN SUMMARY (ZERO TiDB WRITES):");
      console.log(JSON.stringify(dryRunSummary, null, 2));
      return;
    }

    // Real --apply path (only runs when explicitly approved + lock held!)
    const backupRoot = backupDirArg || process.env.IKETERU_BACKUP_ROOT || path.dirname(backupManifest.backup_dir);
    const preApplyBackup = await dumpFreshPreApplyBackup(conn, backupRoot);

    if (!columnExists) {
      await conn.query(
        "ALTER TABLE `videos` ADD COLUMN `analysisObservationScope` VARCHAR(40) NULL DEFAULT NULL AFTER `calibrationGenreBucket`"
      );
    }

    let affected = 0;
    const sqlUpd = "UPDATE `videos` SET `analysisObservationScope` = ?, `updatedAt` = `updatedAt` WHERE `id` = ?";
    for (const u of updates) {
      const [res] = await conn.execute(sqlUpd, [u.scope, u.id]);
      affected += Number(res.affectedRows ?? 0);
    }

    // Post-apply exhaustive verification
    const [scopeAfterRows] = await conn.query(`
      SELECT COALESCE(analysisObservationScope, '(NULL)') AS scope, COUNT(*) AS cnt
      FROM videos GROUP BY analysisObservationScope ORDER BY cnt DESC
    `);
    const scopeAfter = Object.fromEntries(scopeAfterRows.map((r) => [r.scope, Number(r.cnt)]));

    const [calAfterRows] = await conn.query(`
      SELECT COALESCE(calibrationStatus, '(NULL)') AS status, COUNT(*) AS cnt
      FROM videos GROUP BY calibrationStatus ORDER BY cnt DESC
    `);
    const calStatusAfter = Object.fromEntries(calAfterRows.map((r) => [r.status, Number(r.cnt)]));

    const originalColumns = backupManifest.tidb.columns;
    const calibrationColumns = [
      "calibrationStatus",
      "calibratedScore",
      "calibratedRank",
      "calibratedTierBand",
      "calibratedBreakdown",
      "calibrationVersion",
      "calibratedAt",
      "calibratedRoute",
      "calibratedRunId",
      "calibrationGenreBucket",
    ];
    const backupMap = new Map();
    for (const line of fs.readFileSync(backupJsonlPath, "utf8").split("\n").filter(Boolean)) {
      const obj = JSON.parse(line);
      backupMap.set(obj.id, obj);
    }
    const preApplyMap = new Map();
    for (const line of fs.readFileSync(preApplyBackup.jsonl_path, "utf8").split("\n").filter(Boolean)) {
      const obj = JSON.parse(line);
      preApplyMap.set(obj.id, obj);
    }
    const allCheckColumns = [...originalColumns, ...calibrationColumns];
    const colSelect = allCheckColumns.map((c) => `\`${c}\``).join(", ");
    const [liveRows] = await conn.query(`SELECT ${colSelect} FROM videos ORDER BY id ASC`);
    let origMismatches = 0;
    let legacyMismatches = 0;
    let updatedAtMismatches = 0;
    let calibration10Mismatches = 0;
    for (const row of liveRows) {
      const b = backupMap.get(row.id);
      if (!b) {
        origMismatches++;
      } else {
        for (const col of originalColumns) {
          if (serializeValue(row[col]) !== b[col]) {
            origMismatches++;
            if (LEGACY_SCORE_COLUMNS.has(col)) legacyMismatches++;
            if (col === "updatedAt") updatedAtMismatches++;
          }
        }
      }
      const p = preApplyMap.get(row.id);
      if (!p) {
        calibration10Mismatches++;
      } else {
        for (const col of calibrationColumns) {
          if (serializeValue(row[col]) !== p[col]) {
            calibration10Mismatches++;
          }
        }
      }
    }

    const checks = {
      apply_lock_verified: lockMatches,
      pre_apply_backup_created: preApplyBackup.row_count === 5653 && Boolean(preApplyBackup.jsonl_sha256),
      row_count_matches_5653: liveRows.length === 5653,
      all_40_original_columns_zero_diffs: origMismatches === 0,
      legacy_8_columns_zero_diffs: legacyMismatches === 0,
      all_10_calibration_columns_zero_diffs: calibration10Mismatches === 0,
      updated_at_zero_diffs: updatedAtMismatches === 0,
      calibration_status_counts_unchanged: JSON.stringify(calStatusBefore) === JSON.stringify(calStatusAfter),
      tagged_non_null_count_matches_payload:
        Object.entries(scopeAfter)
          .filter(([k]) => k !== "(NULL)")
          .reduce((acc, [, v]) => acc + v, 0) === updates.length,
    };

    const report = {
      executed_at: new Date().toISOString(),
      worker,
      lock_run_id: LOCK_RUN_ID,
      pre_apply_local_backup: preApplyBackup,
      planned_updates_total: updates.length,
      affected_rows: affected,
      scope_counts_after: scopeAfter,
      calibration_status_before: calStatusBefore,
      calibration_status_after: calStatusAfter,
      all_40_original_columns_mismatches: origMismatches,
      all_10_calibration_columns_mismatches: calibration10Mismatches,
      updated_at_mismatches: updatedAtMismatches,
      all_checks_passed: Object.values(checks).every(Boolean),
      checks,
    };
    fs.writeFileSync(APPLY_REPORT_OUT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log("APPLY VERIFICATION:");
    console.log(JSON.stringify(report, null, 2));
    if (!report.all_checks_passed) {
      throw new Error(`Post-apply verification failed: ${JSON.stringify(checks)}`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
