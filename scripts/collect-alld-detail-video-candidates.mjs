import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const inputPath = "/home/ubuntu/iketeru-eizou/analysis/site_imports/official_video_candidates.json";
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/site_imports";
const outputPath = `${outputDir}/alld_detail_video_candidates.json`;
mkdirSync(outputDir, { recursive: true });
const unique = (items) => [...new Set(items.filter(Boolean))];
const clean = (value = "") => value.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const extractTitle = (html) => clean(html.match(/<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
const getVimeo = (raw) => {
  try { const url = new URL(raw.replaceAll("\\/", "/")); const id = url.pathname.match(/\/(?:video\/)?(\d+)/)?.[1]; return id ? { id, platform: "vimeo", videoUrl: `https://vimeo.com/${id}` } : null; } catch { return null; }
};
const current = existsSync(inputPath) ? JSON.parse(readFileSync(inputPath, "utf8")).rows || [] : [];
const savedAllDoms = existsSync("/home/ubuntu/upload")
  ? readdirSync("/home/ubuntu/upload").filter((file) => /^alld\.jp_.*\.html$/i.test(file))
  : [];
const archivedProjectPages = savedAllDoms.flatMap((file) => [...readFileSync(`/home/ubuntu/upload/${file}`, "utf8").matchAll(/href=["'](\/projects\/[A-Za-z0-9_-]+)["']/gi)].map((match) => `https://alld.jp${match[1]}`));
const pages = unique([...current.filter((row) => row.source === "alld").map((row) => row.sourceUrl), ...archivedProjectPages]);
const fetchCandidates = async (sourceUrl) => {
  const urls = [sourceUrl, `${sourceUrl.replace(/\/$/, "")}/_payload.json`, `${sourceUrl.replace(/\/$/, "")}/_payload.js`];
  const results = [];
  for (const url of urls) {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "Mozilla/5.0 (compatible; IketeruEizouCollector/1.0)" } }); if (response.ok) results.push({ url, text: await response.text() }); } catch { /* continue */ }
  }
  const title = results.map((item) => extractTitle(item.text)).find(Boolean) || "";
  const rawVideos = unique(results.flatMap((item) => [...item.text.matchAll(/https?:\\?\/\\?\/[^"'\s<>]*vimeo\.com[^"'\s<>]*/gi)].map((match) => match[0].replaceAll("\\/", "/"))));
  return { sourceUrl, title, responseUrls: results.map((item) => item.url), videos: rawVideos.map(getVimeo).filter(Boolean) };
};
const details = [];
for (let index = 0; index < pages.length; index += 4) details.push(...await Promise.all(pages.slice(index, index + 4).map(fetchCandidates)));
const rows = details.flatMap((detail) => detail.videos.map((video) => ({ ...video, title: detail.title, source: "alld", sourceLabel: "ALLd. 公式制作実績", sourceUrl: detail.sourceUrl, sourceUrls: detail.responseUrls, productionName: "ALLd.", sourceContext: "ALLd.公式プロジェクト詳細またはNuxtペイロード内で動画URLを確認" }))).filter((row) => row.title);
writeFileSync(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), projectPages: pages.length, details, rows }, null, 2)}\n`);
console.log(JSON.stringify({ projectPages: pages.length, detailsWithVideos: details.filter((detail) => detail.videos.length).length, candidateRows: rows.length }, null, 2));
