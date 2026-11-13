import { writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const concurrency = 10;
const db = await mysql.createConnection(process.env.DATABASE_URL);
const normalize = (url = "") => String(url).replace(/^http:\/\//i, "https://").replace(/^https:\/\/www\./i, "https://").replace(/\/$/, "");
const getXId = (url) => url.match(/status\/(\d+)/)?.[1] || "";
const fetchJson = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok) return null;
  return response.json();
};
const getMetadata = async (row) => {
  try {
    if (row.platform === "vimeo") {
      const data = await fetchJson(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(row.videoUrl)}`);
      return { thumbnail: data?.thumbnail_url || "", title: data?.title || "", channelTitle: data?.author_name || "" };
    }
    if (row.platform === "x" || /(?:twitter\.com|x\.com)\/.+\/status\//i.test(row.videoUrl)) {
      const data = await fetchJson(`https://cdn.syndication.twimg.com/tweet-result?id=${getXId(row.videoUrl)}&lang=ja`);
      const media = data?.mediaDetails?.[0];
      return { thumbnail: media?.media_url_https || media?.media_url || "", title: data?.text || "", channelTitle: data?.user?.name || data?.user?.screen_name || "" };
    }
    if (row.platform === "tiktok" || /tiktok\.com/i.test(row.videoUrl)) {
      const data = await fetchJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(row.videoUrl)}`);
      return { thumbnail: data?.thumbnail_url || "", title: data?.title || "", channelTitle: data?.author_name || "" };
    }
    const data = await fetchJson(`https://noembed.com/embed?url=${encodeURIComponent(row.videoUrl)}`);
    return { thumbnail: data?.thumbnail_url || "", title: data?.title || "", channelTitle: data?.author_name || "" };
  } catch {
    return { thumbnail: "", title: "", channelTitle: "" };
  }
};

const [rows] = await db.execute("SELECT id, platform, videoUrl, title, channelTitle FROM videos WHERE (thumbnail IS NULL OR thumbnail = '') AND platform <> 'youtube'");
const report = { updated: [], held: [] };
try {
  for (let offset = 0; offset < rows.length; offset += concurrency) {
    const batch = rows.slice(offset, offset + concurrency);
    const results = await Promise.all(batch.map(async (row) => ({ row, metadata: await getMetadata(row) })));
    for (const { row, metadata } of results) {
      if (!metadata.thumbnail) { report.held.push({ id: row.id, platform: row.platform, videoUrl: row.videoUrl, reason: "thumbnail_unavailable" }); continue; }
      const [result] = await db.execute(
        "UPDATE videos SET thumbnail = ?, title = CASE WHEN title = '' THEN ? ELSE title END, channelTitle = CASE WHEN channelTitle IS NULL OR channelTitle = '' THEN ? ELSE channelTitle END WHERE id = ? AND videoUrl = ? AND (thumbnail IS NULL OR thumbnail = '')",
        [metadata.thumbnail, metadata.title || row.title, metadata.channelTitle || "", row.id, row.videoUrl]
      );
      if (result.affectedRows === 1) report.updated.push({ id: row.id, platform: row.platform, videoUrl: row.videoUrl, thumbnail: metadata.thumbnail });
      else report.held.push({ id: row.id, platform: row.platform, videoUrl: row.videoUrl, reason: "condition_mismatch" });
    }
  }
} finally {
  await db.end();
}
writeFileSync("/home/ubuntu/iketeru-eizou/analysis/external_media_thumbnail_backfill.json", `${JSON.stringify({ executedAt: new Date().toISOString(), ...report }, null, 2)}\n`);
console.log(JSON.stringify({ candidates: rows.length, updated: report.updated.length, held: report.held.length }, null, 2));
