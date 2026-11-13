import { describe, expect, it } from "vitest";
import { applyVideoFilters, buildMetadataFilterOptions, buildProductionFilterOptions, getCategoryMissingCountKey, getCreatorIndexSection, getVideoSearchText, isEizo100Selection, isEizo100YearSelection, isLowAiOverallVideo, isUnavailableVideo, matchesCategoryFilter, matchesMetadataFilter, matchesRatingFilter, matchesSourceFilter, MISSING_FILTER_VALUE, parseSearchQuery, VIDEO_LIST_QUERY_OPTIONS } from "./useVideos";
import type { FilterState, Video } from "@/lib/types";

describe("parseSearchQuery", () => {
  it("通常キーワードとマイナスキーワードを分離する", () => {
    expect(parseSearchQuery("CM -アニメ -解説")).toEqual({
      includes: ["cm"],
      excludeKeywords: ["アニメ", "解説"],
      excludeSources: [],
    });
  });

  it("-source:xxx をソース除外として解釈する", () => {
    expect(parseSearchQuery("MV -source:note -source:youtube")).toEqual({
      includes: ["mv"],
      excludeKeywords: [],
      excludeSources: ["note", "youtube"],
    });
  });

  it("引用符で囲んだ検索語を一つのキーワードとして扱う", () => {
    expect(parseSearchQuery('"Web CM" -"音楽 解説"')).toEqual({
      includes: ["web cm"],
      excludeKeywords: ["音楽 解説"],
      excludeSources: [],
    });
  });
});

describe("getVideoSearchText", () => {
  it("用途・表現・トンマナ・制作・私的評価・AI評価・キュレーションメモを検索対象に含める", () => {
    const video: Video = {
      id: "test-video",
      platform: "youtube",
      title: "インタビュー映像",
      thumbnail: "",
      videoUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      embedUrl: "",
      genres: [],
      products: [],
      directions: [],
      tones: [],
      allTags: [],
      purposes: ["事業・サービス紹介"],
      expressions: ["実写＋アニメーション"],
      toneEmotions: ["信頼感"],
      toneVisuals: ["クリーン"],
      toneTechniques: ["テロップ"],
      productions: ["key MOVIE"],
      productionCredits: [{ name: "代田栄介", roles: ["監督"], entityType: "person" }],
      privateRating: "B",
      aiOverallRating: "A",
      aiDirectionRating: "A-",
      aiTechniqueRating: "B+",
      aiAnalysis: "",
      curationNote: {
        purpose: "採用応募の増加",
        background: "事業変革の節目",
        evaluation: "共感を軸とした構成が高く評価された",
        sourceUrls: ["https://example.com/case-study"],
      },
      embedStatus: "unknown",
      embedCheckedAt: "",
      addedDate: "2025-04-14",
    };

    const text = getVideoSearchText(video);
    expect(text).toContain("事業・サービス紹介");
    expect(text).toContain("実写＋アニメーション");
    expect(text).toContain("key movie");
    expect(text).toContain("監督");
    expect(text).toContain("b");
    expect(text).toContain("a-");
    expect(text).toContain("b+");
    expect(text).toContain("採用応募の増加");
    expect(text).toContain("事業変革の節目");
    expect(text).toContain("共感を軸とした構成が高く評価された");
  });
});

describe("VIDEO_LIST_QUERY_OPTIONS", () => {
  it("操作時以外の動画一覧の自動再取得を無効化する", () => {
    expect(VIDEO_LIST_QUERY_OPTIONS).toMatchObject({
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
    });
  });
});

describe("制作クレジットの役割フィルター", () => {
  const baseVideo = (id: string, productionCredits: Video["productionCredits"]): Video => ({
    id,
    platform: "youtube",
    title: id,
    thumbnail: "",
    videoUrl: `https://www.youtube.com/watch?v=${id}`,
    embedUrl: "",
    genres: [], products: [], directions: [], tones: [], allTags: [], purposes: [], expressions: [], toneEmotions: [], toneVisuals: [], toneTechniques: [],
    productions: (productionCredits ?? []).map((credit) => credit.name),
    productionCredits,
    privateRating: "", aiOverallRating: "", aiDirectionRating: "", aiTechniqueRating: "", aiAnalysis: "", embedStatus: "unknown", embedCheckedAt: "", addedDate: "2026-01-01",
  });

  it("役割を選ぶと該当する人物・会社だけを候補にし、人物・会社を選んだ時だけ動画を絞り込める", () => {
    const directed = baseVideo("directed", [{ name: "代田栄介", roles: ["監督", "編集"], entityType: "person" }]);
    const edited = baseVideo("edited", [{ name: "富田泰秀", roles: ["編集"], entityType: "person" }]);
    const production = baseVideo("production", [{ name: "LIGHT THE WAY Inc.", roles: ["制作会社"], entityType: "company" }]);
    const options = buildProductionFilterOptions([directed, edited, production], "監督");
    const roleSelection: FilterState = {
      search: "", genre: null, product: null, direction: null, tone: null, purpose: null, expression: null, toneEmotion: null, toneVisual: null, toneTechnique: null,
      production: null, productionRole: "監督", privateRating: null, aiOverallRating: null, aiDirectionRating: null, aiTechniqueRating: null,
      source: null, eizo100Only: false, eizo100Year: null, showUnavailable: false, sort: "newest", favoritesOnly: false,
    };
    const entitySelection: FilterState = {
      ...roleSelection,
      search: "", genre: null, product: null, direction: null, tone: null, purpose: null, expression: null, toneEmotion: null, toneVisual: null, toneTechnique: null,
      production: "代田栄介", productionRole: "監督", privateRating: null, aiOverallRating: null, aiDirectionRating: null, aiTechniqueRating: null,
      source: null, eizo100Only: false, eizo100Year: null, showUnavailable: false, sort: "newest", favoritesOnly: false,
    };

    expect(options.roles).toEqual(expect.arrayContaining([{ value: "監督", count: 1 }, { value: "編集", count: 2 }]));
    expect(options.entities).toEqual([{ value: "代田栄介", count: 1 }]);
    expect(applyVideoFilters([directed, edited, production], roleSelection).map((video) => video.id)).toEqual(["directed", "edited", "production"]);
    expect(applyVideoFilters([directed, edited, production], entitySelection).map((video) => video.id)).toEqual(["directed"]);
  });
});

describe("制作者の五十音・ABCインデックス", () => {
  it("かな・英字・未判定名を安全な見出しへ振り分ける", () => {
    expect(getCreatorIndexSection("あらまき")).toBe("あ");
    expect(getCreatorIndexSection("シシヤマザキ")).toBe("さ");
    expect(getCreatorIndexSection("WOW")).toBe("W");
    expect(getCreatorIndexSection("佐々木 貴大")).toBe("さ");
    expect(getCreatorIndexSection("平井秀次")).toBe("は");
    expect(getCreatorIndexSection("9Lana")).toBe("他");
  });
});

describe("buildMetadataFilterOptions", () => {
  it("非文字列の配列要素を除外し、並び替え時にlocaleCompare例外を起こさない", () => {
    const malformedVideo = {
      id: "malformed-metadata",
      platform: "youtube",
      title: "不正メタデータを含む映像",
      thumbnail: "",
      videoUrl: "https://www.youtube.com/watch?v=malformed",
      embedUrl: "",
      genres: [], products: [], directions: [], tones: [], allTags: [],
      purposes: ["MV", { unexpected: true }, 42],
      expressions: [null, "アニメーション"],
      toneEmotions: [], toneVisuals: [], toneTechniques: [], productions: [{}],
      privateRating: "", aiOverallRating: "", aiDirectionRating: "", aiTechniqueRating: "", aiAnalysis: "",
      embedStatus: "unknown", embedCheckedAt: "", addedDate: "2026-01-01",
    } as unknown as Video;

    const options = buildMetadataFilterOptions([malformedVideo]);

    expect(options.purpose).toEqual(expect.arrayContaining([{ value: "MV", count: 1 }]));
    expect(options.expression).toEqual(expect.arrayContaining([{ value: "アニメーション", count: 1 }]));
    expect(options.production).toContainEqual({ value: MISSING_FILTER_VALUE, label: "未入力", count: 1 });
  });
});

describe("未入力メタデータフィルター", () => {
  it("AI総合評価はB+以上と未評価を既定表示し、B以下だけを切り替え対象にする", () => {
    const baseVideo = (id: string, aiOverallRating: string): Video => ({
      id, platform: "youtube", title: id, thumbnail: "", videoUrl: `https://www.youtube.com/watch?v=${id}`, embedUrl: "",
      genres: [], products: [], directions: [], tones: [], allTags: [], purposes: [], expressions: [], toneEmotions: [], toneVisuals: [], toneTechniques: [], productions: [],
      privateRating: "", aiOverallRating, aiDirectionRating: "", aiTechniqueRating: "", aiAnalysis: "", embedStatus: "unknown", embedCheckedAt: "", addedDate: "2026-01-01",
    });
    const videos = ["S+", "S", "S-", "A+", "A", "A-", "B+", "", "B", "B-", "C"].map((rating, index) => baseVideo(`rating-${index}`, rating));
    const filters: FilterState = {
      search: "", genre: null, product: null, direction: null, tone: null, purpose: null, expression: null, toneEmotion: null, toneVisual: null, toneTechnique: null,
      production: null, privateRating: null, aiOverallRating: null, aiDirectionRating: null, aiTechniqueRating: null, eizo100Only: false, eizo100Year: null, showUnavailable: false, sort: "newest", favoritesOnly: false,
    };

    expect(isLowAiOverallVideo(baseVideo("allowed", "A-"))).toBe(false);
    expect(isLowAiOverallVideo(baseVideo("low", "B"))).toBe(true);
    expect(applyVideoFilters(videos, filters).map((video) => video.aiOverallRating)).toEqual(["S+", "S", "S-", "A+", "A", "A-", "B+", ""]);
    expect(applyVideoFilters(videos, { ...filters, showLowAiOverall: true })).toHaveLength(11);
  });

  it("ジャンル・商材・演出・トーンの未入力をカテゴリフィルターとして判定できる", () => {
    expect(matchesCategoryFilter([], MISSING_FILTER_VALUE)).toBe(true);
    expect(matchesCategoryFilter([{ slug: "film" }], MISSING_FILTER_VALUE)).toBe(false);
    expect(matchesCategoryFilter([{ slug: "film" }], "film")).toBe(true);
    expect(getCategoryMissingCountKey("genre")).toBe("__missing_genre__");
  });

  it("用途・表現・各トンマナ・制作の未入力を判定できる", () => {
    expect(matchesMetadataFilter([], MISSING_FILTER_VALUE)).toBe(true);
    expect(matchesMetadataFilter(["MV"], MISSING_FILTER_VALUE)).toBe(false);
    expect(matchesMetadataFilter(["MV"], "MV")).toBe(true);
  });

  it("私的評価とAI評価の未入力を判定できる", () => {
    expect(matchesRatingFilter("", MISSING_FILTER_VALUE)).toBe(true);
    expect(matchesRatingFilter("A+", MISSING_FILTER_VALUE)).toBe(false);
    expect(matchesRatingFilter("A+", "A+")).toBe(true);
  });

  it("未入力選択とカテゴリ・検索を併用して対象動画だけを一覧から抽出できる", () => {
    const baseVideo = (id: string, overrides: Partial<Video>): Video => ({
      id,
      platform: "youtube",
      title: `${id} 映像`,
      thumbnail: "",
      videoUrl: `https://www.youtube.com/watch?v=${id}`,
      embedUrl: "",
      genres: [], products: [], directions: [], tones: [], allTags: [], purposes: [], expressions: [],
      toneEmotions: [], toneVisuals: [], toneTechniques: [], productions: [],
      privateRating: "", aiOverallRating: "", aiDirectionRating: "", aiTechniqueRating: "", aiAnalysis: "",
      embedStatus: "unknown", embedCheckedAt: "", addedDate: "2026-01-01", source: "manual",
      ...overrides,
    });
    const emptyFilm = baseVideo("empty-film", { title: "空欄を含む映画", genres: [{ name: "映画 / ドラマ / ショートフィルム", slug: "film" }] });
    const populatedFilm = baseVideo("filled-film", { title: "入力済み映画", genres: [{ name: "映画 / ドラマ / ショートフィルム", slug: "film" }], purposes: ["MV"] });
    const noGenre = baseVideo("no-genre", { title: "ジャンル未入力" });
    const filters: FilterState = {
      search: "空欄", genre: "film", product: null, direction: null, tone: null,
      purpose: MISSING_FILTER_VALUE, expression: null, toneEmotion: null, toneVisual: null, toneTechnique: null,
      production: null, privateRating: null, aiOverallRating: null, aiDirectionRating: null, aiTechniqueRating: null,
      eizo100Only: false, eizo100Year: null, showUnavailable: false, sort: "newest", favoritesOnly: false,
    };

    expect(applyVideoFilters([emptyFilm, populatedFilm, noGenre], filters).map((video) => video.id)).toEqual(["empty-film"]);
    expect(applyVideoFilters([emptyFilm, populatedFilm, noGenre], { ...filters, search: "", genre: MISSING_FILTER_VALUE, purpose: null }).map((video) => video.id)).toEqual(["no-genre"]);
    expect(applyVideoFilters([emptyFilm, populatedFilm, noGenre], { ...filters, search: "", genre: null, purpose: null }).map((video) => video.id)).toEqual(["empty-film", "filled-film", "no-genre"]);
  });

  it("映像作家100人の受賞歴・出典ラベルを基に選出作品だけを抽出できる", () => {
    const selected: Video = {
      id: "eizo", platform: "youtube", title: "選出作品", thumbnail: "", videoUrl: "https://www.youtube.com/watch?v=abcdefghijk", embedUrl: "",
      genres: [], products: [], directions: [], tones: [], allTags: [], purposes: [], expressions: [], toneEmotions: [], toneVisuals: [], toneTechniques: [], productions: [],
      awards: [{ name: "映像作家100人", year: "2026", category: "2026選出作品", sourceUrl: "https://eizo100.jp/video/1" }],
      privateRating: "", aiOverallRating: "", aiDirectionRating: "", aiTechniqueRating: "", aiAnalysis: "", embedStatus: "unknown", embedCheckedAt: "", addedDate: "2026-01-01",
    };
    const other = { ...selected, id: "other", awards: [], title: "通常作品" };
    const filters: FilterState = { search: "", genre: null, product: null, direction: null, tone: null, purpose: null, expression: null, toneEmotion: null, toneVisual: null, toneTechnique: null, production: null, privateRating: null, aiOverallRating: null, aiDirectionRating: null, aiTechniqueRating: null, eizo100Only: true, eizo100Year: null, showUnavailable: false, sort: "newest", favoritesOnly: false };
    expect(isEizo100Selection(selected)).toBe(true);
    expect(applyVideoFilters([selected, other], filters).map((video) => video.id)).toEqual(["eizo"]);
  });

  it("映像作家100人の選出年を指定して該当年度の作品だけを抽出できる", () => {
    const base: Video = { id: "selected-2026", platform: "youtube", title: "2026選出", thumbnail: "", videoUrl: "https://www.youtube.com/watch?v=abcdefghijk", embedUrl: "", genres: [], products: [], directions: [], tones: [], allTags: [], purposes: [], expressions: [], toneEmotions: [], toneVisuals: [], toneTechniques: [], productions: [], awards: [{ name: "映像作家100人", year: "2026", category: "2026選出作品", sourceUrl: "https://eizo100.jp/video/2026" }], privateRating: "", aiOverallRating: "", aiDirectionRating: "", aiTechniqueRating: "", aiAnalysis: "", embedStatus: "unknown", embedCheckedAt: "", addedDate: "2026-01-01" };
    const previous = { ...base, id: "selected-2025", title: "2025選出", awards: [{ name: "映像作家100人", year: "2025", category: "2025選出作品", sourceUrl: "https://eizo100.jp/video/2025" }] };
    const filters: FilterState = { search: "", genre: null, product: null, direction: null, tone: null, purpose: null, expression: null, toneEmotion: null, toneVisual: null, toneTechnique: null, production: null, privateRating: null, aiOverallRating: null, aiDirectionRating: null, aiTechniqueRating: null, eizo100Only: true, eizo100Year: 2025, showUnavailable: false, sort: "newest", favoritesOnly: false };
    expect(isEizo100YearSelection(base, 2026)).toBe(true);
    expect(isEizo100YearSelection(base, 2025)).toBe(false);
    expect(applyVideoFilters([base, previous], filters).map((video) => video.id)).toEqual(["selected-2025"]);
  });

  it("出典サイトを指定して、その出典の動画だけを絞り込める", () => {
    const createVideo = (id: string, source: Video["source"], sourceLabel: string): Video => ({ id, platform: "youtube", title: id, thumbnail: "", videoUrl: `https://www.youtube.com/watch?v=${id}`, embedUrl: "", genres: [], products: [], directions: [], tones: [], allTags: [], purposes: [], expressions: [], toneEmotions: [], toneVisuals: [], toneTechniques: [], productions: [], privateRating: "", aiOverallRating: "", aiDirectionRating: "", aiTechniqueRating: "", aiAnalysis: "", embedStatus: "unknown", embedCheckedAt: "", addedDate: "2026-01-01", source, sourceLabel });
    const tyo = createVideo("tyo-video", "tyo", "TYO 公式制作実績");
    const other = createVideo("other-video", "pyramidfilm" as Video["source"], "ピラミッドフィルム 公式制作実績");
    const filters: FilterState = { search: "", genre: null, product: null, direction: null, tone: null, purpose: null, expression: null, toneEmotion: null, toneVisual: null, toneTechnique: null, production: null, privateRating: null, aiOverallRating: null, aiDirectionRating: null, aiTechniqueRating: null, source: "tyo", eizo100Only: false, eizo100Year: null, showUnavailable: false, sort: "newest", favoritesOnly: false };
    expect(matchesSourceFilter(tyo, "tyo")).toBe(true);
    expect(matchesSourceFilter(other, "tyo")).toBe(false);
    expect(applyVideoFilters([tyo, other], filters).map((video) => video.id)).toEqual(["tyo-video"]);
  });

  it("削除・非公開だけを既定で隠し、切替時は対象だけを一括表示する", () => {
    const base = (id: string, embedStatus: Video["embedStatus"], embedReason?: string): Video => ({ id, platform: "youtube", title: id, thumbnail: "", videoUrl: `https://www.youtube.com/watch?v=${id}`, embedUrl: "", genres: [], products: [], directions: [], tones: [], allTags: [], purposes: [], expressions: [], toneEmotions: [], toneVisuals: [], toneTechniques: [], productions: [], privateRating: "", aiOverallRating: "", aiDirectionRating: "", aiTechniqueRating: "", aiAnalysis: "", embedStatus, embedReason, embedCheckedAt: "", addedDate: "2026-01-01" });
    const available = base("available", "unknown");
    const deleted = base("deleted", "restricted", "unavailable_deleted");
    const privateVideo = base("private", "restricted", "unavailable_private");
    const embedRestricted = base("embed-restricted", "restricted", "unavailable_embed_restricted");
    const accessRestricted = base("access-restricted", "restricted", "unavailable_access_restricted");
    const filters: FilterState = { search: "", genre: null, product: null, direction: null, tone: null, purpose: null, expression: null, toneEmotion: null, toneVisual: null, toneTechnique: null, production: null, privateRating: null, aiOverallRating: null, aiDirectionRating: null, aiTechniqueRating: null, source: null, eizo100Only: false, eizo100Year: null, showUnavailable: false, sort: "newest", favoritesOnly: false };
    expect(isUnavailableVideo(deleted)).toBe(true);
    expect(isUnavailableVideo(privateVideo)).toBe(true);
    expect(isUnavailableVideo(embedRestricted)).toBe(false);
    expect(isUnavailableVideo(accessRestricted)).toBe(false);
    expect(applyVideoFilters([available, deleted, privateVideo, embedRestricted, accessRestricted], filters).map((video) => video.id)).toEqual(["available", "embed-restricted", "access-restricted"]);
    expect(applyVideoFilters([available, deleted, privateVideo, embedRestricted, accessRestricted], { ...filters, showUnavailable: true }).map((video) => video.id)).toEqual(["deleted", "private"]);
  });
});
