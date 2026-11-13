/**
 * production credit quality audit
 * Node.js 22 / mysql2 3.x
 *
 * Target schema (audit rows):
 * { id: string, title: string, source: 'productionCredits'|'productions', raw: string,
 *   issues: string[], suggestedAction: 'split'|'canonicalize'|'remove'|'review' }
 *
 * This script is intentionally read-only. It emits JSON reports and never updates videos.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { canonicalizeProductionName, normalizeProductionRole } from "../shared/productionCredits.ts";

const outputDir = "/home/ubuntu/iketeru-eizou/analysis/production_tag_normalization";
mkdirSync(outputDir, { recursive: true });

const ROLE_WORDS = /(?:creative\s*director|art\s*director|director|producer|production\s*manager|production\s*company|production|agency|account\s*executive|assistant|designer|developer|animator|animation|2d\s*animation|3dcg|music\s*video|music|sound|pr|business|web\s*(?:art\s*)?director|web\s*designer|character\s*designer|ロケ(?:ーション)?コーディネーター|キャラクターデザイナー|アカウントエグゼクティブ|アシスタント|クリエイティブ|プロダクション[・\s]*マネージャー|デザイナー|デベロッパー|演出|担当者|統括責任者|営業|ビジネス|コンテンツ|海外ロケーションコーディネーター|ロケコーディネーター|アートディレクション|アニメ|音楽|制作会社|関連会社|制作|監督|編集|撮影|美術)/i;
const ROLE_ONLY = /^(?:music|director|designer|2d\s*animation(?:animation)?(?:music\s*video)?|3dcg(?:animation)?(?:music\s*video)?|animation(?:music\s*video)?|promotion|pv|tv|director\s*\/\s*animator|スタジオぴえろ\s*アニメ)$/i;
const LABEL_PREFIX = /^(?:制作会社・関連会社\([^)]*\)|制作会社・関連会社|プロダクション|担当者)\s*[:：]/;
const SPLIT_DELIMITER = /[\/／、,，\n]/;
const MULTI_ROLE_PATTERN = /(?:\b(?:director|designer|assistant|pr|music|animation|3dcg|production|business|developer)\b|アシスタント|アカウントエグゼクティブ|クリエイティブ|デザイナー|デベロッパー|演出|PR|統括責任者|営業|コーディネーター|アートディレクション)/gi;

function parseJsonArray(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function assess(raw) {
  const value = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  const issues = [];
  const roleMatches = value.match(MULTI_ROLE_PATTERN) ?? [];
  const canonical = canonicalizeProductionName(value);
  if (ROLE_ONLY.test(value) || normalizeProductionRole(value)) issues.push("role_only_name");
  if (LABEL_PREFIX.test(value)) issues.push("label_prefix");
  if (SPLIT_DELIMITER.test(value)) issues.push("multiple_entities_delimiter");
  if (/\bby\b/i.test(value)) issues.push("affiliation_or_connector");
  if (/\([^)]*(?:KOO-KI|inc\.?|株式会社|studio|agency)[^)]*\)/i.test(value)) issues.push("affiliation_parenthetical");
  if (ROLE_WORDS.test(value) && (roleMatches.length >= 1 || /\s(?:アシスタント|演出|PR|クリエイティブ|デザイナー|ビジネス|コンテンツ)\s*$/i.test(value))) issues.push("role_mixed_into_name");
  if (roleMatches.length >= 2) issues.push("multiple_role_name_chain");
  if (canonical !== value) issues.push("known_canonical_alias");

  const suggestedAction = issues.includes("role_only_name")
    ? "remove"
    : issues.some((issue) => ["label_prefix", "multiple_entities_delimiter", "role_mixed_into_name", "multiple_role_name_chain"].includes(issue))
      ? "split"
      : issues.includes("known_canonical_alias")
        ? "canonicalize"
        : "review";
  return { value, canonical, issues, suggestedAction };
}

const db = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 10, maxIdle: 10, idleTimeout: 60_000 });
try {
  const [rows] = await db.execute("SELECT id, title, productions, productionCredits FROM videos WHERE (productions IS NOT NULL AND JSON_LENGTH(productions) > 0) OR (productionCredits IS NOT NULL AND JSON_LENGTH(productionCredits) > 0)");
  const findings = [];

  for (const row of rows) {
    const credits = parseJsonArray(row.productionCredits);
    credits.forEach((credit) => {
      if (!credit || typeof credit.name !== "string") return;
      const assessment = assess(credit.name);
      if (assessment.issues.length) {
        findings.push({ id: String(row.id), title: String(row.title), source: "productionCredits", raw: credit.name, ...assessment });
      }
    });
    parseJsonArray(row.productions).forEach((production) => {
      if (typeof production !== "string") return;
      const assessment = assess(production);
      if (assessment.issues.length) {
        findings.push({ id: String(row.id), title: String(row.title), source: "productions", raw: production, ...assessment });
      }
    });
  }

  const issueCounts = Object.fromEntries(
    Array.from(new Set(findings.flatMap((finding) => finding.issues))).sort().map((issue) => [issue, findings.filter((finding) => finding.issues.includes(issue)).length]),
  );
  const actionCounts = Object.fromEntries(["split", "canonicalize", "remove", "review"].map((action) => [action, findings.filter((finding) => finding.suggestedAction === action).length]));
  const report = {
    generatedAt: new Date().toISOString(),
    scannedVideos: rows.length,
    findingCount: findings.length,
    issueCounts,
    actionCounts,
    findings,
  };
  const output = `${outputDir}/production_credit_quality_audit.json`;
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ scannedVideos: rows.length, findingCount: findings.length, issueCounts, actionCounts, report: output }, null, 2));
} finally {
  await db.end();
}
