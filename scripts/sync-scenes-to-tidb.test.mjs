import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildScoreBreakdownAndReconcile,
  buildUpsertBatchSql,
  chunkArray,
  computeStaleScenes,
  estimateStorageBytes,
  LOCK_RUN_ID,
  normalizeSceneRecord,
  parseArgs,
  pruneStaleScenesPerVideo,
  verifyApplyLock,
} from "./sync-scenes-to-tidb.mjs";

test("parseArgs defaults to dry-run without prune-stale and parses flags strictly", () => {
  const def = parseArgs([]);
  assert.equal(def.dryRun, true);
  assert.equal(def.apply, false);
  assert.equal(def.pruneStale, false);
  assert.equal(def.excludeUnwatched, false);
  assert.equal(def.chunkSize, 500);

  const app = parseArgs([
    "--apply",
    "--worker",
    "CHIBA-PC2",
    "--chunk-size",
    "250",
    "--prune-stale",
    "--backup-dir",
    "E:\\tmp\\bk",
    "--exclude-unwatched",
  ]);
  assert.equal(app.dryRun, false);
  assert.equal(app.apply, true);
  assert.equal(app.pruneStale, true);
  assert.equal(app.excludeUnwatched, true);
  assert.equal(app.backupDir, "E:\\tmp\\bk");
  assert.equal(app.worker, "CHIBA-PC2");
  assert.equal(app.chunkSize, 250);

  assert.throws(() => parseArgs(["--worker"]), /requires a value/);
  assert.throws(() => parseArgs(["--backup-dir"]), /requires a value/);
  assert.throws(() => parseArgs(["--chunk-size", "0"]), /integer 1..2000/);
});

test("verifyApplyLock rejects unlocked, wrong run_id, wrong worker, or missing worker", () => {
  assert.throws(
    () => verifyApplyLock({ status: "unlocked", worker: null, run_id: null }, "CHIBA-PC2"),
    /Refusing to write to TiDB without active write lock/,
  );
  assert.throws(
    () => verifyApplyLock({ status: "locked", worker: "CHIBA-PC", run_id: LOCK_RUN_ID }, "CHIBA-PC2"),
    /Refusing to write to TiDB without active write lock/,
  );
  assert.throws(
    () => verifyApplyLock({ status: "locked", worker: "CHIBA-PC2", run_id: "other_run" }, "CHIBA-PC2"),
    /Refusing to write to TiDB without active write lock/,
  );
  assert.throws(
    () => verifyApplyLock({ status: "locked", worker: "CHIBA-PC2", run_id: LOCK_RUN_ID }, ""),
    /Worker name is required/,
  );
  assert.equal(
    verifyApplyLock({ status: "locked", worker: "CHIBA-PC2", run_id: LOCK_RUN_ID }, "CHIBA-PC2"),
    true,
  );
});

test("chunkArray splits into exact 500-row batches", () => {
  const items = Array.from({ length: 1250 }, (_, i) => i);
  const chunks = chunkArray(items, 500);
  assert.equal(chunks.length, 3);
  assert.deepEqual(
    chunks.map((c) => c.length),
    [500, 500, 250],
  );
});

test("normalizeSceneRecord extracts Japanese + English keywords, computes sceneSha256, defaults analysisVersion=legacy", () => {
  const row = normalizeSceneRecord(
    {
      video_id: "abc123",
      shot_index: 2,
      start_mmss: "00:04",
      end_mmss: "00:08",
      start_sec: 4,
      end_sec: 8,
      duration_sec: 4,
      shot_title: "夜のネオン街を疾走するマッチカット VFX",
      description: "逆光のストリートでダンスしながらMotion4でスローモーションへ移行する。",
    },
    "Sample MV",
  );

  assert.equal(row.videoId, "abc123");
  assert.equal(row.shotIndex, 2);
  assert.equal(row.analysisVersion, "legacy");
  assert.equal(row.analysisGeneratedAt, null);
  assert.match(row.sceneSha256, /^[0-9a-f]{64}$/);
  const kws = JSON.parse(row.keywordsJson);
  assert.ok(kws.includes("マッチカット"));
  assert.ok(kws.includes("ダンス"));
  assert.ok(kws.includes("Motion4"));
  assert.ok(row.searchText.includes("sample mv"));
  assert.ok(row.searchText.includes("マッチカット"));

  const { sql, params } = buildUpsertBatchSql([row, { ...row, shotIndex: 3 }]);
  assert.match(sql, /INSERT INTO `videoScenes`/);
  assert.match(sql, /`analysisVersion`/);
  assert.match(sql, /`sceneSha256`/);
  assert.match(sql, /ON DUPLICATE KEY UPDATE/);
  assert.equal(params.length, 32);

  const est = estimateStorageBytes([row]);
  assert.ok(est.rawTextBytes > 0);
  assert.ok(est.estimatedTotalMb >= 0);
});

test("buildScoreBreakdownAndReconcile uses calibratedScore only and reconciles band sums", () => {
  const records = [
    { videoId: "v1", analysisObservationScope: null, calibratedScore: 88.5, aiOverallScore: 80 },
    { videoId: "v1", analysisObservationScope: null, calibratedScore: 83.0, aiOverallScore: 70 },
    { videoId: "v2", analysisObservationScope: null, calibratedScore: 78.0, aiOverallScore: 75 },
    { videoId: "v3", analysisObservationScope: null, calibratedScore: 72.5, aiOverallScore: 90 },
    // Uncalibrated videos with high legacy aiOverallScore MUST NOT enter calibrated 78+ / 83+
    { videoId: "v4", analysisObservationScope: null, calibratedScore: null, aiOverallScore: 92 },
    { videoId: "v5", analysisObservationScope: "triage_unverified_short", calibratedScore: null, aiOverallScore: 80 },
  ];

  const b = buildScoreBreakdownAndReconcile(records);
  assert.equal(b.calibratedVideoScenes, 4);
  assert.equal(b.calibratedBands.score83Plus, 2);
  assert.equal(b.calibratedBands.score78To82, 1);
  assert.equal(b.calibratedBands.scoreBelow78, 1);
  assert.equal(b.score78PlusScenes, 3);
  assert.equal(b.score83PlusScenes, 2);
  assert.equal(b.uncalibratedScenes, 2);
  assert.equal(b.legacyUncalibratedExcludedFromScoreFilters.legacy78PlusExcluded, 2);
  assert.equal(b.legacyUncalibratedExcludedFromScoreFilters.legacy83PlusExcluded, 1);
  assert.equal(b.scoreBandReconciliation.calibratedBandsMatch, true);
  assert.equal(b.scoreBandReconciliation.score78PlusLeqCalibrated, true);
  assert.equal(b.scoreBandReconciliation.allScenesMatch, true);
});

test("computeStaleScenes identifies per-video scenes present in TiDB but missing from SQLite", () => {
  const tidbRows = [
    { videoId: "vidA", shotIndex: 1, startMmss: "00:00", endMmss: "00:10", shotTitle: "A1" },
    { videoId: "vidA", shotIndex: 2, startMmss: "00:10", endMmss: "00:20", shotTitle: "A2" },
    { videoId: "vidA", shotIndex: 3, startMmss: "00:20", endMmss: "00:30", shotTitle: "A3 old" },
    { videoId: "vidA", shotIndex: 4, startMmss: "00:30", endMmss: "00:40", shotTitle: "A4 old" },
    { videoId: "vidB", shotIndex: 1, startMmss: "00:00", endMmss: "00:15", shotTitle: "B1" },
    { videoId: "vidC", shotIndex: 1, startMmss: "00:00", endMmss: "00:08", shotTitle: "C1 orphan" },
  ];
  const sqliteRows = [
    { videoId: "vidA", shotIndex: 1 },
    { videoId: "vidA", shotIndex: 2 },
    { videoId: "vidB", shotIndex: 1 },
  ];

  const stale = computeStaleScenes(tidbRows, sqliteRows);
  assert.equal(stale.staleVideosCount, 2);
  assert.equal(stale.staleScenesCount, 3);
  assert.deepEqual(stale.staleByVideo[0].videoId, "vidA");
  assert.deepEqual(stale.staleByVideo[0].staleShotIndices, [3, 4]);
  assert.deepEqual(stale.staleByVideo[1].videoId, "vidC");
  assert.deepEqual(stale.staleByVideo[1].staleShotIndices, [1]);
});

test("pruneStaleScenesPerVideo writes per-video JSONL backup + SHA-256 BEFORE deleting stale rows", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "iketeru-prune-test-"));
  const executedQueries = [];
  const fakeConn = {
    async query(sql, params) {
      executedQueries.push({ sql, params });
      if (sql.startsWith("SELECT * FROM `videoScenes`")) {
        const vid = params[0];
        return [
          [
            { id: 1, videoId: vid, shotIndex: 1, shotTitle: "keep" },
            { id: 2, videoId: vid, shotIndex: 3, shotTitle: "stale3" },
            { id: 3, videoId: vid, shotIndex: 4, shotTitle: "stale4" },
          ],
        ];
      }
      if (sql.startsWith("DELETE FROM `videoScenes`")) {
        // Verify backup file ALREADY exists on disk when DELETE runs
        const bkPath = path.join(tmpDir, `${params[0]}.jsonl`);
        assert.equal(fs.existsSync(bkPath), true, "Backup MUST exist before DELETE executes");
        return [{ affectedRows: params.length - 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  try {
    const res = await pruneStaleScenesPerVideo({
      conn: fakeConn,
      staleByVideo: [{ videoId: "vidA", staleCount: 2, staleShotIndices: [3, 4], scenes: [] }],
      backupDir: tmpDir,
    });

    assert.equal(res.prunedVideosCount, 1);
    assert.equal(res.prunedScenesCount, 2);
    assert.equal(executedQueries.length, 2);
    assert.match(executedQueries[0].sql, /^SELECT \* FROM `videoScenes` WHERE `videoId` = \?/);
    assert.match(executedQueries[1].sql, /^DELETE FROM `videoScenes` WHERE `videoId` = \? AND `shotIndex` IN \(\?, \?\)/);
    assert.deepEqual(executedQueries[1].params, ["vidA", 3, 4]);

    const manifest = JSON.parse(fs.readFileSync(res.manifestPath, "utf8"));
    assert.equal(manifest.prunedVideosCount, 1);
    assert.equal(manifest.prunedScenesCount, 2);
    assert.match(manifest.videos[0].backupSha256, /^[0-9a-f]{64}$/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
