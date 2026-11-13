export type VideoPlatform = "youtube" | "vimeo" | "x" | "tiktok" | "instagram" | "external";

export type DetectedVideoUrl = {
  platform: VideoPlatform;
  id: string;
  embedUrl: string;
  thumbnail: string;
};

export type ChromeExtensionImport = {
  url: string;
  title: string;
  platform: VideoPlatform;
};

const platformValues = new Set<VideoPlatform>(["youtube", "vimeo", "x", "tiktok", "instagram", "external"]);

function stableExternalId(url: string) {
  let hash = 5381;
  for (const character of url) hash = (hash * 33) ^ character.charCodeAt(0);
  return `external-${(hash >>> 0).toString(36)}`;
}

/**
 * Convert a public URL into the platform-specific fields required by the editor.
 * Other http(s) URLs stay addable as external media with a deterministic local ID.
 */
export function detectVideoUrl(rawUrl: string): DetectedVideoUrl | null {
  const value = rawUrl.trim();
  if (!value) return null;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) return null;

  const normalizedUrl = parsedUrl.toString();
  const youtube = normalizedUrl.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (youtube) {
    return {
      platform: "youtube",
      id: youtube[1],
      embedUrl: `https://www.youtube.com/embed/${youtube[1]}`,
      thumbnail: `https://img.youtube.com/vi/${youtube[1]}/hqdefault.jpg`,
    };
  }

  const vimeo = parsedUrl.hostname.match(/(?:^|\.)vimeo\.com$/) && normalizedUrl.match(/vimeo\.com\/(?:video\/)?(\d+)(?:[/?#]|$)/);
  if (vimeo) {
    return { platform: "vimeo", id: vimeo[1], embedUrl: `https://player.vimeo.com/video/${vimeo[1]}`, thumbnail: "" };
  }

  const x = parsedUrl.hostname.match(/(?:^|\.)(?:x|twitter)\.com$/) && parsedUrl.pathname.match(/\/(?:[^/]+|i)\/status\/(\d+)/);
  if (x) return { platform: "x", id: `x-${x[1]}`, embedUrl: "", thumbnail: "" };

  const tiktok = parsedUrl.hostname.match(/(?:^|\.)tiktok\.com$/) && parsedUrl.pathname.match(/\/@[^/]+\/video\/(\d+)/);
  if (tiktok) return { platform: "tiktok", id: `tiktok-${tiktok[1]}`, embedUrl: "", thumbnail: "" };

  const instagram = parsedUrl.hostname.match(/(?:^|\.)instagram\.com$/) && parsedUrl.pathname.match(/\/(?:p|reel|tv)\/([^/?#]+)/);
  if (instagram) return { platform: "instagram", id: `instagram-${instagram[1]}`, embedUrl: "", thumbnail: "" };

  return { platform: "external", id: stableExternalId(normalizedUrl), embedUrl: "", thumbnail: "" };
}

/** Parse only the explicit, user-triggered handoff made by the browser extension. */
export function getChromeExtensionImport(search: string): ChromeExtensionImport | null {
  const parameters = new URLSearchParams(search);
  if (parameters.get("from") !== "chrome-extension") return null;

  const url = parameters.get("url")?.trim() ?? "";
  const detected = detectVideoUrl(url);
  if (!detected) return null;

  const suppliedPlatform = parameters.get("platform") as VideoPlatform | null;
  return {
    url,
    title: (parameters.get("title") ?? "").trim().slice(0, 500),
    platform: suppliedPlatform && platformValues.has(suppliedPlatform) ? suppliedPlatform : detected.platform,
  };
}

/** Remove only the one-shot data passed by the browser extension after it has been consumed. */
export function clearChromeExtensionImport(search: string): string {
  const parameters = new URLSearchParams(search);
  if (parameters.get("from") !== "chrome-extension") return search;

  ["from", "url", "title", "platform"].forEach((key) => parameters.delete(key));
  const nextSearch = parameters.toString();
  return nextSearch ? `?${nextSearch}` : "";
}
