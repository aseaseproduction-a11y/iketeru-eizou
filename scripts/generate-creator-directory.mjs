import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const outputDir = "/home/ubuntu/iketeru-eizou/analysis/production_tag_normalization/current_creator_directory";
mkdirSync(outputDir, { recursive: true });

function parseJsonArray(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeVariantKey(value) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[\s・･._,，、:：/／()（）\[\]{}「」『』'"`’]/g, "");
}

function kanaToHiragana(value) {
  return value.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

function indexGroup(name, readings) {
  const source = kanaToHiragana((readings[0] || name).normalize("NFKC"));
  const head = source.charAt(0);
  if (/^[a-z]/i.test(head)) return head.toUpperCase();
  const rows = [
    ["あ", "あいうえお"],
    ["か", "かきくけこがぎぐげご"],
    ["さ", "さしすせそざじずぜぞ"],
    ["た", "たちつてとだぢづでど"],
    ["な", "なにぬねの"],
    ["は", "はひふへほばびぶべぼぱぴぷぺぽ"],
    ["ま", "まみむめも"],
    ["や", "やゆよ"],
    ["ら", "らりるれろ"],
    ["わ", "わをん"],
  ];
  return rows.find(([, chars]) => chars.includes(head))?.[0] || "他";
}

function splitTitle(value, length = 42) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > length ? `${compact.slice(0, length - 1)}…` : compact;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(fileName, headers, rows) {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  writeFileSync(path.join(outputDir, fileName), `\uFEFF${lines.join("\n")}\n`, "utf8");
}

function markdownTable(rows) {
  const lines = [
    "| 区分 | 見出し | 表記 | 読み | 役割 | 動画数 | 表記バリエーション | 確認フラグ |",
    "|---|---|---|---|---|---:|---|---|",
  ];
  for (const row of rows) {
    lines.push(`| ${row.entityTypeLabel} | ${row.indexGroup} | ${row.name.replaceAll("|", "\\|")} | ${row.readings.join("／") || "—"} | ${row.roles.join("／") || "—"} | ${row.videoCount} | ${row.variants.join("／") || "—"} | ${row.reviewFlags.join("／") || "—"} |`);
  }
  return lines.join("\n");
}

const db = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 10, maxIdle: 10, idleTimeout: 60_000 });

try {
  const [rows] = await db.execute(
    "SELECT id, title, productions, productionCredits FROM videos WHERE (productionCredits IS NOT NULL AND JSON_LENGTH(productionCredits) > 0) OR (productions IS NOT NULL AND JSON_LENGTH(productions) > 0)",
  );

  const entities = new Map();
  const unclassified = new Map();

  function registerCredit({ videoId, title, name, entityType, roles, reading, source }) {
    if (!name) return;
    const safeType = entityType === "person" || entityType === "company" ? entityType : "unclassified";
    if (safeType === "unclassified") {
      const record = unclassified.get(name) || { name, videoIds: new Set(), titles: new Set(), sources: new Set() };
      record.videoIds.add(videoId);
      record.titles.add(splitTitle(title));
      record.sources.add(source);
      unclassified.set(name, record);
      return;
    }

    const key = `${safeType}\u0000${name}`;
    const record = entities.get(key) || {
      entityType: safeType,
      name,
      roles: new Set(),
      readings: new Set(),
      videoIds: new Set(),
      titles: new Set(),
      variants: new Set([name]),
      sources: new Set(),
    };
    for (const role of roles) if (role) record.roles.add(role);
    if (reading) record.readings.add(reading);
    record.videoIds.add(videoId);
    record.titles.add(splitTitle(title));
    record.variants.add(name);
    record.sources.add(source);
    entities.set(key, record);
  }

  for (const row of rows) {
    const videoId = asTrimmedString(row.id);
    const title = asTrimmedString(row.title);
    const credits = parseJsonArray(row.productionCredits);
    const legacyProductions = parseJsonArray(row.productions).map(asTrimmedString).filter(Boolean);

    if (credits.length > 0) {
      for (const credit of credits) {
        if (!credit || typeof credit !== "object") continue;
        registerCredit({
          videoId,
          title,
          name: asTrimmedString(credit.name),
          entityType: asTrimmedString(credit.entityType),
          roles: Array.isArray(credit.roles) ? credit.roles.map(asTrimmedString).filter(Boolean) : [],
          reading: asTrimmedString(credit.reading),
          source: "productionCredits",
        });
      }
    }

    const creditedNames = new Set(credits.map((credit) => asTrimmedString(credit?.name)).filter(Boolean));
    for (const name of legacyProductions.filter((entry) => !creditedNames.has(entry))) {
      registerCredit({ videoId, title, name, entityType: "", roles: [], reading: "", source: "productions_only" });
    }
  }

  const exactRecords = [...entities.values()].map((record) => {
    const readings = [...record.readings].sort((a, b) => a.localeCompare(b, "ja"));
    const variants = [...record.variants].sort((a, b) => a.localeCompare(b, "ja"));
    const roles = [...record.roles].sort((a, b) => a.localeCompare(b, "ja"));
    const reviewFlags = [];
    if (readings.length === 0) reviewFlags.push("読み未設定");
    if (/[\n\r]|\s{2,}|[/:：／]/.test(record.name)) reviewFlags.push("名称形式要確認");
    return {
      ...record,
      readings,
      variants,
      roles,
      reviewFlags,
      videoCount: record.videoIds.size,
      indexGroup: indexGroup(record.name, readings),
      entityTypeLabel: record.entityType === "person" ? "人物" : "会社",
      sampleTitles: [...record.titles].sort((a, b) => a.localeCompare(b, "ja")).slice(0, 5),
      normalizedKey: normalizeVariantKey(record.name),
    };
  });

  const sameVariantKey = new Map();
  for (const record of exactRecords) {
    const key = `${record.entityType}\u0000${record.normalizedKey}`;
    const list = sameVariantKey.get(key) || [];
    list.push(record);
    sameVariantKey.set(key, list);
  }

  const variantGroups = [...sameVariantKey.entries()]
    .filter(([, records]) => records.length > 1)
    .map(([key, records]) => ({
      entityType: records[0].entityTypeLabel,
      normalizedKey: key.split("\u0000")[1],
      names: records.map((record) => record.name).sort((a, b) => a.localeCompare(b, "ja")),
      totalVideos: new Set(records.flatMap((record) => [...record.videoIds])).size,
      review: "正規化キーが一致する別表記。統合済みか、再確認が必要かを監査してください。",
    }));

  for (const record of exactRecords) {
    const matching = sameVariantKey.get(`${record.entityType}\u0000${record.normalizedKey}`) || [];
    if (matching.length > 1) record.reviewFlags.push("類似表記あり");
  }

  const groupOrder = ["あ", "か", "さ", "た", "な", "は", "ま", "や", "ら", "わ", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "他"];
  const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "variant" });
  exactRecords.sort((left, right) => {
    if (left.entityType !== right.entityType) return left.entityType === "person" ? -1 : 1;
    const groupDiff = groupOrder.indexOf(left.indexGroup) - groupOrder.indexOf(right.indexGroup);
    return groupDiff || collator.compare(left.readings[0] || left.name, right.readings[0] || right.name) || collator.compare(left.name, right.name);
  });

  const people = exactRecords.filter((record) => record.entityType === "person");
  const companies = exactRecords.filter((record) => record.entityType === "company");
  const flagged = exactRecords.filter((record) => record.reviewFlags.length > 0);

  const csvHeaders = ["entity_type", "index_group", "name", "reading", "roles", "video_count", "name_variants", "review_flags", "sample_video_titles", "source"];
  const csvRows = exactRecords.map((record) => [
    record.entityTypeLabel,
    record.indexGroup,
    record.name,
    record.readings.join(" / "),
    record.roles.join(" / "),
    record.videoCount,
    record.variants.join(" / "),
    record.reviewFlags.join(" / "),
    record.sampleTitles.join(" / "),
    [...record.sources].join(" / "),
  ]);
  writeCsv("creator_directory_all.csv", csvHeaders, csvRows);
  writeCsv("creator_directory_people.csv", csvHeaders, csvRows.filter((row) => row[0] === "人物"));
  writeCsv("creator_directory_companies.csv", csvHeaders, csvRows.filter((row) => row[0] === "会社"));
  writeCsv(
    "creator_name_variant_candidates.csv",
    ["entity_type", "normalized_key", "candidate_names", "total_video_count", "review_note"],
    variantGroups.map((group) => [group.entityType, group.normalizedKey, group.names.join(" / "), group.totalVideos, group.review]),
  );
  writeCsv(
    "creator_unclassified_legacy_values.csv",
    ["name", "video_count", "sample_video_titles", "source"],
    [...unclassified.values()]
      .sort((a, b) => collator.compare(a.name, b.name))
      .map((record) => [record.name, record.videoIds.size, [...record.titles].slice(0, 5).join(" / "), [...record.sources].join(" / ")]),
  );

  const summary = [
    "# 制作クレジット人物・会社一覧（表記揺れ監査用）",
    "",
    `生成日時: ${new Date().toISOString()}`,
    "",
    "| 区分 | 名称数 | クレジット対象動画数 |",
    "|---|---:|---:|",
    `| 人物 | ${people.length} | ${new Set(people.flatMap((record) => [...record.videoIds])).size} |`,
    `| 会社 | ${companies.length} | ${new Set(companies.flatMap((record) => [...record.videoIds])).size} |`,
    `| 未分類の旧制作値 | ${unclassified.size} | ${new Set([...unclassified.values()].flatMap((record) => [...record.videoIds])).size} |`,
    `| 表記・読みの確認フラグ付き | ${flagged.length} | — |`,
    `| 正規化キー重複の候補群 | ${variantGroups.length} | — |`,
    "",
    "> この一覧は `productionCredits` の `entityType` が `person` または `company` の値を正として集計しています。旧 `productions` にのみ残る値は、誤って人物・会社へ推定分類せず、別CSVへ分離しています。",
    "",
    "## 人物",
    "",
    markdownTable(people),
    "",
    "## 会社",
    "",
    markdownTable(companies),
    "",
    "## 表記・読みの確認が必要な候補",
    "",
    flagged.length > 0 ? markdownTable(flagged) : "該当なし。",
    "",
    "## 正規化キーが一致する別表記候補",
    "",
    variantGroups.length > 0
      ? [
          "| 区分 | 正規化キー | 候補表記 | 動画数 | 確認内容 |",
          "|---|---|---|---:|---|",
          ...variantGroups.map((group) => `| ${group.entityType} | ${group.normalizedKey} | ${group.names.join("／")} | ${group.totalVideos} | ${group.review} |`),
        ].join("\n")
      : "該当なし。",
    "",
    "## 確認時の補助ファイル",
    "",
    "- `creator_directory_all.csv`: 人物・会社の全行。Excel等で並べ替え・フィルタリング用。",
    "- `creator_directory_people.csv` / `creator_directory_companies.csv`: 区分別の一覧。",
    "- `creator_name_variant_candidates.csv`: 大文字小文字・空白・記号を除いた正規化キーが一致する候補。",
    "- `creator_unclassified_legacy_values.csv`: entityType未分類の旧制作値。人名・会社名に推定分類せず、個別監査用に分離。",
    "",
  ];
  writeFileSync(path.join(outputDir, "creator_directory_audit.md"), `${summary.join("\n")}\n`, "utf8");

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceVideoRows: rows.length,
    people: people.length,
    companies: companies.length,
    unclassifiedLegacyValues: unclassified.size,
    flaggedRecords: flagged.length,
    variantCandidateGroups: variantGroups.length,
    files: [
      "creator_directory_audit.md",
      "creator_directory_all.csv",
      "creator_directory_people.csv",
      "creator_directory_companies.csv",
      "creator_name_variant_candidates.csv",
      "creator_unclassified_legacy_values.csv",
    ],
  };
  writeFileSync(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(manifest, null, 2));
} finally {
  await db.end();
}
process.exit(0);
