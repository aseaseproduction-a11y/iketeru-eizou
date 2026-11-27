import { describe, expect, it, vi } from "vitest";
import type { Video } from "@/lib/types";
import {
  DEFAULT_SORT_CONFIG,
  SORT_STORAGE_KEY,
  getVideoBandInfo,
  groupVideosByScoreBand,
  loadSavedSortConfig,
  normalizeSortConfig,
  saveSortConfig,
  sortVideos,
} from "./videoSort";

function makeVideo(id: string, overrides: Partial<Video> = {}): Video {
  return {
    id,
    platform: "youtube",
    title: id,
    thumbnail: "",
    videoUrl: `https://www.youtube.com/watch?v=${id}`,
    embedUrl: "",
    genres: [],
    products: [],
    directions: [],
    tones: [],
    allTags: [],
    purposes: [],
    expressions: [],
    toneEmotions: [],
    toneVisuals: [],
    toneTechniques: [],
    productions: [],
    privateRating: "",
    aiOverallRating: "",
    aiDirectionRating: "",
    aiTechniqueRating: "",
    aiAnalysis: "",
    embedStatus: "available",
    embedCheckedAt: "",
    addedDate: "2026-11-20",
    createdAt: "2026-11-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("videoSort", () => {
  it("既定は 追加順（新しい）→ 次に 評価順（高い）で、同日は評価順→createdAtで並ぶ", () => {
    const videos = [
      makeVideo("old-high", { addedDate: "2026-11-19", calibratedScore: 95 }),
      makeVideo("new-legacy-high", { addedDate: "2026-11-21", aiOverallScore: 98, aiOverallRating: "S+" }),
      makeVideo("new-cal-low", { addedDate: "2026-11-21", calibratedScore: 70 }),
      makeVideo("new-cal-high-older-ts", {
        addedDate: "2026-11-21",
        calibratedScore: 85,
        createdAt: "2026-11-21T09:00:00.000Z",
      }),
      makeVideo("new-cal-high-newer-ts", {
        addedDate: "2026-11-21",
        calibratedScore: 85,
        createdAt: "2026-11-21T12:00:00.000Z",
      }),
      makeVideo("new-unrated", { addedDate: "2026-11-21" }),
    ];

    const sorted = sortVideos(videos, DEFAULT_SORT_CONFIG);
    // 2026-11-21 が先。その中で校正済み(85 newer ts, 85 older ts, 70) → 未校正旧スコア(98) → 未評価 → 2026-11-19
    expect(sorted.map((v) => v.id)).toEqual([
      "new-cal-high-newer-ts",
      "new-cal-high-older-ts",
      "new-cal-low",
      "new-legacy-high",
      "new-unrated",
      "old-high",
    ]);
  });

  it("追加順（次に: なし）では addedDate → 同日 createdAt で並ぶ", () => {
    const videos = [
      makeVideo("same-day-1", { addedDate: "2026-11-21", createdAt: "2026-11-21T08:00:00.000Z", calibratedScore: 95 }),
      makeVideo("same-day-2", { addedDate: "2026-11-21", createdAt: "2026-11-21T15:00:00.000Z", calibratedScore: 60 }),
      makeVideo("prev-day", { addedDate: "2026-11-20", createdAt: "2026-11-20T23:59:59.000Z", calibratedScore: 99 }),
    ];

    expect(
      sortVideos(videos, { primaryKey: "added", primaryDir: "desc", secondaryKey: "none", secondaryDir: "desc" }).map(
        (v) => v.id,
      ),
    ).toEqual(["same-day-2", "same-day-1", "prev-day"]);

    expect(
      sortVideos(videos, { primaryKey: "added", primaryDir: "asc", secondaryKey: "none", secondaryDir: "desc" }).map(
        (v) => v.id,
      ),
    ).toEqual(["prev-day", "same-day-1", "same-day-2"]);
  });

  it("評価順が1番目のとき、校正済みを先にし旧スコアと混ぜず、5つの帯でまとめ帯内を並べ替え2で並べる", () => {
    const videos = [
      makeVideo("legacy-90", { addedDate: "2026-11-21", aiOverallScore: 90, aiOverallRating: "S-" }),
      makeVideo("cal-88-old", { addedDate: "2026-11-01", calibratedScore: 88 }),
      makeVideo("cal-83-new", { addedDate: "2026-11-21", calibratedScore: 83 }),
      makeVideo("cal-80", { addedDate: "2026-11-10", calibratedScore: 80 }),
      makeVideo("cal-70", { addedDate: "2026-11-15", calibratedScore: 70 }),
      makeVideo("cal-60", { addedDate: "2026-11-18", calibratedScore: 60 }),
      makeVideo("unrated", { addedDate: "2026-11-21" }),
    ];

    // 評価順(高い) → 次に 追加順(新しい): 83以上帯の中では 2026-11-21 の cal-83-new が cal-88-old より先に来る
    const cfgWithAdded = {
      primaryKey: "score" as const,
      primaryDir: "desc" as const,
      secondaryKey: "added" as const,
      secondaryDir: "desc" as const,
    };
    const sortedWithAdded = sortVideos(videos, cfgWithAdded);
    expect(sortedWithAdded.map((v) => v.id)).toEqual([
      "cal-83-new",
      "cal-88-old",
      "cal-80",
      "cal-70",
      "cal-60",
      "legacy-90",
      "unrated",
    ]);

    const groups = groupVideosByScoreBand(sortedWithAdded, sortedWithAdded, cfgWithAdded);
    expect(groups?.map((g) => `${g.scaleLabel}:${g.bandLabel}:${g.totalCount}`)).toEqual([
      "校正済み:83 以上:2",
      "校正済み:78〜82.9:1",
      "校正済み:65〜77.9:1",
      "校正済み:65 未満:1",
      "未校正（旧評価）:83 以上:1",
      ":未評価:1",
    ]);

    // 評価順(高い) → 次に なし: 帯の中は点数高い順なので cal-88-old が cal-83-new より先
    const cfgNoSecondary = {
      primaryKey: "score" as const,
      primaryDir: "desc" as const,
      secondaryKey: "none" as const,
      secondaryDir: "desc" as const,
    };
    const sortedNoSec = sortVideos(videos, cfgNoSecondary);
    expect(sortedNoSec.slice(0, 2).map((v) => v.id)).toEqual(["cal-88-old", "cal-83-new"]);
  });

  it("帯の境界値（83 / 78 / 65）を正確に分類する", () => {
    expect(getVideoBandInfo(makeVideo("a", { calibratedScore: 83 })).bandId).toBe("83_plus");
    expect(getVideoBandInfo(makeVideo("b", { calibratedScore: 82.9 })).bandId).toBe("78_82");
    expect(getVideoBandInfo(makeVideo("c", { calibratedScore: 78 })).bandId).toBe("78_82");
    expect(getVideoBandInfo(makeVideo("d", { calibratedScore: 77.9 })).bandId).toBe("65_77");
    expect(getVideoBandInfo(makeVideo("e", { calibratedScore: 65 })).bandId).toBe("65_77");
    expect(getVideoBandInfo(makeVideo("f", { calibratedScore: 64.9 })).bandId).toBe("under_65");
    expect(getVideoBandInfo(makeVideo("g")).bandId).toBe("unrated");
  });

  it("投稿日時順（新しい／古い）で並び、投稿日時がない動画はどちらの向きでも常に最後になる", () => {
    const videos = [
      makeVideo("no-pub-new-added", { addedDate: "2026-11-27", publishedAt: null }),
      makeVideo("pub-2026", { addedDate: "2026-11-20", publishedAt: "2026-10-14T12:00:11.000Z" }),
      makeVideo("pub-2014", { addedDate: "2026-11-25", publishedAt: "2014-07-10 10:37:37" }),
      makeVideo("pub-2024", { addedDate: "2026-11-21", publishedAt: "2024-08-27T01:42:00.000Z" }),
    ];

    expect(
      sortVideos(videos, {
        primaryKey: "published",
        primaryDir: "desc",
        secondaryKey: "none",
        secondaryDir: "desc",
      }).map((v) => v.id),
    ).toEqual(["pub-2026", "pub-2024", "pub-2014", "no-pub-new-added"]);

    expect(
      sortVideos(videos, {
        primaryKey: "published",
        primaryDir: "asc",
        secondaryKey: "none",
        secondaryDir: "desc",
      }).map((v) => v.id),
    ).toEqual(["pub-2014", "pub-2024", "pub-2026", "no-pub-new-added"]);
  });

  it("評価順の帯の中で並べ替え2に投稿日時順を指定できる", () => {
    const videos = [
      makeVideo("cal-88-old-pub", { calibratedScore: 88, publishedAt: "2020-01-01T00:00:00.000Z" }),
      makeVideo("cal-84-new-pub", { calibratedScore: 84, publishedAt: "2026-05-01T00:00:00.000Z" }),
      makeVideo("cal-90-no-pub", { calibratedScore: 90, publishedAt: null }),
    ];

    expect(
      sortVideos(videos, {
        primaryKey: "score",
        primaryDir: "desc",
        secondaryKey: "published",
        secondaryDir: "desc",
      }).map((v) => v.id),
    ).toEqual(["cal-84-new-pub", "cal-88-old-pub", "cal-90-no-pub"]);
  });

  it("normalizeSortConfig と localStorage 読み書きが不正値・例外に対して安全に動作する", () => {
    expect(
      normalizeSortConfig({ primaryKey: "score", primaryDir: "desc", secondaryKey: "score", secondaryDir: "asc" }),
    ).toEqual({
      primaryKey: "score",
      primaryDir: "desc",
      secondaryKey: "none",
      secondaryDir: "asc",
    });

    const store = new Map<string, string>();
    const fakeWindow = {
      localStorage: {
        getItem: vi.fn((k: string) => store.get(k) ?? null),
        setItem: vi.fn((k: string, v: string) => {
          store.set(k, v);
        }),
      },
    };
    vi.stubGlobal("window", fakeWindow);
    try {
      saveSortConfig({ primaryKey: "score", primaryDir: "asc", secondaryKey: "added", secondaryDir: "desc" });
      expect(store.has(SORT_STORAGE_KEY)).toBe(true);
      expect(loadSavedSortConfig()).toEqual({
        primaryKey: "score",
        primaryDir: "asc",
        secondaryKey: "added",
        secondaryDir: "desc",
      });

      // Broken JSON & throwing storage should never crash
      store.set(SORT_STORAGE_KEY, "{not-valid-json");
      expect(loadSavedSortConfig()).toEqual(DEFAULT_SORT_CONFIG);

      fakeWindow.localStorage.getItem.mockImplementationOnce(() => {
        throw new Error("SecurityError");
      });
      expect(loadSavedSortConfig()).toEqual(DEFAULT_SORT_CONFIG);

      fakeWindow.localStorage.setItem.mockImplementationOnce(() => {
        throw new Error("QuotaExceededError");
      });
      expect(() => saveSortConfig(DEFAULT_SORT_CONFIG)).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
