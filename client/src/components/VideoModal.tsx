/**
 * Video modal with embedded player and lightweight external-link fallback
 * Design: Cinematic Noir — dark overlay, cinematic framing, smooth entrance
 * Features: YouTube/Vimeo embed, tag display, and official-page fallback links
 */
import React, { useEffect, useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ExternalLink, Calendar, Bookmark, BookmarkCheck, StickyNote, Check, Copy, Loader2, Pencil, Save, AlertTriangle } from "lucide-react";
import type { TagItem, Video, VideoSource } from "@/lib/types";
import { SOURCE_LABELS, SOURCE_COLORS } from "@/lib/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { getProductionNames, getProductionRoles, normalizeProductionCredits, productionCreditsToEditableText } from "@shared/productionCredits";
import { clampScore100, scoreToRating } from "@shared/ratingScale";
import {
  CALIBRATED_AXIS_DEFINITIONS,
  formatAxisScore,
  resolveCalibratedScoreAxes,
} from "@shared/calibratedScoreAxes";
import { getAnalysisObservationScopeWarning } from "@shared/analysisObservationScope";
import MetadataValuePicker from "@/components/MetadataValuePicker";
import { collectMetadataValueSuggestions, resolveSuggestedTagItems, type MetadataValueSuggestions } from "@/lib/metadataValueSuggestions";
import { detectVideoUrl } from "@/lib/videoUrlDetection";
import { extractClientPitch, upsertClientPitchInAnalysis } from "@/lib/curationNote";
import AiAnalysisReport from "@/components/AiAnalysisReport";

export type VideoModalFilter = {
  key: "genre" | "product" | "direction" | "tone" | "purpose" | "expression" | "toneEmotion" | "toneVisual" | "toneTechnique" | "production" | "productionRole" | "privateRating" | "aiOverallRating" | "aiDirectionRating" | "aiTechniqueRating";
  value: string;
};

type VideoEditDraft = {
  title: string;
  tags: string[];
  genres: string[];
  products: string[];
  directions: string[];
  tones: string[];
  purposes: string[];
  expressions: string[];
  toneEmotions: string[];
  toneVisuals: string[];
  toneTechniques: string[];
  productionCreditText: string;
  privateRating: string;
  aiOverallRating: string;
  aiDirectionRating: string;
  aiTechniqueRating: string;
  aiOverallScore: string;
  aiDirectionScore: string;
  aiTechniqueScore: string;
  aiAnalysis: string;
  curationPurpose: string;
  curationBackground: string;
  curationEvaluation: string;
  curationClientPitch: string;
  curationSources: string;
};

const parseList = (value: string) => Array.from(new Set(value.split(/[,\n、]/).map((item) => item.trim()).filter(Boolean)));
const toText = (values: string[]) => values.join(", ");
const toTagItems = (values: string[], catalog: TagItem[]) => values.map((name) => catalog.find((item) => item.name === name) ?? { name, slug: name.trim().toLowerCase().replace(/\s+/g, "-") });

function draftFromVideo(video: Video): VideoEditDraft {
  return {
    title: video.title,
    tags: video.allTags,
    genres: video.genres.map((item) => item.name),
    products: video.products.map((item) => item.name),
    directions: video.directions.map((item) => item.name),
    tones: video.tones.map((item) => item.name),
    purposes: video.purposes,
    expressions: video.expressions,
    toneEmotions: video.toneEmotions,
    toneVisuals: video.toneVisuals,
    toneTechniques: video.toneTechniques,
    productionCreditText: productionCreditsToEditableText(normalizeProductionCredits(video.productionCredits, video.productions)),
    privateRating: video.privateRating || "",
    aiOverallRating: video.aiOverallRating || "",
    aiDirectionRating: video.aiDirectionRating || "",
    aiTechniqueRating: video.aiTechniqueRating || "",
    aiOverallScore: typeof video.aiOverallScore === "number" ? String(video.aiOverallScore) : "",
    aiDirectionScore: typeof video.aiDirectionScore === "number" ? String(video.aiDirectionScore) : "",
    aiTechniqueScore: typeof video.aiTechniqueScore === "number" ? String(video.aiTechniqueScore) : "",
    aiAnalysis: video.aiAnalysis || "",
    curationPurpose: video.curationNote?.purpose || "",
    curationBackground: video.curationNote?.background || "",
    curationEvaluation: video.curationNote?.evaluation || "",
    curationClientPitch: extractClientPitch(video),
    curationSources: toText(video.curationNote?.sourceUrls || []),
  };
}

interface VideoModalProps {
  video: Video;
  onClose: () => void;
  initialStartTime?: number;
  isFavorite?: boolean;
  onToggleFavorite?: (id: string) => void;
  favoriteProfileName?: string;
  onChooseFavoriteProfile?: () => void;
  note?: string;
  onSaveNote?: (id: string, note: string) => void;
  relatedVideos?: Video[];
  onSelectRelated?: (video: Video) => void;
  onVideoUpdated?: (video: Video) => void;
  onFilter?: (filter: VideoModalFilter) => void;
  metadataSuggestions?: MetadataValueSuggestions;
}

function getEmbedSrc(video: Video, initialStartTime?: number): string {
  const detected = detectVideoUrl(video.videoUrl);
  const youtubeId = video.platform === "youtube"
    ? video.id
    : detected?.platform === "youtube"
      ? detected.id
      : null;
  if (youtubeId) {
    // enablejsapi=1 is required to receive postMessage events (onReady, onError)
    // Using youtube.com (not nocookie) for more reliable postMessage delivery
    // origin param helps YouTube identify the embedding page
    // origin must NOT be encodeURIComponent'd — YouTube expects raw URL like https://example.com
    const origin = window.location.origin;
    const start = Number.isFinite(initialStartTime) && (initialStartTime ?? 0) > 0 ? `&start=${Math.floor(initialStartTime!)}` : "";
    return `https://www.youtube.com/embed/${youtubeId}?enablejsapi=1&origin=${origin}&rel=0${start}`;
  }
  if (video.platform === "vimeo") {
    return `https://player.vimeo.com/video/${video.id}?autoplay=1&title=0&byline=0&portrait=0`;
  }
  return video.embedUrl;
}

function isYouTubeVideo(video: Video): boolean {
  return video.platform === "youtube" || detectVideoUrl(video.videoUrl)?.platform === "youtube";
}

function getAiRatingBadgeClass(rating: string) {
  const normalized = rating.trim().toUpperCase();
  if (normalized.startsWith("S") || normalized.startsWith("A")) {
    return "border-amber-400/35 bg-amber-400/12 text-amber-200";
  }
  if (normalized.startsWith("B")) {
    return "border-sky-400/35 bg-sky-400/12 text-sky-200";
  }
  return "border-white/15 bg-white/[0.06] text-white/80";
}


export default function VideoModal({
  video,
  onClose,
  initialStartTime,
  isFavorite = false,
  onToggleFavorite,
  favoriteProfileName,
  onChooseFavoriteProfile,
  note = "",
  onSaveNote,
  relatedVideos = [],
  onSelectRelated,
  onVideoUpdated,
  onFilter,
  metadataSuggestions,
}: VideoModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedClientPitch, setCopiedClientPitch] = useState(false);
  const [editDraft, setEditDraft] = useState<VideoEditDraft>(() => draftFromVideo(video));
  const utils = trpc.useUtils();
  const updateVideo = trpc.videos.update.useMutation();
  const availableMetadataSuggestions = metadataSuggestions ?? collectMetadataValueSuggestions([video]);

  useEffect(() => {
    setEditDraft(draftFromVideo(video));
    setIsEditing(false);
  }, [video.id]);

  const copyVideoUrl = async () => {
    try {
      await navigator.clipboard.writeText(video.videoUrl);
      setCopiedUrl(true);
      toast.success("動画URLをコピーしました。");
      window.setTimeout(() => setCopiedUrl(false), 1800);
    } catch {
      toast.error("URLをコピーできませんでした。ブラウザの権限をご確認ください。");
    }
  };

  const resolvedClientPitch = extractClientPitch(video);

  const copyClientPitch = async () => {
    const pitch = resolvedClientPitch;
    if (!pitch) return;
    try {
      await navigator.clipboard.writeText(pitch);
      setCopiedClientPitch(true);
      toast.success("クライアント説明用フレーズをコピーしました。");
      window.setTimeout(() => setCopiedClientPitch(false), 1800);
    } catch {
      toast.error("コピーできませんでした。ブラウザの権限をご確認ください。");
    }
  };

  const saveEdit = async () => {
    const title = editDraft.title.trim();
    if (!title) {
      toast.error("タイトルを入力してください。");
      return;
    }
    try {
      const productionCredits = normalizeProductionCredits([], editDraft.productionCreditText.split(/\n+/));
      const productions = getProductionNames(productionCredits);
      const productionRoles = getProductionRoles(productionCredits);
      const nextClientPitch = editDraft.curationClientPitch.trim();
      const nextAiAnalysis = nextClientPitch !== resolvedClientPitch
        ? upsertClientPitchInAnalysis(editDraft.aiAnalysis, nextClientPitch)
        : editDraft.aiAnalysis;
      const nextCurationNote = {
        purpose: editDraft.curationPurpose,
        background: editDraft.curationBackground,
        evaluation: editDraft.curationEvaluation,
        ...(nextClientPitch ? { clientPitch: nextClientPitch } : (video.curationNote?.clientPitch ? { clientPitch: "" } : {})),
        sourceUrls: parseList(editDraft.curationSources),
      };
      await updateVideo.mutateAsync({
        id: video.id,
        platform: video.platform,
        title,
        thumbnail: video.thumbnail || "",
        videoUrl: video.videoUrl,
        embedUrl: video.embedUrl || "",
        source: video.source || "manual",
        sourceLabel: video.sourceLabel || "手動追加",
        channelId: video.channelId || "",
        channelTitle: video.channelTitle || "",
        genres: resolveSuggestedTagItems(editDraft.genres, availableMetadataSuggestions.genres),
        products: resolveSuggestedTagItems(editDraft.products, availableMetadataSuggestions.products),
        directions: resolveSuggestedTagItems(editDraft.directions, availableMetadataSuggestions.directions),
        tones: resolveSuggestedTagItems(editDraft.tones, availableMetadataSuggestions.tones),
        tags: editDraft.tags,
        purposes: editDraft.purposes,
        expressions: editDraft.expressions,
        toneEmotions: editDraft.toneEmotions,
        toneVisuals: editDraft.toneVisuals,
        toneTechniques: editDraft.toneTechniques,
        productions,
        productionCredits,
        privateRating: editDraft.privateRating,
        aiOverallRating: editDraft.aiOverallRating,
        aiDirectionRating: editDraft.aiDirectionRating,
        aiTechniqueRating: editDraft.aiTechniqueRating,
        aiOverallScore: clampScore100(editDraft.aiOverallScore),
        aiDirectionScore: clampScore100(editDraft.aiDirectionScore),
        aiTechniqueScore: clampScore100(editDraft.aiTechniqueScore),
        aiAnalysis: nextAiAnalysis,
        curationNote: nextCurationNote,
        addedDate: video.addedDate,
      });
      const updatedVideo: Video = {
        ...video,
        title,
        genres: resolveSuggestedTagItems(editDraft.genres, availableMetadataSuggestions.genres),
        products: resolveSuggestedTagItems(editDraft.products, availableMetadataSuggestions.products),
        directions: resolveSuggestedTagItems(editDraft.directions, availableMetadataSuggestions.directions),
        tones: resolveSuggestedTagItems(editDraft.tones, availableMetadataSuggestions.tones),
        allTags: Array.from(new Set([...editDraft.tags, ...productions, ...productionRoles])),
        purposes: editDraft.purposes,
        expressions: editDraft.expressions,
        toneEmotions: editDraft.toneEmotions,
        toneVisuals: editDraft.toneVisuals,
        toneTechniques: editDraft.toneTechniques,
        productions,
        productionCredits,
        privateRating: editDraft.privateRating,
        aiOverallRating: editDraft.aiOverallRating,
        aiDirectionRating: editDraft.aiDirectionRating,
        aiTechniqueRating: editDraft.aiTechniqueRating,
        aiOverallScore: clampScore100(editDraft.aiOverallScore),
        aiDirectionScore: clampScore100(editDraft.aiDirectionScore),
        aiTechniqueScore: clampScore100(editDraft.aiTechniqueScore),
        aiAnalysis: nextAiAnalysis,
        curationNote: nextCurationNote,
      };
      await utils.videos.list.invalidate();
      onVideoUpdated?.(updatedVideo);
      setIsEditing(false);
      toast.success("動画情報を更新しました。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存に失敗しました。");
    }
  };

  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [noteText, setNoteText] = useState(note);

  // Keyboard & scroll lock
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  const allTags: Array<TagItem & { type: "genre" | "product" | "direction" | "tone" }> = [
    ...video.genres.map((g) => ({ ...g, type: "genre" as const })),
    ...video.products.map((p) => ({ ...p, type: "product" as const })),
    ...video.directions.map((d) => ({ ...d, type: "direction" as const })),
    ...video.tones.map((t) => ({ ...t, type: "tone" as const })),
  ];
  const productionCredits = normalizeProductionCredits(video.productionCredits, video.productions);
  const aiRatings = [
    { label: "AI評価（総合）", key: "aiOverallRating" as const, value: video.aiOverallRating, score: video.aiOverallScore },
    { label: "AI評価（ディレクション）", key: "aiDirectionRating" as const, value: video.aiDirectionRating, score: video.aiDirectionScore },
    { label: "AI評価（技術）", key: "aiTechniqueRating" as const, value: video.aiTechniqueRating, score: video.aiTechniqueScore },
  ].filter((rating) => Boolean(rating.value));
  const hasCalibrated = typeof video.calibratedScore === "number";
  const isUnverifiedCalibratedGenre =
    hasCalibrated && video.calibrationStatus === "calibrated_unverified_genre";
  const isLegacyUncalibrated =
    !hasCalibrated &&
    (video.calibrationStatus === "legacy_uncalibrated" ||
      aiRatings.length > 0 ||
      typeof video.aiOverallScore === "number");
  const calibratedScoreText = hasCalibrated
    ? Number.isInteger(video.calibratedScore)
      ? String(video.calibratedScore)
      : video.calibratedScore!.toFixed(1)
    : "";
  const calibratedBandLabel =
    video.calibratedTierBand === "award_tier"
      ? "受賞水準 (83点以上)"
      : video.calibratedTierBand === "pro_band"
      ? "商業標準 (63〜82.9点)"
      : video.calibratedTierBand === "low_band"
      ? "低品質域 (63点未満)"
      : "";
  const observationWarning = getAnalysisObservationScopeWarning(video.analysisObservationScope, {
    hasCalibratedScore: hasCalibrated,
  });

  const calibratedAxes = hasCalibrated
    ? resolveCalibratedScoreAxes({
        calibratedScoreAxes: video.calibratedScoreAxes,
        calibratedBreakdown: video.calibratedBreakdown,
        calibratedRoute: video.calibratedRoute,
      })
    : null;

  const embedSrc = getEmbedSrc(video, initialStartTime);

  const handleSaveNote = () => {
    if (onSaveNote) onSaveNote(video.id, noteText);
    setShowNoteEditor(false);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/90 backdrop-blur-sm"
        onClick={handleBackdropClick}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="w-full max-w-4xl max-h-[90vh] bg-[oklch(0.13_0.005_285)] rounded-xl overflow-hidden shadow-2xl border border-white/[0.06] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 sm:px-5 py-2.5 border-b border-white/[0.06] flex-shrink-0">
            <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                    video.platform === "youtube"
                      ? "bg-red-600 text-white"
                      : video.platform === "vimeo"
                      ? "bg-sky-600 text-white"
                      : "bg-zinc-700 text-white"
                  }`}
                >
                  {video.platform === "youtube" ? "YOUTUBE" : video.platform === "vimeo" ? "VIMEO" : "WEB"}
                </span>
              {video.source && (
                <span
                  className={`text-[10px] font-medium px-2 py-0.5 rounded text-white ${
                    SOURCE_COLORS[video.source as VideoSource] || "bg-white/20"
                  }`}
                >
                  {video.sourceLabel ||
                    SOURCE_LABELS[video.source as VideoSource] ||
                    video.source}
                </span>
              )}
              {video.channelTitle && (
                <span className="text-[11px] text-muted-foreground hidden sm:inline">
                  {video.channelTitle}
                </span>
              )}
            </div>
            {(hasCalibrated || aiRatings.length > 0) && (
              <div
                className="min-w-0 flex-1 flex items-center justify-center gap-1.5 px-1 sm:gap-2 sm:px-4 flex-wrap"
                aria-label={
                  hasCalibrated
                    ? `校正済みスコア ${calibratedScoreText}点`
                    : aiRatings.map((rating) => `${rating.label} ${rating.value}`).join("、")
                }
              >
                {hasCalibrated && (
                  <span
                    data-testid="modal-header-calibrated-score"
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[9px] sm:text-[10px] font-semibold tracking-wide ${
                      isUnverifiedCalibratedGenre
                        ? "border-amber-400/40 bg-amber-500/15 text-amber-200"
                        : "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                    }`}
                  >
                    <span className="opacity-75 font-medium">校正済</span>
                    <span className="font-mono text-[10px] font-bold">{calibratedScoreText}点</span>
                    {isUnverifiedCalibratedGenre && <span className="ml-0.5 text-[8.5px] text-amber-300">(未検証ジャンル)</span>}
                  </span>
                )}
                {!hasCalibrated && isLegacyUncalibrated && (
                  <span
                    data-testid="modal-header-legacy-badge"
                    className="inline-flex items-center rounded-full border border-zinc-500/40 bg-zinc-500/15 px-2 py-0.5 text-[9px] font-medium text-zinc-300"
                  >
                    旧評価
                  </span>
                )}
                {!hasCalibrated && aiRatings.map((rating) => (
                  <span key={rating.key} className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] sm:px-2.5 sm:text-[10px] font-semibold tracking-wide ${getAiRatingBadgeClass(rating.value!)}`}>
                    <span className="text-white/45 font-medium">
                      {rating.key === "aiOverallRating" ? "旧評価 総合" : rating.key === "aiDirectionRating" ? "旧評価 演出" : "旧評価 技術"}
                    </span>
                    <span className="font-bold">{rating.value}</span>
                    {typeof rating.score === "number" && (
                      <span className="font-mono text-[9px] opacity-80">{rating.score}pt</span>
                    )}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={copyVideoUrl}
                className={`p-1.5 rounded-lg transition-colors ${copiedUrl ? "text-emerald-400 bg-emerald-400/10" : "text-muted-foreground hover:bg-white/10 hover:text-foreground"}`}
                title="動画URLをコピー"
              >
                {copiedUrl ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
              <button
                onClick={() => {
                  if (isEditing) setEditDraft(draftFromVideo(video));
                  setIsEditing((current) => !current);
                }}
                className={`p-1.5 rounded-lg transition-colors ${isEditing ? "text-cinematic-red bg-cinematic-red/10" : "text-muted-foreground hover:bg-white/10 hover:text-foreground"}`}
                title={isEditing ? "編集をキャンセル" : "追加情報を編集"}
              >
                <Pencil className="w-4 h-4" />
              </button>
              {onToggleFavorite && (
                <button
                  onClick={() => favoriteProfileName ? onToggleFavorite(video.id) : onChooseFavoriteProfile?.()}
                  className={`p-1.5 rounded-lg transition-colors ${
                    isFavorite
                      ? "text-amber-400 hover:bg-amber-400/10"
                      : "text-muted-foreground hover:bg-white/10"
                  }`}
                  title={favoriteProfileName ? `${favoriteProfileName}のお気に入り${isFavorite ? "から削除" : "に追加"}` : "先にお気に入りの利用者を選択"}
                >
                  {isFavorite ? (
                    <BookmarkCheck className="w-4 h-4" />
                  ) : (
                    <Bookmark className="w-4 h-4" />
                  )}
                </button>
              )}
              {onSaveNote && (
                <button
                  onClick={() => setShowNoteEditor(!showNoteEditor)}
                  className={`p-1.5 rounded-lg transition-colors ${
                    noteText
                      ? "text-sky-400 hover:bg-sky-400/10"
                      : "text-muted-foreground hover:bg-white/10"
                  }`}
                  title="メモを書く"
                >
                  <StickyNote className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="overflow-y-auto flex-1">
            {/* ===== Video area ===== */}
            <div className="aspect-video bg-black relative">
              {!isYouTubeVideo(video) && video.platform !== "vimeo" ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-white/[0.08] to-black px-6 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/45"><ExternalLink className="h-5 w-5 text-white/75" /></div>
                  <div><p className="text-sm font-semibold text-white/90">外部サイトの動画です</p><p className="mt-1 text-[11px] text-white/50">この動画は埋め込み再生に対応していません</p></div>
                  <a href={video.videoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-[#FF3D00] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#FF5722]"><ExternalLink className="h-4 w-4" />元ページを開く</a>
                </div>
              ) : (
                <>
                  {/* YouTube is always attempted, regardless of stored embedStatus/embedReason. */}
                  <iframe
                    key={video.id}
                    src={embedSrc}
                    title={video.title}
                    className="w-full h-full absolute inset-0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                  {Number.isFinite(initialStartTime) && (initialStartTime ?? 0) > 0 && (
                    <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/80 backdrop-blur-md border border-amber-500/40 text-amber-300 text-xs font-mono shadow-lg pointer-events-none">
                      <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                      <span>⏱ {Math.floor(initialStartTime! / 60).toString().padStart(2, "0")}:{(Math.floor(initialStartTime!) % 60).toString().padStart(2, "0")} 付近から再生中</span>
                    </div>
                  )}
                  <a href={video.videoUrl} target="_blank" rel="noopener noreferrer" className="absolute bottom-2 right-2 z-20 inline-flex items-center gap-1 rounded-full bg-black/65 px-2.5 py-1 text-[10px] text-white/65 backdrop-blur-sm transition-colors hover:text-white">
                    {isYouTubeVideo(video) ? "YouTube公式で開く" : "Vimeo公式で開く"} <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              )}
            </div>

            {/* Note editor */}
            <AnimatePresence>
              {showNoteEditor && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="border-b border-white/[0.06] overflow-hidden"
                >
                  <div className="px-4 sm:px-5 py-3 bg-sky-950/30">
                    <div className="flex items-center gap-2 mb-2">
                      <StickyNote className="w-3.5 h-3.5 text-sky-400" />
                      <span className="text-xs font-medium text-sky-400">メモ</span>
                    </div>
                    <textarea
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="この映像について気づいたこと、参考にしたいポイントをメモ..."
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-sky-500/40 min-h-[80px]"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2 mt-2">
                      <button
                        onClick={() => setShowNoteEditor(false)}
                        className="text-xs px-3 py-1.5 rounded-md text-muted-foreground hover:bg-white/5 transition-colors"
                      >
                        キャンセル
                      </button>
                      <button
                        onClick={handleSaveNote}
                        className="text-xs px-3 py-1.5 rounded-md bg-sky-600 text-white hover:bg-sky-500 transition-colors font-medium"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Saved note display */}
            {noteText && !showNoteEditor && (
              <div
                className="px-4 sm:px-5 py-2.5 bg-sky-950/20 border-b border-white/[0.06] cursor-pointer hover:bg-sky-950/30 transition-colors"
                onClick={() => setShowNoteEditor(true)}
              >
                <div className="flex items-start gap-2">
                  <StickyNote className="w-3.5 h-3.5 text-sky-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-sky-200/70 leading-relaxed line-clamp-2">
                    {noteText}
                  </p>
                </div>
              </div>
            )}

            {/* Info section */}
            <div className="px-4 sm:px-5 py-4">
              {isEditing ? (
                <div className="mb-5 rounded-lg border border-cinematic-red/25 bg-cinematic-red/[0.035] p-3 sm:p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-cinematic-red">追加情報を編集</span>
                    <span className="text-[10px] text-muted-foreground">候補は複数追加、候補外だけ手入力できます</span>
                  </div>
                  <label className="mb-3 block text-xs text-muted-foreground">タイトル
                    <textarea value={editDraft.title} onChange={(event) => setEditDraft((current) => ({ ...current, title: event.target.value }))} rows={2} className="mt-1.5 w-full resize-none rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-cinematic-red/40" />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <MetadataValuePicker label="追加タグ" values={editDraft.tags} suggestions={availableMetadataSuggestions.tags} onChange={(values) => setEditDraft((current) => ({ ...current, tags: values }))} placeholder="例：シネマティック" />
                    <MetadataValuePicker label="ジャンル" values={editDraft.genres} suggestions={availableMetadataSuggestions.genres.map((item) => item.name)} onChange={(values) => setEditDraft((current) => ({ ...current, genres: values }))} placeholder="例：ショートフィルム" />
                    <MetadataValuePicker label="商材" values={editDraft.products} suggestions={availableMetadataSuggestions.products.map((item) => item.name)} onChange={(values) => setEditDraft((current) => ({ ...current, products: values }))} placeholder="例：教育 / 出版" />
                    <MetadataValuePicker label="演出" values={editDraft.directions} suggestions={availableMetadataSuggestions.directions.map((item) => item.name)} onChange={(values) => setEditDraft((current) => ({ ...current, directions: values }))} placeholder="例：ワンカット / 長回し" />
                    <MetadataValuePicker label="トーン" values={editDraft.tones} suggestions={availableMetadataSuggestions.tones.map((item) => item.name)} onChange={(values) => setEditDraft((current) => ({ ...current, tones: values }))} placeholder="例：レトロ / ノスタルジック / 昭和・平成" />
                  </div>
                  <label className="mt-3 block text-xs text-muted-foreground">制作クレジット
                    <span className="mt-1 block text-[10px] text-muted-foreground/70">1行ずつ「役割：人物・会社名」で入力します。役割が不明な場合は名前だけを入力できます。</span>
                    <textarea value={editDraft.productionCreditText} onChange={(event) => setEditDraft((current) => ({ ...current, productionCreditText: event.target.value }))} placeholder={"監督：代田栄介\n制作会社：LIGHT THE WAY Inc."} rows={4} className="mt-1.5 w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/45 focus:ring-1 focus:ring-cinematic-red/40" />
                  </label>
                  <div className="mt-4 border-t border-white/[0.08] pt-3">
                    <span className="mb-2 block text-xs font-semibold text-foreground/85">Notion AI評価・分析</span>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {([
                        ["aiOverallRating", "aiOverallScore", "AI評価（総合）"],
                        ["aiDirectionRating", "aiDirectionScore", "AI評価（ディレクション）"],
                        ["aiTechniqueRating", "aiTechniqueScore", "AI評価（技術）"],
                      ] as const).map(([ratingKey, scoreKey, label]) => (
                        <div key={ratingKey} className="space-y-1.5">
                          <label className="block text-xs text-muted-foreground">{label}
                            <input value={editDraft[ratingKey]} onChange={(event) => setEditDraft((current) => ({ ...current, [ratingKey]: event.target.value }))} placeholder="例：A-" className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-cinematic-red/40" />
                          </label>
                          <label className="block text-[11px] text-muted-foreground/80">100点スコア (0-100)
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={editDraft[scoreKey]}
                              onChange={(event) => {
                                const raw = event.target.value;
                                const parsed = clampScore100(raw);
                                setEditDraft((current) => ({
                                  ...current,
                                  [scoreKey]: raw,
                                  ...(parsed !== null && !current[ratingKey] ? { [ratingKey]: scoreToRating(parsed) } : {}),
                                }));
                              }}
                              placeholder="例：84"
                              className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-mono text-foreground outline-none focus:ring-1 focus:ring-cinematic-red/40"
                            />
                          </label>
                        </div>
                      ))}
                    </div>
                    <label className="mt-3 block text-xs text-muted-foreground">AI分析結果
                      <textarea value={editDraft.aiAnalysis} onChange={(event) => setEditDraft((current) => ({ ...current, aiAnalysis: event.target.value }))} rows={5} placeholder="NotionのAI分析結果を入力" className="mt-1.5 w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs leading-relaxed text-foreground outline-none focus:ring-1 focus:ring-cinematic-red/40" />
                    </label>
                  </div>
                  <div className="mt-4 border-t border-white/[0.08] pt-3">
                    <span className="mb-2 block text-xs font-semibold text-foreground/85">キュレーションメモ</span>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-xs text-muted-foreground">制作目的
                        <textarea value={editDraft.curationPurpose} onChange={(event) => setEditDraft((current) => ({ ...current, curationPurpose: event.target.value }))} rows={3} placeholder="何を達成するための映像か" className="mt-1.5 w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs leading-relaxed text-foreground outline-none focus:ring-1 focus:ring-cinematic-red/40" />
                      </label>
                      <label className="text-xs text-muted-foreground">制作背景
                        <textarea value={editDraft.curationBackground} onChange={(event) => setEditDraft((current) => ({ ...current, curationBackground: event.target.value }))} rows={3} placeholder="依頼背景・社会的背景・企画意図" className="mt-1.5 w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs leading-relaxed text-foreground outline-none focus:ring-1 focus:ring-cinematic-red/40" />
                      </label>
                    </div>
                    <label className="mt-3 block text-xs text-muted-foreground">評価・受賞理由
                      <textarea value={editDraft.curationEvaluation} onChange={(event) => setEditDraft((current) => ({ ...current, curationEvaluation: event.target.value }))} rows={4} placeholder="どのような評価を受けたか、見るべき表現は何か" className="mt-1.5 w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs leading-relaxed text-foreground outline-none focus:ring-1 focus:ring-cinematic-red/40" />
                    </label>
                    <label className="mt-3 block text-xs text-muted-foreground">クライアント説明用 企画意図3行まとめ
                      <textarea value={editDraft.curationClientPitch} onChange={(event) => setEditDraft((current) => ({ ...current, curationClientPitch: event.target.value }))} rows={3} placeholder="なぜこのカット割／配色／音設計にするのかをクライアントへそのまま共有できる3行説明" className="mt-1.5 w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs leading-relaxed text-foreground outline-none focus:ring-1 focus:ring-cinematic-red/40" />
                    </label>
                    <label className="mt-3 block text-xs text-muted-foreground">公式出典URL
                      <textarea value={editDraft.curationSources} onChange={(event) => setEditDraft((current) => ({ ...current, curationSources: event.target.value }))} rows={2} placeholder="複数URLはカンマまたは改行で区切る" className="mt-1.5 w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs leading-relaxed text-foreground outline-none focus:ring-1 focus:ring-cinematic-red/40" />
                    </label>
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <button type="button" onClick={() => { setEditDraft(draftFromVideo(video)); setIsEditing(false); }} className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-white/5">キャンセル</button>
                    <button type="button" onClick={saveEdit} disabled={updateVideo.isPending} className="inline-flex items-center gap-1.5 rounded-md bg-cinematic-red px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-cinematic-red-light disabled:opacity-60">{updateVideo.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}変更を保存</button>
                  </div>
                </div>
              ) : (
                <h2 className="text-base sm:text-lg font-bold text-foreground leading-snug mb-3">
                  {video.title}
                </h2>
              )}

              {observationWarning && (
                <div
                  role="alert"
                  data-testid="unwatched-warning-banner"
                  data-observation-scope={observationWarning.scope}
                  className={`mb-4 rounded-lg border px-3.5 py-3 text-xs leading-relaxed ${
                    observationWarning.severity === "high"
                      ? "border-amber-400/50 bg-amber-500/12 text-amber-100"
                      : "border-yellow-400/40 bg-yellow-500/10 text-yellow-100"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        observationWarning.severity === "high" ? "text-amber-300" : "text-yellow-300"
                      }`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-amber-200">{observationWarning.title}</span>
                        <span className="rounded border border-white/15 bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-white/75">
                          {observationWarning.scope}
                        </span>
                      </div>
                      <p className="text-white/85">{observationWarning.description}</p>
                      {observationWarning.calibratedScoreNote && (
                        <p className="text-[11px] text-amber-200/90">{observationWarning.calibratedScoreNote}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Tags */}
              {!isEditing && allTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {allTags.map((tag) => (
                    <button
                      key={`${tag.type}-${tag.slug}`}
                      onClick={() => onFilter?.({ key: tag.type, value: tag.slug })}
                      title={`${tag.name}で絞り込む`}
                      className={`text-[11px] px-2 py-0.5 rounded-md border font-medium ${
                        tag.type === "genre"
                          ? "border-red-500/25 text-red-400 bg-red-500/5"
                          : tag.type === "direction"
                          ? "border-blue-500/25 text-blue-400 bg-blue-500/5"
                          : tag.type === "tone"
                          ? "border-amber-500/25 text-amber-400 bg-amber-500/5"
                          : "border-white/10 text-muted-foreground bg-white/5"
                      } transition-colors hover:brightness-125 hover:ring-1 hover:ring-white/20`}
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>
              )}

              {(productionCredits.length > 0 || hasCalibrated || aiRatings.length > 0 || video.aiAnalysis) && (
                <div className="mb-5 rounded-lg border border-white/[0.08] bg-white/[0.025] px-3.5 py-3">
                  <div className="mb-2.5 flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-foreground/85">制作クレジット・AI評価</span>
                  </div>
                  <dl className="space-y-2.5">
                    {productionCredits.length > 0 && (
                      <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 text-xs">
                        <dt className="text-muted-foreground">制作</dt>
                        <dd className="space-y-1.5">
                          {productionCredits.map((credit) => (
                            <div key={credit.name} className="flex flex-wrap items-center gap-1.5">
                              <button onClick={() => onFilter?.({ key: "production", value: credit.name })} title={`${credit.name}で絞り込む`} className="rounded bg-white/[0.08] px-1.5 py-0.5 font-medium text-foreground/90 transition-colors hover:bg-white/[0.14] hover:text-foreground">{credit.name}</button>
                              {credit.roles.map((role) => <button key={`${credit.name}-${role}`} onClick={() => onFilter?.({ key: "productionRole", value: role })} title={`${role}で絞り込む`} className="rounded border border-cinematic-red/20 bg-cinematic-red/[0.06] px-1.5 py-0.5 text-[10px] text-cinematic-red/90 transition-colors hover:bg-cinematic-red/[0.13]">{role}</button>)}
                            </div>
                          ))}
                        </dd>
                      </div>
                    )}
                  </dl>
                  {(hasCalibrated || aiRatings.length > 0 || video.aiAnalysis) && (
                    <div className="mt-4 border-t border-white/[0.07] pt-3">
                      {hasCalibrated && (
                        <div className={`mb-4 rounded-lg border px-3 py-2.5 ${
                          isUnverifiedCalibratedGenre
                            ? "border-amber-400/35 bg-amber-500/[0.07]"
                            : "border-emerald-400/35 bg-emerald-500/[0.07]"
                        }`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className={`text-xs font-semibold ${isUnverifiedCalibratedGenre ? "text-amber-200" : "text-emerald-200"}`}>
                              校正済みAI評価（{video.calibrationVersion || "phase2_v1"}）
                            </span>
                            <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                              {calibratedBandLabel && (
                                <span className="rounded border border-white/15 bg-black/25 px-1.5 py-0.5 text-white/85">
                                  {calibratedBandLabel}
                                </span>
                              )}
                              {video.calibratedRoute && (
                                <span className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5 font-mono text-white/65">
                                  {video.calibratedRoute}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="mt-1.5 flex items-baseline gap-2">
                            <span className="text-xl font-bold text-white" data-testid="calibrated-total-score">
                              {calibratedScoreText}点
                            </span>
                            <span className="text-xs font-mono text-white/50">/ 100</span>
                            {video.calibrationGenreBucket && (
                              <span className="text-[11px] text-white/60">枠: {video.calibrationGenreBucket}</span>
                            )}
                          </div>
                          {calibratedAxes && (
                            <div
                              data-testid="calibrated-score-axes"
                              className="mt-3 space-y-2 border-t border-white/[0.08] pt-2.5"
                            >
                              {CALIBRATED_AXIS_DEFINITIONS.map((axis) => {
                                const value = calibratedAxes.axes[axis.key];
                                const pct = Math.max(0, Math.min(100, (value / axis.max) * 100));
                                return (
                                  <div
                                    key={axis.key}
                                    data-testid={`calibrated-axis-${axis.key}`}
                                    className="grid grid-cols-[96px_minmax(0,1fr)_52px] items-center gap-2.5 text-xs"
                                  >
                                    <span className="truncate text-[11px] font-medium text-white/80">
                                      {axis.label}
                                    </span>
                                    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                                      <div
                                        className={`h-full rounded-full transition-all ${
                                          isUnverifiedCalibratedGenre
                                            ? "bg-gradient-to-r from-amber-500/80 to-amber-300"
                                            : "bg-gradient-to-r from-emerald-500/80 to-emerald-300"
                                        }`}
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                    <span className="text-right font-mono text-[11px] font-semibold tabular-nums text-white/90">
                                      {formatAxisScore(value)}
                                      <span className="text-[10px] font-normal text-white/45">/{axis.max}</span>
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {isUnverifiedCalibratedGenre && (
                            <p className="mt-1.5 text-[11px] text-amber-200/90">
                              ※ このジャンルは未検証です（Phase 2 検証対象5ジャンル外のため参考値として表示しています）。
                            </p>
                          )}
                          {(video.calibratedAt || video.calibratedRunId) && (
                            <p className="mt-1 text-[10px] font-mono text-white/45">
                              {video.calibratedAt ? `採点日時: ${video.calibratedAt.slice(0, 10)}` : ""}
                              {video.calibratedRunId ? ` / Run: ${video.calibratedRunId}` : ""}
                            </p>
                          )}
                        </div>
                      )}
                      {!hasCalibrated && video.isProvisional && (
                        <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                          <span className="font-bold text-amber-300">【暫定評価】</span>
                          この動画は未視聴・メタデータ中心の一次/暫定評価です。映像確認による再分析が完了するまで、参照検索・生成素材の候補から除外されています。
                        </div>
                      )}
                      {!hasCalibrated && video.visualVerificationStatus === "log_verified" && (
                        <div className="mb-2 inline-flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
                          静止画確認済み（ログ照合済）
                        </div>
                      )}
                      {!hasCalibrated && video.visualVerificationStatus === "unverified_pending" && (
                        <div className="mb-2 inline-flex items-center gap-1.5 rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-300">
                          静止画確認：ログ照合待ち（unverified_pending）
                        </div>
                      )}
                      {!hasCalibrated && video.visualVerificationStatus === "unverifiable_no_log" && (
                        <div className="mb-2 inline-flex items-center gap-1.5 rounded border border-zinc-500/40 bg-zinc-500/15 px-2 py-0.5 text-[11px] text-zinc-300">
                          静止画確認：確認不能（過去ログなし・要再確認）
                        </div>
                      )}
                      {!hasCalibrated && video.visualVerificationStatus === "invalidated_no_visual" && (
                        <div className="mb-2 inline-flex items-center gap-1.5 rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-300">
                          静止画未確認（0枚のため点数無効化・再実施待ち）
                        </div>
                      )}
                      {!hasCalibrated && video.gradeBoundary && (
                        <div className="mb-2 ml-1.5 inline-flex items-center gap-1.5 rounded border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200">
                          ランク境界（隣接ランクまで1点以内）
                        </div>
                      )}
                      {!hasCalibrated && aiRatings.length > 0 && (
                        <div className="mb-3" data-testid="legacy-ai-ratings-section">
                          <span className="mb-1.5 block text-xs font-semibold text-foreground/85">
                            旧評価（未校正・参考保持）{video.isProvisional ? "（暫定）" : ""}
                          </span>
                          <div className="grid grid-cols-3 gap-2">
                            {aiRatings.map((rating) => {
                              const score =
                                rating.key === "aiOverallRating"
                                  ? video.aiOverallScore
                                  : rating.key === "aiDirectionRating"
                                  ? video.aiDirectionScore
                                  : video.aiTechniqueScore;
                              return (
                                <button key={rating.label} onClick={() => onFilter?.({ key: rating.key, value: rating.value! })} title={`${rating.label} ${rating.value} で絞り込む`} className="rounded-md border border-sky-400/20 bg-sky-400/[0.07] px-2 py-1.5 text-left transition-colors hover:bg-sky-400/[0.14]">
                                  <span className="block text-[9px] text-sky-300/70">{rating.label.replace("AI評価（", "").replace("）", "")}</span>
                                  <span className="mt-0.5 block text-sm font-bold text-sky-100">
                                    {rating.value}
                                    {typeof score === "number" ? (
                                      <span className="ml-1 text-[11px] font-medium text-sky-300/85">({score}点)</span>
                                    ) : null}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {video.aiAnalysis && observationWarning && (
                        <div
                          data-testid="unwatched-analysis-reminder"
                          className="mb-3 flex items-center gap-2 rounded-md border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200"
                        >
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
                          <span>
                            以下のAI分析レポートは <strong>{observationWarning.badgeLabel}</strong>（<code className="font-mono">{observationWarning.scope}</code>）として記録されています。
                          </span>
                        </div>
                      )}
                      {video.aiAnalysis && (
                        <AiAnalysisReport
                          analysis={video.aiAnalysis}
                          analysisVersion={video.analysisVersion}
                          analysisGeneratedAt={video.analysisGeneratedAt}
                          analysisPromptSha256={video.analysisPromptSha256}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              {video.awards?.length ? (
                <div className="mb-5 rounded-lg border border-yellow-400/20 bg-yellow-400/[0.045] px-3.5 py-3">
                  <span className="mb-2.5 block text-xs font-semibold tracking-[0.12em] text-yellow-200">AWARDS</span>
                  <div className="space-y-2">
                    {video.awards.map((award, index) => (
                      <a key={`${award.name}-${award.year}-${index}`} href={award.sourceUrl} target="_blank" rel="noreferrer" className="group flex items-start justify-between gap-3 rounded-md border border-yellow-400/15 bg-black/10 px-3 py-2 transition-colors hover:bg-yellow-400/10">
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-yellow-100">{award.name}</span>
                          <span className="mt-0.5 block text-xs text-zinc-400">{award.year} ・ {award.category}</span>
                        </span>
                        <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-yellow-300/80 transition-colors group-hover:text-yellow-200" />
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}

              {(video.curationNote?.purpose || video.curationNote?.background || video.curationNote?.evaluation || resolvedClientPitch || (video.curationNote?.sourceUrls?.length ?? 0) > 0) ? (
                <div className="mb-5 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.035] px-3.5 py-3">
                  <span className="mb-2.5 block text-xs font-semibold tracking-[0.12em] text-emerald-200">CURATION NOTE</span>
                  <div className="space-y-3 text-xs leading-relaxed">
                    {resolvedClientPitch ? (
                      <div className="rounded-md border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="block text-[10px] font-semibold tracking-wider text-amber-200">クライアント説明用・企画意図3行まとめ</span>
                          <button
                            type="button"
                            onClick={copyClientPitch}
                            className="inline-flex items-center gap-1 rounded border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-100 transition-colors hover:bg-amber-400/20"
                          >
                            {copiedClientPitch ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                            <span>{copiedClientPitch ? "コピー済み" : "説明文をコピー"}</span>
                          </button>
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap text-foreground/90">{resolvedClientPitch}</p>
                      </div>
                    ) : null}
                    {video.curationNote?.purpose ? <div><span className="block text-[10px] font-semibold text-emerald-300/75">制作目的</span><p className="mt-0.5 whitespace-pre-wrap text-foreground/80">{video.curationNote.purpose}</p></div> : null}
                    {video.curationNote?.background ? <div><span className="block text-[10px] font-semibold text-emerald-300/75">制作背景</span><p className="mt-0.5 whitespace-pre-wrap text-foreground/80">{video.curationNote.background}</p></div> : null}
                    {video.curationNote?.evaluation ? <div><span className="block text-[10px] font-semibold text-emerald-300/75">評価・受賞理由</span><p className="mt-0.5 whitespace-pre-wrap text-foreground/80">{video.curationNote.evaluation}</p></div> : null}
                    {(video.curationNote?.sourceUrls?.length ?? 0) > 0 ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {(video.curationNote?.sourceUrls ?? []).map((url, index) => (
                          <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-200 transition-colors hover:bg-emerald-400/20">
                            公式出典 {index + 1}<ExternalLink className="h-3 w-3" />
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/* Related videos */}
              {relatedVideos.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                    <span className="w-1 h-3 bg-[#FF3D00] rounded-full inline-block" />
                    類似のイケてる映像
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {relatedVideos.slice(0, 6).map((rv) => (
                      <button
                        key={rv.id}
                        onClick={() => onSelectRelated?.(rv)}
                        className="group relative aspect-video rounded-lg overflow-hidden bg-black/50 hover:ring-1 hover:ring-red-500/50 transition-all text-left"
                      >
                        <img
                          src={
                            rv.thumbnail ||
                            (rv.platform === "youtube"
                              ? `https://img.youtube.com/vi/${rv.id}/hqdefault.jpg`
                              : "")
                          }
                          alt={rv.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          onError={(e) => {
                            const img = e.target as HTMLImageElement;
                            if (rv.platform === "youtube" && !img.src.includes("sddefault")) {
                              img.src = `https://img.youtube.com/vi/${rv.id}/sddefault.jpg`;
                            }
                          }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                        <p className="absolute bottom-1.5 left-1.5 right-1.5 text-[10px] text-white font-medium leading-tight line-clamp-2">
                          {rv.title}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Footer actions */}
              <div className="flex items-center justify-between gap-3 pt-3 border-t border-white/[0.06]">
                <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>追加日: {video.addedDate}</span>
                  </div>
                  {video.source && (
                    <span className="text-[10px] opacity-60">
                      via{" "}
                      {video.sourceLabel ||
                        SOURCE_LABELS[video.source as VideoSource] ||
                        video.source}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <a href={`/manage?video=${encodeURIComponent(video.id)}`} className="text-xs text-muted-foreground transition-colors hover:text-foreground">管理編集</a>
                  <a
                    href={video.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm text-[#FF3D00] hover:text-[#FF5722] transition-colors font-medium"
                  >
                    <span>元の動画を見る</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
