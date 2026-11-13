import { describe, expect, it } from "vitest";
import { clearChromeExtensionImport, detectVideoUrl, getChromeExtensionImport } from "./videoUrlDetection";

describe("detectVideoUrl", () => {
  it("recognizes the supported social and video platforms", () => {
    expect(detectVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toMatchObject({
      platform: "youtube", id: "dQw4w9WgXcQ", embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    });
    expect(detectVideoUrl("https://vimeo.com/123456789")).toMatchObject({ platform: "vimeo", id: "123456789" });
    expect(detectVideoUrl("https://x.com/example/status/123456789")).toMatchObject({ platform: "x", id: "x-123456789" });
    expect(detectVideoUrl("https://www.tiktok.com/@creator/video/123456789")).toMatchObject({ platform: "tiktok", id: "tiktok-123456789" });
    expect(detectVideoUrl("https://www.instagram.com/reel/ABCdef123/")).toMatchObject({ platform: "instagram", id: "instagram-ABCdef123" });
  });

  it("keeps any other public http(s) URL addable as external media", () => {
    const detected = detectVideoUrl("https://example.com/work/a-film?ref=portfolio");
    expect(detected?.platform).toBe("external");
    expect(detected?.id).toMatch(/^external-[a-z0-9]+$/);
    expect(detectVideoUrl("file:///private/video.mp4")).toBeNull();
    expect(detectVideoUrl("not a URL")).toBeNull();
  });
});

describe("getChromeExtensionImport", () => {
  it("accepts only the extension's explicit handoff and preserves a user-visible title", () => {
    expect(getChromeExtensionImport("?from=chrome-extension&url=https%3A%2F%2Fvimeo.com%2F123456789&title=Sample+Film&platform=vimeo")).toEqual({
      url: "https://vimeo.com/123456789", title: "Sample Film", platform: "vimeo",
    });
    expect(getChromeExtensionImport("?url=https%3A%2F%2Fvimeo.com%2F123456789")).toBeNull();
    expect(getChromeExtensionImport("?from=chrome-extension&url=javascript%3Aalert(1)")).toBeNull();
  });

  it("removes one-shot extension data while keeping unrelated query parameters", () => {
    expect(clearChromeExtensionImport("?from=chrome-extension&url=https%3A%2F%2Fvimeo.com%2F123456789&title=Sample+Film&platform=vimeo&view=compact")).toBe("?view=compact");
    expect(clearChromeExtensionImport("?video=123456789")).toBe("?video=123456789");
  });
});
