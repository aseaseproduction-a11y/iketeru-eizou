import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const SOURCE_FILE = "/home/ubuntu/google-pdf-import/works_extracted.json";
const OUTPUT_DIR = "/home/ubuntu/iketeru-eizou/analysis/production-research";
const OUTPUT_FILE = `${OUTPUT_DIR}/youtube_works_2026_official_credit_audit.json`;

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

function normalizePdfText(value) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s*・\s*/g, "・")
    .replace(/\s*\/\s*/g, "/")
    .trim();
}

const allLabels = [
  "アニメーション・プロデューサー", "プロダクション・マネージャー", "クリエイティブ・ディレクター",
  "コミュニケーション・プランナー", "ビジネス・プロデューサー", "ビジネス・ディレクター",
  "アカウント・マネージャー", "プロデューサー", "ディレクター", "アートディレクター",
  "コピーライター", "プランナー", "戦略プランナー", "キャスティング", "カメラマン",
  "撮影", "照明", "美術", "編集", "エディター", "ミキサー", "音楽プロデューサー",
  "音楽監修", "作詞", "作曲", "編曲", "歌手", "アニメーター", "アニメーション",
  "監督", "制作", "プロダクション", "出演", "キャスト", "ナレーション", "フードスタイリスト",
  "エグゼクティブ・プロデューサー", "アクティベーション", "トレーディングデスク", "メディア",
  "車両", "ヘアメイク", "スタイリスト", "衣装", "VFX", "CG", "サウンド", "撮影監督",
].sort((left, right) => right.length - left.length);

const targetLabels = new Set([
  "監督", "ディレクター", "クリエイティブ・ディレクター", "プロデューサー",
  "アニメーション・プロデューサー", "プロダクション・マネージャー", "アニメーター",
  "アニメーション", "制作", "プロダクション",
]);

function extractStaffCredits(contexts) {
  const text = normalizePdfText(contexts.join(" "))
    .split(/スタッフリスト|応募動画/)[0];
  const positions = [];
  for (const label of allLabels) {
    let offset = 0;
    while (offset < text.length) {
      const foundAt = text.indexOf(label, offset);
      if (foundAt < 0) break;
      positions.push({ label, start: foundAt, end: foundAt + label.length });
      offset = foundAt + label.length;
    }
  }
  positions.sort((left, right) => left.start - right.start || right.label.length - left.label.length);
  const nonOverlapping = positions.filter((position, index) => {
    const prior = positions[index - 1];
    return !prior || position.start >= prior.end;
  });
  const credits = [];
  for (let index = 0; index < nonOverlapping.length; index += 1) {
    const current = nonOverlapping[index];
    const next = nonOverlapping[index + 1];
    if (!targetLabels.has(current.label)) continue;
    const name = text.slice(current.end, next?.start ?? text.length)
      .replace(/[→▶].*$/g, "")
      .replace(/^[:：\s]+|[,:：\s]+$/g, "")
      .trim();
    if (!name || name.length > 80 || /https?:\/\//i.test(name) || !/[\p{L}\p{N}]/u.test(name)) continue;
    credits.push(`${current.label}：${name}`);
  }
  return [...new Set(credits)];
}

const extracted = JSON.parse(readFileSync(SOURCE_FILE, "utf8"));
const sourceById = new Map(extracted.works.map((work) => [work.videoId, work]));
const connection = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await connection.execute(`
  SELECT id, title, videoUrl
  FROM videos
  WHERE source = 'youtube_works_awards_2026'
    AND (productions IS NULL OR productions = '[]')
  ORDER BY id
`);

const audits = rows.map((video) => {
  const source = sourceById.get(video.id);
  if (!source) {
    return { id: video.id, title: video.title, videoUrl: video.videoUrl, status: "hold", reason: "source_pdf_record_not_found", productionValues: [] };
  }
  const idMatched = video.id === source.videoId && videoIdFromUrl(video.videoUrl) === video.id;
  const urlMatched = canonicalVideoUrl(video.videoUrl) === canonicalVideoUrl(source.videoUrl);
  const titleMatched = normalize(video.title) === normalize(source.title);
  const productionValues = extractStaffCredits(source.contexts ?? [source.context ?? ""]);
  const verified = idMatched && urlMatched && titleMatched && productionValues.length > 0;
  return {
    id: video.id,
    title: video.title,
    videoUrl: video.videoUrl,
    sourcePdfPages: source.pdfPages,
    sourceTitle: source.title,
    idMatched,
    urlMatched,
    titleMatched,
    confidence: verified ? "official" : "none",
    status: verified ? "verified" : "hold",
    reason: verified ? "official_pdf_title_url_id_matched" : "title_url_id_or_credit_not_matched",
    productionValues: verified ? productionValues : [],
  };
});

const verified = audits.filter((audit) => audit.status === "verified");
if (APPLY) {
  for (const audit of verified) {
    await connection.execute(
      `UPDATE videos SET productions = ?
       WHERE id = ? AND videoUrl = ? AND title = ? AND (productions IS NULL OR productions = '[]')`,
      [JSON.stringify(audit.productionValues), audit.id, audit.videoUrl, audit.title],
    );
  }
}
await connection.end();

mkdirSync(OUTPUT_DIR, { recursive: true });
const summary = {
  runAt: new Date().toISOString(),
  apply: APPLY,
  source: "YouTube Works Awards Japan 2026 official case-study PDF",
  total: audits.length,
  verified: verified.length,
  held: audits.length - verified.length,
  tripleMatch: "video ID + normalized canonical video URL + normalized title",
  results: audits,
};
writeFileSync(OUTPUT_FILE, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT_FILE, total: summary.total, verified: summary.verified, held: summary.held, apply: APPLY }));
process.exit(0);
