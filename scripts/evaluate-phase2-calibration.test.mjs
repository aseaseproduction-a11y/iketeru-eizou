import test from "node:test";
import assert from "node:assert/strict";
import { pairwiseAuc, mannWhitneyOneSidedP, evaluatePhase2Scores } from "./evaluate-phase2-calibration.mjs";

test("pairwiseAuc and mannWhitneyOneSidedP calculate exact metrics", () => {
  assert.equal(pairwiseAuc([90, 85], [70, 65]), 1.0);
  assert.equal(pairwiseAuc([80, 70], [80, 60]), 0.625);
  const p = mannWhitneyOneSidedP([75, 74, 73, 72, 71, 70, 69, 68], [50, 49, 48, 47, 46, 45, 44, 43]);
  assert.ok(p < 0.001, `Expected p < 0.001, got ${p}`);
});

test("evaluatePhase2Scores produces GO on clean separation and NO-GO when primary fails", () => {
  const mk = (stratum, genre, score, rule) => ({ stratum, genre, score, label_rule_id: rule });
  const records = [
    // 24 Tier 2 (all >= 80)
    ...Array.from({ length: 24 }, (_, i) => mk("tier2_award", i < 20 ? "CM" : "企業映像", 82 + (i % 14), "R-T2-01")),
    // 25 R-PRO (22 < 78, 3 >= 78 -> specificity 22/25 = 88% >= 84%)
    ...Array.from({ length: 25 }, (_, i) => mk("non_tier2_pro", i < 20 ? "CM" : "企業映像", i < 22 ? 66 + (i % 10) : 79, "R-PRO-04")),
    // 25 R-LOW (all 40..58, 0 >= 78)
    ...Array.from({ length: 25 }, (_, i) => mk("non_tier2_low", "CM", 42 + (i % 15), i < 2 ? "R-LOW-04" : "R-LOW-01")),
  ];
  const res = evaluatePhase2Scores(records, { tAward: 78.0, tLow: 63.0, bootstrapB: 200 });
  assert.equal(res.decision, "GO");
  assert.equal(res.primary.all_primary_pass, true);
  assert.equal(res.primary.p2_min_required, 20);
  assert.equal(res.primary.p3_min_required, 21);
  assert.equal(res.secondary_all_low.s1_pass, true);
  assert.equal(res.secondary_excl_r_low_04.n_low, 23);

  // Drop 1 Tier 2 below T_low -> P-4 fails -> NO-GO
  records[0].score = 60;
  const resFail = evaluatePhase2Scores(records, { tAward: 78.0, tLow: 63.0, bootstrapB: 50 });
  assert.equal(resFail.primary.p4_pass, false);
  assert.equal(resFail.decision, "NO-GO");
});
