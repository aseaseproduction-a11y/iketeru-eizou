import type { Video } from "./types";

const PITCH_HEADING = "### クライアント説明用・企画意図3行まとめ";
const PITCH_HEADING_REGEX = /(?:^|\n)###\s*(?:📋\s*)?クライアント説明用(?:の言語化フレーズ|・企画意図3行まとめ)[^\n]*\n([\s\S]*?)(?=\n#{2,3}\s|$)/;

/**
 * 独立フィールド `curationNote.clientPitch` を優先取得し、
 * バックエンド側の制約で未保持の場合は aiAnalysis 第9章内の専用セクションから抽出する。
 */
export function extractClientPitch(video: Pick<Video, "curationNote" | "aiAnalysis">): string {
  const direct = video.curationNote?.clientPitch?.trim();
  if (direct) return direct;

  const analysis = video.aiAnalysis || "";
  const match = analysis.match(PITCH_HEADING_REGEX);
  return match?.[1]?.trim() || "";
}

/**
 * UIからクライアント説明用フレーズが編集された際、aiAnalysis 内の対応セクションも同期更新する。
 */
export function upsertClientPitchInAnalysis(aiAnalysis: string, clientPitch: string): string {
  const base = (aiAnalysis || "").replace(/\r\n/g, "\n");
  const trimmedPitch = clientPitch.trim();

  if (PITCH_HEADING_REGEX.test(base)) {
    if (!trimmedPitch) {
      return base
        .replace(PITCH_HEADING_REGEX, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    return base.replace(PITCH_HEADING_REGEX, `\n${PITCH_HEADING}\n${trimmedPitch}`).trim();
  }

  if (!trimmedPitch) return aiAnalysis;
  const block = `${PITCH_HEADING}\n${trimmedPitch}`;
  return base.trim() ? `${base.trim()}\n\n${block}` : block;
}
