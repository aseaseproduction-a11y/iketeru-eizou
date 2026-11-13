import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const yearConfig = [
  [2018, 161, 87, 1], [2019, 663, 97, 1], [2020, 946, 94, 1], [2021, 989, 98, 1],
  [2022, 999, 145, 2], [2023, 1013, 198, 2], [2024, 1026, 194, 2], [2025, 1033, 181, 2],
];
const inputDir = "/home/ubuntu/iketeru-eizou/analysis/eizo100_2026";
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/eizo100_previous_years";
const decodeEntities = (value = "") => value
  .replaceAll(/&#(x?[0-9a-fA-F]+);/g, (_, raw) => String.fromCodePoint(raw.startsWith("x") ? Number.parseInt(raw.slice(1), 16) : Number.parseInt(raw, 10)))
  .replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#8211;", "–").replaceAll("&#8217;", "’").replaceAll("&#038;", "&").replaceAll(/<[^>]*>/g, "").trim();

function parseVideoUrl(rawUrl) {
  if (!rawUrl) return { platform: "none", videoId: "", normalizedUrl: "", status: "no_video_url" };
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      const videoId = url.pathname.split("/").filter(Boolean)[0] || "";
      return { platform: "youtube", videoId, normalizedUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : rawUrl, status: videoId ? "candidate" : "invalid_video_url" };
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      const videoId = url.searchParams.get("v") || (url.pathname.startsWith("/shorts/") ? url.pathname.split("/")[2] : "");
      return { platform: "youtube", videoId, normalizedUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : rawUrl, status: videoId ? "candidate" : "invalid_video_url" };
    }
    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const match = url.pathname.match(/\/(?:video\/)?(\d+)/);
      const videoId = match?.[1] || "";
      return { platform: "vimeo", videoId, normalizedUrl: videoId ? `https://vimeo.com/${videoId}` : rawUrl, status: videoId ? "candidate" : "invalid_video_url" };
    }
    return { platform: "external", videoId: "", normalizedUrl: rawUrl, status: "external_url" };
  } catch {
    return { platform: "external", videoId: "", normalizedUrl: rawUrl, status: "invalid_video_url" };
  }
}

const candidates = yearConfig.flatMap(([year, categoryId, expectedCount, pages]) => {
  const entries = Array.from({ length: pages }, (_, index) => JSON.parse(readFileSync(`${inputDir}/year_${year}_page${index + 1}.json`, "utf8"))).flat();
  if (entries.length !== expectedCount) throw new Error(`${year}: expected ${expectedCount}, received ${entries.length}`);
  return entries.map((entry) => {
    const meta = entry.eizo_meta || {};
    const parsed = parseVideoUrl(meta.video_url || meta.youtube_url || "");
    return {
      sourcePostId: entry.id,
      sourceUrl: decodeEntities(entry.link),
      sourceCategory: `映像作家100人 ${year}`,
      sourceYear: year,
      sourceCategoryId: categoryId,
      sourcePublishedAt: entry.date,
      creatorName: [meta.author_last_name, meta.author_first_name].filter(Boolean).join(" ") || "未取得",
      workTitle: decodeEntities(entry.title?.rendered),
      description: decodeEntities(meta.kaisetsu),
      credits: decodeEntities(meta.credit),
      duration: meta.duration || "",
      productionYear: entry.eizo_terms?.age?.map((item) => item.name).join(" / ") || "",
      sourceGenres: entry.eizo_terms?.genres?.map((item) => item.name) || [],
      originalVideoUrl: meta.video_url || meta.youtube_url || "",
      ...parsed,
    };
  });
});
const byYear = Object.fromEntries(yearConfig.map(([year]) => [year, candidates.filter((candidate) => candidate.sourceYear === year).reduce((counts, candidate) => ({ ...counts, total: counts.total + 1, [candidate.status]: (counts[candidate.status] || 0) + 1 }), { total: 0 })]));
const summary = candidates.reduce((counts, candidate) => ({ ...counts, total: counts.total + 1, [candidate.status]: (counts[candidate.status] || 0) + 1, [candidate.platform]: (counts[candidate.platform] || 0) + 1 }), { total: 0 });
mkdirSync(outputDir, { recursive: true });
writeFileSync(`${outputDir}/candidates.json`, `${JSON.stringify({ fetchedAt: new Date().toISOString(), source: "eizo100 official WordPress REST API", summary, byYear, candidates }, null, 2)}\n`);
writeFileSync(`${outputDir}/candidates.csv`, ["year,source_post_id,creator_name,work_title,platform,video_id,normalized_video_url,source_url,status", ...candidates.map((candidate) => [candidate.sourceYear, candidate.sourcePostId, candidate.creatorName, candidate.workTitle, candidate.platform, candidate.videoId, candidate.normalizedUrl, candidate.sourceUrl, candidate.status].map((value) => `"${String(value || "").replaceAll('"', '""')}"`).join(","))].join("\n"));
console.log(JSON.stringify({ summary, byYear, output: `${outputDir}/candidates.json` }, null, 2));
