import { writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const concurrency = 20;
const requestedLimit = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] || 100);
const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 200)) : 100;
const db = await mysql.createConnection(process.env.DATABASE_URL);
const report = { updated: [], held: [] };

async function fetchJson(url) {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; IketeruVideoCollection/1.0)" },
      signal: AbortSignal.timeout(3_500),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function getMetadata(row) {
  if (row.platform === "youtube") {
    const data = await fetchJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(row.videoUrl)}`);
    const fallbackThumbnail = /^[A-Za-z0-9_-]{11}$/.test(row.id) ? `https://img.youtube.com/vi/${row.id}/hqdefault.jpg` : "";
    return { thumbnail: data?.thumbnail_url || fallbackThumbnail, channelTitle: data?.author_name || "" };
  }
  if (row.platform === "vimeo") {
    const data = await fetchJson(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(row.videoUrl)}`);
    return { thumbnail: data?.thumbnail_url || "", channelTitle: data?.author_name || "" };
  }
  return { thumbnail: "", channelTitle: "" };
}

const [rows] = await db.execute(`
  SELECT id, platform, videoUrl, title, thumbnail, channelTitle
  FROM videos
  WHERE platform IN ('youtube', 'vimeo')
    AND ((thumbnail IS NULL OR thumbnail = '') OR (channelTitle IS NULL OR channelTitle = ''))
  ORDER BY addedDate DESC, id
  LIMIT ${limit}
`);

try {
  for (let offset = 0; offset < rows.length; offset += concurrency) {
    const batch = rows.slice(offset, offset + concurrency);
    const results = await Promise.all(batch.map(async (row) => ({ row, metadata: await getMetadata(row) })));
    for (const { row, metadata } of results) {
      if (!metadata.thumbnail && !metadata.channelTitle) {
        report.held.push({ id: row.id, platform: row.platform, videoUrl: row.videoUrl, reason: "public_metadata_unavailable" });
        continue;
      }
      const [result] = await db.execute(
        `UPDATE videos
         SET thumbnail = CASE WHEN thumbnail IS NULL OR thumbnail = '' THEN ? ELSE thumbnail END,
             channelTitle = CASE WHEN channelTitle IS NULL OR channelTitle = '' THEN ? ELSE channelTitle END
         WHERE id = ? AND videoUrl = ? AND title = ?
           AND ((thumbnail IS NULL OR thumbnail = '') OR (channelTitle IS NULL OR channelTitle = ''))`,
        [metadata.thumbnail, metadata.channelTitle, row.id, row.videoUrl, row.title]
      );
      if (result.affectedRows === 1) report.updated.push({ id: row.id, platform: row.platform, videoUrl: row.videoUrl, updatedThumbnail: Boolean(metadata.thumbnail), updatedCreator: Boolean(metadata.channelTitle) });
      else report.held.push({ id: row.id, platform: row.platform, videoUrl: row.videoUrl, reason: "triple_check_or_missing_condition_mismatch" });
    }
  }
} finally {
  await db.end();
}

const reportPath = "/home/ubuntu/iketeru-eizou/analysis/basic_metadata_backfill_youtube_vimeo.json";
writeFileSync(reportPath, `${JSON.stringify({ executedAt: new Date().toISOString(), candidates: rows.length, ...report }, null, 2)}\n`);
console.log(JSON.stringify({ candidates: rows.length, updated: report.updated.length, held: report.held.length, reportPath }, null, 2));
