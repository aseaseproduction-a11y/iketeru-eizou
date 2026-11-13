import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";

const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error("Usage: node scripts/apply_weekly_collection_candidates.mjs <verified-candidates.json>");
}

const input = JSON.parse(await readFile(inputPath, "utf8"));
const candidates = Array.isArray(input?.candidates) ? input.candidates : [];
const checkedSourceIds = Array.isArray(input?.checkedSourceIds) ? input.checkedSourceIds : [];

const asString = (value) => typeof value === "string" ? value.trim() : "";
const extractVideoId = (platform, value) => platform === "youtube"
  ? value.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{11})/)?.[1] || ""
  : value.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1] || "";
const normalizeTitle = (value) => asString(value).toLowerCase().replace(/[\s!"#$%&'()*+,\.\/:;<=>?@[\\\]^`{|}~_]+/g, "");
const titlesResemble = (left, right) => {
  const a = normalizeTitle(left); const b = normalizeTitle(right);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  if (Math.min(a.length, b.length) < 8) return false;
  return a.includes(b.slice(0, 16)) || b.includes(a.slice(0, 16));
};
const asStringArray = (value) => Array.isArray(value)
  ? Array.from(new Set(value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())))
  : [];
const parseStringArray = (value) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (typeof item === "string" && item.trim()) return [item.trim()];
      if (item && typeof item === "object" && typeof item.name === "string" && item.name.trim()) return [item.name.trim()];
      return [];
    });
  } catch {
    return [];
  }
};
const safeNote = (value) => {
  const fallback = { purpose: "", background: "", evaluation: "", sourceUrls: [] };
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    return {
      purpose: asString(parsed.purpose),
      background: asString(parsed.background),
      evaluation: asString(parsed.evaluation),
      sourceUrls: Array.isArray(parsed.sourceUrls)
        ? parsed.sourceUrls.filter((url) => /^https?:\/\//.test(asString(url)))
        : [],
    };
  } catch {
    return fallback;
  }
};
const getOembed = async (platform, videoUrl) => {
  const endpoint = platform === "youtube"
    ? `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`
    : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(videoUrl)}`;
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return null;
  const data = await response.json();
  return {
    title: asString(data?.title),
    thumbnail: asString(data?.thumbnail_url),
    author: asString(data?.author_name),
  };
};

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const details = [];
let inserted = 0;
let updated = 0;
let skipped = 0;

try {
  await connection.beginTransaction();
  const [runResult] = await connection.execute(
    "INSERT INTO dailyCollectionRuns (taskUid, status, candidateCount) VALUES (?, 'running', ?)",
    [process.env.MANUS_TASK_UID || null, candidates.length],
  );
  const runId = runResult.insertId;
  const [sourceRows] = await connection.execute(
    "SELECT id, label FROM dailyCollectionSources WHERE enabled = 1",
  );
  const sources = new Map(sourceRows.map((row) => [row.id, row]));
  const seenIds = new Set();

  for (const rawCandidate of candidates.slice(0, 160)) {
    const platform = rawCandidate?.platform === "youtube" || rawCandidate?.platform === "vimeo" ? rawCandidate.platform : "";
    const id = asString(rawCandidate?.id);
    const videoUrl = asString(rawCandidate?.videoUrl);
    const sourceTitle = asString(rawCandidate?.title);
    const sourceUrl = asString(rawCandidate?.sourceUrl);
    const sourceId = asString(rawCandidate?.sourceId);
    const articleVerified = rawCandidate?.articleVerified === true;
    const genres = asStringArray(rawCandidate?.genres);
    const products = asStringArray(rawCandidate?.products);
    const purposes = asStringArray(rawCandidate?.purposes);
    const source = sources.get(sourceId);

    if (!platform || !id || !videoUrl || !sourceTitle || !sourceUrl || !source || extractVideoId(platform, videoUrl) !== id) {
      skipped++;
      details.push({ id, sourceId, reason: "invalid_candidate_identity_or_source" });
      continue;
    }
    if (seenIds.has(id)) {
      skipped++;
      details.push({ id, sourceId, reason: "duplicate_candidate_id" });
      continue;
    }
    seenIds.add(id);

    const metadata = await getOembed(platform, videoUrl).catch(() => null);
    if (!metadata?.title || (!titlesResemble(sourceTitle, metadata.title) && !articleVerified)) {
      skipped++;
      details.push({ id, sourceId, reason: "public_oembed_or_title_mismatch" });
      continue;
    }

    const [rows] = await connection.execute("SELECT * FROM videos WHERE id = ? LIMIT 1", [id]);
    const existing = rows[0];
    if (!existing) {
      const curationNote = JSON.stringify({
        purpose: "映像表現のリファレンス収集",
        background: `週次エージェントが公式掲載ページから検出。公式掲載タイトル: ${sourceTitle}`,
        evaluation: "公開oEmbed・動画ID・タイトルを照合済み。",
        sourceUrls: [sourceUrl],
      });
      await connection.execute(
        `INSERT INTO videos (id, platform, title, thumbnail, videoUrl, embedUrl, source, sourceLabel, channelTitle, genres, products, purposes, allTags, curationNote, addedDate, embedStatus)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available')`,
        [
          id, platform, metadata.title, metadata.thumbnail || null, videoUrl,
          platform === "youtube" ? `https://www.youtube.com/embed/${id}` : `https://player.vimeo.com/video/${id}`,
          sourceId, source.label, metadata.author || null,
          JSON.stringify(genres), JSON.stringify(products), JSON.stringify(purposes),
          JSON.stringify(["週次収集", "公式掲載", "掲載記事根拠", platform]), curationNote,
          new Date().toISOString().slice(0, 10),
        ],
      );
      inserted++;
      details.push({ id, sourceId, reason: "inserted" });
      continue;
    }

    const note = safeNote(existing.curationNote);
    const fields = [];
    const values = [];
    if (!asString(existing.thumbnail) && metadata.thumbnail) {
      fields.push("thumbnail = ?"); values.push(metadata.thumbnail);
    }
    if (!asString(existing.channelTitle) && metadata.author) {
      fields.push("channelTitle = ?"); values.push(metadata.author);
    }
    if (!note.sourceUrls.includes(sourceUrl)) {
      fields.push("curationNote = ?");
      values.push(JSON.stringify({ ...note, sourceUrls: [...note.sourceUrls, sourceUrl] }));
    }
    if (!parseStringArray(existing.genres).length && genres.length) {
      fields.push("genres = ?"); values.push(JSON.stringify(genres));
    }
    if (!parseStringArray(existing.products).length && products.length) {
      fields.push("products = ?"); values.push(JSON.stringify(products));
    }
    if (!parseStringArray(existing.purposes).length && purposes.length) {
      fields.push("purposes = ?"); values.push(JSON.stringify(purposes));
    }
    if (!fields.length) {
      skipped++;
      details.push({ id, sourceId, reason: "duplicate_id_no_safe_refresh" });
      continue;
    }
    values.push(id);
    await connection.execute(`UPDATE videos SET ${fields.join(", ")} WHERE id = ?`, values);
    updated++;
    details.push({ id, sourceId, reason: "updated_existing_public_metadata", updatedFields: fields.map((field) => field.split(" ")[0]) });
  }

  const checkedIds = [...new Set(checkedSourceIds.map(asString).filter((id) => sources.has(id)))];
  if (checkedIds.length) {
    const placeholders = checkedIds.map(() => "?").join(", ");
    await connection.execute(`UPDATE dailyCollectionSources SET lastCheckedAt = NOW() WHERE id IN (${placeholders})`, checkedIds);
  }
  await connection.execute(
    "UPDATE dailyCollectionRuns SET status = 'completed', completedAt = NOW(), insertedCount = ?, updatedCount = ?, skippedCount = ?, details = ? WHERE id = ?",
    [inserted, updated, skipped, JSON.stringify(details), runId],
  );
  await connection.commit();
  console.log(JSON.stringify({ runId, candidateCount: candidates.length, inserted, updated, skipped, checkedSourceIds: checkedIds, details }, null, 2));
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
