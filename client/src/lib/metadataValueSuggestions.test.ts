import { describe, expect, it } from "vitest";
import type { Video } from "@/lib/types";
import { collectMetadataValueSuggestions, resolveSuggestedTagItems } from "./metadataValueSuggestions";

const firstVideo = {
  id: "first",
  platform: "youtube",
  title: "First",
  thumbnail: "",
  videoUrl: "https://example.com/first",
  embedUrl: "",
  genres: [{ name: "Web CM", slug: "web-cm" }],
  products: [{ name: "食品 / 飲料 / 飲食", slug: "food" }],
  directions: [{ name: "モーショングラフィックス", slug: "motion-graphics" }],
  tones: [{ name: "スタイリッシュ / クール", slug: "stylish" }],
  allTags: ["キャンペーン", "春"],
  purposes: ["プロモーション"],
  expressions: ["2D"],
  toneEmotions: [],
  toneVisuals: [],
  toneTechniques: [],
  productions: [],
  privateRating: "",
  aiOverallRating: "",
  aiDirectionRating: "",
  aiTechniqueRating: "",
  aiAnalysis: "",
  embedStatus: "unknown",
  embedCheckedAt: "",
  addedDate: "2026-08-28",
} as Video;

describe("metadataValueSuggestions", () => {
  it("全登録動画から重複のないカテゴリ・追加情報候補を収集する", () => {
    const suggestions = collectMetadataValueSuggestions([
      firstVideo,
      {
        ...firstVideo,
        id: "second",
        genres: [{ name: "MV", slug: "music-video" }],
        allTags: ["春", "ライブ"],
        purposes: ["MV"],
        expressions: ["実写"],
      },
    ]);

    expect(suggestions.tags).toEqual(["キャンペーン", "ライブ", "春"]);
    expect(suggestions.genres.map((item) => item.name)).toEqual(["MV", "Web CM"]);
    expect(suggestions.purposes).toEqual(["MV", "プロモーション"]);
    expect(suggestions.expressions).toEqual(["2D", "実写"]);
  });

  it("既存候補は元のslugを保持し、候補外の手入力値だけslugを生成する", () => {
    const result = resolveSuggestedTagItems(["Web CM", "新規カテゴリ"], firstVideo.genres);

    expect(result).toEqual([
      { name: "Web CM", slug: "web-cm" },
      { name: "新規カテゴリ", slug: "新規カテゴリ" },
    ]);
  });

  it("既存データに不完全な値が混在しても候補収集を継続する", () => {
    const malformedVideo = {
      ...firstVideo,
      id: "malformed",
      allTags: ["有効なタグ", undefined] as unknown as string[],
      genres: [{ name: "MV", slug: "mv" }, undefined] as unknown as typeof firstVideo.genres,
    } as Video;

    const suggestions = collectMetadataValueSuggestions([firstVideo, malformedVideo]);

    expect(suggestions.tags).toContain("有効なタグ");
    expect(suggestions.genres.map((item) => item.name)).toContain("MV");
  });
});
