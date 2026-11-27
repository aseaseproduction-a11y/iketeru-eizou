/**
 * Sidebar component for category filtering
 * Design: Cinematic Noir — dark surface, red accent underlines, collapsible sections
 */
import React, { useState } from "react";
import { ChevronDown, Film, Heart, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ALL_CATEGORY_GROUPS,
  type CategoryItem,
  type FilterState,
} from "@/lib/types";
import { CREATOR_INDEX_SECTIONS, EIZO100_YEARS, getCategoryMissingCountKey, getCreatorIndexSection, MISSING_FILTER_VALUE, type MetadataFilterOptions, type ProductionFilterOptions, type SourceFilterOption } from "@/hooks/useVideos";

interface SidebarProps {
  filters: FilterState;
  categoryCounts: Record<string, number>;
  totalCount: number;
  filteredCount: number;
  isLoading?: boolean;
  onGenreChange: (slug: string | null) => void;
  onProductChange: (slug: string | null) => void;
  onDirectionChange: (slug: string | null) => void;
  onToneChange: (slug: string | null) => void;
  metadataFilterOptions: MetadataFilterOptions;
  onPurposeChange: (value: string | null) => void;
  onExpressionChange: (value: string | null) => void;
  onToneEmotionChange: (value: string | null) => void;
  onToneVisualChange: (value: string | null) => void;
  onToneTechniqueChange: (value: string | null) => void;
  onProductionChange: (value: string | null) => void;
  productionFilterOptions?: ProductionFilterOptions;
  onProductionRoleChange?: (value: string | null) => void;
  creatorFavorites?: string[];
  isCreatorFavorite?: (name: string) => boolean;
  onToggleCreatorFavorite?: (name: string) => void;
  onPrivateRatingChange: (value: string | null) => void;
  onAiOverallRatingChange: (value: string | null) => void;
  onAiDirectionRatingChange: (value: string | null) => void;
  onAiTechniqueRatingChange: (value: string | null) => void;
  sourceFilterOptions?: SourceFilterOption[];
  onSourceChange?: (value: string | null) => void;
  eizo100Count: number;
  eizo100YearCounts: Record<number, number>;
  onEizo100Change: (value: boolean) => void;
  onEizo100YearChange: (year: number | null) => void;
  unavailableCount?: number;
  onShowUnavailableChange?: (value: boolean) => void;
  lowAiOverallCount?: number;
  onShowLowAiOverallChange?: (value: boolean) => void;
  calibratedCount?: number;
  onCalibratedOnlyChange?: (value: boolean) => void;
  onClearAll: () => void;
  activeFilterCount: number;
  onClose?: () => void;
}

export default function Sidebar({
  filters,
  categoryCounts,
  totalCount,
  filteredCount,
  isLoading = false,
  onGenreChange,
  onProductChange,
  onDirectionChange,
  onToneChange,
  metadataFilterOptions,
  onPurposeChange,
  onExpressionChange,
  onToneEmotionChange,
  onToneVisualChange,
  onToneTechniqueChange,
  onProductionChange,
  productionFilterOptions = { roles: [], entities: [] },
  onProductionRoleChange = () => {},
  creatorFavorites = [],
  isCreatorFavorite = () => false,
  onToggleCreatorFavorite = () => {},
  onPrivateRatingChange,
  onAiOverallRatingChange,
  onAiDirectionRatingChange,
  onAiTechniqueRatingChange,
  sourceFilterOptions = [],
  onSourceChange = () => {},
  eizo100Count,
  eizo100YearCounts,
  onEizo100Change,
  onEizo100YearChange,
  unavailableCount = 0,
  onShowUnavailableChange = () => {},
  lowAiOverallCount = 0,
  onShowLowAiOverallChange = () => {},
  calibratedCount = 0,
  onCalibratedOnlyChange = () => {},
  onClearAll,
  activeFilterCount,
  onClose,
}: SidebarProps) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    genre: true,
    product: true,
    direction: true,
    tone: true,
  });
  const [creatorIndex, setCreatorIndex] = useState<string | null>(null);

  const toggleGroup = (slug: string) => {
    setExpandedGroups((prev) => ({ ...prev, [slug]: !prev[slug] }));
  };

  const getActiveFilter = (groupSlug: string): string | null => {
    switch (groupSlug) {
      case "genre": return filters.genre;
      case "product": return filters.product;
      case "direction": return filters.direction;
      case "tone": return filters.tone;
      default: return null;
    }
  };

  const handleFilterClick = (groupSlug: string, itemSlug: string) => {
    const current = getActiveFilter(groupSlug);
    const newValue = current === itemSlug ? null : itemSlug;
    switch (groupSlug) {
      case "genre": onGenreChange(newValue); break;
      case "product": onProductChange(newValue); break;
      case "direction": onDirectionChange(newValue); break;
      case "tone": onToneChange(newValue); break;
    }
  };

  const metadataGroups = [
    { slug: "aiOverallRating", label: "旧評価（総合）", items: metadataFilterOptions.aiOverallRating, value: filters.aiOverallRating, onChange: onAiOverallRatingChange },
    { slug: "aiDirectionRating", label: "旧評価（ディレクション）", items: metadataFilterOptions.aiDirectionRating, value: filters.aiDirectionRating, onChange: onAiDirectionRatingChange },
    { slug: "aiTechniqueRating", label: "旧評価（技術）", items: metadataFilterOptions.aiTechniqueRating, value: filters.aiTechniqueRating, onChange: onAiTechniqueRatingChange },
  ].filter((group) => group.items.length > 0);

  const creatorSections = CREATOR_INDEX_SECTIONS
    .map((section) => ({
      section,
      entities: productionFilterOptions.entities.filter((item) => getCreatorIndexSection(item.value) === section),
    }))
    .filter(({ entities }) => entities.length > 0);
  const indexedCreators = creatorIndex
    ? creatorSections.find(({ section }) => section === creatorIndex)?.entities ?? []
    : [];
  const favoritedCreators = productionFilterOptions.entities.filter((item) => creatorFavorites.includes(item.value));

  return (
    <aside className="h-full overflow-y-auto pb-8 scrollbar-thin">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[oklch(0.12_0.005_285)] pb-3 pt-1">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Film className="w-5 h-5 text-cinematic-red" />
            <span className="font-bold text-lg tracking-tight">フィルター</span>
          </div>
          {onClose && (
            <button onClick={onClose} className="lg:hidden p-1 rounded hover:bg-surface-2">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* All videos button */}
        <button
          onClick={onClearAll}
          className={`w-full text-left px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200 ${
            activeFilterCount === 0
              ? "bg-cinematic-red/15 text-cinematic-red border border-cinematic-red/30"
              : "hover:bg-surface-2 text-muted-foreground"
          }`}
        >
          すべての映像
          <span className="ml-2 text-xs opacity-70">{isLoading ? "(読み込み中…)" : `(${totalCount})`}</span>
        </button>

        {/* Calibrated only checkbox */}
        <label
          className={`mt-2 flex w-full cursor-pointer items-center justify-between rounded-md border px-3 py-2 text-xs transition-all select-none ${
            filters.calibratedOnly
              ? "border-emerald-400/40 bg-emerald-500/12 text-emerald-200"
              : "border-white/10 text-muted-foreground hover:border-emerald-400/25 hover:bg-surface-2 hover:text-foreground"
          }`}
        >
          <span className="flex items-center gap-2 font-medium">
            <input
              type="checkbox"
              aria-label="校正済みのみ"
              checked={Boolean(filters.calibratedOnly)}
              onChange={(e) => onCalibratedOnlyChange(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-white/25 bg-black/50 accent-emerald-400"
            />
            <span>校正済みのみ</span>
          </span>
          <span className="font-mono text-[11px] opacity-75">
            {isLoading ? "…" : `(${calibratedCount})`}
          </span>
        </label>

        {unavailableCount > 0 && (
          <button
            onClick={() => onShowUnavailableChange(!filters.showUnavailable)}
            className={`mt-2 flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs transition-all ${
              filters.showUnavailable
                ? "border-amber-400/35 bg-amber-400/10 text-amber-200"
                : "border-white/10 text-muted-foreground hover:border-amber-400/25 hover:bg-surface-2 hover:text-foreground"
            }`}
            aria-pressed={filters.showUnavailable}
          >
            <span>削除・非公開の動画</span>
            <span className="font-medium">{filters.showUnavailable ? "通常表示に戻す" : `のみ表示 (${unavailableCount})`}</span>
          </button>
        )}

        {lowAiOverallCount > 0 && (
          <button
            onClick={() => onShowLowAiOverallChange(!filters.showLowAiOverall)}
            className={`mt-2 flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs transition-all ${
              filters.showLowAiOverall
                ? "border-sky-400/35 bg-sky-400/10 text-sky-200"
                : "border-white/10 text-muted-foreground hover:border-sky-400/25 hover:bg-surface-2 hover:text-foreground"
            }`}
            aria-pressed={filters.showLowAiOverall}
          >
            <span>B以下のAI総合評価</span>
            <span className="font-medium">{filters.showLowAiOverall ? "非表示に戻す" : `表示 (${lowAiOverallCount})`}</span>
          </button>
        )}

        {activeFilterCount > 0 && (
          <button
            onClick={onClearAll}
            className="mt-2 w-full text-center text-xs text-muted-foreground hover:text-cinematic-red transition-colors py-1"
          >
            フィルターをクリア
          </button>
        )}
      </div>

      {/* Category groups */}
      <div className="space-y-1 mt-2">
        {ALL_CATEGORY_GROUPS.map((group) => (
          <div key={group.slug}>
            {/* Group header */}
            <button
              onClick={() => toggleGroup(group.slug)}
              className="w-full flex items-center justify-between px-2 py-2.5 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>{group.label}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-200 ${
                  expandedGroups[group.slug] ? "rotate-0" : "-rotate-90"
                }`}
              />
            </button>

            {/* Group items */}
            <AnimatePresence initial={false}>
              {expandedGroups[group.slug] && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="space-y-0.5 pb-3">
                    {[...group.items, { name: "未入力", slug: MISSING_FILTER_VALUE }].map((item: CategoryItem) => {
                      const isActive = getActiveFilter(group.slug) === item.slug;
                      const count = item.slug === MISSING_FILTER_VALUE
                        ? categoryCounts[getCategoryMissingCountKey(group.slug as "genre" | "product" | "direction" | "tone")] || 0
                        : categoryCounts[item.slug] || 0;
                      return (
                        <button
                          key={item.slug}
                          onClick={() => handleFilterClick(group.slug, item.slug)}
                          className={`w-full text-left px-3 py-1.5 rounded text-sm transition-all duration-150 flex items-center justify-between group ${
                            isActive
                              ? "bg-cinematic-red/10 text-cinematic-red font-medium"
                              : "text-muted-foreground hover:text-foreground hover:bg-surface-2"
                          }`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            {isActive && (
                              <span className="w-1 h-1 rounded-full bg-cinematic-red flex-shrink-0" />
                            )}
                            <span className="truncate">{item.name}</span>
                          </span>
                          <span className={`text-xs flex-shrink-0 ml-2 ${isActive ? "text-cinematic-red/70" : "opacity-40 group-hover:opacity-60"}`}>
                            {isLoading ? "…" : count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
        <div className="mt-2 border-t border-white/[0.06] pt-2">
          <p className="px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">出典から探す</p>
          <button
            onClick={() => onEizo100Change(!filters.eizo100Only)}
            className={`group flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-sm transition-all duration-150 ${filters.eizo100Only ? "bg-cinematic-red/10 font-medium text-cinematic-red" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"}`}
          >
            <span className="flex min-w-0 items-center gap-2">
              {filters.eizo100Only && <span className="h-1 w-1 flex-shrink-0 rounded-full bg-cinematic-red" />}
              <span className="truncate">映像作家100人</span>
            </span>
            <span className={`ml-2 flex-shrink-0 text-xs ${filters.eizo100Only ? "text-cinematic-red/70" : "opacity-40 group-hover:opacity-60"}`}>{isLoading ? "…" : eizo100Count}</span>
          </button>
          {filters.eizo100Only && (
            <div className="mt-1 grid grid-cols-3 gap-1 px-2 pb-2">
              {EIZO100_YEARS.map((year) => {
                const isActive = filters.eizo100Year === year;
                return (
                  <button
                    key={year}
                    onClick={() => onEizo100YearChange(isActive ? null : year)}
                    className={`rounded px-2 py-1 text-xs transition-colors ${isActive ? "bg-cinematic-red/15 text-cinematic-red" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"}`}
                  >
                    {year}<span className="ml-1 opacity-60">{isLoading ? "…" : eizo100YearCounts[year] ?? 0}</span>
                  </button>
                );
              })}
            </div>
          )}
          {sourceFilterOptions.length > 0 && (
            <div className="mt-1 border-t border-white/[0.04] pt-1">
              <button onClick={() => toggleGroup("source")} className="flex w-full items-center justify-between px-2 py-2.5 text-xs font-bold tracking-wide text-muted-foreground transition-colors hover:text-foreground">
                <span>掲載サイト</span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${expandedGroups.source ? "rotate-0" : "-rotate-90"}`} />
              </button>
              <AnimatePresence initial={false}>
                {expandedGroups.source && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: "easeInOut" }} className="overflow-hidden">
                    <div className="space-y-0.5 pb-2">
                      {sourceFilterOptions.map((item) => {
                        const isActive = filters.source === item.value;
                        return <button key={item.value} onClick={() => onSourceChange(isActive ? null : item.value)} className={`group flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-sm transition-all duration-150 ${isActive ? "bg-cinematic-red/10 font-medium text-cinematic-red" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"}`}><span className="truncate">{item.label}</span><span className={`ml-2 flex-shrink-0 text-xs ${isActive ? "text-cinematic-red/70" : "opacity-40 group-hover:opacity-60"}`}>{isLoading ? "…" : item.count}</span></button>;
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
        {metadataGroups.length > 0 && (
          <div className="mt-2 border-t border-white/[0.06] pt-2">
            <p className="px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">旧評価（AIランク）から探す</p>
            {metadataGroups.map((group) => (
              <div key={group.slug}>
                <button
                  onClick={() => toggleGroup(group.slug)}
                  className="flex w-full items-center justify-between px-2 py-2.5 text-xs font-bold tracking-wide text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span>{group.label}</span>
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${expandedGroups[group.slug] ? "rotate-0" : "-rotate-90"}`} />
                </button>
                <AnimatePresence initial={false}>
                  {expandedGroups[group.slug] && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: "easeInOut" }} className="overflow-hidden">
                      <div className="space-y-0.5 pb-3">
                        {group.items.map((item) => {
                          const isActive = group.value === item.value;
                          return (
                            <button key={item.value} onClick={() => group.onChange(isActive ? null : item.value)} className={`group flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-sm transition-all duration-150 ${isActive ? "bg-cinematic-red/10 font-medium text-cinematic-red" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"}`}>
                              <span className="flex min-w-0 items-center gap-2"><span className="truncate">{item.label ?? item.value}</span></span>
                              <span className={`ml-2 flex-shrink-0 text-xs ${isActive ? "text-cinematic-red/70" : "opacity-40 group-hover:opacity-60"}`}>{isLoading ? "…" : item.count}</span>
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        )}
        {(productionFilterOptions.roles.length > 0 || productionFilterOptions.entities.length > 0) && (
          <div className="mt-2 border-t border-white/[0.06] pt-2">
            <p className="px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">制作クレジットから探す</p>
            <div>
              <button onClick={() => toggleGroup("productionRole")} className="flex w-full items-center justify-between px-2 py-2.5 text-xs font-bold tracking-wide text-muted-foreground transition-colors hover:text-foreground">
                <span>役割</span><ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${expandedGroups.productionRole ? "rotate-0" : "-rotate-90"}`} />
              </button>
              <AnimatePresence initial={false}>
                {expandedGroups.productionRole && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: "easeInOut" }} className="overflow-hidden">
                    <div className="space-y-0.5 pb-2">
                      {productionFilterOptions.roles.map((item) => {
                        const isActive = filters.productionRole === item.value;
                        return <button key={item.value} onClick={() => onProductionRoleChange(isActive ? null : item.value)} className={`group flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-sm transition-all duration-150 ${isActive ? "bg-cinematic-red/10 font-medium text-cinematic-red" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"}`}><span className="truncate">{item.value}</span><span className={`ml-2 flex-shrink-0 text-xs ${isActive ? "text-cinematic-red/70" : "opacity-40 group-hover:opacity-60"}`}>{isLoading ? "…" : item.count}</span></button>;
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div>
              <button onClick={() => toggleGroup("productionEntity")} className="flex w-full items-center justify-between px-2 py-2.5 text-xs font-bold tracking-wide text-muted-foreground transition-colors hover:text-foreground">
                <span>{filters.productionRole ? `「${filters.productionRole}」の人物・会社` : "人物・会社"}</span><ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${expandedGroups.productionEntity ? "rotate-0" : "-rotate-90"}`} />
              </button>
              <AnimatePresence initial={false}>
                {expandedGroups.productionEntity && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: "easeInOut" }} className="overflow-hidden">
                    <div className="space-y-2 pb-3">
                      {favoritedCreators.length > 0 && (
                        <div className="rounded border border-cinematic-red/20 bg-cinematic-red/[0.04] p-2">
                          <p className="mb-1 flex items-center gap-1 text-[10px] font-bold tracking-wide text-cinematic-red"><Heart className="h-3 w-3 fill-current" /> お気に入りの制作者</p>
                          <div className="space-y-0.5">
                            {favoritedCreators.map((item) => (
                              <button key={`favorite-${item.value}`} onClick={() => onProductionChange(filters.production === item.value ? null : item.value)} className={`group flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition-colors ${filters.production === item.value ? "bg-cinematic-red/10 text-cinematic-red" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"}`}><span className="truncate">{item.value}</span><span className="ml-2 opacity-50">{isLoading ? "…" : item.count}</span></button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-5 gap-1 px-1">
                        {creatorSections.map(({ section, entities }) => (
                          <button key={section} onClick={() => setCreatorIndex(creatorIndex === section ? null : section)} className={`rounded px-1.5 py-1 text-[11px] transition-colors ${creatorIndex === section ? "bg-cinematic-red/15 font-medium text-cinematic-red" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"}`} aria-pressed={creatorIndex === section}>
                            {section}<span className="ml-0.5 opacity-50">{entities.length}</span>
                          </button>
                        ))}
                      </div>
                      {creatorIndex ? (
                        <div className="max-h-72 space-y-0.5 overflow-y-auto rounded border border-white/[0.06] p-1">
                          {indexedCreators.map((item) => {
                            const isActive = filters.production === item.value;
                            const favorite = isCreatorFavorite(item.value);
                            return <div key={item.value} className={`group flex items-center rounded transition-all duration-150 ${isActive ? "bg-cinematic-red/10 text-cinematic-red" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"}`}>
                              <button onClick={() => onProductionChange(isActive ? null : item.value)} className="flex min-w-0 flex-1 items-center justify-between px-2 py-1.5 text-left text-sm"><span className="truncate">{item.value}</span><span className={`ml-2 flex-shrink-0 text-xs ${isActive ? "text-cinematic-red/70" : "opacity-40 group-hover:opacity-60"}`}>{isLoading ? "…" : item.count}</span></button>
                              <button onClick={() => onToggleCreatorFavorite(item.value)} className={`mr-1 rounded p-1 transition-colors ${favorite ? "text-cinematic-red" : "text-muted-foreground/40 hover:text-cinematic-red"}`} aria-label={`${item.value}をお気に入り${favorite ? "から削除" : "に追加"}`} title={`${item.value}をお気に入り${favorite ? "から削除" : "に追加"}`}><Heart className={`h-3.5 w-3.5 ${favorite ? "fill-current" : ""}`} /></button>
                            </div>;
                          })}
                        </div>
                      ) : (
                        <p className="px-2 text-xs leading-relaxed text-muted-foreground/70">文字を選ぶと、該当する人物・会社だけを表示します。</p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>

    </aside>
  );
}
