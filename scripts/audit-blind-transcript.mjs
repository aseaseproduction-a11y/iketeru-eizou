import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = "E:\\iketeru-eizou";
const BLIND_ROOT_PREFIX = "e:\\iketeru_blind_eval\\";

const GLOBAL_FORBIDDEN_PROMPT_PATTERNS = [
  { label: "repo_path", re: /iketeru-eizou/i },
  { label: "brain_path", re: /\\\.gemini\\antigravity\\brain\\|\/\.gemini\/antigravity\/brain\//i },
  { label: "benchmark_file", re: /golden_benchmark|benchmark_split|benchmark_candidates|benchmark_prefetch/i },
  { label: "split_role", re: /\b(dev_craft|holdout_craft|dev_non_award|holdout_non_award|craft_benchmark|non_award_baseline|reference_only)\b/i },
  { label: "db_field", re: /\b(objective_tier|objective_band|current_db_rating|current_db_score|evidence_level)\b/i },
  { label: "award_keyword_en", re: /\b(Cannes\s*Lions?|D&AD|BOVA|Vimeo\s*Staff\s*Pick|Staff\s*Pick|Annecy|ADFEST|Spikes\s*Asia|Clio\s*Awards?|The\s*One\s*Show|AICP|Ciclope|British\s*Arrows|Motion\s*Awards?|UKMVA|UK\s*Music\s*Video|MTV\s*VMA|SPACE\s*SHOWER|Berlin\s*International|Silver\s*Bear|Grand\s*Prix|Gold\s*Lion|Silver\s*Lion|Bronze\s*Lion|Black\s*Pencil|Yellow\s*Pencil|Graphite\s*Pencil|Wood\s*Pencil|Telly\s*Awards?|Collision\s*Awards?)\b/i },
  { label: "award_keyword_ja", re: /(映文連アワード|経済産業大臣賞|日本国際観光映像祭|観光映像祭|文化庁メディア芸術祭|メディア芸術祭|ギャラクシー賞|ベルリン国際映画祭|銀熊賞|グランプリ|受賞作|ノミネート|ショートリスト|最優秀賞|優秀賞|審査委員会推薦)/ },
  { label: "db_body_marker", re: /(既存ランク|DBランク|正解ランク|想定ランク|ランク決定理由|Ch\.\s*[1-9]|TiDB|SQLite)/i },
];

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

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[k] = true;
      } else {
        args[k] = next;
        i++;
      }
    }
  }
  return args;
}

function normWinPath(p) {
  return path.resolve(String(p || "")).replace(/\//g, "\\").toLowerCase();
}

function loadTranscriptSteps(transcriptPath) {
  const fullPath = transcriptPath.replace(/transcript\.jsonl$/i, "transcript_full.jsonl");
  const compactLines = fs.readFileSync(transcriptPath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  let fullByIndex = null;

  function getFullStep(stepIndex) {
    if (!fs.existsSync(fullPath)) return null;
    if (!fullByIndex) {
      fullByIndex = new Map();
      const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/).filter(Boolean);
      for (const l of lines) {
        try {
          const obj = JSON.parse(l);
          fullByIndex.set(obj.step_index, obj);
        } catch {
          // ignore malformed trailing line
        }
      }
    }
    return fullByIndex.get(stepIndex) || null;
  }

  return compactLines.map(line => {
    const obj = JSON.parse(line);
    if (Array.isArray(obj.truncated_fields) && obj.truncated_fields.length > 0) {
      const full = getFullStep(obj.step_index);
      if (full) return full;
    }
    return obj;
  });
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function main() {
  const args = parseArgs(process.argv);
  const transcriptPath = args["transcript"];
  const videoId = args["video-id"];
  const allowedFilesRaw = args["allowed-files"] || "";
  const parentId = args["parent-id"] || null;
  const channelName = args["channel-name"] || null;
  const strict = Boolean(args["strict"]);

  if (!transcriptPath || !videoId || !allowedFilesRaw) {
    console.error("Usage: node scripts/audit-blind-transcript.mjs --transcript <path> --video-id <id> --allowed-files <p1,p2> [--parent-id <convId>] [--channel-name <name>] [--strict]");
    process.exit(2);
  }

  const allowedFiles = allowedFilesRaw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(normWinPath);
  const allowedFileSet = new Set(allowedFiles);

  // Verify all allowed files are inside E:\iketeru_blind_eval\
  const pathPolicyViolations = [];
  for (const f of allowedFiles) {
    if (!f.startsWith(BLIND_ROOT_PREFIX)) {
      pathPolicyViolations.push(`Allowed file outside isolated root (${BLIND_ROOT_PREFIX}): ${f}`);
    }
  }

  // Load benchmark metadata for this video to detect title / award / rationale leakage in prompts
  const benchPath = path.join(REPO_ROOT, "analysis", "golden_benchmark.json");
  const bench = JSON.parse(fs.readFileSync(benchPath, "utf8"));
  const meta = bench.find(x => x.id === videoId) || null;

  const videoSpecificPatterns = [];
  if (meta) {
    const cleanTitle = String(meta.title || "")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .trim();
    const genericTitleWords = new Set(["official", "video", "music", "movie", "commercial", "short", "film", "trailer", "teaser", "version", "full", "公式", "動画", "映像", "短編", "映画", "採用動画", "紹介動画"]);
    if (cleanTitle.length >= 4) {
      videoSpecificPatterns.push({ label: "video_title_full", re: new RegExp(escapeRegExp(cleanTitle), "i") });
      const seenSegs = new Set([cleanTitle.toLowerCase()]);
      const addSeg = (rawSeg, prefix) => {
        const seg = String(rawSeg || "").trim();
        const low = seg.toLowerCase();
        if (seg.length >= 5 && !genericTitleWords.has(low) && !seenSegs.has(low)) {
          seenSegs.add(low);
          videoSpecificPatterns.push({ label: `${prefix}:${seg.slice(0, 24)}`, re: new RegExp(escapeRegExp(seg), "i") });
        }
      };
      for (const sm of cleanTitle.matchAll(/[「『"【]([^」』"】]{4,})[」』"】]/g)) {
        addSeg(sm[1], "video_title_bracket");
      }
      for (const tok of cleanTitle.split(/[\s　｜|\/〜～–—:：・,、()（）「」『』【】"]+/).filter(Boolean)) {
        addSeg(tok, "video_title_token");
      }
    }
    if (meta.videoUrl && meta.videoUrl.length >= 10) {
      videoSpecificPatterns.push({ label: "video_url", re: new RegExp(escapeRegExp(meta.videoUrl), "i") });
    }
    if (meta.rationale && meta.rationale.length >= 6) {
      videoSpecificPatterns.push({ label: "video_rationale", re: new RegExp(escapeRegExp(meta.rationale), "i") });
    }
    for (const aw of (meta.awards || [])) {
      if (aw.name && aw.name.length >= 3) {
        videoSpecificPatterns.push({ label: `award_name:${aw.name}`, re: new RegExp(escapeRegExp(aw.name), "i") });
      }
      if (aw.category && aw.category.length >= 6) {
        videoSpecificPatterns.push({ label: `award_category:${aw.category}`, re: new RegExp(escapeRegExp(aw.category), "i") });
      }
    }
  }
  if (channelName && channelName.trim().length >= 3) {
    videoSpecificPatterns.push({ label: "channel_name", re: new RegExp(escapeRegExp(channelName.trim()), "i") });
  }

  const steps = loadTranscriptSteps(transcriptPath);
  const promptLeakViolations = [];
  const toolViolations = [];
  const readFilesCalled = new Set();
  const mediaMimeTypes = [];
  let totalToolCalls = 0;

  for (const step of steps) {
    if (Array.isArray(step.media)) {
      for (const m of step.media) {
        if (m && m.mime_type) mediaMimeTypes.push(m.mime_type);
      }
    }

    // (a) Inspect incoming parent instructions / USER_INPUT / SYSTEM_MESSAGE
    const isIncomingPrompt =
      step.type === "USER_INPUT" ||
      step.type === "SYSTEM_MESSAGE" ||
      step.source === "USER_EXPLICIT" ||
      step.source === "SYSTEM" ||
      (typeof step.content === "string" && step.content.includes("<SYSTEM_MESSAGE>"));

    if (isIncomingPrompt && typeof step.content === "string" && step.content.length > 0) {
      const text = step.content;
      for (const p of [...GLOBAL_FORBIDDEN_PROMPT_PATTERNS, ...videoSpecificPatterns]) {
        const m = text.match(p.re);
        if (m) {
          promptLeakViolations.push({
            step_index: step.step_index,
            source: step.source,
            type: step.type,
            rule: p.label,
            matched: m[0].slice(0, 80),
          });
        }
      }
    }

    // (b) Inspect ALL tool calls: ONLY read_file (on allowedFiles) and send_message (to parentId) allowed
    if (Array.isArray(step.tool_calls)) {
      for (const tc of step.tool_calls) {
        totalToolCalls++;
        const name = tc.name || tc.tool_name || "";
        const tcArgs = tc.arguments || tc.args || {};

        if (name === "read_file") {
          const targetPath = decodeArgString(tcArgs.Path ?? tcArgs.path ?? "");
          const normTarget = normWinPath(targetPath);
          readFilesCalled.add(normTarget);
          if (!allowedFileSet.has(normTarget)) {
            toolViolations.push({
              step_index: step.step_index,
              tool: name,
              reason: "read_file_outside_allowed_files",
              target: targetPath,
            });
          }
          if (!normTarget.startsWith(BLIND_ROOT_PREFIX)) {
            toolViolations.push({
              step_index: step.step_index,
              tool: name,
              reason: "read_file_outside_blind_root",
              target: targetPath,
            });
          }
        } else if (name === "send_message") {
          const recipient = decodeArgString(tcArgs.Recipient ?? tcArgs.recipient ?? "");
          if (parentId && recipient !== parentId) {
            toolViolations.push({
              step_index: step.step_index,
              tool: name,
              reason: "send_message_to_non_parent",
              recipient,
            });
          }
        } else {
          toolViolations.push({
            step_index: step.step_index,
            tool: name,
            reason: "disallowed_tool_call",
            arguments: tcArgs,
          });
        }
      }
    }
  }

  const missingFileReads = allowedFiles.filter(f => !readFilesCalled.has(f));
  const valid =
    pathPolicyViolations.length === 0 &&
    promptLeakViolations.length === 0 &&
    toolViolations.length === 0 &&
    missingFileReads.length === 0 &&
    mediaMimeTypes.length > 0;

  const report = {
    valid,
    video_id: videoId,
    transcript_path: transcriptPath,
    allowed_files: allowedFiles,
    read_files_called: [...readFilesCalled],
    missing_file_reads: missingFileReads,
    media_mime_types: mediaMimeTypes,
    total_tool_calls: totalToolCalls,
    path_policy_violations: pathPolicyViolations,
    prompt_leak_violations: promptLeakViolations,
    tool_violations: toolViolations,
  };

  console.log(JSON.stringify(report, null, 2));
  if (strict && !valid) process.exit(1);
}

main();
