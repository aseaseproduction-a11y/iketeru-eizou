import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Video } from "@/lib/types";

const updateMutation = { mutateAsync: vi.fn(), isPending: false };
const invalidate = vi.fn();
const recordEmbedStatus = { mutate: vi.fn() };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ videos: { list: { invalidate } } }),
    videos: {
      update: { useMutation: () => updateMutation },
      recordEmbedStatus: { useMutation: () => recordEmbedStatus },
    },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import VideoModal from "./VideoModal";

const video: Video = {
  id: "modal-test-video",
  platform: "external",
  title: "テスト映像",
  thumbnail: "",
  videoUrl: "https://example.com/video",
  embedUrl: "",
  genres: [{ name: "Web CM", slug: "web-cm" }],
  products: [],
  directions: [],
  tones: [],
  allTags: ["Web CM", "実写"],
  purposes: ["プロモーション"],
  expressions: ["実写"],
  toneEmotions: ["信頼感"],
  toneVisuals: ["クリーン"],
  toneTechniques: ["テロップ"],
  productions: ["key MOVIE"],
  privateRating: "A",
  aiOverallRating: "A",
  aiDirectionRating: "A-",
  aiTechniqueRating: "A+",
  aiAnalysis: "",
  embedStatus: "unknown",
  embedCheckedAt: "",
  addedDate: "2025-04-14",
  source: "manual",
  sourceLabel: "手動追加",
};

describe("VideoModal interactions", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("URLをコピーし、タグクリックで絞り込みを発火する", async () => {
    const onFilter = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<VideoModal video={video} onClose={vi.fn()} onFilter={onFilter} />);

    fireEvent.click(screen.getByTitle("動画URLをコピー"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(video.videoUrl));

    fireEvent.click(screen.getByTitle("Web CMで絞り込む"));
    expect(onFilter).toHaveBeenCalledWith({ key: "genre", value: "web-cm" });

    fireEvent.click(screen.getByTitle("AI評価（総合） A で絞り込む"));
    expect(onFilter).toHaveBeenCalledWith({ key: "aiOverallRating", value: "A" });

    for (const removedLabel of ["用途", "表現", "トンマナ（感情）", "トンマナ（ビジュアル）", "トンマナ（技術）"]) {
      expect(screen.queryByText(removedLabel)).toBeNull();
    }
  });

  it("編集モードで変更を保存すると更新APIを呼び出し、モーダルの動画を更新する", async () => {
    updateMutation.mutateAsync.mockResolvedValue({ success: true });
    const onVideoUpdated = vi.fn();

    render(<VideoModal video={video} onClose={vi.fn()} onVideoUpdated={onVideoUpdated} />);

    fireEvent.click(screen.getByTitle("追加情報を編集"));
    const titleInput = screen.getByDisplayValue(video.title);
    fireEvent.change(titleInput, { target: { value: "編集後のタイトル" } });
    fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));

    await waitFor(() => expect(updateMutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ id: video.id, title: "編集後のタイトル" })));
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    expect(onVideoUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: video.id, title: "編集後のタイトル" }));
  });

  it("キュレーションメモを入力して保存すると目的・背景・評価・公式出典を更新APIへ渡す", async () => {
    updateMutation.mutateAsync.mockResolvedValue({ success: true });
    render(<VideoModal video={video} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTitle("追加情報を編集"));
    fireEvent.change(screen.getByLabelText("制作目的"), { target: { value: "若年層への商品認知を高める" } });
    fireEvent.change(screen.getByLabelText("制作背景"), { target: { value: "夏季の新商品キャンペーン" } });
    fireEvent.change(screen.getByLabelText("評価・受賞理由"), { target: { value: "映像と音楽の一体感が評価された" } });
    fireEvent.change(screen.getByLabelText("公式出典URL"), { target: { value: "https://example.com/case-study\nhttps://example.com/award" } });
    fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));

    await waitFor(() => expect(updateMutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      id: video.id,
      curationNote: {
        purpose: "若年層への商品認知を高める",
        background: "夏季の新商品キャンペーン",
        evaluation: "映像と音楽の一体感が評価された",
        sourceUrls: ["https://example.com/case-study", "https://example.com/award"],
      },
    })));
  });

  it("埋め込み制限の保存状態に関係なくYouTube iframeを描画する", () => {
    const restrictedVideo: Video = {
      ...video,
      platform: "youtube",
      id: "embed-retest-video",
      videoUrl: "https://www.youtube.com/watch?v=embed-retest-video",
      embedStatus: "restricted",
      embedCheckedAt: new Date().toISOString(),
    };

    const { container } = render(<VideoModal video={restrictedVideo} onClose={vi.fn()} />);
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe(`https://www.youtube.com/embed/embed-retest-video?enablejsapi=1&origin=${window.location.origin}&rel=0`);
    expect(iframe?.getAttribute("allow")).toContain("web-share");
    expect(iframe?.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
    expect(screen.getByRole("link", { name: /YouTube公式で開く/ })).toBeTruthy();
    expect(recordEmbedStatus.mutate).not.toHaveBeenCalled();
  });

  it("埋め込み制限理由があってもiframeの再生試行を維持する", () => {
    const expiredRestrictedVideo: Video = {
      ...video,
      platform: "youtube",
      id: "embed-auto-retest-video",
      videoUrl: "https://www.youtube.com/watch?v=embed-auto-retest-video",
      embedStatus: "restricted",
      embedReason: "unavailable_embed_restricted",
      embedCheckedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const { container } = render(<VideoModal video={expiredRestrictedVideo} onClose={vi.fn()} />);
    expect(container.querySelector("iframe")).toBeTruthy();
    expect(screen.queryByText("埋め込み再生は現在確認待ちです")).toBeNull();
  });

  it("platformが古い値でもYouTube URLならiframeを試行する", () => {
    const stalePlatformVideo: Video = {
      ...video,
      platform: "external",
      videoUrl: "https://www.youtube.com/watch?v=stalevid001",
      embedStatus: "restricted",
    };

    const { container } = render(<VideoModal video={stalePlatformVideo} onClose={vi.fn()} />);
    expect(container.querySelector("iframe")?.getAttribute("src")).toContain("youtube.com/embed/stalevid001");
  });

  it("受賞歴と公式出典リンクを表示する", () => {
    const awardVideo: Video = {
      ...video,
      awards: [{
        name: "ACC TOKYO CREATIVITY AWARDS",
        year: "2025",
        category: "フィルム部門 グランプリ",
        sourceUrl: "https://example.com/award",
      }],
    };

    render(<VideoModal video={awardVideo} onClose={vi.fn()} />);

    expect(screen.getByText("AWARDS")).toBeTruthy();
    const link = screen.getByRole("link", { name: /ACC TOKYO CREATIVITY AWARDS/ });
    expect(link.getAttribute("href")).toBe("https://example.com/award");
    expect(screen.getByText("2025 ・ フィルム部門 グランプリ")).toBeTruthy();
  });

  it("キュレーションメモと公式出典リンクを表示する", () => {
    const curationVideo: Video = {
      ...video,
      curationNote: {
        purpose: "若年層への商品認知を高める",
        background: "夏季の新商品キャンペーン",
        evaluation: "映像と音楽の一体感が評価された",
        sourceUrls: ["https://example.com/case-study"],
      },
    };

    render(<VideoModal video={curationVideo} onClose={vi.fn()} />);

    expect(screen.getByText("CURATION NOTE")).toBeTruthy();
    expect(screen.getByText("若年層への商品認知を高める")).toBeTruthy();
    expect(screen.getByText("夏季の新商品キャンペーン")).toBeTruthy();
    expect(screen.getByText("映像と音楽の一体感が評価された")).toBeTruthy();
    expect(screen.getByRole("link", { name: /公式出典 1/ }).getAttribute("href")).toBe("https://example.com/case-study");
  });

  it("クライアント説明用3行まとめを入力・保存・表示できる", async () => {
    updateMutation.mutateAsync.mockResolvedValue({ success: true });
    const pitchText = "1行目：冒頭1秒で視線を止める設計。\n2行目：補色対比で商品を印象付ける。\n3行目：ビート同期の編集で記憶に残す。";
    const { rerender } = render(<VideoModal video={video} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTitle("追加情報を編集"));
    fireEvent.change(screen.getByLabelText("クライアント説明用 企画意図3行まとめ"), { target: { value: pitchText } });
    fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));

    await waitFor(() => expect(updateMutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      id: video.id,
      curationNote: expect.objectContaining({
        clientPitch: pitchText,
      }),
    })));

    rerender(<VideoModal video={{ ...video, curationNote: { purpose: "", background: "", evaluation: "", clientPitch: pitchText, sourceUrls: [] } }} onClose={vi.fn()} />);
    expect(screen.getByText("クライアント説明用・企画意図3行まとめ")).toBeTruthy();
    expect(screen.getByRole("button", { name: /説明文をコピー/ })).toBeTruthy();
  });

  it("校正済み動画では総合点と5軸バーのみを表示し、旧スコア・旧基準AI評価欄を出さない", () => {
    const calibratedV3Video: Video = {
      ...video,
      calibratedScore: 88,
      calibratedRank: "A+",
      calibratedTierBand: "award_tier",
      calibrationStatus: "calibrated_verified",
      calibrationVersion: "phase2_v1",
      calibratedScoreAxes: {
        v: 1,
        axes: {
          direction: 17,
          visual_craft: 18,
          editing_rhythm: 17.5,
          sound_integration: 18.5,
          originality_finish: 17,
        },
        runs: 2,
        source: "phase3",
        offsetPerAxis: 0,
      },
      aiOverallRating: "S-",
      aiDirectionRating: "A+",
      aiTechniqueRating: "A+",
      aiOverallScore: 91,
      aiDirectionScore: 88,
      aiTechniqueScore: 89,
      analysisVersion: "v3",
      aiAnalysis: "## 0. 映像構造と演出力・技術力評価の総括\n新版分析の本文\n\n## 10. 高技術カット完全再現レシピ\n再現手順",
    };

    render(<VideoModal video={calibratedV3Video} onClose={vi.fn()} />);

    expect(screen.getByTestId("modal-header-calibrated-score").textContent).toContain("88点");
    expect(screen.getByTestId("modal-header-calibrated-score").textContent).not.toContain("S-");
    expect(screen.getByTestId("modal-header-calibrated-score").textContent).not.toContain("A+");
    expect(screen.getByTestId("calibrated-score-axes")).toBeTruthy();
    for (const label of ["演出", "映像の技術", "編集・リズム", "音", "独創性・仕上げ"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.queryByTestId("legacy-ai-ratings-section")).toBeNull();
    expect(screen.queryByText(/旧基準AI評価/)).toBeNull();
    expect(screen.queryByText("旧評価 総合")).toBeNull();
    expect(screen.getByTestId("analysis-v3-badge").textContent).toContain("分析 v3");
    expect(screen.queryByTestId("analysis-legacy-badge")).toBeNull();
  });

  it("未校正動画では旧評価を表示し、5軸バーは出さない", () => {
    const legacyUncalibratedVideo: Video = {
      ...video,
      calibratedScore: null,
      calibratedScoreAxes: null,
      aiOverallScore: 84,
      aiDirectionScore: 80,
      aiTechniqueScore: 87,
      analysisVersion: "legacy",
      aiAnalysis: "## 0. 分析サマリー\n旧分析の本文",
    };

    render(<VideoModal video={legacyUncalibratedVideo} onClose={vi.fn()} />);

    expect(screen.queryByTestId("calibrated-score-axes")).toBeNull();
    expect(screen.getByTestId("legacy-ai-ratings-section").textContent).toContain("旧評価");
    expect(screen.getByTestId("analysis-legacy-badge").textContent).toContain("旧分析・時刻は目安");
  });

  it("analysisObservationScope が無い動画では未視聴警告バナーを表示しない", () => {
    render(<VideoModal video={{ ...video, analysisObservationScope: null, aiAnalysis: "実視聴分析本文" }} onClose={vi.fn()} />);
    expect(screen.queryByTestId("unwatched-warning-banner")).toBeNull();
    expect(screen.queryByTestId("unwatched-analysis-reminder")).toBeNull();
  });

  it("analysisObservationScope の種類ごとに異なる未視聴警告バナーとAI分析直上リマインダーを表示する", () => {
    const cases: Array<[string, string]> = [
      ["metadata_only_unwatched", "未視聴分析（メタデータのみ）"],
      ["triage_boilerplate_unwatched", "未視聴分析（定型速報のみ）"],
      ["triage_unverified_short", "要確認（短文速報・実測なし）"],
    ];

    for (const [scope, expectedTitle] of cases) {
      cleanup();
      render(
        <VideoModal
          video={{
            ...video,
            analysisObservationScope: scope,
            aiAnalysis: "## 1. 概要\n未視聴テキスト",
          }}
          onClose={vi.fn()}
        />,
      );
      const banner = screen.getByTestId("unwatched-warning-banner");
      expect(banner.getAttribute("data-observation-scope")).toBe(scope);
      expect(banner.textContent).toContain(expectedTitle);
      expect(banner.textContent).toContain(scope);
      expect(screen.getByTestId("unwatched-analysis-reminder").textContent).toContain(scope);
    }
  });

  it("未視聴本文と校正済みスコアが併存する動画では補足注記を表示する", () => {
    render(
      <VideoModal
        video={{
          ...video,
          analysisObservationScope: "metadata_only_unwatched",
          calibrationStatus: "calibrated_verified",
          calibratedScore: 89.5,
          calibratedRank: "S-",
          aiAnalysis: "メタデータのみ一次記録",
        }}
        onClose={vi.fn()}
      />,
    );
    const banner = screen.getByTestId("unwatched-warning-banner");
    expect(banner.textContent).toContain("校正済みスコアは実動画視聴によるブラインド採点済み");
  });
});
