#!/usr/bin/env node
/**
 * Approved TiDB Original-40-Column Override List (D-024).
 *
 * Allows explicit, user-approved updates to original 40 columns (e.g. aiScoreBreakdown
 * visualVerificationStatus restoration or full aiAnalysis replacement) to pass the
 * Pre-D 40-column diff audit ONLY when (video_id, column, after_sha256) matches an
 * entry in `analysis/approved_tidb_overrides.json` with `status === "approved"` and
 * non-empty `approved_at`.
 *
 * Any diff not listed, pending approval, or with mismatched SHA-256 fails closed.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_APPROVED_OVERRIDES_PATH = path.resolve(
  __dirname,
  "..",
  "analysis",
  "approved_tidb_overrides.json"
);

export function serializeTidbCellValue(v) {
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return v.toString("utf8");
  return v;
}

export function sha256TidbCellValue(v) {
  const s = serializeTidbCellValue(v);
  if (s === null || s === undefined) return "NULL";
  return crypto.createHash("sha256").update(String(s), "utf8").digest("hex");
}

export function validateOverrideEntry(entry, idx = 0) {
  const errs = [];
  if (!entry || typeof entry !== "object") {
    return [`entry[${idx}]: not an object`];
  }
  for (const field of ["video_id", "column", "after_sha256", "reason", "decision_id"]) {
    if (!String(entry[field] || "").trim()) {
      errs.push(`entry[${idx}]: missing required field "${field}"`);
    }
  }
  if (entry.after_sha256 && !/^[0-9a-f]{64}$/i.test(String(entry.after_sha256)) && entry.after_sha256 !== "NULL") {
    errs.push(`entry[${idx}]: invalid after_sha256 "${entry.after_sha256}"`);
  }
  if (!["approved", "pending_approval"].includes(String(entry.status || ""))) {
    errs.push(`entry[${idx}]: invalid status "${entry.status}" (expected "approved" or "pending_approval")`);
  }
  if (entry.status === "approved" && !String(entry.approved_at || "").trim()) {
    errs.push(`entry[${idx}]: status="approved" requires non-empty approved_at timestamp`);
  }
  return errs;
}

export function loadApprovedTidbOverrides(filePath = DEFAULT_APPROVED_OVERRIDES_PATH, { includePending = false } = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { exists: false, file_path: filePath, entries: [], active_map: new Map() };
  }
  const doc = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const list = Array.isArray(doc.overrides) ? doc.overrides : [];
  const allErrors = [];
  list.forEach((entry, idx) => {
    allErrors.push(...validateOverrideEntry(entry, idx));
  });
  if (allErrors.length > 0) {
    throw new Error(`Invalid approved_tidb_overrides.json (${filePath}):\n - ${allErrors.join("\n - ")}`);
  }

  const activeMap = new Map();
  for (const entry of list) {
    const isActive = entry.status === "approved" || (includePending && entry.status === "pending_approval");
    if (!isActive) continue;
    const key = `${String(entry.video_id)}::${String(entry.column)}`;
    if (activeMap.has(key)) {
      throw new Error(`Duplicate approved override key "${key}" in ${filePath}`);
    }
    activeMap.set(key, entry);
  }
  return { exists: true, file_path: filePath, entries: list, active_map: activeMap };
}

export function auditOriginalColumnsAgainstPreD({
  liveRows,
  backupMap,
  originalColumns,
  legacyScoreColumns = new Set(),
  approvedOverrideMap = new Map(),
}) {
  let rowsCompared = 0;
  let totalCellsCompared = 0;
  let anyOriginalColMismatches = 0;
  let legacyScoreColMismatches = 0;
  let updatedAtMismatches = 0;
  const approvedMatches = [];
  const sampleMismatches = [];

  for (const row of liveRows) {
    const b = backupMap.get(row.id);
    if (!b) {
      anyOriginalColMismatches++;
      if (sampleMismatches.length < 10) {
        sampleMismatches.push({ id: row.id, col: "*", reason: "missing_in_pre_d_backup" });
      }
      continue;
    }
    rowsCompared++;
    for (const col of originalColumns) {
      totalCellsCompared++;
      const liveVal = serializeTidbCellValue(row[col]);
      const bakVal = b[col];
      if (liveVal !== bakVal) {
        const key = `${String(row.id)}::${col}`;
        const override = approvedOverrideMap.get(key);
        const liveSha = sha256TidbCellValue(liveVal);
        if (override && liveSha.toLowerCase() === String(override.after_sha256).toLowerCase()) {
          approvedMatches.push({
            video_id: String(row.id),
            column: col,
            after_sha256: liveSha,
            decision_id: override.decision_id,
            approved_at: override.approved_at,
            status: override.status,
          });
          continue;
        }
        anyOriginalColMismatches++;
        if (legacyScoreColumns.has(col)) legacyScoreColMismatches++;
        if (col === "updatedAt") updatedAtMismatches++;
        if (sampleMismatches.length < 10) {
          sampleMismatches.push({
            id: row.id,
            col,
            reason: override ? "approved_override_sha256_mismatch" : "unapproved_original_column_diff",
            expected_override_sha256: override?.after_sha256 ?? null,
            live_sha256: liveSha,
            backup_sha256: sha256TidbCellValue(bakVal),
          });
        }
      }
    }
  }

  return {
    rows_compared: rowsCompared,
    columns_compared_per_row: originalColumns.length,
    total_cells_compared: totalCellsCompared,
    approved_overrides_matched_count: approvedMatches.length,
    approved_overrides_matched: approvedMatches,
    legacy_8_score_columns_mismatches: legacyScoreColMismatches,
    all_40_original_columns_mismatches: anyOriginalColMismatches,
    updated_at_row_mismatches: updatedAtMismatches,
    sample_mismatches: sampleMismatches,
    passed: anyOriginalColMismatches === 0 && legacyScoreColMismatches === 0 && updatedAtMismatches === 0,
  };
}
