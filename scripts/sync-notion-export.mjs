/**
 * Notion video export synchronizer.
 * Dependencies: mysql2@3.15, csv-parse@7.0
 *
 * Usage:
 *   node scripts/sync-notion-export.mjs --csv /absolute/path/to/export_all.csv --dry-run
 *   node scripts/sync-notion-export.mjs --csv /absolute/path/to/export_all.csv --apply
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { config } from "dotenv";
import { parse } from "csv-parse/sync";
import mysql from "mysql2/promise";
import { buildExistingIndexes, findExistingVideo } from "./notion-dedupe.mjs";

config({ path: [".env.local", ".env"] });

const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const csvPath = getArg("--csv");
const apply = args.includes("--apply");
const limitArg = getArg("--limit");
const limit = limitArg ? Number.parseInt(limitArg, 10) : undefined;

if (!csvPath || (!apply && !args.includes("--dry-run"))) {
  throw new Error("Specify --csv <path> and either --dry-run or --apply.");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");

const LIST_FIELDS = [
  "purposes",
  "expressions",
  "toneEmotions",
  "toneVisuals",
  "toneTechniques",
  "productions",
];

const FIELD_MAP = {
  purposes: "用途",
  expressions: "表現",
  toneEmotions: "トンマナ（感情・ムード）",
  toneVisuals: "トンマナ（ビジュアル・スタイル）",
  toneTechniques: "トンマナ（技術・要素）",
  productions: "制作",
};

const genreByPurpose = new Map([
  ["MV", { name: "MV", slug: "mv" }],
  ["テレビCM", { name: "TV CM", slug: "tv-cm" }],
  ["TV CM", { name: "TV CM", slug: "tv-cm" }],
  ["Web CM", { name: "Web CM", slug: "web-cm" }],
  ["WebCM", { name: "Web CM", slug: "web-cm" }],
  ["プロモーション", { name: "Web CM", slug: "web-cm" }],
  ["ブランディングムービー", { name: "ブランデッドムービー", slug: "branded-movie" }],
  ["企業・サービス紹介", { name: "企業 / 商品VP / コンテスト映像", slug: "corporate" }],
  ["採用動画", { name: "企業 / 商品VP / コンテスト映像", slug: "corporate" }],
]);

function clean(value) {
  return String(value ?? "").trim();
}

function splitList(value) {
  return [...new Set(clean(value).split(/[、,\n]/).map((item) => item.trim()).filter(Boolean))];
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeDate(value) {
  const text = clean(value);
  const match = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function extractVideo(url, name = "") {
  const source = clean(url);
  const youtube = source.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/i);
  if (youtube) {
    const id = youtube[1];
    return {
      id,
      platform: "youtube",
      videoUrl: source,
      embedUrl: `https://www.youtube.com/embed/${id}`,
      thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    };
  }
  const vimeo = source.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vimeo) {
    const id = vimeo[1];
    return {
      id,
      platform: "vimeo",
      videoUrl: source,
      embedUrl: `https://player.vimeo.com/video/${id}`,
      thumbnail: null,
    };
  }
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const id = `notion-${createHash("sha256").update(`${source}|${clean(name)}`).digest("hex").slice(0, 24)}`;
    return { id, platform: "external", videoUrl: source, embedUrl: "", thumbnail: null };
  }
  return null;
}

function titleAndChannel(name) {
  const parts = clean(name).split(/\s+-\s+(?:YouTube|Vimeo)\s+-\s+/i);
  return {
    title: clean(parts[0]) || "Untitled video",
    channelTitle: clean(parts[1]),
  };
}

function buildMeta(row) {
  const values = Object.fromEntries(
    LIST_FIELDS.map((field) => [field, splitList(row[FIELD_MAP[field]])])
  );
  const purposes = values.purposes;
  const genres = [...new Map(
    purposes.map((purpose) => genreByPurpose.get(purpose)).filter(Boolean).map((tag) => [tag.slug, tag])
  ).values()];
  const allTags = [...new Set([
    ...values.purposes,
    ...values.expressions,
    ...values.toneEmotions,
    ...values.toneVisuals,
    ...values.toneTechniques,
    ...values.productions,
  ])];
  return {
    ...values,
    genres,
    allTags,
    privateRating: clean(row["私的評価"]),
    aiOverallRating: clean(row["AI評価（総合）"]),
    aiDirectionRating: clean(row["AI評価（ディレクション）"]),
    aiTechniqueRating: clean(row["AI評価（技術）"]),
    aiAnalysis: clean(row["AI分析結果"]).slice(0, 60000),
    addedDate: normalizeDate(row["追加日"]),
  };
}

function mergeTags(existing, fromNotion) {
  const existingNames = parseJsonArray(existing).map((tag) => typeof tag === "string" ? tag : tag?.name).filter(Boolean);
  return [...new Set([...existingNames, ...fromNotion])];
}

function dbConfig(databaseUrl) {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    ssl: url.searchParams.has("ssl") ? { rejectUnauthorized: true } : undefined,
  };
}

async function main() {
  const sourcePath = resolve(csvPath);
  const rows = parse(readFileSync(sourcePath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
  });
  const connection = await mysql.createConnection(dbConfig(process.env.DATABASE_URL));
  const [dbVideos] = await connection.query(
    "SELECT id, platform, title, thumbnail, videoUrl, embedUrl, source, sourceLabel, channelId, channelTitle, genres, products, directions, tones, allTags, purposes, expressions, toneEmotions, toneVisuals, toneTechniques, productions, privateRating, aiOverallRating, aiDirectionRating, aiTechniqueRating, aiAnalysis, addedDate FROM videos"
  );
  const existingIndexes = buildExistingIndexes(dbVideos);
  const uniqueRows = new Map();
  const report = {
    csvRows: rows.length,
    invalidUrlRows: 0,
    invalidUrlSamples: [],
    duplicateRowsInCsv: 0,
    existingMatches: 0,
    matchedById: 0,
    matchedByUrl: 0,
    newVideos: 0,
    skippedByLimit: 0,
    aiAnalysisTruncated: 0,
    affectedIds: [],
  };

  for (const row of rows) {
    const video = extractVideo(row.URL, row["名前"]);
    if (!video) {
      report.invalidUrlRows += 1;
      if (report.invalidUrlSamples.length < 10) {
        report.invalidUrlSamples.push({ name: clean(row["名前"]), url: clean(row.URL) });
      }
      continue;
    }
    if (uniqueRows.has(video.id)) {
      report.duplicateRowsInCsv += 1;
      continue;
    }
    uniqueRows.set(video.id, { row, video });
  }

  const operations = [...uniqueRows.values()];
  const selectedOperations = Number.isFinite(limit) ? operations.slice(0, limit) : operations;
  report.skippedByLimit = operations.length - selectedOperations.length;

  if (apply) await connection.beginTransaction();
  try {
    for (const { row, video } of selectedOperations) {
      const meta = buildMeta(row);
      const identity = titleAndChannel(row["名前"]);
      const match = findExistingVideo(existingIndexes, { ...video, title: identity.title });
      const existing = match.video;
      if (clean(row["AI分析結果"]).length > 60000) report.aiAnalysisTruncated += 1;
      if (existing) {
        report.existingMatches += 1;
        if (match.matchedBy === "id") report.matchedById += 1;
        else report.matchedByUrl += 1;
        if (apply) {
          await connection.execute(
            `UPDATE videos SET
              allTags = ?, purposes = ?, expressions = ?, toneEmotions = ?, toneVisuals = ?, toneTechniques = ?, productions = ?,
              privateRating = ?, aiOverallRating = ?, aiDirectionRating = ?, aiTechniqueRating = ?, aiAnalysis = ?, addedDate = ?
             WHERE id = ?`,
            [
              JSON.stringify(mergeTags(existing.allTags, meta.allTags)),
              JSON.stringify(meta.purposes), JSON.stringify(meta.expressions), JSON.stringify(meta.toneEmotions),
              JSON.stringify(meta.toneVisuals), JSON.stringify(meta.toneTechniques), JSON.stringify(meta.productions),
              meta.privateRating || null, meta.aiOverallRating || null, meta.aiDirectionRating || null,
              meta.aiTechniqueRating || null, meta.aiAnalysis || null, meta.addedDate || existing.addedDate || null, video.id,
            ]
          );
        }
      } else {
        report.newVideos += 1;
        if (apply) {
          await connection.execute(
            `INSERT INTO videos (
              id, platform, title, thumbnail, videoUrl, embedUrl, source, sourceLabel, channelId, channelTitle,
              genres, products, directions, tones, allTags, purposes, expressions, toneEmotions, toneVisuals, toneTechniques,
              productions, privateRating, aiOverallRating, aiDirectionRating, aiTechniqueRating, aiAnalysis, addedDate
            ) VALUES (?, ?, ?, ?, ?, ?, 'notion', 'Notion事例集', NULL, ?, ?, '[]', '[]', '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              video.id, video.platform, identity.title, video.thumbnail, video.videoUrl, video.embedUrl, identity.channelTitle || null,
              JSON.stringify(meta.genres), JSON.stringify(meta.allTags), JSON.stringify(meta.purposes), JSON.stringify(meta.expressions),
              JSON.stringify(meta.toneEmotions), JSON.stringify(meta.toneVisuals), JSON.stringify(meta.toneTechniques), JSON.stringify(meta.productions),
              meta.privateRating || null, meta.aiOverallRating || null, meta.aiDirectionRating || null, meta.aiTechniqueRating || null,
              meta.aiAnalysis || null, meta.addedDate || null,
            ]
          );
        }
      }
      if (report.affectedIds.length < 25) report.affectedIds.push(existing?.id || video.id);
    }
    if (apply) await connection.commit();
  } catch (error) {
    if (apply) await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }

  report.mode = apply ? "apply" : "dry-run";
  report.uniqueVideoRows = operations.length;
  const reportPath = resolve("/home/ubuntu/notion-import-20260812/notion_sync_report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
