import { mkdirSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const apply = process.argv.includes("--apply");
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/thumbnail_completion";
const TIMEOUT_MS = 12_000;
const CONCURRENCY = 5;

const htmlDecode = (value = "") => value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const metaImage = (html) => {
  const tags = html.match(/<meta\s+[^>]*>/gi) || [];
  for (const tag of tags) {
    const property = tag.match(/(?:property|name)=["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const content = tag.match(/content=["']([^"']+)["']/i)?.[1];
    if ((property === "og:image" || property === "twitter:image") && content?.startsWith("http")) return htmlDecode(content);
  }
  return "";
};

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "Mozilla/5.0 (compatible; IketeruEizouMetadata/1.0)" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function getPublicThumbnail(videoUrl) {
  const oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(videoUrl)}`;
  try {
    const data = await fetchJson(oembedUrl);
    if (typeof data.thumbnail_url === "string" && data.thumbnail_url.startsWith("http")) return { thumbnail: data.thumbnail_url, method: "vimeo_oembed" };
  } catch (error) {
    const oembedError = error instanceof Error ? error.message : String(error);
    try {
      const response = await fetch(videoUrl, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "Mozilla/5.0 (compatible; IketeruEizouMetadata/1.0)" } });
      if (!response.ok) return { thumbnail: "", method: "none", reason: `oembed:${oembedError}; ogp:HTTP ${response.status}` };
      const thumbnail = metaImage(await response.text());
      return thumbnail ? { thumbnail, method: "ogp" } : { thumbnail: "", method: "none", reason: `oembed:${oembedError}; ogp:image_missing` };
    } catch (ogpError) {
      const ogpMessage = ogpError instanceof Error ? ogpError.message : String(ogpError);
      return { thumbnail: "", method: "none", reason: `oembed:${oembedError}; ogp:${ogpMessage}` };
    }
  }
  return { thumbnail: "", method: "none", reason: "oembed:image_missing" };
}

async function pooledMap(items, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

mkdirSync(outputDir, { recursive: true });
const db = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await db.execute("SELECT id, title, videoUrl, source FROM videos WHERE platform = 'vimeo' AND (thumbnail IS NULL OR thumbnail = '') ORDER BY addedDate DESC");
const decisions = await pooledMap(rows, async (row) => {
  const fetched = await getPublicThumbnail(row.videoUrl);
  return { id: row.id, title: row.title, videoUrl: row.videoUrl, source: row.source, ...fetched };
});
const updated = [];
try {
  if (apply) {
    for (const item of decisions.filter((entry) => entry.thumbnail)) {
      const [result] = await db.execute("UPDATE videos SET thumbnail = ? WHERE id = ? AND platform = 'vimeo' AND (thumbnail IS NULL OR thumbnail = '')", [item.thumbnail, item.id]);
      if (result.affectedRows) updated.push({ id: item.id, thumbnail: item.thumbnail, method: item.method });
    }
  }
} finally {
  await db.end();
}
const summary = {
  mode: apply ? "apply" : "dry-run",
  completedAt: new Date().toISOString(),
  scanned: rows.length,
  oembed: decisions.filter((item) => item.method === "vimeo_oembed").length,
  ogp: decisions.filter((item) => item.method === "ogp").length,
  unavailable: decisions.filter((item) => !item.thumbnail).length,
  updated: updated.length,
};
writeFileSync(`${outputDir}/vimeo_ogp_thumbnail_${apply ? "apply" : "dry_run"}.json`, `${JSON.stringify({ summary, decisions, updated }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
process.exit(0);
