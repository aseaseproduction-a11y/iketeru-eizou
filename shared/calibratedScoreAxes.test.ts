import { describe, expect, it } from "vitest";
import {
  CALIBRATED_AXIS_DEFINITIONS,
  formatAxisScore,
  parseCalibratedScoreAxes,
  resolveCalibratedScoreAxes,
  sumCalibratedAxes,
} from "./calibratedScoreAxes";

describe("calibratedScoreAxes helpers", () => {
  it("defines the 5 Japanese labels in canonical order", () => {
    expect(CALIBRATED_AXIS_DEFINITIONS.map((d) => d.label)).toEqual([
      "演出",
      "映像の技術",
      "編集・リズム",
      "音",
      "独創性・仕上げ",
    ]);
  });

  it("parses object and JSON string payloads and computes exact sum", () => {
    const payload = {
      v: 1,
      axes: {
        direction: 17,
        visual_craft: 16,
        editing_rhythm: 17.5,
        sound_integration: 17,
        originality_finish: 16,
      },
      runs: 2,
      source: "phase3" as const,
      offsetPerAxis: 0,
    };

    const fromObj = parseCalibratedScoreAxes(payload);
    const fromStr = parseCalibratedScoreAxes(JSON.stringify(payload));
    expect(fromObj).toEqual(payload);
    expect(fromStr).toEqual(payload);
    expect(sumCalibratedAxes(fromObj!.axes)).toBe(83.5);
  });

  it("prefers calibratedScoreAxes over calibratedBreakdown.dimensions and falls back cleanly", () => {
    const fallback = resolveCalibratedScoreAxes({
      calibratedScoreAxes: null,
      calibratedBreakdown: {
        dimensions: {
          direction: 16,
          visual_craft: 15,
          editing_rhythm: 15.5,
          sound_integration: 15,
          originality_finish: 14.5,
        },
        rawScores: [76, 76],
      },
      calibratedRoute: "video_h1",
    });
    expect(fallback?.axes.editing_rhythm).toBe(15.5);
    expect(fallback?.source).toBe("phase3");
    expect(fallback?.offsetPerAxis).toBe(0);

    const direct = resolveCalibratedScoreAxes({
      calibratedScoreAxes: {
        v: 1,
        axes: {
          direction: 18,
          visual_craft: 18,
          editing_rhythm: 19,
          sound_integration: 18,
          originality_finish: 18,
        },
        runs: 2,
        source: "phase3",
        offsetPerAxis: 0,
      },
      calibratedBreakdown: {
        dimensions: {
          direction: 10,
          visual_craft: 10,
          editing_rhythm: 10,
          sound_integration: 10,
          originality_finish: 10,
        },
      },
    });
    expect(direct?.axes.editing_rhythm).toBe(19);
    expect(formatAxisScore(17)).toBe("17");
    expect(formatAxisScore(17.5)).toBe("17.5");
    expect(formatAxisScore(15.55)).toBe("15.55");
  });
});
