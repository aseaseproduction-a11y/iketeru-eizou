#!/usr/bin/env node
/**
 * Deterministic validator for Phase 2 fact-based datasets (Dev additions + New Holdout).
 *
 * Enforces docs/CALIBRATION_PHASE2_DESIGN.md (v3-frozen, commit 61d126a):
 * - Zero overlap with Phase 1's 83 videos (golden_benchmark.json).
 * - Zero overlap between Dev additions and New Holdout.
 * - Valid stratum & label_rule_id mapping (R-T2-*, R-PRO-*, R-LOW-*).
 * - Mutual exclusion: no video matching both R-PRO-* and R-LOW-*.
 * - Corporate video R-PRO strictness: corporate videos must have production-company credit
 *   (R-PRO-01 / R-PRO-03) or TV/major ad distribution fact (R-PRO-04).
 * - Required evidence fields (evidence_url, evidence_excerpt, view_count_at_collection,
 *   collected_at, award_badge_ocr_hit === false).
 * - New Holdout quotas:
 *     - 5 genres x 3 strata: CM/MV/モーション/3DCG/アニメ = 5 each; 企業映像 Tier 2 >= 3 (target 5)
 *     - Tier 2 anti-fame numeric rule:
 *         - >= ceil(0.60 * N_T2) published/awarded in 2022-2026 AND views < 500,000 (YT) / < 100,000 (Vimeo)
 *         - <= 2 videos with views >= 10,000,000
 *     - R-LOW-04-only cap: <= 5 videos out of 25 (20%)
 */

import fs from "node:fs";
import path from "node:path";

export const VALID_GENRES = ["CM", "MV", "モーション", "3DCG/アニメ", "企業映像"];
export const VALID_STRATA = ["tier2_award", "non_tier2_pro", "non_tier2_low"];

export const RULE_TO_STRATUM = {
  "R-T2-01": "tier2_award",
  "R-T2-02": "tier2_award",
  "R-T2-03": "tier2_award",
  "R-T2-04": "tier2_award",
  "R-T2-05": "tier2_award",
  "R-PRO-01": "non_tier2_pro",
  "R-PRO-02": "non_tier2_pro",
  "R-PRO-03": "non_tier2_pro",
  "R-PRO-04": "non_tier2_pro",
  "R-LOW-01": "non_tier2_low",
  "R-LOW-02": "non_tier2_low",
  "R-LOW-03": "non_tier2_low",
  "R-LOW-04": "non_tier2_low",
};

export const R_LOW_KEYWORDS_RE = new RegExp(
  [
    "初めて作った",
    "初めて制作",
    "初制作",
    "初投稿",
    "初心者",
    "練習用",
    "練習で作",
    "テスト動画",
    "独学で初めて",
    "授業課題",
    "学校の課題",
    "映像制作1本目",
    "my\\s+first\\s+video",
    "first\\s+time\\s+editing",
    "first\\s+animation",
    "\\bbeginner\\b",
    "practice\\s+video",
    "test\\s+animation",
    "learning\\s+blender",
    "learning\\s+after\\s+effects",
    "class\\s+assignment",
    "student\\s+exercise",
    "スライドを動画化",
    "パワポで作成",
    "プレゼン資料動画",
    "canva\\s*テンプレート",
    "\\bvyond\\b",
    "\\banimaker\\b",
    "\\bpowtoon\\b",
    "\\brenderforest\\b",
    "\\banimoto\\b",
    "capcut\\s*テンプレ",
    "aiスライド自動生成",
    "無編集",
    "ノーカット",
    "固定カメラ",
    "定点撮影",
    "説明会録画",
    "セミナー録画",
    "ウェビナーアーカイブ",
    "画面録画そのまま",
    "スマホ一発撮り",
    "\\bunedited\\b",
    "raw\\s+footage",
    "static\\s+camera",
    "fixed\\s+camera",
    "webinar\\s+recording",
    "made\\s+with\\s+clipchamp",
    "created\\s+with\\s+powtoon",
    "filmora\\s*無料版",
  ].join("|"),
  "i"
);

export function validatePhase2Dataset(entries, options = {}) {
  const {
    mode = "holdout", // "holdout" | "dev_additions"
    phase1Ids = new Set(),
    otherSplitIds = new Set(),
  } = options;

  const errors = [];
  const warnings = [];
  const seenIds = new Set();
  const seenUrls = new Set();

  if (!Array.isArray(entries)) {
    return { valid: false, errors: ["Dataset must be a JSON array"], warnings, stats: {} };
  }

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const tag = `[${i}:${e?.video_id || "NO_ID"}]`;

    if (!e || typeof e !== "object") {
      errors.push(`${tag} entry must be an object`);
      continue;
    }

    for (const req of [
      "video_id",
      "url",
      "platform",
      "genre",
      "published_year",
      "stratum",
      "label_rule_id",
      "evidence_url",
      "evidence_excerpt",
      "collected_at",
    ]) {
      if (e[req] === undefined || e[req] === null || e[req] === "") {
        errors.push(`${tag} missing required field: ${req}`);
      }
    }

    if (typeof e.view_count_at_collection !== "number" || !Number.isFinite(e.view_count_at_collection) || e.view_count_at_collection < 0) {
      errors.push(`${tag} view_count_at_collection must be a non-negative finite number`);
    }

    if (seenIds.has(e.video_id)) errors.push(`${tag} duplicate video_id within dataset`);
    seenIds.add(e.video_id);

    if (seenUrls.has(e.url)) errors.push(`${tag} duplicate url within dataset`);
    seenUrls.add(e.url);

    if (phase1Ids.has(e.video_id)) errors.push(`${tag} overlaps with Phase 1 83-video dataset`);
    if (otherSplitIds.has(e.video_id)) errors.push(`${tag} overlaps with other Phase 2 split`);

    if (!VALID_GENRES.includes(e.genre)) {
      errors.push(`${tag} invalid genre: ${e.genre}`);
    }
    if (!VALID_STRATA.includes(e.stratum)) {
      errors.push(`${tag} invalid stratum: ${e.stratum}`);
    }

    const expectedStratum = RULE_TO_STRATUM[e.label_rule_id];
    if (!expectedStratum) {
      errors.push(`${tag} invalid label_rule_id: ${e.label_rule_id}`);
    } else if (expectedStratum !== e.stratum) {
      errors.push(`${tag} label_rule_id ${e.label_rule_id} does not match stratum ${e.stratum}`);
    }

    // Mutual exclusion check
    if (e.matches_r_pro === true && e.matches_r_low === true) {
      errors.push(`${tag} violates mutual exclusion (matches both R-PRO-* and R-LOW-*)`);
    }

    // Strict corporate R-PRO rule
    if (e.stratum === "non_tier2_pro" && e.genre === "企業映像") {
      if (!["R-PRO-01", "R-PRO-03", "R-PRO-04"].includes(e.label_rule_id)) {
        errors.push(`${tag} corporate R-PRO video must use R-PRO-01, R-PRO-03, or R-PRO-04`);
      }
      if (!e.production_credit_or_broadcast_verified) {
        errors.push(`${tag} corporate R-PRO video must explicitly verify production_credit_or_broadcast_verified=true`);
      }
    }

    // Local OCR precheck requirement (strict for holdout)
    if (mode === "holdout" && e.award_badge_ocr_hit !== false) {
      errors.push(`${tag} award_badge_ocr_hit must be explicitly false (verified via local OCR)`);
    }
  }

  // Quota & numeric anti-fame checks for Holdout
  const byGenreStratum = {};
  for (const g of VALID_GENRES) {
    byGenreStratum[g] = { tier2_award: 0, non_tier2_pro: 0, non_tier2_low: 0 };
  }
  for (const e of entries) {
    if (byGenreStratum[e.genre] && byGenreStratum[e.genre][e.stratum] !== undefined) {
      byGenreStratum[e.genre][e.stratum]++;
    }
  }

  const tier2 = entries.filter((e) => e.stratum === "tier2_award");
  const pro = entries.filter((e) => e.stratum === "non_tier2_pro");
  const low = entries.filter((e) => e.stratum === "non_tier2_low");

  const lowExposureRecentTier2 = tier2.filter((e) => {
    const yr = Number(e.award_year || e.published_year);
    const inYear = yr >= 2022 && yr <= 2026;
    const viewLimit = e.platform === "vimeo" ? 100000 : 500000;
    return inYear && typeof e.view_count_at_collection === "number" && e.view_count_at_collection < viewLimit;
  });
  const megaHitTier2 = tier2.filter(
    (e) => typeof e.view_count_at_collection === "number" && e.view_count_at_collection >= 10000000
  );
  const low04Only = low.filter((e) => e.label_rule_id === "R-LOW-04");

  if (mode === "holdout") {
    for (const g of VALID_GENRES) {
      const c = byGenreStratum[g];
      const minT2 = g === "企業映像" ? 3 : 5;
      if (c.tier2_award < minT2) errors.push(`Holdout quota: ${g} tier2_award=${c.tier2_award} < ${minT2}`);
      if (c.non_tier2_pro !== 5) errors.push(`Holdout quota: ${g} non_tier2_pro=${c.non_tier2_pro} !== 5`);
      if (c.non_tier2_low !== 5) errors.push(`Holdout quota: ${g} non_tier2_low=${c.non_tier2_low} !== 5`);
    }

    const reqLowExp = Math.ceil(0.6 * tier2.length);
    if (lowExposureRecentTier2.length < reqLowExp) {
      errors.push(
        `Anti-fame rule: Tier 2 recent+low-exposure count=${lowExposureRecentTier2.length} < required ceil(0.60*${tier2.length})=${reqLowExp}`
      );
    }
    if (megaHitTier2.length > 2) {
      errors.push(`Anti-fame rule: Tier 2 >=10M views count=${megaHitTier2.length} > max 2`);
    }
    if (low04Only.length > 5) {
      errors.push(`Watermark cap: R-LOW-04-only count=${low04Only.length} > max 5`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      total: entries.length,
      tier2_count: tier2.length,
      pro_count: pro.length,
      low_count: low.length,
      by_genre_stratum: byGenreStratum,
      tier2_recent_low_exposure_count: lowExposureRecentTier2.length,
      tier2_mega_hit_count: megaHitTier2.length,
      r_low_04_only_count: low04Only.length,
    },
  };
}

// CLI execution
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf("--file");
  const modeIdx = args.indexOf("--mode");
  const otherIdx = args.indexOf("--other-split");

  if (fileIdx === -1 || !args[fileIdx + 1]) {
    console.error("Usage: node scripts/validate-phase2-dataset.mjs --file <path.json> [--mode holdout|dev_additions] [--other-split <path.json>]");
    process.exit(2);
  }

  const filePath = path.resolve(args[fileIdx + 1]);
  const mode = modeIdx !== -1 ? args[modeIdx + 1] : "holdout";
  const gbPath = path.resolve("E:\\iketeru-eizou\\analysis\\golden_benchmark.json");
  const gb = JSON.parse(fs.readFileSync(gbPath, "utf8"));
  const phase1Ids = new Set(gb.map((v) => v.id));

  const otherSplitIds = new Set();
  if (otherIdx !== -1 && args[otherIdx + 1]) {
    const other = JSON.parse(fs.readFileSync(path.resolve(args[otherIdx + 1]), "utf8"));
    for (const v of other) otherSplitIds.add(v.video_id || v.id);
  }

  const entries = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const result = validatePhase2Dataset(entries, { mode, phase1Ids, otherSplitIds });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.valid ? 0 : 1);
}
