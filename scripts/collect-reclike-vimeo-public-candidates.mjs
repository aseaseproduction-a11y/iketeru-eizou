import { mkdir, writeFile } from "node:fs/promises";

const outputDir = new URL("../analysis/site_imports/public_sources_batch_20260819/", import.meta.url);

const reclikeSources = [
  ["reclike_motiongraphics_2d", "REClike MotionGraphics_2D", "https://reclike.com/l/s21cf"],
  ["reclike_motion_comic", "REClike MOTION COMIC", "https://reclike.com/l/stwNM"],
  ["reclike_live", "REClike ライブ演出", "https://reclike.com/l/5floC"],
  ["reclike_independent_animation", "REClike independent animation", "https://reclike.com/l/WoA4q"],
  ["reclike_drawing_animation", "REClike Drawing_animation", "https://reclike.com/l/XZP5b"],
  ["reclike_photorealistic", "REClike Photorealistic", "https://reclike.com/l/ZBmfR"],
  ["reclike_introduction_product", "REClike introduction_product", "https://reclike.com/l/q7U1A"],
  ["reclike_cinema", "REClike 実写/シネマ", "https://reclike.com/l/yB7jA"],
  ["reclike_one_take", "REClike ONE TAKE", "https://reclike.com/l/kov7h"],
  ["reclike_osmo", "REClike Osmo", "https://reclike.com/l/3UQCi"],
  ["reclike_360", "REClike 360°", "https://reclike.com/l/eSrYD"],
  ["reclike_goodlook", "REClike goodLook", "https://reclike.com/l/pC5a6"],
  ["reclike_motiongraphics_3d", "REClike MotionGraphics_3D", "https://reclike.com/l/cfFvX"],
];

const vimeoLikeSources = [
  ["vimeo_karekitsune_likes", "Vimeo karekitsune Likes", "karekitsune"],
  ["vimeo_taker_likes", "Vimeo taker Likes", "taker"],
  ["vimeo_user10086421_likes", "Vimeo user10086421 Likes", "user10086421"],
  ["vimeo_shirotaeisuke_likes", "Vimeo shirotaeisuke Likes", "shirotaeisuke"],
  ["vimeo_cubezeero_likes", "Vimeo cubezeero Likes", "cubezeero"],
  ["vimeo_tkmk_likes", "Vimeo tkmk Likes", "tkmk"],
];

function decodeEntities(value) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
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

function extractReclikeCandidates(html, source, sourceLabel, sourceUrl) {
  const candidates = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']*\/video\/(youtube|vimeo)\/([\w-]+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const [, href, platform, id, titleHtml] = match;
    const title = decodeEntities(titleHtml);
    if (!id || !title || title.length > 500) continue;
    candidates.push({
      source,
      sourceLabel,
      sourceUrl,
      platform,
      id,
      videoUrl: platform === "youtube" ? `https://www.youtube.com/watch?v=${id}` : `https://vimeo.com/${id}`,
      sourceTitle: title,
      sourceVideoUrl: new URL(decodeEntities(href), sourceUrl).href,
      evidence: "public_reclike_list_direct_video_link",
    });
  }
  return candidates;
}

function extractVimeoRssCandidates(xml, source, sourceLabel, username) {
  const candidates = [];
  for (const item of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const body = item[1];
    const titleMatch = body.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/i);
    const linkMatch = body.match(/<link>(?:<!\[CDATA\[)?https?:\/\/vimeo\.com\/(\d+)(?:\]\]>)?<\/link>/i);
    const id = linkMatch?.[1];
    const title = decodeEntities(titleMatch?.[1] ?? titleMatch?.[2] ?? "");
    if (!id || !title) continue;
    candidates.push({
      source,
      sourceLabel,
      sourceUrl: `https://vimeo.com/${username}/likes`,
      platform: "vimeo",
      id,
      videoUrl: `https://vimeo.com/${id}`,
      sourceTitle: title,
      sourceVideoUrl: `https://vimeo.com/${id}`,
      evidence: "public_vimeo_likes_rss_item",
    });
  }
  return candidates;
}

const rows = [];
const sourceResults = [];

for (const [source, sourceLabel, sourceUrl] of reclikeSources) {
  try {
    const html = await fetchText(sourceUrl);
    const candidates = extractReclikeCandidates(html, source, sourceLabel, sourceUrl);
    const pagingPath = html.match(/PAGING_URL\s*=\s*"([^"?]+\?orderby=manual&page=)"/i)?.[1];
    let exhausted = false;
    if (pagingPath) {
      const seenIds = new Set(candidates.map((row) => `${row.platform}:${row.id}`));
      for (let page = 2; page <= 50; page += 1) {
        const pageHtml = await fetchText(new URL(`${pagingPath}${page}`, sourceUrl).href);
        const pageRows = extractReclikeCandidates(pageHtml, source, sourceLabel, sourceUrl);
        const newRows = pageRows.filter((row) => !seenIds.has(`${row.platform}:${row.id}`));
        if (newRows.length === 0) {
          exhausted = true;
          break;
        }
        newRows.forEach((row) => seenIds.add(`${row.platform}:${row.id}`));
        candidates.push(...newRows);
      }
    }
    rows.push(...candidates);
    sourceResults.push({ source, sourceUrl, result: exhausted || !pagingPath ? "ok" : "partial", candidates: candidates.length });
  } catch (error) {
    sourceResults.push({ source, sourceUrl, result: "hold", candidates: 0, reason: error instanceof Error ? error.message : String(error) });
  }
}

for (const [source, sourceLabel, username] of vimeoLikeSources) {
  const rssUrl = `https://vimeo.com/${username}/likes/rss`;
  try {
    const xml = await fetchText(rssUrl);
    const candidates = extractVimeoRssCandidates(xml, source, sourceLabel, username);
    rows.push(...candidates);
    sourceResults.push({ source, sourceUrl: rssUrl, result: "ok", candidates: candidates.length });
  } catch (error) {
    sourceResults.push({ source, sourceUrl: rssUrl, result: "hold", candidates: 0, reason: error instanceof Error ? error.message : String(error) });
  }
}

const byPlatformId = new Map();
for (const row of rows) {
  const key = `${row.platform}:${row.id}`;
  const current = byPlatformId.get(key);
  if (!current) {
    byPlatformId.set(key, {
      ...row,
      sourceUrls: [row.sourceUrl],
      sourceContexts: [{ source: row.source, sourceLabel: row.sourceLabel, sourceUrl: row.sourceUrl, sourceTitle: row.sourceTitle, evidence: row.evidence }],
    });
    continue;
  }
  if (!current.sourceUrls.includes(row.sourceUrl)) current.sourceUrls.push(row.sourceUrl);
  current.sourceContexts.push({ source: row.source, sourceLabel: row.sourceLabel, sourceUrl: row.sourceUrl, sourceTitle: row.sourceTitle, evidence: row.evidence });
}
const deduped = [...byPlatformId.values()];
const summary = {
  extracted: rows.length,
  uniqueByPlatformId: deduped.length,
  bySource: Object.fromEntries(sourceResults.map(({ source, candidates, result }) => [source, { candidates, result }])),
};

await mkdir(outputDir, { recursive: true });
await writeFile(new URL("reclike_vimeo_public_candidates.json", outputDir), `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, sourceResults, rows: deduped }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
