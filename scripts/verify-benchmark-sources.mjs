import fs from "node:fs";

const bench = JSON.parse(fs.readFileSync("E:/iketeru-eizou/analysis/golden_benchmark.json", "utf8"));

// Strict v2 verification rules:
// 1. Strip header, nav, footer, aside, script, style, svg before matching
// 2. FORBID site-name keywords as award proof — MUST match specific award tier/prize/selection words
// 3. Require proximity: work keyword AND specific tier keyword within MAX_PROXIMITY_CHARS in main body text
const MAX_PROXIMITY_CHARS = 500;

const FORBIDDEN_SITE_NAME_TOKENS = new Set([
  "映像作家100人", "観光映像祭", "日本国際観光映像祭", "BOVA", "Cannes", "Cannes Lions",
  "D&AD", "ADFEST", "YouTube Works", "映文連", "Vimeo", "UKMVA", "Oscars", "Annecy", "SXSW", "JWTFF"
]);

const RULES = {
  "FNQ4vqB-waw": { work: ["Train of Memories", "Sotetsu"], tier: ["Gold", "Film Craft"] },
  "5wEjV2ekSwE": { work: ["Hands", "Honda"], tier: ["Silver", "Film Craft"] },
  "vpyeQeTDGFA": { work: ["Paper", "Honda"], tier: ["Graphite Pencil"] },
  "Z_lbVlhO9HE": { work: ["Spreadbeats"], tier: ["Black Pencil", "Digital Marketing"] },
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
  "153159513":   { work: ["Deep Down Low", "Valentino Khan"], tier: ["best dance video"] },
  "5zj3aHgLFQE": { work: ["Poker", "トクマルシューゴ"], tier: ["審査委員会推薦作品", "アニメーション部門"] },
  "3JtO1WMYb58": { work: ["Viewtiful", "Frasco"], tier: ["審査委員会推薦作品"] },
  "QmLBz4FuVDA": { work: ["Footloose", "INNOSENT"], tier: ["審査委員会推薦作品"] },
  "313084145":   { work: ["A Pearl", "Mitski"], tier: ["Special Jury Recognition"] },
  "49367868":    { work: ["地下鉄の動態", "ハイスイノナサ"], tier: ["新人賞"] },
  "246660563":   { work: ["橋本 麦", "HASHIMOTO Baku", "Fly"], tier: ["観客賞", "Audience Award"] },
  "134832670":   { work: ["Cyclone", "HIRAOKA"], tier: ["Jury Selection", "Animation Division"] },
  "vRBVWCs1KW4": { work: ["Blinkity Blank"], tier: ["Palme d'Or"] },
  "X0hyTmlsBUI": { work: ["Origami", "金森慧"], tier: ["ショートリスト", "Shortlist"] },
  "35i4zTky9pI": { work: ["Lost & Found"], tier: ["Shortlist", "Animated Short"] },
  "vohpCZh-Qcw": { work: ["Ordinary Life"], tier: ["Competition", "Official Selection"] },
  "jvKtHf7kDYs": { work: ["世界、北半球", "ホセイン"], tier: ["作品賞", "アジアの未来"] },
  "UvGwIFVUK7M": { work: ["Jindal Steel", "Steel of India"], tier: ["Grand Prix", "Film Craft"] },
  "CWhNI_x9W6c": { work: ["RX-7", "MAZDA"], tier: ["経済産業大臣賞"] },
  "D_vdPkCz23g": { work: ["Palau Legacy Project", "Palau Pledge"], tier: ["Grand Prix", "Sustainable Development Goals"] },
  "1S-KU2F7wc0": { work: ["南阿蘇", "みなみあそ"], tier: ["グランプリ", "最優秀賞"] },
  "8pOOxOo7YYo": { work: ["サロベツ", "利尻"], tier: ["グランプリ"] },
  "uCDUpZV3f8A": { work: ["Brushing Up", "Erika Konno"], tier: ["Fabulous Four", "Commendation"] },
  "9NzQ3G6rY5M": { work: ["和水町", "なごみを"], tier: ["優秀賞"] },
  "p4eAR2Gw5RU": { work: ["旧奈良監獄", "赤レンガ"], tier: ["入選"] },
  "V6XHz7tqGVM": { work: ["Beautiful Lie", "Muranaka"], tier: ["Fabulous Four"] },
  "9waEFmHUNdk": { work: ["BUNGO-ONO", "豊後大野"], tier: ["観客賞"] },
};

// Guard: ensure no rule uses a forbidden site-name token
for (const [id, ruleOrArr] of Object.entries(RULES)) {
  const arr = Array.isArray(ruleOrArr) ? ruleOrArr : [ruleOrArr];
  for (const r of arr) {
    for (const tk of r.tier) {
      if (FORBIDDEN_SITE_NAME_TOKENS.has(tk)) {
        throw new Error(`Forbidden site-name token '${tk}' used in tier rule for ${id}`);
      }
    }
  }
}

const botRx = /Just a moment|cf-browser-verification|Attention Required! \| Cloudflare|Access Denied|Are you a robot|Verify you are human|Checking your browser/i;

function extractMainBody(html) {
  let s = html
    .replace(/<!--[\s\S]{0,400}?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  // Prefer <main> first (excludes site-level header/footer/sidebar while keeping HTML5 card <header> inside <main>)
  const mainMatch = s.match(/<main[\s\S]*?<\/main>/i);
  if (mainMatch && mainMatch[0].replace(/<[^>]+>/g, "").trim().length > 200) {
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
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8217;|&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

async function verifyOne(id, awardName, category, url, rule) {
  const rec = {
    id,
    awardName,
    category,
    url,
    http_status: null,
    status: "failed",
    min_distance_chars: null,
    matched_work: null,
    matched_tier: null,
    context_snippet: null,
    note: "",
  };
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
    rec.http_status = res.status;
    const html = await res.text();
    if (res.status >= 400 || botRx.test(html.slice(0, 3000))) {
      rec.status = "uncheckable_blocked";
      rec.note = `HTTP ${res.status} / bot block`;
      return rec;
    }
    const body = extractMainBody(html);
    const lower = body.toLowerCase();

    const workHits = [];
    for (const w of rule.work) {
      for (const p of findAllPositions(lower, w)) workHits.push({ kw: w, pos: p });
    }
    const tierHits = [];
    for (const t of rule.tier) {
      for (const p of findAllPositions(lower, t)) tierHits.push({ kw: t, pos: p });
    }

    if (workHits.length === 0 || tierHits.length === 0) {
      rec.status = "missing_keyword_in_body";
      rec.note = `workHits=${workHits.length}, tierHits=${tierHits.length}`;
      return rec;
    }

    let best = { dist: Infinity, w: null, t: null };
    for (const wh of workHits) {
      for (const th of tierHits) {
        const d = Math.abs(wh.pos - th.pos);
        if (d < best.dist) best = { dist: d, w: wh, t: th };
      }
    }
    rec.min_distance_chars = best.dist;
    rec.matched_work = best.w.kw;
    rec.matched_tier = best.t.kw;
    const start = Math.max(0, Math.min(best.w.pos, best.t.pos) - 40);
    const end = Math.min(body.length, Math.max(best.w.pos, best.t.pos) + 80);
    rec.context_snippet = body.slice(start, end);

    if (best.dist <= MAX_PROXIMITY_CHARS) {
      rec.status = "verified_proximity_match";
    } else {
      rec.status = "too_far_apart";
      rec.note = `min_distance_chars=${best.dist} > ${MAX_PROXIMITY_CHARS}`;
    }
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
    console.log(`${r.id.padEnd(13)} | ${String(r.http_status).padEnd(3)} | ${r.status.padEnd(24)} | dist=${String(r.min_distance_chars).padEnd(4)} | ${r.matched_work || "-"} <-> ${r.matched_tier || "-"}`);
  }
}

const summary = {
  verification_version: "v2_strict_body_proximity",
  max_proximity_chars: MAX_PROXIMITY_CHARS,
  total_urls: results.length,
  verified_proximity_match: results.filter(r => r.status === "verified_proximity_match").length,
  too_far_apart: results.filter(r => r.status === "too_far_apart").length,
  missing_keyword_in_body: results.filter(r => r.status === "missing_keyword_in_body").length,
  uncheckable_blocked: results.filter(r => r.status === "uncheckable_blocked").length,
  uncheckable_error: results.filter(r => r.status === "uncheckable_error").length,
  results,
};

fs.writeFileSync("E:/iketeru-eizou/analysis/benchmark_source_verification.json", JSON.stringify(summary, null, 2) + "\n", "utf8");
console.log("\nSUMMARY:", JSON.stringify({ ...summary, results: undefined }));
