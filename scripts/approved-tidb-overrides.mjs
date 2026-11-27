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

export const DEFAULT_V3_STORE_DIR =
  process.env.IKETERU_ANALYSIS_V3_DIR || "D:\\マイドライブ\\iketeru_analysis_v3";

export const V3_STORE_EXCLUDED_DIRS = new Set(["_docs", "_prompts"]);

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Load verified Analysis v3 entries from canonical store (`iketeru_analysis_v3/`).
 * Supports both root `manifest.json` (if present with `entries`/`videos`) and
 * per-video `<video_id>/manifest.json` folders.
 *
 * Returns only entries whose `analysis_v3.md` SHA-256 matches `manifest.json` AND
 * whose `mechanical_check.json` passed all mechanical checks.
 */
export function loadV3CanonicalManifestMap(storeDir = DEFAULT_V3_STORE_DIR) {
  const validMap = new Map();
  const rejected = [];
  if (!storeDir || !fs.existsSync(storeDir)) {
    return { exists: false, store_dir: storeDir, valid_map: validMap, rejected };
  }

  const candidateIds = [];
  const rootManifestPath = path.join(storeDir, "manifest.json");
  if (fs.existsSync(rootManifestPath)) {
    try {
      const rootDoc = JSON.parse(fs.readFileSync(rootManifestPath, "utf8"));
      const list = Array.isArray(rootDoc.videos)
        ? rootDoc.videos
        : Array.isArray(rootDoc.entries)
        ? rootDoc.entries
        : rootDoc.videos && typeof rootDoc.videos === "object"
        ? Object.keys(rootDoc.videos)
        : [];
      for (const item of list) {
        const vid = typeof item === "string" ? item : String(item?.video_id || "");
        if (vid) candidateIds.push(vid);
      }
    } catch (err) {
      rejected.push({ video_id: "*", reason: `root_manifest_parse_error: ${err.message}` });
    }
  }

  if (candidateIds.length === 0) {
    for (const ent of fs.readdirSync(storeDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      if (V3_STORE_EXCLUDED_DIRS.has(ent.name)) continue;
      if (!fs.existsSync(path.join(storeDir, ent.name, "manifest.json"))) continue;
      candidateIds.push(ent.name);
    }
    candidateIds.sort();
  }

  for (const vid of candidateIds) {
    const dir = path.join(storeDir, vid);
    const mPath = path.join(dir, "manifest.json");
    const aPath = path.join(dir, "analysis_v3.md");
    const cPath = path.join(dir, "mechanical_check.json");
    if (!fs.existsSync(mPath) || !fs.existsSync(aPath) || !fs.existsSync(cPath)) {
      rejected.push({ video_id: vid, reason: "missing_required_v3_files" });
      continue;
    }
    try {
      const manifest = JSON.parse(fs.readFileSync(mPath, "utf8"));
      const check = JSON.parse(fs.readFileSync(cPath, "utf8"));
      if (String(manifest.video_id || "") !== vid) {
        rejected.push({ video_id: vid, reason: "manifest_video_id_mismatch" });
        continue;
      }
      const analysisBuf = fs.readFileSync(aPath);
      const analysisText = analysisBuf.toString("utf8");
      const actualAnalysisSha = sha256Buffer(analysisBuf);
      const expectedAnalysisSha = String(manifest.files?.["analysis_v3.md"]?.sha256 || "").toLowerCase();
      const expectedAnalysisBytes = manifest.files?.["analysis_v3.md"]?.bytes;
      if (!expectedAnalysisSha || actualAnalysisSha !== expectedAnalysisSha) {
        rejected.push({
          video_id: vid,
          reason: "analysis_v3_sha256_mismatch",
          expected: expectedAnalysisSha,
          actual: actualAnalysisSha,
        });
        continue;
      }
      if (typeof expectedAnalysisBytes === "number" && analysisBuf.length !== expectedAnalysisBytes) {
        rejected.push({
          video_id: vid,
          reason: "analysis_v3_bytes_mismatch",
          expected: expectedAnalysisBytes,
          actual: analysisBuf.length,
        });
        continue;
      }
      const checkBuf = fs.readFileSync(cPath);
      const actualCheckSha = sha256Buffer(checkBuf);
      const expectedCheckSha = String(manifest.files?.["mechanical_check.json"]?.sha256 || "").toLowerCase();
      if (expectedCheckSha && actualCheckSha !== expectedCheckSha) {
        rejected.push({ video_id: vid, reason: "mechanical_check_sha256_mismatch" });
        continue;
      }
      const mech = check.mechanical || {};
      const ta = check.transcript_audit || {};
      if (mech.all_passed !== true) {
        rejected.push({ video_id: vid, reason: "mechanical_check_not_passed", fail_reasons: mech.fail_reasons || [] });
        continue;
      }
      if (ta.ok !== true) {
        rejected.push({ video_id: vid, reason: "transcript_audit_not_ok" });
        continue;
      }
      if (check.prompt_sha256_verified === false) {
        rejected.push({ video_id: vid, reason: "prompt_sha256_not_verified" });
        continue;
      }
      const contentSha256 = sha256TidbCellValue(analysisText);
      validMap.set(vid, {
        video_id: vid,
        dir,
        analysis_path: aPath,
        manifest_path: mPath,
        check_path: cPath,
        analysis_text: analysisText,
        analysis_file_sha256: actualAnalysisSha,
        analysis_content_sha256: contentSha256,
        analysis_bytes: analysisBuf.length,
        manifest_analysis_version: String(manifest.analysis_version || "v3"),
        prompt_version: String(manifest.prompt_version || manifest.analysis_version || "v3"),
        db_analysis_version: "v3",
        prompt_template_sha256: manifest.prompt_template_sha256 ? String(manifest.prompt_template_sha256) : null,
        audit_performed: Boolean(manifest.audit_performed),
        audit_verdict: manifest.audit_verdict ?? null,
        created_at: manifest.created_at ? String(manifest.created_at) : null,
        created_by_pc: manifest.created_by_pc ? String(manifest.created_by_pc) : null,
        scenes_count: Number(mech.scenes_count || 0),
        chapters_count: Number(mech.chapters_count || 0),
        mechanical_passed: true,
      });
    } catch (err) {
      rejected.push({ video_id: vid, reason: `parse_error: ${err.message}` });
    }
  }

  return { exists: true, store_dir: storeDir, valid_map: validMap, rejected };
}

export function auditOriginalColumnsAgainstPreD({
  liveRows,
  backupMap,
  originalColumns,
  legacyScoreColumns = new Set(),
  approvedOverrideMap = new Map(),
  v3ManifestMap = new Map(),
}) {
  let rowsCompared = 0;
  let totalCellsCompared = 0;
  let anyOriginalColMismatches = 0;
  let legacyScoreColMismatches = 0;
  let updatedAtMismatches = 0;
  const approvedMatches = [];
  const v3ManifestMatches = [];
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
        if (col === "aiAnalysis" && v3ManifestMap && v3ManifestMap.has(String(row.id))) {
          const v3Entry = v3ManifestMap.get(String(row.id));
          const expectedV3Sha = String(
            v3Entry.analysis_content_sha256 || v3Entry.analysis_file_sha256 || v3Entry.sha256 || ""
          ).toLowerCase();
          if (v3Entry.mechanical_passed === true && expectedV3Sha && liveSha.toLowerCase() === expectedV3Sha) {
            v3ManifestMatches.push({
              video_id: String(row.id),
              column: col,
              after_sha256: liveSha,
              prompt_template_sha256: v3Entry.prompt_template_sha256 || null,
              analysis_version: "v3",
            });
            continue;
          }
          anyOriginalColMismatches++;
          if (legacyScoreColumns.has(col)) legacyScoreColMismatches++;
          if (sampleMismatches.length < 10) {
            sampleMismatches.push({
              id: row.id,
              col,
              reason: "v3_manifest_sha256_mismatch",
              expected_v3_sha256: expectedV3Sha || null,
              live_sha256: liveSha,
              backup_sha256: sha256TidbCellValue(bakVal),
            });
          }
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
    v3_manifest_matched_count: v3ManifestMatches.length,
    v3_manifest_matched: v3ManifestMatches,
    legacy_8_score_columns_mismatches: legacyScoreColMismatches,
    all_40_original_columns_mismatches: anyOriginalColMismatches,
    updated_at_row_mismatches: updatedAtMismatches,
    sample_mismatches: sampleMismatches,
    passed: anyOriginalColMismatches === 0 && legacyScoreColMismatches === 0 && updatedAtMismatches === 0,
  };
}
