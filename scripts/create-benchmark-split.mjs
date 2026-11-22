import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = "E:\\iketeru-eizou";
const bench = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "golden_benchmark.json"), "utf8"));

// Deterministic seeded PRNG (Mulberry32) so train/holdout split is 100% reproducible & pre-registered
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

function seededShuffle(arr, rng) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const SEED = 20261122;
const rng = mulberry32(SEED);

// 1. Stratified split of craft_benchmark (34 total -> 20 dev/tuning, 14 holdout/eval)
// Stratify by objective_tier so every tier is balanced across dev and holdout
const craft = bench.filter(x => x.craft_or_purpose === "craft_benchmark");
const tierOrder = ["S+", "S", "S-", "A+", "A", "A-", "B+"];
const devCraft = [];
const holdoutCraft = [];

// Allocate exact per-tier holdout counts summing to 14 out of 34:
// S+(3)->1, S(2)->1, S-(9)->4, A+(7)->3, A(8)->3, A-(4)->2, B+(1)->0 (sum=14!)
const holdoutQuotaByTier = { "S+": 1, "S": 1, "S-": 4, "A+": 3, "A": 3, "A-": 2, "B+": 0 };

for (const t of tierOrder) {
  const group = seededShuffle(craft.filter(x => x.objective_tier === t), rng);
  const hCount = holdoutQuotaByTier[t] ?? 0;
  holdoutCraft.push(...group.slice(0, hCount));
  devCraft.push(...group.slice(hCount));
}

// 2. Stratified split of non_award_baseline (44 total -> 24 dev/tuning, 20 holdout/eval)
// Stratify by genre_bucket
const nonAward = bench.filter(x => x.craft_or_purpose === "non_award_baseline");
const genres = ["CM", "MV", "モーション", "3DCG/アニメ", "企業映像"];
// CM(8)->4, MV(7)->3, モーション(9)->4, 3DCG/アニメ(10)->4, 企業映像(10)->5 (sum=20!)
const holdoutQuotaByGenre = { "CM": 4, "MV": 3, "モーション": 4, "3DCG/アニメ": 4, "企業映像": 5 };
const devNonAward = [];
const holdoutNonAward = [];

for (const g of genres) {
  const group = seededShuffle(nonAward.filter(x => x.genre_bucket === g), rng);
  const hCount = holdoutQuotaByGenre[g] ?? 0;
  holdoutNonAward.push(...group.slice(0, hCount));
  devNonAward.push(...group.slice(hCount));
}

// 3. Reference-only entries (5 total -> reported separately, never used in pass/fail)
const referenceOnly = bench.filter(x =>
  x.craft_or_purpose !== "craft_benchmark" && x.craft_or_purpose !== "non_award_baseline"
);

const splitDoc = {
  protocol_version: "v1_preregistered",
  created_at: new Date().toISOString(),
  seed: SEED,
  fixed_pass_criteria_on_holdout: {
    spearman_rho_min: 0.85,
    band_distance_mae_max: 4.0,
    pairwise_accuracy_a_minus_plus_vs_non_award_min: 0.85,
    note: "固定基準（結果を見て変更しない）。合否判定はすべて未学習の確認用（holdout）のみで実施する。"
  },
  counts: {
    dev_craft: devCraft.length,
    holdout_craft: holdoutCraft.length,
    dev_non_award: devNonAward.length,
    holdout_non_award: holdoutNonAward.length,
    reference_only: referenceOnly.length,
    total: devCraft.length + holdoutCraft.length + devNonAward.length + holdoutNonAward.length + referenceOnly.length
  },
  dev_craft_ids: devCraft.map(x => x.id),
  holdout_craft_ids: holdoutCraft.map(x => x.id),
  dev_non_award_ids: devNonAward.map(x => x.id),
  holdout_non_award_ids: holdoutNonAward.map(x => x.id),
  reference_only_ids: referenceOnly.map(x => x.id),
  tier_distribution: Object.fromEntries(
    tierOrder.map(t => [
      t,
      {
        dev: devCraft.filter(x => x.objective_tier === t).length,
        holdout: holdoutCraft.filter(x => x.objective_tier === t).length,
      }
    ])
  ),
  genre_distribution: Object.fromEntries(
    genres.map(g => [
      g,
      {
        dev_craft: devCraft.filter(x => x.genre_bucket === g).length,
        holdout_craft: holdoutCraft.filter(x => x.genre_bucket === g).length,
        dev_non_award: devNonAward.filter(x => x.genre_bucket === g).length,
        holdout_non_award: holdoutNonAward.filter(x => x.genre_bucket === g).length,
        genre_report_status: g === "モーション" ? "未検証（基準作品1本のみのためジャンル別結果を出さない）" : "算出対象"
      }
    ])
  )
};

fs.writeFileSync(
  path.join(REPO_ROOT, "analysis", "benchmark_split.json"),
  JSON.stringify(splitDoc, null, 2) + "\n",
  "utf8"
);

console.log("Wrote analysis/benchmark_split.json");
console.log("Counts:", splitDoc.counts);
console.log("Tier distribution:", splitDoc.tier_distribution);
console.log("Genre distribution:", splitDoc.genre_distribution);
