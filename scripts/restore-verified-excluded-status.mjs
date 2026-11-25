#!/usr/bin/env node
/**
 * Dry-run & apply tool for restoring visually verified videos currently excluded by
 * `provisional` / `invalidated_no_visual` flags in TiDB `videos`.
 *
 * CRITICAL 40-COLUMN / 8-LEGACY-COLUMN AUDIT NOTICE:
 *   `videos.aiScoreBreakdown` IS one of the 40 original columns AND one of the 8 legacy
 *   score columns checked by `scripts/apply-phase3-batch-to-tidb.mjs` against the Pre-D
 *   baseline (`phase3_pre_d_20261123_153343/tidb_videos_backup.jsonl`, SHA-256 17856f03...).
 *
 *   Therefore this script documents & supports two modes (default: --dry-run ONLY):
 *     - --mode new-column (RECOMMENDED, ZERO impact on Pre-D 40-column diff):
 *         Stores the verified restoration decision in a NEW column outside the original 40 columns
 *         (`visualAuditOverride` JSON, nullable) so `all_40_original_columns_zero_diffs` and
 *         `legacy_8_columns_zero_diffs` remain 0 without touching the Pre-D baseline.
 *     - --mode ai-score-breakdown (LEGACY IN-PLACE, BREAKS 40-col 0-diff unless allowlisted):
 *         Updates `aiScoreBreakdown` JSON fields (`analysisStatus`, `isProvisional`,
 *         `visualVerificationStatus`, `invalidatedNoVisual`). Requires updating Phase 3
 *         post-apply audit to allowlist these exact rows/column.
 *
 * Usage:
 *   node scripts/restore-verified-excluded-status.mjs --ids O1DQObWYYLQ --mode new-column --dry-run --worker chibatmute
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const APPLY_LOCK_PATH = path.join(REPO_ROOT, "analysis", "claims", "_apply_lock.json");
const PRE_D_MANIFEST_PATH = path.join(REPO_ROOT, "analysis", "phase3_pre_d_backup_manifest.json");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) args[k] = true;
      else { args[k] = next; i++; }
    }
  }
  return args;
}

async function main() {
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
  const mysql = require("mysql2/promise");

  const args = parseArgs(process.argv);
  const dryRun = !Boolean(args.apply);
  const mode = String(args.mode || "new-column");
  if (!["new-column", "ai-score-breakdown"].includes(mode)) {
    throw new Error(`Invalid --mode "${mode}". Use "new-column" or "ai-score-breakdown".`);
  }
  const worker = String(args.worker || process.env.IKETERU_WORKER_NAME || "").trim();
  if (!worker) throw new Error("--worker or IKETERU_WORKER_NAME is required");

  const ids = String(args.ids || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    throw new Error("--ids <id1,id2,...> is required");
  }

  const preDManifest = JSON.parse(fs.readFileSync(PRE_D_MANIFEST_PATH, "utf8"));
  const originalCols = new Set(preDManifest.tidb.columns || []);
  const lock = fs.existsSync(APPLY_LOCK_PATH) ? JSON.parse(fs.readFileSync(APPLY_LOCK_PATH, "utf8")) : { status: "unlocked" };

  if (!dryRun) {
    throw new Error(
      "Refusing --apply until user explicitly approves the restoration mode (new-column vs ai-score-breakdown) and acquires _apply_lock.json."
    );
  }

  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });

  try {
    const placeholders = ids.map(() => "?").join(",");
    const [rows] = await conn.query(
      `SELECT id, title, platform, calibratedScore, calibratedRank, calibratedRunId, aiScoreBreakdown FROM videos WHERE id IN (${placeholders})`,
      ids
    );

    const plannedChanges = rows.map((r) => {
      let bd = {};
      try { bd = r.aiScoreBreakdown ? JSON.parse(r.aiScoreBreakdown) : {}; } catch {}

      if (mode === "new-column") {
        return {
          id: r.id,
          title: r.title,
          target_column: "visualAuditOverride",
          is_in_original_40_columns: originalCols.has("visualAuditOverride"),
          before: {
            aiScoreBreakdown_analysisStatus: bd.analysisStatus ?? null,
            aiScoreBreakdown_visualVerificationStatus: bd.visualVerificationStatus ?? null,
            visualAuditOverride: "(new nullable column outside original 40 columns)",
          },
          after: {
            aiScoreBreakdown: "(UNCHANGED — 0 diff on original 40 columns & 8 legacy columns)",
            visualAuditOverride: {
              schema_version: 1,
              decision: "restored_visual_verified",
              verdict: "合っている",
              verified_by_worker: worker,
              verified_model: "gemini-4-neon-high",
              verified_at: new Date().toISOString(),
              supersedes_flags: {
                analysisStatus: bd.analysisStatus ?? null,
                visualVerificationStatus: bd.visualVerificationStatus ?? null,
              },
            },
          },
        };
      }

      const nextBd = {
        ...bd,
        analysisStatus: "full_analysis",
        isProvisional: false,
        visualVerificationStatus: "log_verified",
        invalidatedNoVisual: false,
        visualChecked: true,
        restoredByAudit: {
          verified_by_worker: worker,
          verified_model: "gemini-4-neon-high",
          verified_at: new Date().toISOString(),
          previous_visualVerificationStatus: bd.visualVerificationStatus ?? null,
          previous_analysisStatus: bd.analysisStatus ?? null,
        },
      };
      return {
        id: r.id,
        title: r.title,
        target_column: "aiScoreBreakdown",
        is_in_original_40_columns: originalCols.has("aiScoreBreakdown"),
        before: {
          analysisStatus: bd.analysisStatus ?? null,
          isProvisional: bd.isProvisional ?? null,
          visualVerificationStatus: bd.visualVerificationStatus ?? null,
          invalidatedNoVisual: bd.invalidatedNoVisual ?? null,
        },
        after: {
          analysisStatus: nextBd.analysisStatus,
          isProvisional: nextBd.isProvisional,
          visualVerificationStatus: nextBd.visualVerificationStatus,
          invalidatedNoVisual: nextBd.invalidatedNoVisual,
        },
      };
    });

    console.log(
      JSON.stringify(
        {
          mode,
          dry_run: true,
          worker,
          apply_lock_status: lock.status,
          pre_d_40_column_audit_impact:
            mode === "new-column"
              ? "SAFE: visualAuditOverride is outside the original 40 columns; apply-phase3-batch-to-tidb.mjs all_40_original_columns_zero_diffs and legacy_8_columns_zero_diffs remain 0."
              : "WARNING: aiScoreBreakdown IS in both the original 40 columns and the 8 legacy score columns; modifying it will cause apply-phase3-batch-to-tidb.mjs post-apply 0-diff audit to fail unless an explicit allowlist is added.",
          required_apply_procedure: [
            "1. User reviews & approves this --dry-run output and chooses mode (new-column vs ai-score-breakdown).",
            "2. git pull --rebase --autostash origin main",
            "3. node scripts/claim-phase3-batch.mjs --apply-lock-status (confirm unlocked)",
            "4. node scripts/claim-phase3-batch.mjs --acquire-apply-lock restore_excluded_<stamp> --worker chibatmute && git add analysis/claims/_apply_lock.json && git commit && git push",
            "5. Take fresh pre-apply TiDB snapshot backup to E:\\iketeru_backups\\",
            "6. Execute approved UPDATE with updatedAt = updatedAt (preserve historical timestamps)",
            "7. Verify row count & 40-column diff",
            "8. Release _apply_lock.json && git commit && git push",
            "9. Run sync-tidb-to-sqlite-mirror.mjs on all 3 PCs",
          ],
          matched_rows: rows.length,
          planned_changes: plannedChanges,
        },
        null,
        2
      )
    );
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
