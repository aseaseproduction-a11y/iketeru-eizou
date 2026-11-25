#!/usr/bin/env node
/**
 * Evaluator, anchor bias estimator, and TiDB payload builder for Gemini API YouTube URL batches.
 *
 * Guarantees:
 *  - Separates anchor videos into `anchor_eval_results.json` and NEVER places any anchor ID
 *    in `phase3_batch_payload.json` (`updates`).
 *  - Computes constant-offset bias estimate + 95% confidence interval (t-distribution) over anchors.
 *  - Refuses to write `phase3_batch_payload.json` unless:
 *      1) `analysis/api_url_bias_config_v1.json` has `approved === true` and finite `offset_subtracted`
 *      2) `api_audit_report.json` exists in runDir and has `all_checks_passed === true`
 *  - Always stores BOTH `rawApiScore` (pre-correction) and `finalScore` / `calibratedScore` (post-correction).
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  aggregate2Plus1Scores,
  scoreToCalibratedRank,
  scoreToTierBand,
} from "./run-api-url-batch.mjs";
import { classifyVideoForCalibration } from "./dryrun-phase3-calibration-rollout.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_BIAS_CONFIG_PATH = path.join(REPO_ROOT, "analysis", "api_url_bias_config_v1.json");

// Two-sided 95% t-critical values (df = n - 1)
const T_CRIT_95 = {
  1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
  6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
  11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131,
  16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086,
  21: 2.080, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.060,
  26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042,
};

function tCritical95(df) {
  if (df <= 0) return null;
  if (T_CRIT_95[df]) return T_CRIT_95[df];
  if (df <= 40) return 2.021;
  if (df <= 60) return 2.000;
  return 1.96;
}

function round(n, d = 2) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/**
 * Estimate constant offset delta = mean(api_score - baseline_score) and its 95% CI.
 */
export function estimateConstantOffsetWithCI95(anchorPairs) {
  if (!Array.isArray(anchorPairs) || anchorPairs.length === 0) {
    throw new Error("anchorPairs must be a non-empty array");
  }
  const diffs = anchorPairs.map((p) => Number(p.api_score) - Number(p.baseline_score));
  const n = diffs.length;
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / n;
  const maeRaw = diffs.reduce((a, d) => a + Math.abs(d), 0) / n;

  let sd = 0;
  let se = 0;
  let ci95 = null;
  if (n >= 2) {
    const variance = diffs.reduce((a, d) => a + (d - meanDiff) ** 2, 0) / (n - 1);
    sd = Math.sqrt(variance);
    se = sd / Math.sqrt(n);
    const tCrit = tCritical95(n - 1);
    ci95 = [round(meanDiff - tCrit * se, 3), round(meanDiff + tCrit * se, 3)];
  }

  const maeAfterOffset = diffs.reduce((a, d) => a + Math.abs(d - meanDiff), 0) / n;
  let bandMatchRaw = 0;
  let bandMatchCorrected = 0;
  for (const p of anchorPairs) {
    const baseBand = scoreToTierBand(Number(p.baseline_score));
    if (scoreToTierBand(Number(p.api_score)) === baseBand) bandMatchRaw++;
    const corrected = Math.max(0, Math.min(100, Number(p.api_score) - meanDiff));
    if (scoreToTierBand(corrected) === baseBand) bandMatchCorrected++;
  }

  return {
    n,
    mean_diff_offset: round(meanDiff, 3),
    sd: round(sd, 3),
    se: round(se, 3),
    ci95,
    raw_mae: round(maeRaw, 2),
    corrected_mae_in_sample: round(maeAfterOffset, 2),
    raw_band_match_pct: round((bandMatchRaw / n) * 100, 1),
    corrected_band_match_pct: round((bandMatchCorrected / n) * 100, 1),
  };
}

/**
 * Apply approved constant offset correction and build TiDB update objects strictly for target videos.
 */
export function buildApiUrlTidbPayload({
  runId,
  priority,
  batchIndex = 1,
  targetVideoRecords,
  anchorVideoIds,
  biasConfig,
  auditReportSha256,
  auditPassed,
}) {
  if (!auditPassed) {
    throw new Error("Cannot build TiDB payload: API audit report did not pass.");
  }
  if (!biasConfig || biasConfig.approved !== true || typeof biasConfig.offset_subtracted !== "number" || !Number.isFinite(biasConfig.offset_subtracted)) {
    throw new Error("Cannot build TiDB payload: bias correction config is not approved yet (approved !== true).");
  }

  const anchorSet = new Set((anchorVideoIds || []).map(String));
  const offset = biasConfig.offset_subtracted;
  const tAward = biasConfig.thresholds?.t_award ?? 83;
  const tLow = biasConfig.thresholds?.t_low ?? 63;

  const updates = [];
  for (const rec of targetVideoRecords) {
    const vid = String(rec.video_id);
    if (anchorSet.has(vid)) {
      throw new Error(`Refusing to include anchor video "${vid}" in TiDB payload updates!`);
    }
    const rawApiScore = Number(rec.raw_api_score);
    const correctedScore = round(Math.max(0, Math.min(100, rawApiScore - offset)), 2);
    const rank = scoreToCalibratedRank(correctedScore);
    const tierBand = scoreToTierBand(correctedScore, tAward, tLow);
    const calibratedAt = rec.calibrated_at || new Date().toISOString();

    const breakdown = {
      version: "gemini_api_youtube_url_v1",
      runId,
      route: "gemini_api_youtube_url_v1",
      scoringChannel: "gemini_api_url",
      model: rec.model || "gemini-4-neon",
      modelVersion: rec.model_version || rec.model || "gemini-4-neon",
      thinkingLevel: rec.thinking_level || "high",
      serviceTier: rec.service_tier || "flex",
      promptSha256: rec.prompt_sha256,
      thresholds: { tAward, tLow },
      ensembleRule: rec.ensemble_rule,
      rawScores: rec.raw_scores,
      rawApiScore,
      biasCorrection: {
        method: biasConfig.method || "constant_offset",
        offsetSubtracted: offset,
        ci95: biasConfig.ci95 || null,
        anchorCount: biasConfig.anchor_count_actual ?? null,
        configVersion: biasConfig.config_version || "api_url_bias_v1",
        approvedAt: biasConfig.approved_at || null,
      },
      finalScore: correctedScore,
      rank,
      tierBand,
      dimensions: rec.dimensions,
      rationales: rec.rationales,
      timestampedObservations: rec.timestamped_observations,
      postCheck: rec.post_check,
      usageSummary: rec.usage_summary,
      auditPassed: true,
      auditReportSha256,
      interactionIds: rec.interaction_ids || [],
    };

    updates.push({
      id: vid,
      calibrationStatus: rec.calibration_status,
      calibratedScore: correctedScore,
      calibratedRank: rank,
      calibratedTierBand: tierBand,
      calibratedBreakdown: breakdown,
      calibrationVersion: "gemini_api_youtube_url_v1",
      calibratedAt,
      calibratedRoute: "gemini_api_youtube_url_v1",
      calibratedRunId: runId,
      calibrationGenreBucket: rec.calibration_genre_bucket,
    });
  }

  return {
    generated_at: new Date().toISOString(),
    run_id: runId,
    priority,
    batch_index: batchIndex,
    calibration_version: "gemini_api_youtube_url_v1",
    bias_config_approved: true,
    bias_offset_subtracted: offset,
    anchor_video_ids: [...anchorSet].sort(),
    count: updates.length,
    updates,
  };
}

function parseArgs(argv) {
  const args = { _: [] };
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
    } else {
      args._.push(a);
    }
  }
  return args;
}

async function fetchVideoMetadataMap(ids) {
  if (!ids.length) return new Map();
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
  const mysql = require("mysql2/promise");
  const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
  try {
    const [rows] = await conn.query(
      "SELECT id, platform, videoUrl, genres, purposes, expressions, directions, privateRating, aiOverallScore, aiOverallRating, embedStatus, calibratedScore FROM videos WHERE id IN (?)",
      [ids]
    );
    const map = new Map();
    for (const r of rows) {
      map.set(String(r.id), { row: r, cls: classifyVideoForCalibration(r) });
    }
    return map;
  } finally {
    await conn.end();
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const runId = args._[0] || args["run-id"];
  if (!runId) {
    console.error("Usage: node scripts/evaluate-api-url-batch.mjs <run_id> [--priority <P>] [--bias-config <path>] [--write-payload]");
    process.exit(2);
  }
  const runDir = path.join(REPO_ROOT, "analysis", "runs", runId);
  const runConfig = JSON.parse(fs.readFileSync(path.join(runDir, "run_config.json"), "utf8"));
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "evidence_manifest.json"), "utf8"));
  const biasConfigPath = path.resolve(REPO_ROOT, String(args["bias-config"] || DEFAULT_BIAS_CONFIG_PATH));
  const biasConfig = fs.existsSync(biasConfigPath) ? JSON.parse(fs.readFileSync(biasConfigPath, "utf8")) : null;

  const byVid = new Map();
  for (const entry of manifest.files || []) {
    const rec = JSON.parse(fs.readFileSync(entry.abs_path, "utf8"));
    if (rec.exit_code !== 0 || !rec.parse_ok) continue;
    if (!byVid.has(rec.video_id)) byVid.set(rec.video_id, []);
    byVid.get(rec.video_id).push(rec);
  }

  const allIds = [...byVid.keys()];
  const metaMap = await fetchVideoMetadataMap(allIds);
  const anchorSet = new Set((runConfig.anchor_video_ids || []).map(String));

  const targetRecords = [];
  const anchorPairs = [];

  for (const [vid, calls] of byVid.entries()) {
    const sorted = [...calls].sort((a, b) => a.attempt - b.attempt);
    const rawScores = sorted.map((c) => c.parsed_json.total_score);
    const agg = aggregate2Plus1Scores(rawScores);
    if (agg.status !== "complete") continue;

    const dims = ["direction", "visual_craft", "editing_rhythm", "sound_integration", "originality_finish"];
    const dimMeans = {};
    for (const d of dims) {
      dimMeans[d] = round(sorted.reduce((a, c) => a + c.parsed_json.scores[d], 0) / sorted.length, 2);
    }

    const m = metaMap.get(vid);
    if (anchorSet.has(vid)) {
      const baseScore = m?.row?.calibratedScore != null ? Number(m.row.calibratedScore) : null;
      anchorPairs.push({
        video_id: vid,
        baseline_score: baseScore,
        api_score: agg.final_score,
        raw_scores: rawScores,
        ensemble_rule: agg.ensemble_rule,
        diff: baseScore != null ? round(agg.final_score - baseScore, 2) : null,
      });
    } else {
      targetRecords.push({
        video_id: vid,
        raw_api_score: agg.final_score,
        raw_scores: rawScores,
        ensemble_rule: agg.ensemble_rule,
        model: runConfig.model,
        model_version: sorted[0].response_model || runConfig.model,
        thinking_level: runConfig.thinking_level,
        service_tier: runConfig.service_tier,
        prompt_sha256: runConfig.prompt_sha256,
        calibration_status: m?.cls?.target_status_after_calibration || "calibrated_unverified_genre",
        calibration_genre_bucket: m?.cls?.calibration_genre_bucket || "unverified:empty",
        dimensions: dimMeans,
        rationales: sorted.map((c) => c.parsed_json.brief_rationale),
        timestamped_observations: sorted.map((c) => c.parsed_json.timestamped_observations),
        post_check: {
          knowsWork: sorted.some((c) => c.parsed_json.post_check.knows_work),
          knowsAwardHistory: sorted.some((c) => c.parsed_json.post_check.knows_award_history),
          awardBadgeVisibleInVideo: sorted.some((c) => c.parsed_json.post_check.award_badge_visible_in_video),
          perRunKnowsWork: sorted.map((c) => c.parsed_json.post_check.knows_work),
        },
        usage_summary: {
          callsCount: sorted.length,
          inputVideoTokens: sorted[0].usage_breakdown.input_video_tokens,
          inputTextTokens: sorted[0].usage_breakdown.input_text_tokens,
          avgOutputTokens: round(sorted.reduce((a, c) => a + c.usage_breakdown.total_output_tokens, 0) / sorted.length, 1),
          avgThoughtTokens: round(sorted.reduce((a, c) => a + c.usage_breakdown.total_thought_tokens, 0) / sorted.length, 1),
          totalCostUsd: round(sorted.reduce((a, c) => a + (c.cost?.call_cost_usd || 0), 0), 6),
        },
        interaction_ids: sorted.map((c) => c.interaction_id).filter(Boolean),
      });
    }
  }

  const validAnchors = anchorPairs.filter((a) => a.baseline_score != null);
  const anchorReport = {
    generated_at: new Date().toISOString(),
    run_id: runId,
    anchor_count: validAnchors.length,
    offset_estimate: validAnchors.length > 0 ? estimateConstantOffsetWithCI95(validAnchors) : null,
    anchors: anchorPairs,
  };
  fs.writeFileSync(path.join(runDir, "anchor_eval_results.json"), JSON.stringify(anchorReport, null, 2) + "\n", "utf8");

  // Always write local pre-approval summary
  fs.writeFileSync(
    path.join(runDir, "evaluated_local_only.json"),
    JSON.stringify({ run_id: runId, targets_count: targetRecords.length, anchors_count: anchorPairs.length, targets: targetRecords }, null, 2) + "\n",
    "utf8"
  );

  if (args["write-payload"]) {
    const auditPath = path.join(runDir, "api_audit_report.json");
    if (!fs.existsSync(auditPath)) {
      throw new Error(`Missing audit report: ${auditPath}. Run audit-api-url-run.mjs --write-report first.`);
    }
    const auditRaw = fs.readFileSync(auditPath, "utf8");
    const audit = JSON.parse(auditRaw);
    const auditSha = crypto.createHash("sha256").update(auditRaw, "utf8").digest("hex");

    const payload = buildApiUrlTidbPayload({
      runId,
      priority: String(args["priority"] || "P0_craft_recipes"),
      batchIndex: parseInt(String(args["batch-index"] || "1"), 10),
      targetVideoRecords: targetRecords,
      anchorVideoIds: runConfig.anchor_video_ids || [],
      biasConfig,
      auditReportSha256: auditSha,
      auditPassed: audit.all_checks_passed === true,
    });
    const payloadPath = path.join(runDir, "phase3_batch_payload.json");
    fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
    console.log(`Wrote TiDB payload: ${payloadPath} (updates=${payload.count}, excluded_anchors=${payload.anchor_video_ids.length})`);
  } else {
    console.log(JSON.stringify({ run_id: runId, targets_evaluated: targetRecords.length, anchors_evaluated: validAnchors.length, bias_approved: Boolean(biasConfig?.approved) }, null, 2));
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
