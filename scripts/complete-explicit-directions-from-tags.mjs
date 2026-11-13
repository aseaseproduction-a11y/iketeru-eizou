import { mkdirSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const apply = process.argv.includes("--apply");
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/metadata_completion";
const map = new Map([
  ["実写", { slug: "live-action", name: "実写" }],
  ["合成 / VFX / 3DCG", { slug: "vfx-3dcg", name: "合成 / VFX / 3DCG" }],
  ["モーショングラフィックス", { slug: "motion-graphics", name: "モーショングラフィックス" }],
  ["生成AI", { slug: "generative-ai", name: "生成AI" }],
  ["カメラワーク / ドローン・空撮", { slug: "camera-work", name: "カメラワーク / ドローン・空撮" }],
  ["モーションコントロールカメラ", { slug: "motion-control", name: "モーションコントロールカメラ" }],
  ["ストップモーション / タイムラプス", { slug: "stop-motion", name: "ストップモーション / タイムラプス" }],
  ["ボリュメトリック / バーチャルプロダクション", { slug: "virtual-production", name: "ボリュメトリック / バーチャルプロダクション" }],
  ["イラスト / アニメーション", { slug: "illustration", name: "イラスト / アニメーション" }],
]);
const db = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await db.query("SELECT id, source, title, allTags, directions, metadataClassificationAudit FROM videos WHERE source IN ('notion','favvid')");
const parse = (raw, fallback = []) => { try { const value = JSON.parse(raw || ""); return Array.isArray(value) ? value : fallback; } catch { return fallback; } };
const updates = [];
for (const row of rows) {
  const existing = parse(row.directions);
  if (existing.length > 0) continue;
  const tags = parse(row.allTags);
  const directions = tags.filter((tag) => map.has(tag)).map((tag) => map.get(tag));
  if (directions.length === 0) continue;
  let audit = {};
  try { audit = row.metadataClassificationAudit ? JSON.parse(row.metadataClassificationAudit) : {}; } catch { /* keep empty */ }
  updates.push({
    id: row.id,
    title: row.title,
    source: row.source,
    tags,
    directions,
    audit: { ...audit, explicitDirectionTagCompletion: { completedAt: new Date().toISOString(), evidenceType: row.source === "favvid" ? "official_favvid_tag" : "user_notion_tag", tags: tags.filter((tag) => map.has(tag)), updatedFields: ["directions"] } },
  });
}
const applied = [];
try {
  if (apply) {
    for (let offset = 0; offset < updates.length; offset += 100) {
      const chunk = updates.slice(offset, offset + 100);
      const ids = chunk.map((item) => item.id);
      const values = [
        ...chunk.flatMap((item) => [item.id, JSON.stringify(item.directions)]),
        ...chunk.flatMap((item) => [item.id, JSON.stringify(item.audit)]),
        ...ids,
      ];
      const [result] = await db.execute(`UPDATE videos SET directions=CASE id ${chunk.map(() => "WHEN ? THEN ?").join(" ")} ELSE directions END, metadataClassificationAudit=CASE id ${chunk.map(() => "WHEN ? THEN ?").join(" ")} ELSE metadataClassificationAudit END WHERE id IN (${ids.map(() => "?").join(",")})`, values);
      if (result.affectedRows) applied.push(...ids);
    }
  }
} finally { await db.end(); }
const summary = { mode: apply ? "apply" : "dry-run", candidates: updates.length, updated: applied.length, bySource: Object.fromEntries([...new Set(updates.map((item) => item.source))].map((source) => [source, updates.filter((item) => item.source === source).length])) };
mkdirSync(outputDir, { recursive: true });
writeFileSync(`${outputDir}/explicit_directions_from_tags_${apply ? "apply" : "dry_run"}.json`, `${JSON.stringify({ summary, updates }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
