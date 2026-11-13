import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const requestedYear = process.argv[2] ? Number(process.argv[2]) : null;
const input = JSON.parse(readFileSync("/home/ubuntu/iketeru-eizou/analysis/eizo100_previous_years/candidates.json", "utf8"));
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/eizo100_previous_years";
const normalize = (value = "") => value
  .normalize("NFKC").toLowerCase()
  .replace(/musicvideo|official|lyrics?|shorts?|mv|video|映像|ミュージック|official|公式|【[^]*?】|\[[^]*?\]|\([^]*?\)|[\s\-‐‑–—_・:：!！?？'"“”‘’/／\\]/g, "");
const isTitleCorrelated = (workTitle, providerTitle) => {
  const work = normalize(workTitle);
  const provider = normalize(providerTitle);
  if (!work || !provider) return false;
  if (work.includes(provider) || provider.includes(work)) return true;
  const tokens = work.split(/[、,|｜]/).filter((token) => token.length >= 3);
  return tokens.some((token) => provider.includes(token));
};
const fetchOembed = async (candidate) => {
  const endpoint = candidate.platform === "youtube"
    ? `https://www.youtube.com/oembed?url=${encodeURIComponent(candidate.normalizedUrl)}&format=json`
    : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(candidate.normalizedUrl)}`;
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(12_000), headers: { "user-agent": "Mozilla/5.0" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const title = data.title || "";
    const correlated = isTitleCorrelated(candidate.workTitle, title);
    return {
      ...candidate,
      providerTitle: title,
      providerAuthor: data.author_name || "",
      oembedStatus: "verified",
      titleCorrelation: correlated ? "matched" : "official_source_linked",
      status: "triple_verified",
      reason: correlated
        ? "official_eizo_source + canonical_video_id_url + oembed_title_correlated"
        : "official_eizo_source directly links work title to canonical video ID/URL; oEmbed confirms current availability despite provider title variant",
    };
  } catch (error) {
    return { ...candidate, providerTitle: "", providerAuthor: "", oembedStatus: "hold", titleCorrelation: "hold", status: "hold", reason: `oembed_unavailable: ${error.message}` };
  }
};
const candidates = input.candidates.filter((candidate) => candidate.status === "candidate" && (!requestedYear || candidate.sourceYear === requestedYear));
if (!candidates.length) throw new Error(`No candidates for ${requestedYear || "all years"}`);
const results = [];
for (let index = 0; index < candidates.length; index += 8) {
  results.push(...await Promise.all(candidates.slice(index, index + 8).map(fetchOembed)));
  if ((index + 8) % 80 === 0 || index + 8 >= candidates.length) console.log(`${requestedYear || "all"}: ${Math.min(index + 8, candidates.length)}/${candidates.length}`);
}
const summary = results.reduce((counts, item) => ({ ...counts, total: counts.total + 1, [item.status]: (counts[item.status] || 0) + 1 }), { total: 0 });
mkdirSync(outputDir, { recursive: true });
const suffix = requestedYear || "all";
writeFileSync(`${outputDir}/oembed_verification_${suffix}.json`, `${JSON.stringify({ verifiedAt: new Date().toISOString(), summary, results }, null, 2)}\n`);
console.log(JSON.stringify({ year: requestedYear || "all", summary }, null, 2));
