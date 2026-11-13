import { readFileSync, writeFileSync } from "node:fs";

const canonical = (rawUrl = "") => {
  try {
    const url = new URL(rawUrl);
    if (/youtu\.be|youtube\.com/i.test(url.hostname)) {
      const id = url.hostname.includes("youtu.be") ? url.pathname.split("/").filter(Boolean).at(-1) : url.pathname.startsWith("/shorts/") ? url.pathname.split("/")[2] : url.searchParams.get("v");
      return id ? { platform: "youtube", id, url: `https://www.youtube.com/watch?v=${id}` } : null;
    }
    if (/vimeo\.com/i.test(url.hostname)) {
      const id = url.pathname.split("/").filter(Boolean).at(-1);
      return id ? { platform: "vimeo", id, url: `https://vimeo.com/${id}` } : null;
    }
  } catch { /* invalid URL */ }
  return null;
};
const input = JSON.parse(readFileSync("/home/ubuntu/iketeru-eizou/analysis/eizo100_all_years/official_source_rechecks/aggregated_results.json", "utf8"));
const candidates = input.rows.filter((row) => row.result === "verified");
const results = [];
for (const row of candidates) {
  const video = canonical(row.videoUrl);
  const idUrlMatch = Boolean(video && video.platform === row.platform && video.id === String(row.videoId));
  let oembedTitle = "";
  let oembedStatus = "";
  if (idUrlMatch) {
    const endpoint = video.platform === "youtube" ? `https://www.youtube.com/oembed?url=${encodeURIComponent(video.url)}&format=json` : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(video.url)}`;
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      oembedTitle = String(payload.title || "").trim();
      oembedStatus = oembedTitle ? "available" : "missing_title";
    } catch (error) {
      oembedStatus = `unavailable: ${error.message}`;
    }
  }
  const officialSourceMatch = Array.isArray(row.officialSourceUrls) && row.officialSourceUrls.includes(row.sourceUrl) && row.officialSourceUrls.length >= 2;
  const result = idUrlMatch && officialSourceMatch && oembedStatus === "available" ? "triple_verified" : "hold";
  results.push({ ...row, canonicalVideoUrl: video?.url || "", oembedTitle, oembedStatus, idUrlMatch, officialSourceMatch, result });
}
const summary = results.reduce((accumulator, row) => ({ ...accumulator, [row.result]: (accumulator[row.result] || 0) + 1 }), { total: results.length });
writeFileSync("/home/ubuntu/iketeru-eizou/analysis/eizo100_all_years/official_source_rechecks/oembed_verification.json", `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, results }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
