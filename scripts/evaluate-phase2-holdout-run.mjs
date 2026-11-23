#!/usr/bin/env node
/**
 * Phase 2 One-Shot Frozen Holdout v1 Evaluator (Pre-Registered).
 *
 * Strictly enforces:
 *  - Frozen config verified against git HEAD via validateSplitGuard
 *  - Zero threshold sweeping / zero post-hoc adjustment (uses frozen t_award, t_low only)
 *  - 100% strict audit pass & 100% expected_model match
 *  - Pre-registered mandatory supplementary reports:
 *      (a) knows_work || knows_award_history excluded P-1..P-3
 *      (b) low-exposure / recent Tier 2 subset (15 works) P-2
 *      (c) per-genre false positive list (flagging anime-style TV CMs)
 *
 * Usage:
 *   node scripts/evaluate-phase2-holdout-run.mjs <run_id> --frozen-config analysis/phase2_frozen_config_v1.json [--stage1-check]
 */

import fs from "node:fs";
import path from "node:path";
import { evaluatePhase2Scores } from "./evaluate-phase2-calibration.mjs";
import { decideEscalation, decidePhase1Route } from "./phase2-hybrid-router.mjs";
import { validateSplitGuard } from "./prepare-phase2-run.mjs";

const REPO_ROOT = "E:\\iketeru-eizou";

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function aggregate2Plus1(rows) {
  const byVid = new Map();
  for (const r of rows) {
    if (!byVid.has(r.video_id)) byVid.set(r.video_id, []);
    byVid.get(r.video_id).push(r);
  }
  const out = new Map();
  for (const [vid, list] of byVid.entries()) {
    list.sort((a, b) => (a.attempt || 0) - (b.attempt || 0));
    const scores = list.map((x) => x.total_score);
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
    const knowsWork = list.some((x) => x.post_check?.knows_work === true);
    const knowsAward = list.some((x) => x.post_check?.knows_award_history === true);
    const badgeVisible = list.some((x) => x.post_check?.award_badge_visible_in_video === true);
    const getIn = (x) =>
      x.token_usage?.first_post_read_input_tokens ?? x.token_usage?.input_tokens ?? 0;
    const getEff = (x) =>
      x.token_usage?.first_post_read_effective_input_tokens ?? x.token_usage?.effective_input_tokens ?? 0;
    const avgInputTokens = Math.round(list.reduce((a, x) => a + getIn(x), 0) / list.length);
    const avgEffTokens = Math.round(list.reduce((a, x) => a + getEff(x), 0) / list.length);
    const totalInputTokens = list.reduce((a, x) => a + getIn(x), 0);
    const totalEffTokens = list.reduce((a, x) => a + getEff(x), 0);

    out.set(vid, {
      video_id: vid,
      run_count: list.length,
      raw_scores: scores,
      ai_score: aiScore,
      ensemble_rule: rule,
      knows_work: knowsWork,
      knows_award_history: knowsAward,
      award_badge_visible_in_video: badgeVisible,
      flagged_contamination: knowsWork || knowsAward,
      avg_input_tokens: avgInputTokens,
      avg_effective_input_tokens: avgEffTokens,
      total_input_tokens: totalInputTokens,
      total_effective_input_tokens: totalEffTokens,
      rationales: list.map((x) => x.brief_rationale || ""),
    });
  }
  return out;
}

function isLowExposureRecentTier2(entry) {
  if (!entry || entry.stratum !== "tier2_award") return false;
  const yr = Number(entry.award_year || entry.published_year);
  const inYear = yr >= 2022 && yr <= 2026;
  const viewLimit = entry.platform === "vimeo" ? 100000 : 500000;
  return inYear && typeof entry.view_count_at_collection === "number" && entry.view_count_at_collection < viewLimit;
}

function isLikelyAnimeCm(entry, rationales = []) {
  if (entry?.genre !== "CM") return false;
  const hay = `${entry.title || ""} ${entry.channel || ""} ${entry.notes || ""} ${rationales.join(" ")}`;
  return /アニメ|anime|2d\s*作画|セル画|イラスト調|キャラクター\s*cm|ゲーム\s*cm|tvcm.*アニメ/i.test(hay);
}

function main() {
  const args = process.argv.slice(2);
  const runId = args[0];
  const cfgIdx = args.indexOf("--frozen-config");
  const stage1Check = args.includes("--stage1-check");

  if (!runId || cfgIdx === -1 || !args[cfgIdx + 1]) {
    console.error(
      "Usage: node scripts/evaluate-phase2-holdout-run.mjs <run_id> --frozen-config <path> [--stage1-check]"
    );
    process.exit(2);
  }
  const frozenConfigPath = path.resolve(REPO_ROOT, args[cfgIdx + 1]);
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
  if (manifest.split !== "holdout") {
    throw new Error(`Expected holdout run manifest, got split=${manifest.split}`);
  }

  const rawPath = path.join(runDir, "raw_scores.jsonl");
  const rawLines = fs.existsSync(rawPath)
    ? fs
        .readFileSync(rawPath, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

  const validVideoRuns = rawLines.filter(
    (r) => r.mode === "video" && r.audit_valid === true && typeof r.total_score === "number"
  );
  const validCsRuns = rawLines.filter(
    (r) => r.mode === "contact_sheet" && r.audit_valid === true && typeof r.total_score === "number"
  );
  const invalidRuns = rawLines.filter((r) => r.audit_valid !== true);

  const allValidRuns = [...validVideoRuns, ...validCsRuns];
  const modelMismatches = allValidRuns.filter((r) => {
    const obs = r.models_observed?.length
      ? r.models_observed
      : r.token_usage?.model
      ? [r.token_usage.model]
      : [];
    return obs.length === 0 || !obs.every((m) => m === expectedModel);
  });

  const videoAgg = aggregate2Plus1(validVideoRuns);
  const csAgg = aggregate2Plus1(validCsRuns);

  const holdoutRaw = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "phase2_holdout_v1.json"), "utf8"));
  const holdoutItems = Array.isArray(holdoutRaw) ? holdoutRaw : holdoutRaw.items || [];
  const holdoutById = new Map(holdoutItems.map((x) => [x.video_id, x]));

  const stage1Missing = [];
  const stage1Tiebreakers = [];
  const h2EscalationsNeeded = [];
  const stage2Missing = [];
  const stage2Tiebreakers = [];
  const records = [];

  for (const [vid, mItem] of Object.entries(manifest.items || {})) {
    const meta = holdoutById.get(vid) || {};
    const itemForRoute = {
      genre: mItem.genre_bucket,
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
      if (!v || v.run_count < 2) {
        stage1Missing.push({ video_id: vid, blind_id: mItem.blind_id, mode: "video", have: v?.run_count || 0 });
      } else if (v.ensemble_rule === "needs_3rd_tiebreaker") {
        stage1Tiebreakers.push({ video_id: vid, blind_id: mItem.blind_id, mode: "video", scores: v.raw_scores });
      }
      if (v) {
        records.push({
          video_id: vid,
          blind_id: mItem.blind_id,
          title: meta.title || null,
          channel: meta.channel || null,
          platform: meta.platform || null,
          stratum: mItem.stratum,
          genre: mItem.genre_bucket,
          label_rule_id: mItem.label_rule_id,
          low_exposure_recent_tier2: isLowExposureRecentTier2(meta),
          metrics: mItem.metrics,
          hybrid_mode: "video_h1",
          h1_triggers: h1.triggers,
          h2_triggers: [],
          modes_executed: ["video"],
          score: v.ai_score,
          video_score: v.ai_score,
          video_raw_scores: v.raw_scores,
          video_ensemble_rule: v.ensemble_rule,
          contact_sheet_score: null,
          knows_work: v.knows_work,
          knows_award_history: v.knows_award_history,
          award_badge_visible_in_video: v.award_badge_visible_in_video,
          flagged_contamination: v.flagged_contamination,
          total_input_tokens: v.total_input_tokens,
          total_eff_tokens: v.total_effective_input_tokens,
          rationales: v.rationales,
        });
      }
    } else {
      // Non-H1: Stage 1 is contact_sheet
      if (!c || c.run_count < 2) {
        stage1Missing.push({ video_id: vid, blind_id: mItem.blind_id, mode: "contact_sheet", have: c?.run_count || 0 });
        continue;
      }
      if (c.ensemble_rule === "needs_3rd_tiebreaker") {
        stage1Tiebreakers.push({
          video_id: vid,
          blind_id: mItem.blind_id,
          mode: "contact_sheet",
          scores: c.raw_scores,
        });
        continue;
      }

      const h2 = decideEscalation(itemForRoute, c.ai_score, { tAward, tLow });
      if (h2.escalate) {
        h2EscalationsNeeded.push({
          video_id: vid,
          blind_id: mItem.blind_id,
          cs_score: c.ai_score,
          triggers: h2.triggers,
          video_have: v?.run_count || 0,
        });
        if (!v || v.run_count < 2) {
          stage2Missing.push({
            video_id: vid,
            blind_id: mItem.blind_id,
            mode: "video",
            cs_score: c.ai_score,
            triggers: h2.triggers,
            have: v?.run_count || 0,
          });
          continue;
        }
        if (v.ensemble_rule === "needs_3rd_tiebreaker") {
          stage2Tiebreakers.push({
            video_id: vid,
            blind_id: mItem.blind_id,
            mode: "video",
            scores: v.raw_scores,
          });
          continue;
        }
        records.push({
          video_id: vid,
          blind_id: mItem.blind_id,
          title: meta.title || null,
          channel: meta.channel || null,
          platform: meta.platform || null,
          stratum: mItem.stratum,
          genre: mItem.genre_bucket,
          label_rule_id: mItem.label_rule_id,
          low_exposure_recent_tier2: isLowExposureRecentTier2(meta),
          metrics: mItem.metrics,
          hybrid_mode: "video_h2_escalated",
          h1_triggers: [],
          h2_triggers: h2.triggers,
          modes_executed: ["contact_sheet", "video"],
          score: v.ai_score,
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
          total_input_tokens: c.total_input_tokens + v.total_input_tokens,
          total_eff_tokens: c.total_effective_input_tokens + v.total_effective_input_tokens,
          rationales: [...v.rationales, ...c.rationales],
        });
      } else {
        records.push({
          video_id: vid,
          blind_id: mItem.blind_id,
          title: meta.title || null,
          channel: meta.channel || null,
          platform: meta.platform || null,
          stratum: mItem.stratum,
          genre: mItem.genre_bucket,
          label_rule_id: mItem.label_rule_id,
          low_exposure_recent_tier2: isLowExposureRecentTier2(meta),
          metrics: mItem.metrics,
          hybrid_mode: "contact_sheet",
          h1_triggers: [],
          h2_triggers: [],
          modes_executed: ["contact_sheet"],
          score: c.ai_score,
          video_score: null,
          contact_sheet_score: c.ai_score,
          contact_sheet_raw_scores: c.raw_scores,
          contact_sheet_ensemble_rule: c.ensemble_rule,
          knows_work: c.knows_work,
          knows_award_history: c.knows_award_history,
          award_badge_visible_in_video: c.award_badge_visible_in_video,
          flagged_contamination: c.flagged_contamination,
          total_input_tokens: c.total_input_tokens,
          total_eff_tokens: c.total_effective_input_tokens,
          rationales: c.rationales,
        });
      }
    }
  }

  if (stage1Check) {
    console.log(
      JSON.stringify(
        {
          stage1_missing_count: stage1Missing.length,
          stage1_missing: stage1Missing,
          stage1_tiebreakers_count: stage1Tiebreakers.length,
          stage1_tiebreakers: stage1Tiebreakers,
          h2_escalations_needed_count: h2EscalationsNeeded.length,
          stage2_missing_count: stage2Missing.length,
          stage2_missing: stage2Missing,
          stage2_tiebreakers_count: stage2Tiebreakers.length,
          stage2_tiebreakers: stage2Tiebreakers,
          invalid_subagent_runs: invalidRuns.length,
          model_mismatch_count: modelMismatches.length,
        },
        null,
        2
      )
    );
    return;
  }

  if (
    stage1Missing.length > 0 ||
    stage1Tiebreakers.length > 0 ||
    stage2Missing.length > 0 ||
    stage2Tiebreakers.length > 0 ||
    invalidRuns.length > 0 ||
    modelMismatches.length > 0
  ) {
    console.error(
      "INCOMPLETE_OR_INVALID_HOLDOUT_RUN:",
      JSON.stringify(
        {
          stage1Missing: stage1Missing.length,
          stage1Tiebreakers: stage1Tiebreakers.length,
          stage2Missing: stage2Missing.length,
          stage2Tiebreakers: stage2Tiebreakers.length,
          invalidRuns: invalidRuns.length,
          modelMismatches: modelMismatches.length,
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  // Primary evaluation (frozen thresholds only — NO post-hoc tuning!)
  const primaryEval = evaluatePhase2Scores(records, { tAward, tLow, bootstrapB: 5000 });

  // Supplementary Report (a): knows_work || knows_award_history excluded P-1..P-3
  const contamExclRecords = records.filter((x) => !x.flagged_contamination);
  const contamExclEval = evaluatePhase2Scores(contamExclRecords, { tAward, tLow, bootstrapB: 5000 });
  const awardHistExclRecords = records.filter((x) => !x.knows_award_history);
  const awardHistExclEval = evaluatePhase2Scores(awardHistExclRecords, { tAward, tLow, bootstrapB: 5000 });

  // Supplementary Report (b): Low-exposure / recent Tier 2 subset (15 works) P-2 only
  const lowExpTier2 = records.filter((x) => x.low_exposure_recent_tier2);
  const lowExpHits = lowExpTier2.filter((x) => x.score >= tAward).length;
  const lowExpMissed = lowExpTier2
    .filter((x) => x.score < tAward)
    .map((x) => ({
      video_id: x.video_id,
      genre: x.genre,
      title: x.title,
      score: x.score,
      hybrid_mode: x.hybrid_mode,
      knows_work: x.knows_work,
      knows_award_history: x.knows_award_history,
    }));

  // Supplementary Report (c): Per-genre false positive list (explicitly flagging anime-style TV CMs)
  const fpAll = records
    .filter((x) => (x.stratum === "non_tier2_pro" || x.stratum === "non_tier2_low") && x.score >= tAward)
    .map((x) => {
      const meta = holdoutById.get(x.video_id) || {};
      return {
        video_id: x.video_id,
        stratum: x.stratum,
        genre: x.genre,
        title: x.title,
        channel: x.channel,
        score: x.score,
        hybrid_mode: x.hybrid_mode,
        contact_sheet_score: x.contact_sheet_score,
        video_score: x.video_score,
        knows_work: x.knows_work,
        knows_award_history: x.knows_award_history,
        likely_anime_cm: isLikelyAnimeCm(meta, x.rationales),
      };
    });

  const fpByGenre = {};
  const perGenreSummary = {};
  for (const g of ["CM", "MV", "モーション", "3DCG/アニメ", "企業映像"]) {
    const gRecs = records.filter((x) => x.genre === g);
    const gT2 = gRecs.filter((x) => x.stratum === "tier2_award");
    const gPro = gRecs.filter((x) => x.stratum === "non_tier2_pro");
    const gLow = gRecs.filter((x) => x.stratum === "non_tier2_low");
    fpByGenre[g] = fpAll.filter((x) => x.genre === g);
    perGenreSummary[g] = {
      tier2_hits: gT2.filter((x) => x.score >= tAward).length,
      tier2_total: gT2.length,
      pro_correct: gPro.filter((x) => x.score < tAward).length,
      pro_false_positives: gPro.filter((x) => x.score >= tAward).length,
      pro_total: gPro.length,
      low_false_positives: gLow.filter((x) => x.score >= tAward).length,
      low_total: gLow.length,
      tier2_mean: gT2.length ? Math.round((gT2.reduce((a, x) => a + x.score, 0) / gT2.length) * 100) / 100 : null,
      pro_mean: gPro.length ? Math.round((gPro.reduce((a, x) => a + x.score, 0) / gPro.length) * 100) / 100 : null,
      low_mean: gLow.length ? Math.round((gLow.reduce((a, x) => a + x.score, 0) / gLow.length) * 100) / 100 : null,
    };
  }

  const routeCounts = { video_h1: 0, video_h2_escalated: 0, contact_sheet: 0 };
  for (const x of records) routeCounts[x.hybrid_mode]++;

  const badgeDetected = records
    .filter((x) => x.award_badge_visible_in_video)
    .map((x) => ({ video_id: x.video_id, stratum: x.stratum, genre: x.genre, title: x.title, score: x.score }));

  const report = {
    generated_at: new Date().toISOString(),
    holdout_run_id: runId,
    frozen_config_path: path.relative(REPO_ROOT, frozenConfigPath).replace(/\\/g, "/"),
    frozen_config_snapshot: {
      config_version: frozenConfig.config_version,
      t_award: tAward,
      t_low: tLow,
      frozen_commit: frozenConfig.frozen_commit,
      expected_model: expectedModel,
      prompt_version: frozenConfig.prompt_version,
      hybrid_router_version: frozenConfig.hybrid_router_version,
      grid_truncation_disclosure: frozenConfig.grid_truncation_disclosure,
    },
    audit_summary: {
      total_videos_evaluated: records.length,
      valid_video_subagent_runs: validVideoRuns.length,
      valid_cs_subagent_runs: validCsRuns.length,
      total_valid_subagent_runs: allValidRuns.length,
      invalid_subagent_runs: invalidRuns.length,
      model_mismatch_count: modelMismatches.length,
      award_badge_visible_detected: badgeDetected,
    },
    primary_judgment: primaryEval,
    mandatory_supplementary_reports: {
      note: "Pass/fail (GO/NO-GO) is determined strictly by primary_judgment only.",
      a_contamination_excluded_p1_to_p3: {
        rule: "Exclude videos with knows_work === true OR knows_award_history === true",
        counts: contamExclEval.counts,
        primary: contamExclEval.primary,
        cross_table: contamExclEval.reference.cross_table,
        extra_reference_knows_award_history_only_excluded: {
          counts: awardHistExclEval.counts,
          primary: awardHistExclEval.primary,
        },
      },
      b_low_exposure_recent_tier2_p2: {
        count: lowExpTier2.length,
        hits: lowExpHits,
        sensitivity: lowExpTier2.length ? Math.round((lowExpHits / lowExpTier2.length) * 10000) / 10000 : null,
        mean_score: lowExpTier2.length
          ? Math.round((lowExpTier2.reduce((a, x) => a + x.score, 0) / lowExpTier2.length) * 100) / 100
          : null,
        missed_items: lowExpMissed,
      },
      c_per_genre_false_positives: {
        total_false_positives: fpAll.length,
        anime_cm_false_positives: fpAll.filter((x) => x.likely_anime_cm),
        by_genre: fpByGenre,
        per_genre_summary: perGenreSummary,
      },
    },
    hybrid_routing_and_tokens: {
      route_counts: routeCounts,
      total_input_tokens: records.reduce((a, x) => a + x.total_input_tokens, 0),
      total_effective_input_tokens: records.reduce((a, x) => a + x.total_eff_tokens, 0),
    },
    per_video: records.map(({ rationales, ...rest }) => rest),
  };

  const outPath = path.join(REPO_ROOT, "analysis", "phase2_holdout_v1_report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outPath}`);
  console.log("DECISION:", primaryEval.decision);
  console.log("PRIMARY:", JSON.stringify(primaryEval.primary, null, 2));
  console.log("SECONDARY (all R-LOW):", JSON.stringify(primaryEval.secondary_all_low, null, 2));
  console.log("SECONDARY (excl R-LOW-04):", JSON.stringify(primaryEval.secondary_excl_r_low_04, null, 2));
  console.log("CROSS TABLE:", JSON.stringify(primaryEval.reference.cross_table, null, 2));
  console.log("SUPP (a) CONTAM EXCL:", JSON.stringify(report.mandatory_supplementary_reports.a_contamination_excluded_p1_to_p3, null, 2));
  console.log("SUPP (b) LOW-EXP TIER 2:", JSON.stringify(report.mandatory_supplementary_reports.b_low_exposure_recent_tier2_p2, null, 2));
  console.log("SUPP (c) FALSE POSITIVES:", JSON.stringify(report.mandatory_supplementary_reports.c_per_genre_false_positives, null, 2));
  console.log("ROUTING:", JSON.stringify(report.hybrid_routing_and_tokens, null, 2));
}

main();
