import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const pdfPath = process.argv[2];
const outputDir = process.argv[3] || "/home/ubuntu/google-pdf-import";

if (!pdfPath) {
  console.error("Usage: node scripts/extract-google-pdf-works.mjs <pdf-path> [output-dir]");
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });
const rawTextPath = path.join(outputDir, "source_raw.txt");
execFileSync("pdftotext", ["-raw", pdfPath, rawTextPath], { stdio: "inherit" });

const sourceText = readFileSync(rawTextPath, "utf8");
const pages = sourceText.split("\f");
const urlPattern = /https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|vimeo\.com)[A-Za-z0-9_?=&./-]+/gi;

function cleanUrl(url) {
  return url.replace(/[),.;:]+$/g, "").replace(/\?si=[^&#]+/i, "");
}

function getPlatform(url) {
  return /vimeo\.com/i.test(url) ? "vimeo" : "youtube";
}

function getVideoId(url, platform) {
  try {
    const parsed = new URL(url);
    if (platform === "vimeo") {
      return parsed.pathname.split("/").filter(Boolean).at(-1) || "";
    }
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1);
    if (parsed.pathname.startsWith("/shorts/")) return parsed.pathname.split("/")[2] || "";
    return parsed.searchParams.get("v") || "";
  } catch {
    return "";
  }
}

function findContext(pageText, compactIndex) {
  const compactPrefix = pageText.replace(/\s+/g, "").slice(0, compactIndex);
  const approximateTextIndex = Math.max(0, Math.floor(compactPrefix.length * 1.2) - 450);
  return pageText.slice(approximateTextIndex, approximateTextIndex + 900).replace(/\s+/g, " ").trim();
}

const found = [];
for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
  const pageText = pages[pageIndex];
  const compact = pageText.replace(/\s+/g, "");
  for (const match of compact.matchAll(urlPattern)) {
    const videoUrl = cleanUrl(match[0]);
    const platform = getPlatform(videoUrl);
    const videoId = getVideoId(videoUrl, platform);
    if (!videoId) continue;
    found.push({
      pdfPage: pageIndex + 1,
      platform,
      videoId,
      videoUrl,
      context: findContext(pageText, match.index ?? 0),
    });
  }
}

const worksByKey = new Map();
for (const work of found) {
  const key = `${work.platform}:${work.videoId}`;
  const existing = worksByKey.get(key);
  if (existing) {
    existing.pdfPages.push(work.pdfPage);
    existing.contexts.push(work.context);
  } else {
    worksByKey.set(key, {
      ...work,
      pdfPages: [work.pdfPage],
      contexts: [work.context],
      title: "",
      channelTitle: "",
      thumbnail: "",
      status: "pending_metadata",
    });
  }
}

const works = [...worksByKey.values()];

async function getOembed(work) {
  const endpoint = work.platform === "youtube"
    ? `https://www.youtube.com/oembed?url=${encodeURIComponent(work.videoUrl)}&format=json`
    : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(work.videoUrl)}`;
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return {
      ...work,
      title: data.title || "",
      channelTitle: data.author_name || "",
      thumbnail: data.thumbnail_url || "",
      status: data.title ? "ready" : "metadata_missing",
    };
  } catch (error) {
    return { ...work, status: `metadata_error:${error instanceof Error ? error.message : "unknown"}` };
  }
}

const enriched = [];
const concurrency = 6;
for (let index = 0; index < works.length; index += concurrency) {
  const chunk = works.slice(index, index + concurrency);
  enriched.push(...await Promise.all(chunk.map(getOembed)));
}

const output = {
  sourcePdf: pdfPath,
  sourceLabel: "YouTube Works Awards Japan 2026 Case Study",
  extractedAt: new Date().toISOString(),
  counts: {
    rawOccurrences: found.length,
    uniqueWorks: enriched.length,
    ready: enriched.filter((work) => work.status === "ready").length,
    unresolved: enriched.filter((work) => work.status !== "ready").length,
  },
  works: enriched,
};

writeFileSync(path.join(outputDir, "works_extracted.json"), JSON.stringify(output, null, 2));
const markdownRows = enriched.map((work) => `| ${work.platform} | ${work.videoId} | ${work.title || "（要確認）"} | ${work.pdfPages.join(", ")} | ${work.status} | ${work.videoUrl} |`);
writeFileSync(
  path.join(outputDir, "works_extracted.md"),
  `# PDF掲載作品の抽出結果\n\n- 資料: ${output.sourceLabel}\n- 抽出日時: ${output.extractedAt}\n- URL出現数: ${output.counts.rawOccurrences}\n- ユニーク作品数: ${output.counts.uniqueWorks}\n- 登録候補（メタデータ取得済み）: ${output.counts.ready}\n- 要確認: ${output.counts.unresolved}\n\n| Platform | Video ID | Title | PDF page | Status | URL |\n|---|---|---|---|---|---|\n${markdownRows.join("\n")}\n`,
);

console.log(JSON.stringify(output.counts, null, 2));
