/**
 * InspirationMode — random video discovery for creative inspiration.
 * 完全ランダムと、テーマをメタデータ横断で照合するテーマ指定ランダムを提供する。
 */
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Shuffle, ChevronRight, ChevronLeft, Bookmark, BookmarkCheck, StickyNote, ExternalLink, Flame, Sparkles, SlidersHorizontal, RotateCcw } from "lucide-react";
import { DIRECTION_CATEGORIES, GENRE_CATEGORIES, PRODUCT_CATEGORIES, TONE_CATEGORIES, type Video } from "@/lib/types";
import { getThemeCandidatesForCategorySelections, pickRandomInspirationVideo, type InspirationThemeSelectorKey } from "@/lib/inspiration";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PRODUCTION_ROLE_OPTIONS } from "@shared/productionCredits";
import { collectMetadataValueSuggestions } from "@/lib/metadataValueSuggestions";
import VideoModal from "./VideoModal";

type InspirationModeType = "random" | "theme";
type ThemeSelectorKey = InspirationThemeSelectorKey;

type ThemeSelections = Record<ThemeSelectorKey, string>;

const EMPTY_THEME_SELECTIONS: ThemeSelections = {
  genre: "",
  product: "",
  purpose: "",
  expression: "",
  direction: "",
  tone: "",
  productionRole: "",
};

const ANY_VALUE = "__any__";
const RECENT_RANDOM_HISTORY_LIMIT = 12;

const THEME_SELECTORS: Array<{ key: ThemeSelectorKey; label: string; options: ReadonlyArray<{ name: string }> | readonly string[] }> = [
  { key: "genre", label: "ジャンル", options: GENRE_CATEGORIES },
  { key: "product", label: "商材", options: PRODUCT_CATEGORIES },
  { key: "direction", label: "演出", options: DIRECTION_CATEGORIES },
  { key: "tone", label: "トーン", options: TONE_CATEGORIES },
];

const PRODUCTION_ROLE_GROUPS = [
  { label: "企画・進行", options: ["エージェンシー", "クリエイティブディレクター", "アートディレクター", "監督", "演出", "プロデューサー", "プロダクションマネージャー", "制作会社", "制作"] },
  { label: "撮影・編集", options: ["撮影", "編集", "CG", "VFX", "モーショングラフィックス", "アニメーション"] },
  { label: "美術・デザイン", options: ["イラスト", "デザイン", "キャラクターデザイン", "美術", "Webアートディレクション", "Webデザイナー"] },
  { label: "その他の役割", options: PRODUCTION_ROLE_OPTIONS.filter((role) => !["エージェンシー", "クリエイティブディレクター", "アートディレクター", "監督", "演出", "プロデューサー", "プロダクションマネージャー", "制作会社", "制作", "撮影", "編集", "CG", "VFX", "モーショングラフィックス", "アニメーション", "イラスト", "デザイン", "キャラクターデザイン", "美術", "Webアートディレクション", "Webデザイナー"].includes(role)) },
];

function getOptionName(option: { name: string } | string): string {
  return typeof option === "string" ? option : option.name;
}

interface InspirationModeProps {
  videos: Video[];
  onClose: () => void;
  isFavorite: (id: string) => boolean;
  onToggleFavorite: (id: string) => void;
  favoriteProfileName?: string;
  onChooseFavoriteProfile?: () => void;
  getNote: (id: string) => string;
  onSaveNote: (id: string, note: string) => void;
}

export default function InspirationMode({
  videos,
  onClose,
  isFavorite,
  onToggleFavorite,
  favoriteProfileName,
  onChooseFavoriteProfile,
  getNote,
  onSaveNote,
}: InspirationModeProps) {
  const [mode, setMode] = useState<InspirationModeType>("random");
  const [themeSelections, setThemeSelections] = useState<ThemeSelections>(EMPTY_THEME_SELECTIONS);
  const [currentId, setCurrentId] = useState<string | null>(() => pickRandomInspirationVideo(videos)?.id ?? null);
  const [recentRandomIds, setRecentRandomIds] = useState<string[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [direction, setDirection] = useState(1);
  const metadataSuggestions = useMemo(() => collectMetadataValueSuggestions(videos), [videos]);

  const selectedThemeSelections = useMemo(
    () => (Object.entries(themeSelections) as Array<[ThemeSelectorKey, string]>)
      .filter(([, value]) => value.length > 0)
      .map(([key, value]) => ({ key, value })),
    [themeSelections],
  );
  const selectedThemeValues = useMemo(
    () => selectedThemeSelections.map((selection) => selection.value),
    [selectedThemeSelections],
  );

  const candidateVideos = useMemo(
    () => mode === "theme" ? getThemeCandidatesForCategorySelections(videos, selectedThemeSelections) : videos,
    [mode, selectedThemeSelections, videos],
  );
  const candidateKey = useMemo(() => candidateVideos.map((video) => video.id).join("|"), [candidateVideos]);
  const previousCandidateKey = useRef("");
  const current = candidateVideos.find((video) => video.id === currentId) ?? candidateVideos[0];
  const currentIdx = current ? candidateVideos.findIndex((video) => video.id === current.id) : -1;
  const hasThemeSelection = selectedThemeValues.length > 0;

  const updateThemeSelection = useCallback((key: ThemeSelectorKey, value: string) => {
    setThemeSelections((previous) => ({ ...previous, [key]: value === ANY_VALUE ? "" : value }));
  }, []);

  const clearThemeSelections = useCallback(() => setThemeSelections(EMPTY_THEME_SELECTIONS), []);

  useEffect(() => {
    if (previousCandidateKey.current === candidateKey) return;
    previousCandidateKey.current = candidateKey;
    setRecentRandomIds([]);
    setCurrentId(pickRandomInspirationVideo(candidateVideos)?.id ?? null);
  }, [candidateKey, candidateVideos]);

  const goNext = useCallback(() => {
    if (!current || candidateVideos.length === 0) return;
    setDirection(1);
    setCurrentId(candidateVideos[(currentIdx + 1) % candidateVideos.length]?.id ?? null);
  }, [candidateVideos, current, currentIdx]);

  const goPrev = useCallback(() => {
    if (!current || candidateVideos.length === 0) return;
    setDirection(-1);
    setCurrentId(candidateVideos[(currentIdx - 1 + candidateVideos.length) % candidateVideos.length]?.id ?? null);
  }, [candidateVideos, current, currentIdx]);

  const goRandom = useCallback(() => {
    setDirection(1);
    const next = pickRandomInspirationVideo(candidateVideos, current?.id, Math.random, recentRandomIds);
    if (!next) return setCurrentId(null);
    setCurrentId(next.id);
    setRecentRandomIds((previous) => [...previous, next.id].slice(-RECENT_RANDOM_HISTORY_LIMIT));
  }, [candidateVideos, current?.id, recentRandomIds]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "ArrowRight" || event.key === " ") goNext();
      if (event.key === "ArrowLeft") goPrev();
      if (event.key === "r" || event.key === "R") goRandom();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, goNext, goPrev, goRandom]);

  const thumbnailSrc = current?.thumbnail ||
    (current?.platform === "youtube" ? `https://img.youtube.com/vi/${current.id}/maxresdefault.jpg` : "");
  const modeLabel = mode === "random" ? "完全ランダム" : "テーマ指定";
  const themeLabel = selectedThemeValues.join("・");
  const countLabel = mode === "theme" && hasThemeSelection
    ? `「${themeLabel}」の候補 ${candidateVideos.length}本`
    : `${candidateVideos.length}本から抽選`;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex flex-col bg-black"
      >
        <div className="flex shrink-0 flex-col gap-3 border-b border-white/5 px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <Shuffle className="h-4 w-4 shrink-0 text-cinematic-red" />
            <span className="shrink-0 text-sm font-bold text-cinematic-red">インスピレーション</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">{countLabel}</span>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2 lg:flex-1 lg:justify-center">
            <div className="inline-flex rounded-md border border-white/10 bg-white/[0.04] p-0.5" role="group" aria-label="抽選モード">
              <button
                type="button"
                aria-pressed={mode === "random"}
                onClick={() => setMode("random")}
                className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${mode === "random" ? "bg-cinematic-red text-white" : "text-muted-foreground hover:text-white"}`}
              >
                完全ランダム
              </button>
              <button
                type="button"
                aria-pressed={mode === "theme"}
                onClick={() => setMode("theme")}
                className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${mode === "theme" ? "bg-cinematic-red text-white" : "text-muted-foreground hover:text-white"}`}
              >
                テーマ指定
              </button>
            </div>
            {mode === "theme" && (
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 lg:max-w-4xl">
                <div className="flex items-center gap-1 px-1 text-[10px] font-medium text-muted-foreground"><SlidersHorizontal className="h-3.5 w-3.5" />条件</div>
                {THEME_SELECTORS.map((selector) => (
                  <Select
                    key={selector.key}
                    value={themeSelections[selector.key] || ANY_VALUE}
                    onValueChange={(value) => updateThemeSelection(selector.key, value)}
                  >
                    <SelectTrigger className="h-8 w-[118px] border-white/10 bg-white/[0.05] px-2 text-[11px] text-white focus:ring-cinematic-red/50 sm:w-[132px]">
                      <SelectValue placeholder={selector.label} />
                    </SelectTrigger>
                    <SelectContent className="max-h-72 border-white/10 bg-[oklch(0.13_0.006_285)] text-white">
                      <SelectItem value={ANY_VALUE}>すべての{selector.label}</SelectItem>
                      {selector.options.map((option) => {
                        const name = getOptionName(option);
                        return <SelectItem key={name} value={name}>{name}</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                ))}
                <Select value={themeSelections.productionRole || ANY_VALUE} onValueChange={(value) => updateThemeSelection("productionRole", value)}>
                  <SelectTrigger className="h-8 w-[126px] border-white/10 bg-white/[0.05] px-2 text-[11px] text-white focus:ring-cinematic-red/50 sm:w-[142px]">
                    <SelectValue placeholder="制作の役割" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 border-white/10 bg-[oklch(0.13_0.006_285)] text-white">
                    <SelectItem value={ANY_VALUE}>すべての制作役割</SelectItem>
                    {PRODUCTION_ROLE_GROUPS.map((group) => (
                      <SelectGroup key={group.label}>
                        <SelectLabel className="text-[10px] text-muted-foreground">{group.label}</SelectLabel>
                        {group.options.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                {hasThemeSelection && (
                  <button type="button" onClick={clearThemeSelections} className="flex h-8 items-center gap-1 rounded-md border border-white/10 px-2 text-[10px] text-muted-foreground transition-colors hover:bg-white/10 hover:text-white" aria-label="テーマ条件をすべて解除">
                    <RotateCcw className="h-3 w-3" />解除
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 self-end lg:self-auto">
            {current && <span className="text-xs text-muted-foreground">{currentIdx + 1} / {candidateVideos.length}</span>}
            <span className="hidden text-[10px] text-muted-foreground xl:block">← →：移動 / R：再抽選</span>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 transition-colors hover:bg-white/10" aria-label="インスピレーションを閉じる">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {!current ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div className="max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-7">
              <Sparkles className="mx-auto mb-4 h-8 w-8 text-cinematic-red" />
              {mode === "theme" && !hasThemeSelection ? (
                <>
                  <h2 className="mb-2 text-lg font-bold text-white">テーマを選択してください</h2>
                  <p className="text-sm leading-relaxed text-muted-foreground">ジャンル、商材、用途、表現、演出、トーン、制作の役割を組み合わせて、条件に合う映像だけを抽選します。</p>
                </>
              ) : (
                <>
                  <h2 className="mb-2 text-lg font-bold text-white">該当する映像が見つかりません</h2>
                  <p className="text-sm leading-relaxed text-muted-foreground">条件が細かすぎる可能性があります。まずは一部の条件を解除してお試しください。</p>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <AnimatePresence mode="wait" custom={direction}>
                <motion.div
                  key={current.id}
                  custom={direction}
                  initial={{ x: direction * 60, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: direction * -60, opacity: 0 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  className="absolute inset-0"
                >
                  {thumbnailSrc && <img src={thumbnailSrc} alt={current.title} className="h-full w-full object-cover" />}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
                  <div className="absolute inset-0 bg-gradient-to-r from-black/50 to-transparent" />
                </motion.div>
              </AnimatePresence>

              <button type="button" onClick={goPrev} className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/60 backdrop-blur-sm transition-colors hover:bg-black/80" aria-label="前の候補">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button type="button" onClick={goNext} className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/60 backdrop-blur-sm transition-colors hover:bg-black/80" aria-label="次の候補">
                <ChevronRight className="h-5 w-5" />
              </button>

              <AnimatePresence mode="wait">
                <motion.div
                  key={current.id}
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -20, opacity: 0 }}
                  transition={{ duration: 0.3, delay: 0.1 }}
                  className="absolute bottom-0 left-0 right-0 px-5 pb-5 pt-10"
                >
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {[...current.genres, ...current.directions].slice(0, 4).map((tag, index) => (
                      <span key={`${tag.slug}-${index}`} className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/80 backdrop-blur-sm">{tag.name}</span>
                    ))}
                  </div>
                  <h2 className="mb-1 text-lg font-black leading-tight text-white drop-shadow-lg sm:text-2xl">{current.title}</h2>
                  {current.channelTitle && <p className="text-sm text-white/50">{current.channelTitle}</p>}
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="flex shrink-0 flex-col border-t border-white/5 bg-[oklch(0.10_0.005_285)] lg:w-72 lg:border-l lg:border-t-0">
              <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
                <div className="rounded-lg border border-white/8 bg-white/[0.025] px-3 py-2 text-xs">
                  <p className="font-medium text-white">{modeLabel}</p>
                  <p className="mt-0.5 text-muted-foreground">{countLabel}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setShowModal(true)} className="flex items-center justify-center gap-1.5 rounded-lg bg-cinematic-red py-2.5 text-xs font-bold text-white transition-colors hover:bg-cinematic-red-light">
                    <Flame className="h-3.5 w-3.5" />詳細を見る
                  </button>
                  <button type="button" onClick={goRandom} className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 py-2.5 text-xs font-medium text-white transition-colors hover:bg-white/10">
                    <Shuffle className="h-3.5 w-3.5" />再抽選
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => favoriteProfileName ? onToggleFavorite(current.id) : onChooseFavoriteProfile?.()}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border py-2.5 text-xs font-medium transition-colors ${
                      isFavorite(current.id) ? "border-amber-400/20 bg-amber-400/10 text-amber-400" : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10"
                    }`}
                    title={favoriteProfileName ? `${favoriteProfileName}のお気に入り` : "先にお気に入りの利用者を選択"}
                  >
                    {isFavorite(current.id) ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
                    {favoriteProfileName ? (isFavorite(current.id) ? "保存済み" : "保存") : "利用者を選択"}
                  </button>
                  <a href={current.videoUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/10">
                    <ExternalLink className="h-3.5 w-3.5" />元動画
                  </a>
                </div>

                <div>
                  <div className="mb-2 flex items-center gap-1.5"><StickyNote className="h-3.5 w-3.5 text-sky-400" /><span className="text-xs font-medium text-sky-400">クリエイターメモ</span></div>
                  <textarea
                    value={getNote(current.id)}
                    onChange={(event) => onSaveNote(current.id, event.target.value)}
                    placeholder="気づき、参考にしたいポイントをメモ..."
                    className="min-h-[80px] w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-sky-500/40"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-white/5 px-4 py-3">
                <button type="button" onClick={goPrev} className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" />前へ</button>
                <span className="text-xs text-muted-foreground">{currentIdx + 1} / {candidateVideos.length}</span>
                <button type="button" onClick={goNext} className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">次へ<ChevronRight className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          </div>
        )}
      </motion.div>

      {showModal && current && (
        <VideoModal
          video={current}
          onClose={() => setShowModal(false)}
          isFavorite={isFavorite(current.id)}
          onToggleFavorite={onToggleFavorite}
          favoriteProfileName={favoriteProfileName}
          onChooseFavoriteProfile={onChooseFavoriteProfile}
          note={getNote(current.id)}
          onSaveNote={onSaveNote}
          metadataSuggestions={metadataSuggestions}
        />
      )}
    </>
  );
}
