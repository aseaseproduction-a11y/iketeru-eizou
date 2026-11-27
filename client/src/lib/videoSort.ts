import type { Video } from "@/lib/types";
import { getEffectiveScore100 } from "@shared/ratingScale";

export type SortKey = "added" | "published" | "score";
export type ActiveSortKey = "added" | "score";
export type SecondarySortKey = "none" | ActiveSortKey;
export type SortDirection = "desc" | "asc";

export interface SortConfig {
  primaryKey: ActiveSortKey;
  primaryDir: SortDirection;
  secondaryKey: SecondarySortKey;
  secondaryDir: SortDirection;
}

export const DEFAULT_SORT_CONFIG: SortConfig = {
  primaryKey: "added",
  primaryDir: "desc",
  secondaryKey: "score",
  secondaryDir: "desc",
};

export const SORT_STORAGE_KEY = "iketeru_video_sort_v1";

export type ScoreScale = "calibrated" | "legacy" | "unrated";
export type ScoreBandId = "83_plus" | "78_82" | "65_77" | "under_65" | "unrated";

export interface VideoScoreInfo {
  scale: ScoreScale;
  score: number | null;
}

export interface VideoBandInfo {
  key: string;
  scale: ScoreScale;
  bandId: ScoreBandId;
  scaleLabel: string;
  bandLabel: string;
}

export interface VideoBandGroup {
  key: string;
  scale: ScoreScale;
  bandId: ScoreBandId;
  scaleLabel: string;
  bandLabel: string;
  totalCount: number;
  videos: Video[];
}

export const SORT_KEY_LABELS: Record<SortKey, string> = {
  added: "追加順",
  published: "投稿日時順（準備中）",
  score: "評価順",
};

export function getSortDirectionLabels(key: ActiveSortKey): { desc: string; asc: string } {
  if (key === "score") {
    return { desc: "高い順", asc: "低い順" };
  }
  return { desc: "新しい順", asc: "古い順" };
}

function isActiveSortKey(value: unknown): value is ActiveSortKey {
  return value === "added" || value === "score";
}

function isSortDirection(value: unknown): value is SortDirection {
  return value === "desc" || value === "asc";
}

export function normalizeSortConfig(raw: Partial<SortConfig> | null | undefined): SortConfig {
  const primaryKey: ActiveSortKey = isActiveSortKey(raw?.primaryKey)
    ? raw!.primaryKey
    : DEFAULT_SORT_CONFIG.primaryKey;
  const primaryDir: SortDirection = isSortDirection(raw?.primaryDir)
    ? raw!.primaryDir
    : DEFAULT_SORT_CONFIG.primaryDir;

  let secondaryKey: SecondarySortKey =
    raw?.secondaryKey === "none" || isActiveSortKey(raw?.secondaryKey)
      ? raw.secondaryKey
      : primaryKey === DEFAULT_SORT_CONFIG.primaryKey
        ? DEFAULT_SORT_CONFIG.secondaryKey
        : "none";
  if (secondaryKey === primaryKey) {
    secondaryKey = "none";
  }
  const secondaryDir: SortDirection = isSortDirection(raw?.secondaryDir)
    ? raw!.secondaryDir
    : "desc";

  return { primaryKey, primaryDir, secondaryKey, secondaryDir };
}

export function loadSavedSortConfig(): SortConfig {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return { ...DEFAULT_SORT_CONFIG };
    }
    const stored = window.localStorage.getItem(SORT_STORAGE_KEY);
    if (!stored) return { ...DEFAULT_SORT_CONFIG };
    const parsed = JSON.parse(stored) as Partial<SortConfig>;
    return normalizeSortConfig(parsed);
  } catch {
    return { ...DEFAULT_SORT_CONFIG };
  }
}

export function saveSortConfig(config: SortConfig): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(normalizeSortConfig(config)));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

/**
 * 評価順の物差し分離:
 * - calibratedScore がある動画は "calibrated"（校正済み）
 * - ない動画のうち旧スコア／旧ランクがある動画は "legacy"（旧評価）
 * - どちらもない動画は "unrated"（未評価）
 */
export function getVideoScoreInfo(video: Video): VideoScoreInfo {
  if (typeof video.calibratedScore === "number" && Number.isFinite(video.calibratedScore)) {
    return { scale: "calibrated", score: video.calibratedScore };
  }
  const legacy = getEffectiveScore100(video.aiOverallScore, video.aiOverallRating);
  if (legacy >= 0) {
    return { scale: "legacy", score: legacy };
  }
  return { scale: "unrated", score: null };
}

export function getScoreBandId(score: number | null): ScoreBandId {
  if (score === null || !Number.isFinite(score)) return "unrated";
  if (score >= 83) return "83_plus";
  if (score >= 78) return "78_82";
  if (score >= 65) return "65_77";
  return "under_65";
}

export const SCORE_BAND_LABELS: Record<ScoreBandId, string> = {
  "83_plus": "83 以上",
  "78_82": "78〜82.9",
  "65_77": "65〜77.9",
  under_65: "65 未満",
  unrated: "未評価",
};

export function getVideoBandInfo(video: Video): VideoBandInfo {
  const { scale, score } = getVideoScoreInfo(video);
  const bandId = getScoreBandId(score);
  if (scale === "unrated" || bandId === "unrated") {
    return {
      key: "unrated:unrated",
      scale: "unrated",
      bandId: "unrated",
      scaleLabel: "",
      bandLabel: SCORE_BAND_LABELS.unrated,
    };
  }
  return {
    key: `${scale}:${bandId}`,
    scale,
    bandId,
    scaleLabel: scale === "calibrated" ? "校正済み" : "未校正（旧評価）",
    bandLabel: SCORE_BAND_LABELS[bandId],
  };
}

const SCALE_RANK: Record<ScoreScale, number> = {
  calibrated: 0,
  legacy: 1,
  unrated: 2,
};

const BAND_RANK_DESC: Record<ScoreBandId, number> = {
  "83_plus": 0,
  "78_82": 1,
  "65_77": 2,
  under_65: 3,
  unrated: 4,
};

const BAND_RANK_ASC: Record<ScoreBandId, number> = {
  under_65: 0,
  "65_77": 1,
  "78_82": 2,
  "83_plus": 3,
  unrated: 4,
};

function parseAddedDateMs(addedDate: string | null | undefined): number | null {
  const raw = (addedDate ?? "").trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function parseCreatedAtMs(createdAt: string | null | undefined): number | null {
  const raw = (createdAt ?? "").trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

export function compareByAddedDateOnly(a: Video, b: Video, dir: SortDirection): number {
  const msA = parseAddedDateMs(a.addedDate);
  const msB = parseAddedDateMs(b.addedDate);
  if (msA === null && msB === null) return 0;
  if (msA === null) return 1;
  if (msB === null) return -1;
  if (msA === msB) return 0;
  return dir === "desc" ? msB - msA : msA - msB;
}

export function compareByCreatedAtOnly(a: Video, b: Video, dir: SortDirection): number {
  const msA = parseCreatedAtMs(a.createdAt);
  const msB = parseCreatedAtMs(b.createdAt);
  if (msA === null && msB === null) return 0;
  if (msA === null) return 1;
  if (msB === null) return -1;
  if (msA === msB) return 0;
  return dir === "desc" ? msB - msA : msA - msB;
}

export function compareByAdded(a: Video, b: Video, dir: SortDirection): number {
  const byDate = compareByAddedDateOnly(a, b, dir);
  if (byDate !== 0) return byDate;
  return compareByCreatedAtOnly(a, b, dir);
}

/**
 * 評価順の比較:
 * 常に 校正済み → 未校正（旧評価） → 未評価 の順で物差しを分離し、
 * 同じ物差しの中でのみ点数（desc: 高い順 / asc: 低い順）で並べる。
 */
export function compareByScore(a: Video, b: Video, dir: SortDirection): number {
  const infoA = getVideoScoreInfo(a);
  const infoB = getVideoScoreInfo(b);
  const scaleDiff = SCALE_RANK[infoA.scale] - SCALE_RANK[infoB.scale];
  if (scaleDiff !== 0) return scaleDiff;
  if (infoA.score === null && infoB.score === null) return 0;
  if (infoA.score === null) return 1;
  if (infoB.score === null) return -1;
  if (infoA.score === infoB.score) return 0;
  return dir === "desc" ? infoB.score - infoA.score : infoA.score - infoB.score;
}

function compareBandOrder(a: Video, b: Video, dir: SortDirection): number {
  const bandA = getVideoBandInfo(a);
  const bandB = getVideoBandInfo(b);
  const scaleDiff = SCALE_RANK[bandA.scale] - SCALE_RANK[bandB.scale];
  if (scaleDiff !== 0) return scaleDiff;
  const ranks = dir === "desc" ? BAND_RANK_DESC : BAND_RANK_ASC;
  return ranks[bandA.bandId] - ranks[bandB.bandId];
}

export function sortVideos(videos: Video[], rawConfig: SortConfig): Video[] {
  const config = normalizeSortConfig(rawConfig);
  const sorted = [...videos];

  sorted.sort((a, b) => {
    if (config.primaryKey === "score") {
      // 評価順が 1 番目のときは、帯（校正済み → 未校正旧評価 → 未評価）でまとめる
      const byBand = compareBandOrder(a, b, config.primaryDir);
      if (byBand !== 0) return byBand;

      // 帯の中は並べ替え 2 の順（なしなら点数の順）
      if (config.secondaryKey === "added") {
        const byAdded = compareByAdded(a, b, config.secondaryDir);
        if (byAdded !== 0) return byAdded;
        const byScore = compareByScore(a, b, config.primaryDir);
        if (byScore !== 0) return byScore;
      } else {
        const byScore = compareByScore(a, b, config.primaryDir);
        if (byScore !== 0) return byScore;
        const byAdded = compareByAdded(a, b, "desc");
        if (byAdded !== 0) return byAdded;
      }
      return a.id.localeCompare(b.id);
    }

    // 追加順が 1 番目のとき: addedDate → (次に評価順があれば同日内を評価順) → createdAt → id
    const byDate = compareByAddedDateOnly(a, b, config.primaryDir);
    if (byDate !== 0) return byDate;

    if (config.secondaryKey === "score") {
      const byScore = compareByScore(a, b, config.secondaryDir);
      if (byScore !== 0) return byScore;
    }

    const byCreated = compareByCreatedAtOnly(a, b, config.primaryDir);
    if (byCreated !== 0) return byCreated;

    return a.id.localeCompare(b.id);
  });

  return sorted;
}

/**
 * 評価順が 1 番目のときのみ、表示中の動画を帯ごとのグループ配列へまとめる。
 * 各帯の totalCount は全絞り込み結果（allFilteredVideos）基準の総本数を返す。
 */
export function groupVideosByScoreBand(
  visibleVideos: Video[],
  allFilteredVideos: Video[],
  rawConfig: SortConfig,
): VideoBandGroup[] | null {
  const config = normalizeSortConfig(rawConfig);
  if (config.primaryKey !== "score") return null;

  const totals = new Map<string, number>();
  for (const v of allFilteredVideos) {
    const band = getVideoBandInfo(v);
    totals.set(band.key, (totals.get(band.key) ?? 0) + 1);
  }

  const groups: VideoBandGroup[] = [];
  const byKey = new Map<string, VideoBandGroup>();
  for (const v of visibleVideos) {
    const band = getVideoBandInfo(v);
    let group = byKey.get(band.key);
    if (!group) {
      group = {
        key: band.key,
        scale: band.scale,
        bandId: band.bandId,
        scaleLabel: band.scaleLabel,
        bandLabel: band.bandLabel,
        totalCount: totals.get(band.key) ?? 0,
        videos: [],
      };
      byKey.set(band.key, group);
      groups.push(group);
    }
    group.videos.push(v);
  }
  return groups;
}
