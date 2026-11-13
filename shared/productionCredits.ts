export const PRODUCTION_ROLE_OPTIONS = [
  "エージェンシー",
  "クリエイティブディレクター",
  "アートディレクター",
  "Webアートディレクション",
  "Webデザイナー",
  "監督",
  "演出",
  "プロデューサー",
  "プロダクションマネージャー",
  "制作会社",
  "制作",
  "制作者",
  "撮影",
  "編集",
  "アニメーション",
  "モーショングラフィックス",
  "CG",
  "VFX",
  "イラスト",
  "デザイン",
  "キャラクターデザイン",
  "美術",
  "音楽",
  "出演",
  "アシスタント",
  "アカウントエグゼクティブ",
  "PR",
  "統括責任者",
  "営業",
  "デベロッパー",
  "ビジネス",
  "コンテンツ",
  "AIフィルム",
  "海外ロケーションコーディネーター",
  "ロケコーディネーター",
  "その他",
] as const;

/** 公式クレジット固有の職能を失わないよう、標準役割以外の文字列も保持する。 */
export type ProductionRole = string;
export type ProductionEntityType = "person" | "company" | "unknown";

export type ProductionCredit = {
  name: string;
  roles: ProductionRole[];
  entityType: ProductionEntityType;
};

/** 映像制作の制作者フィルターから外す、音楽・出演だけを表す役割。 */
const NON_VIDEO_PRODUCTION_ROLES = new Set<string>([
  "音楽", "ボーカル", "歌唱", "演奏", "作詞", "作曲", "編曲", "アレンジ",
  "ミキシング", "ミックス", "マスタリング", "サウンドディレクション", "ボーカルディレクション",
  "出演", "声優", "ナレーション", "アーティスト", "パフォーマー",
  "ギター", "ベース", "ドラム", "チェロ", "トロンボーン", "バイオリン", "フルート",
  "キーボード", "エレクトリックピアノ", "コーラスアレンジ", "レコーディング", "インスト",
]);

/** 投稿ページの前後移動・一覧導線等を制作者名として取り込まない。 */
const NAVIGATION_OR_UI_TEXT = /^(?:←|→|‹|›|前の投稿|次の投稿|previous\s+post|next\s+post|back\s+to|browse\s+by|all\s+works?\b)/i;

type RoleAlias = { pattern: RegExp; role: ProductionRole };

const ROLE_ALIASES: RoleAlias[] = [
  { pattern: /^(?:creative\s*director|クリエイティブ[・\s]*ディレクター|cd)$/i, role: "クリエイティブディレクター" },
  { pattern: /^(?:art\s*director|アート[・\s]*ディレクター|ad)$/i, role: "アートディレクター" },
  { pattern: /^(?:web\s*(?:art\s*)?direction|web[・\s]*アート[・\s]*ディレクション)$/i, role: "Webアートディレクション" },
  { pattern: /^(?:web\s*designer|web[・\s]*デザイナー)$/i, role: "Webデザイナー" },
  { pattern: /^(?:director|directed(?:\s+by)?|film\s*director|監督|ディレクター)$/i, role: "監督" },
  { pattern: /^(?:direction|演出)$/i, role: "演出" },
  { pattern: /^(?:producer|produce|プロデューサー|プロデュース)$/i, role: "プロデューサー" },
  { pattern: /^(?:production\s*manager|プロダクション[・\s]*マネージャー)$/i, role: "プロダクションマネージャー" },
  { pattern: /^(?:production\s*company|production\s*house|制作会社)$/i, role: "制作会社" },
  { pattern: /^(?:production|制作|製作|movie(?:\s+by)?|映像制作|映像|video(?:\s+by)?)$/i, role: "制作" },
  { pattern: /^(?:creator(?:\([^)]*\))?|制作者(?:\([^)]*\))?)$/i, role: "制作者" },
  { pattern: /^(?:agency|advertising\s*agency|広告会社)$/i, role: "エージェンシー" },
  { pattern: /^(?:cinematograph(?:er|y)|director\s*of\s*photography|dop|撮影)$/i, role: "撮影" },
  { pattern: /^(?:editor|edit|編集)$/i, role: "編集" },
  { pattern: /^(?:animation(?:\s*production)?(?:\s+by)?|animator|アニメーション|アニメ制作|アニメーター)$/i, role: "アニメーション" },
  { pattern: /^(?:motion\s*graphics?(?:\s*designer)?|モーション[・\s]*グラフィックス?)$/i, role: "モーショングラフィックス" },
  { pattern: /^(?:cg(?:\s*designer|\s*artist)?|3dcg|cgi|cg|3d)$/i, role: "CG" },
  { pattern: /^(?:vfx|visual\s*effects)$/i, role: "VFX" },
  { pattern: /^(?:illustration(?:\s+by)?|illustrator|illust|イラスト(?:レーター)?)$/i, role: "イラスト" },
  { pattern: /^(?:character\s*designer|character\s*design|キャラクターデザイナー|キャラクターデザイン)$/i, role: "キャラクターデザイン" },
  { pattern: /^(?:designer|design|graphic\s*design|デザイナー|デザイン)$/i, role: "デザイン" },
  { pattern: /^(?:art\s*department|art\s*direction|美術)$/i, role: "美術" },
  { pattern: /^(?:music(?:\s+by)?|sound(?:\s+by)?|sound\s*design|音楽|サウンド(?:デザイン)?)$/i, role: "音楽" },
  { pattern: /^(?:vocal(?:s|ist)?(?:\s+performed)?(?:\s+by)?|singer|ボーカル|歌唱)$/i, role: "ボーカル" },
  { pattern: /^(?:performance|performer|演奏)$/i, role: "演奏" },
  { pattern: /^(?:lyrics?|lyricist|作詞)$/i, role: "作詞" },
  { pattern: /^(?:composition|composer|作曲)$/i, role: "作曲" },
  { pattern: /^(?:arrangement|arranger|編曲|アレンジ)$/i, role: "編曲" },
  { pattern: /^(?:mix(?:ing)?|ミキシング|ミックス)$/i, role: "ミキシング" },
  { pattern: /^(?:master(?:ing)?|マスタリング)$/i, role: "マスタリング" },
  { pattern: /^(?:vocal\s*direction|ボーカルディレクション)$/i, role: "ボーカルディレクション" },
  { pattern: /^(?:sound\s*direction|サウンドディレクション)$/i, role: "サウンドディレクション" },
  { pattern: /^(?:cast|talent|出演)$/i, role: "出演" },
  { pattern: /^(?:assistant|アシスタント)$/i, role: "アシスタント" },
  { pattern: /^(?:account\s*executive|アカウント[・\s]*エグゼクティブ)$/i, role: "アカウントエグゼクティブ" },
  { pattern: /^(?:pr)$/i, role: "PR" },
  { pattern: /^(?:executive|エグゼクティブ|統括責任者)$/i, role: "統括責任者" },
  { pattern: /^(?:sales|営業)$/i, role: "営業" },
  { pattern: /^(?:developer|デベロッパー)$/i, role: "デベロッパー" },
  { pattern: /^(?:business|ビジネス)$/i, role: "ビジネス" },
  { pattern: /^(?:content|コンテンツ)$/i, role: "コンテンツ" },
  { pattern: /^(?:ai\s*film|ai[・\s]*フィルム)$/i, role: "AIフィルム" },
  { pattern: /^(?:overseas\s*location\s*coordinator|海外ロケーションコーディネーター)$/i, role: "海外ロケーションコーディネーター" },
  { pattern: /^(?:location\s*coordinator|ロケ(?:ーション)?コーディネーター)$/i, role: "ロケコーディネーター" },
  { pattern: /^(?:created\s*by|担当)$/i, role: "その他" },
];

const ROLE_LABEL_PATTERN = /(?:creative\s*director|art\s*director|web\s*(?:art\s*)?direction|web\s*designer|director\s*\/\s*designer|director|producer|production\s*manager|production\s*company|production|agency|account\s*executive|assistant|cinematograph(?:er|y)|director\s*of\s*photography|editor|animation(?:\s*production)?|animator|motion\s*graphics?(?:\s*designer)?|cg(?:\s*designer|\s*artist)?|vfx|illustration|illustrator|character\s*designer|designer|developer|design|art\s*department|music|sound(?:\s*design)?|cast|creator(?:\([^)]*\))?|制作者(?:\([^)]*\))?|制作会社・関連会社(?:\([^)]*\))?|プロダクション[・\s]*マネージャー|制作会社|クリエイティブ[・\s]*ディレクター|アート[・\s]*ディレクター|アカウント[・\s]*エグゼクティブ|アシスタント|キャラクターデザイナー|Web[・\s]*ア[\s]*ート[・\s]*ディレクション|Web[・\s]*デザイナー|海外ロケーションコーディネーター|ロケ(?:ーション)?コーディネーター|ディレクター|プロデューサー|プロデュース|映像制作|映像|アニメ(?:ーション|制作|ーター)?|モーション[・\s]*グラフィックス?|撮影|編集|美術|音楽|サウンド(?:デザイン)?|出演|担当者|担当|制作|製作|監督|演出|営業|PR|CG|VFX)\s*[:：]/gi;

const INLINE_ROLE_PATTERN = /海外ロケーションコーディネーター|ロケ(?:ーション)?コーディネーター|アカウント[・\s]*エグゼクティブ|キャラクターデザイナー|Web[・\s]*ア[\s]*ート[・\s]*ディレクション|Web[・\s]*デザイナー|プロダクション[・\s]*マネージャー|クリエイティブ[・\s]*ディレクター|アート[・\s]*ディレクター|統括責任者|アシスタント|デベロッパー|デザイナー|クリエイティブ|ビジネス|コンテンツ|AI[・\s]*フィルム|アートディレクション|account\s*executive|character\s*designer|web\s*(?:art\s*)?direction|web\s*designer|production\s*manager|assistant|developer|designer|business|content|ai\s*film|(?:^|\s)PR(?=\s|$)|(?:^|\s)PM(?=\s|$)|演出|営業|音楽|アニメ(?:ーション)?/gi;

const ROLE_ONLY_COMPOSITE = /^(?:(?:2d\s*animation|3dcg|animation|music\s*video|music|promotion|pv|tv|director|animator|designer|developer|sound|cast)[\s/,_-]*)+$/i;

const CATEGORY_CONCATENATION = /^(?:2d\s*animation|3dcg|animation|motion\s*graphics|music\s*video|promotion|pv|tv|web(?:\s*cm|\s*movie)?|original|short\s*film|comedy|broadcast|event|live\s*action|illustration|showreel)+$/i;

const ENGLISH_BY_CREDIT_PATTERN = /^(vocals?\s+(?:performed\s+)?by|vocal(?:s)?|vocal\s+direction|vocalist|singer|music\s+by|sound\s+by|video\s+by|movie\s+by|directed\s+by|illustration\s+by|animation\s+by)\s*:?[\s]*(.+)$/i;

const ENTITY_ALIASES = new Map<string, string>([
  ["株式会社ライト・ザ・ウェイ", "LIGHT THE WAY Inc."],
  ["株式会社ライトザウェイ", "LIGHT THE WAY Inc."],
  ["light the way", "LIGHT THE WAY Inc."],
  ["light the way inc", "LIGHT THE WAY Inc."],
  ["light the way inc.", "LIGHT THE WAY Inc."],
  ["eisuke shirota", "代田栄介"],
  ["shirota eisuke", "代田栄介"],
  ["代田 栄介", "代田栄介"],
  ["chocolate.inc", "CHOCOLATE Inc."],
  ["chocolate inc", "CHOCOLATE Inc."],
  ["chocolate inc.", "CHOCOLATE Inc."],
  ["naname inc", "NANAME Inc."],
  ["naname inc.", "NANAME Inc."],
  ["ワウ株式会社", "WOW inc."],
  ["wow.inc", "WOW inc."],
  ["wow inc", "WOW inc."],
  ["wow inc.", "WOW inc."],
  ["wow", "WOW inc."],
  ["土岐 彩乃 (koo-ki)", "土岐 彩乃"],
  ["土岐彩乃 (koo-ki)", "土岐 彩乃"],
  ["平井 秀次", "平井秀次"],
  ["shuji hirai", "平井秀次"],
  ["hirai shuji", "平井秀次"],
  ["supersymmetry", "superSymmetry"],
  ["supersymmetry by omnibus japan", "superSymmetry"],
]);

function normalizeKey(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en");
}

function dedupe<T>(values: T[]) {
  return Array.from(new Set(values));
}

export function normalizeProductionRole(raw: string): ProductionRole | null {
  const label = raw
    .normalize("NFKC")
    .replace(/[:：]/g, "")
    .replace(/[・_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!label) return null;
  if ((PRODUCTION_ROLE_OPTIONS as readonly string[]).includes(label)) return label as ProductionRole;
  if (/^agency$/i.test(label)) return "エージェンシー";
  return ROLE_ALIASES.find(({ pattern }) => pattern.test(label))?.role ?? null;
}

function normalizeDeclaredRole(raw: string): ProductionRole | null {
  const normalized = normalizeProductionRole(raw);
  if (normalized) return normalized;
  const label = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  return label && label.length <= 80 ? label : null;
}

export function canonicalizeProductionName(raw: string): string {
  const value = raw
    .normalize("NFKC")
    .replace(/^[\s:：,，・/]+|[\s:：,，・/]+$/g, "")
    .replace(/^制作会社・関連会社(?:\([^)]*\))?\s*[:：]\s*/i, "")
    .replace(/^プロダクション\s*[:：]\s*マネージャー\s*/i, "")
    .replace(/^担当者\s*/i, "")
    .replace(/^by\s+/i, "")
    .replace(/\s*[（(]\s*KOO-KI\s*[）)]\s*/gi, " ")
    .replace(/\s+by\s+omnibus\s+japan\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return "";
  return ENTITY_ALIASES.get(normalizeKey(value)) ?? value;
}

function inferEntityType(name: string, roles: ProductionRole[]): ProductionEntityType {
  if (roles.includes("制作会社")) return "company";
  if (["wow", "wow inc.", "supersymmetry"].includes(normalizeKey(name))) return "company";
  if (/(?:\b(?:inc\.?|ltd\.?|llc|corp\.?|co\.?,?\s*ltd\.?)\b|株式会社|有限会社|合同会社|スタジオ|studio|films?|pictures|映像|プロダクション)/i.test(name)) return "company";
  if (/^[\u3040-\u30ff\u3400-\u9fffA-Za-z.'’\- ]+$/.test(name)) return "person";
  return "unknown";
}

function isPlausibleEntityName(value: string): boolean {
  if (value.length < 2 || value.length > 120) return false;
  if (/^(?:不明|未確認|unknown|n\/a)$/i.test(value)) return false;
  if (NAVIGATION_OR_UI_TEXT.test(value)) return false;
  const compact = value.toLocaleLowerCase("en").replace(/[\s/,_-]/g, "");
  if (normalizeProductionRole(value) || ROLE_ONLY_COMPOSITE.test(value) || CATEGORY_CONCATENATION.test(value) || /^(?:2danimation|3dcg|animation|motiongraphics|musicvideo|music|promotion|pv|tv|director|animator|designer|developer|sound|cast)+$/.test(compact)) return false;
  if (/https?:\/\//i.test(value) || /[。！？]/.test(value)) return false;
  if (/(?:other works|browse by genre|詳しくは|制作しました|大型屋外ビジョン)/i.test(value)) return false;
  return true;
}

function creditFromName(rawName: string, rawRoles: string[] = [], preserveDeclaredRoles = false): ProductionCredit | null {
  const name = canonicalizeProductionName(rawName.replace(/^[\-–—]+|[\-–—]+$/g, "").trim());
  if (!isPlausibleEntityName(name)) return null;
  const roles = dedupe(rawRoles.map((role) => preserveDeclaredRoles ? normalizeDeclaredRole(role) : normalizeProductionRole(role)).filter((role): role is ProductionRole => Boolean(role)));
  return { name, roles, entityType: inferEntityType(name, roles) };
}

function splitNames(raw: string): string[] {
  return raw
    .split(/[\n,，、/／]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseParentheticalCredit(raw: string): ProductionCredit | null {
  const matched = raw.match(/^(.+?)[（(]([^）)]+)[）)]$/);
  if (!matched) return null;
  const [, name, roleText] = matched;
  const roles = roleText.split(/[・/,&、]/).map((item) => item.trim());
  return creditFromName(name, roles);
}

function parseLeadingRoleLabel(value: string): ProductionCredit[] | null {
  const company = value.match(/^制作会社・関連会社(?:\([^)]*\))?\s*[:：]\s*(.+)$/i);
  if (company) {
    return splitNames(company[1])
      .map((name) => creditFromName(name, ["制作会社"]))
      .filter((credit): credit is ProductionCredit => Boolean(credit));
  }
  const manager = value.match(/^プロダクション\s*[:：]\s*マネージャー\s+(.+)$/i);
  if (manager) {
    return splitNames(manager[1])
      .map((name) => creditFromName(name, ["プロダクションマネージャー"]))
      .filter((credit): credit is ProductionCredit => Boolean(credit));
  }
  return null;
}

function parseEnglishByCredit(value: string): ProductionCredit[] | null {
  const matched = value.match(ENGLISH_BY_CREDIT_PATTERN);
  if (!matched) return null;
  const [, rawRole, rawNames] = matched;
  const role = normalizeProductionRole(rawRole);
  if (!role) return [];
  return splitNames(rawNames)
    .map((name) => creditFromName(name, [role]))
    .filter((credit): credit is ProductionCredit => Boolean(credit));
}

function parseInlineRoleChain(value: string): ProductionCredit[] {
  INLINE_ROLE_PATTERN.lastIndex = 0;
  const matches = Array.from(value.matchAll(INLINE_ROLE_PATTERN));
  if (matches.length === 0) return [];
  const credits: ProductionCredit[] = [];
  let cursor = 0;
  matches.forEach((match) => {
    const before = value.slice(cursor, match.index).replace(/^担当者\s*/i, "").trim();
    const role = normalizeProductionRole(match[0]);
    if (before && role) {
      splitNames(before).forEach((name) => {
        const credit = creditFromName(name, [role]);
        if (credit) credits.push(credit);
      });
    }
    cursor = (match.index ?? 0) + match[0].length;
  });
  const tail = value.slice(cursor).trim();
  if (tail) {
    splitNames(tail).forEach((name) => {
      const credit = creditFromName(name);
      if (credit) credits.push(credit);
    });
  }
  return credits;
}

/**
 * 役割ラベルを含む文字列を、人物／会社と役割の組へ分割する。
 * ラベルがない短い値は、役割未確認の人物・会社名として保持する。
 */
export function parseProductionCreditText(raw: string): ProductionCredit[] {
  const value = raw.normalize("NFKC").replace(/\r\n/g, "\n").trim();
  if (!value || value.length > 800) return [];
  if (NAVIGATION_OR_UI_TEXT.test(value)) return [];
  if (!isPlausibleEntityName(value) && !/[：:]/.test(value)) return [];
  const leading = parseLeadingRoleLabel(value);
  if (leading) return leading;
  const englishBy = parseEnglishByCredit(value);
  if (englishBy) return englishBy;
  const parenthetical = parseParentheticalCredit(value);
  if (parenthetical) return [parenthetical];
  ROLE_LABEL_PATTERN.lastIndex = 0;
  const matches = Array.from(value.matchAll(ROLE_LABEL_PATTERN));
  if (matches.length === 0) {
    const inline = parseInlineRoleChain(value);
    if (inline.length > 0) return inline;
    if (/[\n,，、/／]/.test(value)) {
      return splitNames(value)
        .map((name) => creditFromName(name))
        .filter((credit): credit is ProductionCredit => Boolean(credit));
    }
    return creditFromName(value) ? [creditFromName(value)!] : [];
  }

  const credits: ProductionCredit[] = [];
  matches.forEach((match, index) => {
    const nextStart = matches[index + 1]?.index ?? value.length;
    const roleLabel = match[0].replace(/[:：]\s*$/, "");
    const role = normalizeProductionRole(roleLabel);
    if (!role) return;
    const names = splitNames(value.slice((match.index ?? 0) + match[0].length, nextStart));
    names.forEach((name) => {
      const credit = creditFromName(name, [role]);
      if (credit) credits.push(credit);
    });
  });
  return credits;
}

export function normalizeProductionCredits(
  structured: Array<Partial<ProductionCredit>> | undefined,
  legacyValues: string[] = [],
): ProductionCredit[] {
  const candidates: ProductionCredit[] = [];
  (structured ?? []).forEach((credit) => {
    if (typeof credit.name !== "string") return;
    const creditName = credit.name;
    const declaredRoles = Array.isArray(credit.roles) ? credit.roles : [];
    const parsed = parseProductionCreditText(creditName);
    if (parsed.length > 0) {
      const inheritedRoles = parsed.length === 1
        ? declaredRoles.map(normalizeDeclaredRole).filter((role): role is ProductionRole => Boolean(role))
        : [];
      parsed.forEach((candidate) => {
        const roles = dedupe([
          ...candidate.roles,
          ...inheritedRoles,
        ]);
        const originalName = canonicalizeProductionName(creditName);
        const preservedEntityType = (credit.entityType === "person" || credit.entityType === "company") && candidate.name === originalName
          ? credit.entityType
          : inferEntityType(candidate.name, roles);
        candidates.push({ ...candidate, roles, entityType: preservedEntityType });
      });
    } else {
      const normalized = creditFromName(creditName, declaredRoles, true);
      if (normalized) candidates.push(normalized);
    }
  });
  legacyValues.forEach((value) => {
    if (typeof value !== "string") return;
    candidates.push(...parseProductionCreditText(value));
  });

  const merged = new Map<string, ProductionCredit>();
  candidates.forEach((credit) => {
    const key = normalizeKey(credit.name);
    const current = merged.get(key);
    if (current) {
      current.roles = dedupe([...current.roles, ...credit.roles]);
      if (current.entityType === "unknown" && credit.entityType !== "unknown") current.entityType = credit.entityType;
    } else {
      merged.set(key, { ...credit, roles: [...credit.roles] });
    }
  });
  return Array.from(merged.values())
    .map((credit) => {
      const roles = credit.roles.filter((role) => !NON_VIDEO_PRODUCTION_ROLES.has(role));
      return { credit, roles };
    })
    .filter(({ credit, roles }) => roles.length > 0 || !credit.roles.some((role) => NON_VIDEO_PRODUCTION_ROLES.has(role)))
    .map(({ credit, roles }) => ({ ...credit, roles }));
}

export function getProductionNames(credits: ProductionCredit[]): string[] {
  return dedupe(credits.map((credit) => credit.name).filter(Boolean));
}

export function getProductionRoles(credits: ProductionCredit[]): ProductionRole[] {
  return dedupe(credits.flatMap((credit) => credit.roles));
}

export function productionCreditsToEditableText(credits: ProductionCredit[]): string {
  return credits
    .map((credit) => credit.roles.length > 0 ? `${credit.roles.join("・")}：${credit.name}` : credit.name)
    .join("\n");
}
