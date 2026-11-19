/**
 * 15-level rating (S+..D-) <-> 0..100 score scale & 5x20 rubric definitions.
 * Single source of truth shared across backend, frontend, scripts, and iketeru-creative-studio.
 */

export const RATING_GRADES = [
  "S+", "S", "S-",
  "A+", "A", "A-",
  "B+", "B", "B-",
  "C+", "C", "C-",
  "D+", "D", "D-",
] as const;

export type RatingGrade = (typeof RATING_GRADES)[number];

export interface RatingBand {
  grade: RatingGrade;
  min: number;
  max: number;
  midpoint: number;
}

/**
 * 100点満点と15段階ランクの厳密な対応テーブル。
 * 既存キュレーション作品（A-〜S帯）の解像度を高めるため、上位帯を3〜4点刻みで設計。
 */
export const RATING_BANDS: readonly RatingBand[] = [
  { grade: "S+", min: 97, max: 100, midpoint: 98 },
  { grade: "S",  min: 93, max: 96,  midpoint: 94 },
  { grade: "S-", min: 90, max: 92,  midpoint: 91 },
  { grade: "A+", min: 86, max: 89,  midpoint: 87 },
  { grade: "A",  min: 82, max: 85,  midpoint: 83 },
  { grade: "A-", min: 78, max: 81,  midpoint: 79 },
  { grade: "B+", min: 73, max: 77,  midpoint: 75 },
  { grade: "B",  min: 68, max: 72,  midpoint: 70 },
  { grade: "B-", min: 63, max: 67,  midpoint: 65 },
  { grade: "C+", min: 57, max: 62,  midpoint: 60 },
  { grade: "C",  min: 51, max: 56,  midpoint: 53 },
  { grade: "C-", min: 45, max: 50,  midpoint: 47 },
  { grade: "D+", min: 35, max: 44,  midpoint: 40 },
  { grade: "D",  min: 20, max: 34,  midpoint: 27 },
  { grade: "D-", min: 0,  max: 19,  midpoint: 10 },
] as const;

const BAND_BY_GRADE = new Map<string, RatingBand>(
  RATING_BANDS.map((band) => [band.grade, band]),
);

export interface DirectionRubric {
  hookAndStructure: number;   // 冒頭フック・構成力 (0..20)
  originality: number;        // 演出アイデア独自性 (0..20)
  rhythmAndSync: number;      // テンポ・リズム・音ハメ (0..20)
  worldAndSubject: number;    // 被写体・世界観の説得力 (0..20)
  intentAchievement: number;  // 企画意図の到達度 (0..20)
}

export interface TechniqueRubric {
  cinematographyAndArt: number; // 撮影・照明・作画 (0..20)
  editingAndMotion: number;     // 編集・モーション精度 (0..20)
  colorAndLook: number;         // カラグレ・ルック・美術 (0..20)
  soundAndMix: number;          // 音響・MA・ミックス (0..20)
  polishAndFinish: number;      // 仕上げ・完成度 (0..20)
}

export interface AiScoreBreakdown {
  source: "rubric" | "backfill_from_analysis" | "manual";
  version?: string;
  direction?: Partial<DirectionRubric>;
  technique?: Partial<TechniqueRubric>;
  synergyAdjustment?: number; // -5..+5 企画突破力・独自性・目的到達度による補正
  rationale?: string;
}

export const DIRECTION_RUBRIC_LABELS: Record<keyof DirectionRubric, string> = {
  hookAndStructure: "冒頭フック・構成力",
  originality: "演出アイデア独自性",
  rhythmAndSync: "テンポ・リズム・音ハメ",
  worldAndSubject: "被写体・世界観の説得力",
  intentAchievement: "企画意図の到達度",
};

export const TECHNIQUE_RUBRIC_LABELS: Record<keyof TechniqueRubric, string> = {
  cinematographyAndArt: "撮影・照明・作画",
  editingAndMotion: "編集・モーション精度",
  colorAndLook: "カラグレ・ルック・美術",
  soundAndMix: "音響・MA・ミックス",
  polishAndFinish: "仕上げ・完成度",
};

export function clampScore100(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, Math.round(num)));
}

export function scoreToRating(score: number): RatingGrade {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  for (const band of RATING_BANDS) {
    if (clamped >= band.min && clamped <= band.max) {
      return band.grade;
    }
  }
  return "D-";
}

export function ratingToScoreBand(grade: string | null | undefined): RatingBand | null {
  if (!grade) return null;
  return BAND_BY_GRADE.get(grade.trim()) ?? null;
}

export function isScoreConsistentWithRating(score: number, grade: string | null | undefined): boolean {
  const band = ratingToScoreBand(grade);
  if (!band) return false;
  return score >= band.min && score <= band.max;
}

export function sumRubricScores(rubric: Record<string, unknown> | null | undefined): number | null {
  if (!rubric || typeof rubric !== "object") return null;
  const values = Object.values(rubric).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (values.length !== 5) return null;
  const total = values.reduce((acc, v) => acc + Math.max(0, Math.min(20, Math.round(v))), 0);
  return clampScore100(total);
}

/**
 * 既存ランク据え置きを許容しつつ、スコアとランクを解決する。
 * - preserveExistingRating=false（新規分析）: score を正とし、scoreToRating(score) でランクを自動決定。
 * - preserveExistingRating=true（手動編集/既存維持）: 既存ランクがあれば維持、空なら score から自動決定。
 */
export function resolveRatingPair(params: {
  rating?: string | null;
  score?: number | null;
  preserveExistingRating?: boolean;
}): { rating: string; score: number | null } {
  const score = clampScore100(params.score);
  const rawRating = (params.rating ?? "").trim();
  if (score === null) {
    return { rating: rawRating, score: null };
  }
  if (params.preserveExistingRating && rawRating) {
    return { rating: rawRating, score };
  }
  return { rating: scoreToRating(score), score };
}

/**
 * 総合点（0..100）の算出ルール:
 *   基準値 = round(演出点 * 0.55 + 技術点 * 0.45)
 *   シナジー／突破力補正 = -5 .. +5（0以外のときは rationale 記載を推奨）
 */
export function computeOverallScore(params: {
  directionScore: number;
  techniqueScore: number;
  synergyAdjustment?: number;
}): number {
  const dir = Math.max(0, Math.min(100, Math.round(params.directionScore)));
  const tech = Math.max(0, Math.min(100, Math.round(params.techniqueScore)));
  const adj = Math.max(-5, Math.min(5, Math.round(params.synergyAdjustment ?? 0)));
  const base = Math.round(dir * 0.55 + tech * 0.45);
  return Math.max(0, Math.min(100, base + adj));
}

/**
 * ソート用の実効100点スコア。
 * 100点スコアが付与済みならその値、未付与の既存動画は15段階ランクの中央値へフォールバック。
 */
export function getEffectiveScore100(
  score: number | null | undefined,
  rating: string | null | undefined,
): number {
  if (typeof score === "number" && Number.isFinite(score)) {
    return Math.max(0, Math.min(100, Math.round(score)));
  }
  return ratingToScoreBand(rating)?.midpoint ?? -1;
}
