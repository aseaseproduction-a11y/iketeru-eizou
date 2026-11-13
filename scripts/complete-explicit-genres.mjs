import { mkdirSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const apply = process.argv.includes("--apply");
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/metadata_completion";
const genreNames = {
  "tv-cm": "TV CM", "web-cm": "Web CM", "branded-movie": "ブランデッドムービー", "youtube-sns": "YouTube / SNS / 縦型動画", mv: "MV", corporate: "企業 / 商品VP / コンテスト作品", film: "映画 / ドラマ / ショートフィルム", opening: "オープニング映像", making: "メイキング / Behind The Scenes", documentary: "ドキュメンタリー",
};
const rules = [
  { slug: "mv", reason: "タイトル・公式タグにMV/Music Videoの明示", pattern: /(?:\bM\s*\/\s*V\b|\bMV\b|Music\s*Video|ミュージックビデオ)/i },
  { slug: "web-cm", reason: "タイトル・公式タグにWeb CMの明示", pattern: /(?:Web\s*CM|WebCM|Web\s*Commercial)/i },
  { slug: "tv-cm", reason: "タイトル・公式タグにTVCM/TV CMの明示", pattern: /(?:TV\s*CM|TVCM|テレビCM|コマーシャル)/i },
  { slug: "branded-movie", reason: "タイトル・公式タグにブランデッドムービーの明示", pattern: /(?:ブランデッドムービー|Brand(?:ed)?\s*Movie|ブランドムービー)/i },
  { slug: "opening", reason: "タイトル・公式タグにオープニング/エンディングの明示", pattern: /(?:オープニング|エンディング|\bOpening\b|\bEnding\b|ノンクレジットOP|ノンクレジットED)/i },
  { slug: "making", reason: "タイトル・公式タグにメイキングの明示", pattern: /(?:メイキング|Behind\s+The\s+Scenes|\bMaking\b)/i },
  { slug: "documentary", reason: "タイトル・公式タグにドキュメンタリーの明示", pattern: /(?:ドキュメンタリー|\bDocumentary\b)/i },
  { slug: "film", reason: "タイトル・公式タグに映画・ショートフィルムの明示", pattern: /(?:ショートフィルム|Short\s*Film|\bFilm\b|映画)/i },
  { slug: "corporate", reason: "タイトル・公式タグに企業・サービス紹介の明示", pattern: /(?:会社紹介|企業紹介|Corporate\s*(?:Movie|Film)|サービス紹介|商品紹介)/i },
];

const parseTags = (raw) => { try { return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : []; } catch { return []; } };
const hasGenres = (raw) => { try { return Array.isArray(JSON.parse(raw)) && JSON.parse(raw).length > 0; } catch { return false; } };
mkdirSync(outputDir, { recursive: true });
const db = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await db.execute("SELECT id, title, videoUrl, allTags, genres, metadataClassificationAudit FROM videos");
const updates = [];
for (const row of rows) {
  if (hasGenres(row.genres)) continue;
  const tags = parseTags(row.allTags);
  const searchable = `${row.title}\n${tags.join("\n")}`;
  const rule = rules.find((candidate) => candidate.pattern.test(searchable));
  if (!rule) continue;
  const priorAudit = (() => { try { return row.metadataClassificationAudit ? JSON.parse(row.metadataClassificationAudit) : {}; } catch { return {}; } })();
  updates.push({ id: row.id, title: row.title, videoUrl: row.videoUrl, genres: [{ slug: rule.slug, name: genreNames[rule.slug] }], reason: rule.reason, audit: { ...priorAudit, explicitGenreCompletion: { completedAt: new Date().toISOString(), evidenceType: "explicit_title_or_official_tag", reason: rule.reason, title: row.title, tags } } });
}
const applied = [];
try {
  if (apply) {
    for (let offset = 0; offset < updates.length; offset += 200) {
      const chunk = updates.slice(offset, offset + 200);
      const ids = chunk.map((item) => item.id);
      const genresCase = chunk.map(() => "WHEN ? THEN ?").join(" ");
      const auditCase = chunk.map(() => "WHEN ? THEN ?").join(" ");
      const values = [
        ...chunk.flatMap((item) => [item.id, JSON.stringify(item.genres)]),
        ...chunk.flatMap((item) => [item.id, JSON.stringify(item.audit)]),
        ...ids,
      ];
      const [result] = await db.execute(`UPDATE videos SET genres = CASE id ${genresCase} ELSE genres END, metadataClassificationAudit = CASE id ${auditCase} ELSE metadataClassificationAudit END WHERE id IN (${ids.map(() => "?").join(",")})`, values);
      if (result.affectedRows) applied.push(...ids);
    }
  }
} finally {
  await db.end();
}
const summary = { mode: apply ? "apply" : "dry-run", candidates: updates.length, updated: applied.length, byGenre: Object.fromEntries(Object.keys(genreNames).map((slug) => [slug, updates.filter((item) => item.genres[0].slug === slug).length])) };
writeFileSync(`${outputDir}/explicit_genres_${apply ? "apply" : "dry_run"}.json`, `${JSON.stringify({ summary, updates }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
process.exit(0);
