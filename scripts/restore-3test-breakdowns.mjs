import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

// Read original rubric_100pt.jsonl entries for 1154382470 and Z_lbVlhO9HE
const rubMap = new Map();
for (const line of fs.readFileSync(path.join(REPO_ROOT, "analysis", "rubric_100pt.jsonl"), "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  const o = JSON.parse(line);
  if (o.id === "1154382470" || o.id === "Z_lbVlhO9HE") {
    rubMap.set(o.id, o);
  }
}

const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});

for (const [id, orig] of rubMap.entries()) {
  const bd = { ...(orig.aiScoreBreakdown || {}) };
  if (id === "1154382470") {
    bd.analysisStatus = "provisional";
    bd.isProvisional = true;
  } else {
    bd.analysisStatus = "verified";
    bd.isProvisional = false;
  }
  // Keep original TiDB scores (90/90/86 for 1154382470, 87/88/84 for Z_lbVlhO9HE)
  const dirSum = Object.values(bd.direction || {}).reduce((a, b) => a + Number(b || 0), 0);
  const techSum = Object.values(bd.technique || {}).reduce((a, b) => a + Number(b || 0), 0);
  const targetD = id === "1154382470" ? 90 : 88;
  const targetT = id === "1154382470" ? 86 : 84;
  if (dirSum !== targetD && bd.direction) {
    const keys = Object.keys(bd.direction);
    let diff = targetD - dirSum;
    for (let i = 0; diff !== 0 && i < 100; i++) {
      const k = keys[i % keys.length];
      if (diff > 0 && bd.direction[k] < 20) { bd.direction[k]++; diff--; }
      else if (diff < 0 && bd.direction[k] > 0) { bd.direction[k]--; diff++; }
    }
  }
  if (techSum !== targetT && bd.technique) {
    const keys = Object.keys(bd.technique);
    let diff = targetT - techSum;
    for (let i = 0; diff !== 0 && i < 100; i++) {
      const k = keys[i % keys.length];
      if (diff > 0 && bd.technique[k] < 20) { bd.technique[k]++; diff--; }
      else if (diff < 0 && bd.technique[k] > 0) { bd.technique[k]--; diff++; }
    }
  }
  await conn.query("UPDATE videos SET aiScoreBreakdown = ? WHERE id = ?", [JSON.stringify(bd), id]);
  console.log("Restored full breakdown for", id, "dirSum=", Object.values(bd.direction || {}).reduce((a,b)=>a+b,0), "techSum=", Object.values(bd.technique || {}).reduce((a,b)=>a+b,0));
}
await conn.end();
