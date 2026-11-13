import { describe, expect, it } from "vitest";
// @ts-expect-error JavaScript helper is intentionally shared with the Node import script.
import { buildExistingIndexes, findExistingVideo } from "../scripts/notion-dedupe.mjs";

describe("Notion import duplicate matching", () => {
  it("prevents an exact URL/title re-registration while keeping two gallery works with different titles distinct", () => {
    const galleryUrl = "https://www.kentaku-partners.co.jp/cm-gallery/";
    const indexes = buildExistingIndexes([
      { id: "gallery-a", videoUrl: galleryUrl, title: "テレビCM「そばに寄り添う」編" },
      { id: "gallery-b", videoUrl: galleryUrl, title: "テレビCM「ありがとうの手紙」編" },
    ]);

    expect(findExistingVideo(indexes, { id: "new-id", videoUrl: galleryUrl, title: "テレビCM「そばに寄り添う」編" })).toMatchObject({
      video: { id: "gallery-a" },
      matchedBy: "url",
    });
    expect(findExistingVideo(indexes, { id: "new-id", videoUrl: galleryUrl, title: "別のCM作品" })).toEqual({
      video: undefined,
      matchedBy: null,
    });
  });
});
