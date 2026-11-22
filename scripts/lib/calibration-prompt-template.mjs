import path from "node:path";

export const BLIND_ROOT_REGEX = /^E:\\iketeru_blind_eval\\[A-Za-z0-9_-]+\\(video|contact_sheet)\\[A-Za-z0-9_-]+\\[A-Za-z0-9_.-]+\.(mp4|jpg|jpeg|png)$/i;

export const PROMPT_VERSIONS = Object.freeze(["v1_baseline"]);

function assertFiniteNumber(val, name) {
  if (typeof val !== "number" || !Number.isFinite(val)) {
    throw new Error(`Invalid numeric metric "${name}": ${String(val)}`);
  }
  return val;
}

function assertNonNegativeInt(val, name) {
  if (typeof val !== "number" || !Number.isInteger(val) || val < 0) {
    throw new Error(`Invalid non-negative integer metric "${name}": ${String(val)}`);
  }
  return val;
}

export function validateAssignedFilePath(filePath, mode) {
  if (typeof filePath !== "string" || filePath.includes("..") || filePath.includes("\n") || filePath.includes("\r")) {
    throw new Error(`Invalid assigned file path: ${String(filePath)}`);
  }
  const normalized = path.win32.normalize(filePath.replace(/\//g, "\\"));
  if (!BLIND_ROOT_REGEX.test(normalized)) {
    throw new Error(`Assigned file path does not match strict isolated pattern: ${normalized}`);
  }
  const modeToken = `\\${mode}\\`;
  if (!normalized.toLowerCase().includes(modeToken)) {
    throw new Error(`Assigned file path "${normalized}" does not match mode "${mode}"`);
  }
  return normalized;
}

export function validateMetrics(metrics) {
  if (!metrics || typeof metrics !== "object") {
    throw new Error("metrics object is required");
  }
  const duration_sec = assertFiniteNumber(metrics.duration_sec, "duration_sec");
  if (duration_sec <= 0) throw new Error(`duration_sec must be > 0: ${duration_sec}`);
  const scdet_threshold = assertFiniteNumber(metrics.scdet_threshold, "scdet_threshold");
  const total_cuts = assertNonNegativeInt(metrics.total_cuts, "total_cuts");
  const avg_cut_interval_sec = assertFiniteNumber(metrics.avg_cut_interval_sec, "avg_cut_interval_sec");
  if (avg_cut_interval_sec < 0) throw new Error(`avg_cut_interval_sec must be >= 0: ${avg_cut_interval_sec}`);
  const max_cuts_per_10s = assertNonNegativeInt(metrics.max_cuts_per_10s, "max_cuts_per_10s");

  let integrated_lufs = null;
  if (metrics.integrated_lufs !== null && metrics.integrated_lufs !== undefined) {
    integrated_lufs = assertFiniteNumber(metrics.integrated_lufs, "integrated_lufs");
  }

  if (typeof metrics.slowmo_applied !== "boolean") {
    throw new Error(`slowmo_applied must be boolean: ${String(metrics.slowmo_applied)}`);
  }
  let slowmo_factor = null;
  let slowmo_window_sec = null;
  if (metrics.slowmo_applied) {
    if (metrics.slowmo_factor !== "2x" && metrics.slowmo_factor !== "4x") {
      throw new Error(`Invalid slowmo_factor: ${String(metrics.slowmo_factor)}`);
    }
    slowmo_factor = metrics.slowmo_factor;
    if (
      !Array.isArray(metrics.slowmo_window_sec) ||
      metrics.slowmo_window_sec.length !== 2
    ) {
      throw new Error(`Invalid slowmo_window_sec: ${JSON.stringify(metrics.slowmo_window_sec)}`);
    }
    const w0 = assertFiniteNumber(metrics.slowmo_window_sec[0], "slowmo_window_sec[0]");
    const w1 = assertFiniteNumber(metrics.slowmo_window_sec[1], "slowmo_window_sec[1]");
    if (w0 < 0 || w1 <= w0) {
      throw new Error(`Invalid slowmo_window_sec range: [${w0}, ${w1}]`);
    }
    slowmo_window_sec = [w0, w1];
  } else {
    if (metrics.slowmo_factor !== null && metrics.slowmo_factor !== undefined) {
      throw new Error(`slowmo_factor must be null when slowmo_applied=false`);
    }
    if (metrics.slowmo_window_sec !== null && metrics.slowmo_window_sec !== undefined) {
      throw new Error(`slowmo_window_sec must be null when slowmo_applied=false`);
    }
  }

  return {
    duration_sec,
    scdet_threshold,
    total_cuts,
    avg_cut_interval_sec,
    max_cuts_per_10s,
    integrated_lufs,
    slowmo_applied: metrics.slowmo_applied,
    slowmo_factor,
    slowmo_window_sec,
  };
}

function fmtNum(n, digits = 2) {
  return Number(n).toFixed(digits);
}

/**
 * Renders the frozen blind scoring prompt strictly from:
 * - frozen template version
 * - mode ("video" | "contact_sheet")
 * - strictly validated isolated file paths inside E:\iketeru_blind_eval\
 * - strictly validated numeric scdet/LUFS metrics
 * No free-text metadata (title, channel, awards, DB text) can ever be injected.
 */
export function renderCalibrationPrompt({ version, mode, assignedFiles, metrics }) {
  if (!PROMPT_VERSIONS.includes(version)) {
    throw new Error(`Unsupported prompt version: ${String(version)}`);
  }
  if (mode !== "video" && mode !== "contact_sheet") {
    throw new Error(`Unsupported mode: ${String(mode)}`);
  }
  if (!Array.isArray(assignedFiles) || assignedFiles.length === 0) {
    throw new Error("assignedFiles must be a non-empty array");
  }

  const safeFiles = assignedFiles.map(f => validateAssignedFilePath(f, mode));
  const safeMetrics = validateMetrics(metrics);

  const fileListLines = safeFiles.map((f, idx) => `${idx + 1}. \`${f}\``).join("\n");
  const modeDesc = mode === "video"
    ? (safeMetrics.slowmo_applied
      ? `割り当てファイルは全編動画（約1fps映像＋連続音声）と、高密度区間 [${fmtNum(safeMetrics.slowmo_window_sec[0], 1)}s - ${fmtNum(safeMetrics.slowmo_window_sec[1], 1)}s] の ${safeMetrics.slowmo_factor} スロー無音クリップです。全ファイルを必ず \`read_file\` で読み込んでください。`
      : "割り当てファイルは全編動画（約1fps映像＋連続音声）です。必ず `read_file` で読み込んでください。")
    : (safeMetrics.slowmo_applied
      ? `割り当てファイルは全編のコンタクトシート画像と、高密度区間 [${fmtNum(safeMetrics.slowmo_window_sec[0], 1)}s - ${fmtNum(safeMetrics.slowmo_window_sec[1], 1)}s] の高密度4x4コンタクトシート画像です。全ファイルを必ず \`read_file\` で読み込んでください。`
      : "割り当てファイルは全編のコンタクトシート画像です。全ファイルを必ず `read_file` で読み込んでください。");

  const lufsText = safeMetrics.integrated_lufs === null
    ? "N/A（無音または音声トラック無し）"
    : `${fmtNum(safeMetrics.integrated_lufs, 1)} LUFS`;

  const slowmoSummary = safeMetrics.slowmo_applied
    ? `適用あり（${safeMetrics.slowmo_factor} / 区間 ${fmtNum(safeMetrics.slowmo_window_sec[0], 1)}s - ${fmtNum(safeMetrics.slowmo_window_sec[1], 1)}s）`
    : "なし";

  // Frozen v1_baseline template
  return [
    `[CALIBRATION_BLIND_EVAL | ${version} | mode=${mode}]`,
    "",
    "あなたは映像制作・演出の専門審査員です。以下の割り当てファイルのみを観察し、映像クラフトの到達度を0〜100点で独立採点してください。",
    "",
    "## 厳守事項（違反時は採点無効）",
    "- 使用してよいツールは、下記の割り当てファイルに対する `read_file` と、親エージェントへ結果を返す `send_message` の2種類のみです。",
    "- 割り当て以外のファイル閲覧、コマンド実行、Web検索は一切禁止します。",
    "- 割り当てられた全ファイルを必ず `read_file` で読み込んだうえで採点してください。",
    "",
    "## 割り当てファイル",
    fileListLines,
    "",
    modeDesc,
    "",
    "## 共通実測データ（ffmpeg 計測値）",
    `- 総尺: ${fmtNum(safeMetrics.duration_sec, 1)} 秒`,
    `- カット検出（scdet threshold=${fmtNum(safeMetrics.scdet_threshold, 1)}）: 総カット数 ${safeMetrics.total_cuts} 回 / 平均カット間隔 ${fmtNum(safeMetrics.avg_cut_interval_sec, 2)} 秒 / 10秒窓最大カット数 ${safeMetrics.max_cuts_per_10s} 回`,
    `- 統合ラウドネス（ebur128）: ${lufsText}`,
    `- 高密度区間追加確認: ${slowmoSummary}`,
    "",
    "## 採点ルーブリック（100点満点・クラフト実行力優先）",
    "以下の5項目を各0〜20点で採点し、合計点（0〜100の整数）と対応ランクを決定してください。アイデア単体ではなく、映像としての実行・クラフト（purpose-driven craft）が物語や感情をどれだけ引き上げているかを厳格に評価します。",
    "1. `direction` (0-20): 演出設計・構成力・感情曲線・意図の一貫性",
    "2. `visual_craft` (0-20): 撮影・ライティング・美術・構図・カラグレーディング・VFX/CG/アニメーションの完成度",
    "3. `editing_rhythm` (0-20): 編集テンポ・カット割り・緩急・トランジション・視覚的リズム",
    "4. `sound_integration` (0-20): 音響・音楽・SE・間合いと映像の統合度（※静止画方式で音声非聴取の場合は実測LUFSと視覚的テンポから中立推定し、根拠欄に明記）",
    "5. `originality_finish` (0-20): 表現の独自性・記憶残留力・細部の仕上げ品質（定型・量産的ショートカットは厳しく減点）",
    "",
    "### 点数帯とランク対応表（審査基準）",
    "- `S+` (97-100): 歴史的・世界最高峰の映像クラフト到達点。全要素が極めて高次元で融合",
    "- `S`  (93-96): 国際最上位水準の傑作。圧倒的な演出・技術・完成度",
    "- `S-` (90-92): 国際上位水準の秀作。複数分野で際立つクラフト強度",
    "- `A+` (86-89): 国内外の一線級プロ水準を大きく超える高到達作",
    "- `A`  (82-85): 明確な技術的・演出的強みを持つ上位プロ品質",
    "- `A-` (78-81): 確かな工夫と完成度を備えた良質なプロ作品",
    "- `B+` (73-77): 商業品質として堅実で一部に見どころがある水準",
    "- `B`  (68-72): 標準的な商業・企業映像品質（大きな欠点はないが特筆点も限定的）",
    "- `B-` (63-67): 実用レベルだが演出・構成・仕上げのいずれかに粗さ・凡庸さが残る",
    "- `C+` (57-62): 意図は伝わるが映像表現・技術面で課題が目立つ",
    "- `C`  (51-56): 基礎的な撮影・編集・デザインに明確な不足がある",
    "- `C-` (45-50): 品質・視認性・構成の破綻が大きい",
    "- `D`  (0-44): 重大な技術的・演出的欠陥があり商業水準に大きく未達",
    "",
    "## 出力形式（厳守・JSON のみ）",
    "点数確定後、同じ JSON 内に必ず末尾3項目の自己申告（`post_check`）を含め、`send_message` で親エージェントへ返答してください。",
    "```json",
    "{",
    '  "scores": {',
    '    "direction": 0,',
    '    "visual_craft": 0,',
    '    "editing_rhythm": 0,',
    '    "sound_integration": 0,',
    '    "originality_finish": 0',
    "  },",
    '  "total_score": 0,',
    '  "rank": "B",',
    '  "brief_rationale": "200文字以内で視覚・構成・技術上の根拠を記述",',
    '  "post_check": {',
    '    "knows_work": false,',
    '    "knows_award_history": false,',
    '    "award_badge_visible_in_video": false,',
    '    "post_check_note": "該当がある場合は簡潔に理由を記述（なければ空文字）"',
    "  }",
    "}",
    "```",
  ].join("\n");
}

/**
 * Extracts the exact parent-delivered prompt payload from a subagent transcript step content.
 * Handles Antigravity's <SYSTEM_MESSAGE> [Message] ... content=... wrapper as well as raw USER_INPUT.
 */
export function extractParentMessageContent(stepContent) {
  const s = String(stepContent || "").replace(/\r\n/g, "\n");
  const wrapped = s.match(/<SYSTEM_MESSAGE>\s*\[Message\][^\n]*?\scontent=([\s\S]*?)\n<\/SYSTEM_MESSAGE>/);
  if (wrapped) {
    return wrapped[1].trim();
  }
  return s.trim();
}
