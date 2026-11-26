#!/usr/bin/env node
/**
 * Strictly ONE-WAY sync: Google Drive Recipe Store (IKETERU_RECIPE_STORE_DIR) -> Local SQLite craft_recipes & craft_recipes_fts.
 *
 * Guarantees:
 *  - READ-ONLY on IKETERU_RECIPE_STORE_DIR.
 *  - NEVER modifies SQLite `videos` or `scenes` tables (verified pre/post row counts).
 *  - Fail-closed: aborts with exit 1 BEFORE touching SQLite if any .gdoc/conflict copy, invalid JSON,
 *    video_id/folder mismatch, or Rule 2 unwatched video violation is detected.
 *  - On --apply: takes a verified local SQLite backup first, then rebuilds craft_recipes & craft_recipes_fts
 *    in a single SQLite transaction and checks PRAGMA integrity_check.
 *
 * Usage:
 *   node scripts/sync-craft-recipes-to-sqlite.mjs [--store-dir <dir>] [--sqlite-path <path>] [--dry-run | --apply] [--backup-dir <dir>]
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SQLITE_PATH = "E:\\iketeru-creative-studio\\data\\iketeru_knowledge.db";
const DEFAULT_STUDIO_ROOT = "E:\\iketeru-creative-studio";
const DEFAULT_BACKUP_ROOT = "E:\\iketeru_backups";

const PYTHON_REBUILD_SCRIPT = String.raw`
import hashlib, json, os, pathlib, re, sqlite3, sys, time

studio_root = pathlib.Path(sys.argv[1])
store_dir = pathlib.Path(sys.argv[2])
sqlite_path = pathlib.Path(sys.argv[3])
apply_mode = sys.argv[4] == "1"
backup_root = pathlib.Path(sys.argv[5])

sys.path.insert(0, str(studio_root))
from iketeru_studio.craft_recipes import (
    format_expressive_purpose_fts_text,
    has_valid_expressive_purpose,
    normalize_media_paths,
    to_studio_relative_path,
)
from iketeru_studio.indexer import rating_to_score

FORBIDDEN_EXTS = {".gdoc", ".gsheet", ".gslides", ".gdraw", ".gmap"}
CONFLICT_RE = re.compile(r"\s\(\d+\)(?:\.[^.]+)?$")

if not store_dir.exists():
    print(json.dumps({"ok": False, "error": f"Store directory does not exist: {store_dir}"}, ensure_ascii=False))
    sys.exit(1)

errors = []
forbidden = []
conflicts = []
recipes = []

for entry in sorted(store_dir.iterdir(), key=lambda p: p.name):
    if not entry.is_dir():
        ext = entry.suffix.lower()
        if ext in FORBIDDEN_EXTS:
            forbidden.append(entry.name)
        if CONFLICT_RE.search(entry.name):
            conflicts.append(entry.name)
        continue
    vid = entry.name
    for sub in entry.iterdir():
        if sub.is_file():
            if sub.suffix.lower() in FORBIDDEN_EXTS:
                forbidden.append(f"{vid}/{sub.name}")
            if CONFLICT_RE.search(sub.name):
                conflicts.append(f"{vid}/{sub.name}")
    rj = entry / "recipe.json"
    if not rj.exists():
        errors.append(f"{vid}: missing recipe.json")
        continue
    try:
        doc = json.loads(rj.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"{vid}: invalid JSON ({exc})")
        continue
    if str(doc.get("video_id") or "") != vid:
        errors.append(f"{vid}: video_id mismatch ({doc.get('video_id')!r} != {vid!r})")
        continue
    cuts = doc.get("cuts")
    if not isinstance(cuts, list) or len(cuts) == 0:
        errors.append(f"{vid}: empty cuts array")
        continue
    recipes.append((vid, doc))

if forbidden:
    errors.append(f"forbidden_gdoc_files ({len(forbidden)}): {forbidden[:5]}")
if conflicts:
    errors.append(f"conflict_copy_files ({len(conflicts)}): {conflicts[:5]}")

# Read current SQLite state (read-only first)
rcon = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
rcon.row_factory = sqlite3.Row
pre_videos_cnt = rcon.execute("SELECT COUNT(*) FROM videos").fetchone()[0]
pre_scenes_cnt = rcon.execute("SELECT COUNT(*) FROM scenes").fetchone()[0]
pre_craft_rows = rcon.execute("SELECT COUNT(*) FROM craft_recipes").fetchone()[0]
pre_craft_vids = {r[0] for r in rcon.execute("SELECT DISTINCT video_id FROM craft_recipes").fetchall()}
unwatched_ids = {r[0] for r in rcon.execute("SELECT id FROM videos WHERE analysis_observation_scope IS NOT NULL").fetchall()}

# Check Rule 2: no unwatched video allowed in store
for vid, _ in recipes:
    if vid in unwatched_ids:
        errors.append(f"{vid}: Rule 2 violation (analysis_observation_scope IS NOT NULL)")

# Compute exact content diff vs current SQLite
pre_sig = {}
for r in rcon.execute("SELECT video_id, cut_index, title, category, start_sec, end_sec, recipe_json FROM craft_recipes ORDER BY video_id, cut_index").fetchall():
    rj = json.loads(r["recipe_json"] or "{}")
    ep_sig = json.dumps(rj.get("expressive_purpose") or {}, ensure_ascii=False, sort_keys=True)
    pre_sig.setdefault(r["video_id"], []).append((r["cut_index"], r["title"], r["category"], round(float(r["start_sec"] or 0), 4), round(float(r["end_sec"] or 0), 4), ep_sig))
rcon.close()

if errors:
    print(json.dumps({"ok": False, "mode": "apply" if apply_mode else "dry_run", "errors": errors[:30], "error_count": len(errors)}, ensure_ascii=False, indent=2))
    sys.exit(1)

store_vids = {vid for vid, _ in recipes}
store_total_cuts = sum(len(doc["cuts"]) for _, doc in recipes)
v2_cuts_count = 0
v2_full_vids = 0
purpose_cuts_count = 0
purpose_full_vids = 0
changed_vids = []
for vid, doc in recipes:
    sig = []
    all_v2 = True
    all_purpose = True
    for idx, c in enumerate(doc["cuts"], start=1):
        cidx = int(c.get("cut_index") or idx)
        st_s = round(float(c.get("start_sec") or 0.0), 4)
        en_s = round(float(c.get("end_sec") or 0.0), 4)
        ep_sig = json.dumps(c.get("expressive_purpose") or {}, ensure_ascii=False, sort_keys=True)
        sig.append((cidx, str(c.get("title") or f"Cut #{cidx:02d}"), str(c.get("category") or ""), st_s, en_s, ep_sig))
        is_v2 = bool(c.get("frame_timeline") and c.get("effect_chain") and (c.get("primary_tool") or (c.get("tool_decision") or {}).get("primary_tool")))
        has_ep = has_valid_expressive_purpose(c)
        dur = en_s - st_s
        if is_v2:
            v2_cuts_count += 1
        if has_ep:
            purpose_cuts_count += 1
        else:
            all_purpose = False
        if not (is_v2 and dur <= 15.0):
            all_v2 = False
    if all_v2:
        v2_full_vids += 1
    if all_purpose:
        purpose_full_vids += 1
    if pre_sig.get(vid) != sig:
        changed_vids.append(vid)

report = {
    "ok": True,
    "mode": "apply" if apply_mode else "dry_run",
    "store_dir": str(store_dir),
    "sqlite_path": str(sqlite_path),
    "pre_sqlite": {
        "videos": pre_videos_cnt,
        "scenes": pre_scenes_cnt,
        "craft_recipes_rows": pre_craft_rows,
        "craft_recipes_vids": len(pre_craft_vids),
    },
    "store_summary": {
        "recipe_vids": len(store_vids),
        "recipe_cuts": store_total_cuts,
        "v2_cuts": v2_cuts_count,
        "v2_full_vids": v2_full_vids,
        "purpose_cuts": purpose_cuts_count,
        "purpose_full_vids": purpose_full_vids,
    },
    "diff": {
        "added_vids": sorted(store_vids - pre_craft_vids),
        "removed_vids": sorted(pre_craft_vids - store_vids),
        "changed_or_added_vids_count": len(changed_vids),
        "changed_or_added_vids_sample": changed_vids[:20],
    },
}

if not apply_mode:
    print(json.dumps(report, ensure_ascii=False, indent=2))
    sys.exit(0)

# Take verified backup before writing
stamp = time.strftime("%Y%m%d_%H%M%S")
bak_dir = backup_root / f"sqlite_pre_craft_sync_{stamp}"
bak_dir.mkdir(parents=True, exist_ok=True)
bak_path = bak_dir / sqlite_path.name
scon = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
dcon = sqlite3.connect(str(bak_path))
with dcon:
    scon.backup(dcon)
bak_ic = dcon.execute("PRAGMA integrity_check").fetchone()[0]
scon.close()
dcon.close()
if bak_ic != "ok":
    raise RuntimeError(f"Backup integrity_check failed: {bak_ic}")

h = hashlib.sha256()
with open(bak_path, "rb") as f:
    for chunk in iter(lambda: f.read(1048576), b""):
        h.update(chunk)
report["backup"] = {"path": str(bak_path), "bytes": bak_path.stat().st_size, "sha256": h.hexdigest(), "integrity_check": bak_ic}

# Rebuild craft_recipes & craft_recipes_fts in a single transaction (preserving exact JSON from store)
now_ts = int(time.time())
wcon = sqlite3.connect(str(sqlite_path))
try:
    wcon.execute("BEGIN IMMEDIATE")
    # Ensure craft_recipes_fts has purpose_text column (D-024)
    fts_cols = {r[1] for r in wcon.execute("PRAGMA table_info(craft_recipes_fts)").fetchall()}
    if "purpose_text" not in fts_cols:
        wcon.execute("DROP TABLE IF EXISTS craft_recipes_fts")
        wcon.execute(
            """
            CREATE VIRTUAL TABLE craft_recipes_fts USING fts5(
                video_id UNINDEXED,
                cut_index UNINDEXED,
                title,
                category,
                software_text,
                plugins_text,
                flow_text,
                purpose_text,
                tokenize="trigram"
            )
            """
        )
    wcon.execute("DELETE FROM craft_recipes")
    wcon.execute("DELETE FROM craft_recipes_fts")
    for vid, doc in recipes:
        tech_rating = str(doc.get("technique_rating") or "")
        tech_score = rating_to_score(tech_rating)
        for idx, raw_cut in enumerate(doc["cuts"], start=1):
            cut = dict(raw_cut)
            cut_idx = int(cut.get("cut_index") or idx)
            title = str(cut.get("title") or f"Cut #{cut_idx:02d}")
            category = str(cut.get("category") or "")
            st_mmss = str(cut.get("start_mmss") or "")
            en_mmss = str(cut.get("end_mmss") or "")
            st_sec = float(cut.get("start_sec") or 0.0)
            en_sec = float(cut.get("end_sec") or 0.0)
            sw = list(cut.get("software_stack") or [])
            plugins = list(cut.get("plugins_used") or [])
            palette = cut.get("color_palette_hex") or {}
            easing = cut.get("easing_and_timing") or {}
            media = normalize_media_paths(cut.get("media") or {}, resolve=False, studio_root=studio_root)
            cut["media"] = media
            keyframes = [
                to_studio_relative_path(p, studio_root=studio_root)
                for p in (media.get("start_png"), media.get("mid_png"), media.get("end_png"))
                if p
            ]
            flow_parts = []
            if isinstance(cut.get("recreation_flow"), list):
                flow_parts.extend(str(x) for x in cut["recreation_flow"])
            elif cut.get("recreation_flow"):
                flow_parts.append(str(cut["recreation_flow"]))
            for k in ("layer_stack", "anti_ai_slop_notes", "audio_sync_cues"):
                val = cut.get(k)
                if isinstance(val, list):
                    flow_parts.extend(str(x) for x in val)
                elif val:
                    flow_parts.append(str(val))
            tb = cut.get("transition_bridge") or {}
            if isinstance(tb, dict):
                flow_parts.extend(str(tb.get(k) or "") for k in ("entrance_vector", "exit_vector", "match_cue", "bridge_rule") if tb.get(k))
            alt_code = (cut.get("alternative_paths") or {}).get("experimental_code") or {}
            if isinstance(alt_code, dict):
                flow_parts.extend(str(x) for x in (alt_code.get("steps") or []))
            rec_code_names = [str(rc.get("tool")) for rc in (cut.get("recommended_code_tools") or []) if isinstance(rc, dict) and rc.get("tool")]
            sw_for_index = list(dict.fromkeys([*sw, *rec_code_names]))

            enriched = dict(cut)
            enriched["cut_index"] = cut_idx
            enriched["video_id"] = vid
            enriched["technique_rating"] = tech_rating

            wcon.execute(
                """
                INSERT INTO craft_recipes (
                    video_id, cut_index, title, category, start_mmss, end_mmss, start_sec, end_sec,
                    technique_rating, technique_score, software_json, plugins_json,
                    palette_json, easing_json, recipe_json, gif_path, strip_path, keyframes_json, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    vid, cut_idx, title, category, st_mmss, en_mmss, st_sec, en_sec,
                    tech_rating, tech_score,
                    json.dumps(sw, ensure_ascii=False),
                    json.dumps(plugins, ensure_ascii=False),
                    json.dumps(palette, ensure_ascii=False),
                    json.dumps(easing, ensure_ascii=False),
                    json.dumps(enriched, ensure_ascii=False),
                    str(media.get("gif_path") or ""),
                    str(media.get("strip_path") or ""),
                    json.dumps(keyframes, ensure_ascii=False),
                    now_ts,
                ),
            )
            wcon.execute(
                """
                INSERT INTO craft_recipes_fts (
                    video_id, cut_index, title, category, software_text, plugins_text, flow_text, purpose_text
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    vid, cut_idx, title, category,
                    " ".join(str(x) for x in sw_for_index),
                    " ".join(str(x) for x in plugins),
                    " ".join(flow_parts),
                    format_expressive_purpose_fts_text(enriched),
                ),
            )
    wcon.commit()
except Exception:
    wcon.rollback()
    raise
finally:
    post_videos_cnt = wcon.execute("SELECT COUNT(*) FROM videos").fetchone()[0]
    post_scenes_cnt = wcon.execute("SELECT COUNT(*) FROM scenes").fetchone()[0]
    post_craft_rows = wcon.execute("SELECT COUNT(*) FROM craft_recipes").fetchone()[0]
    post_craft_vids = wcon.execute("SELECT COUNT(DISTINCT video_id) FROM craft_recipes").fetchone()[0]
    post_fts_rows = wcon.execute("SELECT COUNT(*) FROM craft_recipes_fts").fetchone()[0]
    post_ic = wcon.execute("PRAGMA integrity_check").fetchone()[0]
    wcon.close()

report["post_sqlite"] = {
    "videos": post_videos_cnt,
    "scenes": post_scenes_cnt,
    "craft_recipes_rows": post_craft_rows,
    "craft_recipes_vids": post_craft_vids,
    "craft_recipes_fts_rows": post_fts_rows,
    "integrity_check": post_ic,
    "videos_and_scenes_unchanged": (post_videos_cnt == pre_videos_cnt and post_scenes_cnt == pre_scenes_cnt),
    "counts_match_store": (post_craft_rows == store_total_cuts and post_craft_vids == len(store_vids) and post_fts_rows == store_total_cuts),
}
print(json.dumps(report, ensure_ascii=False, indent=2))
if not (report["post_sqlite"]["integrity_check"] == "ok" and report["post_sqlite"]["videos_and_scenes_unchanged"] and report["post_sqlite"]["counts_match_store"]):
    sys.exit(1)
`;

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

export function runSyncCraftRecipesToSqlite({
  studioRoot = DEFAULT_STUDIO_ROOT,
  storeDir,
  sqlitePath = DEFAULT_SQLITE_PATH,
  apply = false,
  backupDir = DEFAULT_BACKUP_ROOT,
}) {
  const res = spawnSync(
    "python",
    ["-c", PYTHON_REBUILD_SCRIPT, studioRoot, storeDir, sqlitePath, apply ? "1" : "0", backupDir],
    { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }
  );
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function main() {
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
  const args = parseArgs(process.argv);
  const storeDir = path.resolve(args["store-dir"] || process.env.IKETERU_RECIPE_STORE_DIR || "D:\\マイドライブ\\iketeru_craft_recipes");
  const sqlitePath = path.resolve(args["sqlite-path"] || process.env.IKETERU_SQLITE_PATH || DEFAULT_SQLITE_PATH);
  const studioRoot = path.resolve(args["studio-root"] || DEFAULT_STUDIO_ROOT);
  const backupDir = path.resolve(args["backup-dir"] || process.env.IKETERU_BACKUP_ROOT || DEFAULT_BACKUP_ROOT);
  const apply = Boolean(args.apply) && !Boolean(args["dry-run"]);

  const res = runSyncCraftRecipesToSqlite({ studioRoot, storeDir, sqlitePath, apply, backupDir });
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  process.exit(res.status ?? 1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
