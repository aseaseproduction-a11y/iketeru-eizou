#!/usr/bin/env node
/**
 * Migrate craft_recipes folder from local studio directory to Google Drive store (IKETERU_RECIPE_STORE_DIR)
 * using local filesystem copy (robocopy on Windows; NEVER browser upload) with exhaustive pre/post SHA-256,
 * .gdoc / conflict-copy = 0 checks, and recipe.json UTF-8 parse validation.
 *
 * Usage:
 *   node scripts/migrate-craft-recipes-to-drive.mjs --src <dir> --dst <dir> [--copy] [--verify-only] [--manifest-out <path>]
 */

import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SRC = "E:\\iketeru-creative-studio\\data\\craft_recipes";
const FORBIDDEN_EXTENSIONS = new Set([".gdoc", ".gsheet", ".gslides", ".gdraw", ".gmap"]);
const CONFLICT_COPY_RE = /\s\(\d+\)(?:\.[^.]+)?$/;

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

export function scanRecipeStore(rootDir) {
  if (!fs.existsSync(rootDir)) {
    throw new Error(`Directory not found: ${rootDir}`);
  }
  const files = {};
  const videoDirs = [];
  const forbiddenFiles = [];
  const conflictCopies = [];
  const invalidJsonFiles = [];
  let totalFiles = 0;
  let totalBytes = 0;

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullTop = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      videoDirs.push(entry.name);
      const stack = [fullTop];
      while (stack.length > 0) {
        const cur = stack.pop();
        for (const sub of fs.readdirSync(cur, { withFileTypes: true })) {
          const full = path.join(cur, sub.name);
          if (sub.isDirectory()) {
            stack.push(full);
            continue;
          }
          const rel = path.relative(rootDir, full).replace(/\\/g, "/");
          const ext = path.extname(sub.name).toLowerCase();
          if (FORBIDDEN_EXTENSIONS.has(ext)) forbiddenFiles.push(rel);
          if (CONFLICT_COPY_RE.test(sub.name)) conflictCopies.push(rel);
          const stat = fs.statSync(full);
          const sha = sha256File(full);
          files[rel] = { bytes: stat.size, sha256: sha };
          totalFiles++;
          totalBytes += stat.size;
          if (sub.name === "recipe.json") {
            try {
              const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
              if (String(parsed.video_id || "") !== entry.name) {
                invalidJsonFiles.push(`${rel}: video_id mismatch (${parsed.video_id} != ${entry.name})`);
              }
            } catch (err) {
              invalidJsonFiles.push(`${rel}: ${err.message}`);
            }
          }
        }
      }
    } else {
      const rel = entry.name;
      const ext = path.extname(entry.name).toLowerCase();
      if (FORBIDDEN_EXTENSIONS.has(ext)) forbiddenFiles.push(rel);
      if (CONFLICT_COPY_RE.test(entry.name)) conflictCopies.push(rel);
      const stat = fs.statSync(fullTop);
      files[rel] = { bytes: stat.size, sha256: sha256File(fullTop) };
      totalFiles++;
      totalBytes += stat.size;
    }
  }

  return {
    root_dir: rootDir,
    scanned_at: new Date().toISOString(),
    video_dirs_count: videoDirs.length,
    total_files: totalFiles,
    total_bytes: totalBytes,
    forbidden_gdoc_files: forbiddenFiles,
    conflict_copy_files: conflictCopies,
    invalid_recipe_json_files: invalidJsonFiles,
    files,
  };
}

export function diffManifests(srcManifest, dstManifest) {
  const missingInDst = [];
  const extraInDst = [];
  const shaMismatches = [];

  for (const [rel, meta] of Object.entries(srcManifest.files)) {
    const d = dstManifest.files[rel];
    if (!d) {
      missingInDst.push(rel);
    } else if (d.sha256 !== meta.sha256 || d.bytes !== meta.bytes) {
      shaMismatches.push({ rel, src: meta, dst: d });
    }
  }
  for (const rel of Object.keys(dstManifest.files)) {
    if (!srcManifest.files[rel]) extraInDst.push(rel);
  }

  const allPassed =
    missingInDst.length === 0 &&
    extraInDst.length === 0 &&
    shaMismatches.length === 0 &&
    dstManifest.forbidden_gdoc_files.length === 0 &&
    dstManifest.conflict_copy_files.length === 0 &&
    dstManifest.invalid_recipe_json_files.length === 0 &&
    srcManifest.total_files === dstManifest.total_files &&
    srcManifest.total_bytes === dstManifest.total_bytes;

  return {
    all_passed: allPassed,
    src_video_dirs: srcManifest.video_dirs_count,
    dst_video_dirs: dstManifest.video_dirs_count,
    src_total_files: srcManifest.total_files,
    dst_total_files: dstManifest.total_files,
    src_total_bytes: srcManifest.total_bytes,
    dst_total_bytes: dstManifest.total_bytes,
    missing_in_dst_count: missingInDst.length,
    extra_in_dst_count: extraInDst.length,
    sha_mismatch_count: shaMismatches.length,
    forbidden_gdoc_count: dstManifest.forbidden_gdoc_files.length,
    conflict_copy_count: dstManifest.conflict_copy_files.length,
    invalid_recipe_json_count: dstManifest.invalid_recipe_json_files.length,
    samples: {
      missing_in_dst: missingInDst.slice(0, 10),
      extra_in_dst: extraInDst.slice(0, 10),
      sha_mismatches: shaMismatches.slice(0, 10),
      forbidden_gdoc: dstManifest.forbidden_gdoc_files.slice(0, 10),
      conflict_copies: dstManifest.conflict_copy_files.slice(0, 10),
      invalid_json: dstManifest.invalid_recipe_json_files.slice(0, 10),
    },
  };
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

function main() {
  const args = parseArgs(process.argv);
  const srcDir = path.resolve(args.src || DEFAULT_SRC);
  const dstDir = path.resolve(args.dst || process.env.IKETERU_RECIPE_STORE_DIR || "D:\\マイドライブ\\iketeru_craft_recipes");
  const doCopy = Boolean(args.copy);
  const verifyOnly = Boolean(args["verify-only"]);
  const manifestOut = args["manifest-out"] ? path.resolve(args["manifest-out"]) : null;

  const preManifest = scanRecipeStore(srcDir);
  if (manifestOut) {
    fs.mkdirSync(path.dirname(manifestOut), { recursive: true });
    fs.writeFileSync(manifestOut, JSON.stringify(preManifest, null, 2) + "\n", "utf8");
  }

  let robocopyExit = null;
  if (doCopy && !verifyOnly) {
    fs.mkdirSync(dstDir, { recursive: true });
    const res = spawnSync("robocopy", [srcDir, dstDir, "/E", "/COPY:DAT", "/R:2", "/W:3", "/MT:4", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"], {
      encoding: "utf8",
      shell: false,
    });
    robocopyExit = res.status;
    if (robocopyExit === null || robocopyExit >= 8) {
      throw new Error(`robocopy failed with exit code ${robocopyExit}: ${res.stderr || res.stdout}`);
    }
  }

  const dstManifest = scanRecipeStore(dstDir);
  const diff = diffManifests(preManifest, dstManifest);
  console.log(JSON.stringify({ srcDir, dstDir, doCopy, robocopyExit, manifestOut, verification: diff }, null, 2));
  if (!diff.all_passed) process.exit(1);
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
