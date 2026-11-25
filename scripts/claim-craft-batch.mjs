#!/usr/bin/env node
/**
 * Multi-machine Git-based claim manager for Craft Recipe v2 work (D-022 / CRAFT_RECIPE_DISTRIBUTION_DESIGN.md).
 *
 * Task types:
 *  - craft_recipe_v2_upgrade (files: analysis/claims/craft_upg_<stamp>.json)
 *  - craft_recipe_new        (files: analysis/claims/craft_new_<stamp>.json)
 *
 * Guarantees:
 *  - Isolated from phase3_calibration claims via `task_type`.
 *  - Enforces 0 video_id overlaps across ALL active craft_recipe_* claims.
 *  - Requires explicit worker name (--worker or IKETERU_WORKER_NAME; no OS hostname fallback).
 *  - Enforces D-022 filter: calibrated_score >= 78 and cached video file present on disk.
 *  - Never uses Google Drive for locking/claims.
 */

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_CLAIMS_DIR = path.join(REPO_ROOT, "analysis", "claims");
const DEFAULT_SQLITE_PATH = "E:\\iketeru-creative-studio\\data\\iketeru_knowledge.db";
const DEFAULT_CACHE_DIR = "D:\\マイドライブ\\iketeru_videos";

export const VALID_CRAFT_TASK_TYPES = Object.freeze([
  "craft_recipe_v2_upgrade",
  "craft_recipe_new",
]);

export const VALID_CRAFT_POOLS = Object.freeze([
  "381_gt15s_ge78",
  "381_le15s_ge78",
  "new_138_ge78",
  "custom",
]);

export function validateCraftTaskType(taskType) {
  const t = String(taskType || "").trim();
  if (!VALID_CRAFT_TASK_TYPES.includes(t)) {
    throw new Error(`Invalid --task-type "${t}". Allowed: ${VALID_CRAFT_TASK_TYPES.join(", ")}`);
  }
  return t;
}

export function validateCraftPool(pool) {
  const p = String(pool || "").trim();
  if (!VALID_CRAFT_POOLS.includes(p)) {
    throw new Error(`Invalid --pool "${p}". Allowed: ${VALID_CRAFT_POOLS.join(", ")}`);
  }
  return p;
}

export function defaultTaskTypeForPool(pool) {
  return pool === "new_138_ge78" ? "craft_recipe_new" : "craft_recipe_v2_upgrade";
}

export function loadCraftClaims(claimsDir = DEFAULT_CLAIMS_DIR) {
  if (!fs.existsSync(claimsDir)) return [];
  const files = fs
    .readdirSync(claimsDir)
    .filter((f) => f.endsWith(".json") && !f.endsWith("_ids.json") && !f.startsWith("_"))
    .sort();
  return files
    .map((f) => {
      const full = path.join(claimsDir, f);
      const data = JSON.parse(fs.readFileSync(full, "utf8"));
      return { file: f, path: full, data };
    })
    .filter((c) => VALID_CRAFT_TASK_TYPES.includes(String(c.data.task_type || "")));
}

export function verifyActiveCraftClaims(claims) {
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

export function selectCraftCandidates({
  candidates,
  ownerById = new Map(),
  completedById = new Set(),
  batchSize = 20,
  seed = null,
}) {
  const available = candidates.filter((c) => {
    const id = String(c.id || c);
    return !ownerById.has(id) && !completedById.has(id);
  });
  let ordered = [...available];
  if (seed) {
    ordered.sort((a, b) => {
      const ha = crypto.createHash("sha256").update(`${seed}:${a.id || a}`).digest("hex");
      const hb = crypto.createHash("sha256").update(`${seed}:${b.id || b}`).digest("hex");
      return ha.localeCompare(hb);
    });
  } else {
    ordered.sort((a, b) => String(a.id || a).localeCompare(String(b.id || b)));
  }
  return ordered.slice(0, batchSize);
}

let _envLoaded = false;
function loadEnvOnce() {
  if (_envLoaded) return;
  _envLoaded = true;
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
}

function resolveWorkerName(argWorker) {
  loadEnvOnce();
  const name = String(argWorker || process.env.IKETERU_WORKER_NAME || "").trim();
  if (!name) {
    throw new Error("Worker name is required: pass --worker <name> or set IKETERU_WORKER_NAME in .env / environment.");
  }
  return name;
}

function generateCraftRunId(taskType) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const prefix = taskType === "craft_recipe_new" ? "craft_new" : "craft_upg";
  return `${prefix}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

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

function queryPoolsFromSqlite({ sqlitePath, cacheDir, minScore = 78.0 }) {
  const pyCode = [
    "import sqlite3, json, pathlib, sys",
    "db, cache_dir, min_score = sys.argv[1], pathlib.Path(sys.argv[2]), float(sys.argv[3])",
    "cache_stems = {p.stem for p in cache_dir.iterdir() if p.is_file() and p.stat().st_size > 0 and not p.name.endswith('.corrupted')} if cache_dir.exists() else set()",
    "con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)",
    "con.row_factory = sqlite3.Row",
    "vids = {r['id']: dict(r) for r in con.execute('SELECT id, platform, title, calibrated_score, technique_rating, analysis_observation_scope, LENGTH(TRIM(COALESCE(ai_analysis, \"\"))) AS alen FROM videos').fetchall()}",
    "scenes = {r[0] for r in con.execute('SELECT DISTINCT video_id FROM scenes').fetchall()}",
    "craft = {}",
    "for r in con.execute('SELECT video_id, cut_index, start_sec, end_sec, recipe_json FROM craft_recipes ORDER BY video_id, cut_index').fetchall():",
    "    rj = json.loads(r['recipe_json'] or '{}')",
    "    dur = float(r['end_sec'] or 0) - float(r['start_sec'] or 0)",
    "    is_v2 = bool(rj.get('frame_timeline') and rj.get('effect_chain') and (rj.get('primary_tool') or (rj.get('tool_decision') or {}).get('primary_tool')))",
    "    craft.setdefault(r['video_id'], []).append({'dur': dur, 'is_v2': is_v2, 'needs_recut': dur > 15.0})",
    "p_gt15, p_le15, p_new = [], [], []",
    "for vid, v in sorted(vids.items()):",
    "    if v['alen'] <= 0 or v['analysis_observation_scope'] is not None or vid not in scenes or vid not in cache_stems:",
    "        continue",
    "    cs = v['calibrated_score']",
    "    if cs is None or float(cs) < min_score:",
    "        continue",
    "    if vid in craft:",
    "        cuts = craft[vid]",
    "        if all(c['is_v2'] and not c['needs_recut'] for c in cuts): continue",
    "        if any(c['needs_recut'] for c in cuts): p_gt15.append({'id': vid, 'calibrated_score': float(cs), 'title': v['title']})",
    "        else: p_le15.append({'id': vid, 'calibrated_score': float(cs), 'title': v['title']})",
    "    else:",
    "        p_new.append({'id': vid, 'calibrated_score': float(cs), 'title': v['title']})",
    "print(json.dumps({'381_gt15s_ge78': p_gt15, '381_le15s_ge78': p_le15, 'new_138_ge78': p_new}, ensure_ascii=False))",
    "con.close()",
  ].join("\n");
  const out = execFileSync("python", ["-c", pyCode, sqlitePath.replace(/\\/g, "/"), cacheDir, String(minScore)], {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function main() {
  loadEnvOnce();
  const args = parseArgs(process.argv);
  const claimsDir = args["claims-dir"] ? path.resolve(args["claims-dir"]) : DEFAULT_CLAIMS_DIR;
  const sqlitePath = args["sqlite-path"] || process.env.IKETERU_SQLITE_PATH || DEFAULT_SQLITE_PATH;
  const cacheDir = args["cache-dir"] || process.env.IKETERU_VIDEO_CACHE_DIR || DEFAULT_CACHE_DIR;
  const minScore = args["min-score"] ? Number(args["min-score"]) : 78.0;

  if (args.verify) {
    const claims = loadCraftClaims(claimsDir);
    const res = verifyActiveCraftClaims(claims);
    console.log(JSON.stringify({ claims_dir: claimsDir, total_craft_claims: claims.length, ...res, ownerById: undefined }, null, 2));
    if (res.overlaps.length > 0) process.exit(1);
    return;
  }

  if (args.complete) {
    const runId = String(args.complete);
    const claimPath = path.join(claimsDir, `${runId}.json`);
    if (!fs.existsSync(claimPath)) throw new Error(`Claim not found: ${claimPath}`);
    const doc = JSON.parse(fs.readFileSync(claimPath, "utf8"));
    doc.status = "completed";
    doc.completed_at = new Date().toISOString();
    fs.writeFileSync(claimPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ completed: runId, status: doc.status, completed_at: doc.completed_at }, null, 2));
    return;
  }

  if (args.release) {
    const runId = String(args["run-id"] || "");
    if (!runId) throw new Error("--release requires --run-id <run_id>");
    const claimPath = path.join(claimsDir, `${runId}.json`);
    if (!fs.existsSync(claimPath)) throw new Error(`Claim not found: ${claimPath}`);
    const doc = JSON.parse(fs.readFileSync(claimPath, "utf8"));
    doc.status = "released";
    doc.released_at = new Date().toISOString();
    doc.release_reason = String(args.reason || "manual_release");
    fs.writeFileSync(claimPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ released: runId, status: doc.status, release_reason: doc.release_reason }, null, 2));
    return;
  }

  const claims = loadCraftClaims(claimsDir);
  const verified = verifyActiveCraftClaims(claims);
  const pools = queryPoolsFromSqlite({ sqlitePath, cacheDir, minScore });

  if (args.status) {
    const available = {};
    for (const [k, list] of Object.entries(pools)) {
      available[k] = list.filter((c) => !verified.ownerById.has(c.id)).length;
    }
    console.log(
      JSON.stringify(
        {
          active_craft_claims: claims
            .filter((c) => c.data.status === "active")
            .map((c) => ({
              run_id: c.data.run_id,
              task_type: c.data.task_type,
              worker: c.data.worker,
              pool: c.data.target_pool,
              count: (c.data.video_ids || []).length,
              claimed_at: c.data.claimed_at,
            })),
          overlaps_count: verified.overlaps.length,
          min_calibrated_score: minScore,
          available_unclaimed_pools: available,
        },
        null,
        2
      )
    );
    return;
  }

  if (args.claim) {
    if (verified.overlaps.length > 0) {
      throw new Error(`Existing active craft claim overlaps detected: ${JSON.stringify(verified.overlaps)}`);
    }
    const worker = resolveWorkerName(args.worker);
    const pool = validateCraftPool(args.pool || "381_gt15s_ge78");
    const taskType = validateCraftTaskType(args["task-type"] || defaultTaskTypeForPool(pool));
    const batchSize = Math.min(50, Math.max(1, parseInt(String(args["batch-size"] || "20"), 10)));
    const seed = args.seed ? String(args.seed) : null;

    let selectedIds = [];
    if (pool === "custom") {
      const rawIds = String(args.ids || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (rawIds.length === 0) throw new Error("--pool custom requires --ids id1,id2,...");
      for (const vid of rawIds) {
        if (verified.ownerById.has(vid)) {
          throw new Error(`Video ID "${vid}" is already locked by active craft claim ${verified.ownerById.get(vid)}`);
        }
      }
      selectedIds = [...new Set(rawIds)];
    } else {
      const selected = selectCraftCandidates({
        candidates: pools[pool] || [],
        ownerById: verified.ownerById,
        batchSize,
        seed,
      });
      selectedIds = selected.map((x) => x.id);
    }

    if (selectedIds.length === 0) {
      throw new Error(`No available unclaimed candidates in pool "${pool}".`);
    }

    const runId = args["run-id"] ? String(args["run-id"]) : generateCraftRunId(taskType);
    const doc = {
      schema_version: 2,
      task_type: taskType,
      run_id: runId,
      worker,
      status: "active",
      target_pool: pool,
      selection_seed: seed,
      min_calibrated_score: minScore,
      require_local_cache: true,
      batch_size: selectedIds.length,
      video_ids: selectedIds,
      claimed_at: new Date().toISOString(),
      completed_at: null,
      released_at: null,
      release_reason: null,
    };

    if (args["dry-run"]) {
      console.log(JSON.stringify({ dry_run: true, claim: doc }, null, 2));
      return;
    }

    fs.mkdirSync(claimsDir, { recursive: true });
    const claimPath = path.join(claimsDir, `${runId}.json`);
    const idsPath = path.join(claimsDir, `${runId}_ids.json`);
    fs.writeFileSync(claimPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
    fs.writeFileSync(idsPath, JSON.stringify(selectedIds, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ claimed: true, claim_path: claimPath, ids_path: idsPath, run_id: runId, count: selectedIds.length, video_ids: selectedIds }, null, 2));
    return;
  }

  console.error("Usage: node scripts/claim-craft-batch.mjs (--status | --verify | --claim --worker <w> --pool <p> [--batch-size N] [--ids ...] [--seed s] [--dry-run] | --complete <run_id> | --release --run-id <run_id> --reason <r>)");
  process.exit(2);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
