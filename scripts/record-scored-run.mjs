import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditTranscript } from "./audit-blind-transcript.mjs";

const REPO_ROOT = "E:\\iketeru-eizou";
const BRAIN_ROOT = process.env.ANTIGRAVITY_BRAIN_ROOT || path.join(os.homedir(), ".gemini", "antigravity", "brain");

export const VALUE_FLAGS = Object.freeze(
  new Set(["run-id", "video-id", "mode", "attempt", "subagent-id", "parent-id"])
);
export const ALLOW_LEADING_DOUBLE_DASH_VALUE_FLAGS = Object.freeze(new Set(["video-id"]));

export function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (VALUE_FLAGS.has(k)) {
        if (next === undefined || next === "") {
          throw new Error(`Missing value for --${k}`);
        }
        if (ALLOW_LEADING_DOUBLE_DASH_VALUE_FLAGS.has(k)) {
          if (next.startsWith("--") && VALUE_FLAGS.has(next.slice(2))) {
            throw new Error(`Missing value for --${k} (got flag "${next}")`);
          }
        } else if (next.startsWith("--")) {
          throw new Error(`Missing value for --${k} (got flag "${next}")`);
        }
        args[k] = next;
        i++;
      } else if (!next || next.startsWith("--")) {
        args[k] = true;
      } else {
        args[k] = next;
        i++;
      }
    }
  }
  return args;
}

function decodeArgString(v) {
  if (typeof v !== "string") return String(v ?? "");
  const trimmed = v.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
    } catch {
      // fall through
    }
  }
  return v;
}

function extractScoreJsonFromTranscript(transcriptPath) {
  const fullPath = transcriptPath.replace(/transcript\.jsonl$/i, "transcript_full.jsonl");
  const target = fs.existsSync(fullPath) ? fullPath : transcriptPath;
  const lines = fs.readFileSync(target, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  let lastMessage = null;
  for (const l of lines) {
    let step;
    try {
      step = JSON.parse(l);
    } catch {
      continue;
    }
    if (Array.isArray(step.tool_calls)) {
      for (const tc of step.tool_calls) {
        if ((tc.name || tc.tool_name) === "send_message") {
          const msg = decodeArgString((tc.arguments || tc.args || {}).Message ?? (tc.arguments || tc.args || {}).message ?? "");
          if (msg) lastMessage = msg;
        }
      }
    }
  }
  if (!lastMessage) return { parsed: null, error: "no_send_message_found" };

  // Strip optional markdown code fences
  const fenceMatch = lastMessage.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenceMatch ? fenceMatch[1] : lastMessage).trim();
  const braceStart = candidate.indexOf("{");
  const braceEnd = candidate.lastIndexOf("}");
  if (braceStart === -1 || braceEnd === -1) {
    return { parsed: null, error: "no_json_object_in_send_message", raw: lastMessage.slice(0, 300) };
  }
  try {
    return { parsed: JSON.parse(candidate.slice(braceStart, braceEnd + 1)), error: null };
  } catch (e) {
    return { parsed: null, error: `json_parse_error:${e.message}`, raw: candidate.slice(0, 300) };
  }
}

function main() {
  const args = parseArgs(process.argv);
  const runId = args["run-id"];
  const videoId = args["video-id"];
  const mode = args["mode"];
  const attempt = parseInt(args["attempt"] || "1", 10);
  const subagentId = args["subagent-id"];
  const parentId = args["parent-id"];

  if (!runId || !videoId || !mode || !subagentId || !parentId) {
    console.error("Usage: node scripts/record-scored-run.mjs --run-id <run_id> --video-id <id> --mode <video|contact_sheet> --attempt <1|2|3> --subagent-id <convId> --parent-id <convId>");
    process.exit(2);
  }

  const runDir = path.join(REPO_ROOT, "analysis", "runs", runId);
  const specPath = path.join(runDir, "specs", `${videoId}_${mode}.json`);
  const blindMapPath = path.join(runDir, "blind_id_map.json");
  const manifestPath = path.join(runDir, "run_manifest.json");
  const transcriptPath = path.join(BRAIN_ROOT, subagentId, ".system_generated", "logs", "transcript.jsonl");

  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  const audit = auditTranscript({
    transcriptPath,
    videoId,
    allowedFilesRaw: spec.assignedFiles,
    parentId,
    promptSpecPath: specPath,
    blindMapPath,
    runManifestPath: manifestPath,
    strict: true,
  });

  const { parsed, error: parseError } = extractScoreJsonFromTranscript(transcriptPath);
  const scoreValid =
    parsed &&
    typeof parsed.total_score === "number" &&
    Number.isFinite(parsed.total_score) &&
    parsed.total_score >= 0 &&
    parsed.total_score <= 100 &&
    parsed.scores &&
    parsed.post_check &&
    typeof parsed.post_check.knows_work === "boolean" &&
    typeof parsed.post_check.knows_award_history === "boolean" &&
    typeof parsed.post_check.award_badge_visible_in_video === "boolean";

  const record = {
    recorded_at: new Date().toISOString(),
    run_id: runId,
    video_id: videoId,
    blind_id: spec.blindId,
    mode,
    attempt,
    subagent_id: subagentId,
    transcript_path: transcriptPath,
    audit_valid: audit.valid && Boolean(scoreValid),
    audit_transcript_valid: audit.valid,
    score_json_valid: Boolean(scoreValid),
    parse_error: parseError,
    models_observed: audit.models_observed || [],
    model_match: Array.isArray(audit.model_violations) ? audit.model_violations.length === 0 : null,
    token_usage: audit.token_usage,
    verified_media_by_file: audit.verified_media_by_file,
    verified_manifest_hashes: audit.verified_manifest_hashes,
    violations: {
      config: audit.config_violations,
      path: audit.path_policy_violations,
      manifest: audit.manifest_violations,
      prompt_exact: audit.prompt_exact_match_violations,
      prompt_leak: audit.prompt_leak_violations,
      tool: audit.tool_violations,
      media: audit.media_violations,
      model: audit.model_violations,
    },
    scores: parsed?.scores ?? null,
    total_score: parsed?.total_score ?? null,
    rank: parsed?.rank ?? null,
    brief_rationale: parsed?.brief_rationale ?? null,
    post_check: parsed?.post_check ?? null,
  };

  const outPath = path.join(runDir, "raw_scores.jsonl");
  fs.appendFileSync(outPath, JSON.stringify(record) + "\n", "utf8");

  console.log(JSON.stringify({
    video_id: record.video_id,
    blind_id: record.blind_id,
    mode: record.mode,
    attempt: record.attempt,
    subagent_id: record.subagent_id,
    audit_valid: record.audit_valid,
    total_score: record.total_score,
    rank: record.rank,
    post_check: record.post_check,
    token_usage: record.token_usage,
    violations: record.audit_valid ? "none" : record.violations,
  }, null, 2));

  if (!record.audit_valid) process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(err.message || err);
    process.exit(2);
  }
}
