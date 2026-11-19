/**
 * Custom hook for video data management, filtering, and search
 * Design: Cinematic Noir — performance-optimized for smooth interactions
 * Features: filtering, sorting, infinite scroll, favorites filter
 *
 * 検索構文:
 *   通常キーワード: タイトル・チャンネル・タグに含まれる動画を表示
 *   -キーワード: そのキーワードを含む動画を除外
 *   -source:notion: ソースが "notion" の動画を除外
 *   -source:youtube: ソースが "youtube" 系の動画を除外
 *   -source:vimeo: ソースが "vimeo" 系の動画を除外
 *   -source:vook: ソースが "vook" の動画を除外
 *   複数指定可: "CM -source:notion -アニメ"
 */
import { useState, useMemo, useCallback } from "react";
import type { Video, FilterState, SortType } from "@/lib/types";
import { trpc } from "@/lib/trpc";
import { getProductionRoles } from "@shared/productionCredits";
import { CREATOR_INDEX_OVERRIDES } from "@shared/creatorIndexOverrides";
import { getEffectiveScore100 } from "@shared/ratingScale";

const ITEMS_PER_PAGE = 30;
export const MISSING_FILTER_VALUE = "__missing__";
export const EIZO100_YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018] as const;
export const getCategoryMissingCountKey = (group: "genre" | "product" | "direction" | "tone") => `__missing_${group}__`;
export const VIDEO_LIST_QUERY_OPTIONS = {
  staleTime: 5 * 60 * 1000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchOnMount: false,
} as const;

export type MetadataFilterOptions = Record<
  "purpose" | "expression" | "toneEmotion" | "toneVisual" | "toneTechnique" | "production" | "privateRating" | "aiOverallRating" | "aiDirectionRating" | "aiTechniqueRating",
  Array<{ value: string; label?: string; count: number }>
>;
export type SourceFilterOption = { value: string; label: string; count: number };
export type ProductionFilterOptions = {
  roles: Array<{ value: string; count: number }>;
  entities: Array<{ value: string; count: number }>;
};

export const CREATOR_INDEX_SECTIONS = [
  "あ", "か", "さ", "た", "な", "は", "ま", "や", "ら", "わ",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
  "他",
] as const;

export type CreatorIndexSection = (typeof CREATOR_INDEX_SECTIONS)[number];

const JAPANESE_INDEX_BOUNDARIES: Array<[Exclude<CreatorIndexSection, "他">, string, string]> = [
  ["あ", "あ", "か"], ["か", "か", "さ"], ["さ", "さ", "た"], ["た", "た", "な"], ["な", "な", "は"],
  ["は", "は", "ま"], ["ま", "ま", "や"], ["や", "や", "ら"], ["ら", "ら", "わ"], ["わ", "わ", "ん"],
];
const JAPANESE_NAME_COLLATOR = new Intl.Collator("ja", { usage: "sort", sensitivity: "base" });

/**
 * 制作者名を五十音・ABCの見出しへ振り分ける。
 * 漢字名は日本語照合順序を使って推定するが、読みが取得できない場合は「他」へ残すため、誤った読みを確定保存しない。
 */
export function getCreatorIndexSection(rawName: string): CreatorIndexSection {
  const name = rawName.normalize("NFKC").trim();
  if (!name) return "他";
  const override = CREATOR_INDEX_OVERRIDES[name];
  if (override && CREATOR_INDEX_SECTIONS.includes(override as CreatorIndexSection)) return override as CreatorIndexSection;
  const latin = name.match(/^[A-Za-z]/)?.[0];
  if (latin) return latin.toUpperCase() as CreatorIndexSection;
  const kana = name[0]?.replace(/[ァ-ヶ]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60));
  if (kana && /[ぁ-ん]/.test(kana)) {
    return JAPANESE_INDEX_BOUNDARIES.find(([, start, end]) => kana >= start && kana < end)?.[0] ?? "わ";
  }
  const matched = JAPANESE_INDEX_BOUNDARIES.find(([, start, end]) =>
    JAPANESE_NAME_COLLATOR.compare(name, start) >= 0 && JAPANESE_NAME_COLLATOR.compare(name, end) < 0,
  );
  return matched?.[0] ?? "他";
}

const METADATA_FILTER_DEFINITIONS = [
  ["purpose", "purposes"],
  ["expression", "expressions"],
  ["toneEmotion", "toneEmotions"],
  ["toneVisual", "toneVisuals"],
  ["toneTechnique", "toneTechniques"],
  ["production", "productions"],
  ["privateRating", "privateRating"],
  ["aiOverallRating", "aiOverallRating"],
  ["aiDirectionRating", "aiDirectionRating"],
  ["aiTechniqueRating", "aiTechniqueRating"],
] as const;

function getNonEmptyStringValues(rawValue: unknown, isScalar: boolean): string[] {
  if (isScalar) {
    return typeof rawValue === "string" && rawValue.trim() ? [rawValue] : [];
  }
  return Array.isArray(rawValue)
    ? rawValue.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
}

/** DB由来の不正な値を表示用フィルターへ流さず、安全な文字列値だけを集計する。 */
export function buildMetadataFilterOptions(allVideos: Video[]): MetadataFilterOptions {
  const output = Object.fromEntries(
    METADATA_FILTER_DEFINITIONS.map(([filterKey, videoKey]) => {
      const counts = new Map<string, number>();
      const isScalarRating = ["privateRating", "aiOverallRating", "aiDirectionRating", "aiTechniqueRating"].includes(videoKey);

      allVideos.forEach((video) => {
        const values = getNonEmptyStringValues(video[videoKey], isScalarRating);
        values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
      });

      const missingCount = allVideos.filter((video) =>
        getNonEmptyStringValues(video[videoKey], isScalarRating).length === 0
      ).length;
      const items = Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "ja"));

      return [filterKey, [...items, { value: MISSING_FILTER_VALUE, label: "未入力", count: missingCount }]];
    })
  );
  return output as MetadataFilterOptions;
}

/**
 * 役割を先に選ぶと、その役割を担った人物・会社だけが候補になる。
 * 役割自体は動画一覧を絞り込む条件にはしない。候補から人物・会社を選んだ時にだけ一覧を絞り込む。
 */
export function buildProductionFilterOptions(allVideos: Video[], roleFilter: string | null): ProductionFilterOptions {
  const roleCounts = new Map<string, number>();
  const entityCounts = new Map<string, number>();

  allVideos.forEach((video) => {
    const credits = video.productionCredits ?? [];
    getProductionRoles(credits).forEach((role) => roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1));
    credits
      .filter((credit) => !roleFilter || credit.roles.includes(roleFilter as never))
      .forEach((credit) => entityCounts.set(credit.name, (entityCounts.get(credit.name) ?? 0) + 1));
  });

  const toOptions = (counts: Map<string, number>) => Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "ja"));
  return { roles: toOptions(roleCounts), entities: toOptions(entityCounts) };
}

export function matchesCategoryFilter<T extends { slug: string }>(items: T[], value: string | null): boolean {
  if (!value) return true;
  if (value === MISSING_FILTER_VALUE) return items.length === 0;
  return items.some((item) => item.slug === value);
}

export function matchesMetadataFilter(values: string[], value: string | null): boolean {
  if (!value) return true;
  if (value === MISSING_FILTER_VALUE) return values.length === 0;
  return values.includes(value);
}

export function matchesRatingFilter(value: string, filter: string | null): boolean {
  if (!filter) return true;
  if (filter === MISSING_FILTER_VALUE) return !value;
  return value === filter;
}

export function matchesSourceFilter(video: Video, filter: string | null | undefined): boolean {
  return !filter || video.source === filter;
}

/**
 * 既定で非表示にするのは、削除・非公開が確認済みの動画だけ。
 * 埋め込み制限、地域・アクセス制限、確認不能は、外部ページでは視聴できる可能性があるため既定表示を維持する。
 */
export function isUnavailableVideo(video: Video): boolean {
  return ["unavailable_deleted", "unavailable_private"].includes(video.embedReason ?? "");
}

/** B以下の入力済みAI総合評価を既定では一覧から除外する。未評価は表示対象に残す。 */
export function isLowAiOverallVideo(video: Video): boolean {
  const rating = video.aiOverallRating.trim().toUpperCase();
  return Boolean(rating) && !["B+", "A-", "A", "A+", "S-", "S", "S+"].includes(rating);
}

export function isEizo100Selection(video: Video): boolean {
  return Boolean(
    video.awards?.some((award) => award.name === "映像作家100人") ||
    video.sourceLabel?.includes("映像作家100人") ||
    (video.source as string | undefined)?.startsWith("eizo100"),
  );
}

export function isEizo100YearSelection(video: Video, year: number): boolean {
  return Boolean(
    video.awards?.some((award) => award.name === "映像作家100人" && Number(award.year) === year) ||
    video.sourceLabel?.includes(`映像作家100人 ${year}`) ||
    (video.source as string | undefined)?.includes(`eizo100_${year}`),
  );
}
// ============================================================
// 検索クエリパーサー
// ============================================================

interface ParsedQuery {
  /** 通常のインクルードキーワード（AND） */
  includes: string[];
  /** マイナスキーワード（タイトル・チャンネル・タグから除外） */
  excludeKeywords: string[];
  /** ソース除外リスト（"notion", "youtube", "vimeo", "vook" 等） */
  excludeSources: string[];
}

/** ソース文字列がマイナス指定に一致するか判定 */
function matchesSourceExclusion(source: string | undefined, excludeSources: string[]): boolean {
  if (!source || excludeSources.length === 0) return false;
  const s = source.toLowerCase();
  return excludeSources.some((ex) => {
    // "notion" → source に "notion" が含まれる
    // "youtube" → source に "youtube" が含まれる
    // "vimeo" → source に "vimeo" が含まれる
    // "vook" → source === "vook"
    return s.includes(ex);
  });
}

export function parseSearchQuery(raw: string): ParsedQuery {
  const includes: string[] = [];
  const excludeKeywords: string[] = [];
  const excludeSources: string[] = [];

  // トークン分割: スペース区切り（ただし "" で囲まれた部分は一塊）
  const tokens = raw.match(/-?"[^"]*"|\S+/g) ?? [];

  for (const token of tokens) {
    if (token.startsWith('-')) {
      const body = token.slice(1).replace(/^"|"$/g, '');
      if (body.toLowerCase().startsWith('source:')) {
        // -source:notion → ソース除外
        const src = body.slice('source:'.length).toLowerCase();
        if (src) excludeSources.push(src);
      } else if (body) {
        excludeKeywords.push(body.toLowerCase());
      }
    } else {
      const kw = token.replace(/^"|"$/g, '');
      if (kw) includes.push(kw.toLowerCase());
    }
  }

  return { includes, excludeKeywords, excludeSources };
}

export function getVideoSearchText(video: Video): string {
  return [
    video.title,
    video.channelTitle || "",
    ...video.allTags,
    ...video.purposes,
    ...video.expressions,
    ...video.toneEmotions,
    ...video.toneVisuals,
    ...video.toneTechniques,
    ...video.productions,
    ...getProductionRoles(video.productionCredits ?? []),
    video.privateRating,
    video.aiOverallRating,
    video.aiDirectionRating,
    video.aiTechniqueRating,
    video.curationNote?.purpose || "",
    video.curationNote?.background || "",
    video.curationNote?.evaluation || "",
    video.curationNote?.clientPitch || "",
  ]
    .join(" ")
    .toLowerCase();
}

export function applyVideoFilters(allVideos: Video[], filters: FilterState, favorites: string[] = []): Video[] {
  let result = [...allVideos];

  // 通常一覧では削除・非公開を除外し、切替時は対象だけをまとめて確認できるようにする。
  result = filters.showUnavailable
    ? result.filter(isUnavailableVideo)
    : result.filter((video) => !isUnavailableVideo(video));

  if (!filters.showLowAiOverall) {
    result = result.filter((video) => !isLowAiOverallVideo(video));
  }

  if (filters.favoritesOnly) {
    result = result.filter((video) => favorites.includes(video.id));
  }
  if (filters.eizo100Only) {
    result = result.filter(isEizo100Selection);
  }
  if (filters.eizo100Year !== null) {
    result = result.filter((video) => isEizo100YearSelection(video, filters.eizo100Year!));
  }
  if (filters.source) {
    result = result.filter((video) => matchesSourceFilter(video, filters.source));
  }

  if (filters.search.trim()) {
    const parsed = parseSearchQuery(filters.search);
    if (parsed.excludeSources.length > 0) {
      result = result.filter((video) => !matchesSourceExclusion(video.source, parsed.excludeSources));
    }
    if (parsed.excludeKeywords.length > 0) {
      result = result.filter((video) => {
        const haystack = getVideoSearchText(video);
        return !parsed.excludeKeywords.some((keyword) => haystack.includes(keyword));
      });
    }
    if (parsed.includes.length > 0) {
      result = result.filter((video) => {
        const haystack = getVideoSearchText(video);
        return parsed.includes.every((keyword) => haystack.includes(keyword));
      });
    }
  }

  result = result
    .filter((video) => matchesCategoryFilter(video.genres, filters.genre))
    .filter((video) => matchesCategoryFilter(video.products, filters.product))
    .filter((video) => matchesCategoryFilter(video.directions, filters.direction))
    .filter((video) => matchesCategoryFilter(video.tones, filters.tone));

  const metadataFilters = [
    [filters.purpose, "purposes"],
    [filters.expression, "expressions"],
    [filters.toneEmotion, "toneEmotions"],
    [filters.toneVisual, "toneVisuals"],
    [filters.toneTechnique, "toneTechniques"],
    [filters.production, "productions"],
  ] as const;
  metadataFilters.forEach(([value, videoKey]) => {
    if (value) result = result.filter((video) => matchesMetadataFilter(video[videoKey], value));
  });

  return result
    .filter((video) => matchesRatingFilter(video.privateRating, filters.privateRating))
    .filter((video) => matchesRatingFilter(video.aiOverallRating, filters.aiOverallRating))
    .filter((video) => matchesRatingFilter(video.aiDirectionRating, filters.aiDirectionRating))
    .filter((video) => matchesRatingFilter(video.aiTechniqueRating, filters.aiTechniqueRating));
}

export function useVideos(favorites: string[] = []) {
  const [filters, setFilters] = useState<FilterState>({
    search: "",
    genre: null,
    product: null,
    direction: null,
    tone: null,
    purpose: null,
    expression: null,
    toneEmotion: null,
    toneVisual: null,
    toneTechnique: null,
    production: null,
    productionRole: null,
    privateRating: null,
    aiOverallRating: null,
    aiDirectionRating: null,
    aiTechniqueRating: null,
    source: null,
    eizo100Only: false,
    eizo100Year: null,
    showUnavailable: false,
    showLowAiOverall: false,
    sort: "newest" as SortType,
    favoritesOnly: false,
  });
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);

  // Fetch videos from DB via tRPC
  const { data: dbVideos, isLoading: isVideosLoading } = trpc.videos.list.useQuery(undefined, VIDEO_LIST_QUERY_OPTIONS);

  const allVideos = useMemo(() => (dbVideos as Video[] | undefined) ?? [], [dbVideos]);
  const unavailableCount = useMemo(() => allVideos.filter(isUnavailableVideo).length, [allVideos]);
  const lowAiOverallCount = useMemo(() => allVideos.filter(isLowAiOverallVideo).length, [allVideos]);

  // Compute counts for each category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allVideos.forEach((v) => {
      v.genres.forEach((g) => {
        counts[g.slug] = (counts[g.slug] || 0) + 1;
      });
      v.products.forEach((p) => {
        counts[p.slug] = (counts[p.slug] || 0) + 1;
      });
      v.directions.forEach((d) => {
        counts[d.slug] = (counts[d.slug] || 0) + 1;
      });
      v.tones.forEach((t) => {
        counts[t.slug] = (counts[t.slug] || 0) + 1;
      });
      if (v.genres.length === 0) counts[getCategoryMissingCountKey("genre")] = (counts[getCategoryMissingCountKey("genre")] || 0) + 1;
      if (v.products.length === 0) counts[getCategoryMissingCountKey("product")] = (counts[getCategoryMissingCountKey("product")] || 0) + 1;
      if (v.directions.length === 0) counts[getCategoryMissingCountKey("direction")] = (counts[getCategoryMissingCountKey("direction")] || 0) + 1;
      if (v.tones.length === 0) counts[getCategoryMissingCountKey("tone")] = (counts[getCategoryMissingCountKey("tone")] || 0) + 1;
    });
    return counts;
  }, [allVideos]);

  const metadataFilterOptions = useMemo(() => buildMetadataFilterOptions(allVideos), [allVideos]);
  const productionFilterOptions = useMemo(
    () => buildProductionFilterOptions(allVideos, filters.productionRole ?? null),
    [allVideos, filters.productionRole],
  );
  const eizo100Count = useMemo(() => allVideos.filter(isEizo100Selection).length, [allVideos]);
  const sourceFilterOptions = useMemo<SourceFilterOption[]>(() => {
    const counts = new Map<string, { count: number; label: string }>();
    allVideos.forEach((video) => {
      const source = video.source || "manual";
      const current = counts.get(source);
      counts.set(source, { count: (current?.count ?? 0) + 1, label: video.sourceLabel || source });
    });
    return Array.from(counts.entries())
      .map(([value, data]) => ({ value, ...data }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ja"));
  }, [allVideos]);
  const eizo100YearCounts = useMemo(() => Object.fromEntries(EIZO100_YEARS.map((year) => [year, allVideos.filter((video) => isEizo100YearSelection(video, year)).length])) as Record<number, number>, [allVideos]);

  // Filter and sort videos
  const filteredVideos = useMemo(() => {
    const result = applyVideoFilters(allVideos, filters, favorites);

    // Sort
    if (filters.sort === "newest") {
      result.sort(
        (a, b) =>
          new Date(b.addedDate).getTime() - new Date(a.addedDate).getTime()
      );
    } else if (filters.sort === "oldest") {
      result.sort(
        (a, b) =>
          new Date(a.addedDate).getTime() - new Date(b.addedDate).getTime()
      );
    } else if (filters.sort === "aiOverallScoreDesc") {
      result.sort((a, b) => {
        const diff =
          getEffectiveScore100(b.aiOverallScore, b.aiOverallRating) -
          getEffectiveScore100(a.aiOverallScore, a.aiOverallRating);
        return diff !== 0 ? diff : new Date(b.addedDate).getTime() - new Date(a.addedDate).getTime();
      });
    } else if (filters.sort === "aiDirectionScoreDesc") {
      result.sort((a, b) => {
        const diff =
          getEffectiveScore100(b.aiDirectionScore, b.aiDirectionRating) -
          getEffectiveScore100(a.aiDirectionScore, a.aiDirectionRating);
        return diff !== 0 ? diff : new Date(b.addedDate).getTime() - new Date(a.addedDate).getTime();
      });
    } else if (filters.sort === "aiTechniqueScoreDesc") {
      result.sort((a, b) => {
        const diff =
          getEffectiveScore100(b.aiTechniqueScore, b.aiTechniqueRating) -
          getEffectiveScore100(a.aiTechniqueScore, a.aiTechniqueRating);
        return diff !== 0 ? diff : new Date(b.addedDate).getTime() - new Date(a.addedDate).getTime();
      });
    }

    return result;
  }, [allVideos, filters, favorites]);

  const visibleVideos = useMemo(
    () => filteredVideos.slice(0, visibleCount),
    [filteredVideos, visibleCount]
  );

  const hasMore = visibleCount < filteredVideos.length;

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => prev + ITEMS_PER_PAGE);
  }, []);

  const setSearch = useCallback((search: string) => {
    setFilters((prev) => ({ ...prev, search }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);

  const setGenre = useCallback((genre: string | null) => {
    setFilters((prev) => ({ ...prev, genre }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);

  const setProduct = useCallback((product: string | null) => {
    setFilters((prev) => ({ ...prev, product }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);

  const setDirection = useCallback((direction: string | null) => {
    setFilters((prev) => ({ ...prev, direction }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);

  const setTone = useCallback((tone: string | null) => {
    setFilters((prev) => ({ ...prev, tone }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);

  const setPurpose = useCallback((purpose: string | null) => {
    setFilters((prev) => ({ ...prev, purpose }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);
  const setExpression = useCallback((expression: string | null) => {
    setFilters((prev) => ({ ...prev, expression }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);
  const setToneEmotion = useCallback((toneEmotion: string | null) => {
    setFilters((prev) => ({ ...prev, toneEmotion }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);
  const setToneVisual = useCallback((toneVisual: string | null) => {
    setFilters((prev) => ({ ...prev, toneVisual }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);
  const setToneTechnique = useCallback((toneTechnique: string | null) => {
    setFilters((prev) => ({ ...prev, toneTechnique }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);
  const setProduction = useCallback((production: string | null) => {
    setFilters((prev) => ({ ...prev, production }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);
  const setProductionRole = useCallback((productionRole: string | null) => {
    setFilters((prev) => ({ ...prev, productionRole, production: productionRole === prev.productionRole ? prev.production : null }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);
  const setPrivateRating = useCallback((privateRating: string | null) => {
    setFilters((prev) => ({ ...prev, privateRating }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);
  const setAiOverallRating = useCallback((aiOverallRating: string | null) => {
    setFilters((prev) => ({ ...prev, aiOverallRating }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);
  const setAiDirectionRating = useCallback((aiDirectionRating: string | null) => {
    setFilters((prev) => ({ ...prev, aiDirectionRating }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);
  const setAiTechniqueRating = useCallback((aiTechniqueRating: string | null) => {
    setFilters((prev) => ({ ...prev, aiTechniqueRating }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);
  const setSource = useCallback((source: string | null) => {
    setFilters((prev) => ({ ...prev, source }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);
  const setEizo100Only = useCallback((eizo100Only: boolean) => {
    setFilters((prev) => ({ ...prev, eizo100Only, eizo100Year: eizo100Only ? prev.eizo100Year : null }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);
  const setEizo100Year = useCallback((eizo100Year: number | null) => {
    setFilters((prev) => ({ ...prev, eizo100Only: eizo100Year !== null ? true : prev.eizo100Only, eizo100Year }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);
  const setShowUnavailable = useCallback((showUnavailable: boolean) => {
    setFilters((prev) => ({ ...prev, showUnavailable }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);

  const setShowLowAiOverall = useCallback((showLowAiOverall: boolean) => {
    setFilters((prev) => ({ ...prev, showLowAiOverall }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);

  const setSort = useCallback((sort: SortType) => {
    setFilters((prev) => ({ ...prev, sort }));
  }, []);

  const setFavoritesOnly = useCallback((favoritesOnly: boolean) => {
    setFilters((prev) => ({ ...prev, favoritesOnly }));
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters({
      search: "",
      genre: null,
      product: null,
      direction: null,
      tone: null,
      purpose: null,
      expression: null,
      toneEmotion: null,
      toneVisual: null,
      toneTechnique: null,
      production: null,
      productionRole: null,
      privateRating: null,
      aiOverallRating: null,
      aiDirectionRating: null,
      aiTechniqueRating: null,
      source: null,
      eizo100Only: false,
      eizo100Year: null,
      showUnavailable: false,
      showLowAiOverall: false,
      sort: "newest",
      favoritesOnly: false,
    });
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.genre) count++;
    if (filters.product) count++;
    if (filters.direction) count++;
    if (filters.tone) count++;
    if (filters.purpose) count++;
    if (filters.expression) count++;
    if (filters.toneEmotion) count++;
    if (filters.toneVisual) count++;
    if (filters.toneTechnique) count++;
    if (filters.production) count++;
    if (filters.privateRating) count++;
    if (filters.aiOverallRating) count++;
    if (filters.aiDirectionRating) count++;
    if (filters.aiTechniqueRating) count++;
    if (filters.source) count++;
    if (filters.eizo100Only) count++;
    if (filters.showUnavailable) count++;
    if (filters.showLowAiOverall) count++;
    if (filters.search.trim()) count++;
    if (filters.favoritesOnly) count++;
    return count;
  }, [filters]);

  return {
    videos: visibleVideos,
    allVideos,
    totalCount: allVideos.length,
    filteredCount: filteredVideos.length,
    filters,
    categoryCounts,
    hasMore,
    loadMore,
    setSearch,
    setGenre,
    setProduct,
    setDirection,
    setTone,
    setPurpose,
    setExpression,
    setToneEmotion,
    setToneVisual,
    setToneTechnique,
    setProduction,
    setProductionRole,
    setPrivateRating,
    setAiOverallRating,
    setAiDirectionRating,
    setAiTechniqueRating,
    setSource,
    setEizo100Only,
    setEizo100Year,
    setShowUnavailable,
    setShowLowAiOverall,
    setSort,
    setFavoritesOnly,
    clearAllFilters,
    activeFilterCount,
    metadataFilterOptions,
    productionFilterOptions,
    eizo100Count,
    eizo100YearCounts,
    sourceFilterOptions,
    unavailableCount,
    lowAiOverallCount,
    isLoading: isVideosLoading,
  };
}
