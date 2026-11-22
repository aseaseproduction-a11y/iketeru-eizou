import test from "node:test";
import assert from "node:assert/strict";
import { decidePhase1Route, decideEscalation, computeHybridScore } from "./phase2-hybrid-router.mjs";

test("H1 routes MV, Motion, and high-cut (>=12/10s even when silent) directly to video", () => {
  assert.equal(decidePhase1Route({ genre: "MV", max_cuts_per_10s: 2 }).route, "video");
  assert.equal(decidePhase1Route({ genre: "モーション", max_cuts_per_10s: 1 }).route, "video");
  const silentFast = decidePhase1Route({ genre: "CM", max_cuts_per_10s: 12, integrated_lufs: null });
  assert.equal(silentFast.route, "video");
  assert.match(silentFast.triggers[0], /^H1-c/);

  const normalCm = decidePhase1Route({ genre: "CM", max_cuts_per_10s: 11, integrated_lufs: -14.0 });
  assert.equal(normalCm.route, "contact_sheet");
  assert.equal(normalCm.triggers.length, 0);
});

test("H2 escalates boundary +/-3.0, static >=60s long videos, and null/<=-28 LUFS when cs >= T_low", () => {
  const base = { genre: "CM", duration_sec: 30, total_cuts: 10, avg_cut_interval_sec: 3.0, integrated_lufs: -16.0 };

  assert.equal(decideEscalation(base, 75.0, { tAward: 78.0, tLow: 63.0 }).escalate, true);
  assert.equal(decideEscalation(base, 81.0, { tAward: 78.0, tLow: 63.0 }).escalate, true);
  assert.equal(decideEscalation(base, 81.5, { tAward: 78.0, tLow: 63.0 }).escalate, false);
  assert.equal(decideEscalation(base, 66.0, { tAward: 78.0, tLow: 63.0 }).escalate, true);
  assert.equal(decideEscalation(base, 59.5, { tAward: 78.0, tLow: 63.0 }).escalate, false);

  // H2-b static long video
  const staticLong = { genre: "企業映像", duration_sec: 90, total_cuts: 2, avg_cut_interval_sec: 45, integrated_lufs: -16.0 };
  assert.equal(decideEscalation(staticLong, 70.0, { tAward: 78.0, tLow: 63.0 }).escalate, true);
  assert.equal(decideEscalation(staticLong, 55.0, { tAward: 78.0, tLow: 63.0 }).escalate, false); // below T_low

  // H2-c null or <= -28 LUFS
  const silent = { genre: "3DCG/アニメ", duration_sec: 30, total_cuts: 8, avg_cut_interval_sec: 3.75, integrated_lufs: null };
  assert.equal(decideEscalation(silent, 72.0, { tAward: 78.0, tLow: 63.0 }).escalate, true);
  const veryQuiet = { ...silent, integrated_lufs: -28.0 };
  assert.equal(decideEscalation(veryQuiet, 72.0, { tAward: 78.0, tLow: 63.0 }).escalate, true);
  const okAudio = { ...silent, integrated_lufs: -27.9 };
  assert.equal(decideEscalation(okAudio, 72.0, { tAward: 78.0, tLow: 63.0 }).escalate, false);
});

test("computeHybridScore returns deterministic final_score and modes_executed", () => {
  const cm = { genre: "CM", duration_sec: 30, max_cuts_per_10s: 5, total_cuts: 10, avg_cut_interval_sec: 3.0, integrated_lufs: -15.0 };
  const stayCs = computeHybridScore(cm, { videoScore: 95, contactSheetScore: 92, tAward: 78, tLow: 63 });
  assert.equal(stayCs.final_mode, "contact_sheet");
  assert.equal(stayCs.final_score, 92);
  assert.deepEqual(stayCs.modes_executed, ["contact_sheet"]);

  const esc = computeHybridScore(cm, { videoScore: 76, contactSheetScore: 79, tAward: 78, tLow: 63 });
  assert.equal(esc.final_mode, "video_h2_escalated");
  assert.equal(esc.final_score, 76);
  assert.deepEqual(esc.modes_executed, ["contact_sheet", "video"]);
});
