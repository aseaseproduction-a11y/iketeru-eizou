#!/usr/bin/env node
/**
 * Phase 2 Primary Source & Metadata Verifier (inherits strict v4 rules from verify-benchmark-sources.mjs).
 *
 * For Tier 2 (R-T2-*):
 *   1. Rejects bare homepage URLs (evidence_url MUST be a specific entry / winner list / archive page).
 *   2. Fetches live HTML, strips nav/header/footer/aside/script/style/svg, rejects bot/404 pages.
 *   3. Checks table rows and semantic blocks for BOTH work keyword AND pure award grade keyword
 *      within <= 150 chars (forbidding site/category names as grade tokens; guarding against
 *      intervening entries and competing medals).
 *   4. Verifies craft category keyword presence on the page (prevents Outdoor/Print/Non-craft mismatch).
 *   5. Extracts exact verbatim evidence_excerpt (<= 150 chars) directly from the matched live block.
 *   6. Stamps verified_by_script and verified_at ONLY on PASS.
 *
 * For R-PRO-* and R-LOW-*:
 *   1. Verifies evidence_excerpt is an exact verbatim substring of the live yt-dlp title or description.
 *   2. For R-LOW-*, verifies frozen R_LOW_KEYWORDS_RE matches the live metadata.
 *   3. Stamps verified_by_script and verified_at ONLY on PASS.
 */

import fs from "node:fs";
import path from "node:path";
import { isBareHomepageUrl, R_LOW_KEYWORDS_RE } from "./validate-phase2-dataset.mjs";

const MAX_PROXIMITY_CHARS = 150;
const MAX_EXCERPT_CHARS = 150;

const FORBIDDEN_TIER_TOKENS = new Set([
  "Cannes", "Cannes Lions", "D&AD", "UKMVA", "Annecy", "SIGGRAPH", "ACC",
  "The Motion Awards", "Motion Awards", "Cannes Corporate", "Art of the Title",
  "Film Craft", "Cinematography", "Editing", "Visual Effects", "Production Design",
  "Title Sequence", "Music Videos", "Commissioned", "Corporate", "Short films"
]);

const PRIMARY_OFFICIAL_HOSTS = [
  "awards.ukmva.com",
  "motionawards.com",
  "www.annecyfestival.com",
  "annecyfestival.com",
  "blog.siggraph.org",
  "www.televisionacademy.com",
  "televisionacademy.com",
  "winners.cannescorporate.com",
  "www.cannescorporate.com",
  "www.acc-awards.com",
  "acc-awards.com",
  "www.dandad.org",
  "www.canneslions.com",
  "www.lovethework.com",
  "www.oneclub.org",
  "www.britisharrows.com",
  "www.ciclopefestival.com"
];

const SELF_REPORTED_HOSTS = [
  "thomasgrovecarter.com"
];

export function classifySourceTier(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (SELF_REPORTED_HOSTS.includes(host)) return "self_reported";
    if (PRIMARY_OFFICIAL_HOSTS.includes(host)) return "primary_official";
    return "secondary";
  } catch {
    return "invalid";
  }
}

const INTERVENING_ENTRY_RX = /\b(?:Title|Advertiser|Agency|Client)\s*:|»/i;
const BOT_RX = /Just a moment|cf-browser-verification|Attention Required! \| Cloudflare|Access Denied|Are you a robot|Verify you are human|Checking your browser/i;
const NON_COMMERCIAL_SPEC_RX = /仮想クライアント|架空企業|架空設定|自主制作作品|学習課題|vookschoolの(?:学習|仮想)/i;

function cleanText(rawHtml) {
  return rawHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8217;|&#039;|&#x27;/g, "'")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#8212;|&mdash;/g, "-")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMainHtml(html) {
  let s = html
    .replace(/<!--[\s\S]{0,400}?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  const mainMatch = s.match(/<main[\s\S]*?<\/main>/i);
  if (mainMatch && cleanText(mainMatch[0]).length > 200) {
    s = mainMatch[0]
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<aside[\s\S]*?<\/aside>/gi, " ");
  } else {
    s = s
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<aside[\s\S]*?<\/aside>/gi, " ");
  }
  return s;
}

function extractSemanticBlocks(proseHtml) {
  const blocks = [];
  const tagPatterns = [
    /<tr\b[^>]*>[\s\S]*?<\/tr>/gi,
    /<li\b[^>]*>[\s\S]*?<\/li>/gi,
    /<p\b[^>]*>[\s\S]*?<\/p>/gi,
    /<dl\b[^>]*>[\s\S]*?<\/dl>/gi,
    /<h[1-4]\b[^>]*>[\s\S]*?<\/h[1-4]>\s*(?:<[^>]+>\s*){0,2}(?:<(?:p|div|ul|ol|span)\b[^>]*>[\s\S]*?<\/(?:p|div|ul|ol|span)>)?/gi,
    /<h[1-4]\b[^>]*>[\s\S]*?<\/h[1-4]>/gi,
  ];
  for (const rx of tagPatterns) {
    for (const m of proseHtml.matchAll(rx)) {
      const t = cleanText(m[0]);
      if (t.length >= 6 && t.length <= 2500) blocks.push(t);
    }
  }
  const chunks = proseHtml
    .replace(/<br\s*\/?>/gi, "</p><p>")
    .split(/<\/(?:div|section|article|p|li|dd|dt|tr|h[1-6])>/i)
    .map(cleanText)
    .filter((t) => t.length >= 2);
  for (const t of chunks) {
    if (t.length >= 6 && t.length <= 1200) blocks.push(t);
  }
  for (let i = 0; i < chunks.length - 1; i++) {
    const pair = `${chunks[i]} ${chunks[i + 1]}`;
    if (pair.length <= 500) blocks.push(pair);
  }
  for (let i = 0; i < chunks.length - 2; i++) {
    const tri = `${chunks[i]} ${chunks[i + 1]} ${chunks[i + 2]}`;
    if (tri.length <= 320) blocks.push(tri);
  }
  for (let i = 0; i < chunks.length - 3; i++) {
    const quad = `${chunks[i]} ${chunks[i + 1]} ${chunks[i + 2]} ${chunks[i + 3]}`;
    if (quad.length <= 320) blocks.push(quad);
  }
  return blocks;
}

function findAllPositions(hayLower, needle) {
  const pos = [];
  const n = needle.toLowerCase();
  let idx = 0;
  while ((idx = hayLower.indexOf(n, idx)) !== -1) {
    pos.push(idx);
    idx += Math.max(1, n.length);
  }
  return pos;
}

function hasCompetingMedalBetween(between, matchedTier) {
  const tl = matchedTier.toLowerCase();
  const bl = between.toLowerCase();
  if (tl === "gold" && /\b(?:silver|bronze)\b/.test(bl)) return true;
  if (tl === "silver" && /\b(?:gold|bronze)\b/.test(bl)) return true;
  if (tl === "bronze" && /\b(?:gold|silver)\b/.test(bl)) return true;
  if (tl === "ゴールド" && /(?:シルバー|ブロンズ)/.test(between)) return true;
  if (tl === "シルバー" && /(?:ゴールド|ブロンズ)/.test(between)) return true;
  return false;
}

function makeSnippet150(text, spanStart, spanEnd) {
  const spanLen = spanEnd - spanStart;
  if (spanLen >= MAX_EXCERPT_CHARS) {
    return text.slice(spanStart, spanStart + MAX_EXCERPT_CHARS).trim();
  }
  const budget = MAX_EXCERPT_CHARS - spanLen;
  const padLeft = Math.floor(budget * 0.4);
  const start = Math.max(0, spanStart - padLeft);
  const end = Math.min(text.length, start + MAX_EXCERPT_CHARS);
  return text.slice(start, end).trim();
}

function findBestPairInBlock(text, workKws, tierKws) {
  const lower = text.toLowerCase();
  const workHits = [];
  for (const w of workKws) for (const p of findAllPositions(lower, w)) workHits.push({ kw: w, pos: p, len: w.length });
  const tierHits = [];
  for (const t of tierKws) for (const p of findAllPositions(lower, t)) tierHits.push({ kw: t, pos: p, len: t.length });
  if (!workHits.length || !tierHits.length) return null;

  let best = null;
  for (const wh of workHits) {
    for (const th of tierHits) {
      const lo = wh.pos < th.pos ? wh.pos + wh.len : th.pos + th.len;
      const hi = wh.pos < th.pos ? th.pos : wh.pos;
      const dist = Math.max(0, hi - lo);
      if (dist > MAX_PROXIMITY_CHARS) continue;
      const between = text.slice(lo, hi);
      if (INTERVENING_ENTRY_RX.test(between)) continue;
      if (hasCompetingMedalBetween(between, th.kw)) continue;
      if (!best || dist < best.dist) {
        best = { dist, w: wh, t: th };
      }
    }
  }
  if (!best) return null;
  const spanStart = Math.min(best.w.pos, best.t.pos);
  const spanEnd = Math.max(best.w.pos + best.w.len, best.t.pos + best.t.len);
  return {
    dist: best.dist,
    matched_work: best.w.kw,
    matched_tier: best.t.kw,
    excerpt: makeSnippet150(text, spanStart, spanEnd),
  };
}

export async function verifyTier2Entry(entry, htmlCache) {
  const url = entry.evidence_url;
  const workKws = entry.verify_rule?.work || [];
  const tierKws = entry.verify_rule?.tier || [];
  const catKws = entry.verify_rule?.category || [];

  if (!url || isBareHomepageUrl(url)) {
    return { status: "failed", reason: `bare_homepage_or_invalid_url: ${url}` };
  }
  const sourceTier = classifySourceTier(url);
  if (sourceTier === "self_reported") {
    return { status: "failed", reason: `self_reported_personal_source_rejected: ${url}` };
  }
  if (!workKws.length || !tierKws.length) {
    return { status: "failed", reason: "missing_verify_rule_work_or_tier" };
  }
  for (const tk of tierKws) {
    if (FORBIDDEN_TIER_TOKENS.has(tk)) {
      return { status: "failed", reason: `forbidden_tier_token: ${tk}` };
    }
  }

  let fetched = htmlCache.get(url);
  if (!fetched) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      });
      const html = await res.text();
      fetched = { status: res.status, finalUrl: res.url, html };
    } catch (err) {
      fetched = { status: 0, error: String(err.message || err) };
    }
    htmlCache.set(url, fetched);
  }

  if (fetched.status !== 200 || !fetched.html) {
    return { status: "failed", reason: `http_${fetched.status}_${fetched.error || "non200"}` };
  }

  // Official ACC JSONP support (acc-awards.com/festival/*fes_result/js/data/*.js)
  if (/acc-awards\.com\/festival\/\d+fes_result\/js\/data\/[^/]+\.js$/i.test(url)) {
    try {
      const jsonStr = fetched.html.trim().replace(/^callback\s*\(/, "").replace(/\)\s*;?\s*$/, "");
      const parsed = JSON.parse(jsonStr);
      for (const tbl of parsed.tables || []) {
        const label = String(tbl.label || "");
        const matchedTier = tierKws.find((tk) => label.toLowerCase().includes(tk.toLowerCase()));
        if (!matchedTier) continue;
        for (const row of tbl.data || []) {
          const rowText = `${label} | ${row["作品No"] || ""} | ${row["広告主"] || ""} ${row["商品名"] || ""}「${row["題名"] || ""}」`.replace(/\s+/g, " ").trim();
          const matchedWork = workKws.find((wk) => rowText.toLowerCase().includes(wk.toLowerCase()));
          if (matchedWork) {
            return {
              status: "verified",
              final_url: fetched.finalUrl,
              source_tier: sourceTier,
              matched_work: matchedWork,
              matched_tier: matchedTier,
              min_distance_chars: 0,
              verbatim_excerpt: rowText.slice(0, MAX_EXCERPT_CHARS).trim(),
            };
          }
        }
      }
      return { status: "failed", reason: "acc_jsonp_work_and_tier_not_found" };
    } catch (err) {
      return { status: "failed", reason: `acc_jsonp_parse_error: ${err.message}` };
    }
  }

  const mainHtml = extractMainHtml(fetched.html);
  const fullText = cleanText(mainHtml);
  const visiblePageText = cleanText(
    fetched.html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
  );
  if (BOT_RX.test(visiblePageText)) {
    return { status: "failed", reason: "bot_or_cloudflare_blocked" };
  }
  const fullLower = fullText.toLowerCase();

  if (catKws.length > 0 && !catKws.some((ck) => fullLower.includes(ck.toLowerCase()))) {
    return { status: "failed", reason: `craft_category_not_found_on_page: [${catKws.join(", ")}]` };
  }

  const blocks = extractSemanticBlocks(mainHtml);
  let best = null;
  for (const b of blocks) {
    const m = findBestPairInBlock(b, workKws, tierKws);
    if (m && (!best || m.dist < best.dist)) best = m;
  }

  if (!best) {
    return {
      status: "failed",
      reason: `work_and_tier_not_co_located_within_${MAX_PROXIMITY_CHARS}chars (blocks=${blocks.length})`,
    };
  }

  return {
    status: "verified",
    final_url: fetched.finalUrl,
    source_tier: sourceTier,
    matched_work: best.matched_work,
    matched_tier: best.matched_tier,
    min_distance_chars: best.dist,
    verbatim_excerpt: best.excerpt,
  };
}

export function verifyMetadataEntry(entry, rawMeta) {
  if (!rawMeta) {
    return { status: "failed", reason: "missing_raw_ytdlp_metadata" };
  }
  const title = String(rawMeta.title || "");
  const desc = String(rawMeta.description || "");
  const channel = String(rawMeta.channel || rawMeta.uploader || "");
  const haystack = `${title}\n${desc}\n${channel}`;
  const excerpt = String(entry.evidence_excerpt || "").trim();

  if (!excerpt) {
    return { status: "failed", reason: "empty_evidence_excerpt" };
  }
  // Normalize whitespace for robust verbatim substring check
  const normHay = haystack.replace(/\s+/g, " ");
  const normExc = excerpt.replace(/\s+/g, " ");
  if (!normHay.includes(normExc)) {
    return { status: "failed", reason: "evidence_excerpt_not_verbatim_in_live_metadata" };
  }
  if (entry.stratum === "non_tier2_pro") {
    const specHit = haystack.match(NON_COMMERCIAL_SPEC_RX);
    if (specHit) {
      return { status: "failed", reason: `non_commercial_spec_or_student_work: ${specHit[0]}` };
    }
  }
  if (entry.stratum === "non_tier2_low") {
    const tags = Array.isArray(rawMeta.tags) ? rawMeta.tags.join(" ") : "";
    if (!R_LOW_KEYWORDS_RE.test(`${haystack}\n${tags}`)) {
      return { status: "failed", reason: "r_low_frozen_keyword_not_matched_in_live_metadata" };
    }
  }
  return { status: "verified", verbatim_excerpt: excerpt };
}

// CLI entrypoint
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  const args = process.argv.slice(2);
  const inIdx = args.indexOf("--input");
  const metaIdx = args.indexOf("--raw-meta");
  const outIdx = args.indexOf("--output");
  const repIdx = args.indexOf("--report");

  if (inIdx === -1 || !args[inIdx + 1]) {
    console.error("Usage: node scripts/verify-phase2-sources.mjs --input <candidates.json> [--raw-meta <meta_map.json>] [--output <verified.json>] [--report <report.json>]");
    process.exit(2);
  }

  const entries = JSON.parse(fs.readFileSync(path.resolve(args[inIdx + 1]), "utf8"));
  const rawMetaMap = metaIdx !== -1 && args[metaIdx + 1]
    ? JSON.parse(fs.readFileSync(path.resolve(args[metaIdx + 1]), "utf8"))
    : {};

  const htmlCache = new Map();
  const verifiedAt = new Date().toISOString();
  const report = { verified_at: verifiedAt, total: entries.length, verified: 0, failed: 0, results: [] };
  const verifiedEntries = [];

  for (const e of entries) {
    let res;
    if (e.stratum === "tier2_award") {
      res = await verifyTier2Entry(e, htmlCache);
    } else {
      res = verifyMetadataEntry(e, rawMetaMap[e.video_id]);
    }
    report.results.push({ video_id: e.video_id, genre: e.genre, stratum: e.stratum, evidence_url: e.evidence_url, ...res });
    if (res.status === "verified") {
      report.verified++;
      const clean = { ...e };
      delete clean.verify_rule;
      clean.evidence_excerpt = res.verbatim_excerpt;
      if (res.final_url) clean.evidence_url = res.final_url;
      if (res.source_tier) clean.source_tier = res.source_tier;
      clean.verified_by_script = "scripts/verify-phase2-sources.mjs";
      clean.verified_at = verifiedAt;
      verifiedEntries.push(clean);
    } else {
      report.failed++;
    }
  }

  if (outIdx !== -1 && args[outIdx + 1]) {
    fs.writeFileSync(path.resolve(args[outIdx + 1]), JSON.stringify(verifiedEntries, null, 2), "utf8");
  }
  if (repIdx !== -1 && args[repIdx + 1]) {
    fs.writeFileSync(path.resolve(args[repIdx + 1]), JSON.stringify(report, null, 2), "utf8");
  }
  console.log(JSON.stringify({ total: report.total, verified: report.verified, failed: report.failed }, null, 2));
  for (const r of report.results.filter((x) => x.status !== "verified")) {
    console.log(`FAIL\t${r.video_id}\t${r.genre}\t${r.stratum}\t${r.reason}`);
  }
}
