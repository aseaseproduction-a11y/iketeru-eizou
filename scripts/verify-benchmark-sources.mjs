import fs from "node:fs";

const bench = JSON.parse(fs.readFileSync("E:/iketeru-eizou/analysis/golden_benchmark.json", "utf8"));

// Per-video expected work keywords & award keywords for mechanical body check
const KEYWORDS = {
  "FNQ4vqB-waw": { work: ["Train of Memories", "Sotetsu", "父と娘"], award: ["Film Craft", "Gold", "Cannes Lions"] },
  "5wEjV2ekSwE": { work: ["Honda", "Hands"], award: ["Silver", "Film Craft", "Cannes"] },
  "vpyeQeTDGFA": { work: ["Paper", "Honda"], award: ["Graphite Pencil", "D&AD"] },
  "Z_lbVlhO9HE": { work: ["Spreadbeats"], award: ["Black Pencil", "Digital Marketing", "D&AD"] },
  "DwIur8FBRxw": { work: ["ありがとう", "漫画愛", "ABJ"], award: ["グランプリ", "Grand Prix", "YouTube Works"] },
  "iIL_CB_YjFk": { work: ["LIGHT HOLE"], award: ["カンヌ", "Cannes", "ブロンズ", "Bronze", "shots", "Gold"] },
  "tdQCMuaJUQk": { work: ["シール交換小学生", "セコム"], award: ["グランプリ", "BOVA"] },
  "JFDm4p8T6_4": { work: ["立命館大学"], award: ["ゴールド", "BOVA"] },
  "wXD33Jx25oI": { work: ["ギャンブル", "エスケープ"], award: ["ゴールド", "BOVA"] },
  "FSqTqdjf2YQ": { work: ["アロンアルフア", "東亞合成"], award: ["シルバー", "BOVA"] },
  "iXTuYbyH2Rc": { work: ["朝は絶対", "オハヨー"], award: ["シルバー", "BOVA"] },
  "-J7Oi1-EfG8": { work: ["UMAMI BOOST", "味の素"], award: ["協賛企業賞", "BOVA"] },
  "5URefVYaJrA": { work: ["Tailor Swif", "A$AP Rocky"], award: ["Black Pencil", "D&AD"] },
  "tvTRZJ-4EyI": { work: ["HUMBLE", "Kendrick Lamar"], award: ["Video of the Year", "VMA", "MTV"] },
  "ebzEEEdjHj0": { work: ["Bonobo", "No Reason"], award: ["Best Dance Video", "Production Design", "UK Music Video"] },
  "5zj3aHgLFQE": { work: ["Poker", "トクマルシューゴ"], award: ["審査委員会推薦作品", "アニメーション部門"] },
  "3JtO1WMYb58": { work: ["Viewtiful", "Frasco"], award: ["審査委員会推薦作品", "エンターテインメント部門"] },
  "QmLBz4FuVDA": { work: ["Footloose", "INNOSENT"], award: ["審査委員会推薦作品", "エンターテインメント部門"] },
  "_2JRv0n6w4g": { work: ["BAKU", "いきものがかり"], award: ["映像作家100人"] },
  "_ESKiygZh9Y": { work: ["imase", "でもね"], award: ["映像作家100人"] },
  "Ula15c4UN4s": { work: ["A.G.I.T", "Suchmos"], award: ["映像作家100人"] },
  "1119375393": { work: ["OFFF", "XK Studio"], award: ["Permanent Collection", "STASH", "Stash"] },
  "1225708698": { work: ["STAIRS", "Riley Donigan"], award: ["Staff Pick"] },
  "_5XZMPbbJIk": { work: ["讐復を能える"], award: ["映像作家100人"] },
  "_H6zuJAtQqI": { work: ["Evangelion", "エヴァンゲリオン"], award: ["映像作家100人"] },
  "vRBVWCs1KW4": { work: ["Blinkity Blank"], award: ["Palme d'Or", "Cannes"] },
  "X0hyTmlsBUI": { work: ["Origami"], award: ["Shortlist", "Oscars", "Animated Short"] },
  "35i4zTky9pI": { work: ["Lost & Found", "Lost &amp; Found"], award: ["Shortlist", "Oscars", "Animated Short"] },
  "vohpCZh-Qcw": { work: ["Ordinary Life", "普通の生活"], award: ["Annecy", "Competition"] },
  "jvKtHf7kDYs": { work: ["世界、北半球", "ホセイン"], award: ["アジアの未来", "作品賞"] },
  "1230811867": { work: ["Coeur Cerise"], award: ["Staff Pick"] },
  "_PTHdkmCLRs": { work: ["よんぺーくん"], award: ["映像作家100人"] },
  "g9dacS4c_D8": { work: ["Builder"], award: ["映像作家100人"] },
  "UvGwIFVUK7M": { work: ["Jindal Steel", "Steel of India"], award: ["Film Craft", "Grand Prix", "Spikes Asia"] },
  "CWhNI_x9W6c": { work: ["MAZDA", "RX-7"], award: ["経済産業大臣賞", "映文連"] },
  "D_vdPkCz23g": { work: ["Palau Pledge"], award: ["Sustainable Development Goals", "Grand Prix", "Cannes"] },
  "1S-KU2F7wc0": { work: ["南阿蘇", "みなみあそ"], award: ["グランプリ", "観光映像祭"] },
  "8pOOxOo7YYo": { work: ["サロベツ", "利尻"], award: ["グランプリ", "観光映像祭"] },
  "uCDUpZV3f8A": { work: ["Brushing Up", "Erika Konno"], award: ["Fabulous Four", "ADFEST"] },
  "9NzQ3G6rY5M": { work: ["和水町", "なごみを"], award: ["優秀賞", "観光映像祭"] },
  "p4eAR2Gw5RU": { work: ["旧奈良監獄", "赤レンガ"], award: ["優秀賞", "観光映像祭"] },
  "V6XHz7tqGVM": { work: ["Beautiful Lie", "Muranaka"], award: ["Fabulous Four", "ADFEST"] },
  "9waEFmHUNdk": { work: ["BUNGO-ONO", "豊後大野"], award: ["観客賞", "観光映像祭"] },
};

// Extra checks (none needed for final benchmark verification)
const EXTRA_CHECKS = [];

const botRx = /Just a moment|cf-browser-verification|Attention Required! \| Cloudflare|Access Denied|Are you a robot|Verify you are human|Checking your browser/i;

async function checkOne(id, awardName, url, workKws, awardKws) {
  const rec = { id, awardName, url, http_status: null, status: "unverified", work_matched: [], award_matched: [], note: "" };
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
    const text = await res.text();
    if (res.status >= 400 || botRx.test(text.slice(0, 3000))) {
      rec.status = "uncheckable_blocked";
      rec.note = `HTTP ${res.status} / bot or access block`;
      return rec;
    }
    const lower = text.toLowerCase();
    rec.work_matched = workKws.filter(k => lower.includes(k.toLowerCase()));
    rec.award_matched = awardKws.filter(k => lower.includes(k.toLowerCase()));
    if (rec.work_matched.length > 0 && rec.award_matched.length > 0) {
      rec.status = "verified_text_match";
    } else if (rec.work_matched.length > 0 || rec.award_matched.length > 0) {
      rec.status = "partial_match";
      rec.note = `work=${rec.work_matched.length}, award=${rec.award_matched.length}`;
    } else {
      rec.status = "no_match";
      rec.note = "Neither work nor award keyword found in HTML text";
    }
  } catch (e) {
    rec.status = "uncheckable_error";
    rec.note = e.message;
  }
  return rec;
}

const tasks = [];
for (const item of bench) {
  if (!item.awards || item.awards.length === 0) continue;
  const kw = KEYWORDS[item.id] || { work: [item.title.slice(0, 10)], award: [item.awards[0].name] };
  for (const a of item.awards) {
    tasks.push({ id: item.id, awardName: a.name, url: a.sourceUrl, work: kw.work, award: kw.award });
  }
}
for (const ex of EXTRA_CHECKS) {
  tasks.push({ id: ex.id, awardName: "Stash Candidate", url: ex.url, work: ex.work, award: ex.award });
}

const results = [];
for (const t of tasks) {
  const r = await checkOne(t.id, t.awardName, t.url, t.work, t.award);
  results.push(r);
  console.log(`${r.id.padEnd(20)} | ${String(r.http_status).padEnd(3)} | ${r.status.padEnd(20)} | work:[${r.work_matched.join(",")}] | award:[${r.award_matched.join(",")}]`);
}

const summary = {
  total_urls: results.length,
  verified_text_match: results.filter(r => r.status === "verified_text_match").length,
  partial_match: results.filter(r => r.status === "partial_match").length,
  no_match: results.filter(r => r.status === "no_match").length,
  uncheckable_blocked: results.filter(r => r.status === "uncheckable_blocked").length,
  uncheckable_error: results.filter(r => r.status === "uncheckable_error").length,
  results,
};

fs.writeFileSync("E:/iketeru-eizou/analysis/benchmark_source_verification.json", JSON.stringify(summary, null, 2) + "\n", "utf8");
console.log("\nSUMMARY:", JSON.stringify({ ...summary, results: undefined }));
