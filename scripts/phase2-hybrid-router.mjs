/**
 * Phase 2 Deterministic Hybrid Routing Engine (docs/CALIBRATION_PHASE2_DESIGN.md Section 6.2).
 *
 * Stage 1 — Rule H1 (pre-scoring routing to video mode):
 *   - H1-a: genre === "MV"
 *   - H1-b: genre === "モーション"
 *   - H1-c: max_cuts_per_10s >= 12 (regardless of genre or integrated_lufs)
 *
 * Stage 2 — Rule H2 (post-contact-sheet escalation to video mode):
 *   - H2-a: |contact_sheet_score - T_award| <= 3.0 OR |contact_sheet_score - T_low| <= 3.0
 *   - H2-b: duration_sec >= 60.0 AND (avg_cut_interval_sec >= 15.0 OR total_cuts <= 2) AND contact_sheet_score >= T_low
 *   - H2-c: (integrated_lufs === null OR integrated_lufs <= -28.0) AND contact_sheet_score >= T_low
 */

export const HYBRID_DEFAULTS = Object.freeze({
  h1MaxCutsPer10sThreshold: 12,
  h2BoundaryMargin: 3.0,
  h2StaticDurationSec: 60.0,
  h2StaticAvgCutIntervalSec: 15.0,
  h2StaticTotalCutsMax: 2,
  h2LowLufsMax: -28.0,
});

export function decidePhase1Route(item) {
  const triggers = [];
  const genre = item?.genre || item?.genre_bucket || "";
  if (genre === "MV") triggers.push("H1-a:genre=MV");
  if (genre === "モーション") triggers.push("H1-b:genre=モーション");

  const maxCuts10s = Number(item?.max_cuts_per_10s ?? item?.maxCuts10s ?? 0);
  if (Number.isFinite(maxCuts10s) && maxCuts10s >= HYBRID_DEFAULTS.h1MaxCutsPer10sThreshold) {
    triggers.push(`H1-c:max_cuts_per_10s=${maxCuts10s}>=${HYBRID_DEFAULTS.h1MaxCutsPer10sThreshold}`);
  }

  return {
    route: triggers.length > 0 ? "video" : "contact_sheet",
    triggers,
  };
}

export function decideEscalation(item, contactSheetScore, { tAward = 78.0, tLow = 63.0 } = {}) {
  const triggers = [];
  if (typeof contactSheetScore !== "number" || !Number.isFinite(contactSheetScore)) {
    throw new Error("contactSheetScore must be a finite number");
  }

  const margin = HYBRID_DEFAULTS.h2BoundaryMargin;
  if (Math.abs(contactSheetScore - tAward) <= margin) {
    triggers.push(`H2-a:near_t_award(${contactSheetScore} within ${tAward}+/-${margin})`);
  }
  if (Math.abs(contactSheetScore - tLow) <= margin) {
    triggers.push(`H2-a:near_t_low(${contactSheetScore} within ${tLow}+/-${margin})`);
  }

  const dur = Number(item?.duration_sec ?? item?.duration ?? 0);
  const totalCuts = Number(item?.total_cuts ?? item?.totalCuts ?? NaN);
  const avgIntervalRaw = item?.avg_cut_interval_sec ?? item?.avgCutIntervalSec;
  const avgInterval =
    typeof avgIntervalRaw === "number" && Number.isFinite(avgIntervalRaw)
      ? avgIntervalRaw
      : Number.isFinite(totalCuts) && totalCuts > 0 && dur > 0
      ? dur / totalCuts
      : dur;

  if (
    contactSheetScore >= tLow &&
    dur >= HYBRID_DEFAULTS.h2StaticDurationSec &&
    (avgInterval >= HYBRID_DEFAULTS.h2StaticAvgCutIntervalSec ||
      (Number.isFinite(totalCuts) && totalCuts <= HYBRID_DEFAULTS.h2StaticTotalCutsMax))
  ) {
    triggers.push(`H2-b:static_long_video(dur=${dur}s,avgInt=${Math.round(avgInterval * 10) / 10}s,cuts=${totalCuts})`);
  }

  const lufs = item?.integrated_lufs === undefined ? item?.integratedLufs : item.integrated_lufs;
  if (
    contactSheetScore >= tLow &&
    (lufs === null || lufs === undefined || (typeof lufs === "number" && lufs <= HYBRID_DEFAULTS.h2LowLufsMax))
  ) {
    triggers.push(`H2-c:low_or_null_lufs(${lufs})`);
  }

  return {
    escalate: triggers.length > 0,
    triggers,
  };
}

export function computeHybridScore(item, { videoScore, contactSheetScore, tAward = 78.0, tLow = 63.0 } = {}) {
  const h1 = decidePhase1Route(item);
  if (h1.route === "video") {
    return {
      final_score: videoScore,
      final_mode: "video_h1",
      escalated: false,
      h1_triggers: h1.triggers,
      h2_triggers: [],
      modes_executed: ["video"],
    };
  }
  const h2 = decideEscalation(item, contactSheetScore, { tAward, tLow });
  if (h2.escalate) {
    return {
      final_score: videoScore,
      final_mode: "video_h2_escalated",
      escalated: true,
      h1_triggers: [],
      h2_triggers: h2.triggers,
      modes_executed: ["contact_sheet", "video"],
    };
  }
  return {
    final_score: contactSheetScore,
    final_mode: "contact_sheet",
    escalated: false,
    h1_triggers: [],
    h2_triggers: [],
    modes_executed: ["contact_sheet"],
  };
}
