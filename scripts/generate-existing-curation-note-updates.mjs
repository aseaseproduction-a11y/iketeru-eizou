import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const researchPath = "/home/ubuntu/research_existing_video_curation_notes.json";
const outputPath = "/home/ubuntu/iketeru-eizou/analysis/curation_note_updates_existing_videos.sql";
const research = JSON.parse(readFileSync(researchPath, "utf8"));

const expected = new Map([
  ["b712-HFa6yA", { title: "【Official MV】YUNYUN HARDCORE｜『ゆんゆん電波シンドローム』オリジナルソング - YouTube", videoUrl: "https://www.youtube.com/watch?v=b712-HFa6yA" }],
  ["fUU_VKLXzRQ", { title: "オープニングムービー完全版｜TVアニメ『上伊那ぼたん、酔へる姿は百合の花』", videoUrl: "https://www.youtube.com/watch?v=fUU_VKLXzRQ" }],
  ["gAeacXZilaE", { title: "【MV】ウシロジカン/ゆーり【オリジナル】 - YouTube", videoUrl: "https://www.youtube.com/watch?v=gAeacXZilaE" }],
  ["4G5O59-vlCU", { title: "『つみみじかん』新作steamゲーム主題歌『推推推推推推推推金金金金金金金金』作詞作曲：きくお／vocal：神楽めあ - YouTube", videoUrl: "https://www.youtube.com/watch?v=4G5O59-vlCU" }],
  ["mrAWbxB5p4k", { title: "FOCUS / covered by 夜乃くろむ", videoUrl: "https://www.youtube.com/watch?v=mrAWbxB5p4k" }],
  ["THG8WHjaub4", { title: "ポッピンキャンディ☆フィーバー！ - Covered by 猫汰つな、花芽なずな", videoUrl: "https://www.youtube.com/watch?v=THG8WHjaub4" }],
  ["O9M1UMj-vwE", { title: "『ONE PIECE』全世界累計発行部数6億部突破記念企画「ONE PIECEとは？」", videoUrl: "https://www.youtube.com/watch?v=O9M1UMj-vwE" }],
  ["t7HlVWkKnWI", { title: "Gimme×Gimme／covered by 戌亥とこ、珠乃井ナナ - YouTube", videoUrl: "https://www.youtube.com/watch?v=t7HlVWkKnWI" }],
]);

const officialHosts = new Set([
  "www.youtube.com",
  "youtube.com",
  "alliance-arts.co.jp",
  "store.steampowered.com",
  "www.aniplex.co.jp",
  "www.jvcmusic.co.jp",
  "prtimes.jp",
  "one-piece.com",
  "www.one-piece.com",
]);
const sqlEscape = (value) => String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'");

const updates = research.results
  .map(({ output }) => {
    if (!output?.verified || !expected.has(output.video_id)) return null;
    const triple = expected.get(output.video_id);
    const sourceUrls = JSON.parse(output.source_urls_json)
      .filter((url) => {
        try {
          return officialHosts.has(new URL(url).hostname);
        } catch {
          return false;
        }
      });
    if (!sourceUrls.length) throw new Error(`No official source URLs for ${output.video_id}`);
    const curationNote = JSON.stringify({
      purpose: output.purpose,
      background: output.background,
      evaluation: output.evaluation,
      sourceUrls,
    });
    return `UPDATE videos SET curationNote = '${sqlEscape(curationNote)}' WHERE id = '${sqlEscape(output.video_id)}' AND title = '${sqlEscape(triple.title)}' AND videoUrl = '${sqlEscape(triple.videoUrl)}';`;
  })
  .filter(Boolean);

if (updates.length !== expected.size) throw new Error(`Expected ${expected.size} verified updates, received ${updates.length}`);
mkdirSync("/home/ubuntu/iketeru-eizou/analysis", { recursive: true });
writeFileSync(outputPath, `${updates.join("\n")}\n`);
console.log(JSON.stringify({ outputPath, updates: updates.length }, null, 2));
