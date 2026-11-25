import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CANONICAL_PROMPT_SHA256,
  RETRY_BACKOFF_SECONDS,
  aggregate2Plus1Scores,
  calcCallCostUsd,
  checkBudgetGuard,
  classifyApiError,
  executeWithRetry,
  getRetryDelaySec,
  sha256Text,
} from "./run-api-url-batch.mjs";
import { auditApiUrlRun, auditCallRecord, parseTimestampToSec } from "./audit-api-url-run.mjs";
import { buildApiUrlTidbPayload, estimateConstantOffsetWithCI95 } from "./evaluate-api-url-batch.mjs";
import { findAlreadyCalibratedIds, validateApiUrlPayloadGate } from "./apply-phase3-batch-to-tidb.mjs";
import { VALID_SCORING_CHANNELS, validateScoringChannel } from "./claim-phase3-batch.mjs";

const CANONICAL_PROMPT_TEXT = JSON.parse(
  fs.readFileSync(
    path.resolve(import.meta.dirname, "..", "analysis", "pilot_gemini_api_url", "run_20261125_125425", "run_config.json"),
    "utf8"
  )
).prompt_text;

function makeValidParsedJson(totalScore = 76) {
  const base = Math.floor(totalScore / 5);
  const rem = totalScore - base * 5;
  const scores = {
    direction: base + (rem > 0 ? 1 : 0),
    visual_craft: base + (rem > 1 ? 1 : 0),
    editing_rhythm: base + (rem > 2 ? 1 : 0),
    sound_integration: base + (rem > 3 ? 1 : 0),
    originality_finish: base,
  };
  const rankMap = (s) =>
    s >= 97 ? "S+" : s >= 93 ? "S" : s >= 90 ? "S-" : s >= 86 ? "A+" : s >= 82 ? "A" : s >= 78 ? "A-" :
    s >= 73 ? "B+" : s >= 68 ? "B" : s >= 63 ? "B-" : s >= 57 ? "C+" : s >= 51 ? "C" : s >= 45 ? "C-" : "D";
  return {
    scores,
    total_score: totalScore,
    rank: rankMap(totalScore),
    brief_rationale: "撮影・編集・音響の完成度が堅実な商業作品。",
    timestamped_observations: [
      { timestamp: "00:05", observation: "冒頭のロゴと俯瞰ショットがゆっくりと引いていく。" },
      { timestamp: "00:30", observation: "中盤のカット割りがビートに同期して切り替わる。" },
      { timestamp: "00:55", observation: "終盤のエンドカードで白いコピーが中央に表示される。" },
    ],
    post_check: {
      knows_work: false,
      knows_award_history: false,
      award_badge_visible_in_video: false,
      post_check_note: "",
    },
  };
}

function makeValidCallRecord({
  callIndex = 1,
  videoId = "vid_target_1",
  role = "target",
  attempt = 1,
  totalScore = 76,
  durationSec = 60,
  videoTokens = 6050,
  serviceTier = "flex",
} = {}) {
  const parsed = makeValidParsedJson(totalScore);
  const text = JSON.stringify(parsed);
  return {
    call_index: callIndex,
    run_id: "run_20261125_999999",
    worker: "CHIBA-PC-api",
    video_id: videoId,
    role,
    ref_duration_sec: durationSec,
    attempt,
    request: {
      model: "gemini-4-neon",
      thinking_level: "high",
      service_tier: serviceTier,
      store: false,
      stream: false,
      youtube_url: `https://www.youtube.com/watch?v=${videoId}`,
      prompt_sha256: CANONICAL_PROMPT_SHA256,
    },
    exit_code: 0,
    api_status: "completed",
    response_model: "gemini-4-neon",
    response_service_tier: serviceTier,
    interaction_id: `v1_test_${callIndex}`,
    usage_breakdown: {
      total_input_tokens: 1500 + videoTokens,
      input_text_tokens: 1500,
      input_video_tokens: videoTokens,
      total_output_tokens: 500,
      total_thought_tokens: 2000,
      total_tokens: 4000 + videoTokens,
    },
    cost: calcCallCostUsd({ total_input_tokens: 1500 + videoTokens, total_output_tokens: 500, total_thought_tokens: 2000 }, serviceTier),
    parse_ok: true,
    parse_error: null,
    parsed_json: parsed,
    extracted_text: text,
    raw_response: { id: `v1_test_${callIndex}`, status: "completed", model: "gemini-4-neon", outputs: [{ type: "text", text }] },
  };
}

// 1. Budget guards
test("checkBudgetGuard blocks monthly cap ($38), run cap, and max requests", () => {
  assert.equal(
    checkBudgetGuard({ monthlySpentUsd: 37.95, monthlyLimitUsd: 38.0, runSpentUsd: 1.0, runLimitUsd: 10.0, estimatedNextCallUsd: 0.08, requestCount: 10, maxRequests: 100 }).allowed,
    false
  );
  assert.equal(
    checkBudgetGuard({ monthlySpentUsd: 10.0, monthlyLimitUsd: 38.0, runSpentUsd: 0.56, runLimitUsd: 0.6, estimatedNextCallUsd: 0.06, requestCount: 8, maxRequests: 100 }).allowed,
    false
  );
  assert.equal(
    checkBudgetGuard({ monthlySpentUsd: 10.0, monthlyLimitUsd: 38.0, runSpentUsd: 1.0, runLimitUsd: 10.0, estimatedNextCallUsd: 0.05, requestCount: 50, maxRequests: 50 }).allowed,
    false
  );
  assert.equal(
    checkBudgetGuard({ monthlySpentUsd: 2.16, monthlyLimitUsd: 38.0, runSpentUsd: 0.2, runLimitUsd: 0.6, estimatedNextCallUsd: 0.05, requestCount: 4, maxRequests: 15 }).allowed,
    true
  );
});

// 2. Flex 503/429 retry logic & 402/403 immediate stop
test("executeWithRetry retries 503/429 with backoff including >=10m waits and stops immediately on 402/403", async () => {
  assert.deepEqual(RETRY_BACKOFF_SECONDS, [60, 180, 600, 900, 1200]);
  assert.equal(getRetryDelaySec(2, () => 0), 600);
  assert.equal(getRetryDelaySec(2, () => 0.999), 615);

  // 503 -> 429 -> 503 -> success on 4th attempt (3 retries, including 600s wait)
  const sleptMs = [];
  let attemptIdx = 0;
  const resOk = await executeWithRetry(
    async () => {
      attemptIdx++;
      if (attemptIdx === 1) return { exitCode: 1, stderr: "HTTP 503 SERVICE_UNAVAILABLE", stdout: "", respObj: null };
      if (attemptIdx === 2) return { exitCode: 1, stderr: "HTTP 429 RESOURCE_EXHAUSTED", stdout: "", respObj: null };
      if (attemptIdx === 3) return { exitCode: 1, stderr: "503 overloaded", stdout: "", respObj: null };
      return { exitCode: 0, stderr: "", stdout: "{}", respObj: { status: "completed" } };
    },
    { sleepFn: async (ms) => sleptMs.push(ms), rng: () => 0 }
  );
  assert.equal(resOk.classification.kind, "ok");
  assert.equal(resOk.retries_used, 3);
  assert.deepEqual(sleptMs, [60_000, 180_000, 600_000]);

  // Exhausting all 5 retries marks exhausted=true
  const sleptAll = [];
  const resEx = await executeWithRetry(
    async () => ({ exitCode: 1, stderr: "HTTP 503 SERVICE_UNAVAILABLE", stdout: "", respObj: null }),
    { sleepFn: async (ms) => sleptAll.push(ms), rng: () => 0 }
  );
  assert.equal(resEx.classification.exhausted, true);
  assert.equal(resEx.retries_used, 5);
  assert.deepEqual(sleptAll, [60_000, 180_000, 600_000, 900_000, 1_200_000]);

  // 402 and 403 do NOT retry
  for (const errText of ["HTTP 402 PAYMENT_REQUIRED", "HTTP 403 PERMISSION_DENIED"]) {
    let calls = 0;
    const resFatal = await executeWithRetry(
      async () => {
        calls++;
        return { exitCode: 1, stderr: errText, stdout: "", respObj: null };
      },
      { sleepFn: async () => { throw new Error("must not sleep on fatal 402/403"); } }
    );
    assert.equal(calls, 1);
    assert.equal(resFatal.classification.kind, "fatal_stop");
  }
  assert.equal(classifyApiError(1, "402 billing", null).code, "402");
  assert.equal(classifyApiError(1, "403 forbidden", null).code, "403");
});

// 3. 2+1 ensemble aggregation
test("aggregate2Plus1Scores computes mean when |r1-r2|<5, triggers 3rd at >=5, and takes median of 3", () => {
  const m2 = aggregate2Plus1Scores([80, 84]);
  assert.equal(m2.status, "complete");
  assert.equal(m2.needs_3rd, false);
  assert.equal(m2.ensemble_rule, "mean_of_2");
  assert.equal(m2.final_score, 82);

  const need3 = aggregate2Plus1Scores([80, 85]);
  assert.equal(need3.status, "needs_3rd");
  assert.equal(need3.needs_3rd, true);

  const med3 = aggregate2Plus1Scores([80, 85, 81]);
  assert.equal(med3.status, "complete");
  assert.equal(med3.ensemble_rule, "median_of_3");
  assert.equal(med3.final_score, 81);
});

// 4. Anchor exclusion & unapproved bias config rejection
test("buildApiUrlTidbPayload rejects unapproved bias config and strictly excludes anchor videos", () => {
  const targetRec = {
    video_id: "new_vid_1",
    raw_api_score: 85.0,
    raw_scores: [86, 84],
    ensemble_rule: "mean_of_2",
    prompt_sha256: CANONICAL_PROMPT_SHA256,
    calibration_status: "calibrated_verified",
    calibration_genre_bucket: "CM",
    dimensions: { direction: 17, visual_craft: 17, editing_rhythm: 17, sound_integration: 17, originality_finish: 17 },
    rationales: ["r1", "r2"],
    timestamped_observations: [[], []],
    post_check: { knowsWork: false, knowsAwardHistory: false, awardBadgeVisibleInVideo: false },
    usage_summary: { callsCount: 2, inputVideoTokens: 6000 },
  };

  // Unapproved bias config must throw
  assert.throws(
    () =>
      buildApiUrlTidbPayload({
        runId: "run_20261125_999999",
        priority: "P0_craft_recipes",
        targetVideoRecords: [targetRec],
        anchorVideoIds: ["anchor_vid_1"],
        biasConfig: { approved: false, offset_subtracted: null },
        auditReportSha256: "a".repeat(64),
        auditPassed: true,
      }),
    /not approved/
  );

  // Anchor leaked into targetVideoRecords must throw
  assert.throws(
    () =>
      buildApiUrlTidbPayload({
        runId: "run_20261125_999999",
        priority: "P0_craft_recipes",
        targetVideoRecords: [targetRec, { ...targetRec, video_id: "anchor_vid_1" }],
        anchorVideoIds: ["anchor_vid_1"],
        biasConfig: { approved: true, offset_subtracted: 2.2, ci95: [1.5, 2.9], anchor_count_actual: 30 },
        auditReportSha256: "a".repeat(64),
        auditPassed: true,
      }),
    /Refusing to include anchor video/
  );

  // Valid approved build stores BOTH pre-correction rawApiScore and post-correction calibratedScore
  const payload = buildApiUrlTidbPayload({
    runId: "run_20261125_999999",
    priority: "P0_craft_recipes",
    targetVideoRecords: [targetRec],
    anchorVideoIds: ["anchor_vid_1"],
    biasConfig: { approved: true, offset_subtracted: 2.2, ci95: [1.5, 2.9], anchor_count_actual: 30 },
    auditReportSha256: "a".repeat(64),
    auditPassed: true,
  });
  assert.equal(payload.count, 1);
  assert.equal(payload.updates[0].id, "new_vid_1");
  assert.equal(payload.updates[0].calibratedScore, 82.8);
  assert.equal(payload.updates[0].calibratedTierBand, "pro_band");
  assert.equal(payload.updates[0].calibratedRoute, "gemini_api_youtube_url_v1");
  assert.equal(payload.updates[0].calibrationVersion, "gemini_api_youtube_url_v1");
  assert.equal(payload.updates[0].calibratedBreakdown.rawApiScore, 85.0);
  assert.equal(payload.updates[0].calibratedBreakdown.finalScore, 82.8);
  assert.equal(payload.updates[0].calibratedBreakdown.biasCorrection.offsetSubtracted, 2.2);
});

// 5. Overwrite guard & API gate in apply-phase3-batch-to-tidb.mjs
test("apply-phase3-batch-to-tidb guards reject already-calibrated rows and unapproved/unaudited API payloads", () => {
  const conflicts = findAlreadyCalibratedIds([
    { id: "uncal_1", calibratedScore: null },
    { id: "anchor_1", calibratedScore: 84.0, calibrationVersion: "phase2_v1", calibratedRoute: "video_h1" },
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].id, "anchor_1");
  assert.equal(findAlreadyCalibratedIds([{ id: "uncal_1", calibratedScore: null }]).length, 0);

  // Legacy phase2_v1 payload passes API gate untouched (backward compatibility)
  assert.equal(
    validateApiUrlPayloadGate({
      payload: { calibration_version: "phase2_v1", updates: [{ id: "v1", calibratedRoute: "video_h1" }] },
      runDir: os.tmpdir(),
    }).passed,
    true
  );

  // API URL payload fails if audit missing or bias_config_approved !== true or anchor present
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "iketeru-api-gate-"));
  try {
    const failGate = validateApiUrlPayloadGate({
      payload: {
        calibration_version: "gemini_api_youtube_url_v1",
        bias_config_approved: false,
        anchor_video_ids: ["a1"],
        updates: [{ id: "a1", calibratedRoute: "gemini_api_youtube_url_v1" }],
      },
      runDir: tmpDir,
    });
    assert.equal(failGate.passed, false);
    assert.equal(failGate.errors.length, 3);

    fs.writeFileSync(path.join(tmpDir, "api_audit_report.json"), JSON.stringify({ all_checks_passed: true }), "utf8");
    const okGate = validateApiUrlPayloadGate({
      payload: {
        calibration_version: "gemini_api_youtube_url_v1",
        bias_config_approved: true,
        anchor_video_ids: ["a1"],
        updates: [{ id: "t1", calibratedRoute: "gemini_api_youtube_url_v1" }],
      },
      runDir: tmpDir,
    });
    assert.equal(okGate.passed, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 6. All 7 automated audit checks (PASS + every single FAIL mode)
test("auditCallRecord & auditApiUrlRun verify all 7 automated audit checks", () => {
  assert.equal(parseTimestampToSec("01:23"), 83);
  assert.equal(parseTimestampToSec("00:05"), 5);
  assert.equal(parseTimestampToSec("bad"), null);

  const c1 = makeValidCallRecord({ callIndex: 1, videoId: "t1", attempt: 1, totalScore: 76, durationSec: 60, videoTokens: 6050 });
  const c2 = makeValidCallRecord({ callIndex: 2, videoId: "t1", attempt: 2, totalScore: 74, durationSec: 60, videoTokens: 6050 });
  const raw1 = JSON.stringify(c1);
  const raw2 = JSON.stringify(c2);
  const runCfg = {
    run_id: "run_20261125_999999",
    model: "gemini-4-neon",
    thinking_level: "high",
    service_tier: "flex",
    prompt_text: CANONICAL_PROMPT_TEXT,
    target_video_ids: ["t1"],
    anchor_video_ids: ["a1"],
  };

  // Happy path: all 7 pass
  const ok = auditApiUrlRun({
    runConfig: runCfg,
    callRecordsWithMeta: [
      { record: c1, rawFileText: raw1, expectedSha256: sha256Text(raw1) },
      { record: c2, rawFileText: raw2, expectedSha256: sha256Text(raw2) },
    ],
    plannedPayloadVideoIds: ["t1"],
  });
  assert.equal(ok.all_checks_passed, true);

  // Check 1 FAIL: prompt SHA mismatch
  const badPrompt = makeValidCallRecord();
  badPrompt.request.prompt_sha256 = "0".repeat(64);
  assert.equal(auditCallRecord(badPrompt).checks.prompt_sha256_match, false);

  // Check 2 FAIL: wrong service_tier / model
  const badTier = makeValidCallRecord({ serviceTier: "standard" });
  assert.equal(auditCallRecord(badTier, { expectedServiceTier: "flex" }).checks.model_and_tier_match, false);

  // Check 3 FAIL: scores sum mismatch
  const badJson = makeValidCallRecord({ totalScore: 76 });
  badJson.parsed_json.total_score = 99;
  badJson.extracted_text = JSON.stringify(badJson.parsed_json);
  assert.equal(auditCallRecord(badJson).checks.output_json_valid, false);

  // Check 4 FAIL: video tokens < duration * 90
  const lowVidTok = makeValidCallRecord({ durationSec: 60, videoTokens: 5399 });
  assert.equal(auditCallRecord(lowVidTok, { knownDurationSec: 60 }).checks.video_tokens_threshold, false);

  // Check 5 FAIL: observation timestamp exceeds duration + 5s
  const badTs = makeValidCallRecord({ durationSec: 60 });
  badTs.parsed_json.timestamped_observations[2].timestamp = "02:30";
  badTs.extracted_text = JSON.stringify(badTs.parsed_json);
  assert.equal(auditCallRecord(badTs, { knownDurationSec: 60 }).checks.observations_within_duration, false);

  // Check 6 FAIL: secret leaked or SHA mismatch
  const leakRec = makeValidCallRecord();
  const fakeKey = "AIza" + "SyDummySecretKey123456789012345";
  assert.equal(
    auditCallRecord(leakRec, { rawFileText: JSON.stringify(leakRec) + " " + fakeKey }).checks.raw_response_and_no_secrets,
    false
  );
  assert.equal(
    auditCallRecord(leakRec, { rawFileText: raw1, expectedSha256: "f".repeat(64) }).checks.raw_response_and_no_secrets,
    false
  );

  // Check 7 FAIL: anchor leaked into planned payload OR missing 3rd tiebreaker when |r1-r2| >= 5
  const leakedAnchor = auditApiUrlRun({
    runConfig: runCfg,
    callRecordsWithMeta: [
      { record: c1, rawFileText: raw1, expectedSha256: sha256Text(raw1) },
      { record: c2, rawFileText: raw2, expectedSha256: sha256Text(raw2) },
    ],
    plannedPayloadVideoIds: ["t1", "a1"],
  });
  assert.equal(leakedAnchor.checks.ensemble_and_anchor_separation, false);

  const c2Wide = makeValidCallRecord({ callIndex: 2, videoId: "t1", attempt: 2, totalScore: 81 });
  const missingTie = auditApiUrlRun({
    runConfig: runCfg,
    callRecordsWithMeta: [
      { record: c1, rawFileText: raw1, expectedSha256: sha256Text(raw1) },
      { record: c2Wide, rawFileText: JSON.stringify(c2Wide), expectedSha256: sha256Text(JSON.stringify(c2Wide)) },
    ],
  });
  assert.equal(missingTie.checks.ensemble_and_anchor_separation, false);
});

// 7. Constant offset CI95 & claim scoring-channel validation
test("estimateConstantOffsetWithCI95 and validateScoringChannel behave accurately", () => {
  const est = estimateConstantOffsetWithCI95([
    { baseline_score: 80, api_score: 82 },
    { baseline_score: 70, api_score: 73 },
    { baseline_score: 60, api_score: 61 },
    { baseline_score: 90, api_score: 92 },
  ]);
  assert.equal(est.n, 4);
  assert.equal(est.mean_diff_offset, 2);
  assert.ok(Array.isArray(est.ci95) && est.ci95[0] < 2 && est.ci95[1] > 2);

  assert.deepEqual(VALID_SCORING_CHANNELS, ["local_blind", "gemini_api_url"]);
  assert.equal(validateScoringChannel(undefined), null);
  assert.equal(validateScoringChannel("gemini_api_url"), "gemini_api_url");
  assert.throws(() => validateScoringChannel("invalid_channel"), /Invalid --scoring-channel/);
});
