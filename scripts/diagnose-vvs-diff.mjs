import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const logRep = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "visual_log_verification.json"), "utf8"));
const logVerSet = new Set(logRep.log_verified_ids.map(String));
const unvSet = new Set(logRep.unverifiable_no_log_self_true_ids.map(String));

const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});

const allCheck = [...logVerSet, ...unvSet];
const missingLogVer = [];
const missingUnv = [];

for (let i = 0; i < allCheck.length; i += 200) {
  const slice = allCheck.slice(i, i + 200);
  const ph = slice.map(() => "?").join(",");
  const [rows] = await conn.query(
    `SELECT id, title, JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.visualVerificationStatus')) AS vvs,
            JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.source')) AS src
       FROM videos WHERE id IN (${ph})`,
    slice
  );
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  for (const id of slice) {
    const r = byId.get(id);
    if (logVerSet.has(id) && (!r || r.vvs !== "log_verified")) {
      missingLogVer.push({ id, foundOnTidb: Boolean(r), actualVvs: r?.vvs ?? null, source: r?.src ?? null, title: r?.title ?? null });
    }
    if (unvSet.has(id) && (!r || r.vvs !== "unverifiable_no_log")) {
      missingUnv.push({ id, foundOnTidb: Boolean(r), actualVvs: r?.vvs ?? null, source: r?.src ?? null, title: r?.title ?? null });
    }
  }
}

await conn.end();
console.log(JSON.stringify({
  expectedLogVerified: logVerSet.size,
  missingLogVerifiedOnTidb: missingLogVer,
  expectedUnverifiable: unvSet.size,
  missingUnverifiableOnTidb: missingUnv,
}, null, 2));
