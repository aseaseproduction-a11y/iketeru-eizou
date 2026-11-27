// server/_core/vercelHandler.ts
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// server/db.ts
import { asc, desc, eq, sql } from "drizzle-orm";
import { and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

// drizzle/schema.ts
import { decimal, index, int, json, mediumtext, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var videos = mysqlTable("videos", {
  id: varchar("id", { length: 64 }).primaryKey(),
  // YouTube/Vimeo video ID
  platform: varchar("platform", { length: 16 }).notNull(),
  // 'youtube' | 'vimeo'
  title: text("title").notNull(),
  thumbnail: text("thumbnail"),
  videoUrl: text("videoUrl").notNull(),
  embedUrl: text("embedUrl"),
  source: varchar("source", { length: 64 }),
  // 'vook' | 'youtube_search' | etc.
  sourceLabel: text("sourceLabel"),
  channelId: varchar("channelId", { length: 64 }),
  channelTitle: text("channelTitle"),
  genres: text("genres").notNull().default("[]"),
  // JSON array
  products: text("products").notNull().default("[]"),
  // JSON array
  directions: text("directions").notNull().default("[]"),
  // JSON array
  tones: text("tones").notNull().default("[]"),
  // JSON array
  allTags: text("allTags").notNull().default("[]"),
  // JSON array
  purposes: text("purposes"),
  // JSON array: 用途
  expressions: text("expressions"),
  // JSON array: 表現
  toneEmotions: text("toneEmotions"),
  // JSON array: 感情トンマナ
  toneVisuals: text("toneVisuals"),
  // JSON array: ビジュアルトンマナ
  toneTechniques: text("toneTechniques"),
  // JSON array: 技術トンマナ
  productions: text("productions"),
  // JSON array: 制作
  productionCredits: mediumtext("productionCredits"),
  // JSON array: { name, roles, entityType }
  awards: text("awards"),
  // JSON array: 受賞アワード・年・区分・公式出典
  curationNote: mediumtext("curationNote"),
  // JSON: 制作目的・背景・評価・公式出典
  metadataClassificationAudit: mediumtext("metadataClassificationAudit"),
  // JSON: 自動分類の根拠・信頼度・状態
  privateRating: varchar("privateRating", { length: 16 }),
  // 私的評価
  aiOverallRating: varchar("aiOverallRating", { length: 16 }),
  // Notion AI評価（総合）
  aiDirectionRating: varchar("aiDirectionRating", { length: 16 }),
  // Notion AI評価（ディレクション）
  aiTechniqueRating: varchar("aiTechniqueRating", { length: 16 }),
  // Notion AI評価（技術）
  aiOverallScore: int("aiOverallScore"),
  // AI評価100点満点（総合: 0-100）
  aiDirectionScore: int("aiDirectionScore"),
  // AI評価100点満点（ディレクション: 0-100）
  aiTechniqueScore: int("aiTechniqueScore"),
  // AI評価100点満点（技術: 0-100）
  aiScoreBreakdown: mediumtext("aiScoreBreakdown"),
  // JSON: 5観点x20点ルーブリック内訳
  aiAnalysis: mediumtext("aiAnalysis"),
  // Notion AI分析結果
  calibrationStatus: varchar("calibrationStatus", { length: 32 }),
  // legacy_uncalibrated | unscored | calibrated_verified | calibrated_unverified_genre
  calibratedScore: decimal("calibratedScore", { precision: 5, scale: 2 }),
  // Phase 2 校正済み総合スコア (0.00-100.00)
  calibratedRank: varchar("calibratedRank", { length: 8 }),
  // S+..D
  calibratedTierBand: varchar("calibratedTierBand", { length: 24 }),
  // award_tier | pro_band | low_band
  calibratedBreakdown: mediumtext("calibratedBreakdown"),
  // JSON: 2+1各回点数・5観点内訳・監査証跡
  calibratedScoreAxes: json("calibratedScoreAxes").$type(),
  // JSON: 校正済み5軸スコア（各20点、合計=calibratedScore）
  calibrationVersion: varchar("calibrationVersion", { length: 32 }),
  // 'phase2_v1'
  calibratedAt: timestamp("calibratedAt"),
  // 校正完了日時 (UTC)
  calibratedRoute: varchar("calibratedRoute", { length: 32 }),
  // video_h1 | video_h2_escalated | contact_sheet
  calibratedRunId: varchar("calibratedRunId", { length: 64 }),
  // analysis/runs/<run_id>
  calibrationGenreBucket: varchar("calibrationGenreBucket", { length: 64 }),
  // CM | MV | モーション | 3DCG/アニメ | 企業映像 | unverified:<slug>
  analysisObservationScope: varchar("analysisObservationScope", { length: 40 }),
  // metadata_only_unwatched | triage_boilerplate_unwatched | triage_unverified_short | missing_video_unwatched | null
  analysisVersion: varchar("analysisVersion", { length: 16 }).notNull().default("legacy"),
  // 'legacy' | 'v3'
  analysisGeneratedAt: timestamp("analysisGeneratedAt"),
  // v3 生成完了日時 (UTC)。legacy は NULL
  analysisPromptSha256: varchar("analysisPromptSha256", { length: 64 }),
  // プロンプト SHA-256（v3 / v3.1 の識別用）
  embedStatus: varchar("embedStatus", { length: 16 }).notNull().default("unknown"),
  // unknown | available | restricted
  embedReason: varchar("embedReason", { length: 128 }),
  // unavailable_private_or_deleted | unavailable_access_restricted | unavailable_embed_restricted | unavailable_page_unavailable
  embedCheckedAt: timestamp("embedCheckedAt"),
  addedDate: varchar("addedDate", { length: 16 }),
  // 'YYYY-MM-DD'
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var videoScenes = mysqlTable("videoScenes", {
  id: int("id").autoincrement().primaryKey(),
  videoId: varchar("videoId", { length: 64 }).notNull(),
  shotIndex: int("shotIndex").notNull(),
  startMmss: varchar("startMmss", { length: 16 }).notNull(),
  endMmss: varchar("endMmss", { length: 16 }).notNull(),
  startSec: decimal("startSec", { precision: 8, scale: 2 }).notNull().default("0.00"),
  endSec: decimal("endSec", { precision: 8, scale: 2 }).notNull().default("0.00"),
  durationSec: decimal("durationSec", { precision: 8, scale: 2 }).notNull().default("0.00"),
  shotTitle: varchar("shotTitle", { length: 255 }).notNull().default(""),
  description: text("description").notNull(),
  audioText: text("audioText"),
  keywordsJson: text("keywordsJson").notNull(),
  searchText: text("searchText").notNull(),
  sceneSha256: varchar("sceneSha256", { length: 64 }),
  analysisVersion: varchar("analysisVersion", { length: 16 }).notNull().default("legacy"),
  analysisGeneratedAt: timestamp("analysisGeneratedAt"),
  sourceUpdatedAt: timestamp("sourceUpdatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => [
  uniqueIndex("video_scenes_video_shot_unique").on(table.videoId, table.shotIndex),
  index("video_scenes_video_id_idx").on(table.videoId),
  index("video_scenes_video_time_idx").on(table.videoId, table.startSec),
  index("video_scenes_version_idx").on(table.analysisVersion)
]);
var videoAnalysisHistory = mysqlTable("videoAnalysisHistory", {
  id: int("id").autoincrement().primaryKey(),
  videoId: varchar("videoId", { length: 64 }).notNull(),
  analysisVersion: varchar("analysisVersion", { length: 16 }).notNull(),
  aiAnalysis: mediumtext("aiAnalysis"),
  contentSha256: varchar("contentSha256", { length: 64 }).notNull(),
  promptSha256: varchar("promptSha256", { length: 64 }),
  generatedAt: timestamp("generatedAt"),
  archivedAt: timestamp("archivedAt").defaultNow().notNull(),
  archivedBy: varchar("archivedBy", { length: 64 }).notNull()
}, (table) => [
  index("video_analysis_history_video_id_idx").on(table.videoId, table.archivedAt),
  index("video_analysis_history_version_idx").on(table.analysisVersion)
]);
var favoriteProfiles = mysqlTable("favoriteProfiles", {
  id: varchar("id", { length: 64 }).primaryKey(),
  displayName: varchar("displayName", { length: 80 }).notNull(),
  normalizedName: varchar("normalizedName", { length: 160 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => [
  uniqueIndex("favorite_profiles_normalized_name_unique").on(table.normalizedName)
]);
var profileVideoFavorites = mysqlTable("profileVideoFavorites", {
  id: int("id").autoincrement().primaryKey(),
  profileId: varchar("profileId", { length: 64 }).notNull(),
  videoId: varchar("videoId", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => [
  uniqueIndex("profile_video_favorites_profile_video_unique").on(table.profileId, table.videoId)
]);
var profileCreatorFavorites = mysqlTable("profileCreatorFavorites", {
  id: int("id").autoincrement().primaryKey(),
  profileId: varchar("profileId", { length: 64 }).notNull(),
  creatorName: varchar("creatorName", { length: 160 }).notNull(),
  normalizedCreatorName: varchar("normalizedCreatorName", { length: 240 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => [
  uniqueIndex("profile_creator_favorites_profile_creator_unique").on(table.profileId, table.normalizedCreatorName)
]);
var dailyCollectionSources = mysqlTable("dailyCollectionSources", {
  id: varchar("id", { length: 64 }).primaryKey(),
  label: varchar("label", { length: 128 }).notNull(),
  url: text("url").notNull(),
  enabled: int("enabled").notNull().default(1),
  scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }),
  lastCheckedAt: timestamp("lastCheckedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var dailyCollectionRuns = mysqlTable("dailyCollectionRuns", {
  id: int("id").autoincrement().primaryKey(),
  taskUid: varchar("taskUid", { length: 65 }),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  status: varchar("status", { length: 32 }).notNull(),
  candidateCount: int("candidateCount").notNull().default(0),
  insertedCount: int("insertedCount").notNull().default(0),
  updatedCount: int("updatedCount").notNull().default(0),
  skippedCount: int("skippedCount").notNull().default(0),
  details: mediumtext("details")
});
var aiMetadataCompletionJobs = mysqlTable("aiMetadataCompletionJobs", {
  id: varchar("id", { length: 64 }).primaryKey(),
  scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }),
  backupScheduleCronTaskUid: varchar("backupScheduleCronTaskUid", { length: 65 }),
  enabled: int("enabled").notNull().default(1),
  batchSize: int("batchSize").notNull().default(5),
  consecutiveModelFailureCount: int("consecutiveModelFailureCount").notNull().default(0),
  retryAfter: timestamp("retryAfter"),
  lastRunAt: timestamp("lastRunAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var aiMetadataCompletionRuns = mysqlTable("aiMetadataCompletionRuns", {
  id: int("id").autoincrement().primaryKey(),
  taskUid: varchar("taskUid", { length: 65 }),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  status: varchar("status", { length: 32 }).notNull(),
  selectedCount: int("selectedCount").notNull().default(0),
  analyzedCount: int("analyzedCount").notNull().default(0),
  auditedCount: int("auditedCount").notNull().default(0),
  savedValueCount: int("savedValueCount").notNull().default(0),
  skippedCount: int("skippedCount").notNull().default(0),
  details: mediumtext("details")
});

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// shared/favoriteProfiles.ts
function normalizeFavoriteProfileName(value) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ja-JP");
}
function normalizeFavoriteCreatorName(value) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ja-JP");
}
function cleanFavoriteDisplayName(value) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

// shared/productionCredits.ts
var PRODUCTION_ROLE_OPTIONS = [
  "\u30A8\u30FC\u30B8\u30A7\u30F3\u30B7\u30FC",
  "\u30AF\u30EA\u30A8\u30A4\u30C6\u30A3\u30D6\u30C7\u30A3\u30EC\u30AF\u30BF\u30FC",
  "\u30A2\u30FC\u30C8\u30C7\u30A3\u30EC\u30AF\u30BF\u30FC",
  "Web\u30A2\u30FC\u30C8\u30C7\u30A3\u30EC\u30AF\u30B7\u30E7\u30F3",
  "Web\u30C7\u30B6\u30A4\u30CA\u30FC",
  "\u76E3\u7763",
  "\u6F14\u51FA",
  "\u30D7\u30ED\u30C7\u30E5\u30FC\u30B5\u30FC",
  "\u30D7\u30ED\u30C0\u30AF\u30B7\u30E7\u30F3\u30DE\u30CD\u30FC\u30B8\u30E3\u30FC",
  "\u5236\u4F5C\u4F1A\u793E",
  "\u5236\u4F5C",
  "\u5236\u4F5C\u8005",
  "\u64AE\u5F71",
  "\u7DE8\u96C6",
  "\u30A2\u30CB\u30E1\u30FC\u30B7\u30E7\u30F3",
  "\u30E2\u30FC\u30B7\u30E7\u30F3\u30B0\u30E9\u30D5\u30A3\u30C3\u30AF\u30B9",
  "CG",
  "VFX",
  "\u30A4\u30E9\u30B9\u30C8",
  "\u30C7\u30B6\u30A4\u30F3",
  "\u30AD\u30E3\u30E9\u30AF\u30BF\u30FC\u30C7\u30B6\u30A4\u30F3",
  "\u7F8E\u8853",
  "\u97F3\u697D",
  "\u51FA\u6F14",
  "\u30A2\u30B7\u30B9\u30BF\u30F3\u30C8",
  "\u30A2\u30AB\u30A6\u30F3\u30C8\u30A8\u30B0\u30BC\u30AF\u30C6\u30A3\u30D6",
  "PR",
  "\u7D71\u62EC\u8CAC\u4EFB\u8005",
  "\u55B6\u696D",
  "\u30C7\u30D9\u30ED\u30C3\u30D1\u30FC",
  "\u30D3\u30B8\u30CD\u30B9",
  "\u30B3\u30F3\u30C6\u30F3\u30C4",
  "AI\u30D5\u30A3\u30EB\u30E0",
  "\u6D77\u5916\u30ED\u30B1\u30FC\u30B7\u30E7\u30F3\u30B3\u30FC\u30C7\u30A3\u30CD\u30FC\u30BF\u30FC",
  "\u30ED\u30B1\u30B3\u30FC\u30C7\u30A3\u30CD\u30FC\u30BF\u30FC",
  "\u305D\u306E\u4ED6"
];
var NON_VIDEO_PRODUCTION_ROLES = /* @__PURE__ */ new Set([
  "\u97F3\u697D",
  "\u30DC\u30FC\u30AB\u30EB",
  "\u6B4C\u5531",
  "\u6F14\u594F",
  "\u4F5C\u8A5E",
  "\u4F5C\u66F2",
  "\u7DE8\u66F2",
  "\u30A2\u30EC\u30F3\u30B8",
  "\u30DF\u30AD\u30B7\u30F3\u30B0",
  "\u30DF\u30C3\u30AF\u30B9",
  "\u30DE\u30B9\u30BF\u30EA\u30F3\u30B0",
  "\u30B5\u30A6\u30F3\u30C9\u30C7\u30A3\u30EC\u30AF\u30B7\u30E7\u30F3",
  "\u30DC\u30FC\u30AB\u30EB\u30C7\u30A3\u30EC\u30AF\u30B7\u30E7\u30F3",
  "\u51FA\u6F14",
  "\u58F0\u512A",
  "\u30CA\u30EC\u30FC\u30B7\u30E7\u30F3",
  "\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8",
  "\u30D1\u30D5\u30A9\u30FC\u30DE\u30FC",
  "\u30AE\u30BF\u30FC",
  "\u30D9\u30FC\u30B9",
  "\u30C9\u30E9\u30E0",
  "\u30C1\u30A7\u30ED",
  "\u30C8\u30ED\u30F3\u30DC\u30FC\u30F3",
  "\u30D0\u30A4\u30AA\u30EA\u30F3",
  "\u30D5\u30EB\u30FC\u30C8",
  "\u30AD\u30FC\u30DC\u30FC\u30C9",
  "\u30A8\u30EC\u30AF\u30C8\u30EA\u30C3\u30AF\u30D4\u30A2\u30CE",
  "\u30B3\u30FC\u30E9\u30B9\u30A2\u30EC\u30F3\u30B8",
  "\u30EC\u30B3\u30FC\u30C7\u30A3\u30F3\u30B0",
  "\u30A4\u30F3\u30B9\u30C8"
]);
var NAVIGATION_OR_UI_TEXT = /^(?:←|→|‹|›|前の投稿|次の投稿|previous\s+post|next\s+post|back\s+to|browse\s+by|all\s+works?\b)/i;
var ROLE_ALIASES = [
  { pattern: /^(?:creative\s*director|クリエイティブ[・\s]*ディレクター|cd)$/i, role: "\u30AF\u30EA\u30A8\u30A4\u30C6\u30A3\u30D6\u30C7\u30A3\u30EC\u30AF\u30BF\u30FC" },
  { pattern: /^(?:art\s*director|アート[・\s]*ディレクター|ad)$/i, role: "\u30A2\u30FC\u30C8\u30C7\u30A3\u30EC\u30AF\u30BF\u30FC" },
  { pattern: /^(?:web\s*(?:art\s*)?direction|web[・\s]*アート[・\s]*ディレクション)$/i, role: "Web\u30A2\u30FC\u30C8\u30C7\u30A3\u30EC\u30AF\u30B7\u30E7\u30F3" },
  { pattern: /^(?:web\s*designer|web[・\s]*デザイナー)$/i, role: "Web\u30C7\u30B6\u30A4\u30CA\u30FC" },
  { pattern: /^(?:director|directed(?:\s+by)?|film\s*director|監督|ディレクター)$/i, role: "\u76E3\u7763" },
  { pattern: /^(?:direction|演出)$/i, role: "\u6F14\u51FA" },
  { pattern: /^(?:producer|produce|プロデューサー|プロデュース)$/i, role: "\u30D7\u30ED\u30C7\u30E5\u30FC\u30B5\u30FC" },
  { pattern: /^(?:production\s*manager|プロダクション[・\s]*マネージャー)$/i, role: "\u30D7\u30ED\u30C0\u30AF\u30B7\u30E7\u30F3\u30DE\u30CD\u30FC\u30B8\u30E3\u30FC" },
  { pattern: /^(?:production\s*company|production\s*house|制作会社)$/i, role: "\u5236\u4F5C\u4F1A\u793E" },
  { pattern: /^(?:production|制作|製作|movie(?:\s+by)?|映像制作|映像|video(?:\s+by)?)$/i, role: "\u5236\u4F5C" },
  { pattern: /^(?:creator(?:\([^)]*\))?|制作者(?:\([^)]*\))?)$/i, role: "\u5236\u4F5C\u8005" },
  { pattern: /^(?:agency|advertising\s*agency|広告会社)$/i, role: "\u30A8\u30FC\u30B8\u30A7\u30F3\u30B7\u30FC" },
  { pattern: /^(?:cinematograph(?:er|y)|director\s*of\s*photography|dop|撮影)$/i, role: "\u64AE\u5F71" },
  { pattern: /^(?:editor|edit|編集)$/i, role: "\u7DE8\u96C6" },
  { pattern: /^(?:animation(?:\s*production)?(?:\s+by)?|animator|アニメーション|アニメ制作|アニメーター)$/i, role: "\u30A2\u30CB\u30E1\u30FC\u30B7\u30E7\u30F3" },
  { pattern: /^(?:motion\s*graphics?(?:\s*designer)?|モーション[・\s]*グラフィックス?)$/i, role: "\u30E2\u30FC\u30B7\u30E7\u30F3\u30B0\u30E9\u30D5\u30A3\u30C3\u30AF\u30B9" },
  { pattern: /^(?:cg(?:\s*designer|\s*artist)?|3dcg|cgi|cg|3d)$/i, role: "CG" },
  { pattern: /^(?:vfx|visual\s*effects)$/i, role: "VFX" },
  { pattern: /^(?:illustration(?:\s+by)?|illustrator|illust|イラスト(?:レーター)?)$/i, role: "\u30A4\u30E9\u30B9\u30C8" },
  { pattern: /^(?:character\s*designer|character\s*design|キャラクターデザイナー|キャラクターデザイン)$/i, role: "\u30AD\u30E3\u30E9\u30AF\u30BF\u30FC\u30C7\u30B6\u30A4\u30F3" },
  { pattern: /^(?:designer|design|graphic\s*design|デザイナー|デザイン)$/i, role: "\u30C7\u30B6\u30A4\u30F3" },
  { pattern: /^(?:art\s*department|art\s*direction|美術)$/i, role: "\u7F8E\u8853" },
  { pattern: /^(?:music(?:\s+by)?|sound(?:\s+by)?|sound\s*design|音楽|サウンド(?:デザイン)?)$/i, role: "\u97F3\u697D" },
  { pattern: /^(?:vocal(?:s|ist)?(?:\s+performed)?(?:\s+by)?|singer|ボーカル|歌唱)$/i, role: "\u30DC\u30FC\u30AB\u30EB" },
  { pattern: /^(?:performance|performer|演奏)$/i, role: "\u6F14\u594F" },
  { pattern: /^(?:lyrics?|lyricist|作詞)$/i, role: "\u4F5C\u8A5E" },
  { pattern: /^(?:composition|composer|作曲)$/i, role: "\u4F5C\u66F2" },
  { pattern: /^(?:arrangement|arranger|編曲|アレンジ)$/i, role: "\u7DE8\u66F2" },
  { pattern: /^(?:mix(?:ing)?|ミキシング|ミックス)$/i, role: "\u30DF\u30AD\u30B7\u30F3\u30B0" },
  { pattern: /^(?:master(?:ing)?|マスタリング)$/i, role: "\u30DE\u30B9\u30BF\u30EA\u30F3\u30B0" },
  { pattern: /^(?:vocal\s*direction|ボーカルディレクション)$/i, role: "\u30DC\u30FC\u30AB\u30EB\u30C7\u30A3\u30EC\u30AF\u30B7\u30E7\u30F3" },
  { pattern: /^(?:sound\s*direction|サウンドディレクション)$/i, role: "\u30B5\u30A6\u30F3\u30C9\u30C7\u30A3\u30EC\u30AF\u30B7\u30E7\u30F3" },
  { pattern: /^(?:cast|talent|出演)$/i, role: "\u51FA\u6F14" },
  { pattern: /^(?:assistant|アシスタント)$/i, role: "\u30A2\u30B7\u30B9\u30BF\u30F3\u30C8" },
  { pattern: /^(?:account\s*executive|アカウント[・\s]*エグゼクティブ)$/i, role: "\u30A2\u30AB\u30A6\u30F3\u30C8\u30A8\u30B0\u30BC\u30AF\u30C6\u30A3\u30D6" },
  { pattern: /^(?:pr)$/i, role: "PR" },
  { pattern: /^(?:executive|エグゼクティブ|統括責任者)$/i, role: "\u7D71\u62EC\u8CAC\u4EFB\u8005" },
  { pattern: /^(?:sales|営業)$/i, role: "\u55B6\u696D" },
  { pattern: /^(?:developer|デベロッパー)$/i, role: "\u30C7\u30D9\u30ED\u30C3\u30D1\u30FC" },
  { pattern: /^(?:business|ビジネス)$/i, role: "\u30D3\u30B8\u30CD\u30B9" },
  { pattern: /^(?:content|コンテンツ)$/i, role: "\u30B3\u30F3\u30C6\u30F3\u30C4" },
  { pattern: /^(?:ai\s*film|ai[・\s]*フィルム)$/i, role: "AI\u30D5\u30A3\u30EB\u30E0" },
  { pattern: /^(?:overseas\s*location\s*coordinator|海外ロケーションコーディネーター)$/i, role: "\u6D77\u5916\u30ED\u30B1\u30FC\u30B7\u30E7\u30F3\u30B3\u30FC\u30C7\u30A3\u30CD\u30FC\u30BF\u30FC" },
  { pattern: /^(?:location\s*coordinator|ロケ(?:ーション)?コーディネーター)$/i, role: "\u30ED\u30B1\u30B3\u30FC\u30C7\u30A3\u30CD\u30FC\u30BF\u30FC" },
  { pattern: /^(?:created\s*by|担当)$/i, role: "\u305D\u306E\u4ED6" }
];
var ROLE_LABEL_PATTERN = /(?:creative\s*director|art\s*director|web\s*(?:art\s*)?direction|web\s*designer|director\s*\/\s*designer|director|producer|production\s*manager|production\s*company|production|agency|account\s*executive|assistant|cinematograph(?:er|y)|director\s*of\s*photography|editor|animation(?:\s*production)?|animator|motion\s*graphics?(?:\s*designer)?|cg(?:\s*designer|\s*artist)?|vfx|illustration|illustrator|character\s*designer|designer|developer|design|art\s*department|music|sound(?:\s*design)?|cast|creator(?:\([^)]*\))?|制作者(?:\([^)]*\))?|制作会社・関連会社(?:\([^)]*\))?|プロダクション[・\s]*マネージャー|制作会社|クリエイティブ[・\s]*ディレクター|アート[・\s]*ディレクター|アカウント[・\s]*エグゼクティブ|アシスタント|キャラクターデザイナー|Web[・\s]*ア[\s]*ート[・\s]*ディレクション|Web[・\s]*デザイナー|海外ロケーションコーディネーター|ロケ(?:ーション)?コーディネーター|ディレクター|プロデューサー|プロデュース|映像制作|映像|アニメ(?:ーション|制作|ーター)?|モーション[・\s]*グラフィックス?|撮影|編集|美術|音楽|サウンド(?:デザイン)?|出演|担当者|担当|制作|製作|監督|演出|営業|PR|CG|VFX)\s*[:：]/gi;
var INLINE_ROLE_PATTERN = /海外ロケーションコーディネーター|ロケ(?:ーション)?コーディネーター|アカウント[・\s]*エグゼクティブ|キャラクターデザイナー|Web[・\s]*ア[\s]*ート[・\s]*ディレクション|Web[・\s]*デザイナー|プロダクション[・\s]*マネージャー|クリエイティブ[・\s]*ディレクター|アート[・\s]*ディレクター|統括責任者|アシスタント|デベロッパー|デザイナー|クリエイティブ|ビジネス|コンテンツ|AI[・\s]*フィルム|アートディレクション|account\s*executive|character\s*designer|web\s*(?:art\s*)?direction|web\s*designer|production\s*manager|assistant|developer|designer|business|content|ai\s*film|(?:^|\s)PR(?=\s|$)|(?:^|\s)PM(?=\s|$)|演出|営業|音楽|アニメ(?:ーション)?/gi;
var ROLE_ONLY_COMPOSITE = /^(?:(?:2d\s*animation|3dcg|animation|music\s*video|music|promotion|pv|tv|director|animator|designer|developer|sound|cast)[\s/,_-]*)+$/i;
var CATEGORY_CONCATENATION = /^(?:2d\s*animation|3dcg|animation|motion\s*graphics|music\s*video|promotion|pv|tv|web(?:\s*cm|\s*movie)?|original|short\s*film|comedy|broadcast|event|live\s*action|illustration|showreel)+$/i;
var ENGLISH_BY_CREDIT_PATTERN = /^(vocals?\s+(?:performed\s+)?by|vocal(?:s)?|vocal\s+direction|vocalist|singer|music\s+by|sound\s+by|video\s+by|movie\s+by|directed\s+by|illustration\s+by|animation\s+by)\s*:?[\s]*(.+)$/i;
var ENTITY_ALIASES = /* @__PURE__ */ new Map([
  ["\u682A\u5F0F\u4F1A\u793E\u30E9\u30A4\u30C8\u30FB\u30B6\u30FB\u30A6\u30A7\u30A4", "LIGHT THE WAY Inc."],
  ["\u682A\u5F0F\u4F1A\u793E\u30E9\u30A4\u30C8\u30B6\u30A6\u30A7\u30A4", "LIGHT THE WAY Inc."],
  ["light the way", "LIGHT THE WAY Inc."],
  ["light the way inc", "LIGHT THE WAY Inc."],
  ["light the way inc.", "LIGHT THE WAY Inc."],
  ["eisuke shirota", "\u4EE3\u7530\u6804\u4ECB"],
  ["shirota eisuke", "\u4EE3\u7530\u6804\u4ECB"],
  ["\u4EE3\u7530 \u6804\u4ECB", "\u4EE3\u7530\u6804\u4ECB"],
  ["chocolate.inc", "CHOCOLATE Inc."],
  ["chocolate inc", "CHOCOLATE Inc."],
  ["chocolate inc.", "CHOCOLATE Inc."],
  ["naname inc", "NANAME Inc."],
  ["naname inc.", "NANAME Inc."],
  ["\u30EF\u30A6\u682A\u5F0F\u4F1A\u793E", "WOW inc."],
  ["wow.inc", "WOW inc."],
  ["wow inc", "WOW inc."],
  ["wow inc.", "WOW inc."],
  ["wow", "WOW inc."],
  ["\u571F\u5C90 \u5F69\u4E43 (koo-ki)", "\u571F\u5C90 \u5F69\u4E43"],
  ["\u571F\u5C90\u5F69\u4E43 (koo-ki)", "\u571F\u5C90 \u5F69\u4E43"],
  ["\u5E73\u4E95 \u79C0\u6B21", "\u5E73\u4E95\u79C0\u6B21"],
  ["shuji hirai", "\u5E73\u4E95\u79C0\u6B21"],
  ["hirai shuji", "\u5E73\u4E95\u79C0\u6B21"],
  ["supersymmetry", "superSymmetry"],
  ["supersymmetry by omnibus japan", "superSymmetry"]
]);
function normalizeKey(value) {
  return value.normalize("NFKC").replace(/[“”]/g, '"').replace(/[‐‑–—―]/g, "-").replace(/\s+/g, " ").trim().toLocaleLowerCase("en");
}
function dedupe(values) {
  return Array.from(new Set(values));
}
function normalizeProductionRole(raw) {
  const label = raw.normalize("NFKC").replace(/[:：]/g, "").replace(/[・_]/g, " ").replace(/\s+/g, " ").trim();
  if (!label) return null;
  if (PRODUCTION_ROLE_OPTIONS.includes(label)) return label;
  if (/^agency$/i.test(label)) return "\u30A8\u30FC\u30B8\u30A7\u30F3\u30B7\u30FC";
  return ROLE_ALIASES.find(({ pattern }) => pattern.test(label))?.role ?? null;
}
function normalizeDeclaredRole(raw) {
  const normalized = normalizeProductionRole(raw);
  if (normalized) return normalized;
  const label = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  return label && label.length <= 80 ? label : null;
}
function canonicalizeProductionName(raw) {
  const value = raw.normalize("NFKC").replace(/^[\s:：,，・/]+|[\s:：,，・/]+$/g, "").replace(/^制作会社・関連会社(?:\([^)]*\))?\s*[:：]\s*/i, "").replace(/^プロダクション\s*[:：]\s*マネージャー\s*/i, "").replace(/^担当者\s*/i, "").replace(/^by\s+/i, "").replace(/\s*[（(]\s*KOO-KI\s*[）)]\s*/gi, " ").replace(/\s+by\s+omnibus\s+japan\s*$/i, "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  return ENTITY_ALIASES.get(normalizeKey(value)) ?? value;
}
function inferEntityType(name, roles) {
  if (roles.includes("\u5236\u4F5C\u4F1A\u793E")) return "company";
  if (["wow", "wow inc.", "supersymmetry"].includes(normalizeKey(name))) return "company";
  if (/(?:\b(?:inc\.?|ltd\.?|llc|corp\.?|co\.?,?\s*ltd\.?)\b|株式会社|有限会社|合同会社|スタジオ|studio|films?|pictures|映像|プロダクション)/i.test(name)) return "company";
  if (/^[\u3040-\u30ff\u3400-\u9fffA-Za-z.'’\- ]+$/.test(name)) return "person";
  return "unknown";
}
function isPlausibleEntityName(value) {
  if (value.length < 2 || value.length > 120) return false;
  if (/^(?:不明|未確認|unknown|n\/a)$/i.test(value)) return false;
  if (NAVIGATION_OR_UI_TEXT.test(value)) return false;
  const compact = value.toLocaleLowerCase("en").replace(/[\s/,_-]/g, "");
  if (normalizeProductionRole(value) || ROLE_ONLY_COMPOSITE.test(value) || CATEGORY_CONCATENATION.test(value) || /^(?:2danimation|3dcg|animation|motiongraphics|musicvideo|music|promotion|pv|tv|director|animator|designer|developer|sound|cast)+$/.test(compact)) return false;
  if (/https?:\/\//i.test(value) || /[。！？]/.test(value)) return false;
  if (/(?:other works|browse by genre|詳しくは|制作しました|大型屋外ビジョン)/i.test(value)) return false;
  return true;
}
function creditFromName(rawName, rawRoles = [], preserveDeclaredRoles = false) {
  const name = canonicalizeProductionName(rawName.replace(/^[\-–—]+|[\-–—]+$/g, "").trim());
  if (!isPlausibleEntityName(name)) return null;
  const roles = dedupe(rawRoles.map((role) => preserveDeclaredRoles ? normalizeDeclaredRole(role) : normalizeProductionRole(role)).filter((role) => Boolean(role)));
  return { name, roles, entityType: inferEntityType(name, roles) };
}
function splitNames(raw) {
  return raw.split(/[\n,，、/／]+/).map((item) => item.trim()).filter(Boolean);
}
function parseParentheticalCredit(raw) {
  const matched = raw.match(/^(.+?)[（(]([^）)]+)[）)]$/);
  if (!matched) return null;
  const [, name, roleText] = matched;
  const roles = roleText.split(/[・/,&、]/).map((item) => item.trim());
  return creditFromName(name, roles);
}
function parseLeadingRoleLabel(value) {
  const company = value.match(/^制作会社・関連会社(?:\([^)]*\))?\s*[:：]\s*(.+)$/i);
  if (company) {
    return splitNames(company[1]).map((name) => creditFromName(name, ["\u5236\u4F5C\u4F1A\u793E"])).filter((credit) => Boolean(credit));
  }
  const manager = value.match(/^プロダクション\s*[:：]\s*マネージャー\s+(.+)$/i);
  if (manager) {
    return splitNames(manager[1]).map((name) => creditFromName(name, ["\u30D7\u30ED\u30C0\u30AF\u30B7\u30E7\u30F3\u30DE\u30CD\u30FC\u30B8\u30E3\u30FC"])).filter((credit) => Boolean(credit));
  }
  return null;
}
function parseEnglishByCredit(value) {
  const matched = value.match(ENGLISH_BY_CREDIT_PATTERN);
  if (!matched) return null;
  const [, rawRole, rawNames] = matched;
  const role = normalizeProductionRole(rawRole);
  if (!role) return [];
  return splitNames(rawNames).map((name) => creditFromName(name, [role])).filter((credit) => Boolean(credit));
}
function parseInlineRoleChain(value) {
  INLINE_ROLE_PATTERN.lastIndex = 0;
  const matches = Array.from(value.matchAll(INLINE_ROLE_PATTERN));
  if (matches.length === 0) return [];
  const credits = [];
  let cursor = 0;
  matches.forEach((match) => {
    const before = value.slice(cursor, match.index).replace(/^担当者\s*/i, "").trim();
    const role = normalizeProductionRole(match[0]);
    if (before && role) {
      splitNames(before).forEach((name) => {
        const credit = creditFromName(name, [role]);
        if (credit) credits.push(credit);
      });
    }
    cursor = (match.index ?? 0) + match[0].length;
  });
  const tail = value.slice(cursor).trim();
  if (tail) {
    splitNames(tail).forEach((name) => {
      const credit = creditFromName(name);
      if (credit) credits.push(credit);
    });
  }
  return credits;
}
function parseProductionCreditText(raw) {
  const value = raw.normalize("NFKC").replace(/\r\n/g, "\n").trim();
  if (!value || value.length > 800) return [];
  if (NAVIGATION_OR_UI_TEXT.test(value)) return [];
  if (!isPlausibleEntityName(value) && !/[：:]/.test(value)) return [];
  const leading = parseLeadingRoleLabel(value);
  if (leading) return leading;
  const englishBy = parseEnglishByCredit(value);
  if (englishBy) return englishBy;
  const parenthetical = parseParentheticalCredit(value);
  if (parenthetical) return [parenthetical];
  ROLE_LABEL_PATTERN.lastIndex = 0;
  const matches = Array.from(value.matchAll(ROLE_LABEL_PATTERN));
  if (matches.length === 0) {
    const inline = parseInlineRoleChain(value);
    if (inline.length > 0) return inline;
    if (/[\n,，、/／]/.test(value)) {
      return splitNames(value).map((name) => creditFromName(name)).filter((credit) => Boolean(credit));
    }
    return creditFromName(value) ? [creditFromName(value)] : [];
  }
  const credits = [];
  matches.forEach((match, index2) => {
    const nextStart = matches[index2 + 1]?.index ?? value.length;
    const roleLabel = match[0].replace(/[:：]\s*$/, "");
    const role = normalizeProductionRole(roleLabel);
    if (!role) return;
    const names2 = splitNames(value.slice((match.index ?? 0) + match[0].length, nextStart));
    names2.forEach((name) => {
      const credit = creditFromName(name, [role]);
      if (credit) credits.push(credit);
    });
  });
  return credits;
}
function normalizeProductionCredits(structured, legacyValues = []) {
  const candidates = [];
  (structured ?? []).forEach((credit) => {
    if (typeof credit.name !== "string") return;
    const creditName = credit.name;
    const declaredRoles = Array.isArray(credit.roles) ? credit.roles : [];
    const parsed = parseProductionCreditText(creditName);
    if (parsed.length > 0) {
      const inheritedRoles = parsed.length === 1 ? declaredRoles.map(normalizeDeclaredRole).filter((role) => Boolean(role)) : [];
      parsed.forEach((candidate) => {
        const roles = dedupe([
          ...candidate.roles,
          ...inheritedRoles
        ]);
        const originalName = canonicalizeProductionName(creditName);
        const preservedEntityType = (credit.entityType === "person" || credit.entityType === "company") && candidate.name === originalName ? credit.entityType : inferEntityType(candidate.name, roles);
        candidates.push({ ...candidate, roles, entityType: preservedEntityType });
      });
    } else {
      const normalized = creditFromName(creditName, declaredRoles, true);
      if (normalized) candidates.push(normalized);
    }
  });
  legacyValues.forEach((value) => {
    if (typeof value !== "string") return;
    candidates.push(...parseProductionCreditText(value));
  });
  const merged = /* @__PURE__ */ new Map();
  candidates.forEach((credit) => {
    const key = normalizeKey(credit.name);
    const current = merged.get(key);
    if (current) {
      current.roles = dedupe([...current.roles, ...credit.roles]);
      if (current.entityType === "unknown" && credit.entityType !== "unknown") current.entityType = credit.entityType;
    } else {
      merged.set(key, { ...credit, roles: [...credit.roles] });
    }
  });
  return Array.from(merged.values()).map((credit) => {
    const roles = credit.roles.filter((role) => !NON_VIDEO_PRODUCTION_ROLES.has(role));
    return { credit, roles };
  }).filter(({ credit, roles }) => roles.length > 0 || !credit.roles.some((role) => NON_VIDEO_PRODUCTION_ROLES.has(role))).map(({ credit, roles }) => ({ ...credit, roles }));
}
function getProductionNames(credits) {
  return dedupe(credits.map((credit) => credit.name).filter(Boolean));
}
function getProductionRoles(credits) {
  return dedupe(credits.flatMap((credit) => credit.roles));
}

// shared/sceneSearchMeta.ts
var SCENE_SYNONYM_MAP = {
  "\u5915\u65E5": ["\u5915\u65E5", "\u5915\u967D", "\u5915\u713C\u3051", "\u65E5\u6CA1", "\u30DE\u30B8\u30C3\u30AF\u30A2\u30EF\u30FC", "\u9EC4\u660F", "\u30B5\u30F3\u30BB\u30C3\u30C8", "sunset", "\u30AA\u30EC\u30F3\u30B8", "\u831C\u8272"],
  "\u5915\u967D": ["\u5915\u65E5", "\u5915\u967D", "\u5915\u713C\u3051", "\u65E5\u6CA1", "\u30DE\u30B8\u30C3\u30AF\u30A2\u30EF\u30FC", "\u9EC4\u660F", "\u30B5\u30F3\u30BB\u30C3\u30C8", "sunset", "\u30AA\u30EC\u30F3\u30B8"],
  "\u6D77": ["\u6D77", "\u6D77\u5CB8", "\u7802\u6D5C", "\u30D3\u30FC\u30C1", "\u6CE2", "\u6C34\u7740", "ocean", "beach", "sea", "\u6C34\u9762", "\u6CE2\u6253\u3061\u969B"],
  "\u96E8": ["\u96E8", "\u8C6A\u96E8", "\u96E8\u6EF4", "\u6C34\u6EF4", "\u5098", "\u30EC\u30A4\u30F3", "rain", "\u96E8\u964D\u308A", "\u571F\u7802\u964D\u308A", "\u53F0\u98A8"],
  "\u591C": ["\u591C", "\u591C\u666F", "\u6DF1\u591C", "\u6697\u95C7", "\u30CD\u30AA\u30F3", "\u30CA\u30A4\u30C8", "night", "\u7167\u660E", "\u8857\u706F"],
  "\u8ECA": ["\u8ECA", "\u81EA\u52D5\u8ECA", "\u30B9\u30DD\u30FC\u30C4\u30AB\u30FC", "\u30C9\u30E9\u30A4\u30D6", "\u30AB\u30FC\u30B9\u30BF\u30F3\u30C8", "\u8D70\u884C", "car", "\u30D8\u30C3\u30C9\u30E9\u30A4\u30C8"],
  "\u8D70\u308B": ["\u8D70\u308B", "\u75BE\u8D70", "\u30E9\u30F3\u30CB\u30F3\u30B0", "\u30C0\u30C3\u30B7\u30E5", "\u9003\u3052\u308B", "\u99C6\u3051\u629C\u3051\u308B", "\u30B9\u30D4\u30FC\u30C9"],
  "\u8E0A\u308B": ["\u8E0A\u308B", "\u30C0\u30F3\u30B9", "\u30B9\u30C6\u30C3\u30D7", "\u632F\u4ED8", "\u30B3\u30EC\u30AA", "dance", "\u30C0\u30F3\u30B5\u30FC", "\u7FA4\u821E"],
  "\u5149": ["\u5149", "\u767A\u5149", "\u30B9\u30C8\u30ED\u30DC", "\u9583\u5149", "\u30EC\u30F3\u30BA\u30D5\u30EC\u30A2", "\u30B0\u30ED\u30FC", "\u9006\u5149", "\u30E9\u30A4\u30C8", "light"],
  "\u8857": ["\u8857", "\u90FD\u5E02", "\u30D3\u30EB", "\u6771\u4EAC", "\u30B9\u30C8\u30EA\u30FC\u30C8", "\u8DEF\u5730\u88CF", "\u4EA4\u5DEE\u70B9", "city", "street"],
  "\u7159": ["\u7159", "\u30B9\u30E2\u30FC\u30AF", "\u30D5\u30A9\u30B0", "\u6E6F\u6C17", "\u7206\u767A", "\u706B\u82B1", "smoke", "fog"],
  "\u82B1": ["\u82B1", "\u685C", "\u82B1\u3073\u3089", "\u690D\u7269", "\u81EA\u7136", "flower"],
  "\u7A7A": ["\u7A7A", "\u9752\u7A7A", "\u96F2", "\u661F\u7A7A", "\u5B87\u5B99", "sky", "\u30AF\u30E9\u30A6\u30C9"],
  "\u7F8E\u3057\u3044": ["\u7F8E\u3057\u3044", "\u30A8\u30E2\u30FC\u30B7\u30E7\u30CA\u30EB", "\u7DBA\u9E97", "\u5E7B\u60F3\u7684", "\u30B7\u30CD\u30DE\u30C6\u30A3\u30C3\u30AF", "\u7D76\u666F", "\u7F8E\u9E97"],
  "\u72C2\u6C17": ["\u72C2\u6C17", "\u30DB\u30E9\u30FC", "\u4E0D\u6C17\u5473", "\u6050\u6016", "\u602A\u4F5C", "\u30AB\u30EB\u30C8", "\u66B4\u8D70"],
  "\u7B11\u3044": ["\u7B11\u3044", "\u7B11\u9854", "\u30B3\u30DF\u30AB\u30EB", "\u30E6\u30FC\u30E2\u30A2", "\u7206\u7B11", "\u5FAE\u7B11\u307F", "\u30B9\u30DE\u30A4\u30EB"],
  "\u30DE\u30C3\u30C1\u30AB\u30C3\u30C8": ["\u30DE\u30C3\u30C1\u30AB\u30C3\u30C8", "match cut", "\u30B0\u30E9\u30D5\u30A3\u30C3\u30AF\u30DE\u30C3\u30C1", "\u5F62\u72B6\u4E00\u81F4"],
  "\u30B9\u30C8\u30C3\u30D7\u30E2\u30FC\u30B7\u30E7\u30F3": ["\u30B9\u30C8\u30C3\u30D7\u30E2\u30FC\u30B7\u30E7\u30F3", "\u30B3\u30DE\u64AE\u308A", "stop motion", "\u30AF\u30EC\u30A4\u30A2\u30CB\u30E1", "\u4EBA\u5F62\u30A2\u30CB\u30E1"],
  "\u30E1\u30BF\u30E2\u30EB\u30D5\u30A9\u30FC\u30BC": ["\u30E1\u30BF\u30E2\u30EB\u30D5\u30A9\u30FC\u30BC", "\u30E2\u30FC\u30D5", "\u30E2\u30FC\u30D5\u30A3\u30F3\u30B0", "\u5909\u8EAB", "\u5F62\u614B\u5909\u5316"],
  "\u30EF\u30F3\u30AB\u30C3\u30C8": ["\u30EF\u30F3\u30AB\u30C3\u30C8", "\u9577\u56DE\u3057", "one take", "\u30B7\u30FC\u30E0\u30EC\u30B9"],
  "\u97F3\u30CF\u30E1": ["\u97F3\u30CF\u30E1", "\u30D3\u30FC\u30C8\u30B7\u30F3\u30AF", "\u30EA\u30BA\u30E0\u7DE8\u96C6", "\u30D3\u30FC\u30C8\u306B\u5408\u308F\u305B", "\u30B7\u30F3\u30AF\u30ED"],
  "\u30AD\u30CD\u30C6\u30A3\u30C3\u30AF\u30BF\u30A4\u30DD\u30B0\u30E9\u30D5\u30A3": ["\u30AD\u30CD\u30C6\u30A3\u30C3\u30AF\u30BF\u30A4\u30DD\u30B0\u30E9\u30D5\u30A3", "\u30BF\u30A4\u30DD\u30B0\u30E9\u30D5\u30A3", "\u30E2\u30FC\u30B7\u30E7\u30F3\u30B0\u30E9\u30D5\u30A3\u30C3\u30AF\u30B9"],
  "\u30C8\u30E9\u30C3\u30AD\u30F3\u30B0": ["\u30C8\u30E9\u30C3\u30AD\u30F3\u30B0", "\u30AB\u30E1\u30E9\u30C8\u30E9\u30C3\u30AF", "\u8FFD\u5F93", "tracking"],
  "\u30C9\u30EA\u30FC": ["\u30C9\u30EA\u30FC", "\u30D7\u30C3\u30B7\u30E5\u30A4\u30F3", "\u30C8\u30E9\u30C3\u30AF\u30A4\u30F3", "\u30C9\u30EA\u30FC\u30A2\u30A6\u30C8", "dolly"],
  "\u624B\u6301\u3061": ["\u624B\u6301\u3061", "\u30CF\u30F3\u30C7\u30A3", "\u30CF\u30F3\u30C7\u30A3\u30AB\u30E1\u30E9", "handheld"],
  "\u30D5\u30A9\u30FC\u30AB\u30B9\u9001\u308A": ["\u30D5\u30A9\u30FC\u30AB\u30B9\u9001\u308A", "\u30E9\u30C3\u30AF\u30D5\u30A9\u30FC\u30AB\u30B9", "\u30D4\u30F3\u30C8\u79FB\u52D5", "\u30D4\u30F3\u30C8\u9001\u308A"],
  "\u753B\u9762\u5206\u5272": ["\u753B\u9762\u5206\u5272", "\u30B9\u30D7\u30EA\u30C3\u30C8\u30B9\u30AF\u30EA\u30FC\u30F3", "\u30DE\u30EB\u30C1\u753B\u9762", "split screen"],
  "vfx": ["vfx", "\u30B3\u30F3\u30DD\u30B8\u30C3\u30C8", "\u5408\u6210", "cg\u5408\u6210", "\u8996\u899A\u52B9\u679C"],
  "\u30B0\u30EA\u30C3\u30C1": ["\u30B0\u30EA\u30C3\u30C1", "\u30C7\u30FC\u30BF\u30E2\u30C3\u30B7\u30E5", "\u30C7\u30B8\u30BF\u30EB\u30CE\u30A4\u30BA", "\u8D70\u67FB\u7DDA", "glitch"],
  "\u30ED\u30C8\u30B9\u30B3\u30FC\u30D7": ["\u30ED\u30C8\u30B9\u30B3\u30FC\u30D7", "rotoscope", "\u30C8\u30EC\u30FC\u30B9"],
  "\u30BF\u30A4\u30E0\u30E9\u30D7\u30B9": ["\u30BF\u30A4\u30E0\u30E9\u30D7\u30B9", "\u30CF\u30A4\u30D1\u30FC\u30E9\u30D7\u30B9", "timelapse"],
  "\u30B8\u30E3\u30F3\u30D7\u30AB\u30C3\u30C8": ["\u30B8\u30E3\u30F3\u30D7\u30AB\u30C3\u30C8", "\u30AB\u30C3\u30C8\u5272\u308A", "jump cut"],
  "\u30BA\u30FC\u30E0": ["\u30BA\u30FC\u30E0", "\u30BA\u30FC\u30E0\u30A4\u30F3", "\u30BA\u30FC\u30E0\u30A2\u30A6\u30C8", "zoom"],
  "\u30B9\u30D4\u30FC\u30C9\u30E9\u30F3\u30D7": ["\u30B9\u30D4\u30FC\u30C9\u30E9\u30F3\u30D7", "\u7DE9\u6025", "speed ramp", "\u30B9\u30ED\u30FC\u30E2\u30FC\u30B7\u30E7\u30F3"]
};
var SCENE_CATEGORY_DEFINITIONS = [
  {
    id: "situation",
    name: "\u30B7\u30C1\u30E5\u30A8\u30FC\u30B7\u30E7\u30F3",
    icon: "\u{1F4CD}",
    seedWords: [
      "\u7A7A",
      "\u9752\u7A7A",
      "\u591C",
      "\u591C\u666F",
      "\u8857",
      "\u90FD\u4F1A",
      "\u30B9\u30C8\u30EA\u30FC\u30C8",
      "\u8DEF\u5730\u88CF",
      "\u90E8\u5C4B",
      "\u5BA4\u5185",
      "\u6D77",
      "\u6D77\u5CB8",
      "\u7802\u6D5C",
      "\u6C34\u9762",
      "\u96E8",
      "\u6C34\u6EF4",
      "\u96F2",
      "\u661F\u7A7A",
      "\u5B87\u5B99",
      "\u81EA\u7136",
      "\u68EE",
      "\u5915\u65E5",
      "\u5915\u66AE\u308C",
      "\u30B9\u30BF\u30B8\u30A2\u30E0",
      "\u5C4B\u4E0A",
      "\u30C8\u30F3\u30CD\u30EB",
      "\u99C5",
      "\u96FB\u8ECA",
      "\u968E\u6BB5"
    ]
  },
  {
    id: "technique",
    name: "\u6F14\u51FA\u6280\u6CD5\u30FB\u7DE8\u96C6",
    icon: "\u{1F3AC}",
    seedWords: [
      "\u30DE\u30C3\u30C1\u30AB\u30C3\u30C8",
      "\u30B8\u30E3\u30F3\u30D7\u30AB\u30C3\u30C8",
      "\u30EF\u30F3\u30AB\u30C3\u30C8",
      "\u30B9\u30D4\u30FC\u30C9\u30E9\u30F3\u30D7",
      "\u97F3\u30CF\u30E1",
      "\u30B9\u30C8\u30C3\u30D7\u30E2\u30FC\u30B7\u30E7\u30F3",
      "\u30E1\u30BF\u30E2\u30EB\u30D5\u30A9\u30FC\u30BC",
      "\u30ED\u30C8\u30B9\u30B3\u30FC\u30D7",
      "\u30AB\u30C3\u30C8\u30A2\u30A6\u30C8",
      "\u30BB\u30EB\u30EB\u30C3\u30AF",
      "\u30AD\u30CD\u30C6\u30A3\u30C3\u30AF\u30BF\u30A4\u30DD\u30B0\u30E9\u30D5\u30A3",
      "\u30E2\u30FC\u30B7\u30E7\u30F3\u30B0\u30E9\u30D5\u30A3\u30C3\u30AF\u30B9",
      "\u30B3\u30E9\u30FC\u30B8\u30E5",
      "3DCG",
      "VFX",
      "\u30B3\u30F3\u30DD\u30B8\u30C3\u30C8",
      "\u753B\u9762\u5206\u5272",
      "\u30C8\u30E9\u30C3\u30AD\u30F3\u30B0",
      "\u30C9\u30EA\u30FC",
      "\u624B\u6301\u3061",
      "\u30BA\u30FC\u30E0",
      "\u30ED\u30FC\u30A2\u30F3\u30B0\u30EB",
      "\u4FEF\u77B0",
      "\u30AF\u30ED\u30FC\u30BA\u30A2\u30C3\u30D7",
      "\u30D5\u30A9\u30FC\u30AB\u30B9\u9001\u308A",
      "\u88AB\u5199\u754C\u6DF1\u5EA6",
      "\u30B9\u30ED\u30FC\u30E2\u30FC\u30B7\u30E7\u30F3",
      "\u30BF\u30A4\u30E0\u30E9\u30D7\u30B9",
      "\u30B0\u30EA\u30C3\u30C1",
      "\u8272\u53CE\u5DEE",
      "\u30EF\u30A4\u30D7",
      "\u30D7\u30ED\u30B8\u30A7\u30AF\u30B7\u30E7\u30F3",
      "\u624B\u63CF\u304D",
      "\u30DF\u30CB\u30C1\u30E5\u30A2",
      "\u30B7\u30EB\u30A8\u30C3\u30C8",
      "\u9006\u5149",
      "\u30B9\u30C8\u30ED\u30DC"
    ]
  },
  {
    id: "visual",
    name: "\u6F14\u51FA\u30FB\u30AB\u30E1\u30E9\u30FBVFX",
    icon: "\u{1F3A5}",
    seedWords: [
      "\u5149",
      "\u9006\u5149",
      "\u30B9\u30C8\u30ED\u30DC",
      "\u30D5\u30E9\u30C3\u30B7\u30E5",
      "\u30A2\u30CB\u30E1\u30FC\u30B7\u30E7\u30F3",
      "\u624B\u63CF\u304D",
      "\u30C9\u30ED\u30FC\u30A4\u30F3\u30B0",
      "\u6587\u5B57",
      "\u30BF\u30A4\u30DD\u30B0\u30E9\u30D5\u30A3",
      "\u30E2\u30FC\u30B7\u30E7\u30F3\u30B0\u30E9\u30D5\u30A3\u30C3\u30AF\u30B9",
      "\u30B0\u30EA\u30C3\u30C1",
      "\u30CE\u30A4\u30BA",
      "\u8272\u53CE\u5DEE",
      "3DCG",
      "\u30BB\u30EB\u30EB\u30C3\u30AF",
      "\u30B7\u30EB\u30A8\u30C3\u30C8",
      "\u88AB\u5199\u754C\u6DF1\u5EA6",
      "\u30D4\u30F3\u30C8",
      "\u30B9\u30ED\u30FC\u30E2\u30FC\u30B7\u30E7\u30F3",
      "\u4FEF\u77B0",
      "\u30C9\u30ED\u30FC\u30F3",
      "\u4E07\u83EF\u93E1",
      "\u753B\u9762\u5206\u5272",
      "\u30B9\u30D7\u30EA\u30C3\u30C8\u30B9\u30AF\u30EA\u30FC\u30F3",
      "\u30B3\u30E9\u30FC\u30B8\u30E5",
      "\u30A2\u30A4\u30BD\u30E1\u30C8\u30EA\u30C3\u30AF",
      "\u5B9F\u5199"
    ]
  },
  {
    id: "action",
    name: "\u30A2\u30AF\u30B7\u30E7\u30F3\u30FB\u88AB\u5199\u4F53",
    icon: "\u26A1",
    seedWords: [
      "\u30C0\u30F3\u30B9",
      "\u7FA4\u821E",
      "\u30B9\u30C6\u30C3\u30D7",
      "\u8ECA",
      "\u30AF\u30E9\u30B7\u30C3\u30AF\u30AB\u30FC",
      "\u30C9\u30E9\u30A4\u30D6",
      "\u8D70\u884C",
      "\u8D70\u308B",
      "\u75BE\u8D70",
      "\u5973\u6027",
      "\u5C11\u5973",
      "\u7537\u6027",
      "\u76EE",
      "\u77B3",
      "\u6307\u5148",
      "\u708E",
      "\u706B\u82B1",
      "\u82B1\u706B",
      "\u7159",
      "\u30B9\u30E2\u30FC\u30AF",
      "\u82B1",
      "\u685C",
      "\u690D\u7269",
      "\u7D19\u5439\u96EA",
      "\u98A8\u8239",
      "\u6606\u866B",
      "\u30D0\u30B0",
      "\u81EA\u8EE2\u8ECA"
    ]
  },
  {
    id: "mood",
    name: "\u30E0\u30FC\u30C9\u30FB\u4E16\u754C\u89B3",
    icon: "\u{1F3A8}",
    seedWords: [
      "\u30DD\u30C3\u30D7",
      "\u30D1\u30B9\u30C6\u30EB",
      "\u53EF\u611B\u3044",
      "\u9759\u5BC2",
      "\u30DF\u30CB\u30DE\u30EB",
      "\u30A8\u30E2\u30FC\u30B7\u30E7\u30CA\u30EB",
      "\u795D\u796D",
      "\u591A\u5E78\u611F",
      "\u30EC\u30C8\u30ED",
      "\u30B7\u30CD\u30DE\u30C6\u30A3\u30C3\u30AF",
      "\u30C0\u30FC\u30AF",
      "\u72C2\u6C17",
      "\u4E0D\u6C17\u5473",
      "\u30B5\u30A4\u30D0\u30FC\u30D1\u30F3\u30AF",
      "\u5E7B\u60F3\u7684",
      "\u30CE\u30B9\u30BF\u30EB\u30B8\u30FC"
    ]
  },
  {
    id: "music",
    name: "\u97F3\u697D\u30FB\u30B5\u30A6\u30F3\u30C9",
    icon: "\u{1F3B5}",
    seedWords: [
      "\u30D3\u30FC\u30C8",
      "\u30AD\u30C3\u30AF",
      "\u30AE\u30BF\u30FC",
      "\u30D4\u30A2\u30CE",
      "\u30A2\u30B3\u30FC\u30B9\u30C6\u30A3\u30C3\u30AF",
      "\u30E9\u30C3\u30D7",
      "\u521D\u97F3\u30DF\u30AF",
      "\u5408\u5531",
      "\u30A6\u30A3\u30B9\u30D1\u30FC\u30DC\u30A4\u30B9",
      "\u30D5\u30E5\u30FC\u30C1\u30E3\u30FC\u30D9\u30FC\u30B9",
      "\u30D9\u30FC\u30B9\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF",
      "\u30DC\u30AB\u30ED",
      "VTuber"
    ]
  }
];
function parseQueryWords(query) {
  if (!query) return [];
  return query.trim().split(/[\s,、。!！?？#+＋]+/).map((w) => w.trim()).filter((w) => w.length > 0);
}
function getSynonymsForWord(word) {
  const normalized = word.trim().toLowerCase();
  if (!normalized) return [];
  const set = /* @__PURE__ */ new Set([normalized]);
  for (const [key, syns] of Object.entries(SCENE_SYNONYM_MAP)) {
    const keyLower = key.toLowerCase();
    if (normalized.includes(keyLower) || keyLower.includes(normalized)) {
      syns.forEach((s) => set.add(s.toLowerCase()));
    }
  }
  return Array.from(set);
}

// shared/analysisVersion.ts
function normalizeAnalysisVersion(value) {
  return value === "v3" ? "v3" : "legacy";
}

// shared/calibratedScoreAxes.ts
var CALIBRATED_AXIS_KEYS = [
  "direction",
  "visual_craft",
  "editing_rhythm",
  "sound_integration",
  "originality_finish"
];
function roundScore2(value) {
  return Math.round(value * 100) / 100;
}
function parseAxesRecord(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw;
  const out = {};
  for (const key of CALIBRATED_AXIS_KEYS) {
    const val = Number(record[key]);
    if (!Number.isFinite(val) || val < 0 || val > 20) return null;
    out[key] = roundScore2(val);
  }
  return out;
}
function parseCalibratedScoreAxes(raw) {
  if (raw === null || raw === void 0 || raw === "") return null;
  let obj = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const rec = obj;
  const axes = parseAxesRecord(rec.axes);
  if (!axes) return null;
  const runs = Number(rec.runs);
  const offsetPerAxis = Number(rec.offsetPerAxis ?? 0);
  const source = rec.source === "api" ? "api" : "phase3";
  const ensembleRule = rec.ensembleRule === "mean_of_2" || rec.ensembleRule === "median_of_3_median_run" || rec.ensembleRule === "median_of_3_mean" ? rec.ensembleRule : void 0;
  return {
    v: 1,
    axes,
    runs: Number.isFinite(runs) && runs > 0 ? Math.round(runs) : 2,
    source,
    offsetPerAxis: Number.isFinite(offsetPerAxis) ? roundScore2(offsetPerAxis) : 0,
    ...ensembleRule ? { ensembleRule } : {}
  };
}

// server/db.ts
var _db = null;
var _pool = null;
function createMysqlPool(databaseUrl) {
  const needsTls = /tidbcloud\.com|psdb\.cloud|aivencloud\.com/i.test(databaseUrl) || process.env.MYSQL_SSL === "true" || /[?&]ssl=/i.test(databaseUrl);
  return mysql.createPool({
    uri: databaseUrl,
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_POOL_LIMIT ?? 5),
    queueLimit: 0,
    enableKeepAlive: true,
    ...needsTls ? { ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true } } : {}
  });
}
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _pool = createMysqlPool(process.env.DATABASE_URL);
      _db = drizzle(_pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
async function upsertUser(user) {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values = {
      openId: user.openId
    };
    const updateSet = {};
    const textFields = ["name", "email", "loginMethod"];
    const assignNullable = (field) => {
      const value = user[field];
      if (value === void 0) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== void 0) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== void 0) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) {
      values.lastSignedIn = /* @__PURE__ */ new Date();
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = /* @__PURE__ */ new Date();
    }
    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return void 0;
  }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getAllVideoListItems() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: videos.id,
    platform: videos.platform,
    title: videos.title,
    thumbnail: videos.thumbnail,
    videoUrl: videos.videoUrl,
    embedUrl: videos.embedUrl,
    source: videos.source,
    sourceLabel: videos.sourceLabel,
    channelId: videos.channelId,
    channelTitle: videos.channelTitle,
    genres: videos.genres,
    products: videos.products,
    directions: videos.directions,
    tones: videos.tones,
    allTags: videos.allTags,
    purposes: videos.purposes,
    expressions: videos.expressions,
    toneEmotions: videos.toneEmotions,
    toneVisuals: videos.toneVisuals,
    toneTechniques: videos.toneTechniques,
    productions: videos.productions,
    productionCredits: videos.productionCredits,
    awards: videos.awards,
    curationNote: videos.curationNote,
    privateRating: videos.privateRating,
    aiOverallRating: videos.aiOverallRating,
    aiDirectionRating: videos.aiDirectionRating,
    aiTechniqueRating: videos.aiTechniqueRating,
    aiOverallScore: videos.aiOverallScore,
    aiDirectionScore: videos.aiDirectionScore,
    aiTechniqueScore: videos.aiTechniqueScore,
    calibrationStatus: videos.calibrationStatus,
    calibratedScore: videos.calibratedScore,
    calibratedRank: videos.calibratedRank,
    calibratedTierBand: videos.calibratedTierBand,
    calibratedScoreAxes: videos.calibratedScoreAxes,
    calibrationVersion: videos.calibrationVersion,
    calibratedAt: videos.calibratedAt,
    calibratedRoute: videos.calibratedRoute,
    calibratedRunId: videos.calibratedRunId,
    calibrationGenreBucket: videos.calibrationGenreBucket,
    analysisObservationScope: videos.analysisObservationScope,
    analysisVersion: videos.analysisVersion,
    analysisGeneratedAt: videos.analysisGeneratedAt,
    analysisPromptSha256: videos.analysisPromptSha256,
    embedStatus: videos.embedStatus,
    embedReason: videos.embedReason,
    embedCheckedAt: videos.embedCheckedAt,
    addedDate: videos.addedDate,
    createdAt: videos.createdAt,
    updatedAt: videos.updatedAt,
    isProvisional: sql`CASE WHEN ${videos.aiScoreBreakdown} LIKE '%"analysisStatus":"provisional"%' OR ${videos.aiScoreBreakdown} LIKE '%"isProvisional":true%' THEN 1 ELSE 0 END`,
    gradeBoundary: sql`CASE WHEN ${videos.aiScoreBreakdown} LIKE '%"gradeBoundary":true%' THEN 1 ELSE 0 END`,
    visualVerificationStatus: sql`CASE WHEN ${videos.aiScoreBreakdown} LIKE '%"visualVerificationStatus":"log_verified"%' THEN 'log_verified' WHEN ${videos.aiScoreBreakdown} LIKE '%"visualVerificationStatus":"unverifiable_no_log"%' THEN 'unverifiable_no_log' WHEN ${videos.aiScoreBreakdown} LIKE '%"visualVerificationStatus":"unverified_pending"%' THEN 'unverified_pending' WHEN ${videos.aiScoreBreakdown} LIKE '%"visualVerificationStatus":"invalidated_no_visual"%' THEN 'invalidated_no_visual' ELSE 'not_audited' END`
  }).from(videos).orderBy(desc(videos.createdAt));
  return rows.map((row) => {
    const { isProvisional, gradeBoundary, visualVerificationStatus, ...rest } = row;
    const video = parseVideoRow({
      ...rest,
      aiAnalysis: null,
      aiScoreBreakdown: null,
      calibratedBreakdown: null,
      metadataClassificationAudit: null
    });
    return {
      ...video,
      isProvisional: Boolean(isProvisional),
      gradeBoundary: Boolean(gradeBoundary),
      visualVerificationStatus: visualVerificationStatus || "not_audited",
      aiAnalysis: "",
      aiScoreBreakdown: void 0,
      calibratedBreakdown: void 0,
      metadataClassificationAudit: void 0
    };
  });
}
async function getVideoCount() {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db.select({ count: sql`COUNT(*)` }).from(videos);
  return Number(row?.count ?? 0);
}
async function getVideoById(id) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(videos).where(eq(videos.id, id)).limit(1);
  return row ? parseVideoRow(row) : null;
}
async function createVideo(input) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(videos).values(input);
  return getVideoById(input.id);
}
async function updateVideo(id, input) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(videos).set(input).where(eq(videos.id, id));
  return getVideoById(id);
}
async function updateMetadataClassificationIfMatching(identity, input) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(videos).set(input).where(and(eq(videos.id, identity.id), eq(videos.title, identity.title), eq(videos.videoUrl, identity.videoUrl)));
  return getVideoById(identity.id);
}
async function deleteVideo(id) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(videos).where(eq(videos.id, id));
}
async function updateEmbedStatus(id, status) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(videos).set({
    embedStatus: status,
    embedReason: status === "available" ? null : "unavailable_embed_restricted",
    embedCheckedAt: /* @__PURE__ */ new Date()
  }).where(eq(videos.id, id));
  return getVideoById(id);
}
async function listFavoriteProfiles() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(favoriteProfiles).orderBy(asc(favoriteProfiles.displayName));
}
async function getFavoriteProfileById(id) {
  const db = await getDb();
  if (!db) return null;
  const [profile] = await db.select().from(favoriteProfiles).where(eq(favoriteProfiles.id, id)).limit(1);
  return profile ?? null;
}
async function getFavoriteProfileByNormalizedName(normalizedName) {
  const db = await getDb();
  if (!db) return null;
  const [profile] = await db.select().from(favoriteProfiles).where(eq(favoriteProfiles.normalizedName, normalizedName)).limit(1);
  return profile ?? null;
}
async function createFavoriteProfile(displayName) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const cleanName = cleanFavoriteDisplayName(displayName);
  const profile = {
    id: crypto.randomUUID(),
    displayName: cleanName,
    normalizedName: normalizeFavoriteProfileName(cleanName)
  };
  await db.insert(favoriteProfiles).values(profile);
  return getFavoriteProfileById(profile.id);
}
async function renameFavoriteProfile(id, displayName) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const cleanName = cleanFavoriteDisplayName(displayName);
  await db.update(favoriteProfiles).set({
    displayName: cleanName,
    normalizedName: normalizeFavoriteProfileName(cleanName)
  }).where(eq(favoriteProfiles.id, id));
  return getFavoriteProfileById(id);
}
async function deleteFavoriteProfile(id) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(profileVideoFavorites).where(eq(profileVideoFavorites.profileId, id));
  await db.delete(profileCreatorFavorites).where(eq(profileCreatorFavorites.profileId, id));
  await db.delete(favoriteProfiles).where(eq(favoriteProfiles.id, id));
}
async function getFavoriteProfileItems(profileId) {
  const db = await getDb();
  if (!db) return { videoIds: [], creatorNames: [] };
  const [videoRows, creatorRows] = await Promise.all([
    db.select({ videoId: profileVideoFavorites.videoId }).from(profileVideoFavorites).where(eq(profileVideoFavorites.profileId, profileId)).orderBy(desc(profileVideoFavorites.createdAt)),
    db.select({ creatorName: profileCreatorFavorites.creatorName }).from(profileCreatorFavorites).where(eq(profileCreatorFavorites.profileId, profileId)).orderBy(asc(profileCreatorFavorites.creatorName))
  ]);
  return {
    videoIds: videoRows.map((row) => row.videoId),
    creatorNames: creatorRows.map((row) => row.creatorName)
  };
}
async function toggleFavoriteProfileVideo(profileId, videoId) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [existing] = await db.select({ id: profileVideoFavorites.id }).from(profileVideoFavorites).where(and(eq(profileVideoFavorites.profileId, profileId), eq(profileVideoFavorites.videoId, videoId))).limit(1);
  if (existing) {
    await db.delete(profileVideoFavorites).where(eq(profileVideoFavorites.id, existing.id));
    return { isFavorite: false };
  }
  await db.insert(profileVideoFavorites).values({ profileId, videoId });
  return { isFavorite: true };
}
async function toggleFavoriteProfileCreator(profileId, creatorName) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const cleanName = cleanFavoriteDisplayName(creatorName);
  const normalizedCreatorName = normalizeFavoriteCreatorName(cleanName);
  const [existing] = await db.select({ id: profileCreatorFavorites.id }).from(profileCreatorFavorites).where(and(
    eq(profileCreatorFavorites.profileId, profileId),
    eq(profileCreatorFavorites.normalizedCreatorName, normalizedCreatorName)
  )).limit(1);
  if (existing) {
    await db.delete(profileCreatorFavorites).where(eq(profileCreatorFavorites.id, existing.id));
    return { isFavorite: false };
  }
  await db.insert(profileCreatorFavorites).values({ profileId, creatorName: cleanName, normalizedCreatorName });
  return { isFavorite: true };
}
async function mergeLegacyFavoritesIntoProfile(profileId, videoIds, creatorNames) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await getFavoriteProfileById(profileId);
  if (!existing) throw new Error("Favorite profile not found");
  for (const videoId of Array.from(new Set(videoIds))) {
    const [current] = await db.select({ id: profileVideoFavorites.id }).from(profileVideoFavorites).where(and(eq(profileVideoFavorites.profileId, profileId), eq(profileVideoFavorites.videoId, videoId))).limit(1);
    if (!current) await db.insert(profileVideoFavorites).values({ profileId, videoId });
  }
  for (const creatorName of Array.from(new Set(creatorNames.map(cleanFavoriteDisplayName).filter(Boolean)))) {
    const normalizedCreatorName = normalizeFavoriteCreatorName(creatorName);
    const [current] = await db.select({ id: profileCreatorFavorites.id }).from(profileCreatorFavorites).where(and(
      eq(profileCreatorFavorites.profileId, profileId),
      eq(profileCreatorFavorites.normalizedCreatorName, normalizedCreatorName)
    )).limit(1);
    if (!current) await db.insert(profileCreatorFavorites).values({ profileId, creatorName, normalizedCreatorName });
  }
  return getFavoriteProfileItems(profileId);
}
function parseVideoRow(row) {
  const legacyProductions = safeParseJson(row.productions, []);
  const productionCredits = normalizeProductionCredits(
    safeParseJson(row.productionCredits, []),
    legacyProductions
  );
  const productions = getProductionNames(productionCredits);
  const allTags = Array.from(/* @__PURE__ */ new Set([
    ...safeParseJson(row.allTags, []),
    ...productions,
    ...getProductionRoles(productionCredits)
  ]));
  return {
    id: row.id,
    platform: row.platform,
    title: row.title,
    thumbnail: row.thumbnail ?? "",
    videoUrl: row.videoUrl,
    embedUrl: row.embedUrl ?? "",
    source: row.source ?? "",
    sourceLabel: row.sourceLabel ?? "",
    channelId: row.channelId ?? "",
    channelTitle: row.channelTitle ?? "",
    genres: safeParseJson(row.genres, []),
    products: safeParseJson(row.products, []),
    directions: safeParseJson(row.directions, []),
    tones: safeParseJson(row.tones, []),
    allTags,
    purposes: safeParseJson(row.purposes, []),
    expressions: safeParseJson(row.expressions, []),
    toneEmotions: safeParseJson(row.toneEmotions, []),
    toneVisuals: safeParseJson(row.toneVisuals, []),
    toneTechniques: safeParseJson(row.toneTechniques, []),
    productions,
    productionCredits,
    awards: safeParseJson(row.awards, []),
    curationNote: safeParseJson(row.curationNote, { purpose: "", background: "", evaluation: "", sourceUrls: [] }),
    metadataClassificationAudit: safeParseJson(row.metadataClassificationAudit, void 0),
    privateRating: row.privateRating ?? "",
    aiOverallRating: row.aiOverallRating ?? "",
    aiDirectionRating: row.aiDirectionRating ?? "",
    aiTechniqueRating: row.aiTechniqueRating ?? "",
    aiOverallScore: row.aiOverallScore ?? null,
    aiDirectionScore: row.aiDirectionScore ?? null,
    aiTechniqueScore: row.aiTechniqueScore ?? null,
    aiScoreBreakdown: safeParseJson(row.aiScoreBreakdown, void 0),
    aiAnalysis: row.aiAnalysis ?? "",
    calibrationStatus: row.calibrationStatus ?? (row.aiOverallScore !== null || row.aiOverallRating ? "legacy_uncalibrated" : "unscored"),
    calibratedScore: row.calibratedScore !== null && row.calibratedScore !== void 0 ? Number(row.calibratedScore) : null,
    calibratedRank: row.calibratedRank ?? null,
    calibratedTierBand: row.calibratedTierBand ?? null,
    calibratedBreakdown: safeParseJson(row.calibratedBreakdown, void 0),
    calibratedScoreAxes: parseCalibratedScoreAxes(row.calibratedScoreAxes),
    calibrationVersion: row.calibrationVersion ?? null,
    calibratedAt: row.calibratedAt ? row.calibratedAt.toISOString() : null,
    calibratedRoute: row.calibratedRoute ?? null,
    calibratedRunId: row.calibratedRunId ?? null,
    calibrationGenreBucket: row.calibrationGenreBucket ?? null,
    analysisObservationScope: row.analysisObservationScope ?? null,
    analysisVersion: normalizeAnalysisVersion(row.analysisVersion),
    analysisGeneratedAt: row.analysisGeneratedAt instanceof Date ? row.analysisGeneratedAt.toISOString() : typeof row.analysisGeneratedAt === "string" ? row.analysisGeneratedAt : null,
    analysisPromptSha256: row.analysisPromptSha256 ?? null,
    isProvisional: isProvisionalFromBreakdown(row.aiScoreBreakdown),
    gradeBoundary: isGradeBoundaryFromBreakdown(row.aiScoreBreakdown),
    visualVerificationStatus: getVisualVerificationStatus(row.aiScoreBreakdown),
    embedStatus: row.embedStatus ?? "unknown",
    embedReason: row.embedReason ?? "",
    embedCheckedAt: row.embedCheckedAt?.toISOString() ?? "",
    addedDate: row.addedDate ?? "",
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : typeof row.createdAt === "string" ? row.createdAt : null
  };
}
function isProvisionalFromBreakdown(aiScoreBreakdown) {
  const bd = safeParseJson(aiScoreBreakdown, null);
  if (!bd) return false;
  return bd.analysisStatus === "provisional" || bd.isProvisional === true;
}
function isGradeBoundaryFromBreakdown(aiScoreBreakdown) {
  const bd = safeParseJson(aiScoreBreakdown, null);
  return bd?.gradeBoundary === true;
}
function getVisualVerificationStatus(aiScoreBreakdown) {
  const bd = safeParseJson(aiScoreBreakdown, null);
  const v = bd?.visualVerificationStatus;
  if (v === "log_verified" || v === "unverifiable_no_log" || v === "unverified_pending" || v === "invalidated_no_visual") {
    return v;
  }
  return "not_audited";
}
function safeParseJson(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
function isMissingVideoScenesTableError(error) {
  if (!error || typeof error !== "object") return false;
  const err = error;
  if (err.code === "ER_NO_SUCH_TABLE" || err.errno === 1146) return true;
  const msg = String(err.message ?? "");
  if (/ER_NO_SUCH_TABLE|1146|videoScenes.*doesn't exist|Table .*videoScenes/i.test(msg)) {
    return true;
  }
  if (err.cause && err.cause !== error) {
    return isMissingVideoScenesTableError(err.cause);
  }
  return false;
}
function buildVideoSceneFilterWhere(params) {
  const clauses = [
    "(v.embedReason IS NULL OR v.embedReason NOT IN ('unavailable_deleted', 'unavailable_private'))"
  ];
  const whereParams = [];
  if (params.excludeUnwatched !== false) {
    clauses.push("v.analysisObservationScope IS NULL");
  }
  if (params.excludeLegacyAnalysis) {
    clauses.push("s.analysisVersion = 'v3'");
  }
  const scoreFilter = params.scoreFilter ?? "all";
  if (scoreFilter === "calibrated_only") {
    clauses.push("v.calibratedScore IS NOT NULL");
  } else if (scoreFilter === "score_78_plus") {
    clauses.push("v.calibratedScore IS NOT NULL AND v.calibratedScore >= 78");
  } else if (scoreFilter === "score_83_plus") {
    clauses.push("v.calibratedScore IS NOT NULL AND v.calibratedScore >= 83");
  } else if (scoreFilter === "uncalibrated_only") {
    clauses.push("v.calibratedScore IS NULL");
  }
  const words = parseQueryWords(params.query ?? "").slice(0, 5);
  const wordGroups = words.map((w) => getSynonymsForWord(w).slice(0, 12)).filter((g) => g.length > 0);
  for (const group of wordGroups) {
    const orParts = group.map(() => "s.searchText LIKE ?");
    clauses.push(`(${orParts.join(" OR ")})`);
    for (const term of group) {
      whereParams.push(`%${term.replace(/[%_\\]/g, "\\$&")}%`);
    }
  }
  return {
    whereSql: clauses.join(" AND "),
    whereParams,
    wordGroups
  };
}
function buildThumbnailUrl(platform, videoId, storedThumbnail) {
  if (storedThumbnail && storedThumbnail.trim()) return storedThumbnail.trim();
  if (platform === "youtube") return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  return "";
}
async function searchVideoScenes(params) {
  const pool = params.poolOverride ?? (await getDb(), _pool);
  if (!pool) {
    return {
      available: false,
      source: "table_unavailable",
      items: [],
      total: 0,
      hasMore: false,
      totalIndexedScenes: 0,
      totalIndexedVideos: 0
    };
  }
  const limit = Math.max(1, Math.min(80, Math.floor(params.limit ?? 40)));
  const offset = Math.max(0, Math.min(5e3, Math.floor(params.offset ?? 0)));
  const { whereSql, whereParams, wordGroups } = buildVideoSceneFilterWhere({
    query: params.query,
    excludeUnwatched: params.excludeUnwatched,
    excludeLegacyAnalysis: params.excludeLegacyAnalysis,
    scoreFilter: params.scoreFilter
  });
  try {
    const [[totalsRow]] = await pool.query(
      "SELECT COUNT(*) AS totalScenes, COUNT(DISTINCT videoId) AS totalVideos FROM videoScenes"
    );
    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) AS cnt
       FROM videoScenes s
       INNER JOIN videos v ON v.id = s.videoId
       WHERE ${whereSql}`,
      whereParams
    );
    const total = Number(countRow?.cnt ?? 0);
    if (total === 0) {
      return {
        available: true,
        source: "tidb",
        items: [],
        total: 0,
        hasMore: false,
        totalIndexedScenes: Number(totalsRow?.totalScenes ?? 0),
        totalIndexedVideos: Number(totalsRow?.totalVideos ?? 0)
      };
    }
    const [rows] = await pool.query(
      `SELECT
        s.id,
        s.videoId,
        s.shotIndex,
        s.startMmss,
        s.endMmss,
        s.startSec,
        s.endSec,
        s.shotTitle,
        s.description,
        s.audioText,
        s.keywordsJson,
        s.analysisVersion,
        s.analysisGeneratedAt,
        v.title AS videoTitle,
        v.platform,
        v.thumbnail,
        v.analysisObservationScope,
        v.calibratedScore,
        v.calibratedRank,
        v.aiOverallScore,
        v.aiOverallRating
       FROM videoScenes s
       INNER JOIN videos v ON v.id = s.videoId
       WHERE ${whereSql}
       ORDER BY (v.calibratedScore IS NOT NULL) DESC, COALESCE(v.calibratedScore, -1) DESC, s.id ASC
       LIMIT ? OFFSET ?`,
      [...whereParams, limit, offset]
    );
    const items = rows.map((row) => {
      const videoId = String(row.videoId ?? "");
      const platform = String(row.platform ?? "youtube");
      const shotIndex = Number(row.shotIndex ?? 1);
      const shotTitle = String(row.shotTitle ?? "").trim();
      const description = String(row.description ?? "").trim();
      const visual = shotTitle && description && !description.startsWith(shotTitle) ? `${shotTitle} \u2014 ${description}` : description || shotTitle;
      const audio = String(row.audioText ?? "").trim();
      const keywords = safeParseJson(row.keywordsJson, []);
      const videoTitle = String(row.videoTitle ?? "");
      const matchedTermsSet = /* @__PURE__ */ new Set();
      let score = wordGroups.length === 0 ? 1 : 0;
      const visualLower = visual.toLowerCase();
      const audioLower = audio.toLowerCase();
      const titleLower = videoTitle.toLowerCase();
      const kwLower = keywords.map((k) => k.toLowerCase());
      for (const group of wordGroups) {
        let groupScore = 0;
        for (const token of group) {
          let hit = false;
          if (visualLower.includes(token)) {
            groupScore = Math.max(groupScore, 15);
            hit = true;
          }
          if (kwLower.some((k) => k.includes(token) || token.includes(k))) {
            groupScore = Math.max(groupScore, 10);
            hit = true;
          }
          if (audioLower.includes(token)) {
            groupScore = Math.max(groupScore, 8);
            hit = true;
          }
          if (titleLower.includes(token)) {
            groupScore = Math.max(groupScore, 5);
            hit = true;
          }
          if (hit) matchedTermsSet.add(token);
        }
        score += groupScore;
      }
      const startSec = Number(row.startSec ?? 0);
      const endSec = Number(row.endSec ?? 0);
      const startMmss = String(row.startMmss ?? "00:00");
      const endMmss = String(row.endMmss ?? "00:00");
      return {
        scene: {
          id: `${videoId}_s${String(shotIndex).padStart(2, "0")}`,
          videoId,
          videoTitle,
          platform,
          sceneNumber: shotIndex,
          startSeconds: startSec,
          endSeconds: endSec,
          timeRange: `${startMmss} - ${endMmss}`,
          visual,
          audio,
          keywords,
          thumbnailUrl: buildThumbnailUrl(platform, videoId, row.thumbnail ?? null),
          analysisObservationScope: row.analysisObservationScope ?? null,
          analysisVersion: normalizeAnalysisVersion(row.analysisVersion),
          analysisGeneratedAt: row.analysisGeneratedAt instanceof Date ? row.analysisGeneratedAt.toISOString() : typeof row.analysisGeneratedAt === "string" ? row.analysisGeneratedAt : null,
          calibratedScore: row.calibratedScore != null ? Number(row.calibratedScore) : null,
          calibratedRank: row.calibratedRank ?? null,
          aiOverallScore: row.aiOverallScore != null ? Number(row.aiOverallScore) : null,
          aiOverallRating: row.aiOverallRating ?? null
        },
        score: score || 1,
        matchedTerms: Array.from(matchedTermsSet)
      };
    });
    if (wordGroups.length > 0) {
      items.sort((a, b) => b.score - a.score);
    }
    return {
      available: true,
      source: "tidb",
      items,
      total,
      hasMore: offset + items.length < total,
      totalIndexedScenes: Number(totalsRow?.totalScenes ?? 0),
      totalIndexedVideos: Number(totalsRow?.totalVideos ?? 0)
    };
  } catch (error) {
    if (isMissingVideoScenesTableError(error)) {
      return {
        available: false,
        source: "table_unavailable",
        items: [],
        total: 0,
        hasMore: false,
        totalIndexedScenes: 0,
        totalIndexedVideos: 0
      };
    }
    throw error;
  }
}
async function getVideoSceneKeywordStats(params) {
  const pool = params.poolOverride ?? (await getDb(), _pool);
  if (!pool) {
    return {
      available: false,
      source: "table_unavailable",
      totalScenes: 0,
      totalVideos: 0,
      categories: []
    };
  }
  const { whereSql, whereParams } = buildVideoSceneFilterWhere({
    excludeUnwatched: params.excludeUnwatched,
    excludeLegacyAnalysis: params.excludeLegacyAnalysis,
    scoreFilter: params.scoreFilter
  });
  try {
    const [rows] = await pool.query(
      `SELECT s.videoId, s.searchText
       FROM videoScenes s
       INNER JOIN videos v ON v.id = s.videoId
       WHERE ${whereSql}`,
      whereParams
    );
    const videoIds = /* @__PURE__ */ new Set();
    const texts = [];
    for (const r of rows) {
      videoIds.add(String(r.videoId));
      texts.push(String(r.searchText ?? "").toLowerCase());
    }
    const categories = SCENE_CATEGORY_DEFINITIONS.map((cat) => {
      const validKeywords = [];
      for (const word of cat.seedWords) {
        const terms = getSynonymsForWord(word);
        let matchCount = 0;
        for (let i = 0; i < texts.length; i++) {
          if (terms.some((term) => texts[i].includes(term))) {
            matchCount++;
          }
        }
        if (matchCount >= 2) {
          validKeywords.push({ text: word, count: matchCount });
        }
      }
      validKeywords.sort((a, b) => b.count - a.count);
      return {
        id: cat.id,
        name: cat.name,
        icon: cat.icon,
        keywords: validKeywords
      };
    });
    return {
      available: true,
      source: "tidb",
      totalScenes: rows.length,
      totalVideos: videoIds.size,
      categories
    };
  } catch (error) {
    if (isMissingVideoScenesTableError(error)) {
      return {
        available: false,
        source: "table_unavailable",
        totalScenes: 0,
        totalVideos: 0,
        categories: []
      };
    }
    throw error;
  }
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var CRON_OPEN_ID_PREFIX = "cron_";
function buildCronUser(userInfo) {
  const now = /* @__PURE__ */ new Date();
  return {
    id: -1,
    openId: userInfo.openId,
    name: userInfo.name || "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    taskUid: userInfo.taskUid ?? void 0,
    isCron: true
  };
}
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    const redirectUri = atob(state);
    return redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
      if (!userInfo.taskUid) throw ForbiddenError("Cron session missing task_uid");
      return buildCronUser(userInfo);
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var sdk = new SDKServer();

// server/_core/trpc.ts
import { initTRPC, TRPCError } from "@trpc/server";
import { timingSafeEqual } from "node:crypto";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var ADMIN_WRITE_ERR_MSG = "ADMIN_KEY_REQUIRED: \u7BA1\u7406\u8005\u307E\u305F\u306F @atsu-maru.co.jp \u30A2\u30AB\u30A6\u30F3\u30C8\u3067\u306E\u30ED\u30B0\u30A4\u30F3\u304C\u5FC5\u8981\u3067\u3059";
var ALLOWED_EDITOR_EMAIL_DOMAIN = "@atsu-maru.co.jp";
function isAllowedEditorUser(user) {
  if (!user) return false;
  if (user.role === "admin") return true;
  const email = (user.email ?? "").trim().toLowerCase();
  return email.length > ALLOWED_EDITOR_EMAIL_DOMAIN.length && email.endsWith(ALLOWED_EDITOR_EMAIL_DOMAIN);
}
function extractAdminToken(req) {
  const headerKey = req.headers["x-admin-api-key"];
  if (typeof headerKey === "string" && headerKey.trim()) {
    return headerKey.trim();
  }
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  return "";
}
function safeTokenMatch(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
var writeProtectedProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (isAllowedEditorUser(ctx.user)) {
      return next();
    }
    const expectedKey = (process.env.ADMIN_API_KEY ?? "").trim();
    const providedKey = extractAdminToken(ctx.req);
    if (expectedKey && safeTokenMatch(providedKey, expectedKey)) {
      return next();
    }
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ADMIN_WRITE_ERR_MSG
    });
  })
);
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app2) {
  app2.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      const email = (userInfo.email ?? "").trim().toLowerCase();
      const isOwner = Boolean(ENV.ownerOpenId && userInfo.openId === ENV.ownerOpenId);
      const isAllowedDomain = email.length > ALLOWED_EDITOR_EMAIL_DOMAIN.length && email.endsWith(ALLOWED_EDITOR_EMAIL_DOMAIN);
      if (!isOwner && !isAllowedDomain) {
        res.status(403).json({
          error: "ACCESS_DENIED: \u7BA1\u7406\u8005\u307E\u305F\u306F @atsu-maru.co.jp \u30A2\u30AB\u30A6\u30F3\u30C8\u306E\u307F\u30ED\u30B0\u30A4\u30F3\u3067\u304D\u307E\u3059\u3002"
        });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError as TRPCError2 } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError2({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError2({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError2({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError2({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError2({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError2({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/externalMediaMetadata.ts
var USER_AGENT = "Mozilla/5.0 (compatible; IketeruVideoCollection/1.0; metadata preview)";
var ALLOWED_DOMAINS = {
  x: ["x.com", "twitter.com", "mobile.twitter.com"],
  tiktok: ["tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com", "m.tiktok.com"],
  instagram: ["instagram.com", "www.instagram.com"],
  vimeo: ["vimeo.com", "www.vimeo.com", "player.vimeo.com"]
};
function assertAllowedExternalMediaUrl(platform, rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("\u4E0D\u6B63\u306AURL\u5F62\u5F0F\u3067\u3059");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("HTTPS\u4EE5\u5916\u306EURL\u306F\u8A31\u53EF\u3055\u308C\u3066\u3044\u307E\u305B\u3093");
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) || host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    throw new Error("\u30D7\u30E9\u30A4\u30D9\u30FC\u30C8IP\u307E\u305F\u306F\u30ED\u30FC\u30AB\u30EB\u30DB\u30B9\u30C8\u3078\u306E\u30A2\u30AF\u30BB\u30B9\u306F\u7981\u6B62\u3055\u308C\u3066\u3044\u307E\u3059");
  }
  const allowed = ALLOWED_DOMAINS[platform] ?? [];
  const isAllowed = allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));
  if (!isAllowed) {
    throw new Error(`\u8A31\u53EF\u3055\u308C\u3066\u3044\u306A\u3044\u30C9\u30E1\u30A4\u30F3\u3067\u3059 (${host})`);
  }
  return parsed;
}
function decodeHtml(value) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function metaContent(html, key) {
  const tags = html.match(/<meta\s+[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const property = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (property !== key.toLowerCase()) continue;
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (content) return decodeHtml(content).trim();
  }
  return "";
}
async function fetchOpenGraph(platform, url) {
  const safeUrl = assertAllowedExternalMediaUrl(platform, url);
  const response = await fetch(safeUrl.toString(), {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    redirect: "manual",
    signal: AbortSignal.timeout(8e3)
  });
  if (response.status >= 300 && response.status < 400) {
    const loc = response.headers.get("location");
    if (!loc) throw new Error("\u30EA\u30C0\u30A4\u30EC\u30AF\u30C8\u5148\u304C\u4E0D\u660E\u3067\u3059");
    const nextUrl = assertAllowedExternalMediaUrl(platform, new URL(loc, safeUrl).toString());
    const redirected = await fetch(nextUrl.toString(), {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      redirect: "error",
      signal: AbortSignal.timeout(8e3)
    });
    if (!redirected.ok) throw new Error(`\u516C\u958B\u30DA\u30FC\u30B8\u53D6\u5F97\u30A8\u30E9\u30FC (${redirected.status})`);
    const html2 = (await redirected.text()).slice(0, 2e6);
    return {
      title: metaContent(html2, "og:title") || metaContent(html2, "twitter:title"),
      thumbnail: metaContent(html2, "og:image") || metaContent(html2, "twitter:image"),
      channelTitle: metaContent(html2, "og:site_name")
    };
  }
  if (!response.ok) throw new Error(`\u516C\u958B\u30DA\u30FC\u30B8\u53D6\u5F97\u30A8\u30E9\u30FC (${response.status})`);
  const html = (await response.text()).slice(0, 2e6);
  return {
    title: metaContent(html, "og:title") || metaContent(html, "twitter:title"),
    thumbnail: metaContent(html, "og:image") || metaContent(html, "twitter:image"),
    channelTitle: metaContent(html, "og:site_name")
  };
}
function empty(reason) {
  return { title: "", thumbnail: "", channelTitle: "", source: "", available: false, reason };
}
async function fetchExternalMediaMetadata(input) {
  try {
    const safeUrl = assertAllowedExternalMediaUrl(input.platform, input.url).toString();
    if (input.platform === "tiktok") {
      const response = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(safeUrl)}`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(8e3)
      });
      if (response.ok) {
        const data = await response.json();
        if (data.title || data.thumbnail_url || data.author_name) {
          return {
            title: data.title?.trim() ?? "",
            thumbnail: data.thumbnail_url?.trim() ?? "",
            channelTitle: data.author_name?.trim() ?? "",
            source: "TikTok oEmbed",
            available: true
          };
        }
      }
    }
    if (input.platform === "x") {
      const response = await fetch(`https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(safeUrl)}`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(8e3)
      });
      const oembed2 = response.ok ? await response.json() : {};
      try {
        const openGraph2 = await fetchOpenGraph("x", safeUrl);
        if (openGraph2.title || openGraph2.thumbnail || oembed2.author_name) {
          return {
            title: openGraph2.title,
            thumbnail: openGraph2.thumbnail,
            channelTitle: oembed2.author_name?.trim() || openGraph2.channelTitle,
            source: "X\u516C\u958B\u30DA\u30FC\u30B8 / oEmbed",
            available: true
          };
        }
      } catch {
        if (oembed2.author_name) return { title: "", thumbnail: "", channelTitle: oembed2.author_name.trim(), source: "X oEmbed", available: true };
      }
    }
    const openGraph = await fetchOpenGraph(input.platform, safeUrl);
    if (openGraph.title || openGraph.thumbnail || openGraph.channelTitle) {
      return { ...openGraph, source: "\u516C\u958B\u30DA\u30FC\u30B8\u306EOpen Graph", available: true };
    }
    return empty("\u516C\u958B\u30DA\u30FC\u30B8\u304B\u3089\u30BF\u30A4\u30C8\u30EB\u30FB\u30B5\u30E0\u30CD\u30A4\u30EB\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
  } catch (error) {
    return empty(error instanceof Error ? error.message : "\u516C\u958B\u30E1\u30BF\u30C7\u30FC\u30BF\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
  }
}

// shared/metadataOptions.ts
var GENRE_OPTIONS = [
  { name: "TV CM", slug: "tv-cm" },
  { name: "Web CM", slug: "web-cm" },
  { name: "\u30D6\u30E9\u30F3\u30C7\u30C3\u30C9\u30E0\u30FC\u30D3\u30FC", slug: "branded-movie" },
  { name: "YouTube / SNS / \u7E26\u578B\u52D5\u753B", slug: "youtube-sns" },
  { name: "MV", slug: "mv" },
  { name: "\u4F01\u696D / \u5546\u54C1VP / \u30B3\u30F3\u30C6\u30B9\u30C8\u4F5C\u54C1", slug: "corporate" },
  { name: "\u6620\u753B / \u30C9\u30E9\u30DE / \u30B7\u30E7\u30FC\u30C8\u30D5\u30A3\u30EB\u30E0", slug: "film" },
  { name: "\u30AA\u30FC\u30D7\u30CB\u30F3\u30B0\u6620\u50CF", slug: "opening" },
  { name: "\u30E1\u30A4\u30AD\u30F3\u30B0 / Behind The Scenes", slug: "making" },
  { name: "\u30C9\u30AD\u30E5\u30E1\u30F3\u30BF\u30EA\u30FC", slug: "documentary" },
  { name: "\u30C6\u30A3\u30B6\u30FC / \u30C8\u30EC\u30FC\u30E9\u30FC / PV", slug: "teaser-trailer" },
  { name: "\u30C7\u30E2\u30EA\u30FC\u30EB / \u30B7\u30E7\u30FC\u30EA\u30FC\u30EB", slug: "showreel" },
  { name: "\u30E9\u30A4\u30D6 / \u30A4\u30D9\u30F3\u30C8 / \u5C55\u793A\u6620\u50CF", slug: "event-live" },
  { name: "\u89E3\u8AAC / \u30CF\u30A6\u30C4\u30FC / \u30C1\u30E5\u30FC\u30C8\u30EA\u30A2\u30EB", slug: "how-to" },
  { name: "\u30A2\u30FC\u30C8\u4F5C\u54C1 / \u81EA\u4E3B\u5236\u4F5C / \u5B9F\u9A13\u6620\u50CF", slug: "concept-art" }
];
var PRODUCT_OPTIONS = [
  { name: "\u7F8E\u5BB9 / \u5316\u7CA7\u54C1", slug: "beauty" },
  { name: "\u30D5\u30A1\u30C3\u30B7\u30E7\u30F3 / \u30A2\u30D1\u30EC\u30EB", slug: "fashion" },
  { name: "\u98DF\u54C1 / \u98F2\u6599 / \u98F2\u98DF", slug: "food" },
  { name: "\u65E5\u7528\u54C1 / \u9632\u72AF / \u8B66\u5099", slug: "daily" },
  { name: "\u81EA\u52D5\u8ECA / \u30D0\u30A4\u30AF", slug: "automotive" },
  { name: "\u30B2\u30FC\u30E0 / \u30A2\u30D7\u30EA / \u73A9\u5177", slug: "gaming" },
  { name: "IT / \u901A\u4FE1 / \u30CD\u30C3\u30C8\u30B5\u30FC\u30D3\u30B9", slug: "it" },
  { name: "\u65C5\u884C / \u5BBF\u6CCA", slug: "travel" },
  { name: "\u533B\u7642 / \u533B\u85AC", slug: "medical" },
  { name: "\u4F4F\u5B85 / \u4E0D\u52D5\u7523 / \u5EFA\u8A2D", slug: "real-estate" },
  { name: "\u4EA4\u901A / \u7269\u6D41 / \u7523\u696D\u7D20\u6750", slug: "transport" },
  { name: "\u5A2F\u697D / \u30A2\u30DF\u30E5\u30FC\u30BA\u30E1\u30F3\u30C8", slug: "entertainment" },
  { name: "\u7CBE\u5BC6\u6A5F\u5668 / \u5BB6\u5177 / \u96FB\u5316\u88FD\u54C1", slug: "electronics" },
  { name: "\u30B9\u30DD\u30FC\u30C4 / \u5065\u5EB7 / \u30D5\u30A3\u30C3\u30C8\u30CD\u30B9", slug: "sports" },
  { name: "\u6559\u80B2 / \u51FA\u7248 / \u30E1\u30C7\u30A3\u30A2", slug: "education" },
  { name: "\u91D1\u878D / \u4FDD\u967A / \u30D5\u30A3\u30F3\u30C6\u30C3\u30AF", slug: "finance" },
  { name: "\u97F3\u697D / \u30A2\u30FC\u30C6\u30A3\u30B9\u30C8", slug: "music-artist" },
  { name: "\u5C0F\u58F2 / \u767E\u8CA8\u5E97 / EC", slug: "retail-ec" },
  { name: "\u5B98\u516C\u5E81 / \u81EA\u6CBB\u4F53 / \u516C\u5171\u30FB\u89B3\u5149\u30A4\u30F3\u30D5\u30E9", slug: "public-regional" },
  { name: "\u63A1\u7528 / \u4EBA\u6750 / \u4F01\u696D\u30D6\u30E9\u30F3\u30C9", slug: "recruiting" }
];
var DIRECTION_OPTIONS = [
  { name: "\u5B9F\u5199", slug: "live-action" },
  { name: "\u5408\u6210 / VFX / 3DCG", slug: "vfx-3dcg" },
  { name: "\u30E2\u30FC\u30B7\u30E7\u30F3\u30B0\u30E9\u30D5\u30A3\u30C3\u30AF\u30B9", slug: "motion-graphics" },
  { name: "\u751F\u6210AI", slug: "generative-ai" },
  { name: "\u30AB\u30E1\u30E9\u30EF\u30FC\u30AF / \u30C9\u30ED\u30FC\u30F3\u30FB\u7A7A\u64AE", slug: "camera-work" },
  { name: "\u30E2\u30FC\u30B7\u30E7\u30F3\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u30AB\u30E1\u30E9", slug: "motion-control" },
  { name: "\u30B9\u30C8\u30C3\u30D7\u30E2\u30FC\u30B7\u30E7\u30F3 / \u30BF\u30A4\u30E0\u30E9\u30D7\u30B9", slug: "stop-motion" },
  { name: "\u30DC\u30EA\u30E5\u30E1\u30C8\u30EA\u30C3\u30AF / \u30D0\u30FC\u30C1\u30E3\u30EB\u30D7\u30ED\u30C0\u30AF\u30B7\u30E7\u30F3", slug: "virtual-production" },
  { name: "\u30A4\u30E9\u30B9\u30C8 / \u30A2\u30CB\u30E1\u30FC\u30B7\u30E7\u30F3", slug: "illustration" },
  { name: "\u30EF\u30F3\u30AB\u30C3\u30C8 / \u9577\u56DE\u3057", slug: "one-take" },
  { name: "\u30C0\u30F3\u30B9 / \u30B3\u30EC\u30AA\u30B0\u30E9\u30D5\u30A3", slug: "choreography" },
  { name: "\u30EA\u30EA\u30C3\u30AF / \u30BF\u30A4\u30DD\u30B0\u30E9\u30D5\u30A3", slug: "typography" },
  { name: "\u30DF\u30CB\u30C1\u30E5\u30A2 / \u7279\u64AE / \u30A2\u30CA\u30ED\u30B0\u9020\u5F62", slug: "miniature-analog" },
  { name: "\u97F3\u30CF\u30E1 / \u30EA\u30BA\u30E0\u7DE8\u96C6", slug: "sound-sync" },
  { name: "\u30C9\u30E9\u30DE / \u30B9\u30C8\u30FC\u30EA\u30FC\u30C6\u30EA\u30F3\u30B0", slug: "storytelling" }
];
var TONE_OPTIONS = [
  { name: "\u30B9\u30BF\u30A4\u30EA\u30C3\u30B7\u30E5 / \u30AF\u30FC\u30EB", slug: "stylish" },
  { name: "\u30B3\u30DF\u30AB\u30EB / \u30E6\u30FC\u30E2\u30E9\u30B9 / \u30AB\u30AA\u30B9", slug: "comical" },
  { name: "\u30A8\u30E2\u30FC\u30B7\u30E7\u30CA\u30EB / \u611F\u52D5\u7684", slug: "emotional" },
  { name: "\u6D17\u7DF4 / \u30E9\u30B0\u30B8\u30E5\u30A2\u30EA\u30FC", slug: "luxury" },
  { name: "\u30DD\u30C3\u30D7 / \u30A8\u30CD\u30EB\u30AE\u30C3\u30B7\u30E5 / \u723D\u5FEB", slug: "energetic" },
  { name: "\u307B\u3063\u3053\u308A / \u6E29\u304B\u307F / \u89AA\u3057\u307F\u3084\u3059\u3044", slug: "warm" },
  { name: "\u30C0\u30FC\u30AF / \u30B7\u30EA\u30A2\u30B9 / \u30DF\u30B9\u30C6\u30EA\u30A2\u30B9", slug: "dark" },
  { name: "\u58EE\u5927 / \u30A8\u30D4\u30C3\u30AF / \u30B7\u30CD\u30DE\u30C6\u30A3\u30C3\u30AF", slug: "epic" },
  { name: "\u30EC\u30C8\u30ED / \u30CE\u30B9\u30BF\u30EB\u30B8\u30C3\u30AF / \u662D\u548C\u30FB\u5E73\u6210", slug: "retro" },
  { name: "\u30B7\u30E5\u30FC\u30EB / \u30B5\u30A4\u30B1\u30C7\u30EA\u30C3\u30AF / \u30A2\u30D0\u30F3\u30AE\u30E3\u30EB\u30C9", slug: "surreal" },
  { name: "\u30EA\u30A2\u30EB / \u30C9\u30AD\u30E5\u30E1\u30F3\u30BF\u30EA\u30FC\u8ABF / \u7D20\u6734", slug: "documentary-raw" },
  { name: "\u8FD1\u672A\u6765 / \u30B5\u30A4\u30D0\u30FC / \u30C6\u30C3\u30AF", slug: "futuristic" }
];
function toCategoryNameMap(items) {
  return Object.fromEntries(items.map((item) => [item.slug, item.name]));
}
var PURPOSE_OPTIONS = [
  "MV",
  "\u30D6\u30E9\u30F3\u30C7\u30A3\u30F3\u30B0\u30E0\u30FC\u30D3\u30FC",
  "\u30D7\u30ED\u30E2\u30FC\u30B7\u30E7\u30F3",
  "\u4E8B\u696D\u30FB\u30B5\u30FC\u30D3\u30B9\u7D39\u4ECB",
  "OPED",
  "\u30A4\u30F3\u30BF\u30D3\u30E5\u30FC",
  "\u30C6\u30A3\u30B6\u30FC",
  "\u30A2\u30FC\u30C8",
  "\u4F01\u753B\u7CFB",
  "\u63A1\u7528\u30FB\u30EA\u30AF\u30EB\u30FC\u30C6\u30A3\u30F3\u30B0",
  "\u30CF\u30A6\u30C4\u30FC\u30FB\u89E3\u8AAC",
  "\u30A4\u30D9\u30F3\u30C8\u30FB\u7A7A\u9593\u6F14\u51FA",
  "\u305D\u306E\u4ED6"
];
var EXPRESSION_OPTIONS = [
  "2D",
  "3D",
  "\u30A2\u30CB\u30E1\u30FC\u30B7\u30E7\u30F3",
  "\u5B9F\u5199",
  "\u30A4\u30E9\u30B9\u30C8",
  "\u5B9F\u5199+\u30A2\u30CB\u30E1\u30FC\u30B7\u30E7\u30F3",
  "\u751F\u6210AI",
  "\u30B3\u30DE\u64AE\u308A\u30FB\u30B9\u30C8\u30C3\u30D7\u30E2\u30FC\u30B7\u30E7\u30F3",
  "\u30BF\u30A4\u30DD\u30B0\u30E9\u30D5\u30A3\u30FB\u30B0\u30E9\u30D5\u30A3\u30C3\u30AF"
];
var OPTION_ALIASES = {
  "\u5B9F\u5199\uFF0B\u30A2\u30CB\u30E1\u30FC\u30B7\u30E7\u30F3": "\u5B9F\u5199+\u30A2\u30CB\u30E1\u30FC\u30B7\u30E7\u30F3",
  "\u5B9F\u5199+\u30A2\u30CB\u30E1": "\u5B9F\u5199+\u30A2\u30CB\u30E1\u30FC\u30B7\u30E7\u30F3",
  "\u5B9F\u5199\uFF0B\u30A2\u30CB\u30E1": "\u5B9F\u5199+\u30A2\u30CB\u30E1\u30FC\u30B7\u30E7\u30F3",
  "2d": "2D",
  "3d": "3D",
  "\u751F\u6210ai": "\u751F\u6210AI",
  "oped": "OPED"
};
function restrictToAllowedOptions(values, options) {
  const allowed = new Set(options);
  const normalize3 = (raw) => {
    const value = raw.trim();
    const direct = OPTION_ALIASES[value] ?? OPTION_ALIASES[value.toLowerCase()] ?? value;
    if (allowed.has(direct)) return direct;
    if (allowed.has("\u30D6\u30E9\u30F3\u30C7\u30A3\u30F3\u30B0\u30E0\u30FC\u30D3\u30FC") && /(?:商品|企業|ブランド).*ブランディング|ブランディング(?:動画|映像)?/i.test(value)) return "\u30D6\u30E9\u30F3\u30C7\u30A3\u30F3\u30B0\u30E0\u30FC\u30D3\u30FC";
    if (allowed.has("\u30D7\u30ED\u30E2\u30FC\u30B7\u30E7\u30F3") && /キャンペーン|販促|プロモーション/i.test(value)) return "\u30D7\u30ED\u30E2\u30FC\u30B7\u30E7\u30F3";
    if (allowed.has("\u5B9F\u5199+\u30A2\u30CB\u30E1\u30FC\u30B7\u30E7\u30F3") && /実写.*(?:2d|3d|アニメーション|アニメ)|(?:2d|3d|アニメーション|アニメ).*実写/i.test(value)) return "\u5B9F\u5199+\u30A2\u30CB\u30E1\u30FC\u30B7\u30E7\u30F3";
    if (allowed.has("\u5B9F\u5199") && /^実写(?:コンポジット|合成|撮影)?$/i.test(value)) return "\u5B9F\u5199";
    return value;
  };
  return Array.from(new Set(values.map(normalize3).filter((value) => allowed.has(value))));
}

// server/metadataAutoClassification.ts
var METADATA_TAXONOMY = {
  genres: GENRE_OPTIONS.map((item) => item.slug),
  products: PRODUCT_OPTIONS.map((item) => item.slug),
  directions: DIRECTION_OPTIONS.map((item) => item.slug),
  tones: TONE_OPTIONS.map((item) => item.slug)
};
var names = {
  genres: toCategoryNameMap(GENRE_OPTIONS),
  products: toCategoryNameMap(PRODUCT_OPTIONS),
  directions: toCategoryNameMap(DIRECTION_OPTIONS),
  tones: toCategoryNameMap(TONE_OPTIONS)
};
var categorySchema = (values) => ({ type: "array", items: { type: "string", enum: values } });
var responseFormat = {
  type: "json_schema",
  json_schema: {
    name: "video_metadata_classification",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        genres: categorySchema(METADATA_TAXONOMY.genres),
        products: categorySchema(METADATA_TAXONOMY.products),
        directions: categorySchema(METADATA_TAXONOMY.directions),
        tones: categorySchema(METADATA_TAXONOMY.tones),
        purposes: categorySchema(PURPOSE_OPTIONS),
        expressions: categorySchema(EXPRESSION_OPTIONS),
        confidence: { type: "number", minimum: 0, maximum: 1 },
        evidence: { type: "string" }
      },
      required: ["genres", "products", "directions", "tones", "purposes", "expressions", "confidence", "evidence"]
    }
  }
};
function selectSafeMetadataUpdates(input, candidate) {
  if (candidate.confidence < 0.82 || candidate.evidence.trim().length < 6) return {};
  const updates = {};
  for (const field of Object.keys(METADATA_TAXONOMY)) {
    if (input[field].length || !candidate[field]?.length) continue;
    const mapped = candidate[field].map((slug) => ({ slug, name: names[field][slug] })).filter((item) => item.name);
    if (mapped.length) updates[field] = mapped;
  }
  if (!input.purposes.length && candidate.purposes?.length) updates.purposes = restrictToAllowedOptions(candidate.purposes, PURPOSE_OPTIONS);
  if (!input.expressions.length && candidate.expressions?.length) updates.expressions = restrictToAllowedOptions(candidate.expressions, EXPRESSION_OPTIONS);
  return updates;
}
async function classifyVideoMetadata(input) {
  const missing = [...Object.keys(METADATA_TAXONOMY).filter((field) => input[field].length === 0), ...input.purposes.length ? [] : ["purposes"], ...input.expressions.length ? [] : ["expressions"]];
  if (!missing.length) return { status: "skipped", updates: {}, reason: "all_metadata_fields_are_already_filled" };
  try {
    const response = await fetch(`${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ENV.forgeApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5-mini",
        max_completion_tokens: 1800,
        response_format: responseFormat,
        messages: [
          { role: "system", content: "\u3042\u306A\u305F\u306F\u6620\u50CF\u30E1\u30BF\u30C7\u30FC\u30BF\u306E\u4FDD\u5B88\u7684\u306A\u5206\u985E\u5668\u3067\u3059\u3002\u30BF\u30A4\u30C8\u30EB\u3001\u63B2\u8F09\u5143\u3001\u5236\u4F5C\u8005\u540D\u3001\u30BF\u30B0\u3001\u30AD\u30E5\u30EC\u30FC\u30B7\u30E7\u30F3\u30E1\u30E2\u306B\u660E\u8A18\u3055\u308C\u305F\u6839\u62E0\u3060\u3051\u3092\u7528\u3044\u3001\u6307\u5B9A\u3055\u308C\u305F\u30B9\u30E9\u30C3\u30B0\u304B\u3089\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u6620\u50CF\u5185\u5BB9\u3084\u30D6\u30E9\u30F3\u30C9\u3092\u63A8\u6E2C\u3057\u3066\u306F\u3044\u3051\u307E\u305B\u3093\u3002\u6839\u62E0\u304C\u5F31\u3044\u5206\u985E\u306F\u5FC5\u305A\u7A7A\u914D\u5217\u306B\u3057\u307E\u3059\u3002evidence\u306B\u306F\u5165\u529B\u304B\u3089\u4F7F\u3063\u305F\u77ED\u3044\u624B\u639B\u304B\u308A\u3092\u65E5\u672C\u8A9E\u3067\u66F8\u3044\u3066\u304F\u3060\u3055\u3044\u3002" },
          { role: "user", content: JSON.stringify({ taxonomy: METADATA_TAXONOMY, missing, video: { id: input.id, title: input.title, videoUrl: input.videoUrl, source: input.source, sourceLabel: input.sourceLabel, channelTitle: input.channelTitle, tags: input.allTags.slice(0, 40), curationNote: input.curationNote } }) }
        ]
      })
    });
    if (!response.ok) throw new Error(`classification_api_${response.status}`);
    const body = await response.json();
    const candidate = JSON.parse(String(body.choices?.[0]?.message?.content || "{}"));
    const updates = selectSafeMetadataUpdates(input, candidate);
    return Object.keys(updates).length ? { status: "updated", updates, confidence: candidate.confidence, evidence: candidate.evidence } : { status: "skipped", updates: {}, confidence: candidate.confidence, evidence: candidate.evidence, reason: "insufficient_evidence_or_no_empty_field_candidate" };
  } catch (error) {
    return { status: "failed", updates: {}, reason: error instanceof Error ? error.message.slice(0, 600) : "unknown_classification_error" };
  }
}

// shared/ratingScale.ts
var RATING_BANDS = [
  { grade: "S+", min: 97, max: 100, midpoint: 98 },
  { grade: "S", min: 93, max: 96, midpoint: 94 },
  { grade: "S-", min: 90, max: 92, midpoint: 91 },
  { grade: "A+", min: 86, max: 89, midpoint: 87 },
  { grade: "A", min: 82, max: 85, midpoint: 83 },
  { grade: "A-", min: 78, max: 81, midpoint: 79 },
  { grade: "B+", min: 73, max: 77, midpoint: 75 },
  { grade: "B", min: 68, max: 72, midpoint: 70 },
  { grade: "B-", min: 63, max: 67, midpoint: 65 },
  { grade: "C+", min: 57, max: 62, midpoint: 60 },
  { grade: "C", min: 51, max: 56, midpoint: 53 },
  { grade: "C-", min: 45, max: 50, midpoint: 47 },
  { grade: "D+", min: 35, max: 44, midpoint: 40 },
  { grade: "D", min: 20, max: 34, midpoint: 27 },
  { grade: "D-", min: 0, max: 19, midpoint: 10 }
];
var BAND_BY_GRADE = new Map(
  RATING_BANDS.map((band) => [band.grade, band])
);
function clampScore100(value) {
  if (value === null || value === void 0 || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, Math.round(num)));
}
function scoreToRating(score) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  for (const band of RATING_BANDS) {
    if (clamped >= band.min && clamped <= band.max) {
      return band.grade;
    }
  }
  return "D-";
}
function resolveRatingPair(params) {
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

// server/routers.ts
import { TRPCError as TRPCError3 } from "@trpc/server";
import { z as z2 } from "zod";
var tagSchema = z2.object({
  name: z2.string().trim().min(1).max(120),
  slug: z2.string().trim().min(1).max(120)
});
var stringListSchema = z2.array(z2.string().trim().min(1).max(120)).default([]);
var productionCreditSchema = z2.object({
  name: z2.string().trim().min(1).max(120),
  roles: stringListSchema,
  entityType: z2.enum(["person", "company", "unknown"]).default("unknown")
});
var awardEntrySchema = z2.object({
  name: z2.string().trim().min(1).max(240),
  year: z2.string().trim().min(1).max(32),
  category: z2.string().trim().min(1).max(240),
  sourceUrl: z2.string().url()
});
var curationNoteSchema = z2.object({
  purpose: z2.string().trim().max(2e4).default(""),
  background: z2.string().trim().max(2e4).default(""),
  evaluation: z2.string().trim().max(2e4).default(""),
  clientPitch: z2.string().trim().max(2e4).optional().default(""),
  sourceUrls: z2.array(z2.string().url()).default([])
}).default({ purpose: "", background: "", evaluation: "", clientPitch: "", sourceUrls: [] });
var favoriteProfileIdSchema = z2.string().uuid();
var favoriteProfileNameSchema = z2.string().trim().min(1, "\u5229\u7528\u8005\u540D\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044").max(80, "\u5229\u7528\u8005\u540D\u306F80\u6587\u5B57\u4EE5\u5185\u306B\u3057\u3066\u304F\u3060\u3055\u3044");
var videoWriteSchema = z2.object({
  platform: z2.enum(["youtube", "vimeo", "x", "tiktok", "instagram", "external"]),
  title: z2.string().trim().min(1).max(500),
  thumbnail: z2.string().trim().default(""),
  videoUrl: z2.string().url(),
  embedUrl: z2.string().trim().default(""),
  source: z2.string().trim().max(64).default("manual"),
  sourceLabel: z2.string().trim().max(120).default("\u624B\u52D5\u8FFD\u52A0"),
  channelId: z2.string().trim().max(64).default(""),
  channelTitle: z2.string().trim().max(300).default(""),
  genres: z2.array(tagSchema).default([]),
  products: z2.array(tagSchema).default([]),
  directions: z2.array(tagSchema).default([]),
  tones: z2.array(tagSchema).default([]),
  tags: stringListSchema,
  purposes: stringListSchema.transform((values) => restrictToAllowedOptions(values, PURPOSE_OPTIONS)),
  expressions: stringListSchema.transform((values) => restrictToAllowedOptions(values, EXPRESSION_OPTIONS)),
  toneEmotions: stringListSchema,
  toneVisuals: stringListSchema,
  toneTechniques: stringListSchema,
  productions: stringListSchema,
  productionCredits: z2.array(productionCreditSchema).default([]),
  awards: z2.array(awardEntrySchema).default([]),
  curationNote: curationNoteSchema,
  privateRating: z2.string().trim().max(16).default(""),
  aiOverallRating: z2.string().trim().max(16).default(""),
  aiDirectionRating: z2.string().trim().max(16).default(""),
  aiTechniqueRating: z2.string().trim().max(16).default(""),
  aiOverallScore: z2.number().int().min(0).max(100).nullable().optional(),
  aiDirectionScore: z2.number().int().min(0).max(100).nullable().optional(),
  aiTechniqueScore: z2.number().int().min(0).max(100).nullable().optional(),
  aiScoreBreakdown: z2.record(z2.string(), z2.unknown()).nullable().optional(),
  aiAnalysis: z2.string().trim().max(1e6).default(""),
  addedDate: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});
async function enrichMetadataAfterWrite(id, input) {
  const parsedInput = {
    id,
    title: input.title,
    videoUrl: input.videoUrl,
    source: input.source,
    sourceLabel: input.sourceLabel,
    channelTitle: input.channelTitle,
    allTags: input.tags,
    curationNote: input.curationNote,
    genres: input.genres,
    products: input.products,
    directions: input.directions,
    tones: input.tones,
    purposes: input.purposes,
    expressions: input.expressions
  };
  const result = await classifyVideoMetadata(parsedInput);
  const audit = JSON.stringify({ status: result.status, confidence: result.confidence, evidence: result.evidence, reason: result.reason, updatedFields: Object.keys(result.updates), processedAt: (/* @__PURE__ */ new Date()).toISOString() });
  const classifiedTagNames = [
    ...result.updates.genres ?? [],
    ...result.updates.products ?? [],
    ...result.updates.directions ?? [],
    ...result.updates.tones ?? []
  ].map((item) => item.name);
  const categories = {
    genres: result.updates.genres ? JSON.stringify(result.updates.genres) : JSON.stringify(input.genres),
    products: result.updates.products ? JSON.stringify(result.updates.products) : JSON.stringify(input.products),
    directions: result.updates.directions ? JSON.stringify(result.updates.directions) : JSON.stringify(input.directions),
    tones: result.updates.tones ? JSON.stringify(result.updates.tones) : JSON.stringify(input.tones),
    purposes: JSON.stringify(result.updates.purposes ?? input.purposes),
    expressions: JSON.stringify(result.updates.expressions ?? input.expressions),
    allTags: JSON.stringify(Array.from(new Set([
      ...input.tags,
      ...input.genres,
      ...input.products,
      ...input.directions,
      ...input.tones,
      ...classifiedTagNames,
      ...result.updates.purposes ?? input.purposes,
      ...result.updates.expressions ?? input.expressions
    ].map((item) => typeof item === "string" ? item : item.name)))),
    metadataClassificationAudit: audit
  };
  return updateMetadataClassificationIfMatching({ id, title: input.title, videoUrl: input.videoUrl }, categories);
}
function toVideoRecord(input) {
  const productionCredits = normalizeProductionCredits(input.productionCredits, input.productions);
  const productions = getProductionNames(productionCredits);
  const productionRoles = getProductionRoles(productionCredits);
  const categoryTags = [
    ...input.genres,
    ...input.products,
    ...input.directions,
    ...input.tones
  ].map((tag) => tag.name);
  const allTags = Array.from(
    /* @__PURE__ */ new Set([
      ...input.tags,
      ...categoryTags,
      ...input.purposes,
      ...input.expressions,
      ...input.toneEmotions,
      ...input.toneVisuals,
      ...input.toneTechniques,
      ...productions,
      ...productionRoles,
      ...input.awards.flatMap((award) => [award.name, award.year, award.category]),
      input.curationNote.purpose
    ])
  );
  return {
    platform: input.platform,
    title: input.title,
    thumbnail: input.thumbnail || null,
    videoUrl: input.videoUrl,
    embedUrl: input.embedUrl || null,
    source: input.source || "manual",
    sourceLabel: input.sourceLabel || "\u624B\u52D5\u8FFD\u52A0",
    channelId: input.channelId || null,
    channelTitle: input.channelTitle || null,
    genres: JSON.stringify(input.genres),
    products: JSON.stringify(input.products),
    directions: JSON.stringify(input.directions),
    tones: JSON.stringify(input.tones),
    allTags: JSON.stringify(allTags),
    purposes: JSON.stringify(input.purposes),
    expressions: JSON.stringify(input.expressions),
    toneEmotions: JSON.stringify(input.toneEmotions),
    toneVisuals: JSON.stringify(input.toneVisuals),
    toneTechniques: JSON.stringify(input.toneTechniques),
    productions: JSON.stringify(productions),
    productionCredits: JSON.stringify(productionCredits),
    awards: JSON.stringify(input.awards),
    curationNote: JSON.stringify(input.curationNote),
    privateRating: input.privateRating || null,
    aiOverallRating: resolveRatingPair({ rating: input.aiOverallRating, score: input.aiOverallScore, preserveExistingRating: true }).rating || null,
    aiDirectionRating: resolveRatingPair({ rating: input.aiDirectionRating, score: input.aiDirectionScore, preserveExistingRating: true }).rating || null,
    aiTechniqueRating: resolveRatingPair({ rating: input.aiTechniqueRating, score: input.aiTechniqueScore, preserveExistingRating: true }).rating || null,
    aiOverallScore: input.aiOverallScore ?? null,
    aiDirectionScore: input.aiDirectionScore ?? null,
    aiTechniqueScore: input.aiTechniqueScore ?? null,
    aiScoreBreakdown: input.aiScoreBreakdown ? JSON.stringify(input.aiScoreBreakdown) : null,
    aiAnalysis: input.aiAnalysis || null,
    addedDate: input.addedDate
  };
}
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    })
  }),
  favorites: router({
    /** 共有端末で選択できる、名前付きのお気に入りプロフィール一覧。 */
    profiles: publicProcedure.query(() => listFavoriteProfiles()),
    items: publicProcedure.input(z2.object({ profileId: favoriteProfileIdSchema })).query(async ({ input }) => {
      const profile = await getFavoriteProfileById(input.profileId);
      if (!profile) throw new TRPCError3({ code: "NOT_FOUND", message: "\u5229\u7528\u8005\u30D7\u30ED\u30D5\u30A3\u30FC\u30EB\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093" });
      return getFavoriteProfileItems(input.profileId);
    }),
    createProfile: writeProtectedProcedure.input(z2.object({ displayName: favoriteProfileNameSchema })).mutation(async ({ input }) => {
      const normalizedName = normalizeFavoriteProfileName(input.displayName);
      const existing = await getFavoriteProfileByNormalizedName(normalizedName);
      if (existing) throw new TRPCError3({ code: "CONFLICT", message: "\u540C\u3058\u5229\u7528\u8005\u540D\u304C\u3059\u3067\u306B\u3042\u308A\u307E\u3059" });
      const profile = await createFavoriteProfile(input.displayName);
      if (!profile) throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: "\u5229\u7528\u8005\u30D7\u30ED\u30D5\u30A3\u30FC\u30EB\u3092\u4F5C\u6210\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F" });
      return profile;
    }),
    renameProfile: writeProtectedProcedure.input(z2.object({ profileId: favoriteProfileIdSchema, displayName: favoriteProfileNameSchema })).mutation(async ({ input }) => {
      const profile = await getFavoriteProfileById(input.profileId);
      if (!profile) throw new TRPCError3({ code: "NOT_FOUND", message: "\u5229\u7528\u8005\u30D7\u30ED\u30D5\u30A3\u30FC\u30EB\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093" });
      const normalizedName = normalizeFavoriteProfileName(input.displayName);
      const existing = await getFavoriteProfileByNormalizedName(normalizedName);
      if (existing && existing.id !== input.profileId) throw new TRPCError3({ code: "CONFLICT", message: "\u540C\u3058\u5229\u7528\u8005\u540D\u304C\u3059\u3067\u306B\u3042\u308A\u307E\u3059" });
      const renamed = await renameFavoriteProfile(input.profileId, input.displayName);
      if (!renamed) throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: "\u5229\u7528\u8005\u30D7\u30ED\u30D5\u30A3\u30FC\u30EB\u3092\u5909\u66F4\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F" });
      return renamed;
    }),
    deleteProfile: writeProtectedProcedure.input(z2.object({ profileId: favoriteProfileIdSchema })).mutation(async ({ input }) => {
      await deleteFavoriteProfile(input.profileId);
      return { success: true };
    }),
    toggleVideo: writeProtectedProcedure.input(z2.object({ profileId: favoriteProfileIdSchema, videoId: z2.string().trim().min(1).max(64) })).mutation(async ({ input }) => {
      const profile = await getFavoriteProfileById(input.profileId);
      if (!profile) throw new TRPCError3({ code: "NOT_FOUND", message: "\u5229\u7528\u8005\u30D7\u30ED\u30D5\u30A3\u30FC\u30EB\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093" });
      return toggleFavoriteProfileVideo(input.profileId, input.videoId);
    }),
    toggleCreator: writeProtectedProcedure.input(z2.object({ profileId: favoriteProfileIdSchema, creatorName: z2.string().trim().min(1).max(160) })).mutation(async ({ input }) => {
      const profile = await getFavoriteProfileById(input.profileId);
      if (!profile) throw new TRPCError3({ code: "NOT_FOUND", message: "\u5229\u7528\u8005\u30D7\u30ED\u30D5\u30A3\u30FC\u30EB\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093" });
      return toggleFavoriteProfileCreator(input.profileId, input.creatorName);
    }),
    migrateLegacy: writeProtectedProcedure.input(z2.object({
      profileId: favoriteProfileIdSchema,
      videoIds: z2.array(z2.string().trim().min(1).max(64)).max(5e3),
      creatorNames: z2.array(z2.string().trim().min(1).max(160)).max(5e3)
    })).mutation(({ input }) => mergeLegacyFavoritesIntoProfile(input.profileId, input.videoIds, input.creatorNames))
  }),
  videos: router({
    /** Get all videos from DB */
    list: publicProcedure.query(async () => {
      return await getAllVideoListItems();
    }),
    /** Get full metadata only when a video detail is opened. */
    get: publicProcedure.input(z2.object({ id: z2.string().min(1).max(64) })).query(async ({ input }) => {
      return await getVideoById(input.id);
    }),
    /** Get total video count */
    count: publicProcedure.query(async () => {
      return await getVideoCount();
    }),
    previewExternalMedia: writeProtectedProcedure.input(z2.object({
      platform: z2.enum(["x", "tiktok", "instagram", "vimeo"]),
      url: z2.string().url()
    })).mutation(async ({ input }) => fetchExternalMediaMetadata(input)),
    create: writeProtectedProcedure.input(videoWriteSchema.extend({ id: z2.string().trim().min(1).max(64) })).mutation(async ({ input }) => {
      const { id, ...values } = input;
      const existing = await getVideoById(id);
      if (existing) {
        throw new TRPCError3({
          code: "CONFLICT",
          message: "\u3053\u306E\u52D5\u753B\u306F\u3059\u3067\u306B\u767B\u9332\u3055\u308C\u3066\u3044\u307E\u3059\u3002\u65E2\u5B58\u306E\u52D5\u753B\u3092\u4E00\u89A7\u304B\u3089\u7DE8\u96C6\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
        });
      }
      const created = await createVideo({ id, ...toVideoRecord(values) });
      if (!created) return created;
      const enriched = await enrichMetadataAfterWrite(id, values);
      return enriched ?? created;
    }),
    update: writeProtectedProcedure.input(videoWriteSchema.extend({ id: z2.string().trim().min(1).max(64) })).mutation(async ({ input }) => {
      const { id, ...values } = input;
      const updated = await updateVideo(id, toVideoRecord(values));
      if (!updated) return updated;
      const enriched = await enrichMetadataAfterWrite(id, values);
      return enriched ?? updated;
    }),
    recordEmbedStatus: writeProtectedProcedure.input(z2.object({ id: z2.string().trim().min(1).max(64), status: z2.enum(["available", "restricted"]) })).mutation(async ({ input }) => updateEmbedStatus(input.id, input.status)),
    delete: writeProtectedProcedure.input(z2.object({ id: z2.string().trim().min(1).max(64) })).mutation(async ({ input }) => {
      await deleteVideo(input.id);
      return { success: true };
    })
  }),
  scenes: router({
    /** Search scenes in TiDB videoScenes table (returns available: false if table does not exist yet). */
    search: publicProcedure.input(
      z2.object({
        query: z2.string().max(200).default(""),
        limit: z2.number().int().min(1).max(80).default(40),
        offset: z2.number().int().min(0).max(5e3).default(0),
        excludeUnwatched: z2.boolean().default(true),
        excludeLegacyAnalysis: z2.boolean().default(false),
        scoreFilter: z2.enum(["all", "calibrated_only", "score_78_plus", "score_83_plus", "uncalibrated_only"]).default("all")
      })
    ).query(async ({ input }) => searchVideoScenes(input)),
    /** Keyword preset counts aggregated from TiDB videoScenes (safe fallback when table is absent). */
    keywordStats: publicProcedure.input(
      z2.object({
        excludeUnwatched: z2.boolean().default(true),
        excludeLegacyAnalysis: z2.boolean().default(false),
        scoreFilter: z2.enum(["all", "calibrated_only", "score_78_plus", "score_83_plus", "uncalibrated_only"]).default("all")
      }).optional()
    ).query(
      async ({ input }) => getVideoSceneKeywordStats({
        excludeUnwatched: input?.excludeUnwatched ?? true,
        excludeLegacyAnalysis: input?.excludeLegacyAnalysis ?? false,
        scoreFilter: input?.scoreFilter ?? "all"
      })
    )
  })
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/dailyCollection.ts
import { and as and2, eq as eq2, inArray } from "drizzle-orm";
function parseDailyCollectionCurationNote(value) {
  const fallback = { purpose: "", background: "", evaluation: "", sourceUrls: [] };
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    const note = parsed;
    return {
      purpose: typeof note.purpose === "string" ? note.purpose : "",
      background: typeof note.background === "string" ? note.background : "",
      evaluation: typeof note.evaluation === "string" ? note.evaluation : "",
      ...typeof note.clientPitch === "string" && note.clientPitch ? { clientPitch: note.clientPitch } : {},
      sourceUrls: Array.isArray(note.sourceUrls) ? note.sourceUrls.filter((url) => typeof url === "string" && /^https?:\/\//.test(url)) : []
    };
  } catch {
    return fallback;
  }
}
function getDailyCollectionExistingUpdate(existing, metadata, sourceUrl) {
  const update = {};
  if (!existing.thumbnail?.trim() && typeof metadata.thumbnail_url === "string" && metadata.thumbnail_url.trim()) {
    update.thumbnail = metadata.thumbnail_url.trim();
  }
  if (!existing.channelTitle?.trim() && typeof metadata.author_name === "string" && metadata.author_name.trim()) {
    update.channelTitle = metadata.author_name.trim();
  }
  const note = parseDailyCollectionCurationNote(existing.curationNote);
  if (!note.sourceUrls.includes(sourceUrl)) {
    update.curationNote = JSON.stringify({
      ...note,
      sourceUrls: [...note.sourceUrls, sourceUrl]
    });
  }
  return update;
}
function parseStringArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (typeof item === "string" && item.trim()) return [item.trim()];
      if (item && typeof item === "object" && "name" in item && typeof item.name === "string" && item.name.trim()) return [item.name.trim()];
      return [];
    });
  } catch {
    return [];
  }
}
function normalizeArticleValues(value) {
  return Array.isArray(value) ? Array.from(new Set(value.filter((item) => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))) : [];
}
function getDailyCollectionArticleMetadataUpdate(existing, articleMetadata) {
  const update = {};
  const genres = normalizeArticleValues(articleMetadata.genres);
  const products = normalizeArticleValues(articleMetadata.products);
  const purposes = normalizeArticleValues(articleMetadata.purposes);
  if (!parseStringArray(existing.genres).length && genres.length) update.genres = JSON.stringify(genres);
  if (!parseStringArray(existing.products).length && products.length) update.products = JSON.stringify(products);
  if (!parseStringArray(existing.purposes).length && purposes.length) update.purposes = JSON.stringify(purposes);
  return update;
}
var weeklyCollectionSourceDefaults = [
  ["eizo100", "\u6620\u50CF\u4F5C\u5BB6100\u4EBA", "https://eizo100.jp/", 0],
  ["vook_iketeru", "Vook \u30A4\u30B1\u3066\u308B\u6620\u50CF", "https://site.vook.vc/iketeru-eizou", 1],
  ["alincolony", "ALINCOLONY \u3088\u304B\u3063\u305F\u6620\u50CF", "https://alincolony.com/blog/2023-07-21-good-movies/", 1],
  ["favvid", "FAVVID", "https://to7mg.notion.site/FAVVID-773335a7959c4a26b6bd933ea4f40249", 1],
  ["all_d", "ALLd.", "https://alld.jp/", 0],
  ["video_refs", "Video Refs", "https://video-refs.com/", 0],
  ["bova", "BOVA", "https://awardg.sendenkaigi.com/bova", 0],
  ["light_the_way", "LIGHT THE WAY", "https://light-the-way.jp/works/", 1],
  ["takashi_ohashi", "\u9AD8\u6A4B\u8CB4\u58EB", "https://takashiohashi.com/", 1],
  ["shirotaeisuke", "Eisuke Shirota", "https://shirotaeisuke.com/", 1],
  ["bb_navi", "BB-NAVI", "https://www.bb-navi.com/cm-douga/index-news.html", 1],
  ["douganow", "\u52D5\u753BNOW!!", "https://douganow.jp/", 1],
  ["one_media", "ONE MEDIA", "https://www.onemedia.jp/", 0],
  ["odd_fellows", "Oddfellows", "https://oddfellows.tv/", 1],
  ["pics", "P.I.C.S.", "https://www.pics.tokyo/", 1],
  ["naname", "naname", "https://nanameinc.jp/", 1],
  ["edp", "EDP", "https://www.edp.jp/", 0],
  ["liki", "LIKI", "https://www.likiinc.com/", 1],
  ["takerushima", "\u7AF9\u7559", "https://takerushima.com/", 1],
  ["sgasakura", "\u4F50\u5009", "https://www.sgasakura.com/", 1],
  ["maxilla", "maxilla", "https://maxilla.jp/", 1],
  ["wachajack", "\u30EF\u30C1\u30E3\u30B8\u30E3\u30C3\u30AF", "https://wachajack.com/", 1],
  ["signif", "SIGNIF", "https://signif.jp/", 1],
  ["flapper3", "\u30D5\u30E9\u30C3\u30D1\u30FC3", "https://www.flapper3.co.jp/", 1],
  ["taiyo_kikaku", "\u592A\u967D\u4F01\u753B", "https://www.taiyokikaku.com/", 1],
  ["pyramidfilm", "\u30D4\u30E9\u30DF\u30C3\u30C9\u30D5\u30A3\u30EB\u30E0", "https://www.pyramidfilm.co.jp/", 1],
  ["babel_pro", "BABEL LABEL", "https://babel-pro.com/", 1],
  ["aoi_pro", "AOI Pro.", "https://www.aoi-pro.com/jp/", 1],
  ["tyo", "TYO", "https://tyo.co.jp/", 1],
  ["geek_pictures", "GEEK PICTURES", "https://geekpictures.co.jp/jp/", 1],
  ["stink_studios", "Stink Studios", "https://www.stinkstudios.com/", 1],
  ["d_walker", "D-Walker", "https://www.d-walker.com/", 1]
];
var dailyCollectionSourceIdFromCandidate = (value) => typeof value === "string" && /^[a-z0-9_]{1,64}$/.test(value) ? value : "";
var normalize = (value = "") => value.toLowerCase().replace(/[\s!"#$%&'()*+,\.\/:;<=>?@[\\\]^`{|}~_]+/g, "");
var dailyCollectionTitlesResemble = (left = "", right = "") => {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  if (Math.min(a.length, b.length) < 8) return false;
  return a.includes(b.slice(0, 16)) || b.includes(a.slice(0, 16));
};
var dailyCollectionIdentityIsConfirmed = (sourceTitle, oembedTitle, articleVerified) => dailyCollectionTitlesResemble(sourceTitle, oembedTitle) || articleVerified === true;
var dailyCollectionVideoIdFromUrl = (platform, value) => platform === "youtube" ? value.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{11})/)?.[1] || "" : value.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1] || "";
var oembed = async (platform, videoUrl) => {
  const endpoint = platform === "youtube" ? `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json` : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(videoUrl)}`;
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(15e3) });
  return response.ok ? await response.json() : null;
};
async function getDailyCollectionSources(req, res) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron) return res.status(403).json({ error: "cron-only" });
    const db = await getDb();
    if (!db) throw new Error("database unavailable");
    for (const [id, label, url, enabled] of weeklyCollectionSourceDefaults) {
      await db.insert(dailyCollectionSources).values({ id, label, url, enabled }).onDuplicateKeyUpdate({ set: { label, url, enabled } });
    }
    const sources = await db.select().from(dailyCollectionSources).where(eq2(dailyCollectionSources.enabled, 1));
    res.json({ sources });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
}
async function receiveDailyCollection(req, res) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
    const candidates = Array.isArray(req.body?.candidates) ? req.body.candidates.slice(0, 200) : [];
    const rawCheckedSourceIds = Array.isArray(req.body?.checkedSourceIds) ? req.body.checkedSourceIds : [];
    const checkedSourceIds = Array.from(new Set(
      rawCheckedSourceIds.map(dailyCollectionSourceIdFromCandidate).filter(Boolean)
    ));
    const db = await getDb();
    if (!db) throw new Error("database unavailable");
    const enabledSources = await db.select({ id: dailyCollectionSources.id, label: dailyCollectionSources.label }).from(dailyCollectionSources).where(eq2(dailyCollectionSources.enabled, 1));
    const enabledSourceLabels = new Map(enabledSources.map((source) => [source.id, source.label]));
    const [run] = await db.insert(dailyCollectionRuns).values({ taskUid: user.taskUid, status: "running", candidateCount: candidates.length }).$returningId();
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const details = [];
    for (const candidate of candidates) {
      const platform = candidate?.platform === "vimeo" ? "vimeo" : candidate?.platform === "youtube" ? "youtube" : "";
      const id = typeof candidate?.id === "string" ? candidate.id : "";
      const videoUrl = typeof candidate?.videoUrl === "string" ? candidate.videoUrl : "";
      const sourceTitle = typeof candidate?.title === "string" ? candidate.title : "";
      const sourceUrl = typeof candidate?.sourceUrl === "string" ? candidate.sourceUrl : "";
      const sourceId = dailyCollectionSourceIdFromCandidate(candidate?.sourceId);
      const sourceLabel = enabledSourceLabels.get(sourceId);
      const articleVerified = candidate?.articleVerified === true;
      const articleMetadata = { genres: candidate?.genres, products: candidate?.products, purposes: candidate?.purposes };
      if (!platform || !id || !videoUrl || !sourceTitle || !sourceId || !sourceLabel || dailyCollectionVideoIdFromUrl(platform, videoUrl) !== id || !sourceUrl) {
        skipped++;
        details.push({ id, sourceId, reason: "invalid_identity_or_source" });
        continue;
      }
      const metadata = await oembed(platform, videoUrl).catch(() => null);
      const metadataTitle = typeof metadata?.title === "string" ? metadata.title.trim() : "";
      const metadataThumbnail = typeof metadata?.thumbnail_url === "string" ? metadata.thumbnail_url.trim() : "";
      const metadataAuthor = typeof metadata?.author_name === "string" ? metadata.author_name.trim() : "";
      if (!metadataTitle || !dailyCollectionIdentityIsConfirmed(sourceTitle, metadataTitle, articleVerified)) {
        skipped++;
        details.push({ id, reason: "public_oembed_or_title_mismatch" });
        continue;
      }
      const existing = (await db.select().from(videos).where(eq2(videos.id, id)).limit(1))[0] ?? null;
      if (existing) {
        const update = {
          ...getDailyCollectionExistingUpdate(existing, { thumbnail_url: metadataThumbnail, author_name: metadataAuthor }, sourceUrl),
          ...getDailyCollectionArticleMetadataUpdate(existing, articleMetadata)
        };
        const updatedFields = Object.keys(update);
        if (updatedFields.length) {
          await db.update(videos).set(update).where(eq2(videos.id, id));
          updated++;
          details.push({ id, reason: "updated_existing_public_metadata", updatedFields });
        } else {
          skipped++;
          details.push({ id, reason: "duplicate_id_no_safe_refresh" });
        }
        continue;
      }
      const genres = normalizeArticleValues(articleMetadata.genres);
      const products = normalizeArticleValues(articleMetadata.products);
      const purposes = normalizeArticleValues(articleMetadata.purposes);
      await createVideo({ id, platform, title: metadataTitle, thumbnail: metadataThumbnail || null, videoUrl, embedUrl: platform === "youtube" ? `https://www.youtube.com/embed/${id}` : `https://player.vimeo.com/video/${id}`, source: sourceId, sourceLabel, channelTitle: metadataAuthor || null, genres: JSON.stringify(genres), products: JSON.stringify(products), purposes: JSON.stringify(purposes), allTags: JSON.stringify(["\u9031\u6B21\u53CE\u96C6", "\u516C\u5F0F\u63B2\u8F09", "\u63B2\u8F09\u8A18\u4E8B\u6839\u62E0", platform]), curationNote: JSON.stringify({ purpose: "\u6620\u50CF\u8868\u73FE\u306E\u30EA\u30D5\u30A1\u30EC\u30F3\u30B9\u53CE\u96C6", background: `\u9031\u6B21\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u304C\u63B2\u8F09\u8A18\u4E8B\u304B\u3089\u691C\u51FA\u3002\u8A18\u4E8B\u63B2\u8F09\u30BF\u30A4\u30C8\u30EB: ${sourceTitle}`, evaluation: articleVerified ? "\u63B2\u8F09\u8A18\u4E8B\u306E\u6B63\u898F\u52D5\u753BURL\u3068\u516C\u958BoEmbed\u3092\u7167\u5408\u6E08\u307F\u3002" : "\u516C\u958BoEmbed\u30FB\u52D5\u753BID\u30FB\u30BF\u30A4\u30C8\u30EB\u3092\u7167\u5408\u6E08\u307F\u3002", sourceUrls: [sourceUrl] }), addedDate: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), embedStatus: "available" });
      inserted++;
      details.push({ id, reason: "inserted" });
    }
    if (checkedSourceIds.length) {
      await db.update(dailyCollectionSources).set({ lastCheckedAt: /* @__PURE__ */ new Date() }).where(and2(eq2(dailyCollectionSources.enabled, 1), inArray(dailyCollectionSources.id, checkedSourceIds)));
    }
    await db.update(dailyCollectionRuns).set({ status: "completed", completedAt: /* @__PURE__ */ new Date(), insertedCount: inserted, updatedCount: updated, skippedCount: skipped, details: JSON.stringify(details) }).where(eq2(dailyCollectionRuns.id, run.id));
    res.json({ ok: true, inserted, updated, skipped, checkedSourceIds, runId: run.id });
  } catch (error) {
    res.status(500).json({ error: String(error), timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  }
}

// server/aiMetadataCompletion.ts
import { eq as eq3 } from "drizzle-orm";
var JOB_ID = "ai_metadata_completion";
var MODEL = "gpt-5-mini";
var CONFIDENCE_THRESHOLD = 0.9;
var BACKOFF_BASE_MINUTES = 60;
var BACKOFF_MAX_MINUTES = 6 * 60;
var PERSISTENT_AI_WORKER_INTERVAL_MS = 5 * 6e4;
var PERSISTENT_WORKER_TASK_UID = "persistent_ai_worker";
var ARRAY_FIELDS = ["genres", "products", "directions", "tones", "purposes", "expressions"];
var tagNames = {
  genres: toCategoryNameMap(GENRE_OPTIONS),
  products: toCategoryNameMap(PRODUCT_OPTIONS),
  directions: toCategoryNameMap(DIRECTION_OPTIONS),
  tones: toCategoryNameMap(TONE_OPTIONS)
};
var purposeOptions = new Set(PURPOSE_OPTIONS);
var expressionOptions = new Set(EXPRESSION_OPTIONS);
var directCueRules = {
  genres: { "tv-cm": ["tvcm", "tvspot"], "web-cm": ["webcm"], "branded-movie": ["brandedmovie", "\u30D6\u30E9\u30F3\u30C9\u30E0\u30FC\u30D3\u30FC"], "youtube-sns": ["youtube", "sns", "shorts"], mv: ["mv", "musicvideo", "\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF\u30D3\u30C7\u30AA"], corporate: ["\u4F01\u696Dvp", "companyprofile", "corporatevideo"], film: ["shortfilm", "shortmovie", "\u77ED\u7DE8\u6620\u753B"], opening: ["opening", "\u30AA\u30FC\u30D7\u30CB\u30F3\u30B0"], making: ["making", "\u30E1\u30A4\u30AD\u30F3\u30B0", "behindthescenes"], documentary: ["documentary", "\u30C9\u30AD\u30E5\u30E1\u30F3\u30BF\u30EA\u30FC"] },
  products: { food: ["\u98DF\u54C1", "\u98F2\u6599", "beverage", "chocolate", "\u30C1\u30E7\u30B3", "cider", "\u30B5\u30A4\u30C0\u30FC"], entertainment: ["netflix", "entertainmentservice", "\u6620\u50CF\u914D\u4FE1"] },
  directions: { "vfx-3dcg": ["vfx", "3dcg", "cg"], "generative-ai": ["\u751F\u6210ai", "generativeai", "ai\u5275\u4F5C", "ai\u751F\u6210"] },
  purposes: { MV: ["mv", "musicvideo", "\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF\u30D3\u30C7\u30AA"], "\u30C6\u30A3\u30B6\u30FC": ["teaser", "\u30C6\u30A3\u30B6\u30FC"] },
  expressions: { "\u751F\u6210AI": ["\u751F\u6210ai", "generativeai", "ai\u5275\u4F5C", "ai\u751F\u6210"] }
};
var schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    identity: { type: "object", additionalProperties: false, properties: { videoId: { type: "string" }, videoUrl: { type: "string" }, title: { type: "string" } }, required: ["videoId", "videoUrl", "title"] },
    genres: { type: "array", items: { type: "string", enum: Object.keys(tagNames.genres) } },
    products: { type: "array", items: { type: "string", enum: Object.keys(tagNames.products) } },
    directions: { type: "array", items: { type: "string", enum: Object.keys(tagNames.directions) } },
    tones: { type: "array", items: { type: "string", enum: Object.keys(tagNames.tones) } },
    purposes: { type: "array", items: { type: "string", enum: Array.from(purposeOptions) } },
    expressions: { type: "array", items: { type: "string", enum: Array.from(expressionOptions) } },
    privateRating: { type: "string", enum: [""] },
    aiOverallRating: { type: "string", enum: [""] },
    aiDirectionRating: { type: "string", enum: [""] },
    aiTechniqueRating: { type: "string", enum: [""] },
    aiAnalysis: { type: "string", enum: [""] },
    confidence: { type: "object", additionalProperties: false, properties: Object.fromEntries(["genres", "products", "directions", "tones", "purposes", "expressions", "ratings", "analysis"].map((key) => [key, { type: "number", minimum: 0, maximum: 1 }])), required: ["genres", "products", "directions", "tones", "purposes", "expressions", "ratings", "analysis"] },
    evidence: { type: "object", additionalProperties: false, properties: Object.fromEntries([...ARRAY_FIELDS, "privateRating", "aiOverallRating", "aiDirectionRating", "aiTechniqueRating", "aiAnalysis"].map((key) => [key, { type: "array", items: { type: "string" } }])), required: [...ARRAY_FIELDS, "privateRating", "aiOverallRating", "aiDirectionRating", "aiTechniqueRating", "aiAnalysis"] }
  },
  required: ["identity", ...ARRAY_FIELDS, "privateRating", "aiOverallRating", "aiDirectionRating", "aiTechniqueRating", "aiAnalysis", "confidence", "evidence"]
};
var systemPrompt = "\u3042\u306A\u305F\u306F\u6839\u62E0\u3092\u9650\u5B9A\u3059\u308B\u6620\u50CF\u30E1\u30BF\u30C7\u30FC\u30BF\u62BD\u51FA\u5668\u3067\u3059\u3002\u5165\u529B\u306B\u3042\u308B\u30BF\u30A4\u30C8\u30EB\u3001URL\u3001\u51FA\u5178\u3001\u65E2\u5B58\u30E1\u30E2\u3001publicMetadata\u3060\u3051\u3092\u6839\u62E0\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u6620\u50CF\u672C\u7DE8\u3092\u8996\u8074\u3057\u3066\u3044\u306A\u3044\u305F\u3081\u63A8\u6E2C\u306F\u7981\u6B62\u3067\u3059\u3002identity\u306F\u5165\u529B\u306Eid\u3001videoUrl\u3001title\u3092\u6587\u5B57\u5358\u4F4D\u3067\u8FD4\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u76F4\u63A5\u78BA\u8A8D\u3067\u304D\u308B\u539F\u6587\u5F15\u7528\u304C\u3042\u308A\u3001\u6B21\u306E\u76F4\u63A5\u5BFE\u5FDC\u306B\u660E\u767D\u306B\u4E00\u81F4\u3059\u308B\u5834\u5408\u306E\u307F\u5F53\u8A72\u914D\u5217\u3078\u5024\u3092\u63D0\u6848\u3057confidence\u30920.95\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002MV\u2192genres=mv\u3068purposes=MV\u3001Teaser/\u30C6\u30A3\u30B6\u30FC\u2192purposes=\u30C6\u30A3\u30B6\u30FC\u3001VFX/3DCG\u2192directions=vfx-3dcg\u3001\u751F\u6210AI\u2192directions=generative-ai\u307E\u305F\u306Fexpressions=\u751F\u6210AI\u3001\u98DF\u54C1\u30FB\u98F2\u6599\u30FB\u30C1\u30E7\u30B3\u30FB\u30B5\u30A4\u30C0\u30FC\u2192products=food\u3001Netflix/\u6620\u50CF\u914D\u4FE1\u2192products=entertainment\u3002\u305D\u306E\u4ED6\u306F\u7A7A\u914D\u5217\u30FBconfidence=0\u306B\u3057\u3001\u8A55\u4FA1\u3068aiAnalysis\u306F\u5E38\u306B\u7A7A\u6587\u5B57\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u5F15\u7528\u306F\u5165\u529B\u306B\u542B\u307E\u308C\u308B\u9023\u7D9A\u6587\u5B57\u5217\u3060\u3051\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
var parse = (value, fallback) => {
  try {
    return typeof value === "string" && value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};
var normalize2 = (value) => String(value ?? "").toLowerCase().replace(/[\s!"#$%&'()*+,\.\/:;<=>?@[\\\]^`{|}~_]+/g, "");
var isEmpty = (value) => !Array.isArray(parse(value, [])) || parse(value, []).length === 0;
var missingFields = (row) => ARRAY_FIELDS.filter((field) => isEmpty(row[field]));
function selectUnprocessedAiInputs(rows, batchSize) {
  return rows.filter((row) => missingFields(row).length > 0 && !parse(row.metadataClassificationAudit, {}).aiMetadataCompletion).slice(0, Math.min(Math.max(batchSize, 1), 5));
}
function acceptsAiCompletionTaskUid(job, taskUid) {
  if (!job?.enabled || !taskUid) return false;
  return [job.scheduleCronTaskUid, job.backupScheduleCronTaskUid].filter(Boolean).includes(taskUid);
}
function getModelRetryAfter(now, consecutiveFailureCount) {
  const multiplier = Math.pow(2, Math.max(0, consecutiveFailureCount - 1));
  const minutes = Math.min(BACKOFF_BASE_MINUTES * multiplier, BACKOFF_MAX_MINUTES);
  return new Date(now.getTime() + minutes * 6e4);
}
function isModelBackoffActive(job, now) {
  return Boolean(job?.retryAfter && job.retryAfter.getTime() > now.getTime());
}
async function publicMetadata(row) {
  if (row.platform !== "youtube" || !process.env.YOUTUBE_API_KEY) return null;
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("id", row.id);
  url.searchParams.set("key", process.env.YOUTUBE_API_KEY);
  const response = await fetch(url, { signal: AbortSignal.timeout(15e3) });
  if (!response.ok) return null;
  const snippet = (await response.json())?.items?.[0]?.snippet;
  return snippet ? { description: String(snippet.description ?? "").slice(0, 6e3), channelTitle: String(snippet.channelTitle ?? ""), tags: Array.isArray(snippet.tags) ? snippet.tags.slice(0, 40) : [], sourceUrl: row.videoUrl } : null;
}
function makeInput(row, meta) {
  return { id: row.id, platform: row.platform, title: row.title, videoUrl: row.videoUrl, source: row.source ?? "", sourceLabel: row.sourceLabel ?? "", channelTitle: row.channelTitle ?? "", tags: parse(row.allTags, []), curationNote: parse(row.curationNote, {}), missing: missingFields(row), publicMetadata: meta };
}
function sourceText(input) {
  return [input.title, input.videoUrl, input.source, input.sourceLabel, input.channelTitle, ...input.tags ?? [], JSON.stringify(input.curationNote ?? {}), input.publicMetadata?.description, input.publicMetadata?.channelTitle, ...input.publicMetadata?.tags ?? []].map(normalize2).join(" ");
}
function assess(candidate, input) {
  const identityOk = candidate?.identity?.videoId === input.id && candidate?.identity?.videoUrl === input.videoUrl && candidate?.identity?.title === input.title;
  const eligible = [];
  const rejected = {};
  for (const field of ARRAY_FIELDS) {
    const values = candidate?.[field];
    const confidence = Number(candidate?.confidence?.[field] ?? 0);
    const evidence = candidate?.evidence?.[field];
    if (!identityOk) rejected[field] = "identity_mismatch";
    else if (!Array.isArray(values) || !values.length) rejected[field] = "empty_candidate";
    else if (!Number.isFinite(confidence) || confidence < CONFIDENCE_THRESHOLD) rejected[field] = "confidence_below_threshold";
    else if (!Array.isArray(evidence) || !evidence.some((quote) => {
      const text2 = normalize2(quote);
      return text2.length >= 2 && sourceText(input).includes(text2);
    })) rejected[field] = "ungrounded_evidence";
    else if (!values.every((value) => directCueRules[field]?.[value]?.some((cue) => normalize2(evidence.join(" ")).includes(cue)))) rejected[field] = "indirect_category_mapping";
    else eligible.push(field);
  }
  return { identityOk, eligible, rejected };
}
function tagItems(field, values) {
  return Array.from(new Set(values)).map((slug) => tagNames[field]?.[slug] ? { slug, name: tagNames[field][slug] } : null).filter(Boolean);
}
async function analyze(input) {
  const response = await fetch(`${process.env.BUILT_IN_FORGE_API_URL}/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${process.env.BUILT_IN_FORGE_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, max_completion_tokens: 1200, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `\u5165\u529B\u30C7\u30FC\u30BF: ${JSON.stringify(input)}` }], response_format: { type: "json_schema", json_schema: { name: "safe_video_metadata", strict: true, schema } } }) });
  if (!response.ok) throw new Error(`model_http_${response.status}`);
  const content = (await response.json())?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("empty_model_content");
  return JSON.parse(content);
}
async function runAiMetadataCompletion(req, res) {
  let runId = null;
  try {
    const isInternalWorker = Boolean(process.env.JWT_SECRET) && req.get("x-ai-completion-worker") === process.env.JWT_SECRET;
    const user = isInternalWorker ? null : await sdk.authenticateRequest(req);
    if (!isInternalWorker && (!user?.isCron || !user.taskUid)) return res.status(403).json({ error: "cron-only" });
    const taskUid = isInternalWorker ? PERSISTENT_WORKER_TASK_UID : user.taskUid;
    const db = await getDb();
    if (!db) throw new Error("database unavailable");
    const job = (await db.select().from(aiMetadataCompletionJobs).where(eq3(aiMetadataCompletionJobs.id, JOB_ID)).limit(1))[0];
    const taskAllowed = isInternalWorker ? Boolean(job?.enabled) : acceptsAiCompletionTaskUid(job, taskUid);
    if (!taskAllowed) {
      await db.insert(aiMetadataCompletionRuns).values({
        taskUid,
        status: "skipped",
        completedAt: /* @__PURE__ */ new Date(),
        details: JSON.stringify({
          reason: "disabled_or_orphan",
          expectedTaskUid: job?.scheduleCronTaskUid ?? null,
          expectedBackupTaskUid: job?.backupScheduleCronTaskUid ?? null,
          enabled: Boolean(job?.enabled)
        })
      });
      return res.json({ ok: true, skipped: "disabled_or_orphan", taskUid });
    }
    const now = /* @__PURE__ */ new Date();
    if (isModelBackoffActive(job, now)) {
      await db.insert(aiMetadataCompletionRuns).values({
        taskUid,
        status: "backoff",
        completedAt: now,
        details: JSON.stringify({ reason: "model_backoff", retryAfter: job.retryAfter?.toISOString() ?? null, consecutiveModelFailureCount: job.consecutiveModelFailureCount })
      });
      return res.json({ ok: true, skipped: "model_backoff", retryAfter: job.retryAfter?.toISOString() ?? null });
    }
    const rows = await db.select().from(videos);
    const selected = selectUnprocessedAiInputs(rows, job.batchSize);
    const [run] = await db.insert(aiMetadataCompletionRuns).values({ taskUid, status: "running", selectedCount: selected.length }).$returningId();
    runId = run.id;
    const details = [];
    let savedValueCount = 0;
    let analyzedCount = 0;
    for (const row of selected) {
      try {
        const input = makeInput(row, await publicMetadata(row));
        const candidate = await analyze(input);
        analyzedCount++;
        const quality = assess(candidate, input);
        const priorAudit = parse(row.metadataClassificationAudit, {});
        const next = {};
        for (const field of ARRAY_FIELDS) if (quality.eligible.includes(field) && isEmpty(row[field])) {
          const value = field === "purposes" ? Array.from(new Set(candidate[field].filter((item) => purposeOptions.has(item)))) : field === "expressions" ? Array.from(new Set(candidate[field].filter((item) => expressionOptions.has(item)))) : tagItems(field, candidate[field]);
          if (value.length) {
            next[field] = JSON.stringify(value);
            savedValueCount += value.length;
          }
        }
        const appliedMissing = Object.keys(next);
        const audit = { ...priorAudit, aiMetadataCompletion: { model: MODEL, analyzedAt: (/* @__PURE__ */ new Date()).toISOString(), evidenceType: "ai_analysis", identityTripleMatch: quality.identityOk, confidence: candidate.confidence, evidence: candidate.evidence, input: { title: row.title, videoUrl: row.videoUrl, source: row.source, channelTitle: row.channelTitle, tags: parse(row.allTags, []), publicMetadataUsed: Boolean(input.publicMetadata) }, eligibleFields: quality.eligible, rejectedFields: quality.rejected, appliedMissing } };
        await db.update(videos).set({ ...next, metadataClassificationAudit: JSON.stringify(audit) }).where(eq3(videos.id, row.id));
        details.push({ id: row.id, status: "audited", eligibleFields: quality.eligible, appliedMissing });
      } catch (error) {
        details.push({ id: row.id, status: "error", error: String(error) });
      }
    }
    const modelFailureCount = details.filter((item) => item.status === "error" && String(item.error).includes("model_http_")).length;
    const allSelectedRequestsFailed = selected.length > 0 && modelFailureCount === selected.length;
    const consecutiveModelFailureCount = allSelectedRequestsFailed ? job.consecutiveModelFailureCount + 1 : 0;
    const retryAfter = allSelectedRequestsFailed ? getModelRetryAfter(now, consecutiveModelFailureCount) : null;
    await db.update(aiMetadataCompletionJobs).set({ lastRunAt: now, consecutiveModelFailureCount, retryAfter }).where(eq3(aiMetadataCompletionJobs.id, JOB_ID));
    await db.update(aiMetadataCompletionRuns).set({ status: "completed", completedAt: /* @__PURE__ */ new Date(), analyzedCount, auditedCount: details.filter((item) => item.status === "audited").length, savedValueCount, skippedCount: details.filter((item) => item.status !== "audited").length, details: JSON.stringify(details) }).where(eq3(aiMetadataCompletionRuns.id, runId));
    res.json({ ok: true, selected: selected.length, analyzedCount, savedValueCount, runId, retryAfter: retryAfter?.toISOString() ?? null });
  } catch (error) {
    if (runId) {
      const db = await getDb();
      await db?.update(aiMetadataCompletionRuns).set({ status: "failed", completedAt: /* @__PURE__ */ new Date(), details: JSON.stringify({ error: String(error) }) }).where(eq3(aiMetadataCompletionRuns.id, runId));
    }
    res.status(500).json({ error: String(error), timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  }
}

// server/_core/vercelHandler.ts
var app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.get("/api/health", async (_req, res) => {
  try {
    const hasDb = Boolean(process.env.DATABASE_URL);
    const videoCount = hasDb ? await getVideoCount() : 0;
    res.json({ ok: true, runtime: "vercel-serverless", hasDb, videoCount });
  } catch (error) {
    res.status(500).json({
      ok: false,
      runtime: "vercel-serverless",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
registerOAuthRoutes(app);
app.get("/api/scheduled/daily-video-collection/sources", getDailyCollectionSources);
app.post("/api/scheduled/daily-video-collection", receiveDailyCollection);
app.post("/api/scheduled/ai-metadata-completion", runAiMetadataCompletion);
app.use(
  "/api/trpc",
  (req, res, next) => {
    if (req.method === "GET" && (req.path.includes("videos.list") || req.path.includes("videos.count") || req.path.includes("scenes.search"))) {
      res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    } else if (req.method === "GET" && req.path.includes("scenes.keywordStats")) {
      res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    }
    next();
  },
  createExpressMiddleware({
    router: appRouter,
    createContext
  })
);
var vercelHandler_default = app;
export {
  vercelHandler_default as default
};
