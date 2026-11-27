/**
 * Shared 5-axis calibrated score definitions and parsers.
 *
 * Axes (20 points each, sum = 100):
 *  - direction:          演出
 *  - visual_craft:       映像の技術
 *  - editing_rhythm:     編集・リズム
 *  - sound_integration:  音
 *  - originality_finish: 独創性・仕上げ
 */

export const CALIBRATED_AXIS_KEYS = [
  "direction",
  "visual_craft",
  "editing_rhythm",
  "sound_integration",
  "originality_finish",
] as const;

export type CalibratedAxisKey = (typeof CALIBRATED_AXIS_KEYS)[number];

export interface CalibratedAxisDefinition {
  key: CalibratedAxisKey;
  label: string;
  max: number;
}

export const CALIBRATED_AXIS_DEFINITIONS: readonly CalibratedAxisDefinition[] = [
  { key: "direction", label: "演出", max: 20 },
  { key: "visual_craft", label: "映像の技術", max: 20 },
  { key: "editing_rhythm", label: "編集・リズム", max: 20 },
  { key: "sound_integration", label: "音", max: 20 },
  { key: "originality_finish", label: "独創性・仕上げ", max: 20 },
] as const;

export type CalibratedScoreAxesMap = Record<CalibratedAxisKey, number>;

export interface CalibratedScoreAxesPayload {
  v: 1;
  axes: CalibratedScoreAxesMap;
  runs: number;
  source: "phase3" | "api";
  offsetPerAxis: number;
  ensembleRule?: "mean_of_2" | "median_of_3_median_run" | "median_of_3_mean";
}

function roundScore2(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseAxesRecord(raw: unknown): CalibratedScoreAxesMap | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const out = {} as CalibratedScoreAxesMap;
  for (const key of CALIBRATED_AXIS_KEYS) {
    const val = Number(record[key]);
    if (!Number.isFinite(val) || val < 0 || val > 20) return null;
    out[key] = roundScore2(val);
  }
  return out;
}

/**
 * Parse `videos.calibratedScoreAxes` (accepts either a JSON object returned by TiDB/mysql2
 * or a serialized JSON string). Returns null if empty or malformed.
 */
export function parseCalibratedScoreAxes(raw: unknown): CalibratedScoreAxesPayload | null {
  if (raw === null || raw === undefined || raw === "") return null;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const rec = obj as Record<string, unknown>;
  const axes = parseAxesRecord(rec.axes);
  if (!axes) return null;

  const runs = Number(rec.runs);
  const offsetPerAxis = Number(rec.offsetPerAxis ?? 0);
  const source: "phase3" | "api" = rec.source === "api" ? "api" : "phase3";
  const ensembleRule =
    rec.ensembleRule === "mean_of_2" ||
    rec.ensembleRule === "median_of_3_median_run" ||
    rec.ensembleRule === "median_of_3_mean"
      ? rec.ensembleRule
      : undefined;

  return {
    v: 1,
    axes,
    runs: Number.isFinite(runs) && runs > 0 ? Math.round(runs) : 2,
    source,
    offsetPerAxis: Number.isFinite(offsetPerAxis) ? roundScore2(offsetPerAxis) : 0,
    ...(ensembleRule ? { ensembleRule } : {}),
  };
}

/**
 * Resolve 5-axis scores for display:
 *  1. Prefer `calibratedScoreAxes` (canonical new column once DDL + backfill are applied).
 *  2. Fall back to `calibratedBreakdown.dimensions` when `calibratedScoreAxes` is not yet populated.
 */
export function resolveCalibratedScoreAxes(params: {
  calibratedScoreAxes?: CalibratedScoreAxesPayload | null;
  calibratedBreakdown?: Record<string, unknown> | null;
  calibratedRoute?: string | null;
}): CalibratedScoreAxesPayload | null {
  const direct = parseCalibratedScoreAxes(params.calibratedScoreAxes);
  if (direct) return direct;

  const bd = params.calibratedBreakdown;
  if (!bd || typeof bd !== "object") return null;
  const dims = parseAxesRecord((bd as Record<string, unknown>).dimensions);
  if (!dims) return null;

  const rawScores = Array.isArray((bd as Record<string, unknown>).rawScores)
    ? ((bd as Record<string, unknown>).rawScores as unknown[])
    : [];
  const isApi =
    params.calibratedRoute === "gemini_api_youtube_url_v1" ||
    (bd as Record<string, unknown>).route === "gemini_api_youtube_url_v1";

  return {
    v: 1,
    axes: dims,
    runs: rawScores.length > 0 ? rawScores.length : 2,
    source: isApi ? "api" : "phase3",
    offsetPerAxis: isApi ? 0.45 : 0,
  };
}

export function sumCalibratedAxes(axes: CalibratedScoreAxesMap): number {
  return roundScore2(
    CALIBRATED_AXIS_KEYS.reduce((acc, key) => acc + axes[key], 0),
  );
}

export function formatAxisScore(score: number): string {
  if (!Number.isFinite(score)) return "-";
  if (Math.abs(score - Math.round(score)) < 0.005) {
    return String(Math.round(score));
  }
  const oneDecimal = Math.round(score * 10) / 10;
  if (Math.abs(score - oneDecimal) < 0.005) {
    return oneDecimal.toFixed(1);
  }
  return score.toFixed(2);
}
