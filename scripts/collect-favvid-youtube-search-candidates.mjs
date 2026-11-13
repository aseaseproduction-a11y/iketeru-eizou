import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const outputDir = "/home/ubuntu/iketeru-eizou/analysis/site_imports";
const outputPath = `${outputDir}/favvid_youtube_search_candidates.json`;
const sourceUrl = "https://to7mg.notion.site/FAVVID-773335a7959c4a26b6bd933ea4f40249";
const offset = Math.max(0, Number(process.env.FAVVID_SEARCH_OFFSET || 0));
const limit = Math.min(80, Math.max(1, Number(process.env.FAVVID_SEARCH_LIMIT || 60)));
const clean = (value = "") => value.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#xA0;/gi, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const normalize = (value = "") => clean(value).toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, "");
const resembles = (left, right) => {
  const a = normalize(left);
  const b = normalize(right);
  if (a.length < 8 || b.length < 8) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const shortest = a.length <= b.length ? a : b;
  return shortest.length >= 14 && (a.includes(shortest.slice(0, 18)) || b.includes(shortest.slice(0, 18)));
};
const titleSet = new Set();
for (const file of readdirSync("/home/ubuntu/upload").filter((name) => name.startsWith("to7mg.notion.site_FAVVID-") && name.endsWith(".html"))) {
  const html = readFileSync(`/home/ubuntu/upload/${file}`, "utf8");
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1];
    const title = clean(match[2]);
    if (/^\/[A-Za-z0-9_-]+-[a-f0-9]{32}\?pvs=25$/i.test(href) && title.length >= 8) titleSet.add(title);
  }
}
const directPath = `${outputDir}/official_video_candidates.json`;
const directTitles = existsSync(directPath) ? new Set(JSON.parse(readFileSync(directPath, "utf8")).rows.filter((row) => row.source === "favvid").map((row) => normalize(row.title))) : new Set();
const titles = [...titleSet].filter((title) => !directTitles.has(normalize(title))).sort((a, b) => a.localeCompare(b, "ja"));
const batch = titles.slice(offset, offset + limit);
const key = process.env.YOUTUBE_API_KEY || "";
if (!key) throw new Error("YOUTUBE_API_KEY is required");
const existing = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, "utf8")).rows || [] : [];
const existingTitles = new Set(existing.map((row) => normalize(row.title)));
const rows = [...existing];
for (const title of batch) {
  try {
    const endpoint = new URL("https://www.googleapis.com/youtube/v3/search");
    endpoint.searchParams.set("part", "snippet");
    endpoint.searchParams.set("type", "video");
    endpoint.searchParams.set("maxResults", "3");
    endpoint.searchParams.set("q", title);
    endpoint.searchParams.set("key", key);
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(15_000) });
    const data = response.ok ? await response.json() : { items: [] };
    const matched = (data.items || []).find((item) => item?.id?.videoId && resembles(title, item?.snippet?.title || ""));
    if (matched && !existingTitles.has(normalize(title))) {
      rows.push({
        id: matched.id.videoId,
        platform: "youtube",
        videoUrl: `https://www.youtube.com/watch?v=${matched.id.videoId}`,
        title,
        source: "favvid",
        sourceLabel: "FAVVID",
        sourceUrl,
        sourceUrls: [sourceUrl],
        productionName: "",
        sourceContext: "FAVVIDの公式公開データベースに掲載",
        searchTitle: matched.snippet.title,
      });
    }
  } catch { /* no verifiable public result: remain absent */ }
}
const result = { generatedAt: new Date().toISOString(), counts: { allPortfolioCards: titles.length, offset, batchSize: batch.length, matchedCandidates: rows.length }, rows };
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result.counts, null, 2));
