import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const REPAIR = process.argv.includes("--repair");
const INPUT_FILE = "/home/ubuntu/iketeru-eizou/analysis/youtube_works_curation_inputs/batch_inputs.json";
const OUTPUT_DIR = "/home/ubuntu/iketeru-eizou/analysis/production-research";
const OUTPUT_FILE = `${OUTPUT_DIR}/youtube_works_2026_production_role_audit.json`;

const roleLabels = [
  "エグゼクティブ・クリエイティブ・ディレクター", "クリエイティブ・ディレクター", "プロダクション・マネージャー",
  "アカウント・ディレクター", "アニメーション・プロデューサー", "プロデューサー", "ディレクター", "監督",
  "アニメーター", "アニメーション",
].sort((left, right) => right.length - left.length);
const allLabels = [
  ...roleLabels, "カメラマン", "ライトマン", "エディター", "ミキサー", "タレント", "スタイリスト", "ヘアメイク",
  "プランナー/コピーライター", "コピーライター", "プランナー", "キャスティング", "アートディレクター", "制作会社", "広告会社",
].sort((left, right) => right.length - left.length);

function normalize(value) {
  return (value ?? "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, "");
}

function videoIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1);
    if (parsed.hostname.includes("vimeo.com")) return parsed.pathname.match(/\d+/)?.[0] ?? "";
    if (parsed.pathname.startsWith("/shorts/")) return parsed.pathname.split("/")[2] ?? "";
    return parsed.searchParams.get("v") ?? "";
  } catch { return ""; }
}

function canonicalVideoUrl(url) {
  const id = videoIdFromUrl(url);
  if (!id) return "";
  return /vimeo\.com/i.test(url) ? `https://vimeo.com/${id}` : `https://www.youtube.com/watch?v=${id}`;
}

function extractCredits(sourceText) {
  const text = sourceText
    .split(/スタッフリスト|応募動画/)[0]
    .replace(/\s*・\s*/g, "・")
    .replace(/\s+/g, " ")
    .trim();
  const positions = [];
  for (const label of allLabels) {
    let offset = 0;
    while (offset < text.length) {
      const start = text.indexOf(label, offset);
      if (start < 0) break;
      positions.push({ label, start, end: start + label.length });
      offset = start + label.length;
    }
  }
  positions.sort((left, right) => left.start - right.start || right.label.length - left.label.length);
  const nonOverlapping = positions.filter((item, index) => !positions[index - 1] || item.start >= positions[index - 1].end);
  const credits = [];
  for (let index = 0; index < nonOverlapping.length; index += 1) {
    const current = nonOverlapping[index];
    if (!roleLabels.includes(current.label)) continue;
    const next = nonOverlapping[index + 1];
    const name = text.slice(current.end, next?.start ?? text.length)
      .replace(/[→▶].*$/g, "")
      .replace(/^[:：\s]+|[,:：\s]+$/g, "")
      .trim();
    if (!name || name.length > 80 || /https?:\/\//i.test(name) || !/[\p{L}\p{N}]/u.test(name)) continue;
    credits.push(`${current.label}：${name}`);
  }
  return [...new Set(credits)];
}

const inputs = JSON.parse(readFileSync(INPUT_FILE, "utf8"));
const db = await mysql.createConnection(process.env.DATABASE_URL);
const audits = [];
for (const input of inputs) {
  const productionValues = extractCredits(input.officialText);
  const groupAudit = { sourcePages: input.sourcePages, status: productionValues.length ? "verified" : "hold", reason: productionValues.length ? "official_pdf_role_credit_explicit" : "official_pdf_role_credit_not_found", productionValues, videos: [] };
  if (!productionValues.length) { audits.push(groupAudit); continue; }
  for (const expected of input.videos) {
    const [rows] = await db.execute(`SELECT id, title, videoUrl, productions FROM videos WHERE id = ? LIMIT 1`, [expected.id]);
    const current = rows[0];
    const productionVacant = !current?.productions || current.productions === "[]";
    const malformedPriorCredit = typeof current?.productions === "string" && /\s(?:アカウント・|エグゼクティブ・)/.test(current.productions);
    const matched = Boolean(current && current.id === expected.id && canonicalVideoUrl(current.videoUrl) === canonicalVideoUrl(expected.videoUrl) && normalize(current.title) === normalize(expected.title) && (productionVacant || (REPAIR && malformedPriorCredit)));
    if (APPLY && matched) await db.execute(`UPDATE videos SET productions = ? WHERE id = ? AND videoUrl = ? AND title = ? AND (productions IS NULL OR productions = '[]' OR productions LIKE '% アカウント・%' OR productions LIKE '% エグゼクティブ・%')`, [JSON.stringify(productionValues), current.id, current.videoUrl, current.title]);
    groupAudit.videos.push({ id: expected.id, title: expected.title, status: matched ? "verified" : "hold", tripleMatch: matched });
  }
  audits.push(groupAudit);
}
await db.end();
mkdirSync(OUTPUT_DIR, { recursive: true });
const videos = audits.flatMap((audit) => audit.videos);
const summary = { runAt: new Date().toISOString(), apply: APPLY, repair: REPAIR, source: "YouTube Works Awards Japan 2026 official case-study PDF", groups: audits.length, verifiedGroups: audits.filter((audit) => audit.status === "verified").length, tripleMatchedVideos: videos.filter((video) => video.tripleMatch).length, heldVideos: videos.filter((video) => !video.tripleMatch).length, qualityGate: "explicit official staff role + video ID/URL/title triple match + production field missing or malformed prior role boundary", results: audits };
writeFileSync(OUTPUT_FILE, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT_FILE, groups: summary.groups, verifiedGroups: summary.verifiedGroups, tripleMatchedVideos: summary.tripleMatchedVideos, heldVideos: summary.heldVideos, apply: APPLY }));
process.exit(0);
