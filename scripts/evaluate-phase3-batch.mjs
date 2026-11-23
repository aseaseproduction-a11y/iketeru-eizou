#!/usr/bin/env node
/**
 * Phase 3 Step C — Batch Evaluator, Dispatch Planner & Report Generator.
 *
 * Strictly enforces frozen Phase 2 v1 rules:
 *  - Verifies analysis/phase2_frozen_config_v1.json against git HEAD via validateSplitGuard
 *  - Exact 2+1 ensemble (tiebreaker at |r1 - r2| >= 5, median of 3 else mean of 2)
 *  - Exact H1 pre-route + H2 escalation (T_award=83, T_low=63)
 *  - 100% strict audit pass & 100% expected_model match required for payload generation
 *  - Generates mandatory privateRating vs calibratedScore reference comparison table
 *    (explicitly marked reference-only, never used to adjust frozen thresholds)
 *
 * Usage:
 *   node scripts/evaluate-phase3-batch.mjs <run_id> --frozen-config analysis/phase2_frozen_config_v1.json [--status]
 *   node scripts/evaluate-phase3-batch.mjs <run_id> --frozen-config analysis/phase2_frozen_config_v1.json --next-dispatch 24 [--exclude-dispatched]
 *   node scripts/evaluate-phase3-batch.mjs <run_id> --frozen-config analysis/phase2_frozen_config_v1.json --write-report
 */

import fs from "node:fs";
import path from "node:path";
import { decideEscalation, decidePhase1Route } from "./phase2-hybrid-router.mjs";
import { validateSplitGuard } from "./prepare-phase2-run.mjs";
import { renderCalibrationPrompt } from "./lib/calibration-prompt-template.mjs";

const REPO_ROOT = "E:\\iketeru-eizou";

const RATING_BANDS = [
  { grade: "S+", min: 97, max: 100 },
  { grade: "S",  min: 93, max: 96 },
  { grade: "S-", min: 90, max: 92 },
  { grade: "A+", min: 86, max: 89 },
  { grade: "A",  min: 82, max: 85 },
  { grade: "A-", min: 78, max: 81 },
  { grade: "B+", min: 73, max: 77 },
  { grade: "B",  min: 68, max: 72 },
  { grade: "B-", min: 63, max: 67 },
  { grade: "C+", min: 57, max: 62 },
  { grade: "C",  min: 51, max: 56 },
  { grade: "C-", min: 45, max: 50 },
  { grade: "D",  min: 0,  max: 44 },
];

export function scoreToCalibratedRank(score) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  for (const b of RATING_BANDS) {
    if (clamped >= b.min && clamped <= b.max) return b.grade;
  }
  return "D";
}

export function scoreToTierBand(score, tAward = 83, tLow = 63) {
  if (score >= tAward) return "award_tier";
  if (score >= tLow) return "pro_band";
  return "low_band";
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 100) / 100;
}

function mean(arr) {
  if (!arr.length) return null;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;
}

function avgDims(list) {
  const keys = ["direction", "visual_craft", "editing_rhythm", "sound_integration", "originality_finish"];
  const out = {};
  for (const k of keys) {
    const vals = list.map((x) => x.scores?.[k]).filter((v) => typeof v === "number" && Number.isFinite(v));
    out[k] = vals.length ? mean(vals) : null;
  }
  return out;
}

function aggregate2Plus1(rows) {
  const byVid = new Map();
  for (const r of rows) {
    if (!byVid.has(r.video_id)) byVid.set(r.video_id, []);
    byVid.get(r.video_id).push(r);
  }
  const out = new Map();
  for (const [vid, list] of byVid.entries()) {
    // Deduplicate by attempt (keep latest valid run per attempt)
    const byAttempt = new Map();
    for (const r of list) {
      byAttempt.set(r.attempt || 1, r);
    }
    const deduped = [...byAttempt.values()].sort((a, b) => (a.attempt || 0) - (b.attempt || 0));
    const scores = deduped.map((x) => x.total_score);
    let aiScore = null;
    let rule = "insufficient";
    if (scores.length === 1) {
      aiScore = scores[0];
      rule = "single_run_incomplete";
    } else if (scores.length === 2) {
      const diff = Math.abs(scores[0] - scores[1]);
      if (diff >= 5) {
        aiScore = Math.round(((scores[0] + scores[1]) / 2) * 100) / 100;
        rule = "needs_3rd_tiebreaker";
      } else {
        aiScore = Math.round(((scores[0] + scores[1]) / 2) * 100) / 100;
        rule = "mean_of_2";
      }
    } else if (scores.length >= 3) {
      aiScore = median(scores.slice(0, 3));
      rule = "median_of_3";
    }

    const usedRuns = scores.length >= 3 ? deduped.slice(0, 3) : deduped;
    const getIn = (x) => x.token_usage?.first_post_read_input_tokens ?? x.token_usage?.input_tokens ?? 0;
    const getEff = (x) => x.token_usage?.first_post_read_effective_input_tokens ?? x.token_usage?.effective_input_tokens ?? 0;

    out.set(vid, {
      video_id: vid,
      run_count: deduped.length,
      attempts_present: deduped.map((x) => x.attempt),
      raw_scores: scores,
      ai_score: aiScore,
      ensemble_rule: rule,
      dimension_means: avgDims(usedRuns),
      per_run: usedRuns.map((x) => ({
        attempt: x.attempt,
        total_score: x.total_score,
        rank: x.rank,
        scores: x.scores,
        brief_rationale: x.brief_rationale || "",
        subagent_id: x.subagent_id,
        recorded_at: x.recorded_at,
        post_check: x.post_check,
      })),
      knows_work: usedRuns.some((x) => x.post_check?.knows_work === true),
      knows_award_history: usedRuns.some((x) => x.post_check?.knows_award_history === true),
      award_badge_visible_in_video: usedRuns.some((x) => x.post_check?.award_badge_visible_in_video === true),
      total_input_tokens: usedRuns.reduce((a, x) => a + getIn(x), 0),
      total_effective_input_tokens: usedRuns.reduce((a, x) => a + getEff(x), 0),
      rationales: usedRuns.map((x) => x.brief_rationale || ""),
    });
  }
  return out;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[k] = true;
      } else {
        args[k] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function buildPrivateRatingComparison(records, tAward, tLow) {
  const privOrder = ["S", "A", "B", "C", "D"];
  const byPriv = {};
  for (const r of records) {
    const p = r.private_rating || "(none)";
    if (!byPriv[p]) byPriv[p] = [];
    byPriv[p].push(r);
  }
  const summarizeGroup = (arr) => {
    const cal = arr.map((x) => x.calibrated_score);
    const leg = arr.map((x) => x.legacy_overall_score).filter((v) => typeof v === "number");
    const awardCnt = arr.filter((x) => x.calibrated_score >= tAward).length;
    const proCnt = arr.filter((x) => x.calibrated_score >= tLow && x.calibrated_score < tAward).length;
    const lowCnt = arr.filter((x) => x.calibrated_score < tLow).length;
    const deltas = arr
      .filter((x) => typeof x.legacy_overall_score === "number")
      .map((x) => Math.round((x.calibrated_score - x.legacy_overall_score) * 100) / 100);
    return {
      count: arr.length,
      calibrated_mean: mean(cal),
      calibrated_median: median(cal),
      calibrated_min: Math.min(...cal),
      calibrated_max: Math.max(...cal),
      award_tier_gte_83_count: awardCnt,
      award_tier_gte_83_pct: Math.round((awardCnt / arr.length) * 1000) / 10,
      pro_band_63_to_82_99_count: proCnt,
      low_band_lt_63_count: lowCnt,
      legacy_count: leg.length,
      legacy_mean: mean(leg),
      mean_delta_calibrated_minus_legacy: mean(deltas),
    };
  };

  const overallByPrivateRating = {};
  for (const k of [...privOrder, ...Object.keys(byPriv)]) {
    if (byPriv[k] && !overallByPrivateRating[k]) {
      overallByPrivateRating[k] = summarizeGroup(byPriv[k]);
    }
  }

  // Reference heuristic for concordance display (strictly diagnostic):
  //   privateRating S -> expected calibrated >= 83 (award_tier)
  //   privateRating A -> expected calibrated >= 78 (A- or higher)
  //   privateRating B -> expected calibrated 63..82.99 (pro_band)
  //   privateRating C -> expected calibrated < 73 (B or lower)
  function isRoughMatch(r) {
    const p = r.private_rating;
    const s = r.calibrated_score;
    if (p === "S") return s >= tAward;
    if (p === "A") return s >= 78;
    if (p === "B") return s >= tLow && s < tAward;
    if (p === "C") return s < 73;
    return false;
  }

  const byGenre = {};
  for (const r of records) {
    const g = r.calibration_genre_bucket;
    if (!byGenre[g]) byGenre[g] = [];
    byGenre[g].push(r);
  }
  const perGenreComparison = Object.entries(byGenre)
    .map(([genre, arr]) => {
      const subPriv = {};
      for (const r of arr) {
        const p = r.private_rating || "(none)";
        if (!subPriv[p]) subPriv[p] = [];
        subPriv[p].push(r.calibrated_score);
      }
      const privMeans = Object.fromEntries(
        Object.entries(subPriv).map(([k, vals]) => [k, { n: vals.length, mean: mean(vals), median: median(vals) }])
      );
      const matches = arr.filter(isRoughMatch).length;
      const divergences = arr.length - matches;
      const sItems = arr.filter((x) => x.private_rating === "S");
      const aItems = arr.filter((x) => x.private_rating === "A");
      const bItems = arr.filter((x) => x.private_rating === "B");
      return {
        genre_bucket: genre,
        genre_verified: arr[0].genre_verified,
        count: arr.length,
        calibrated_mean: mean(arr.map((x) => x.calibrated_score)),
        calibrated_median: median(arr.map((x) => x.calibrated_score)),
        award_tier_count: arr.filter((x) => x.calibrated_score >= tAward).length,
        rough_concordance_count: matches,
        rough_divergence_count: divergences,
        rough_divergence_rate_pct: Math.round((divergences / arr.length) * 1000) / 10,
        by_private_rating: privMeans,
        s_below_83_count: sItems.filter((x) => x.calibrated_score < tAward).length,
        a_below_78_count: aItems.filter((x) => x.calibrated_score < 78).length,
        b_gte_83_count: bItems.filter((x) => x.calibrated_score >= tAward).length,
      };
    })
    .sort((a, b) => b.rough_divergence_rate_pct - a.rough_divergence_rate_pct || b.count - a.count);

  const notableDivergences = {
    private_S_below_83: records
      .filter((r) => r.private_rating === "S" && r.calibrated_score < tAward)
      .sort((a, b) => a.calibrated_score - b.calibrated_score)
      .map((r) => ({
        video_id: r.video_id,
        title: r.title,
        genre_bucket: r.calibration_genre_bucket,
        private_rating: r.private_rating,
        calibrated_score: r.calibrated_score,
        calibrated_rank: r.calibrated_rank,
        legacy_overall_score: r.legacy_overall_score,
        route: r.calibrated_route,
      })),
    private_B_or_C_gte_83: records
      .filter((r) => (r.private_rating === "B" || r.private_rating === "C") && r.calibrated_score >= tAward)
      .sort((a, b) => b.calibrated_score - a.calibrated_score)
      .map((r) => ({
        video_id: r.video_id,
        title: r.title,
        genre_bucket: r.calibration_genre_bucket,
        private_rating: r.private_rating,
        calibrated_score: r.calibrated_score,
        calibrated_rank: r.calibrated_rank,
        legacy_overall_score: r.legacy_overall_score,
        route: r.calibrated_route,
      })),
    private_A_below_73: records
      .filter((r) => r.private_rating === "A" && r.calibrated_score < 73)
      .sort((a, b) => a.calibrated_score - b.calibrated_score)
      .map((r) => ({
        video_id: r.video_id,
        title: r.title,
        genre_bucket: r.calibration_genre_bucket,
        private_rating: r.private_rating,
        calibrated_score: r.calibrated_score,
        calibrated_rank: r.calibrated_rank,
        legacy_overall_score: r.legacy_overall_score,
        route: r.calibrated_route,
      })),
  };

  return {
    disclaimer:
      "参考情報のみ（Phase 3 承認条件4）。ユーザーの privateRating（個人的な好み・保存理由）と Phase 2 凍結校正スコア（客観クラフト到達度）の傾向比較であり、採点基準や閾値（T_award=83, T_low=63）の変更には使用しない。",
    diagnostic_rough_match_rule: "S: >=83 / A: >=78 / B: 63..82.99 / C: <73",
    overall_by_private_rating: overallByPrivateRating,
    per_genre_comparison: perGenreComparison,
    notable_divergences: notableDivergences,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const runId = args._[0];
  const cfgArg = args["frozen-config"] || "analysis/phase2_frozen_config_v1.json";
  const nextDispatchN = args["next-dispatch"] ? parseInt(args["next-dispatch"], 10) : 0;
  const excludeDispatched = Boolean(args["exclude-dispatched"]);
  const writeReport = Boolean(args["write-report"]);
  const outJsonPath = args["out-json"] || null;

  if (!runId) {
    console.error("Usage: node scripts/evaluate-phase3-batch.mjs <run_id> [--frozen-config <path>] [--status] [--next-dispatch N] [--write-report]");
    process.exit(2);
  }

  const frozenConfigPath = path.resolve(REPO_ROOT, cfgArg);
  const frozenConfig = validateSplitGuard({
    splitName: "holdout",
    confirmFrozenHoldout: true,
    frozenConfigPath,
    repoRoot: REPO_ROOT,
  });

  const tAward = frozenConfig.t_award;
  const tLow = frozenConfig.t_low;
  const expectedModel = frozenConfig.expected_model;

  const runDir = path.join(REPO_ROOT, "analysis", "runs", runId);
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "run_manifest.json"), "utf8"));
  const selection = JSON.parse(fs.readFileSync(path.join(runDir, "batch_selection.json"), "utf8"));
  const selById = new Map(selection.items.map((x) => [x.video_id, x]));

  const rawPath = path.join(runDir, "raw_scores.jsonl");
  const rawLines = fs.existsSync(rawPath)
    ? fs.readFileSync(rawPath, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
    : [];

  const dispatchPath = path.join(runDir, "dispatch_log.jsonl");
  const dispatchedKeys = new Set();
  if (fs.existsSync(dispatchPath)) {
    for (const l of fs.readFileSync(dispatchPath, "utf8").split(/\r?\n/).filter(Boolean)) {
      const d = JSON.parse(l);
      dispatchedKeys.add(`${d.video_id}::${d.mode}::${d.attempt}`);
    }
  }

  const validVideoRuns = rawLines.filter(
    (r) => r.mode === "video" && r.audit_valid === true && typeof r.total_score === "number"
  );
  const validCsRuns = rawLines.filter(
    (r) => r.mode === "contact_sheet" && r.audit_valid === true && typeof r.total_score === "number"
  );
  const invalidRuns = rawLines.filter((r) => r.audit_valid !== true);

  const allValidRuns = [...validVideoRuns, ...validCsRuns];
  const modelMismatches = allValidRuns.filter((r) => {
    const obs = r.models_observed?.length ? r.models_observed : r.token_usage?.model ? [r.token_usage.model] : [];
    return obs.length === 0 || !obs.every((m) => m === expectedModel);
  });

  const videoAgg = aggregate2Plus1(validVideoRuns);
  const csAgg = aggregate2Plus1(validCsRuns);

  const pendingJobs = [];
  const finalizedRecords = [];
  const stageStats = {
    stage1_missing_jobs: 0,
    stage1_tiebreaker_jobs: 0,
    stage2_escalation_jobs: 0,
    stage2_tiebreaker_jobs: 0,
    finalized_videos: 0,
  };

  for (const sel of selection.items) {
    const vid = sel.video_id;
    const mItem = manifest.items?.[vid];
    if (!mItem) continue;

    const itemForRoute = {
      genre: mItem.routing_genre,
      duration_sec: mItem.metrics.duration_sec,
      total_cuts: mItem.metrics.total_cuts,
      avg_cut_interval_sec: mItem.metrics.avg_cut_interval_sec,
      max_cuts_per_10s: mItem.metrics.max_cuts_per_10s,
      integrated_lufs: mItem.metrics.integrated_lufs,
    };
    const h1 = decidePhase1Route(itemForRoute);
    const v = videoAgg.get(vid) || null;
    const c = csAgg.get(vid) || null;

    if (h1.route === "video") {
      const present = new Set(v?.attempts_present || []);
      if (!present.has(1)) {
        stageStats.stage1_missing_jobs++;
        pendingJobs.push({ stage: "stage1_video", video_id: vid, blind_id: mItem.blind_id, mode: "video", attempt: 1 });
      }
      if (!present.has(2)) {
        stageStats.stage1_missing_jobs++;
        pendingJobs.push({ stage: "stage1_video", video_id: vid, blind_id: mItem.blind_id, mode: "video", attempt: 2 });
      }
      if (v && v.run_count === 2 && v.ensemble_rule === "needs_3rd_tiebreaker" && !present.has(3)) {
        stageStats.stage1_tiebreaker_jobs++;
        pendingJobs.push({ stage: "stage1_video_tiebreaker", video_id: vid, blind_id: mItem.blind_id, mode: "video", attempt: 3 });
      }
      if (v && (v.ensemble_rule === "mean_of_2" || v.ensemble_rule === "median_of_3")) {
        stageStats.finalized_videos++;
        finalizedRecords.push(buildFinalRecord({ sel, mItem, runId, tAward, tLow, expectedModel, route: "video_h1", h1Triggers: h1.triggers, h2Triggers: [], finalAgg: v, csAgg: null }));
      }
    } else {
      const cPresent = new Set(c?.attempts_present || []);
      if (!cPresent.has(1)) {
        stageStats.stage1_missing_jobs++;
        pendingJobs.push({ stage: "stage1_cs", video_id: vid, blind_id: mItem.blind_id, mode: "contact_sheet", attempt: 1 });
      }
      if (!cPresent.has(2)) {
        stageStats.stage1_missing_jobs++;
        pendingJobs.push({ stage: "stage1_cs", video_id: vid, blind_id: mItem.blind_id, mode: "contact_sheet", attempt: 2 });
      }
      if (c && c.run_count === 2 && c.ensemble_rule === "needs_3rd_tiebreaker" && !cPresent.has(3)) {
        stageStats.stage1_tiebreaker_jobs++;
        pendingJobs.push({ stage: "stage1_cs_tiebreaker", video_id: vid, blind_id: mItem.blind_id, mode: "contact_sheet", attempt: 3 });
      }
      if (!c || (c.ensemble_rule !== "mean_of_2" && c.ensemble_rule !== "median_of_3")) {
        continue;
      }

      const h2 = decideEscalation(itemForRoute, c.ai_score, { tAward, tLow });
      if (!h2.escalate) {
        stageStats.finalized_videos++;
        finalizedRecords.push(buildFinalRecord({ sel, mItem, runId, tAward, tLow, expectedModel, route: "contact_sheet", h1Triggers: [], h2Triggers: [], finalAgg: c, csAgg: c }));
      } else {
        const vPresent = new Set(v?.attempts_present || []);
        if (!vPresent.has(1)) {
          stageStats.stage2_escalation_jobs++;
          pendingJobs.push({ stage: "stage2_h2_video", video_id: vid, blind_id: mItem.blind_id, mode: "video", attempt: 1 });
        }
        if (!vPresent.has(2)) {
          stageStats.stage2_escalation_jobs++;
          pendingJobs.push({ stage: "stage2_h2_video", video_id: vid, blind_id: mItem.blind_id, mode: "video", attempt: 2 });
        }
        if (v && v.run_count === 2 && v.ensemble_rule === "needs_3rd_tiebreaker" && !vPresent.has(3)) {
          stageStats.stage2_tiebreaker_jobs++;
          pendingJobs.push({ stage: "stage2_h2_tiebreaker", video_id: vid, blind_id: mItem.blind_id, mode: "video", attempt: 3 });
        }
        if (v && (v.ensemble_rule === "mean_of_2" || v.ensemble_rule === "median_of_3")) {
          stageStats.finalized_videos++;
          finalizedRecords.push(buildFinalRecord({ sel, mItem, runId, tAward, tLow, expectedModel, route: "video_h2_escalated", h1Triggers: [], h2Triggers: h2.triggers, finalAgg: v, csAgg: c }));
        }
      }
    }
  }

  if (nextDispatchN > 0) {
    const filtered = excludeDispatched
      ? pendingJobs.filter((j) => !dispatchedKeys.has(`${j.video_id}::${j.mode}::${j.attempt}`))
      : pendingJobs;
    const chosen = filtered.slice(0, nextDispatchN).map((j) => {
      const specPath = path.join(runDir, "specs", `${j.video_id}_${j.mode}.json`);
      const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
      const modeShort = j.mode === "contact_sheet" ? "cs" : "video";
      return {
        ...j,
        role: `Blind Eval ${j.blind_id} ${modeShort} r${j.attempt}`,
        prompt: renderCalibrationPrompt(spec),
      };
    });
    const outObj = {
      run_id: runId,
      total_pending: pendingJobs.length,
      filtered_pending: filtered.length,
      returned: chosen.length,
      stage_stats: stageStats,
      jobs: chosen,
    };
    if (outJsonPath) {
      fs.writeFileSync(outJsonPath, JSON.stringify(outObj, null, 2), "utf8");
      console.log(`Wrote ${chosen.length} dispatch jobs to ${outJsonPath} (total_pending=${pendingJobs.length}, finalized=${stageStats.finalized_videos}/${manifest.prepared_count})`);
    } else {
      console.log(JSON.stringify(outObj, null, 2));
    }
    return;
  }

  const summary = {
    run_id: runId,
    priority: manifest.priority,
    batch_index: manifest.batch_index,
    target_count: manifest.target_count,
    prepared_count: manifest.prepared_count,
    finalized_count: finalizedRecords.length,
    pending_jobs_count: pendingJobs.length,
    stage_stats: stageStats,
    valid_runs_total: allValidRuns.length,
    valid_video_runs: validVideoRuns.length,
    valid_cs_runs: validCsRuns.length,
    invalid_runs_count: invalidRuns.length,
    model_mismatches_count: modelMismatches.length,
  };

  if (!writeReport) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (finalizedRecords.length !== manifest.prepared_count) {
    throw new Error(`Cannot write final report: finalized=${finalizedRecords.length} !== prepared=${manifest.prepared_count} (pending_jobs=${pendingJobs.length})`);
  }
  if (modelMismatches.length > 0) {
    throw new Error(`Cannot write final report: ${modelMismatches.length} model mismatches observed (expected ${expectedModel})`);
  }

  const byRoute = {};
  const byBand = { award_tier: 0, pro_band: 0, low_band: 0 };
  const byStatus = {};
  const byRank = {};
  for (const r of finalizedRecords) {
    byRoute[r.calibrated_route] = (byRoute[r.calibrated_route] || 0) + 1;
    byBand[r.calibrated_tier_band] = (byBand[r.calibrated_tier_band] || 0) + 1;
    byStatus[r.calibration_status] = (byStatus[r.calibration_status] || 0) + 1;
    byRank[r.calibrated_rank] = (byRank[r.calibrated_rank] || 0) + 1;
  }

  const allCalScores = finalizedRecords.map((x) => x.calibrated_score);
  const withLegacy = finalizedRecords.filter((x) => typeof x.legacy_overall_score === "number");
  const deltas = withLegacy.map((x) => Math.round((x.calibrated_score - x.legacy_overall_score) * 100) / 100);
  const tiebreakersUsed = finalizedRecords.filter((x) => x.final_ensemble_rule === "median_of_3").length;
  const knowsWorkCount = finalizedRecords.filter((x) => x.knows_work).length;
  const knowsAwardCount = finalizedRecords.filter((x) => x.knows_award_history).length;

  const totalInputTok = allValidRuns.reduce((a, x) => a + (x.token_usage?.first_post_read_input_tokens ?? 0), 0);
  const totalEffTok = allValidRuns.reduce((a, x) => a + (x.token_usage?.first_post_read_effective_input_tokens ?? 0), 0);

  const report = {
    generated_at: new Date().toISOString(),
    phase: "phase3_c",
    run_id: runId,
    priority: manifest.priority,
    batch_index: manifest.batch_index,
    frozen_config: {
      config_version: frozenConfig.config_version,
      t_award: tAward,
      t_low: tLow,
      expected_model: expectedModel,
      prompt_version: frozenConfig.prompt_version,
      hybrid_router_version: frozenConfig.hybrid_router_version,
      frozen_commit: frozenConfig.frozen_commit,
    },
    execution_stats: {
      target_count: manifest.target_count,
      prepared_count: manifest.prepared_count,
      finalized_count: finalizedRecords.length,
      runtime_failures_count: (manifest.runtime_failures || []).length,
      valid_subagent_runs: allValidRuns.length,
      valid_video_runs: validVideoRuns.length,
      valid_cs_runs: validCsRuns.length,
      invalid_subagent_runs: invalidRuns.length,
      strict_audit_pass_rate: allValidRuns.length > 0 ? Math.round((allValidRuns.length / (allValidRuns.length + invalidRuns.length)) * 10000) / 100 : 0,
      model_match_rate_pct: 100,
      tiebreakers_triggered_final_mode: tiebreakersUsed,
      by_route: byRoute,
      by_calibration_status: byStatus,
      knows_work_count: knowsWorkCount,
      knows_award_history_count: knowsAwardCount,
      total_first_post_read_input_tokens: totalInputTok,
      total_first_post_read_effective_tokens: totalEffTok,
    },
    score_distribution: {
      calibrated_mean: mean(allCalScores),
      calibrated_median: median(allCalScores),
      calibrated_min: Math.min(...allCalScores),
      calibrated_max: Math.max(...allCalScores),
      by_tier_band: byBand,
      by_rank: byRank,
      legacy_comparison: {
        videos_with_legacy_score: withLegacy.length,
        legacy_mean: mean(withLegacy.map((x) => x.legacy_overall_score)),
        legacy_median: median(withLegacy.map((x) => x.legacy_overall_score)),
        calibrated_mean_on_legacy_subset: mean(withLegacy.map((x) => x.calibrated_score)),
        delta_mean_calibrated_minus_legacy: mean(deltas),
        delta_median_calibrated_minus_legacy: median(deltas),
        increased_count: deltas.filter((d) => d > 0).length,
        unchanged_count: deltas.filter((d) => d === 0).length,
        decreased_count: deltas.filter((d) => d < 0).length,
      },
    },
    private_rating_reference_comparison: buildPrivateRatingComparison(finalizedRecords, tAward, tLow),
    records: finalizedRecords,
  };

  const payloadPath = path.join(runDir, "phase3_batch_payload.json");
  const reportName = `phase3_c_${manifest.priority.toLowerCase().replace("_private_rating", "p1")}_batch${String(manifest.batch_index).padStart(2, "0")}_report.json`;
  const canonicalReportName =
    manifest.priority === "P1_private_rating"
      ? `phase3_c_p1_batch${String(manifest.batch_index).padStart(2, "0")}_report.json`
      : manifest.priority === "P0_craft_recipes"
        ? `phase3_c_craft_batch${String(manifest.batch_index).padStart(2, "0")}_report.json`
        : reportName;
  const reportPath = path.join(REPO_ROOT, "analysis", canonicalReportName);

  const payload = {
    generated_at: report.generated_at,
    run_id: runId,
    priority: manifest.priority,
    batch_index: manifest.batch_index,
    calibration_version: "phase2_v1",
    count: finalizedRecords.length,
    updates: finalizedRecords.map((r) => ({
      id: r.video_id,
      calibrationStatus: r.calibration_status,
      calibratedScore: r.calibrated_score,
      calibratedRank: r.calibrated_rank,
      calibratedTierBand: r.calibrated_tier_band,
      calibratedBreakdown: r.calibrated_breakdown,
      calibrationVersion: "phase2_v1",
      calibratedAt: r.calibrated_at,
      calibratedRoute: r.calibrated_route,
      calibratedRunId: runId,
      calibrationGenreBucket: r.calibration_genre_bucket,
    })),
  };

  fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2).replace(/\r\n/g, "\n") + "\n", "utf8");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2).replace(/\r\n/g, "\n") + "\n", "utf8");
  console.log(`Wrote TiDB payload: ${payloadPath} (${payload.count} rows)`);
  console.log(`Wrote Batch report: ${reportPath}`);
  console.log(JSON.stringify({ execution_stats: report.execution_stats, score_distribution: report.score_distribution }, null, 2));
}

function buildFinalRecord({ sel, mItem, runId, tAward, tLow, expectedModel, route, h1Triggers, h2Triggers, finalAgg, csAgg }) {
  const calibratedScore = finalAgg.ai_score;
  const calibratedRank = scoreToCalibratedRank(calibratedScore);
  const calibratedTierBand = scoreToTierBand(calibratedScore, tAward, tLow);
  const calibratedAt = new Date().toISOString();

  const breakdown = {
    version: "phase2_v1",
    runId,
    route,
    model: expectedModel,
    thresholds: { tAward, tLow },
    ensembleRule: finalAgg.ensemble_rule,
    rawScores: finalAgg.raw_scores,
    finalScore: calibratedScore,
    rank: calibratedRank,
    tierBand: calibratedTierBand,
    dimensions: finalAgg.dimension_means,
    h1Triggers,
    h2Triggers,
    contactSheetPreScore: route === "video_h2_escalated" && csAgg ? csAgg.ai_score : null,
    contactSheetRawScores: route === "video_h2_escalated" && csAgg ? csAgg.raw_scores : null,
    rationales: finalAgg.rationales,
    postCheck: {
      knowsWork: finalAgg.knows_work,
      knowsAwardHistory: finalAgg.knows_award_history,
      awardBadgeVisibleInVideo: finalAgg.award_badge_visible_in_video,
    },
    metrics: mItem.metrics,
    auditPassed: true,
    subagentIds: finalAgg.per_run.map((x) => x.subagent_id),
  };

  return {
    video_id: sel.video_id,
    blind_id: mItem.blind_id,
    title: sel.title,
    platform: sel.platform,
    private_rating: sel.private_rating,
    legacy_overall_score: sel.legacy_overall_score,
    legacy_overall_rating: sel.legacy_overall_rating,
    genre_verified: mItem.genre_verified,
    calibration_genre_bucket: mItem.genre_bucket,
    calibration_status: mItem.target_status_after_calibration,
    calibrated_score: calibratedScore,
    calibrated_rank: calibratedRank,
    calibrated_tier_band: calibratedTierBand,
    calibrated_route: route,
    calibrated_at: calibratedAt,
    final_ensemble_rule: finalAgg.ensemble_rule,
    final_raw_scores: finalAgg.raw_scores,
    cs_pre_score: route === "video_h2_escalated" && csAgg ? csAgg.ai_score : null,
    knows_work: finalAgg.knows_work,
    knows_award_history: finalAgg.knows_award_history,
    calibrated_breakdown: breakdown,
  };
}

main();
