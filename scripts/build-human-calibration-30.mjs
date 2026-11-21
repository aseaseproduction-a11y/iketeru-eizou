import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});

// 1. Get actual DB rating distribution (excluding provisional & restricted)
const [distRows] = await conn.query(`
  SELECT COALESCE(NULLIF(aiOverallRating, ''), '(none)') AS rating, COUNT(*) AS cnt
  FROM videos
  WHERE (embedStatus IS NULL OR embedStatus != 'restricted')
    AND COALESCE(aiAnalysis, '') NOT LIKE '%一次評価%'
    AND COALESCE(aiAnalysis, '') NOT LIKE '%暫定評価%'
    AND COALESCE(aiAnalysis, '') NOT LIKE '%未視聴%'
    AND COALESCE(aiAnalysis, '') NOT LIKE '%簡易分析済(要完全版)%'
    AND COALESCE(aiScoreBreakdown, '') NOT LIKE '%"needs_full_analysis"%'
  GROUP BY rating
  ORDER BY cnt DESC
`);

// 2. Fetch candidate pool (non-provisional, playable, has rating)
const [pool] = await conn.query(`
  SELECT id, platform, title, videoUrl, genres, products, directions, aiOverallRating, aiOverallScore, aiDirectionRating, aiTechniqueRating, awards
  FROM videos
  WHERE (embedStatus IS NULL OR embedStatus != 'restricted')
    AND aiOverallRating IS NOT NULL AND aiOverallRating != ''
    AND COALESCE(aiAnalysis, '') NOT LIKE '%一次評価%'
    AND COALESCE(aiAnalysis, '') NOT LIKE '%暫定評価%'
    AND COALESCE(aiAnalysis, '') NOT LIKE '%未視聴%'
    AND COALESCE(aiAnalysis, '') NOT LIKE '%簡易分析済(要完全版)%'
    AND COALESCE(aiScoreBreakdown, '') NOT LIKE '%"needs_full_analysis"%'
    AND COALESCE(aiScoreBreakdown, '') NOT LIKE '%"invalidated_no_visual"%'
`);

await conn.end();

const isVertical = (r) =>
  r.platform === "tiktok" ||
  r.platform === "instagram" ||
  /shorts|縦型|reels|vertical/i.test(`${r.videoUrl} ${r.title} ${r.genres}`);

const isCorporate = (r) =>
  /企業|採用|コーポレート|会社紹介|リクルート|b2b|corporate|recruit|service|サービス紹介|ブランドムービー|官公庁/i.test(
    `${r.title} ${r.genres} ${r.products}`
  );

// Target counts matching real DB distribution (A/A-/B+ centered, >=5 C or below)
const targetPlan = [
  { group: "S帯 (S+/S/S-)", grades: ["S+", "S", "S-"], count: 3, rationale: "上位アンカー（国際賞・最高峰基準の確認用）" },
  { group: "A+", grades: ["A+"], count: 3, rationale: "準最高峰帯（S帯との境界線を見極める）" },
  { group: "A", grades: ["A"], count: 6, rationale: "DB最頻帯（中核ボリュームゾーンの基準校正）" },
  { group: "A-", grades: ["A-"], count: 5, rationale: "DB第2頻帯（AとB+の中間・実務良作の境界）" },
  { group: "B+", grades: ["B+"], count: 4, rationale: "DB第3頻帯（標準以上〜良作の下限を確認）" },
  { group: "B / B-", grades: ["B", "B-"], count: 4, rationale: "平均〜やや課題あり帯（標準水準の底を確認）" },
  { group: "C以下 (C+/C/C-/D+)", grades: ["C+", "C", "C-", "D+", "D", "D-"], count: 5, rationale: "下位アンカー（課題あり・改善対象の下限基準を明確化）" },
];

const selected = [];
const usedIds = new Set();

function pickFromCandidates(cands, n, preferCorporate = false, preferVertical = false) {
  const picked = [];
  // Stable deterministic shuffle by id hash
  const sorted = [...cands].sort((a, b) => {
    const scoreA = (preferVertical && isVertical(a) ? 100 : 0) + (preferCorporate && isCorporate(a) ? 50 : 0) + (a.platform === "youtube" ? 10 : 0);
    const scoreB = (preferVertical && isVertical(b) ? 100 : 0) + (preferCorporate && isCorporate(b) ? 50 : 0) + (b.platform === "youtube" ? 10 : 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return String(a.id).localeCompare(String(b.id));
  });
  for (const r of sorted) {
    if (picked.length >= n) break;
    if (usedIds.has(r.id)) continue;
    usedIds.add(r.id);
    picked.push(r);
  }
  return picked;
}

// Track special quotas
let verticalCount = 0;
let corporateCount = 0;

for (const plan of targetPlan) {
  const cands = pool.filter((r) => plan.grades.includes(r.aiOverallRating));
  const groupPicked = [];

  // Ensure at least 1 vertical if available in this band and we need more verticals
  if (verticalCount < 4) {
    const vCands = cands.filter((r) => isVertical(r) && !usedIds.has(r.id));
    if (vCands.length > 0 && groupPicked.length < plan.count) {
      const p = pickFromCandidates(vCands, 1, false, true);
      groupPicked.push(...p);
      verticalCount += p.length;
    }
  }
  // Ensure corporate videos distributed across A/A-/B+/B/C bands
  if (corporateCount < 6 && ["A", "A-", "B+", "B / B-", "C以下 (C+/C/C-/D+)"].includes(plan.group)) {
    const cCands = cands.filter((r) => isCorporate(r) && !usedIds.has(r.id));
    if (cCands.length > 0 && groupPicked.length < plan.count) {
      const p = pickFromCandidates(cCands, 1, true, false);
      groupPicked.push(...p);
      corporateCount += p.length;
    }
  }
  // Fill remainder of group with grade diversity
  const rem = plan.count - groupPicked.length;
  if (rem > 0) {
    // Spread across sub-grades if multiple grades in group
    if (plan.grades.length > 1) {
      for (const g of plan.grades) {
        if (groupPicked.length >= plan.count) break;
        const gCands = cands.filter((r) => r.aiOverallRating === g && !usedIds.has(r.id));
        if (gCands.length > 0) {
          groupPicked.push(...pickFromCandidates(gCands, 1));
        }
      }
    }
    const stillRem = plan.count - groupPicked.length;
    if (stillRem > 0) {
      groupPicked.push(...pickFromCandidates(cands, stillRem));
    }
  }

  for (const r of groupPicked) {
    const tags = [];
    if (isVertical(r)) tags.push("縦型/ショート");
    if (isCorporate(r)) tags.push("企業/採用");
    selected.push({
      id: r.id,
      platform: r.platform,
      title: r.title,
      videoUrl: r.videoUrl,
      tierGroup: plan.group,
      currentAiOverallRating: r.aiOverallRating,
      currentAiOverallScore: r.aiOverallScore,
      currentAiDirectionRating: r.aiDirectionRating,
      currentAiTechniqueRating: r.aiTechniqueRating,
      specialCategories: tags,
      selectionRationale: plan.rationale,
      humanRating: null,
      humanNotes: "",
    });
  }
}

const byTier = {};
let finalVert = 0;
let finalCorp = 0;
for (const s of selected) {
  byTier[s.currentAiOverallRating] = (byTier[s.currentAiOverallRating] || 0) + 1;
  if (s.specialCategories.includes("縦型/ショート")) finalVert++;
  if (s.specialCategories.includes("企業/採用")) finalCorp++;
}

const out = {
  generatedAt: new Date().toISOString(),
  note: "DB実分布（A/A-/B+中心）準拠・C以下5本以上・企業/縦型動画を含む較正用30本（暫定評価・再生不可を除外）",
  totalCount: selected.length,
  dbDistributionNonProvisional: distRows,
  selectedTierCounts: byTier,
  verticalCount: finalVert,
  corporateCount: finalCorp,
  items: selected,
};

fs.writeFileSync(
  path.join(REPO_ROOT, "analysis", "human_calibration_30.json"),
  JSON.stringify(out, null, 2),
  "utf8"
);

console.log(JSON.stringify({
  totalCount: out.totalCount,
  selectedTierCounts: byTier,
  verticalCount: finalVert,
  corporateCount: finalCorp,
  dbDistributionTop12: distRows.slice(0, 12),
}, null, 2));
