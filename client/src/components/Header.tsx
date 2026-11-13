/**
 * Header component with search bar and branding
 * Design: Cinematic Noir — sticky header, dark glass effect, cinematic red accent
 */
import React, { useState, useRef } from "react";
import { Search, X, SlidersHorizontal, HelpCircle, Settings2 } from "lucide-react";
import { Link } from "wouter";

interface HeaderProps {
  search: string;
  onSearchChange: (value: string) => void;
  filteredCount: number;
  totalCount: number;
  isLoading?: boolean;
  onToggleSidebar: () => void;
  activeFilterCount: number;
}

export default function Header({
  search,
  onSearchChange,
  filteredCount,
  totalCount,
  isLoading = false,
  onToggleSidebar,
  activeFilterCount,
}: HeaderProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // マイナス検索が使われているか判定
  const hasMinusSearch = search.includes('-');

  return (
    <header className="sticky top-0 z-40 bg-[oklch(0.10_0.005_285/0.95)] backdrop-blur-xl border-b border-white/[0.06]">
      <div className="flex items-center gap-3 px-4 lg:px-5 h-14">
        {/* Mobile menu button */}
        <button
          onClick={onToggleSidebar}
          className="lg:hidden p-2 -ml-1 rounded-lg hover:bg-surface-2 transition-colors relative"
        >
          <SlidersHorizontal className="w-4.5 h-4.5" />
          {activeFilterCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-cinematic-red text-[9px] font-bold text-white flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Logo */}
        <a href="/" className="flex items-center gap-2.5 flex-shrink-0 group">
          <div className="w-7 h-7 rounded-md bg-cinematic-red flex items-center justify-center group-hover:shadow-md group-hover:shadow-cinematic-red/30 transition-shadow">
            <span className="text-white font-black text-[11px]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>IK</span>
          </div>
          <div className="hidden sm:block">
            <h1 className="text-sm font-bold tracking-tight leading-none text-foreground">
              イケてる映像
            </h1>
            <p className="text-[9px] text-muted-foreground tracking-[0.2em] leading-none mt-0.5" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              COLLECTION
            </p>
          </div>
        </a>

        {/* Search bar */}
        <div className="flex-1 max-w-lg mx-auto relative">
          <div
            className={`relative flex items-center rounded-lg transition-all duration-200 ${
              isFocused
                ? "bg-surface-2 ring-1 ring-cinematic-red/30 shadow-sm shadow-cinematic-red/10"
                : "bg-surface-1 hover:bg-surface-2"
            }`}
          >
            <Search className="w-3.5 h-3.5 text-muted-foreground ml-3 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => {
                setIsFocused(false);
                // 少し遅延してヒントを閉じる（クリック操作を妨げないため）
                setTimeout(() => setShowHint(false), 200);
              }}
              placeholder="検索… -キーワード でマイナス除外"
              className="w-full bg-transparent text-sm py-2 px-2.5 outline-none placeholder:text-muted-foreground/40"
            />
            {/* マイナス検索インジケーター */}
            {hasMinusSearch && (
              <span className="flex-shrink-0 text-[9px] font-mono bg-cinematic-red/20 text-cinematic-red px-1.5 py-0.5 rounded mr-1">
                除外中
              </span>
            )}
            {search && (
              <button
                onClick={() => onSearchChange("")}
                className="p-1.5 mr-1 rounded hover:bg-white/10 transition-colors"
              >
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
            )}
            {/* ヘルプボタン */}
            <button
              onMouseEnter={() => setShowHint(true)}
              onMouseLeave={() => setShowHint(false)}
              onClick={() => setShowHint((v) => !v)}
              className="p-1.5 mr-1.5 rounded hover:bg-white/10 transition-colors flex-shrink-0"
              aria-label="検索ヘルプ"
            >
              <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/50 hover:text-muted-foreground" />
            </button>
          </div>

          {/* 検索ヒントポップアップ */}
          {showHint && (
            <div className="absolute top-full left-0 right-0 mt-1.5 z-50 bg-[oklch(0.14_0.008_285)] border border-white/10 rounded-lg shadow-xl p-3 text-xs">
              <p className="font-semibold text-foreground mb-2 flex items-center gap-1.5">
                <HelpCircle className="w-3.5 h-3.5 text-cinematic-red" />
                検索構文
              </p>
              <div className="space-y-1.5 text-muted-foreground">
                <div className="flex items-start gap-2">
                  <code className="font-mono text-amber-400/80 flex-shrink-0">CM</code>
                  <span>「CM」を含む動画を表示</span>
                </div>
                <div className="flex items-start gap-2">
                  <code className="font-mono text-cinematic-red flex-shrink-0">-Notion</code>
                  <span>「Notion」を含む動画を除外</span>
                </div>
                <div className="flex items-start gap-2">
                  <code className="font-mono text-cinematic-red flex-shrink-0">-source:note</code>
                  <span>noteソースの動画を除外</span>
                </div>
                <div className="flex items-start gap-2">
                  <code className="font-mono text-cinematic-red flex-shrink-0">-source:youtube</code>
                  <span>YouTubeソースの動画を除外</span>
                </div>
                <div className="flex items-start gap-2">
                  <code className="font-mono text-amber-400/80 flex-shrink-0">CM -アニメ</code>
                  <span>「CM」含む かつ「アニメ」除外</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Count badge */}
        <div className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0 tabular-nums">
          {isLoading ? (
            <span className="text-muted-foreground/70">映像を読み込み中…</span>
          ) : (
            <>
              <span className="font-bold text-foreground">{filteredCount}</span>
              <span className="text-muted-foreground/50">/</span>
              <span>{totalCount}</span>
              <span className="ml-0.5">本</span>
            </>
          )}
        </div>
        <Link href="/manage" className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground" aria-label="動画管理" title="動画管理">
          <Settings2 className="h-4 w-4" />
        </Link>
      </div>
    </header>
  );
}
