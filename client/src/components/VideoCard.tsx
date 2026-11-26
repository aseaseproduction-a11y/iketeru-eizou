/**
 * Video card component with cinematic hover effects
 * Design: Cinematic Noir — thumbnail as light source, zoom on hover, tag underlines
 * Thumbnail fallback chain: maxresdefault → sddefault → hqdefault → placeholder
 * Features: favorite badge, note indicator, external click handler
 */
import React, { useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Play, Film, Bookmark, StickyNote, AlertCircle, User } from "lucide-react";
import type { Video, VideoSource } from "@/lib/types";
import { SOURCE_COLORS } from "@/lib/types";
import { formatEmbedRecheckAt, isEmbedStatusRecheckDue } from "@/lib/embedStatus";
import {
  isLegacyAnalysisVersion,
  LEGACY_ANALYSIS_LABEL,
  V3_ANALYSIS_LABEL,
} from "@shared/analysisVersion";

interface VideoCardProps {
  video: Video;
  index: number;
  isFavorite?: boolean;
  hasNote?: boolean;
  onClick?: () => void;
}

// YouTube thumbnail fallback chain
function getYouTubeFallbacks(videoId: string): string[] {
  return [
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/sddefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
  ];
}

function getEmbedReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    unavailable_private_or_deleted: "非公開・削除",
    unavailable_access_restricted: "アクセス制限",
    unavailable_embed_restricted: "埋め込み制限",
    unavailable_page_unavailable: "ページ非公開",
    check_failed: "再確認が必要",
  };
  return labels[reason] || "再生不可";
}

export function formatSourceLabel(source: string): string {
  if (source === "youtube_search") return "YT検索";
  if (source === "note") return "note";
  if (source === "eizo100") return "作家100";
  if (source === "vimeo_staff_picks") return "Staff Pick";
  if (source === "creator_tracking") return "追跡";
  if (source === "alincolony") return "ALINCO";
  if (source.startsWith("トレンド")) return "トレンド";
  if (source.length > 8) return source.slice(0, 6) + "…";
  return source;
}

export function getMainCreatorName(video: Video): string | null {
  // 1. 監督 / 演出 / ディレクター
  if (video.productionCredits && video.productionCredits.length > 0) {
    const director = video.productionCredits.find((c) =>
      c.roles?.some((r) => /監督|演出|ディレクター|director/i.test(r))
    );
    if (director && director.name?.trim()) return director.name.trim();

    // 2. 先頭のクレジット
    const first = video.productionCredits[0];
    if (first && first.name?.trim()) return first.name.trim();
  }

  // 3. productions
  if (video.productions && video.productions.length > 0 && video.productions[0]?.trim()) {
    return video.productions[0].trim();
  }

  // 4. channelTitle
  if (video.channelTitle && video.channelTitle.trim()) {
    return video.channelTitle.trim();
  }

  return null;
}

export default function VideoCard({ video, index, isFavorite = false, hasNote = false, onClick }: VideoCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [allFailed, setAllFailed] = useState(false);
  const fallbackIndexRef = useRef(0);
  const [currentSrc, setCurrentSrc] = useState(video.thumbnail);
  const mainCreator = getMainCreatorName(video);

  const handleClick = useCallback(() => {
    if (onClick) onClick();
  }, [onClick]);

  const handleImgError = useCallback(() => {
    if (video.platform === "youtube") {
      const fallbacks = getYouTubeFallbacks(video.id);
      const currentIdx = fallbackIndexRef.current;
      const nextIdx = currentIdx + 1;
      if (nextIdx < fallbacks.length) {
        fallbackIndexRef.current = nextIdx;
        setCurrentSrc(fallbacks[nextIdx]);
      } else {
        setAllFailed(true);
      }
    } else {
      setAllFailed(true);
    }
  }, [video.platform, video.id]);

  const allTagBadges = [
    ...video.genres.map((tag, index) => ({ key: `genre-${tag.name}-${index}`, name: tag.name })),
    ...video.products.map((tag, index) => ({ key: `product-${tag.name}-${index}`, name: tag.name })),
    ...video.directions.map((tag, index) => ({ key: `direction-${tag.name}-${index}`, name: tag.name })),
    ...video.tones.map((tag, index) => ({ key: `tone-${tag.name}-${index}`, name: tag.name })),
  ];
  const aiRatings = [
    { shortLabel: "総", fullLabel: "総合", value: video.aiOverallRating, score: video.aiOverallScore },
    { shortLabel: "演", fullLabel: "ディレクション", value: video.aiDirectionRating, score: video.aiDirectionScore },
    { shortLabel: "技", fullLabel: "技術", value: video.aiTechniqueRating, score: video.aiTechniqueScore },
  ].filter((rating) => Boolean(rating.value));
  const hasCalibrated = typeof video.calibratedScore === "number";
  const isUnverifiedCalibratedGenre =
    hasCalibrated && video.calibrationStatus === "calibrated_unverified_genre";
  const isLegacyUncalibrated =
    !hasCalibrated &&
    (video.calibrationStatus === "legacy_uncalibrated" ||
      aiRatings.length > 0 ||
      typeof video.aiOverallScore === "number");
  const calibratedScoreLabel = hasCalibrated
    ? Number.isInteger(video.calibratedScore)
      ? String(video.calibratedScore)
      : video.calibratedScore!.toFixed(1)
    : "";
  const embedRecheckDue = isEmbedStatusRecheckDue(video.embedStatus, video.embedCheckedAt);
  const embedRecheckAt = formatEmbedRecheckAt(video.embedCheckedAt);

  const getTagColor = (tag: string) => {
    if (video.genres.some((g) => g.name === tag)) return "bg-cinematic-red/70 text-white";
    if (video.directions.some((d) => d.name === tag)) return "bg-blue-600/70 text-white";
    if (video.tones.some((t) => t.name === tag)) return "bg-amber-600/70 text-white";
    return "bg-white/20 text-white/90";
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.025, 0.4), ease: "easeOut" }}
      className="group relative cursor-pointer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
    >
      {/* Thumbnail container */}
      <div className="relative aspect-video rounded-lg overflow-hidden bg-[oklch(0.15_0.005_285)] border border-white/5">
        {/* Thumbnail image or placeholder */}
        {allFailed || !currentSrc ? (
          <div data-testid="thumbnail-placeholder" className="relative w-full h-full overflow-hidden bg-[radial-gradient(circle_at_75%_15%,oklch(0.36_0.12_15_/_0.7),transparent_36%),linear-gradient(135deg,oklch(0.18_0.01_285),oklch(0.11_0.015_285))]">
            <div className="absolute -right-8 -top-10 h-36 w-36 rounded-full border border-white/10" />
            <div className="absolute -right-2 -top-2 h-20 w-20 rounded-full border border-cinematic-red/35" />
            <div className="relative flex h-full flex-col items-center justify-center gap-2 px-5 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/25 backdrop-blur-sm">
                <Film className="h-5 w-5 text-white/70" />
              </span>
              <span className="text-[9px] font-bold tracking-[0.18em] text-white/45">PREVIEW PENDING</span>
              <span className="line-clamp-2 text-[11px] font-medium leading-snug text-white/70">{video.title}</span>
              <span className="text-[9px] uppercase tracking-wider text-white/35">{video.platform}</span>
            </div>
          </div>
        ) : (
          <img
            src={currentSrc}
            alt={video.title}
            loading="lazy"
            onError={handleImgError}
            className={`w-full h-full object-cover transition-transform duration-500 ease-out ${
              isHovered ? "scale-[1.08]" : "scale-100"
            }`}
          />
        )}

        {/* Gradient overlay */}
        <div
          className={`absolute inset-0 transition-opacity duration-300 ${
            isHovered
              ? "bg-gradient-to-t from-black/85 via-black/30 to-transparent opacity-100"
              : "bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-80"
          }`}
        />

        {/* Play button on hover */}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
            isHovered ? "opacity-100 scale-100" : "opacity-0 scale-90"
          }`}
        >
          <div className="w-12 h-12 rounded-full bg-cinematic-red/90 flex items-center justify-center shadow-lg shadow-cinematic-red/40 backdrop-blur-sm">
            <Play className="w-5 h-5 text-white ml-0.5" fill="white" />
          </div>
        </div>

        {/* Top header bar: Left (Creator, Award, Favorite, Note) & Right (Warning, Source, Platform) */}
        <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-1.5 z-10 pointer-events-none">
          {/* Top-left items */}
          <div className="flex items-center gap-1 min-w-0 flex-1 flex-wrap pointer-events-auto">
            {mainCreator && (
              <span
                title={`メイン制作者: ${mainCreator}`}
                className="inline-flex items-center gap-1 rounded bg-black/85 px-1.5 py-0.5 text-[10px] font-semibold text-white/95 backdrop-blur-md border border-white/15 shadow-sm max-w-[120px] sm:max-w-[140px] truncate"
              >
                <User className="h-2.5 w-2.5 text-amber-300 shrink-0" />
                <span className="truncate">{mainCreator}</span>
              </span>
            )}
            {video.awards?.length ? (
              <div title={`受賞歴 ${video.awards.length}件`} className="rounded-sm bg-yellow-400/95 px-1.5 py-0.5 text-[9px] font-bold text-black backdrop-blur-sm shrink-0">
                受賞作{video.awards.length > 1 ? ` ${video.awards.length}` : ""}
              </div>
            ) : null}
            {video.isProvisional && (
              <span
                title="未視聴・メタデータ基準の暫定評価です（映像確認による再分析待ち）"
                className="rounded-sm bg-amber-500/90 px-1.5 py-0.5 text-[9px] font-bold text-black backdrop-blur-sm shrink-0"
              >
                暫定
              </span>
            )}
            {isFavorite && (
              <div className="w-5 h-5 rounded-full bg-amber-400/90 flex items-center justify-center backdrop-blur-sm shrink-0">
                <Bookmark className="w-2.5 h-2.5 text-white" fill="white" />
              </div>
            )}
            {hasNote && (
              <div className="w-5 h-5 rounded-full bg-sky-500/90 flex items-center justify-center backdrop-blur-sm shrink-0">
                <StickyNote className="w-2.5 h-2.5 text-white" />
              </div>
            )}
          </div>

          {/* Top-right badges: warning + source + platform */}
          <div className="flex items-center gap-1 shrink-0 pointer-events-auto">
            {video.embedStatus === "restricted" && (
              <span title={`${getEmbedReasonLabel(video.embedReason || "")}。${embedRecheckDue ? "再確認期限を迎えました。詳細から再テストできます" : `次回確認目安：${embedRecheckAt}`}`} className="inline-flex items-center gap-1 rounded-sm bg-amber-500/85 px-1.5 py-0.5 text-[9px] font-bold text-black backdrop-blur-sm">
                <AlertCircle className="h-2.5 w-2.5" />{embedRecheckDue ? `${getEmbedReasonLabel(video.embedReason || "")}・再確認` : getEmbedReasonLabel(video.embedReason || "")}
              </span>
            )}
            {video.source && video.source !== "vook" && (
              <span
                title={`収集元: ${video.source}`}
                className={`text-[9px] font-medium px-1.5 py-0.5 rounded-sm backdrop-blur-sm text-white max-w-[70px] truncate ${SOURCE_COLORS[video.source as VideoSource] || "bg-white/20"}`}
              >
                {formatSourceLabel(video.source)}
              </span>
            )}
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm backdrop-blur-sm ${
              video.platform === "youtube"
                ? "bg-red-600/80 text-white"
                : video.platform === "vimeo"
                ? "bg-sky-600/80 text-white"
                : "bg-zinc-700/85 text-white"
            }`}>
              {video.platform === "youtube" ? "YT" : video.platform === "vimeo" ? "VM" : video.platform === "x" ? "X" : video.platform === "tiktok" ? "TT" : video.platform === "instagram" ? "IG" : "WEB"}
            </span>
          </div>
        </div>

        {/* Tags at bottom of thumbnail */}
        <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1">
          {allTagBadges.slice(0, 3).map((tag) => (
            <span
              key={tag.key}
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded-sm backdrop-blur-sm ${getTagColor(tag.name)}`}
            >
              {tag.name}
            </span>
          ))}
          {allTagBadges.length > 3 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-sm bg-black/50 text-white/50 backdrop-blur-sm">
              +{allTagBadges.length - 3}
            </span>
          )}
        </div>
      </div>

      {/* Title */}
      <div className="mt-2 px-0.5">
        <h3 className="text-[13px] font-medium text-foreground/85 leading-snug line-clamp-2 group-hover:text-cinematic-red-light transition-colors duration-200">
          {video.title}
        </h3>
        {mainCreator && (
          <p className="mt-1 text-[11px] text-white/55 truncate flex items-center gap-1" title={`制作者: ${mainCreator}`}>
            <User className="h-3 w-3 text-amber-400/70 shrink-0" />
            <span className="truncate">{mainCreator}</span>
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {isLegacyAnalysisVersion(video.analysisVersion) ? (
            <span
              data-testid="video-legacy-analysis-badge"
              title="旧方式の分析です（実映像照合済みの v3 へ順次更新中）"
              className="inline-flex items-center rounded-sm border border-amber-400/40 bg-amber-950/80 px-1.5 py-0.5 text-[8.5px] font-semibold text-amber-300"
            >
              {LEGACY_ANALYSIS_LABEL}
            </span>
          ) : (
            <span
              data-testid="video-v3-analysis-badge"
              title={
                video.analysisGeneratedAt
                  ? `${V3_ANALYSIS_LABEL}（生成: ${video.analysisGeneratedAt.slice(0, 10)}）`
                  : V3_ANALYSIS_LABEL
              }
              className="inline-flex items-center rounded-sm border border-emerald-400/35 bg-emerald-500/15 px-1.5 py-0.5 text-[8.5px] font-semibold text-emerald-200"
            >
              {V3_ANALYSIS_LABEL}
            </span>
          )}
        </div>
        {(hasCalibrated || aiRatings.length > 0 || isLegacyUncalibrated) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1" aria-label="AI評価">
            {hasCalibrated && (
              <>
                <span
                  title={`校正済み評価（${video.calibrationVersion || "phase2_v1"}）：${calibratedScoreLabel}点${video.calibratedRank ? `（${video.calibratedRank}）` : ""}${isUnverifiedCalibratedGenre ? " ※このジャンルは未検証" : ""}`}
                  className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold ${
                    isUnverifiedCalibratedGenre
                      ? "border-amber-400/35 bg-amber-500/15 text-amber-200"
                      : "border-emerald-400/35 bg-emerald-500/15 text-emerald-200"
                  }`}
                >
                  <span className={isUnverifiedCalibratedGenre ? "text-amber-300/80" : "text-emerald-300/80"}>
                    校正済
                  </span>
                  {video.calibratedRank && <span className="font-bold">{video.calibratedRank}</span>}
                  <span className="font-mono text-[8.5px]">{calibratedScoreLabel}</span>
                </span>
                {isUnverifiedCalibratedGenre && (
                  <span
                    title="このジャンルは Phase 2 検証対象外のため参考値です"
                    className="inline-flex items-center rounded-sm border border-amber-400/30 bg-amber-500/10 px-1 py-0.5 text-[8.5px] font-medium text-amber-300"
                  >
                    未検証ジャンル
                  </span>
                )}
              </>
            )}
            {isLegacyUncalibrated && (
              <span
                title="Phase 2 校正導入前の旧基準スコアです（未校正・参考保持）"
                className="inline-flex items-center rounded-sm border border-zinc-500/35 bg-zinc-500/15 px-1.5 py-0.5 text-[8.5px] font-medium text-zinc-300"
              >
                旧基準・未校正
              </span>
            )}
            {aiRatings.map((rating) => (
              <span
                key={rating.shortLabel}
                title={`旧基準AI評価（${rating.fullLabel}・未校正）：${rating.value}${typeof rating.score === "number" ? `（${rating.score}点）` : ""}`}
                className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold ${
                  hasCalibrated
                    ? "border-white/10 bg-white/[0.03] text-white/45"
                    : "border-sky-400/20 bg-sky-400/[0.07] text-sky-300"
                }`}
              >
                <span className={hasCalibrated ? "text-white/35" : "text-sky-300/65"}>
                  {hasCalibrated ? `旧${rating.shortLabel}` : `AI ${rating.shortLabel}`}
                </span>
                <span className={hasCalibrated ? "text-white/55" : "text-sky-100"}>{rating.value}</span>
                {typeof rating.score === "number" && (
                  <span className={`font-mono text-[8.5px] ${hasCalibrated ? "text-white/40" : "text-sky-300/80"}`}>
                    {rating.score}
                  </span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
