#!/usr/bin/env node
/**
 * Phase 2 Calibration Evaluator & Dev Threshold-Sweep Engine
 * (docs/CALIBRATION_PHASE2_DESIGN.md Sections 5.2-5.5).
 *
 * Computes:
 *  - Primary P-1 (ROC-AUC + 2,000-bootstrap 95% CI), P-2 (Sensitivity), P-3 (Specificity), P-4 (Major Error A)
 *  - Secondary S-1 (Major Error B), S-2 (Tier 2 vs R-LOW ROC-AUC), S-3 (R-PRO vs R-LOW Pairwise + mean gap + one-sided MWU p)
 *    for BOTH (a) all R-LOW and (b) R-LOW excluding R-LOW-04 watermark-only
 *  - Reference: Tier 2 vs All-Non-Tier2, 3-stratum x score-band cross-table, per-mode comparison
 *  - Dev threshold grid sweep (only used on Dev pool; NEVER on Holdout)
 */

import fs from "node:fs";
import path from "node:path";
import { computeHybridScore } from "./phase2-hybrid-router.mjs";

export function pairwiseAuc(posScores, negScores) {
  if (!posScores.length || !negScores.length) return null;
  let wins = 0;
  const total = posScores.length * negScores.length;
  for (const p of posScores) {
    for (const n of negScores) {
      if (p > n) wins += 1;
      else if (p === n) wins += 0.5;
    }
  }
  return wins / total;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootstrapAucCi(posScores, negScores, B = 2000, seed = 20261123) {
  if (!posScores.length || !negScores.length) return null;
  const rng = mulberry32(seed);
  const vals = [];
  for (let b = 0; b < B; b++) {
    const ps = new Array(posScores.length);
    const ns = new Array(negScores.length);
    for (let i = 0; i < ps.length; i++) ps[i] = posScores[Math.floor(rng() * posScores.length)];
    for (let j = 0; j < ns.length; j++) ns[j] = negScores[Math.floor(rng() * negScores.length)];
    vals.push(pairwiseAuc(ps, ns));
  }
  vals.sort((a, b) => a - b);
  return {
    low: Math.round(vals[Math.floor(0.025 * B)] * 10000) / 10000,
    high: Math.round(vals[Math.floor(0.975 * B)] * 10000) / 10000,
  };
}

function normalCdf(z) {
  // Abramowitz & Stegun 7.1.26 erf approximation
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * One-sided Mann-Whitney U test (H1: groupA > groupB) with tie correction.
 */
export function mannWhitneyOneSidedP(groupA, groupB) {
  const n1 = groupA.length;
  const n2 = groupB.length;
  if (!n1 || !n2) return null;
  const combined = [
    ...groupA.map((v) => ({ v, g: 1 })),
    ...groupB.map((v) => ({ v, g: 2 })),
  ].sort((a, b) => a.v - b.v);

  let r1 = 0;
  let tieSum = 0;
  let i = 0;
  while (i < combined.length) {
    let j = i;
    while (j < combined.length && combined[j].v === combined[i].v) j++;
    const avgRank = (i + 1 + j) / 2;
    const t = j - i;
    if (t > 1) tieSum += t * t * t - t;
    for (let k = i; k < j; k++) {
      if (combined[k].g === 1) r1 += avgRank;
    }
    i = j;
  }
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const meanU = (n1 * n2) / 2;
  const N = n1 + n2;
  const varU = ((n1 * n2) / 12) * (N + 1 - tieSum / (N * (N - 1)));
  if (varU <= 0) return u1 > meanU ? 0 : 1;
  // Continuity correction
  const z = (u1 - meanU - 0.5) / Math.sqrt(varU);
  return Math.max(0, Math.min(1, 1 - normalCdf(z)));
}

const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const r4 = (x) => (x === null || x === undefined ? null : Math.round(x * 10000) / 10000);
const r2 = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);

export function evaluatePhase2Scores(records, { tAward = 78.0, tLow = 63.0, bootstrapB = 2000, corporateTier2Unverified = false } = {}) {
  const t2 = records.filter((r) => r.stratum === "tier2_award");
  const allPro = records.filter((r) => r.stratum === "non_tier2_pro");
  const primaryPro = corporateTier2Unverified ? allPro.filter((r) => r.genre !== "企業映像") : allPro;
  const allLow = records.filter((r) => r.stratum === "non_tier2_low");
  const lowNo04 = allLow.filter((r) => r.label_rule_id !== "R-LOW-04");

  const t2Scores = t2.map((r) => r.score);
  const proScores = primaryPro.map((r) => r.score);
  const allProScores = allPro.map((r) => r.score);
  const lowScores = allLow.map((r) => r.score);
  const lowNo04Scores = lowNo04.map((r) => r.score);

  const p1Auc = pairwiseAuc(t2Scores, proScores);
  const p1Ci = bootstrapB > 0 ? bootstrapAucCi(t2Scores, proScores, bootstrapB) : null;
  const p2Hits = t2Scores.filter((s) => s >= tAward).length;
  const p2Min = Math.ceil(0.8 * t2Scores.length);
  const p3Correct = proScores.filter((s) => s < tAward).length;
  const p3Min = Math.ceil(0.84 * proScores.length);
  const p4Errors = t2Scores.filter((s) => s < tLow).length;
  const p4Max = Math.floor(0.0 * t2Scores.length);

  const primaryPass =
    p1Auc !== null &&
    p1Auc >= 0.9 &&
    p2Hits >= p2Min &&
    p3Correct >= p3Min &&
    p4Errors <= p4Max;

  function evalLowSubset(subScores) {
    if (!subScores.length) return null;
    const s1Err = subScores.filter((s) => s >= tAward).length;
    const s1Max = Math.floor(0.04 * subScores.length);
    const s2Auc = pairwiseAuc(t2Scores, subScores);
    const s3Auc = pairwiseAuc(allProScores, subScores);
    const meanGap = mean(allProScores) !== null && mean(subScores) !== null ? mean(allProScores) - mean(subScores) : null;
    const mwuP = mannWhitneyOneSidedP(allProScores, subScores);
    return {
      n_low: subScores.length,
      s1_major_error_b_count: s1Err,
      s1_major_error_b_max: s1Max,
      s1_major_error_b_rate: r4(s1Err / subScores.length),
      s1_pass: s1Err <= s1Max,
      s2_tier2_vs_low_auc: r4(s2Auc),
      s2_pass: s2Auc !== null && s2Auc >= 0.96,
      s3_pro_vs_low_auc: r4(s3Auc),
      s3_pro_minus_low_mean_gap: r2(meanGap),
      s3_mwu_one_sided_p: mwuP === null ? null : Number(mwuP.toExponential(3)),
      s3_pass: s3Auc !== null && s3Auc >= 0.8 && meanGap !== null && meanGap >= 10.0 && mwuP !== null && mwuP < 0.01,
    };
  }

  const secondaryAll = evalLowSubset(lowScores);
  const secondaryExcl04 = evalLowSubset(lowNo04Scores);

  const secondaryPass =
    secondaryAll === null
      ? null
      : secondaryAll.s1_pass &&
        secondaryAll.s2_pass &&
        secondaryAll.s3_pass &&
        (secondaryExcl04 === null ||
          (secondaryExcl04.s2_tier2_vs_low_auc >= 0.9 && secondaryExcl04.s3_pro_vs_low_auc >= 0.75));

  const decision = !primaryPass ? "NO-GO" : secondaryPass === false ? "HOLD_LOW_REDESIGN" : "GO";

  // 3-stratum x score-band cross-table
  const bands = (arr) => ({
    gte_t_award: arr.filter((s) => s >= tAward).length,
    mid_t_low_to_t_award: arr.filter((s) => s >= tLow && s < tAward).length,
    lt_t_low: arr.filter((s) => s < tLow).length,
    mean: r2(mean(arr)),
  });

  const nonT2All = [...allProScores, ...lowScores];

  return {
    thresholds: { t_award: tAward, t_low: tLow },
    counts: {
      tier2: t2Scores.length,
      primary_pro: proScores.length,
      all_pro: allProScores.length,
      low_all: lowScores.length,
      low_excl_r_low_04: lowNo04Scores.length,
    },
    primary: {
      scope: corporateTier2Unverified ? "4_genres_matched" : "5_genres_all",
      p1_roc_auc: r4(p1Auc),
      p1_ci95: p1Ci,
      p1_pass: p1Auc !== null && p1Auc >= 0.9,
      p2_sensitivity: r4(t2Scores.length ? p2Hits / t2Scores.length : null),
      p2_hits: p2Hits,
      p2_min_required: p2Min,
      p2_pass: p2Hits >= p2Min,
      p3_specificity: r4(proScores.length ? p3Correct / proScores.length : null),
      p3_correct: p3Correct,
      p3_min_required: p3Min,
      p3_pass: p3Correct >= p3Min,
      p4_major_error_a: p4Errors,
      p4_max_allowed: p4Max,
      p4_pass: p4Errors <= p4Max,
      all_primary_pass: primaryPass,
    },
    secondary_all_low: secondaryAll,
    secondary_excl_r_low_04: secondaryExcl04,
    reference: {
      tier2_vs_all_non_tier2_auc: r4(pairwiseAuc(t2Scores, nonT2All)),
      tier2_vs_all_pro_auc: r4(pairwiseAuc(t2Scores, allProScores)),
      cross_table: {
        tier2_award: bands(t2Scores),
        non_tier2_pro: bands(allProScores),
        non_tier2_low: bands(lowScores),
      },
    },
    decision,
  };
}

export function sweepDevThresholds(itemsWithBothModes, {
  tAwardGrid = [75, 76, 77, 78, 79, 80, 81, 82, 83, 84],
  tLowGrid = [58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68],
} = {}) {
  const results = [];
  for (const tAward of tAwardGrid) {
    for (const tLow of tLowGrid) {
      if (tLow > tAward - 5) continue;
      const scored = itemsWithBothModes.map((it) => {
        const h = computeHybridScore(it, {
          videoScore: it.video_score,
          contactSheetScore: it.contact_sheet_score,
          tAward,
          tLow,
        });
        return { ...it, score: h.final_score, final_mode: h.final_mode };
      });
      const ev = evaluatePhase2Scores(scored, { tAward, tLow, bootstrapB: 0 });
      const videoCalls = scored.filter((x) => x.final_mode !== "contact_sheet").length;
      results.push({
        t_award: tAward,
        t_low: tLow,
        decision: ev.decision,
        p1_auc: ev.primary.p1_roc_auc,
        p2_sens: ev.primary.p2_sensitivity,
        p3_spec: ev.primary.p3_specificity,
        p4_err: ev.primary.p4_major_error_a,
        s1_err: ev.secondary_all_low?.s1_major_error_b_count ?? null,
        video_rate: r4(scored.length ? videoCalls / scored.length : 0),
        youden_j: r4((ev.primary.p2_sensitivity || 0) + (ev.primary.p3_specificity || 0) - 1),
      });
    }
  }
  results.sort((a, b) => {
    const rank = (d) => (d === "GO" ? 2 : d === "HOLD_LOW_REDESIGN" ? 1 : 0);
    return (
      rank(b.decision) - rank(a.decision) ||
      b.youden_j - a.youden_j ||
      b.p1_auc - a.p1_auc ||
      a.t_award - b.t_award ||
      a.t_low - b.t_low
    );
  });
  return results;
}

export function findContiguousRuns(values, step = 1) {
  const uniq = [...new Set(values)].sort((a, b) => a - b);
  if (!uniq.length) return [];
  const runs = [[uniq[0]]];
  for (let i = 1; i < uniq.length; i++) {
    const prev = uniq[i - 1];
    if (Math.abs((uniq[i] - prev) - step) < 1e-9) {
      runs[runs.length - 1].push(uniq[i]);
    } else {
      runs.push([uniq[i]]);
    }
  }
  return runs;
}

function inferGridStep(allValues, fallback = 1) {
  const uniq = [...new Set(allValues)].sort((a, b) => a - b);
  let minDiff = Infinity;
  for (let i = 1; i < uniq.length; i++) {
    const d = uniq[i] - uniq[i - 1];
    if (d > 1e-9 && d < minDiff) minDiff = d;
  }
  return Number.isFinite(minDiff) ? minDiff : fallback;
}

function pickUpperMedianFromRuns(runs, rowsByVal) {
  if (!runs.length) return { value: null, chosen_run: [] };
  const ranked = runs.map((run) => {
    let maxAuc = -Infinity;
    for (const v of run) {
      for (const r of rowsByVal.get(v) || []) {
        if (typeof r.p1_auc === "number" && r.p1_auc > maxAuc) maxAuc = r.p1_auc;
      }
    }
    return { run, len: run.length, maxAuc, start: run[0] };
  });
  ranked.sort((a, b) => b.len - a.len || b.maxAuc - a.maxAuc || b.start - a.start);
  const bestRun = ranked[0].run;
  // Exact center for odd length; higher of the two middle values for even length
  const value = bestRun[Math.floor(bestRun.length / 2)];
  return { value, chosen_run: bestRun };
}

/**
 * Pre-registered deterministic threshold selector (CALIBRATION_PHASE2_DESIGN.md Section 5.6).
 * Independent of input row order:
 *  1. Filter GO rows and find max Youden's J.
 *  2. Among GO rows with max Youden's J, pick T_award as upper-median of longest contiguous run.
 *  3. At that T_award, pick T_low as upper-median of longest contiguous run among max-J GO rows.
 *  4. Also returns full GO pass-range width for transparent reporting.
 */
export function selectFrozenThresholds(sweepResults, { stepTAward = null, stepTLow = null } = {}) {
  const tAwardStep = stepTAward ?? inferGridStep(sweepResults.map((r) => r.t_award), 1);
  const tLowStep = stepTLow ?? inferGridStep(sweepResults.map((r) => r.t_low), 1);

  const goRows = sweepResults.filter((r) => r.decision === "GO");
  const goTAwardRuns = findContiguousRuns(goRows.map((r) => r.t_award), tAwardStep);
  const goTLowRuns = findContiguousRuns(goRows.map((r) => r.t_low), tLowStep);

  const passRange = {
    go_pair_count: goRows.length,
    total_pair_count: sweepResults.length,
    t_award_go_runs: goTAwardRuns,
    t_award_go_min: goTAwardRuns.length ? goTAwardRuns[0][0] : null,
    t_award_go_max: goTAwardRuns.length ? goTAwardRuns[goTAwardRuns.length - 1].slice(-1)[0] : null,
    t_low_go_runs: goTLowRuns,
    t_low_go_min: goTLowRuns.length ? goTLowRuns[0][0] : null,
    t_low_go_max: goTLowRuns.length ? goTLowRuns[goTLowRuns.length - 1].slice(-1)[0] : null,
  };

  if (!goRows.length) {
    return {
      selected: null,
      reason: "NO_GO_CANDIDATE",
      max_youden_j: null,
      tied_best_count: 0,
      best_t_award_run: [],
      best_t_low_run: [],
      pass_range: passRange,
    };
  }

  let maxJ = -Infinity;
  for (const r of goRows) {
    if (r.youden_j > maxJ) maxJ = r.youden_j;
  }
  const bestRows = goRows.filter((r) => Math.abs(r.youden_j - maxJ) < 1e-12);

  const byTAward = new Map();
  for (const r of bestRows) {
    if (!byTAward.has(r.t_award)) byTAward.set(r.t_award, []);
    byTAward.get(r.t_award).push(r);
  }
  const bestTAwardRuns = findContiguousRuns([...byTAward.keys()], tAwardStep);
  const tAwardPick = pickUpperMedianFromRuns(bestTAwardRuns, byTAward);

  const rowsAtTAward = byTAward.get(tAwardPick.value) || [];
  const byTLow = new Map();
  for (const r of rowsAtTAward) {
    if (!byTLow.has(r.t_low)) byTLow.set(r.t_low, []);
    byTLow.get(r.t_low).push(r);
  }
  const bestTLowRuns = findContiguousRuns([...byTLow.keys()], tLowStep);
  const tLowPick = pickUpperMedianFromRuns(bestTLowRuns, byTLow);

  const selected = rowsAtTAward.find((r) => r.t_low === tLowPick.value) || null;
  const goTLowRunsAtSelected = findContiguousRuns(
    goRows.filter((r) => r.t_award === tAwardPick.value).map((r) => r.t_low),
    tLowStep
  );

  return {
    selected,
    reason: bestRows.length === 1 ? "UNIQUE_MAX_YOUDEN_J_GO" : "UPPER_MEDIAN_OF_LONGEST_CONTIGUOUS_MAX_YOUDEN_J_RUN",
    max_youden_j: maxJ,
    tied_best_count: bestRows.length,
    best_t_award_run: tAwardPick.chosen_run,
    best_t_low_run: tLowPick.chosen_run,
    pass_range: {
      ...passRange,
      t_low_go_runs_at_selected_t_award: goTLowRunsAtSelected,
    },
  };
}
