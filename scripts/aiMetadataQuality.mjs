export const AI_CONFIDENCE_THRESHOLD = 0.9;

const arrayFields = ["genres", "products", "directions", "tones", "purposes", "expressions"];
const scalarFields = ["privateRating", "aiOverallRating", "aiDirectionRating", "aiTechniqueRating", "aiAnalysis"];
const confidenceField = {
  genres: "genres", products: "products", directions: "directions", tones: "tones",
  purposes: "purposes", expressions: "expressions",
  privateRating: "ratings", aiOverallRating: "ratings", aiDirectionRating: "ratings", aiTechniqueRating: "ratings",
  aiAnalysis: "analysis",
};

function normalized(value) {
  return String(value ?? "").toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, "");
}

function sourceText(input) {
  return [
    input.title, input.videoUrl, input.source, input.sourceLabel, input.channelTitle,
    ...(Array.isArray(input.tags) ? input.tags : []), JSON.stringify(input.curationNote ?? {}),
    input.publicMetadata?.description, input.publicMetadata?.channelTitle, input.publicMetadata?.publishedAt,
    ...(Array.isArray(input.publicMetadata?.tags) ? input.publicMetadata.tags : []),
  ].map(normalized).join(" ");
}

function hasValue(field, value) {
  return arrayFields.includes(field) ? Array.isArray(value) && value.length > 0 : typeof value === "string" && value.trim().length > 0;
}

const directCueRules = {
  genres: {
    "tv-cm": ["tvcm", "tvspot"],
    "web-cm": ["webcm"],
    "branded-movie": ["brandedmovie", "ブランドムービー"],
    "youtube-sns": ["youtube", "sns", "shorts"],
    mv: ["mv", "musicvideo", "ミュージックビデオ"],
    corporate: ["企業vp", "companyprofile", "corporatevideo"],
    film: ["shortfilm", "shortmovie", "短編映画"],
    opening: ["opening", "オープニング"],
    making: ["making", "メイキング", "behindthescenes"],
    documentary: ["documentary", "ドキュメンタリー"],
  },
  products: {
    food: ["食品", "飲料", "beverage", "chocolate", "チョコ", "cider", "サイダー"],
    entertainment: ["netflix", "entertainmentservice", "映像配信"],
  },
  directions: {
    "vfx-3dcg": ["vfx", "3dcg", "3dcg", "cg"],
    "generative-ai": ["生成ai", "generativeai", "ai創作", "ai生成"],
  },
  purposes: { MV: ["mv", "musicvideo", "ミュージックビデオ"], "ティザー": ["teaser", "ティザー"] },
  expressions: { "生成AI": ["生成ai", "generativeai", "ai創作", "ai生成"] },
};

export function valuesHaveDirectCues(field, values, evidence) {
  const evidenceText = (Array.isArray(evidence) ? evidence : []).map(normalized).join(" ");
  const rules = directCueRules[field];
  if (!rules || !Array.isArray(values)) return false;
  return values.every((value) => {
    const cues = rules[value];
    return Array.isArray(cues) && cues.some((cue) => evidenceText.includes(cue));
  });
}

export function identityMatches(candidate, input) {
  const identity = candidate?.identity;
  return Boolean(identity)
    && identity.videoId === input.id
    && identity.videoUrl === input.videoUrl
    && identity.title === input.title;
}

export function evidenceIsGrounded(evidence, input) {
  if (!Array.isArray(evidence)) return false;
  const available = sourceText(input);
  return evidence.some((quote) => {
    const excerpt = normalized(quote);
    return excerpt.length >= 2 && available.includes(excerpt);
  });
}

/** Return field-level eligibility without mutating database data. */
export function assessAiCandidate(candidate, input) {
  const identityOk = identityMatches(candidate, input);
  const eligible = [];
  const rejected = {};
  for (const field of [...arrayFields, ...scalarFields]) {
    if (!identityOk) {
      rejected[field] = "identity_mismatch";
      continue;
    }
    if (!hasValue(field, candidate?.[field])) {
      rejected[field] = "empty_candidate";
      continue;
    }
    const confidence = Number(candidate?.confidence?.[confidenceField[field]] ?? 0);
    if (!Number.isFinite(confidence) || confidence < AI_CONFIDENCE_THRESHOLD) {
      rejected[field] = "confidence_below_threshold";
      continue;
    }
    if (!evidenceIsGrounded(candidate?.evidence?.[field], input)) {
      rejected[field] = "ungrounded_evidence";
      continue;
    }
    if (!valuesHaveDirectCues(field, candidate?.[field], candidate?.evidence?.[field])) {
      rejected[field] = "indirect_category_mapping";
      continue;
    }
    eligible.push(field);
  }
  return { identityOk, eligible, rejected };
}
