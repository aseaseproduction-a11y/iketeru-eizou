import type { ProductionCredit } from "@shared/productionCredits";
import type { AiScoreBreakdown } from "@shared/ratingScale";
import type { AnalysisVersion } from "@shared/analysisVersion";
import type { CalibratedScoreAxesPayload } from "@shared/calibratedScoreAxes";
import type { AnalysisObservationScope } from "@shared/analysisObservationScope";

export type { AnalysisObservationScope };

/**
 * Video data types and category definitions for イケてる映像コレクション
 * Design: Cinematic Noir — dark base, cinematic red accent, immersive experience
 */

import { DIRECTION_OPTIONS, GENRE_OPTIONS, PRODUCT_OPTIONS, TONE_OPTIONS } from "@shared/metadataOptions";

export interface TagItem {
  name: string;
  slug: string;
}

export interface AwardEntry {
  name: string;
  year: string;
  category: string;
  sourceUrl: string;
}

export interface CurationNote {
  purpose: string;
  background: string;
  evaluation: string;
  clientPitch?: string;
  sourceUrls: string[];
}

export interface MetadataClassificationAudit {
  status: "updated" | "skipped" | "failed";
  confidence?: number;
  evidence?: string;
  reason?: string;
  updatedFields?: string[];
  processedAt: string;
}

export type VideoSource = "vook" | "youtube_search" | "eizo100" | "note" | "vimeo_staff_picks" | "creator_tracking" | "manual" | "award_winners" | "youtube_works_awards_2026" | "alincolony";

export const SOURCE_LABELS: Record<VideoSource, string> = {
  vook: "Vook イケてる映像",
  youtube_search: "YouTube検索（自動キーワード）",
  eizo100: "映像作家100人",
  note: "note 映像系記事",
  vimeo_staff_picks: "Vimeo Staff Picks",
  creator_tracking: "制作者チャンネル追跡",
  manual: "手動追加",
  award_winners: "アワード受賞作",
  youtube_works_awards_2026: "YouTube Works Awards Japan 2026",
  alincolony: "ALINCOLONY よかった映像",
};

export const SOURCE_COLORS: Record<VideoSource, string> = {
  vook: "bg-emerald-600/80",
  youtube_search: "bg-red-600/80",
  eizo100: "bg-violet-600/80",
  note: "bg-green-500/80",
  vimeo_staff_picks: "bg-sky-600/80",
  creator_tracking: "bg-amber-600/80",
  manual: "bg-zinc-600/80",
  award_winners: "bg-yellow-600/80",
  youtube_works_awards_2026: "bg-yellow-700/80",
  alincolony: "bg-teal-600/80",
};

export interface Video {
  id: string;
  platform: "youtube" | "vimeo" | "x" | "tiktok" | "instagram" | "external";
  title: string;
  thumbnail: string;
  videoUrl: string;
  embedUrl: string;
  genres: TagItem[];
  products: TagItem[];
  directions: TagItem[];
  tones: TagItem[];
  allTags: string[];
  purposes: string[];
  expressions: string[];
  toneEmotions: string[];
  toneVisuals: string[];
  toneTechniques: string[];
  productions: string[];
  productionCredits?: ProductionCredit[];
  awards?: AwardEntry[];
  curationNote?: CurationNote;
  metadataClassificationAudit?: MetadataClassificationAudit;
  privateRating: string;
  aiOverallRating: string;
  aiDirectionRating: string;
  aiTechniqueRating: string;
  aiOverallScore?: number | null;
  aiDirectionScore?: number | null;
  aiTechniqueScore?: number | null;
  aiScoreBreakdown?: AiScoreBreakdown | null;
  aiAnalysis: string;
  calibrationStatus?: CalibrationStatus;
  calibratedScore?: number | null;
  calibratedRank?: string | null;
  calibratedTierBand?: CalibrationTierBand | null;
  calibratedBreakdown?: Record<string, unknown> | null;
  calibratedScoreAxes?: CalibratedScoreAxesPayload | null;
  calibrationVersion?: string | null;
  calibratedAt?: string | null;
  calibratedRoute?: "video_h1" | "video_h2_escalated" | "contact_sheet" | "gemini_api_youtube_url_v1" | null;
  calibratedRunId?: string | null;
  calibrationGenreBucket?: string | null;
  analysisObservationScope?: AnalysisObservationScope | null;
  analysisVersion?: AnalysisVersion;
  analysisGeneratedAt?: string | null;
  analysisPromptSha256?: string | null;
  isProvisional?: boolean;
  gradeBoundary?: boolean;
  visualVerificationStatus?: "log_verified" | "unverifiable_no_log" | "unverified_pending" | "invalidated_no_visual" | "not_audited";
  embedStatus: "unknown" | "available" | "restricted";
  embedReason?: string;
  embedCheckedAt: string;
  addedDate: string;
  source?: VideoSource;
  sourceLabel?: string;
  channelId?: string;
  channelTitle?: string;
  sourceUrl?: string;
}

export interface CategoryGroup {
  label: string;
  slug: string;
  items: CategoryItem[];
}

export interface CategoryItem {
  name: string;
  slug: string;
  count?: number;
}

export type CalibrationStatus =
  | "legacy_uncalibrated"
  | "unscored"
  | "calibrated_verified"
  | "calibrated_unverified_genre";

export type CalibrationTierBand = "award_tier" | "pro_band" | "low_band";

export type CalibrationFilterMode =
  | "all"
  | "calibrated"
  | "calibrated_verified"
  | "legacy_uncalibrated";

export type FilterType = "genre" | "product" | "direction" | "tone" | "duration";
export type SortType =
  | "newest"
  | "oldest"
  | "calibratedScoreDesc"
  | "aiOverallScoreDesc"
  | "aiDirectionScoreDesc"
  | "aiTechniqueScoreDesc";

export interface FilterState {
  search: string;
  genre: string | null;
  product: string | null;
  direction: string | null;
  tone: string | null;
  purpose: string | null;
  expression: string | null;
  toneEmotion: string | null;
  toneVisual: string | null;
  toneTechnique: string | null;
  production: string | null;
  productionRole?: string | null;
  privateRating: string | null;
  aiOverallRating: string | null;
  aiDirectionRating: string | null;
  aiTechniqueRating: string | null;
  calibrationFilter?: CalibrationFilterMode;
  source?: string | null;
  eizo100Only: boolean;
  eizo100Year: number | null;
  showUnavailable: boolean;
  showLowAiOverall?: boolean;
  sort: SortType;
  favoritesOnly: boolean;
}

// Category definitions
export const GENRE_CATEGORIES: CategoryItem[] = GENRE_OPTIONS.map((item) => ({ ...item }));

export const PRODUCT_CATEGORIES: CategoryItem[] = PRODUCT_OPTIONS.map((item) => ({ ...item }));

export const DIRECTION_CATEGORIES: CategoryItem[] = DIRECTION_OPTIONS.map((item) => ({ ...item }));

export const TONE_CATEGORIES: CategoryItem[] = TONE_OPTIONS.map((item) => ({ ...item }));

export const ALL_CATEGORY_GROUPS: CategoryGroup[] = [
  { label: "ジャンルから探す", slug: "genre", items: GENRE_CATEGORIES },
  { label: "商材から探す", slug: "product", items: PRODUCT_CATEGORIES },
  { label: "演出から探す", slug: "direction", items: DIRECTION_CATEGORIES },
  { label: "トーンから探す", slug: "tone", items: TONE_CATEGORIES },
];
