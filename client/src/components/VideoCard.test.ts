import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getMainCreatorName, formatSourceLabel } from "./VideoCard";
import type { Video } from "@/lib/types";

describe("VideoCard AI評価表示", () => {
  it("評価済み動画の校正スコアまたは旧AI評価（総合・演出・技術）を要約バッジで表示する", () => {
    const source = readFileSync(new URL("./VideoCard.tsx", import.meta.url), "utf8");

    expect(source).toContain('shortLabel: "総"');
    expect(source).toContain('shortLabel: "演"');
    expect(source).toContain('shortLabel: "技"');
    expect(source).toContain("{(hasCalibrated || aiRatings.length > 0 || isLegacyUncalibrated) && (");
    expect(source).toContain("{hasCalibrated && (");
    expect(source).toContain("{!hasCalibrated && aiRatings.map((rating) => (");
    expect(source).toContain('aria-label="AI評価"');
    expect(source).toContain('data-testid="video-v3-analysis-badge"');
    expect(source).toContain('data-testid="video-legacy-analysis-badge"');
  });

  it("X・TikTok・Instagramなど外部媒体の種別バッジを表示できる", () => {
    const source = readFileSync(new URL("./VideoCard.tsx", import.meta.url), "utf8");
    expect(source).toContain('video.platform === "x" ? "X"');
    expect(source).toContain('video.platform === "tiktok" ? "TT"');
    expect(source).toContain('video.platform === "instagram" ? "IG"');
    expect(source).toContain('source === "alincolony"');
  });

  it("サムネイル未取得時は統一された仮サムネイルを表示する", () => {
    const source = readFileSync(new URL("./VideoCard.tsx", import.meta.url), "utf8");
    expect(source).toContain('data-testid="thumbnail-placeholder"');
    expect(source).toContain("PREVIEW PENDING");
    expect(source).toContain("{video.title}");
  });

  it("再生不可動画には理由別のバッジを表示する", () => {
    const source = readFileSync(new URL("./VideoCard.tsx", import.meta.url), "utf8");
    expect(source).toContain("unavailable_private_or_deleted: \"非公開・削除\"");
    expect(source).toContain("unavailable_embed_restricted: \"埋め込み制限\"");
    expect(source).toContain("getEmbedReasonLabel(video.embedReason");
  });

  it("カテゴリ間で同名タグがあっても固有キーで表示する", () => {
    const source = readFileSync(new URL("./VideoCard.tsx", import.meta.url), "utf8");

    expect(source).toContain("const allTagBadges = [");
    expect(source).toContain("key: `genre-${tag.name}-${index}`");
    expect(source).toContain("key: `product-${tag.name}-${index}`");
    expect(source).toContain("key={tag.key}");
    expect(source).not.toContain("key={tag}\n              className={`text-[10px]");
  });

  it("メイン制作者名（監督・筆頭クレジット・プロダクション・チャンネル名）をサムネイルとタイトル下に表示する", () => {
    const source = readFileSync(new URL("./VideoCard.tsx", import.meta.url), "utf8");

    expect(source).toContain("getMainCreatorName");
    expect(source).toContain("const mainCreator = getMainCreatorName(video);");
    expect(source).toContain("メイン制作者:");
    expect(source).toContain("<User className=");
  });

  describe("getMainCreatorName ロジック検証", () => {
    const baseVideo = {
      id: "test1",
      title: "Test Video",
      url: "https://www.youtube.com/watch?v=test1",
      platform: "youtube",
      thumbnail: "",
      genres: [],
      products: [],
      directions: [],
      tones: [],
      productionCredits: [],
      productions: [],
    } as unknown as Video;

    it("監督・演出ロールを最優先で取得する", () => {
      const video: Video = {
        ...baseVideo,
        productionCredits: [
          { name: "プロデューサーA", roles: ["プロデューサー"] },
          { name: "新海監督", roles: ["監督", "絵コンテ"] },
        ],
        productions: ["スタジオZ"],
        channelTitle: "公式チャンネル",
      };
      expect(getMainCreatorName(video)).toBe("新海監督");
    });

    it("監督がいない場合は筆頭クレジットを取得する", () => {
      const video: Video = {
        ...baseVideo,
        productionCredits: [
          { name: "筆頭制作者B", roles: ["アニメーション"] },
          { name: "アシスタントC", roles: ["CG"] },
        ],
        productions: ["制作会社Y"],
        channelTitle: "公式チャンネル",
      };
      expect(getMainCreatorName(video)).toBe("筆頭制作者B");
    });

    it("クレジットがない場合は productions[0] を取得する", () => {
      const video: Video = {
        ...baseVideo,
        productionCredits: [],
        productions: ["MAPPA", "東宝"],
        channelTitle: "TOHO animation",
      };
      expect(getMainCreatorName(video)).toBe("MAPPA");
    });

    it("クレジットも制作会社もない場合は channelTitle を取得する", () => {
      const video: Video = {
        ...baseVideo,
        productionCredits: [],
        productions: [],
        channelTitle: "Vincent Bossel",
      };
      expect(getMainCreatorName(video)).toBe("Vincent Bossel");
    });

    it("制作者情報が何もない場合は null を返す", () => {
      const video: Video = {
        ...baseVideo,
        productionCredits: [],
        productions: [],
        channelTitle: "",
      };
      expect(getMainCreatorName(video)).toBeNull();
    });
  });

  describe("formatSourceLabel 収集元ラベル省略ロジック", () => {
    it("既知のソースキーを短縮名へ変換する", () => {
      expect(formatSourceLabel("youtube_search")).toBe("YT検索");
      expect(formatSourceLabel("vimeo_staff_picks")).toBe("Staff Pick");
      expect(formatSourceLabel("eizo100")).toBe("作家100");
      expect(formatSourceLabel("creator_tracking")).toBe("追跡");
    });

    it("長いトレンド収集元（トレンド: YouTube...）を短縮する", () => {
      expect(formatSourceLabel("トレンド: YouTube (モーショングラフィックス)")).toBe("トレンド");
    });

    it("8文字を超える未知の長いソース名は末尾を省略する", () => {
      expect(formatSourceLabel("超長文の収集元ラベルテキスト")).toBe("超長文の収集…");
    });
  });
});
