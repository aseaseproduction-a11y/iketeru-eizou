import { describe, expect, it } from "vitest";
import { createVerifiedSiteImports } from "../scripts/lib/siteImportMetadata.mjs";

describe("指定サイト掲載動画の登録計画", () => {
  it("三重照合済みの公式制作実績を出典・制作・メモ付きで計画化する", () => {
    const [item] = createVerifiedSiteImports([{
      result: "verified", id: "abc123", platform: "youtube", videoUrl: "https://www.youtube.com/watch?v=abc123", titleMatch: true,
      title: "公式作品タイトル", retrievedTitle: "取得済み公式作品タイトル", source: "light_the_way", sourceUrl: "https://light-the-way.jp/works/movie/1",
      sourceUrls: ["https://light-the-way.jp/works/movie/1"], productionName: "LIGHT THE WAY Inc.", verificationReason: "official_source_url_video_id_oembed_title_match",
    }]);
    expect(item.embedUrl).toBe("https://www.youtube.com/embed/abc123");
    expect(item.productions).toEqual(["LIGHT THE WAY Inc."]);
    expect(item.curationNote.sourceUrls).toEqual(["https://light-the-way.jp/works/movie/1"]);
    expect(item.curationNote.background).toContain("公式作品タイトル");
  });

  it("未検証・URL欠損・タイトル不一致の候補を登録計画から除外する", () => {
    const imports = createVerifiedSiteImports([
      { result: "hold", id: "a", platform: "youtube", videoUrl: "https://youtube.com/watch?v=a", titleMatch: true, source: "favvid" },
      { result: "verified", id: "b", platform: "youtube", videoUrl: "", titleMatch: true, source: "favvid" },
      { result: "verified", id: "c", platform: "youtube", videoUrl: "https://youtube.com/watch?v=c", titleMatch: false, source: "favvid" },
    ]);
    expect(imports).toEqual([]);
  });
});
