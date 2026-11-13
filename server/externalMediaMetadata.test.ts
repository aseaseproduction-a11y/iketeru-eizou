import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchExternalMediaMetadata } from "./externalMediaMetadata";

afterEach(() => vi.unstubAllGlobals());

describe("外部媒体の公開メタデータ候補取得", () => {
  it("TikTok oEmbedからタイトル・サムネイル・投稿者を返す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      title: "TikTokの公式タイトル", thumbnail_url: "https://cdn.example.com/thumb.jpg", author_name: "公式アカウント",
    }), { status: 200 })));

    await expect(fetchExternalMediaMetadata({ platform: "tiktok", url: "https://www.tiktok.com/@creator/video/123" }))
      .resolves.toMatchObject({ title: "TikTokの公式タイトル", thumbnail: "https://cdn.example.com/thumb.jpg", channelTitle: "公式アカウント", available: true });
  });

  it("XではoEmbedと公開ページのOpen Graphを組み合わせて候補を返す", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ author_name: "公式アカウント" }), { status: 200 }))
      .mockResolvedValueOnce(new Response('<meta property="og:title" content="X投稿のタイトル"><meta property="og:image" content="https://img.example.com/post.jpg">', { status: 200 })));

    await expect(fetchExternalMediaMetadata({ platform: "x", url: "https://x.com/official/status/123" }))
      .resolves.toMatchObject({ title: "X投稿のタイトル", thumbnail: "https://img.example.com/post.jpg", channelTitle: "公式アカウント", available: true });
  });

  it("公開情報が取得不能でも例外を送出せず、手入力継続用の結果を返す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));

    await expect(fetchExternalMediaMetadata({ platform: "x", url: "https://x.com/official/status/123" }))
      .resolves.toMatchObject({ available: false, title: "", thumbnail: "", reason: "network unavailable" });
  });
});
