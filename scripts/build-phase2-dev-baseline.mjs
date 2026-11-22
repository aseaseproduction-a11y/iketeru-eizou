#!/usr/bin/env node
/**
 * Build Phase 1 surviving Dev baseline report (analysis/phase2_dev_baseline_phase1_only.json)
 * by combining:
 *   - Phase 1 blind runs (run_20261122_195500 + run_20261122_232100)
 *   - Step 0 re-audit (analysis/phase2_dev_non_award_reaudit.json -> 9 kept R-PRO)
 *   - OCR precheck log (analysis/phase2_ocr_precheck_log.jsonl -> excludes OCR-hit V6XHz7tqGVM)
 *   - Phase 1 golden_benchmark.json (excluding BOVA and purpose_benchmark)
 *
 * Strictly NEVER reads analysis/phase2_holdout_v1.json!
 */

import fs from "node:fs";
import path from "node:path";
import { computeHybridScore } from "./phase2-hybrid-router.mjs";
import { evaluatePhase2Scores, sweepDevThresholds } from "./evaluate-phase2-calibration.mjs";

const REPO = "E:\\iketeru-eizou";

const golden = JSON.parse(fs.readFileSync(path.join(REPO, "analysis", "golden_benchmark.json"), "utf8"));
const reaudit = JSON.parse(fs.readFileSync(path.join(REPO, "analysis", "phase2_dev_non_award_reaudit.json"), "utf8"));
const ocrLines = fs
  .readFileSync(path.join(REPO, "analysis", "phase2_ocr_precheck_log.jsonl"), "utf8")
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const ocrHits = new Set(ocrLines.filter((x) => x.award_badge_ocr_hit).map((x) => x.video_id));

const keptProSet = new Set(reaudit.kept_ids || []);
const reauditById = new Map((reaudit.records || []).map((r) => [r.video_id || r.id, r]));

const runIds = ["run_20261122_195500", "run_20261122_232100"];
const metricsById = new Map();
const videoScoreById = new Map();
const csScoreById = new Map();

for (const rid of runIds) {
  const rdir = path.join(REPO, "analysis", "runs", rid);
  const manifest = JSON.parse(fs.readFileSync(path.join(rdir, "run_manifest.json"), "utf8"));
  for (const [vid, info] of Object.entries(manifest.items || {})) {
    metricsById.set(vid, { ...info.metrics, genre_bucket: info.genre_bucket, run_id: rid });
  }
  const ev = JSON.parse(fs.readFileSync(path.join(rdir, "evaluation_summary.json"), "utf8"));
  for (const row of ev.modes?.video?.per_video || []) {
    videoScoreById.set(row.video_id, row);
  }
  for (const row of ev.modes?.contact_sheet?.per_video || []) {
    csScoreById.set(row.video_id, row);
  }
}

const isBova = (v) =>
  (v.awards || []).some((a) => /bova/i.test(`${a.name || ""} ${a.category || ""}`)) ||
  /bova/i.test(v.rationale || "");

const excludedTier2 = [];
const survivingItems = [];

for (const v of golden) {
  const vid = v.id;
  const m = metricsById.get(vid);
  const vs = videoScoreById.get(vid);
  const cs = csScoreById.get(vid);
  if (!m || !vs || !cs) continue;

  if (v.craft_or_purpose === "craft_benchmark" && ["S+", "S", "S-", "A+", "A", "A-"].includes(v.objective_tier)) {
    if (isBova(v)) {
      excludedTier2.push({ video_id: vid, title: v.title, reason: "BOVA_excluded_per_Phase2_Rule_1.2" });
      continue;
    }
    if (ocrHits.has(vid) || vs.award_badge_visible_in_video || cs.award_badge_visible_in_video) {
      excludedTier2.push({ video_id: vid, title: v.title, reason: "award_badge_visible_or_ocr_hit" });
      continue;
    }
    const awardsSummary = (v.awards || []).map((a) => `${a.name} ${a.year} (${a.category})`).join("; ");
    survivingItems.push({
      video_id: vid,
      title: v.title,
      stratum: "tier2_award",
      genre: v.genre_bucket,
      objective_tier: v.objective_tier,
      awards_summary: awardsSummary,
      run_id: m.run_id,
      duration_sec: m.duration_sec,
      total_cuts: m.total_cuts,
      avg_cut_interval_sec: m.avg_cut_interval_sec,
      max_cuts_per_10s: m.max_cuts_per_10s,
      integrated_lufs: m.integrated_lufs,
      video_score: vs.ai_score,
      contact_sheet_score: cs.ai_score,
      flagged_contamination_video: Boolean(vs.flagged_contamination),
    });
  } else if (keptProSet.has(vid)) {
    const rec = reauditById.get(vid);
    survivingItems.push({
      video_id: vid,
      title: v.title,
      stratum: "non_tier2_pro",
      genre: v.genre_bucket,
      label_rule_id: rec?.rule_id || "R-PRO-kept",
      run_id: m.run_id,
      duration_sec: m.duration_sec,
      total_cuts: m.total_cuts,
      avg_cut_interval_sec: m.avg_cut_interval_sec,
      max_cuts_per_10s: m.max_cuts_per_10s,
      integrated_lufs: m.integrated_lufs,
      video_score: vs.ai_score,
      contact_sheet_score: cs.ai_score,
      flagged_contamination_video: Boolean(vs.flagged_contamination),
    });
  }
}

// Compute mode comparisons at default (T_award=78, T_low=63)
const defaultT = { tAward: 78.0, tLow: 63.0 };
const withHybridDefault = survivingItems.map((it) => {
  const h = computeHybridScore(it, {
    videoScore: it.video_score,
    contactSheetScore: it.contact_sheet_score,
    ...defaultT,
  });
  return { ...it, hybrid_default: h };
});

const evalVideoOnly = evaluatePhase2Scores(
  survivingItems.map((x) => ({ ...x, score: x.video_score })),
  { ...defaultT, bootstrapB: 2000 }
);
const evalCsOnly = evaluatePhase2Scores(
  survivingItems.map((x) => ({ ...x, score: x.contact_sheet_score })),
  { ...defaultT, bootstrapB: 2000 }
);
const evalHybridDefault = evaluatePhase2Scores(
  withHybridDefault.map((x) => ({ ...x, score: x.hybrid_default.final_score })),
  { ...defaultT, bootstrapB: 2000 }
);

const sweep = sweepDevThresholds(survivingItems, {
  tAwardGrid: [76, 77, 78, 79, 80, 81, 82],
  tLowGrid: [60, 62, 63, 64, 65],
});

const routeCounts = { video_h1: 0, video_h2_escalated: 0, contact_sheet: 0 };
for (const x of withHybridDefault) routeCounts[x.hybrid_default.final_mode]++;

const genreBreakdown = {};
for (const x of survivingItems) {
  genreBreakdown[x.genre] = genreBreakdown[x.genre] || { tier2_award: 0, non_tier2_pro: 0 };
  genreBreakdown[x.genre][x.stratum]++;
}

const report = {
  generated_at: new Date().toISOString(),
  note: "Phase 1 surviving Dev baseline ONLY (before adding the 31 new Phase 2 Dev videos). Holdout v1 was NOT accessed.",
  phase1_surviving_counts: {
    total: survivingItems.length,
    tier2_award: survivingItems.filter((x) => x.stratum === "tier2_award").length,
    non_tier2_pro: survivingItems.filter((x) => x.stratum === "non_tier2_pro").length,
    non_tier2_low: 0,
    by_genre: genreBreakdown,
  },
  excluded_phase1_tier2: excludedTier2,
  note_on_uCDUpZV3f8A:
    "uCDUpZV3f8A (ADFEST 2016 Fabulous Four Commendation Certificate) is flagged for user review: it is a New Director Lotus short film rather than a strict Category D corporate film craft winner.",
  default_threshold_78_63_comparison: {
    video_only: evalVideoOnly,
    contact_sheet_only: evalCsOnly,
    hybrid_h1_h2: {
      route_counts: routeCounts,
      video_call_rate: Math.round(((routeCounts.video_h1 + routeCounts.video_h2_escalated) / survivingItems.length) * 10000) / 10000,
      evaluation: evalHybridDefault,
    },
  },
  dev_threshold_sweep_top10: sweep.slice(0, 10),
  items: withHybridDefault,
};

const outPath = path.join(REPO, "analysis", "phase2_dev_baseline_phase1_only.json");
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");

console.log("=== Phase 1 Surviving Dev Baseline (Holdout untouched) ===");
console.log("Counts:", JSON.stringify(report.phase1_surviving_counts));
console.log("Excluded Tier 2:", excludedTier2.map((x) => `${x.video_id}(${x.reason})`).join(", "));
console.log("\n--- At default T_award=78, T_low=63 ---");
for (const [label, ev] of [
  ["video_only", evalVideoOnly],
  ["contact_sheet_only", evalCsOnly],
  ["hybrid_h1_h2", evalHybridDefault],
]) {
  const p = ev.primary;
  console.log(
    `${label.padEnd(20)} | P-1 AUC=${p.p1_roc_auc} [${p.p1_ci95?.low}, ${p.p1_ci95?.high}] | P-2=${p.p2_hits}/${ev.counts.tier2} (${p.p2_sensitivity}) | P-3=${p.p3_correct}/${ev.counts.primary_pro} (${p.p3_specificity}) | P-4=${p.p4_major_error_a} | decision=${ev.decision}`
  );
}
console.log("Hybrid routing at (78,63):", JSON.stringify(routeCounts), "video_rate=", report.default_threshold_78_63_comparison.hybrid_h1_h2.video_call_rate);
console.log("\n--- Top 5 Dev Threshold Sweep (Hybrid, Phase 1 surviving only) ---");
for (const row of sweep.slice(0, 5)) {
  console.log(JSON.stringify(row));
}
console.log("\n--- Per-item Phase 1 Surviving Tier 2 Awards Audit ---");
for (const it of survivingItems.filter((x) => x.stratum === "tier2_award")) {
  console.log(`${it.video_id} | ${it.genre} | vid=${it.video_score} cs=${it.contact_sheet_score} | ${it.awards_summary}`);
}
console.log("\n--- Per-item Phase 1 Surviving R-PRO ---");
for (const it of survivingItems.filter((x) => x.stratum === "non_tier2_pro")) {
  console.log(`${it.video_id} | ${it.genre} | vid=${it.video_score} cs=${it.contact_sheet_score} | ${it.label_rule_id}`);
}
