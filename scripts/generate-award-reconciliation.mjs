import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const basePlan = JSON.parse(readFileSync("/home/ubuntu/award-winners-import/db_import_plan.json", "utf8"));
const recheckPlan = JSON.parse(readFileSync("/home/ubuntu/award-winners-import/recheck_verified_import_plan.json", "utf8"));
const globalPlan = JSON.parse(readFileSync("/home/ubuntu/award-winners-import/additional_global_awards_import_plan.json", "utf8"));
const dadPlan = JSON.parse(readFileSync("/home/ubuntu/award-winners-import/dad_verified_import_plan.json", "utf8"));
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/award_recheck";
const invalidAwardName = "PFFアワードの過去受賞作を調査しました。2022年から2025年までの公式受賞作品（グランプリ、準グランプリ、審査員特別賞、エンタテインメント賞、映画ファン賞、観客賞など）について、PFF公式サイトのアーカイブをもとに作品名、監督名、受賞年、賞名を収集しています。公式情報から動画本編の直接的なYouTube/Vimeo配信URLの紐付けが確認できないため、video_urlは空文字とし、video_url_basisはunverifiedとしています。";

const recheckedIds = new Set(recheckPlan.imports.map((item) => item.id));
const normalize = (value = "") => String(value).toLowerCase().normalize("NFKC").replace(/[\s\-‐‑–—_・:：!！?？()（）\[\]【】]/g, "");
const recheckTitleAliases = new Map([
  [normalize("南阿蘇村 温泉PRムービー"), "1S-KU2F7wc0"],
  [normalize("大分県を舞台にした観光映像"), "9waEFmHUNdk"],
  [normalize("Mrs SAKE Japan プロデュース観光映像"), "hfRj2Hlh22M"],
  [normalize("奈良赤レンガフェスティバルPV"), "p4eAR2Gw5RU"],
]);
const value = (item, ...keys) => {
  for (const key of keys) if (item[key] !== undefined && item[key] !== null && String(item[key]).trim()) return String(item[key]);
  return "";
};

function getRecheckedHoldMatch(item) {
  const id = value(item, "id", "videoId", "video_id");
  if (id && recheckedIds.has(id)) return recheckPlan.imports.find((verified) => verified.id === id);
  const workTitle = normalize(value(item, "workTitle", "work_title", "title"));
  if (recheckTitleAliases.has(workTitle)) return recheckPlan.imports.find((verified) => verified.id === recheckTitleAliases.get(workTitle));
  const awardName = value(item, "awardName", "award_name");
  const awardYear = value(item, "awardYear", "award_year", "year");
  const awardCategory = value(item, "awardCategory", "award_category", "category");
  const sourceUrl = value(item, "officialSourceUrl", "official_source_url", "sourceUrl", "source_url");
  return recheckPlan.imports.find((verified) => {
    const matchingAward = verified.awards.some((award) => award.name === awardName && award.year === awardYear && award.category === awardCategory);
    const verifiedTitle = normalize(verified.title);
    const matchingTitle = workTitle && (verifiedTitle.includes(workTitle) || workTitle.includes(verifiedTitle));
    const matchingSource = verified.awards.some((award) => award.sourceUrl === sourceUrl);
    return matchingAward && (matchingTitle || matchingSource);
  });
}

const rows = (basePlan.hold || []).map((item) => {
  const originalId = value(item, "id", "videoId", "video_id");
  const awardName = value(item, "awardName", "award_name");
  const isInvalid = awardName === invalidAwardName;
  const rechecked = isInvalid ? undefined : getRecheckedHoldMatch(item);
  const status = isInvalid ? "invalid" : rechecked ? "registered" : "hold";
  return {
    scope: "添付リスト保留316件",
    status,
    id: rechecked?.id || originalId,
    title: value(item, "title", "workTitle", "work_title"),
    videoUrl: rechecked?.videoUrl || value(item, "videoUrl", "video_url"),
    awardName,
    awardYear: value(item, "year", "awardYear", "award_year"),
    awardCategory: value(item, "category", "awardCategory", "award_category"),
    sourceUrl: rechecked?.awards?.[0]?.sourceUrl || value(item, "officialSourceUrl", "official_source_url", "sourceUrl", "source_url"),
    reason: isInvalid
      ? "作品情報ではなく説明文が入力されているため除外"
      : status === "registered"
        ? "公式受賞出典・公式動画・ID/URL/タイトルの三重照合を通過"
        : "公式動画URLを三重照合できないため保留を維持",
  };
});

const additionalCandidates = [
  ...globalPlan.imports.map((item) => ({ scope: "追加アワード候補", status: "registered", ...item, reason: "公式受賞出典・公式動画・ID/URL/タイトルの三重照合を通過" })),
  { scope: "追加アワード候補", status: "hold", id: "", title: "Telstra - Better on a Better Network", videoUrl: "", awards: [{ name: "Cannes Lions", year: "2025", category: "Film Craft Lions Grand Prix", sourceUrl: "https://www.canneslions.com/news/cannes-lions-announces-2025-winners-across-entertainment-and-craft-tracks" }], reason: "公式受賞は確認できたが公式公開動画を三重照合できないため保留" },
  { scope: "追加アワード候補", status: "duplicate", id: "5URefVYaJrA", title: "A$AP Rocky - Tailor Swif (Official Video)", videoUrl: "https://www.youtube.com/watch?v=5URefVYaJrA", awards: [{ name: "D&AD Awards", year: "2025", category: "Black Pencil", sourceUrl: "https://www.dandad.org/work/annual" }], reason: "既存動画を動画ID・URL・タイトルで再照合し、受賞歴のみ追記" },
  ...dadPlan.imports.map((item) => ({ scope: "追加アワード候補", status: "registered", ...item, reason: "公式受賞出典・公式動画・ID/URL/タイトルの三重照合を通過" })),
  { scope: "追加アワード候補", status: "hold", id: "", title: "Designing Paris 2024", videoUrl: "", awards: [{ name: "D&AD Awards", year: "2025", category: "Black Pencil", sourceUrl: "https://www.dandad.org/work/annual" }], reason: "公式受賞は確認できたが公式公開動画を三重照合できないため保留" },
].map((item) => ({
  scope: item.scope,
  status: item.status,
  id: item.id || "",
  title: item.title || "",
  videoUrl: item.videoUrl || "",
  awardName: item.awards?.map((award) => award.name).join(" / ") || "",
  awardYear: item.awards?.map((award) => award.year).join(" / ") || "",
  awardCategory: item.awards?.map((award) => award.category).join(" / ") || "",
  sourceUrl: item.awards?.map((award) => award.sourceUrl).join(" | ") || "",
  reason: item.reason,
}));

const allRows = [...rows, ...additionalCandidates];
const counts = allRows.reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] || 0) + 1 }), {});
if (rows.length !== 316 || counts.registered !== 19 || counts.duplicate !== 1 || counts.hold !== 301 || counts.invalid !== 1) {
  const unmatchedRecheckedTitles = recheckPlan.imports
    .filter((verified) => !rows.some((row) => row.status === "registered" && normalize(verified.title).includes(normalize(row.title))))
    .map((verified) => verified.title);
  throw new Error(`Unexpected reconciliation counts: ${JSON.stringify({ base: rows.length, counts, unmatchedRecheckedTitles })}`);
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(`${outputDir}/award_reconciliation.json`, JSON.stringify({ generatedAt: new Date().toISOString(), counts, rows: allRows }, null, 2));
const headers = ["scope", "status", "id", "title", "videoUrl", "awardName", "awardYear", "awardCategory", "sourceUrl", "reason"];
const csvEscape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
writeFileSync(`${outputDir}/award_reconciliation.csv`, `${headers.join(",")}\n${allRows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")).join("\n")}\n`);
console.log(JSON.stringify({ counts, total: allRows.length }, null, 2));
