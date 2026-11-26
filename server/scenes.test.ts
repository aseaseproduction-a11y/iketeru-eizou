import { describe, expect, it, vi } from "vitest";
import {
  buildVideoSceneFilterWhere,
  getVideoSceneKeywordStats,
  isMissingVideoScenesTableError,
  searchVideoScenes,
} from "./db";

describe("videoScenes search API & missing-table fallback", () => {
  it("recognizes MySQL/TiDB ER_NO_SUCH_TABLE (1146) errors safely", () => {
    expect(isMissingVideoScenesTableError({ code: "ER_NO_SUCH_TABLE", errno: 1146 })).toBe(true);
    expect(isMissingVideoScenesTableError(new Error("Table 'iketeru_eizou.videoScenes' doesn't exist"))).toBe(true);
    expect(isMissingVideoScenesTableError({ cause: { errno: 1146 } })).toBe(true);
    expect(isMissingVideoScenesTableError(new Error("Connection timeout"))).toBe(false);
  });

  it("builds SQL WHERE filters strictly on calibratedScore without leaking legacy aiOverallScore", () => {
    const def = buildVideoSceneFilterWhere({
      query: "マッチカット 夜",
      excludeUnwatched: true,
      scoreFilter: "score_78_plus",
    });
    expect(def.whereSql).toContain("v.analysisObservationScope IS NULL");
    expect(def.whereSql).toContain("v.calibratedScore IS NOT NULL AND v.calibratedScore >= 78");
    expect(def.whereSql).not.toContain("aiOverallScore");
    expect(def.whereSql).not.toContain("COALESCE");
    expect(def.wordGroups.length).toBe(2);
    expect(def.whereParams.some((p) => String(p).includes("match cut"))).toBe(true);

    const includeUnwatched = buildVideoSceneFilterWhere({
      query: "",
      excludeUnwatched: false,
      scoreFilter: "calibrated_only",
    });
    expect(includeUnwatched.whereSql).not.toContain("v.analysisObservationScope IS NULL");
    expect(includeUnwatched.whereSql).toContain("v.calibratedScore IS NOT NULL");

    const score83 = buildVideoSceneFilterWhere({ scoreFilter: "score_83_plus" });
    expect(score83.whereSql).toContain("v.calibratedScore IS NOT NULL AND v.calibratedScore >= 83");
    expect(score83.whereSql).not.toContain("aiOverallScore");

    const uncalibrated = buildVideoSceneFilterWhere({ scoreFilter: "uncalibrated_only" });
    expect(uncalibrated.whereSql).toContain("v.calibratedScore IS NULL");
  });

  it("returns available: false without throwing when videoScenes table does not exist in TiDB", async () => {
    const missingErr = Object.assign(new Error("Table 'iketeru_eizou.videoScenes' doesn't exist"), {
      code: "ER_NO_SUCH_TABLE",
      errno: 1146,
    });
    const fakePool = {
      query: vi.fn().mockRejectedValue(missingErr),
    };

    const searchRes = await searchVideoScenes({ query: "マッチカット", poolOverride: fakePool as never });
    expect(searchRes).toEqual({
      available: false,
      source: "table_unavailable",
      items: [],
      total: 0,
      hasMore: false,
      totalIndexedScenes: 0,
      totalIndexedVideos: 0,
    });

    const statsRes = await getVideoSceneKeywordStats({ poolOverride: fakePool as never });
    expect(statsRes).toEqual({
      available: false,
      source: "table_unavailable",
      totalScenes: 0,
      totalVideos: 0,
      categories: [],
    });
  });

  it("returns shaped items, pagination, and scores when videoScenes exists", async () => {
    const fakePool = {
      query: vi
        .fn()
        .mockResolvedValueOnce([[{ totalScenes: 35768, totalVideos: 4555 }]])
        .mockResolvedValueOnce([[{ cnt: 2 }]])
        .mockResolvedValueOnce([
          [
            {
              id: 101,
              videoId: "vid1",
              shotIndex: 3,
              startMmss: "00:10",
              endMmss: "00:15",
              startSec: "10.00",
              endSec: "15.00",
              shotTitle: "マッチカット転換",
              description: "円形窓から月へグラフィックマッチで切り替わる。",
              audioText: "キック音ハメ",
              keywordsJson: '["マッチカット","音ハメ"]',
              videoTitle: "Test MV",
              platform: "youtube",
              thumbnail: null,
              analysisObservationScope: null,
              calibratedScore: "88.50",
              calibratedRank: "A+",
              aiOverallScore: 86,
              aiOverallRating: "A+",
            },
          ],
        ]),
    };

    const res = await searchVideoScenes({
      query: "マッチカット",
      limit: 1,
      offset: 0,
      excludeUnwatched: true,
      scoreFilter: "score_78_plus",
      poolOverride: fakePool as never,
    });

    expect(res.available).toBe(true);
    expect(res.source).toBe("tidb");
    expect(res.total).toBe(2);
    expect(res.hasMore).toBe(true);
    expect(res.totalIndexedScenes).toBe(35768);
    expect(res.totalIndexedVideos).toBe(4555);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].scene.id).toBe("vid1_s03");
    expect(res.items[0].scene.calibratedScore).toBe(88.5);
    expect(res.items[0].matchedTerms).toContain("マッチカット");
  });
});
