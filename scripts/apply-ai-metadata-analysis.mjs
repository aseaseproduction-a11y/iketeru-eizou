import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { assessAiCandidate } from "./aiMetadataQuality.mjs";

const inputPath = process.env.AI_ANALYSIS_INPUT;
const outputPath = process.env.AI_ANALYSIS_OUTPUT;
const apply = process.argv.includes("--apply");
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/ai_metadata_completion";
const model = "gpt-5-mini";
if (!inputPath || !outputPath) throw new Error("AI_ANALYSIS_INPUT and AI_ANALYSIS_OUTPUT are required");
if (!existsSync(inputPath) || !existsSync(outputPath)) throw new Error("input/output file not found");

const names = {
  genres: { "tv-cm": "TV CM", "web-cm": "Web CM", "branded-movie": "ブランデッドムービー", "youtube-sns": "YouTube / SNS / 縦型動画", mv: "MV", corporate: "企業 / 商品VP / コンテスト作品", film: "映画 / ドラマ / ショートフィルム", opening: "オープニング映像", making: "メイキング / Behind The Scenes", documentary: "ドキュメンタリー" },
  products: { beauty: "美容 / 化粧品", fashion: "ファッション / アパレル", food: "食品 / 飲料 / 飲食", daily: "日用品 / 防犯 / 警備", automotive: "自動車 / バイク", gaming: "ゲーム / アプリ / 玩具", it: "IT / 通信 / ネットサービス", travel: "旅行 / 宿泊", medical: "医療 / 医薬", "real-estate": "住宅 / 不動産 / 建設", transport: "交通 / 物流 / 産業素材", entertainment: "娯楽 / アミューズメント", electronics: "精密機器 / 家具 / 電化製品", sports: "スポーツ / 健康 / フィットネス" },
  directions: { "live-action": "実写", "vfx-3dcg": "合成 / VFX / 3DCG", "motion-graphics": "モーショングラフィックス", "generative-ai": "生成AI", "camera-work": "カメラワーク / ドローン・空撮", "motion-control": "モーションコントロールカメラ", "stop-motion": "ストップモーション / タイムラプス", "virtual-production": "ボリュメトリック / バーチャルプロダクション", illustration: "イラスト / アニメーション" },
  tones: { stylish: "スタイリッシュ / クール", comical: "コミカル / ユーモラス / カオス", emotional: "エモーショナル / 感動的", luxury: "洗練 / ラグジュアリー" },
};
const purposeOptions = new Set(["MV", "ブランディングムービー", "プロモーション", "事業・サービス紹介", "OPED", "インタビュー", "ティザー", "アート", "企画系", "その他"]);
const expressionOptions = new Set(["2D", "3D", "アニメーション", "実写", "イラスト", "実写+アニメーション", "生成AI"]);
const parseJson = (raw, fallback) => { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
const isEmptyArray = (value) => !Array.isArray(parseJson(value, [])) || parseJson(value, []).length === 0;
const tagItems = (field, values) => Array.from(new Set(values || [])).map((slug) => names[field][slug] ? ({ slug, name: names[field][slug] }) : null).filter(Boolean);

const inputs = JSON.parse(readFileSync(inputPath, "utf8"));
const byId = new Map(inputs.map((item) => [item.id, item]));
const results = readFileSync(outputPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const parsed = [];
for (const result of results) {
  if (result.error || !result.output) continue;
  const original = byId.get(JSON.parse(result.input).id);
  if (!original) continue;
  try { parsed.push({ original, candidate: JSON.parse(result.output) }); } catch { /* invalid JSON is excluded */ }
}

const db = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = parsed.length ? await db.query("SELECT id, title, videoUrl, CAST(genres AS CHAR) AS genres, CAST(products AS CHAR) AS products, CAST(directions AS CHAR) AS directions, CAST(tones AS CHAR) AS tones, CAST(purposes AS CHAR) AS purposes, CAST(expressions AS CHAR) AS expressions, privateRating, aiOverallRating, aiDirectionRating, aiTechniqueRating, aiAnalysis, CAST(curationNote AS CHAR) AS curationNote, CAST(metadataClassificationAudit AS CHAR) AS metadataClassificationAudit FROM videos WHERE id IN (?)", [parsed.map((item) => item.original.id)]) : [[]];
const currentById = new Map(rows.map((row) => [row.id, row]));
const updates = [];
for (const { original, candidate } of parsed) {
  const current = currentById.get(original.id);
  if (!current || current.title !== original.title || current.videoUrl !== original.videoUrl) continue;
  const quality = assessAiCandidate(candidate, original);
  const accepted = new Set(quality.eligible);
  const use = (field) => accepted.has(field);
  const next = {
    genres: isEmptyArray(current.genres) && use("genres") ? tagItems("genres", candidate.genres) : parseJson(current.genres, []),
    products: isEmptyArray(current.products) && use("products") ? tagItems("products", candidate.products) : parseJson(current.products, []),
    directions: isEmptyArray(current.directions) && use("directions") ? tagItems("directions", candidate.directions) : parseJson(current.directions, []),
    tones: isEmptyArray(current.tones) && use("tones") ? tagItems("tones", candidate.tones) : parseJson(current.tones, []),
    purposes: isEmptyArray(current.purposes) && use("purposes") ? Array.from(new Set(candidate.purposes.filter((value) => purposeOptions.has(value)))) : parseJson(current.purposes, []),
    expressions: isEmptyArray(current.expressions) && use("expressions") ? Array.from(new Set(candidate.expressions.filter((value) => expressionOptions.has(value)))) : parseJson(current.expressions, []),
    privateRating: !current.privateRating && use("privateRating") ? candidate.privateRating : current.privateRating || "",
    aiOverallRating: !current.aiOverallRating && use("aiOverallRating") ? candidate.aiOverallRating : current.aiOverallRating || "",
    aiDirectionRating: !current.aiDirectionRating && use("aiDirectionRating") ? candidate.aiDirectionRating : current.aiDirectionRating || "",
    aiTechniqueRating: !current.aiTechniqueRating && use("aiTechniqueRating") ? candidate.aiTechniqueRating : current.aiTechniqueRating || "",
    aiAnalysis: !current.aiAnalysis && use("aiAnalysis") ? candidate.aiAnalysis : current.aiAnalysis || "",
  };
  const appliedMissing = Object.entries(next).filter(([field, value]) => original.missing.includes(field) && (Array.isArray(value) ? value.length > 0 : Boolean(value))).map(([field]) => field);
  const priorAudit = parseJson(current.metadataClassificationAudit, {});
  const metadataClassificationAudit = {
    ...priorAudit,
    aiMetadataCompletion: { model, analyzedAt: new Date().toISOString(), evidenceType: "ai_analysis", identityTripleMatch: quality.identityOk, confidence: candidate.confidence, evidence: candidate.evidence, input: { title: current.title, videoUrl: current.videoUrl, source: original.source, channelTitle: original.channelTitle, tags: original.tags }, eligibleFields: quality.eligible, rejectedFields: quality.rejected, appliedMissing },
  };
  updates.push({ id: current.id, title: current.title, videoUrl: current.videoUrl, ...next, metadataClassificationAudit });
}
const applied = [];
try {
  if (apply) {
    for (let offset = 0; offset < updates.length; offset += 100) {
      const chunk = updates.slice(offset, offset + 100);
      const fields = ["genres", "products", "directions", "tones", "purposes", "expressions", "privateRating", "aiOverallRating", "aiDirectionRating", "aiTechniqueRating", "aiAnalysis", "metadataClassificationAudit"];
      const cases = fields.map((field) => `${field} = CASE id ${chunk.map(() => "WHEN ? THEN ?").join(" ")} ELSE ${field} END`).join(", ");
      const values = fields.flatMap((field) => chunk.flatMap((item) => [item.id, typeof item[field] === "string" ? item[field] : JSON.stringify(item[field])]));
      const ids = chunk.map((item) => item.id);
      const [result] = await db.execute(`UPDATE videos SET ${cases} WHERE id IN (${ids.map(() => "?").join(",")})`, [...values, ...ids]);
      if (result.affectedRows) applied.push(...ids);
    }
  }
} finally { await db.end(); }
mkdirSync(outputDir, { recursive: true });
const acceptedFields = updates.reduce((count, item) => count + item.metadataClassificationAudit.aiMetadataCompletion.eligibleFields.length, 0);
const summary = { mode: apply ? "apply" : "dry-run", inputs: inputs.length, responseRows: results.length, validStructuredOutputs: parsed.length, tripleMatchedUpdates: updates.length, acceptedFields, updated: applied.length };
writeFileSync(`${outputDir}/apply_${apply ? "apply" : "dry_run"}_${inputs.length}.json`, `${JSON.stringify({ summary, updates }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
