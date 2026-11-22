import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BLIND_ID_REGEX,
  BLIND_ROOT_PREFIX,
  RUN_ID_REGEX,
  validateBlindIdMappingForVideo,
} from "./lib/blind-id-map.mjs";
import {
  extractParentMessageContent,
  renderCalibrationPrompt,
  validateAssignedFilePaths,
} from "./lib/calibration-prompt-template.mjs";

const REPO_ROOT = "E:\\iketeru-eizou";
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

// Strict path grammar: E:\iketeru_blind_eval\run_YYYYMMDD_HHMMSS\(video|contact_sheet)\<12hex>\<12hex>(.mp4|_slow.mp4|_sheet_NN.jpg|_sheet_dense.jpg)
const STRICT_ISOLATED_FILE_RE = /^e:\\iketeru_blind_eval\\(run_\d{8}_\d{6})\\(video|contact_sheet)\\([a-f0-9]{12})\\([a-f0-9]{12})(\.mp4|_slow\.mp4|_sheet_\d{2}\.jpg|_sheet_dense\.jpg)$/;

// Defense-in-depth blacklist (used when --prompt-spec is not supplied, and video-specific checks always run)
const GLOBAL_FORBIDDEN_PROMPT_PATTERNS = [
  { label: "repo_path", re: /iketeru-eizou/i },
  { label: "brain_path", re: /\\\.gemini\\antigravity\\brain\\|\/\.gemini\/antigravity\/brain\//i },
  { label: "benchmark_file", re: /golden_benchmark|benchmark_split|benchmark_candidates|benchmark_prefetch|blind_id_map|run_manifest/i },
  { label: "split_role", re: /\b(dev_craft|holdout_craft|dev_non_award|holdout_non_award|craft_benchmark|non_award_baseline|reference_only)\b/i },
  { label: "db_field", re: /\b(objective_tier|objective_band|current_db_rating|current_db_score|evidence_level)\b/i },
  { label: "rank_plus_minus", re: /(?:^|[\s「『(（:：・\-])([SABCD][+-])(?=$|[\s」』)）,、。.\-!！?？])/ },
  { label: "rank_label_ja", re: /ランク\s*[SABCD][+-]?/i },
  {
    label: "award_keyword_en",
    re: /\b(Cannes\s*Lions?|Palme\s*d['’]?Or|Oscar|Academy\s*Awards?|Emmy|Webby|Golden\s*Globe|BAFTA|Venice\s*Film|Sundance|SXSW|D&AD|BOVA|Vimeo\s*Staff\s*Pick|Staff\s*Pick|Annecy|ADFEST|Spikes\s*Asia|Clio\s*Awards?|The\s*One\s*Show|AICP|Ciclope|British\s*Arrows|Motion\s*Awards?|UKMVA|UK\s*Music\s*Video|MTV\s*VMA|SPACE\s*SHOWER|Berlin\s*International|Silver\s*Bear|Grand\s*Prix|Gold\s*Lion|Silver\s*Lion|Bronze\s*Lion|Black\s*Pencil|Yellow\s*Pencil|Graphite\s*Pencil|Wood\s*Pencil|Telly\s*Awards?|Collision\s*Awards?)\b/i,
  },
  {
    label: "award_keyword_ja",
    re: /(映文連アワード|経済産業大臣賞|日本国際観光映像祭|観光映像祭|文化庁メディア芸術祭|メディア芸術祭|ギャラクシー賞|ベルリン国際映画祭|銀熊賞|グランプリ|受賞作|ノミネート|ショートリスト|最優秀賞|優秀賞|審査委員会推薦|金賞|銀賞|銅賞|ゴールド|シルバー|ブロンズ|入賞|入選|特選)/,
  },
  { label: "db_body_marker", re: /(既存ランク|DBランク|正解ランク|想定ランク|ランク決定理由|Ch\.\s*[1-9]|TiDB|SQLite)/i },
];

export function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const buf = fs.readFileSync(filePath);
  hash.update(buf);
  return hash.digest("hex");
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
  return path.win32.resolve(String(p || "").replace(/\//g, "\\")).toLowerCase();
}

function expectedMimeMatcher(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp4") {
    return { expected: "video/mp4", test: m => m === "video/mp4" };
  }
  if (ext === ".jpg") {
    return { expected: "image/jpeg", test: m => m === "image/jpeg" || m === "image/jpg" };
  }
  return { expected: "unknown", test: () => false };
}

function loadTranscriptSteps(transcriptPath) {
  const fullPath = transcriptPath.replace(/transcript\.jsonl$/i, "transcript_full.jsonl");
  const compactLines = fs.readFileSync(transcriptPath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  let fullByIndex = null;

  function getFullStep(stepIndex) {
    if (!fs.existsSync(fullPath)) return null;
    if (!fullByIndex) {
      fullByIndex = new Map();
      const lines = fs.readFileSync(fullPath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
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

function buildVideoSpecificPatterns(meta, videoId, channelName) {
  const patterns = [];
  const genericWords = new Set([
    "official", "video", "music", "movie", "commercial", "short", "film", "trailer", "teaser",
    "version", "full", "award", "awards", "craft", "design", "best", "winner", "category",
    "production", "direction", "animation", "visual", "effects", "sound",
    "公式", "動画", "映像", "短編", "映画", "採用動画", "紹介動画", "部門", "作品",
  ]);
  const seen = new Set();
  const addPattern = (raw, labelPrefix, minLen = 5) => {
    const seg = String(raw || "").trim();
    const low = seg.toLowerCase();
    if (seg.length >= minLen && !genericWords.has(low) && !seen.has(low)) {
      seen.add(low);
      patterns.push({ label: `${labelPrefix}:${seg.slice(0, 28)}`, re: new RegExp(escapeRegExp(seg), "i") });
    }
  };

  if (videoId && String(videoId).trim().length >= 5) {
    addPattern(videoId, "original_video_id_in_prompt", 5);
  }

  if (meta) {
    const cleanTitle = String(meta.title || "")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .trim();
    addPattern(cleanTitle, "video_title_full", 4);
    for (const sm of cleanTitle.matchAll(/[「『"【]([^」』"】]{4,})[」』"】]/g)) {
      addPattern(sm[1], "video_title_bracket", 4);
    }
    for (const tok of cleanTitle.split(/[\s　｜|\/〜～–—:：・,、()（）「」『』【】"]+/).filter(Boolean)) {
      addPattern(tok, "video_title_token", 5);
    }

    if (meta.videoUrl && meta.videoUrl.length >= 10) {
      addPattern(meta.videoUrl, "video_url", 10);
    }
    if (meta.rationale && meta.rationale.length >= 6) {
      addPattern(meta.rationale, "video_rationale", 6);
    }
    for (const aw of (meta.awards || [])) {
      addPattern(aw.name, "award_name_full", 3);
      for (const tok of String(aw.name || "").split(/[\s　｜|\/〜～–—:：・,、()（）「」『』【】"]+/).filter(Boolean)) {
        addPattern(tok, "award_name_token", 4);
      }
      addPattern(aw.category, "award_category_full", 6);
      for (const tok of String(aw.category || "").split(/[\s　｜|\/〜～–—:：・,、()（）「」『』【】"]+/).filter(Boolean)) {
        addPattern(tok, "award_category_token", 5);
      }
    }
  }
  if (channelName) {
    addPattern(channelName, "channel_name", 3);
  }
  return patterns;
}

export function auditTranscript({
  transcriptPath,
  videoId,
  allowedFilesRaw,
  parentId = null,
  channelName = null,
  promptSpecPath = null,
  promptSpecObj = null,
  blindMapPath = null,
  blindMapObj = null,
  runManifestPath = null,
  runManifestObj = null,
  stagedFilePathResolver = null, // optional hook for unit tests using temp files
  strict = false,
}) {
  const configViolations = [];
  const pathPolicyViolations = [];
  const manifestViolations = [];

  if (strict && (!parentId || String(parentId).trim() === "")) {
    configViolations.push("strict_mode_requires_parent_id");
  }
  if (strict && !promptSpecPath && !promptSpecObj) {
    configViolations.push("strict_mode_requires_prompt_spec");
  }
  if (strict && !blindMapPath && !blindMapObj) {
    configViolations.push("strict_mode_requires_blind_map");
  }
  if (strict && !runManifestPath && !runManifestObj) {
    configViolations.push("strict_mode_requires_run_manifest");
  }

  // Ensure blind_id_map and run_manifest are stored OUTSIDE E:\iketeru_blind_eval\
  if (blindMapPath && normWinPath(blindMapPath).startsWith(BLIND_ROOT_PREFIX)) {
    pathPolicyViolations.push(`blind_map_inside_blind_root:${blindMapPath}`);
  }
  if (runManifestPath && normWinPath(runManifestPath).startsWith(BLIND_ROOT_PREFIX)) {
    pathPolicyViolations.push(`run_manifest_inside_blind_root:${runManifestPath}`);
  }

  const spec = promptSpecObj || (promptSpecPath ? JSON.parse(fs.readFileSync(promptSpecPath, "utf8").replace(/^\uFEFF/, "")) : null);
  const blindMap = blindMapObj || (blindMapPath ? JSON.parse(fs.readFileSync(blindMapPath, "utf8").replace(/^\uFEFF/, "")) : null);
  const manifest = runManifestObj || (runManifestPath ? JSON.parse(fs.readFileSync(runManifestPath, "utf8").replace(/^\uFEFF/, "")) : null);

  // Verify videoId <-> expectedBlindId bijection via blind_id_map
  let expectedBlindId = null;
  let expectedRunId = spec?.runId || blindMap?.run_id || manifest?.run_id || null;
  if (blindMap) {
    const mapCheck = validateBlindIdMappingForVideo(blindMap, spec?.runId || manifest?.run_id || null, videoId);
    if (!mapCheck.ok) {
      for (const err of mapCheck.errors) configViolations.push(err);
    } else {
      expectedBlindId = mapCheck.blindId;
      expectedRunId = blindMap.run_id;
    }
  }

  const allowedFiles = (Array.isArray(allowedFilesRaw) ? allowedFilesRaw : String(allowedFilesRaw || "").split(","))
    .map(s => s.trim())
    .filter(Boolean)
    .map(normWinPath);
  const allowedFileSet = new Set(allowedFiles);

  // Manifest SHA-256 verification (locks blind_id_map.json + source_sha256 + staged files on disk)
  const verifiedManifestHashes = {
    blind_id_map_sha256_verified: false,
    staged_file_hashes_verified: {},
  };

  if (manifest) {
    if (!RUN_ID_REGEX.test(String(manifest.run_id || ""))) {
      manifestViolations.push(`manifest_invalid_run_id:${String(manifest.run_id)}`);
    }
    if (expectedRunId && manifest.run_id !== expectedRunId) {
      manifestViolations.push(`manifest_run_id_mismatch:manifest=${manifest.run_id},expected=${expectedRunId}`);
    }
    if (!SHA256_HEX_RE.test(String(manifest.blind_id_map_sha256 || ""))) {
      manifestViolations.push("manifest_missing_or_invalid_blind_id_map_sha256");
    } else if (blindMapPath && fs.existsSync(blindMapPath)) {
      const actualMapHash = sha256File(blindMapPath);
      if (actualMapHash !== manifest.blind_id_map_sha256) {
        manifestViolations.push(`blind_map_sha256_mismatch:expected=${manifest.blind_id_map_sha256},actual=${actualMapHash}`);
      } else {
        verifiedManifestHashes.blind_id_map_sha256_verified = true;
      }
    } else if (strict) {
      manifestViolations.push("blind_map_file_path_required_for_sha256_verification");
    }

    const itemEntry = manifest.items && manifest.items[videoId];
    if (!itemEntry) {
      manifestViolations.push(`manifest_missing_video_entry:${videoId}`);
    } else {
      if (expectedBlindId && itemEntry.blind_id !== expectedBlindId) {
        manifestViolations.push(`manifest_blind_id_mismatch:manifest=${itemEntry.blind_id},map=${expectedBlindId}`);
      }
      if (!SHA256_HEX_RE.test(String(itemEntry.source_sha256 || ""))) {
        manifestViolations.push(`manifest_invalid_source_sha256:${videoId}`);
      }
      const modeKey = spec?.mode || (allowedFiles[0]?.includes("\\contact_sheet\\") ? "contact_sheet" : "video");
      const manifestStagedList = itemEntry.staged_files?.[modeKey];
      if (!Array.isArray(manifestStagedList) || manifestStagedList.length === 0) {
        manifestViolations.push(`manifest_missing_staged_files:${videoId}:${modeKey}`);
      } else {
        const byNormPath = new Map();
        for (const sf of manifestStagedList) {
          byNormPath.set(normWinPath(sf.path), sf);
        }
        if (byNormPath.size !== allowedFiles.length) {
          manifestViolations.push(`manifest_staged_file_count_mismatch:manifest=${byNormPath.size},allowed=${allowedFiles.length}`);
        }
        for (const af of allowedFiles) {
          const rec = byNormPath.get(af);
          if (!rec) {
            manifestViolations.push(`allowed_file_not_in_manifest:${af}`);
            continue;
          }
          if (!SHA256_HEX_RE.test(String(rec.sha256 || ""))) {
            manifestViolations.push(`manifest_invalid_staged_sha256:${af}`);
            continue;
          }
          const diskPath = typeof stagedFilePathResolver === "function" ? stagedFilePathResolver(rec.path) : rec.path;
          if (!fs.existsSync(diskPath)) {
            manifestViolations.push(`staged_file_missing_on_disk:${diskPath}`);
            continue;
          }
          const actualSha = sha256File(diskPath);
          if (actualSha !== rec.sha256) {
            manifestViolations.push(`staged_file_sha256_mismatch:${af}:expected=${rec.sha256},actual=${actualSha}`);
          } else {
            verifiedManifestHashes.staged_file_hashes_verified[af] = actualSha;
          }
        }
      }
    }
  }

  if (spec) {
    if (!RUN_ID_REGEX.test(String(spec.runId || ""))) {
      configViolations.push(`prompt_spec_invalid_run_id:${String(spec.runId)}`);
    }
    if (!BLIND_ID_REGEX.test(String(spec.blindId || ""))) {
      configViolations.push(`prompt_spec_invalid_blind_id:${String(spec.blindId)}`);
    }
    if (expectedBlindId && spec.blindId !== expectedBlindId) {
      configViolations.push(`blind_id_mismatch_for_video_id:expected=${expectedBlindId},spec=${String(spec.blindId)}`);
    }
    if (String(spec.blindId || "").toLowerCase() === String(videoId || "").toLowerCase()) {
      configViolations.push("prompt_spec_uses_original_video_id");
    }
  }

  // Validate EVERY allowed file strictly against mechanical grammar + blindId match + no original videoId
  const videoIdLow = String(videoId || "").toLowerCase();
  for (const f of allowedFiles) {
    if (!f.startsWith(BLIND_ROOT_PREFIX)) {
      pathPolicyViolations.push(`Allowed file outside isolated root (${BLIND_ROOT_PREFIX}): ${f}`);
      continue;
    }
    if (videoIdLow.length >= 5 && f.includes(videoIdLow)) {
      pathPolicyViolations.push(`original_video_id_in_path:${f}`);
    }
    const m = f.match(STRICT_ISOLATED_FILE_RE);
    if (!m) {
      pathPolicyViolations.push(`path_violates_strict_mechanical_grammar:${f}`);
      continue;
    }
    const [, pathRunId, pathMode, folderId, filePrefixId] = m;
    if (folderId !== filePrefixId) {
      pathPolicyViolations.push(`folder_filename_id_mismatch:${folderId}!=${filePrefixId}`);
    }
    if (expectedRunId && pathRunId !== expectedRunId.toLowerCase()) {
      pathPolicyViolations.push(`path_run_id_mismatch:expected=${expectedRunId},got=${pathRunId}`);
    }
    if (expectedBlindId && folderId !== expectedBlindId.toLowerCase()) {
      pathPolicyViolations.push(`path_blind_id_mismatch_for_video_id:expected=${expectedBlindId},got=${folderId}`);
    }
    if (spec?.mode && pathMode !== spec.mode) {
      pathPolicyViolations.push(`path_mode_mismatch:expected=${spec.mode},got=${pathMode}`);
    }
  }

  // Build expected frozen prompt if promptSpec is supplied
  let expectedPrompt = null;
  let promptSpecError = null;
  if (spec) {
    try {
      validateAssignedFilePaths({
        runId: spec.runId,
        blindId: spec.blindId,
        mode: spec.mode,
        assignedFiles: spec.assignedFiles,
        slowmoApplied: Boolean(spec.metrics?.slowmo_applied),
      });
      expectedPrompt = renderCalibrationPrompt(spec).replace(/\r\n/g, "\n").trim();
      const specFilesNorm = (spec.assignedFiles || []).map(normWinPath).sort();
      const allowedSorted = [...allowedFiles].sort();
      if (JSON.stringify(specFilesNorm) !== JSON.stringify(allowedSorted)) {
        configViolations.push("prompt_spec_assigned_files_mismatch_allowed_files");
      }
    } catch (e) {
      promptSpecError = e.message;
      configViolations.push(`prompt_spec_render_failed:${e.message}`);
    }
  }

  const benchPath = path.join(REPO_ROOT, "analysis", "golden_benchmark.json");
  const bench = fs.existsSync(benchPath) ? JSON.parse(fs.readFileSync(benchPath, "utf8")) : [];
  const meta = bench.find(x => x.id === videoId) || null;
  const videoSpecificPatterns = buildVideoSpecificPatterns(meta, videoId, channelName);

  const steps = loadTranscriptSteps(transcriptPath);
  const promptLeakViolations = [];
  const promptExactMatchViolations = [];
  const toolViolations = [];
  const mediaViolations = [];
  const readFilesCalled = new Set();
  const verifiedMediaByFile = {};
  let incomingPromptCount = 0;
  let sendMessageToParentCount = 0;
  let totalToolCalls = 0;

  let modelName = null;
  let maxInputTokens = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let firstPostReadInputTokens = null;
  let seenAnyRead = false;

  for (let idx = 0; idx < steps.length; idx++) {
    const step = steps[idx];

    if (step.type === "PLANNER_RESPONSE") {
      if (step.model && !modelName) modelName = step.model;
      if (typeof step.input_tokens === "number") {
        totalInputTokens += step.input_tokens;
        if (step.input_tokens > maxInputTokens) maxInputTokens = step.input_tokens;
        if (seenAnyRead && firstPostReadInputTokens === null) {
          firstPostReadInputTokens = step.input_tokens;
        }
      }
      if (typeof step.output_tokens === "number") {
        totalOutputTokens += step.output_tokens;
      }
    }

    const isIncomingPrompt =
      step.type === "USER_INPUT" ||
      step.type === "SYSTEM_MESSAGE" ||
      step.source === "USER_EXPLICIT" ||
      step.source === "SYSTEM" ||
      (typeof step.content === "string" && step.content.includes("<SYSTEM_MESSAGE>"));

    if (isIncomingPrompt && typeof step.content === "string" && step.content.length > 0) {
      incomingPromptCount++;
      const extracted = extractParentMessageContent(step.content);

      if (expectedPrompt !== null) {
        if (extracted !== expectedPrompt) {
          let diffPos = 0;
          const minLen = Math.min(extracted.length, expectedPrompt.length);
          while (diffPos < minLen && extracted[diffPos] === expectedPrompt[diffPos]) diffPos++;
          promptExactMatchViolations.push({
            step_index: step.step_index,
            reason: "prompt_exact_match_mismatch",
            expected_length: expectedPrompt.length,
            actual_length: extracted.length,
            first_diff_index: diffPos,
            actual_snippet: extracted.slice(Math.max(0, diffPos - 20), diffPos + 60),
          });
        }
      } else {
        for (const p of GLOBAL_FORBIDDEN_PROMPT_PATTERNS) {
          const m = extracted.match(p.re);
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

      for (const p of videoSpecificPatterns) {
        const m = extracted.match(p.re);
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

    if (Array.isArray(step.tool_calls)) {
      for (let k = 0; k < step.tool_calls.length; k++) {
        const tc = step.tool_calls[k];
        totalToolCalls++;
        const name = tc.name || tc.tool_name || "";
        const tcArgs = tc.arguments || tc.args || {};

        if (name === "read_file") {
          seenAnyRead = true;
          const rawTargetPath = decodeArgString(tcArgs.Path ?? tcArgs.path ?? "");
          if (rawTargetPath.includes("..")) {
            toolViolations.push({
              step_index: step.step_index,
              tool: name,
              reason: "read_file_path_traversal",
              target: rawTargetPath,
            });
          }
          const normTarget = normWinPath(rawTargetPath);
          readFilesCalled.add(normTarget);
          if (!allowedFileSet.has(normTarget)) {
            toolViolations.push({
              step_index: step.step_index,
              tool: name,
              reason: "read_file_outside_allowed_files",
              target: rawTargetPath,
            });
          }
          if (!normTarget.startsWith(BLIND_ROOT_PREFIX)) {
            toolViolations.push({
              step_index: step.step_index,
              tool: name,
              reason: "read_file_outside_blind_root",
              target: rawTargetPath,
            });
          }
          if (videoIdLow.length >= 5 && normTarget.includes(videoIdLow)) {
            toolViolations.push({
              step_index: step.step_index,
              tool: name,
              reason: "read_file_contains_original_video_id",
              target: rawTargetPath,
            });
          }
          const pm = normTarget.match(STRICT_ISOLATED_FILE_RE);
          if (!pm) {
            toolViolations.push({
              step_index: step.step_index,
              tool: name,
              reason: "read_file_violates_strict_mechanical_grammar",
              target: rawTargetPath,
            });
          } else if (expectedBlindId && (pm[3] !== expectedBlindId.toLowerCase() || pm[4] !== expectedBlindId.toLowerCase())) {
            toolViolations.push({
              step_index: step.step_index,
              tool: name,
              reason: "read_file_blind_id_mismatch",
              target: rawTargetPath,
              expected_blind_id: expectedBlindId,
            });
          }

          const respStep = steps[idx + 1 + k];
          const matcher = expectedMimeMatcher(normTarget);
          const respMedia = Array.isArray(respStep?.media) ? respStep.media : [];
          const matchedMedia = respStep && respStep.status === "DONE"
            ? respMedia.find(m => m && matcher.test(m.mime_type))
            : null;
          if (matchedMedia) {
            verifiedMediaByFile[normTarget] = matchedMedia.mime_type;
          } else {
            mediaViolations.push({
              step_index: step.step_index,
              response_step_index: respStep ? respStep.step_index : null,
              target: rawTargetPath,
              expected_mime: matcher.expected,
              actual_status: respStep ? respStep.status : "missing_response_step",
              actual_media: respMedia.map(m => m?.mime_type || null),
            });
          }
        } else if (name === "send_message") {
          const recipient = decodeArgString(tcArgs.Recipient ?? tcArgs.recipient ?? "");
          if (!parentId || recipient !== parentId) {
            toolViolations.push({
              step_index: step.step_index,
              tool: name,
              reason: parentId ? "send_message_to_non_parent" : "send_message_parent_id_not_configured",
              recipient,
            });
          } else {
            sendMessageToParentCount++;
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

  if (expectedPrompt !== null && incomingPromptCount === 0) {
    promptExactMatchViolations.push({
      step_index: null,
      reason: "missing_incoming_parent_prompt",
    });
  }

  const missingFileReads = allowedFiles.filter(f => !readFilesCalled.has(f));
  const missingMediaFiles = allowedFiles.filter(f => !verifiedMediaByFile[f]);

  const valid =
    configViolations.length === 0 &&
    pathPolicyViolations.length === 0 &&
    manifestViolations.length === 0 &&
    promptExactMatchViolations.length === 0 &&
    promptLeakViolations.length === 0 &&
    toolViolations.length === 0 &&
    mediaViolations.length === 0 &&
    missingFileReads.length === 0 &&
    missingMediaFiles.length === 0 &&
    (!strict || sendMessageToParentCount >= 1);

  return {
    valid,
    strict,
    video_id: videoId,
    expected_blind_id: expectedBlindId,
    expected_run_id: expectedRunId,
    transcript_path: transcriptPath,
    prompt_exact_match_checked: expectedPrompt !== null,
    prompt_spec_error: promptSpecError,
    incoming_prompt_count: incomingPromptCount,
    allowed_files: allowedFiles,
    read_files_called: [...readFilesCalled],
    missing_file_reads: missingFileReads,
    verified_media_by_file: verifiedMediaByFile,
    missing_media_files: missingMediaFiles,
    verified_manifest_hashes: verifiedManifestHashes,
    send_message_to_parent_count: sendMessageToParentCount,
    total_tool_calls: totalToolCalls,
    token_usage: {
      model: modelName,
      first_post_read_input_tokens: firstPostReadInputTokens,
      max_input_tokens: maxInputTokens,
      total_input_tokens: totalInputTokens,
      total_output_tokens: totalOutputTokens,
    },
    config_violations: configViolations,
    path_policy_violations: pathPolicyViolations,
    manifest_violations: manifestViolations,
    prompt_exact_match_violations: promptExactMatchViolations,
    prompt_leak_violations: promptLeakViolations,
    tool_violations: toolViolations,
    media_violations: mediaViolations,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const transcriptPath = args["transcript"];
  const videoId = args["video-id"];
  const allowedFilesRaw = args["allowed-files"] || "";
  const parentId = args["parent-id"] || null;
  const channelName = args["channel-name"] || null;
  const promptSpecPath = args["prompt-spec"] || null;
  const blindMapPath = args["blind-map"] || null;
  const runManifestPath = args["run-manifest"] || null;
  const strict = Boolean(args["strict"]);

  if (!transcriptPath || !videoId || !allowedFilesRaw) {
    console.error(
      "Usage: node scripts/audit-blind-transcript.mjs --transcript <path> --video-id <id> --allowed-files <p1,p2> --parent-id <convId> --prompt-spec <spec.json> --blind-map <map.json> --run-manifest <manifest.json> [--channel-name <name>] [--strict]"
    );
    process.exit(2);
  }

  const report = auditTranscript({
    transcriptPath,
    videoId,
    allowedFilesRaw,
    parentId,
    channelName,
    promptSpecPath,
    blindMapPath,
    runManifestPath,
    strict,
  });

  console.log(JSON.stringify(report, null, 2));
  if (strict && !report.valid) process.exit(1);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase();
if (isCli) {
  main();
}
