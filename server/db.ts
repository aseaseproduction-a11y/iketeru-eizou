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

/** 一覧表示用。重量の大きい分析本文・分類監査は詳細表示時にのみ取得する。 */
export async function getAllVideoListItems() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(videos).orderBy(desc(videos.createdAt));
  return rows.map((row) => {
    const video = parseVideoRow(row);
    return {
      ...video,
      aiAnalysis: "",
      aiScoreBreakdown: undefined,
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
    embedStatus: row.embedStatus ?? "unknown",
    embedReason: row.embedReason ?? "",
    embedCheckedAt: row.embedCheckedAt?.toISOString() ?? "",
    addedDate: row.addedDate ?? "",
  };
}

function safeParseJson<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str) as T; } catch { return fallback; }
}
