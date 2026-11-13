import { mkdirSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";
import {
  getProductionNames,
  getProductionRoles,
  normalizeProductionCredits,
} from "../shared/productionCredits.ts";

const outputDir = "/home/ubuntu/iketeru-eizou/analysis/production_tag_normalization";
const apply = process.argv.includes("--apply");
mkdirSync(outputDir, { recursive: true });

function parseStringArray(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string" && value.trim()) : [];
  } catch {
    return [];
  }
}

function parseCredits(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

const db = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 20, maxIdle: 20, idleTimeout: 60_000 });
try {
  const [rows] = await db.execute("SELECT id, title, productions, productionCredits, allTags, DATE_FORMAT(updatedAt, '%Y-%m-%d %H:%i:%s') AS updatedAtRaw FROM videos");
  const changes = [];
  const unresolved = [];

  for (const row of rows) {
    const productionsBefore = parseStringArray(row.productions);
    const creditsBefore = parseCredits(row.productionCredits);
    const creditsAfter = normalizeProductionCredits(creditsBefore, productionsBefore);

    if (productionsBefore.length > 0 && creditsAfter.length === 0) {
      unresolved.push({ id: String(row.id), title: String(row.title), productionsBefore, reason: "人物・会社名として安全に分離できない値を含むため自動更新しない" });
      continue;
    }

    const productionsAfter = getProductionNames(creditsAfter);
    const rolesAfter = getProductionRoles(creditsAfter);
    const rolesBefore = getProductionRoles(creditsBefore.filter((credit) => credit && typeof credit.name === "string" && Array.isArray(credit.roles)));
    const allTagsBefore = parseStringArray(row.allTags);
    const obsoleteProductionValues = new Set([
      ...productionsBefore.filter((value) => !productionsAfter.includes(value)),
      ...rolesBefore.filter((value) => !rolesAfter.includes(value)),
    ]);
    const allTagsAfter = Array.from(new Set([
      ...allTagsBefore.filter((tag) => !obsoleteProductionValues.has(tag)),
      ...productionsAfter.filter((value) => !allTagsBefore.includes(value)),
      ...rolesAfter.filter((value) => !allTagsBefore.includes(value)),
    ]));

    if (!sameJson(creditsBefore, creditsAfter) || !sameJson(productionsBefore, productionsAfter) || !sameJson(allTagsBefore, allTagsAfter)) {
      changes.push({
        id: String(row.id),
        title: String(row.title),
        productionsBefore,
        productionsAfter,
        creditsBefore,
        creditsAfter,
        rolesAfter,
        allTagsBefore,
        allTagsAfter,
        updatedAt: row.updatedAtRaw,
      });
    }
  }

  if (apply) {
    for (let offset = 0; offset < changes.length; offset += 20) {
      await Promise.all(changes.slice(offset, offset + 20).map((change) => db.execute(
        "UPDATE videos SET productions = ?, productionCredits = ?, allTags = ? WHERE id = ? AND updatedAt <=> ?",
        [
          JSON.stringify(change.productionsAfter),
          JSON.stringify(change.creditsAfter),
          JSON.stringify(change.allTagsAfter),
          change.id,
          change.updatedAt,
        ],
      )));
    }
  }

  const report = {
    mode: apply ? "apply" : "dry-run",
    generatedAt: new Date().toISOString(),
    totalVideos: rows.length,
    changedVideos: changes.length,
    unresolvedVideos: unresolved.length,
    unchangedVideos: rows.length - changes.length - unresolved.length,
    changes,
    unresolved,
  };
  const fileName = `${outputDir}/production_credits_${apply ? "apply" : "dry_run"}.json`;
  writeFileSync(fileName, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ mode: report.mode, totalVideos: report.totalVideos, changedVideos: report.changedVideos, unresolvedVideos: report.unresolvedVideos, report: fileName }, null, 2));
} finally {
  await db.end();
}
process.exit(0);
