import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { aiMetadataCompletionJobs, aiMetadataCompletionRuns, videos } from "../drizzle/schema";
import {
  DIRECTION_OPTIONS,
  EXPRESSION_OPTIONS,
  GENRE_OPTIONS,
  PRODUCT_OPTIONS,
  PURPOSE_OPTIONS,
  TONE_OPTIONS,
  toCategoryNameMap,
} from "@shared/metadataOptions";
import { getDb } from "./db";
import { sdk } from "./_core/sdk";

const JOB_ID = "ai_metadata_completion";
const MODEL = "gpt-5-mini";
const CONFIDENCE_THRESHOLD = 0.9;
const BACKOFF_BASE_MINUTES = 60;
const BACKOFF_MAX_MINUTES = 6 * 60;
export const PERSISTENT_AI_WORKER_INTERVAL_MS = 5 * 60_000;
const PERSISTENT_WORKER_TASK_UID = "persistent_ai_worker";
const ARRAY_FIELDS = ["genres", "products", "directions", "tones", "purposes", "expressions"] as const;
type ArrayField = typeof ARRAY_FIELDS[number];
type Row = typeof videos.$inferSelect;

const tagNames: Record<string, Record<string, string>> = {
  genres: toCategoryNameMap(GENRE_OPTIONS),
  products: toCategoryNameMap(PRODUCT_OPTIONS),
  directions: toCategoryNameMap(DIRECTION_OPTIONS),
  tones: toCategoryNameMap(TONE_OPTIONS),
};
const purposeOptions = new Set<string>(PURPOSE_OPTIONS);
const expressionOptions = new Set<string>(EXPRESSION_OPTIONS);
const directCueRules: Record<string, Record<string, string[]>> = {
  genres: { "tv-cm": ["tvcm", "tvspot"], "web-cm": ["webcm"], "branded-movie": ["brandedmovie", "ブランドムービー"], "youtube-sns": ["youtube", "sns", "shorts"], mv: ["mv", "musicvideo", "ミュージックビデオ"], corporate: ["企業vp", "companyprofile", "corporatevideo"], film: ["shortfilm", "shortmovie", "短編映画"], opening: ["opening", "オープニング"], making: ["making", "メイキング", "behindthescenes"], documentary: ["documentary", "ドキュメンタリー"] },
  products: { food: ["食品", "飲料", "beverage", "chocolate", "チョコ", "cider", "サイダー"], entertainment: ["netflix", "entertainmentservice", "映像配信"] },
  directions: { "vfx-3dcg": ["vfx", "3dcg", "cg"], "generative-ai": ["生成ai", "generativeai", "ai創作", "ai生成"] },
  purposes: { MV: ["mv", "musicvideo", "ミュージックビデオ"], "ティザー": ["teaser", "ティザー"] },
  expressions: { "生成AI": ["生成ai", "generativeai", "ai創作", "ai生成"] },
};
const schema = {
  type: "object", additionalProperties: false,
  properties: {
    identity: { type: "object", additionalProperties: false, properties: { videoId: { type: "string" }, videoUrl: { type: "string" }, title: { type: "string" } }, required: ["videoId", "videoUrl", "title"] },
    genres: { type: "array", items: { type: "string", enum: Object.keys(tagNames.genres) } }, products: { type: "array", items: { type: "string", enum: Object.keys(tagNames.products) } }, directions: { type: "array", items: { type: "string", enum: Object.keys(tagNames.directions) } }, tones: { type: "array", items: { type: "string", enum: Object.keys(tagNames.tones) } },
    purposes: { type: "array", items: { type: "string", enum: Array.from(purposeOptions) } }, expressions: { type: "array", items: { type: "string", enum: Array.from(expressionOptions) } },
    privateRating: { type: "string", enum: [""] }, aiOverallRating: { type: "string", enum: [""] }, aiDirectionRating: { type: "string", enum: [""] }, aiTechniqueRating: { type: "string", enum: [""] }, aiAnalysis: { type: "string", enum: [""] },
    confidence: { type: "object", additionalProperties: false, properties: Object.fromEntries(["genres", "products", "directions", "tones", "purposes", "expressions", "ratings", "analysis"].map((key) => [key, { type: "number", minimum: 0, maximum: 1 }])), required: ["genres", "products", "directions", "tones", "purposes", "expressions", "ratings", "analysis"] },
    evidence: { type: "object", additionalProperties: false, properties: Object.fromEntries([...ARRAY_FIELDS, "privateRating", "aiOverallRating", "aiDirectionRating", "aiTechniqueRating", "aiAnalysis"].map((key) => [key, { type: "array", items: { type: "string" } }])), required: [...ARRAY_FIELDS, "privateRating", "aiOverallRating", "aiDirectionRating", "aiTechniqueRating", "aiAnalysis"] },
  },
  required: ["identity", ...ARRAY_FIELDS, "privateRating", "aiOverallRating", "aiDirectionRating", "aiTechniqueRating", "aiAnalysis", "confidence", "evidence"],
};
const systemPrompt = "あなたは根拠を限定する映像メタデータ抽出器です。入力にあるタイトル、URL、出典、既存メモ、publicMetadataだけを根拠にしてください。映像本編を視聴していないため推測は禁止です。identityは入力のid、videoUrl、titleを文字単位で返してください。直接確認できる原文引用があり、次の直接対応に明白に一致する場合のみ当該配列へ値を提案しconfidenceを0.95にしてください。MV→genres=mvとpurposes=MV、Teaser/ティザー→purposes=ティザー、VFX/3DCG→directions=vfx-3dcg、生成AI→directions=generative-aiまたはexpressions=生成AI、食品・飲料・チョコ・サイダー→products=food、Netflix/映像配信→products=entertainment。その他は空配列・confidence=0にし、評価とaiAnalysisは常に空文字にしてください。引用は入力に含まれる連続文字列だけにしてください。";

const parse = <T>(value: unknown, fallback: T): T => { try { return typeof value === "string" && value ? JSON.parse(value) as T : fallback; } catch { return fallback; } };
const normalize = (value: unknown) => String(value ?? "").toLowerCase().replace(/[\s!"#$%&'()*+,\.\/:;<=>?@[\\\]^`{|}~_]+/g, "");
const isEmpty = (value: unknown) => !Array.isArray(parse(value, [])) || parse<unknown[]>(value, []).length === 0;
const missingFields = (row: Row) => ARRAY_FIELDS.filter((field) => isEmpty(row[field]));

export function selectUnprocessedAiInputs(rows: Row[], batchSize: number) {
  return rows.filter((row) => missingFields(row).length > 0 && !parse<Record<string, unknown>>(row.metadataClassificationAudit, {}).aiMetadataCompletion).slice(0, Math.min(Math.max(batchSize, 1), 5));
}

export function acceptsAiCompletionTaskUid(job: Pick<typeof aiMetadataCompletionJobs.$inferSelect, "scheduleCronTaskUid" | "backupScheduleCronTaskUid" | "enabled"> | undefined, taskUid: string | undefined) {
  if (!job?.enabled || !taskUid) return false;
  return [job.scheduleCronTaskUid, job.backupScheduleCronTaskUid].filter(Boolean).includes(taskUid);
}

export function getModelRetryAfter(now: Date, consecutiveFailureCount: number) {
  const multiplier = Math.pow(2, Math.max(0, consecutiveFailureCount - 1));
  const minutes = Math.min(BACKOFF_BASE_MINUTES * multiplier, BACKOFF_MAX_MINUTES);
  return new Date(now.getTime() + minutes * 60_000);
}

export function isModelBackoffActive(job: Pick<typeof aiMetadataCompletionJobs.$inferSelect, "retryAfter"> | undefined, now: Date) {
  return Boolean(job?.retryAfter && job.retryAfter.getTime() > now.getTime());
}

export function isPersistentAiWorkerEnabled(
  env: { NODE_ENV?: string; JWT_SECRET?: string } = {
    NODE_ENV: process.env.NODE_ENV,
    JWT_SECRET: process.env.JWT_SECRET,
  }
) {
  return env.NODE_ENV !== "development" && Boolean(env.JWT_SECRET);
}

export function startPersistentAiMetadataWorker(port: number) {
  if (!isPersistentAiWorkerEnabled()) return () => undefined;

  let inFlight = false;
  const execute = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/scheduled/ai-metadata-completion`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-ai-completion-worker": process.env.JWT_SECRET ?? "",
        },
        body: "{}",
        signal: AbortSignal.timeout(10 * 60_000),
      });
      if (!response.ok) console.error(`[AI completion worker] ${response.status} ${await response.text()}`);
    } catch (error) {
      console.error("[AI completion worker] execution failed", error);
    } finally {
      inFlight = false;
    }
  };

  const initialTimer = setTimeout(() => void execute(), 15_000);
  const interval = setInterval(() => void execute(), PERSISTENT_AI_WORKER_INTERVAL_MS);
  return () => {
    clearTimeout(initialTimer);
    clearInterval(interval);
  };
}

async function publicMetadata(row: Row) {
  if (row.platform !== "youtube" || !process.env.YOUTUBE_API_KEY) return null;
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet"); url.searchParams.set("id", row.id); url.searchParams.set("key", process.env.YOUTUBE_API_KEY);
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return null;
  const snippet = (await response.json())?.items?.[0]?.snippet;
  return snippet ? { description: String(snippet.description ?? "").slice(0, 6000), channelTitle: String(snippet.channelTitle ?? ""), tags: Array.isArray(snippet.tags) ? snippet.tags.slice(0, 40) : [], sourceUrl: row.videoUrl } : null;
}

function makeInput(row: Row, meta: Awaited<ReturnType<typeof publicMetadata>>) {
  return { id: row.id, platform: row.platform, title: row.title, videoUrl: row.videoUrl, source: row.source ?? "", sourceLabel: row.sourceLabel ?? "", channelTitle: row.channelTitle ?? "", tags: parse<string[]>(row.allTags, []), curationNote: parse(row.curationNote, {}), missing: missingFields(row), publicMetadata: meta };
}
function sourceText(input: any) { return [input.title, input.videoUrl, input.source, input.sourceLabel, input.channelTitle, ...(input.tags ?? []), JSON.stringify(input.curationNote ?? {}), input.publicMetadata?.description, input.publicMetadata?.channelTitle, ...(input.publicMetadata?.tags ?? [])].map(normalize).join(" "); }
function assess(candidate: any, input: any) {
  const identityOk = candidate?.identity?.videoId === input.id && candidate?.identity?.videoUrl === input.videoUrl && candidate?.identity?.title === input.title;
  const eligible: string[] = []; const rejected: Record<string, string> = {};
  for (const field of ARRAY_FIELDS) {
    const values = candidate?.[field]; const confidence = Number(candidate?.confidence?.[field] ?? 0); const evidence = candidate?.evidence?.[field];
    if (!identityOk) rejected[field] = "identity_mismatch";
    else if (!Array.isArray(values) || !values.length) rejected[field] = "empty_candidate";
    else if (!Number.isFinite(confidence) || confidence < CONFIDENCE_THRESHOLD) rejected[field] = "confidence_below_threshold";
    else if (!Array.isArray(evidence) || !evidence.some((quote) => { const text = normalize(quote); return text.length >= 2 && sourceText(input).includes(text); })) rejected[field] = "ungrounded_evidence";
    else if (!values.every((value: string) => directCueRules[field]?.[value]?.some((cue) => normalize(evidence.join(" ")).includes(cue)))) rejected[field] = "indirect_category_mapping";
    else eligible.push(field);
  }
  return { identityOk, eligible, rejected };
}
function tagItems(field: string, values: string[]) { return Array.from(new Set(values)).map((slug) => tagNames[field]?.[slug] ? { slug, name: tagNames[field][slug] } : null).filter(Boolean); }
async function analyze(input: any) {
  const response = await fetch(`${process.env.BUILT_IN_FORGE_API_URL}/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${process.env.BUILT_IN_FORGE_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, max_completion_tokens: 1200, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `入力データ: ${JSON.stringify(input)}` }], response_format: { type: "json_schema", json_schema: { name: "safe_video_metadata", strict: true, schema } } }) });
  if (!response.ok) throw new Error(`model_http_${response.status}`);
  const content = (await response.json())?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("empty_model_content");
  return JSON.parse(content);
}

export async function runAiMetadataCompletion(req: Request, res: Response) {
  let runId: number | null = null;
  try {
    const isInternalWorker = Boolean(process.env.JWT_SECRET) && req.get("x-ai-completion-worker") === process.env.JWT_SECRET;
    const user = isInternalWorker ? null : await sdk.authenticateRequest(req);
    if (!isInternalWorker && (!user?.isCron || !user.taskUid)) return res.status(403).json({ error: "cron-only" });
    const taskUid = isInternalWorker ? PERSISTENT_WORKER_TASK_UID : user!.taskUid!;
    const db = await getDb(); if (!db) throw new Error("database unavailable");
    const job = (await db.select().from(aiMetadataCompletionJobs).where(eq(aiMetadataCompletionJobs.id, JOB_ID)).limit(1))[0];
    const taskAllowed = isInternalWorker ? Boolean(job?.enabled) : acceptsAiCompletionTaskUid(job, taskUid);
    if (!taskAllowed) {
      await db.insert(aiMetadataCompletionRuns).values({
        taskUid,
        status: "skipped",
        completedAt: new Date(),
        details: JSON.stringify({
          reason: "disabled_or_orphan",
          expectedTaskUid: job?.scheduleCronTaskUid ?? null,
          expectedBackupTaskUid: job?.backupScheduleCronTaskUid ?? null,
          enabled: Boolean(job?.enabled),
        }),
      });
      return res.json({ ok: true, skipped: "disabled_or_orphan", taskUid });
    }
    const now = new Date();
    if (isModelBackoffActive(job, now)) {
      await db.insert(aiMetadataCompletionRuns).values({
        taskUid,
        status: "backoff",
        completedAt: now,
        details: JSON.stringify({ reason: "model_backoff", retryAfter: job.retryAfter?.toISOString() ?? null, consecutiveModelFailureCount: job.consecutiveModelFailureCount }),
      });
      return res.json({ ok: true, skipped: "model_backoff", retryAfter: job.retryAfter?.toISOString() ?? null });
    }
    const rows = await db.select().from(videos);
    const selected = selectUnprocessedAiInputs(rows, job.batchSize);
    const [run] = await db.insert(aiMetadataCompletionRuns).values({ taskUid, status: "running", selectedCount: selected.length }).$returningId(); runId = run.id;
    const details: any[] = []; let savedValueCount = 0; let analyzedCount = 0;
    for (const row of selected) {
      try {
        const input = makeInput(row, await publicMetadata(row)); const candidate = await analyze(input); analyzedCount++;
        const quality = assess(candidate, input); const priorAudit = parse<Record<string, unknown>>(row.metadataClassificationAudit, {}); const next: Record<string, unknown> = {};
        for (const field of ARRAY_FIELDS) if (quality.eligible.includes(field) && isEmpty(row[field])) {
          const value = field === "purposes" ? Array.from(new Set(candidate[field].filter((item: string) => purposeOptions.has(item)))) : field === "expressions" ? Array.from(new Set(candidate[field].filter((item: string) => expressionOptions.has(item))) ) : tagItems(field, candidate[field]);
          if ((value as unknown[]).length) { next[field] = JSON.stringify(value); savedValueCount += (value as unknown[]).length; }
        }
        const appliedMissing = Object.keys(next);
        const audit = { ...priorAudit, aiMetadataCompletion: { model: MODEL, analyzedAt: new Date().toISOString(), evidenceType: "ai_analysis", identityTripleMatch: quality.identityOk, confidence: candidate.confidence, evidence: candidate.evidence, input: { title: row.title, videoUrl: row.videoUrl, source: row.source, channelTitle: row.channelTitle, tags: parse(row.allTags, []), publicMetadataUsed: Boolean(input.publicMetadata) }, eligibleFields: quality.eligible, rejectedFields: quality.rejected, appliedMissing } };
        await db.update(videos).set({ ...next, metadataClassificationAudit: JSON.stringify(audit) }).where(eq(videos.id, row.id));
        details.push({ id: row.id, status: "audited", eligibleFields: quality.eligible, appliedMissing });
      } catch (error) { details.push({ id: row.id, status: "error", error: String(error) }); }
    }
    const modelFailureCount = details.filter((item) => item.status === "error" && String(item.error).includes("model_http_")).length;
    const allSelectedRequestsFailed = selected.length > 0 && modelFailureCount === selected.length;
    const consecutiveModelFailureCount = allSelectedRequestsFailed ? job.consecutiveModelFailureCount + 1 : 0;
    const retryAfter = allSelectedRequestsFailed ? getModelRetryAfter(now, consecutiveModelFailureCount) : null;
    await db.update(aiMetadataCompletionJobs).set({ lastRunAt: now, consecutiveModelFailureCount, retryAfter }).where(eq(aiMetadataCompletionJobs.id, JOB_ID));
    await db.update(aiMetadataCompletionRuns).set({ status: "completed", completedAt: new Date(), analyzedCount, auditedCount: details.filter((item) => item.status === "audited").length, savedValueCount, skippedCount: details.filter((item) => item.status !== "audited").length, details: JSON.stringify(details) }).where(eq(aiMetadataCompletionRuns.id, runId));
    res.json({ ok: true, selected: selected.length, analyzedCount, savedValueCount, runId, retryAfter: retryAfter?.toISOString() ?? null });
  } catch (error) {
    if (runId) { const db = await getDb(); await db?.update(aiMetadataCompletionRuns).set({ status: "failed", completedAt: new Date(), details: JSON.stringify({ error: String(error) }) }).where(eq(aiMetadataCompletionRuns.id, runId)); }
    res.status(500).json({ error: String(error), timestamp: new Date().toISOString() });
  }
}
