import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const requestedLimit = Number(process.argv.find((argument) => argument.startsWith("--limit="))?.split("=")[1] || 100);
const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 500) : 100;
const model = "gpt-5-mini";
const batchSize = 16;
const concurrency = 4;
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/metadata_classification";
const ledgerPath = `${outputDir}/reviewed_ids.json`;
mkdirSync(outputDir, { recursive: true });
const outputPath = `${outputDir}/candidates_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
const taxonomy = {
  genres: ["tv-cm", "web-cm", "branded-movie", "youtube-sns", "mv", "corporate", "film", "opening", "making", "documentary"],
  products: ["beauty", "fashion", "food", "daily", "automotive", "gaming", "it", "travel", "medical", "real-estate", "transport", "entertainment", "electronics", "sports"],
  directions: ["live-action", "vfx-3dcg", "motion-graphics", "generative-ai", "camera-work", "motion-control", "stop-motion", "virtual-production", "illustration"],
  tones: ["stylish", "comical", "emotional", "luxury"],
};
const fieldNames = { genres: "ジャンル", products: "商材", directions: "演出", tones: "トーン" };
const databaseUrl = new URL(process.env.DATABASE_URL);
const db = await mysql.createConnection({ host: databaseUrl.hostname, port: databaseUrl.port ? Number(databaseUrl.port) : 3306, user: decodeURIComponent(databaseUrl.username), password: decodeURIComponent(databaseUrl.password), database: databaseUrl.pathname.replace(/^\//, ""), ssl: { rejectUnauthorized: false } });
const reviewedIds = new Set(existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : []);
const rowWindowSize = Math.max(limit * 8, 800);
const rows = [];
let offset = 0;
while (rows.length < limit) {
  const [page] = await db.execute(
    `SELECT id, title, videoUrl, source, sourceLabel, channelTitle, allTags, genres, products, directions, tones, curationNote
     FROM videos
     WHERE genres = '[]' OR products = '[]' OR directions = '[]' OR tones = '[]'
     ORDER BY CASE WHEN source = 'alincolony' THEN 0 WHEN source IN ('eizo100','eizo100_2026') THEN 1 ELSE 2 END, createdAt DESC
     LIMIT ${rowWindowSize} OFFSET ${offset}`,
  );
  if (page.length === 0) break;
  rows.push(...page.filter((row) => !reviewedIds.has(String(row.id))));
  offset += page.length;
  if (page.length < rowWindowSize) break;
}
await db.end();
const safeJson = (value, fallback) => { try { return JSON.parse(value || ""); } catch { return fallback; } };
const inputs = rows.slice(0, limit).map((row) => {
  const note = safeJson(row.curationNote, {});
  return {
    id: row.id, title: row.title, videoUrl: row.videoUrl, source: row.source || "", sourceLabel: row.sourceLabel || "", channelTitle: row.channelTitle || "", allTags: safeJson(row.allTags, []).slice(0, 40),
    missing: Object.keys(taxonomy).filter((field) => safeJson(row[field], []).length === 0),
    evidence: [note.purpose, note.background, note.evaluation].filter(Boolean).join(" ").slice(0, 1500),
  };
});
const schema = {
  name: "video_metadata_candidates", strict: true,
  schema: {
    type: "object", additionalProperties: false,
    properties: { items: { type: "array", items: { type: "object", additionalProperties: false, properties: {
      id: { type: "string" }, genres: { type: "array", items: { type: "string", enum: taxonomy.genres } }, products: { type: "array", items: { type: "string", enum: taxonomy.products } }, directions: { type: "array", items: { type: "string", enum: taxonomy.directions } }, tones: { type: "array", items: { type: "string", enum: taxonomy.tones } }, confidence: { type: "number", minimum: 0, maximum: 1 }, evidence: { type: "string" },
    }, required: ["id", "genres", "products", "directions", "tones", "confidence", "evidence"] } } }, required: ["items"],
  },
};
const classify = async (items, attempt = 1) => {
  try {
    const response = await fetch(`${process.env.OPENAI_API_BASE}/chat/completions`, {
      method: "POST", signal: AbortSignal.timeout(120_000), headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_completion_tokens: 5000, response_format: { type: "json_schema", json_schema: schema }, messages: [
        { role: "system", content: `あなたは映像メタデータの保守的な分類器です。入力に明記されたタイトル、制作者名、タグ、掲載者コメントだけを根拠に、指定タクソノミーの候補を返してください。推測は禁止です。ジャンル/商材/演出/トーンが明示または強く示唆されない場合は必ず空配列にします。confidenceは全候補を支持する根拠の強さです。evidenceには判断に使った入力内の短い手掛かりを日本語で記載します。` },
        { role: "user", content: JSON.stringify({ taxonomy, fieldNames, items }) },
      ] }),
    });
    if (!response.ok) throw new Error(`LLM ${response.status}: ${await response.text()}`);
    const body = await response.json();
    return JSON.parse(body.choices?.[0]?.message?.content || '{"items":[]}').items;
  } catch (error) {
    if (attempt >= 3) throw error;
    await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    return classify(items, attempt + 1);
  }
};
const candidateBatches = [];
for (let index = 0; index < inputs.length; index += batchSize) candidateBatches.push(inputs.slice(index, index + batchSize));
const candidates = [];
for (let index = 0; index < candidateBatches.length; index += concurrency) candidates.push(...(await Promise.all(candidateBatches.slice(index, index + concurrency).map(classify))).flat());
const inputById = new Map(inputs.map((item) => [item.id, item]));
const accepted = candidates.filter((candidate) => {
  const source = inputById.get(candidate.id);
  if (!source || candidate.confidence < 0.82 || candidate.evidence.trim().length < 6) return false;
  return Object.keys(taxonomy).some((field) => candidate[field].length > 0 && source.missing.includes(field));
});
const report = { generatedAt: new Date().toISOString(), model, taxonomy, inputCount: inputs.length, candidateCount: candidates.length, acceptedCount: accepted.length, inputs, candidates, accepted };
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ model, inputs: inputs.length, candidates: candidates.length, accepted: accepted.length, outputPath }, null, 2));
