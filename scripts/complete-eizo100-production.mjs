import { mkdirSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const limitArg = process.argv.find((value) => value.startsWith("--limit="));
const LIMIT = Number(limitArg?.split("=")[1] ?? 30);
const OUTPUT_DIR = "/home/ubuntu/iketeru-eizou/analysis/production-research";
const OUTPUT_FILE = `${OUTPUT_DIR}/eizo100_official_credit_audit.json`;
const concurrency = 2;

function normalize(value) {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}_]+/gu, "");
}

function videoIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1);
    if (parsed.pathname.startsWith("/shorts/")) return parsed.pathname.split("/")[2] ?? "";
    if (parsed.hostname.includes("vimeo.com")) return parsed.pathname.match(/\d+/)?.[0] ?? "";
    return parsed.searchParams.get("v") ?? "";
  } catch {
    return "";
  }
}

function extractOfficialSource(note) {
  try {
    const urls = JSON.parse(note ?? "{}").sourceUrls ?? [];
    return urls.find((url) => /^https:\/\/eizo100\.jp\/video\/\d+/.test(url)) ?? null;
  } catch {
    return null;
  }
}

function compactName(value) {
  const text = value.replace(/\s+/g, " ").trim();
  const midpoint = Math.floor(text.length / 2);
  if (text.length % 2 === 0 && text.slice(0, midpoint) === text.slice(midpoint)) {
    return text.slice(0, midpoint).trim();
  }
  return text;
}

function unique(values) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function stripHtml(value) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(?:x[\da-f]+|\d+);/gi, " ");
}

function metaContent(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"));
  return match ? stripHtml(match[1]).trim() : "";
}

function jsonLdAuthorName(html) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const findVideoAuthor = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findVideoAuthor(item);
        if (found) return found;
      }
      return "";
    }
    if (!value || typeof value !== "object") return "";
    const type = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
    if (type.includes("VideoObject") && typeof value.author?.name === "string") {
      return value.author.name.trim();
    }
    for (const child of Object.values(value)) {
      const found = findVideoAuthor(child);
      if (found) return found;
    }
    return "";
  };
  for (const script of scripts) {
    try {
      const value = JSON.parse(script[1]);
      const author = findVideoAuthor(value);
      if (author) return author;
    } catch {
      // A malformed or unrelated JSON-LD block is not a production-credit source.
    }
  }
  return "";
}

function parseOfficialPage(html, expectedVideoId) {
  const heading = metaContent(html, "og:title");
  const embeds = [...html.matchAll(/(?:youtube\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})|(?:player\.)?vimeo\.com\/video\/(\d+)/g)]
    .map((match) => match[1] ?? match[2]);
  const member = jsonLdAuthorName(html);
  const bodyText = stripHtml(html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(?:p|div|li|h[1-6]|section|tr|article)>/gi, "\n"));
  const creditLines = bodyText
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => /^(映像|監督|Director|Production|制作|Producer|プロデューサー|Animation|Animator|アニメーション|CG|Cinematographer)[：:]/i.test(line))
    .slice(0, 12);
  const values = unique([
    compactName(member) ? `制作者（映像作家100人掲載者）：${compactName(member)}` : "",
    ...creditLines,
  ]);
  return { heading, embeds, values, videoIdMatched: embeds.includes(expectedVideoId) };
}

async function runWithConcurrency(items, fn) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await connection.execute(`
  SELECT id, title, videoUrl, curationNote
  FROM videos
  WHERE source = 'eizo100'
    AND (productions IS NULL OR productions = '[]')
  ORDER BY id
  LIMIT ${Number.isSafeInteger(LIMIT) && LIMIT > 0 ? LIMIT : 30}
`);

const audits = await runWithConcurrency(rows, async (video) => {
  const sourceUrl = extractOfficialSource(video.curationNote);
  const expectedVideoId = videoIdFromUrl(video.videoUrl);
  if (!sourceUrl || !expectedVideoId || expectedVideoId !== video.id) {
    return {
      id: video.id,
      title: video.title,
      videoUrl: video.videoUrl,
      sourceUrl,
      status: "hold",
      reason: "missing_official_source_or_video_id_mismatch",
      productionValues: [],
    };
  }
  try {
    const response = await fetch(sourceUrl, {
      headers: { "User-Agent": "Mozilla/5.0 metadata-verifier" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const parsed = parseOfficialPage(await response.text(), expectedVideoId);
    const titleMatched = normalize(parsed.heading).includes(normalize(video.title));
    const verified = titleMatched && parsed.videoIdMatched && parsed.values.length > 0;
    return {
      id: video.id,
      title: video.title,
      videoUrl: video.videoUrl,
      sourceUrl,
      status: verified ? "verified" : "hold",
      reason: verified ? "official_eizo100_title_url_id_matched" : "title_url_id_or_credit_not_matched",
      officialPageTitle: parsed.heading,
      videoIdMatched: parsed.videoIdMatched,
      titleMatched,
      confidence: verified ? "official" : "none",
      productionValues: verified ? parsed.values : [],
    };
  } catch (error) {
    return {
      id: video.id,
      title: video.title,
      videoUrl: video.videoUrl,
      sourceUrl,
      status: "hold",
      reason: "official_page_fetch_failed",
      error: error instanceof Error ? error.message : String(error),
      productionValues: [],
    };
  }
});

const verified = audits.filter((audit) => audit.status === "verified");
if (APPLY) {
  for (const audit of verified) {
    await connection.execute(
      `UPDATE videos SET productions = ?
       WHERE id = ? AND videoUrl = ? AND title = ? AND (productions IS NULL OR productions = '[]')`,
      [JSON.stringify(audit.productionValues), audit.id, audit.videoUrl, audit.title],
    );
  }
}
await connection.end();

mkdirSync(OUTPUT_DIR, { recursive: true });
const summary = {
  runAt: new Date().toISOString(),
  apply: APPLY,
  source: "eizo100 official video pages",
  total: audits.length,
  verified: verified.length,
  held: audits.length - verified.length,
  tripleMatch: "official page title + official page embedded video ID + database video ID/URL",
  results: audits,
};
writeFileSync(OUTPUT_FILE, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT_FILE, total: summary.total, verified: summary.verified, held: summary.held, apply: APPLY }));
process.exit(0);
