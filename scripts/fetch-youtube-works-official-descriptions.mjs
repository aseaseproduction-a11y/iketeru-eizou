import { mkdirSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const OUTPUT_DIR = "/home/ubuntu/iketeru-eizou/analysis/production-research";
const OUTPUT_FILE = `${OUTPUT_DIR}/youtube_works_2026_official_youtube_descriptions.json`;

const db = await mysql.createConnection(process.env.DATABASE_URL);
const [videos] = await db.execute(`
  SELECT id, title, videoUrl, channelTitle
  FROM videos
  WHERE source = 'youtube_works_awards_2026'
    AND (productions IS NULL OR productions = '[]')
  ORDER BY id
`);
await db.end();

const ids = videos.map((video) => video.id);
const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(ids.join(","))}&key=${encodeURIComponent(process.env.YOUTUBE_API_KEY ?? "")}`, { signal: AbortSignal.timeout(20_000) });
if (!response.ok) throw new Error(`youtube_data_api_http_${response.status}`);
const payload = await response.json();
const snippets = new Map((payload.items ?? []).map((item) => [item.id, item.snippet]));
const results = videos.map((video) => {
  const snippet = snippets.get(video.id);
  const exactTitleMatched = Boolean(snippet && snippet.title === video.title);
  const officialChannelMatched = Boolean(snippet && snippet.channelTitle === video.channelTitle);
  return {
    id: video.id,
    videoUrl: video.videoUrl,
    databaseTitle: video.title,
    databaseChannelTitle: video.channelTitle,
    apiTitle: snippet?.title ?? null,
    apiChannelTitle: snippet?.channelTitle ?? null,
    description: snippet?.description ?? null,
    tags: snippet?.tags ?? [],
    exactTitleMatched,
    officialChannelMatched,
    status: exactTitleMatched && officialChannelMatched ? "official_video_matched" : "hold",
  };
});

mkdirSync(OUTPUT_DIR, { recursive: true });
const summary = {
  runAt: new Date().toISOString(),
  source: "YouTube Data API snippet from official SoftBank channel",
  total: results.length,
  officialVideoMatched: results.filter((result) => result.status === "official_video_matched").length,
  results,
};
writeFileSync(OUTPUT_FILE, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT_FILE, total: summary.total, officialVideoMatched: summary.officialVideoMatched }));
