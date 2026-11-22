import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = "E:\\iketeru-eizou";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function averageRanks(arr) {
  const indexed = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}

function pearson(x, y) {
  const n = x.length;
  if (n < 2) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx;
    const b = y[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

export function spearmanRho(x, y) {
  if (x.length < 2) return null;
  return pearson(averageRanks(x), averageRanks(y));
}

export function kendallTauB(x, y) {
  const n = x.length;
  if (n < 2) return null;
  let c = 0, d = 0, tx = 0, ty = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = Math.sign(x[i] - x[j]);
      const dy = Math.sign(y[i] - y[j]);
      if (dx === 0 && dy === 0) continue;
      if (dx === 0) tx++;
      else if (dy === 0) ty++;
      else if (dx === dy) c++;
      else d++;
    }
  }
  const denom = Math.sqrt((c + d + tx) * (c + d + ty));
  return denom === 0 ? null : (c - d) / denom;
}

export function bandDistance(score, band) {
  const [lo, hi] = band;
  if (score >= lo && score <= hi) return 0;
  return score < lo ? lo - score : score - hi;
}

export function pairwiseAccuracy(posScores, negScores) {
  if (posScores.length === 0 || negScores.length === 0) return null;
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

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function bootstrapCraftMetrics(items, B = 2000, seed = 20261122) {
  const n = items.length;
  if (n < 2) return { rho_ci: null, tau_ci: null, mae_ci: null };
  const rng = mulberry32(seed);
  const rhos = [], taus = [], maes = [];
  for (let b = 0; b < B; b++) {
    const xs = [], ys = [], dists = [];
    for (let i = 0; i < n; i++) {
      const it = items[Math.floor(rng() * n)];
      xs.push(it.target_mid);
      ys.push(it.ai_score);
      dists.push(it.band_dist);
    }
    const r = spearmanRho(xs, ys);
    const t = kendallTauB(xs, ys);
    if (r !== null) rhos.push(r);
    if (t !== null) taus.push(t);
    maes.push(dists.reduce((a, c) => a + c, 0) / n);
  }
  rhos.sort((a, b) => a - b);
  taus.sort((a, b) => a - b);
  maes.sort((a, b) => a - b);
  return {
    rho_ci: rhos.length ? [round4(percentile(rhos, 0.025)), round4(percentile(rhos, 0.975))] : null,
    tau_ci: taus.length ? [round4(percentile(taus, 0.025)), round4(percentile(taus, 0.975))] : null,
    mae_ci: maes.length ? [round4(percentile(maes, 0.025)), round4(percentile(maes, 0.975))] : null,
  };
}

function bootstrapPairwise(posScores, negScores, B = 2000, seed = 20261123) {
  if (posScores.length === 0 || negScores.length === 0) return null;
  const rng = mulberry32(seed);
  const vals = [];
  for (let b = 0; b < B; b++) {
    const ps = Array.from({ length: posScores.length }, () => posScores[Math.floor(rng() * posScores.length)]);
    const ns = Array.from({ length: negScores.length }, () => negScores[Math.floor(rng() * negScores.length)]);
    vals.push(pairwiseAccuracy(ps, ns));
  }
  vals.sort((a, b) => a - b);
  return [round4(percentile(vals, 0.025)), round4(percentile(vals, 0.975))];
}

function round4(v) {
  return v === null || v === undefined ? null : Math.round(v * 10000) / 10000;
}

const A_MINUS_PLUS = new Set(["S+", "S", "S-", "A+", "A", "A-"]);

function summarizeSubset(records, label) {
  const craft = records.filter(r => r.craft_or_purpose === "craft_benchmark");
  const craftAMinusPlus = craft.filter(r => A_MINUS_PLUS.has(r.objective_tier));
  const nonAward = records.filter(r => r.craft_or_purpose === "non_award_baseline");
  const referenceOnly = records.filter(r => r.craft_or_purpose !== "craft_benchmark" && r.craft_or_purpose !== "non_award_baseline");

  const xs = craft.map(r => r.target_mid);
  const ys = craft.map(r => r.ai_score);
  const rho = round4(spearmanRho(xs, ys));
  const tau = round4(kendallTauB(xs, ys));
  const mae = craft.length ? round4(craft.reduce((a, r) => a + r.band_dist, 0) / craft.length) : null;
  const exactBandHits = craft.filter(r => r.band_dist === 0).length;
  const bootCraft = bootstrapCraftMetrics(craft);

  const posScores = craftAMinusPlus.map(r => r.ai_score);
  const negScores = nonAward.map(r => r.ai_score);
  const pairwise = round4(pairwiseAccuracy(posScores, negScores));
  const pairwiseCi = bootstrapPairwise(posScores, negScores);

  const genres = ["CM", "MV", "モーション", "3DCG/アニメ", "企業映像"];
  const byGenre = {};
  for (const g of genres) {
    const gc = craft.filter(r => r.genre_bucket === g);
    const gcA = craftAMinusPlus.filter(r => r.genre_bucket === g);
    const gn = nonAward.filter(r => r.genre_bucket === g);
    if (g === "モーション") {
      byGenre[g] = { status: "未検証（基準作品1本のみのためジャンル別結果を出さない）", craft_n: gc.length, non_award_n: gn.length };
      continue;
    }
    byGenre[g] = {
      status: gc.length < 5 ? `参考（n<5：受賞作${gc.length}本のため合否・結論には使用しない）` : "算出対象",
      craft_n: gc.length,
      non_award_n: gn.length,
      spearman_rho: round4(spearmanRho(gc.map(r => r.target_mid), gc.map(r => r.ai_score))),
      band_distance_mae: gc.length ? round4(gc.reduce((a, r) => a + r.band_dist, 0) / gc.length) : null,
      pairwise_a_minus_plus_vs_non_award: round4(pairwiseAccuracy(gcA.map(r => r.ai_score), gn.map(r => r.ai_score))),
    };
  }

  const rankBandGroups = {
    "S帯(S+/S/S-)": craft.filter(r => ["S+", "S", "S-"].includes(r.objective_tier)),
    "A帯(A+/A/A-)": craft.filter(r => ["A+", "A", "A-"].includes(r.objective_tier)),
    "B帯以下(B+以下)": craft.filter(r => !["S+", "S", "S-", "A+", "A", "A-"].includes(r.objective_tier)),
  };
  const byRankBand = {};
  for (const [bLabel, items] of Object.entries(rankBandGroups)) {
    const exact = items.filter(r => r.band_dist === 0).length;
    const within5 = items.filter(r => r.band_dist <= 5).length;
    byRankBand[bLabel] = {
      n: items.length,
      exact_band_hits: `${exact}/${items.length}`,
      exact_band_hit_rate: items.length ? round4(exact / items.length) : null,
      within_5pt_of_band_hits: `${within5}/${items.length}`,
      within_5pt_of_band_rate: items.length ? round4(within5 / items.length) : null,
      band_distance_mae: items.length ? round4(items.reduce((a, r) => a + r.band_dist, 0) / items.length) : null,
      mean_signed_bias: items.length ? round4(items.reduce((a, r) => a + (r.ai_score - r.target_mid), 0) / items.length) : null,
    };
  }

  const sBandN = rankBandGroups["S帯(S+/S/S-)"].length;
  const subsetNote = label === "contamination_excluded"
    ? `参考値（既知除外により上位帯が脱落し範囲が狭い：S帯残存 ${sBandN} 本 / 受賞作計 ${craft.length} 本）`
    : label === "bova_excluded_sensitivity"
    ? `事前登録感度分析（案C：BOVA除外・同一実行データより算出・受賞作 ${craft.length} 本 vs 非受賞作 ${nonAward.length} 本）`
    : null;

  return {
    subset: label,
    ...(subsetNote ? { note: subsetNote } : {}),
    counts: {
      total: records.length,
      craft: craft.length,
      craft_a_minus_plus: craftAMinusPlus.length,
      non_award: nonAward.length,
      reference_only_scored: referenceOnly.length,
    },
    craft_metrics: {
      spearman_rho: rho,
      spearman_rho_95ci: bootCraft.rho_ci,
      kendall_tau_b: tau,
      kendall_tau_b_95ci: bootCraft.tau_ci,
      band_distance_mae: mae,
      band_distance_mae_95ci: bootCraft.mae_ci,
      exact_band_hit_rate: craft.length ? round4(exactBandHits / craft.length) : null,
      exact_band_hits: `${exactBandHits}/${craft.length}`,
      mean_signed_bias: craft.length ? round4(craft.reduce((a, r) => a + (r.ai_score - r.target_mid), 0) / craft.length) : null,
    },
    by_rank_band: byRankBand,
    pairwise_metrics: {
      a_minus_plus_vs_non_award: pairwise,
      pairwise_95ci: pairwiseCi,
      mean_craft_a_minus_plus: posScores.length ? round4(posScores.reduce((a, b) => a + b, 0) / posScores.length) : null,
      mean_non_award: negScores.length ? round4(negScores.reduce((a, b) => a + b, 0) / negScores.length) : null,
    },
    by_genre: byGenre,
  };
}

function main() {
  const runId = process.argv[2];
  if (!runId) {
    console.error("Usage: node scripts/evaluate-calibration-run.mjs <run_id> [--out <filename>]");
    process.exit(2);
  }
  const outIdx = process.argv.indexOf("--out");
  const outFilename = outIdx >= 0 && process.argv[outIdx + 1] ? process.argv[outIdx + 1] : "evaluation_summary.json";
  const runDir = path.join(REPO_ROOT, "analysis", "runs", runId);
  const scoresPath = path.join(runDir, "raw_scores.jsonl");
  const bench = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "golden_benchmark.json"), "utf8"));
  const benchById = new Map(bench.map(x => [x.id, x]));
  const split = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "benchmark_split.json"), "utf8"));
  const bovaExcludedSet = new Set(split.bova_sensitivity_excluded_ids || []);

  const lines = fs.readFileSync(scoresPath, "utf8").split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));

  const outByMode = {};
  for (const mode of ["video", "contact_sheet"]) {
    const modeRuns = lines.filter(x => x.mode === mode);
    const validRuns = modeRuns.filter(x => x.audit_valid === true && typeof x.total_score === "number");
    const invalidRuns = modeRuns.filter(x => x.audit_valid !== true);

    // Group by video_id for 2+1 ensemble
    const byVid = new Map();
    for (const r of validRuns) {
      if (!byVid.has(r.video_id)) byVid.set(r.video_id, []);
      byVid.get(r.video_id).push(r);
    }

    const aggregated = [];
    for (const [videoId, runs] of byVid.entries()) {
      runs.sort((a, b) => (a.attempt || 0) - (b.attempt || 0));
      const scores = runs.map(r => r.total_score);
      let finalScore;
      let ensembleRule;
      if (scores.length === 1) {
        finalScore = scores[0];
        ensembleRule = "single_run";
      } else if (scores.length === 2) {
        finalScore = (scores[0] + scores[1]) / 2;
        ensembleRule = Math.abs(scores[0] - scores[1]) >= 5 ? "needs_3rd_tiebreaker" : "mean_of_2";
      } else {
        const sorted3 = [...scores.slice(0, 3)].sort((a, b) => a - b);
        finalScore = sorted3[1];
        ensembleRule = "median_of_3";
      }

      const meta = benchById.get(videoId);
      const band = meta.objective_band;
      const targetMid = band ? (band[0] + band[1]) / 2 : null;
      const bDist = band ? bandDistance(finalScore, band) : null;

      const flaggedContam = runs.some(r =>
        Boolean(r.post_check?.knows_work) ||
        Boolean(r.post_check?.knows_award_history) ||
        Boolean(r.post_check?.award_badge_visible_in_video)
      );

      const isBova = bovaExcludedSet.has(videoId) || (meta.awards || []).some(a => /BOVA/i.test(a.name || ""));

      aggregated.push({
        video_id: videoId,
        genre_bucket: meta.genre_bucket,
        craft_or_purpose: meta.craft_or_purpose,
        is_bova: isBova,
        objective_tier: meta.objective_tier,
        objective_band: band,
        target_mid: targetMid,
        raw_scores: scores,
        ai_score: round4(finalScore),
        ensemble_rule: ensembleRule,
        band_dist: bDist !== null ? round4(bDist) : null,
        flagged_contamination: flaggedContam,
        knows_work: runs.some(r => Boolean(r.post_check?.knows_work)),
        knows_award_history: runs.some(r => Boolean(r.post_check?.knows_award_history)),
        award_badge_visible_in_video: runs.some(r => Boolean(r.post_check?.award_badge_visible_in_video)),
        run_count: runs.length,
        avg_first_post_read_input_tokens: Math.round(
          runs.reduce((a, r) => a + (r.token_usage?.first_post_read_input_tokens || 0), 0) / runs.length
        ),
        avg_first_post_read_effective_input_tokens: Math.round(
          runs.reduce((a, r) => a + (r.token_usage?.first_post_read_effective_input_tokens || r.token_usage?.first_post_read_input_tokens || 0), 0) / runs.length
        ),
      });
    }

    const tokenVals = validRuns
      .map(r => r.token_usage?.first_post_read_input_tokens)
      .filter(v => typeof v === "number" && v > 0)
      .sort((a, b) => a - b);
    const effTokenVals = validRuns
      .map(r => r.token_usage?.first_post_read_effective_input_tokens ?? r.token_usage?.first_post_read_input_tokens)
      .filter(v => typeof v === "number" && v > 0)
      .sort((a, b) => a - b);

    const unflagged = aggregated.filter(r => !r.flagged_contamination);
    const bovaExcluded = aggregated.filter(r => !r.is_bova);
    const tiebreakersNeeded = aggregated.filter(r => r.ensemble_rule === "needs_3rd_tiebreaker").map(r => r.video_id);
    const tiebreakersCompleted = aggregated.filter(r => r.ensemble_rule === "median_of_3").map(r => r.video_id);

    outByMode[mode] = {
      valid_subagent_runs: validRuns.length,
      invalid_subagent_runs: invalidRuns.length,
      unique_videos_scored: aggregated.length,
      tiebreakers_needed_count: tiebreakersNeeded.length,
      tiebreakers_needed_videos: tiebreakersNeeded,
      tiebreakers_completed_count: tiebreakersCompleted.length,
      flagged_contamination_count: aggregated.length - unflagged.length,
      token_summary: {
        count: tokenVals.length,
        min_first_post_read_input_tokens: tokenVals[0] ?? null,
        median_first_post_read_input_tokens: tokenVals.length ? tokenVals[Math.floor(tokenVals.length / 2)] : null,
        max_first_post_read_input_tokens: tokenVals[tokenVals.length - 1] ?? null,
        mean_first_post_read_input_tokens: tokenVals.length ? Math.round(tokenVals.reduce((a, b) => a + b, 0) / tokenVals.length) : null,
        min_first_post_read_effective_input_tokens: effTokenVals[0] ?? null,
        median_first_post_read_effective_input_tokens: effTokenVals.length ? effTokenVals[Math.floor(effTokenVals.length / 2)] : null,
        max_first_post_read_effective_input_tokens: effTokenVals[effTokenVals.length - 1] ?? null,
        mean_first_post_read_effective_input_tokens: effTokenVals.length ? Math.round(effTokenVals.reduce((a, b) => a + b, 0) / effTokenVals.length) : null,
      },
      all_included: summarizeSubset(aggregated, "all_included"),
      bova_excluded_sensitivity: summarizeSubset(bovaExcluded, "bova_excluded_sensitivity"),
      contamination_excluded: summarizeSubset(unflagged, "contamination_excluded"),
      per_video: aggregated,
    };
  }

  const outPath = path.join(runDir, outFilename);
  fs.writeFileSync(outPath, JSON.stringify({
    run_id: runId,
    evaluated_at: new Date().toISOString(),
    protocol_version: split.protocol_version || null,
    ensemble_tiebreaker_rule: "|s1 - s2| >= 5 -> median of 3 (otherwise mean of 2)",
    modes: outByMode,
  }, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outPath}`);
  for (const m of ["video", "contact_sheet"]) {
    console.log(`\n=== ${m.toUpperCase()} ===`);
    console.log(JSON.stringify({
      valid_runs: outByMode[m].valid_subagent_runs,
      invalid_runs: outByMode[m].invalid_subagent_runs,
      videos: outByMode[m].unique_videos_scored,
      flagged_contam: outByMode[m].flagged_contamination_count,
      tokens: outByMode[m].token_summary,
      all_included_craft: outByMode[m].all_included.craft_metrics,
      all_included_pairwise: outByMode[m].all_included.pairwise_metrics,
      bova_excl_craft: outByMode[m].bova_excluded_sensitivity.craft_metrics,
      bova_excl_pairwise: outByMode[m].bova_excluded_sensitivity.pairwise_metrics,
      contam_excl_craft: outByMode[m].contamination_excluded.craft_metrics,
      contam_excl_pairwise: outByMode[m].contamination_excluded.pairwise_metrics,
    }, null, 2));
  }
}

main();
