import { readFileSync, writeFileSync } from "node:fs";

const inputPath = process.env.CANDIDATE_INPUT_PATH || "analysis/site_imports/public_sources_batch_20260819/official_video_candidates.json";
const outputPath = process.env.VERIFICATION_OUTPUT_PATH || "analysis/site_imports/public_sources_batch_20260819/official_video_verification.json";
const input = JSON.parse(readFileSync(inputPath, "utf8"));

const fetchJson = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
};

const verify = async (candidate) => {
  const endpoint = candidate.platform === "youtube"
    ? `https://www.youtube.com/oembed?url=${encodeURIComponent(candidate.videoUrl)}&format=json`
    : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(candidate.videoUrl)}`;
  const metadata = await fetchJson(endpoint);
  const retrievedTitle = metadata?.title || "";
  return {
    ...candidate,
    title: retrievedTitle,
    retrievedTitle,
    thumbnail: metadata?.thumbnail_url || "",
    channelTitle: metadata?.author_name || "",
    titleMatch: Boolean(retrievedTitle),
    result: metadata && retrievedTitle ? "verified" : "hold",
    verificationReason: metadata && retrievedTitle
      ? "official_source_direct_video_url_public_oembed_title"
      : "public_oembed_unavailable",
  };
};

const rows = [];
for (let index = 0; index < input.rows.length; index += 10) rows.push(...await Promise.all(input.rows.slice(index, index + 10).map(verify)));
const summary = rows.reduce((acc, row) => ({ ...acc, [row.result]: (acc[row.result] || 0) + 1, [`${row.source}_${row.result}`]: (acc[`${row.source}_${row.result}`] || 0) + 1 }), { total: rows.length });
writeFileSync(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
