import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  auditOriginalColumnsAgainstPreD,
  loadV3CanonicalManifestMap,
  sha256TidbCellValue,
} from "./approved-tidb-overrides.mjs";
import {
  loadPinnedV3ApplyList,
  parseV3ScenesFromMarkdown,
  selectV3Entries,
} from "./apply-reanalysis-v3-to-tidb.mjs";
import { EXPRESSIVE_PURPOSE_VOCAB, validateRecipeGates } from "./publish-craft-recipe-to-store.mjs";

function sha256Str(s) {
  return crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
}

test("loadV3CanonicalManifestMap verifies SHA-256 and mechanical_check pass and rejects tampered/failed entries", () => {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), "v3-manifest-test-"));
  try {
    // 1. Valid entry
    const v1Dir = path.join(td, "vid_ok");
    fs.mkdirSync(v1Dir);
    const anaOk = "## 0. 総括\n本文\n## 3. シーン\n- #01 【00:00-00:05】 導入: タイトル表示\n- #02 【00:05-00:12】 展開: ロゴ出現\n";
    const chkOk = JSON.stringify({
      video_id: "vid_ok",
      prompt_sha256_verified: true,
      transcript_audit: { ok: true },
      mechanical: { all_passed: true, scenes_count: 2, chapters_count: 11 },
    });
    fs.writeFileSync(path.join(v1Dir, "analysis_v3.md"), anaOk, "utf8");
    fs.writeFileSync(path.join(v1Dir, "mechanical_check.json"), chkOk, "utf8");
    fs.writeFileSync(
      path.join(v1Dir, "manifest.json"),
      JSON.stringify({
        video_id: "vid_ok",
        analysis_version: "v3.1",
        prompt_template_sha256: "a".repeat(64),
        created_at: "2026-11-26T15:00:00+09:00",
        files: {
          "analysis_v3.md": { bytes: Buffer.byteLength(anaOk, "utf8"), sha256: sha256Str(anaOk) },
          "mechanical_check.json": { bytes: Buffer.byteLength(chkOk, "utf8"), sha256: sha256Str(chkOk) },
        },
      }),
      "utf8"
    );

    // 2. Tampered SHA-256 entry
    const v2Dir = path.join(td, "vid_tampered");
    fs.mkdirSync(v2Dir);
    fs.writeFileSync(path.join(v2Dir, "analysis_v3.md"), anaOk + "tamper", "utf8");
    fs.writeFileSync(path.join(v2Dir, "mechanical_check.json"), chkOk, "utf8");
    fs.writeFileSync(
      path.join(v2Dir, "manifest.json"),
      JSON.stringify({
        video_id: "vid_tampered",
        files: { "analysis_v3.md": { bytes: Buffer.byteLength(anaOk, "utf8"), sha256: sha256Str(anaOk) } },
      }),
      "utf8"
    );

    // 3. Mechanical fail entry
    const v3Dir = path.join(td, "vid_mech_fail");
    fs.mkdirSync(v3Dir);
    const chkFail = JSON.stringify({
      video_id: "vid_mech_fail",
      prompt_sha256_verified: true,
      transcript_audit: { ok: true },
      mechanical: { all_passed: false, fail_reasons: ["backticks"] },
    });
    fs.writeFileSync(path.join(v3Dir, "analysis_v3.md"), anaOk, "utf8");
    fs.writeFileSync(path.join(v3Dir, "mechanical_check.json"), chkFail, "utf8");
    fs.writeFileSync(
      path.join(v3Dir, "manifest.json"),
      JSON.stringify({
        video_id: "vid_mech_fail",
        files: {
          "analysis_v3.md": { bytes: Buffer.byteLength(anaOk, "utf8"), sha256: sha256Str(anaOk) },
          "mechanical_check.json": { bytes: Buffer.byteLength(chkFail, "utf8"), sha256: sha256Str(chkFail) },
        },
      }),
      "utf8"
    );

    const loaded = loadV3CanonicalManifestMap(td);
    assert.equal(loaded.valid_map.size, 1);
    assert.ok(loaded.valid_map.has("vid_ok"));
    assert.equal(loaded.rejected.length, 2);

    // Parse scenes check
    const scenes = parseV3ScenesFromMarkdown(anaOk);
    assert.equal(scenes.length, 2);
    assert.equal(scenes[0].start_sec, 0);
    assert.equal(scenes[1].end_sec, 12);

    // Pre-D audit: allows matching v3 aiAnalysis, rejects mismatched SHA or other column
    const backupMap = new Map([["vid_ok", { id: "vid_ok", title: "T1", aiAnalysis: "legacy", updatedAt: "2026-11-20T00:00:00.000Z" }]]);
    const cols = ["id", "title", "aiAnalysis", "updatedAt"];
    const passRes = auditOriginalColumnsAgainstPreD({
      liveRows: [{ id: "vid_ok", title: "T1", aiAnalysis: anaOk, updatedAt: "2026-11-20T00:00:00.000Z" }],
      backupMap,
      originalColumns: cols,
      legacyScoreColumns: new Set(["aiAnalysis"]),
      v3ManifestMap: loaded.valid_map,
    });
    assert.equal(passRes.passed, true);
    assert.equal(passRes.v3_manifest_matched_count, 1);

    const failTitleRes = auditOriginalColumnsAgainstPreD({
      liveRows: [{ id: "vid_ok", title: "T1_CHANGED", aiAnalysis: anaOk, updatedAt: "2026-11-20T00:00:00.000Z" }],
      backupMap,
      originalColumns: cols,
      legacyScoreColumns: new Set(["aiAnalysis"]),
      v3ManifestMap: loaded.valid_map,
    });
    assert.equal(failTitleRes.passed, false);
    assert.equal(failTitleRes.sample_mismatches[0].col, "title");

    const failAnaTamper = auditOriginalColumnsAgainstPreD({
      liveRows: [{ id: "vid_ok", title: "T1", aiAnalysis: anaOk + "x", updatedAt: "2026-11-20T00:00:00.000Z" }],
      backupMap,
      originalColumns: cols,
      legacyScoreColumns: new Set(["aiAnalysis"]),
      v3ManifestMap: loaded.valid_map,
    });
    assert.equal(failAnaTamper.passed, false);
    assert.equal(failAnaTamper.sample_mismatches[0].reason, "v3_manifest_sha256_mismatch");
  } finally {
    fs.rmSync(td, { recursive: true, force: true });
  }
});

test("validateRecipeGates supports gemini_api_url_v1 track ONLY with explicit allowApiRecipe flag", () => {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), "api-recipe-gate-test-"));
  try {
    const recipe = {
      video_id: "vid_api",
      provenance: { source: "gemini_api_url_v1", worker: "CHIBA-PC", run_id: "api_run_1", model: "gemini-2.5-pro" },
      cuts: [
        {
          cut_index: 1,
          title: "Test API Cut",
          start_sec: 1.0,
          end_sec: 5.0,
          primary_tool: "After Effects",
          frame_timeline: [{ frame: 0 }, { frame: 24 }],
          effect_chain: [{ order: 1 }],
          ae_blueprint: { layers: [{ name: "L1" }] },
          credibility: { credibility_score: 95, needs_recut: false },
          provenance: { source: "gemini_api_url_v1" },
          media: { telemetry: { available: false, unavailable_reason: "no_local_video_api_url_v1" } },
          expressive_purpose: {
            intent_summary: "API経由で動画構成と視線誘導の要点を抽出したテストカット。",
            narrative_role: EXPRESSIVE_PURPOSE_VOCAB.narrative_role[0],
            viewer_effect: [EXPRESSIVE_PURPOSE_VOCAB.viewer_effect[0], EXPRESSIVE_PURPOSE_VOCAB.viewer_effect[1]],
            best_for: {
              purposes: [EXPRESSIVE_PURPOSE_VOCAB.best_for.purposes[0]],
              genres: [EXPRESSIVE_PURPOSE_VOCAB.best_for.genres[0]],
              industries: [EXPRESSIVE_PURPOSE_VOCAB.best_for.industries[0]],
              media_formats: [EXPRESSIVE_PURPOSE_VOCAB.best_for.media_formats[0]],
              duration_fit: [EXPRESSIVE_PURPOSE_VOCAB.best_for.duration_fit[0]],
            },
            avoid_when: ["落ち着いた説明動画"],
            search_phrases: ["冒頭で視線を引く", "ブランド導入演出", "高テンポなカット導入"],
            keywords: ["視線誘導", "冒頭掴み", "高速カット", "ブランド", "導入演出"],
            evidence: [{ timestamp_sec: 2.0, timecode: "00:02.00", observation: "ロゴ表示" }],
            provenance: "api_interpreted",
          },
        },
      ],
    };
    fs.writeFileSync(path.join(td, "recipe.json"), JSON.stringify(recipe, null, 2), "utf8");

    // Without allowApiRecipe -> MUST fail closed
    const strictRes = validateRecipeGates({
      videoId: "vid_api",
      stagingDir: td,
      calibratedScore: 82,
      requirePurpose: true,
      allowApiRecipe: false,
    });
    assert.equal(strictRes.all_passed, false);

    // With allowApiRecipe -> PASS all 8 gates
    const apiRes = validateRecipeGates({
      videoId: "vid_api",
      stagingDir: td,
      calibratedScore: 82,
      requirePurpose: true,
      allowApiRecipe: true,
    });
    assert.equal(apiRes.all_passed, true);
  } finally {
    fs.rmSync(td, { recursive: true, force: true });
  }
});

test("apply-phase3-batch-to-tidb and restore-verified-excluded-status wire loadV3CanonicalManifestMap into Pre-D audit", () => {
  const phase3Src = fs.readFileSync(new URL("./apply-phase3-batch-to-tidb.mjs", import.meta.url), "utf8");
  const restoreSrc = fs.readFileSync(new URL("./restore-verified-excluded-status.mjs", import.meta.url), "utf8");
  assert.match(phase3Src, /loadV3CanonicalManifestMap/);
  assert.match(phase3Src, /v3ManifestMap:\s*v3Manifest\.valid_map/);
  assert.match(restoreSrc, /loadV3CanonicalManifestMap/);
  assert.match(restoreSrc, /v3ManifestMap:\s*v3Manifest\.valid_map/);

  // Functional coexistence test: approved override on vid1 + v3 manifest aiAnalysis on vid2 BOTH pass Pre-D audit
  const newBd1 = '{"visualVerificationStatus":"log_verified"}';
  const newAna2 = "## 0. 総括\nv3本文";
  const backupMap = new Map([
    ["vid1", { id: "vid1", aiScoreBreakdown: "old_bd", aiAnalysis: "old1", updatedAt: "2026-11-20T00:00:00.000Z" }],
    ["vid2", { id: "vid2", aiScoreBreakdown: "old_bd2", aiAnalysis: "old2", updatedAt: "2026-11-20T00:00:00.000Z" }],
  ]);
  const approvedMap = new Map([
    [
      "vid1::aiScoreBreakdown",
      { video_id: "vid1", column: "aiScoreBreakdown", after_sha256: sha256TidbCellValue(newBd1), decision_id: "D-024", approved_at: "2026-11-26T00:00:00Z", status: "approved" },
    ],
  ]);
  const v3Map = new Map([
    ["vid2", { video_id: "vid2", analysis_content_sha256: sha256TidbCellValue(newAna2), mechanical_passed: true }],
  ]);
  const res = auditOriginalColumnsAgainstPreD({
    liveRows: [
      { id: "vid1", aiScoreBreakdown: newBd1, aiAnalysis: "old1", updatedAt: "2026-11-20T00:00:00.000Z" },
      { id: "vid2", aiScoreBreakdown: "old_bd2", aiAnalysis: newAna2, updatedAt: "2026-11-20T00:00:00.000Z" },
    ],
    backupMap,
    originalColumns: ["id", "aiScoreBreakdown", "aiAnalysis", "updatedAt"],
    legacyScoreColumns: new Set(["aiScoreBreakdown", "aiAnalysis"]),
    approvedOverrideMap: approvedMap,
    v3ManifestMap: v3Map,
  });
  assert.equal(res.passed, true);
  assert.equal(res.approved_overrides_matched_count, 1);
  assert.equal(res.v3_manifest_matched_count, 1);
});

test("selectV3Entries --list pins exact video_ids/versions/SHA-256s regardless of new canonical folders and fails closed on drift", () => {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), "v3-pinned-list-test-"));
  try {
    const makeVideo = (vid, promptVer, promptSha, body) => {
      const dir = path.join(td, vid);
      fs.mkdirSync(dir);
      const chk = JSON.stringify({
        video_id: vid,
        prompt_sha256_verified: true,
        transcript_audit: { ok: true },
        mechanical: { all_passed: true, scenes_count: 1, chapters_count: 11 },
      });
      fs.writeFileSync(path.join(dir, "analysis_v3.md"), body, "utf8");
      fs.writeFileSync(path.join(dir, "mechanical_check.json"), chk, "utf8");
      fs.writeFileSync(
        path.join(dir, "manifest.json"),
        JSON.stringify({
          video_id: vid,
          analysis_version: "v3",
          prompt_version: promptVer,
          prompt_template_sha256: promptSha,
          created_at: "2026-11-26T15:00:00+09:00",
          files: {
            "analysis_v3.md": { bytes: Buffer.byteLength(body, "utf8"), sha256: sha256Str(body) },
            "mechanical_check.json": { bytes: Buffer.byteLength(chk, "utf8"), sha256: sha256Str(chk) },
          },
        }),
        "utf8"
      );
      return sha256Str(body);
    };

    const pSha1 = "1".repeat(64);
    const pSha2 = "2".repeat(64);
    // Add lexicographically earlier video "000_new" that is NOT in the pinned list
    makeVideo("000_new", "v3.2", pSha2, "## 3. シーン\n- #01 【00:00-00:05】 新規: テスト\n");
    const shaA = makeVideo("vid_a", "v3.1", pSha1, "## 3. シーン\n- #01 【00:00-00:05】 A: テスト\n");
    const shaB = makeVideo("vid_b", "v3.2", pSha2, "## 3. シーン\n- #01 【00:00-00:05】 B: テスト\n");

    const listPath = path.join(td, "pinned.json");
    fs.writeFileSync(
      listPath,
      JSON.stringify({
        list_id: "test_pinned",
        entries: [
          { video_id: "vid_b", prompt_version: "v3.2", prompt_template_sha256: pSha2, analysis_v3_sha256: shaB },
          { video_id: "vid_a", prompt_version: "v3.1", prompt_template_sha256: pSha1, analysis_v3_sha256: shaA },
        ],
      }),
      "utf8"
    );

    const v3Loaded = loadV3CanonicalManifestMap(td);
    assert.equal(v3Loaded.valid_map.size, 3);
    const pinnedMeta = loadPinnedV3ApplyList(listPath);
    assert.equal(pinnedMeta.entries.length, 2);

    // Exact pinned order preserved, "000_new" ignored
    const { selectedEntries } = selectV3Entries({ v3Loaded, listPath, storeDir: td });
    assert.deepEqual(
      selectedEntries.map((e) => e.video_id),
      ["vid_b", "vid_a"]
    );

    // Drift in analysis_v3_sha256 fails closed
    const badShaList = path.join(td, "bad_sha.json");
    fs.writeFileSync(
      badShaList,
      JSON.stringify({
        entries: [{ video_id: "vid_a", prompt_version: "v3.1", prompt_template_sha256: pSha1, analysis_v3_sha256: "f".repeat(64) }],
      }),
      "utf8"
    );
    assert.throws(() => selectV3Entries({ v3Loaded, listPath: badShaList, storeDir: td }), /analysis_v3\.md SHA-256 mismatch/);

    // Drift in prompt_template_sha256 fails closed
    const badPromptList = path.join(td, "bad_prompt.json");
    fs.writeFileSync(
      badPromptList,
      JSON.stringify({
        entries: [{ video_id: "vid_a", prompt_version: "v3.1", prompt_template_sha256: pSha2, analysis_v3_sha256: shaA }],
      }),
      "utf8"
    );
    assert.throws(() => selectV3Entries({ v3Loaded, listPath: badPromptList, storeDir: td }), /prompt_template_sha256 mismatch/);

    // Drift in prompt_version fails closed
    const badVerList = path.join(td, "bad_ver.json");
    fs.writeFileSync(
      badVerList,
      JSON.stringify({
        entries: [{ video_id: "vid_a", prompt_version: "v3.2", prompt_template_sha256: pSha1, analysis_v3_sha256: shaA }],
      }),
      "utf8"
    );
    assert.throws(() => selectV3Entries({ v3Loaded, listPath: badVerList, storeDir: td }), /prompt_version mismatch/);
  } finally {
    fs.rmSync(td, { recursive: true, force: true });
  }
});

test("loadV3CanonicalManifestMap includes underscore-prefixed YouTube IDs and excludes only _docs, _prompts, and dirs without manifest.json", () => {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), "v3-underscore-ids-test-"));
  try {
    const makeValidVideo = (vid) => {
      const dir = path.join(td, vid);
      fs.mkdirSync(dir);
      const body = "## 0. 総括\n本文\n## 3. シーン\n- #01 【00:00-00:05】 導入: テスト\n";
      const chk = JSON.stringify({
        video_id: vid,
        prompt_sha256_verified: true,
        transcript_audit: { ok: true },
        mechanical: { all_passed: true, scenes_count: 1, chapters_count: 11 },
      });
      fs.writeFileSync(path.join(dir, "analysis_v3.md"), body, "utf8");
      fs.writeFileSync(path.join(dir, "mechanical_check.json"), chk, "utf8");
      fs.writeFileSync(
        path.join(dir, "manifest.json"),
        JSON.stringify({
          video_id: vid,
          analysis_version: "v3",
          prompt_version: "v3.2",
          prompt_template_sha256: "e".repeat(64),
          created_at: "2026-11-27T00:00:00+09:00",
          files: {
            "analysis_v3.md": { bytes: Buffer.byteLength(body, "utf8"), sha256: sha256Str(body) },
            "mechanical_check.json": { bytes: Buffer.byteLength(chk, "utf8"), sha256: sha256Str(chk) },
          },
        }),
        "utf8"
      );
    };

    // Real underscore-prefixed YouTube IDs MUST be loaded
    makeValidVideo("_F6oRAbEoLY");
    makeValidVideo("_-nLBLtidZ4");
    makeValidVideo("normalVid01");

    // _docs and _prompts MUST be excluded even if they contain manifest.json
    for (const metaDir of ["_docs", "_prompts"]) {
      const p = path.join(td, metaDir);
      fs.mkdirSync(p);
      fs.writeFileSync(path.join(p, "manifest.json"), JSON.stringify({ note: "meta manifest" }), "utf8");
    }

    // Directories without manifest.json MUST be skipped (not rejected)
    fs.mkdirSync(path.join(td, "_scratch_no_manifest"));
    fs.mkdirSync(path.join(td, "partial_dir_no_manifest"));

    const loaded = loadV3CanonicalManifestMap(td);
    assert.deepEqual(Array.from(loaded.valid_map.keys()).sort(), ["_-nLBLtidZ4", "_F6oRAbEoLY", "normalVid01"]);
    assert.equal(loaded.rejected.length, 0);
  } finally {
    fs.rmSync(td, { recursive: true, force: true });
  }
});
