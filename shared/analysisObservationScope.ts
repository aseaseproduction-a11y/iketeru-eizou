export type KnownAnalysisObservationScope =
  | "metadata_only_unwatched"
  | "triage_boilerplate_unwatched"
  | "triage_unverified_short"
  | "missing_video_unwatched";

export type AnalysisObservationScope = KnownAnalysisObservationScope | (string & {});

export type ObservationWarningSeverity = "high" | "medium";

export interface AnalysisObservationScopeWarning {
  scope: string;
  isKnown: boolean;
  severity: ObservationWarningSeverity;
  badgeLabel: string;
  title: string;
  description: string;
  calibratedScoreNote: string | null;
}

const CALIBRATED_SCORE_CONFLICT_NOTE =
  "※ 校正済みスコアは実動画視聴によるブラインド採点済みですが、下の詳細分析テキストは未視聴版のまま残っています。";

const SCOPE_DEFINITIONS: Record<
  KnownAnalysisObservationScope,
  Omit<AnalysisObservationScopeWarning, "scope" | "isKnown" | "calibratedScoreNote">
> = {
  metadata_only_unwatched: {
    severity: "high",
    badgeLabel: "未視聴・メタデータのみ",
    title: "未視聴分析（メタデータのみ）",
    description:
      "この詳細分析は動画本編を視聴せず、公式メタデータ・クレジット・サムネイル情報のみをもとに作成された一次記録です。演出・手法の根拠としてそのまま参照しないでください（映像確認による再分析待ち）。",
  },
  triage_boilerplate_unwatched: {
    severity: "high",
    badgeLabel: "未視聴・定型速報",
    title: "未視聴分析（定型速報のみ）",
    description:
      "この詳細分析は映像の実測値（解像度・fps・音量等）を伴わない定型テンプレートによる一次速報です。実際の映像を確認した記録ではないため、参考・手本としての利用にはご注意ください。",
  },
  triage_unverified_short: {
    severity: "medium",
    badgeLabel: "要確認・実測なし",
    title: "要確認（短文速報・実測なし）",
    description:
      "この詳細分析には固有の短文メモがありますが、映像の実測値（解像度・fps・音量等）の記載がなく、実視聴に基づく記録かどうか未確認です。白黒確認の再分析が完了するまで参考扱いとしてください。",
  },
  missing_video_unwatched: {
    severity: "high",
    badgeLabel: "未視聴・動画未取得",
    title: "未視聴分析（動画未取得）",
    description:
      "動画ファイルを取得できない状態で作成された未視聴記録です。実際の映像を確認した分析ではないため、演出・手法の参照にはご注意ください。",
  },
};

export const KNOWN_UNWATCHED_OBSERVATION_SCOPES = Object.keys(
  SCOPE_DEFINITIONS,
) as KnownAnalysisObservationScope[];

export function normalizeAnalysisObservationScope(
  scope: string | null | undefined,
): string | null {
  if (typeof scope !== "string") return null;
  const trimmed = scope.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isUnwatchedAnalysisScope(
  scope: string | null | undefined,
): boolean {
  return normalizeAnalysisObservationScope(scope) !== null;
}

export function getAnalysisObservationScopeWarning(
  scope: string | null | undefined,
  options?: { hasCalibratedScore?: boolean },
): AnalysisObservationScopeWarning | null {
  const normalized = normalizeAnalysisObservationScope(scope);
  if (!normalized) return null;

  const calibratedScoreNote = options?.hasCalibratedScore
    ? CALIBRATED_SCORE_CONFLICT_NOTE
    : null;

  if (normalized in SCOPE_DEFINITIONS) {
    const def = SCOPE_DEFINITIONS[normalized as KnownAnalysisObservationScope];
    return {
      scope: normalized,
      isKnown: true,
      ...def,
      calibratedScoreNote,
    };
  }

  return {
    scope: normalized,
    isKnown: false,
    severity: "medium",
    badgeLabel: "未視聴・要確認",
    title: `未視聴・要確認の分析（${normalized}）`,
    description: `この詳細分析には観察範囲の制限タグ（${normalized}）が付与されています。実視聴に基づく記録ではない可能性があるため、内容の参照にはご注意ください。`,
    calibratedScoreNote,
  };
}
