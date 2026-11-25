#!/usr/bin/env node
/**
 * Dry-run planner & Pre-D 40-column approved-override verifier for TiDB `videos` updates (D-024).
 *
 * Uses the "Approved Override List" approach (`analysis/approved_tidb_overrides.json`):
 *   - No schema changes to production TiDB.
 *   - Each planned original-40-column change is hashed (SHA-256) and recorded with
 *     (video_id, column, after_sha256, reason, decision_id, approved_at, status).
 *   - `apply-phase3-batch-to-tidb.mjs` allows ONLY diffs matching status="approved" + exact SHA-256.
 *   - IMPORTANT: Compact JSON (`JSON.stringify(obj)` without pretty spaces) MUST be used for
 *     `aiScoreBreakdown` because `server/db.ts` uses SQL `LIKE '%"visualVerificationStatus":"log_verified"%'`.
 *
 * Default mode is strictly --dry-run (ZERO TiDB writes).
 *
 * Usage:
 *   node scripts/restore-verified-excluded-status.mjs --dry-run --worker chibatmute \
 *     --restore-visual-ids O1DQObWYYLQ \
 *     --replace-analysis 1018644295=E:\iketeru_tmp\craft_pilot_20261125\remade_analyses\1018644295_full_ai_analysis.md,Gwgo9GS4mVM=E:\iketeru_tmp\craft_pilot_20261125\remade_analyses\Gwgo9GS4mVM_full_ai_analysis.md \
 *     [--write-pending-overrides analysis/approved_tidb_overrides.json]
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_APPROVED_OVERRIDES_PATH,
  auditOriginalColumnsAgainstPreD,
  serializeTidbCellValue,
  sha256TidbCellValue,
} from "./approved-tidb-overrides.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const APPLY_LOCK_PATH = path.join(REPO_ROOT, "analysis", "claims", "_apply_lock.json");
const PRE_D_MANIFEST_PATH = path.join(REPO_ROOT, "analysis", "phase3_pre_d_backup_manifest.json");

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

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) args[k] = true;
      else {
        args[k] = next;
        i++;
      }
    }
  }
  return args;
}

function parseReplaceAnalysisArg(raw) {
  const map = new Map();
  if (!raw) return map;
  for (const item of String(raw).split(",").map((s) => s.trim()).filter(Boolean)) {
    const eq = item.indexOf("=");
    if (eq <= 0) throw new Error(`Invalid --replace-analysis entry "${item}" (expected video_id=file_path)`);
    const vid = item.slice(0, eq).trim();
    const fpath = item.slice(eq + 1).trim();
    if (!fs.existsSync(fpath)) throw new Error(`Analysis file not found for ${vid}: ${fpath}`);
    map.set(vid, { path: fpath, content: fs.readFileSync(fpath, "utf8") });
  }
  return map;
}

async function main() {
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
  const mysql = require("mysql2/promise");

  const args = parseArgs(process.argv);
  const dryRun = !Boolean(args.apply);
  const worker = String(args.worker || process.env.IKETERU_WORKER_NAME || "").trim();
  if (!worker) throw new Error("--worker or IKETERU_WORKER_NAME is required");

  if (!dryRun) {
    throw new Error(
      "Refusing --apply until user explicitly approves analysis/approved_tidb_overrides.json (status='approved' with approved_at) and acquires _apply_lock.json."
    );
  }

  const restoreIds = String(args["restore-visual-ids"] || args.ids || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const replaceAnalysisMap = parseReplaceAnalysisArg(args["replace-analysis"]);
  const allTargetIds = [...new Set([...restoreIds, ...replaceAnalysisMap.keys()])];
  if (allTargetIds.length === 0) {
    throw new Error("Specify --restore-visual-ids and/or --replace-analysis");
  }

  const preDManifest = JSON.parse(fs.readFileSync(PRE_D_MANIFEST_PATH, "utf8"));
  const originalColumns = preDManifest.tidb.columns;
  const backupJsonlPath = args["pre-d-backup"] || process.env.IKETERU_PRE_D_BACKUP_PATH || preDManifest.tidb.jsonl_path;
  if (!fs.existsSync(backupJsonlPath)) {
    throw new Error(`Pre-D baseline backup not found: ${backupJsonlPath}`);
  }
  const lock = fs.existsSync(APPLY_LOCK_PATH) ? JSON.parse(fs.readFileSync(APPLY_LOCK_PATH, "utf8")) : { status: "unlocked" };

  // Load Pre-D baseline rows (5,653 rows × 40 original columns)
  const backupMap = new Map();
  for (const line of fs.readFileSync(backupJsonlPath, "utf8").split("\n").filter(Boolean)) {
    const obj = JSON.parse(line);
    backupMap.set(obj.id, obj);
  }

  // Read live TiDB rows (READ-ONLY) for accurate diff + audit simulation
  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });

  let liveRows = [];
  try {
    const colSelect = originalColumns.map((c) => `\`${c}\``).join(", ");
    const [rows] = await conn.query(`SELECT ${colSelect} FROM videos ORDER BY id ASC`);
    liveRows = rows;
  } finally {
    await conn.end();
  }

  const liveById = new Map(liveRows.map((r) => [String(r.id), r]));
  const plannedOverrides = [];
  const plannedDetails = [];
  const simulatedMutations = new Map(); // video_id -> { col: newVal }

  for (const vid of restoreIds) {
    const row = liveById.get(vid);
    if (!row) throw new Error(`Video ID not found in TiDB: ${vid}`);
    const beforeStr = serializeTidbCellValue(row.aiScoreBreakdown);
    let bd = {};
    try {
      bd = beforeStr ? JSON.parse(beforeStr) : {};
    } catch {
      bd = {};
    }
    const nextBd = {
      ...bd,
      analysisStatus: "full_analysis",
      isProvisional: false,
      visualVerificationStatus: "log_verified",
      invalidatedNoVisual: false,
      visualChecked: true,
      status: "visual_audit_verified",
      note: "実映像点検（2026-11-25, Antigravity gemini-4-neon-high）にて時刻・映像・技法・音の4軸一致を確認し復帰承認待ち。",
      restoredByAudit: {
        decision_id: "D-024",
        verdict: "合っている",
        verified_by_worker: worker,
        verified_model: "gemini-4-neon-high",
        previous_visualVerificationStatus: bd.visualVerificationStatus ?? null,
        previous_analysisStatus: bd.analysisStatus ?? null,
      },
    };
    // MUST be compact JSON (no spaces) to match server/db.ts LIKE '%"visualVerificationStatus":"log_verified"%'
    const afterStr = JSON.stringify(nextBd);
    const entry = {
      video_id: vid,
      column: "aiScoreBreakdown",
      after_sha256: sha256TidbCellValue(afterStr),
      reason: "Visual audit passed (verdict: 合っている; restore visualVerificationStatus=log_verified, invalidatedNoVisual=false)",
      decision_id: "D-024",
      approved_at: null,
      status: "pending_approval",
    };
    plannedOverrides.push(entry);
    const m = simulatedMutations.get(vid) || {};
    m.aiScoreBreakdown = afterStr;
    simulatedMutations.set(vid, m);
    plannedDetails.push({
      video_id: vid,
      title: row.title,
      column: "aiScoreBreakdown",
      before_sha256: sha256TidbCellValue(beforeStr),
      after_sha256: entry.after_sha256,
      before_flags: {
        analysisStatus: bd.analysisStatus ?? null,
        isProvisional: bd.isProvisional ?? null,
        visualVerificationStatus: bd.visualVerificationStatus ?? null,
        invalidatedNoVisual: bd.invalidatedNoVisual ?? null,
      },
      after_flags: {
        analysisStatus: nextBd.analysisStatus,
        isProvisional: nextBd.isProvisional,
        visualVerificationStatus: nextBd.visualVerificationStatus,
        invalidatedNoVisual: nextBd.invalidatedNoVisual,
      },
      matches_server_db_sql_like: afterStr.includes('"visualVerificationStatus":"log_verified"'),
    });
  }

  for (const [vid, info] of replaceAnalysisMap.entries()) {
    const row = liveById.get(vid);
    if (!row) throw new Error(`Video ID not found in TiDB: ${vid}`);
    const beforeStr = serializeTidbCellValue(row.aiAnalysis);
    const afterStr = info.content;
    const entry = {
      video_id: vid,
      column: "aiAnalysis",
      after_sha256: sha256TidbCellValue(afterStr),
      reason: `Replace truncated/mismatched analysis with visually verified full 10-chapter analysis (${afterStr.length} chars, 0 backticks)`,
      decision_id: "D-024",
      approved_at: null,
      status: "pending_approval",
    };
    plannedOverrides.push(entry);
    const m = simulatedMutations.get(vid) || {};
    m.aiAnalysis = afterStr;
    simulatedMutations.set(vid, m);

    let bd = {};
    try {
      bd = row.aiScoreBreakdown ? JSON.parse(serializeTidbCellValue(row.aiScoreBreakdown)) : {};
    } catch {}
    plannedDetails.push({
      video_id: vid,
      title: row.title,
      column: "aiAnalysis",
      source_file: info.path,
      before_chars: beforeStr ? beforeStr.length : 0,
      after_chars: afterStr.length,
      after_backticks: (afterStr.match(/`/g) || []).length,
      before_sha256: sha256TidbCellValue(beforeStr),
      after_sha256: entry.after_sha256,
      note_on_provisional_flag:
        bd.analysisStatus === "provisional" || bd.isProvisional === true
          ? "NOTE: This row ALSO has analysisStatus='provisional' / isProvisional=true in aiScoreBreakdown; to make it visible in site/MCP searches, an additional aiScoreBreakdown override entry will be needed when approved."
          : null,
    });
  }

  if (args["write-pending-overrides"]) {
    const outPath = path.resolve(args["write-pending-overrides"] === true ? DEFAULT_APPROVED_OVERRIDES_PATH : args["write-pending-overrides"]);
    const doc = {
      schema_version: 1,
      description:
        "Approved TiDB original-40-column override list (D-024). Entries take effect in Pre-D audits ONLY when status === 'approved' and approved_at is set.",
      overrides: plannedOverrides,
    };
    fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
  }

  // Simulate applying ONLY the planned overrides onto the live 5,653 rows (in memory only!)
  const simulatedLiveRows = liveRows.map((row) => {
    const mut = simulatedMutations.get(String(row.id));
    return mut ? { ...row, ...mut } : row;
  });

  // 1. Audit WITH the 3 planned overrides active (simulating post-approval) -> MUST PASS
  const simApprovedMap = new Map(plannedOverrides.map((e) => [`${e.video_id}::${e.column}`, { ...e, status: "approved", approved_at: "SIMULATED_DRY_RUN" }]));
  const auditWithApproved = auditOriginalColumnsAgainstPreD({
    liveRows: simulatedLiveRows,
    backupMap,
    originalColumns,
    legacyScoreColumns: LEGACY_SCORE_COLUMNS,
    approvedOverrideMap: simApprovedMap,
  });

  // 2. Audit WITHOUT overrides (strict current state) -> MUST FAIL with exact count = plannedOverrides.length
  const auditWithoutApproved = auditOriginalColumnsAgainstPreD({
    liveRows: simulatedLiveRows,
    backupMap,
    originalColumns,
    legacyScoreColumns: LEGACY_SCORE_COLUMNS,
    approvedOverrideMap: new Map(),
  });

  // 3. Negative audit test: tamper 1 unlisted column on first target -> MUST FAIL
  const tamperedRows = simulatedLiveRows.map((row) =>
    String(row.id) === allTargetIds[0] ? { ...row, title: `${row.title} [TAMPERED]` } : row
  );
  const auditWithUnlistedDiff = auditOriginalColumnsAgainstPreD({
    liveRows: tamperedRows,
    backupMap,
    originalColumns,
    legacyScoreColumns: LEGACY_SCORE_COLUMNS,
    approvedOverrideMap: simApprovedMap,
  });

  console.log(
    JSON.stringify(
      {
        mode: "approved-override",
        dry_run: true,
        tidb_writes_performed: 0,
        worker,
        apply_lock_status: lock.status,
        planned_overrides_count: plannedOverrides.length,
        planned_changes: plannedDetails,
        pre_d_audit_simulation: {
          rows_compared: auditWithApproved.rows_compared,
          columns_per_row: auditWithApproved.columns_compared_per_row,
          total_cells_compared: auditWithApproved.total_cells_compared,
          with_approved_list: {
            passed: auditWithApproved.passed,
            approved_overrides_matched_count: auditWithApproved.approved_overrides_matched_count,
            unapproved_mismatches: auditWithApproved.all_40_original_columns_mismatches,
            legacy_8_mismatches: auditWithApproved.legacy_8_score_columns_mismatches,
          },
          without_approved_list_control: {
            passed: auditWithoutApproved.passed,
            unapproved_mismatches: auditWithoutApproved.all_40_original_columns_mismatches,
          },
          with_extra_unlisted_diff_control: {
            passed: auditWithUnlistedDiff.passed,
            unapproved_mismatches: auditWithUnlistedDiff.all_40_original_columns_mismatches,
            sample_mismatch: auditWithUnlistedDiff.sample_mismatches[0] ?? null,
          },
        },
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
