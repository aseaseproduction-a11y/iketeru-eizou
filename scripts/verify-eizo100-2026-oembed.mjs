import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";

const execFileAsync = promisify(execFile);
const inputPath = "/home/ubuntu/iketeru-eizou/analysis/eizo100_2026/candidates.json";
const outputPath = "/home/ubuntu/iketeru-eizou/analysis/eizo100_2026/oembed_verification.json";
const { candidates } = JSON.parse(readFileSync(inputPath, "utf8"));
const targets = candidates.filter((candidate) => candidate.status === "candidate" && ["youtube", "vimeo"].includes(candidate.platform));

const normalizeTitle = (value = "") => value
  .normalize("NFKC")
  .toLowerCase()
  .replaceAll(/\s+/g, "")
  .replaceAll(/[“”"'`‘’「」『』【】\[\]（）()\-–—|｜:：・!！?？,，.。]/g, "");

const getOembedUrl = (candidate) => candidate.platform === "youtube"
  ? `https://www.youtube.com/oembed?url=${encodeURIComponent(candidate.normalizedUrl)}&format=json`
  : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(candidate.normalizedUrl)}`;

async function verify(candidate) {
  try {
    const { stdout } = await execFileAsync("curl", ["--max-time", "15", "-s", getOembedUrl(candidate)], { maxBuffer: 1024 * 1024 });
    const data = JSON.parse(stdout);
    const providerTitle = data.title || "";
    const sourceNormalized = normalizeTitle(candidate.workTitle);
    const providerNormalized = normalizeTitle(providerTitle);
    const titleMatch = sourceNormalized === providerNormalized;
    return {
      ...candidate,
      providerTitle,
      providerAuthor: data.author_name || "",
      oembedUrl: getOembedUrl(candidate),
      titleMatch,
      verified: Boolean(candidate.videoId && candidate.normalizedUrl && titleMatch),
      verificationStatus: titleMatch ? "triple_verified" : "title_mismatch",
    };
  } catch (error) {
    return {
      ...candidate,
      providerTitle: "",
      providerAuthor: "",
      oembedUrl: getOembedUrl(candidate),
      titleMatch: false,
      verified: false,
      verificationStatus: "oembed_unavailable",
      verificationError: error instanceof Error ? error.message : String(error),
    };
  }
}

const concurrency = 12;
const verified = [];
for (let offset = 0; offset < targets.length; offset += concurrency) {
  verified.push(...await Promise.all(targets.slice(offset, offset + concurrency).map(verify)));
  console.log(`Verified ${Math.min(offset + concurrency, targets.length)}/${targets.length}`);
}

const summary = verified.reduce((accumulator, item) => {
  accumulator[item.verificationStatus] = (accumulator[item.verificationStatus] || 0) + 1;
  return accumulator;
}, { total: verified.length });
writeFileSync(outputPath, `${JSON.stringify({ checkedAt: new Date().toISOString(), summary, verified }, null, 2)}\n`);
console.log(JSON.stringify({ summary, outputPath }, null, 2));
