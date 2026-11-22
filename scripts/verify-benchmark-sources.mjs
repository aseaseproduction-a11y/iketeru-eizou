import fs from "node:fs";

const bench = JSON.parse(fs.readFileSync("E:/iketeru-eizou/analysis/golden_benchmark.json", "utf8"));

// Strict v4 verification rules:
// 1. Strip header/nav/footer/aside/script/style/svg before matching
// 2. FORBID BOTH site-name keywords AND category/division names — ONLY pure award grade/rank/selection tokens allowed!
// 3. Block-level isolation:
//    - <table> is checked strictly row-by-row (<tr>)
//    - Non-table prose is split into semantic blocks (<li>, <p>, <header class="bv-movie-header">, <h1>..<h4> + immediate block, etc.)
// 4. Tight proximity: work keyword AND grade keyword MUST be <= 150 chars apart within the same block
// 5. Intervening-entry guard: REJECT any match if a different-entry separator (Title:, Advertiser:, Agency:, Client:, or competing medal word) appears between work and tier!
const MAX_PROXIMITY_CHARS = 150;

const FORBIDDEN_TOKENS = new Set([
  "映像作家100人", "観光映像祭", "日本国際観光映像祭", "BOVA", "Cannes", "Cannes Lions",
  "D&AD", "ADFEST", "YouTube Works", "映文連", "Vimeo", "UKMVA", "Oscars", "Annecy", "SXSW", "JWTFF",
  "The Motion Awards", "Motion Awards",
  "Film Craft", "Animation Division", "Animated Short", "Digital Marketing",
  "Sustainable Development Goals", "アジアの未来", "アニメーション部門", "エンターテインメント部門",
  "Competition", "Title Sequence", "Music Videos", "Short films", "NEW MOTION"
]);

const INTERVENING_ENTRY_RX = /\b(?:Title|Advertiser|Agency|Client)\s*:|»/i;

const RULES = {
  "FNQ4vqB-waw": { work: ["父と娘の風景"], tier: ["金賞"] },
  "5wEjV2ekSwE": { work: ["Hands"], tier: ["Silver"] },
  "vpyeQeTDGFA": { work: ["Paper"], tier: ["Graphite Pencil"] },
  "Z_lbVlhO9HE": { work: ["Spreadbeats"], tier: ["Black Pencil"] },
  "DwIur8FBRxw": { work: ["ありがとう", "漫画愛", "ABJ"], tier: ["グランプリ", "Grand Prix"] },
  "iIL_CB_YjFk": [
    { work: ["LIGHT HOLE"], tier: ["ブロンズ", "Bronze"] },
    { work: ["LIGHT HOLE"], tier: ["Gold"] },
  ],
  "tdQCMuaJUQk": { work: ["シール交換小学生", "セコム"], tier: ["グランプリ"] },
  "JFDm4p8T6_4": { work: ["立命館大学"], tier: ["ゴールド"] },
  "wXD33Jx25oI": { work: ["ギャンブル", "エスケープ"], tier: ["ゴールド"] },
  "FSqTqdjf2YQ": { work: ["アロンアルフア", "東亞合成"], tier: ["シルバー"] },
  "iXTuYbyH2Rc": { work: ["朝は絶対", "オハヨー"], tier: ["シルバー"] },
  "-J7Oi1-EfG8": { work: ["UMAMI BOOST", "味の素"], tier: ["協賛企業賞"] },
  "5URefVYaJrA": { work: ["Tailor Swif", "A$AP Rocky"], tier: ["Black Pencil"] },
  "tvTRZJ-4EyI": { work: ["HUMBLE"], tier: ["Video of the Year", "Best Direction"] },
  "ebzEEEdjHj0": { work: ["No Reason", "Bonobo"], tier: ["Best Dance Video", "Best Production Design"] },
  "153159513":   { work: ["Deep Down Low", "Valentino Khan"], tier: ["Best Dance Video"] },
  "313084145":   { work: ["A Pearl", "Mitski"], tier: ["Special Jury Recognition"] },
  "49367868":    { work: ["地下鉄の動態", "ハイスイノナサ"], tier: ["新人賞"] },
  "5zj3aHgLFQE": { work: ["Poker", "トクマルシューゴ"], tier: ["審査委員会推薦作品"] },
  "3JtO1WMYb58": { work: ["Viewtiful", "Frasco"], tier: ["審査委員会推薦作品"] },
  "QmLBz4FuVDA": { work: ["Footloose", "INNOSENT"], tier: ["審査委員会推薦作品"] },
  "246660563":   { work: ["橋本 麦", "HASHIMOTO Baku", "Fly"], tier: ["観客賞", "Audience Award"] },
  "1032202784":  { work: ["Node Fest Titles 2024", "Never Sit Still"], tier: ["Winner"] },
  "vRBVWCs1KW4": { work: ["Blinkity Blank"], tier: ["Palme d'Or"] },
  "X0hyTmlsBUI": { work: ["Origami", "金森慧"], tier: ["ショートリスト", "Shortlist"] },
  "35i4zTky9pI": { work: ["Lost & Found"], tier: ["Shortlist"] },
  "vohpCZh-Qcw": { work: ["普通の生活"], tier: ["銀熊賞"] },
  "jvKtHf7kDYs": { work: ["世界、北半球", "ホセイン"], tier: ["作品賞"] },
  "134832670":   { work: ["Cyclone", "HIRAOKA"], tier: ["Jury Selection"] },
  "UvGwIFVUK7M": { work: ["Jindal Steel", "Steel of India"], tier: ["Grand Prix"] },
  "CWhNI_x9W6c": { work: ["RX-7", "MAZDA"], tier: ["経済産業大臣賞"] },
  "D_vdPkCz23g": { work: ["Palau Legacy Project", "Palau Pledge"], tier: ["Grand Prix"] },
  "1S-KU2F7wc0": { work: ["南阿蘇", "みなみあそ"], tier: ["グランプリ", "最優秀賞"] },
  "8pOOxOo7YYo": { work: ["サロベツ", "利尻"], tier: ["グランプリ"] },
  "uCDUpZV3f8A": { work: ["Brushing Up", "Erika Konno"], tier: ["Commendation"] },
  "9NzQ3G6rY5M": { work: ["和水町", "なごみを"], tier: ["優秀賞"] },
  "p4eAR2Gw5RU": { work: ["旧奈良監獄", "赤レンガ"], tier: ["入選"] },
  "V6XHz7tqGVM": { work: ["Beautiful Lie", "Muranaka"], tier: ["Fabulous Four"] },
  "9waEFmHUNdk": { work: ["BUNGO-ONO", "豊後大野"], tier: ["観客賞"] },
};

for (const [id, ruleOrArr] of Object.entries(RULES)) {
  const arr = Array.isArray(ruleOrArr) ? ruleOrArr : [ruleOrArr];
  for (const r of arr) {
    for (const tk of r.tier) {
      if (FORBIDDEN_TOKENS.has(tk)) {
        throw new Error(`Forbidden site/category token '${tk}' used in tier rule for ${id}`);
      }
    }
  }
}

const botRx = /Just a moment|cf-browser-verification|Attention Required! \| Cloudflare|Access Denied|Are you a robot|Verify you are human|Checking your browser/i;

function cleanText(rawHtml) {
  return rawHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8217;|&#039;/g, "'")
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

// Extract semantic content blocks from non-table prose HTML:
// 1. Explicit semantic containers: <li>, <p>, <header class="bv-movie-header">, <h1>..<h4>, <dl>
// 2. Heading + immediately following sibling block (for layouts like <h3>Winner</h3><p>Title</p> or <h2>Award</h2><ul>...</ul>)
function extractSemanticBlocks(proseHtml) {
  const blocks = [];
  const tagPatterns = [
    /<li\b[^>]*>[\s\S]*?<\/li>/gi,
    /<p\b[^>]*>[\s\S]*?<\/p>/gi,
    /<header\b[^>]*>[\s\S]*?<\/header>/gi,
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
  // Split loose text/div cards on block boundaries (preserving intact <p> lists like oscars.org) AND <br> boundaries
  const intactChunks = proseHtml
    .split(/<\/(?:div|section|article|p|li|dd|dt|h[1-6])>/i)
    .map(cleanText)
    .filter(t => t.length >= 2);
  for (const t of intactChunks) {
    if (t.length >= 6 && t.length <= 1200) blocks.push(t);
  }
  for (let i = 0; i < intactChunks.length - 1; i++) {
    if (intactChunks[i].length + intactChunks[i + 1].length <= 600) {
      blocks.push(`${intactChunks[i]} ${intactChunks[i + 1]}`);
    }
  }
  const rawChunks = proseHtml
    .replace(/<br\s*\/?>/gi, "</p><p>")
    .split(/<\/(?:div|section|article|p|li|dd|dt|h[1-6])>/i)
    .map(cleanText)
    .filter(t => t.length >= 2);
  for (const t of rawChunks) {
    if (t.length >= 6 && t.length <= 1200) blocks.push(t);
  }
  // Adjacent pair of non-empty short blocks (e.g., heading div + value div separated by nested </div> wrappers)
  for (let i = 0; i < rawChunks.length - 1; i++) {
    const t1 = rawChunks[i];
    const t2 = rawChunks[i + 1];
    if (t1.length + t2.length <= 500) {
      blocks.push(`${t1} ${t2}`);
    }
  }
  // Also allow 3 consecutive very short blocks (e.g., label + sublabel + title in Elementor/card layout, total <= 300 chars)
  for (let i = 0; i < rawChunks.length - 2; i++) {
    const combined = `${rawChunks[i]} ${rawChunks[i + 1]} ${rawChunks[i + 2]}`;
    if (combined.length <= 300) blocks.push(combined);
  }
  return blocks;
}

function findAllPositions(haystackLower, needle) {
  const pos = [];
  const n = needle.toLowerCase();
  let idx = 0;
  while ((idx = haystackLower.indexOf(n, idx)) !== -1) {
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

function findBestPairInBlock(text, workKws, tierKws) {
  const lower = text.toLowerCase();
  const workHits = [];
  for (const w of workKws) for (const p of findAllPositions(lower, w)) workHits.push({ kw: w, pos: p, len: w.length });
  const tierHits = [];
  for (const t of tierKws) for (const p of findAllPositions(lower, t)) tierHits.push({ kw: t, pos: p, len: t.length });
  if (workHits.length === 0 || tierHits.length === 0) return null;

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
  const start = Math.max(0, Math.min(best.w.pos, best.t.pos) - 35);
  const end = Math.min(text.length, Math.max(best.w.pos + best.w.len, best.t.pos + best.t.len) + 55);
  return {
    dist: best.dist,
    matched_work: best.w.kw,
    matched_tier: best.t.kw,
    context_snippet: text.slice(start, end),
  };
}

async function verifyOne(id, awardName, category, url, rule) {
  const rec = {
    id,
    awardName,
    category,
    url,
    http_status: null,
    status: "failed",
    match_scope: null,
    table_rows_checked: 0,
    blocks_checked: 0,
    min_distance_chars: null,
    matched_work: null,
    matched_tier: null,
    context_snippet: null,
    note: "",
  };
  try {
    let res = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(12000),
      });
      if (res.status < 500) break;
      await new Promise(r => setTimeout(r, 1200));
    }
    rec.http_status = res.status;
    const html = await res.text();
    if (res.status >= 400 || botRx.test(html.slice(0, 3000))) {
      rec.status = "uncheckable_blocked";
      rec.note = `HTTP ${res.status} / bot block`;
      return rec;
    }

    const mainHtml = extractMainHtml(html);

    // 1. Check <table> rows strictly row-by-row (<tr>)
    const trMatches = [...mainHtml.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
    rec.table_rows_checked = trMatches.length;
    let bestRowMatch = null;
    for (const m of trMatches) {
      const pair = findBestPairInBlock(cleanText(m[0]), rule.work, rule.tier);
      if (pair && (!bestRowMatch || pair.dist < bestRowMatch.dist)) bestRowMatch = pair;
    }

    // 2. Strip <table> completely, then check prose semantic blocks strictly block-by-block
    const proseHtml = mainHtml.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, " ");
    const blocks = extractSemanticBlocks(proseHtml);
    rec.blocks_checked = blocks.length;
    let bestBlockMatch = null;
    for (const b of blocks) {
      const pair = findBestPairInBlock(b, rule.work, rule.tier);
      if (pair && (!bestBlockMatch || pair.dist < bestBlockMatch.dist)) bestBlockMatch = pair;
    }

    let chosen = null;
    let scope = null;
    if (bestRowMatch && (!bestBlockMatch || bestRowMatch.dist <= bestBlockMatch.dist)) {
      chosen = bestRowMatch;
      scope = "table_row";
    } else if (bestBlockMatch) {
      chosen = bestBlockMatch;
      scope = "semantic_block";
    }

    if (!chosen) {
      rec.status = "failed_block_or_proximity";
      rec.note = `No clean match <=${MAX_PROXIMITY_CHARS} chars in same <tr> or semantic block`;
      return rec;
    }

    rec.status = "verified_block_proximity_match";
    rec.match_scope = scope;
    rec.min_distance_chars = chosen.dist;
    rec.matched_work = chosen.matched_work;
    rec.matched_tier = chosen.matched_tier;
    rec.context_snippet = chosen.context_snippet;
  } catch (e) {
    rec.status = "uncheckable_error";
    rec.note = e.message;
  }
  return rec;
}

const results = [];
for (const item of bench) {
  if (!item.awards || item.awards.length === 0) continue;
  const rSpec = RULES[item.id];
  if (!rSpec) throw new Error(`Missing verification rule for ${item.id}`);
  for (let i = 0; i < item.awards.length; i++) {
    const a = item.awards[i];
    const rule = Array.isArray(rSpec) ? rSpec[i] : rSpec;
    const r = await verifyOne(item.id, a.name, a.category, a.sourceUrl, rule);
    results.push(r);
    console.log(`${r.id.padEnd(13)} | ${String(r.http_status).padEnd(3)} | ${r.status.padEnd(30)} | ${String(r.match_scope || "-").padEnd(14)} | dist=${String(r.min_distance_chars).padEnd(4)} | ${r.matched_work || "-"} <-> ${r.matched_tier || "-"}`);
  }
}

const summary = {
  verification_version: "v4_block_isolated_150char_intervening_guard",
  max_proximity_chars: MAX_PROXIMITY_CHARS,
  total_urls: results.length,
  verified_block_proximity_match: results.filter(r => r.status === "verified_block_proximity_match").length,
  failed_block_or_proximity: results.filter(r => r.status === "failed_block_or_proximity").length,
  uncheckable_blocked: results.filter(r => r.status === "uncheckable_blocked").length,
  uncheckable_error: results.filter(r => r.status === "uncheckable_error").length,
  results,
};

fs.writeFileSync("E:/iketeru-eizou/analysis/benchmark_source_verification.json", JSON.stringify(summary, null, 2) + "\n", "utf8");
console.log("\nSUMMARY:", JSON.stringify({ ...summary, results: undefined }));
