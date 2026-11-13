import { mkdirSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const apply = process.argv.includes("--apply");
const limit = Number(process.env.PLAYBACK_LIMIT || "0");
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/playback_reverification";
const timeoutMs = 15_000;
const vimeoConcurrency = 6;
const youtubeApiKey = process.env.YOUTUBE_API_KEY;

const checkedAt = new Date().toISOString();
const isHttpUrl = (value) => typeof value === "string" && /^https?:\/\//i.test(value);

function restricted(reason, evidence) {
  return { embedStatus: "restricted", embedReason: reason, evidence };
}

function available(evidence) {
  return { embedStatus: "available", embedReason: null, evidence };
}

function unknown(reason, evidence) {
  return { embedStatus: "unknown", embedReason: reason, evidence };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "Mozilla/5.0 (compatible; IketeruEizouPlaybackAudit/1.0)" },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 160)}`);
  return JSON.parse(body);
}

async function verifyYoutubeBatch(videos) {
  if (!youtubeApiKey) {
    return videos.map((video) => ({ ...video, ...unknown("check_failed", "YouTube Data API key unavailable") }));
  }
  const ids = videos.map((video) => video.id).join(",");
  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "status,contentDetails");
    url.searchParams.set("id", ids);
    url.searchParams.set("key", youtubeApiKey);
    const data = await fetchJson(url);
    const byId = new Map((data.items || []).map((item) => [item.id, item]));
    return videos.map((video) => {
      const item = byId.get(video.id);
      if (!item) return { ...video, ...restricted("unavailable_private_or_deleted", "YouTube Data API: video item not returned") };
      if (item.status?.privacyStatus !== "public") return { ...video, ...restricted("unavailable_private_or_deleted", `YouTube privacyStatus=${item.status?.privacyStatus || "unknown"}`) };
      if (item.status?.embeddable === false) return { ...video, ...restricted("unavailable_embed_restricted", "YouTube status.embeddable=false") };
      const restriction = item.contentDetails?.regionRestriction;
      const blockedJapan = Array.isArray(restriction?.blocked) && restriction.blocked.includes("JP");
      const unavailableInJapan = Array.isArray(restriction?.allowed) && !restriction.allowed.includes("JP");
      if (blockedJapan || unavailableInJapan) return { ...video, ...restricted("unavailable_access_restricted", "YouTube region restriction excludes JP") };
      return { ...video, ...available("YouTube Data API: public and embeddable") };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return videos.map((video) => ({ ...video, ...unknown("check_failed", `YouTube Data API: ${message}`) }));
  }
}

async function verifyVimeo(video) {
  try {
    const oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(video.videoUrl)}`;
    const data = await fetchJson(oembedUrl);
    if (data?.video_id || data?.uri) return { ...video, ...available("Vimeo oEmbed: public response") };
    return { ...video, ...unknown("check_failed", "Vimeo oEmbed returned no video identifier") };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/HTTP (401|403|404|410)/.test(message)) return { ...video, ...restricted("unavailable_private_or_deleted", `Vimeo oEmbed: ${message}`) };
    return { ...video, ...unknown("check_failed", `Vimeo oEmbed: ${message}`) };
  }
}

async function verifyExternal(video) {
  if (!isHttpUrl(video.videoUrl)) return { ...video, ...restricted("unavailable_page_unavailable", "No valid public video URL") };
  try {
    const response = await fetch(video.videoUrl, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "Mozilla/5.0 (compatible; IketeruEizouPlaybackAudit/1.0)" } });
    if ([401, 403, 404, 410].includes(response.status)) return { ...video, ...restricted("unavailable_page_unavailable", `Public page HTTP ${response.status}`) };
    if (response.ok) return { ...video, ...unknown("check_failed", `Public page HTTP ${response.status}; embed playback cannot be verified for this platform`) };
    return { ...video, ...unknown("check_failed", `Public page HTTP ${response.status}`) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...video, ...unknown("check_failed", `Public page request: ${message}`) };
  }
}

async function pooledMap(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

mkdirSync(outputDir, { recursive: true });
const db = await mysql.createConnection(process.env.DATABASE_URL);
const [allRows] = await db.execute("SELECT id, platform, title, videoUrl, embedStatus, embedReason FROM videos ORDER BY platform, id");
const rows = limit > 0 ? allRows.slice(0, limit) : allRows;
const youtube = rows.filter((row) => row.platform === "youtube");
const vimeo = rows.filter((row) => row.platform === "vimeo");
const external = rows.filter((row) => row.platform !== "youtube" && row.platform !== "vimeo");

const youtubeResults = [];
for (let index = 0; index < youtube.length; index += 50) youtubeResults.push(...await verifyYoutubeBatch(youtube.slice(index, index + 50)));
const vimeoResults = await pooledMap(vimeo, verifyVimeo, vimeoConcurrency);
const externalResults = await pooledMap(external, verifyExternal, Math.min(4, external.length));
const decisions = [...youtubeResults, ...vimeoResults, ...externalResults];
const changes = decisions.filter((item) => item.embedStatus !== item.embedStatus || item.embedReason !== item.embedReason);

const updated = [];
try {
  if (apply) {
    for (let index = 0; index < decisions.length; index += 250) {
      const chunk = decisions.slice(index, index + 250);
      const statusCase = chunk.map(() => "WHEN ? THEN ?").join(" ");
      const reasonCase = chunk.map(() => "WHEN ? THEN ?").join(" ");
      const ids = chunk.map((item) => item.id);
      const sql = `UPDATE videos SET embedStatus = CASE id ${statusCase} ELSE embedStatus END, embedReason = CASE id ${reasonCase} ELSE embedReason END, embedCheckedAt = ? WHERE id IN (${ids.map(() => "?").join(",")})`;
      const values = [
        ...chunk.flatMap((item) => [item.id, item.embedStatus]),
        ...chunk.flatMap((item) => [item.id, item.embedReason]),
        checkedAt,
        ...ids,
      ];
      const [result] = await db.execute(sql, values);
      if (result.affectedRows) updated.push(...ids);
    }
  }
} finally {
  await db.end();
}

const byStatus = Object.fromEntries(["available", "restricted", "unknown"].map((status) => [status, decisions.filter((item) => item.embedStatus === status).length]));
const byReason = Object.fromEntries([...new Set(decisions.map((item) => item.embedReason || "none"))].sort().map((reason) => [reason, decisions.filter((item) => (item.embedReason || "none") === reason).length]));
const summary = { mode: apply ? "apply" : "dry-run", checkedAt, scanned: rows.length, platforms: { youtube: youtube.length, vimeo: vimeo.length, external: external.length }, byStatus, byReason, updated: updated.length };
writeFileSync(`${outputDir}/all_playback_${apply ? "apply" : "dry_run"}.json`, `${JSON.stringify({ summary, decisions }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
process.exit(0);
