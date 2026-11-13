import { readFileSync, writeFileSync } from "node:fs";

const root = "/home/ubuntu/iketeru-eizou/analysis/ai_metadata_completion";
const inputPath = process.env.AI_ANALYSIS_INPUT || `${root}/inputs_0_3.json`;
const outputPath = process.env.AI_ANALYSIS_ENRICHED_OUTPUT || inputPath.replace(/\.json$/, "_enriched.json");
const inputs = JSON.parse(readFileSync(inputPath, "utf8"));

async function getYouTubePublicMetadata(videoId) {
  if (!process.env.YOUTUBE_API_KEY || !videoId) return null;
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", process.env.YOUTUBE_API_KEY);
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return null;
  const item = (await response.json())?.items?.[0]?.snippet;
  if (!item) return null;
  return {
    description: String(item.description || "").slice(0, 6_000),
    channelTitle: String(item.channelTitle || ""),
    publishedAt: String(item.publishedAt || ""),
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 40) : [],
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

const enriched = [];
for (const input of inputs) {
  const publicMetadata = input.platform === "youtube" ? await getYouTubePublicMetadata(input.id) : null;
  enriched.push({ ...input, publicMetadata });
  console.log(`completed ${enriched.length}/${inputs.length}`);
}
writeFileSync(outputPath, `${JSON.stringify(enriched, null, 2)}\n`);
console.log(JSON.stringify({ inputPath, outputPath, total: enriched.length, withPublicMetadata: enriched.filter((item) => item.publicMetadata).length }));
