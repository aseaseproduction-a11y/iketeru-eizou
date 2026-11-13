import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const WORKS_FILE = "/home/ubuntu/google-pdf-import/works_extracted.json";
const PDF_TEXT_FILE = "/home/ubuntu/google-pdf-import/source_raw.txt";
const OUTPUT_DIR = "/home/ubuntu/iketeru-eizou/analysis/youtube_works_curation_inputs";

function videoIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1);
    if (parsed.hostname.includes("vimeo.com")) return parsed.pathname.match(/\d+/)?.[0] ?? "";
    if (parsed.pathname.startsWith("/shorts/")) return parsed.pathname.split("/")[2] ?? "";
    return parsed.searchParams.get("v") ?? "";
  } catch {
    return "";
  }
}

function canonicalVideoUrl(url) {
  const id = videoIdFromUrl(url);
  if (!id) return "";
  return /vimeo\.com/i.test(url) ? `https://vimeo.com/${id}` : `https://www.youtube.com/watch?v=${id}`;
}

function normalize(value) {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}_]+/gu, "");
}

function titleTerms(title) {
  const compact = normalize(title);
  const terms = new Set();
  for (let index = 0; index <= compact.length - 4; index += 2) {
    terms.add(compact.slice(index, index + 4));
  }
  return [...terms].filter((term) => /[\p{L}\p{N}]/u.test(term));
}

const works = JSON.parse(readFileSync(WORKS_FILE, "utf8")).works;
const workById = new Map(works.map((work) => [work.videoId, work]));
const pages = readFileSync(PDF_TEXT_FILE, "utf8").split("\f");

function campaignTextRange(staffPage, titles) {
  const terms = titles.flatMap(titleTerms);
  const candidatePages = [];
  for (let index = Math.max(0, staffPage - 8); index < staffPage; index += 1) {
    const pageText = normalize(pages[index]);
    const score = terms.filter((term) => pageText.includes(term)).length;
    if (score >= 2) candidatePages.push(index);
  }
  const clusters = candidatePages.reduce((items, page) => {
    const latest = items.at(-1);
    if (!latest || page > latest.at(-1) + 1) items.push([page]);
    else latest.push(page);
    return items;
  }, []);
  const finalCluster = clusters.at(-1) ?? [];
  const start = finalCluster.length ? finalCluster[0] : Math.max(0, staffPage - 3);
  return { start, end: staffPage };
}

const db = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await db.execute(`
  SELECT id, title, videoUrl
  FROM videos
  WHERE source = 'youtube_works_awards_2026'
    AND (curationNote IS NULL OR curationNote = '' OR curationNote = '{}')
  ORDER BY id
`);
await db.end();

const groups = new Map();
const holds = [];
for (const video of rows) {
  const work = workById.get(video.id);
  const page = work?.pdfPages?.[0];
  const matched = Boolean(
    work
    && page
    && video.id === work.videoId
    && canonicalVideoUrl(video.videoUrl) === canonicalVideoUrl(work.videoUrl)
    && normalize(video.title) === normalize(work.title),
  );
  if (!matched) {
    holds.push({ id: video.id, title: video.title, videoUrl: video.videoUrl, reason: "source_pdf_title_url_id_not_matched" });
    continue;
  }
  if (!groups.has(page)) groups.set(page, []);
  groups.get(page).push({ id: video.id, title: video.title, videoUrl: video.videoUrl, sourceTitle: work.title });
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const manifestGroups = [...groups.entries()].sort(([left], [right]) => left - right).map(([page, videos], index) => {
  const range = campaignTextRange(page, videos.map((video) => video.sourceTitle));
  const input = {
    source: "YouTube Works Awards Japan 2026 official case-study PDF",
    sourcePdf: "/home/ubuntu/google-pdf-import/ytwaj_2026_casestudy.pdf",
    sourcePages: Array.from({ length: range.end - range.start }, (_, offset) => range.start + offset + 1),
    officialText: pages.slice(range.start, range.end).join("\n\n"),
    videos: videos.map(({ sourceTitle, ...video }) => video),
    verification: "Each listed video passed exact video ID, normalized canonical URL, and normalized title matching against the official PDF extraction.",
  };
  const path = `${OUTPUT_DIR}/group-${String(index + 1).padStart(2, "0")}.json`;
  writeFileSync(path, `${JSON.stringify(input, null, 2)}\n`);
  return { group: index + 1, sourcePage: page, path, videoCount: videos.length };
});

const manifest = {
  generatedAt: new Date().toISOString(),
  source: "YouTube Works Awards Japan 2026 official case-study PDF",
  totalCandidates: rows.length,
  matchedVideos: manifestGroups.reduce((sum, group) => sum + group.videoCount, 0),
  heldVideos: holds.length,
  tripleMatch: "video ID + normalized canonical video URL + normalized title",
  groups: manifestGroups,
  holds,
};
writeFileSync(`${OUTPUT_DIR}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
const batchInputs = manifestGroups.map((group) => JSON.parse(readFileSync(group.path, "utf8")));
writeFileSync(`${OUTPUT_DIR}/batch_inputs.json`, `${JSON.stringify(batchInputs, null, 2)}\n`);
console.log(JSON.stringify({ totalCandidates: manifest.totalCandidates, matchedVideos: manifest.matchedVideos, heldVideos: manifest.heldVideos, groups: manifest.groups.length }));
