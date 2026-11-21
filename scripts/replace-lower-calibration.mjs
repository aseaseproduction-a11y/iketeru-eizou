import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const calPath = path.join(REPO_ROOT, "analysis", "human_calibration_30.json");
const cal = JSON.parse(fs.readFileSync(calPath, "utf8"));

const replacements = [
  {
    oldId: "_PO5O3QAaVM",
    newId: "2NOefVvwLIM",
    reason: "旧候補がテレビニュース報道だったため、実際の採用オープニング映像（企業動画）で演出・構成に課題があるB-作品へ差し替え",
  },
  {
    oldId: "_8S5nlXiBwo",
    newId: "2b41yoNZGhM",
    reason: "旧候補がAIツールのハウツー解説動画だったため、実際のMV作品（B-）へ差し替え",
  },
  {
    oldId: "_Ppg6wQ5uXg",
    newId: "265532017",
    reason: "旧候補がゲーム切り抜き系ネタショートだったため、実験映像・モーショングラフィックス作品（Vimeo・B-）へ差し替え",
  },
  {
    oldId: "-h0IqDYl9Zo",
    newId: "Dhx2EIhYkc0",
    reason: "旧候補がネタ系ショートだったため、実際のOfficial Music Video作品で演出・技術に課題があるC帯作品へ差し替え",
  },
  {
    oldId: "53i4Yuw2ld8",
    newId: "Z-nPJFF1PYY",
    reason: "旧候補がイベント取材ニュース映像だったため、企業の採用ピッチ動画（C-）へ差し替え",
  },
  {
    oldId: "efxhgspLRIQ",
    newId: "DMowlj44nZc",
    reason: "旧候補（D+唯一の動画）がネタ系ショートだったため、実際のMV作品で表現・仕上げに明確な課題があるC-作品へ差し替え",
  },
];

const newIds = replacements.map((r) => r.newId);
const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});
const [rows] = await conn.query(
  `SELECT id, platform, title, videoUrl, aiOverallRating, aiOverallScore, aiDirectionRating, aiTechniqueRating, genres, products
     FROM videos WHERE id IN (${newIds.map(() => "?").join(",")})`,
  newIds
);
await conn.end();

const byId = new Map(rows.map((r) => [String(r.id), r]));
const replacementLog = [];

for (const rep of replacements) {
  const idx = cal.items.findIndex((x) => x.id === rep.oldId);
  const nr = byId.get(rep.newId);
  if (idx === -1 || !nr) {
    throw new Error(`Missing replacement ${rep.oldId} -> ${rep.newId}`);
  }
  const oldItem = cal.items[idx];
  const isCorp = /企業|採用|コーポレート|会社紹介|リクルート|service|corporate/i.test(`${nr.title} ${nr.genres} ${nr.products}`);
  const isVert = /shorts|縦型|reels/i.test(`${nr.videoUrl} ${nr.title}`);
  const cats = [];
  if (isVert) cats.push("縦型/ショート");
  if (isCorp) cats.push("企業/採用");
  cal.items[idx] = {
    id: nr.id,
    platform: nr.platform,
    title: nr.title,
    videoUrl: nr.videoUrl,
    tierGroup: ["C+", "C", "C-"].includes(nr.aiOverallRating) ? "C以下 (C+/C/C-)" : "B / B-",
    currentAiOverallRating: nr.aiOverallRating,
    currentAiOverallScore: nr.aiOverallScore,
    currentAiDirectionRating: nr.aiDirectionRating,
    currentAiTechniqueRating: nr.aiTechniqueRating,
    specialCategories: cats,
    selectionRationale: rep.reason,
    humanRating: null,
    humanNotes: "",
  };
  replacementLog.push({
    oldId: oldItem.id,
    oldRating: oldItem.currentAiOverallRating,
    oldTitle: oldItem.title,
    newId: nr.id,
    newRating: nr.aiOverallRating,
    newTitle: nr.title,
    reason: rep.reason,
  });
}

// Recompute counts
const byTier = {};
let vert = 0;
let corp = 0;
for (const it of cal.items) {
  byTier[it.currentAiOverallRating] = (byTier[it.currentAiOverallRating] || 0) + 1;
  if (it.specialCategories.includes("縦型/ショート")) vert++;
  if (it.specialCategories.includes("企業/採用")) corp++;
}
cal.generatedAt = new Date().toISOString();
cal.selectedTierCounts = byTier;
cal.verticalCount = vert;
cal.corporateCount = corp;
cal.replacementHistory = replacementLog;

fs.writeFileSync(calPath, JSON.stringify(cal, null, 2), "utf8");
console.log(JSON.stringify({ totalCount: cal.items.length, selectedTierCounts: byTier, verticalCount: vert, corporateCount: corp, replacements: replacementLog }, null, 2));
