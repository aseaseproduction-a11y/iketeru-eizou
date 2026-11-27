import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildAcquireLock,
  buildReleaseLock,
  extractListCount,
  parseLockJson,
} from "./manage-apply-lock.mjs";
import {
  assertDeltaBounds,
  extractJsonFromStdout,
  parseArgs as parsePipelineArgs,
} from "./run-v3-delta-pipeline.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("parseLockJson strips UTF-8 BOM cleanly", () => {
  const withBom = '\uFEFF{"schema_version":1,"status":"unlocked","worker":null}';
  const parsed = parseLockJson(withBom);
  assert.equal(parsed.status, "unlocked");
  assert.equal(parsed.worker, null);
});

test("buildAcquireLock and buildReleaseLock preserve canonical schema with released_at & released_by", () => {
  const initial = {
    schema_version: 1,
    status: "unlocked",
    worker: null,
    run_id: null,
    started_at: null,
    last_worker: "chibatmute",
    last_run_id: "v3_apply_delta_prev",
    last_started_at: "2026-11-27T10:00:00.000Z",
    released_at: "2026-11-27T10:05:00.000Z",
    released_by: "chibatmute",
  };

  const locked = buildAcquireLock(initial, {
    worker: "chibatmute",
    runId: "v3_apply_delta_20261128_r1",
    startedAt: "2026-11-27T15:30:00.000Z",
  });
  assert.equal(locked.status, "locked");
  assert.equal(locked.worker, "chibatmute");
  assert.equal(locked.run_id, "v3_apply_delta_20261128_r1");
  assert.equal(locked.started_at, "2026-11-27T15:30:00.000Z");
  assert.equal(locked.last_run_id, "v3_apply_delta_prev");

  // Refuses acquiring when already locked by another worker
  assert.throws(
    () => buildAcquireLock(locked, { worker: "CHIBA-PC2", runId: "other" }),
    /not unlocked/
  );

  // Refuses releasing when owned by another worker
  assert.throws(
    () => buildReleaseLock(locked, { worker: "CHIBA-PC2", runId: "v3_apply_delta_20261128_r1" }),
    /not owned by CHIBA-PC2/
  );

  const released = buildReleaseLock(locked, {
    worker: "chibatmute",
    runId: "v3_apply_delta_20261128_r1",
    releasedAt: "2026-11-27T15:32:00.000Z",
  });
  assert.deepEqual(released, {
    schema_version: 1,
    status: "unlocked",
    worker: null,
    run_id: null,
    started_at: null,
    last_worker: "chibatmute",
    last_run_id: "v3_apply_delta_20261128_r1",
    last_started_at: "2026-11-27T15:30:00.000Z",
    released_at: "2026-11-27T15:32:00.000Z",
    released_by: "chibatmute",
  });
});

test("extractListCount supports entries, videos, and raw arrays", () => {
  assert.equal(extractListCount({ entries: [{ video_id: "a" }, { video_id: "b" }] }), 2);
  assert.equal(extractListCount({ videos: [{ id: "a" }] }), 1);
  assert.equal(extractListCount(["a", "b", "c"]), 3);
  assert.equal(extractListCount({}), 0);
});

test("assertDeltaBounds enforces 1..maxDelta fail-closed", () => {
  assert.doesNotThrow(() => assertDeltaBounds(1, 200));
  assert.doesNotThrow(() => assertDeltaBounds(200, 200));
  assert.throws(() => assertDeltaBounds(0, 200), /out of auto-apply bounds/);
  assert.throws(() => assertDeltaBounds(201, 200), /out of auto-apply bounds/);
});

test("run-v3-delta-pipeline parseArgs and extractJsonFromStdout", () => {
  const opts = parsePipelineArgs([
    "--run-id",
    "v3_apply_delta_20261128_r1",
    "--list=tmp/list.json",
    "--worker",
    "chibatmute",
    "--max-delta",
    "150",
  ]);
  assert.equal(opts.runId, "v3_apply_delta_20261128_r1");
  assert.equal(opts.listPath, "tmp/list.json");
  assert.equal(opts.worker, "chibatmute");
  assert.equal(opts.maxDelta, 150);
  assert.equal(opts.skipVideoScenes, false);

  const extracted = extractJsonFromStdout('dotenv log line\n{"ok":true}');
  assert.deepEqual(JSON.parse(extracted), { ok: true });
});

test("new v3 delta pipeline scripts contain no hardcoded secrets or user-specific paths", () => {
  const files = [
    "manage-apply-lock.mjs",
    "check-v3-delta.mjs",
    "run-v3-delta-pipeline.mjs",
    "check-v3-scenes-pending.mjs",
    "verify-tidb-vs-sqlite-v3-scenes.mjs",
  ];
  const forbidden = [
    /mysql2?:\/\//i,
    /tidbcloud\.com/i,
    /gateway0\d\./i,
    /C:\\Users\\/i,
    /E:\/iketeru_tmp/i,
    /AIza[0-9A-Za-z_-]{20,}/,
    /ghp_[0-9A-Za-z]{20,}/,
  ];
  for (const fn of files) {
    const src = fs.readFileSync(path.join(__dirname, fn), "utf8");
    for (const pat of forbidden) {
      assert.equal(pat.test(src), false, `${fn} matched forbidden pattern ${pat}`);
    }
  }
});
