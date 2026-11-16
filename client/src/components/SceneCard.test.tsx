// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SceneItem } from "@/lib/sceneSearch";
import SceneCard from "./SceneCard";

const sampleScene: SceneItem = {
  id: "8z4K0QffMc0_s01",
  videoId: "8z4K0QffMc0",
  videoTitle: "VFX Showreel 2026",
  platform: "youtube",
  sceneNumber: 1,
  startSeconds: 0,
  endSeconds: 5,
  timeRange: "00:00 - 00:05",
  visual: "闇の中からリアルタイム・パーティクル・シミュレーションが立ち上がるオープニング。",
  audio: "ハイテク感あふれる電子音",
  keywords: ["グリッチ", "Unreal Engine"],
  thumbnailUrl: "https://img.youtube.com/vi/8z4K0QffMc0/hqdefault.jpg",
};

describe("SceneCard hover preview", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("youtube-nocookie を使わず youtube.com + enablejsapi + origin で埋め込み、PLAYING 通知まで iframe を表示しない", () => {
    vi.useFakeTimers();
    const { container } = render(<SceneCard scene={sampleScene} index={0} />);
    const card = container.firstElementChild as HTMLElement;

    fireEvent.mouseEnter(card);
    act(() => {
      vi.advanceTimersByTime(400);
    });

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const src = iframe?.getAttribute("src") ?? "";
    expect(src).toContain("https://www.youtube.com/embed/8z4K0QffMc0");
    expect(src).toContain("enablejsapi=1");
    expect(src).toContain(`origin=${window.location.origin}`);
    expect(src).not.toContain("youtube-nocookie.com");

    // 再生開始前は iframe ラッパーが非表示（サムネイル側が前面）で bot 確認画面が露出しない
    const iframeWrapper = iframe?.parentElement as HTMLElement;
    expect(iframeWrapper.className).toContain("opacity-0");

    // YouTube から onError (bot-check / 埋め込み制限など) が返ったら iframe をアンマウント
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe?.contentWindow as Window,
          data: JSON.stringify({ event: "onError", info: 150 }),
        })
      );
    });
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("YouTube iframe が PLAYING (playerState=1) になったら iframe を表示する", () => {
    vi.useFakeTimers();
    const { container } = render(<SceneCard scene={sampleScene} index={0} />);
    const card = container.firstElementChild as HTMLElement;

    fireEvent.mouseEnter(card);
    act(() => {
      vi.advanceTimersByTime(400);
    });

    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow as Window,
          data: JSON.stringify({ event: "onStateChange", info: 1 }),
        })
      );
    });

    const iframeWrapper = iframe.parentElement as HTMLElement;
    expect(iframeWrapper.className).toContain("opacity-100");
  });
});
