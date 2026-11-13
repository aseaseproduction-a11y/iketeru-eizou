import type { ProductionCredit } from "@shared/productionCredits";

/**
 * Video data types and category definitions for イケてる映像コレクション
 * Design: Cinematic Noir — dark base, cinematic red accent, immersive experience
 */

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
  aiAnalysis: string;
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

export type FilterType = "genre" | "product" | "direction" | "tone" | "duration";
export type SortType = "newest" | "oldest";

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
  source?: string | null;
  eizo100Only: boolean;
  eizo100Year: number | null;
  showUnavailable: boolean;
  showLowAiOverall?: boolean;
  sort: SortType;
  favoritesOnly: boolean;
}

// Category definitions
export const GENRE_CATEGORIES: CategoryItem[] = [
  { name: "TV CM", slug: "tv-cm" },
  { name: "Web CM", slug: "web-cm" },
  { name: "ブランデッドムービー", slug: "branded-movie" },
  { name: "YouTube / SNS / 縦型動画", slug: "youtube-sns" },
  { name: "MV", slug: "mv" },
  { name: "企業 / 商品VP / コンテスト作品", slug: "corporate" },
  { name: "映画 / ドラマ / ショートフィルム", slug: "film" },
  { name: "オープニング映像", slug: "opening" },
  { name: "メイキング / Behind The Scenes", slug: "making" },
  { name: "ドキュメンタリー", slug: "documentary" },
];

export const PRODUCT_CATEGORIES: CategoryItem[] = [
  { name: "美容 / 化粧品", slug: "beauty" },
  { name: "ファッション / アパレル", slug: "fashion" },
  { name: "食品 / 飲料 / 飲食", slug: "food" },
  { name: "日用品 / 防犯 / 警備", slug: "daily" },
  { name: "自動車 / バイク", slug: "automotive" },
  { name: "ゲーム / アプリ / 玩具", slug: "gaming" },
  { name: "IT / 通信 / ネットサービス", slug: "it" },
  { name: "旅行 / 宿泊", slug: "travel" },
  { name: "医療 / 医薬", slug: "medical" },
  { name: "住宅 / 不動産 / 建設", slug: "real-estate" },
  { name: "交通 / 物流 / 産業素材", slug: "transport" },
  { name: "娯楽 / アミューズメント", slug: "entertainment" },
  { name: "精密機器 / 家具 / 電化製品", slug: "electronics" },
  { name: "スポーツ / 健康 / フィットネス", slug: "sports" },
];

export const DIRECTION_CATEGORIES: CategoryItem[] = [
  { name: "実写", slug: "live-action" },
  { name: "合成 / VFX / 3DCG", slug: "vfx-3dcg" },
  { name: "モーショングラフィックス", slug: "motion-graphics" },
  { name: "生成AI", slug: "generative-ai" },
  { name: "カメラワーク / ドローン・空撮", slug: "camera-work" },
  { name: "モーションコントロールカメラ", slug: "motion-control" },
  { name: "ストップモーション / タイムラプス", slug: "stop-motion" },
  { name: "ボリュメトリック / バーチャルプロダクション", slug: "virtual-production" },
  { name: "イラスト / アニメーション", slug: "illustration" },
];

export const TONE_CATEGORIES: CategoryItem[] = [
  { name: "スタイリッシュ / クール", slug: "stylish" },
  { name: "コミカル / ユーモラス / カオス", slug: "comical" },
  { name: "エモーショナル / 感動的", slug: "emotional" },
  { name: "洗練 / ラグジュアリー", slug: "luxury" },
];

export const ALL_CATEGORY_GROUPS: CategoryGroup[] = [
  { label: "ジャンルから探す", slug: "genre", items: GENRE_CATEGORIES },
  { label: "商材から探す", slug: "product", items: PRODUCT_CATEGORIES },
  { label: "演出から探す", slug: "direction", items: DIRECTION_CATEGORIES },
  { label: "トーンから探す", slug: "tone", items: TONE_CATEGORIES },
];
