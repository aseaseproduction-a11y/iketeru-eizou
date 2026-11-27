import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Video } from "@/lib/types";

(globalThis as unknown as { React: typeof React }).React = React;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ videos: { list: { invalidate: vi.fn() } } }),
    videos: {
      update: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import VideoCard from "./VideoCard";
import VideoModal from "./VideoModal";

const baseVideo: Video = {
  id: "render-test-video",
  platform: "vimeo",
  title: "テスト作品",
  thumbnail: "",
  videoUrl: "https://vimeo.com/776884130",
  embedUrl: "",
  genres: [{ name: "Web CM", slug: "web-cm" }],
  products: [],
  directions: [],
  tones: [],
  allTags: ["Web CM"],
  purposes: [],
  expressions: [],
  toneEmotions: [],
  toneVisuals: [],
  toneTechniques: [],
  productions: [],
  privateRating: "",
  aiOverallRating: "",
  aiDirectionRating: "",
  aiTechniqueRating: "",
  aiAnalysis: "## 1. 概要\nサンプル分析本文",
  embedStatus: "unknown",
  embedCheckedAt: "",
  addedDate: "2026-11-19",
};

describe("Unwatched analysis warning rendering (VideoCard & VideoModal)", () => {
  it("does not render unwatched warning on VideoCard or VideoModal when analysisObservationScope is null", () => {
    const cardHtml = renderToStaticMarkup(
      <VideoCard video={{ ...baseVideo, analysisObservationScope: null }} index={0} />,
    );
    const modalHtml = renderToStaticMarkup(
      <VideoModal video={{ ...baseVideo, analysisObservationScope: null }} onClose={vi.fn()} />,
    );
    expect(cardHtml).not.toContain('data-testid="unwatched-warning-badge"');
    expect(modalHtml).not.toContain('data-testid="unwatched-warning-banner"');
    expect(modalHtml).not.toContain('data-testid="unwatched-analysis-reminder"');
  });

  it("renders distinct warning copy per analysisObservationScope on VideoCard and VideoModal", () => {
    const cases: Array<{ scope: string; badge: string; title: string }> = [
      {
        scope: "metadata_only_unwatched",
        badge: "未視聴・メタデータのみ",
        title: "未視聴分析（メタデータのみ）",
      },
      {
        scope: "triage_boilerplate_unwatched",
        badge: "未視聴・定型速報",
        title: "未視聴分析（定型速報のみ）",
      },
      {
        scope: "triage_unverified_short",
        badge: "要確認・実測なし",
        title: "要確認（短文速報・実測なし）",
      },
      {
        scope: "missing_video_unwatched",
        badge: "未視聴・動画未取得",
        title: "未視聴分析（動画未取得）",
      },
    ];

    for (const c of cases) {
      const target: Video = { ...baseVideo, analysisObservationScope: c.scope };
      const cardHtml = renderToStaticMarkup(<VideoCard video={target} index={0} />);
      expect(cardHtml).toContain('data-testid="unwatched-warning-badge"');
      expect(cardHtml).toContain(`data-observation-scope="${c.scope}"`);
      expect(cardHtml).toContain(c.badge);

      const modalHtml = renderToStaticMarkup(<VideoModal video={target} onClose={vi.fn()} />);
      expect(modalHtml).toContain('data-testid="unwatched-warning-banner"');
      expect(modalHtml).toContain(`data-observation-scope="${c.scope}"`);
      expect(modalHtml).toContain(c.title);
      expect(modalHtml).toContain('data-testid="unwatched-analysis-reminder"');
    }
  });

  it("renders calibrated score coexistence note in VideoModal when both calibratedScore and analysisObservationScope exist", () => {
    const modalHtml = renderToStaticMarkup(
      <VideoModal
        video={{
          ...baseVideo,
          analysisObservationScope: "metadata_only_unwatched",
          calibrationStatus: "calibrated_verified",
          calibratedScore: 89.5,
          calibratedRank: "S-",
        }}
        onClose={vi.fn()}
      />,
    );
    expect(modalHtml).toContain("校正済みスコアは実動画視聴によるブラインド採点済み");
  });
});
