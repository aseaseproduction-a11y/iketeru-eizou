import { readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const sqlPath = process.argv[2];
if (!sqlPath) throw new Error("Usage: node scripts/apply-metadata-classification-updates.mjs <updates.sql>");
const statements = readFileSync(sqlPath, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const databaseUrl = new URL(process.env.DATABASE_URL);
const db = await mysql.createConnection({ host: databaseUrl.hostname, port: databaseUrl.port ? Number(databaseUrl.port) : 3306, user: decodeURIComponent(databaseUrl.username), password: decodeURIComponent(databaseUrl.password), database: databaseUrl.pathname.replace(/^\//, ""), ssl: { rejectUnauthorized: false }, multipleStatements: true });
let result;
try {
  await db.beginTransaction();
  result = await db.query(statements.join("\n"));
  await db.commit();
} catch (error) {
  await db.rollback();
  throw error;
} finally {
  await db.end();
}
const affected = Array.isArray(result?.[0]) ? result[0].reduce((total, item) => total + Number(item.affectedRows || 0), 0) : 0;
const report = { completedAt: new Date().toISOString(), sqlPath, planned: statements.length, affected };
writeFileSync(`${sqlPath.replace(/\.sql$/, "")}_apply_result.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
