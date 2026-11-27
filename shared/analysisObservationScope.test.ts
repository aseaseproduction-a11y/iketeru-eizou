import { describe, expect, it } from "vitest";
import {
  getAnalysisObservationScopeWarning,
  isUnwatchedAnalysisScope,
  KNOWN_UNWATCHED_OBSERVATION_SCOPES,
} from "./analysisObservationScope";

describe("analysisObservationScope warning mapping", () => {
  it("returns null for null, undefined, and empty strings", () => {
    expect(getAnalysisObservationScopeWarning(null)).toBeNull();
    expect(getAnalysisObservationScopeWarning(undefined)).toBeNull();
    expect(getAnalysisObservationScopeWarning("")).toBeNull();
    expect(getAnalysisObservationScopeWarning("   ")).toBeNull();
    expect(isUnwatchedAnalysisScope(null)).toBe(false);
    expect(isUnwatchedAnalysisScope("")).toBe(false);
  });

  it("returns distinct labels and descriptions for each known scope", () => {
    const warnings = KNOWN_UNWATCHED_OBSERVATION_SCOPES.map((scope) =>
      getAnalysisObservationScopeWarning(scope),
    );
    expect(warnings.every((w) => w !== null && w.isKnown)).toBe(true);

    const badgeLabels = new Set(warnings.map((w) => w!.badgeLabel));
    const titles = new Set(warnings.map((w) => w!.title));
    const descriptions = new Set(warnings.map((w) => w!.description));
    expect(badgeLabels.size).toBe(KNOWN_UNWATCHED_OBSERVATION_SCOPES.length);
    expect(titles.size).toBe(KNOWN_UNWATCHED_OBSERVATION_SCOPES.length);
    expect(descriptions.size).toBe(KNOWN_UNWATCHED_OBSERVATION_SCOPES.length);

    expect(getAnalysisObservationScopeWarning("metadata_only_unwatched")).toMatchObject({
      scope: "metadata_only_unwatched",
      severity: "high",
      badgeLabel: "未視聴・メタデータのみ",
      title: "未視聴分析（メタデータのみ）",
    });
    expect(getAnalysisObservationScopeWarning("triage_boilerplate_unwatched")).toMatchObject({
      scope: "triage_boilerplate_unwatched",
      severity: "high",
      badgeLabel: "未視聴・定型速報",
      title: "未視聴分析（定型速報のみ）",
    });
    expect(getAnalysisObservationScopeWarning("triage_unverified_short")).toMatchObject({
      scope: "triage_unverified_short",
      severity: "medium",
      badgeLabel: "要確認・実測なし",
      title: "要確認（短文速報・実測なし）",
    });
    expect(getAnalysisObservationScopeWarning("missing_video_unwatched")).toMatchObject({
      scope: "missing_video_unwatched",
      severity: "high",
      badgeLabel: "未視聴・動画未取得",
      title: "未視聴分析（動画未取得）",
    });
  });

  it("falls back safely for unknown non-empty scope strings", () => {
    const warning = getAnalysisObservationScopeWarning("custom_future_scope");
    expect(warning).not.toBeNull();
    expect(warning?.isKnown).toBe(false);
    expect(warning?.scope).toBe("custom_future_scope");
    expect(warning?.title).toContain("custom_future_scope");
    expect(warning?.description).toContain("custom_future_scope");
  });

  it("includes calibrated score note only when hasCalibratedScore is true", () => {
    const withoutCal = getAnalysisObservationScopeWarning("metadata_only_unwatched");
    const withCal = getAnalysisObservationScopeWarning("metadata_only_unwatched", {
      hasCalibratedScore: true,
    });
    expect(withoutCal?.calibratedScoreNote).toBeNull();
    expect(withCal?.calibratedScoreNote).toContain("校正済みスコア");
  });
});
