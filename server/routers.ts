import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, writeProtectedProcedure } from "./_core/trpc";
import {
  createFavoriteProfile,
  createVideo,
  deleteFavoriteProfile,
  deleteVideo,
  getFavoriteProfileById,
  getFavoriteProfileByNormalizedName,
  getFavoriteProfileItems,
  getAllVideoListItems,
  getVideoById,
  getVideoCount,
  getVideoSceneKeywordStats,
  listFavoriteProfiles,
  mergeLegacyFavoritesIntoProfile,
  renameFavoriteProfile,
  searchVideoScenes,
  toggleFavoriteProfileCreator,
  toggleFavoriteProfileVideo,
  updateEmbedStatus,
  updateMetadataClassificationIfMatching,
  updateVideo,
} from "./db";
import { fetchExternalMediaMetadata } from "./externalMediaMetadata";
import { classifyVideoMetadata } from "./metadataAutoClassification";
import { normalizeFavoriteProfileName } from "@shared/favoriteProfiles";
import { EXPRESSION_OPTIONS, PURPOSE_OPTIONS, restrictToAllowedOptions } from "@shared/metadataOptions";
import { getProductionNames, getProductionRoles, normalizeProductionCredits, type ProductionCredit } from "@shared/productionCredits";
import { resolveRatingPair } from "@shared/ratingScale";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const tagSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(120),
});

const stringListSchema = z.array(z.string().trim().min(1).max(120)).default([]);
const productionCreditSchema = z.object({
  name: z.string().trim().min(1).max(120),
  roles: stringListSchema,
  entityType: z.enum(["person", "company", "unknown"]).default("unknown"),
});
const awardEntrySchema = z.object({
  name: z.string().trim().min(1).max(240),
  year: z.string().trim().min(1).max(32),
  category: z.string().trim().min(1).max(240),
  sourceUrl: z.string().url(),
});
const curationNoteSchema = z.object({
  purpose: z.string().trim().max(20_000).default(""),
  background: z.string().trim().max(20_000).default(""),
  evaluation: z.string().trim().max(20_000).default(""),
  clientPitch: z.string().trim().max(20_000).optional().default(""),
  sourceUrls: z.array(z.string().url()).default([]),
}).default({ purpose: "", background: "", evaluation: "", clientPitch: "", sourceUrls: [] });
const favoriteProfileIdSchema = z.string().uuid();
const favoriteProfileNameSchema = z.string().trim().min(1, "利用者名を入力してください").max(80, "利用者名は80文字以内にしてください");

const videoWriteSchema = z.object({
  platform: z.enum(["youtube", "vimeo", "x", "tiktok", "instagram", "external"]),
  title: z.string().trim().min(1).max(500),
  thumbnail: z.string().trim().default(""),
  videoUrl: z.string().url(),
  embedUrl: z.string().trim().default(""),
  source: z.string().trim().max(64).default("manual"),
  sourceLabel: z.string().trim().max(120).default("手動追加"),
  channelId: z.string().trim().max(64).default(""),
  channelTitle: z.string().trim().max(300).default(""),
  genres: z.array(tagSchema).default([]),
  products: z.array(tagSchema).default([]),
  directions: z.array(tagSchema).default([]),
  tones: z.array(tagSchema).default([]),
  tags: stringListSchema,
  purposes: stringListSchema.transform((values) => restrictToAllowedOptions(values, PURPOSE_OPTIONS)),
  expressions: stringListSchema.transform((values) => restrictToAllowedOptions(values, EXPRESSION_OPTIONS)),
  toneEmotions: stringListSchema,
  toneVisuals: stringListSchema,
  toneTechniques: stringListSchema,
  productions: stringListSchema,
  productionCredits: z.array(productionCreditSchema).default([]),
  awards: z.array(awardEntrySchema).default([]),
  curationNote: curationNoteSchema,
  privateRating: z.string().trim().max(16).default(""),
  aiOverallRating: z.string().trim().max(16).default(""),
  aiDirectionRating: z.string().trim().max(16).default(""),
  aiTechniqueRating: z.string().trim().max(16).default(""),
  aiOverallScore: z.number().int().min(0).max(100).nullable().optional(),
  aiDirectionScore: z.number().int().min(0).max(100).nullable().optional(),
  aiTechniqueScore: z.number().int().min(0).max(100).nullable().optional(),
  aiScoreBreakdown: z.record(z.string(), z.unknown()).nullable().optional(),
  aiAnalysis: z.string().trim().max(1_000_000).default(""),
  addedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

type VideoWriteInput = z.infer<typeof videoWriteSchema>;

async function enrichMetadataAfterWrite(id: string, input: VideoWriteInput) {
  const parsedInput = {
    id, title: input.title, videoUrl: input.videoUrl, source: input.source, sourceLabel: input.sourceLabel, channelTitle: input.channelTitle,
    allTags: input.tags, curationNote: input.curationNote, genres: input.genres, products: input.products, directions: input.directions, tones: input.tones, purposes: input.purposes, expressions: input.expressions,
  };
  const result = await classifyVideoMetadata(parsedInput);
  const audit = JSON.stringify({ status: result.status, confidence: result.confidence, evidence: result.evidence, reason: result.reason, updatedFields: Object.keys(result.updates), processedAt: new Date().toISOString() });
  const classifiedTagNames = [
    ...(result.updates.genres ?? []), ...(result.updates.products ?? []), ...(result.updates.directions ?? []), ...(result.updates.tones ?? []),
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
      ...input.genres, ...input.products, ...input.directions, ...input.tones,
      ...classifiedTagNames,
      ...(result.updates.purposes ?? input.purposes),
      ...(result.updates.expressions ?? input.expressions),
    ].map((item) => typeof item === "string" ? item : item.name)))),
    metadataClassificationAudit: audit,
  };
  return updateMetadataClassificationIfMatching({ id, title: input.title, videoUrl: input.videoUrl }, categories);
}

function toVideoRecord(input: VideoWriteInput) {
  const productionCredits = normalizeProductionCredits(input.productionCredits as ProductionCredit[], input.productions);
  const productions = getProductionNames(productionCredits);
  const productionRoles = getProductionRoles(productionCredits);
  const categoryTags = [
    ...input.genres,
    ...input.products,
    ...input.directions,
    ...input.tones,
  ].map((tag) => tag.name);
  const allTags = Array.from(
    new Set([
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
      input.curationNote.purpose,
    ])
  );

  return {
    platform: input.platform,
    title: input.title,
    thumbnail: input.thumbnail || null,
    videoUrl: input.videoUrl,
    embedUrl: input.embedUrl || null,
    source: input.source || "manual",
    sourceLabel: input.sourceLabel || "手動追加",
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
    addedDate: input.addedDate,
  };
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  favorites: router({
    /** 共有端末で選択できる、名前付きのお気に入りプロフィール一覧。 */
    profiles: publicProcedure.query(() => listFavoriteProfiles()),

    items: publicProcedure
      .input(z.object({ profileId: favoriteProfileIdSchema }))
      .query(async ({ input }) => {
        const profile = await getFavoriteProfileById(input.profileId);
        if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "利用者プロフィールが見つかりません" });
        return getFavoriteProfileItems(input.profileId);
      }),

    createProfile: writeProtectedProcedure
      .input(z.object({ displayName: favoriteProfileNameSchema }))
      .mutation(async ({ input }) => {
        const normalizedName = normalizeFavoriteProfileName(input.displayName);
        const existing = await getFavoriteProfileByNormalizedName(normalizedName);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "同じ利用者名がすでにあります" });
        const profile = await createFavoriteProfile(input.displayName);
        if (!profile) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "利用者プロフィールを作成できませんでした" });
        return profile;
      }),

    renameProfile: writeProtectedProcedure
      .input(z.object({ profileId: favoriteProfileIdSchema, displayName: favoriteProfileNameSchema }))
      .mutation(async ({ input }) => {
        const profile = await getFavoriteProfileById(input.profileId);
        if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "利用者プロフィールが見つかりません" });
        const normalizedName = normalizeFavoriteProfileName(input.displayName);
        const existing = await getFavoriteProfileByNormalizedName(normalizedName);
        if (existing && existing.id !== input.profileId) throw new TRPCError({ code: "CONFLICT", message: "同じ利用者名がすでにあります" });
        const renamed = await renameFavoriteProfile(input.profileId, input.displayName);
        if (!renamed) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "利用者プロフィールを変更できませんでした" });
        return renamed;
      }),

    deleteProfile: writeProtectedProcedure
      .input(z.object({ profileId: favoriteProfileIdSchema }))
      .mutation(async ({ input }) => {
        await deleteFavoriteProfile(input.profileId);
        return { success: true } as const;
      }),

    toggleVideo: writeProtectedProcedure
      .input(z.object({ profileId: favoriteProfileIdSchema, videoId: z.string().trim().min(1).max(64) }))
      .mutation(async ({ input }) => {
        const profile = await getFavoriteProfileById(input.profileId);
        if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "利用者プロフィールが見つかりません" });
        return toggleFavoriteProfileVideo(input.profileId, input.videoId);
      }),

    toggleCreator: writeProtectedProcedure
      .input(z.object({ profileId: favoriteProfileIdSchema, creatorName: z.string().trim().min(1).max(160) }))
      .mutation(async ({ input }) => {
        const profile = await getFavoriteProfileById(input.profileId);
        if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "利用者プロフィールが見つかりません" });
        return toggleFavoriteProfileCreator(input.profileId, input.creatorName);
      }),

    migrateLegacy: writeProtectedProcedure
      .input(z.object({
        profileId: favoriteProfileIdSchema,
        videoIds: z.array(z.string().trim().min(1).max(64)).max(5_000),
        creatorNames: z.array(z.string().trim().min(1).max(160)).max(5_000),
      }))
      .mutation(({ input }) => mergeLegacyFavoritesIntoProfile(input.profileId, input.videoIds, input.creatorNames)),
  }),

  videos: router({
    /** Get all videos from DB */
    list: publicProcedure.query(async () => {
      return await getAllVideoListItems();
    }),

    /** Get full metadata only when a video detail is opened. */
    get: publicProcedure.input(z.object({ id: z.string().min(1).max(64) })).query(async ({ input }) => {
      return await getVideoById(input.id);
    }),

    /** Get total video count */
    count: publicProcedure.query(async () => {
      return await getVideoCount();
    }),

    previewExternalMedia: writeProtectedProcedure
      .input(z.object({
        platform: z.enum(["x", "tiktok", "instagram", "vimeo"]),
        url: z.string().url(),
      }))
      .mutation(async ({ input }) => fetchExternalMediaMetadata(input)),

    create: writeProtectedProcedure
      .input(videoWriteSchema.extend({ id: z.string().trim().min(1).max(64) }))
      .mutation(async ({ input }) => {
        const { id, ...values } = input;
        const existing = await getVideoById(id);
        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "この動画はすでに登録されています。既存の動画を一覧から編集してください。",
          });
        }
        const created = await createVideo({ id, ...toVideoRecord(values) });
        if (!created) return created;
        const enriched = await enrichMetadataAfterWrite(id, values);
        return enriched ?? created;
      }),

    update: writeProtectedProcedure
      .input(videoWriteSchema.extend({ id: z.string().trim().min(1).max(64) }))
      .mutation(async ({ input }) => {
        const { id, ...values } = input;
        const updated = await updateVideo(id, toVideoRecord(values));
        if (!updated) return updated;
        const enriched = await enrichMetadataAfterWrite(id, values);
        return enriched ?? updated;
      }),

    recordEmbedStatus: writeProtectedProcedure
      .input(z.object({ id: z.string().trim().min(1).max(64), status: z.enum(["available", "restricted"]) }))
      .mutation(async ({ input }) => updateEmbedStatus(input.id, input.status)),

    delete: writeProtectedProcedure
      .input(z.object({ id: z.string().trim().min(1).max(64) }))
      .mutation(async ({ input }) => {
        await deleteVideo(input.id);
        return { success: true } as const;
      }),
  }),

  scenes: router({
    /** Search scenes in TiDB videoScenes table (returns available: false if table does not exist yet). */
    search: publicProcedure
      .input(
        z.object({
          query: z.string().max(200).default(""),
          limit: z.number().int().min(1).max(80).default(40),
          offset: z.number().int().min(0).max(5000).default(0),
          excludeUnwatched: z.boolean().default(true),
          excludeLegacyAnalysis: z.boolean().default(false),
          scoreFilter: z.enum(["all", "calibrated_only", "score_78_plus", "score_83_plus", "uncalibrated_only"]).default("all"),
        }),
      )
      .query(async ({ input }) => searchVideoScenes(input)),

    /** Keyword preset counts aggregated from TiDB videoScenes (safe fallback when table is absent). */
    keywordStats: publicProcedure
      .input(
        z
          .object({
            excludeUnwatched: z.boolean().default(true),
            excludeLegacyAnalysis: z.boolean().default(false),
            scoreFilter: z.enum(["all", "calibrated_only", "score_78_plus", "score_83_plus", "uncalibrated_only"]).default("all"),
          })
          .optional(),
      )
      .query(async ({ input }) =>
        getVideoSceneKeywordStats({
          excludeUnwatched: input?.excludeUnwatched ?? true,
          excludeLegacyAnalysis: input?.excludeLegacyAnalysis ?? false,
          scoreFilter: input?.scoreFilter ?? "all",
        }),
      ),
  }),
});

export type AppRouter = typeof appRouter;
