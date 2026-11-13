/**
 * Scene search engine (Client-side, Zero-cost, Twelve Labs-style)
 * Supports natural language query, synonym expansion, and multi-factor scoring.
 */

import type { Video } from "./types";
import fallbackScenes from "./scenes_index.json";

export interface SceneItem {
  id: string;
  videoId: string;
  videoTitle: string;
  platform: string;
  sceneNumber: number;
  startSeconds: number;
  endSeconds: number;
  timeRange: string;
  visual: string;
  audio: string;
  keywords: string[];
  thumbnailUrl: string;
}

export interface SceneSearchResult {
  scene: SceneItem;
  score: number;
  matchedTerms: string[];
}

let cachedScenes: SceneItem[] | null = (fallbackScenes as unknown as SceneItem[]) || null;
let isLoading = false;

function parseTimeToSeconds(tStr: string): number {
  const parts = tStr.trim().split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function formatSecondsToMMSS(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

const STOP_WORDS = new Set([
  "視覚", "聴覚", "制約", "事実", "演出上", "意図", "確認上", "観察", "記録", "範囲",
  "年前", "下部", "上部", "左部", "右部", "中央", "左右", "上下", "前後", "周囲", "背後",
  "画面", "映像", "動画", "場面", "シーン", "パート", "セクション", "カット", "ショット",
  "カメラ", "フレーム", "レンズ", "アングル", "サイズ", "状態", "様子", "瞬間", "動き",
  "変化", "効果", "印象", "構成", "展開", "導入", "突入", "開始", "終了", "直後", "直前",
  "全体", "一部", "複数", "連続", "同時", "交互", "再提示", "再利用", "象徴的", "特徴的",
  "効果的", "圧倒的", "徹底的", "規則的", "直線的", "立体的", "視覚的", "聴覚的", "構造的",
  "空間", "時間", "速度", "方向", "位置", "配置", "登場", "出現", "表示", "強調", "表現",
  "撮影", "編集", "演出", "処理", "設定", "使用", "活用", "採用", "維持", "形成", "移行",
  "転換", "接続", "連動", "同期", "対比", "詳細", "明確", "鮮明", "完全", "最後", "最初",
  "冒頭", "中盤", "終盤", "後半", "前半", "背景", "前景", "手前", "奥側", "内側", "外側",
  "アスペクト比", "画面比率", "シネマスコープ", "推測", "概要欄", "記載", "スタート"
]);

function cleanVisualText(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/^(\*\*?)?視覚(\*\*?)?[:：]\s*/i, "")
    .replace(/[／/]\s*(\*\*?)?(聴覚|音声|サウンド|BGM|SE|演出上の制約|確認上の制約|制約・事実|制約|意図|演出意図)[\s\S]*$/i, "")
    .replace(/\*\*/g, "")
    .replace(/^画面(アスペクト)?比率?は[^。]+。\s*/, "")
    .trim();
}

function cleanAudioText(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/^(\*\*?)?(聴覚|音声|サウンド)(\*\*?)?[:：]\s*/i, "")
    .replace(/[／/]\s*(\*\*?)?(演出上の制約|確認上の制約|制約・事実|制約|意図|演出意図)[\s\S]*$/i, "")
    .replace(/\*\*/g, "")
    .trim();
}

function splitIntoShotDescriptions(visualText: string, durationSec: number): string[] {
  if (!visualText) return [""];

  const rawParts: string[] = [];
  let current = "";
  let parenDepth = 0;
  for (let i = 0; i < visualText.length; i++) {
    const ch = visualText[i];
    if (ch === "（" || ch === "(" || ch === "「" || ch === "『") parenDepth++;
    else if (ch === "）" || ch === ")" || ch === "」" || ch === "』") parenDepth = Math.max(0, parenDepth - 1);

    current += ch;
    if (ch === "。" && parenDepth === 0) {
      if (current.trim()) rawParts.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) rawParts.push(current.trim());
  if (rawParts.length === 0) return [visualText];

  const merged: string[] = [];
  for (let i = 0; i < rawParts.length; i++) {
    const part = rawParts[i];
    const isPrefixHeader = /^(画面(アスペクト)?比率|アスペクト比|イントロ|アウトロ|Aメロ|Bメロ|Cメロ|サビ|間奏|ラスサビ|続いて|さらに|また)/.test(part) && part.length <= 26;
    const isTechSupplement = /^(ARRI|RED|Sony|Midjourney|Unreal Engine|Houdini|Blender|After Effects|DaVinci|Cinema 4D|空気遠近法|被写界深度|これにより|この演出|結果として|光のブルーム|ポリゴン表面)/i.test(part) || /(が素晴らしい|が美しい|が秀逸|を再現|を実現|ロールオフ|ラティチュード)。?$/.test(part);

    if (isPrefixHeader && i < rawParts.length - 1) {
      rawParts[i + 1] = part + " " + rawParts[i + 1];
    } else if ((part.length <= 16 || isTechSupplement) && merged.length > 0 && (merged[merged.length - 1].length + part.length <= 110)) {
      merged[merged.length - 1] = merged[merged.length - 1] + " " + part;
    } else if (part.length <= 18 && i < rawParts.length - 1) {
      rawParts[i + 1] = part + " " + rawParts[i + 1];
    } else {
      merged.push(part);
    }
  }

  const finalShots: string[] = [];
  const estSecPerShot = durationSec / Math.max(1, merged.length);
  for (const shot of merged) {
    if (estSecPerShot > 9 && shot.length >= 42) {
      const clauses: string[] = [];
      let cur = "";
      let pDepth = 0;
      for (let i = 0; i < shot.length; i++) {
        const c = shot[i];
        if (c === "（" || c === "(" || c === "「" || c === "『") pDepth++;
        else if (c === "）" || c === ")" || c === "」" || c === "』") pDepth = Math.max(0, pDepth - 1);
        cur += c;
        if (c === "、" && pDepth === 0 && cur.length >= 20 && shot.length - i > 20) {
          clauses.push(cur.trim());
          cur = "";
        }
      }
      if (cur.trim()) {
        if (clauses.length > 0 && cur.trim().length < 16) {
          clauses[clauses.length - 1] += cur.trim();
        } else {
          clauses.push(cur.trim());
        }
      }
      finalShots.push(...clauses);
    } else {
      finalShots.push(shot);
    }
  }

  return finalShots.length > 0 ? finalShots : [visualText];
}

function extractShotKeywords(visual: string, audio: string): string[] {
  const combined = `${visual} ${audio}`;
  const matched = new Set<string>();

  const kwRegex = /#([\w\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fffー]+)/g;
  let km: RegExpExecArray | null;
  while ((km = kwRegex.exec(combined)) !== null) {
    const val = km[1].trim();
    if (val.length >= 2 && !STOP_WORDS.has(val)) matched.add(val);
  }

  const kataRegex = /[ァ-ヶー]{3,14}/g;
  let ktm: RegExpExecArray | null;
  while ((ktm = kataRegex.exec(visual)) !== null) {
    const val = ktm[0].replace(/^[・ー]+|[・]+$/g, "");
    if (val.length >= 3 && !STOP_WORDS.has(val)) matched.add(val);
  }

  for (const cat of CATEGORY_DEFINITIONS) {
    for (const seed of cat.seedWords) {
      if (combined.toLowerCase().includes(seed.toLowerCase())) {
        matched.add(seed);
      }
    }
  }

  return Array.from(matched).slice(0, 14);
}

const MAX_MICRO_SHOT_DURATION = 10; // Maximum 10 seconds per trimmed micro-scene

/**
 * Automatically extracts structured micro-scenes (1s to 10s) from aiAnalysis.
 * Supports multi-line nested format, single-line bullet format, markdown tables, and inline timestamps.
 */
export function extractScenesFromAiAnalysis(videoId: string, videoTitle: string, platform: string, aiAnalysis?: string): SceneItem[] {
  if (!aiAnalysis) return [];

  const rawBlocks: { startSeconds: number; endSeconds: number; visual: string; audio: string }[] = [];

  // Pattern A: Multi-line nested format
  const multiLineRegex = /-\s*\*?\*?(?:#?C?\d+\s*)?【(\d{1,2}:\d{2}(?::\d{2})?)[–~〜\-](\d{1,2}:\d{2}(?::\d{2})?)】[^\n]*\n((?:[ \t]+-\s*[^\n]+\n?)+)/g;
  let mm: RegExpExecArray | null;
  while ((mm = multiLineRegex.exec(aiAnalysis)) !== null) {
    const startStr = mm[1];
    const endStr = mm[2];
    const subLines = mm[3];
    const visMatch = subLines.match(/-\s*\*?\*?(?:視覚|映像|Visual)\*?\*?[:：]\s*([^\n]+)/i);
    const audMatch = subLines.match(/-\s*\*?\*?(?:聴覚|音声|サウンド|Audio)\*?\*?[:：]\s*([^\n]+)/i);
    if (visMatch) {
      rawBlocks.push({
        startSeconds: parseTimeToSeconds(startStr),
        endSeconds: parseTimeToSeconds(endStr),
        visual: visMatch[1].trim(),
        audio: audMatch ? audMatch[1].trim() : "",
      });
    }
  }

  // Pattern B: Single-line bullet format
  if (rawBlocks.length === 0) {
    const singleLineRegex = /-\s*(?:\*?\*?#?C?(\d+)\*?\*?\s*)?【(\d{1,2}:\d{2}(?::\d{2})?)[–~〜\-](\d{1,2}:\d{2}(?::\d{2})?)】\*?\*?[：:\s]*([^\n]+)/g;
    let sm: RegExpExecArray | null;
    while ((sm = singleLineRegex.exec(aiAnalysis)) !== null) {
      const startStr = sm[2];
      const endStr = sm[3];
      const body = sm[4].trim();
      if (!body) continue;

      let visual = "";
      let audio = "";
      const visMatch = body.match(/\*\*視覚\*\*[:：]\s*([^*／/]+)/);
      if (visMatch) visual = visMatch[1].trim();
      else visual = body.split(/[／/]/)[0].replace(/\*\*/g, "").trim();

      const audMatch = body.match(/\*\*(?:聴覚|音声)\*\*[:：]\s*([^*／/]+)/);
      if (audMatch) audio = audMatch[1].trim();

      rawBlocks.push({
        startSeconds: parseTimeToSeconds(startStr),
        endSeconds: parseTimeToSeconds(endStr),
        visual,
        audio,
      });
    }
  }

  // Pattern C: Markdown table format
  if (rawBlocks.length === 0) {
    const tableRegex = /\|\s*[^|]*?\s*\|\s*【?(\d{1,2}:\d{2}(?::\d{2})?)[–~〜\-](\d{1,2}:\d{2}(?::\d{2})?)】?\s*\|\s*([^|]+)\|\s*([^|]*)\|/g;
    let tm: RegExpExecArray | null;
    while ((tm = tableRegex.exec(aiAnalysis)) !== null) {
      const visual = tm[3].trim();
      if (visual && !visual.includes("---")) {
        rawBlocks.push({
          startSeconds: parseTimeToSeconds(tm[1]),
          endSeconds: parseTimeToSeconds(tm[2]),
          visual,
          audio: tm[4].trim(),
        });
      }
    }
  }

  const scenes: SceneItem[] = [];
  let sceneNum = 0;
  const thumbnailUrl = platform === "youtube" ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : "";

  for (const block of rawBlocks) {
    const cleanVis = cleanVisualText(block.visual);
    const cleanAud = cleanAudioText(block.audio);
    if (!cleanVis || cleanVis.length < 4) continue;

    let start = block.startSeconds;
    let end = block.endSeconds;
    if (end <= start) end = start + 3;

    let rawDur = end - start;
    const shots = splitIntoShotDescriptions(cleanVis, rawDur);

    if (rawDur > 60) {
      rawDur = Math.min(rawDur, Math.max(shots.length * 7, 16));
      end = start + rawDur;
    }

    const totalChars = shots.reduce((sum, s) => sum + Math.max(s.length, 10), 0);
    let cursor = start;

    for (let i = 0; i < shots.length; i++) {
      const shotText = shots[i].trim();
      if (!shotText) continue;

      const weight = Math.max(shotText.length, 10) / totalChars;
      let allocated = Math.round(rawDur * weight);
      if (allocated < 1) allocated = 1;

      const shotStart = cursor;
      let shotEnd = i === shots.length - 1 ? end : shotStart + allocated;
      if (shotEnd <= shotStart) shotEnd = shotStart + 1;

      if (shotEnd - shotStart > MAX_MICRO_SHOT_DURATION) {
        shotEnd = shotStart + MAX_MICRO_SHOT_DURATION;
      }

      cursor = cursor + allocated;
      if (cursor >= end && i < shots.length - 1) {
        cursor = Math.max(shotStart + 1, end - (shots.length - 1 - i));
      }

      sceneNum++;
      const timeRange = `${formatSecondsToMMSS(shotStart)} - ${formatSecondsToMMSS(shotEnd)}`;
      const keywords = extractShotKeywords(shotText, cleanAud);

      scenes.push({
        id: `${videoId}_s${String(sceneNum).padStart(2, "0")}`,
        videoId,
        videoTitle,
        platform,
        sceneNumber: sceneNum,
        startSeconds: shotStart,
        endSeconds: shotEnd,
        timeRange,
        visual: shotText,
        audio: cleanAud,
        keywords,
        thumbnailUrl,
      });
    }
  }

  return scenes;
}

export async function loadSceneIndex(liveVideos?: Video[]): Promise<SceneItem[]> {
  let scenes: SceneItem[] = [];

  if (cachedScenes && cachedScenes.length > 0) {
    scenes = [...cachedScenes];
  } else if (!isLoading) {
    isLoading = true;
    try {
      const res = await fetch("/scenes_index.json");
      if (res.ok) {
        const text = await res.text();
        if (text.startsWith("[") || text.startsWith("{")) {
          scenes = JSON.parse(text);
        }
      }
    } catch (err) {
      console.warn("[SceneSearch] Failed to fetch /scenes_index.json, using bundled fallback:", err);
    } finally {
      isLoading = false;
    }
  }

  // If fetch failed or returned non-JSON, fallback to bundled scenes
  if (!scenes || scenes.length === 0) {
    scenes = (fallbackScenes as unknown as SceneItem[]) || [];
  }

  // Merge dynamic scenes from newly analyzed videos that are not yet in static scenes_index.json
  // ONLY include videos rated A- or higher (A-, A, A+, S-, S, S+) per user directive
  const HIGH_RATINGS = new Set(["A-", "A", "A+", "S-", "S", "S+"]);
  if (liveVideos && liveVideos.length > 0) {
    const existingVideoIds = new Set(scenes.map((s) => s.videoId));
    for (const v of liveVideos) {
      const rating = (v.aiOverallRating || v.privateRating || "").trim().toUpperCase();
      if (!existingVideoIds.has(v.id) && v.aiAnalysis && HIGH_RATINGS.has(rating)) {
        const dynamicScenes = extractScenesFromAiAnalysis(v.id, v.title, v.platform, v.aiAnalysis);
        if (dynamicScenes.length > 0) {
          scenes.push(...dynamicScenes);
          existingVideoIds.add(v.id);
        }
      }
    }
  }

  cachedScenes = scenes;
  return scenes;
}

// Common Japanese synonym mapping for video concepts
const SYNONYM_MAP: Record<string, string[]> = {
  "夕日": ["夕日", "夕陽", "夕焼け", "日没", "マジックアワー", "黄昏", "サンセット", "sunset", "オレンジ", "茜色"],
  "夕陽": ["夕日", "夕陽", "夕焼け", "日没", "マジックアワー", "黄昏", "サンセット", "sunset", "オレンジ"],
  "海": ["海", "海岸", "砂浜", "ビーチ", "波", "水着", "ocean", "beach", "sea", "水面", "波打ち際"],
  "雨": ["雨", "豪雨", "雨滴", "水滴", "傘", "レイン", "rain", "雨降り", "土砂降り", "台風"],
  "夜": ["夜", "夜景", "深夜", "暗闇", "ネオン", "ナイト", "night", "照明", "街灯"],
  "車": ["車", "自動車", "スポーツカー", "ドライブ", "カースタント", "走行", "car", "ヘッドライト"],
  "走る": ["走る", "疾走", "ランニング", "ダッシュ", "逃げる", "駆け抜ける", "スピード"],
  "踊る": ["踊る", "ダンス", "ステップ", "振付", "コレオ", "dance", "ダンサー", "群舞"],
  "光": ["光", "発光", "ストロボ", "閃光", "レンズフレア", "グロー", "逆光", "ライト", "light"],
  "街": ["街", "都市", "ビル", "東京", "ストリート", "路地裏", "交差点", "city", "street"],
  "煙": ["煙", "スモーク", "フォグ", "湯気", "爆発", "火花", "smoke", "fog"],
  "花": ["花", "桜", "花びら", "植物", "自然", "flower"],
  "空": ["空", "青空", "雲", "星空", "宇宙", "sky", "クラウド"],
  "美しい": ["美しい", "エモーショナル", "綺麗", "幻想的", "シネマティック", "絶景", "美麗"],
  "狂気": ["狂気", "ホラー", "不気味", "恐怖", "怪作", "カルト", "暴走"],
  "笑い": ["笑い", "笑顔", "コミカル", "ユーモア", "爆笑", "微笑み", "スマイル"],
};

/**
 * Split query string into individual words/tokens
 */
export function parseQueryWords(query: string): string[] {
  if (!query) return [];
  return query
    .trim()
    .split(/[\s,、。!！?？#+＋]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

/**
 * Expand a single word with its known synonyms
 */
export function getSynonymsForWord(word: string): string[] {
  const normalized = word.trim().toLowerCase();
  const set = new Set<string>([normalized]);
  for (const [key, syns] of Object.entries(SYNONYM_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      syns.forEach((s) => set.add(s.toLowerCase()));
    }
  }
  return Array.from(set);
}

/**
 * Search scenes by natural language query.
 * Multi-word queries (e.g. "ダンス 夜") perform AND search:
 * every word group must match the scene.
 */
export async function searchScenes(
  query: string,
  limit: number = 80,
  customScenes?: SceneItem[]
): Promise<SceneSearchResult[]> {
  const scenes = customScenes && customScenes.length > 0 ? customScenes : await loadSceneIndex();
  const words = parseQueryWords(query);

  if (words.length === 0) {
    // Return sample scenes
    return scenes.slice(0, limit).map((scene) => ({
      scene,
      score: 1.0,
      matchedTerms: [],
    }));
  }

  // Build synonym groups for each user word: each word must match at least one synonym
  const wordTokenGroups = words.map((w) => getSynonymsForWord(w));

  const results: SceneSearchResult[] = [];

  for (const scene of scenes) {
    const visualLower = scene.visual.toLowerCase();
    const audioLower = scene.audio.toLowerCase();
    const titleLower = scene.videoTitle.toLowerCase();
    const keywordsLower = scene.keywords.map((k) => k.toLowerCase());

    let allWordsMatched = true;
    let totalScore = 0;
    const matchedTerms: string[] = [];

    for (const group of wordTokenGroups) {
      let wordMatched = false;
      let wordScore = 0;

      for (const token of group) {
        let tokenHit = false;

        // Exact in visual description (highest weight)
        if (visualLower.includes(token)) {
          wordScore = Math.max(wordScore, 15);
          tokenHit = true;
        }

        // In scene keywords
        if (keywordsLower.some((k) => k.includes(token) || token.includes(k))) {
          wordScore = Math.max(wordScore, 10);
          tokenHit = true;
        }

        // In audio description
        if (audioLower.includes(token)) {
          wordScore = Math.max(wordScore, 8);
          tokenHit = true;
        }

        // In video title
        if (titleLower.includes(token)) {
          wordScore = Math.max(wordScore, 5);
          tokenHit = true;
        }

        if (tokenHit) {
          wordMatched = true;
          matchedTerms.push(token);
        }
      }

      if (!wordMatched) {
        allWordsMatched = false;
        break; // AND condition failed
      }

      totalScore += wordScore;
    }

    if (allWordsMatched && totalScore > 0) {
      results.push({
        scene,
        score: totalScore,
        matchedTerms: Array.from(new Set(matchedTerms)),
      });
    }
  }

  // Sort descending by score
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
}

export interface KeywordCategory {
  id: string;
  name: string;
  icon: string;
  keywords: { text: string; count: number }[];
}

const CATEGORY_DEFINITIONS = [
  {
    id: "situation",
    name: "シチュエーション",
    icon: "📍",
    seedWords: [
      "空", "青空", "夜", "夜景", "街", "都会", "ストリート", "路地裏", "部屋", "室内",
      "海", "海岸", "砂浜", "水面", "雨", "水滴", "雲", "星空", "宇宙", "自然",
      "森", "夕日", "夕暮れ", "スタジアム", "屋上", "トンネル", "駅", "電車", "階段"
    ]
  },
  {
    id: "visual",
    name: "演出・カメラ・VFX",
    icon: "🎥",
    seedWords: [
      "光", "逆光", "ストロボ", "フラッシュ", "アニメーション", "手描き", "ドローイング",
      "文字", "タイポグラフィ", "モーショングラフィックス", "グリッチ", "ノイズ", "色収差",
      "3DCG", "セルルック", "シルエット", "被写界深度", "ピント", "スローモーション",
      "俯瞰", "ドローン", "万華鏡", "画面分割", "スプリットスクリーン", "コラージュ", "アイソメトリック", "実写"
    ]
  },
  {
    id: "action",
    name: "アクション・被写体",
    icon: "⚡",
    seedWords: [
      "ダンス", "群舞", "ステップ", "車", "クラシックカー", "ドライブ", "走行", "走る", "疾走",
      "女性", "少女", "男性", "目", "瞳", "指先", "炎", "火花", "花火", "煙", "スモーク",
      "花", "桜", "植物", "紙吹雪", "風船", "昆虫", "バグ", "自転車"
    ]
  },
  {
    id: "mood",
    name: "ムード・世界観",
    icon: "🎨",
    seedWords: [
      "ポップ", "パステル", "可愛い", "静寂", "ミニマル", "エモーショナル", "祝祭", "多幸感",
      "レトロ", "シネマティック", "ダーク", "狂気", "不気味", "サイバーパンク", "幻想的", "ノスタルジー"
    ]
  },
  {
    id: "music",
    name: "音楽・サウンド",
    icon: "🎵",
    seedWords: [
      "ビート", "キック", "ギター", "ピアノ", "アコースティック", "ラップ", "初音ミク",
      "合唱", "ウィスパーボイス", "フューチャーベース", "ベースミュージック", "ボカロ", "VTuber"
    ]
  }
];

/**
 * Dynamically computes keyword categories from provided scenes.
 * - If scenes is a filtered subset (e.g. results of "ダンス"), computes co-occurring keywords.
 * - Excludes words in selectedWords so the user sees "what to refine next".
 * - Filters strictly to keywords having AT LEAST 2 matching scenes.
 */
export function getSceneKeywordCategories(
  scenes: SceneItem[],
  selectedWords: string[] = []
): KeywordCategory[] {
  if (!scenes || scenes.length === 0) return [];

  const normalizedSelected = new Set(
    selectedWords.map((w) => w.trim().toLowerCase()).filter(Boolean)
  );

  // Pre-index scene search texts for fast hit counting
  const sceneTexts = scenes.map((s) => {
    return (s.visual + " " + s.keywords.join(" ") + " " + s.videoTitle + " " + s.audio).toLowerCase();
  });

  return CATEGORY_DEFINITIONS.map((cat) => {
    const validKeywords: { text: string; count: number }[] = [];

    for (const word of cat.seedWords) {
      const lower = word.toLowerCase();
      // Skip words already selected
      if (normalizedSelected.has(lower)) continue;

      let matchCount = 0;
      for (let i = 0; i < sceneTexts.length; i++) {
        if (sceneTexts[i].includes(lower)) {
          matchCount++;
        }
      }

      // STRICT USER DIRECTIVE: At least 2 scenes must match! Never show 1 hit or 0 hit keywords!
      if (matchCount >= 2) {
        validKeywords.push({ text: word, count: matchCount });
      }
    }

    // Sort descending by hit count
    validKeywords.sort((a, b) => b.count - a.count);

    return {
      id: cat.id,
      name: cat.name,
      icon: cat.icon,
      keywords: validKeywords,
    };
  });
}

