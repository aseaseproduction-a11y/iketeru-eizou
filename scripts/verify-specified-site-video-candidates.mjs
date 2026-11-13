import { readFileSync, writeFileSync } from "node:fs";

const inputPath = process.env.CANDIDATE_INPUT_PATH || "/home/ubuntu/iketeru-eizou/analysis/site_imports/official_video_candidates.json";
const outputPath = process.env.VERIFICATION_OUTPUT_PATH || "/home/ubuntu/iketeru-eizou/analysis/site_imports/official_video_verification.json";
const input = JSON.parse(readFileSync(inputPath, "utf8"));
const normalize = (value = "") => String(value).toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, "");
const resembles = (left, right) => {
  const source = normalize(left);
  const retrieved = normalize(right);
  if (!source || !retrieved) return false;
  if (source.includes(retrieved) || retrieved.includes(source)) return true;
  const shorter = source.length <= retrieved.length ? source : retrieved;
  return shorter.length >= 8 && (retrieved.includes(shorter.slice(0, 16)) || source.includes(shorter.slice(0, 16)));
};
const fetchJson = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "Mozilla/5.0 (compatible; IketeruEizouCollector/1.0)" } });
    return response.ok ? await response.json() : null;
  } catch { return null; }
};
const verify = async (candidate) => {
  const endpoint = candidate.platform === "youtube"
    ? `https://www.youtube.com/oembed?url=${encodeURIComponent(candidate.videoUrl)}&format=json`
    : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(candidate.videoUrl)}`;
  const metadata = await fetchJson(endpoint);
  const retrievedTitle = metadata?.title || "";
  const titleMatch = resembles(candidate.title, retrievedTitle);
  return {
    ...candidate,
    retrievedTitle,
    thumbnail: metadata?.thumbnail_url || "",
    channelTitle: metadata?.author_name || "",
    titleMatch,
    result: metadata && titleMatch ? "verified" : "hold",
    verificationReason: !metadata ? "public_oembed_unavailable" : titleMatch ? "official_source_url_video_id_oembed_title_match" : "official_source_url_video_id_title_mismatch",
  };
};
const rows = [];
for (let index = 0; index < input.rows.length; index += 10) rows.push(...await Promise.all(input.rows.slice(index, index + 10).map(verify)));
const summary = rows.reduce((acc, row) => ({ ...acc, [row.result]: (acc[row.result] || 0) + 1, [`${row.source}_${row.result}`]: (acc[`${row.source}_${row.result}`] || 0) + 1 }), { total: rows.length });
writeFileSync(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
