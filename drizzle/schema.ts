import { decimal, index, int, mediumtext, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
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
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// TODO: Add your tables here

/**
 * Videos table — stores all collected video entries
 * genres/products/directions/tones are stored as JSON strings
 */
export const videos = mysqlTable("videos", {
  id: varchar("id", { length: 64 }).primaryKey(), // YouTube/Vimeo video ID
  platform: varchar("platform", { length: 16 }).notNull(), // 'youtube' | 'vimeo'
  title: text("title").notNull(),
  thumbnail: text("thumbnail"),
  videoUrl: text("videoUrl").notNull(),
  embedUrl: text("embedUrl"),
  source: varchar("source", { length: 64 }), // 'vook' | 'youtube_search' | etc.
  sourceLabel: text("sourceLabel"),
  channelId: varchar("channelId", { length: 64 }),
  channelTitle: text("channelTitle"),
  genres: text("genres").notNull().default("[]"),       // JSON array
  products: text("products").notNull().default("[]"),   // JSON array
  directions: text("directions").notNull().default("[]"), // JSON array
  tones: text("tones").notNull().default("[]"),         // JSON array
  allTags: text("allTags").notNull().default("[]"),     // JSON array
  purposes: text("purposes"), // JSON array: 用途
  expressions: text("expressions"), // JSON array: 表現
  toneEmotions: text("toneEmotions"), // JSON array: 感情トンマナ
  toneVisuals: text("toneVisuals"), // JSON array: ビジュアルトンマナ
  toneTechniques: text("toneTechniques"), // JSON array: 技術トンマナ
  productions: text("productions"), // JSON array: 制作
  productionCredits: mediumtext("productionCredits"), // JSON array: { name, roles, entityType }
  awards: text("awards"), // JSON array: 受賞アワード・年・区分・公式出典
  curationNote: mediumtext("curationNote"), // JSON: 制作目的・背景・評価・公式出典
  metadataClassificationAudit: mediumtext("metadataClassificationAudit"), // JSON: 自動分類の根拠・信頼度・状態
  privateRating: varchar("privateRating", { length: 16 }), // 私的評価
  aiOverallRating: varchar("aiOverallRating", { length: 16 }), // Notion AI評価（総合）
  aiDirectionRating: varchar("aiDirectionRating", { length: 16 }), // Notion AI評価（ディレクション）
  aiTechniqueRating: varchar("aiTechniqueRating", { length: 16 }), // Notion AI評価（技術）
  aiOverallScore: int("aiOverallScore"), // AI評価100点満点（総合: 0-100）
  aiDirectionScore: int("aiDirectionScore"), // AI評価100点満点（ディレクション: 0-100）
  aiTechniqueScore: int("aiTechniqueScore"), // AI評価100点満点（技術: 0-100）
  aiScoreBreakdown: mediumtext("aiScoreBreakdown"), // JSON: 5観点x20点ルーブリック内訳
  aiAnalysis: mediumtext("aiAnalysis"), // Notion AI分析結果
  calibrationStatus: varchar("calibrationStatus", { length: 32 }), // legacy_uncalibrated | unscored | calibrated_verified | calibrated_unverified_genre
  calibratedScore: decimal("calibratedScore", { precision: 5, scale: 2 }), // Phase 2 校正済み総合スコア (0.00-100.00)
  calibratedRank: varchar("calibratedRank", { length: 8 }), // S+..D
  calibratedTierBand: varchar("calibratedTierBand", { length: 24 }), // award_tier | pro_band | low_band
  calibratedBreakdown: mediumtext("calibratedBreakdown"), // JSON: 2+1各回点数・5観点内訳・監査証跡
  calibrationVersion: varchar("calibrationVersion", { length: 32 }), // 'phase2_v1'
  calibratedAt: timestamp("calibratedAt"), // 校正完了日時 (UTC)
  calibratedRoute: varchar("calibratedRoute", { length: 32 }), // video_h1 | video_h2_escalated | contact_sheet
  calibratedRunId: varchar("calibratedRunId", { length: 64 }), // analysis/runs/<run_id>
  calibrationGenreBucket: varchar("calibrationGenreBucket", { length: 64 }), // CM | MV | モーション | 3DCG/アニメ | 企業映像 | unverified:<slug>
  analysisObservationScope: varchar("analysisObservationScope", { length: 40 }), // metadata_only_unwatched | triage_boilerplate_unwatched | triage_unverified_short | missing_video_unwatched | null
  analysisVersion: varchar("analysisVersion", { length: 16 }).notNull().default("legacy"), // 'legacy' | 'v3'
  analysisGeneratedAt: timestamp("analysisGeneratedAt"), // v3 生成完了日時 (UTC)。legacy は NULL
  analysisPromptSha256: varchar("analysisPromptSha256", { length: 64 }), // プロンプト SHA-256（v3 / v3.1 の識別用）
  embedStatus: varchar("embedStatus", { length: 16 }).notNull().default("unknown"), // unknown | available | restricted
  embedReason: varchar("embedReason", { length: 128 }), // unavailable_private_or_deleted | unavailable_access_restricted | unavailable_embed_restricted | unavailable_page_unavailable
  embedCheckedAt: timestamp("embedCheckedAt"),
  addedDate: varchar("addedDate", { length: 16 }),      // 'YYYY-MM-DD'
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Video = typeof videos.$inferSelect;
export type InsertVideo = typeof videos.$inferInsert;

/**
 * Video scenes table — timestamped scene descriptions extracted from Ch.3 timelines.
 * Stored independently from `videos` so existing columns remain untouched.
 */
export const videoScenes = mysqlTable("videoScenes", {
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
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("video_scenes_video_shot_unique").on(table.videoId, table.shotIndex),
  index("video_scenes_video_id_idx").on(table.videoId),
  index("video_scenes_video_time_idx").on(table.videoId, table.startSec),
  index("video_scenes_version_idx").on(table.analysisVersion),
]);

export type VideoSceneRow = typeof videoScenes.$inferSelect;
export type InsertVideoScene = typeof videoScenes.$inferInsert;

/**
 * Archive history of previous `videos.aiAnalysis` snapshots preserved before v3 replacement.
 * Aligned with chibatmute's write script schema (`drizzle/add_analysis_version.sql`).
 */
export const videoAnalysisHistory = mysqlTable("videoAnalysisHistory", {
  id: int("id").autoincrement().primaryKey(),
  videoId: varchar("videoId", { length: 64 }).notNull(),
  analysisVersion: varchar("analysisVersion", { length: 16 }).notNull(),
  aiAnalysis: mediumtext("aiAnalysis").notNull(),
  contentSha256: varchar("contentSha256", { length: 64 }).notNull(),
  promptSha256: varchar("promptSha256", { length: 64 }),
  generatedAt: timestamp("generatedAt"),
  archivedAt: timestamp("archivedAt").defaultNow().notNull(),
  archivedBy: varchar("archivedBy", { length: 64 }),
}, (table) => [
  index("video_analysis_history_video_id_idx").on(table.videoId, table.archivedAt),
  index("video_analysis_history_version_idx").on(table.analysisVersion),
]);

export type VideoAnalysisHistoryRow = typeof videoAnalysisHistory.$inferSelect;
export type InsertVideoAnalysisHistory = typeof videoAnalysisHistory.$inferInsert;

/**
 * 公開端末でも利用者ごとにお気に入りを分離するための名前付きプロフィール。
 * 認証ユーザーには紐付けず、利用者名を明示して共有端末でも切り替えられるようにする。
 */
export const favoriteProfiles = mysqlTable("favoriteProfiles", {
  id: varchar("id", { length: 64 }).primaryKey(),
  displayName: varchar("displayName", { length: 80 }).notNull(),
  normalizedName: varchar("normalizedName", { length: 160 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("favorite_profiles_normalized_name_unique").on(table.normalizedName),
]);

/** 動画のお気に入りをプロフィール単位で保存する。 */
export const profileVideoFavorites = mysqlTable("profileVideoFavorites", {
  id: int("id").autoincrement().primaryKey(),
  profileId: varchar("profileId", { length: 64 }).notNull(),
  videoId: varchar("videoId", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("profile_video_favorites_profile_video_unique").on(table.profileId, table.videoId),
]);

/** 制作者のお気に入りをプロフィール単位で保存する。 */
export const profileCreatorFavorites = mysqlTable("profileCreatorFavorites", {
  id: int("id").autoincrement().primaryKey(),
  profileId: varchar("profileId", { length: 64 }).notNull(),
  creatorName: varchar("creatorName", { length: 160 }).notNull(),
  normalizedCreatorName: varchar("normalizedCreatorName", { length: 240 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("profile_creator_favorites_profile_creator_unique").on(table.profileId, table.normalizedCreatorName),
]);

export const dailyCollectionSources = mysqlTable("dailyCollectionSources", {
  id: varchar("id", { length: 64 }).primaryKey(),
  label: varchar("label", { length: 128 }).notNull(),
  url: text("url").notNull(),
  enabled: int("enabled").notNull().default(1),
  scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }),
  lastCheckedAt: timestamp("lastCheckedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const dailyCollectionRuns = mysqlTable("dailyCollectionRuns", {
  id: int("id").autoincrement().primaryKey(),
  taskUid: varchar("taskUid", { length: 65 }),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  status: varchar("status", { length: 32 }).notNull(),
  candidateCount: int("candidateCount").notNull().default(0),
  insertedCount: int("insertedCount").notNull().default(0),
  updatedCount: int("updatedCount").notNull().default(0),
  skippedCount: int("skippedCount").notNull().default(0),
  details: mediumtext("details"),
});

export const aiMetadataCompletionJobs = mysqlTable("aiMetadataCompletionJobs", {
  id: varchar("id", { length: 64 }).primaryKey(),
  scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }),
  backupScheduleCronTaskUid: varchar("backupScheduleCronTaskUid", { length: 65 }),
  enabled: int("enabled").notNull().default(1),
  batchSize: int("batchSize").notNull().default(5),
  consecutiveModelFailureCount: int("consecutiveModelFailureCount").notNull().default(0),
  retryAfter: timestamp("retryAfter"),
  lastRunAt: timestamp("lastRunAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const aiMetadataCompletionRuns = mysqlTable("aiMetadataCompletionRuns", {
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
  details: mediumtext("details"),
});
