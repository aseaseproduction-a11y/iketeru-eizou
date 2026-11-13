import { readFileSync, writeFileSync } from "node:fs";

const input = JSON.parse(readFileSync("/home/ubuntu/iketeru-eizou/analysis/eizo100_2026/hold_recheck_aggregate.json", "utf8"));
const timeoutFetch = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};
const getOembed = async (candidate) => {
  const endpoint = candidate.platform === "youtube"
    ? `https://www.youtube.com/oembed?url=${encodeURIComponent(candidate.normalizedUrl)}&format=json`
    : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(candidate.normalizedUrl)}`;
  try {
    const data = await timeoutFetch(endpoint);
    return { ...candidate, oembedStatus: "verified", oembedTitle: data.title || "", oembedAuthor: data.author_name || "" };
  } catch (error) {
    return { ...candidate, oembedStatus: "hold", oembedTitle: "", oembedAuthor: "", oembedError: error.message };
  }
};
const verified = [];
for (let index = 0; index < input.candidates.length; index += 4) {
  verified.push(...await Promise.all(input.candidates.slice(index, index + 4).map(getOembed)));
}
const eligible = verified.filter((item) => item.oembedStatus === "verified");
writeFileSync("/home/ubuntu/iketeru-eizou/analysis/eizo100_2026/hold_recheck_oembed.json", `${JSON.stringify({ generatedAt: new Date().toISOString(), summary: { proposed: verified.length, oembedVerified: eligible.length, hold: verified.length - eligible.length }, verified, eligible }, null, 2)}\n`);
console.log(JSON.stringify({ proposed: verified.length, oembedVerified: eligible.length, hold: verified.length - eligible.length }, null, 2));
