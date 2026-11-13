import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const apply = process.argv.includes("--apply");
const inputPath = "/home/ubuntu/iketeru-eizou/analysis/site_imports/vook_iketeru/official_video_verification.json";
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/site_imports/vook_iketeru";
const categoryMap = {
  genres: new Map([["TV CM", "tv-cm"], ["Web CM", "web-cm"], ["ブランデッドムービー", "branded-movie"], ["YouTube / SNS / 縦型動画", "youtube-sns"], ["MV", "mv"], ["企業 / 商品VP / コンテスト作品", "corporate"], ["映画 / ドラマ / ショートフィルム", "film"], ["オープニング映像", "opening"], ["メイキング / Behind The Scenes", "making"], ["ドキュメンタリー", "documentary"]]),
  products: new Map([["美容 / 化粧品", "beauty"], ["ファッション / アパレル", "fashion"], ["食品 / 飲料 / 飲食", "food"], ["日用品 / 防犯 / 警備", "daily"], ["自動車 / バイク", "automotive"], ["ゲーム / アプリ / 玩具", "gaming"], ["IT / 通信 / ネットサービス", "it"], ["旅行 / 宿泊", "travel"], ["医療 / 医薬", "medical"], ["住宅 / 不動産 / 建設", "real-estate"], ["交通 / 物流 / 産業素材", "transport"], ["娯楽 / アミューズメント", "entertainment"], ["精密機器 / 家具 / 電化製品", "electronics"], ["スポーツ / 健康 / フィットネス", "sports"]]),
  directions: new Map([["実写", "live-action"], ["合成 / VFX / 3DCG", "vfx-3dcg"], ["モーショングラフィックス", "motion-graphics"], ["生成AI", "generative-ai"], ["カメラワーク / ドローン・空撮", "camera-work"], ["モーションコントロールカメラ", "motion-control"], ["ストップモーション / タイムラプス", "stop-motion"], ["ボリュメトリック / バーチャルプロダクション", "virtual-production"], ["イラスト / アニメーション", "illustration"]]),
  tones: new Map([["スタイリッシュ / クール", "stylish"], ["コミカル / ユーモラス / カオス", "comical"], ["エモーショナル / 感動的", "emotional"], ["洗練 / ラグジュアリー", "luxury"]]),
};
const labels = Object.fromEntries(Object.entries(categoryMap).map(([field, entries]) => [field, new Map([...entries].map(([name, slug]) => [slug, name]))]));
const parse = (raw, fallback = []) => { try { const value = JSON.parse(raw || ""); return Array.isArray(value) ? value : fallback; } catch { return fallback; } };
const input = JSON.parse(readFileSync(inputPath, "utf8"));
const verified = input.rows.filter((row) => row.result === "verified");
const db = await mysql.createConnection(process.env.DATABASE_URL);
const ids = verified.map((row) => row.id);
const [rows] = await db.query(`SELECT id, genres, products, directions, tones, allTags, metadataClassificationAudit FROM videos WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
const candidatesById = new Map(verified.map((row) => [row.id, row]));
const updates = [];
for (const row of rows) {
  const source = candidatesById.get(row.id);
  if (!source) continue;
  const tags = source.allTags || [];
  const update = { id: row.id, allTags: [...new Set([...parse(row.allTags), ...tags])], changed: [], reason: "Vook公式カードの明示タグ" };
  for (const field of ["genres", "products", "directions", "tones"]) {
    const existing = parse(row[field]);
    if (existing.length > 0) { update[field] = existing; continue; }
    const entries = tags.filter((tag) => categoryMap[field].has(tag)).map((tag) => ({ slug: categoryMap[field].get(tag), name: labels[field].get(categoryMap[field].get(tag)) }));
    update[field] = entries;
    if (entries.length > 0) update.changed.push(field);
  }
  if (update.changed.length === 0 && JSON.stringify(update.allTags) === JSON.stringify(parse(row.allTags))) continue;
  const existingAudit = (() => { try { return row.metadataClassificationAudit ? JSON.parse(row.metadataClassificationAudit) : {}; } catch { return {}; } })();
  update.audit = { ...existingAudit, vookOfficialCardCompletion: { completedAt: new Date().toISOString(), evidenceType: "official_vook_card_tags", sourceUrl: source.sourceUrl, tags, updatedFields: update.changed } };
  updates.push(update);
}
const applied = [];
try {
  if (apply) {
    for (let offset = 0; offset < updates.length; offset += 100) {
      const chunk = updates.slice(offset, offset + 100);
      const idsChunk = chunk.map((item) => item.id);
      const makeCase = (field, transform = (item) => item[field]) => chunk.map(() => "WHEN ? THEN ?").join(" ");
      const values = [
        ...chunk.flatMap((item) => [item.id, JSON.stringify(item.genres)]),
        ...chunk.flatMap((item) => [item.id, JSON.stringify(item.products)]),
        ...chunk.flatMap((item) => [item.id, JSON.stringify(item.directions)]),
        ...chunk.flatMap((item) => [item.id, JSON.stringify(item.tones)]),
        ...chunk.flatMap((item) => [item.id, JSON.stringify(item.allTags)]),
        ...chunk.flatMap((item) => [item.id, JSON.stringify(item.audit)]),
        ...idsChunk,
      ];
      const [result] = await db.execute(`UPDATE videos SET genres=CASE id ${makeCase("genres")} ELSE genres END, products=CASE id ${makeCase("products")} ELSE products END, directions=CASE id ${makeCase("directions")} ELSE directions END, tones=CASE id ${makeCase("tones")} ELSE tones END, allTags=CASE id ${makeCase("allTags")} ELSE allTags END, metadataClassificationAudit=CASE id ${makeCase("audit")} ELSE metadataClassificationAudit END WHERE id IN (${idsChunk.map(() => "?").join(",")})`, values);
      if (result.affectedRows) applied.push(...idsChunk);
    }
  }
} finally { await db.end(); }
const summary = { mode: apply ? "apply" : "dry-run", candidates: updates.length, updated: applied.length, fieldUpdates: Object.fromEntries(["genres", "products", "directions", "tones"].map((field) => [field, updates.filter((item) => item.changed.includes(field)).length])) };
mkdirSync(outputDir, { recursive: true });
writeFileSync(`${outputDir}/official_tag_completion_${apply ? "apply" : "dry_run"}.json`, `${JSON.stringify({ summary, updates }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
