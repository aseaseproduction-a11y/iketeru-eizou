import test from "node:test";
import assert from "node:assert/strict";
import { verifyTier2Entry, verifyMetadataEntry } from "./verify-phase2-sources.mjs";

test("verifyTier2Entry rejects bare homepage URLs and forbidden tier tokens", async () => {
  const cache = new Map();
  const resHome = await verifyTier2Entry(
    {
      video_id: "test1",
      evidence_url: "https://www.canneslions.com/",
      verify_rule: { work: ["Work"], tier: ["Gold"], category: ["Film Craft"] },
    },
    cache
  );
  assert.equal(resHome.status, "failed");
  assert.match(resHome.reason, /bare_homepage_or_invalid_url/);

  const resForbid = await verifyTier2Entry(
    {
      video_id: "test2",
      evidence_url: "https://awards.ukmva.com/years/2024",
      verify_rule: { work: ["Work"], tier: ["Film Craft"], category: ["Editing"] },
    },
    cache
  );
  assert.equal(resForbid.status, "failed");
  assert.match(resForbid.reason, /forbidden_tier_token/);
});

test("verifyMetadataEntry enforces verbatim substring, non-commercial guard, and frozen R-LOW regex", () => {
  const metaPro = {
    title: "テレビCM「サンプル篇」30秒",
    description: "全国放映開始。制作会社: サンプルプロダクション",
    channel: "Sample Official",
  };
  const okPro = verifyMetadataEntry(
    { stratum: "non_tier2_pro", evidence_excerpt: "テレビCM「サンプル篇」30秒" },
    metaPro
  );
  assert.equal(okPro.status, "verified");

  const failSummary = verifyMetadataEntry(
    { stratum: "non_tier2_pro", evidence_excerpt: "公式チャンネル公開のテレビCMです（要約）" },
    metaPro
  );
  assert.equal(failSummary.status, "failed");
  assert.equal(failSummary.reason, "evidence_excerpt_not_verbatim_in_live_metadata");

  const failSpec = verifyMetadataEntry(
    { stratum: "non_tier2_pro", evidence_excerpt: "制作: サンプル" },
    { title: "ポートフォリオ", description: "制作: サンプル ※仮想クライアントワーク課題として制作" }
  );
  assert.equal(failSpec.status, "failed");
  assert.match(failSpec.reason, /non_commercial_spec_or_student_work/);

  const okLow = verifyMetadataEntry(
    { stratum: "non_tier2_low", evidence_excerpt: "After Effects初心者による練習で作った動画" },
    { title: "After Effects初心者による練習で作った動画", description: "" }
  );
  assert.equal(okLow.status, "verified");

  const failLow = verifyMetadataEntry(
    { stratum: "non_tier2_low", evidence_excerpt: "My first After Effects animation" },
    { title: "My first After Effects animation", description: "" }
  );
  assert.equal(failLow.status, "failed");
  assert.equal(failLow.reason, "r_low_frozen_keyword_not_matched_in_live_metadata");
});
