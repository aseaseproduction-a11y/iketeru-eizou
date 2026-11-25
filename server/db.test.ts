import { describe, expect, it } from "vitest";
import { parseVideoRow } from "./db";

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
  });

  it("preserves analysisObservationScope when present and defaults to null", () => {
    const baseRow = {
      id: "obs-test",
      platform: "vimeo",
      title: "Observation scope test",
      thumbnail: null,
      videoUrl: "https://vimeo.com/776884130",
      embedUrl: null,
      source: "manual",
      sourceLabel: "手動追加",
      channelId: null,
      channelTitle: null,
      genres: "[]", products: "[]", directions: "[]", tones: "[]", allTags: "[]",
      purposes: "[]", expressions: "[]", toneEmotions: "[]", toneVisuals: "[]", toneTechniques: "[]", productions: "[]", awards: "[]",
      curationNote: null, metadataClassificationAudit: null,
      privateRating: null, aiOverallRating: null, aiDirectionRating: null, aiTechniqueRating: null,
      aiAnalysis: "メタデータのみ一次記録", embedStatus: "unknown", embedReason: null, embedCheckedAt: null,
      addedDate: "2026-11-19", createdAt: new Date(), updatedAt: new Date(),
    };
    const tagged = parseVideoRow({ ...baseRow, analysisObservationScope: "metadata_only_unwatched" } as never);
    const untagged = parseVideoRow({ ...baseRow, analysisObservationScope: null } as never);

    expect(tagged.analysisObservationScope).toBe("metadata_only_unwatched");
    expect(untagged.analysisObservationScope).toBeNull();
  });
});
