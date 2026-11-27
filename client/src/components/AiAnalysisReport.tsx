import React, { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Clock3, Copy, FileText, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  isLegacyAnalysisVersion,
  LEGACY_ANALYSIS_LABEL,
  V3_ANALYSIS_LABEL,
  type AnalysisVersion,
} from "@shared/analysisVersion";

type ReportTabId = "planning" | "direction" | "technical" | "sound" | "all";

type ReportTab = {
  id: ReportTabId;
  label: string;
  shortLabel: string;
};

type ReportSection = {
  id: string;
  heading: string;
  content: string;
  tab: Exclude<ReportTabId, "all">;
};

const REPORT_TABS: ReportTab[] = [
  { id: "planning", label: "🎯 評価・企画", shortLabel: "評価・企画" },
  { id: "direction", label: "🎬 演出・撮影", shortLabel: "演出・撮影" },
  { id: "technical", label: "💻 技術解剖", shortLabel: "技術解剖" },
  { id: "sound", label: "📋 音響・実践", shortLabel: "音響・実践" },
  { id: "all", label: "📜 全編表示", shortLabel: "全編表示" },
];

const TIME_CODE_PATTERN = /^【\d{1,2}:\d{2}(?:\s*[-–—〜~]\s*\d{1,2}:\d{2})?】$/;
const INLINE_TOKEN_PATTERN = /(\*\*[^*]+\*\*|`[^`]+`|【\d{1,2}:\d{2}(?:\s*[-–—〜~]\s*\d{1,2}:\d{2})?】)/g;
const HEADING_PATTERN = /^(#{1,3})\s+(.+)$/;
const SPLIT_HEADING_PATTERN = /^(#{1,2})\s+(.+)$/;
const LEGACY_DAI_CHAPTER_PATTERN = /^第\s*(10|[0-9])\s*章(?=\s|$|[：:.)）】、—–-])/;
const NUMBERED_CHAPTER_PATTERN = /^(1[01]|[0-9])\s*(?:[.．:：)\]）]|\s)/;
const STANDALONE_SECTION_PATTERN = /^(?:第\s*(?:10|[0-9])\s*章(?=\s|$|[：:|｜—–-])|キュレーション要約|辛口クリティーク|多面的評価|企画・心理誘導|マーケティング設計|タイムライン観察記録|演出・構図|撮影・照明・美術|技術解剖|再現・拡張レシピ|音響演出|明日からのアクションプラン)/;

/**
 * Chapter-number-based tab mapping for `## 0.` .. `## 10.` format (v3 & modern 10-chapter reports).
 * Independent of heading wording so v3 wording differences never mis-route tabs:
 *  - 0 (総括), 1 (ジャンル/トーン), 2 (企画/ターゲット), 9 (セールス/企画提案フック), 11 (監査) -> planning (評価・企画)
 *  - 3 (時系列タイムスタンプ), 4 (演出・撮影・構図・照明・美術) -> direction (演出・撮影)
 *  - 5 (編集・モーショングラフィックス・VFX), 10 (高技術カット完全再現レシピ) -> technical (技術解剖)
 *  - 6 (サウンド・リズム・テンポ), 7 (再現性・制作体制), 8 (応用・参考ポイント) -> sound (音響・実践)
 */
const V3_CHAPTER_NUMBER_TAB_MAP: Record<string, Exclude<ReportTabId, "all">> = {
  "0": "planning",
  "1": "planning",
  "2": "planning",
  "3": "direction",
  "4": "direction",
  "5": "technical",
  "6": "sound",
  "7": "sound",
  "8": "sound",
  "9": "planning",
  "10": "technical",
  "11": "planning",
};

/**
 * Legacy `第0章〜第8章` (Notion v1) mapping preserved for backward compatibility:
 *  - 第0章 タイムライン観察記録, 第3章, 第4章 -> direction
 *  - 第1章, 第2章, 第9章 -> planning
 *  - 第5章, 第6章, 第10章 -> technical
 *  - 第7章, 第8章 -> sound
 */
const LEGACY_DAI_CHAPTER_TAB_MAP: Record<string, Exclude<ReportTabId, "all">> = {
  "0": "direction",
  "1": "planning",
  "2": "planning",
  "3": "direction",
  "4": "direction",
  "5": "technical",
  "6": "technical",
  "7": "sound",
  "8": "sound",
  "9": "planning",
  "10": "technical",
};

function getSectionTab(heading: string, contentPreview = ""): Exclude<ReportTabId, "all"> {
  const cleanHeading = heading.replace(/\s+/g, " ").trim();

  // 1. Explicit `## 0.` .. `## 10.` chapter number (v3 & numbered reports) — independent of wording.
  const numberedMatch = cleanHeading.match(NUMBERED_CHAPTER_PATTERN);
  if (numberedMatch?.[1] && V3_CHAPTER_NUMBER_TAB_MAP[numberedMatch[1]]) {
    return V3_CHAPTER_NUMBER_TAB_MAP[numberedMatch[1]];
  }

  // 2. Legacy `第N章` chapter number
  const daiMatch = cleanHeading.match(LEGACY_DAI_CHAPTER_PATTERN);
  if (daiMatch?.[1] && LEGACY_DAI_CHAPTER_TAB_MAP[daiMatch[1]]) {
    return LEGACY_DAI_CHAPTER_TAB_MAP[daiMatch[1]];
  }

  // 3. Fallback keyword matching (heading first, then body preview) for unnumbered sections
  const classifyKeywords = (text: string): Exclude<ReportTabId, "all"> | null => {
    const normalized = text.replace(/\s+/g, " ").toLowerCase();
    if (/(?:タイムライン|演出|構図|撮影|照明|美術|シーン連鎖)/.test(normalized)) return "direction";
    if (/(?:after effects|davinci|blender|技術解剖|再現|拡張レシピ|コード|パラメータ)/.test(normalized)) return "technical";
    if (/(?:音響|サウンド|アクションプラン|明日から)/.test(normalized)) return "sound";
    if (/(?:キュレーション|要約|企画|評価|クライアント)/.test(normalized)) return "planning";
    return null;
  };

  return classifyKeywords(cleanHeading) ?? classifyKeywords(contentPreview) ?? "planning";
}

export function getAnalysisScale(markdown: string): 1 | 2 | 3 {
  const explicitScale = markdown.match(/\bscale\s*([123])\b/i)?.[1];
  if (explicitScale === "1" || explicitScale === "2" || explicitScale === "3") {
    return Number(explicitScale) as 1 | 2 | 3;
  }

  if (markdown.length >= 6000) return 3;
  if (markdown.length >= 2200) return 2;
  return 1;
}

export function splitAiAnalysisByTab(markdown: string): ReportSection[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let current = { heading: "レポート概要", lines: [] as string[] };
  let inCodeFence = false;

  const pushCurrent = () => {
    if (current.lines.some((line) => line.trim()) || current.heading !== "レポート概要") {
      sections.push(current);
    }
  };

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      inCodeFence = !inCodeFence;
      current.lines.push(line);
      continue;
    }

    const markdownHeading = line.match(SPLIT_HEADING_PATTERN);
    const trimmed = line.trim();
    const isStandaloneSection = !inCodeFence && trimmed.length > 0 && STANDALONE_SECTION_PATTERN.test(trimmed);

    if ((!inCodeFence && markdownHeading) || isStandaloneSection) {
      pushCurrent();
      current = {
        heading: markdownHeading ? markdownHeading[2].trim() : trimmed.replace(/[:：]$/, ""),
        lines: [],
      };
      continue;
    }

    current.lines.push(line);
  }

  // The final chapter has no following heading to trigger a flush; always
  // commit the active section after the loop so its body is never dropped.
  pushCurrent();

  return sections
    .map((section, index) => {
      const content = section.lines.join("\n").trim();
      return {
        id: `${index}-${section.heading}`,
        heading: section.heading,
        content,
        tab: getSectionTab(section.heading, content.slice(0, 240)),
      };
    })
    .filter((section) => section.content || section.heading !== "レポート概要");
}

function InlineMarkdown({ text, isLegacy = false }: { text: string; isLegacy?: boolean }) {
  return (
    <>
      {text.split(INLINE_TOKEN_PATTERN).filter(Boolean).map((token, index) => {
        if (token.startsWith("**") && token.endsWith("**")) {
          return (
            <strong
              key={`${token}-${index}`}
              className="rounded bg-white/[0.11] px-1 py-0.5 font-semibold text-white shadow-[inset_0_-1px_0_rgba(255,255,255,0.12)]"
            >
              {token.slice(2, -2)}
            </strong>
          );
        }

        if (token.startsWith("`") && token.endsWith("`")) {
          return (
            <code key={`${token}-${index}`} className="rounded border border-sky-400/20 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[0.9em] text-sky-200">
              {token.slice(1, -1)}
            </code>
          );
        }

        if (TIME_CODE_PATTERN.test(token)) {
          return (
            <span
              key={`${token}-${index}`}
              title={isLegacy ? "旧分析のため時刻は目安" : undefined}
              className="mx-0.5 inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/20 px-2 py-0.5 align-[0.08em] font-mono text-[10px] font-medium text-sky-200"
            >
              <Clock3 className="h-3 w-3" aria-hidden="true" />
              {token.slice(1, -1)}
            </span>
          );
        }

        return <span key={`${token}-${index}`}>{token}</span>;
      })}
    </>
  );
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("コードをコピーしました。");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("コードをコピーできませんでした。ブラウザの権限をご確認ください。");
    }
  };

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-white/[0.09] bg-black/45 shadow-[0_12px_32px_rgba(0,0,0,0.2)]">
      <div className="flex items-center justify-between border-b border-white/[0.07] bg-white/[0.035] px-3 py-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-200/75">{language || "code"}</span>
        <button
          type="button"
          onClick={copyCode}
          aria-label="コードをコピー"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-300" /> : <Copy className="h-3 w-3" />}
          {copied ? "コピー済み" : "コピー"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[11px] leading-6 text-sky-50/85"><code>{code}</code></pre>
    </div>
  );
}

function MarkdownBlocks({ markdown, isLegacy = false }: { markdown: string; isLegacy?: boolean }) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const codeFence = line.match(/^```\s*([^\s]*)\s*$/);

    if (codeFence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<CodeBlock key={`code-${index}`} code={codeLines.join("\n")} language={codeFence[1]} />);
      continue;
    }

    const heading = line.match(HEADING_PATTERN);
    if (heading) {
      const level = heading[1].length;
      const headingClass = level === 1
        ? "border-cinematic-red text-base sm:text-lg"
        : level === 2
        ? "border-sky-400 text-sm sm:text-base"
        : "border-white/35 text-xs sm:text-sm";
      const Tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
      blocks.push(
        <Tag key={`heading-${index}`} className={`my-5 rounded-r-lg border-l-2 bg-gradient-to-r from-white/[0.065] to-transparent px-3 py-2 font-bold tracking-[0.01em] ${headingClass}`}>
          <InlineMarkdown text={heading[2]} isLegacy={isLegacy} />
        </Tag>,
      );
      index += 1;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`list-${index}`} className="my-3 space-y-2 pl-1">
          {items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`} className="relative pl-5 text-[13px] leading-7 text-foreground/85 before:absolute before:left-0 before:top-[0.78rem] before:h-1.5 before:w-1.5 before:rounded-full before:bg-cinematic-red/90">
              <InlineMarkdown text={item} isLegacy={isLegacy} />
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+[.)]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ol key={`ordered-${index}`} className="my-3 list-decimal space-y-2 pl-6 marker:font-mono marker:text-sky-300/80">
          {items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`} className="pl-1 text-[13px] leading-7 text-foreground/85"><InlineMarkdown text={item} isLegacy={isLegacy} /></li>
          ))}
        </ol>,
      );
      continue;
    }

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^```/.test(lines[index]) &&
      !HEADING_PATTERN.test(lines[index]) &&
      !/^\s*[-*+]\s+/.test(lines[index]) &&
      !/^\s*\d+[.)]\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(
      <p key={`paragraph-${index}`} className="my-3 whitespace-pre-line text-[13px] leading-7 text-foreground/82">
        <InlineMarkdown text={paragraph.join("\n")} isLegacy={isLegacy} />
      </p>,
    );
  }

  return <>{blocks}</>;
}

function AnalysisSection({ section, isLegacy = false }: { section: ReportSection; isLegacy?: boolean }) {
  return (
    <article className="rounded-xl border border-white/[0.075] bg-black/10 px-3.5 py-1 sm:px-4">
      {section.heading !== "レポート概要" && (
        <h2 className="mt-4 rounded-r-lg border-l-2 border-cinematic-red bg-gradient-to-r from-white/[0.065] to-transparent px-3 py-2 text-sm font-bold text-foreground sm:text-base">
          <InlineMarkdown text={section.heading} isLegacy={isLegacy} />
        </h2>
      )}
      {section.content ? <MarkdownBlocks markdown={section.content} isLegacy={isLegacy} /> : null}
    </article>
  );
}

export default function AiAnalysisReport({
  analysis,
  analysisVersion,
  analysisGeneratedAt,
  analysisPromptSha256,
}: {
  analysis: string;
  analysisVersion?: AnalysisVersion | string | null;
  analysisGeneratedAt?: string | null;
  analysisPromptSha256?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const sections = useMemo(() => splitAiAnalysisByTab(analysis), [analysis]);
  const scale = useMemo(() => getAnalysisScale(analysis), [analysis]);
  const isLegacy = isLegacyAnalysisVersion(analysisVersion);
  const v3TooltipParts = [
    V3_ANALYSIS_LABEL,
    analysisGeneratedAt ? `生成日時: ${analysisGeneratedAt}` : null,
    analysisPromptSha256 ? `Prompt SHA: ${analysisPromptSha256.slice(0, 12)}` : null,
  ].filter(Boolean);

  const copyFullReport = async () => {
    try {
      await navigator.clipboard.writeText(analysis);
      setCopied(true);
      toast.success("AI分析レポート全文をコピーしました。");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("レポートをコピーできませんでした。ブラウザの権限をご確認ください。");
    }
  };

  return (
    <section aria-label="AI分析結果" className="overflow-hidden rounded-xl border border-sky-400/15 bg-[linear-gradient(145deg,rgba(14,23,39,0.96),rgba(14,14,18,0.92))] shadow-[0_16px_45px_rgba(0,0,0,0.22)]">
      <header className="border-b border-white/[0.075] bg-white/[0.025] px-3.5 py-3 sm:px-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md border border-sky-400/25 bg-sky-400/10 text-sky-200"><FileText className="h-3.5 w-3.5" aria-hidden="true" /></span>
              <span className="text-[10px] font-bold tracking-[0.16em] text-sky-200/85">AI ANALYSIS REPORT</span>
              <span title="分析本文の分量に応じた表示スケール" className="rounded-full border border-cinematic-red/30 bg-cinematic-red/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-red-200">Scale {scale}</span>
              {isLegacy ? (
                <span
                  data-testid="analysis-legacy-badge"
                  title="旧方式の分析です（実映像照合済みの v3 へ順次更新中）"
                  className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-950/90 px-2 py-0.5 text-[10px] font-semibold text-amber-300"
                >
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {LEGACY_ANALYSIS_LABEL}
                </span>
              ) : (
                <span
                  data-testid="analysis-v3-badge"
                  title={v3TooltipParts.join(" / ")}
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-400/35 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-200"
                >
                  <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {V3_ANALYSIS_LABEL}
                </span>
              )}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">章ごとに読み分け、制作の判断材料をすばやく取り出せます。</p>
            {isLegacy && (
              <p
                data-testid="analysis-legacy-notice"
                className="mt-2 rounded-md border border-amber-400/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200/95"
              >
                旧方式の分析です。記載のタイムスタンプや細部描写は目安として参照してください（実映像照合済みの新版へ順次更新中）。
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={copyFullReport}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.055] px-2.5 py-1.5 text-[11px] font-medium text-foreground/85 transition-colors hover:border-sky-300/30 hover:bg-sky-400/10 hover:text-sky-100"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "コピー済み" : "レポート全文をコピー"}
          </button>
        </div>
      </header>

      <Tabs defaultValue="planning" className="gap-0">
        <div className="overflow-x-auto border-b border-white/[0.075] px-2 py-2 sm:px-3">
          <TabsList className="h-auto min-w-max gap-1 rounded-lg border border-white/[0.07] bg-black/25 p-1">
            {REPORT_TABS.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="h-auto min-h-8 rounded-md border-0 px-2.5 py-1.5 text-[11px] text-muted-foreground data-[state=active]:bg-white/[0.09] data-[state=active]:text-white data-[state=active]:shadow-none sm:px-3"
              >
                <span className="sm:hidden">{tab.shortLabel}</span>
                <span className="hidden sm:inline">{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {REPORT_TABS.map((tab) => {
          const visibleSections = tab.id === "all" ? sections : sections.filter((section) => section.tab === tab.id);
          return (
            <TabsContent key={tab.id} value={tab.id} className="m-0 p-3 sm:p-4">
              {visibleSections.length ? (
                <div className="space-y-3">
                  {visibleSections.map((section) => <AnalysisSection key={section.id} section={section} isLegacy={isLegacy} />)}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-white/10 bg-black/15 px-4 py-7 text-center text-xs leading-relaxed text-muted-foreground">
                  このカテゴリに対応する章見出しは、レポート内でまだ検出されていません。<br />
                  「全編表示」では全文を確認できます。
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </section>
  );
}
