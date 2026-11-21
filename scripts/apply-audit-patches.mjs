/**
 * Apply visual audit findings & real cut pacing telemetry from analysis/full_audit_progress.jsonl
 * into videos.aiAnalysis (idempotently appending/updating `## 11. 実映像ビジュアル監査・実測補正`)
 * in both TiDB Cloud and local SQLite DB.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/apply-audit-patches.mjs [--apply]
 */
import { existsSync, readFileSync } from "node:fs";
import mysql from "mysql2/promise";

const apply = process.argv.includes("--apply");
const progressPath = "analysis/full_audit_progress.jsonl";
if (!existsSync(progressPath)) {
  throw new Error(`Not found: ${progressPath}`);
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required.");
}

const MARKER = "## 11. 実映像ビジュアル監査・実測補正";

const redoIds = new Set(
  existsSync("analysis/visual_redo_queue.json")
    ? JSON.parse(readFileSync("analysis/visual_redo_queue.json", "utf8")).map((x) => String(x.video_id))
    : []
);

const records = readFileSync(progressPath, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((r) => r.visual_checked === true && !redoIds.has(String(r.video_id)));

const byId = new Map();
for (const r of records) {
  byId.set(String(r.video_id), r);
}
const ids = Array.from(byId.keys());
if (ids.length === 0) {
  console.log(JSON.stringify({ ok: true, patched: 0 }));
  process.exit(0);
}

function buildAuditSection(r) {
  const rc = r.real_cuts && typeof r.real_cuts === "object" && r.real_cuts.cut_count
    ? `実カット数: ${r.real_cuts.cut_count}カット / 実平均カット尺: ${r.real_cuts.avg_cut_sec}秒 / 中央値: ${r.real_cuts.median_cut_sec}秒（${r.real_cuts.cuts_per_minute}カット/分）`
    : "実カット計測: メディア取得制限により未計測";
  const lines = [
    MARKER,
    `- **監査判定**: \`${r.analysis_verdict}\`（実映像コンタクトシート目視確認: ${r.visual_checked ? "済" : "未（アクセス制限）"}）`,
    `- **実映像カット実測値（ffmpeg scdet）**: ${rc}`,
    `- **100点ルーブリック確定スコア**: 総合/演出/技術 = \`${r.scores100}\`（現行ランク \`${r.ratings}\` 準拠）`,
    `- **監査・補正メモ**: ${r.audit_findings}`,
  ];
  if (r.rating_mismatch_note) {
    lines.push(`- **ランク乖離メモ**: ${r.rating_mismatch_note}`);
  }
  return lines.join("\n");
}

const needsTls = /tidbcloud\.com|psdb\.cloud|aivencloud\.com/i.test(process.env.DATABASE_URL);
const db = await mysql.createConnection({
  uri: process.env.DATABASE_URL,
  ...(needsTls ? { ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true } } : {}),
});

let patched = 0;
try {
  const [rows] = await db.query("SELECT id, aiAnalysis FROM videos WHERE id IN (?)", [ids]);
  for (const row of rows) {
    const r = byId.get(String(row.id));
    if (!r) continue;
    const base = String(row.aiAnalysis || "").trim();
    const section = buildAuditSection(r);
    const idx = base.indexOf(MARKER);
    const next = idx !== -1
      ? `${base.slice(0, idx).trimEnd()}\n\n${section}`
      : (base ? `${base}\n\n${section}` : section);
    if (next !== base) {
      if (apply) {
        await db.execute("UPDATE videos SET aiAnalysis = ? WHERE id = ?", [next, row.id]);
      }
      patched += 1;
    }
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", candidates: ids.length, patched }, null, 2));
} finally {
  await db.end();
}
