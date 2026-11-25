import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, runPrune, sha256File } from "./prune-sqlite-tidb-orphans.mjs";

function createFixtureDb(dbPath, { includeCraftRefOnOrphan = false } = {}) {
  const py = `
import sqlite3, sys
db_path = sys.argv[1]
inc_craft = sys.argv[2] == "1"
con = sqlite3.connect(db_path)
cur = con.cursor()
cur.executescript("""
CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  platform TEXT,
  title TEXT,
  source TEXT,
  source_label TEXT,
  added_date TEXT,
  analysis_observation_scope TEXT
);
CREATE VIRTUAL TABLE videos_fts USING fts5(video_id UNINDEXED, title);
CREATE TABLE scenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT,
  shot_index INTEGER,
  shot_title TEXT
);
CREATE VIRTUAL TABLE scenes_fts USING fts5(video_id UNINDEXED, shot_index UNINDEXED, shot_title);
CREATE TABLE craft_recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT,
  name TEXT
);
""")
# 2 videos present in TiDB
cur.execute("INSERT INTO videos VALUES ('keep1','youtube','Keep 1','s','l','2026-01-01',NULL)")
cur.execute("INSERT INTO videos VALUES ('keep2','vimeo','Keep 2','s','l','2026-01-02','metadata_only_unwatched')")
cur.execute("INSERT INTO videos_fts VALUES ('keep1','Keep 1')")
cur.execute("INSERT INTO videos_fts VALUES ('keep2','Keep 2')")
cur.execute("INSERT INTO scenes (video_id, shot_index, shot_title) VALUES ('keep1', 1, 's1')")
cur.execute("INSERT INTO scenes_fts VALUES ('keep1', 1, 's1')")
cur.execute("INSERT INTO craft_recipes (video_id, name) VALUES ('keep1', 'r1')")

# 2 orphan videos absent from TiDB
cur.execute("INSERT INTO videos VALUES ('orphan1','youtube','Orphan 1','s','l','2026-02-01',NULL)")
cur.execute("INSERT INTO videos VALUES ('orphan2','youtube','Orphan 2','s','l','2026-02-02','missing_video_unwatched')")
cur.execute("INSERT INTO videos_fts VALUES ('orphan1','Orphan 1')")
cur.execute("INSERT INTO videos_fts VALUES ('orphan2','Orphan 2')")
cur.execute("INSERT INTO scenes (video_id, shot_index, shot_title) VALUES ('orphan1', 1, 'os1')")
cur.execute("INSERT INTO scenes (video_id, shot_index, shot_title) VALUES ('orphan1', 2, 'os2')")
cur.execute("INSERT INTO scenes_fts VALUES ('orphan1', 1, 'os1')")
cur.execute("INSERT INTO scenes_fts VALUES ('orphan1', 2, 'os2')")
if inc_craft:
    cur.execute("INSERT INTO craft_recipes (video_id, name) VALUES ('orphan2', 'bad_ref')")
con.commit()
con.close()
`;
  const r = spawnSync("python", ["-c", py, dbPath, includeCraftRefOnOrphan ? "1" : "0"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
}

function queryCounts(dbPath) {
  const py = `
import json, sqlite3, sys
con = sqlite3.connect(sys.argv[1])
out = {}
for t in ['videos', 'videos_fts', 'scenes', 'scenes_fts', 'craft_recipes']:
    out[t] = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
out['video_ids'] = [r[0] for r in con.execute("SELECT id FROM videos ORDER BY id").fetchall()]
con.close()
print(json.dumps(out))
`;
  const r = spawnSync("python", ["-c", py, dbPath], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim());
}

test("dry-run reports exact orphans and scenes without modifying SQLite", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prune-dry-"));
  try {
    const dbPath = path.join(dir, "test.db");
    const idsPath = path.join(dir, "tidb_ids.json");
    createFixtureDb(dbPath, { includeCraftRefOnOrphan: false });
    fs.writeFileSync(idsPath, JSON.stringify(["keep1", "keep2"]), "utf8");
    const shaBefore = sha256File(dbPath);

    const { exitCode, report } = await runPrune(
      parseArgs(["node", "prune", "--dry-run", "--sqlite-path", dbPath, "--tidb-ids-file", idsPath])
    );
    assert.equal(exitCode, 0);
    assert.equal(report.mode, "dry_run");
    assert.equal(report.tidb_count, 2);
    assert.equal(report.sqlite_pre_count, 4);
    assert.equal(report.orphan_count, 2);
    assert.deepEqual(report.orphan_ids, ["orphan1", "orphan2"]);
    assert.equal(report.scenes_rows_to_delete, 2);
    assert.equal(report.craft_recipes_references_count, 0);
    assert.equal(report.safe_to_prune, true);
    assert.equal(sha256File(dbPath), shaBefore);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("hard-stops when craft_recipes references any orphan ID (both dry-run and apply)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prune-guard-"));
  try {
    const dbPath = path.join(dir, "test.db");
    const idsPath = path.join(dir, "tidb_ids.json");
    const bakPath = path.join(dir, "bak.db");
    createFixtureDb(dbPath, { includeCraftRefOnOrphan: true });
    fs.writeFileSync(idsPath, JSON.stringify(["keep1", "keep2"]), "utf8");
    const shaBefore = sha256File(dbPath);

    const dry = await runPrune(
      parseArgs(["node", "prune", "--dry-run", "--sqlite-path", dbPath, "--tidb-ids-file", idsPath])
    );
    assert.equal(dry.exitCode, 1);
    assert.equal(dry.report.safe_to_prune, false);
    assert.equal(dry.report.craft_recipes_references_count, 1);
    assert.equal(dry.report.aborted_reason, "craft_recipes_references_detected");

    const app = await runPrune(
      parseArgs([
        "node", "prune", "--apply",
        "--sqlite-path", dbPath,
        "--tidb-ids-file", idsPath,
        "--backup-path", bakPath,
      ])
    );
    assert.equal(app.exitCode, 1);
    assert.equal(app.report.safe_to_prune, false);
    assert.equal(sha256File(dbPath), shaBefore);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("apply takes backup, deletes orphans across videos/videos_fts/scenes/scenes_fts in one transaction, and matches TiDB count", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prune-apply-"));
  try {
    const dbPath = path.join(dir, "test.db");
    const idsPath = path.join(dir, "tidb_ids.json");
    const bakPath = path.join(dir, "backup", "pre.db");
    createFixtureDb(dbPath, { includeCraftRefOnOrphan: false });
    fs.writeFileSync(idsPath, JSON.stringify(["keep1", "keep2"]), "utf8");
    const shaBefore = sha256File(dbPath);

    const { exitCode, report } = await runPrune(
      parseArgs([
        "node", "prune", "--apply",
        "--sqlite-path", dbPath,
        "--tidb-ids-file", idsPath,
        "--backup-path", bakPath,
      ])
    );
    assert.equal(exitCode, 0);
    assert.equal(report.mode, "apply");
    assert.equal(fs.existsSync(bakPath), true);
    assert.equal(report.pre_prune_backup.sha256, shaBefore);
    assert.equal(report.apply.matches_tidb_count, true);
    assert.equal(report.apply.sqlite_post_count, 2);
    assert.equal(report.apply.remaining_orphan_count, 0);
    assert.equal(report.apply.craft_recipes_unchanged, true);
    assert.deepEqual(report.apply.deleted_rows, {
      videos_fts: 2,
      scenes_fts: 2,
      scenes: 2,
      videos: 2,
    });

    const after = queryCounts(dbPath);
    assert.deepEqual(after, {
      videos: 2,
      videos_fts: 2,
      scenes: 1,
      scenes_fts: 1,
      craft_recipes: 1,
      video_ids: ["keep1", "keep2"],
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
