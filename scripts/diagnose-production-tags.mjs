import mysql from "mysql2/promise";

const parseList = (raw) => {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string" && item.trim()) : [];
  } catch {
    return [];
  }
};

const roleLabelPattern = /(?:agency|art\s*director|creative\s*director|director|producer|production|editor|designer|animation(?:\s*production)?|motion\s*graphics?|cg(?:\s*designer)?|cinematograph(?:er|y)|illustration|illustrator|manager|制作|製作|監督|演出|編集|撮影|美術|作画|原画|動画|プロデューサー|ディレクター|アートディレクター|デザイナー|イラスト|アニメーション|CG|VFX|カラーリスト|制作会社)\s*[:：]/gi;

const normalizeRaw = (value) => value.normalize("NFKC").replace(/\s+/g, " ").trim();

const db = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const [rows] = await db.execute("SELECT id, title, productions FROM videos WHERE productions IS NOT NULL AND productions <> '[]'");
  const values = [];

  for (const row of rows) {
    for (const raw of parseList(row.productions)) {
      const value = normalizeRaw(raw);
      const roleMatches = [...value.matchAll(roleLabelPattern)].length;
      values.push({
        id: String(row.id),
        title: String(row.title),
        value,
        roleMatches,
        hasRoleLabel: roleMatches > 0,
        hasConcatenatedRoles: roleMatches > 1,
        hasJapanese: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value),
        hasLatin: /[A-Za-z]/.test(value),
        isLong: value.length > 120,
        isLikelyNarrative: /[。！？]|(?:その他の作品|Other Works|Browse by genre|詳しくは|制作しました)/i.test(value),
      });
    }
  }

  const counts = values.reduce((summary, value) => {
    summary.totalTagValues += 1;
    if (value.hasRoleLabel) summary.withRoleLabel += 1;
    if (value.hasConcatenatedRoles) summary.withConcatenatedRoles += 1;
    if (value.hasJapanese && value.hasLatin) summary.mixedJapaneseAndLatin += 1;
    if (value.isLong) summary.over120Chars += 1;
    if (value.isLikelyNarrative) summary.likelyNarrative += 1;
    return summary;
  }, {
    videoCount: rows.length,
    totalTagValues: 0,
    withRoleLabel: 0,
    withConcatenatedRoles: 0,
    mixedJapaneseAndLatin: 0,
    over120Chars: 0,
    likelyNarrative: 0,
  });

  const sample = (predicate) => values.filter(predicate).slice(0, 20);
  console.log(JSON.stringify({
    ...counts,
    samples: {
      concatenatedRoles: sample((value) => value.hasConcatenatedRoles),
      roleLabeled: sample((value) => value.hasRoleLabel),
      mixedJapaneseAndLatin: sample((value) => value.hasJapanese && value.hasLatin),
      likelyNarrative: sample((value) => value.isLikelyNarrative),
    },
  }, null, 2));
} finally {
  await db.end();
}
