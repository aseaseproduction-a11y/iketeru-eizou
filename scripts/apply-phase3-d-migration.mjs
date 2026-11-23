#!/usr/bin/env node
/**
 * Phase 3 Step D Executor + Full 5,653-Row Post-Migration Auditor (TiDB Source of Truth ONLY).
 *
 * Pre-flight gate:
 *   - Requires verified backup manifest (analysis/phase3_pre_d_backup_manifest.json)
 *   - Re-verifies backup JSONL file SHA-256 on disk before touching TiDB
 *
 * Writes ONLY:
 *   1. Additive DDL: 10 new calibration columns + 2 indexes on TiDB `videos`
 *   2. Initial status backfill: `calibrationStatus` = 'legacy_uncalibrated' | 'unscored'
 *      with explicit `updatedAt = updatedAt` (preserving historical timestamps)
 *   - ZERO changes to any of the 40 existing columns
 *   - ZERO changes to local SQLite mirror
 *
 * Post-verification:
 *   - Compares EVERY row (5,653) × EVERY original column (40) in live TiDB against backup JSONL
 *   - Verifies exact calibrationStatus counts, all calibrated* NULL, MAX(updatedAt) unchanged,
 *     and SQLite source SHA-256 unchanged.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BACKUP_MANIFEST_PATH = path.join(REPO_ROOT, "analysis", "phase3_pre_d_backup_manifest.json");
const REPORT_PATH = path.join(REPO_ROOT, "analysis", "phase3_d_migration_report.json");

const NEW_COLUMNS = [
  { name: "calibrationStatus", def: "varchar(32) DEFAULT NULL" },
  { name: "calibratedScore", def: "decimal(5,2) DEFAULT NULL" },
  { name: "calibratedRank", def: "varchar(8) DEFAULT NULL" },
  { name: "calibratedTierBand", def: "varchar(24) DEFAULT NULL" },
  { name: "calibratedBreakdown", def: "mediumtext DEFAULT NULL" },
  { name: "calibrationVersion", def: "varchar(32) DEFAULT NULL" },
  { name: "calibratedAt", def: "timestamp NULL DEFAULT NULL" },
  { name: "calibratedRoute", def: "varchar(32) DEFAULT NULL" },
  { name: "calibratedRunId", def: "varchar(64) DEFAULT NULL" },
  { name: "calibrationGenreBucket", def: "varchar(64) DEFAULT NULL" },
];

const NEW_INDEXES = [
  { name: "idx_videos_calibration_status", col: "calibrationStatus" },
  { name: "idx_videos_calibrated_run_id", col: "calibratedRunId" },
];

const LEGACY_SCORE_COLUMNS = [
  "aiOverallScore",
  "aiDirectionScore",
  "aiTechniqueScore",
  "aiScoreBreakdown",
  "aiOverallRating",
  "aiDirectionRating",
  "aiTechniqueRating",
  "aiAnalysis",
];

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

async function main() {
  if (!fs.existsSync(BACKUP_MANIFEST_PATH)) {
    throw new Error(`Missing backup manifest: ${BACKUP_MANIFEST_PATH}`);
  }
  const backupManifest = JSON.parse(fs.readFileSync(BACKUP_MANIFEST_PATH, "utf8"));
  const backupJsonlPath = backupManifest.tidb.jsonl_path;
  if (!fs.existsSync(backupJsonlPath)) {
    throw new Error(`Missing backup JSONL on disk: ${backupJsonlPath}`);
  }
  const actualBackupSha = sha256File(backupJsonlPath);
  if (actualBackupSha !== backupManifest.tidb.jsonl_sha256) {
    throw new Error(
      `Backup JSONL SHA-256 mismatch! expected=${backupManifest.tidb.jsonl_sha256} actual=${actualBackupSha}`
    );
  }
  console.log("Pre-flight backup SHA-256 verified:", actualBackupSha);

  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env") });
  const mysql = require("mysql2/promise");

  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });

  try {
    // 1. Additive DDL (idempotent)
    const [existingColRows] = await conn.query("DESCRIBE videos");
    const existingColSet = new Set(existingColRows.map((c) => c.Field));
    const addedColumns = [];
    for (const col of NEW_COLUMNS) {
      if (!existingColSet.has(col.name)) {
        await conn.query(`ALTER TABLE \`videos\` ADD \`${col.name}\` ${col.def}`);
        addedColumns.push(col.name);
      }
    }

    const [existingIdxRows] = await conn.query("SHOW INDEX FROM videos");
    const existingIdxSet = new Set(existingIdxRows.map((r) => r.Key_name));
    const addedIndexes = [];
    for (const idx of NEW_INDEXES) {
      if (!existingIdxSet.has(idx.name)) {
        await conn.query(`CREATE INDEX \`${idx.name}\` ON \`videos\` (\`${idx.col}\`)`);
        addedIndexes.push(idx.name);
      }
    }

    // 2. Initial D legacy tagging backfill (preserving updatedAt)
    const [updRes] = await conn.query(`
      UPDATE \`videos\`
      SET
        \`calibrationStatus\` = CASE
          WHEN \`aiOverallScore\` IS NOT NULL
            OR (\`aiOverallRating\` IS NOT NULL AND TRIM(\`aiOverallRating\`) != '')
          THEN 'legacy_uncalibrated'
          ELSE 'unscored'
        END,
        \`updatedAt\` = \`updatedAt\`
      WHERE \`calibrationStatus\` IS NULL
    `);

    // 3. Exhaustive post-verification
    const [afterColRows] = await conn.query("DESCRIBE videos");
    const afterCols = afterColRows.map((c) => c.Field);

    const [metaRows] = await conn.query(
      "SELECT COUNT(*) AS cnt, MAX(updatedAt) AS max_upd FROM videos"
    );
    const afterCount = Number(metaRows[0].cnt);
    const afterMaxUpd =
      metaRows[0].max_upd instanceof Date
        ? metaRows[0].max_upd.toISOString()
        : String(metaRows[0].max_upd);

    const [statusRows] = await conn.query(`
      SELECT COALESCE(calibrationStatus, '(NULL)') AS status, COUNT(*) AS cnt
      FROM videos
      GROUP BY calibrationStatus
      ORDER BY cnt DESC
    `);
    const statusCounts = Object.fromEntries(statusRows.map((r) => [r.status, Number(r.cnt)]));

    const [nonNullCalibRows] = await conn.query(`
      SELECT
        SUM(CASE WHEN calibratedScore IS NOT NULL THEN 1 ELSE 0 END) AS calibratedScore,
        SUM(CASE WHEN calibratedRank IS NOT NULL THEN 1 ELSE 0 END) AS calibratedRank,
        SUM(CASE WHEN calibratedTierBand IS NOT NULL THEN 1 ELSE 0 END) AS calibratedTierBand,
        SUM(CASE WHEN calibratedBreakdown IS NOT NULL THEN 1 ELSE 0 END) AS calibratedBreakdown,
        SUM(CASE WHEN calibrationVersion IS NOT NULL THEN 1 ELSE 0 END) AS calibrationVersion,
        SUM(CASE WHEN calibratedAt IS NOT NULL THEN 1 ELSE 0 END) AS calibratedAt,
        SUM(CASE WHEN calibratedRoute IS NOT NULL THEN 1 ELSE 0 END) AS calibratedRoute,
        SUM(CASE WHEN calibratedRunId IS NOT NULL THEN 1 ELSE 0 END) AS calibratedRunId,
        SUM(CASE WHEN calibrationGenreBucket IS NOT NULL THEN 1 ELSE 0 END) AS calibrationGenreBucket
      FROM videos
    `);
    const nonNullCalib = Object.fromEntries(
      Object.entries(nonNullCalibRows[0]).map(([k, v]) => [k, Number(v || 0)])
    );

    // 4. FULL ROW-BY-ROW comparison of all 5,653 rows × all 40 original columns against backup JSONL
    const originalColumns = backupManifest.tidb.columns;
    const backupMap = new Map();
    const backupLines = fs.readFileSync(backupJsonlPath, "utf8").split("\n").filter(Boolean);
    for (const line of backupLines) {
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

    const legacySet = new Set(LEGACY_SCORE_COLUMNS);
    for (const row of liveRows) {
      const b = backupMap.get(row.id);
      if (!b) {
        anyOriginalColMismatches++;
        if (sampleMismatches.length < 10) sampleMismatches.push({ id: row.id, error: "missing_in_backup" });
        continue;
      }
      rowsCompared++;
      for (const col of originalColumns) {
        totalCellsCompared++;
        const liveVal = serializeValue(row[col]);
        const bakVal = b[col];
        if (liveVal !== bakVal) {
          anyOriginalColMismatches++;
          if (legacySet.has(col)) legacyScoreColMismatches++;
          if (col === "updatedAt") updatedAtMismatches++;
          if (sampleMismatches.length < 10) {
            sampleMismatches.push({ id: row.id, col, backup: bakVal, live: liveVal });
          }
        }
      }
    }

    // 5. Verify SQLite source file is untouched
    const sqliteShaAfter = sha256File(backupManifest.sqlite.source_path);
    const sqliteUntouched = sqliteShaAfter === backupManifest.sqlite.source_sha256;

    const checks = {
      row_count_matches_5653: afterCount === 5653 && rowsCompared === 5653,
      column_count_is_50: afterCols.length === 50,
      status_counts_match_dryrun:
        statusCounts.legacy_uncalibrated === 5252 &&
        statusCounts.unscored === 401 &&
        !statusCounts["(NULL)"],
      all_calibrated_value_columns_null: Object.values(nonNullCalib).every((n) => n === 0),
      max_updated_at_unchanged: afterMaxUpd === backupManifest.tidb.max_updated_at,
      legacy_8_columns_zero_diffs: legacyScoreColMismatches === 0,
      all_40_original_columns_zero_diffs: anyOriginalColMismatches === 0,
      updated_at_per_row_zero_diffs: updatedAtMismatches === 0,
      sqlite_mirror_untouched: sqliteUntouched,
    };

    const report = {
      executed_at: new Date().toISOString(),
      step: "Phase 3 Step D (TiDB source-of-truth migration + initial legacy tagging)",
      backup_manifest_ref: "analysis/phase3_pre_d_backup_manifest.json",
      backup_dir: backupManifest.backup_dir,
      tidb_backup_jsonl_sha256: actualBackupSha,
      sqlite_backup_sha256: backupManifest.sqlite.backup_sha256,
      ddl_applied: {
        added_columns: addedColumns,
        added_indexes: addedIndexes,
        total_columns_after: afterCols.length,
      },
      backfill_affected_rows: Number(updRes.affectedRows ?? 0),
      post_verification: {
        row_count_after: afterCount,
        max_updated_at_before: backupManifest.tidb.max_updated_at,
        max_updated_at_after: afterMaxUpd,
        calibration_status_counts: statusCounts,
        calibrated_columns_non_null_counts: nonNullCalib,
        full_row_diff_against_backup: {
          rows_compared: rowsCompared,
          columns_compared_per_row: originalColumns.length,
          total_cells_compared: totalCellsCompared,
          legacy_8_score_columns_mismatches: legacyScoreColMismatches,
          all_40_original_columns_mismatches: anyOriginalColMismatches,
          updated_at_row_mismatches: updatedAtMismatches,
          sample_mismatches: sampleMismatches,
        },
        sqlite_source_sha256_after: sqliteShaAfter,
        sqlite_untouched: sqliteUntouched,
      },
      all_checks_passed: Object.values(checks).every(Boolean),
      checks,
    };

    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2).replace(/\r\n/g, "\n") + "\n", "utf8");
    console.log("STEP D REPORT:");
    console.log(JSON.stringify(report, null, 2));

    if (!report.all_checks_passed) {
      throw new Error(`Post-migration verification failed: ${JSON.stringify(checks)}`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
