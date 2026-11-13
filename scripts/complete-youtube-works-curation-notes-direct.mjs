import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const INPUT_FILE = "/home/ubuntu/iketeru-eizou/analysis/youtube_works_curation_inputs/batch_inputs.json";
const OUTPUT_DIR = "/home/ubuntu/iketeru-eizou/analysis/production-research";
const OUTPUT_FILE = `${OUTPUT_DIR}/youtube_works_2026_direct_curation_note_audit.json`;
const OFFICIAL_SOURCE_URL = "https://services.google.com/fh/files/events/ytwaj_2026_casestudy.pdf";

function normalize(value) {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}_]+/gu, "");
}

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

function compact(text) {
  return text
    .replace(/\r/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*([、。！？：])/g, "$1")
    .trim();
}

function sentenceAfter(text, labels) {
  const positions = labels.map((label) => text.indexOf(label)).filter((index) => index >= 0);
  if (!positions.length) return "";
  const start = Math.min(...positions);
  const window = text.slice(start, start + 620);
  const end = window.search(/(?:スタッフリスト|応募動画|広告フォーマット|キャンペーン結果ハイライト|\n\s*\n)/);
  const candidate = compact(window.slice(0, Math.min(end >= 0 ? end : 620, 280)));
  if (candidate.length < 40 || candidate.length > 280) return "";
  return candidate;
}

function deriveNote(officialText) {
  const text = compact(officialText);
  const purpose = sentenceAfter(text, ["広告主のビジネスゴール", "ビジネスゴール", "目的"]);
  const background = sentenceAfter(text, ["背景、", "背景", "課題"]);
  if (!purpose || !background) return null;
  const award = text.match(/(?:Grand Prix|Gold|Silver|Bronze|Finalist)\s*[\s\S]{0,180}?YouTube Works Awards Japan 2026/i)?.[0];
  const evaluation = award
    ? `YouTube Works Awards Japan 2026の公式事例集に、${compact(award).slice(0, 180)}として掲載されている。`
    : "YouTube Works Awards Japan 2026の公式事例集に掲載されている。";
  return { purpose, background, evaluation };
}

const inputs = JSON.parse(readFileSync(INPUT_FILE, "utf8"));
const connection = await mysql.createConnection(process.env.DATABASE_URL);
const audits = [];

for (const input of inputs) {
  const note = deriveNote(input.officialText);
  const groupAudit = {
    sourcePages: input.sourcePages,
    status: note ? "verified" : "hold",
    reason: note ? "official_pdf_explicit_purpose_and_background" : "explicit_purpose_or_background_not_found",
    evidence: note ? { purpose: note.purpose, background: note.background } : null,
    videos: [],
  };
  if (!note) {
    audits.push(groupAudit);
    continue;
  }
  const curationNote = JSON.stringify({ ...note, sourceUrls: [OFFICIAL_SOURCE_URL] });
  for (const expected of input.videos) {
    const [rows] = await connection.execute(`SELECT id, title, videoUrl, curationNote FROM videos WHERE id = ? LIMIT 1`, [expected.id]);
    const current = rows[0];
    const matched = Boolean(current
      && current.id === expected.id
      && canonicalVideoUrl(current.videoUrl) === canonicalVideoUrl(expected.videoUrl)
      && normalize(current.title) === normalize(expected.title)
      && (!current.curationNote || current.curationNote === "{}"));
    if (APPLY && matched) {
      await connection.execute(`UPDATE videos SET curationNote = ? WHERE id = ? AND videoUrl = ? AND title = ? AND (curationNote IS NULL OR curationNote = '' OR curationNote = '{}')`, [curationNote, current.id, current.videoUrl, current.title]);
    }
    groupAudit.videos.push({ id: expected.id, title: expected.title, status: matched ? "verified" : "hold", tripleMatch: matched });
  }
  audits.push(groupAudit);
}

await connection.end();
mkdirSync(OUTPUT_DIR, { recursive: true });
const videos = audits.flatMap((audit) => audit.videos);
const summary = {
  runAt: new Date().toISOString(),
  apply: APPLY,
  source: "YouTube Works Awards Japan 2026 official case-study PDF",
  groups: audits.length,
  verifiedGroups: audits.filter((audit) => audit.status === "verified").length,
  tripleMatchedVideos: videos.filter((video) => video.tripleMatch).length,
  heldVideos: videos.filter((video) => !video.tripleMatch).length,
  qualityGate: "official source text contains explicit purpose and background snippets + video ID/URL/title triple match",
  results: audits,
};
writeFileSync(OUTPUT_FILE, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT_FILE, groups: summary.groups, verifiedGroups: summary.verifiedGroups, tripleMatchedVideos: summary.tripleMatchedVideos, heldVideos: summary.heldVideos, apply: APPLY }));
process.exit(0);
