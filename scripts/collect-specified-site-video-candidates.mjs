import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const outputDir = "/home/ubuntu/iketeru-eizou/analysis/site_imports";
const outputPath = `${outputDir}/official_video_candidates.json`;
mkdirSync(outputDir, { recursive: true });

const decode = (value = "") => String(value)
  .replaceAll("&amp;", "&")
  .replaceAll("&#x27;", "'")
  .replaceAll("&quot;", '"');
const clean = (value = "") => decode(String(value)
  .replace(/<[^>]*>/g, " ")
  .replace(/\s+/g, " ")
  .trim());
const normalize = (value = "") => String(value).toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, "");
const unique = (values) => [...new Set(values.filter(Boolean))];

function getVideo(url) {
  try {
    const parsed = new URL(decode(url));
    if (/youtu\.be|youtube\.com/i.test(parsed.hostname)) {
      const id = parsed.hostname.includes("youtu.be")
        ? parsed.pathname.split("/").filter(Boolean).at(-1)
        : parsed.searchParams.get("v") || parsed.pathname.match(/\/(?:embed|shorts)\/([^/?]+)/)?.[1];
      return id ? { platform: "youtube", id, videoUrl: `https://www.youtube.com/watch?v=${id}` } : null;
    }
    if (/vimeo\.com/i.test(parsed.hostname)) {
      const id = parsed.pathname.match(/\/(?:video\/)?(\d+)/)?.[1]
        || parsed.pathname.match(/\/playback\/(\d+)/)?.[1];
      return id ? { platform: "vimeo", id, videoUrl: `https://vimeo.com/${id}` } : null;
    }
  } catch { /* ignore malformed external links */ }
  return null;
}

function externalLinks(html) {
  const text = String(html);
  const attributed = [...text.matchAll(/(?:href|src)=["']([^"']+(?:youtube\.com|youtu\.be|vimeo\.com)[^"']*)["']/gi)].map((match) => decode(match[1]));
  const embedded = [...text.matchAll(/https?:\\?\/\\?\/[^"'\s<>]*(?:youtube\.com|youtu\.be|vimeo\.com)[^"'\s<>]*/gi)]
    .map((match) => decode(match[0].replaceAll("\\/", "/")));
  return unique([...attributed, ...embedded]);
}

function titleFromHtml(html) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1];
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return clean(og || h1 || title || "");
}

async function fetchText(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "Mozilla/5.0 (compatible; IketeruEizouCollector/1.0)" } });
    return response.ok ? await response.text() : "";
  } catch { return ""; }
}

async function mapLimit(values, limit, callback) {
  const results = [];
  for (let index = 0; index < values.length; index += limit) {
    results.push(...await Promise.all(values.slice(index, index + limit).map(callback)));
  }
  return results;
}

function directFavvidRows() {
  const sourceUrl = "https://to7mg.notion.site/FAVVID-773335a7959c4a26b6bd933ea4f40249";
  const rows = [];
  const files = readdirSync("/home/ubuntu/upload")
    .filter((file) => file.startsWith("to7mg.notion.site_FAVVID-") && file.endsWith(".html"));
  for (const file of files) {
    const html = readFileSync(`/home/ubuntu/upload/${file}`, "utf8");
    for (const fragment of html.split(/<a\b/i).slice(1)) {
      const anchor = fragment.slice(0, fragment.search(/<\/a>/i));
      const href = anchor.match(/href=["']([^"']+)["']/i)?.[1] || "";
      const video = getVideo(href);
      const title = clean(anchor.slice(anchor.indexOf(">") + 1));
      if (video && title) rows.push({ ...video, title, source: "favvid", sourceLabel: "FAVVID", sourceUrl, productionName: "", sourceContext: "FAVVIDに映像リファレンスとして掲載" });
    }
  }
  return rows;
}

async function collectWorkPages({ source, sourceLabel, rootUrl, indexUrl, indexUrls = [], pathPattern, productionName }) {
  const urls = indexUrls.length ? indexUrls : [indexUrl];
  const indexHtmls = await mapLimit(urls, 4, async (url) => url.startsWith("file:") ? readFileSync(url.replace("file:", ""), "utf8") : await fetchText(url));
  const links = unique(indexHtmls.flatMap((indexHtml) => [...indexHtml.matchAll(/href=["']([^"']+)["']/gi)]
    .map((match) => decode(match[1]))
    .map((href) => new URL(href, rootUrl).toString())
    .filter((url) => pathPattern.test(new URL(url).pathname))));
  const pages = await mapLimit(links, 6, async (sourceUrl) => ({ sourceUrl, html: await fetchText(sourceUrl) }));
  const rows = [];
  for (const page of pages) {
    const title = titleFromHtml(page.html);
    for (const externalUrl of externalLinks(page.html)) {
      const video = getVideo(externalUrl);
      if (video && title) rows.push({ ...video, title, source, sourceLabel, sourceUrl: page.sourceUrl, productionName, sourceContext: `${sourceLabel}の公式制作実績ページに掲載` });
    }
  }
  return { rows, pages: links.length };
}

const favvid = directFavvidRows();
const lightTheWay = await collectWorkPages({
  source: "light_the_way",
  sourceLabel: "LIGHT THE WAY 公式制作実績",
  rootUrl: "https://light-the-way.jp/",
  indexUrl: "https://light-the-way.jp/works/",
  indexUrls: ["https://light-the-way.jp/works/", ...Array.from({ length: 15 }, (_, index) => `https://light-the-way.jp/works/page/${index + 2}/`)],
  pathPattern: /^\/works\/(?:movie|graphic)\/\d+$/,
  productionName: "LIGHT THE WAY Inc.",
});
const alld = await collectWorkPages({
  source: "alld",
  sourceLabel: "ALLd. 公式制作実績",
  rootUrl: "https://alld.jp/",
  indexUrl: "file:/home/ubuntu/upload/alld.jp__1787116580125.html",
  pathPattern: /^\/projects\/[A-Za-z0-9_-]+$/,
  productionName: "ALLd.",
});
const takashiPath = "/home/ubuntu/iketeru-eizou/analysis/site_imports/takashi_ohashi_youtube_candidates.json";
const takashiOhashi = existsSync(takashiPath) ? JSON.parse(readFileSync(takashiPath, "utf8")).rows || [] : [];
const favvidSearchPath = "/home/ubuntu/iketeru-eizou/analysis/site_imports/favvid_youtube_search_candidates.json";
const favvidSearch = existsSync(favvidSearchPath) ? JSON.parse(readFileSync(favvidSearchPath, "utf8")).rows || [] : [];

const deduped = new Map();
for (const row of [...favvid, ...favvidSearch, ...lightTheWay.rows, ...alld.rows, ...takashiOhashi]) {
  const key = `${row.platform}:${row.id}`;
  const current = deduped.get(key);
  if (!current) deduped.set(key, { ...row, sourceUrls: [row.sourceUrl] });
  else {
    current.sourceUrls = unique([...current.sourceUrls, row.sourceUrl]);
    current.sourceContext = unique([current.sourceContext, row.sourceContext]).join(" / ");
  }
}

const rows = [...deduped.values()]
  .filter((row) => row.title && normalize(row.title).length >= 4)
  .sort((a, b) => a.source.localeCompare(b.source) || a.title.localeCompare(b.title, "ja"));
const summary = rows.reduce((result, row) => ({ ...result, [row.source]: (result[row.source] || 0) + 1, [row.platform]: (result[row.platform] || 0) + 1 }), {
  favvidDirectRows: favvid.length,
  lightTheWayWorkPages: lightTheWay.pages,
  alldProjectPages: alld.pages,
  takashiOhashiPortfolioCandidates: takashiOhashi.length,
  favvidSearchCandidates: favvidSearch.length,
  uniqueCandidates: rows.length,
});
writeFileSync(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
