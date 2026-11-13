import { writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const db = await mysql.createConnection(process.env.DATABASE_URL);

const genreMappings = new Map([
  ["mv", { name: "MV", slug: "mv" }],
  ["music video", { name: "MV", slug: "mv" }],
  ["pv", { name: "MV", slug: "mv" }],
  ["web cm", { name: "Web CM", slug: "web-cm" }],
  ["web movie", { name: "Web CM", slug: "web-cm" }],
  ["tv-cm", { name: "TV CM", slug: "tv-cm" }],
  ["brand movie", { name: "ブランデッドムービー", slug: "branded-movie" }],
  ["ブランディングムービー", { name: "ブランデッドムービー", slug: "branded-movie" }],
  ["opening movie", { name: "オープニング映像", slug: "opening" }],
  ["live opening animation", { name: "オープニング映像", slug: "opening" }],
  ["short film", { name: "映画 / ドラマ / ショートフィルム", slug: "film" }],
  ["documentary", { name: "ドキュメンタリー", slug: "documentary" }],
]);

const directionMappings = new Map([
  ["live action", { name: "実写", slug: "live-action" }],
  ["実写", { name: "実写", slug: "live-action" }],
  ["実写+アニメーション", { name: "実写", slug: "live-action" }],
  ["2d animation", { name: "イラストレーション", slug: "illustration" }],
  ["2dアニメーション", { name: "イラスト / アニメーション", slug: "illustration" }],
  ["アニメーション", { name: "イラスト / アニメーション", slug: "illustration" }],
  ["animation", { name: "イラストレーション", slug: "illustration" }],
  ["イラスト", { name: "イラスト / アニメーション", slug: "illustration" }],
  ["3dcg", { name: "VFX / 3DCG", slug: "vfx-3dcg" }],
  ["3d", { name: "合成 / VFX / 3DCG", slug: "vfx-3dcg" }],
  ["vfx", { name: "合成 / VFX / 3DCG", slug: "vfx-3dcg" }],
  ["motion graphics", { name: "モーショングラフィックス", slug: "motion-graphics" }],
  ["モーショングラフィックス", { name: "モーショングラフィックス", slug: "motion-graphics" }],
  ["ai", { name: "生成AI", slug: "generative-ai" }],
  ["motion control", { name: "モーションコントロール", slug: "motion-control" }],
  ["カメラワーク", { name: "カメラワーク / ドローン・空撮", slug: "camera-work" }],
  ["ドローン撮影", { name: "カメラワーク / ドローン・空撮", slug: "camera-work" }],
  ["stop motion", { name: "ストップモーション", slug: "stop-motion" }],
  ["タイムラプス", { name: "ストップモーション / タイムラプス", slug: "stop-motion" }],
  ["virtual production", { name: "バーチャルプロダクション", slug: "virtual-production" }],
  ["illustration", { name: "イラストレーション", slug: "illustration" }],
]);

const productMappings = new Map([
  ["beauty", { name: "美容 / 化粧品", slug: "beauty" }],
  ["cosmetics", { name: "美容 / 化粧品", slug: "beauty" }],
  ["fashion", { name: "ファッション / アパレル", slug: "fashion" }],
  ["apparel", { name: "ファッション / アパレル", slug: "fashion" }],
  ["food", { name: "食品 / 飲料 / 飲食", slug: "food" }],
  ["beverage", { name: "食品 / 飲料 / 飲食", slug: "food" }],
  ["automotive", { name: "自動車 / バイク", slug: "automotive" }],
  ["自動車", { name: "自動車 / バイク", slug: "automotive" }],
  ["game", { name: "ゲーム / アプリ / 玩具", slug: "gaming" }],
  ["gaming", { name: "ゲーム / アプリ / 玩具", slug: "gaming" }],
  ["ゲームui", { name: "ゲーム / アプリ / 玩具", slug: "gaming" }],
  ["it", { name: "IT / 通信 / ネットサービス", slug: "it" }],
  ["travel", { name: "旅行 / 宿泊", slug: "travel" }],
  ["旅行", { name: "旅行 / 宿泊", slug: "travel" }],
  ["medical", { name: "医療 / 健康", slug: "medical" }],
  ["real estate", { name: "不動産 / 建築", slug: "real-estate" }],
  ["sports", { name: "スポーツ", slug: "sports" }],
  ["スポーツ", { name: "スポーツ / 健康 / フィットネス", slug: "sports" }],
  ["electronics", { name: "家電 / テクノロジー", slug: "electronics" }],
  ["mv", { name: "娯楽 / アミューズメント", slug: "entertainment" }],
  ["music video", { name: "娯楽 / アミューズメント", slug: "entertainment" }],
  ["pv", { name: "娯楽 / アミューズメント", slug: "entertainment" }],
  ["short film", { name: "娯楽 / アミューズメント", slug: "entertainment" }],
  ["movie", { name: "娯楽 / アミューズメント", slug: "entertainment" }],
  ["event", { name: "娯楽 / アミューズメント", slug: "entertainment" }],
  ["installation", { name: "娯楽 / アミューズメント", slug: "entertainment" }],
  ["concert movie", { name: "娯楽 / アミューズメント", slug: "entertainment" }],
  ["fashion film", { name: "ファッション / アパレル", slug: "fashion" }],
  ["ファッション", { name: "ファッション / アパレル", slug: "fashion" }],
]);

const toneMappings = new Map([
  ["stylish", { name: "スタイリッシュ", slug: "stylish" }],
  ["スタイリッシュ", { name: "スタイリッシュ / クール", slug: "stylish" }],
  ["クール", { name: "スタイリッシュ / クール", slug: "stylish" }],
  ["シネマティック", { name: "スタイリッシュ / クール", slug: "stylish" }],
  ["comical", { name: "コミカル", slug: "comical" }],
  ["ユーモラス", { name: "コミカル / ユーモラス / カオス", slug: "comical" }],
  ["カオス", { name: "コミカル / ユーモラス / カオス", slug: "comical" }],
  ["混沌", { name: "コミカル / ユーモラス / カオス", slug: "comical" }],
  ["シュール", { name: "コミカル / ユーモラス / カオス", slug: "comical" }],
  ["emotional", { name: "エモーショナル", slug: "emotional" }],
  ["エモーショナル", { name: "エモーショナル / 感動的", slug: "emotional" }],
  ["ノスタルジック", { name: "エモーショナル / 感動的", slug: "emotional" }],
  ["ノスタルジー", { name: "エモーショナル / 感動的", slug: "emotional" }],
  ["切ない", { name: "エモーショナル / 感動的", slug: "emotional" }],
  ["内省的", { name: "エモーショナル / 感動的", slug: "emotional" }],
  ["希望", { name: "エモーショナル / 感動的", slug: "emotional" }],
  ["luxury", { name: "ラグジュアリー", slug: "luxury" }],
  ["洗練", { name: "洗練 / ラグジュアリー", slug: "luxury" }],
  ["クリーン", { name: "洗練 / ラグジュアリー", slug: "luxury" }],
]);

function parseArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function resolveMappings(tags, mappings) {
  const normalized = new Set(tags.map((tag) => String(tag).trim().toLowerCase()));
  return [...mappings.entries()]
    .filter(([tag]) => normalized.has(tag))
    .map(([, value]) => value);
}

const [rows] = await db.execute(`
  SELECT id, videoUrl, title, allTags, genres, products, directions, tones
  FROM videos
  WHERE (genres IS NULL OR genres = '[]') OR (products IS NULL OR products = '[]') OR (directions IS NULL OR directions = '[]') OR (tones IS NULL OR tones = '[]')
`);

const report = { candidates: rows.length, updated: [], held: [] };
try {
  for (const row of rows) {
    const tags = parseArray(row.allTags);
    const genres = parseArray(row.genres);
    const products = parseArray(row.products);
    const directions = parseArray(row.directions);
    const tones = parseArray(row.tones);
    const inferredGenres = genres.length ? [] : resolveMappings(tags, genreMappings);
    const inferredProducts = products.length ? [] : resolveMappings(tags, productMappings);
    const inferredDirections = directions.length ? [] : resolveMappings(tags, directionMappings);
    const inferredTones = tones.length ? [] : resolveMappings(tags, toneMappings);
    if (!inferredGenres.length && !inferredProducts.length && !inferredDirections.length && !inferredTones.length) {
      report.held.push({ id: row.id, reason: "no_deterministic_official_tag_mapping" });
      continue;
    }
    const [result] = await db.execute(
      `UPDATE videos
       SET genres = CASE WHEN genres IS NULL OR genres = '[]' THEN ? ELSE genres END,
           products = CASE WHEN products IS NULL OR products = '[]' THEN ? ELSE products END,
           directions = CASE WHEN directions IS NULL OR directions = '[]' THEN ? ELSE directions END
           , tones = CASE WHEN tones IS NULL OR tones = '[]' THEN ? ELSE tones END
       WHERE id = ? AND videoUrl = ? AND title = ?
         AND ((genres IS NULL OR genres = '[]') OR (products IS NULL OR products = '[]') OR (directions IS NULL OR directions = '[]') OR (tones IS NULL OR tones = '[]'))`,
      [JSON.stringify(inferredGenres), JSON.stringify(inferredProducts), JSON.stringify(inferredDirections), JSON.stringify(inferredTones), row.id, row.videoUrl, row.title]
    );
    if (result.affectedRows === 1) {
      report.updated.push({ id: row.id, genres: inferredGenres, products: inferredProducts, directions: inferredDirections, tones: inferredTones });
    } else {
      report.held.push({ id: row.id, reason: "triple_check_or_missing_condition_mismatch" });
    }
  }
} finally {
  await db.end();
}

const reportPath = "/home/ubuntu/iketeru-eizou/analysis/official_tag_taxonomy_backfill.json";
writeFileSync(reportPath, `${JSON.stringify({ executedAt: new Date().toISOString(), ...report }, null, 2)}\n`);
console.log(JSON.stringify({ candidates: report.candidates, updated: report.updated.length, held: report.held.length, reportPath }, null, 2));
