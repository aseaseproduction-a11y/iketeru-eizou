import { describe, expect, it, vi } from "vitest";
import { createEmbedStatusReporter, EMBED_RECHECK_INTERVAL_MS, formatEmbedRecheckAt, getEmbedRecheckAt, isEmbedStatusRecheckDue, shouldPersistEmbedStatus } from "./embedStatus";

describe("shouldPersistEmbedStatus", () => {
  it("未判定動画の最初の結果だけを保存し、同じ状態の重複送信を防ぐ", () => {
    expect(shouldPersistEmbedStatus("youtube", "unknown", undefined, "available")).toBe(true);
    expect(shouldPersistEmbedStatus("youtube", "unknown", "available", "available")).toBe(false);
    expect(shouldPersistEmbedStatus("youtube", "available", undefined, "available")).toBe(false);
  });

  it("外部URL動画は埋め込み状態を保存しない", () => {
    expect(shouldPersistEmbedStatus("external", "unknown", undefined, "restricted")).toBe(false);
  });

  it("同じ動画・同じ状態の通知で送信関数を一度だけ呼ぶ", () => {
    const send = vi.fn();
    const report = createEmbedStatusReporter(send);
    const input = { id: "video-1", platform: "youtube" as const, currentStatus: "unknown" as const, nextStatus: "available" as const };

    expect(report(input)).toBe(true);
    expect(report(input)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ id: "video-1", status: "available" });
  });

  it("手動再テストでは同じ状態でも一度だけ再送できる", () => {
    expect(shouldPersistEmbedStatus("youtube", "restricted", undefined, "restricted", true)).toBe(true);
    expect(shouldPersistEmbedStatus("youtube", "restricted", "restricted", "restricted", true)).toBe(true);
  });
});

describe("埋め込み制限の再確認期限", () => {
  it("制限状態は7日後に再確認対象となる", () => {
    const checkedAt = new Date(1_000).toISOString();
    expect(isEmbedStatusRecheckDue("restricted", checkedAt, 1_000 + EMBED_RECHECK_INTERVAL_MS - 1)).toBe(false);
    expect(isEmbedStatusRecheckDue("restricted", checkedAt, 1_000 + EMBED_RECHECK_INTERVAL_MS)).toBe(true);
  });

  it("再生可能・未確認状態は再確認対象にしない", () => {
    expect(isEmbedStatusRecheckDue("available", "", Date.now())).toBe(false);
    expect(isEmbedStatusRecheckDue("unknown", "", Date.now())).toBe(false);
  });

  it("次回確認日時を7日後として計算・表示する", () => {
    const checkedAt = "2026-08-01T00:00:00.000Z";
    expect(getEmbedRecheckAt(checkedAt)?.toISOString()).toBe("2026-08-08T00:00:00.000Z");
    expect(formatEmbedRecheckAt(checkedAt)).toMatch(/8\/8/);
  });
});
