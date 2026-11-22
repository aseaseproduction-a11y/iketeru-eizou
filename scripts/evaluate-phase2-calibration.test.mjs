import test from "node:test";
import assert from "node:assert/strict";
import {
  pairwiseAuc,
  mannWhitneyOneSidedP,
  evaluatePhase2Scores,
  selectFrozenThresholds,
} from "./evaluate-phase2-calibration.mjs";

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

test("selectFrozenThresholds picks upper-median of longest contiguous max-Youden-J GO run independent of input order", () => {
  // Odd-length T_award run [78, 79, 80] -> median 79
  // Even-length T_low run [60, 61, 62, 63] -> upper median 62 (higher of 61, 62)
  const rows = [];
  for (const tAward of [76, 77, 78, 79, 80, 81, 82]) {
    for (const tLow of [59, 60, 61, 62, 63, 64]) {
      const isGo = tAward >= 77 && tAward <= 81 && tLow >= 60 && tLow <= 63;
      const isMaxJ = tAward >= 78 && tAward <= 80 && tLow >= 60 && tLow <= 63;
      rows.push({
        t_award: tAward,
        t_low: tLow,
        decision: isGo ? "GO" : "NO-GO",
        p1_auc: 0.96,
        youden_j: isMaxJ ? 0.85 : isGo ? 0.8 : 0.6,
      });
    }
  }
  const resForward = selectFrozenThresholds(rows);
  const resReversed = selectFrozenThresholds([...rows].reverse());

  assert.equal(resForward.selected.t_award, 79);
  assert.equal(resForward.selected.t_low, 62);
  assert.deepEqual(resForward.selected, resReversed.selected);
  assert.deepEqual(resForward.best_t_award_run, [78, 79, 80]);
  assert.deepEqual(resForward.best_t_low_run, [60, 61, 62, 63]);
  assert.equal(resForward.pass_range.t_award_go_min, 77);
  assert.equal(resForward.pass_range.t_award_go_max, 81);
  assert.equal(resForward.pass_range.t_low_go_min, 60);
  assert.equal(resForward.pass_range.t_low_go_max, 63);

  // Even-length T_award run [78, 79, 80, 81] -> upper median 80 (higher of 79, 80)
  // Odd-length T_low run [61, 62, 63] -> exact center 62
  const evenRows = [];
  for (const tAward of [78, 79, 80, 81]) {
    for (const tLow of [61, 62, 63]) {
      evenRows.push({ t_award: tAward, t_low: tLow, decision: "GO", p1_auc: 0.95, youden_j: 0.88 });
    }
  }
  const resEven = selectFrozenThresholds(evenRows);
  assert.equal(resEven.selected.t_award, 80);
  assert.equal(resEven.selected.t_low, 62);

  // Disjoint runs: picks longest contiguous run ([79, 80, 81] over [76])
  const disjointRows = [
    { t_award: 76, t_low: 62, decision: "GO", p1_auc: 0.95, youden_j: 0.9 },
    { t_award: 79, t_low: 62, decision: "GO", p1_auc: 0.95, youden_j: 0.9 },
    { t_award: 80, t_low: 62, decision: "GO", p1_auc: 0.95, youden_j: 0.9 },
    { t_award: 81, t_low: 62, decision: "GO", p1_auc: 0.95, youden_j: 0.9 },
  ];
  const resDisjoint = selectFrozenThresholds(disjointRows);
  assert.equal(resDisjoint.selected.t_award, 80);
  assert.equal(resDisjoint.selected.t_low, 62);

  // No GO candidate -> null
  const resNone = selectFrozenThresholds([{ t_award: 78, t_low: 63, decision: "NO-GO", p1_auc: 0.8, youden_j: 0.5 }]);
  assert.equal(resNone.selected, null);
  assert.equal(resNone.reason, "NO_GO_CANDIDATE");
});
