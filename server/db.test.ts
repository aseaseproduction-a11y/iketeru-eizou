import { describe, expect, it } from "vitest";
import {
  isMissingAnalysisVersionColumnError,
  isMissingCalibratedScoreAxesColumnError,
  isMissingOptionalVideoColumnError,
  parseVideoRow,
} from "./db";

describe("parseVideoRow", () => {
  it("exposes Notion metadata and AI evaluation fields", () => {
    const video = parseVideoRow({
      id: "sample-notion-video",
      platform: "youtube",
      title: "Notion metadata test",
      thumbnail: null,
      videoUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      embedUrl: null,
      source: "notion",
      sourceLabel: "Notion事例集",
      channelId: null,
      channelTitle: null,
      genres: "[]",
      products: "[]",
      directions: "[]",
      tones: "[]",
      allTags: "[]",
      purposes: '["プロモーション"]',
      expressions: '["2D"]',
      toneEmotions: '["信頼感"]',
      toneVisuals: '["ミニマル"]',
      toneTechniques: '["テロップ"]',
      productions: '["Sample Studio"]',
      awards: '[{"name":"ACC TOKYO CREATIVITY AWARDS","year":"2025","category":"フィルム部門 グランプリ","sourceUrl":"https://example.com/award"}]',
      curationNote: '{"purpose":"若年層への商品認知を高める","background":"夏季の新商品キャンペーン","evaluation":"映像と音楽の一体感が評価された","sourceUrls":["https://example.com/case-study"]}',
      privateRating: "B+",
      aiOverallRating: "A-",
      aiDirectionRating: "A",
      aiTechniqueRating: "A+",
      aiAnalysis: "Notionから同期した分析結果",
      embedStatus: "restricted",
      embedReason: "unavailable_private_or_deleted",
      embedCheckedAt: new Date("2026-08-12T00:00:00.000Z"),
      addedDate: "2025-04-06",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    expect(video.purposes).toEqual(["プロモーション"]);
    expect(video.aiOverallRating).toBe("A-");
    expect(video.aiDirectionRating).toBe("A");
    expect(video.aiTechniqueRating).toBe("A+");
    expect(video.aiAnalysis).toBe("Notionから同期した分析結果");
    expect(video.awards).toEqual([
      {
        name: "ACC TOKYO CREATIVITY AWARDS",
        year: "2025",
        category: "フィルム部門 グランプリ",
        sourceUrl: "https://example.com/award",
      },
    ]);
    expect(video.curationNote).toEqual({
      purpose: "若年層への商品認知を高める",
      background: "夏季の新商品キャンペーン",
      evaluation: "映像と音楽の一体感が評価された",
      sourceUrls: ["https://example.com/case-study"],
    });
    expect(video.embedStatus).toBe("restricted");
    expect(video.embedReason).toBe("unavailable_private_or_deleted");
    expect(video.embedCheckedAt).toBe("2026-08-12T00:00:00.000Z");
  });

  it("keeps detailed analysis separate from list-item shaping", () => {
    const video = parseVideoRow({
      id: "detail-video",
      platform: "youtube",
      title: "Detail test",
      thumbnail: null,
      videoUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      embedUrl: null,
      source: "manual",
      sourceLabel: "手動追加",
      channelId: null,
      channelTitle: null,
      genres: "[]", products: "[]", directions: "[]", tones: "[]", allTags: "[]",
      purposes: "[]", expressions: "[]", toneEmotions: "[]", toneVisuals: "[]", toneTechniques: "[]", productions: "[]", awards: "[]",
      curationNote: null, metadataClassificationAudit: "{\"status\":\"verified\"}",
      privateRating: null, aiOverallRating: null, aiDirectionRating: null, aiTechniqueRating: null,
      aiAnalysis: "長い分析本文", embedStatus: "available", embedReason: null, embedCheckedAt: null,
      addedDate: "2026-08-19", createdAt: new Date(), updatedAt: new Date(),
    } as never);
    const listItem = { ...video, aiAnalysis: "", metadataClassificationAudit: undefined };
    expect(listItem.aiAnalysis).toBe("");
    expect(listItem.metadataClassificationAudit).toBeUndefined();
    expect(video.aiAnalysis).toBe("長い分析本文");
    expect(video.analysisVersion).toBe("legacy");
    expect(video.analysisGeneratedAt).toBeNull();
    expect(video.analysisPromptSha256).toBeNull();
  });

  it("maps v3 analysisVersion, analysisGeneratedAt, analysisPromptSha256 and detects missing-column errors safely", () => {
    const generatedAt = new Date("2026-11-26T05:29:37.000Z");
    const v3Video = parseVideoRow({
      id: "v3-video",
      platform: "youtube",
      title: "V3 analyzed video",
      thumbnail: null,
      videoUrl: "https://www.youtube.com/watch?v=RgkoXU4BlOE",
      embedUrl: null,
      source: "vook",
      sourceLabel: null,
      channelId: null,
      channelTitle: null,
      genres: "[]", products: "[]", directions: "[]", tones: "[]", allTags: "[]",
      purposes: "[]", expressions: "[]", toneEmotions: "[]", toneVisuals: "[]", toneTechniques: "[]", productions: "[]", awards: "[]",
      curationNote: null, metadataClassificationAudit: null,
      privateRating: null, aiOverallRating: null, aiDirectionRating: null, aiTechniqueRating: null,
      aiAnalysis: "v3 analysis",
      analysisVersion: "v3",
      analysisGeneratedAt: generatedAt,
      analysisPromptSha256: "a53083e103d3114e72f5d60d321a0644b0daf603830ad033b74ed5b2ee0083fe",
      embedStatus: "available", embedReason: null, embedCheckedAt: null,
      addedDate: "2026-11-26", createdAt: new Date(), updatedAt: new Date(),
    } as never);

    expect(v3Video.analysisVersion).toBe("v3");
    expect(v3Video.analysisGeneratedAt).toBe("2026-11-26T05:29:37.000Z");
    expect(v3Video.analysisPromptSha256).toBe("a53083e103d3114e72f5d60d321a0644b0daf603830ad033b74ed5b2ee0083fe");

    expect(isMissingAnalysisVersionColumnError({ code: "ER_BAD_FIELD_ERROR", errno: 1054, message: "Unknown column 'analysisVersion' in 'field list'" })).toBe(true);
    expect(isMissingAnalysisVersionColumnError({ cause: { errno: 1054, message: "Unknown column 'analysisPromptSha256' in 'field list'" } })).toBe(true);
    expect(isMissingAnalysisVersionColumnError(new Error("Unknown column 'otherCol' in 'field list'"))).toBe(false);

    expect(isMissingCalibratedScoreAxesColumnError({ code: "ER_BAD_FIELD_ERROR", errno: 1054, message: "Unknown column 'calibratedScoreAxes' in 'field list'" })).toBe(true);
    expect(isMissingCalibratedScoreAxesColumnError({ cause: { errno: 1054, message: "Unknown column 'videos.calibratedScoreAxes' in 'field list'" } })).toBe(true);
    expect(isMissingCalibratedScoreAxesColumnError({ code: "ER_BAD_FIELD_ERROR", errno: 1054, message: "Unknown column 'analysisVersion' in 'field list'" })).toBe(false);
    expect(isMissingOptionalVideoColumnError({ code: "ER_BAD_FIELD_ERROR", errno: 1054, message: "Unknown column 'calibratedScoreAxes' in 'field list'" })).toBe(true);
  });

  it("parses calibratedScoreAxes from both JSON object and JSON string", () => {
    const axesPayload = {
      v: 1,
      axes: {
        direction: 17,
        visual_craft: 18,
        editing_rhythm: 17.5,
        sound_integration: 18.5,
        originality_finish: 17,
      },
      runs: 2,
      source: "phase3",
      offsetPerAxis: 0,
    };
    const parsedFromObj = parseVideoRow({
      id: "axes-obj",
      platform: "youtube",
      title: "Axes Object",
      thumbnail: null,
      videoUrl: "https://www.youtube.com/watch?v=-fYxwC8wJsk",
      embedUrl: null,
      source: "vook",
      sourceLabel: null,
      channelId: null,
      channelTitle: null,
      genres: "[]", products: "[]", directions: "[]", tones: "[]", allTags: "[]",
      purposes: "[]", expressions: "[]", toneEmotions: "[]", toneVisuals: "[]", toneTechniques: "[]", productions: "[]", awards: "[]",
      curationNote: null, metadataClassificationAudit: null,
      privateRating: null, aiOverallRating: null, aiDirectionRating: null, aiTechniqueRating: null,
      aiAnalysis: null,
      calibratedScore: "88.00",
      calibratedScoreAxes: axesPayload,
      embedStatus: "available", embedReason: null, embedCheckedAt: null,
      addedDate: "2026-11-26", createdAt: new Date(), updatedAt: new Date(),
    } as never);
    expect(parsedFromObj.calibratedScoreAxes).toEqual(axesPayload);

    const parsedFromStr = parseVideoRow({
      id: "axes-str",
      platform: "youtube",
      title: "Axes String",
      thumbnail: null,
      videoUrl: "https://www.youtube.com/watch?v=-fYxwC8wJsk",
      embedUrl: null,
      source: "vook",
      sourceLabel: null,
      channelId: null,
      channelTitle: null,
      genres: "[]", products: "[]", directions: "[]", tones: "[]", allTags: "[]",
      purposes: "[]", expressions: "[]", toneEmotions: "[]", toneVisuals: "[]", toneTechniques: "[]", productions: "[]", awards: "[]",
      curationNote: null, metadataClassificationAudit: null,
      privateRating: null, aiOverallRating: null, aiDirectionRating: null, aiTechniqueRating: null,
      aiAnalysis: null,
      calibratedScore: "88.00",
      calibratedScoreAxes: JSON.stringify(axesPayload),
      embedStatus: "available", embedReason: null, embedCheckedAt: null,
      addedDate: "2026-11-26", createdAt: new Date(), updatedAt: new Date(),
    } as never);
    expect(parsedFromStr.calibratedScoreAxes).toEqual(axesPayload);
  });
});
