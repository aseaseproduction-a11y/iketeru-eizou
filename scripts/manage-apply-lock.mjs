#!/usr/bin/env node
/**
 * Acquire, inspect, or release `analysis/claims/_apply_lock.json` on `main`.
 *
 * Guarantees:
 *  - Strips UTF-8 BOM on read; always writes UTF-8 WITHOUT BOM.
 *  - On `release`, writes `released_at` (ISO-8601 UTC) and `released_by`.
 *  - Stages and pushes ONLY `analysis/claims/_apply_lock.json` (fails closed if
 *    any other file is staged).
 *
 * Usage:
 *   node scripts/manage-apply-lock.mjs status
 *   node scripts/manage-apply-lock.mjs acquire --run-id <id> --worker <name> [--copy-list-from <src> --copy-list-to <dst>] [--repair-self] [--no-git]
 *   node scripts/manage-apply-lock.mjs release --run-id <id> --worker <name> [--no-git]
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = process.env.IKETERU_REPO_ROOT || path.resolve(__dirname, "..");
export const DEFAULT_LOCK_PATH = path.join(REPO_ROOT, "analysis", "claims", "_apply_lock.json");

export function parseLockJson(rawText) {
  return JSON.parse(String(rawText).replace(/^\uFEFF/, ""));
}

export function extractListCount(listData) {
  const arr = Array.isArray(listData?.entries)
    ? listData.entries
    : Array.isArray(listData?.videos)
      ? listData.videos
      : Array.isArray(listData)
        ? listData
        : [];
  return arr.length;
}

export function buildAcquireLock(currentLock, { worker, runId, startedAt = new Date().toISOString(), allowRepair = false }) {
  if (!worker || !String(worker).trim()) throw new Error("--worker (or IKETERU_WORKER_NAME) is required");
  if (!runId || !String(runId).trim()) throw new Error("--run-id is required");

  const ownedBySelf =
    currentLock?.status === "locked" &&
    (currentLock.worker === worker || currentLock.locked_by === worker) &&
    currentLock.run_id === runId;

  if (currentLock?.status !== "unlocked" && !(allowRepair && ownedBySelf)) {
    throw new Error(`Lock is not unlocked! current=${JSON.stringify(currentLock)}`);
  }

  return {
    schema_version: 1,
    status: "locked",
    worker,
    run_id: runId,
    started_at: startedAt,
    last_worker: currentLock?.last_worker ?? null,
    last_run_id: currentLock?.last_run_id ?? null,
    last_started_at: currentLock?.last_started_at ?? null,
  };
}

export function buildReleaseLock(currentLock, { worker, runId, releasedAt = new Date().toISOString() }) {
  if (!worker || !String(worker).trim()) throw new Error("--worker (or IKETERU_WORKER_NAME) is required");
  if (currentLock?.status !== "locked" || currentLock?.worker !== worker) {
    throw new Error(`Refusing to release lock not owned by ${worker}: ${JSON.stringify(currentLock)}`);
  }
  const effectiveRunId = runId || currentLock.run_id || "unknown";
  return {
    schema_version: 1,
    status: "unlocked",
    worker: null,
    run_id: null,
    started_at: null,
    last_worker: worker,
    last_run_id: effectiveRunId,
    last_started_at: currentLock.started_at || releasedAt,
    released_at: releasedAt,
    released_by: worker,
  };
}

export function parseArgs(argv) {
  const action = argv[0] || "status";
  const opts = {
    action,
    runId: null,
    worker: process.env.IKETERU_WORKER_NAME || null,
    lockPath: DEFAULT_LOCK_PATH,
    copyListFrom: null,
    copyListTo: null,
    maxDelta: 200,
    repairSelf: false,
    noGit: false,
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--run-id") opts.runId = argv[++i];
    else if (a === "--worker") opts.worker = argv[++i];
    else if (a === "--lock-path") opts.lockPath = argv[++i];
    else if (a === "--copy-list-from") opts.copyListFrom = argv[++i];
    else if (a === "--copy-list-to") opts.copyListTo = argv[++i];
    else if (a === "--max-delta") opts.maxDelta = Number(argv[++i]);
    else if (a === "--repair-self") opts.repairSelf = true;
    else if (a === "--no-git") opts.noGit = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

function runGit(gitArgs, cwd = REPO_ROOT) {
  return execFileSync("git", gitArgs, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.noGit && (opts.action === "acquire" || opts.action === "release")) {
    runGit(["fetch", "origin", "--prune"]);
    runGit(["pull", "--rebase", "--autostash", "origin", "main"]);
  }

  const headBefore = opts.noGit ? null : runGit(["rev-parse", "--short", "HEAD"]);
  const currentLock = parseLockJson(fs.readFileSync(opts.lockPath, "utf8"));

  if (opts.action === "status") {
    console.log(JSON.stringify({ head: headBefore, lockPath: opts.lockPath, lock: currentLock }, null, 2));
    return;
  }

  if (opts.action === "acquire") {
    if (opts.copyListFrom && opts.copyListTo) {
      const listData = JSON.parse(fs.readFileSync(opts.copyListFrom, "utf8"));
      const count = extractListCount(listData);
      if (count < 1 || count > opts.maxDelta) {
        throw new Error(`Invalid list count: ${count} (allowed: 1..${opts.maxDelta})`);
      }
      if (listData.list_id) listData.list_id = opts.runId;
      fs.mkdirSync(path.dirname(opts.copyListTo), { recursive: true });
      fs.writeFileSync(opts.copyListTo, JSON.stringify(listData, null, 2) + "\n", "utf8");
      console.log(JSON.stringify({ copiedList: opts.copyListTo, count }));
    }

    const nextLock = buildAcquireLock(currentLock, {
      worker: opts.worker,
      runId: opts.runId,
      allowRepair: opts.repairSelf,
    });
    fs.writeFileSync(opts.lockPath, JSON.stringify(nextLock, null, 2) + "\n", "utf8");

    let headAfter = headBefore;
    if (!opts.noGit) {
      runGit(["add", "analysis/claims/_apply_lock.json"]);
      const staged = runGit(["diff", "--cached", "--name-only"]).split(/\r?\n/).filter(Boolean);
      if (staged.length !== 1 || staged[0] !== "analysis/claims/_apply_lock.json") {
        throw new Error(`Refusing commit: unexpected staged files: ${JSON.stringify(staged)}`);
      }
      runGit(["commit", "-m", `chore(lock): acquire _apply_lock for ${opts.runId}`]);
      runGit(["push", "origin", "main"]);
      headAfter = runGit(["rev-parse", "--short", "HEAD"]);
    }
    console.log(JSON.stringify({ action: "acquire", headBefore, headAfter, runId: opts.runId, lock: nextLock }, null, 2));
    return;
  }

  if (opts.action === "release") {
    const nextLock = buildReleaseLock(currentLock, {
      worker: opts.worker,
      runId: opts.runId,
    });
    fs.writeFileSync(opts.lockPath, JSON.stringify(nextLock, null, 2) + "\n", "utf8");

    let headAfter = headBefore;
    if (!opts.noGit) {
      runGit(["add", "analysis/claims/_apply_lock.json"]);
      const staged = runGit(["diff", "--cached", "--name-only"]).split(/\r?\n/).filter(Boolean);
      if (staged.length !== 1 || staged[0] !== "analysis/claims/_apply_lock.json") {
        throw new Error(`Refusing commit: unexpected staged files: ${JSON.stringify(staged)}`);
      }
      runGit(["commit", "-m", `chore(lock): release _apply_lock after ${nextLock.last_run_id}`]);
      runGit(["push", "origin", "main"]);
      headAfter = runGit(["rev-parse", "--short", "HEAD"]);
    }
    console.log(JSON.stringify({ action: "release", headBefore, headAfter, runId: nextLock.last_run_id, lock: nextLock }, null, 2));
    return;
  }

  throw new Error(`Unknown action: ${opts.action}`);
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    main();
  } catch (err) {
    console.error(`[manage-apply-lock] ERROR:`, err?.message || err);
    process.exit(1);
  }
}
