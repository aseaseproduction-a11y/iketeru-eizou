/**
 * Phase 4A: Precision 5x20 Rubric 100pt Scorer from existing aiAnalysis (Resumable JSONL batch).
 *
 * Reads analyzed videos from TiDB Cloud (DATABASE_URL), extracts key chapters (Ch.0/4/5/8),
 * scores 5x20 Direction + 5x20 Technique rubrics + synergyAdjustment (-5..+5) strictly clamped
 * inside each video's existing S+..D- grade band (preserving existing ratings), and appends
 * results to a resumable JSONL file.
 *
 * Supports OpenAI (OPENAI_API_KEY) or Gemini (GEMINI_API_KEY) via standard fetch (zero extra deps).
 *
 * Usage:
 *   DATABASE_URL=... OPENAI_API_KEY=... node scripts/score-rubric-from-analysis.mjs --out=analysis/rubric_100pt.jsonl --limit=100
 *   DATABASE_URL=... GEMINI_API_KEY=... node scripts/score-rubric-from-analysis.mjs --provider=gemini --out=analysis/rubric_100pt.jsonl --limit=100
 *   # Then apply to TiDB Cloud:
 *   DATABASE_URL=... node scripts/backfill-100pt-scores.mjs --from-jsonl=analysis/rubric_100pt.jsonl --apply
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import mysql from "mysql2/promise";

const outArg = process.argv.find((a) => a.startsWith("--out="));
const outPath = outArg ? outArg.slice(6) : "analysis/rubric_100pt.jsonl";
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Math.max(1, Number(limitArg.slice(8))) : 50;
const concurrencyArg = process.argv.find((a) => a.startsWith("--concurrency="));
const concurrency = concurrencyArg ? Math.max(1, Math.min(12, Number(concurrencyArg.slice(12)))) : 4;
const providerArg = process.argv.find((a) => a.startsWith("--provider="));
const provider = providerArg
  ? providerArg.slice(11).toLowerCase()
  : (process.env.OPENAI_API_KEY ? "openai" : (process.env.GEMINI_API_KEY ? "gemini" : "none"));
const modelArg = process.argv.find((a) => a.startsWith("--model="));
const model = modelArg
  ? modelArg.slice(8)
  : (provider === "gemini" ? "gemini-2.5-flash-lite" : "gpt-5-mini");
const dryRun = process.argv.includes("--dry-run");

const BANDS = {
  "S+": { min: 97, max: 100, mid: 98 },
  "S":  { min: 93, max: 96,  mid: 94 },
  "S-": { min: 90, max: 92,  mid: 91 },
  "A+": { min: 86, max: 89,  mid: 87 },
  "A":  { min: 82, max: 85,  mid: 83 },
  "A-": { min: 78, max: 81,  mid: 79 },
  "B+": { min: 73, max: 77,  mid: 75 },
  "B":  { min: 68, max: 72,  mid: 70 },
  "B-": { min: 63, max: 67,  mid: 65 },
  "C+": { min: 57, max: 62,  mid: 60 },
  "C":  { min: 51, max: 56,  mid: 53 },
  "C-": { min: 45, max: 50,  mid: 47 },
  "D+": { min: 35, max: 44,  mid: 40 },
  "D":  { min: 20, max: 34,  mid: 27 },
  "D-": { min: 0,  max: 19,  mid: 10 },
};

function clampBand(val, grade) {
  const b = BANDS[String(grade || "").trim()];
  if (!b) return null;
  if (typeof val !== "number" || !Number.isFinite(val)) return b.mid;
  return Math.max(b.min, Math.min(b.max, Math.round(val)));
}

function extractCompactExcerpt(analysis) {
  const txt = String(analysis || "");
  if (txt.length <= 2600) return txt;
  const sections = txt.split(/(?=^## \d+\.)/m);
  const picked = sections.filter((s) => /^## [0458]\./.test(s.trim()));
  const joined = (picked.length ? picked.join("\n\n") : txt).slice(0, 2800);
  return joined;
}

function buildPrompt(row) {
  const dBand = BANDS[row.aiDirectionRating] || { min: 0, max: 100 };
  const tBand = BANDS[row.aiTechniqueRating] || { min: 0, max: 100 };
  const oBand = BANDS[row.aiOverallRating] || { min: 0, max: 100 };
  return `あなたは日本のトップ映像ディレクター兼評価審査員です。
以下の既存AI分析レポートを読み、現行のS+〜D-ランクを据え置いたまま、各ランクの点数レンジ内で厳密な5観点×20点ルーブリック採点を行ってください。

対象作品: ${row.title} (ID: ${row.id})
現行ランク（据え置き）:
- 総合: ${row.aiOverallRating}（許容レンジ: ${oBand.min}〜${oBand.max}点）
- 演出: ${row.aiDirectionRating}（許容レンジ: ${dBand.min}〜${dBand.max}点）
- 技術: ${row.aiTechniqueRating}（許容レンジ: ${tBand.min}〜${tBand.max}点）

出力は必ず以下のJSONオブジェクト1つのみ（Markdownコードブロック不要）:
{
  "direction": {
    "hookAndStructure": 0..20,
    "originality": 0..20,
    "rhythmAndSync": 0..20,
    "worldAndSubject": 0..20,
    "intentAchievement": 0..20
  },
  "technique": {
    "cinematographyAndArt": 0..20,
    "editingAndMotion": 0..20,
    "colorAndLook": 0..20,
    "soundAndMix": 0..20,
    "polishAndFinish": 0..20
  },
  "synergyAdjustment": -5..5,
  "rationale": "同一ランク内でこの点数（上限寄り/中央/下限寄り）とした具体的根拠を1文で記載"
}

--- 分析レポート抜粋 ---
${extractCompactExcerpt(row.aiAnalysis)}`;
}

async function callLlm(prompt) {
  if (provider === "openai") {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) throw new Error(`OpenAI HTTP ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    return JSON.parse(data.choices[0].message.content);
  }
  if (provider === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });
    if (!resp.ok) throw new Error(`Gemini HTTP ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    return JSON.parse(data.candidates[0].content.parts[0].text);
  }
  throw new Error("No LLM API key found. Set OPENAI_API_KEY or GEMINI_API_KEY.");
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required.");
}

const doneIds = new Set();
if (existsSync(outPath)) {
  for (const line of readFileSync(outPath, "utf8").split(/\r?\n/).filter(Boolean)) {
    try {
      const obj = JSON.parse(line);
      if (obj?.id) doneIds.add(String(obj.id));
    } catch { /* skip */ }
  }
}

const needsTls = /tidbcloud\.com|psdb\.cloud|aivencloud\.com/i.test(process.env.DATABASE_URL);
const db = await mysql.createConnection({
  uri: process.env.DATABASE_URL,
  ...(needsTls ? { ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true } } : {}),
});

try {
  const [rows] = await db.query(
    `SELECT id, title, aiOverallRating, aiDirectionRating, aiTechniqueRating, aiAnalysis
     FROM videos
     WHERE aiAnalysis IS NOT NULL AND LENGTH(aiAnalysis) >= 1500
       AND aiOverallRating IS NOT NULL AND aiOverallRating != ''
     ORDER BY FIELD(aiOverallRating,'S+','S','S-','A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-')
     LIMIT ?`,
    [limit + doneIds.size],
  );
  const todo = rows.filter((r) => !doneIds.has(String(r.id))).slice(0, limit);
  if (dryRun || provider === "none") {
    console.log(JSON.stringify({ mode: "dry-run", provider, model, alreadyDone: doneIds.size, queued: todo.length, sampleIds: todo.slice(0, 5).map((r) => ({ id: r.id, rating: r.aiOverallRating, title: r.title })) }, null, 2));
    process.exit(0);
  }

  mkdirSync(dirname(outPath), { recursive: true });
  let completed = 0;
  let failed = 0;

  async function worker(queue) {
    while (queue.length > 0) {
      const row = queue.shift();
      try {
        const res = await callLlm(buildPrompt(row));
        const dSum = Object.values(res.direction || {}).reduce((a, b) => a + Math.max(0, Math.min(20, Math.round(Number(b) || 0))), 0);
        const tSum = Object.values(res.technique || {}).reduce((a, b) => a + Math.max(0, Math.min(20, Math.round(Number(b) || 0))), 0);
        const adj = Math.max(-5, Math.min(5, Math.round(Number(res.synergyAdjustment) || 0)));
        const dirScore = clampBand(dSum, row.aiDirectionRating);
        const techScore = clampBand(tSum, row.aiTechniqueRating);
        const baseOverall = (dirScore !== null && techScore !== null) ? Math.round(dirScore * 0.55 + techScore * 0.45) + adj : null;
        const overallScore = clampBand(baseOverall, row.aiOverallRating);

        const record = {
          id: row.id,
          aiOverallScore: overallScore,
          aiDirectionScore: dirScore,
          aiTechniqueScore: techScore,
          aiScoreBreakdown: {
            source: "rubric",
            version: "1.0",
            model,
            direction: res.direction,
            technique: res.technique,
            synergyAdjustment: adj,
            rationale: String(res.rationale || "").trim(),
          },
        };
        appendFileSync(outPath, JSON.stringify(record) + "\n", "utf8");
        completed += 1;
      } catch (err) {
        failed += 1;
        console.error(`[FAIL] ${row.id}:`, err instanceof Error ? err.message : String(err));
      }
    }
  }

  const queue = [...todo];
  await Promise.all(Array.from({ length: concurrency }, () => worker(queue)));
  console.log(JSON.stringify({ ok: true, provider, model, outPath, completed, failed }, null, 2));
} finally {
  await db.end();
}
