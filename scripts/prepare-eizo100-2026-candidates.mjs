import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const categoryId = 1045;
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/eizo100_2026";
const officialApi = "https://eizo100.jp/wp-json/wp/v2/video?categories=1045&per_page=100&page={page}&_embed=1";
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
      return { platform: "youtube", videoId, normalizedUrl: `https://www.youtube.com/watch?v=${videoId}`, status: videoId ? "candidate" : "invalid_video_url" };
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      const videoId = url.searchParams.get("v") || "";
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

const page1 = JSON.parse(readFileSync(`${outputDir}/video_page1_embedded.json`, "utf8"));
const page2 = JSON.parse(readFileSync(`${outputDir}/video_page2.json`, "utf8"));
if (page1.length + page2.length !== 191) throw new Error(`Unexpected official API counts: ${page1.length}+${page2.length}`);

const candidates = [...page1, ...page2].map((entry) => {
  const meta = entry.eizo_meta || {};
  const author = entry._embedded?.author?.[0] || {};
  const parsed = parseVideoUrl(meta.video_url || meta.youtube_url || "");
  return {
    sourcePostId: entry.id,
    sourceUrl: decodeEntities(entry.link),
    sourceCategory: "映像作家100人 2026",
    sourcePublishedAt: entry.date,
    creatorName: author.name || [meta.author_last_name, meta.author_first_name].filter(Boolean).join(" ") || "未取得",
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

const summary = candidates.reduce((accumulator, candidate) => {
  accumulator.total += 1;
  accumulator[candidate.platform] = (accumulator[candidate.platform] || 0) + 1;
  accumulator[candidate.status] = (accumulator[candidate.status] || 0) + 1;
  return accumulator;
}, { total: 0 });

mkdirSync(outputDir, { recursive: true });
writeFileSync(`${outputDir}/candidates.json`, `${JSON.stringify({ fetchedAt: new Date().toISOString(), sourceApi: officialApi, summary, candidates }, null, 2)}\n`);
writeFileSync(`${outputDir}/candidates.csv`, [
  "source_post_id,creator_name,work_title,platform,video_id,normalized_video_url,source_url,status",
  ...candidates.map((candidate) => [candidate.sourcePostId, candidate.creatorName, candidate.workTitle, candidate.platform, candidate.videoId, candidate.normalizedUrl, candidate.sourceUrl, candidate.status].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")),
].join("\n"));
console.log(JSON.stringify({ summary, output: `${outputDir}/candidates.json` }, null, 2));
