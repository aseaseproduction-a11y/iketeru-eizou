import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { diffManifests, scanRecipeStore } from "./migrate-craft-recipes-to-drive.mjs";
import { publishStagedRecipeToStore, validateRecipeGates } from "./publish-craft-recipe-to-store.mjs";
import { runSyncCraftRecipesToSqlite } from "./sync-craft-recipes-to-sqlite.mjs";

function makeValidStagedVideo(dir, vid) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ["cut_01.gif", "cut_01_strip.jpg", "cut_01_start.png", "cut_01_mid.png", "cut_01_end.png"]) {
    fs.writeFileSync(path.join(dir, f), Buffer.from(`dummy-${vid}-${f}`));
  }
  const recipe = {
    video_id: vid,
    technique_rating: "A",
    title: `Title ${vid}`,
    provenance: { source: "antigravity_local_v2", worker: "chibatmute", run_id: "craft_upg_test", model: "gemini-4-neon-high" },
    cuts: [
      {
        cut_index: 1,
        title: "Test v2 cut",
        category: "motion_graphics",
        start_mmss: "00:01",
        end_mmss: "00:05",
        start_sec: 1.0,
        end_sec: 5.0,
        primary_tool: "After Effects",
        software_stack: ["After Effects"],
        plugins_used: ["Deep Glow"],
        color_palette_hex: { base: "#101010", primary: "#FFFFFF", accent: "#FF2D55" },
        frame_timeline: [
          { frame: 0, event: "start" },
          { frame: 12, event: "peak" },
        ],
        effect_chain: [{ order: 1, tool: "After Effects", plugin: "Deep Glow", match_name: "Deep Glow" }],
        ae_blueprint: { schema_version: 2, layers: [{ type: "shape", name: "BG" }] },
        credibility: { credibility_score: 100, credibility_grade: "A", needs_recut: false },
        media: {
          gif_path: `data/craft_recipes/${vid}/cut_01.gif`,
          strip_path: `data/craft_recipes/${vid}/cut_01_strip.jpg`,
          start_png: `data/craft_recipes/${vid}/cut_01_start.png`,
          mid_png: `data/craft_recipes/${vid}/cut_01_mid.png`,
          end_png: `data/craft_recipes/${vid}/cut_01_end.png`,
          telemetry: { available: true, luminance: { mean: 80 } },
        },
      },
    ],
  };
  fs.writeFileSync(path.join(dir, "recipe.json"), JSON.stringify(recipe, null, 2), "utf8");
}

test("migrate-craft-recipes-to-drive scanRecipeStore & diffManifests detect mismatches, .gdoc, and conflict copies", () => {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), "craft-migrate-test-"));
  try {
    const src = path.join(td, "src");
    const dst = path.join(td, "dst");
    makeValidStagedVideo(path.join(src, "vidA"), "vidA");
    makeValidStagedVideo(path.join(dst, "vidA"), "vidA");

    const mSrc = scanRecipeStore(src);
    const mDst = scanRecipeStore(dst);
    const diffOk = diffManifests(mSrc, mDst);
    assert.equal(diffOk.all_passed, true);
    assert.equal(diffOk.sha_mismatch_count, 0);

    // Inject forbidden .gdoc and conflict copy in dst -> must fail
    fs.writeFileSync(path.join(dst, "vidA", "recipe.gdoc"), "{}", "utf8");
    fs.writeFileSync(path.join(dst, "vidA", "cut_01 (1).gif"), "x", "utf8");
    const mDstBad = scanRecipeStore(dst);
    const diffBad = diffManifests(mSrc, mDstBad);
    assert.equal(diffBad.all_passed, false);
    assert.equal(diffBad.forbidden_gdoc_count, 1);
    assert.equal(diffBad.conflict_copy_count, 1);
  } finally {
    fs.rmSync(td, { recursive: true, force: true });
  }
});

test("publish-craft-recipe-to-store enforces G1-G7 gates, backs up old folder, removes stale files, and verifies SHA-256", () => {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), "craft-pub-test-"));
  try {
    const staging = path.join(td, "staging", "vidB");
    const store = path.join(td, "store");
    const bak = path.join(td, "backups");
    makeValidStagedVideo(staging, "vidB");

    // Pre-existing v1 folder with stale cut_02.gif
    fs.mkdirSync(path.join(store, "vidB"), { recursive: true });
    fs.writeFileSync(path.join(store, "vidB", "cut_02.gif"), "old-stale");

    // Gate G7 rejection when calibratedScore < 78
    const rejected = validateRecipeGates({ videoId: "vidB", stagingDir: staging, videoDurationSec: 30, calibratedScore: 76.5 });
    assert.equal(rejected.all_passed, false);
    assert.equal(rejected.gates.G7_rule2_and_d022.passed, false);

    // Valid publish
    const res = publishStagedRecipeToStore({
      videoId: "vidB",
      stagingDir: staging,
      storeDir: store,
      runId: "craft_upg_test",
      worker: "chibatmute",
      backupRoot: bak,
      validationOpts: { videoDurationSec: 30, calibratedScore: 84.0, observationScope: null },
    });
    assert.equal(res.published, true);
    assert.equal(res.files_verified, 6);
    assert.deepEqual(res.removed_stale_files, ["cut_02.gif"]);
    assert.ok(fs.existsSync(path.join(res.backup_path, "cut_02.gif")));
    assert.ok(fs.existsSync(path.join(store, "vidB", "_folder_manifest.json")));
    assert.ok(!fs.existsSync(path.join(store, "vidB", "cut_02.gif")));
  } finally {
    fs.rmSync(td, { recursive: true, force: true });
  }
});

test("sync-craft-recipes-to-sqlite dry-run, fail-closed on .gdoc/broken JSON, and atomic apply preserving videos/scenes", () => {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), "craft-sync-test-"));
  try {
    const dbPath = path.join(td, "test.db");
    const store = path.join(td, "store");
    const bak = path.join(td, "backups");
    makeValidStagedVideo(path.join(store, "vidC"), "vidC");

    // Seed minimal SQLite using KnowledgeIndex
    execFileSync(
      "python",
      [
        "-c",
        `import sys; sys.path.insert(0, 'E:/iketeru-creative-studio'); from iketeru_studio.indexer import KnowledgeIndex; idx=KnowledgeIndex(db_path=r'${dbPath}'); idx.upsert_video({'id':'vidC','platform':'youtube','title':'Title vidC','videoUrl':'https://youtu.be/vidC','aiOverallRating':'A','aiDirectionRating':'A','aiTechniqueRating':'A','aiAnalysis':'## 3. シーン\\n- #01 【00:00-00:10】test\\n' + 'あ'*2000})`,
      ],
      { encoding: "utf8" }
    );

    // Dry-run
    const dr = runSyncCraftRecipesToSqlite({ storeDir: store, sqlitePath: dbPath, apply: false, backupDir: bak });
    assert.equal(dr.status, 0);
    const drJson = JSON.parse(dr.stdout);
    assert.equal(drJson.ok, true);
    assert.equal(drJson.pre_sqlite.craft_recipes_rows, 0);
    assert.equal(drJson.store_summary.recipe_cuts, 1);

    // Apply
    const ap = runSyncCraftRecipesToSqlite({ storeDir: store, sqlitePath: dbPath, apply: true, backupDir: bak });
    assert.equal(ap.status, 0);
    const apJson = JSON.parse(ap.stdout);
    assert.equal(apJson.post_sqlite.craft_recipes_rows, 1);
    assert.equal(apJson.post_sqlite.craft_recipes_vids, 1);
    assert.equal(apJson.post_sqlite.videos_and_scenes_unchanged, true);
    assert.equal(apJson.post_sqlite.integrity_check, "ok");

    // Fail-closed when .gdoc exists in store
    fs.writeFileSync(path.join(store, "vidC", "bad.gdoc"), "{}", "utf8");
    const bad = runSyncCraftRecipesToSqlite({ storeDir: store, sqlitePath: dbPath, apply: true, backupDir: bak });
    assert.notEqual(bad.status, 0);
  } finally {
    fs.rmSync(td, { recursive: true, force: true });
  }
});

test("G4 image telop check ignores media.start_png filenames while catching real PNG telop instructions", () => {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), "craft-g4-test-"));
  try {
    const staging = path.join(td, "vidG4");
    makeValidStagedVideo(staging, "vidG4");
    const rPath = path.join(staging, "recipe.json");
    const doc = JSON.parse(fs.readFileSync(rPath, "utf8"));
    doc.cuts[0].anti_ai_slop_notes = "テロップは編集可能なAEテキストレイヤーで組むこと。";
    fs.writeFileSync(rPath, JSON.stringify(doc, null, 2), "utf8");
    const ok = validateRecipeGates({ videoId: "vidG4", stagingDir: staging, videoDurationSec: 30, calibratedScore: 84.0 });
    assert.equal(ok.gates.G4_production_compliance.passed, true);

    doc.cuts[0].anti_ai_slop_notes = "PNG画像でテロップを書き出して貼る。";
    fs.writeFileSync(rPath, JSON.stringify(doc, null, 2), "utf8");
    const ng = validateRecipeGates({ videoId: "vidG4", stagingDir: staging, videoDurationSec: 30, calibratedScore: 84.0 });
    assert.equal(ng.gates.G4_production_compliance.passed, false);
  } finally {
    fs.rmSync(td, { recursive: true, force: true });
  }
});

test("G8 expressive_purpose validates controlled vocab, evidence range, search_phrases 3..6, and keywords 5..10 (2..10 chars)", () => {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), "craft-g8-test-"));
  try {
    const staging = path.join(td, "vidG8");
    makeValidStagedVideo(staging, "vidG8");
    const rPath = path.join(staging, "recipe.json");
    const doc = JSON.parse(fs.readFileSync(rPath, "utf8"));

    // requirePurpose=true fails when expressive_purpose is missing
    const missing = validateRecipeGates({ videoId: "vidG8", stagingDir: staging, videoDurationSec: 30, calibratedScore: 84.0, requirePurpose: true });
    assert.equal(missing.all_passed, false);
    assert.equal(missing.gates.G8_expressive_purpose.passed, false);

    // Valid expressive_purpose passes all 8 gates
    doc.cuts[0].expressive_purpose = {
      intent_summary: "冒頭で高コントラストな光帯転換を使い視聴者の視線を一気に掴む導入演出。",
      viewer_effect: ["疾走感", "視線誘導"],
      narrative_role: "掴み",
      best_for: {
        purposes: ["プロモーション", "MV"],
        genres: ["web-cm", "mv"],
        industries: ["it", "music-artist"],
        media_formats: ["Web CM / 広告"],
        duration_fit: ["15s", "30s"],
      },
      avoid_when: ["落ち着いた医療説明動画"],
      search_phrases: ["冒頭で一気に目を引く転換", "音ハメで切り替わる導入", "スピード感のある掴み"],
      keywords: ["冒頭フック", "音ハメ転換", "疾走感", "光帯遷移", "Web広告向け"],
      evidence: [{ timestamp_sec: 1.5, timecode: "00:01.50", observation: "中央に光帯が発生し場面が切り替わる" }],
      provenance: "video_observed",
    };
    fs.writeFileSync(rPath, JSON.stringify(doc, null, 2), "utf8");
    const ok = validateRecipeGates({ videoId: "vidG8", stagingDir: staging, videoDurationSec: 30, calibratedScore: 84.0, requirePurpose: true });
    assert.equal(ok.all_passed, true);
    assert.equal(ok.gates.G8_expressive_purpose.passed, true);

    // Out-of-range evidence & >10-char keyword & too few search_phrases must fail G8
    doc.cuts[0].expressive_purpose.search_phrases = ["1個だけ"];
    doc.cuts[0].expressive_purpose.keywords[0] = "これは十一文字を超える長すぎるキーワード";
    doc.cuts[0].expressive_purpose.evidence[0].timestamp_sec = 9.9;
    fs.writeFileSync(rPath, JSON.stringify(doc, null, 2), "utf8");
    const bad = validateRecipeGates({ videoId: "vidG8", stagingDir: staging, videoDurationSec: 30, calibratedScore: 84.0, requirePurpose: true });
    assert.equal(bad.gates.G8_expressive_purpose.passed, false);
    assert.ok(bad.gates.G8_expressive_purpose.errors.some((e) => e.includes("search_phrases")));
    assert.ok(bad.gates.G8_expressive_purpose.errors.some((e) => e.includes("keywords char length")));
    assert.ok(bad.gates.G8_expressive_purpose.errors.some((e) => e.includes("out of cut range")));
  } finally {
    fs.rmSync(td, { recursive: true, force: true });
  }
});
