import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const INPUT_FILE = "/home/ubuntu/iketeru-eizou/analysis/youtube_works_curation_inputs/batch_inputs.json";
const RESULT_FILE = "/home/ubuntu/iketeru-eizou/analysis/youtube_works_curation_inputs/batch_results.jsonl";
const OUTPUT_DIR = "/home/ubuntu/iketeru-eizou/analysis/production-research";
const OUTPUT_FILE = `${OUTPUT_DIR}/youtube_works_2026_curation_note_audit.json`;
const OFFICIAL_SOURCE_URL = "https://services.google.com/fh/files/events/ytwaj_2026_casestudy.pdf";

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

const inputs = JSON.parse(readFileSync(INPUT_FILE, "utf8"));
const results = readFileSync(RESULT_FILE, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const connection = await mysql.createConnection(process.env.DATABASE_URL);
const audits = [];

for (const result of results) {
  const input = inputs[result.index];
  if (!input || result.error || !result.output) {
    audits.push({ index: result.index, status: "hold", reason: "missing_batch_input_or_model_error", videos: [] });
    continue;
  }
  let note;
  try {
    note = JSON.parse(result.output);
  } catch {
    audits.push({ index: result.index, status: "hold", reason: "invalid_model_json", videos: [] });
    continue;
  }
  const noteComplete = note.confidence === "official"
    && [note.purpose, note.background, note.evaluation, note.evidence].every((value) => typeof value === "string" && value.trim().length >= 12);
  const groupAudit = { index: result.index, status: noteComplete ? "verified" : "hold", reason: noteComplete ? "official_pdf_evidence_complete" : "incomplete_or_nonofficial_evidence", videos: [] };
  if (!noteComplete) {
    audits.push(groupAudit);
    continue;
  }
  const curationNote = JSON.stringify({
    purpose: note.purpose.trim(),
    background: note.background.trim(),
    evaluation: note.evaluation.trim(),
    sourceUrls: [OFFICIAL_SOURCE_URL],
  });
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
const flatVideos = audits.flatMap((audit) => audit.videos);
const summary = {
  runAt: new Date().toISOString(),
  apply: APPLY,
  source: "YouTube Works Awards Japan 2026 official case-study PDF",
  groups: audits.length,
  verifiedGroups: audits.filter((audit) => audit.status === "verified").length,
  tripleMatchedVideos: flatVideos.filter((video) => video.tripleMatch).length,
  heldVideos: flatVideos.filter((video) => !video.tripleMatch).length,
  qualityGate: "official evidence excerpt + nonempty purpose/background/evaluation + video ID/URL/title triple match",
  results: audits,
};
writeFileSync(OUTPUT_FILE, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT_FILE, groups: summary.groups, verifiedGroups: summary.verifiedGroups, tripleMatchedVideos: summary.tripleMatchedVideos, heldVideos: summary.heldVideos, apply: APPLY }));
