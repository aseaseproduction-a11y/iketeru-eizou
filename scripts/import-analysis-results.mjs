import mysql from "mysql2/promise";
import { readFile, writeFile } from "node:fs/promises";
import { matchesAnalysisIdentity } from "./analysis-identity.mjs";

const inputPath = process.argv[2];
const apply = process.argv.includes("--apply");
const reportPath = process.argv.find((arg) => arg.startsWith("--report="))?.slice(9)
  || "/home/ubuntu/iketeru-eizou/analysis/analysis_import_report.json";

if (!inputPath) {
  throw new Error("Usage: node scripts/import-analysis-results.mjs <map-results.json> [--apply] [--report=/absolute/path]");
}

const RATING_SET = new Set(["S", "A", "A-", "B+", "B", "B-", "C"]);

function parseStringArray(raw) {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(value)
      ? [...new Set(value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))]
      : [];
  } catch {
    return [];
  }
}

function parseTagArray(raw) {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(value)
      ? value
          .filter((item) => item && typeof item.name === "string" && item.name.trim())
          .map((item) => ({
            name: item.name.trim().slice(0, 120),
            slug: (typeof item.slug === "string" && item.slug.trim()
              ? item.slug.trim()
              : item.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"))
              .slice(0, 120),
          }))
      : [];
  } catch {
    return [];
  }
}

function rating(value) {
  return RATING_SET.has(value) ? value : "B";
}

function conservativeAnalysis({ title, existingMetadata }) {
  const existingTags = [
    ...parseStringArray(existingMetadata?.allTags),
    ...parseStringArray(existingMetadata?.purposes),
    ...parseStringArray(existingMetadata?.expressions),
  ];
  const tagText = existingTags.length ? existingTags.slice(0, 12).join("、") : "既存の登録メタデータなし";
  return [
    "■ 分析根拠",
    "映像本編へ十分にアクセスできなかったため、この記録はタイトル・チャンネル・既存メタデータに基づく暫定分析です。映像内の具体的なカット、色、編集、音、演技を断定していません。実映像を確認できた時点で詳細分析に更新します。",
    "",
    "■ 暫定的な位置づけ",
    `対象作品：${title || "無題"}。既存の関連情報は「${tagText}」。タイトルと登録情報から想定される目的・文脈を検索可能な形で維持しつつ、映像表現の評価は保留とします。`,
    "",
    "■ 次の確認事項",
    "冒頭のフック、構成転換点、画面設計、編集リズム、音設計、商品または主題の見せ方を実視聴で確認し、根拠付きの詳細分析へ差し替えること。",
  ].join("\n");
}

function mergedAllTags(output) {
  const categoryNames = [
    ...parseTagArray(output.genres),
    ...parseTagArray(output.products),
    ...parseTagArray(output.directions),
    ...parseTagArray(output.tones),
  ].map((tag) => tag.name);
  return [...new Set([
    ...categoryNames,
    ...parseStringArray(output.purposes),
    ...parseStringArray(output.expressions),
    ...parseStringArray(output.tone_emotions),
    ...parseStringArray(output.tone_visuals),
    ...parseStringArray(output.tone_techniques),
    ...parseStringArray(output.productions),
  ])];
}

async function resolveTarget(result, output) {
  const inputReference = typeof result?.input === "string" ? result.input : "";
  if (inputReference.endsWith(".json")) {
    try {
      const inputPayload = JSON.parse(await readFile(inputReference, "utf8"));
      if (inputPayload?.target?.id) {
        return {
          id: String(inputPayload.target.id),
          title: String(inputPayload.target.title || ""),
          videoUrl: String(inputPayload.target.videoUrl || ""),
        };
      }
    } catch {
      // Mapの入力ファイルが利用できない場合は、モデルが返したIDへ安全にフォールバックする。
    }
  }
  return output?.id ? { id: String(output.id), title: "", videoUrl: "" } : null;
}

const payload = JSON.parse(await readFile(inputPath, "utf8"));
const results = Array.isArray(payload.results) ? payload.results : [];
const connection = await mysql.createConnection(process.env.DATABASE_URL);
const report = { inputPath, apply, processed: 0, updatedVideoViewed: 0, updatedMetadataOnly: 0, idRecoveredFromInput: 0, skipped: [], errors: [] };

try {
  for (const result of results) {
    const output = result?.output;
    if (!output || result?.error) {
      report.skipped.push({ reason: "analysis_failed", input: result?.input ?? "", error: result?.error ?? "" });
      continue;
    }
    const target = await resolveTarget(result, output);
    if (!target?.id) {
      report.skipped.push({ reason: "missing_output_or_id", input: result?.input ?? "" });
      continue;
    }
    const targetId = target.id;
    if (targetId !== String(output?.id || "")) report.idRecoveredFromInput += 1;

    const [existingRows] = await connection.execute(
      `SELECT id, title, videoUrl, allTags, purposes, expressions, toneEmotions, toneVisuals, toneTechniques, productions
       FROM videos WHERE id = ? LIMIT 1`,
      [targetId]
    );
    const existing = existingRows[0];
    if (!existing) {
      report.skipped.push({ id: targetId, reason: "video_not_found" });
      continue;
    }
    if (!matchesAnalysisIdentity({ target, existing, output })) {
      report.skipped.push({ id: targetId, reason: "analysis_identity_mismatch" });
      continue;
    }

    const videoViewed = output.analysis_basis === "video_viewed" && Number(output.confidence) >= 0.8;
    const aiAnalysis = videoViewed
      ? String(output.ai_analysis || "").trim()
      : conservativeAnalysis({ title: existing.title, existingMetadata: existing });

    if (!aiAnalysis) {
      report.skipped.push({ id: targetId, reason: "empty_analysis" });
      continue;
    }

    if (apply) {
      if (videoViewed) {
        const genres = parseTagArray(output.genres);
        const products = parseTagArray(output.products);
        const directions = parseTagArray(output.directions);
        const tones = parseTagArray(output.tones);
        await connection.execute(
          `UPDATE videos SET genres = ?, products = ?, directions = ?, tones = ?, allTags = ?,
             purposes = ?, expressions = ?, toneEmotions = ?, toneVisuals = ?, toneTechniques = ?, productions = ?,
             privateRating = ?, aiOverallRating = ?, aiDirectionRating = ?, aiTechniqueRating = ?, aiAnalysis = ?, updatedAt = NOW()
           WHERE id = ?`,
          [
            JSON.stringify(genres), JSON.stringify(products), JSON.stringify(directions), JSON.stringify(tones),
            JSON.stringify(mergedAllTags(output)), JSON.stringify(parseStringArray(output.purposes)),
            JSON.stringify(parseStringArray(output.expressions)), JSON.stringify(parseStringArray(output.tone_emotions)),
            JSON.stringify(parseStringArray(output.tone_visuals)), JSON.stringify(parseStringArray(output.tone_techniques)),
            JSON.stringify(parseStringArray(output.productions)), rating(output.private_rating),
            rating(output.ai_overall_rating), rating(output.ai_direction_rating), rating(output.ai_technique_rating),
            aiAnalysis, targetId,
          ]
        );
      } else {
        await connection.execute(
          `UPDATE videos SET aiAnalysis = ?, updatedAt = NOW() WHERE id = ?`,
          [aiAnalysis, targetId]
        );
      }
    }

    report.processed += 1;
    if (videoViewed) report.updatedVideoViewed += 1;
    else report.updatedMetadataOnly += 1;
  }
} catch (error) {
  report.errors.push({ message: error instanceof Error ? error.message : String(error) });
  throw error;
} finally {
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  await connection.end();
}

console.log(JSON.stringify(report));
process.exit(0);
