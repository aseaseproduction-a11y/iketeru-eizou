import { asc, desc, eq, sql } from "drizzle-orm";
import { and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  favoriteProfiles,
  InsertUser,
  InsertVideo,
  profileCreatorFavorites,
  profileVideoFavorites,
  users,
  videos,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { cleanFavoriteDisplayName, normalizeFavoriteCreatorName, normalizeFavoriteProfileName } from "@shared/favoriteProfiles";
import { getProductionNames, getProductionRoles, normalizeProductionCredits, type ProductionCredit } from "@shared/productionCredits";
import {
  getSynonymsForWord,
  parseQueryWords,
  SCENE_CATEGORY_DEFINITIONS,
  type KeywordCategory,
  type SceneScoreFilter,
} from "@shared/sceneSearchMeta";
import {
  normalizeAnalysisVersion,
  type AnalysisVersion,
} from "@shared/analysisVersion";
import { parseCalibratedScoreAxes } from "@shared/calibratedScoreAxes";

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: mysql.Pool | null = null;

function createMysqlPool(databaseUrl: string): mysql.Pool {
  const needsTls =
    /tidbcloud\.com|psdb\.cloud|aivencloud\.com/i.test(databaseUrl) ||
    process.env.MYSQL_SSL === "true" ||
    /[?&]ssl=/i.test(databaseUrl);
  return mysql.createPool({
    uri: databaseUrl,
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_POOL_LIMIT ?? 5),
    queueLimit: 0,
    enableKeepAlive: true,
    ...(needsTls ? { ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true } } : {}),
  });
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
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

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ============================================================
// Video queries
// ============================================================

export async function getAllVideos() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(videos).orderBy(desc(videos.createdAt));
  return rows.map(parseVideoRow);
}

/** 一覧表示用。重量の大きい分析本文・分類監査・スコア内訳はSQLレベルで除外し、詳細表示時にのみ取得する。 */
export async function getAllVideoListItems() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
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
      isProvisional: sql<number>`CASE WHEN ${videos.aiScoreBreakdown} LIKE '%"analysisStatus":"provisional"%' OR ${videos.aiScoreBreakdown} LIKE '%"isProvisional":true%' THEN 1 ELSE 0 END`,
      gradeBoundary: sql<number>`CASE WHEN ${videos.aiScoreBreakdown} LIKE '%"gradeBoundary":true%' THEN 1 ELSE 0 END`,
      visualVerificationStatus: sql<string>`CASE WHEN ${videos.aiScoreBreakdown} LIKE '%"visualVerificationStatus":"log_verified"%' THEN 'log_verified' WHEN ${videos.aiScoreBreakdown} LIKE '%"visualVerificationStatus":"unverifiable_no_log"%' THEN 'unverifiable_no_log' WHEN ${videos.aiScoreBreakdown} LIKE '%"visualVerificationStatus":"unverified_pending"%' THEN 'unverified_pending' WHEN ${videos.aiScoreBreakdown} LIKE '%"visualVerificationStatus":"invalidated_no_visual"%' THEN 'invalidated_no_visual' ELSE 'not_audited' END`,
    })
    .from(videos)
    .orderBy(desc(videos.createdAt));
  return rows.map((row) => {
    const { isProvisional, gradeBoundary, visualVerificationStatus, ...rest } = row;
    const video = parseVideoRow({
      ...(rest as unknown as typeof videos.$inferSelect),
      aiAnalysis: null,
      aiScoreBreakdown: null,
      calibratedBreakdown: null,
      metadataClassificationAudit: null,
    });
    return {
      ...video,
      isProvisional: Boolean(isProvisional),
      gradeBoundary: Boolean(gradeBoundary),
      visualVerificationStatus: (visualVerificationStatus || "not_audited") as "log_verified" | "unverifiable_no_log" | "unverified_pending" | "invalidated_no_visual" | "not_audited",
      aiAnalysis: "",
      aiScoreBreakdown: undefined,
      calibratedBreakdown: undefined,
      metadataClassificationAudit: undefined,
    };
  });
}

export async function getVideoCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db.select({ count: sql<number>`COUNT(*)` }).from(videos);
  return Number(row?.count ?? 0);
}

export async function getVideoById(id: string) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(videos).where(eq(videos.id, id)).limit(1);
  return row ? parseVideoRow(row) : null;
}

export async function createVideo(input: InsertVideo) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(videos).values(input);
  return getVideoById(input.id);
}

export async function updateVideo(
  id: string,
  input: Omit<Partial<InsertVideo>, "id">
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(videos).set(input).where(eq(videos.id, id));
  return getVideoById(id);
}

export async function updateMetadataClassificationIfMatching(
  identity: { id: string; title: string; videoUrl: string },
  input: Pick<InsertVideo, "genres" | "products" | "directions" | "tones" | "purposes" | "expressions" | "allTags" | "metadataClassificationAudit">
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(videos)
    .set(input)
    .where(and(eq(videos.id, identity.id), eq(videos.title, identity.title), eq(videos.videoUrl, identity.videoUrl)));
  return getVideoById(identity.id);
}

export async function deleteVideo(id: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(videos).where(eq(videos.id, id));
}

export async function updateEmbedStatus(
  id: string,
  status: "available" | "restricted"
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(videos)
    .set({
      embedStatus: status,
      embedReason: status === "available" ? null : "unavailable_embed_restricted",
      embedCheckedAt: new Date(),
    })
    .where(eq(videos.id, id));
  return getVideoById(id);
}

// ============================================================
// Named favorite profiles
// ============================================================

export async function listFavoriteProfiles() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(favoriteProfiles).orderBy(asc(favoriteProfiles.displayName));
}

export async function getFavoriteProfileById(id: string) {
  const db = await getDb();
  if (!db) return null;
  const [profile] = await db.select().from(favoriteProfiles).where(eq(favoriteProfiles.id, id)).limit(1);
  return profile ?? null;
}

export async function getFavoriteProfileByNormalizedName(normalizedName: string) {
  const db = await getDb();
  if (!db) return null;
  const [profile] = await db.select().from(favoriteProfiles).where(eq(favoriteProfiles.normalizedName, normalizedName)).limit(1);
  return profile ?? null;
}

export async function createFavoriteProfile(displayName: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const cleanName = cleanFavoriteDisplayName(displayName);
  const profile = {
    id: crypto.randomUUID(),
    displayName: cleanName,
    normalizedName: normalizeFavoriteProfileName(cleanName),
  };
  await db.insert(favoriteProfiles).values(profile);
  return getFavoriteProfileById(profile.id);
}

export async function renameFavoriteProfile(id: string, displayName: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const cleanName = cleanFavoriteDisplayName(displayName);
  await db.update(favoriteProfiles).set({
    displayName: cleanName,
    normalizedName: normalizeFavoriteProfileName(cleanName),
  }).where(eq(favoriteProfiles.id, id));
  return getFavoriteProfileById(id);
}

export async function deleteFavoriteProfile(id: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(profileVideoFavorites).where(eq(profileVideoFavorites.profileId, id));
  await db.delete(profileCreatorFavorites).where(eq(profileCreatorFavorites.profileId, id));
  await db.delete(favoriteProfiles).where(eq(favoriteProfiles.id, id));
}

export async function getFavoriteProfileItems(profileId: string) {
  const db = await getDb();
  if (!db) return { videoIds: [], creatorNames: [] };
  const [videoRows, creatorRows] = await Promise.all([
    db.select({ videoId: profileVideoFavorites.videoId })
      .from(profileVideoFavorites)
      .where(eq(profileVideoFavorites.profileId, profileId))
      .orderBy(desc(profileVideoFavorites.createdAt)),
    db.select({ creatorName: profileCreatorFavorites.creatorName })
      .from(profileCreatorFavorites)
      .where(eq(profileCreatorFavorites.profileId, profileId))
      .orderBy(asc(profileCreatorFavorites.creatorName)),
  ]);
  return {
    videoIds: videoRows.map((row) => row.videoId),
    creatorNames: creatorRows.map((row) => row.creatorName),
  };
}

export async function toggleFavoriteProfileVideo(profileId: string, videoId: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [existing] = await db.select({ id: profileVideoFavorites.id })
    .from(profileVideoFavorites)
    .where(and(eq(profileVideoFavorites.profileId, profileId), eq(profileVideoFavorites.videoId, videoId)))
    .limit(1);
  if (existing) {
    await db.delete(profileVideoFavorites).where(eq(profileVideoFavorites.id, existing.id));
    return { isFavorite: false };
  }
  await db.insert(profileVideoFavorites).values({ profileId, videoId });
  return { isFavorite: true };
}

export async function toggleFavoriteProfileCreator(profileId: string, creatorName: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const cleanName = cleanFavoriteDisplayName(creatorName);
  const normalizedCreatorName = normalizeFavoriteCreatorName(cleanName);
  const [existing] = await db.select({ id: profileCreatorFavorites.id })
    .from(profileCreatorFavorites)
    .where(and(
      eq(profileCreatorFavorites.profileId, profileId),
      eq(profileCreatorFavorites.normalizedCreatorName, normalizedCreatorName),
    ))
    .limit(1);
  if (existing) {
    await db.delete(profileCreatorFavorites).where(eq(profileCreatorFavorites.id, existing.id));
    return { isFavorite: false };
  }
  await db.insert(profileCreatorFavorites).values({ profileId, creatorName: cleanName, normalizedCreatorName });
  return { isFavorite: true };
}

/** 旧ブラウザ内お気に入りを、指定プロフィールへ重複なく一回移植する。 */
export async function mergeLegacyFavoritesIntoProfile(profileId: string, videoIds: string[], creatorNames: string[]) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await getFavoriteProfileById(profileId);
  if (!existing) throw new Error("Favorite profile not found");

  for (const videoId of Array.from(new Set(videoIds))) {
    const [current] = await db.select({ id: profileVideoFavorites.id })
      .from(profileVideoFavorites)
      .where(and(eq(profileVideoFavorites.profileId, profileId), eq(profileVideoFavorites.videoId, videoId)))
      .limit(1);
    if (!current) await db.insert(profileVideoFavorites).values({ profileId, videoId });
  }
  for (const creatorName of Array.from(new Set(creatorNames.map(cleanFavoriteDisplayName).filter(Boolean)))) {
    const normalizedCreatorName = normalizeFavoriteCreatorName(creatorName);
    const [current] = await db.select({ id: profileCreatorFavorites.id })
      .from(profileCreatorFavorites)
      .where(and(
        eq(profileCreatorFavorites.profileId, profileId),
        eq(profileCreatorFavorites.normalizedCreatorName, normalizedCreatorName),
      ))
      .limit(1);
    if (!current) await db.insert(profileCreatorFavorites).values({ profileId, creatorName, normalizedCreatorName });
  }
  return getFavoriteProfileItems(profileId);
}

/** Parse a raw DB row back into the Video shape the frontend expects */
export function parseVideoRow(row: typeof videos.$inferSelect) {
  const legacyProductions = safeParseJson<string[]>(row.productions, []);
  const productionCredits = normalizeProductionCredits(
    safeParseJson<ProductionCredit[]>(row.productionCredits, []),
    legacyProductions,
  );
  const productions = getProductionNames(productionCredits);
  const allTags = Array.from(new Set([
    ...safeParseJson<string[]>(row.allTags, []),
    ...productions,
    ...getProductionRoles(productionCredits),
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
    metadataClassificationAudit: safeParseJson(row.metadataClassificationAudit, undefined),
    privateRating: row.privateRating ?? "",
    aiOverallRating: row.aiOverallRating ?? "",
    aiDirectionRating: row.aiDirectionRating ?? "",
    aiTechniqueRating: row.aiTechniqueRating ?? "",
    aiOverallScore: row.aiOverallScore ?? null,
    aiDirectionScore: row.aiDirectionScore ?? null,
    aiTechniqueScore: row.aiTechniqueScore ?? null,
    aiScoreBreakdown: safeParseJson(row.aiScoreBreakdown, undefined),
    aiAnalysis: row.aiAnalysis ?? "",
    calibrationStatus: (row.calibrationStatus ?? (row.aiOverallScore !== null || row.aiOverallRating ? "legacy_uncalibrated" : "unscored")) as "legacy_uncalibrated" | "unscored" | "calibrated_verified" | "calibrated_unverified_genre",
    calibratedScore: row.calibratedScore !== null && row.calibratedScore !== undefined ? Number(row.calibratedScore) : null,
    calibratedRank: row.calibratedRank ?? null,
    calibratedTierBand: (row.calibratedTierBand ?? null) as "award_tier" | "pro_band" | "low_band" | null,
    calibratedBreakdown: safeParseJson(row.calibratedBreakdown, undefined),
    calibratedScoreAxes: parseCalibratedScoreAxes((row as { calibratedScoreAxes?: unknown }).calibratedScoreAxes),
    calibrationVersion: row.calibrationVersion ?? null,
    calibratedAt: row.calibratedAt ? row.calibratedAt.toISOString() : null,
    calibratedRoute: (row.calibratedRoute ?? null) as "video_h1" | "video_h2_escalated" | "contact_sheet" | null,
    calibratedRunId: row.calibratedRunId ?? null,
    calibrationGenreBucket: row.calibrationGenreBucket ?? null,
    analysisObservationScope: row.analysisObservationScope ?? null,
    analysisVersion: normalizeAnalysisVersion((row as { analysisVersion?: unknown }).analysisVersion),
    analysisGeneratedAt:
      row.analysisGeneratedAt instanceof Date
        ? row.analysisGeneratedAt.toISOString()
        : typeof row.analysisGeneratedAt === "string"
          ? row.analysisGeneratedAt
          : null,
    analysisPromptSha256: row.analysisPromptSha256 ?? null,
    isProvisional: isProvisionalFromBreakdown(row.aiScoreBreakdown),
    gradeBoundary: isGradeBoundaryFromBreakdown(row.aiScoreBreakdown),
    visualVerificationStatus: getVisualVerificationStatus(row.aiScoreBreakdown),
    embedStatus: row.embedStatus ?? "unknown",
    embedReason: row.embedReason ?? "",
    embedCheckedAt: row.embedCheckedAt?.toISOString() ?? "",
    addedDate: row.addedDate ?? "",
  };
}

function isProvisionalFromBreakdown(aiScoreBreakdown: string | null | undefined): boolean {
  const bd = safeParseJson<Record<string, unknown> | null>(aiScoreBreakdown, null);
  if (!bd) return false;
  return bd.analysisStatus === "provisional" || bd.isProvisional === true;
}

function isGradeBoundaryFromBreakdown(aiScoreBreakdown: string | null | undefined): boolean {
  const bd = safeParseJson<Record<string, unknown> | null>(aiScoreBreakdown, null);
  return bd?.gradeBoundary === true;
}

function getVisualVerificationStatus(
  aiScoreBreakdown: string | null | undefined
): "log_verified" | "unverifiable_no_log" | "unverified_pending" | "invalidated_no_visual" | "not_audited" {
  const bd = safeParseJson<Record<string, unknown> | null>(aiScoreBreakdown, null);
  const v = bd?.visualVerificationStatus;
  if (v === "log_verified" || v === "unverifiable_no_log" || v === "unverified_pending" || v === "invalidated_no_visual") {
    return v;
  }
  return "not_audited";
}

function safeParseJson<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str) as T; } catch { return fallback; }
}

// ============================================================
// Video Scenes search queries (with safe missing-table fallback)
// ============================================================

export interface VideoSceneApiItem {
  id: string;
  videoId: string;
  videoTitle: string;
  platform: string;
  sceneNumber: number;
  startSeconds: number;
  endSeconds: number;
  timeRange: string;
  visual: string;
  audio: string;
  keywords: string[];
  thumbnailUrl: string;
  analysisObservationScope: string | null;
  analysisVersion: AnalysisVersion;
  analysisGeneratedAt: string | null;
  calibratedScore: number | null;
  calibratedRank: string | null;
  aiOverallScore: number | null;
  aiOverallRating: string | null;
}

export interface VideoSceneSearchResponse {
  available: boolean;
  source: "tidb" | "table_unavailable";
  items: Array<{
    scene: VideoSceneApiItem;
    score: number;
    matchedTerms: string[];
  }>;
  total: number;
  hasMore: boolean;
  totalIndexedScenes: number;
  totalIndexedVideos: number;
}

export interface VideoSceneKeywordStatsResponse {
  available: boolean;
  source: "tidb" | "table_unavailable";
  totalScenes: number;
  totalVideos: number;
  categories: KeywordCategory[];
}

export function isMissingVideoScenesTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: unknown; errno?: unknown; message?: unknown; cause?: unknown };
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

export function buildVideoSceneFilterWhere(params: {
  query?: string;
  excludeUnwatched?: boolean;
  excludeLegacyAnalysis?: boolean;
  scoreFilter?: SceneScoreFilter;
}): { whereSql: string; whereParams: unknown[]; wordGroups: string[][] } {
  const clauses: string[] = [
    "(v.embedReason IS NULL OR v.embedReason NOT IN ('unavailable_deleted', 'unavailable_private'))",
  ];
  const whereParams: unknown[] = [];

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
    wordGroups,
  };
}

function buildThumbnailUrl(platform: string, videoId: string, storedThumbnail: string | null): string {
  if (storedThumbnail && storedThumbnail.trim()) return storedThumbnail.trim();
  if (platform === "youtube") return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  return "";
}

export async function searchVideoScenes(params: {
  query?: string;
  limit?: number;
  offset?: number;
  excludeUnwatched?: boolean;
  excludeLegacyAnalysis?: boolean;
  scoreFilter?: SceneScoreFilter;
  poolOverride?: Pick<mysql.Pool, "query">;
}): Promise<VideoSceneSearchResponse> {
  const pool = params.poolOverride ?? (await getDb(), _pool);
  if (!pool) {
    return {
      available: false,
      source: "table_unavailable",
      items: [],
      total: 0,
      hasMore: false,
      totalIndexedScenes: 0,
      totalIndexedVideos: 0,
    };
  }

  const limit = Math.max(1, Math.min(80, Math.floor(params.limit ?? 40)));
  const offset = Math.max(0, Math.min(5000, Math.floor(params.offset ?? 0)));
  const { whereSql, whereParams, wordGroups } = buildVideoSceneFilterWhere({
    query: params.query,
    excludeUnwatched: params.excludeUnwatched,
    excludeLegacyAnalysis: params.excludeLegacyAnalysis,
    scoreFilter: params.scoreFilter,
  });

  try {
    const [[totalsRow]] = (await pool.query(
      "SELECT COUNT(*) AS totalScenes, COUNT(DISTINCT videoId) AS totalVideos FROM videoScenes",
    )) as unknown as [Array<{ totalScenes: number; totalVideos: number }>];

    const [[countRow]] = (await pool.query(
      `SELECT COUNT(*) AS cnt
       FROM videoScenes s
       INNER JOIN videos v ON v.id = s.videoId
       WHERE ${whereSql}`,
      whereParams,
    )) as unknown as [Array<{ cnt: number }>];

    const total = Number(countRow?.cnt ?? 0);
    if (total === 0) {
      return {
        available: true,
        source: "tidb",
        items: [],
        total: 0,
        hasMore: false,
        totalIndexedScenes: Number(totalsRow?.totalScenes ?? 0),
        totalIndexedVideos: Number(totalsRow?.totalVideos ?? 0),
      };
    }

    const [rows] = (await pool.query(
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
      [...whereParams, limit, offset],
    )) as unknown as [Array<Record<string, unknown>>];

    const items = rows.map((row) => {
      const videoId = String(row.videoId ?? "");
      const platform = String(row.platform ?? "youtube");
      const shotIndex = Number(row.shotIndex ?? 1);
      const shotTitle = String(row.shotTitle ?? "").trim();
      const description = String(row.description ?? "").trim();
      const visual = shotTitle && description && !description.startsWith(shotTitle)
        ? `${shotTitle} — ${description}`
        : description || shotTitle;
      const audio = String(row.audioText ?? "").trim();
      const keywords = safeParseJson<string[]>(row.keywordsJson as string, []);
      const videoTitle = String(row.videoTitle ?? "");

      const matchedTermsSet = new Set<string>();
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
          thumbnailUrl: buildThumbnailUrl(platform, videoId, (row.thumbnail as string | null) ?? null),
          analysisObservationScope: (row.analysisObservationScope as string | null) ?? null,
          analysisVersion: normalizeAnalysisVersion(row.analysisVersion),
          analysisGeneratedAt:
            row.analysisGeneratedAt instanceof Date
              ? row.analysisGeneratedAt.toISOString()
              : typeof row.analysisGeneratedAt === "string"
                ? row.analysisGeneratedAt
                : null,
          calibratedScore: row.calibratedScore != null ? Number(row.calibratedScore) : null,
          calibratedRank: (row.calibratedRank as string | null) ?? null,
          aiOverallScore: row.aiOverallScore != null ? Number(row.aiOverallScore) : null,
          aiOverallRating: (row.aiOverallRating as string | null) ?? null,
        },
        score: score || 1,
        matchedTerms: Array.from(matchedTermsSet),
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
      totalIndexedVideos: Number(totalsRow?.totalVideos ?? 0),
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
        totalIndexedVideos: 0,
      };
    }
    throw error;
  }
}

export async function getVideoSceneKeywordStats(params: {
  excludeUnwatched?: boolean;
  excludeLegacyAnalysis?: boolean;
  scoreFilter?: SceneScoreFilter;
  poolOverride?: Pick<mysql.Pool, "query">;
}): Promise<VideoSceneKeywordStatsResponse> {
  const pool = params.poolOverride ?? (await getDb(), _pool);
  if (!pool) {
    return {
      available: false,
      source: "table_unavailable",
      totalScenes: 0,
      totalVideos: 0,
      categories: [],
    };
  }

  const { whereSql, whereParams } = buildVideoSceneFilterWhere({
    excludeUnwatched: params.excludeUnwatched,
    excludeLegacyAnalysis: params.excludeLegacyAnalysis,
    scoreFilter: params.scoreFilter,
  });

  try {
    const [rows] = (await pool.query(
      `SELECT s.videoId, s.searchText
       FROM videoScenes s
       INNER JOIN videos v ON v.id = s.videoId
       WHERE ${whereSql}`,
      whereParams,
    )) as unknown as [Array<{ videoId: string; searchText: string }>];

    const videoIds = new Set<string>();
    const texts: string[] = [];
    for (const r of rows) {
      videoIds.add(String(r.videoId));
      texts.push(String(r.searchText ?? "").toLowerCase());
    }

    const categories: KeywordCategory[] = SCENE_CATEGORY_DEFINITIONS.map((cat) => {
      const validKeywords: { text: string; count: number }[] = [];
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
        keywords: validKeywords,
      };
    });

    return {
      available: true,
      source: "tidb",
      totalScenes: rows.length,
      totalVideos: videoIds.size,
      categories,
    };
  } catch (error) {
    if (isMissingVideoScenesTableError(error)) {
      return {
        available: false,
        source: "table_unavailable",
        totalScenes: 0,
        totalVideos: 0,
        categories: [],
      };
    }
    throw error;
  }
}
