import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const inputPath = process.argv[2] || "/home/ubuntu/research_award_winners.json";
const outputDir = process.argv[3] || "/home/ubuntu/award-winners-import";
mkdirSync(outputDir, { recursive: true });

function parseWinnerList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  const trimmed = value.trim().replace(/^```json\s*/i, "").replace(/```$/i, "");
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function canonicalVideo(url) {
  try {
    const parsed = new URL(url);
    if (/youtu\.be|youtube\.com/i.test(parsed.hostname)) {
      const id = parsed.hostname.includes("youtu.be")
        ? parsed.pathname.split("/").filter(Boolean).at(-1)
        : parsed.pathname.startsWith("/shorts/")
          ? parsed.pathname.split("/")[2]
          : parsed.searchParams.get("v");
      return id ? { platform: "youtube", id, url: `https://www.youtube.com/watch?v=${id}` } : null;
    }
    if (/vimeo\.com/i.test(parsed.hostname)) {
      const id = parsed.pathname.split("/").filter(Boolean).at(-1);
      return id ? { platform: "vimeo", id, url: `https://vimeo.com/${id}` } : null;
    }
  } catch {
    return null;
  }
  return null;
}

async function getVideoMetadata(video) {
  const endpoint = video.platform === "youtube"
    ? `https://www.youtube.com/oembed?url=${encodeURIComponent(video.url)}&format=json`
    : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(video.url)}`;
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return null;
    const data = await response.json();
    return { title: data.title || "", channelTitle: data.author_name || "", thumbnail: data.thumbnail_url || "" };
  } catch {
    return null;
  }
}

const raw = JSON.parse(readFileSync(inputPath, "utf8"));
const extracted = [];
const parseErrors = [];
for (const result of raw.results || []) {
  const output = result.output || {};
  const winners = parseWinnerList(output.awards_json);
  if (!winners.length) parseErrors.push({ award: result.input, reason: "awards_json_parse_failed_or_empty" });
  for (const winner of winners) {
    extracted.push({
      awardName: winner.award_name || output.award_name || result.input || "",
      awardYear: String(winner.award_year || ""),
      awardCategory: winner.award_category || "",
      workTitle: winner.work_title || "",
      creatorOrBrand: winner.creator_or_brand || "",
      officialSourceUrl: winner.official_source_url || output.official_awards_url || "",
      videoUrl: winner.video_url || "",
      videoUrlBasis: winner.video_url_basis || "unverified",
    });
  }
}

const unique = new Map();
for (const item of extracted) {
  const video = canonicalVideo(item.videoUrl);
  const key = video ? `${video.platform}:${video.id}` : `${item.awardName}|${item.awardYear}|${item.workTitle}`;
  const awardEntry = { name: item.awardName, year: item.awardYear, category: item.awardCategory, sourceUrl: item.officialSourceUrl };
  const existing = unique.get(key);
  if (existing) {
    const alreadyRecorded = existing.awards.some((award) => award.name === awardEntry.name && award.year === awardEntry.year && award.category === awardEntry.category);
    if (!alreadyRecorded) existing.awards.push(awardEntry);
  } else {
    unique.set(key, { ...item, video, awards: [awardEntry] });
  }
}

const candidates = [];
const hold = [];
const items = [...unique.values()];
const concurrency = 8;
for (let index = 0; index < items.length; index += concurrency) {
  const batch = items.slice(index, index + concurrency);
  const enriched = await Promise.all(batch.map(async (item) => ({ ...item, metadata: item.video ? await getVideoMetadata(item.video) : null })));
  for (const item of enriched) {
    const isOfficialSource = /^https:\/\//.test(item.officialSourceUrl);
    const isSupportedVideo = Boolean(item.video && item.metadata?.title);
    const isAwardDataComplete = Boolean(item.awardName && item.awardYear && item.awardCategory && item.workTitle);
    const eligible = isOfficialSource && isSupportedVideo && isAwardDataComplete && item.videoUrlBasis !== "unverified";
    const record = {
      ...item,
      title: item.metadata?.title || "",
      channelTitle: item.metadata?.channelTitle || "",
      thumbnail: item.metadata?.thumbnail || "",
      status: eligible ? "candidate" : "hold",
      holdReason: eligible ? "" : [
        !isOfficialSource ? "official_source_missing" : "",
        !isSupportedVideo ? "video_metadata_unavailable" : "",
        !isAwardDataComplete ? "award_metadata_incomplete" : "",
        item.videoUrlBasis === "unverified" ? "video_url_unverified" : "",
      ].filter(Boolean).join(","),
    };
    (eligible ? candidates : hold).push(record);
  }
}

const output = {
  preparedAt: new Date().toISOString(),
  counts: { raw: extracted.length, unique: items.length, candidates: candidates.length, hold: hold.length, parseErrors: parseErrors.length },
  candidates,
  hold,
  parseErrors,
};
writeFileSync(path.join(outputDir, "candidates.json"), JSON.stringify(output, null, 2));
const candidateRows = candidates.map((item) => `| ${item.awardName} | ${item.awardYear} | ${item.awardCategory} | ${item.workTitle} | ${item.video.platform}:${item.video.id} | ${item.videoUrlBasis} | ${item.officialSourceUrl} |`);
const holdRows = hold.map((item) => `| ${item.awardName} | ${item.awardYear} | ${item.workTitle} | ${item.holdReason} | ${item.videoUrl || ""} |`);
writeFileSync(
  path.join(outputDir, "candidates.md"),
  `# アワード受賞作の登録候補\n\n- 作成日時: ${output.preparedAt}\n- 件数: ${JSON.stringify(output.counts)}\n\n## 登録候補\n\n| Award | Year | Category | Work | Video | Video URL basis | Official source |\n|---|---|---|---|---|---|---|\n${candidateRows.join("\n")}\n\n## 保留\n\n| Award | Year | Work | Reason | Video URL |\n|---|---|---|---|---|\n${holdRows.join("\n")}\n`,
);
console.log(JSON.stringify(output.counts, null, 2));
