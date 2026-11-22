import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const RUN_ID_REGEX = /^run_\d{8}_\d{6}$/;
export const BLIND_ID_REGEX = /^[a-f0-9]{12}$/;
export const BLIND_ROOT_PREFIX = "e:\\iketeru_blind_eval\\";

export function generateRunId(date = new Date()) {
  const pad = n => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `run_${y}${mo}${d}_${h}${mi}${s}`;
}

export function generateBlindIdMap(runId, videoIds) {
  if (!RUN_ID_REGEX.test(runId)) {
    throw new Error(`Invalid run_id format (expected ^run_\\d{8}_\\d{6}$): ${runId}`);
  }
  const uniqueVideoIds = [...new Set(videoIds)];
  const videoIdLowerSet = new Set(uniqueVideoIds.map(v => String(v).toLowerCase()));
  const blindToVideo = {};
  const videoToBlind = {};

  for (const vid of uniqueVideoIds) {
    let bid = null;
    while (!bid || blindToVideo[bid] || videoIdLowerSet.has(bid)) {
      bid = crypto.randomBytes(6).toString("hex"); // 12-char lowercase hex alphanumeric
    }
    blindToVideo[bid] = vid;
    videoToBlind[vid] = bid;
  }

  return {
    run_id: runId,
    created_at: new Date().toISOString(),
    blind_id_format: "^[a-f0-9]{12}$",
    count: uniqueVideoIds.length,
    video_to_blind: videoToBlind,
    blind_to_video: blindToVideo,
  };
}

export function saveBlindIdMap(mapPath, mapObj) {
  const norm = path.win32.resolve(mapPath.replace(/\//g, "\\")).toLowerCase();
  if (norm.startsWith(BLIND_ROOT_PREFIX)) {
    throw new Error(`Refusing to write blind_id_map inside isolated blind root: ${mapPath}`);
  }
  fs.mkdirSync(path.dirname(mapPath), { recursive: true });
  fs.writeFileSync(mapPath, JSON.stringify(mapObj, null, 2) + "\n", "utf8");
}

export function validateBlindIdMappingForVideo(mapObj, runId, videoId) {
  const errors = [];
  if (!mapObj || typeof mapObj !== "object") {
    return { ok: false, blindId: null, errors: ["blind_map_missing_or_invalid"] };
  }
  if (!RUN_ID_REGEX.test(String(mapObj.run_id || ""))) {
    errors.push("blind_map_invalid_run_id");
  }
  if (runId && mapObj.run_id !== runId) {
    errors.push(`blind_map_run_id_mismatch:${mapObj.run_id}!=${runId}`);
  }

  const v2b = mapObj.video_to_blind || {};
  const b2v = mapObj.blind_to_video || {};
  const blindId = v2b[videoId] || null;

  if (!blindId) {
    errors.push(`blind_map_missing_video_id:${videoId}`);
    return { ok: false, blindId: null, errors };
  }
  if (!BLIND_ID_REGEX.test(blindId)) {
    errors.push(`blind_map_invalid_blind_id_format:${blindId}`);
  }
  if (String(blindId).toLowerCase() === String(videoId).toLowerCase()) {
    errors.push("blind_id_equals_original_video_id");
  }
  if (b2v[blindId] !== videoId) {
    errors.push(`blind_map_bijection_broken:${blindId}->${String(b2v[blindId])}`);
  }

  return { ok: errors.length === 0, blindId, errors };
}
