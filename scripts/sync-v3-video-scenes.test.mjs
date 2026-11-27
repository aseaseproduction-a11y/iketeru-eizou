import test from "node:test";
import assert from "node:assert/strict";
import {
  parseArgs,
  planV3ScenesSync,
  selectPendingV3VideoIds,
  verifyApplyLockState,
} from "./sync-v3-video-scenes.mjs";

test("selectPendingV3VideoIds selects only v3 videos missing v3 scenes or still having legacy scenes", () => {
  const statusMap = new Map([
    ["vid_already_v3", { totalCount: 8, v3Count: 8, nonV3Count: 0 }],
    ["vid_legacy_only", { totalCount: 5, v3Count: 0, nonV3Count: 5 }],
    ["vid_mixed", { totalCount: 6, v3Count: 4, nonV3Count: 2 }],
  ]);

  const { pending, alreadySynced } = selectPendingV3VideoIds(
    ["vid_already_v3", "vid_legacy_only", "vid_mixed", "vid_no_scenes"],
    statusMap,
  );

  assert.deepEqual(alreadySynced, ["vid_already_v3"]);
  assert.deepEqual(pending, ["vid_legacy_only", "vid_mixed", "vid_no_scenes"]);
});

test("verifyApplyLockState requires caller's active lock with matching worker and lock-run-id", () => {
  const active = { status: "locked", worker: "chibatmute", run_id: "v3_apply_delta_20261127_r2" };
  assert.equal(verifyApplyLockState(active, "chibatmute", "v3_apply_delta_20261127_r2"), true);

  assert.throws(
    () => verifyApplyLockState({ status: "unlocked", worker: null, run_id: null }, "chibatmute", "r2"),
    /Refusing to write/,
  );
  assert.throws(
    () => verifyApplyLockState(active, "CHIBA-PC2", "v3_apply_delta_20261127_r2"),
    /Refusing to write/,
  );
  assert.throws(
    () => verifyApplyLockState(active, "chibatmute", "other_run_id"),
    /Refusing to write/,
  );
  assert.throws(() => verifyApplyLockState(active, "chibatmute", ""), /--lock-run-id is required/);
});

test("parseArgs defaults to dry-run + pending-only and supports caller lock flags", () => {
  const def = parseArgs([]);
  assert.equal(def.dryRun, true);
  assert.equal(def.apply, false);
  assert.equal(def.pendingOnly, true);

  const custom = parseArgs([
    "--apply",
    "--all-v3",
    "--worker",
    "chibatmute",
    "--lock-run-id",
    "v3_apply_delta_r2",
    "--lock-git-ref",
    "origin/main",
  ]);
  assert.equal(custom.apply, true);
  assert.equal(custom.dryRun, false);
  assert.equal(custom.pendingOnly, false);
  assert.equal(custom.worker, "chibatmute");
  assert.equal(custom.lockRunId, "v3_apply_delta_r2");
  assert.equal(custom.lockGitRef, "origin/main");
});

test("planV3ScenesSync parses Ch.3 scenes, detects stale excess shots, and catches 0-scene / duplicate failures", () => {
  const mdOk = [
    "## 3. 時系列ビジュアル・タイムスタンプ詳細",
    "- #1 [00:00-00:05] 導入タイトル: 白背景にロゴが出現する。",
    "- #2 [00:05-00:12] 本編カット: 夜の街をカメラがドリーする。",
  ].join("\n");

  const existing = [
    { videoId: "vid1", shotIndex: 1, startMmss: "00:00", endMmss: "00:04", shotTitle: "old1", analysisVersion: "legacy" },
    { videoId: "vid1", shotIndex: 2, startMmss: "00:04", endMmss: "00:08", shotTitle: "old2", analysisVersion: "legacy" },
    { videoId: "vid1", shotIndex: 3, startMmss: "00:08", endMmss: "00:12", shotTitle: "old3", analysisVersion: "legacy" },
  ];

  const plan = planV3ScenesSync(
    [
      { id: "vid1", title: "Test Video 1", analysisGeneratedAt: new Date("2026-11-27T06:00:00.000Z"), aiAnalysis: mdOk },
      { id: "vid2", title: "Test Video 2 (new)", analysisGeneratedAt: new Date("2026-11-27T06:05:00.000Z"), aiAnalysis: mdOk },
    ],
    existing,
  );

  assert.equal(plan.zeroSceneVideos.length, 0);
  assert.equal(plan.duplicateShotIndexVideos.length, 0);
  assert.equal(plan.videosReplacingLegacy, 1);
  assert.equal(plan.videosNewlyAdding, 1);
  assert.equal(plan.normalizedRows.length, 4);
  assert.equal(plan.normalizedRows.every((r) => r.analysisVersion === "v3"), true);
  assert.equal(plan.normalizedRows[0].analysisGeneratedAt, "2026-11-27 06:00:00");
  assert.equal(plan.stale.staleVideosCount, 1);
  assert.equal(plan.stale.staleScenesCount, 1);
  assert.deepEqual(plan.stale.staleByVideo[0].staleShotIndices, [3]);

  // Fail-closed detection on 0 scenes and duplicate shotIndex
  const badPlan = planV3ScenesSync(
    [
      { id: "vid_zero", title: "No scenes", analysisGeneratedAt: null, aiAnalysis: "テキストのみ" },
      {
        id: "vid_dup",
        title: "Dup shots",
        analysisGeneratedAt: null,
        aiAnalysis: "- #1 [00:00-00:03] A: a\n- #1 [00:03-00:06] B: b",
      },
    ],
    [],
  );
  assert.equal(badPlan.zeroSceneVideos.length, 1);
  assert.equal(badPlan.duplicateShotIndexVideos.length, 1);
});
