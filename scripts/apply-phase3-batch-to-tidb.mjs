#!/usr/bin/env node
/**
 * Phase 3 Step C — Apply Calibrated Batch Scores to TiDB (Source of Truth ONLY) + Exhaustive Audit.
 *
 * Guarantees:
 *  - Multi-PC write serialization: on real apply (non --dry-run), REQUIRES
 *    `analysis/claims/_apply_lock.json` to be `status === "locked"` for the exact
 *    `(worker, run_id)` (resolved via `--worker` or `IKETERU_WORKER_NAME`; NO OS hostname fallback).
 *  - Pre-flight gate verifies pre-D baseline backup JSONL SHA-256 on disk
 *    (path overrideable via `--pre-d-backup` or `IKETERU_PRE_D_BACKUP_PATH`).
 *  - Automatically takes a fresh local pre-apply TiDB snapshot backup before writing any rows.
 *  - Writes ONLY the 10 new calibrated* columns for the videos in phase3_batch_payload.json
 *  - Preserves `updatedAt = updatedAt` (never pollutes historical timestamps)
 *  - ZERO changes to any of the 8 legacy score columns or any of the 40 original columns
 *  - ZERO writes to local SQLite mirror (verified via SHA-256 when present)
 *  - Post-flight verification diffs ALL 5,653 rows × ALL 40 original columns against pre-D backup,
 *    verifying own `calibratedRunId = run_id` row count while recording cumulative multi-PC totals.
 *
 * Usage:
 *   node scripts/apply-phase3-batch-to-tidb.mjs <run_id> [--dry-run] [--apply] [--worker <name>]
 *     [--pre-d-backup <path>] [--sqlite <path>] [--backup-dir <dir>] [--allow-missing-sqlite]
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
        "(OS hostname fallback is disabled because multiple PCs share hostname 'CHIBA-PC'.)"
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

function localTimestampStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
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

function toMysqlTimestamp(isoStr) {
  const d = new Date(isoStr);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

async function dumpFreshPreApplyBackup(conn, runId, backupRoot) {
  const stamp = localTimestampStamp();
  const dir = path.join(backupRoot, `phase3_pre_apply_${runId}_${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, "tidb_videos_pre_apply.jsonl");

  const [rows] = await conn.query("SELECT * FROM videos ORDER BY id ASC");
  const fd = fs.openSync(outPath, "w");
  try {
    for (const row of rows) {
      const obj = {};
      for (const [k, v] of Object.entries(row)) {
        obj[k] = serializeValue(v);
      }
      fs.writeSync(fd, JSON.stringify(obj) + "\n", null, "utf8");
    }
  } finally {
    fs.closeSync(fd);
  }

  const stat = fs.statSync(outPath);
  const sha = sha256File(outPath);
  const meta = {
    created_at: new Date().toISOString(),
    purpose: `Fresh local pre-apply TiDB snapshot before applying ${runId}`,
    run_id: runId,
    row_count: rows.length,
    jsonl_path: outPath,
    jsonl_bytes: stat.size,
    jsonl_sha256: sha,
  };
  fs.writeFileSync(path.join(dir, "pre_apply_backup_meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");
  return meta;
}

export function findAlreadyCalibratedIds(existingRows) {
  const conflicts = [];
  for (const row of existingRows || []) {
    if (row && row.calibratedScore !== null && row.calibratedScore !== undefined) {
      conflicts.push({
        id: String(row.id),
        calibratedScore: Number(row.calibratedScore),
        calibrationVersion: row.calibrationVersion ?? null,
        calibratedRoute: row.calibratedRoute ?? null,
        calibratedRunId: row.calibratedRunId ?? null,
      });
    }
  }
  return conflicts;
}

export function validateApiUrlPayloadGate({ payload, runDir }) {
  const isApiUrl =
    payload?.calibration_version === "gemini_api_youtube_url_v1" ||
    (Array.isArray(payload?.updates) &&
      payload.updates.some((u) => u.calibratedRoute === "gemini_api_youtube_url_v1" || u.calibrationVersion === "gemini_api_youtube_url_v1"));
  if (!isApiUrl) {
    return { is_api_url: false, passed: true, errors: [] };
  }

  const errors = [];
  if (payload.bias_config_approved !== true) {
    errors.push("API URL payload requires bias_config_approved === true (user-approved bias correction)");
  }

  const anchorSet = new Set((payload.anchor_video_ids || []).map(String));
  for (const u of payload.updates || []) {
    if (anchorSet.has(String(u.id))) {
      errors.push(`Anchor video "${u.id}" must NOT appear in payload.updates`);
    }
  }

  const auditPath = path.join(runDir, "api_audit_report.json");
  if (!fs.existsSync(auditPath)) {
    errors.push(`Missing required API URL audit report: ${auditPath}`);
  } else {
    try {
      const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
      if (audit.all_checks_passed !== true) {
        errors.push(`API URL audit report did not pass all checks (all_checks_passed=${String(audit.all_checks_passed)})`);
      }
    } catch (err) {
      errors.push(`Failed to parse api_audit_report.json: ${err.message}`);
    }
  }

  return { is_api_url: true, passed: errors.length === 0, errors };
}

async function main() {
  loadDotenv();
  const runId = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  const allowMissingSqlite = process.argv.includes("--allow-missing-sqlite");
  const allowOverwrite = process.argv.includes("--allow-overwrite");
  const workerArg = getFlagValue(process.argv, "--worker");
  const preDBackupArg = getFlagValue(process.argv, "--pre-d-backup");
  const sqliteArg = getFlagValue(process.argv, "--sqlite");
  const backupDirArg = getFlagValue(process.argv, "--backup-dir");

  if (!runId || runId.startsWith("--")) {
    console.error(
      "Usage: node scripts/apply-phase3-batch-to-tidb.mjs <run_id> [--dry-run] [--apply] [--worker <name>] [--pre-d-backup <path>] [--sqlite <path>] [--backup-dir <dir>] [--allow-missing-sqlite]"
    );
    process.exit(2);
  }

  const runDir = path.join(REPO_ROOT, "analysis", "runs", runId);
  const payloadPath = path.join(runDir, "phase3_batch_payload.json");
  if (!fs.existsSync(payloadPath)) {
    throw new Error(`Missing payload file: ${payloadPath}`);
  }
  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  if (!Array.isArray(payload.updates) || payload.updates.length === 0) {
    throw new Error("Payload updates array is empty");
  }
  if (payload.updates.length > 200) {
    throw new Error(`Refusing to write >200 rows in one batch (got ${payload.updates.length})`);
  }

  // API URL payload pre-flight gate (no-op for existing phase2_v1 payloads)
  const apiGate = validateApiUrlPayloadGate({ payload, runDir });
  if (!apiGate.passed) {
    throw new Error(`API URL payload pre-flight gate failed:\n - ${apiGate.errors.join("\n - ")}`);
  }

  // Resolve worker and check multi-PC serialized TiDB apply lock
  const worker = resolveWorkerName(workerArg);
  const lock = loadApplyLock();
  const lockMatches = lock.status === "locked" && lock.run_id === runId && lock.worker === worker;
  if (!dryRun && !lockMatches) {
    throw new Error(
      `Refusing to write to TiDB without active write lock in analysis/claims/_apply_lock.json! ` +
        `Expected status="locked", worker="${worker}", run_id="${runId}", ` +
        `found=${JSON.stringify({ status: lock.status, worker: lock.worker, run_id: lock.run_id, started_at: lock.started_at })}. ` +
        `Run git pull --rebase, then: node scripts/claim-phase3-batch.mjs --acquire-apply-lock ${runId} --worker ${worker}, commit and push _apply_lock.json first.`
    );
  }

  // Verify pre-D baseline backup manifest & SHA-256 on disk
  const backupManifest = JSON.parse(fs.readFileSync(BACKUP_MANIFEST_PATH, "utf8"));
  const backupJsonlPath = preDBackupArg || process.env.IKETERU_PRE_D_BACKUP_PATH || backupManifest.tidb.jsonl_path;
  if (!fs.existsSync(backupJsonlPath)) {
    throw new Error(
      `Pre-D baseline backup not found at: ${backupJsonlPath}. ` +
        `Use each PC's local copy at ${backupManifest.tidb.jsonl_path} (or pass --pre-d-backup / set IKETERU_PRE_D_BACKUP_PATH) and verify SHA-256 ${backupManifest.tidb.jsonl_sha256}. ` +
        `When onboarding a new PC, temporarily share a copy from an existing PC and delete the temporary share after copying and verifying SHA-256.`
    );
  }
  const actualBackupSha = sha256File(backupJsonlPath);
  if (actualBackupSha !== backupManifest.tidb.jsonl_sha256) {
    throw new Error(`Pre-D backup SHA-256 mismatch! expected=${backupManifest.tidb.jsonl_sha256} actual=${actualBackupSha}`);
  }

  const sqlitePath = sqliteArg || process.env.IKETERU_SQLITE_PATH || backupManifest.sqlite.source_path;
  const sqliteExists = fs.existsSync(sqlitePath);
  if (!sqliteExists && !allowMissingSqlite) {
    throw new Error(
      `Local SQLite mirror not found at: ${sqlitePath}. ` +
        `Pass --sqlite <path> / set IKETERU_SQLITE_PATH, or pass --allow-missing-sqlite if this worker has no local SQLite file.`
    );
  }
  const sqliteShaBefore = sqliteExists ? sha256File(sqlitePath) : null;

  console.log(`Worker: ${worker}`);
  console.log(`Apply lock status: ${lock.status} (matches_this_run=${lockMatches})`);
  console.log(`Pre-flight pre-D backup SHA-256 verified: ${actualBackupSha} (${backupJsonlPath})`);
  console.log(`Pre-flight live SQLite SHA-256: ${sqliteShaBefore ?? "(missing — allowed by --allow-missing-sqlite)"}`);
  console.log(`Payload ready: run_id=${runId}, rows=${payload.updates.length}, dry_run=${dryRun}`);

  if (dryRun) {
    console.log("[DRY-RUN] Verified payload & pre-D backup SHA-256. Zero TiDB writes performed.");
    return;
  }

  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  const mysql = require("mysql2/promise");
  const backupRoot = backupDirArg || process.env.IKETERU_BACKUP_ROOT || path.dirname(backupManifest.backup_dir);

  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });

  try {
    // Guard against accidentally overwriting already-calibrated rows (e.g. anchor videos)
    const targetIds = payload.updates.map((u) => String(u.id));
    const [existingRows] = await conn.query(
      "SELECT id, calibratedScore, calibrationVersion, calibratedRoute, calibratedRunId FROM videos WHERE id IN (?)",
      [targetIds]
    );
    const overwriteConflicts = findAlreadyCalibratedIds(existingRows);
    if (overwriteConflicts.length > 0 && !allowOverwrite) {
      throw new Error(
        `Refusing to overwrite ${overwriteConflicts.length} already-calibrated row(s) in TiDB (pass --allow-overwrite only if explicitly intended): ${JSON.stringify(overwriteConflicts.slice(0, 10))}`
      );
    }

    // Take a fresh local pre-apply snapshot BEFORE touching any TiDB rows
    const preApplyBackup = await dumpFreshPreApplyBackup(conn, runId, backupRoot);
    console.log(
      `Fresh local pre-apply TiDB backup saved: ${preApplyBackup.jsonl_path} (rows=${preApplyBackup.row_count}, sha256=${preApplyBackup.jsonl_sha256})`
    );

    let totalAffected = 0;
    const sqlUpdate = `
      UPDATE \`videos\`
      SET
        \`calibrationStatus\` = ?,
        \`calibratedScore\` = ?,
        \`calibratedRank\` = ?,
        \`calibratedTierBand\` = ?,
        \`calibratedBreakdown\` = ?,
        \`calibrationVersion\` = ?,
        \`calibratedAt\` = ?,
        \`calibratedRoute\` = ?,
        \`calibratedRunId\` = ?,
        \`calibrationGenreBucket\` = ?,
        \`updatedAt\` = \`updatedAt\`
      WHERE \`id\` = ?
    `;

    for (const u of payload.updates) {
      const [res] = await conn.execute(sqlUpdate, [
        u.calibrationStatus,
        u.calibratedScore,
        u.calibratedRank,
        u.calibratedTierBand,
        JSON.stringify(u.calibratedBreakdown),
        u.calibrationVersion,
        toMysqlTimestamp(u.calibratedAt),
        u.calibratedRoute,
        u.calibratedRunId,
        u.calibrationGenreBucket,
        u.id,
      ]);
      totalAffected += Number(res.affectedRows ?? 0);
    }

    // Exhaustive post-write verification
    const [metaRows] = await conn.query("SELECT COUNT(*) AS cnt, MAX(updatedAt) AS max_upd FROM videos");
    const afterCount = Number(metaRows[0].cnt);
    const afterMaxUpd =
      metaRows[0].max_upd instanceof Date ? metaRows[0].max_upd.toISOString() : String(metaRows[0].max_upd);

    const [statusRows] = await conn.query(`
      SELECT COALESCE(calibrationStatus, '(NULL)') AS status, COUNT(*) AS cnt
      FROM videos
      GROUP BY calibrationStatus
      ORDER BY cnt DESC
    `);
    const statusCounts = Object.fromEntries(statusRows.map((r) => [r.status, Number(r.cnt)]));

    const [runRows] = await conn.query(
      "SELECT COUNT(*) AS cnt FROM videos WHERE calibratedRunId = ?",
      [runId]
    );
    const runCountInDb = Number(runRows[0].cnt);

    // Full 5,653 rows × 40 original columns diff against pre-D backup JSONL
    const originalColumns = backupManifest.tidb.columns;
    const backupMap = new Map();
    for (const line of fs.readFileSync(backupJsonlPath, "utf8").split("\n").filter(Boolean)) {
      const obj = JSON.parse(line);
      backupMap.set(obj.id, obj);
    }

    const colSelect = originalColumns.map((c) => `\`${c}\``).join(", ");
    const [liveRows] = await conn.query(`SELECT ${colSelect} FROM videos ORDER BY id ASC`);

    let rowsCompared = 0;
    let totalCellsCompared = 0;
    let anyOriginalColMismatches = 0;
    let legacyScoreColMismatches = 0;
    let updatedAtMismatches = 0;
    const sampleMismatches = [];

    for (const row of liveRows) {
      const b = backupMap.get(row.id);
      if (!b) {
        anyOriginalColMismatches++;
        continue;
      }
      rowsCompared++;
      for (const col of originalColumns) {
        totalCellsCompared++;
        const liveVal = serializeValue(row[col]);
        const bakVal = b[col];
        if (liveVal !== bakVal) {
          anyOriginalColMismatches++;
          if (LEGACY_SCORE_COLUMNS.has(col)) legacyScoreColMismatches++;
          if (col === "updatedAt") updatedAtMismatches++;
          if (sampleMismatches.length < 10) {
            sampleMismatches.push({ id: row.id, col, backup: bakVal, live: liveVal });
          }
        }
      }
    }

    const sqliteShaAfter = sqliteExists ? sha256File(sqlitePath) : null;
    const sqliteUntouched = sqliteExists ? sqliteShaAfter === sqliteShaBefore : true;

    const checks = {
      apply_lock_verified: lockMatches,
      pre_apply_backup_created: preApplyBackup.row_count === 5653 && Boolean(preApplyBackup.jsonl_sha256),
      row_count_matches_5653: afterCount === 5653 && rowsCompared === 5653,
      updated_rows_match_payload: runCountInDb === payload.updates.length,
      max_updated_at_unchanged: afterMaxUpd === backupManifest.tidb.max_updated_at,
      legacy_8_columns_zero_diffs: legacyScoreColMismatches === 0,
      all_40_original_columns_zero_diffs: anyOriginalColMismatches === 0,
      updated_at_per_row_zero_diffs: updatedAtMismatches === 0,
      sqlite_mirror_untouched: sqliteUntouched,
    };

    const applyReport = {
      executed_at: new Date().toISOString(),
      worker,
      run_id: runId,
      priority: payload.priority,
      batch_index: payload.batch_index,
      apply_lock_snapshot: lock,
      pre_d_baseline_backup: {
        path: backupJsonlPath,
        sha256: actualBackupSha,
      },
      pre_apply_local_backup: preApplyBackup,
      payload_count: payload.updates.length,
      affected_rows: totalAffected,
      tidb_rows_with_run_id: runCountInDb,
      tidb_calibration_status_counts: statusCounts,
      multi_pc_audit_note:
        "tidb_calibration_status_counts reflects cumulative calibrated rows across ALL PCs (including other PCs' completed runs); this run's integrity is verified by tidb_rows_with_run_id === payload_count and all_40_original_columns_zero_diffs === true.",
      max_updated_at_before: backupManifest.tidb.max_updated_at,
      max_updated_at_after: afterMaxUpd,
      full_row_diff_against_pre_d_backup: {
        rows_compared: rowsCompared,
        columns_compared_per_row: originalColumns.length,
        total_cells_compared: totalCellsCompared,
        legacy_8_score_columns_mismatches: legacyScoreColMismatches,
        all_40_original_columns_mismatches: anyOriginalColMismatches,
        updated_at_row_mismatches: updatedAtMismatches,
        sample_mismatches: sampleMismatches,
      },
      sqlite_check_mode: sqliteExists ? "sha256_verified" : "skipped_missing_local_sqlite",
      sqlite_path: sqlitePath,
      sqlite_source_sha256_before: sqliteShaBefore,
      sqlite_source_sha256_after: sqliteShaAfter,
      sqlite_untouched: sqliteUntouched,
      all_checks_passed: Object.values(checks).every(Boolean),
      checks,
    };

    const outPath = path.join(runDir, "tidb_apply_verification.json");
    fs.writeFileSync(outPath, JSON.stringify(applyReport, null, 2).replace(/\r\n/g, "\n") + "\n", "utf8");
    console.log("TIDB APPLY VERIFICATION:");
    console.log(JSON.stringify(applyReport, null, 2));

    if (!applyReport.all_checks_passed) {
      throw new Error(`Post-apply verification failed: ${JSON.stringify(checks)}`);
    }
  } finally {
    await conn.end();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
