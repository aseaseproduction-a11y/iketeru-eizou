/**
 * Home page — main layout with sidebar, hero, and video grid
 * Design: Cinematic Noir — dark immersive experience, sidebar + masonry-like grid
 * Features: video grid, filters, search, inspiration mode, manual add, favorites, notes
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, Loader2, X, Shuffle, Bookmark, BookmarkCheck, UsersRound, Film, Sparkles, Search as SearchIcon, Play, Zap } from "lucide-react";
import Header from "@/components/Header";
import FavoriteProfileManager from "@/components/FavoriteProfileManager";
import Sidebar from "@/components/Sidebar";
import VideoCard from "@/components/VideoCard";
import VideoModal, { type VideoModalFilter } from "@/components/VideoModal";
import InspirationMode from "@/components/InspirationMode";
import SceneCard from "@/components/SceneCard";
import { searchScenes, loadSceneIndex, getSceneKeywordCategories, parseQueryWords, type SceneItem, type SceneSearchResult, type KeywordCategory } from "@/lib/sceneSearch";
import { useVideos } from "@/hooks/useVideos";
import { useCreatorTools } from "@/hooks/useCreatorTools";
import { getInspirationSourceVideos } from "@/lib/inspiration";
import { trpc } from "@/lib/trpc";
import { collectMetadataValueSuggestions } from "@/lib/metadataValueSuggestions";
import type { Video } from "@/lib/types";
import {
  GENRE_CATEGORIES,
  PRODUCT_CATEGORIES,
  DIRECTION_CATEGORIES,
  TONE_CATEGORIES,
} from "@/lib/types";

const HERO_IMAGE = "https://d2xsxph8kpxj0f.cloudfront.net/310519663100820170/mZeHLCezU2MrLhTsDAa2dW/hero-bg-7vyM9SCSQXi6UiLCfGP9Jf.webp";

const SCENE_SEARCH_PRESETS = [
  { label: "🌅 夕日が海に沈む", query: "夕日 海" },
  { label: "🌃 夜のネオン・都会", query: "夜 ネオン 都会" },
  { label: "🌧️ 雨の中の疾走", query: "雨 走る" },
  { label: "🏎️ 車の走行・ドライブ", query: "車 走行" },
  { label: "💃 ダイナミックなダンス", query: "ダンス 群舞" },
  { label: "✨ 美しい光と逆光", query: "光 逆光 美しい" },
  { label: "💥 煙・爆発・スモーク", query: "煙 スモーク" },
  { label: "🎌 アニメーション・狂気", query: "アニメ 狂気" },
];

function getFilterLabel(slug: string, type: string): string {
  const lists: Record<string, { name: string; slug: string }[]> = {
    genre: GENRE_CATEGORIES,
    product: PRODUCT_CATEGORIES,
    direction: DIRECTION_CATEGORIES,
    tone: TONE_CATEGORIES,
  };
  const list = lists[type] || [];
  const item = list.find((i) => i.slug === slug);
  return item?.name || slug;
}

export default function Home() {
  // The userAuth hooks provides authentication state
  // To implement login/logout functionality, simply call logout() or redirect to getLoginUrl()
  let { user, loading, error, isAuthenticated, logout } = useAuth();

  const {
    favorites,
    toggleFavorite,
    isFavorite,
    creatorFavorites,
    toggleCreatorFavorite,
    isCreatorFavorite,
    saveNote,
    getNote,
    favoriteCount,
    profiles,
    activeProfile,
    selectProfile,
    createProfile,
    renameProfile,
    deleteProfile,
    legacyMigrationPending,
    migrateLegacyFavorites,
  } = useCreatorTools();

  const {
    videos,
    allVideos,
    totalCount,
    filteredCount,
    filters,
    categoryCounts,
    hasMore,
    loadMore,
    setSearch,
    setGenre,
    setProduct,
    setDirection,
    setTone,
    setPurpose,
    setExpression,
    setToneEmotion,
    setToneVisual,
    setToneTechnique,
    setProduction,
    setProductionRole,
    setPrivateRating,
    setAiOverallRating,
    setAiDirectionRating,
    setAiTechniqueRating,
    setSource,
    setEizo100Only,
    setEizo100Year,
    setShowUnavailable,
    setSort,
    setFavoritesOnly,
    clearAllFilters,
    activeFilterCount,
    metadataFilterOptions,
    productionFilterOptions,
    eizo100Count,
    eizo100YearCounts,
    sourceFilterOptions,
    unavailableCount,
    lowAiOverallCount,
    setShowLowAiOverall,
    isLoading: isVideosLoading,
  } = useVideos(favorites);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [selectedSceneStartTime, setSelectedSceneStartTime] = useState<number | undefined>(undefined);
  const [showInspirationMode, setShowInspirationMode] = useState(false);
  const [showFavoriteProfiles, setShowFavoriteProfiles] = useState(false);

  // View Mode: 'videos' (standard) or 'scenes' (Twelve Labs-style scene search)
  const [viewMode, setViewMode] = useState<"videos" | "scenes">("videos");
  const [sceneQuery, setSceneQuery] = useState("");
  const [sceneResults, setSceneResults] = useState<SceneSearchResult[]>([]);
  const [allScenes, setAllScenes] = useState<SceneItem[]>([]);
  const [isScenesLoading, setIsScenesLoading] = useState(false);
  const [selectedKeywordCategory, setSelectedKeywordCategory] = useState<string>("all");
  const [isKeywordsExpanded, setIsKeywordsExpanded] = useState<boolean>(false);

  const activeSceneWords = useMemo(() => parseQueryWords(sceneQuery), [sceneQuery]);

  // When words are selected, dynamically compute co-occurring keywords from the matching scene subset!
  const scenesForKeywords = useMemo(() => {
    if (activeSceneWords.length > 0 && sceneResults.length > 0) {
      return sceneResults.map((r) => r.scene);
    }
    return allScenes;
  }, [activeSceneWords, sceneResults, allScenes]);

  const keywordCategories = useMemo(() => {
    return getSceneKeywordCategories(scenesForKeywords, activeSceneWords);
  }, [scenesForKeywords, activeSceneWords]);

  const handleToggleSceneKeyword = useCallback((keyword: string) => {
    const currentWords = parseQueryWords(sceneQuery);
    const normalized = keyword.trim();
    const exists = currentWords.some((w) => w.toLowerCase() === normalized.toLowerCase());

    let nextWords: string[];
    if (exists) {
      nextWords = currentWords.filter((w) => w.toLowerCase() !== normalized.toLowerCase());
    } else {
      nextWords = [...currentWords, normalized];
    }
    setSceneQuery(nextWords.join(" "));
  }, [sceneQuery]);

  const handleRemoveSceneKeyword = useCallback((wordToRemove: string) => {
    const nextWords = parseQueryWords(sceneQuery).filter(
      (w) => w.toLowerCase() !== wordToRemove.toLowerCase()
    );
    setSceneQuery(nextWords.join(" "));
  }, [sceneQuery]);

  const loadMoreRef = useRef<HTMLDivElement>(null);
  const { data: selectedVideoDetail } = trpc.videos.get.useQuery(
    { id: selectedVideo?.id ?? "__none__" },
    { enabled: Boolean(selectedVideo), staleTime: 5 * 60 * 1000 }
  );
  const detailedVideo = selectedVideoDetail as Video | null | undefined;
  const modalVideo = detailedVideo?.id === selectedVideo?.id ? detailedVideo : selectedVideo;
  const metadataSuggestions = useMemo(() => collectMetadataValueSuggestions(allVideos), [allVideos]);

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore) {
          loadMore();
        }
      },
      { rootMargin: "200px" }
    );
    if (loadMoreRef.current) observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  // Show scroll-to-top button
  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 600);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Preload scenes index and dynamically merge newly analyzed videos from DB (No Python execution needed!)
  useEffect(() => {
    let isMounted = true;
    setIsScenesLoading(true);
    loadSceneIndex(allVideos)
      .then((data) => {
        if (isMounted) {
          setAllScenes(data);
          setIsScenesLoading(false);
        }
      })
      .catch((err) => {
        console.error("Failed to load scene index:", err);
        if (isMounted) setIsScenesLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [allVideos]);

  // Sync header search into scene search in real-time
  useEffect(() => {
    if (filters.search) {
      setSceneQuery(filters.search);
    }
  }, [filters.search]);

  // Execute fast client-side scene search
  useEffect(() => {
    let isMounted = true;
    const runSearch = async () => {
      if (allScenes.length === 0) return;
      const results = await searchScenes(sceneQuery, 80);
      if (isMounted) {
        setSceneResults(results);
      }
    };
    runSearch();
    return () => {
      isMounted = false;
    };
  }, [sceneQuery, allScenes]);

  // Handle click on scene card: open VideoModal with timestamp
  const handleSceneClick = useCallback((scene: SceneItem) => {
    const targetVideo = allVideos.find((v) => v.id === scene.videoId);
    if (targetVideo) {
      setSelectedSceneStartTime(scene.startSeconds);
      setSelectedVideo(targetVideo);
    }
  }, [allVideos]);

  const applyModalFilter = useCallback((filter: VideoModalFilter) => {
    const setters: Record<VideoModalFilter["key"], (value: string | null) => void> = {
      genre: setGenre,
      product: setProduct,
      direction: setDirection,
      tone: setTone,
      purpose: setPurpose,
      expression: setExpression,
      toneEmotion: setToneEmotion,
      toneVisual: setToneVisual,
      toneTechnique: setToneTechnique,
      production: setProduction,
      productionRole: setProductionRole,
      privateRating: setPrivateRating,
      aiOverallRating: setAiOverallRating,
      aiDirectionRating: setAiDirectionRating,
      aiTechniqueRating: setAiTechniqueRating,
    };
    setters[filter.key](filter.value);
    setSelectedVideo(null);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [setAiDirectionRating, setAiOverallRating, setAiTechniqueRating, setDirection, setExpression, setGenre, setPrivateRating, setProduct, setProduction, setProductionRole, setPurpose, setTone, setToneEmotion, setToneTechnique, setToneVisual]);

  // Build active filter tags
  const activeFilters: { label: string; type: string; onRemove: () => void }[] = [];
  if (filters.genre) {
    activeFilters.push({ label: getFilterLabel(filters.genre, "genre"), type: "genre", onRemove: () => setGenre(null) });
  }
  if (filters.product) {
    activeFilters.push({ label: getFilterLabel(filters.product, "product"), type: "product", onRemove: () => setProduct(null) });
  }
  if (filters.direction) {
    activeFilters.push({ label: getFilterLabel(filters.direction, "direction"), type: "direction", onRemove: () => setDirection(null) });
  }
  if (filters.tone) {
    activeFilters.push({ label: getFilterLabel(filters.tone, "tone"), type: "tone", onRemove: () => setTone(null) });
  }
  if (filters.purpose) activeFilters.push({ label: filters.purpose, type: "purpose", onRemove: () => setPurpose(null) });
  if (filters.expression) activeFilters.push({ label: filters.expression, type: "expression", onRemove: () => setExpression(null) });
  if (filters.toneEmotion) activeFilters.push({ label: filters.toneEmotion, type: "toneEmotion", onRemove: () => setToneEmotion(null) });
  if (filters.toneVisual) activeFilters.push({ label: filters.toneVisual, type: "toneVisual", onRemove: () => setToneVisual(null) });
  if (filters.toneTechnique) activeFilters.push({ label: filters.toneTechnique, type: "toneTechnique", onRemove: () => setToneTechnique(null) });
  if (filters.production) activeFilters.push({ label: filters.production, type: "production", onRemove: () => setProduction(null) });
  if (filters.privateRating) activeFilters.push({ label: `評価 ${filters.privateRating}`, type: "privateRating", onRemove: () => setPrivateRating(null) });
  if (filters.aiOverallRating) activeFilters.push({ label: `AI評価（総合） ${filters.aiOverallRating}`, type: "aiOverallRating", onRemove: () => setAiOverallRating(null) });
  if (filters.aiDirectionRating) activeFilters.push({ label: `AI評価（ディレクション） ${filters.aiDirectionRating}`, type: "aiDirectionRating", onRemove: () => setAiDirectionRating(null) });
  if (filters.aiTechniqueRating) activeFilters.push({ label: `AI評価（技術） ${filters.aiTechniqueRating}`, type: "aiTechniqueRating", onRemove: () => setAiTechniqueRating(null) });
  if (filters.source) activeFilters.push({ label: `出典 ${sourceFilterOptions.find((item) => item.value === filters.source)?.label || filters.source}`, type: "source", onRemove: () => setSource(null) });
  if (filters.eizo100Only) activeFilters.push({ label: filters.eizo100Year ? `映像作家100人 ${filters.eizo100Year}` : "映像作家100人", type: "eizo100", onRemove: () => setEizo100Only(false) });
  if (filters.showUnavailable) activeFilters.push({ label: "再生不可・非公開を表示", type: "unavailable", onRemove: () => setShowUnavailable(false) });

  // 一覧の無限スクロール表示件数や画面上の絞り込みではなく、全公開動画を抽選母集団にする。
  const allVideosForInspiration = useMemo(
    () => getInspirationSourceVideos(allVideos),
    [allVideos],
  );

  // Compute related videos for selected video (same genre or direction, excluding self)
  const relatedVideos = selectedVideo
    ? (() => {
        const genreSlugs = new Set(selectedVideo.genres.map(g => g.slug));
        const dirSlugs = new Set(selectedVideo.directions.map(d => d.slug));
        const scored = videos
          .filter(v => v.id !== selectedVideo.id)
          .map(v => ({
            video: v,
            score:
              v.genres.filter(g => genreSlugs.has(g.slug)).length * 2 +
              v.directions.filter(d => dirSlugs.has(d.slug)).length,
          }))
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score);
        return scored.slice(0, 6).map(({ video }) => video);
      })()
    : [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header
        search={filters.search}
        onSearchChange={setSearch}
        filteredCount={filteredCount}
        totalCount={totalCount}
        isLoading={isVideosLoading}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        activeFilterCount={activeFilterCount}
      />

      <div className="flex">
        {/* Desktop sidebar (videos mode only) */}
        {viewMode === "videos" && (
          <div className="hidden lg:block w-64 xl:w-72 flex-shrink-0 border-r border-white/5 sticky top-16 h-[calc(100vh-4rem)] bg-[oklch(0.12_0.005_285)]">
            <div className="px-4 pt-4 h-full">
              <Sidebar
                filters={filters}
                categoryCounts={categoryCounts}
                totalCount={totalCount}
                filteredCount={filteredCount}
                isLoading={isVideosLoading}
                onGenreChange={setGenre}
                onProductChange={setProduct}
                onDirectionChange={setDirection}
                onToneChange={setTone}
                metadataFilterOptions={metadataFilterOptions}
                onPurposeChange={setPurpose}
                onExpressionChange={setExpression}
                onToneEmotionChange={setToneEmotion}
                onToneVisualChange={setToneVisual}
                onToneTechniqueChange={setToneTechnique}
                onProductionChange={setProduction}
                productionFilterOptions={productionFilterOptions}
                onProductionRoleChange={setProductionRole}
                creatorFavorites={creatorFavorites}
                isCreatorFavorite={isCreatorFavorite}
                onToggleCreatorFavorite={toggleCreatorFavorite}
                onPrivateRatingChange={setPrivateRating}
                onAiOverallRatingChange={setAiOverallRating}
                onAiDirectionRatingChange={setAiDirectionRating}
                onAiTechniqueRatingChange={setAiTechniqueRating}
                sourceFilterOptions={sourceFilterOptions}
                onSourceChange={setSource}
                eizo100Count={eizo100Count}
                eizo100YearCounts={eizo100YearCounts}
                onEizo100Change={setEizo100Only}
                onEizo100YearChange={setEizo100Year}
                unavailableCount={unavailableCount}
                onShowUnavailableChange={setShowUnavailable}
                lowAiOverallCount={lowAiOverallCount}
                onShowLowAiOverallChange={setShowLowAiOverall}
                onClearAll={clearAllFilters}
                activeFilterCount={activeFilterCount}
              />
            </div>
          </div>
        )}

        {/* Mobile sidebar overlay */}
        <AnimatePresence>
          {sidebarOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
                onClick={() => setSidebarOpen(false)}
              />
              <motion.div
                initial={{ x: -300 }}
                animate={{ x: 0 }}
                exit={{ x: -300 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className="fixed left-0 top-0 bottom-0 z-50 w-72 bg-[oklch(0.12_0.005_285)] border-r border-white/5 lg:hidden"
              >
                <div className="px-4 pt-4 h-full">
                  <Sidebar
                    filters={filters}
                    categoryCounts={categoryCounts}
                    totalCount={totalCount}
                    filteredCount={filteredCount}
                    isLoading={isVideosLoading}
                    onGenreChange={(v) => { setGenre(v); setSidebarOpen(false); }}
                    onProductChange={(v) => { setProduct(v); setSidebarOpen(false); }}
                    onDirectionChange={(v) => { setDirection(v); setSidebarOpen(false); }}
                    onToneChange={(v) => { setTone(v); setSidebarOpen(false); }}
                    metadataFilterOptions={metadataFilterOptions}
                    onPurposeChange={(v) => { setPurpose(v); setSidebarOpen(false); }}
                    onExpressionChange={(v) => { setExpression(v); setSidebarOpen(false); }}
                    onToneEmotionChange={(v) => { setToneEmotion(v); setSidebarOpen(false); }}
                    onToneVisualChange={(v) => { setToneVisual(v); setSidebarOpen(false); }}
                    onToneTechniqueChange={(v) => { setToneTechnique(v); setSidebarOpen(false); }}
                    onProductionChange={(v) => { setProduction(v); setSidebarOpen(false); }}
                    productionFilterOptions={productionFilterOptions}
                    onProductionRoleChange={(v) => { setProductionRole(v); setSidebarOpen(false); }}
                    creatorFavorites={creatorFavorites}
                    isCreatorFavorite={isCreatorFavorite}
                    onToggleCreatorFavorite={toggleCreatorFavorite}
                    onPrivateRatingChange={(v) => { setPrivateRating(v); setSidebarOpen(false); }}
                    onAiOverallRatingChange={(v) => { setAiOverallRating(v); setSidebarOpen(false); }}
                    onAiDirectionRatingChange={(v) => { setAiDirectionRating(v); setSidebarOpen(false); }}
                    onAiTechniqueRatingChange={(v) => { setAiTechniqueRating(v); setSidebarOpen(false); }}
                    sourceFilterOptions={sourceFilterOptions}
                    onSourceChange={(v) => { setSource(v); setSidebarOpen(false); }}
                    eizo100Count={eizo100Count}
                    eizo100YearCounts={eizo100YearCounts}
                    onEizo100Change={(v) => { setEizo100Only(v); setSidebarOpen(false); }}
                    onEizo100YearChange={(v) => { setEizo100Year(v); setSidebarOpen(false); }}
                    unavailableCount={unavailableCount}
                    onShowUnavailableChange={(v) => { setShowUnavailable(v); setSidebarOpen(false); }}
                    lowAiOverallCount={lowAiOverallCount}
                    onShowLowAiOverallChange={(v) => { setShowLowAiOverall(v); setSidebarOpen(false); }}
                    onClearAll={() => { clearAllFilters(); setSidebarOpen(false); }}
                    activeFilterCount={activeFilterCount}
                    onClose={() => setSidebarOpen(false)}
                  />
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Main content */}
        <main className="flex-1 min-w-0">
          {/* Hero section */}
          <div className="relative h-44 sm:h-52 md:h-60 overflow-hidden">
            <img
              src={HERO_IMAGE}
              alt="イケてる映像コレクション"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-background/20" />
            <div className="absolute bottom-0 left-0 right-0 px-6 pb-5">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
              >
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight text-white leading-none mb-1.5">
                  <span className="text-cinematic-red">#</span>イケてる映像
                </h2>
                <p className="text-xs sm:text-sm text-white/50 max-w-lg leading-relaxed">
                  日本中心に世界中のイケてる映像を集約。ジャンル・商材・演出・トーンで検索できる映像クリエイターのための参考サイト。
                </p>
              </motion.div>
            </div>
          </div>

          {/* Mode Selector Tabs (Videos vs Scenes) */}
          <div className="bg-[oklch(0.12_0.005_285)] border-b border-white/10 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setViewMode("videos")}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
                  viewMode === "videos"
                    ? "bg-white/15 text-white shadow-sm border border-white/20"
                    : "text-muted-foreground hover:text-white hover:bg-white/5"
                }`}
              >
                <Film className="w-4 h-4 text-cinematic-red" />
                <span>動画一覧</span>
                <span className="text-[11px] font-mono px-1.5 py-0.2 rounded-full bg-white/10 text-white/80">
                  {totalCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode("scenes")}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all relative ${
                  viewMode === "scenes"
                    ? "bg-gradient-to-r from-cinematic-red/25 to-amber-500/25 text-white border border-amber-400/40 shadow-md shadow-amber-500/10"
                    : sceneQuery.trim() && sceneResults.length > 0
                    ? "bg-amber-400/15 text-amber-300 border border-amber-400/30 animate-pulse"
                    : "text-muted-foreground hover:text-white hover:bg-white/5"
                }`}
              >
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>シーン・秒数検索</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 font-bold border border-amber-400/30">
                  Twelve Labs風
                </span>
                <span className="hidden sm:inline-block text-[11px] font-mono px-1.5 py-0.2 rounded-full bg-white/10 text-white/80">
                  {sceneQuery.trim() && sceneResults.length > 0
                    ? `${sceneResults.length}件ヒット!`
                    : allScenes.length > 0
                    ? `${allScenes.length}シーン`
                    : "1,312シーン"}
                </span>
              </button>
            </div>

            {viewMode === "scenes" && (
              <div className="hidden md:flex items-center gap-1.5 text-[11px] text-amber-300/80 bg-amber-400/10 px-2.5 py-1 rounded-md border border-amber-400/20">
                <Zap className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                <span>カードにカーソルを合わせると該当シーンを自動プレビュー再生</span>
              </div>
            )}
          </div>

          {viewMode === "scenes" ? (
            /* Scenes Mode View (Twelve Labs Style) */
            <div className="px-4 sm:px-6 py-6 max-w-7xl mx-auto w-full">
              {/* Scene Search Header & Query Input */}
              <div className="bg-[oklch(0.13_0.008_285)] border border-white/10 rounded-2xl p-5 sm:p-7 mb-8 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-amber-500/10 via-cinematic-red/5 to-transparent rounded-full blur-3xl pointer-events-none" />

                <div className="flex flex-col gap-4 relative z-10">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-amber-400/15 text-amber-300 border border-amber-400/30">
                          <Sparkles className="w-3 h-3 text-amber-400" />
                          Twelve Labs-style Scene Search
                        </span>
                        <span className="text-[11px] text-white/40">完全¥0・API代ゼロ</span>
                      </div>
                      <h3 className="text-lg sm:text-xl font-bold text-white mt-1">
                        自然言語シーン・タイムスタンプ検索
                      </h3>
                      <p className="text-xs sm:text-sm text-white/60 mt-0.5">
                        「夕日が海に沈む美しい映像」「夜の都会を走る車」など、見たい情景やアクションを自然言語で瞬時に検索できます。
                      </p>
                    </div>

                    <div className="text-right">
                      <span className="text-xs text-white/50 block">解析済みシーン総数</span>
                      <span className="text-xl sm:text-2xl font-black font-mono text-amber-400">
                        {allScenes.length.toLocaleString()}
                        <span className="text-xs font-normal text-white/60 ml-1">シーン</span>
                      </span>
                    </div>
                  </div>

                  {/* Main Search Input */}
                  <div className="relative mt-2">
                    <div className="relative flex items-center bg-black/50 border border-white/15 focus-within:border-amber-400/60 focus-within:ring-2 focus-within:ring-amber-400/20 rounded-xl transition-all shadow-inner">
                      <SearchIcon className="w-5 h-5 text-amber-400/80 ml-4 flex-shrink-0" />
                      <input
                        type="text"
                        value={sceneQuery}
                        onChange={(e) => setSceneQuery(e.target.value)}
                        placeholder="何が起きているシーンを探しますか？（複数単語で絞り込み可: 夕日 海、夜 ダンス、車 雨）"
                        className="w-full bg-transparent text-sm sm:text-base py-3.5 px-3.5 outline-none text-white placeholder:text-white/30"
                      />
                      {sceneQuery && (
                        <button
                          onClick={() => setSceneQuery("")}
                          className="p-2 mr-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                          title="検索をクリア"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Active Selected Keyword Tags (Drill-down Filter Badges) */}
                  {activeSceneWords.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                      <span className="text-xs text-white/60 font-semibold flex items-center gap-1 mr-1">
                        <span>🔍</span>
                        <span>選択中の絞り込み:</span>
                      </span>
                      {activeSceneWords.map((word) => (
                        <span
                          key={word}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-400 text-black text-xs font-bold shadow-md animate-in fade-in zoom-in-95 duration-150"
                        >
                          <span>{word}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveSceneKeyword(word)}
                            className="p-0.5 rounded-full hover:bg-black/20 text-black/70 hover:text-black transition-colors"
                            title={`「${word}」を解除`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      ))}
                      <button
                        type="button"
                        onClick={() => setSceneQuery("")}
                        className="text-xs text-white/40 hover:text-amber-400 underline ml-1.5 transition-colors font-medium"
                      >
                        すべて解除
                      </button>
                    </div>
                  )}

                  {/* Dynamic Categorized Keyword Presets (Strictly >= 2 hits guaranteed, auto-refined on selection) */}
                  <div className="pt-2 flex flex-col gap-2.5">
                    {/* Category Selector Tabs */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs text-white/50 font-semibold mr-1 flex items-center gap-1">
                        <span>🏷️</span>
                        <span>{activeSceneWords.length > 0 ? "さらに絞り込めるキーワード例:" : "キーワード例:"}</span>
                      </span>
                      <button
                        onClick={() => setSelectedKeywordCategory("all")}
                        className={`text-xs px-2.5 py-1 rounded-full transition-all border font-medium ${
                          selectedKeywordCategory === "all"
                            ? "bg-white/20 text-white border-white/40 shadow-sm"
                            : "bg-white/5 hover:bg-white/10 text-white/60 border-white/10 hover:border-white/20"
                        }`}
                      >
                        すべて
                      </button>
                      {keywordCategories.map((cat) => (
                        <button
                          key={cat.id}
                          onClick={() => setSelectedKeywordCategory(cat.id)}
                          className={`text-xs px-2.5 py-1 rounded-full transition-all border font-medium flex items-center gap-1 ${
                            selectedKeywordCategory === cat.id
                              ? "bg-amber-400/20 text-amber-300 border-amber-400/50 shadow-sm"
                              : "bg-white/5 hover:bg-white/10 text-white/60 border-white/10 hover:border-white/20"
                          }`}
                        >
                          <span>{cat.icon}</span>
                          <span>{cat.name}</span>
                          {cat.keywords.length > 0 && (
                            <span className="text-[10px] opacity-60 font-mono">({cat.keywords.length})</span>
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Keywords Pill Grid */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {(() => {
                        const targetKeywords = selectedKeywordCategory === "all"
                          ? keywordCategories.flatMap((c) => c.keywords).sort((a, b) => b.count - a.count)
                          : keywordCategories.find((c) => c.id === selectedKeywordCategory)?.keywords || [];

                        // Deduplicate in "all" view
                        const uniqueKeywords: { text: string; count: number }[] = [];
                        const seen = new Set<string>();
                        for (const kw of targetKeywords) {
                          if (!seen.has(kw.text)) {
                            seen.add(kw.text);
                            uniqueKeywords.push(kw);
                          }
                        }

                        if (uniqueKeywords.length === 0 && activeSceneWords.length > 0) {
                          return (
                            <span className="text-xs text-white/40 italic py-1">
                              現在の絞り込み条件（{activeSceneWords.join(" + ")}）に合致するこれ以上の共通キーワードはありません。
                            </span>
                          );
                        }

                        const displayKeywords = isKeywordsExpanded ? uniqueKeywords : uniqueKeywords.slice(0, 20);

                        return (
                          <>
                            {displayKeywords.map((kw) => {
                              const isSelected = activeSceneWords.some((w) => w.toLowerCase() === kw.text.toLowerCase());
                              return (
                                <button
                                  key={kw.text}
                                  onClick={() => handleToggleSceneKeyword(kw.text)}
                                  className={`text-xs px-2.5 py-1 rounded-full transition-all border flex items-center gap-1.5 ${
                                    isSelected
                                      ? "bg-amber-400 text-black font-bold border-amber-300 shadow-md scale-105"
                                      : "bg-white/5 hover:bg-white/12 text-white/85 border-white/10 hover:border-white/25 hover:text-white"
                                  }`}
                                  title={
                                    isSelected
                                      ? `「${kw.text}」の絞り込みを解除`
                                      : activeSceneWords.length > 0
                                      ? `「${activeSceneWords.join(" + ")}」に「${kw.text}」を追加して絞り込む（${kw.count}件ヒット）`
                                      : `「${kw.text}」でシーン検索（${kw.count}件ヒット）`
                                  }
                                >
                                  <span>{isSelected ? `✓ ${kw.text}` : activeSceneWords.length > 0 ? `+ ${kw.text}` : kw.text}</span>
                                  <span
                                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                                      isSelected
                                        ? "bg-black/20 text-black font-bold"
                                        : "bg-white/10 text-white/50"
                                    }`}
                                  >
                                    {kw.count}
                                  </span>
                                </button>
                              );
                            })}

                            {uniqueKeywords.length > 20 && (
                              <button
                                onClick={() => setIsKeywordsExpanded(!isKeywordsExpanded)}
                                className="text-xs px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/10 text-amber-400/90 hover:text-amber-300 border border-amber-400/20 hover:border-amber-400/40 transition-all font-medium"
                              >
                                {isKeywordsExpanded ? "閉じる ▲" : `+他${uniqueKeywords.length - 20}件 ▼`}
                              </button>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Results Status Header */}
              <div className="flex items-center justify-between mb-4 px-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white/70">
                    {activeSceneWords.length > 0 ? (
                      <>
                        {activeSceneWords.map((w, idx) => (
                          <span key={w}>
                            {idx > 0 && <span className="text-white/40 mx-1">＋</span>}
                            「<span className="text-amber-400 font-bold">{w}</span>」
                          </span>
                        ))}
                        <span className="text-white/70 ml-1">の該当シーン:</span>
                        <span className="ml-1.5 text-base font-bold text-white font-mono">{sceneResults.length}</span> 件
                      </>
                    ) : (
                      <>
                        注目のシーン一覧:
                        <span className="ml-1.5 text-base font-bold text-white font-mono">{sceneResults.length}</span> 件
                      </>
                    )}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs text-white/50">
                  <span className="hidden sm:inline">🖱️ カードをホバーでプレビュー / クリックで本編再生</span>
                </div>
              </div>

              {/* Scenes Grid */}
              {isScenesLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div key={index} className="aspect-[16/12] animate-pulse rounded-xl bg-white/[0.05]" />
                  ))}
                </div>
              ) : sceneResults.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                  {sceneResults.map((result, index) => (
                    <SceneCard
                      key={result.scene.id}
                      scene={result.scene}
                      index={index}
                      matchedTerms={result.matchedTerms}
                      score={result.score}
                      onClick={handleSceneClick}
                    />
                  ))}
                </div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-center justify-center py-20 text-center bg-surface-1/40 rounded-2xl border border-white/5"
                >
                  <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mb-4 border border-amber-500/20">
                    <Sparkles className="w-7 h-7 text-amber-400" />
                  </div>
                  <h3 className="text-base font-bold mb-1.5 text-white">該当するシーンが見つかりませんでした</h3>
                  <p className="text-xs text-white/50 mb-5 max-w-sm">
                    別のキーワード（「海」「夜」「車」「走る」「ダンス」など）や上記のおすすめタグをお試しください
                  </p>
                  <button
                    onClick={() => setSceneQuery("")}
                    className="text-xs bg-amber-400/15 text-amber-300 hover:bg-amber-400/25 px-4 py-2 rounded-lg transition-colors font-medium border border-amber-400/30"
                  >
                    すべてのシーンを表示
                  </button>
                </motion.div>
              )}
            </div>
          ) : (
            /* Videos Mode View (Original) */
            <>
              {/* Creator toolbar */}
              <div className="px-4 sm:px-6 py-2.5 border-b border-white/5 bg-[oklch(0.11_0.005_285)] flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setShowFavoriteProfiles(true)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                activeProfile
                  ? "border-sky-400/25 bg-sky-400/10 text-sky-200 hover:bg-sky-400/15"
                  : "border-amber-400/25 bg-amber-400/10 text-amber-200 hover:bg-amber-400/15"
              }`}
              title="お気に入りを使う利用者を選択・管理"
            >
              <UsersRound className="h-3.5 w-3.5" />
              {activeProfile ? `利用者：${activeProfile.displayName}` : "利用者を選択"}
            </button>

            {/* Inspiration mode button */}
            <button
              onClick={() => setShowInspirationMode(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cinematic-red/10 hover:bg-cinematic-red/20 text-cinematic-red text-xs font-medium transition-colors border border-cinematic-red/20"
            >
              <Shuffle className="w-3.5 h-3.5" />
              インスピレーションモード
            </button>

            {/* Favorites filter */}
            <button
              type="button"
              disabled={!activeProfile}
              onClick={() => setFavoritesOnly(!filters.favoritesOnly)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                filters.favoritesOnly
                  ? "bg-amber-400/10 text-amber-400 border-amber-400/20"
                  : "bg-white/5 text-muted-foreground border-white/10 hover:bg-white/10"
              } ${!activeProfile ? "cursor-not-allowed opacity-45" : ""}`}
              title={activeProfile ? `${activeProfile.displayName}のお気に入りを絞り込み` : "先に利用者を選択してください"}
            >
              {filters.favoritesOnly ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
              お気に入り
              {favoriteCount > 0 && (
                <span className={`ml-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${filters.favoritesOnly ? "bg-amber-400/20" : "bg-white/10"}`}>
                  {favoriteCount}
                </span>
              )}
            </button>


          </div>

          {/* Sort bar + active filters */}
          <div className="sticky top-16 z-30 bg-background/95 backdrop-blur-md border-b border-white/5 px-4 sm:px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 flex-wrap">
                {isVideosLoading ? (
                  <span className="inline-flex items-center gap-2 text-sm text-muted-foreground flex-shrink-0" role="status">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    映像を読み込み中…
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground flex-shrink-0">
                    <span className="font-bold text-foreground tabular-nums">{filteredCount}</span>
                    <span className="ml-1">本の映像</span>
                  </span>
                )}

                {/* Favorites only badge */}
                {filters.favoritesOnly && (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-amber-400/10 text-amber-400 border border-amber-400/20">
                    <Bookmark className="w-3 h-3" />
                    お気に入りのみ
                    <button onClick={() => setFavoritesOnly(false)} className="hover:bg-amber-400/20 rounded p-0.5 transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}

                {/* Active filter tags */}
                {activeFilters.map((f) => (
                  <span
                    key={f.type}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-cinematic-red/10 text-cinematic-red border border-cinematic-red/20"
                  >
                    {f.label}
                    <button onClick={f.onRemove} className="hover:bg-cinematic-red/20 rounded p-0.5 transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}

                {filters.search.trim() && (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-white/5 text-foreground/80 border border-white/10">
                    「{filters.search}」
                    <button onClick={() => setSearch("")} className="hover:bg-white/10 rounded p-0.5 transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}

                {activeFilterCount > 1 && (
                  <button onClick={clearAllFilters} className="text-xs text-muted-foreground hover:text-cinematic-red transition-colors">
                    すべてクリア
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <select
                  value={filters.sort}
                  onChange={(e) => setSort(e.target.value as "newest" | "oldest")}
                  className="text-xs bg-surface-1 border border-white/10 rounded-md px-2.5 py-1.5 text-foreground outline-none focus:ring-1 focus:ring-cinematic-red/40"
                >
                  <option value="newest">新しい順</option>
                  <option value="oldest">古い順</option>
                </select>
              </div>
            </div>
          </div>

          {/* Video grid */}
          <div className="px-4 sm:px-6 py-6">
            {isVideosLoading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 2xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, index) => (
                  <div key={index} className="aspect-[16/11] animate-pulse rounded-xl bg-white/[0.05]" />
                ))}
              </div>
            ) : videos.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 sm:gap-5">
                {videos.map((video, index) => (
                  <VideoCard
                    key={video.id}
                    video={video}
                    index={index}
                    isFavorite={isFavorite(video.id)}
                    hasNote={!!getNote(video.id)}
                    onClick={() => setSelectedVideo(video)}
                  />
                ))}
              </div>
            ) : filters.search.trim() && sceneResults.length > 0 ? (
              /* Smart Scene Fallback when title search returns 0 videos */
              <div className="py-6">
                <div className="bg-gradient-to-r from-amber-500/15 via-cinematic-red/10 to-transparent border border-amber-500/30 rounded-2xl p-5 sm:p-6 mb-6">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0 border border-amber-500/40">
                        <Sparkles className="w-5 h-5 text-amber-400" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-white flex items-center gap-2">
                          <span>「{filters.search}」に該当するシーンが <span className="text-amber-400 font-mono text-lg">{sceneResults.length}</span> 件見つかりました</span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-400/20 text-amber-300 font-bold border border-amber-400/30">
                            Twelve Labs風
                          </span>
                        </h3>
                        <p className="text-xs text-white/60 mt-0.5">
                          作品タイトルではなく、映像内の客観描写・タイムスタンプから該当シーンを抽出しています。
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => setViewMode("scenes")}
                      className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-black font-bold text-xs transition-colors flex items-center gap-1.5 shadow-md flex-shrink-0"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      シーン検索モードで全画面表示
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 sm:gap-5">
                  {sceneResults.slice(0, 12).map((result, index) => (
                    <SceneCard
                      key={result.scene.id}
                      scene={result.scene}
                      index={index}
                      matchedTerms={result.matchedTerms}
                      score={result.score}
                      onClick={handleSceneClick}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center py-24 text-center"
              >
                <div className="w-20 h-20 rounded-2xl bg-surface-1 flex items-center justify-center mb-5 border border-white/5">
                  <svg className="w-8 h-8 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" />
                    <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold mb-2">映像が見つかりません</h3>
                <p className="text-sm text-muted-foreground mb-5 max-w-xs">
                  検索条件を変更するか、フィルターをクリアしてお試しください
                </p>
                <button
                  onClick={clearAllFilters}
                  className="text-sm bg-cinematic-red/10 text-cinematic-red hover:bg-cinematic-red/20 px-4 py-2 rounded-lg transition-colors font-medium border border-cinematic-red/20"
                >
                  フィルターをクリア
                </button>
              </motion.div>
            )}

            {/* Load more trigger */}
            <div ref={loadMoreRef} className="h-10 flex items-center justify-center mt-8">
              {hasMore && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-xs">読み込み中...</span>
                </div>
              )}
            </div>
          </div>
          </>
          )}

          {/* Footer */}
          <footer className="border-t border-white/5 px-6 py-8">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded bg-cinematic-red flex items-center justify-center">
                  <span className="text-white font-black text-[8px]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>IK</span>
                </div>
                <span>イケてる映像コレクション</span>
              </div>
              <p>映像クリエイターのための参考映像キュレーションサイト</p>
            </div>
          </footer>
        </main>
      </div>

      {/* Video modal */}
      {modalVideo && (
        <VideoModal
          video={modalVideo}
          onClose={() => {
            setSelectedVideo(null);
            setSelectedSceneStartTime(undefined);
          }}
          isFavorite={isFavorite(modalVideo.id)}
          onToggleFavorite={toggleFavorite}
          favoriteProfileName={activeProfile?.displayName}
          onChooseFavoriteProfile={() => setShowFavoriteProfiles(true)}
          note={getNote(modalVideo.id)}
          onSaveNote={saveNote}
          relatedVideos={relatedVideos}
          onSelectRelated={(v) => setSelectedVideo(v)}
          onVideoUpdated={setSelectedVideo}
          onFilter={applyModalFilter}
          metadataSuggestions={metadataSuggestions}
          initialStartTime={selectedSceneStartTime}
        />
      )}

      {/* Inspiration mode */}
      <AnimatePresence>
        {showInspirationMode && (
          <InspirationMode
            videos={allVideosForInspiration}
            onClose={() => setShowInspirationMode(false)}
            isFavorite={isFavorite}
            onToggleFavorite={toggleFavorite}
            favoriteProfileName={activeProfile?.displayName}
            onChooseFavoriteProfile={() => setShowFavoriteProfiles(true)}
            getNote={getNote}
            onSaveNote={saveNote}
          />
        )}
      </AnimatePresence>

      <FavoriteProfileManager
        open={showFavoriteProfiles}
        onOpenChange={setShowFavoriteProfiles}
        profiles={profiles}
        activeProfile={activeProfile}
        onSelectProfile={selectProfile}
        onCreateProfile={createProfile}
        onRenameProfile={renameProfile}
        onDeleteProfile={deleteProfile}
        legacyMigrationPending={legacyMigrationPending}
        onMigrateLegacyFavorites={migrateLegacyFavorites}
      />

      {/* Scroll to top button */}
      <AnimatePresence>
        {showScrollTop && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={scrollToTop}
            className="fixed bottom-6 right-6 z-40 w-10 h-10 rounded-full bg-cinematic-red/90 text-white flex items-center justify-center shadow-lg shadow-cinematic-red/30 hover:bg-cinematic-red transition-colors"
          >
            <ArrowUp className="w-4 h-4" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
