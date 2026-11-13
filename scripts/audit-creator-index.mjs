/**
 * Creator index quality audit (read-only)
 * Node.js 22 / mysql2 3.x
 *
 * Reports the exact set of creator names that currently fall into "他",
 * navigation/UI strings that leaked into credits, and role families that
 * should not participate in a video-production creator filter.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import mysql from "mysql2/promise";

const outputDir = "/home/ubuntu/iketeru-eizou/analysis/production_tag_normalization";
const outputPath = `${outputDir}/creator_index_quality_audit.json`;
const inferencePath = `${outputDir}/creator_reading_inference.json`;
mkdirSync(outputDir, { recursive: true });

const JAPANESE_BOUNDARIES = [
  ["あ", "あ", "か"], ["か", "か", "さ"], ["さ", "さ", "た"], ["た", "た", "な"], ["な", "な", "は"],
  ["は", "は", "ま"], ["ま", "ま", "や"], ["や", "や", "ら"], ["ら", "ら", "わ"], ["わ", "わ", "ん"],
];
const collator = new Intl.Collator("ja", { usage: "sort", sensitivity: "base" });
const NAVIGATION_PATTERN = /^(?:←|→|‹|›|前の投稿|次の投稿|previous\s+post|next\s+post|back\s+to|browse\s+by|all\s+works?\b)/i;
const INLINE_ROLE_PATTERN = /(?:\bvocals?\s+(?:performed\s+)?by\b|\bperformed\s+by\b|\bvocal(?:ist)?\b|\bsinger\b|\bmusic\s*(?:by|:)|\bsound\s*(?:by|:))/i;
const NON_VIDEO_ROLE_PATTERN = /^(?:歌唱|ボーカル|vocal(?:s|ist)?|singer|演奏|performer|作詞|作曲|編曲|music|music direction|sound direction|mix(?:ing)?|master(?:ing)?|マスタリング|ミキシング|サウンドディレクション|ボーカルディレクション)$/i;
const inferredSections = existsSync(inferencePath)
  ? new Map(JSON.parse(readFileSync(inferencePath, "utf8")).inferred.map((entry) => [entry.name, entry.section]))
  : new Map();

function parseJsonArray(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getSection(rawName) {
  const name = String(rawName ?? "").normalize("NFKC").trim();
  if (!name) return "他";
  const inferred = inferredSections.get(name);
  if (inferred) return inferred;
  const latin = name.match(/^[A-Za-z]/)?.[0];
  if (latin) return latin.toUpperCase();
  const kana = name[0]?.replace(/[ァ-ヶ]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60));
  if (kana && /[ぁ-ん]/.test(kana)) return JAPANESE_BOUNDARIES.find(([, start, end]) => kana >= start && kana < end)?.[0] ?? "わ";
  return JAPANESE_BOUNDARIES.find(([, start, end]) => collator.compare(name, start) >= 0 && collator.compare(name, end) < 0)?.[0] ?? "他";
}

const db = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 10, maxIdle: 10, idleTimeout: 60_000 });
try {
  const [rows] = await db.execute("SELECT id, title, productionCredits FROM videos WHERE productionCredits IS NOT NULL AND JSON_LENGTH(productionCredits) > 0");
  const otherNames = new Map();
  const navigationCredits = [];
  const inlineRoleNames = [];
  const roleCounts = new Map();
  const nonVideoRoleCounts = new Map();

  for (const row of rows) {
    for (const credit of parseJsonArray(row.productionCredits)) {
      if (!credit || typeof credit.name !== "string") continue;
      const name = credit.name.normalize("NFKC").trim();
      const roles = Array.isArray(credit.roles) ? credit.roles.filter((role) => typeof role === "string") : [];
      roles.forEach((role) => {
        roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
        if (NON_VIDEO_ROLE_PATTERN.test(role.trim())) nonVideoRoleCounts.set(role, (nonVideoRoleCounts.get(role) ?? 0) + 1);
      });
      if (NAVIGATION_PATTERN.test(name)) navigationCredits.push({ id: row.id, title: row.title, name, roles });
      if (INLINE_ROLE_PATTERN.test(name)) inlineRoleNames.push({ id: row.id, title: row.title, name, roles });
      if (getSection(name) === "他") {
        const current = otherNames.get(name) ?? { name, count: 0, roles: new Set(), samples: [] };
        current.count += 1;
        roles.forEach((role) => current.roles.add(role));
        if (current.samples.length < 3) current.samples.push({ id: row.id, title: row.title });
        otherNames.set(name, current);
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    scannedVideos: rows.length,
    otherNameCount: otherNames.size,
    otherNames: Array.from(otherNames.values()).map((entry) => ({ ...entry, roles: Array.from(entry.roles) })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja")),
    navigationCreditCount: navigationCredits.length,
    navigationCredits,
    inlineRoleNameCount: inlineRoleNames.length,
    inlineRoleNames,
    nonVideoRoleCounts: Object.fromEntries(Array.from(nonVideoRoleCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))),
    roleCounts: Object.fromEntries(Array.from(roleCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))),
  };
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ scannedVideos: report.scannedVideos, otherNameCount: report.otherNameCount, navigationCreditCount: report.navigationCreditCount, inlineRoleNameCount: report.inlineRoleNameCount, outputPath }, null, 2));
} finally {
  await db.end();
}
