import type { Video } from "@/lib/types";
import { getProductionRoles } from "@shared/productionCredits";

export type InspirationThemeSelectorKey = "genre" | "product" | "purpose" | "expression" | "direction" | "tone" | "productionRole";
export type InspirationThemeSelection = { key: InspirationThemeSelectorKey; value: string };

export function normalizeInspirationText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/\s+/g, " ")
    .trim();
}

export function getInspirationThemeTokens(theme: string): string[] {
  return Array.from(new Set(
    normalizeInspirationText(theme)
      .split(/[\s,、，/／・]+/)
      .filter((token) => token.length > 0),
  ));
}

/** テーマ照合対象を、編集可能なすべての主要メタデータから構成する。 */
export function getInspirationSearchText(video: Video): string {
  return normalizeInspirationText([
    video.title,
    video.channelTitle,
    ...video.genres.flatMap((item) => [item.name, item.slug]),
    ...video.products.flatMap((item) => [item.name, item.slug]),
    ...video.directions.flatMap((item) => [item.name, item.slug]),
    ...video.tones.flatMap((item) => [item.name, item.slug]),
    ...video.allTags,
    ...video.purposes,
    ...video.expressions,
    ...video.toneEmotions,
    ...video.toneVisuals,
    ...video.toneTechniques,
    ...video.productions,
    ...(video.productionCredits ?? []).map((credit) => credit.name),
    ...getProductionRoles(video.productionCredits ?? []),
    video.curationNote?.purpose ?? "",
    video.curationNote?.background ?? "",
    video.curationNote?.evaluation ?? "",
    video.curationNote?.clientPitch ?? "",
  ].join(" "));
}

/** 複数語はAND条件として照合し、テーマに沿う候補だけを返す。 */
export function getThemeCandidates(videos: Video[], theme: string): Video[] {
  const tokens = getInspirationThemeTokens(theme);
  if (tokens.length === 0) return [];
  return videos.filter((video) => {
    const haystack = getInspirationSearchText(video);
    return tokens.every((token) => haystack.includes(token));
  });
}

/** カテゴリ別プルダウンの選択値をAND条件として照合する。 */
export function getThemeCandidatesForSelections(videos: Video[], selectedValues: string[]): Video[] {
  return getThemeCandidates(videos, selectedValues.filter(Boolean).join(" "));
}

function includesExactThemeValue(values: Array<string | null | undefined>, selectedValue: string): boolean {
  const normalizedSelection = normalizeInspirationText(selectedValue);
  return values.some((value) => typeof value === "string" && normalizeInspirationText(value) === normalizedSelection);
}

/**
 * プルダウンの値は、各カテゴリの対応フィールドだけで照合する。
 * 同じ文字列が別カテゴリのメモやタイトルへ含まれていても一致扱いにせず、選択した複数カテゴリはAND条件とする。
 */
export function getThemeCandidatesForCategorySelections(videos: Video[], selections: InspirationThemeSelection[]): Video[] {
  const activeSelections = selections.filter((selection) => selection.value.trim().length > 0);
  if (activeSelections.length === 0) return [];

  return videos.filter((video) => activeSelections.every(({ key, value }) => {
    switch (key) {
      case "genre":
        return includesExactThemeValue(video.genres.flatMap((item) => [item.name, item.slug]), value);
      case "product":
        return includesExactThemeValue(video.products.flatMap((item) => [item.name, item.slug]), value);
      case "purpose":
        return includesExactThemeValue(video.purposes, value);
      case "expression":
        return includesExactThemeValue(video.expressions, value);
      case "direction":
        return includesExactThemeValue(video.directions.flatMap((item) => [item.name, item.slug]), value);
      case "tone":
        return includesExactThemeValue(video.tones.flatMap((item) => [item.name, item.slug]), value);
      case "productionRole":
        return includesExactThemeValue(getProductionRoles(video.productionCredits ?? []), value);
    }
  }));
}

/** 削除・非公開が確認済みの動画を除いた、インスピレーション用の全公開母集団を返す。 */
export function getInspirationSourceVideos(videos: Video[]): Video[] {
  return videos.filter((video) => !["unavailable_deleted", "unavailable_private"].includes(video.embedReason ?? ""));
}

/** 候補が複数ある場合は直前・直近の動画を避け、残らない場合だけ候補全体へ戻して選ぶ。 */
export function pickRandomInspirationVideo<T extends { id: string }>(
  videos: T[],
  currentId?: string | null,
  random: () => number = Math.random,
  recentIds: string[] = [],
): T | undefined {
  if (videos.length === 0) return undefined;
  const nonCurrentChoices = videos.length > 1 && currentId
    ? videos.filter((video) => video.id !== currentId)
    : videos;
  const freshChoices = nonCurrentChoices.filter((video) => !recentIds.includes(video.id));
  const choices = freshChoices.length > 0 ? freshChoices : nonCurrentChoices;
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
}
