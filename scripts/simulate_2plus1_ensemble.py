import itertools
import json
import statistics
from pathlib import Path

REPO = Path(r"E:\iketeru-eizou")
BLIND_PATH = REPO / "analysis" / "reproducibility_blind_10x3.json"
SIM_OUT = REPO / "analysis" / "ensemble_2plus1_simulation.json"

BANDS = {
    "S+": (97, 100, 98), "S": (93, 96, 94), "S-": (90, 92, 91),
    "A+": (86, 89, 87),  "A": (82, 85, 83), "A-": (78, 81, 79),
    "B+": (73, 77, 75),  "B": (68, 72, 70), "B-": (63, 67, 65),
    "C+": (57, 62, 60),  "C": (51, 56, 53), "C-": (45, 50, 47),
    "D+": (35, 44, 40),  "D": (20, 34, 27), "D-": (0, 19, 10),
}
ORDER = list(BANDS.keys())
RANK_VAL = {g: len(ORDER) - i for i, g in enumerate(ORDER)}

def score_to_grade(score: int) -> str:
    for g, (lo, hi, _m) in BANDS.items():
        if lo <= score <= hi:
            return g
    return "B"

def is_boundary(score: int) -> bool:
    for _g, (lo, hi, _m) in BANDS.items():
        if lo <= score <= hi:
            return ((lo > 0) and (score == lo)) or ((hi < 100) and (score == hi))
    return False

doc = json.loads(BLIND_PATH.read_text(encoding="utf-8"))

per_video_sim = []
single_run_stable_videos = 0
ensemble_2plus1_stable_videos = 0
ensemble_all_3_unordered_pairs_trigger_3rd = 0
total_unordered_pairs = 0
single_ranges = []
ensemble_ranges = []

# Inflation stats (#2)
consistently_lower_all3 = 0
consistently_higher_all3 = 0
median_lower_than_db = 0
median_equal_to_db = 0
median_higher_than_db = 0
tier_deltas = []

for v in doc["per_video"]:
    runs = sorted(v["runs"], key=lambda r: r["run_idx"])
    db_g = v["db_overall_rating"]
    db_rv = RANK_VAL[db_g]

    # Inflation check
    run_rvs = [RANK_VAL[r["overall_grade"]] for r in runs]
    if all(rv < db_rv for rv in run_rvs):
        consistently_lower_all3 += 1
    if all(rv > db_rv for rv in run_rvs):
        consistently_higher_all3 += 1

    med_g = v["blind_overall"]["median_grade"]
    med_rv = RANK_VAL[med_g]
    tier_deltas.append(med_rv - db_rv)
    if med_rv < db_rv:
        median_lower_than_db += 1
    elif med_rv > db_rv:
        median_higher_than_db += 1
    else:
        median_equal_to_db += 1

    # Single-run stability
    o_scores = [r["overall"] for r in runs]
    o_grades = [r["overall_grade"] for r in runs]
    single_range = max(o_scores) - min(o_scores)
    single_ranges.append(single_range)
    if len(set(o_grades)) == 1:
        single_run_stable_videos += 1

    # 2+1 Adaptive Ensemble simulation across all 3 possible initial pairs {(r1,r2), (r1,r3), (r2,r3)}
    pair_outcomes = []
    for (i, j) in ((0, 1), (0, 2), (1, 2)):
        k = 3 - i - j
        r_a, r_b, r_c = runs[i], runs[j], runs[k]
        diff_o = abs(r_a["overall"] - r_b["overall"])
        diff_d = abs(r_a["direction"] - r_b["direction"])
        diff_t = abs(r_a["technique"] - r_b["technique"])
        total_unordered_pairs += 1
        if diff_o <= 3 and diff_d <= 3 and diff_t <= 3:
            final_o = int(round((r_a["overall"] + r_b["overall"]) / 2))
            mode = "2_run_mean"
        else:
            final_o = int(round(statistics.median([r_a["overall"], r_b["overall"], r_c["overall"]])))
            mode = "3_run_median"
            ensemble_all_3_unordered_pairs_trigger_3rd += 1
        pair_outcomes.append({
            "pair": f"run{i+1}+run{j+1}",
            "mode": mode,
            "final_overall": final_o,
            "final_grade": score_to_grade(final_o),
            "grade_boundary": is_boundary(final_o),
        })

    ens_scores = [p["final_overall"] for p in pair_outcomes]
    ens_grades = [p["final_grade"] for p in pair_outcomes]
    ens_range = max(ens_scores) - min(ens_scores)
    ensemble_ranges.append(ens_range)
    ens_stable = len(set(ens_grades)) == 1
    if ens_stable:
        ensemble_2plus1_stable_videos += 1

    per_video_sim.append({
        "video_id": v["video_id"],
        "db_rating": db_g,
        "single_run_scores": o_scores,
        "single_run_grades": o_grades,
        "single_run_range": single_range,
        "ensemble_2plus1_outcomes": pair_outcomes,
        "ensemble_score_range": ens_range,
        "ensemble_grades": ens_grades,
        "ensemble_grade_100pct_stable": ens_stable,
        "tier_delta_median_vs_db": med_rv - db_rv,
    })

sim_report = {
    "dataset": "analysis/reproducibility_blind_10x3.json (10 videos x 3 blind runs)",
    "single_run_vs_2plus1_ensemble": {
        "single_run_mean_score_range": round(statistics.mean(single_ranges), 2),
        "single_run_max_score_range": max(single_ranges),
        "single_run_grade_stable_videos_out_of_10": single_run_stable_videos,
        "ensemble_2plus1_mean_score_range": round(statistics.mean(ensemble_ranges), 2),
        "ensemble_2plus1_max_score_range": max(ensemble_ranges),
        "ensemble_2plus1_grade_stable_videos_out_of_10": ensemble_2plus1_stable_videos,
        "third_run_trigger_rate": f"{ensemble_all_3_unordered_pairs_trigger_3rd}/{total_unordered_pairs} ({round(100 * ensemble_all_3_unordered_pairs_trigger_3rd / total_unordered_pairs, 1)}%)",
        "expected_avg_runs_per_video": round(2.0 + ensemble_all_3_unordered_pairs_trigger_3rd / total_unordered_pairs, 2),
    },
    "inflation_bias_analysis": {
        "consistently_lower_all_3_runs": consistently_lower_all3,
        "consistently_higher_all_3_runs": consistently_higher_all3,
        "median_lower_than_db": median_lower_than_db,
        "median_equal_to_db": median_equal_to_db,
        "median_higher_than_db": median_higher_than_db,
        "mean_tier_delta_median_minus_db": round(statistics.mean(tier_deltas), 2),
    },
    "per_video": per_video_sim,
}

SIM_OUT.write_text(json.dumps(sim_report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({k: v for k, v in sim_report.items() if k != "per_video"}, ensure_ascii=False, indent=2))
for p in per_video_sim:
    print(f"{p['video_id']} (DB:{p['db_rating']}) | single:{p['single_run_grades']} rng={p['single_run_range']} -> 2+1:{p['ensemble_grades']} rng={p['ensemble_score_range']} stable={p['ensemble_grade_100pct_stable']}")
