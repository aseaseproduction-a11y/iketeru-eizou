#!/usr/bin/env node
/**
 * Validate (G1-G7) a locally staged craft recipe folder and publish it safely to IKETERU_RECIPE_STORE_DIR.
 *
 * Protocol (CRAFT_RECIPE_DISTRIBUTION_DESIGN.md §2-3 & §7-3):
 *  1. Complete all media & recipe.json in local staging folder first.
 *  2. Run 7-gate automated validation (G1..G7). Fail-closed if any gate fails.
 *  3. Back up existing destination folder (if upgrading) to local backup root.
 *  4. Copy all non-recipe media files first -> copy recipe.json LAST -> remove stale old-cut files -> write _folder_manifest.json.
 *  5. Read back every file from destination and verify 100% SHA-256 match against staging.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOCAB_PATH = path.resolve(__dirname, "..", "shared", "expressivePurposeVocab.json");
export const EXPRESSIVE_PURPOSE_VOCAB = JSON.parse(fs.readFileSync(VOCAB_PATH, "utf8"));

const GEN_AI_VIDEO_RE = /\b(runway|kling|veo|sora|pika|luma|gen-3|hailuo)\b/i;
const IMAGE_TELOP_RE = /(画像生成[^"\n]{0,24}テロップ|テロップ[^"\n]{0,24}画像生成|png[^"\n]{0,24}テロップ|テロップ[^"\n]{0,24}png)/i;

export function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(1024 * 1024);
  try {
    while (true) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

export function validateExpressivePurposeCut(cut, prefix = "cut") {
  const errors = [];
  const ep = cut?.expressive_purpose;
  if (!ep || typeof ep !== "object") {
    errors.push(`${prefix}: missing expressive_purpose object`);
    return errors;
  }
  const v = EXPRESSIVE_PURPOSE_VOCAB;
  const c = v.constraints || {};
  const intent = String(ep.intent_summary || "").trim();
  if (intent.length < (c.intent_summary_min_chars ?? 15)) {
    errors.push(`${prefix}: expressive_purpose.intent_summary missing or < ${c.intent_summary_min_chars ?? 15} chars`);
  }
  const allowedRoles = new Set(v.narrative_role || []);
  if (!allowedRoles.has(String(ep.narrative_role || ""))) {
    errors.push(`${prefix}: invalid narrative_role "${ep.narrative_role}"`);
  }
  const allowedVe = new Set(v.viewer_effect || []);
  const ve = ep.viewer_effect;
  if (!Array.isArray(ve) || ve.length < (c.viewer_effect_min ?? 2) || ve.length > (c.viewer_effect_max ?? 4)) {
    errors.push(`${prefix}: viewer_effect count must be 2..4 (got ${Array.isArray(ve) ? ve.length : "non-array"})`);
  } else {
    const badVe = ve.filter((x) => !allowedVe.has(x));
    if (badVe.length > 0) errors.push(`${prefix}: invalid viewer_effect ${JSON.stringify(badVe)}`);
  }
  const bf = ep.best_for;
  if (!bf || typeof bf !== "object") {
    errors.push(`${prefix}: missing expressive_purpose.best_for`);
  } else {
    for (const k of ["purposes", "genres", "industries", "media_formats", "duration_fit"]) {
      const allowed = new Set((v.best_for || {})[k] || []);
      const vals = bf[k];
      if (!Array.isArray(vals) || vals.length < (c.best_for_each_min ?? 1) || vals.length > (c.best_for_each_max ?? 3)) {
        errors.push(`${prefix}: best_for.${k} count must be 1..3`);
      } else {
        const bad = vals.filter((x) => !allowed.has(x));
        if (bad.length > 0) errors.push(`${prefix}: best_for.${k} invalid values ${JSON.stringify(bad)}`);
      }
    }
  }
  const aw = ep.avoid_when;
  if (!Array.isArray(aw) || aw.length < (c.avoid_when_min ?? 1) || aw.length > (c.avoid_when_max ?? 3) || aw.some((x) => !String(x || "").trim())) {
    errors.push(`${prefix}: avoid_when must have 1..3 non-empty strings`);
  }
  const sp = ep.search_phrases;
  const spMin = c.search_phrases_min ?? 3;
  const spMax = c.search_phrases_max ?? 6;
  if (!Array.isArray(sp) || sp.length < spMin || sp.length > spMax || sp.some((x) => !String(x || "").trim())) {
    errors.push(`${prefix}: search_phrases must have ${spMin}..${spMax} non-empty phrases`);
  }
  const kw = ep.keywords;
  const kwMin = c.keywords_min ?? 5;
  const kwMax = c.keywords_max ?? 10;
  const kwMinC = c.keyword_min_chars ?? 2;
  const kwMaxC = c.keyword_max_chars ?? 10;
  if (!Array.isArray(kw) || kw.length < kwMin || kw.length > kwMax) {
    errors.push(`${prefix}: keywords must have ${kwMin}..${kwMax} items (got ${Array.isArray(kw) ? kw.length : "non-array"})`);
  } else {
    const trimmed = kw.map((x) => String(x || "").trim());
    const badLen = trimmed.filter((x) => x.length < kwMinC || x.length > kwMaxC);
    if (badLen.length > 0) {
      errors.push(`${prefix}: keywords char length must be ${kwMinC}..${kwMaxC}: ${JSON.stringify(badLen)}`);
    }
    if (new Set(trimmed).size !== trimmed.length) {
      errors.push(`${prefix}: keywords contains duplicates`);
    }
  }
  const allowedProv = new Set(v.provenance || []);
  if (!allowedProv.has(String(ep.provenance || ""))) {
    errors.push(`${prefix}: invalid provenance "${ep.provenance}"`);
  }
  const ev = ep.evidence;
  const st = Number(cut?.start_sec);
  const en = Number(cut?.end_sec);
  if (!Array.isArray(ev) || ev.length < (c.evidence_min ?? 1)) {
    errors.push(`${prefix}: evidence must have >= 1 entry`);
  } else {
    for (const item of ev) {
      const ts = Number(item?.timestamp_sec);
      if (!Number.isFinite(ts) || !String(item?.observation || "").trim()) {
        errors.push(`${prefix}: evidence entry missing numeric timestamp_sec or observation`);
        continue;
      }
      if (Number.isFinite(st) && Number.isFinite(en) && (ts < st || ts > en)) {
        errors.push(`${prefix}: evidence timestamp_sec ${ts} out of cut range [${st}, ${en}]`);
      }
    }
  }
  return errors;
}

export function validateRecipeGates({
  videoId,
  stagingDir,
  videoDurationSec = null,
  calibratedScore = null,
  observationScope = null,
  minCredibilityScore = 90,
  minCalibratedScore = 78.0,
  requirePurpose = false,
}) {
  const gates = {
    G1_schema_and_v2: { passed: true, errors: [] },
    G2_duration_and_frames: { passed: true, errors: [] },
    G3_credibility_score: { passed: true, errors: [] },
    G4_production_compliance: { passed: true, errors: [] },
    G5_media_and_telemetry: { passed: true, errors: [] },
    G6_paths_and_provenance: { passed: true, errors: [] },
    G7_rule2_and_d022: { passed: true, errors: [] },
    G8_expressive_purpose: { passed: true, errors: [] },
  };

  const rjPath = path.join(stagingDir, "recipe.json");
  if (!fs.existsSync(rjPath)) {
    gates.G1_schema_and_v2.passed = false;
    gates.G1_schema_and_v2.errors.push("Missing recipe.json in stagingDir");
    return { all_passed: false, gates };
  }

  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(rjPath, "utf8"));
  } catch (err) {
    gates.G1_schema_and_v2.passed = false;
    gates.G1_schema_and_v2.errors.push(`Invalid JSON: ${err.message}`);
    return { all_passed: false, gates };
  }

  if (String(doc.video_id || "") !== String(videoId)) {
    gates.G1_schema_and_v2.errors.push(`video_id mismatch (${doc.video_id} != ${videoId})`);
  }
  const cuts = Array.isArray(doc.cuts) ? doc.cuts : [];
  if (cuts.length === 0) {
    gates.G1_schema_and_v2.errors.push("cuts array is empty");
  }

  const topProv = doc.provenance || {};
  if (!topProv.source || !topProv.worker || !topProv.run_id || !topProv.model) {
    gates.G6_paths_and_provenance.errors.push("Missing required top-level provenance fields (source, worker, run_id, model)");
  }

  for (const c of cuts) {
    const idx = c.cut_index;
    const prefix = `cut#${idx}`;

    // G1: v2 fields
    const hasFt = Array.isArray(c.frame_timeline) && c.frame_timeline.length >= 2;
    const hasEc = Array.isArray(c.effect_chain) && c.effect_chain.length >= 1;
    const hasPt = Boolean(c.primary_tool || c.tool_decision?.primary_tool);
    const hasBpLayers = Array.isArray(c.ae_blueprint?.layers) && c.ae_blueprint.layers.length >= 1;
    if (!hasFt) gates.G1_schema_and_v2.errors.push(`${prefix}: frame_timeline < 2 entries`);
    if (!hasEc) gates.G1_schema_and_v2.errors.push(`${prefix}: effect_chain < 1 entry`);
    if (!hasPt) gates.G1_schema_and_v2.errors.push(`${prefix}: missing primary_tool`);
    if (!hasBpLayers) gates.G1_schema_and_v2.errors.push(`${prefix}: missing ae_blueprint.layers`);

    // G2: duration <= 15s and within video duration
    const st = Number(c.start_sec);
    const en = Number(c.end_sec);
    const dur = en - st;
    if (!Number.isFinite(st) || !Number.isFinite(en) || dur < 0.06 || dur > 15.0) {
      gates.G2_duration_and_frames.errors.push(`${prefix}: duration out of [0.06, 15.0]s (got ${dur.toFixed(3)}s)`);
    }
    if (c.credibility?.needs_recut === true) {
      gates.G2_duration_and_frames.errors.push(`${prefix}: credibility.needs_recut is true`);
    }
    if (videoDurationSec !== null && Number.isFinite(videoDurationSec) && en > videoDurationSec + 0.25) {
      gates.G2_duration_and_frames.errors.push(`${prefix}: end_sec (${en}) exceeds video duration (${videoDurationSec})`);
    }

    // G3: credibility score
    const credScore = Number(c.credibility?.credibility_score ?? -1);
    if (!Number.isFinite(credScore) || credScore < minCredibilityScore) {
      gates.G3_credibility_score.errors.push(`${prefix}: credibility_score ${credScore} < ${minCredibilityScore}`);
    }

    // G4: production standards (exclude media paths & derived credibility to avoid start_png + "テロップ" false positives)
    const { media: _ignoredMedia, credibility: _ignoredCred, ...policyFields } = c;
    const blob = JSON.stringify(policyFields);
    if (GEN_AI_VIDEO_RE.test(blob)) {
      gates.G4_production_compliance.errors.push(`${prefix}: mentions banned gen-AI video tool`);
    }
    if (IMAGE_TELOP_RE.test(blob)) {
      gates.G4_production_compliance.errors.push(`${prefix}: mentions banned image telop`);
    }

    // G5: media files & telemetry
    const media = c.media || {};
    for (const mk of ["gif_path", "strip_path", "start_png", "mid_png", "end_png"]) {
      const rel = String(media[mk] || "");
      if (!rel) {
        gates.G5_media_and_telemetry.errors.push(`${prefix}: missing media.${mk}`);
        continue;
      }
      if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) {
        gates.G6_paths_and_provenance.errors.push(`${prefix}: PC-dependent absolute path in media.${mk}: ${rel}`);
      }
      const fname = path.basename(rel);
      const stagedFile = path.join(stagingDir, fname);
      if (!fs.existsSync(stagedFile) || fs.statSync(stagedFile).size <= 0) {
        gates.G5_media_and_telemetry.errors.push(`${prefix}: staged media file missing or empty: ${fname}`);
      }
    }
    if (media.telemetry?.available !== true) {
      gates.G5_media_and_telemetry.errors.push(`${prefix}: media.telemetry.available is not true`);
    }

    // G8: expressive_purpose (D-024) — always validated when present; required when requirePurpose=true
    if (requirePurpose || c.expressive_purpose !== undefined) {
      gates.G8_expressive_purpose.errors.push(...validateExpressivePurposeCut(c, prefix));
    }
  }

  // G7: Rule 2 unwatched & D-022 >= 78
  if (observationScope !== null && observationScope !== undefined && String(observationScope).trim() !== "") {
    gates.G7_rule2_and_d022.errors.push(`Rule 2 violation: analysis_observation_scope=${observationScope}`);
  }
  if (calibratedScore === null || calibratedScore === undefined || Number(calibratedScore) < minCalibratedScore) {
    gates.G7_rule2_and_d022.errors.push(`D-022 violation: calibrated_score=${calibratedScore} < ${minCalibratedScore}`);
  }

  for (const g of Object.values(gates)) {
    g.passed = g.errors.length === 0;
  }
  const allPassed = Object.values(gates).every((g) => g.passed);
  return { all_passed: allPassed, gates };
}

export function publishStagedRecipeToStore({
  videoId,
  stagingDir,
  storeDir,
  runId,
  worker,
  backupRoot = "E:\\iketeru_backups",
  validationOpts = {},
}) {
  const validation = validateRecipeGates({ videoId, stagingDir, ...validationOpts });
  if (!validation.all_passed) {
    return { published: false, video_id: videoId, validation };
  }

  const dstDir = path.join(storeDir, videoId);
  let backupPath = null;
  if (fs.existsSync(dstDir)) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    backupPath = path.join(backupRoot, `craft_pre_upgrade_${runId}_${stamp}`, videoId);
    fs.mkdirSync(backupPath, { recursive: true });
    for (const name of fs.readdirSync(dstDir)) {
      const sp = path.join(dstDir, name);
      if (fs.statSync(sp).isFile()) {
        fs.copyFileSync(sp, path.join(backupPath, name));
      }
    }
  } else {
    fs.mkdirSync(dstDir, { recursive: true });
  }

  // Compute staging SHA-256s; place all media files FIRST, recipe.json LAST
  const stagedFiles = fs.readdirSync(stagingDir).filter((f) => fs.statSync(path.join(stagingDir, f)).isFile());
  const nonRecipe = stagedFiles.filter((f) => f !== "recipe.json" && f !== "_folder_manifest.json").sort();
  const stagedHashes = {};

  for (const name of nonRecipe) {
    const src = path.join(stagingDir, name);
    const dst = path.join(dstDir, name);
    stagedHashes[name] = { bytes: fs.statSync(src).size, sha256: sha256File(src) };
    fs.copyFileSync(src, dst);
  }

  // Place recipe.json LAST (atomic-style ordering)
  const rjSrc = path.join(stagingDir, "recipe.json");
  const rjDst = path.join(dstDir, "recipe.json");
  stagedHashes["recipe.json"] = { bytes: fs.statSync(rjSrc).size, sha256: sha256File(rjSrc) };
  fs.copyFileSync(rjSrc, rjDst);

  // Remove stale cut files that no longer belong to this upgraded recipe
  const keepSet = new Set([...nonRecipe, "recipe.json", "_folder_manifest.json"]);
  const removedStale = [];
  for (const existing of fs.readdirSync(dstDir)) {
    if (!keepSet.has(existing) && fs.statSync(path.join(dstDir, existing)).isFile()) {
      fs.unlinkSync(path.join(dstDir, existing));
      removedStale.push(existing);
    }
  }

  // Read back every published file from Drive store and verify 100% SHA-256 match
  const mismatches = [];
  for (const [name, expected] of Object.entries(stagedHashes)) {
    const dst = path.join(dstDir, name);
    if (!fs.existsSync(dst)) {
      mismatches.push({ name, reason: "missing_after_copy" });
      continue;
    }
    const actualBytes = fs.statSync(dst).size;
    const actualSha = sha256File(dst);
    if (actualBytes !== expected.bytes || actualSha !== expected.sha256) {
      mismatches.push({ name, expected, actual: { bytes: actualBytes, sha256: actualSha } });
    }
  }

  if (mismatches.length > 0) {
    throw new Error(`Post-publish SHA-256 verification failed for ${videoId}: ${JSON.stringify(mismatches)}`);
  }

  const folderManifest = {
    schema_version: 1,
    video_id: videoId,
    run_id: runId,
    worker,
    published_at: new Date().toISOString(),
    files: stagedHashes,
  };
  fs.writeFileSync(path.join(dstDir, "_folder_manifest.json"), JSON.stringify(folderManifest, null, 2) + "\n", "utf8");

  return {
    published: true,
    video_id: videoId,
    dst_dir: dstDir,
    backup_path: backupPath,
    files_verified: Object.keys(stagedHashes).length,
    removed_stale_files: removedStale,
    validation,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) args[k] = true;
      else { args[k] = next; i++; }
    }
  }
  return args;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const args = parseArgs(process.argv);
    const videoId = args["video-id"];
    const stagingDir = path.resolve(args["staging-dir"] || "");
    const storeDir = path.resolve(args["store-dir"] || process.env.IKETERU_RECIPE_STORE_DIR || "D:\\マイドライブ\\iketeru_craft_recipes");
    const runId = args["run-id"] || "manual";
    const worker = args.worker || process.env.IKETERU_WORKER_NAME || "";
    if (!videoId || !args["staging-dir"] || !worker) {
      throw new Error("Usage: node scripts/publish-craft-recipe-to-store.mjs --video-id <id> --staging-dir <dir> --worker <w> [--store-dir <dir>] [--run-id <id>] [--video-duration <sec>] [--calibrated-score <n>]");
    }
    const res = publishStagedRecipeToStore({
      videoId,
      stagingDir,
      storeDir,
      runId,
      worker,
      validationOpts: {
        videoDurationSec: args["video-duration"] ? Number(args["video-duration"]) : null,
        calibratedScore: args["calibrated-score"] ? Number(args["calibrated-score"]) : null,
        observationScope: args["observation-scope"] || null,
        requirePurpose: Boolean(args["require-purpose"]),
      },
    });
    console.log(JSON.stringify(res, null, 2));
    if (!res.published) process.exit(1);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
