import fs from "node:fs";

const researchPath = "/home/ubuntu/research_award_curation_notes.json";
const { results } = JSON.parse(fs.readFileSync(researchPath, "utf8"));

const allowedSourceHosts = new Set([
  "awardg.sendenkaigi.com",
  "prtimes.jp",
  "toyota.jp",
  "www.eibunren.or.jp",
  "newsroom.mazda.com",
  "www.mazda.com",
  "www.oneclub.org",
  "2021.tiff-jp.net",
]);

function escapeSql(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "''");
}

function parseInput(input) {
  const matched = input.match(/^id=(.*?) \| title=(.*?) \| award=(.*?) \| official=(.*)$/);
  if (!matched) throw new Error(`Unexpected research input: ${input}`);
  return {
    id: matched[1],
    title: matched[2],
    officialUrl: matched[4],
  };
}

function normalizeSourceUrls(officialUrl, sourceUrlsText) {
  const researchUrls = JSON.parse(sourceUrlsText);
  const urls = [officialUrl, ...researchUrls].filter((url) => {
    try {
      return allowedSourceHosts.has(new URL(url).hostname);
    } catch {
      return false;
    }
  });
  return [...new Set(urls)];
}

const updates = results.map(({ input, output, error }) => {
  if (error) throw new Error(`Research error for ${input}: ${error}`);
  const { id, title, officialUrl } = parseInput(input);
  const curationNote = {
    purpose: output.purpose.trim(),
    background: output.background.trim(),
    evaluation: output.evaluation.trim(),
    sourceUrls: normalizeSourceUrls(officialUrl, output.source_urls),
  };
  return { id, title, curationNote };
});

console.log("START_SQL");
for (const { id, title, curationNote } of updates) {
  const noteJson = escapeSql(JSON.stringify(curationNote));
  console.log(`UPDATE videos SET curationNote = '${noteJson}' WHERE id = '${escapeSql(id)}' AND title = '${escapeSql(title)}' AND videoUrl = 'https://www.youtube.com/watch?v=${escapeSql(id)}';`);
}
console.log("END_SQL");
console.log("START_AUDIT_SQL");
console.log(`SELECT id, title, videoUrl, curationNote FROM videos WHERE id IN (${updates.map(({ id }) => `'${escapeSql(id)}'`).join(", ")}) ORDER BY id;`);
console.log("END_AUDIT_SQL");
