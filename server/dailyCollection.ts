import type { Request, Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { dailyCollectionRuns, dailyCollectionSources, videos } from "../drizzle/schema";
import { createVideo, getDb } from "./db";
import { sdk } from "./_core/sdk";

type DailyCollectionOembed = {
  title?: unknown;
  thumbnail_url?: unknown;
  author_name?: unknown;
};

type DailyCollectionExistingVideo = Pick<typeof videos.$inferSelect, "thumbnail" | "channelTitle" | "curationNote" | "genres" | "products" | "purposes">;

type DailyCollectionArticleMetadata = {
  genres?: unknown;
  products?: unknown;
  purposes?: unknown;
};

function parseDailyCollectionCurationNote(value: string | null) {
  const fallback = { purpose: "", background: "", evaluation: "", sourceUrls: [] as string[] };
  if (!value) return fallback;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    const note = parsed as Record<string, unknown>;
    return {
      purpose: typeof note.purpose === "string" ? note.purpose : "",
      background: typeof note.background === "string" ? note.background : "",
      evaluation: typeof note.evaluation === "string" ? note.evaluation : "",
      ...(typeof note.clientPitch === "string" && note.clientPitch ? { clientPitch: note.clientPitch } : {}),
      sourceUrls: Array.isArray(note.sourceUrls)
        ? note.sourceUrls.filter((url): url is string => typeof url === "string" && /^https?:\/\//.test(url))
        : [],
    };
  } catch {
    return fallback;
  }
}

/**
 * 既存動画は利用者が編集したタイトル・タグ・分類・クレジットを変更しない。
 * 週次巡回で確認できる公開oEmbedの不足値と、新しい掲載元URLだけを追記する。
 */
export function getDailyCollectionExistingUpdate(
  existing: DailyCollectionExistingVideo,
  metadata: DailyCollectionOembed,
  sourceUrl: string,
) {
  const update: { thumbnail?: string; channelTitle?: string; curationNote?: string } = {};
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
      sourceUrls: [...note.sourceUrls, sourceUrl],
    });
  }
  return update;
}

function parseStringArray(value: string | null | undefined) {
  if (!value) return [] as string[];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [] as string[];
    return parsed.flatMap((item) => {
      if (typeof item === "string" && item.trim()) return [item.trim()];
      if (item && typeof item === "object" && "name" in item && typeof item.name === "string" && item.name.trim()) return [item.name.trim()];
      return [] as string[];
    });
  } catch {
    return [] as string[];
  }
}

function normalizeArticleValues(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map(item => item.trim())))
    : [];
}

/** 掲載記事に明記された分類は、既存の空欄を埋める場合だけ使用する。 */
export function getDailyCollectionArticleMetadataUpdate(
  existing: Pick<DailyCollectionExistingVideo, "genres" | "products" | "purposes">,
  articleMetadata: DailyCollectionArticleMetadata,
) {
  const update: { genres?: string; products?: string; purposes?: string } = {};
  const genres = normalizeArticleValues(articleMetadata.genres);
  const products = normalizeArticleValues(articleMetadata.products);
  const purposes = normalizeArticleValues(articleMetadata.purposes);
  if (!parseStringArray(existing.genres).length && genres.length) update.genres = JSON.stringify(genres);
  if (!parseStringArray(existing.products).length && products.length) update.products = JSON.stringify(products);
  if (!parseStringArray(existing.purposes).length && purposes.length) update.purposes = JSON.stringify(purposes);
  return update;
}

export const weeklyCollectionSourceDefaults = [
  ["eizo100", "映像作家100人", "https://eizo100.jp/", 0],
  ["vook_iketeru", "Vook イケてる映像", "https://site.vook.vc/iketeru-eizou", 1],
  ["alincolony", "ALINCOLONY よかった映像", "https://alincolony.com/blog/2023-07-21-good-movies/", 1],
  ["favvid", "FAVVID", "https://to7mg.notion.site/FAVVID-773335a7959c4a26b6bd933ea4f40249", 1],
  ["all_d", "ALLd.", "https://alld.jp/", 0],
  ["video_refs", "Video Refs", "https://video-refs.com/", 0],
  ["bova", "BOVA", "https://awardg.sendenkaigi.com/bova", 0],
  ["light_the_way", "LIGHT THE WAY", "https://light-the-way.jp/works/", 1],
  ["takashi_ohashi", "高橋貴士", "https://takashiohashi.com/", 1],
  ["shirotaeisuke", "Eisuke Shirota", "https://shirotaeisuke.com/", 1],
  ["bb_navi", "BB-NAVI", "https://www.bb-navi.com/cm-douga/index-news.html", 1],
  ["douganow", "動画NOW!!", "https://douganow.jp/", 1],
  ["one_media", "ONE MEDIA", "https://www.onemedia.jp/", 0],
  ["odd_fellows", "Oddfellows", "https://oddfellows.tv/", 1],
  ["pics", "P.I.C.S.", "https://www.pics.tokyo/", 1],
  ["naname", "naname", "https://nanameinc.jp/", 1],
  ["edp", "EDP", "https://www.edp.jp/", 0],
  ["liki", "LIKI", "https://www.likiinc.com/", 1],
  ["takerushima", "竹留", "https://takerushima.com/", 1],
  ["sgasakura", "佐倉", "https://www.sgasakura.com/", 1],
  ["maxilla", "maxilla", "https://maxilla.jp/", 1],
  ["wachajack", "ワチャジャック", "https://wachajack.com/", 1],
  ["signif", "SIGNIF", "https://signif.jp/", 1],
  ["flapper3", "フラッパー3", "https://www.flapper3.co.jp/", 1],
  ["taiyo_kikaku", "太陽企画", "https://www.taiyokikaku.com/", 1],
  ["pyramidfilm", "ピラミッドフィルム", "https://www.pyramidfilm.co.jp/", 1],
  ["babel_pro", "BABEL LABEL", "https://babel-pro.com/", 1],
  ["aoi_pro", "AOI Pro.", "https://www.aoi-pro.com/jp/", 1],
  ["tyo", "TYO", "https://tyo.co.jp/", 1],
  ["geek_pictures", "GEEK PICTURES", "https://geekpictures.co.jp/jp/", 1],
  ["stink_studios", "Stink Studios", "https://www.stinkstudios.com/", 1],
  ["d_walker", "D-Walker", "https://www.d-walker.com/", 1],
] as const;

/**
 * 高頻度のCMキュレーションは毎週、作品ポートフォリオは4週で一巡する。
 * 2026-09-07 を第1週として月曜ごとに順送りする（Asia/Tokyo）。
 */
export const weeklyCollectionRotation = {
  everyWeek: ["bb_navi", "douganow"],
  week1: ["vook_iketeru", "alincolony", "favvid", "pics", "babel_pro", "aoi_pro"],
  week2: ["light_the_way", "odd_fellows", "naname", "liki", "tyo", "geek_pictures"],
  week3: ["takashi_ohashi", "shirotaeisuke", "takerushima", "sgasakura", "maxilla", "wachajack"],
  week4: ["signif", "flapper3", "taiyo_kikaku", "pyramidfilm", "stink_studios", "d_walker"],
} as const;

/** 保存候補が台帳の収集元IDを明示している場合だけ、その出典として扱う。 */
export const dailyCollectionSourceIdFromCandidate = (value: unknown) =>
  typeof value === "string" && /^[a-z0-9_]{1,64}$/.test(value) ? value : "";

const normalize = (value = "") => value.toLowerCase().replace(/[\s!"#$%&'()*+,\.\/:;<=>?@[\\\]^`{|}~_]+/g, "");
export const dailyCollectionTitlesResemble = (left = "", right = "") => {
  const a = normalize(left); const b = normalize(right);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  if (Math.min(a.length, b.length) < 8) return false;
  return a.includes(b.slice(0, 16)) || b.includes(a.slice(0, 16));
};

/** 掲載元記事で正規動画URLを明示確認済みの場合は、説明的な記事見出しと正式タイトルの差異を許容する。 */
export const dailyCollectionIdentityIsConfirmed = (sourceTitle: string, oembedTitle: string, articleVerified: unknown) =>
  dailyCollectionTitlesResemble(sourceTitle, oembedTitle) || articleVerified === true;
export const dailyCollectionVideoIdFromUrl = (platform: string, value: string) => platform === "youtube"
  ? value.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{11})/)?.[1] || ""
  : value.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1] || "";
const oembed = async (platform: string, videoUrl: string): Promise<DailyCollectionOembed | null> => {
  const endpoint = platform === "youtube"
    ? `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`
    : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(videoUrl)}`;
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(15_000) });
  return response.ok ? await response.json() : null;
};

export async function getDailyCollectionSources(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron) return res.status(403).json({ error: "cron-only" });
    const db = await getDb();
    if (!db) throw new Error("database unavailable");
    for (const [id, label, url, enabled] of weeklyCollectionSourceDefaults) {
      await db.insert(dailyCollectionSources).values({ id, label, url, enabled }).onDuplicateKeyUpdate({ set: { label, url, enabled } });
    }
    const sources = await db.select().from(dailyCollectionSources).where(eq(dailyCollectionSources.enabled, 1));
    res.json({ sources });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
}

export async function receiveDailyCollection(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
    const candidates = Array.isArray(req.body?.candidates) ? req.body.candidates.slice(0, 200) : [];
    const rawCheckedSourceIds: unknown[] = Array.isArray(req.body?.checkedSourceIds) ? req.body.checkedSourceIds as unknown[] : [];
    const checkedSourceIds = Array.from(new Set<string>(
      rawCheckedSourceIds.map(dailyCollectionSourceIdFromCandidate).filter(Boolean),
    ));
    const db = await getDb();
    if (!db) throw new Error("database unavailable");
    const enabledSources = await db.select({ id: dailyCollectionSources.id, label: dailyCollectionSources.label })
      .from(dailyCollectionSources)
      .where(eq(dailyCollectionSources.enabled, 1));
    const enabledSourceLabels = new Map(enabledSources.map(source => [source.id, source.label]));
    const [run] = await db.insert(dailyCollectionRuns).values({ taskUid: user.taskUid, status: "running", candidateCount: candidates.length }).$returningId();
    let inserted = 0; let updated = 0; let skipped = 0; const details: unknown[] = [];
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
      if (!platform || !id || !videoUrl || !sourceTitle || !sourceId || !sourceLabel || dailyCollectionVideoIdFromUrl(platform, videoUrl) !== id || !sourceUrl) { skipped++; details.push({ id, sourceId, reason: "invalid_identity_or_source" }); continue; }
      const metadata = await oembed(platform, videoUrl).catch(() => null);
      const metadataTitle = typeof metadata?.title === "string" ? metadata.title.trim() : "";
      const metadataThumbnail = typeof metadata?.thumbnail_url === "string" ? metadata.thumbnail_url.trim() : "";
      const metadataAuthor = typeof metadata?.author_name === "string" ? metadata.author_name.trim() : "";
      if (!metadataTitle || !dailyCollectionIdentityIsConfirmed(sourceTitle, metadataTitle, articleVerified)) { skipped++; details.push({ id, reason: "public_oembed_or_title_mismatch" }); continue; }
      const [existing] = await db.select().from(videos).where(eq(videos.id, id)).limit(1);
      if (existing) {
        const update = {
          ...getDailyCollectionExistingUpdate(existing, { thumbnail_url: metadataThumbnail, author_name: metadataAuthor }, sourceUrl),
          ...getDailyCollectionArticleMetadataUpdate(existing, articleMetadata),
        };
        const updatedFields = Object.keys(update);
        if (updatedFields.length) {
          await db.update(videos).set(update).where(eq(videos.id, id));
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
      await createVideo({ id, platform, title: metadataTitle, thumbnail: metadataThumbnail || null, videoUrl, embedUrl: platform === "youtube" ? `https://www.youtube.com/embed/${id}` : `https://player.vimeo.com/video/${id}`, source: sourceId, sourceLabel, channelTitle: metadataAuthor || null, genres: JSON.stringify(genres), products: JSON.stringify(products), purposes: JSON.stringify(purposes), allTags: JSON.stringify(["週次収集", "公式掲載", "掲載記事根拠", platform]), curationNote: JSON.stringify({ purpose: "映像表現のリファレンス収集", background: `週次エージェントが掲載記事から検出。記事掲載タイトル: ${sourceTitle}`, evaluation: articleVerified ? "掲載記事の正規動画URLと公開oEmbedを照合済み。" : "公開oEmbed・動画ID・タイトルを照合済み。", sourceUrls: [sourceUrl] }), addedDate: new Date().toISOString().slice(0, 10), embedStatus: "available" });
      inserted++; details.push({ id, reason: "inserted" });
    }
    if (checkedSourceIds.length) {
      await db.update(dailyCollectionSources)
        .set({ lastCheckedAt: new Date() })
        .where(and(eq(dailyCollectionSources.enabled, 1), inArray(dailyCollectionSources.id, checkedSourceIds)));
    }
    await db.update(dailyCollectionRuns).set({ status: "completed", completedAt: new Date(), insertedCount: inserted, updatedCount: updated, skippedCount: skipped, details: JSON.stringify(details) }).where(eq(dailyCollectionRuns.id, run.id));
    res.json({ ok: true, inserted, updated, skipped, checkedSourceIds, runId: run.id });
  } catch (error) {
    res.status(500).json({ error: String(error), timestamp: new Date().toISOString() });
  }
}
