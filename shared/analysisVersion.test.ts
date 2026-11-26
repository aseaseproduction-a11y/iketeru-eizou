import { describe, expect, it } from "vitest";
import {
  isLegacyAnalysisVersion,
  isV3AnalysisVersion,
  LEGACY_ANALYSIS_LABEL,
  normalizeAnalysisVersion,
  V3_ANALYSIS_LABEL,
} from "./analysisVersion";

describe("analysisVersion helpers", () => {
  it("normalizes unknown/null/legacy values to 'legacy' and preserves 'v3'", () => {
    expect(normalizeAnalysisVersion("v3")).toBe("v3");
    expect(normalizeAnalysisVersion("legacy")).toBe("legacy");
    expect(normalizeAnalysisVersion(null)).toBe("legacy");
    expect(normalizeAnalysisVersion(undefined)).toBe("legacy");
    expect(normalizeAnalysisVersion("")).toBe("legacy");
  });

  it("classifies legacy vs v3 cleanly and exports canonical UI labels", () => {
    expect(isLegacyAnalysisVersion("legacy")).toBe(true);
    expect(isLegacyAnalysisVersion(null)).toBe(true);
    expect(isLegacyAnalysisVersion(undefined)).toBe(true);
    expect(isLegacyAnalysisVersion("v3")).toBe(false);

    expect(isV3AnalysisVersion("v3")).toBe(true);
    expect(isV3AnalysisVersion("legacy")).toBe(false);
    expect(isV3AnalysisVersion(null)).toBe(false);

    expect(LEGACY_ANALYSIS_LABEL).toBe("旧分析・時刻は目安");
    expect(V3_ANALYSIS_LABEL).toBe("分析 v3");
  });
});
