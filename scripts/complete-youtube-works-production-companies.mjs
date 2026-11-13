import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const INPUT_FILE = "/home/ubuntu/iketeru-eizou/analysis/youtube_works_curation_inputs/batch_inputs.json";
const OUTPUT_DIR = "/home/ubuntu/iketeru-eizou/analysis/production-research";
const OUTPUT_FILE = `${OUTPUT_DIR}/youtube_works_2026_production_company_audit.json`;

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

function extractProductionCompanies(text) {
  const match = text.match(/制作会社\s*(?:・\s*)?(?:関連会社)?\s*([\s\S]{0,280}?)(?=広告フォーマット|広告キャンペーン|広告主のビジネスゴール|背景、|クリエイティブ|YouTube 活用|スタッフリスト|応募動画|$)/);
  if (!match) return [];
  const companies = match[1]
    .replace(/\r/g, "")
    .split(/[／/\n]+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => /(?:株式会社|合同会社|有限会社|Inc\.?|Co\.?|LLC|LTD\.?)/i.test(part))
    .map((part) => part.replace(/^(?:・|関連会社|制作会社)\s*/g, "").trim())
    .filter((part) => part.length <= 90);
  return [...new Set(companies)];
}

const inputs = JSON.parse(readFileSync(INPUT_FILE, "utf8"));
const db = await mysql.createConnection(process.env.DATABASE_URL);
const audits = [];

for (const input of inputs) {
  const companies = extractProductionCompanies(input.officialText);
  const groupAudit = {
    sourcePages: input.sourcePages,
    status: companies.length ? "verified" : "hold",
    reason: companies.length ? "official_pdf_production_company_explicit" : "official_pdf_production_company_not_found",
    productionValues: companies.map((company) => `制作会社・関連会社（公式資料）：${company}`),
    videos: [],
  };
  if (!companies.length) {
    audits.push(groupAudit);
    continue;
  }
  for (const expected of input.videos) {
    const [rows] = await db.execute(`SELECT id, title, videoUrl, productions FROM videos WHERE id = ? LIMIT 1`, [expected.id]);
    const current = rows[0];
    const matched = Boolean(current
      && current.id === expected.id
      && canonicalVideoUrl(current.videoUrl) === canonicalVideoUrl(expected.videoUrl)
      && normalize(current.title) === normalize(expected.title)
      && (!current.productions || current.productions === "[]"));
    if (APPLY && matched) {
      await db.execute(`UPDATE videos SET productions = ? WHERE id = ? AND videoUrl = ? AND title = ? AND (productions IS NULL OR productions = '[]')`, [JSON.stringify(groupAudit.productionValues), current.id, current.videoUrl, current.title]);
    }
    groupAudit.videos.push({ id: expected.id, title: expected.title, status: matched ? "verified" : "hold", tripleMatch: matched });
  }
  audits.push(groupAudit);
}

await db.end();
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
  qualityGate: "explicit official production-company text + video ID/URL/title triple match + production field still missing",
  results: audits,
};
writeFileSync(OUTPUT_FILE, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT_FILE, groups: summary.groups, verifiedGroups: summary.verifiedGroups, tripleMatchedVideos: summary.tripleMatchedVideos, heldVideos: summary.heldVideos, apply: APPLY }));
process.exit(0);
