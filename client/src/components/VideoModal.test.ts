import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("VideoModal embed handling", () => {
  it("does not persist iframe load or player errors to embed status", () => {
    const source = readFileSync(new URL("./VideoModal.tsx", import.meta.url), "utf8");

    expect(source).not.toContain("recordEmbedStatus");
    expect(source).not.toContain("createEmbedStatusReporter");
  });

  it("動画URLコピー、直接更新、クリック絞り込みの導線を提供する", () => {
    const source = readFileSync(new URL("./VideoModal.tsx", import.meta.url), "utf8");

    expect(source).toContain("navigator.clipboard.writeText(video.videoUrl)");
    expect(source).toContain("trpc.videos.update.useMutation()");
    expect(source).toContain('onFilter?.({ key: "production", value: credit.name })');
    expect(source).toContain("onFilter?.({ key: tag.type, value: tag.slug })");
  });

  it("AI評価3項目を評価済み動画だけに明示表示し、評価値で絞り込める", () => {
    const source = readFileSync(new URL("./VideoModal.tsx", import.meta.url), "utf8");

    expect(source).toContain('label: "AI評価（総合）"');
    expect(source).toContain('label: "AI評価（ディレクション）"');
    expect(source).toContain('label: "AI評価（技術）"');
    expect(source).toContain(".filter((rating) => Boolean(rating.value))");
    expect(source).toContain('onFilter?.({ key: rating.key, value: rating.value! })');
  });

  it("AI総合評価をモーダルヘッダー中央のバッジとして表示する", () => {
    const source = readFileSync(new URL("./VideoModal.tsx", import.meta.url), "utf8");

    expect(source).toContain("aiRatings.length > 0");
    expect(source).toContain('"AI総合"');
    expect(source).toContain('"AI演出"');
    expect(source).toContain('"AI技術"');
    expect(source).toContain("getAiRatingBadgeClass(rating.value!)");
    expect(source).toContain("aiRatings.map((rating)");
  });

  it("AI分析結果をタブ式のリッチMarkdownレポートで表示する", () => {
    const source = readFileSync(new URL("./VideoModal.tsx", import.meta.url), "utf8");

    expect(source).toContain('import AiAnalysisReport from "@/components/AiAnalysisReport"');
    expect(source).toContain("<AiAnalysisReport analysis={video.aiAnalysis} />");
    expect(source).not.toContain("AI分析結果を読む");
  });

  it("保存された埋め込み制限に関係なくYouTube iframeを表示する", () => {
    const source = readFileSync(new URL("./VideoModal.tsx", import.meta.url), "utf8");

    expect(source).toContain("https://www.youtube.com/embed/${youtubeId}?enablejsapi=1&origin=${origin}&rel=0");
    expect(source).toContain('referrerPolicy="strict-origin-when-cross-origin"');
    expect(source).toContain("YouTube公式で開く");
    expect(source).not.toContain('video.embedStatus === "restricted"');
  });

  it("シーン検索から渡された開始秒をYouTube埋め込みへ反映する", () => {
    const source = readFileSync(new URL("./VideoModal.tsx", import.meta.url), "utf8");

    expect(source).toContain("initialStartTime?: number");
    expect(source).toContain("&start=${Math.floor(initialStartTime!)}");
    expect(source).toContain("getEmbedSrc(video, initialStartTime)");
  });
});
