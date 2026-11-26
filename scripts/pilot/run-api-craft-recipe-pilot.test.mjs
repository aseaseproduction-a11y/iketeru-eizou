import test from "node:test";
import assert from "node:assert/strict";
import {
  loadAndVerifyPreregistration,
  renderCraftPrompt,
  buildCraftRequestBody,
  estimateCraftCallCostUsd,
  parseAndValidateCraftRecipeJson,
  attachApiProvenance,
  EXPECTED_PREREG_LF_SHA256,
  EXPECTED_PROMPT_SHA256,
} from "./run-api-craft-recipe-pilot.mjs";

test("loadAndVerifyPreregistration verifies LF SHA-256, prompt SHA-256, and 5 videos", () => {
  const { prereg, preregLfSha256, promptSha256 } = loadAndVerifyPreregistration();
  assert.equal(preregLfSha256, EXPECTED_PREREG_LF_SHA256);
  assert.equal(promptSha256, EXPECTED_PROMPT_SHA256);
  assert.equal(prereg.selected_videos.length, 5);
  assert.deepEqual(
    prereg.selected_videos.map((v) => v.video_id),
    ["FcIFvzP8-mg", "jsEVOjI690Y", "Xr032EhUDPw", "I0jHbsidh1g", "kqj7b59D85Y"]
  );
});

test("renderCraftPrompt substitutes only allowed metadata and never injects scenes", () => {
  const { prereg } = loadAndVerifyPreregistration();
  const v = prereg.selected_videos[0];
  const rendered = renderCraftPrompt(prereg.prompt.prompt_text, v);
  assert.ok(rendered.includes(v.video_id));
  assert.ok(rendered.includes(v.title));
  assert.ok(rendered.includes("web-cm, teaser-trailer"));
  assert.ok(!rendered.includes("{{"));
  // Ensure existing cut title from preregistration is NOT injected into prompt
  assert.ok(!rendered.includes("機械式カメラ絞りアイリス開閉シンク"));
});

test("buildCraftRequestBody constructs Pass 1 (1 fps) and Pass 2 (4 fps clipped) Interactions API payloads", () => {
  const p1 = buildCraftRequestBody({
    promptText: "Prompt 1",
    youtubeUrl: "https://www.youtube.com/watch?v=FcIFvzP8-mg",
    thinkingLevel: "high",
    serviceTier: "flex",
    videoProcessing: { type: "static", fps: 1.0, content_layers: ["frames", "audio"] },
    resolution: "low",
  });
  assert.equal(p1.service_tier, "flex");
  assert.equal(p1.store, false);
  assert.equal(p1.generation_config.thinking_level, "high");
  assert.equal(p1.input[1].processing.fps, 1.0);
  assert.deepEqual(p1.input[1].processing.content_layers, ["frames", "audio"]);

  const p2 = buildCraftRequestBody({
    promptText: "Prompt 2",
    youtubeUrl: "https://www.youtube.com/watch?v=jsEVOjI690Y",
    thinkingLevel: "high",
    serviceTier: "flex",
    videoProcessing: {
      type: "static",
      start_offset: "0s",
      end_offset: "15s",
      fps: 4.0,
      content_layers: ["frames"],
    },
    resolution: "low",
  });
  assert.equal(p2.input[1].processing.fps, 4.0);
  assert.equal(p2.input[1].processing.start_offset, "0s");
  assert.equal(p2.input[1].processing.end_offset, "15s");
  assert.deepEqual(p2.input[1].processing.content_layers, ["frames"]);
});

test("estimateCraftCallCostUsd matches design doc formula", () => {
  const c15 = estimateCraftCallCostUsd(15, "flex", { fps: 1.0, outThoughtTok: 7000 });
  assert.ok(c15 > 0.055 && c15 < 0.062, `unexpected 15s cost: ${c15}`);
  const c180 = estimateCraftCallCostUsd(180, "flex", { fps: 1.0, outThoughtTok: 7000 });
  assert.ok(c180 > 0.08 && c180 < 0.09, `unexpected 180s cost: ${c180}`);
});

test("parseAndValidateCraftRecipeJson parses fenced JSON and rejects empty/broken JSON", () => {
  const okRes = parseAndValidateCraftRecipeJson('```json\n{"cuts":[{"cut_index":1,"title":"Test"}]}\n```');
  assert.equal(okRes.ok, true);
  assert.equal(okRes.cuts_count, 1);

  const badRes = parseAndValidateCraftRecipeJson("not json at all");
  assert.equal(badRes.ok, false);

  const emptyCuts = parseAndValidateCraftRecipeJson('{"cuts":[]}');
  assert.equal(emptyCuts.ok, false);

  const p2Ok = parseAndValidateCraftRecipeJson('{"refined_cuts":[{"cut_index":1}]}', { isPass2: true });
  assert.equal(p2Ok.ok, true);
});

test("attachApiProvenance marks estimated provenance and empty local media safely", () => {
  const sample = {
    video_id: "FcIFvzP8-mg",
    cuts: [
      {
        cut_index: 1,
        title: "Cut 1",
        easing_and_timing: { bpm: 120 },
        ae_blueprint: { layers: [] },
        transition_bridge: { entrance_vector: "cut" },
      },
    ],
  };
  const out = attachApiProvenance(sample, {
    videoMeta: { video_id: "FcIFvzP8-mg", title: "Apple", technique_rating: "A" },
    model: "gemini-4-neon",
    thinkingLevel: "high",
    serviceTier: "flex",
    videoProcessing: { type: "static", fps: 1.0, content_layers: ["frames", "audio"] },
    resolution: "low",
    usage: { input_video_tokens: 1500 },
    attempt: 1,
  });
  assert.equal(out.provenance.source, "gemini_api_url_v1");
  assert.equal(out.cuts[0].easing_and_timing.verified, false);
  assert.equal(out.cuts[0].easing_and_timing.source, "api_estimated");
  assert.equal(out.cuts[0].media.available, false);
});
