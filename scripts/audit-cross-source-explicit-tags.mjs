import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq } from "drizzle-orm";
import { videos } from "../drizzle/schema.ts";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error("DATABASE_URL is required");

const pool = await mysql.createPool(dbUrl);
const db = drizzle(pool);

const categoryMaps = {
  genres: new Map([
    ["mv", { slug: "mv", name: "MV" }],
    ["music video", { slug: "mv", name: "MV" }],
    ["tv cm", { slug: "tv-cm", name: "TV CM" }],
    ["web cm", { slug: "web-cm", name: "Web CM" }],
    ["ブランデッドムービー", { slug: "branded", name: "ブランデッドムービー" }],
    ["オープニング映像", { slug: "opening", name: "オープニング映像" }],
    ["メイキング", { slug: "making", name: "メイキング" }],
    ["ドキュメンタリー", { slug: "documentary", name: "ドキュメンタリー" }],
  ]),
  directions: new Map([
    ["モーショングラフィックス", { slug: "motion-graphics", name: "モーショングラフィックス" }],
    ["アニメーション", { slug: "animation", name: "アニメーション" }],
    ["実写", { slug: "live-action", name: "実写" }],
    ["3d", { slug: "3d", name: "3D" }],
    ["2d", { slug: "2d", name: "2D" }],
    ["生成ai", { slug: "generative-ai", name: "生成AI" }],
  ]),
  tones: new Map([
    ["シネマティック", { slug: "cinematic", name: "シネマティック" }],
    ["ポップ", { slug: "pop", name: "ポップ" }],
    ["ミニマル", { slug: "minimal", name: "ミニマル" }],
  ]),
  products: new Map(),
};

const normalized = value => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const parse = value => {
  try { return Array.isArray(JSON.parse(value || "[]")) ? JSON.parse(value || "[]") : []; }
  catch { return []; }
};

const rows = await db.select().from(videos);
const candidates = [];

for (const row of rows) {
  const tags = parse(row.allTags).map(normalized).filter(Boolean);
  if (!tags.length) continue;
  for (const [field, mapping] of Object.entries(categoryMaps)) {
    const existing = parse(row[field]);
    if (existing.length) continue;
    const matched = tags.map(tag => mapping.get(tag)).filter(Boolean);
    if (matched.length) {
      candidates.push({ id: row.id, source: row.source, title: row.title, field, tags, values: matched });
    }
  }
}

const bySource = Object.groupBy(candidates, item => item.source || "unknown");
const output = {
  generatedAt: new Date().toISOString(),
  totalVideos: rows.length,
  deterministicCandidates: candidates.length,
  bySource: Object.fromEntries(Object.entries(bySource).map(([source, items]) => [source, items.length])),
  candidates,
};

const path = resolve("analysis/metadata_completion/cross_source_explicit_tag_audit.json");
if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ totalVideos: rows.length, deterministicCandidates: candidates.length, bySource: output.bySource }, null, 2));
await pool.end();
