import { mkdirSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const apply = process.argv.includes("--apply");
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/metadata_completion";
const unique = (items) => [...new Set(items)];

function inferExplicitValues(title, allTags) {
  const text = [title, ...allTags].join(" ");
  const purposes = [];
  const expressions = [];
  const rules = [];
  const add = (list, value, rule) => { if (!list.includes(value)) list.push(value); if (!rules.includes(rule)) rules.push(rule); };

  if (/(?:music\s*video|\bm\/?v\b|ミュージック[\s・-]*ビデオ)/i.test(text)) add(purposes, "MV", "title_or_official_tag_explicit_mv");
  if (/(?:tvc?m|\bcm\b|commercial|広告)/i.test(text)) add(purposes, "プロモーション", "title_or_official_tag_explicit_commercial");
  if (/(?:オープニング|エンディング|\bopening\b|\bending\b)/i.test(text)) add(purposes, "OPED", "title_or_official_tag_explicit_opening_ending");
  if (/(?:インタビュー|\binterview\b)/i.test(text)) add(purposes, "インタビュー", "title_or_official_tag_explicit_interview");
  if (/(?:ティザー|\bteaser\b)/i.test(text)) add(purposes, "ティザー", "title_or_official_tag_explicit_teaser");
  if (/(?:ブランディング(?:ムービー|映像|動画)?|brand\s*movie)/i.test(text)) add(purposes, "ブランディングムービー", "title_or_official_tag_explicit_brand_movie");
  if (/(?:事業紹介|サービス紹介|企業紹介|company\s*profile|service\s*introduction)/i.test(text)) add(purposes, "事業・サービス紹介", "title_or_official_tag_explicit_service_introduction");
  if (/(?:アートフィルム|art\s*film|\bアート\b)/i.test(text)) add(purposes, "アート", "title_or_official_tag_explicit_art");
  if (/(?:企画(?:映像|動画)?|campaign\s*(?:movie|film))/i.test(text)) add(purposes, "企画系", "title_or_official_tag_explicit_project");

  const animation = /(?:animation|アニメーション|animated|\banime\b|アニメ)/i.test(text);
  const liveAction = /(?:実写|live[\s-]*action)/i.test(text);
  if (/(?:生成\s*ai|generative\s*ai|ai[\s-]*generated)/i.test(text)) add(expressions, "生成AI", "title_or_official_tag_explicit_generative_ai");
  if (liveAction && animation) add(expressions, "実写+アニメーション", "title_or_official_tag_explicit_live_action_animation");
  else {
    if (liveAction) add(expressions, "実写", "title_or_official_tag_explicit_live_action");
    if (animation) add(expressions, "アニメーション", "title_or_official_tag_explicit_animation");
  }
  if (/(?:\b3d\b|\bcgi\b|\bcg\b)/i.test(text)) add(expressions, "3D", "title_or_official_tag_explicit_3d");
  if (/(?:\b2d\b)/i.test(text)) add(expressions, "2D", "title_or_official_tag_explicit_2d");
  if (/(?:illustration|イラスト)/i.test(text)) add(expressions, "イラスト", "title_or_official_tag_explicit_illustration");
  return { purposes: unique(purposes), expressions: unique(expressions), rules };
}

mkdirSync(outputDir, { recursive: true });
const db = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await db.execute("SELECT id, title, source, allTags, purposes, expressions FROM videos WHERE JSON_LENGTH(purposes) = 0 OR JSON_LENGTH(expressions) = 0");
const decisions = [];
try {
  for (const row of rows) {
    const existingPurposes = JSON.parse(row.purposes || "[]");
    const existingExpressions = JSON.parse(row.expressions || "[]");
    const allTags = JSON.parse(row.allTags || "[]");
    const inferred = inferExplicitValues(row.title || "", allTags);
    const nextPurposes = existingPurposes.length ? existingPurposes : inferred.purposes;
    const nextExpressions = existingExpressions.length ? existingExpressions : inferred.expressions;
    if (JSON.stringify(existingPurposes) === JSON.stringify(nextPurposes) && JSON.stringify(existingExpressions) === JSON.stringify(nextExpressions)) continue;
    decisions.push({ id: row.id, title: row.title, source: row.source, before: { purposes: existingPurposes, expressions: existingExpressions }, after: { purposes: nextPurposes, expressions: nextExpressions }, rules: inferred.rules });
    if (apply) await db.execute("UPDATE videos SET purposes = ?, expressions = ? WHERE id = ? AND (JSON_LENGTH(purposes) = 0 OR JSON_LENGTH(expressions) = 0)", [JSON.stringify(nextPurposes), JSON.stringify(nextExpressions), row.id]);
  }
} finally {
  await db.end();
}
const summary = { mode: apply ? "apply" : "dry-run", generatedAt: new Date().toISOString(), scanned: rows.length, updates: decisions.length, purposesFilled: decisions.filter((item) => item.before.purposes.length === 0 && item.after.purposes.length > 0).length, expressionsFilled: decisions.filter((item) => item.before.expressions.length === 0 && item.after.expressions.length > 0).length };
writeFileSync(`${outputDir}/explicit_purpose_expression_${apply ? "apply" : "dry_run"}.json`, `${JSON.stringify({ summary, decisions }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
process.exit(0);
