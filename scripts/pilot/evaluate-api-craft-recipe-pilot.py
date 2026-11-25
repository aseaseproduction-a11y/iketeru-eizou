#!/usr/bin/env python3
"""Isolated evaluator for Gemini API Craft Recipe v2 pilot (M1..M7).

Strict guarantees:
  - NEVER writes to production SQLite (E:/iketeru-creative-studio/data/iketeru_knowledge.db)
    or TiDB. Copies SQLite into a temporary directory for M6 verification and asserts
    pre/post SHA-256 identity of the production SQLite file.
  - Uses existing SQLite `scenes`, `videos.ai_analysis`, and `craft_recipes` purely as
    read-only ground truth for M3 (recall), M4 (hallucination check), and M5 (timing accuracy).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import sqlite3
import statistics
import sys
import tempfile
from pathlib import Path
from typing import Any

STUDIO_ROOT = Path(r"E:\iketeru-creative-studio")
PROD_SQLITE_PATH = STUDIO_ROOT / "data" / "iketeru_knowledge.db"
REPO_ROOT = Path(__file__).resolve().parents[2]
PREREG_PATH = REPO_ROOT / "analysis" / "pilot_api_craft_recipe" / "preregistration.json"

if str(STUDIO_ROOT) not in sys.path:
    sys.path.insert(0, str(STUDIO_ROOT))

from iketeru_studio.craft_recipes import (
    CANONICAL_CATEGORIES,
    extract_style_profile,
    normalize_cut_dict,
    score_recipe_credibility,
)
from iketeru_studio.indexer import KnowledgeIndex
from iketeru_studio.macro_planner import build_macro_sequence_plan
from iketeru_studio.project_scaffold import validate_production_compliance


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def parse_timestamp_sec(ts: Any) -> float | None:
    if ts is None:
        return None
    s = str(ts).strip()
    if not s:
        return None
    m = re.match(r"^(\d{1,2}):(\d{2}(?:\.\d+)?)$", s)
    if m:
        return int(m.group(1)) * 60.0 + float(m.group(2))
    m3 = re.match(r"^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$", s)
    if m3:
        return int(m3.group(1)) * 3600.0 + int(m3.group(2)) * 60.0 + float(m3.group(3))
    try:
        return float(s)
    except ValueError:
        return None


def interval_iou(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    inter = max(0.0, min(a_end, b_end) - max(a_start, b_start))
    union = max(a_end, b_end) - min(a_start, b_start)
    if union <= 0:
        return 0.0
    return inter / union


def check_audio_separation_in_layer_stack(layer_stack: Any) -> bool:
    if not isinstance(layer_stack, list):
        return False
    has_bgm = False
    has_se = False
    for item in layer_stack:
        s = str(item).lower()
        item_has_bgm = any(k in s for k in ("bgm", "music", "音楽"))
        item_has_se = any(k in s for k in ("se", "sfx", "効果音", "foley"))
        if item_has_bgm and item_has_se:
            # Combined on same line -> violation
            return False
        if item_has_bgm:
            has_bgm = True
        if item_has_se:
            has_se = True
    return has_bgm and has_se


def evaluate_m1_call(draft: dict[str, Any]) -> dict[str, Any]:
    cuts = draft.get("cuts")
    if not isinstance(cuts, list) or not cuts:
        return {"pass": False, "reasons": ["missing_or_empty_cuts"], "cut_reports": []}

    reasons: list[str] = []
    cut_reports: list[dict[str, Any]] = []
    for idx, raw_cut in enumerate(cuts, start=1):
        c_reasons: list[str] = []
        if not isinstance(raw_cut, dict):
            c_reasons.append("cut_not_object")
            cut_reports.append({"cut_index": idx, "pass": False, "reasons": c_reasons})
            continue

        # Required v2 fields check
        for field in ("title", "category", "primary_tool", "software_stack", "recreation_flow"):
            if not raw_cut.get(field):
                c_reasons.append(f"missing_{field}")
        if raw_cut.get("start_sec") is None or raw_cut.get("end_sec") is None:
            c_reasons.append("missing_start_or_end_sec")
        if not isinstance(raw_cut.get("frame_timeline"), list) or len(raw_cut["frame_timeline"]) < 2:
            c_reasons.append("missing_frame_timeline_ge_2")
        if not isinstance(raw_cut.get("effect_chain"), list) or len(raw_cut["effect_chain"]) < 1:
            c_reasons.append("missing_effect_chain_ge_1")
        bp = raw_cut.get("ae_blueprint") if isinstance(raw_cut.get("ae_blueprint"), dict) else {}
        if not isinstance(bp.get("layers"), list) or len(bp["layers"]) < 1:
            c_reasons.append("missing_ae_blueprint_layers")
        obs = raw_cut.get("observed_timestamps")
        if not isinstance(obs, list) or len(obs) < 1:
            c_reasons.append("missing_observed_timestamps")
        if not check_audio_separation_in_layer_stack(raw_cut.get("layer_stack")):
            c_reasons.append("missing_separated_bgm_se_in_layer_stack")

        norm_cut = None
        cred = None
        try:
            norm_cut = normalize_cut_dict(raw_cut)
            cred = score_recipe_credibility(norm_cut)
        except Exception as exc:
            c_reasons.append(f"normalize_or_credibility_error: {exc}")

        if norm_cut and cred:
            dur = float(norm_cut.get("frame_timing", {}).get("duration_sec", 999.0))
            if dur > 15.0 or cred.get("needs_recut"):
                c_reasons.append(f"duration_gt_15s ({dur}s)")
            if int(cred.get("credibility_score", 0)) < 90:
                c_reasons.append(
                    f"credibility_lt_90 ({cred.get('credibility_score')}, flags={cred.get('flags')})"
                )
            # Validate production compliance on ae_blueprint layers + synthetic audio tracks from layer_stack
            try:
                validate_production_compliance(
                    {
                        "layers": (norm_cut.get("ae_blueprint") or {}).get("layers") or [],
                        "tracks": [
                            {"kind": "audio", "name": "BGM_Track", "audio_role": "bgm", "clips": [{"name": "bgm"}]},
                            {"kind": "audio", "name": "SE_Track", "audio_role": "se", "clips": [{"name": "se"}]},
                        ],
                    }
                )
            except Exception as exc:
                c_reasons.append(f"validate_production_compliance_failed: {exc}")

        cut_pass = len(c_reasons) == 0
        if not cut_pass:
            reasons.extend([f"cut#{idx}:{r}" for r in c_reasons])
        cut_reports.append(
            {
                "cut_index": raw_cut.get("cut_index", idx),
                "title": raw_cut.get("title"),
                "category": raw_cut.get("category"),
                "duration_sec": norm_cut.get("frame_timing", {}).get("duration_sec") if norm_cut else None,
                "credibility_score": cred.get("credibility_score") if cred else None,
                "credibility_flags": cred.get("flags") if cred else [],
                "pass": cut_pass,
                "reasons": c_reasons,
            }
        )

    return {"pass": len(reasons) == 0, "reasons": reasons, "cut_reports": cut_reports}


def evaluate_m2_call(call_summary: dict[str, Any], draft: dict[str, Any], ref_dur: float) -> dict[str, Any]:
    min_req = max(1000, int(math.floor(ref_dur * 90.0)))
    vid_tok = int(call_summary.get("input_video_tokens") or 0)
    tok_ok = vid_tok >= min_req
    ts_issues: list[str] = []
    ts_count = 0
    for c_idx, cut in enumerate(draft.get("cuts") or [], start=1):
        obs = cut.get("observed_timestamps") or []
        for o_idx, entry in enumerate(obs, start=1):
            ts_raw = entry.get("timestamp") if isinstance(entry, dict) else entry
            sec = parse_timestamp_sec(ts_raw)
            ts_count += 1
            if sec is None:
                ts_issues.append(f"cut#{c_idx}.obs#{o_idx}:unparseable({ts_raw})")
            elif sec < 0 or sec > ref_dur + 5.0:
                ts_issues.append(f"cut#{c_idx}.obs#{o_idx}:out_of_range({sec}s > {ref_dur + 5.0}s)")
    return {
        "pass": tok_ok and len(ts_issues) == 0 and ts_count > 0,
        "input_video_tokens": vid_tok,
        "min_required_video_tokens": min_req,
        "tokens_per_sec": round(vid_tok / ref_dur, 2) if ref_dur > 0 else None,
        "tokens_ok": tok_ok,
        "observed_timestamps_count": ts_count,
        "timestamp_issues": ts_issues,
    }


def load_ground_truth(sqlite_path: Path, video_ids: list[str]) -> dict[str, Any]:
    conn = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    gt: dict[str, Any] = {}
    for vid in video_ids:
        cur.execute("SELECT id, title, technique_rating, ai_analysis FROM videos WHERE id = ?", (vid,))
        vrow = cur.fetchone()
        cur.execute(
            "SELECT shot_index, start_mmss, end_mmss, start_sec, end_sec, shot_title, description "
            "FROM scenes WHERE video_id = ? ORDER BY shot_index",
            (vid,),
        )
        scenes = [dict(r) for r in cur.fetchall()]
        cur.execute(
            "SELECT cut_index, title, category, start_mmss, end_mmss, start_sec, end_sec, recipe_json "
            "FROM craft_recipes WHERE video_id = ? ORDER BY cut_index",
            (vid,),
        )
        existing_cuts = []
        for r in cur.fetchall():
            rj = json.loads(r["recipe_json"] or "{}")
            ft = rj.get("frame_timing") or {}
            dur = float(ft.get("duration_sec") or max(0.0, float(r["end_sec"]) - float(r["start_sec"])))
            gran = ft.get("granularity") or ("micro_transition" if dur <= 0.85 else ("technique_unit" if dur <= 8.0 else "complex_composite"))
            cred = rj.get("credibility") or {}
            is_v2 = bool(rj.get("frame_timeline") and rj.get("effect_chain") and (rj.get("primary_tool") or (rj.get("tool_decision") or {}).get("primary_tool")))
            existing_cuts.append(
                {
                    "cut_index": r["cut_index"],
                    "title": r["title"],
                    "category": r["category"],
                    "start_sec": float(r["start_sec"]),
                    "end_sec": float(r["end_sec"]),
                    "duration_sec": dur,
                    "granularity": gran,
                    "primary_tool": rj.get("primary_tool") or (rj.get("tool_decision") or {}).get("primary_tool"),
                    "plugins_used": rj.get("plugins_used") or [],
                    "is_v2": is_v2,
                    "credibility_score": cred.get("credibility_score"),
                }
            )
        gt[vid] = {
            "title": vrow["title"] if vrow else "",
            "technique_rating": vrow["technique_rating"] if vrow else "",
            "ai_analysis": vrow["ai_analysis"] if vrow else "",
            "scenes": scenes,
            "existing_cuts": existing_cuts,
            "existing_v2_major": [c for c in existing_cuts if c["is_v2"] and c["granularity"] != "micro_transition"],
            "existing_v2_micro": [c for c in existing_cuts if c["is_v2"] and c["granularity"] == "micro_transition"],
        }
    conn.close()
    return gt


def match_api_cuts_to_ref(api_cuts: list[dict[str, Any]], ref_cuts: list[dict[str, Any]], tolerance_sec: float = 4.0) -> list[dict[str, Any]]:
    matches = []
    for ref in ref_cuts:
        best = None
        best_score = -1.0
        ref_mid = 0.5 * (ref["start_sec"] + ref["end_sec"])
        for ac in api_cuts:
            a_st = float(ac.get("start_sec") or 0.0)
            a_en = float(ac.get("end_sec") or a_st)
            a_mid = 0.5 * (a_st + a_en)
            iou = interval_iou(ref["start_sec"], ref["end_sec"], a_st, a_en)
            mid_err = abs(a_mid - ref_mid)
            start_err = abs(a_st - ref["start_sec"])
            end_err = abs(a_en - ref["end_sec"])
            boundary_mean_err = 0.5 * (start_err + end_err)
            cat_match = str(ac.get("category") or "") == str(ref.get("category") or "")
            # Composite proximity score for picking best candidate match
            prox = iou * 10.0 + (1.0 if mid_err <= tolerance_sec else 0.0) - 0.1 * mid_err + (0.5 if cat_match else 0.0)
            if prox > best_score:
                best_score = prox
                best = {
                    "ref_cut_index": ref["cut_index"],
                    "ref_title": ref["title"],
                    "ref_granularity": ref["granularity"],
                    "ref_category": ref["category"],
                    "ref_primary_tool": ref["primary_tool"],
                    "ref_start_sec": ref["start_sec"],
                    "ref_end_sec": ref["end_sec"],
                    "api_cut_index": ac.get("cut_index"),
                    "api_title": ac.get("title"),
                    "api_category": ac.get("category"),
                    "api_primary_tool": ac.get("primary_tool"),
                    "api_start_sec": a_st,
                    "api_end_sec": a_en,
                    "iou": round(iou, 4),
                    "start_err_sec": round(start_err, 3),
                    "end_err_sec": round(end_err, 3),
                    "boundary_mean_err_sec": round(boundary_mean_err, 3),
                    "midpoint_err_sec": round(mid_err, 3),
                    "time_matched": iou > 0.0 or mid_err <= tolerance_sec,
                    "category_match": cat_match,
                }
        matches.append(best)
    return matches


def evaluate_m6_isolated_sqlite(
    prod_sqlite: Path,
    video_ids: list[str],
    drafts_by_vid: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    pre_sha = sha256_file(prod_sqlite)
    per_video: dict[str, Any] = {}
    all_pass = True

    with tempfile.TemporaryDirectory(prefix="iketeru_pilot_m6_") as tmpdir:
        tmp_db = Path(tmpdir) / "iketeru_knowledge_copy.db"
        shutil.copy2(prod_sqlite, tmp_db)

        # Remove pre-existing craft_recipes for the 5 pilot videos on the TEMP copy ONLY
        conn = sqlite3.connect(str(tmp_db))
        for vid in video_ids:
            conn.execute("DELETE FROM craft_recipes WHERE video_id = ?", (vid,))
            conn.execute("DELETE FROM craft_recipes_fts WHERE video_id = ?", (vid,))
        conn.commit()
        conn.close()

        idx = KnowledgeIndex(tmp_db)
        for vid in video_ids:
            draft = drafts_by_vid.get(vid)
            if not draft:
                per_video[vid] = {"pass": False, "error": "missing_draft"}
                all_pass = False
                continue
            try:
                upserted_n = idx.upsert_craft_recipe(draft)
                got = idx.get_craft_recipe(vid)
                got_cuts = (got or {}).get("cuts") or []
                search_res = idx.search_craft_recipes(
                    query=got_cuts[0]["title"][:12] if got_cuts else "",
                    v2_only=True,
                    limit=50,
                )
                found_in_v2_search = any(r.get("video_id") == vid for r in search_res)

                # Test plan_craft_sequence (build_macro_sequence_plan) specifically pulling from the upserted draft
                first_cut = got_cuts[0] if got_cuts else {}
                brief = f"{first_cut.get('title', '')} {first_cut.get('category', '')} {draft.get('title', '')}"
                plan = build_macro_sequence_plan(
                    idx,
                    brief=brief,
                    duration_sec=15.0,
                )
                style_prof = extract_style_profile(got_cuts)
                locked_pal = plan.get("locked_palette_hex") or {}
                has_palette = bool(
                    locked_pal.get("base") and locked_pal.get("primary") and locked_pal.get("accent")
                )
                plan_cuts = plan.get("sequence_cuts") or []
                ref_cands = plan.get("reference_candidates") or []
                has_cuts_in_plan = len(plan_cuts) > 0
                in_ref_cands = any(r.get("video_id") == vid for r in ref_cands)
                in_seq_cuts = any(
                    ((c.get("reference_recipe") or {}).get("video_id") == vid) for c in plan_cuts
                )
                has_bp = all(bool((c.get("ae_blueprint") or {}).get("layers")) for c in got_cuts)
                has_tb = all(bool(c.get("transition_bridge")) for c in got_cuts)
                v_pass = (
                    upserted_n >= 1
                    and len(got_cuts) == upserted_n
                    and found_in_v2_search
                    and has_palette
                    and has_cuts_in_plan
                    and has_bp
                    and has_tb
                    and bool(style_prof)
                )
                if not v_pass:
                    all_pass = False
                per_video[vid] = {
                    "pass": v_pass,
                    "upserted_cuts": upserted_n,
                    "retrieved_cuts": len(got_cuts),
                    "found_in_v2_search": found_in_v2_search,
                    "targeted_search_hits": len(search_res),
                    "reference_candidates_count": len(ref_cands),
                    "in_reference_candidates": in_ref_cands,
                    "plan_cuts_count": len(plan_cuts),
                    "plan_includes_this_video": in_seq_cuts,
                    "locked_palette_hex": locked_pal,
                    "has_palette": has_palette,
                    "has_ae_blueprint_layers": has_bp,
                    "has_transition_bridge": has_tb,
                    "style_profile_ok": bool(style_prof),
                }
            except Exception as exc:
                all_pass = False
                per_video[vid] = {"pass": False, "error": f"{type(exc).__name__}: {exc}"}

    post_sha = sha256_file(prod_sqlite)
    sqlite_untouched = pre_sha == post_sha
    return {
        "pass": all_pass and sqlite_untouched,
        "prod_sqlite_untouched": sqlite_untouched,
        "prod_sqlite_sha256": pre_sha,
        "per_video": per_video,
    }


def evaluate_m7_r1_r2(r1_draft: dict[str, Any], r2_draft: dict[str, Any]) -> dict[str, Any]:
    c1 = r1_draft.get("cuts") or []
    c2 = r2_draft.get("cuts") or []
    if not c1 or not c2:
        return {"tool_agreement": 0.0, "category_agreement": 0.0, "mean_best_iou": 0.0}
    tool_matches = 0
    cat_matches = 0
    ious = []
    for a in c1:
        a_st, a_en = float(a.get("start_sec") or 0), float(a.get("end_sec") or 0)
        best_b = max(
            c2,
            key=lambda b: interval_iou(a_st, a_en, float(b.get("start_sec") or 0), float(b.get("end_sec") or 0)),
        )
        iou = interval_iou(a_st, a_en, float(best_b.get("start_sec") or 0), float(best_b.get("end_sec") or 0))
        ious.append(iou)
        if str(a.get("primary_tool") or "") == str(best_b.get("primary_tool") or ""):
            tool_matches += 1
        if str(a.get("category") or "") == str(best_b.get("category") or ""):
            cat_matches += 1
    return {
        "r1_cuts": len(c1),
        "r2_cuts": len(c2),
        "tool_agreement": round(tool_matches / len(c1), 4),
        "category_agreement": round(cat_matches / len(c1), 4),
        "mean_best_iou": round(sum(ious) / len(ious), 4),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-dir", required=True, help="Path to pilot run directory (analysis/pilot_api_craft_recipe/<run_id>)")
    ap.add_argument("--pass2-dir", default=None, help="Optional Pass 2 run directory to compare timing improvement")
    ap.add_argument("--out", default=None, help="Optional output JSON report path")
    args = ap.parse_args()

    run_dir = Path(args.run_dir).resolve()
    prereg = json.loads(PREREG_PATH.read_text(encoding="utf-8"))
    videos = prereg["selected_videos"]
    video_ids = [v["video_id"] for v in videos]
    dur_by_vid = {v["video_id"]: float(v["ref_duration_sec"]) for v in videos}

    calls_log = []
    log_file = run_dir / "calls_log.jsonl"
    for line in log_file.read_text(encoding="utf-8").splitlines():
        if line.strip():
            calls_log.append(json.loads(line))

    # Index latest succeeded summary per (video_id, attempt)
    latest_call: dict[tuple[str, int], dict[str, Any]] = {}
    for rec in calls_log:
        if rec.get("parse_ok") and rec.get("exit_code") == 0:
            latest_call[(rec["video_id"], int(rec["attempt"]))] = rec

    gt = load_ground_truth(PROD_SQLITE_PATH, video_ids)

    m1_calls = {}
    m2_calls = {}
    drafts_r1: dict[str, dict[str, Any]] = {}
    drafts_r2: dict[str, dict[str, Any]] = {}
    all_drafts: dict[tuple[str, int], dict[str, Any]] = {}

    for vid in video_ids:
        for att in (1, 2):
            draft_path = run_dir / "drafts" / f"{vid}_r{att}.json"
            key = f"{vid}_r{att}"
            if not draft_path.exists():
                m1_calls[key] = {"pass": False, "reasons": ["missing_draft_file"]}
                m2_calls[key] = {"pass": False, "reasons": ["missing_draft_file"]}
                continue
            draft = json.loads(draft_path.read_text(encoding="utf-8"))
            all_drafts[(vid, att)] = draft
            if att == 1:
                drafts_r1[vid] = draft
            else:
                drafts_r2[vid] = draft
            m1_calls[key] = evaluate_m1_call(draft)
            m2_calls[key] = evaluate_m2_call(latest_call.get((vid, att), {}), draft, dur_by_vid[vid])

    # M3 & M5: Match against existing v2 major cuts & micro_transitions separately
    m3_m5_by_vid = {}
    all_major_boundary_errs = []
    all_major_mid_errs = []
    fast_cut_major_boundary_errs = {"jsEVOjI690Y": [], "Xr032EhUDPw": []}
    all_micro_mid_errs = []
    m4_api_only_audit = {}

    for vid in video_ids:
        r1_cuts = (drafts_r1.get(vid) or {}).get("cuts") or []
        r2_cuts = (drafts_r2.get(vid) or {}).get("cuts") or []
        union_cuts = [dict(c, _attempt=1) for c in r1_cuts] + [dict(c, _attempt=2) for c in r2_cuts]

        major_refs = gt[vid]["existing_v2_major"]
        micro_refs = gt[vid]["existing_v2_micro"]

        major_matches_r1 = match_api_cuts_to_ref(r1_cuts, major_refs)
        major_matches_r2 = match_api_cuts_to_ref(r2_cuts, major_refs)
        major_matches_union = match_api_cuts_to_ref(union_cuts, major_refs)
        micro_matches_union = match_api_cuts_to_ref(union_cuts, micro_refs, tolerance_sec=2.0)

        for m in major_matches_union:
            if m and m["time_matched"]:
                all_major_boundary_errs.extend([m["start_err_sec"], m["end_err_sec"]])
                all_major_mid_errs.append(m["midpoint_err_sec"])
                if vid in fast_cut_major_boundary_errs:
                    fast_cut_major_boundary_errs[vid].extend([m["start_err_sec"], m["end_err_sec"]])
        for m in micro_matches_union:
            if m and m["time_matched"]:
                all_micro_mid_errs.append(m["midpoint_err_sec"])

        # M4: Collect API cuts (r1 & r2) and align each with overlapping SQLite scenes
        scenes = gt[vid]["scenes"]
        api_cuts_with_scenes = []
        for att, clist in ((1, r1_cuts), (2, r2_cuts)):
            for c in clist:
                st, en = float(c.get("start_sec") or 0), float(c.get("end_sec") or 0)
                matches_existing_v2 = any(
                    interval_iou(st, en, ref["start_sec"], ref["end_sec"]) > 0.0
                    or abs(0.5 * (st + en) - 0.5 * (ref["start_sec"] + ref["end_sec"])) <= 4.0
                    for ref in gt[vid]["existing_cuts"]
                )
                overlapping_scenes = [
                    {
                        "shot_index": sc["shot_index"],
                        "range": f"{sc['start_mmss']}-{sc['end_mmss']}",
                        "shot_title": sc["shot_title"],
                        "description": sc["description"][:220],
                    }
                    for sc in scenes
                    if not (sc["end_sec"] < st - 2.0 or sc["start_sec"] > en + 2.0)
                ]
                api_cuts_with_scenes.append(
                    {
                        "attempt": att,
                        "cut_index": c.get("cut_index"),
                        "range": f"{c.get('start_mmss')}-{c.get('end_mmss')} ({st}-{en}s)",
                        "title": c.get("title"),
                        "category": c.get("category"),
                        "primary_tool": c.get("primary_tool"),
                        "matches_existing_v2": matches_existing_v2,
                        "observed_timestamps": c.get("observed_timestamps") or [],
                        "overlapping_sqlite_scenes": overlapping_scenes,
                    }
                )
        m4_api_only_audit[vid] = api_cuts_with_scenes

        m3_m5_by_vid[vid] = {
            "existing_v2_major_count": len(major_refs),
            "existing_v2_micro_count": len(micro_refs),
            "major_matches_r1": major_matches_r1,
            "major_matches_r2": major_matches_r2,
            "major_matches_union": major_matches_union,
            "micro_matches_union": micro_matches_union,
        }

    # M6 on isolated SQLite copy (test r1 drafts)
    m6_res = evaluate_m6_isolated_sqlite(PROD_SQLITE_PATH, video_ids, drafts_r1)

    # M7 r1 vs r2
    m7_by_vid = {}
    for vid in video_ids:
        if vid in drafts_r1 and vid in drafts_r2:
            m7_by_vid[vid] = evaluate_m7_r1_r2(drafts_r1[vid], drafts_r2[vid])

    # Aggregate summary
    m1_pass_n = sum(1 for v in m1_calls.values() if v.get("pass"))
    m2_pass_n = sum(1 for v in m2_calls.values() if v.get("pass"))
    total_major_refs = sum(len(gt[vid]["existing_v2_major"]) for vid in video_ids)
    matched_major_union = sum(
        sum(1 for m in m3_m5_by_vid[vid]["major_matches_union"] if m and m["time_matched"])
        for vid in video_ids
    )
    m5_median_boundary = round(statistics.median(all_major_boundary_errs), 3) if all_major_boundary_errs else None
    m5_median_mid = round(statistics.median(all_major_mid_errs), 3) if all_major_mid_errs else None

    fast_cut_medians = {}
    for fvid, errs in fast_cut_major_boundary_errs.items():
        fast_cut_medians[fvid] = round(statistics.median(errs), 3) if errs else None
    fast_cut_combined = fast_cut_major_boundary_errs["jsEVOjI690Y"] + fast_cut_major_boundary_errs["Xr032EhUDPw"]
    fast_cut_combined_median = round(statistics.median(fast_cut_combined), 3) if fast_cut_combined else None

    report = {
        "run_dir": str(run_dir),
        "summary": {
            "M1_pass_calls": f"{m1_pass_n}/{len(m1_calls)}",
            "M1_pass": m1_pass_n == len(m1_calls) and len(m1_calls) == 10,
            "M2_pass_calls": f"{m2_pass_n}/{len(m2_calls)}",
            "M2_pass": m2_pass_n == len(m2_calls) and len(m2_calls) == 10,
            "M3_time_matched_major_union": f"{matched_major_union}/{total_major_refs}",
            "M3_time_recall_ratio": round(matched_major_union / total_major_refs, 4) if total_major_refs else None,
            "M5_median_boundary_err_sec": m5_median_boundary,
            "M5_median_midpoint_err_sec": m5_median_mid,
            "M5_fast_cut_boundary_medians_sec": fast_cut_medians,
            "M5_fast_cut_combined_median_sec": fast_cut_combined_median,
            "M5_pass2_triggered": bool(
                any((v is not None and v > 1.0) for v in fast_cut_medians.values())
                or (fast_cut_combined_median is not None and fast_cut_combined_median > 1.0)
            ),
            "M5_micro_transition_median_mid_err_sec": round(statistics.median(all_micro_mid_errs), 3)
            if all_micro_mid_errs
            else None,
            "M6_pass": m6_res["pass"],
            "M6_prod_sqlite_untouched": m6_res["prod_sqlite_untouched"],
            "M7_avg_tool_agreement": round(
                statistics.mean(v["tool_agreement"] for v in m7_by_vid.values()), 4
            )
            if m7_by_vid
            else None,
            "M7_avg_category_agreement": round(
                statistics.mean(v["category_agreement"] for v in m7_by_vid.values()), 4
            )
            if m7_by_vid
            else None,
            "M7_avg_best_iou": round(
                statistics.mean(v["mean_best_iou"] for v in m7_by_vid.values()), 4
            )
            if m7_by_vid
            else None,
        },
        "M1_details": m1_calls,
        "M2_details": m2_calls,
        "M3_M5_details": m3_m5_by_vid,
        "M4_api_cuts_vs_sqlite_scenes": m4_api_only_audit,
        "M6_details": m6_res,
        "M7_details": m7_by_vid,
    }

    out_path = Path(args.out) if args.out else (run_dir / "pilot_evaluation_report.json")
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    print(f"Saved full evaluation report to: {out_path}")


if __name__ == "__main__":
    main()
