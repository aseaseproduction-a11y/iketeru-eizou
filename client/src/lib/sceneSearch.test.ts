import { describe, expect, it } from "vitest";
import { filterFallbackScenes, getSceneKeywordCategories, searchScenes, type SceneItem } from "./sceneSearch";

const sampleScenes: SceneItem[] = [
  {
    id: "v1-0",
    videoId: "v1",
    videoTitle: "Sample PV",
    platform: "youtube",
    startSeconds: 0,
    endSeconds: 10,
    timeRange: "00:00 - 00:10",
    visual: "人物のターンから風景へグラフィックマッチで繋がるマッチカット。",
    audio: "キックに合わせて音ハメ。",
    keywords: ["マッチカット", "音ハメ"],
    thumbnailUrl: "",
  },
  {
    id: "v2-0",
    videoId: "v2",
    videoTitle: "Sample CM",
    platform: "youtube",
    startSeconds: 10,
    endSeconds: 20,
    timeRange: "00:10 - 00:20",
    visual: "円形窓へのmatch cutトランジションとビートシンク編集。",
    audio: "シンセベース。",
    keywords: ["match cut", "トラッキング"],
    thumbnailUrl: "",
  },
  {
    id: "v3-0",
    videoId: "v3",
    videoTitle: "One Shot Film",
    platform: "youtube",
    startSeconds: 0,
    endSeconds: 30,
    timeRange: "00:00 - 00:30",
    visual: "ラックフォーカスのみで部屋を移動するカット。",
    audio: "環境音。",
    keywords: ["トラッキング"],
    thumbnailUrl: "",
  },
  {
    id: "v4-0",
    videoId: "v4",
    videoTitle: "Focus Shift",
    platform: "youtube",
    startSeconds: 5,
    endSeconds: 12,
    timeRange: "00:05 - 00:12",
    visual: "手前から奥へのフォーカス送りで人物へ視線誘導。",
    audio: "ピアノ単音。",
    keywords: ["被写界深度"],
    thumbnailUrl: "",
  },
];

describe("sceneSearch technique keywords & categories", () => {
  it("exposes the 演出技法・編集 category with strict >= 2 hit filtering including synonyms", () => {
    const categories = getSceneKeywordCategories(sampleScenes);
    const techniqueCat = categories.find((cat) => cat.id === "technique");

    expect(techniqueCat).toBeDefined();
    expect(techniqueCat?.name).toBe("演出技法・編集");
    expect(techniqueCat?.keywords.some((kw) => kw.text === "マッチカット" && kw.count === 2)).toBe(true);
    expect(techniqueCat?.keywords.some((kw) => kw.text === "フォーカス送り" && kw.count === 2)).toBe(true);
    expect(techniqueCat?.keywords.some((kw) => kw.text === "トラッキング" && kw.count === 2)).toBe(true);
    expect(techniqueCat?.keywords.every((kw) => kw.count >= 2)).toBe(true);
  });

  it("matches case-insensitive technique synonyms cleanly in searchScenes", async () => {
    const matchCutResults = await searchScenes("マッチカット", 20, sampleScenes);
    expect(matchCutResults.map((r) => r.scene.id)).toEqual(["v1-0", "v2-0"]);

    const focusResults = await searchScenes("フォーカス送り", 20, sampleScenes);
    expect(focusResults.map((r) => r.scene.id).sort()).toEqual(["v3-0", "v4-0"]);
  });

  it("filters fallback scenes by excludeUnwatched and scoreFilter", () => {
    const richScenes: SceneItem[] = [
      { ...sampleScenes[0], analysisObservationScope: null, calibratedScore: 85 },
      { ...sampleScenes[1], analysisObservationScope: null, calibratedScore: 79 },
      { ...sampleScenes[2], analysisObservationScope: "triage_unverified_short", calibratedScore: null, aiOverallScore: 84 },
      { ...sampleScenes[3], analysisObservationScope: null, calibratedScore: null, aiOverallScore: 70 },
    ];
    expect(filterFallbackScenes(richScenes, { excludeUnwatched: true, scoreFilter: "all" }).map((s) => s.id)).toEqual(["v1-0", "v2-0", "v4-0"]);
    expect(filterFallbackScenes(richScenes, { excludeUnwatched: false, scoreFilter: "all" }).map((s) => s.id)).toEqual(["v1-0", "v2-0", "v3-0", "v4-0"]);
    expect(filterFallbackScenes(richScenes, { excludeUnwatched: true, scoreFilter: "calibrated_only" }).map((s) => s.id)).toEqual(["v1-0", "v2-0"]);
    expect(filterFallbackScenes(richScenes, { excludeUnwatched: true, scoreFilter: "score_78_plus" }).map((s) => s.id)).toEqual(["v1-0", "v2-0"]);
    expect(filterFallbackScenes(richScenes, { excludeUnwatched: true, scoreFilter: "score_83_plus" }).map((s) => s.id)).toEqual(["v1-0"]);
  });
});
