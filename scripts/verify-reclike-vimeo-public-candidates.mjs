import { readFile, writeFile } from "node:fs/promises";

const inputPath = process.env.CANDIDATE_INPUT_PATH || new URL("../analysis/site_imports/public_sources_batch_20260819/reclike_vimeo_public_candidates.json", import.meta.url);
const outputPath = process.env.VERIFICATION_OUTPUT_PATH || new URL("../analysis/site_imports/public_sources_batch_20260819/reclike_vimeo_public_verification.json", import.meta.url);
const limit = Number(process.env.LIMIT || 0);

function normalizeTitle(value) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}\s_]+/gu, "")
    .trim();
}

function titleComparison(sourceTitle, retrievedTitle) {
  const source = normalizeTitle(sourceTitle);
  const retrieved = normalizeTitle(retrievedTitle);
  if (!source || !retrieved) return { titleMatch: false, titleMatchMethod: "missing_title" };
  if (source === retrieved) return { titleMatch: true, titleMatchMethod: "normalized_exact" };
  if (source.length >= 12 && retrieved.includes(source)) return { titleMatch: true, titleMatchMethod: "source_title_contained" };
  if (retrieved.length >= 12 && source.includes(retrieved)) return { titleMatch: true, titleMatchMethod: "retrieved_title_contained" };
  return { titleMatch: false, titleMatchMethod: "title_mismatch" };
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; IketeruEizouCatalog/1.0; +https://iketeruvid-mzehlcez.manus.space)" },
      signal: AbortSignal.timeout(20_000),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function verify(candidate) {
  if (candidate.platform !== "youtube" && candidate.platform !== "vimeo") {
    return {
      ...candidate,
      retrievedTitle: "",
      thumbnail: "",
      channelTitle: "",
      publicOembed: false,
      videoIdUrlMatch: false,
      titleMatch: false,
      titleMatchMethod: "unsupported_platform",
      result: "hold",
      verificationReason: "platform_requires_separate_public_metadata_verification",
    };
  }
  const endpoint = candidate.platform === "youtube"
    ? `https://www.youtube.com/oembed?url=${encodeURIComponent(candidate.videoUrl)}&format=json`
    : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(candidate.videoUrl)}`;
  const metadata = await fetchJson(endpoint);
  const retrievedTitle = metadata?.title || "";
  const comparison = titleComparison(candidate.sourceTitle, retrievedTitle);
  const publicOembed = Boolean(metadata && retrievedTitle);
  const videoIdUrlMatch = candidate.platform === "youtube"
    ? candidate.videoUrl === `https://www.youtube.com/watch?v=${candidate.id}`
    : candidate.videoUrl === `https://vimeo.com/${candidate.id}`;
  const result = publicOembed && videoIdUrlMatch && comparison.titleMatch ? "verified" : "hold";
  const verificationReason = result === "verified"
    ? "public_oembed_and_source_title_video_id_canonical_url_verified"
    : !publicOembed
      ? "public_oembed_unavailable"
      : !videoIdUrlMatch
        ? "video_id_canonical_url_mismatch"
        : "source_title_oembed_title_mismatch";

  return {
    ...candidate,
    retrievedTitle,
    thumbnail: metadata?.thumbnail_url || "",
    channelTitle: metadata?.author_name || "",
    publicOembed,
    videoIdUrlMatch,
    ...comparison,
    result,
    verificationReason,
  };
}

const input = JSON.parse(await readFile(inputPath, "utf8"));
const candidates = limit > 0 ? input.rows.slice(0, limit) : input.rows;
const rows = [];
for (let index = 0; index < candidates.length; index += 10) {
  rows.push(...await Promise.all(candidates.slice(index, index + 10).map(verify)));
}

const summary = rows.reduce((acc, row) => {
  acc.total += 1;
  acc[row.result] = (acc[row.result] || 0) + 1;
  acc[`${row.platform}_${row.result}`] = (acc[`${row.platform}_${row.result}`] || 0) + 1;
  return acc;
}, { total: 0, verified: 0, hold: 0 });

await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), input: String(inputPath), summary, rows }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
