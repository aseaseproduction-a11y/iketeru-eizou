/**
 * Shared analysis version helpers aligned with chibatmute's v3 write procedure
 * and PILOT_V3_REPORT.md Ch. 5.
 *
 * Canonical values:
 *  - "legacy": pre-v3 analyses (timestamps are approximate; display "旧分析・時刻は目安")
 *  - "v3":     real-video + scdet verified analyses (v3 vs v3.1 distinguished via analysisPromptSha256)
 */

export type AnalysisVersion = "legacy" | "v3";

export const LEGACY_ANALYSIS_LABEL = "旧分析・時刻は目安";
export const V3_ANALYSIS_LABEL = "v3 実測照合済";

export function normalizeAnalysisVersion(value: unknown): AnalysisVersion {
  return value === "v3" ? "v3" : "legacy";
}

export function isLegacyAnalysisVersion(version: string | null | undefined): boolean {
  return normalizeAnalysisVersion(version) !== "v3";
}

export function isV3AnalysisVersion(version: string | null | undefined): boolean {
  return normalizeAnalysisVersion(version) === "v3";
}
