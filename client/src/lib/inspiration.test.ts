import { describe, expect, it } from "vitest";
import type { Video } from "@/lib/types";
import { getInspirationSourceVideos, getInspirationThemeTokens, getThemeCandidates, getThemeCandidatesForCategorySelections, getThemeCandidatesForSelections, normalizeInspirationText, pickRandomInspirationVideo } from "./inspiration";

const createVideo = (id: string, title: string, overrides: Partial<Video> = {}): Video => ({
  id,
  platform: "youtube",
  title,
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
  productionCredits: [],
  privateRating: "",
  aiOverallRating: "",
  aiDirectionRating: "",
  aiTechniqueRating: "",
  aiAnalysis: "",
  curationNote: { purpose: "", background: "", evaluation: "", sourceUrls: [] },
  embedStatus: "unknown",
  embedCheckedAt: "",
  addedDate: "2026-08-22",
  ...overrides,
});

describe("インスピレーションのテーマ正規化", () => {
  it("全半角・大文字小文字・連続空白を吸収してトークン化する", () => {
    expect(normalizeInspirationText(" ＭＶ　2D  ")).toBe("mv 2d");
    expect(getInspirationThemeTokens("ＭＶ、2D / mv")).toEqual(["mv", "2d"]);
  });

  it("タイトル・ジャンル・商材・用途・表現・トーン・制作・役割・メモを横断してAND照合する", () => {
    const videos = [
      createVideo("fashion-mv", "Mode Film", {
        genres: [{ name: "MV", slug: "mv" }],
        products: [{ name: "ファッション", slug: "fashion" }],
        expressions: ["実写"],
        productions: ["LIGHT THE WAY Inc."],
        productionCredits: [{ name: "代田栄介", roles: ["監督"], entityType: "person" }],
      }),
      createVideo("corporate-2d", "企業紹介", {
        purposes: ["事業・サービス紹介"],
        expressions: ["2D"],
        toneVisuals: ["クリーン"],
      }),
    ];

    expect(getThemeCandidates(videos, "MV ファッション").map((video) => video.id)).toEqual(["fashion-mv"]);
    expect(getThemeCandidates(videos, "2Ｄ クリーン").map((video) => video.id)).toEqual(["corporate-2d"]);
    expect(getThemeCandidates(videos, "監督 代田栄介").map((video) => video.id)).toEqual(["fashion-mv"]);
    expect(getThemeCandidates(videos, "存在しないテーマ")).toEqual([]);
  });

  it("カテゴリ別プルダウンで選んだ複数条件をAND条件として照合する", () => {
    const videos = [
      createVideo("live-fashion", "Fashion Film", {
        products: [{ name: "ファッション / アパレル", slug: "fashion" }],
        expressions: ["実写"],
        productionCredits: [{ name: "山田太郎", roles: ["監督"], entityType: "person" }],
      }),
      createVideo("animation-fashion", "Fashion Animation", {
        products: [{ name: "ファッション / アパレル", slug: "fashion" }],
        expressions: ["アニメーション"],
      }),
    ];

    expect(getThemeCandidatesForSelections(videos, ["ファッション / アパレル", "実写", "監督"]).map((video) => video.id)).toEqual(["live-fashion"]);
    expect(getThemeCandidatesForSelections(videos, [])).toEqual([]);
  });

  it("プルダウン値をカテゴリ別にAND照合し、別カテゴリの同名テキストでは一致させない", () => {
    const videos = [
      createVideo("fashion-film", "実写という言葉を含む別作品", {
        products: [{ name: "ファッション / アパレル", slug: "fashion" }],
        expressions: ["実写"],
      }),
      createVideo("wrong-category", "ファッション / アパレル 実写", {
        products: [{ name: "食品 / 飲料 / 飲食", slug: "food" }],
        expressions: ["アニメーション"],
      }),
    ];

    expect(getThemeCandidatesForCategorySelections(videos, [
      { key: "product", value: "ファッション / アパレル" },
      { key: "expression", value: "実写" },
    ]).map((video) => video.id)).toEqual(["fashion-film"]);
  });

  it("既存カテゴリに未定義の表示値が混在してもテーマ指定を停止させない", () => {
    const videos = [createVideo("mv", "MV", {
      genres: [{ name: "MV", slug: undefined as unknown as string }],
    })];

    expect(getThemeCandidatesForCategorySelections(videos, [
      { key: "genre", value: "MV" },
    ]).map((video) => video.id)).toEqual(["mv"]);
  });
});

describe("インスピレーションの抽選", () => {
  it("候補が複数ある場合は直前と異なる映像を抽選する", () => {
    const candidates = [createVideo("one", "1"), createVideo("two", "2")];
    expect(pickRandomInspirationVideo(candidates, "one", () => 0)?.id).toBe("two");
  });

  it("候補がない場合は未選択を返す", () => {
    expect(pickRandomInspirationVideo([])).toBeUndefined();
  });

  it("直近に抽選した動画を避け、全公開母集団から候補を維持する", () => {
    const candidates = [createVideo("one", "1"), createVideo("two", "2"), createVideo("three", "3"), createVideo("private", "4", { embedReason: "unavailable_private" })];
    expect(getInspirationSourceVideos(candidates).map((video) => video.id)).toEqual(["one", "two", "three"]);
    expect(pickRandomInspirationVideo(candidates.slice(0, 3), "one", () => 0, ["two"] )?.id).toBe("three");
  });
});
