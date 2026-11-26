/**
 * SceneCard component (Twelve Labs style)
 * Features:
 * - Precise timestamp badge (e.g. 01:25 - 01:55)
 * - Hover preview: Automatically plays the exact segment in a muted looping iframe on mouse enter
 * - Seamless click-to-play: Opens full video modal starting at exact segment seconds
 * - Rich visual and audio description highlights
 */
import React, { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Play, Clock, Sparkles, ExternalLink, Volume2, Eye, AlertTriangle } from "lucide-react";
import type { SceneItem } from "@/lib/sceneSearch";

interface SceneCardProps {
  scene: SceneItem;
  index: number;
  matchedTerms?: string[];
  score?: number;
  videoTotalDuration?: number;
  onClick?: (scene: SceneItem) => void;
}

export default function SceneCard({ scene, index, matchedTerms = [], score, videoTotalDuration, onClick }: SceneCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [isIframePlaying, setIsIframePlaying] = useState(false);
  const [isIframeBlocked, setIsIframeBlocked] = useState(false);
  const [fallbackFrameIdx, setFallbackFrameIdx] = useState(0);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Calculate timeline position (Twelve Labs timeline bar)
  // Default total duration to 240s if not known, or endSeconds + 30s
  const totalDuration = videoTotalDuration || Math.max(scene.endSeconds + 30, 180);
  const timelineLeftPercent = Math.min(Math.max((scene.startSeconds / totalDuration) * 100, 0), 96);
  const timelineWidthPercent = Math.min(Math.max(((scene.endSeconds - scene.startSeconds) / totalDuration) * 100, 4), 100 - timelineLeftPercent);

  // Confidence % calculation (based on score)
  const confidencePercent = score !== undefined && score > 0
    ? Math.min(Math.round(65 + Math.min(score, 7) * 4.8), 98)
    : null;

  // Trigger preview after 350ms hover to prevent accidental flashing while scrolling
  useEffect(() => {
    if (isHovered) {
      hoverTimeoutRef.current = setTimeout(() => {
        setIsPlayingPreview(true);
      }, 350);
    } else {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      setIsPlayingPreview(false);
      setIsIframePlaying(false);
      setIsIframeBlocked(false);
      setFallbackFrameIdx(0);
    }
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, [isHovered]);

  // Listen to YouTube IFrame API postMessage events so we only reveal the iframe
  // once playback actually enters PLAYING (state === 1), preventing any YouTube
  // "Sign in to confirm you're not a bot" / embed-restriction overlay from showing.
  useEffect(() => {
    if (!isPlayingPreview || isIframeBlocked || scene.platform !== "youtube") return;

    // If YouTube does not reach PLAYING within 4.5s (e.g. bot-check screen), stop mounting the blocked iframe
    // and continue clean storyboard frame previewing instead.
    const blockTimer = setTimeout(() => {
      setIsIframePlaying((playing) => {
        if (!playing) setIsIframeBlocked(true);
        return playing;
      });
    }, 4500);

    const handleMessage = (event: MessageEvent) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      if (typeof event.data !== "string") return;
      try {
        const data = JSON.parse(event.data);
        if (data.event === "onReady" || data.event === "initialDelivery") {
          iframeRef.current.contentWindow?.postMessage(
            JSON.stringify({ event: "command", func: "mute", args: [] }),
            "*"
          );
          iframeRef.current.contentWindow?.postMessage(
            JSON.stringify({ event: "command", func: "playVideo", args: [] }),
            "*"
          );
        }
        const playerState =
          data.event === "onStateChange"
            ? data.info
            : data.event === "infoDelivery" && data.info && typeof data.info.playerState === "number"
              ? data.info.playerState
              : undefined;
        if (playerState === 1) {
          setIsIframePlaying(true);
        } else if (data.event === "onError") {
          setIsIframePlaying(false);
          setIsIframeBlocked(true);
        }
      } catch {
        // ignore non-JSON messages
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      clearTimeout(blockTimer);
      window.removeEventListener("message", handleMessage);
    };
  }, [isPlayingPreview, isIframeBlocked, scene.platform]);

  // Multi-frame storyboard fallback cycle while iframe is loading or if YouTube blocks autoplay
  useEffect(() => {
    if (!isPlayingPreview || isIframePlaying || scene.platform !== "youtube") return;
    const interval = setInterval(() => {
      setFallbackFrameIdx((prev) => (prev + 1) % 4);
    }, 650);
    return () => clearInterval(interval);
  }, [isPlayingPreview, isIframePlaying, scene.platform]);

  const handleIframeLoad = () => {
    if (!iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      JSON.stringify({ event: "listening", id: scene.id, channel: "widget" }),
      "*"
    );
    iframeRef.current.contentWindow.postMessage(
      JSON.stringify({ event: "command", func: "mute", args: [] }),
      "*"
    );
    iframeRef.current.contentWindow.postMessage(
      JSON.stringify({ event: "command", func: "playVideo", args: [] }),
      "*"
    );
  };

  // Construct looping YouTube embed URL using youtube.com (with cookies & origin) instead of youtube-nocookie.com
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const youtubeEmbedUrl = scene.platform === "youtube"
    ? `https://www.youtube.com/embed/${scene.videoId}?enablejsapi=1&origin=${origin}&start=${scene.startSeconds}&end=${scene.endSeconds}&autoplay=1&mute=1&controls=0&loop=1&playlist=${scene.videoId}&modestbranding=1&playsinline=1&rel=0`
    : "";

  const fallbackThumbnails = scene.platform === "youtube" && scene.videoId
    ? [
        scene.thumbnailUrl || `https://img.youtube.com/vi/${scene.videoId}/hqdefault.jpg`,
        `https://img.youtube.com/vi/${scene.videoId}/hq1.jpg`,
        `https://img.youtube.com/vi/${scene.videoId}/hq2.jpg`,
        `https://img.youtube.com/vi/${scene.videoId}/hq3.jpg`,
      ]
    : [scene.thumbnailUrl];
  const activeThumbnailUrl = isPlayingPreview && !isIframePlaying
    ? fallbackThumbnails[fallbackFrameIdx % fallbackThumbnails.length]
    : scene.thumbnailUrl;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.03, 0.4), ease: "easeOut" }}
      className="group relative flex flex-col rounded-xl overflow-hidden bg-[oklch(0.14_0.01_285)] border border-white/10 hover:border-cinematic-red/60 transition-all duration-300 shadow-lg hover:shadow-cinematic-red/20 cursor-pointer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onClick && onClick(scene)}
    >
      {/* Thumbnail & Video Preview Area */}
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        {/* Static / Storyboard Cycling Thumbnail */}
        <img
          src={activeThumbnailUrl}
          alt={scene.videoTitle}
          loading="lazy"
          onError={(e) => {
            if (scene.thumbnailUrl && e.currentTarget.src !== scene.thumbnailUrl) {
              e.currentTarget.src = scene.thumbnailUrl;
            }
          }}
          className={`w-full h-full object-cover transition-transform duration-500 ${
            isHovered ? "scale-105" : "scale-100"
          } ${isPlayingPreview && isIframePlaying ? "opacity-0" : "opacity-100"}`}
        />

        {/* Hover Video Preview (YouTube Iframe — revealed only once PLAYING state is confirmed) */}
        {isPlayingPreview && !isIframeBlocked && scene.platform === "youtube" && (
          <div
            className={`absolute inset-0 w-full h-full pointer-events-none bg-black transition-opacity duration-300 ${
              isIframePlaying ? "opacity-100" : "opacity-0"
            }`}
          >
            <iframe
              ref={iframeRef}
              src={youtubeEmbedUrl}
              title={`Preview ${scene.timeRange}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={handleIframeLoad}
              className="w-full h-full object-cover border-0 scale-[1.02]"
            />
          </div>
        )}

        {/* Top Overlay Badges */}
        <div className="absolute top-2 left-2 right-2 flex items-center justify-between z-10 pointer-events-none">
          {/* Timestamp Pill Badge */}
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold tracking-wide bg-black/85 text-amber-400 border border-amber-400/40 shadow-md backdrop-blur-md">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            {scene.timeRange}
          </span>

          {/* Right badges: Match Confidence or Playing indicator */}
          <div className="flex items-center gap-1.5">
            {confidencePercent !== null && !isPlayingPreview && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono tracking-wider bg-black/85 text-emerald-400 border border-emerald-400/40 backdrop-blur-md shadow-md">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {confidencePercent}% Match
              </span>
            )}

            {isPlayingPreview ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider bg-cinematic-red text-white uppercase animate-pulse shadow-md">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                Previewing
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider bg-black/60 text-white/70 backdrop-blur-sm">
                #{scene.sceneNumber}
              </span>
            )}
          </div>
        </div>

        {/* Play Icon Overlay (when not playing preview) */}
        {!isPlayingPreview && (
          <div
            className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
              isHovered ? "opacity-100 scale-100" : "opacity-0 scale-90"
            }`}
          >
            <div className="w-12 h-12 rounded-full bg-cinematic-red/90 flex items-center justify-center shadow-lg shadow-cinematic-red/50 backdrop-blur-sm">
              <Play className="w-5 h-5 text-white ml-0.5" fill="white" />
            </div>
          </div>
        )}

        {/* Bottom gradient */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/90 to-transparent pointer-events-none" />
      </div>

      {/* Twelve Labs-style Video Timeline Position Bar */}
      <div className="w-full h-1.5 bg-white/10 relative overflow-hidden" title={`動画全体の ${Math.round(timelineLeftPercent)}% 付近のシーン`}>
        <div
          className="absolute top-0 bottom-0 bg-gradient-to-r from-amber-400 to-amber-300 rounded-full shadow-[0_0_8px_rgba(251,191,36,0.6)]"
          style={{
            left: `${timelineLeftPercent}%`,
            width: `${Math.max(timelineWidthPercent, 5)}%`,
          }}
        />
      </div>

      {/* Card Body */}
      <div className="p-3.5 flex flex-col flex-grow justify-between gap-2.5">
        <div>
          {/* Video Title & Score / Observation Badges */}
          <div className="flex items-start justify-between gap-1.5">
            <h4 className="text-xs font-semibold text-white/90 line-clamp-1 group-hover:text-cinematic-red transition-colors flex-1">
              {scene.videoTitle}
            </h4>
            {typeof scene.calibratedScore === "number" ? (
              <span
                title={`校正済みスコア: ${scene.calibratedScore.toFixed(1)}点`}
                className="shrink-0 rounded border border-emerald-400/35 bg-emerald-500/15 px-1.5 py-0.2 font-mono text-[9.5px] font-bold text-emerald-200"
              >
                校正 {scene.calibratedScore.toFixed(1)}
              </span>
            ) : (
              <span
                data-testid="scene-uncalibrated-badge"
                title={
                  typeof scene.aiOverallScore === "number"
                    ? `未校正（旧基準AI参考値: ${scene.aiOverallScore}点・点数絞り込み対象外）`
                    : "未校正（点数絞り込み対象外）"
                }
                className="shrink-0 rounded border border-white/20 bg-white/8 px-1.5 py-0.2 font-mono text-[9.5px] font-medium text-white/65"
              >
                未校正
              </span>
            )}
          </div>

          {scene.analysisObservationScope && (
            <div className="mt-1">
              <span
                data-testid="scene-unwatched-warning"
                className="inline-flex items-center gap-1 rounded border border-amber-400/45 bg-amber-500/15 px-1.5 py-0.5 text-[9.5px] font-semibold text-amber-200"
                title={`未視聴・要確認タグ: ${scene.analysisObservationScope}`}
              >
                <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                未視聴・要確認 ({scene.analysisObservationScope})
              </span>
            </div>
          )}

          {/* Visual Description */}
          <p className="mt-1.5 text-xs text-white/75 leading-relaxed line-clamp-3">
            {scene.visual}
          </p>
        </div>

        {/* Audio / Foley description if present */}
        {scene.audio && (
          <div className="flex items-start gap-1.5 text-[11px] text-white/50 line-clamp-1">
            <Volume2 className="w-3.5 h-3.5 text-white/40 shrink-0 mt-0.5" />
            <span className="truncate">{scene.audio}</span>
          </div>
        )}

        {/* Keywords tags */}
        <div className="flex flex-wrap gap-1 mt-1">
          {scene.keywords.slice(0, 4).map((kw: string, i: number) => {
            const isMatched = matchedTerms.some((mt) => kw.toLowerCase().includes(mt) || mt.includes(kw.toLowerCase()));
            return (
              <span
                key={i}
                className={`text-[10px] px-2 py-0.5 rounded-md font-medium ${
                  isMatched
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold"
                    : "bg-white/5 text-white/50 border border-white/5"
                }`}
              >
                #{kw}
              </span>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
