export type ExternalMediaPlatform = "x" | "tiktok" | "instagram" | "vimeo";

export type ExternalMediaMetadata = {
  title: string;
  thumbnail: string;
  channelTitle: string;
  source: string;
  available: boolean;
  reason?: string;
};

const USER_AGENT = "Mozilla/5.0 (compatible; IketeruVideoCollection/1.0; metadata preview)";

const ALLOWED_DOMAINS: Record<ExternalMediaPlatform, readonly string[]> = {
  x: ["x.com", "twitter.com", "mobile.twitter.com"],
  tiktok: ["tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com", "m.tiktok.com"],
  instagram: ["instagram.com", "www.instagram.com"],
  vimeo: ["vimeo.com", "www.vimeo.com", "player.vimeo.com"],
};

export function assertAllowedExternalMediaUrl(platform: ExternalMediaPlatform, rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("不正なURL形式です");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("HTTPS以外のURLは許可されていません");
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host.includes(":") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host)
  ) {
    throw new Error("プライベートIPまたはローカルホストへのアクセスは禁止されています");
  }
  const allowed = ALLOWED_DOMAINS[platform] ?? [];
  const isAllowed = allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));
  if (!isAllowed) {
    throw new Error(`許可されていないドメインです (${host})`);
  }
  return parsed;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function metaContent(html: string, key: string) {
  const tags = html.match(/<meta\s+[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const property = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (property !== key.toLowerCase()) continue;
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (content) return decodeHtml(content).trim();
  }
  return "";
}

async function fetchOpenGraph(platform: ExternalMediaPlatform, url: string) {
  const safeUrl = assertAllowedExternalMediaUrl(platform, url);
  const response = await fetch(safeUrl.toString(), {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    redirect: "manual",
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status >= 300 && response.status < 400) {
    const loc = response.headers.get("location");
    if (!loc) throw new Error("リダイレクト先が不明です");
    const nextUrl = assertAllowedExternalMediaUrl(platform, new URL(loc, safeUrl).toString());
    const redirected = await fetch(nextUrl.toString(), {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (!redirected.ok) throw new Error(`公開ページ取得エラー (${redirected.status})`);
    const html = (await redirected.text()).slice(0, 2_000_000);
    return {
      title: metaContent(html, "og:title") || metaContent(html, "twitter:title"),
      thumbnail: metaContent(html, "og:image") || metaContent(html, "twitter:image"),
      channelTitle: metaContent(html, "og:site_name"),
    };
  }
  if (!response.ok) throw new Error(`公開ページ取得エラー (${response.status})`);
  const html = (await response.text()).slice(0, 2_000_000);
  return {
    title: metaContent(html, "og:title") || metaContent(html, "twitter:title"),
    thumbnail: metaContent(html, "og:image") || metaContent(html, "twitter:image"),
    channelTitle: metaContent(html, "og:site_name"),
  };
}

function empty(reason: string): ExternalMediaMetadata {
  return { title: "", thumbnail: "", channelTitle: "", source: "", available: false, reason };
}

export async function fetchExternalMediaMetadata(input: { platform: ExternalMediaPlatform; url: string }): Promise<ExternalMediaMetadata> {
  try {
    const safeUrl = assertAllowedExternalMediaUrl(input.platform, input.url).toString();
    if (input.platform === "tiktok") {
      const response = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(safeUrl)}`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) {
        const data = await response.json() as { title?: string; thumbnail_url?: string; author_name?: string };
        if (data.title || data.thumbnail_url || data.author_name) {
          return {
            title: data.title?.trim() ?? "",
            thumbnail: data.thumbnail_url?.trim() ?? "",
            channelTitle: data.author_name?.trim() ?? "",
            source: "TikTok oEmbed",
            available: true,
          };
        }
      }
    }

    if (input.platform === "x") {
      const response = await fetch(`https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(safeUrl)}`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(8_000),
      });
      const oembed = response.ok ? await response.json() as { author_name?: string } : {};
      try {
        const openGraph = await fetchOpenGraph("x", safeUrl);
        if (openGraph.title || openGraph.thumbnail || oembed.author_name) {
          return {
            title: openGraph.title,
            thumbnail: openGraph.thumbnail,
            channelTitle: oembed.author_name?.trim() || openGraph.channelTitle,
            source: "X公開ページ / oEmbed",
            available: true,
          };
        }
      } catch {
        if (oembed.author_name) return { title: "", thumbnail: "", channelTitle: oembed.author_name.trim(), source: "X oEmbed", available: true };
      }
    }

    const openGraph = await fetchOpenGraph(input.platform, safeUrl);
    if (openGraph.title || openGraph.thumbnail || openGraph.channelTitle) {
      return { ...openGraph, source: "公開ページのOpen Graph", available: true };
    }
    return empty("公開ページからタイトル・サムネイルを取得できませんでした。");
  } catch (error) {
    return empty(error instanceof Error ? error.message : "公開メタデータを取得できませんでした。");
  }
}
