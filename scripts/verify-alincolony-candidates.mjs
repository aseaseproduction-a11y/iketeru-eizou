import { readFileSync, writeFileSync } from "node:fs";

const input = JSON.parse(readFileSync("/home/ubuntu/iketeru-eizou/analysis/alincolony_good_movies/candidates.json", "utf8"));
const concurrency = 12;
const normalizeTitle = (value = "") => String(value).toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, "");
const resembles = (sourceTitle, fetchedTitle) => {
  const source = normalizeTitle(sourceTitle);
  const fetched = normalizeTitle(fetchedTitle);
  if (!source || !fetched) return false;
  if (source.includes(fetched) || fetched.includes(source)) return true;
  const token = source.slice(0, Math.min(source.length, 12));
  return token.length >= 6 && fetched.includes(token);
};
const fetchJson = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "Mozilla/5.0" } });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
};
const xId = (url) => url.match(/status\/(\d+)/)?.[1] || "";
const verify = async (candidate) => {
  if (candidate.platform === "youtube") {
    const metadata = await fetchJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(candidate.videoUrl)}&format=json`);
    const titleMatch = resembles(candidate.title, metadata?.title || "");
    return { ...candidate, retrievedTitle: metadata?.title || "", thumbnail: metadata?.thumbnail_url || "", channelTitle: metadata?.author_name || "", titleMatch, result: metadata && titleMatch ? "verified" : "hold", verificationReason: metadata ? (titleMatch ? "youtube_oembed_title_match" : "youtube_oembed_title_mismatch") : "youtube_oembed_unavailable" };
  }
  if (candidate.platform === "vimeo") {
    const metadata = await fetchJson(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(candidate.videoUrl)}`);
    const titleMatch = resembles(candidate.title, metadata?.title || "");
    return { ...candidate, retrievedTitle: metadata?.title || "", thumbnail: metadata?.thumbnail_url || "", channelTitle: metadata?.author_name || "", titleMatch, result: metadata && titleMatch ? "verified" : "hold", verificationReason: metadata ? (titleMatch ? "vimeo_oembed_title_match" : "vimeo_oembed_title_mismatch") : "vimeo_oembed_unavailable" };
  }
  if (candidate.platform === "x") {
    const metadata = await fetchJson(`https://cdn.syndication.twimg.com/tweet-result?id=${xId(candidate.videoUrl)}&lang=ja`);
    const retrievedTitle = metadata?.text || "";
    const titleMatch = Boolean(retrievedTitle) && resembles(candidate.title, retrievedTitle);
    const thumbnail = metadata?.mediaDetails?.[0]?.media_url_https || metadata?.mediaDetails?.[0]?.media_url || "";
    return { ...candidate, retrievedTitle, thumbnail, channelTitle: metadata?.user?.name || metadata?.user?.screen_name || "", titleMatch, result: metadata && titleMatch ? "verified" : "hold", verificationReason: metadata ? (titleMatch ? "x_public_post_title_match" : "x_public_post_title_mismatch") : "x_public_post_unavailable" };
  }
  const metadata = await fetchJson(`https://noembed.com/embed?url=${encodeURIComponent(candidate.videoUrl)}`);
  const titleMatch = resembles(candidate.title, metadata?.title || "");
  return { ...candidate, retrievedTitle: metadata?.title || "", thumbnail: metadata?.thumbnail_url || "", channelTitle: metadata?.author_name || "", titleMatch, result: metadata && titleMatch ? "verified" : "hold", verificationReason: metadata ? (titleMatch ? "public_oembed_title_match" : "public_oembed_title_mismatch") : "public_oembed_unavailable" };
};

const rows = [];
for (let index = 0; index < input.rows.length; index += concurrency) {
  rows.push(...await Promise.all(input.rows.slice(index, index + concurrency).map(verify)));
}
const summary = rows.reduce((accumulator, row) => ({ ...accumulator, [row.result]: (accumulator[row.result] || 0) + 1, [`${row.platform}_${row.result}`]: (accumulator[`${row.platform}_${row.result}`] || 0) + 1 }), { total: rows.length });
writeFileSync("/home/ubuntu/iketeru-eizou/analysis/alincolony_good_movies/verification.json", `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
