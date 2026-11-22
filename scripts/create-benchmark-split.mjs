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

// 4. Symmetrically exclude unfetchable videos from BOTH Contact-Sheet and Video modes
//    (applied AFTER the seeded split so all fetchable videos retain their exact pre-registered assignments)
const prefetchPath = path.join(REPO_ROOT, "analysis", "benchmark_prefetch_check.json");
const excludedRecords = [];
const excludedIdSet = new Set();
if (fs.existsSync(prefetchPath)) {
  const prefetch = JSON.parse(fs.readFileSync(prefetchPath, "utf8"));
  for (const ex of (prefetch.excluded_from_both_modes || [])) {
    excludedIdSet.add(ex.id);
    excludedRecords.push(ex);
  }
}

const activeDevCraft = devCraft.filter(x => !excludedIdSet.has(x.id));
const activeHoldoutCraft = holdoutCraft.filter(x => !excludedIdSet.has(x.id));
const activeDevNonAward = devNonAward.filter(x => !excludedIdSet.has(x.id));
const activeHoldoutNonAward = holdoutNonAward.filter(x => !excludedIdSet.has(x.id));
const activeReferenceOnly = referenceOnly.filter(x => !excludedIdSet.has(x.id));

const splitDoc = {
  protocol_version: "v2_preregistered",
  created_at: new Date().toISOString(),
  seed: SEED,
  fixed_pass_criteria_on_holdout: {
    spearman_rho_min: 0.85,
    band_distance_mae_max: 4.0,
    pairwise_accuracy_a_minus_plus_vs_non_award_min: 0.85,
    judgment_basis: "point_estimate_on_holdout_with_bootstrap_95ci_reported",
    holdout_max_runs: 1,
    note: "固定基準（結果を見て変更しない）。合否判定はすべて未学習の確認用（holdout）の点推定値のみで1回限り実施し、ブートストラップ95%信頼区間を併記する。"
  },
  counts: {
    dev_craft: activeDevCraft.length,
    holdout_craft: activeHoldoutCraft.length,
    dev_non_award: activeDevNonAward.length,
    holdout_non_award: activeHoldoutNonAward.length,
    reference_only: activeReferenceOnly.length,
    active_total: activeDevCraft.length + activeHoldoutCraft.length + activeDevNonAward.length + activeHoldoutNonAward.length + activeReferenceOnly.length,
    excluded_from_both_modes: excludedRecords.length,
    benchmark_total: bench.length
  },
  excluded_from_both_modes: excludedRecords,
  dev_craft_ids: activeDevCraft.map(x => x.id),
  holdout_craft_ids: activeHoldoutCraft.map(x => x.id),
  dev_non_award_ids: activeDevNonAward.map(x => x.id),
  holdout_non_award_ids: activeHoldoutNonAward.map(x => x.id),
  reference_only_ids: activeReferenceOnly.map(x => x.id),
  tier_distribution: Object.fromEntries(
    tierOrder.map(t => [
      t,
      {
        dev: activeDevCraft.filter(x => x.objective_tier === t).length,
        holdout: activeHoldoutCraft.filter(x => x.objective_tier === t).length,
      }
    ])
  ),
  genre_distribution: Object.fromEntries(
    genres.map(g => {
      const hc = activeHoldoutCraft.filter(x => x.genre_bucket === g).length;
      let status = "算出対象";
      if (g === "モーション") {
        status = "未検証（基準作品1本・確認用0本のためジャンル別結果を出さない）";
      } else if (hc < 5) {
        status = `参考（n<5：確認用受賞作${hc}本のため合否・結論には使用しない）`;
      }
      return [
        g,
        {
          dev_craft: activeDevCraft.filter(x => x.genre_bucket === g).length,
          holdout_craft: hc,
          dev_non_award: activeDevNonAward.filter(x => x.genre_bucket === g).length,
          holdout_non_award: activeHoldoutNonAward.filter(x => x.genre_bucket === g).length,
          genre_report_status: status
        }
      ];
    })
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
