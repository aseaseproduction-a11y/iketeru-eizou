#!/usr/bin/env node
/**
 * Phase 3 Step C — Apply Calibrated Batch Scores to TiDB (Source of Truth ONLY) + Exhaustive Audit.
 *
 * Guarantees:
 *  - Pre-flight gate verifies pre-D backup JSONL SHA-256 on disk
 *  - Writes ONLY the 10 new calibrated* columns for the videos in phase3_batch_payload.json
 *  - Preserves `updatedAt = updatedAt` (never pollutes historical timestamps)
 *  - ZERO changes to any of the 8 legacy score columns or any of the 40 original columns
 *  - ZERO writes to local SQLite mirror (verified via SHA-256)
 *  - Post-flight verification diffs ALL 5,653 rows × ALL 40 original columns against pre-D backup
 *
 * Usage:
 *   node scripts/apply-phase3-batch-to-tidb.mjs <run_id> [--dry-run]
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BACKUP_MANIFEST_PATH = path.join(REPO_ROOT, "analysis", "phase3_pre_d_backup_manifest.json");

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

async function main() {
  const runId = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!runId) {
    console.error("Usage: node scripts/apply-phase3-batch-to-tidb.mjs <run_id> [--dry-run]");
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

  // Verify pre-D backup manifest & SHA-256 on disk
  const backupManifest = JSON.parse(fs.readFileSync(BACKUP_MANIFEST_PATH, "utf8"));
  const backupJsonlPath = backupManifest.tidb.jsonl_path;
  const actualBackupSha = sha256File(backupJsonlPath);
  if (actualBackupSha !== backupManifest.tidb.jsonl_sha256) {
    throw new Error(`Pre-D backup SHA-256 mismatch! expected=${backupManifest.tidb.jsonl_sha256} actual=${actualBackupSha}`);
  }
  const sqliteShaBefore = sha256File(backupManifest.sqlite.source_path);
  console.log(`Pre-flight pre-D backup SHA-256 verified: ${actualBackupSha}`);
  console.log(`Pre-flight live SQLite SHA-256 recorded: ${sqliteShaBefore}`);
  console.log(`Payload ready: run_id=${runId}, rows=${payload.updates.length}, dry_run=${dryRun}`);

  if (dryRun) {
    console.log("[DRY-RUN] Verified payload & backup SHA-256. Zero TiDB writes performed.");
    return;
  }

  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env") });
  const mysql = require("mysql2/promise");

  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });

  try {
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

    const sqliteShaAfter = sha256File(backupManifest.sqlite.source_path);
    const sqliteUntouched = sqliteShaAfter === sqliteShaBefore;

    const checks = {
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
      run_id: runId,
      priority: payload.priority,
      batch_index: payload.batch_index,
      payload_count: payload.updates.length,
      affected_rows: totalAffected,
      tidb_rows_with_run_id: runCountInDb,
      tidb_calibration_status_counts: statusCounts,
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
