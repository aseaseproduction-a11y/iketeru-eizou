import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

test("Phase 2 freeze SHA-256 manifest matches all 13 working-tree files and committed git blobs (LF-normalized)", () => {
  const manifestPath = path.join(REPO_ROOT, "analysis", "phase2_pre_freeze_sha256.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.files.length, 13, "Expected exactly 13 files in Phase 2 freeze SHA-256 list");

  for (const entry of manifest.files) {
    const abs = path.join(REPO_ROOT, entry.file);
    const diskBuf = fs.readFileSync(abs);
    assert.equal(diskBuf.includes(Buffer.from("\r\n")), false, `${entry.file} must use LF line endings on disk`);
    const diskSha = crypto.createHash("sha256").update(diskBuf).digest("hex");
    assert.equal(diskSha, entry.sha256, `Working-tree SHA-256 mismatch for ${entry.file}`);

    const blobBuf = execFileSync("git", ["-C", REPO_ROOT, "show", `HEAD:${entry.file}`], {
      maxBuffer: 20 * 1024 * 1024,
    });
    const blobSha = crypto.createHash("sha256").update(blobBuf).digest("hex");
    assert.equal(blobSha, entry.sha256, `Committed git blob SHA-256 mismatch for HEAD:${entry.file}`);
  }
});
