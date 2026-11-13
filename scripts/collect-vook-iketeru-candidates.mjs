import { mkdirSync, writeFileSync } from "node:fs";

const sourceUrl = "https://site.vook.vc/iketeru-eizou?c=b";
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/site_imports/vook_iketeru";
const html = await (await fetch(sourceUrl, { headers: { "user-agent": "Mozilla/5.0" } })).text();
const strip = (value = "") => value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const candidates = [];
const seen = new Set();
const anchorPattern = /<a\s+href="([^"]+)"[^>]*\bid="iketeru_([A-Za-z0-9_-]+)"[^>]*>([\s\S]*?)<\/a>/g;
for (const match of html.matchAll(anchorPattern)) {
  const [, videoUrl, anchorId, block] = match;
  if (!/^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|vimeo\.com)\//.test(videoUrl) || seen.has(videoUrl)) continue;
  const titleMatch = block.match(/class="item-title"[^>]*>([\s\S]*?)<\/div>/);
  const tags = [...block.matchAll(/class="item-tags-tag[^>]*>([\s\S]*?)<\/div>/g)].map((item) => strip(item[1])).filter(Boolean);
  const title = strip(titleMatch?.[1]) || strip(block.match(/<img[^>]+alt="([^"]+)"/)?.[1]);
  if (!title) continue;
  seen.add(videoUrl);
  candidates.push({
    id: anchorId,
    title,
    videoUrl,
    platform: /vimeo\.com/.test(videoUrl) ? "vimeo" : "youtube",
    source: "vook_iketeru",
    sourceUrl,
    allTags: tags,
    productions: [{ role: "掲載元", name: "Vook" }],
  });
}
mkdirSync(outputDir, { recursive: true });
writeFileSync(`${outputDir}/official_video_candidates.json`, `${JSON.stringify({ sourceUrl, fetchedAt: new Date().toISOString(), count: candidates.length, rows: candidates, candidates }, null, 2)}\n`);
console.log(JSON.stringify({ sourceUrl, candidates: candidates.length, youtube: candidates.filter((item) => item.platform === "youtube").length, vimeo: candidates.filter((item) => item.platform === "vimeo").length }, null, 2));
