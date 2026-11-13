/**
 * Creator reading inference (local and reproducible)
 * kuromoji==0.1.2 / @types/kuromoji==0.1.3
 *
 * Input schema: [{ name: string, count: number, roles: string[], samples: unknown[] }]
 * Output schema: [{ name: string, readingHiragana: string, section: string,
 *   confidence: 'inferred', method: 'kuromoji-local', count: number }]
 *
 * This script is read-only. It never modifies videos. The generated report is
 * reviewed before creating the runtime index map. Names with no usable Japanese
 * reading remain absent from the report rather than receiving an invented value.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import kuromoji from "kuromoji";

const require = createRequire(import.meta.url);
const root = "/home/ubuntu/iketeru-eizou";
const inputPath = `${root}/analysis/production_tag_normalization/creator_index_quality_audit.json`;
const outputPath = `${root}/analysis/production_tag_normalization/creator_reading_inference.json`;
const dictPath = path.join(path.dirname(require.resolve("kuromoji")), "..", "dict");

const entries = JSON.parse(readFileSync(inputPath, "utf8")).otherNames;
if (!Array.isArray(entries)) throw new Error("creator index audit does not contain otherNames");
if (!existsSync(dictPath)) throw new Error(`kuromoji dictionary not found: ${dictPath}`);

function buildTokenizer() {
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: dictPath }).build((error, tokenizer) => {
      if (error) reject(error);
      else resolve(tokenizer);
    });
  });
}

function toHiragana(value) {
  return value.replace(/[ァ-ヶ]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60));
}

function getSection(reading) {
  const first = reading[0];
  if (!first) return "他";
  if (first >= "あ" && first < "か") return "あ";
  if (first >= "か" && first < "さ") return "か";
  if (first >= "さ" && first < "た") return "さ";
  if (first >= "た" && first < "な") return "た";
  if (first >= "な" && first < "は") return "な";
  if (first >= "は" && first < "ま") return "は";
  if (first >= "ま" && first < "や") return "ま";
  if (first >= "や" && first < "ら") return "や";
  if (first >= "ら" && first < "わ") return "ら";
  if (first >= "わ" && first <= "ん") return "わ";
  return "他";
}

const tokenizer = await buildTokenizer();
const inferred = [];
const skipped = [];

for (const entry of entries) {
  const name = String(entry?.name ?? "").normalize("NFKC").trim();
  if (!/[\u3400-\u9fff]/.test(name)) continue;
  const tokens = tokenizer.tokenize(name);
  const readingKatakana = tokens.map((token) => token.reading && token.reading !== "*" ? token.reading : "").join("");
  const readingHiragana = toHiragana(readingKatakana);
  const section = getSection(readingHiragana);
  if (!readingHiragana || section === "他") {
    skipped.push({ name, count: entry.count, reason: "local tokenizer could not infer a usable initial reading" });
    continue;
  }
  inferred.push({
    name,
    readingHiragana,
    section,
    confidence: "inferred",
    method: "kuromoji-local",
    count: entry.count,
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  inputOtherNameCount: entries.length,
  inferredCount: inferred.length,
  skippedCount: skipped.length,
  inferred,
  skipped,
};
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ inputOtherNameCount: entries.length, inferredCount: inferred.length, skippedCount: skipped.length, outputPath }, null, 2));
