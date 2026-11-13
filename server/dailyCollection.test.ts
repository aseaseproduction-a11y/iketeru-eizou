import { describe, expect, it } from "vitest";
import { dailyCollectionIdentityIsConfirmed, dailyCollectionSourceIdFromCandidate, dailyCollectionTitlesResemble, dailyCollectionVideoIdFromUrl, getDailyCollectionArticleMetadataUpdate, getDailyCollectionExistingUpdate, weeklyCollectionRotation, weeklyCollectionSourceDefaults } from "./dailyCollection";

describe("daily collection identity gate", () => {
  it("extracts canonical IDs from supported public video URLs", () => {
    expect(dailyCollectionVideoIdFromUrl("youtube", "https://www.youtube.com/embed/t5jPgM_VKZo")).toBe("t5jPgM_VKZo");
    expect(dailyCollectionVideoIdFromUrl("vimeo", "https://player.vimeo.com/video/123456789")).toBe("123456789");
  });

  it("accepts matching official titles and rejects unrelated titles", () => {
    expect(dailyCollectionTitlesResemble("ロッテ「Let's ギューリッシュ」", "ロッテ「Let's ギューリッシュ」第11回BOVAグランプリ")).toBe(true);
    expect(dailyCollectionTitlesResemble("ロッテ「Let's ギューリッシュ」", "全く別の映像")).toBe(false);
  });

  it("allows a descriptive listing title only when the article has explicitly identified the canonical video URL", () => {
    expect(dailyCollectionIdentityIsConfirmed("出演者を含むCM記事の長い見出し", "公式チャンネルの短いCM正式タイトル", false)).toBe(false);
    expect(dailyCollectionIdentityIsConfirmed("出演者を含むCM記事の長い見出し", "公式チャンネルの短いCM正式タイトル", true)).toBe(true);
  });

  it("enables only update-oriented sources and keeps fixed archives out of weekly collection", () => {
    const sourcesById = new Map(weeklyCollectionSourceDefaults.map(([id, , , enabled]) => [id, enabled]));
    expect(weeklyCollectionSourceDefaults).toHaveLength(32);
    expect([...sourcesById.values()].filter(enabled => enabled === 1)).toHaveLength(26);
    expect(sourcesById.get("eizo100")).toBe(0);
    expect(sourcesById.get("bova")).toBe(0);
    expect(sourcesById.get("video_refs")).toBe(0);
    expect(sourcesById.get("vook_iketeru")).toBe(1);
    expect(sourcesById.get("alincolony")).toBe(1);
    expect(sourcesById.get("favvid")).toBe(1);
    expect(sourcesById.get("all_d")).toBe(0);
    expect(sourcesById.get("one_media")).toBe(0);
    expect(sourcesById.get("edp")).toBe(0);
  });

  it("uses two frequently updated CM sources every week and visits all other eligible sources once in four weeks", () => {
    const rotatingGroups = [weeklyCollectionRotation.week1, weeklyCollectionRotation.week2, weeklyCollectionRotation.week3, weeklyCollectionRotation.week4];
    const rotatingIds = rotatingGroups.flat();

    expect(weeklyCollectionRotation.everyWeek).toEqual(["bb_navi", "douganow"]);
    expect(rotatingGroups.every(group => group.length === 6)).toBe(true);
    expect(new Set(rotatingIds)).toHaveLength(24);
    expect(new Set([...weeklyCollectionRotation.everyWeek, ...rotatingIds])).toHaveLength(26);
    expect(weeklyCollectionRotation.week1).toEqual(["vook_iketeru", "alincolony", "favvid", "pics", "babel_pro", "aoi_pro"]);
  });

  it("updates only missing public metadata and adds a new provenance URL for an existing video", () => {
    const update = getDailyCollectionExistingUpdate({
      thumbnail: null,
      channelTitle: "",
      curationNote: JSON.stringify({
        purpose: "既存の目的",
        background: "既存の背景",
        evaluation: "既存の評価",
        sourceUrls: ["https://example.com/original"],
      }),
    }, {
      thumbnail_url: "https://images.example.com/thumb.jpg",
      author_name: "公式チャンネル",
    }, "https://example.com/new-listing");

    expect(update).toMatchObject({
      thumbnail: "https://images.example.com/thumb.jpg",
      channelTitle: "公式チャンネル",
    });
    expect(JSON.parse(update.curationNote ?? "{}")).toEqual({
      purpose: "既存の目的",
      background: "既存の背景",
      evaluation: "既存の評価",
      sourceUrls: ["https://example.com/original", "https://example.com/new-listing"],
    });
  });

  it("does not overwrite populated metadata or write when the provenance URL is already recorded", () => {
    const update = getDailyCollectionExistingUpdate({
      thumbnail: "https://images.example.com/existing.jpg",
      channelTitle: "既存チャンネル",
      curationNote: JSON.stringify({ purpose: "", background: "", evaluation: "", sourceUrls: ["https://example.com/listing"] }),
    }, {
      thumbnail_url: "https://images.example.com/new.jpg",
      author_name: "新チャンネル",
    }, "https://example.com/listing");

    expect(update).toEqual({});
  });

  it("fills only blank category fields with values explicitly stated by the listing article", () => {
    const update = getDailyCollectionArticleMetadataUpdate({
      genres: "[]",
      products: JSON.stringify(["既存商材"]),
      purposes: null,
    }, {
      genres: ["TV CM"],
      products: ["食品 / 飲料 / 飲食"],
      purposes: ["プロモーション"],
    });

    expect(update).toEqual({
      genres: JSON.stringify(["TV CM"]),
      purposes: JSON.stringify(["プロモーション"]),
    });
  });

  it("recognizes legacy TagItem category arrays as populated and never replaces them", () => {
    const update = getDailyCollectionArticleMetadataUpdate({
      genres: JSON.stringify([{ name: "Web CM", slug: "web-cm" }]),
      products: JSON.stringify([{ name: "食品 / 飲料 / 飲食", slug: "food" }]),
      purposes: JSON.stringify(["プロモーション"]),
    }, {
      genres: ["TV CM"],
      products: ["食品 / 飲料 / 飲食"],
      purposes: ["その他"],
    });

    expect(update).toEqual({});
  });

  it("keeps all weekly sources addressable with safe snake-case IDs for checked-at recording", () => {
    expect(weeklyCollectionSourceDefaults.every(([id]) => /^[a-z0-9_]{1,64}$/.test(id))).toBe(true);
  });

  it("requires candidates to name a safe collection-source ID before storing their provenance", () => {
    expect(dailyCollectionSourceIdFromCandidate("bb_navi")).toBe("bb_navi");
    expect(dailyCollectionSourceIdFromCandidate("BB-NAVI")).toBe("");
    expect(dailyCollectionSourceIdFromCandidate("../../../unexpected")).toBe("");
    expect(dailyCollectionSourceIdFromCandidate(undefined)).toBe("");
  });
});
