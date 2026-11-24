#!/usr/bin/env node
/**
 * Multi-machine claim/lease manager for Phase 3 C calibration batches.
 *
 * Allows N machines to run calibration batches concurrently with ZERO video-ID overlap:
 *  - Active claims live in `analysis/claims/<run_id>.json` (tracked in Git).
 *  - Before starting a new batch on ANY machine:
 *      1. `git pull`
 *      2. `node scripts/claim-phase3-batch.mjs --worker <machine_name> --priority <tier> --batch-size <N> [--id-list <path>]`
 *      3. `git add analysis/claims/<run_id>* && git commit -m "..." && git push`
 *         (If another machine pushed concurrently, `git pull --rebase` + `--verify` detects any conflict immediately.)
 *      4. Pass `--id-list analysis/claims/<run_id>_ids.json` to `prepare-phase3-batch.mjs`.
 *  - After TiDB apply finishes:
 *      `node scripts/claim-phase3-batch.mjs --complete <run_id>` and push.
 *
 * Does NOT modify any frozen Phase 2 scoring/calibration files.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CLAIMS_DIR = path.join(REPO_ROOT, "analysis", "claims");
const MAX_BATCH_SIZE = 200;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[k] = true;
      } else {
        args[k] = next;
        i++;
      }
    }
  }
  return args;
}

function generateRunId() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `run_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function loadAllClaims() {
  if (!fs.existsSync(CLAIMS_DIR)) return [];
  const files = fs.readdirSync(CLAIMS_DIR).filter((f) => f.endsWith(".json") && !f.endsWith("_ids.json")).sort();
  return files.map((f) => {
    const full = path.join(CLAIMS_DIR, f);
    const data = JSON.parse(fs.readFileSync(full, "utf8"));
    return { file: f, path: full, data };
  });
}

function verifyActiveClaims(claims) {
  const active = claims.filter((c) => c.data.status === "active");
  const ownerById = new Map();
  const overlaps = [];
  for (const c of active) {
    for (const vid of c.data.video_ids || []) {
      const id = String(vid);
      if (ownerById.has(id)) {
        overlaps.push({ video_id: id, run_a: ownerById.get(id), run_b: c.data.run_id });
      } else {
        ownerById.set(id, c.data.run_id);
      }
    }
  }
  return { activeCount: active.length, totalLockedIds: ownerById.size, ownerById, overlaps };
}

async function fetchTidbVideos() {
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env") });
  const mysql = require("mysql2/promise");
  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });
  try {
    const [rows] = await conn.query(`
      SELECT id, platform, videoUrl, genres, privateRating, calibratedScore, calibrationStatus
      FROM videos
      ORDER BY id ASC
    `);
    return rows;
  } finally {
    await conn.end();
  }
}

function isYoutubeRow(row) {
  if (String(row.platform || "").toLowerCase() === "youtube") return true;
  const u = row.videoUrl || "";
  return typeof u === "string" && (u.includes("youtube.com") || u.includes("youtu.be"));
}

async function main() {
  const args = parseArgs(process.argv);
  fs.mkdirSync(CLAIMS_DIR, { recursive: true });

  // 1. Register an existing active run directory as a claim
  if (args["register-run"]) {
    const runId = String(args["register-run"]);
    const worker = String(args["worker"] || os.hostname());
    const manifestPath = path.join(REPO_ROOT, "analysis", "runs", runId, "run_manifest.json");
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`run_manifest.json not found: ${manifestPath}`);
    }
    const rm = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const prepared = Array.isArray(rm.items) ? rm.items.map((x) => String(x.video_id)) : Object.keys(rm.items || {});
    const failed = (rm.runtime_failures || []).map((x) => String(x.video_id || x.id));
    const allIds = [...new Set([...prepared, ...failed])].sort();

    const claim = {
      schema_version: 1,
      run_id: runId,
      worker,
      priority: rm.priority || "P0_craft_recipes",
      batch_index: rm.batch_index || null,
      status: "active",
      claimed_at: rm.created_at || new Date().toISOString(),
      prepared_count: prepared.length,
      failed_count: failed.length,
      video_ids: allIds,
    };
    const outPath = path.join(CLAIMS_DIR, `${runId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(claim, null, 2) + "\n", "utf8");

    const check = verifyActiveClaims(loadAllClaims());
    if (check.overlaps.length > 0) {
      throw new Error(`Overlap detected after registering ${runId}: ${JSON.stringify(check.overlaps.slice(0, 5))}`);
    }
    console.log(JSON.stringify({ registered: runId, worker, locked_ids: allIds.length, active_claims: check.activeCount, overlaps: 0 }, null, 2));
    return;
  }

  // 2. Complete/release an active claim
  if (args["complete"]) {
    const runId = String(args["complete"]);
    const claimPath = path.join(CLAIMS_DIR, `${runId}.json`);
    if (!fs.existsSync(claimPath)) {
      throw new Error(`Claim not found: ${claimPath}`);
    }
    const claim = JSON.parse(fs.readFileSync(claimPath, "utf8"));
    claim.status = "completed";
    claim.completed_at = new Date().toISOString();
    fs.writeFileSync(claimPath, JSON.stringify(claim, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ completed: runId, status: claim.status, completed_at: claim.completed_at }, null, 2));
    return;
  }

  // 2b. Release/cancel an active claim without completing it
  if (args["release"]) {
    const runId = typeof args["release"] === "string" ? args["release"] : String(args["run-id"] || "");
    if (!runId) {
      throw new Error("Usage: node scripts/claim-phase3-batch.mjs --release --run-id <run_id> [--reason <text>]");
    }
    const claimPath = path.join(CLAIMS_DIR, `${runId}.json`);
    if (!fs.existsSync(claimPath)) {
      throw new Error(`Claim not found: ${claimPath}`);
    }
    const claim = JSON.parse(fs.readFileSync(claimPath, "utf8"));
    const prevStatus = claim.status;
    claim.status = "released";
    claim.released_at = new Date().toISOString();
    claim.release_reason = String(args["reason"] || "manual_release");
    fs.writeFileSync(claimPath, JSON.stringify(claim, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({
      released: runId,
      previous_status: prevStatus,
      status: claim.status,
      released_at: claim.released_at,
      release_reason: claim.release_reason,
      released_ids_count: (claim.video_ids || []).length,
    }, null, 2));
    return;
  }

  // 3. Verify all active claims have zero pairwise overlap
  if (args["verify"]) {
    const claims = loadAllClaims();
    const check = verifyActiveClaims(claims);
    console.log(JSON.stringify({
      total_claim_files: claims.length,
      active_claims: check.activeCount,
      total_locked_ids: check.totalLockedIds,
      overlaps_count: check.overlaps.length,
      overlaps_sample: check.overlaps.slice(0, 10),
    }, null, 2));
    if (check.overlaps.length > 0) process.exit(1);
    return;
  }

  // 4. Status across TiDB + active claims
  if (args["status"]) {
    const claims = loadAllClaims();
    const check = verifyActiveClaims(claims);
    const rows = await fetchTidbVideos();
    const byId = new Map(rows.map((r) => [String(r.id), r]));

    const craftPath = path.join(REPO_ROOT, "analysis", "phase3_craft_recipes_target_ids.json");
    let craftUnclaimedYt = 0;
    let craftUnclaimedOther = 0;
    if (fs.existsSync(craftPath)) {
      const doc = JSON.parse(fs.readFileSync(craftPath, "utf8"));
      const ids = (Array.isArray(doc) ? doc : doc.video_ids || []).map(String);
      for (const vid of ids) {
        const r = byId.get(vid);
        if (!r || r.calibratedScore != null || check.ownerById.has(vid)) continue;
        if (isYoutubeRow(r)) craftUnclaimedYt++;
        else craftUnclaimedOther++;
      }
    }

    let p1UnclaimedYt = 0;
    let p1UnclaimedOther = 0;
    let totalUncalYt = 0;
    for (const r of rows) {
      if (r.calibratedScore != null) continue;
      const vid = String(r.id);
      if (check.ownerById.has(vid)) continue;
      const yt = isYoutubeRow(r);
      if (yt) totalUncalYt++;
      if (r.privateRating != null) {
        if (yt) p1UnclaimedYt++;
        else p1UnclaimedOther++;
      }
    }

    console.log(JSON.stringify({
      active_claims: claims.filter((c) => c.data.status === "active").map((c) => ({
        run_id: c.data.run_id,
        worker: c.data.worker,
        priority: c.data.priority,
        locked_ids: (c.data.video_ids || []).length,
      })),
      overlaps_count: check.overlaps.length,
      available_unclaimed_pools: {
        P0_craft_recipes_youtube: craftUnclaimedYt,
        P0_craft_recipes_non_youtube: craftUnclaimedOther,
        P1_private_rating_youtube: p1UnclaimedYt,
        P1_private_rating_non_youtube: p1UnclaimedOther,
        all_remaining_uncalibrated_youtube: totalUncalYt,
      },
    }, null, 2));
    return;
  }

  // 5. Create a new disjoint claim for a machine
  if (args["claim"]) {
    const worker = String(args["worker"] || os.hostname());
    const priority = String(args["priority"] || "P1_private_rating");
    const batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, parseInt(args["batch-size"] || "200", 10)));
    const runId = String(args["run-id"] || generateRunId());
    const idListPath = args["id-list"] ? path.resolve(REPO_ROOT, String(args["id-list"])) : null;
    const dryRun = Boolean(args["dry-run"]);

    const claims = loadAllClaims();
    const check = verifyActiveClaims(claims);
    if (check.overlaps.length > 0) {
      throw new Error(`Existing active claims have overlaps! Fix first: ${JSON.stringify(check.overlaps.slice(0, 5))}`);
    }

    const rows = await fetchTidbVideos();
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    const candidates = [];

    if (priority === "P0_craft_recipes") {
      const targetPath = idListPath || path.join(REPO_ROOT, "analysis", "phase3_craft_recipes_target_ids.json");
      const doc = JSON.parse(fs.readFileSync(targetPath, "utf8"));
      const ids = (Array.isArray(doc) ? doc : doc.video_ids || []).map(String);
      for (const vid of ids) {
        const r = byId.get(vid);
        if (!r || r.calibratedScore != null || check.ownerById.has(vid)) continue;
        if (!isYoutubeRow(r)) continue;
        candidates.push(vid);
      }
    } else if (priority === "P1_private_rating") {
      for (const r of rows) {
        const vid = String(r.id);
        if (r.privateRating == null || r.calibratedScore != null || check.ownerById.has(vid)) continue;
        if (!isYoutubeRow(r)) continue;
        candidates.push(vid);
      }
    } else {
      for (const r of rows) {
        const vid = String(r.id);
        if (r.calibratedScore != null || check.ownerById.has(vid)) continue;
        if (!isYoutubeRow(r)) continue;
        candidates.push(vid);
      }
    }

    const chosen = candidates.slice(0, batchSize);
    if (chosen.length === 0) {
      console.log(JSON.stringify({ message: "No unclaimed uncalibrated YouTube videos available for this priority.", priority, active_locked: check.totalLockedIds }, null, 2));
      return;
    }

    const claim = {
      schema_version: 1,
      run_id: runId,
      worker,
      priority,
      status: "active",
      claimed_at: new Date().toISOString(),
      video_ids: chosen,
    };

    if (!dryRun) {
      fs.writeFileSync(path.join(CLAIMS_DIR, `${runId}.json`), JSON.stringify(claim, null, 2) + "\n", "utf8");
      fs.writeFileSync(
        path.join(CLAIMS_DIR, `${runId}_ids.json`),
        JSON.stringify({ run_id: runId, worker, priority, video_ids: chosen }, null, 2) + "\n",
        "utf8"
      );
    }

    console.log(JSON.stringify({
      dry_run: dryRun,
      run_id: runId,
      worker,
      priority,
      claimed_count: chosen.length,
      remaining_unclaimed_in_pool: candidates.length - chosen.length,
      claim_file: `analysis/claims/${runId}.json`,
      id_list_file: `analysis/claims/${runId}_ids.json`,
      next_prepare_cmd: `node scripts/prepare-phase3-batch.mjs --priority P0_craft_recipes --id-list analysis/claims/${runId}_ids.json --batch 1 --batch-size ${chosen.length} --uncalibrated-head --run-id ${runId} --frozen-config analysis/phase2_frozen_config_v1.json`,
    }, null, 2));
    return;
  }

  console.log(`Usage:
  node scripts/claim-phase3-batch.mjs --status
  node scripts/claim-phase3-batch.mjs --verify
  node scripts/claim-phase3-batch.mjs --register-run <run_id> [--worker <name>]
  node scripts/claim-phase3-batch.mjs --claim --worker <name> --priority <P0_craft_recipes|P1_private_rating|ALL> [--batch-size 200] [--dry-run]
  node scripts/claim-phase3-batch.mjs --complete <run_id>
  node scripts/claim-phase3-batch.mjs --release --run-id <run_id> [--reason <text>]`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
