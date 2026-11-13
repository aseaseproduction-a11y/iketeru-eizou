import { readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const candidatePath = process.argv[2];
if (!candidatePath) throw new Error("Usage: node scripts/generate-metadata-classification-updates.mjs <candidates.json>");
const report = JSON.parse(readFileSync(candidatePath, "utf8"));
const names = {
  genres: { "tv-cm": "TV CM", "web-cm": "Web CM", "branded-movie": "ブランデッドムービー", "youtube-sns": "YouTube / SNS / 縦型動画", mv: "MV", corporate: "企業 / 商品VP / コンテスト作品", film: "映画 / ドラマ / ショートフィルム", opening: "オープニング映像", making: "メイキング / Behind The Scenes", documentary: "ドキュメンタリー" },
  products: { beauty: "美容 / 化粧品", fashion: "ファッション / アパレル", food: "食品 / 飲料 / 飲食", daily: "日用品 / 防犯 / 警備", automotive: "自動車 / バイク", gaming: "ゲーム / アプリ / 玩具", it: "IT / 通信 / ネットサービス", travel: "旅行 / 宿泊", medical: "医療 / 医薬", "real-estate": "住宅 / 不動産 / 建設", transport: "交通 / 物流 / 産業素材", entertainment: "娯楽 / アミューズメント", electronics: "精密機器 / 家具 / 電化製品", sports: "スポーツ / 健康 / フィットネス" },
  directions: { "live-action": "実写", "vfx-3dcg": "合成 / VFX / 3DCG", "motion-graphics": "モーショングラフィックス", "generative-ai": "生成AI", "camera-work": "カメラワーク / ドローン・空撮", "motion-control": "モーションコントロールカメラ", "stop-motion": "ストップモーション / タイムラプス", "virtual-production": "ボリュメトリック / バーチャルプロダクション", illustration: "イラスト / アニメーション" },
  tones: { stylish: "スタイリッシュ / クール", comical: "コミカル / ユーモラス / カオス", emotional: "エモーショナル / 感動的", luxury: "洗練 / ラグジュアリー" },
};
const asTagItems = (field, slugs) => slugs.map((slug) => ({ slug, name: names[field][slug] })).filter((item) => item.name);
const asBase64Sql = (value) => `FROM_BASE64('${Buffer.from(String(value), "utf8").toString("base64")}')`;
const sourceInputs = new Map(report.inputs.map((item) => [item.id, item]));
const ids = report.accepted.map((item) => item.id);
const databaseUrl = new URL(process.env.DATABASE_URL);
const db = await mysql.createConnection({ host: databaseUrl.hostname, port: databaseUrl.port ? Number(databaseUrl.port) : 3306, user: decodeURIComponent(databaseUrl.username), password: decodeURIComponent(databaseUrl.password), database: databaseUrl.pathname.replace(/^\//, ""), ssl: { rejectUnauthorized: false } });
const [rows] = ids.length ? await db.query(`SELECT id, title, videoUrl, genres, products, directions, tones FROM videos WHERE id IN (${ids.map(() => "?").join(",")})`, ids) : [[]];
await db.end();
const byId = new Map(rows.map((row) => [String(row.id), row]));
const updates = [];
const held = [];
for (const candidate of report.accepted) {
  const input = sourceInputs.get(candidate.id);
  const row = byId.get(candidate.id);
  if (!input || !row || row.videoUrl !== input.videoUrl || row.title !== input.title) {
    held.push({ id: candidate.id, reason: "triple_check_mismatch" });
    continue;
  }
  const assignments = [];
  for (const field of ["genres", "products", "directions", "tones"]) {
    if (row[field] === "[]" && candidate[field]?.length) assignments.push(`${field} = ${asBase64Sql(JSON.stringify(asTagItems(field, candidate[field])))}`);
  }
  if (!assignments.length) continue;
  updates.push({ id: row.id, title: row.title, confidence: candidate.confidence, evidence: candidate.evidence, sql: `UPDATE videos SET ${assignments.join(", ")} WHERE id = ${asBase64Sql(row.id)} AND videoUrl = ${asBase64Sql(row.videoUrl)} AND title = ${asBase64Sql(row.title)};` });
}
const base = candidatePath.replace(/\.json$/, "");
writeFileSync(`${base}_updates.sql`, `${updates.map((item) => item.sql).join("\n")}\n`);
writeFileSync(`${base}_update_plan.json`, `${JSON.stringify({ generatedAt: new Date().toISOString(), candidatePath, updates: updates.map(({ id, title, confidence, evidence }) => ({ id, title, confidence, evidence })), held }, null, 2)}\n`);
console.log(JSON.stringify({ updates: updates.length, held: held.length, sql: `${base}_updates.sql` }, null, 2));
