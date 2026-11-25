import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUpsertBatchSql,
  chunkArray,
  estimateStorageBytes,
  LOCK_RUN_ID,
  normalizeSceneRecord,
  parseArgs,
  verifyApplyLock,
} from "./sync-scenes-to-tidb.mjs";

test("parseArgs defaults to dry-run and parses apply/chunk-size/worker", () => {
  const def = parseArgs([]);
  assert.equal(def.dryRun, true);
  assert.equal(def.apply, false);
  assert.equal(def.chunkSize, 500);

  const app = parseArgs(["--apply", "--worker", "CHIBA-PC2", "--chunk-size", "250"]);
  assert.equal(app.dryRun, false);
  assert.equal(app.apply, true);
  assert.equal(app.worker, "CHIBA-PC2");
  assert.equal(app.chunkSize, 250);

  assert.throws(() => parseArgs(["--worker"]), /requires a value/);
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

test("normalizeSceneRecord extracts keywords, builds lowercase searchText, and generates idempotent upsert SQL", () => {
  const row = normalizeSceneRecord(
    {
      video_id: "abc123",
      shot_index: 2,
      start_mmss: "00:04",
      end_mmss: "00:08",
      start_sec: 4,
      end_sec: 8,
      duration_sec: 4,
      shot_title: "夜のネオン街を疾走するマッチカット",
      description: "逆光のストリートでダンスしながらスローモーションへ移行する。",
    },
    "Sample MV",
  );

  assert.equal(row.videoId, "abc123");
  assert.equal(row.shotIndex, 2);
  const kws = JSON.parse(row.keywordsJson);
  assert.ok(kws.includes("マッチカット"));
  assert.ok(kws.includes("ダンス"));
  assert.ok(row.searchText.includes("sample mv"));
  assert.ok(row.searchText.includes("マッチカット"));

  const { sql, params } = buildUpsertBatchSql([row, { ...row, shotIndex: 3 }]);
  assert.match(sql, /INSERT INTO `videoScenes`/);
  assert.match(sql, /ON DUPLICATE KEY UPDATE/);
  assert.equal(params.length, 26);

  const est = estimateStorageBytes([row]);
  assert.ok(est.rawTextBytes > 0);
  assert.ok(est.estimatedTotalMb >= 0);
});
