/**
 * Scene search engine (Client-side, Zero-cost, Twelve Labs-style)
 * Supports natural language query, synonym expansion, and multi-factor scoring.
 */

import type { Video } from "./types";
import fallbackScenes from "./scenes_index.json";
import {
  getSynonymsForWord,
  matchesSceneScoreFilter,
  parseQueryWords,
  SCENE_CATEGORY_DEFINITIONS,
  SCENE_STOP_WORDS,
  type KeywordCategory,
  type SceneScoreFilter,
} from "@shared/sceneSearchMeta";
import {
  isV3AnalysisVersion,
  normalizeAnalysisVersion,
  type AnalysisVersion,
} from "@shared/analysisVersion";

export { getSynonymsForWord, parseQueryWords, type KeywordCategory, type SceneScoreFilter };

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
  analysisObservationScope?: string | null;
  analysisVersion?: AnalysisVersion;
  analysisGeneratedAt?: string | null;
  calibratedScore?: number | null;
  calibratedRank?: string | null;
  aiOverallScore?: number | null;
  aiOverallRating?: string | null;
}

export interface SceneSearchResult {
  scene: SceneItem;
  score: number;
  matchedTerms: string[];
}

export function filterFallbackScenes(
  scenes: SceneItem[],
  options: {
    videosById?: Map<string, Video>;
    excludeUnwatched?: boolean;
    excludeLegacyAnalysis?: boolean;
    scoreFilter?: SceneScoreFilter;
  },
): SceneItem[] {
  const excludeUnwatched = options.excludeUnwatched ?? true;
  const excludeLegacyAnalysis = options.excludeLegacyAnalysis ?? false;
  const scoreFilter = options.scoreFilter ?? "all";
  const videosById = options.videosById;

  return scenes
    .map((scene) => {
      const video = videosById?.get(scene.videoId);
      const resolvedAnalysisVersion = normalizeAnalysisVersion(
        scene.analysisVersion ?? video?.analysisVersion,
      );
      if (!video) {
        return {
          ...scene,
          analysisVersion: resolvedAnalysisVersion,
          analysisGeneratedAt: scene.analysisGeneratedAt ?? null,
        };
      }
      return {
        ...scene,
        analysisObservationScope:
          scene.analysisObservationScope ??
          ((video as Video & { analysisObservationScope?: string | null }).analysisObservationScope ?? null),
        analysisVersion: resolvedAnalysisVersion,
        analysisGeneratedAt: scene.analysisGeneratedAt ?? video.analysisGeneratedAt ?? null,
        calibratedScore: scene.calibratedScore ?? video.calibratedScore ?? null,
        calibratedRank: scene.calibratedRank ?? video.calibratedRank ?? null,
        aiOverallScore: scene.aiOverallScore ?? video.aiOverallScore ?? null,
        aiOverallRating: scene.aiOverallRating ?? (video.aiOverallRating || null),
      };
    })
    .filter((scene) => {
      if (excludeUnwatched && scene.analysisObservationScope) {
        return false;
      }
      if (excludeLegacyAnalysis && !isV3AnalysisVersion(scene.analysisVersion)) {
        return false;
      }
      const cal = typeof scene.calibratedScore === "number" ? scene.calibratedScore : null;
      return matchesSceneScoreFilter(cal, scoreFilter);
    });
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

const STOP_WORDS = SCENE_STOP_WORDS;
const CATEGORY_DEFINITIONS = SCENE_CATEGORY_DEFINITIONS;

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

      const terms = getSynonymsForWord(word);
      let matchCount = 0;
      for (let i = 0; i < sceneTexts.length; i++) {
        if (terms.some((term) => sceneTexts[i].includes(term))) {
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

