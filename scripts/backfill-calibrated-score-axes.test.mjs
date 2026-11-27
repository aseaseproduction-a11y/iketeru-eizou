import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKFILL_UPDATE_SQL,
  buildCalibratedScoreAxesForRow,
  planBackfillUpdates,
  verifyApplyLockState,
} from "./backfill-calibrated-score-axes.mjs";

test("buildCalibratedScoreAxesForRow computes exact 2-run mean for Phase 3 (offsetPerAxis=0)", () => {
  const rawIndex = new Map([
    [
      "run_20261125_070347::vid1",
      [
        {
          video_id: "vid1",
          mode: "video",
          attempt: 1,
          total_score: 83,
          scores: { direction: 17, visual_craft: 16, editing_rhythm: 17, sound_integration: 17, originality_finish: 16 },
        },
        {
          video_id: "vid1",
          mode: "video",
          attempt: 2,
          total_score: 84,
          scores: { direction: 17, visual_craft: 16, editing_rhythm: 18, sound_integration: 17, originality_finish: 16 },
        },
      ],
    ],
  ]);

  const res = buildCalibratedScoreAxesForRow(
    {
      id: "vid1",
      calibratedScore: "83.50",
      calibratedRoute: "video_h1",
      calibratedRunId: "run_20261125_070347",
      calibrationVersion: "phase2_v1",
      calibratedBreakdown: JSON.stringify({ ensembleRule: "mean_of_2" }),
    },
    rawIndex,
  );

  assert.equal(res.status, "ready_2runs");
  assert.equal(res.diff, 0);
  assert.equal(res.sum_axes, 83.5);
  assert.deepEqual(res.payload, {
    v: 1,
    axes: {
      direction: 17,
      visual_craft: 16,
      editing_rhythm: 17.5,
      sound_integration: 17,
      originality_finish: 16,
    },
    runs: 2,
    source: "phase3",
    offsetPerAxis: 0,
    ensembleRule: "mean_of_2",
  });
});

test("buildCalibratedScoreAxesForRow matches median_of_3 calibratedScore exactly (including median ties)", () => {
  const rawIndex = new Map([
    [
      "run_20261125_070347::vid_tie",
      [
        {
          video_id: "vid_tie",
          mode: "video",
          attempt: 1,
          total_score: 73,
          scores: { direction: 15, visual_craft: 14, editing_rhythm: 15, sound_integration: 15, originality_finish: 14 },
        },
        {
          video_id: "vid_tie",
          mode: "video",
          attempt: 2,
          total_score: 78,
          scores: { direction: 16, visual_craft: 15, editing_rhythm: 16, sound_integration: 16, originality_finish: 15 },
        },
        {
          video_id: "vid_tie",
          mode: "video",
          attempt: 3,
          total_score: 78,
          scores: { direction: 16, visual_craft: 15, editing_rhythm: 16, sound_integration: 16, originality_finish: 15 },
        },
      ],
    ],
  ]);

  const res = buildCalibratedScoreAxesForRow(
    {
      id: "vid_tie",
      calibratedScore: "78.00",
      calibratedRoute: "video_h1",
      calibratedRunId: "run_20261125_070347",
      calibrationVersion: "phase2_v1",
      calibratedBreakdown: JSON.stringify({ ensembleRule: "median_of_3" }),
    },
    rawIndex,
  );

  assert.equal(res.status, "ready_3runs_median");
  assert.equal(res.diff, 0);
  assert.equal(res.sum_axes, 78);
  assert.equal(res.payload.runs, 3);
  assert.equal(res.payload.offsetPerAxis, 0);
});

test("buildCalibratedScoreAxesForRow applies offsetPerAxis=0.45 for API URL route so sum matches calibratedScore", () => {
  const rawIndex = new Map([
    [
      "run1_api::vid_api",
      [
        {
          video_id: "vid_api",
          mode: "video",
          attempt: 1,
          total_score: 90,
          scores: { direction: 18, visual_craft: 18, editing_rhythm: 18, sound_integration: 18, originality_finish: 18 },
        },
        {
          video_id: "vid_api",
          mode: "video",
          attempt: 2,
          total_score: 90,
          scores: { direction: 18, visual_craft: 18, editing_rhythm: 18, sound_integration: 18, originality_finish: 18 },
        },
      ],
    ],
  ]);

  const res = buildCalibratedScoreAxesForRow(
    {
      id: "vid_api",
      calibratedScore: "87.75", // 90 - 2.25
      calibratedRoute: "gemini_api_youtube_url_v1",
      calibratedRunId: "run1_api",
      calibrationVersion: "gemini_api_youtube_url_v1",
      calibratedBreakdown: JSON.stringify({ ensembleRule: "mean_of_2" }),
    },
    rawIndex,
  );

  assert.equal(res.status, "ready_2runs");
  assert.equal(res.diff, 0);
  assert.equal(res.sum_axes, 87.75);
  assert.equal(res.payload.source, "api");
  assert.equal(res.payload.offsetPerAxis, 0.45);
  assert.equal(res.payload.axes.direction, 17.55);
});

test("verifyApplyLockState enforces locked status, exact worker, and exact run_id", () => {
  assert.equal(
    verifyApplyLockState({ status: "unlocked", worker: null, run_id: null }, { worker: "CHIBA-PC2", expectedRunId: "r1" }).ok,
    false,
  );
  assert.equal(
    verifyApplyLockState({ status: "locked", worker: "CHIBA-PC", run_id: "r1" }, { worker: "CHIBA-PC2", expectedRunId: "r1" }).ok,
    false,
  );
  assert.equal(
    verifyApplyLockState({ status: "locked", worker: "CHIBA-PC2", run_id: "other" }, { worker: "CHIBA-PC2", expectedRunId: "r1" }).ok,
    false,
  );
  assert.equal(
    verifyApplyLockState({ status: "locked", worker: "CHIBA-PC2", run_id: "r1" }, { worker: "CHIBA-PC2", expectedRunId: "r1" }).ok,
    true,
  );
});

test("planBackfillUpdates skips rows missing raw_scores cleanly and UPDATE SQL touches only calibratedScoreAxes + updatedAt", () => {
  const rawIndex = new Map([
    [
      "run_a::vid_ok",
      [
        {
          video_id: "vid_ok",
          mode: "video",
          attempt: 1,
          total_score: 80,
          scores: { direction: 16, visual_craft: 16, editing_rhythm: 16, sound_integration: 16, originality_finish: 16 },
        },
        {
          video_id: "vid_ok",
          mode: "video",
          attempt: 2,
          total_score: 80,
          scores: { direction: 16, visual_craft: 16, editing_rhythm: 16, sound_integration: 16, originality_finish: 16 },
        },
      ],
    ],
  ]);

  const plan = planBackfillUpdates(
    [
      {
        id: "vid_ok",
        title: "OK",
        calibratedScore: "80.00",
        calibratedRoute: "video_h1",
        calibratedRunId: "run_a",
        calibrationVersion: "phase2_v1",
        calibratedBreakdown: JSON.stringify({ ensembleRule: "mean_of_2" }),
      },
      {
        id: "vid_missing",
        title: "Missing Raw",
        calibratedScore: "82.00",
        calibratedRoute: "video_h1",
        calibratedRunId: "run_20261127_104500",
        calibrationVersion: "phase2_v1",
        calibratedBreakdown: null,
      },
    ],
    rawIndex,
  );

  assert.equal(plan.ready.length, 1);
  assert.equal(plan.ready[0].id, "vid_ok");
  assert.equal(plan.skippedMissingRaw.length, 1);
  assert.equal(plan.skippedMissingRaw[0].id, "vid_missing");
  assert.equal(plan.sumMismatches.length, 0);

  assert.equal(
    BACKFILL_UPDATE_SQL,
    "UPDATE `videos` SET `calibratedScoreAxes` = ?, `updatedAt` = `updatedAt` WHERE `id` = ? AND `calibratedScoreAxes` IS NULL",
  );
});
