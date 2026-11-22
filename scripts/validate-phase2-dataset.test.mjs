import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validatePhase2Dataset, VALID_GENRES } from "./validate-phase2-dataset.mjs";

function makeValidHoldout(corporateTier2Count = 5) {
  const entries = [];
  let idx = 0;
  for (const genre of VALID_GENRES) {
    const t2Count = genre === "企業映像" ? corporateTier2Count : 5;
    const t2Rule = {
      CM: "R-T2-01",
      MV: "R-T2-02",
      モーション: "R-T2-03",
      "3DCG/アニメ": "R-T2-04",
      企業映像: "R-T2-05",
    }[genre];

    for (let i = 0; i < t2Count; i++) {
      idx++;
      entries.push({
        video_id: `t2_${idx}`,
        url: `https://example.com/t2_${idx}`,
        platform: "youtube",
        genre,
        published_year: 2024,
        stratum: "tier2_award",
        label_rule_id: t2Rule,
        evidence_url: `https://awards.example.com/winners/2024/entry-${idx}`,
        evidence_excerpt: "Shortlist Film Craft 2024",
        view_count_at_collection: 50000,
        collected_at: "2026-11-23T00:00:00Z",
        verified_by_script: "scripts/verify-phase2-sources.mjs",
        verified_at: "2026-11-23T01:00:00Z",
        award_badge_ocr_hit: false,
      });
    }
    for (let i = 0; i < 5; i++) {
      idx++;
      const rule = genre === "MV" ? "R-PRO-02" : "R-PRO-01";
      entries.push({
        video_id: `pro_${idx}`,
        url: `https://example.com/pro_${idx}`,
        platform: "youtube",
        genre,
        published_year: 2024,
        stratum: "non_tier2_pro",
        label_rule_id: rule,
        production_credit_or_broadcast_verified: genre === "企業映像" ? true : undefined,
        evidence_url: `https://official.example.com/watch?v=pro_${idx}`,
        evidence_excerpt: "Production: Example Studio Inc.",
        view_count_at_collection: 120000,
        collected_at: "2026-11-23T00:00:00Z",
        verified_by_script: "scripts/verify-phase2-sources.mjs",
        verified_at: "2026-11-23T01:00:00Z",
        award_badge_ocr_hit: false,
      });
    }
    for (let i = 0; i < 5; i++) {
      idx++;
      entries.push({
        video_id: `low_${idx}`,
        url: `https://example.com/low_${idx}`,
        platform: "youtube",
        genre,
        published_year: 2024,
        stratum: "non_tier2_low",
        label_rule_id: i === 0 ? "R-LOW-04" : "R-LOW-01",
        evidence_url: `https://youtube.com/watch?v=low_${idx}`,
        evidence_excerpt: i === 0 ? "Made with Clipchamp" : "初めて作った練習動画",
        view_count_at_collection: 300,
        collected_at: "2026-11-23T00:00:00Z",
        verified_by_script: "scripts/verify-phase2-sources.mjs",
        verified_at: "2026-11-23T01:00:00Z",
        award_badge_ocr_hit: false,
      });
    }
  }
  return entries;
}

describe("validatePhase2Dataset", () => {
  it("accepts a valid 75-video Holdout (5 per genre per stratum)", () => {
    const res = validatePhase2Dataset(makeValidHoldout(5), { mode: "holdout" });
    assert.equal(res.valid, true, JSON.stringify(res.errors));
    assert.equal(res.stats.total, 75);
  });

  it("accepts a valid 73-video Holdout (corporate Tier 2 = 3 lower bound)", () => {
    const res = validatePhase2Dataset(makeValidHoldout(3), { mode: "holdout" });
    assert.equal(res.valid, true, JSON.stringify(res.errors));
    assert.equal(res.stats.tier2_count, 23);
  });

  it("rejects Phase 1 overlap, mutual exclusion, unverified corporate R-PRO, OCR hit, and R-LOW-04 > 5", () => {
    const entries = makeValidHoldout(5);
    // 1. Phase 1 overlap
    entries[0].video_id = "V6XHz7tqGVM";
    // 2. Mutual exclusion violation
    entries[5].matches_r_pro = true;
    entries[5].matches_r_low = true;
    // 3. Corporate R-PRO missing credit verification
    const corpPro = entries.find((e) => e.genre === "企業映像" && e.stratum === "non_tier2_pro");
    corpPro.production_credit_or_broadcast_verified = false;
    // 4. OCR hit true
    entries[1].award_badge_ocr_hit = true;
    // 5. R-LOW-04 cap exceeded (6 videos)
    const extraLow = entries.find((e) => e.stratum === "non_tier2_low" && e.label_rule_id !== "R-LOW-04");
    extraLow.label_rule_id = "R-LOW-04";

    const res = validatePhase2Dataset(entries, {
      mode: "holdout",
      phase1Ids: new Set(["V6XHz7tqGVM"]),
    });
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("Phase 1")));
    assert.ok(res.errors.some((e) => e.includes("mutual exclusion")));
    assert.ok(res.errors.some((e) => e.includes("production_credit_or_broadcast_verified")));
    assert.ok(res.errors.some((e) => e.includes("award_badge_ocr_hit")));
    assert.ok(res.errors.some((e) => e.includes("R-LOW-04-only")));
  });

  it("rejects bare homepage evidence_url, missing verified_by_script/verified_at, and >150-char Tier 2 excerpt", () => {
    const entries = makeValidHoldout(5);
    entries[0].evidence_url = "https://www.canneslions.com/";
    entries[1].verified_by_script = "";
    entries[1].verified_at = "";
    entries[2].evidence_excerpt = "x".repeat(151);

    const res = validatePhase2Dataset(entries, { mode: "holdout" });
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("bare homepage")));
    assert.ok(res.errors.some((e) => e.includes("verified_by_script")));
    assert.ok(res.errors.some((e) => e.includes("verified_at")));
    assert.ok(res.errors.some((e) => e.includes("<= 150 chars")));
  });

  it("accepts a 70-video Holdout (N_T2=20) when corporateTier2Unverified is enabled, and rejects self_reported Tier 2", () => {
    const entries = makeValidHoldout(0);
    const res = validatePhase2Dataset(entries, { mode: "holdout", corporateTier2Unverified: true });
    assert.equal(res.valid, true, JSON.stringify(res.errors));
    assert.equal(res.stats.tier2_count, 20);
    assert.equal(res.stats.total, 70);
    assert.ok(res.warnings.some((w) => w.includes("N_T2=20")));

    entries[0].source_tier = "self_reported";
    const resSelf = validatePhase2Dataset(entries, { mode: "holdout", corporateTier2Unverified: true });
    assert.equal(resSelf.valid, false);
    assert.ok(resSelf.errors.some((e) => e.includes("self_reported")));
  });
});
