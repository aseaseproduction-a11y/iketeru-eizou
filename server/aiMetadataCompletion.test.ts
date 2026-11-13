import { describe, expect, it } from "vitest";
import { acceptsAiCompletionTaskUid, getModelRetryAfter, isModelBackoffActive, isPersistentAiWorkerEnabled, PERSISTENT_AI_WORKER_INTERVAL_MS, selectUnprocessedAiInputs } from "./aiMetadataCompletion";

const row = (id: string, audit: unknown = null, genres = "[]") => ({ id, genres, products: "[]", directions: "[]", tones: "[]", purposes: "[]", expressions: "[]", metadataClassificationAudit: audit ? JSON.stringify(audit) : null } as any);

describe("AI metadata completion batch selection", () => {
  it("selects only missing and unprocessed records within the five-item safety limit", () => {
    const selected = selectUnprocessedAiInputs([row("new"), row("processed", { aiMetadataCompletion: {} }), row("complete", null, '[{"slug":"mv"}]')], 50);
    expect(selected.map((item) => item.id)).toEqual(["new", "complete"]);
    expect(selected).toHaveLength(2);
  });

  it("excludes records whose metadata fields are fully populated", () => {
    const complete = row("complete");
    complete.genres = '[{"slug":"mv"}]'; complete.products = '[{"slug":"food"}]'; complete.directions = '[{"slug":"vfx-3dcg"}]'; complete.tones = '[{"slug":"stylish"}]'; complete.purposes = '["MV"]'; complete.expressions = '["実写"]';
    expect(selectUnprocessedAiInputs([complete], 5)).toEqual([]);
  });

  it("accepts only the primary or backup schedule task UID while the job is enabled", () => {
    const job = { scheduleCronTaskUid: "primary", backupScheduleCronTaskUid: "daily-backup", enabled: 1 } as any;
    expect(acceptsAiCompletionTaskUid(job, "primary")).toBe(true);
    expect(acceptsAiCompletionTaskUid(job, "daily-backup")).toBe(true);
    expect(acceptsAiCompletionTaskUid(job, "unrelated")).toBe(false);
    expect(acceptsAiCompletionTaskUid({ ...job, enabled: 0 }, "primary")).toBe(false);
  });

  it("backs off exponentially after consecutive model failures", () => {
    const now = new Date("2026-08-19T18:00:00.000Z");
    expect(getModelRetryAfter(now, 1).toISOString()).toBe("2026-08-19T19:00:00.000Z");
    expect(getModelRetryAfter(now, 2).toISOString()).toBe("2026-08-19T20:00:00.000Z");
    expect(getModelRetryAfter(now, 4).toISOString()).toBe("2026-08-20T00:00:00.000Z");
  });

  it("activates model backoff only before retryAfter", () => {
    const now = new Date("2026-08-19T18:00:00.000Z");
    expect(isModelBackoffActive({ retryAfter: new Date("2026-08-19T18:01:00.000Z") } as any, now)).toBe(true);
    expect(isModelBackoffActive({ retryAfter: new Date("2026-08-19T18:00:00.000Z") } as any, now)).toBe(false);
  });

  it("enables the persistent worker only in production with an internal authentication secret", () => {
    expect(PERSISTENT_AI_WORKER_INTERVAL_MS).toBe(5 * 60_000);
    expect(isPersistentAiWorkerEnabled({ NODE_ENV: "production", JWT_SECRET: "secret" })).toBe(true);
    expect(isPersistentAiWorkerEnabled({ JWT_SECRET: "secret" })).toBe(true);
    expect(isPersistentAiWorkerEnabled({ NODE_ENV: "development", JWT_SECRET: "secret" })).toBe(false);
    expect(isPersistentAiWorkerEnabled({ NODE_ENV: "production" })).toBe(false);
  });
});
