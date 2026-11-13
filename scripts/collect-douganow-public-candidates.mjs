import { mkdir, writeFile } from "node:fs/promises";

const rootUrl = "https://douganow.jp/";
const outputDir = new URL("../analysis/site_imports/public_sources_batch_20260819/", import.meta.url);
const outputPath = new URL("douganow_public_candidates.json", outputDir);

function decode(value) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; IketeruEizouCatalog/1.0; +https://iketeruvid-mzehlcez.manus.space)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function articleTitle(html) {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return decode(h1 || title || "").replace(/\s*[-｜|]\s*動画NOW.*$/i, "").trim();
}

function videoCandidates(html, sourceUrl, sourceTitle) {
  const rows = [];
  const linkPattern = /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})[^\s"'<>]*/gi;
  for (const match of html.matchAll(linkPattern)) {
    const id = match[1];
    rows.push({ source: "douganow", sourceLabel: "動画NOW", sourceUrl, sourceTitle, platform: "youtube", id, videoUrl: `https://www.youtube.com/watch?v=${id}`, evidence: "public_douganow_article_official_channel_context" });
  }
  const vimeoPattern = /https?:\/\/(?:player\.)?vimeo\.com\/(?:video\/)?(\d+)[^\s"'<>]*/gi;
  for (const match of html.matchAll(vimeoPattern)) {
    const id = match[1];
    rows.push({ source: "douganow", sourceLabel: "動画NOW", sourceUrl, sourceTitle, platform: "vimeo", id, videoUrl: `https://vimeo.com/${id}`, evidence: "public_douganow_article_official_channel_context" });
  }
  return rows;
}

const rootHtml = await fetchText(rootUrl);
const rootLinks = [...rootHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)];
const articleUrls = [...new Set(rootLinks
  .map((match) => new URL(decode(match[1]), rootUrl).href)
  .filter((url) => new URL(url).hostname === "douganow.jp")
  .filter((url) => !url.includes("#") && url !== rootUrl && !/\/(?:category|tag|page|author)\//.test(new URL(url).pathname)))]
  .slice(0, 100);

const rows = [];
const articleResults = [];
for (let index = 0; index < articleUrls.length; index += 8) {
  const batch = await Promise.all(articleUrls.slice(index, index + 8).map(async (url) => {
    try {
      const html = await fetchText(url);
      const officialContext = /公式(?:チャンネル|YouTube|動画|サイト)|official\s+(?:channel|video)/i.test(html);
      const title = articleTitle(html);
      const candidates = officialContext ? videoCandidates(html, url, title) : [];
      return { url, result: officialContext ? "ok" : "hold", candidates };
    } catch (error) {
      return { url, result: "hold", candidates: [], reason: error instanceof Error ? error.message : String(error) };
    }
  }));
  for (const item of batch) {
    rows.push(...item.candidates);
    articleResults.push({ url: item.url, result: item.result, candidates: item.candidates.length, reason: item.reason || "" });
  }
}

const deduped = [...new Map(rows.map((row) => [`${row.platform}:${row.id}`, row])).values()];
const summary = { articleUrls: articleUrls.length, extracted: rows.length, uniqueByPlatformId: deduped.length, articleResults };
await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows: deduped }, null, 2)}\n`);
console.log(JSON.stringify({ articleUrls: articleUrls.length, extracted: rows.length, uniqueByPlatformId: deduped.length }, null, 2));
