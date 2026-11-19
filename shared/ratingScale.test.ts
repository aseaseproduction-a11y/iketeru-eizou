import { describe, expect, it } from "vitest";
import {
  RATING_BANDS,
  RATING_GRADES,
  clampScore100,
  computeOverallScore,
  getEffectiveScore100,
  isScoreConsistentWithRating,
  ratingToScoreBand,
  resolveRatingPair,
  scoreToRating,
  sumRubricScores,
} from "./ratingScale";

describe("ratingScale (100pt <-> 15-level S+..D-)", () => {
  it("covers 0..100 continuously without gaps or overlaps across all 15 grades", () => {
    expect(RATING_BANDS).toHaveLength(15);
    expect(RATING_GRADES).toHaveLength(15);
    for (let score = 0; score <= 100; score += 1) {
      const grade = scoreToRating(score);
      expect(isScoreConsistentWithRating(score, grade)).toBe(true);
    }
  });

  it("maps boundary values accurately", () => {
    expect(scoreToRating(100)).toBe("S+");
    expect(scoreToRating(97)).toBe("S+");
    expect(scoreToRating(96)).toBe("S");
    expect(scoreToRating(93)).toBe("S");
    expect(scoreToRating(90)).toBe("S-");
    expect(scoreToRating(86)).toBe("A+");
    expect(scoreToRating(82)).toBe("A");
    expect(scoreToRating(78)).toBe("A-");
    expect(scoreToRating(73)).toBe("B+");
    expect(scoreToRating(68)).toBe("B");
    expect(scoreToRating(63)).toBe("B-");
    expect(scoreToRating(57)).toBe("C+");
    expect(scoreToRating(51)).toBe("C");
    expect(scoreToRating(45)).toBe("C-");
    expect(scoreToRating(35)).toBe("D+");
    expect(scoreToRating(20)).toBe("D");
    expect(scoreToRating(19)).toBe("D-");
    expect(scoreToRating(0)).toBe("D-");
  });

  it("preserves existing rating when requested, and derives rating from score for new analyses", () => {
    expect(resolveRatingPair({ rating: "A", score: 87, preserveExistingRating: true })).toEqual({
      rating: "A",
      score: 87,
    });
    expect(resolveRatingPair({ rating: "", score: 87, preserveExistingRating: true })).toEqual({
      rating: "A+",
      score: 87,
    });
    expect(resolveRatingPair({ rating: "A", score: 87, preserveExistingRating: false })).toEqual({
      rating: "A+",
      score: 87,
    });
  });

  it("sums 5x20 rubric scores cleanly and rejects incomplete rubrics", () => {
    expect(
      sumRubricScores({
        hookAndStructure: 18,
        originality: 17,
        rhythmAndSync: 19,
        worldAndSubject: 16,
        intentAchievement: 18,
      }),
    ).toBe(88);
    expect(sumRubricScores({ hookAndStructure: 18, originality: 17 })).toBeNull();
    expect(clampScore100(105)).toBe(100);
    expect(clampScore100(-3)).toBe(0);
    expect(clampScore100("")).toBeNull();
    expect(ratingToScoreBand("A+")?.midpoint).toBe(87);
  });

  it("computes overall score with 55/45 weighting + clamped +-5 synergy adjustment", () => {
    expect(computeOverallScore({ directionScore: 90, techniqueScore: 80 })).toBe(86);
    expect(computeOverallScore({ directionScore: 90, techniqueScore: 80, synergyAdjustment: 4 })).toBe(90);
    expect(computeOverallScore({ directionScore: 90, techniqueScore: 80, synergyAdjustment: 12 })).toBe(91); // clamped to +5
    expect(computeOverallScore({ directionScore: 80, techniqueScore: 80, synergyAdjustment: -8 })).toBe(75); // clamped to -5
    expect(getEffectiveScore100(88, "A+")).toBe(88);
    expect(getEffectiveScore100(null, "A+")).toBe(87);
    expect(getEffectiveScore100(null, "")).toBe(-1);
  });
});
