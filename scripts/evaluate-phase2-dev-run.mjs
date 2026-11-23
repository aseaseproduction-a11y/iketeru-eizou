#!/usr/bin/env node
/**
 * Phase 2 Combined Dev Pool Evaluator & Pre-registered Threshold Selector
 * (docs/CALIBRATION_PHASE2_DESIGN.md Sections 5.2-5.6, 6.2).
 *
 * Combines:
 *   1. Phase 1 surviving Dev pool (28 videos: 19 Tier 2 + 9 Step 0 R-PRO, optimistic previously-seen reference)
 *   2. Phase 2 Dev Additions blind run (31 videos: 5 Motion Tier 2 + 11 R-PRO + 15 R-LOW)
 * -> Total 59 Dev videos (Tier 2: 24, R-PRO: 20, R-LOW: 15).
 *
 * Strictly NEVER touches analysis/phase2_holdout_v1.json!
 */

import fs from "node:fs";
import path from "node:path";
import { computeHybridScore } from "./phase2-hybrid-router.mjs";
import {
  evaluatePhase2Scores,
  sweepDevThresholds,
  selectFrozenThresholds,
} from "./evaluate-phase2-calibration.mjs";

const REPO_ROOT = "E:\\iketeru-eizou";

function aggregate2Plus1(validRuns) {
  const byVid = new Map();
  for (const r of validRuns) {
    if (!byVid.has(r.video_id)) byVid.set(r.video_id, []);
    byVid.get(r.video_id).push(r);
  }
  const out = new Map();
  for (const [vid, runs] of byVid.entries()) {
    runs.sort((a, b) => (a.attempt || 0) - (b.attempt || 0));
    const scores = runs.map((r) => r.total_score);
    let aiScore;
    let rule;
    if (scores.length === 1) {
      aiScore = scores[0];
      rule = "single_run";
    } else if (scores.length === 2) {
      aiScore = (scores[0] + scores[1]) / 2;
      rule = Math.abs(scores[0] - scores[1]) >= 5 ? "needs_3rd_tiebreaker" : "mean_of_2";
    } else {
      const s3 = [...scores.slice(0, 3)].sort((a, b) => a - b);
      aiScore = s3[1];
      rule = "median_of_3";
    }
    const avgIn = Math.round(
      runs.reduce((a, r) => a + (r.token_usage?.first_post_read_input_tokens || 0), 0) / runs.length
    );
    const avgEff = Math.round(
      runs.reduce(
        (a, r) => a + (r.token_usage?.first_post_read_effective_input_tokens || r.token_usage?.first_post_read_input_tokens || 0),
        0
      ) / runs.length
    );
    out.set(vid, {
      video_id: vid,
      raw_scores: scores,
      ai_score: Math.round(aiScore * 10000) / 10000,
      ensemble_rule: rule,
      run_count: runs.length,
      knows_work: runs.some((r) => Boolean(r.post_check?.knows_work)),
      knows_award_history: runs.some((r) => Boolean(r.post_check?.knows_award_history)),
      award_badge_visible_in_video: runs.some((r) => Boolean(r.post_check?.award_badge_visible_in_video)),
      flagged_contamination: runs.some(
        (r) =>
          Boolean(r.post_check?.knows_work) ||
          Boolean(r.post_check?.knows_award_history) ||
          Boolean(r.post_check?.award_badge_visible_in_video)
      ),
      avg_input_tokens: avgIn,
      avg_effective_input_tokens: avgEff,
    });
  }
  return out;
}

function main() {
  const runId = process.argv[2];
  if (!runId) {
    console.error("Usage: node scripts/evaluate-phase2-dev-run.mjs <dev_run_id>");
    process.exit(2);
  }
  const runDir = path.join(REPO_ROOT, "analysis", "runs", runId);
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "run_manifest.json"), "utf8"));
  if (manifest.split !== "dev") {
    throw new Error(`Refusing to run Dev threshold sweeper on non-dev split: ${manifest.split}`);
  }
  const rawLines = fs
    .readFileSync(path.join(runDir, "raw_scores.jsonl"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const validVideoRuns = rawLines.filter((r) => r.mode === "video" && r.audit_valid === true && typeof r.total_score === "number");
  const validCsRuns = rawLines.filter((r) => r.mode === "contact_sheet" && r.audit_valid === true && typeof r.total_score === "number");
  const invalidRuns = rawLines.filter((r) => r.audit_valid !== true);

  const videoAgg = aggregate2Plus1(validVideoRuns);
  const csAgg = aggregate2Plus1(validCsRuns);

  const tiebreakersVideo = [...videoAgg.values()].filter((x) => x.ensemble_rule === "needs_3rd_tiebreaker").map((x) => x.video_id);
  const tiebreakersCs = [...csAgg.values()].filter((x) => x.ensemble_rule === "needs_3rd_tiebreaker").map((x) => x.video_id);

  // Verify expected model 100%
  const expectedModel = manifest.expected_model || "gemini-4-neon-high";
  const allValidRuns = [...validVideoRuns, ...validCsRuns];
  const modelMismatches = allValidRuns.filter((r) => {
    const obs = r.models_observed?.length ? r.models_observed : r.token_usage?.model ? [r.token_usage.model] : [];
    return obs.length === 0 || !obs.every((m) => m === expectedModel);
  });

  // Load Dev additions metadata
  const devAddRaw = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "phase2_dev_additions_v1.json"), "utf8"));
  const devAddItems = Array.isArray(devAddRaw) ? devAddRaw : devAddRaw.items || [];
  const devAddById = new Map(devAddItems.map((x) => [x.video_id, x]));

  const newDevRecords = [];
  const excludedNewBadge = [];
  for (const [vid, mItem] of Object.entries(manifest.items || {})) {
    const v = videoAgg.get(vid);
    const c = csAgg.get(vid);
    if (!v || !c) continue;
    const meta = devAddById.get(vid) || {};
    const rec = {
      video_id: vid,
      source_pool: "phase2_dev_additions_v1",
      title: meta.title || null,
      stratum: mItem.stratum,
      genre: mItem.genre_bucket,
      label_rule_id: mItem.label_rule_id,
      duration_sec: mItem.metrics.duration_sec,
      total_cuts: mItem.metrics.total_cuts,
      avg_cut_interval_sec: mItem.metrics.avg_cut_interval_sec,
      max_cuts_per_10s: mItem.metrics.max_cuts_per_10s,
      integrated_lufs: mItem.metrics.integrated_lufs,
      video_score: v.ai_score,
      video_raw_scores: v.raw_scores,
      video_ensemble_rule: v.ensemble_rule,
      contact_sheet_score: c.ai_score,
      contact_sheet_raw_scores: c.raw_scores,
      contact_sheet_ensemble_rule: c.ensemble_rule,
      knows_work: v.knows_work || c.knows_work,
      knows_award_history: v.knows_award_history || c.knows_award_history,
      award_badge_visible_in_video: v.award_badge_visible_in_video || c.award_badge_visible_in_video,
      flagged_contamination: v.flagged_contamination || c.flagged_contamination,
      avg_video_input_tokens: v.avg_input_tokens,
      avg_cs_input_tokens: c.avg_input_tokens,
      avg_video_eff_tokens: v.avg_effective_input_tokens,
      avg_cs_eff_tokens: c.avg_effective_input_tokens,
    };
    if (rec.award_badge_visible_in_video && rec.stratum === "tier2_award") {
      excludedNewBadge.push({ video_id: vid, title: rec.title, reason: "award_badge_visible_in_video" });
    }
    newDevRecords.push(rec);
  }

  // Load Phase 1 surviving Dev baseline (28 videos)
  const p1Base = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "phase2_dev_baseline_phase1_only.json"), "utf8"));
  const p1Records = (p1Base.items || []).map((x) => ({
    video_id: x.video_id,
    source_pool: "phase1_surviving_dev",
    title: x.title,
    stratum: x.stratum,
    genre: x.genre,
    label_rule_id: x.label_rule_id || "phase1_craft_benchmark",
    duration_sec: x.duration_sec,
    total_cuts: x.total_cuts,
    avg_cut_interval_sec: x.avg_cut_interval_sec,
    max_cuts_per_10s: x.max_cuts_per_10s,
    integrated_lufs: x.integrated_lufs,
    video_score: x.video_score,
    contact_sheet_score: x.contact_sheet_score,
    flagged_contamination: Boolean(x.flagged_contamination_video),
  }));

  const combined = [...p1Records, ...newDevRecords];

  // Sweep pre-registered 1-point integer grid (Section 5.6)
  const sweep = sweepDevThresholds(combined);
  const selection = selectFrozenThresholds(sweep);

  const chosenT = selection.selected
    ? { tAward: selection.selected.t_award, tLow: selection.selected.t_low }
    : { tAward: 78.0, tLow: 63.0 };

  const hybridScored = combined.map((it) => {
    const h = computeHybridScore(it, {
      videoScore: it.video_score,
      contactSheetScore: it.contact_sheet_score,
      ...chosenT,
    });
    return { ...it, hybrid: h, score: h.final_score };
  });

  const evalHybrid = evaluatePhase2Scores(hybridScored, { ...chosenT, bootstrapB: 2000 });
  const evalVideo = evaluatePhase2Scores(
    combined.map((x) => ({ ...x, score: x.video_score })),
    { ...chosenT, bootstrapB: 2000 }
  );
  const evalCs = evaluatePhase2Scores(
    combined.map((x) => ({ ...x, score: x.contact_sheet_score })),
    { ...chosenT, bootstrapB: 2000 }
  );

  // Also check unflagged (contamination-excluded) sensitivity on combined Dev
  const unflaggedHybrid = hybridScored.filter((x) => !x.flagged_contamination);
  const evalUnflagged = evaluatePhase2Scores(unflaggedHybrid, { ...chosenT, bootstrapB: 2000 });

  // Transparent subset breakdowns: brand-new unseen Dev 31 vs Phase 1 surviving Dev 28 (optimistic previously-seen reference)
  const newHybrid = hybridScored.filter((x) => x.source_pool === "phase2_dev_additions_v1");
  const p1Hybrid = hybridScored.filter((x) => x.source_pool === "phase1_surviving_dev");
  const evalNewDevOnly = evaluatePhase2Scores(newHybrid, { ...chosenT, bootstrapB: 2000 });
  const evalPhase1SurvivingOnly = evaluatePhase2Scores(p1Hybrid, { ...chosenT, bootstrapB: 2000 });

  // Route counts & token estimate on the 31 new Dev additions
  const routeCountsAll = { video_h1: 0, video_h2_escalated: 0, contact_sheet: 0 };
  for (const x of hybridScored) routeCountsAll[x.hybrid.final_mode]++;

  const routeCountsNew = { video_h1: 0, video_h2_escalated: 0, contact_sheet: 0 };
  let sumAllVideoTok = 0;
  let sumHybridTok = 0;
  let sumAllVideoEff = 0;
  let sumHybridEff = 0;
  for (const x of newHybrid) {
    routeCountsNew[x.hybrid.final_mode]++;
    sumAllVideoTok += x.avg_video_input_tokens || 0;
    sumAllVideoEff += x.avg_video_eff_tokens || 0;
    if (x.hybrid.final_mode === "video_h1") {
      sumHybridTok += x.avg_video_input_tokens || 0;
      sumHybridEff += x.avg_video_eff_tokens || 0;
    } else if (x.hybrid.final_mode === "video_h2_escalated") {
      sumHybridTok += (x.avg_cs_input_tokens || 0) + (x.avg_video_input_tokens || 0);
      sumHybridEff += (x.avg_cs_eff_tokens || 0) + (x.avg_video_eff_tokens || 0);
    } else {
      sumHybridTok += x.avg_cs_input_tokens || 0;
      sumHybridEff += x.avg_cs_eff_tokens || 0;
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    dev_run_id: runId,
    expected_model: expectedModel,
    audit_summary: {
      valid_video_subagent_runs: validVideoRuns.length,
      valid_cs_subagent_runs: validCsRuns.length,
      invalid_subagent_runs: invalidRuns.length,
      model_mismatch_count: modelMismatches.length,
      new_dev_videos_with_both_modes: newDevRecords.length,
      tiebreakers_pending_video: tiebreakersVideo,
      tiebreakers_pending_cs: tiebreakersCs,
      excluded_new_award_badge_detected: excludedNewBadge,
    },
    pool_counts: {
      total_combined: combined.length,
      phase1_surviving_dev_note: "Phase 1 surviving Dev (28 videos: 19 Tier 2 + 9 R-PRO) is previously-seen data and acts as an optimistic reference subset; combined pool adds 31 brand-new unseen Dev videos.",
      phase1_surviving: p1Records.length,
      phase2_new_dev: newDevRecords.length,
      tier2_award: combined.filter((x) => x.stratum === "tier2_award").length,
      non_tier2_pro: combined.filter((x) => x.stratum === "non_tier2_pro").length,
      non_tier2_low: combined.filter((x) => x.stratum === "non_tier2_low").length,
    },
    pre_registered_selection_rule: "CALIBRATION_PHASE2_DESIGN.md Section 5.6 (upper-median of longest contiguous max-Youden-J GO run for T_award and T_low)",
    threshold_selection: selection,
    evaluations_at_selected_thresholds: {
      thresholds_used: chosenT,
      hybrid_primary: evalHybrid,
      video_only_reference: evalVideo,
      contact_sheet_only_reference: evalCs,
      contamination_excluded_hybrid_reference: evalUnflagged,
      new_dev_31_only_reference: evalNewDevOnly,
      phase1_surviving_28_only_reference: evalPhase1SurvivingOnly,
    },
    hybrid_routing_stats: {
      combined_59: routeCountsAll,
      new_dev_31: routeCountsNew,
      new_dev_token_comparison: {
        all_video_raw_input_tokens: sumAllVideoTok,
        hybrid_raw_input_tokens: sumHybridTok,
        raw_token_reduction_pct: sumAllVideoTok ? Math.round((1 - sumHybridTok / sumAllVideoTok) * 10000) / 100 : null,
        all_video_eff_input_tokens: sumAllVideoEff,
        hybrid_eff_input_tokens: sumHybridEff,
        eff_token_reduction_pct: sumAllVideoEff ? Math.round((1 - sumHybridEff / sumAllVideoEff) * 10000) / 100 : null,
      },
    },
    sweep_top_20: sweep.slice(0, 20),
    per_video: hybridScored,
  };

  const outPath = path.join(REPO_ROOT, "analysis", "phase2_dev_calibration_report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outPath}`);
  console.log("Audit:", JSON.stringify(report.audit_summary));
  console.log("Pool:", JSON.stringify(report.pool_counts));
  console.log("Selection:", JSON.stringify({
    selected: selection.selected,
    reason: selection.reason,
    best_t_award_run: selection.best_t_award_run,
    best_t_low_run: selection.best_t_low_run,
    pass_range: selection.pass_range,
  }, null, 2));
  console.log("Hybrid Primary Eval:", JSON.stringify({
    decision: evalHybrid.decision,
    primary: evalHybrid.primary,
    secondary_all_low: evalHybrid.secondary_all_low,
    secondary_excl_r_low_04: evalHybrid.secondary_excl_r_low_04,
    cross_table: evalHybrid.reference.cross_table,
  }, null, 2));
}

main();
