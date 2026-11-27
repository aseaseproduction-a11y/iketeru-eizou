import test from "node:test";
import assert from "node:assert/strict";
import {
  PUBLISHED_AT_UPDATE_SQL,
  buildDownloadExcludeListPayload,
  classifyYouTubeApiBatch,
  normalizeToMysqlDatetimeUtc,
  normalizeVimeoUploadDateToUtc,
  parseArgs,
  verifyApplyLockState,
} from "./backfill-published-at.mjs";

test("normalizeToMysqlDatetimeUtc converts YouTube ISO-8601 UTC and offset timestamps cleanly", () => {
  assert.equal(normalizeToMysqlDatetimeUtc("2024-10-11T01:03:05Z"), "2024-10-11 01:03:05");
  assert.equal(normalizeToMysqlDatetimeUtc("2024-10-11T10:03:05+09:00"), "2024-10-11 01:03:05");
  assert.equal(normalizeToMysqlDatetimeUtc(""), null);
  assert.equal(normalizeToMysqlDatetimeUtc("not-a-date"), null);
});

test("normalizeVimeoUploadDateToUtc converts America/New_York (EDT UTC-4 / EST UTC-5) to exact UTC", () => {
  // Empirically verified against Vimeo video page JSON-LD uploadDate (+00:00):
  // 1003005012 (summer EDT, UTC-4 -> +4h)
  assert.equal(normalizeVimeoUploadDateToUtc("2024-08-26 21:42:00"), "2024-08-27 01:42:00");
  // 100398359 (summer EDT, UTC-4 -> +4h)
  assert.equal(normalizeVimeoUploadDateToUtc("2014-07-10 06:37:37"), "2014-07-10 10:37:37");
  // 1032202784 (winter EST, UTC-5 -> +5h)
  assert.equal(normalizeVimeoUploadDateToUtc("2024-11-21 23:49:36"), "2024-11-22 04:49:36");
  // Explicit ISO offset passes through cleanly
  assert.equal(normalizeVimeoUploadDateToUtc("2024-08-27T01:42:00+00:00"), "2024-08-27 01:42:00");
  assert.equal(normalizeVimeoUploadDateToUtc(""), null);
  assert.equal(normalizeVimeoUploadDateToUtc("invalid"), null);
});

test("classifyYouTubeApiBatch distinguishes public, unlisted, private, upload_deleted, and missing IDs", () => {
  const results = classifyYouTubeApiBatch(
    ["pub1", "unl1", "prv1", "del1", "gone1"],
    [
      { id: "pub1", snippet: { publishedAt: "2025-01-02T03:04:05Z" }, status: { privacyStatus: "public", uploadStatus: "processed", embeddable: true } },
      { id: "unl1", snippet: { publishedAt: "2025-02-03T04:05:06Z" }, status: { privacyStatus: "unlisted", uploadStatus: "processed", embeddable: true } },
      { id: "prv1", snippet: { publishedAt: "2025-03-04T05:06:07Z" }, status: { privacyStatus: "private", uploadStatus: "processed", embeddable: false } },
      { id: "del1", snippet: {}, status: { privacyStatus: "public", uploadStatus: "deleted", embeddable: false } },
    ],
  );

  assert.equal(results.length, 5);
  assert.equal(results[0].category, "public");
  assert.equal(results[0].publishedAt, "2025-01-02 03:04:05");
  assert.equal(results[0].shouldExcludeFromDownloadQueue, false);

  assert.equal(results[1].category, "unlisted");
  assert.equal(results[1].shouldExcludeFromDownloadQueue, false);

  assert.equal(results[2].category, "private");
  assert.equal(results[2].shouldExcludeFromDownloadQueue, true);

  assert.equal(results[3].category, "upload_deleted");
  assert.equal(results[3].shouldExcludeFromDownloadQueue, true);

  assert.equal(results[4].category, "private_or_deleted_not_returned");
  assert.equal(results[4].publishedAt, null);
  assert.equal(results[4].shouldExcludeFromDownloadQueue, true);

  const payload = buildDownloadExcludeListPayload({ results, sourceDescription: "test_pool" });
  assert.equal(payload.total_checked, 5);
  assert.equal(payload.exclude_count, 3);
  assert.deepEqual(
    payload.exclude_entries.map((e) => e.video_id),
    ["prv1", "del1", "gone1"],
  );
});

test("parseArgs enforces >= 1000ms Vimeo interval and safe dry-run default", () => {
  const vimeo = parseArgs(["--source", "vimeo"]);
  assert.equal(vimeo.dryRun, true);
  assert.equal(vimeo.apply, false);
  assert.equal(vimeo.intervalMs >= 1000, true);

  assert.throws(() => parseArgs(["--source", "vimeo", "--interval-ms", "500"]), /must be >= 1000/);
  assert.throws(() => parseArgs(["--source", "other"]), /must be 'vimeo' or 'youtube'/);
});

test("verifyApplyLockState and PUBLISHED_AT_UPDATE_SQL preserve updatedAt and require active lock", () => {
  assert.match(PUBLISHED_AT_UPDATE_SQL, /SET `publishedAt` = \?, `updatedAt` = `updatedAt`/);
  assert.match(PUBLISHED_AT_UPDATE_SQL, /WHERE `id` = \? AND `publishedAt` IS NULL/);

  assert.equal(
    verifyApplyLockState({ status: "locked", worker: "CHIBA-PC2", run_id: "pub_run_1" }, "CHIBA-PC2", "pub_run_1"),
    true,
  );
  assert.throws(
    () => verifyApplyLockState({ status: "unlocked", worker: null, run_id: null }, "CHIBA-PC2", "pub_run_1"),
    /Refusing to write/,
  );
});
