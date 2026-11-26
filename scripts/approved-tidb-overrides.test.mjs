import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  auditOriginalColumnsAgainstPreD,
  loadApprovedTidbOverrides,
  sha256TidbCellValue,
} from "./approved-tidb-overrides.mjs";

const LEGACY = new Set(["aiScoreBreakdown", "aiAnalysis"]);

test("approved TiDB overrides allow exact (video_id, column, after_sha256) match and fail closed otherwise", () => {
  const backupMap = new Map([
    ["vid1", { id: "vid1", aiScoreBreakdown: '{"visualVerificationStatus":"invalidated_no_visual"}', aiAnalysis: "old1", updatedAt: "2026-11-20T00:00:00.000Z" }],
    ["vid2", { id: "vid2", aiScoreBreakdown: '{"analysisStatus":"provisional"}', aiAnalysis: "old2", updatedAt: "2026-11-20T00:00:00.000Z" }],
  ]);
  const cols = ["id", "aiScoreBreakdown", "aiAnalysis", "updatedAt"];
  const newBd1 = '{"visualVerificationStatus":"log_verified","invalidatedNoVisual":false}';
  const newAna2 = "## 0. 総括\n完全版テキスト";

  const td = fs.mkdtempSync(path.join(os.tmpdir(), "approved-overrides-test-"));
  try {
    const file = path.join(td, "approved.json");
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          schema_version: 1,
          overrides: [
            {
              video_id: "vid1",
              column: "aiScoreBreakdown",
              after_sha256: sha256TidbCellValue(newBd1),
              reason: "Visual audit passed",
              decision_id: "D-024",
              approved_at: "2026-11-25T09:00:00Z",
              status: "approved",
            },
            {
              video_id: "vid2",
              column: "aiAnalysis",
              after_sha256: sha256TidbCellValue(newAna2),
              reason: "Remade full analysis",
              decision_id: "D-024",
              approved_at: null,
              status: "pending_approval",
            },
          ],
        },
        null,
        2
      ),
      "utf8"
    );

    // 1. Only status=approved is active by default; pending_approval MUST fail closed
    const loadedStrict = loadApprovedTidbOverrides(file);
    assert.equal(loadedStrict.active_map.size, 1);

    const liveRows = [
      { id: "vid1", aiScoreBreakdown: newBd1, aiAnalysis: "old1", updatedAt: "2026-11-20T00:00:00.000Z" },
      { id: "vid2", aiScoreBreakdown: '{"analysisStatus":"provisional"}', aiAnalysis: newAna2, updatedAt: "2026-11-20T00:00:00.000Z" },
    ];
    const strictAudit = auditOriginalColumnsAgainstPreD({
      liveRows,
      backupMap,
      originalColumns: cols,
      legacyScoreColumns: LEGACY,
      approvedOverrideMap: loadedStrict.active_map,
    });
    assert.equal(strictAudit.passed, false);
    assert.equal(strictAudit.approved_overrides_matched_count, 1);
    assert.equal(strictAudit.all_40_original_columns_mismatches, 1);

    // 2. When both are approved (or simulated with includePending=true), audit passes with 0 unapproved diffs
    const loadedSim = loadApprovedTidbOverrides(file, { includePending: true });
    const passAudit = auditOriginalColumnsAgainstPreD({
      liveRows,
      backupMap,
      originalColumns: cols,
      legacyScoreColumns: LEGACY,
      approvedOverrideMap: loadedSim.active_map,
    });
    assert.equal(passAudit.passed, true);
    assert.equal(passAudit.approved_overrides_matched_count, 2);
    assert.equal(passAudit.all_40_original_columns_mismatches, 0);

    // 3. Tampered value (SHA-256 mismatch) MUST fail
    const tamperedRows = [
      { id: "vid1", aiScoreBreakdown: newBd1 + " ", aiAnalysis: "old1", updatedAt: "2026-11-20T00:00:00.000Z" },
      liveRows[1],
    ];
    const tamperedAudit = auditOriginalColumnsAgainstPreD({
      liveRows: tamperedRows,
      backupMap,
      originalColumns: cols,
      legacyScoreColumns: LEGACY,
      approvedOverrideMap: loadedSim.active_map,
    });
    assert.equal(tamperedAudit.passed, false);
    assert.equal(tamperedAudit.sample_mismatches[0].reason, "approved_override_sha256_mismatch");

    // 4. Unlisted column diff MUST fail
    const unlistedRows = [
      { ...liveRows[0], aiAnalysis: "unexpected_edit" },
      liveRows[1],
    ];
    const unlistedAudit = auditOriginalColumnsAgainstPreD({
      liveRows: unlistedRows,
      backupMap,
      originalColumns: cols,
      legacyScoreColumns: LEGACY,
      approvedOverrideMap: loadedSim.active_map,
    });
    assert.equal(unlistedAudit.passed, false);
    assert.equal(unlistedAudit.sample_mismatches[0].reason, "unapproved_original_column_diff");
  } finally {
    fs.rmSync(td, { recursive: true, force: true });
  }
});
