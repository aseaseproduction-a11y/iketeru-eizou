import { ENV } from "./_core/env";
import {
  DIRECTION_OPTIONS,
  EXPRESSION_OPTIONS,
  PURPOSE_OPTIONS,
  TONE_OPTIONS,
  restrictToAllowedOptions,
  toCategoryNameMap,
} from "@shared/metadataOptions";

export const METADATA_TAXONOMY = {
  genres: ["tv-cm", "web-cm", "branded-movie", "youtube-sns", "mv", "corporate", "film", "opening", "making", "documentary"],
  products: ["beauty", "fashion", "food", "daily", "automotive", "gaming", "it", "travel", "medical", "real-estate", "transport", "entertainment", "electronics", "sports"],
  directions: DIRECTION_OPTIONS.map((item) => item.slug),
  tones: TONE_OPTIONS.map((item) => item.slug),
} as const;

export type MetadataField = keyof typeof METADATA_TAXONOMY;
export type TagItem = { name: string; slug: string };
export type AutoClassificationInput = {
  id: string;
  title: string;
  videoUrl: string;
  source: string;
  sourceLabel: string;
  channelTitle: string;
  allTags: string[];
  curationNote: { purpose?: string; background?: string; evaluation?: string; sourceUrls?: string[] };
  genres: TagItem[];
  products: TagItem[];
  directions: TagItem[];
  tones: TagItem[];
  purposes: string[];
  expressions: string[];
};
type ModelCandidate = Record<MetadataField, string[]> & { purposes: string[]; expressions: string[]; confidence: number; evidence: string };
export type AutoClassificationResult = {
  status: "updated" | "skipped" | "failed";
  updates: Partial<Record<MetadataField, TagItem[]>> & { purposes?: string[]; expressions?: string[] };
  confidence?: number;
  evidence?: string;
  reason?: string;
};

const names: Record<MetadataField, Record<string, string>> = {
  genres: { "tv-cm": "TV CM", "web-cm": "Web CM", "branded-movie": "ブランデッドムービー", "youtube-sns": "YouTube / SNS / 縦型動画", mv: "MV", corporate: "企業 / 商品VP / コンテスト作品", film: "映画 / ドラマ / ショートフィルム", opening: "オープニング映像", making: "メイキング / Behind The Scenes", documentary: "ドキュメンタリー" },
  products: { beauty: "美容 / 化粧品", fashion: "ファッション / アパレル", food: "食品 / 飲料 / 飲食", daily: "日用品 / 防犯 / 警備", automotive: "自動車 / バイク", gaming: "ゲーム / アプリ / 玩具", it: "IT / 通信 / ネットサービス", travel: "旅行 / 宿泊", medical: "医療 / 医薬", "real-estate": "住宅 / 不動産 / 建設", transport: "交通 / 物流 / 産業素材", entertainment: "娯楽 / アミューズメント", electronics: "精密機器 / 家具 / 電化製品", sports: "スポーツ / 健康 / フィットネス" },
  directions: toCategoryNameMap(DIRECTION_OPTIONS),
  tones: toCategoryNameMap(TONE_OPTIONS),
};

const categorySchema = (values: readonly string[]) => ({ type: "array", items: { type: "string", enum: values } });
const responseFormat = {
  type: "json_schema" as const,
  json_schema: {
    name: "video_metadata_classification", strict: true,
    schema: {
      type: "object", additionalProperties: false,
      properties: {
        genres: categorySchema(METADATA_TAXONOMY.genres), products: categorySchema(METADATA_TAXONOMY.products), directions: categorySchema(METADATA_TAXONOMY.directions), tones: categorySchema(METADATA_TAXONOMY.tones), purposes: categorySchema(PURPOSE_OPTIONS), expressions: categorySchema(EXPRESSION_OPTIONS),
        confidence: { type: "number", minimum: 0, maximum: 1 }, evidence: { type: "string" },
      },
      required: ["genres", "products", "directions", "tones", "purposes", "expressions", "confidence", "evidence"],
    },
  },
};

export function selectSafeMetadataUpdates(input: AutoClassificationInput, candidate: ModelCandidate): AutoClassificationResult["updates"] {
  if (candidate.confidence < 0.82 || candidate.evidence.trim().length < 6) return {};
  const updates: AutoClassificationResult["updates"] = {};
  for (const field of Object.keys(METADATA_TAXONOMY) as MetadataField[]) {
    if (input[field].length || !candidate[field]?.length) continue;
    const mapped = candidate[field].map((slug) => ({ slug, name: names[field][slug] })).filter((item) => item.name);
    if (mapped.length) updates[field] = mapped;
  }
  if (!input.purposes.length && candidate.purposes?.length) updates.purposes = restrictToAllowedOptions(candidate.purposes, PURPOSE_OPTIONS);
  if (!input.expressions.length && candidate.expressions?.length) updates.expressions = restrictToAllowedOptions(candidate.expressions, EXPRESSION_OPTIONS);
  return updates;
}

export async function classifyVideoMetadata(input: AutoClassificationInput): Promise<AutoClassificationResult> {
  const missing = [...(Object.keys(METADATA_TAXONOMY) as MetadataField[]).filter((field) => input[field].length === 0), ...(input.purposes.length ? [] : ["purposes"]), ...(input.expressions.length ? [] : ["expressions"])];
  if (!missing.length) return { status: "skipped", updates: {}, reason: "all_metadata_fields_are_already_filled" };
  try {
    const response = await fetch(`${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ENV.forgeApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5-mini", max_completion_tokens: 1800, response_format: responseFormat,
        messages: [
        { role: "system", content: "あなたは映像メタデータの保守的な分類器です。タイトル、掲載元、制作者名、タグ、キュレーションメモに明記された根拠だけを用い、指定されたスラッグから選択してください。映像内容やブランドを推測してはいけません。根拠が弱い分類は必ず空配列にします。evidenceには入力から使った短い手掛かりを日本語で書いてください。" },
        { role: "user", content: JSON.stringify({ taxonomy: METADATA_TAXONOMY, missing, video: { id: input.id, title: input.title, videoUrl: input.videoUrl, source: input.source, sourceLabel: input.sourceLabel, channelTitle: input.channelTitle, tags: input.allTags.slice(0, 40), curationNote: input.curationNote } }) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`classification_api_${response.status}`);
    const body = await response.json() as { choices?: { message?: { content?: string } }[] };
    const candidate = JSON.parse(String(body.choices?.[0]?.message?.content || "{}")) as ModelCandidate;
    const updates = selectSafeMetadataUpdates(input, candidate);
    return Object.keys(updates).length ? { status: "updated", updates, confidence: candidate.confidence, evidence: candidate.evidence } : { status: "skipped", updates: {}, confidence: candidate.confidence, evidence: candidate.evidence, reason: "insufficient_evidence_or_no_empty_field_candidate" };
  } catch (error) {
    return { status: "failed", updates: {}, reason: error instanceof Error ? error.message.slice(0, 600) : "unknown_classification_error" };
  }
}
