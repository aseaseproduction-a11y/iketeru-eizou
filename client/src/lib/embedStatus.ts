import type { Video } from "./types";

export type PersistedEmbedStatus = "available" | "restricted";
export const EMBED_RECHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export function getEmbedRecheckAt(checkedAt: string): Date | null {
  const checkedAtMs = Date.parse(checkedAt);
  return Number.isNaN(checkedAtMs) ? null : new Date(checkedAtMs + EMBED_RECHECK_INTERVAL_MS);
}

export function formatEmbedRecheckAt(checkedAt: string): string {
  const recheckAt = getEmbedRecheckAt(checkedAt);
  if (!recheckAt) return "次回確認時刻は未設定";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(recheckAt);
}

export function isEmbedStatusRecheckDue(status: Video["embedStatus"], checkedAt: string, now = Date.now()): boolean {
  if (status !== "restricted") return false;
  const checkedAtMs = Date.parse(checkedAt);
  return Number.isNaN(checkedAtMs) || now - checkedAtMs >= EMBED_RECHECK_INTERVAL_MS;
}

export function shouldPersistEmbedStatus(
  platform: Video["platform"],
  currentStatus: Video["embedStatus"],
  lastReportedStatus: PersistedEmbedStatus | undefined,
  nextStatus: PersistedEmbedStatus,
  force = false
): boolean {
  if (platform !== "youtube" && platform !== "vimeo") return false;
  if (force) return true;
  if (lastReportedStatus === nextStatus) return false;
  if (currentStatus === nextStatus) return false;
  return true;
}

export function createEmbedStatusReporter(
  send: (input: { id: string; status: PersistedEmbedStatus }) => void
) {
  const reported: Record<string, PersistedEmbedStatus> = {};

  return (input: {
    id: string;
    platform: Video["platform"];
    currentStatus: Video["embedStatus"];
    nextStatus: PersistedEmbedStatus;
    force?: boolean;
  }): boolean => {
    if (!shouldPersistEmbedStatus(input.platform, input.currentStatus, reported[input.id], input.nextStatus, input.force)) return false;
    reported[input.id] = input.nextStatus;
    send({ id: input.id, status: input.nextStatus });
    return true;
  };
}
