import { mkdir, writeFile } from "node:fs/promises";

const worksUrl = "https://www.onemedia.jp/works";
const outputDir = new URL("../analysis/site_imports/public_sources_batch_20260819/", import.meta.url);
const outputPath = new URL("onemedia_public_candidates.json", outputDir);

const decode = (value) => value
  .replace(/<[^>]*>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
  .replace(/\s+/g, " ")
  .trim();

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; IketeruEizouCatalog/1.0; +https://iketeruvid-mzehlcez.manus.space)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function workUrls(html) {
  return [...new Set([...html.matchAll(/href=["'](\/works\/[^"'#?]+)["']/gi)].map((match) => new URL(match[1], worksUrl).href))];
}

function workTitle(html) {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  return decode(title).replace(/\s*[｜|]\s*ワンメディア株式会社.*$/i, "").trim();
}

function externalUrls(html) {
  const urls = [...html.matchAll(/https?:\/\/[^\s"'<>]+/gi)].map((match) => decode(match[0]).replace(/[),.;]+$/, ""));
  return [...new Set(urls.filter((url) => /(?:tiktok\.com\/@[^/]+\/video\/\d+|youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/|vimeo\.com\/\d+)/i.test(url)))];
}

function parseVideo(url) {
  const youtube = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/i);
  if (youtube) return { platform: "youtube", id: youtube[1], videoUrl: `https://www.youtube.com/watch?v=${youtube[1]}` };
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vimeo) return { platform: "vimeo", id: vimeo[1], videoUrl: `https://vimeo.com/${vimeo[1]}` };
  const tiktok = url.match(/tiktok\.com\/@([^/]+)\/video\/(\d+)/i);
  if (tiktok) return { platform: "tiktok", id: `tiktok:${tiktok[2]}`, videoUrl: `https://www.tiktok.com/@${tiktok[1]}/video/${tiktok[2]}` };
  return null;
}

const allWorkUrls = new Set();
for (let page = 1; page <= 50; page += 1) {
  const url = page === 1 ? worksUrl : `${worksUrl}?page=${page}`;
  const html = await fetchText(url);
  const pageWorks = workUrls(html);
  const before = allWorkUrls.size;
  pageWorks.forEach((work) => allWorkUrls.add(work));
  if (pageWorks.length === 0 || allWorkUrls.size === before) break;
}

const detailResults = [];
const rows = [];
const urls = [...allWorkUrls];
for (let index = 0; index < urls.length; index += 8) {
  const batch = await Promise.all(urls.slice(index, index + 8).map(async (sourceUrl) => {
    try {
      const html = await fetchText(sourceUrl);
      const sourceTitle = workTitle(html);
      const candidates = externalUrls(html)
        .map(parseVideo)
        .filter(Boolean)
        .map((video) => ({ ...video, source: "one_media", sourceLabel: "ONE MEDIA公式Works", sourceUrl, sourceTitle, evidence: "official_onemedia_work_detail_direct_external_video_url", directSourceLink: true }));
      return { sourceUrl, result: "ok", candidates };
    } catch (error) {
      return { sourceUrl, result: "hold", candidates: [], reason: error instanceof Error ? error.message : String(error) };
    }
  }));
  for (const result of batch) {
    rows.push(...result.candidates);
    detailResults.push({ sourceUrl: result.sourceUrl, result: result.result, candidates: result.candidates.length, reason: result.reason || "" });
  }
}

const deduped = [...new Map(rows.map((row) => [`${row.platform}:${row.id}`, row])).values()];
await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), summary: { works: urls.length, extracted: rows.length, uniqueByPlatformId: deduped.length, detailResults }, rows: deduped }, null, 2)}\n`);
console.log(JSON.stringify({ works: urls.length, extracted: rows.length, uniqueByPlatformId: deduped.length }, null, 2));
