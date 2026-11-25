#!/usr/bin/env node
/**
 * Aggregate and analyze results of a Gemini API YouTube URL pilot run.
 * Read-only on TiDB / SQLite; writes analysis report only inside the pilot run directory.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

function scoreToBand(score) {
  if (score >= 83) return ">=83";
  if (score >= 63) return "63-82";
  return "<63";
}

function round(n, d = 2) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function summarizeSubset(items) {
  if (!items.length) return null;
  const absErrs = items.map((x) => Math.abs(x.diff_mean_minus_base));
  const signedErrs = items.map((x) => x.diff_mean_minus_base);
  const bandMatches = items.filter((x) => x.band_match).length;
  const diffsR1R2 = items.map((x) => x.r1_r2_abs_diff);
  return {
    n: items.length,
    mae: round(mean(absErrs), 2),
    mean_signed_error: round(mean(signedErrs), 2),
    max_abs_error: round(Math.max(...absErrs), 2),
    band_match_count: bandMatches,
    band_match_pct: round((bandMatches / items.length) * 100, 1),
    mean_r1_r2_diff: round(mean(diffsR1R2), 2),
    r1_r2_lt5_count: diffsR1R2.filter((d) => d < 5).length,
    r1_r2_lt5_pct: round((diffsR1R2.filter((d) => d < 5).length / items.length) * 100, 1),
  };
}

function main() {
  const runId = process.argv[2] || "run_20261125_125425";
  const runDir = path.join(REPO_ROOT, "analysis", "pilot_gemini_api_url", runId);
  const sel = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "analysis", "pilot_gemini_api_url", "selected_10_videos.json"), "utf8")
  );
  const callsDir = path.join(runDir, "calls");
  const calls = fs
    .readdirSync(callsDir)
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(callsDir, f), "utf8")));

  const perVideo = [];
  for (const v of sel.selected) {
    const vc = calls.filter((c) => c.video_id === v.video_id).sort((a, b) => a.attempt - b.attempt);
    const r1 = vc[0];
    const r2 = vc[1];
    const s1 = r1.parsed_json.total_score;
    const s2 = r2.parsed_json.total_score;
    const apiMean = round((s1 + s2) / 2, 2);
    const diffMeanMinusBase = round(apiMean - v.calibrated_score, 2);
    const absDiff = round(Math.abs(diffMeanMinusBase), 2);
    const r1r2Diff = Math.abs(s1 - s2);
    const apiBand = scoreToBand(apiMean);
    const bandMatch = apiBand === v.band;
    const kwR1 = r1.parsed_json.post_check.knows_work;
    const kwR2 = r2.parsed_json.post_check.knows_work;
    const apiKnowsWorkAny = Boolean(kwR1 || kwR2);

    const vidTok1 = r1.usage_breakdown.input_video_tokens;
    const vidTok2 = r2.usage_breakdown.input_video_tokens;
    const vidTokPerSec = round(vidTok1 / v.duration_sec, 2);
    const txtTok1 = r1.usage_breakdown.input_text_tokens;
    const outTokAvg = round((r1.usage_breakdown.total_output_tokens + r2.usage_breakdown.total_output_tokens) / 2, 1);
    const thTokAvg = round((r1.usage_breakdown.total_thought_tokens + r2.usage_breakdown.total_thought_tokens) / 2, 1);
    const cost2Calls = round(r1.cost.call_cost_usd + r2.cost.call_cost_usd, 6);
    const time2Calls = round(r1.elapsed_sec + r2.elapsed_sec, 2);

    // Per-dimension comparison vs baseline if available
    const dimKeys = ["direction", "visual_craft", "editing_rhythm", "sound_integration", "originality_finish"];
    const dimComparison = {};
    for (const k of dimKeys) {
      const apiDimMean = round((r1.parsed_json.scores[k] + r2.parsed_json.scores[k]) / 2, 2);
      const baseDim = v.baseline_dimensions?.[k] ?? null;
      dimComparison[k] = {
        base: baseDim,
        api_mean: apiDimMean,
        diff: baseDim != null ? round(apiDimMean - baseDim, 2) : null,
      };
    }

    perVideo.push({
      video_id: v.video_id,
      duration_sec: v.duration_sec,
      route_raw: v.route_raw,
      route_group: v.route_group,
      base_score: v.calibrated_score,
      base_rank: v.calibrated_rank,
      base_band: v.band,
      base_knows_work: v.knows_work,
      api_r1_score: s1,
      api_r2_score: s2,
      api_mean_score: apiMean,
      api_band: apiBand,
      band_match: bandMatch,
      diff_mean_minus_base: diffMeanMinusBase,
      abs_error: absDiff,
      r1_r2_abs_diff: r1r2Diff,
      r1_r2_lt5: r1r2Diff < 5,
      api_knows_work_r1: kwR1,
      api_knows_work_r2: kwR2,
      api_knows_work_any: apiKnowsWorkAny,
      post_check_notes: [r1.parsed_json.post_check.post_check_note, r2.parsed_json.post_check.post_check_note],
      usage: {
        r1: r1.usage_breakdown,
        r2: r2.usage_breakdown,
        video_tokens_same_across_runs: vidTok1 === vidTok2,
        input_video_tokens: vidTok1,
        input_text_tokens: txtTok1,
        video_tokens_per_sec: vidTokPerSec,
        avg_output_tokens: outTokAvg,
        avg_thought_tokens: thTokAvg,
      },
      cost_2_calls_usd: cost2Calls,
      cost_per_call_usd: round(cost2Calls / 2, 6),
      time_2_calls_sec: time2Calls,
      time_per_call_sec: round(time2Calls / 2, 2),
      dim_comparison: dimComparison,
      sum_mismatch_any: Boolean(r1.scores_sum_mismatch || r2.scores_sum_mismatch),
    });
  }

  // Linear fit for input_video_tokens and input_text_tokens vs duration_sec
  const xs = perVideo.map((v) => v.duration_sec);
  const ysVid = perVideo.map((v) => v.usage.input_video_tokens);
  const ysTxt = perVideo.map((v) => v.usage.input_text_tokens);
  function linReg(x, y) {
    const mx = mean(x);
    const my = mean(y);
    let num = 0;
    let den = 0;
    for (let i = 0; i < x.length; i++) {
      num += (x[i] - mx) * (y[i] - my);
      den += (x[i] - mx) ** 2;
    }
    const slope = num / den;
    const intercept = my - slope * mx;
    return { slope: round(slope, 3), intercept: round(intercept, 1) };
  }

  const totalCost = round(calls.reduce((a, c) => a + c.cost.call_cost_usd, 0), 6);
  const totalTimeSec = round(calls.reduce((a, c) => a + c.elapsed_sec, 0), 2);
  const avgOutTok = round(mean(calls.map((c) => c.usage_breakdown.total_output_tokens)), 1);
  const avgThTok = round(mean(calls.map((c) => c.usage_breakdown.total_thought_tokens)), 1);
  const totalDur = perVideo.reduce((a, v) => a + v.duration_sec, 0);
  const totalVidTokOnePass = perVideo.reduce((a, v) => a + v.usage.input_video_tokens, 0);

  const report = {
    run_id: runId,
    generated_at: new Date().toISOString(),
    overall: summarizeSubset(perVideo),
    by_route_group: {
      video: summarizeSubset(perVideo.filter((v) => v.route_group === "video")),
      contact_sheet: summarizeSubset(perVideo.filter((v) => v.route_group === "contact_sheet")),
    },
    by_band: {
      ">=83": summarizeSubset(perVideo.filter((v) => v.base_band === ">=83")),
      "63-82": summarizeSubset(perVideo.filter((v) => v.base_band === "63-82")),
      "<63": summarizeSubset(perVideo.filter((v) => v.base_band === "<63")),
    },
    by_knows_work: {
      api_knows_work_true_rate_videos_pct: round(
        (perVideo.filter((v) => v.api_knows_work_any).length / perVideo.length) * 100,
        1
      ),
      api_knows_work_true_rate_calls_pct: round(
        (calls.filter((c) => c.parsed_json.post_check.knows_work === true).length / calls.length) * 100,
        1
      ),
      by_api_knows_work: {
        true: summarizeSubset(perVideo.filter((v) => v.api_knows_work_any)),
        false: summarizeSubset(perVideo.filter((v) => !v.api_knows_work_any)),
      },
      by_base_knows_work: {
        true: summarizeSubset(perVideo.filter((v) => v.base_knows_work)),
        false: summarizeSubset(perVideo.filter((v) => !v.base_knows_work)),
      },
    },
    dimension_mean_diffs: Object.fromEntries(
      ["direction", "visual_craft", "editing_rhythm", "sound_integration", "originality_finish"].map((k) => [
        k,
        round(
          mean(perVideo.map((v) => v.dim_comparison[k].diff).filter((d) => d != null)),
          2
        ),
      ])
    ),
    cost_and_latency: {
      total_calls: calls.length,
      total_cost_usd: totalCost,
      cost_per_video_2calls_usd: round(totalCost / perVideo.length, 4),
      cost_per_call_usd: round(totalCost / calls.length, 4),
      total_api_time_sec: totalTimeSec,
      avg_time_per_call_sec: round(totalTimeSec / calls.length, 2),
      avg_time_per_video_2calls_sec: round(totalTimeSec / perVideo.length, 2),
      suspect_video_calls_lt1000: calls.filter((c) => c.usage_breakdown.suspect_video_not_processed).length,
    },
    token_duration_model: {
      weighted_video_tokens_per_sec: round(totalVidTokOnePass / totalDur, 2),
      per_video_tok_per_sec_min: Math.min(...perVideo.map((v) => v.usage.video_tokens_per_sec)),
      per_video_tok_per_sec_max: Math.max(...perVideo.map((v) => v.usage.video_tokens_per_sec)),
      linear_fit_video_tokens: linReg(xs, ysVid),
      linear_fit_text_tokens: linReg(xs, ysTxt),
      avg_output_tokens_per_call: avgOutTok,
      avg_thought_tokens_per_call: avgThTok,
      avg_output_plus_thought_tokens_per_call: round(avgOutTok + avgThTok, 1),
    },
    per_video: perVideo,
  };

  const outPath = path.join(runDir, "analysis_summary.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`Saved analysis to ${outPath}`);
  console.log(JSON.stringify({
    overall: report.overall,
    by_route_group: report.by_route_group,
    by_knows_work: report.by_knows_work,
    dimension_mean_diffs: report.dimension_mean_diffs,
    cost_and_latency: report.cost_and_latency,
    token_duration_model: report.token_duration_model,
  }, null, 2));
}

main();
