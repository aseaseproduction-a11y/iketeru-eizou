import { trpc } from "@/lib/trpc";
import {
  type TagItem,
  type Video,
} from "@/lib/types";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ExternalLink,
  Film,
  Loader2,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { getProductionNames, normalizeProductionCredits, productionCreditsToEditableText, type ProductionCredit } from "@shared/productionCredits";
import { EXPRESSION_OPTIONS, PURPOSE_OPTIONS } from "@shared/metadataOptions";
import { clearChromeExtensionImport, detectVideoUrl, getChromeExtensionImport, type ChromeExtensionImport } from "@/lib/videoUrlDetection";
import MetadataValuePicker from "@/components/MetadataValuePicker";
import { collectMetadataValueSuggestions, resolveSuggestedTagItems, type MetadataValueSuggestions } from "@/lib/metadataValueSuggestions";

type ListField =
  | "tags"
  | "purposes"
  | "expressions"
  | "toneEmotions"
  | "toneVisuals"
  | "toneTechniques";

type VideoForm = {
  id: string;
  platform: "youtube" | "vimeo" | "x" | "tiktok" | "instagram" | "external";
  title: string;
  thumbnail: string;
  videoUrl: string;
  embedUrl: string;
  source: string;
  sourceLabel: string;
  channelId: string;
  channelTitle: string;
  genres: TagItem[];
  products: TagItem[];
  directions: TagItem[];
  tones: TagItem[];
  tags: string[];
  purposes: string[];
  expressions: string[];
  toneEmotions: string[];
  toneVisuals: string[];
  toneTechniques: string[];
  productions: string[];
  productionCredits: ProductionCredit[];
  productionCreditText: string;
  privateRating: string;
  aiOverallRating: string;
  aiDirectionRating: string;
  aiTechniqueRating: string;
  aiAnalysis: string;
  addedDate: string;
};

const today = () => new Date().toISOString().slice(0, 10);

const newVideoForm = (): VideoForm => ({
  id: "",
  platform: "youtube",
  title: "",
  thumbnail: "",
  videoUrl: "",
  embedUrl: "",
  source: "manual",
  sourceLabel: "手動追加",
  channelId: "",
  channelTitle: "",
  genres: [],
  products: [],
  directions: [],
  tones: [],
  tags: [],
  purposes: [],
  expressions: [],
  toneEmotions: [],
  toneVisuals: [],
  toneTechniques: [],
  productions: [],
  productionCredits: [],
  productionCreditText: "",
  privateRating: "",
  aiOverallRating: "",
  aiDirectionRating: "",
  aiTechniqueRating: "",
  aiAnalysis: "",
  addedDate: today(),
});

function formFromVideo(video: Video): VideoForm {
  const productionCredits = normalizeProductionCredits(video.productionCredits, video.productions);
  return {
    ...video,
    source: video.source || "manual",
    sourceLabel: video.sourceLabel || "手動追加",
    channelId: video.channelId || "",
    channelTitle: video.channelTitle || "",
    tags: video.allTags || [],
    purposes: video.purposes || [],
    expressions: video.expressions || [],
    toneEmotions: video.toneEmotions || [],
    toneVisuals: video.toneVisuals || [],
    toneTechniques: video.toneTechniques || [],
    productions: getProductionNames(productionCredits),
    productionCredits,
    productionCreditText: productionCreditsToEditableText(productionCredits),
    privateRating: video.privateRating || "",
    aiOverallRating: video.aiOverallRating || "",
    aiDirectionRating: video.aiDirectionRating || "",
    aiTechniqueRating: video.aiTechniqueRating || "",
    aiAnalysis: video.aiAnalysis || "",
  };
}

function newVideoFormFromExtension(imported: ChromeExtensionImport): VideoForm {
  const detected = detectVideoUrl(imported.url);
  if (!detected) return newVideoForm();
  return {
    ...newVideoForm(),
    id: detected.id,
    platform: imported.platform,
    title: imported.title,
    videoUrl: imported.url,
    embedUrl: detected.embedUrl,
    thumbnail: detected.thumbnail,
    sourceLabel: "Chrome拡張機能",
  };
}

function StringListEditor({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
    setDraft("");
  };

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2 focus-within:ring-1 focus-within:ring-cinematic-red/40">
        {values.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {values.map((value) => (
              <span key={value} className="inline-flex items-center gap-1 rounded-md bg-cinematic-red/10 px-2 py-1 text-[11px] text-cinematic-red">
                {value}
                <button type="button" onClick={() => onChange(values.filter((item) => item !== value))} aria-label={`${value}を削除`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent px-1 py-1 text-xs outline-none placeholder:text-muted-foreground/45"
          />
          <button type="button" onClick={add} className="rounded-md bg-white/5 px-2 text-xs text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground">
            追加
          </button>
        </div>
      </div>
    </div>
  );
}

function VideoEditor({ video, onClose, chromeExtensionImport, metadataSuggestions }: { video: Video | null; onClose: () => void; chromeExtensionImport?: ChromeExtensionImport | null; metadataSuggestions: MetadataValueSuggestions }) {
  const isNew = video === null;
  const [form, setForm] = useState<VideoForm>(() => (video ? formFromVideo(video) : chromeExtensionImport ? newVideoFormFromExtension(chromeExtensionImport) : newVideoForm()));
  const utils = trpc.useUtils();
  const createMutation = trpc.videos.create.useMutation();
  const updateMutation = trpc.videos.update.useMutation();
  const previewExternalMediaMutation = trpc.videos.previewExternalMedia.useMutation();
  const isSaving = createMutation.isPending || updateMutation.isPending;

  const set = <K extends keyof VideoForm>(key: K, value: VideoForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleUrlChange = (value: string) => {
    const parsed = detectVideoUrl(value);
    setForm((current) => ({
      ...current,
      videoUrl: value,
      ...(parsed ? { platform: parsed.platform, embedUrl: parsed.embedUrl, thumbnail: parsed.thumbnail, ...(isNew ? { id: parsed.id } : {}) } : {}),
    }));
    if (parsed && ["x", "tiktok", "instagram", "vimeo"].includes(parsed.platform)) {
      void lookupExternalMetadata(value, parsed.platform);
    }
  };

  const lookupExternalMetadata = async (url = form.videoUrl, platform = form.platform) => {
    if (!url || !["x", "tiktok", "instagram", "vimeo"].includes(platform)) return;
    try {
      const metadata = await previewExternalMediaMutation.mutateAsync({ url, platform: platform as "x" | "tiktok" | "instagram" | "vimeo" });
      setForm((current) => {
        if (current.videoUrl !== url) return current;
        return {
          ...current,
          title: current.title || metadata.title,
          thumbnail: current.thumbnail || metadata.thumbnail,
          channelTitle: current.channelTitle || metadata.channelTitle,
        };
      });
      if (metadata.available && (metadata.title || metadata.thumbnail || metadata.channelTitle)) {
        toast.success(`${metadata.source}から公開情報の候補を取得しました。`);
      } else {
        toast.message("公開情報を取得できませんでした。タイトル・サムネイルは手入力で登録できます。");
      }
    } catch {
      toast.message("公開情報を取得できませんでした。タイトル・サムネイルは手入力で登録できます。");
    }
  };

  const save = async () => {
    if (!form.id || !form.title || !form.videoUrl) {
      toast.error("動画URL・動画ID・タイトルは必須です。");
      return;
    }
    try {
      const productionCredits = normalizeProductionCredits([], form.productionCreditText.split(/\n+/));
      const { productionCreditText: _productionCreditText, ...input } = form;
      const payload = { ...input, productions: getProductionNames(productionCredits), productionCredits };
      if (isNew) {
        await createMutation.mutateAsync(payload);
        toast.success("動画を追加しました。");
      } else {
        await updateMutation.mutateAsync(payload);
        toast.success("動画情報を更新しました。");
      }
      await utils.videos.list.invalidate();
      await utils.videos.count.invalidate();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存に失敗しました。");
    }
  };

  const listFields: Array<{ key: ListField; label: string; placeholder: string }> = [
    { key: "tags", label: "追加タグ", placeholder: "例：ローカルプロモーション" },
    { key: "toneEmotions", label: "トンマナ（感情）", placeholder: "例：信頼感" },
    { key: "toneVisuals", label: "トンマナ（ビジュアル）", placeholder: "例：クリーン" },
    { key: "toneTechniques", label: "トンマナ（技術）", placeholder: "例：テロップ" },
  ];

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] overflow-y-auto bg-black/80 p-3 backdrop-blur-sm sm:p-6">
        <motion.div initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: 0.98 }} className="mx-auto min-h-full max-w-5xl rounded-xl border border-white/10 bg-[oklch(0.12_0.006_285)] shadow-2xl">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[oklch(0.12_0.006_285/0.96)] px-4 py-3 backdrop-blur sm:px-6">
            <div>
              <p className="text-sm font-bold">{isNew ? "動画を追加" : "動画情報を編集"}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">カテゴリとNotion相当メタデータを一括で管理できます。</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-white/10 hover:text-foreground" aria-label="閉じる"><X className="h-5 w-5" /></button>
          </div>

          <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <section className="space-y-4">
              {chromeExtensionImport && isNew && (
                <div className="rounded-xl border border-cinematic-red/25 bg-cinematic-red/10 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                  <p className="font-semibold text-cinematic-red">Chrome拡張機能から追加</p>
                  <p className="mt-1">URL・タイトル・媒体候補を引き継ぎました。公開情報と入力内容を確認してから保存してください。</p>
                </div>
              )}
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Film className="h-4 w-4 text-cinematic-red" /> 基本情報</div>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs text-muted-foreground">プラットフォーム
                      <select value={form.platform} onChange={(event) => set("platform", event.target.value as VideoForm["platform"])} className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-cinematic-red/40">
                        <option value="youtube">YouTube</option><option value="vimeo">Vimeo</option><option value="x">X</option><option value="tiktok">TikTok</option><option value="instagram">Instagram</option><option value="external">その他の外部サイト</option>
                      </select>
                    </label>
                    <label className="text-xs text-muted-foreground">私的評価
                      <select value={form.privateRating} onChange={(event) => set("privateRating", event.target.value)} className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-cinematic-red/40">
                        <option value="">未評価</option><option value="S">S</option><option value="A">A</option><option value="B">B</option><option value="C">C</option>
                      </select>
                    </label>
                  </div>
                  <label className="block text-xs text-muted-foreground">動画URL
                    <input value={form.videoUrl} onChange={(event) => handleUrlChange(event.target.value)} onBlur={() => void lookupExternalMetadata()} placeholder="https://www.youtube.com/watch?v=..." className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-cinematic-red/40" />
                  </label>
                  <label className="block text-xs text-muted-foreground">動画ID
                    <input value={form.id} disabled={!isNew} onChange={(event) => set("id", event.target.value)} placeholder="YouTube / Vimeo ID" className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-cinematic-red/40 disabled:cursor-not-allowed disabled:opacity-50" />
                  </label>
                  <label className="block text-xs text-muted-foreground">タイトル
                    <textarea value={form.title} onChange={(event) => set("title", event.target.value)} rows={3} className="mt-1.5 w-full resize-none rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-cinematic-red/40" />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs text-muted-foreground">チャンネル／制作者
                      <input value={form.channelTitle} onChange={(event) => set("channelTitle", event.target.value)} className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-cinematic-red/40" />
                    </label>
                    <label className="text-xs text-muted-foreground">追加日
                      <input type="date" value={form.addedDate} onChange={(event) => set("addedDate", event.target.value)} className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-cinematic-red/40" />
                    </label>
                  </div>
                  <label className="block text-xs text-muted-foreground">サムネイルURL（任意）
                    <input value={form.thumbnail} onChange={(event) => set("thumbnail", event.target.value)} className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-cinematic-red/40" />
                  </label>
                  {(["x", "tiktok", "instagram", "vimeo"] as const).includes(form.platform as "x" | "tiktok" | "instagram" | "vimeo") && (
                    <button type="button" onClick={() => void lookupExternalMetadata()} disabled={!form.videoUrl || previewExternalMediaMutation.isPending} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-50">
                      {previewExternalMediaMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      公開情報からタイトル・サムネイル候補を取得
                    </button>
                  )}
                </div>
              </div>
              {form.thumbnail && <img src={form.thumbnail} alt="サムネイルプレビュー" className="aspect-video w-full rounded-xl border border-white/10 bg-black object-cover" />}
            </section>

            <section className="space-y-5">
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="mb-1 flex items-center gap-2 text-sm font-semibold"><Tag className="h-4 w-4 text-cinematic-red" /> 既存カテゴリ</div>
                <p className="mb-3 text-[10px] text-muted-foreground">登録済みの値から複数追加できます。候補外だけ手入力してください。</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <MetadataValuePicker label="ジャンル" values={form.genres.map((item) => item.name)} suggestions={metadataSuggestions.genres.map((item) => item.name)} onChange={(values) => set("genres", resolveSuggestedTagItems(values, metadataSuggestions.genres))} placeholder="例：ショートフィルム" />
                  <MetadataValuePicker label="商材" values={form.products.map((item) => item.name)} suggestions={metadataSuggestions.products.map((item) => item.name)} onChange={(values) => set("products", resolveSuggestedTagItems(values, metadataSuggestions.products))} placeholder="例：教育 / 出版" />
                  <MetadataValuePicker label="演出" values={form.directions.map((item) => item.name)} suggestions={metadataSuggestions.directions.map((item) => item.name)} onChange={(values) => set("directions", resolveSuggestedTagItems(values, metadataSuggestions.directions))} placeholder="例：長回し" />
                  <MetadataValuePicker label="トーン" values={form.tones.map((item) => item.name)} suggestions={metadataSuggestions.tones.map((item) => item.name)} onChange={(values) => set("tones", resolveSuggestedTagItems(values, metadataSuggestions.tones))} placeholder="例：ノスタルジック" />
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Tag className="h-4 w-4 text-cinematic-red" /> Notion相当の追加情報</div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <MetadataValuePicker label="追加タグ" values={form.tags} suggestions={metadataSuggestions.tags} onChange={(values) => set("tags", values)} placeholder="例：ローカルプロモーション" />
                  <MetadataValuePicker label="用途" values={form.purposes} suggestions={PURPOSE_OPTIONS} onChange={(values) => set("purposes", values)} placeholder="" allowCustom={false} />
                  <MetadataValuePicker label="表現" values={form.expressions} suggestions={EXPRESSION_OPTIONS} onChange={(values) => set("expressions", values)} placeholder="" allowCustom={false} />
                  {listFields.slice(1).map((field) => <StringListEditor key={field.key} label={field.label} values={form[field.key]} onChange={(values) => set(field.key, values)} placeholder={field.placeholder} />)}
                </div>
                <label className="mt-4 block text-xs font-medium text-muted-foreground">制作クレジット
                  <span className="mt-1 block text-[10px] font-normal text-muted-foreground/70">1行ずつ「役割：人物・会社名」で入力します。役割が不明な場合は名前だけを入力できます。</span>
                  <textarea value={form.productionCreditText} onChange={(event) => set("productionCreditText", event.target.value)} placeholder={"監督：代田栄介\n制作会社：LIGHT THE WAY Inc."} rows={5} className="mt-1.5 w-full resize-y rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/45 focus:ring-1 focus:ring-cinematic-red/40" />
                </label>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Tag className="h-4 w-4 text-cinematic-red" /> Notion AI評価・分析</div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {([
                    ["aiOverallRating", "AI評価（総合）"],
                    ["aiDirectionRating", "AI評価（ディレクション）"],
                    ["aiTechniqueRating", "AI評価（技術）"],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="text-xs text-muted-foreground">{label}
                      <input value={form[key]} onChange={(event) => set(key, event.target.value)} placeholder="例：A-" className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-cinematic-red/40" />
                    </label>
                  ))}
                </div>
                <label className="mt-3 block text-xs text-muted-foreground">AI分析結果
                  <textarea value={form.aiAnalysis} onChange={(event) => set("aiAnalysis", event.target.value)} rows={10} placeholder="NotionのAI分析結果を入力" className="mt-1.5 w-full resize-y rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm leading-relaxed text-foreground outline-none focus:ring-1 focus:ring-cinematic-red/40" />
                </label>
              </div>
            </section>
          </div>

          <div className="sticky bottom-0 flex justify-end gap-3 border-t border-white/10 bg-[oklch(0.12_0.006_285/0.96)] px-4 py-3 backdrop-blur sm:px-6">
            <button type="button" onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground">キャンセル</button>
            <button type="button" onClick={save} disabled={isSaving} className="inline-flex items-center gap-2 rounded-lg bg-cinematic-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-cinematic-red-light disabled:opacity-60">
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}{isNew ? "動画を追加" : "変更を保存"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function VideoManagerContent() {
  const { data, isLoading } = trpc.videos.list.useQuery();
  const utils = trpc.useUtils();
  const deleteMutation = trpc.videos.delete.useMutation();
  const [search, setSearch] = useState("");
  const [editorVideo, setEditorVideo] = useState<Video | null | undefined>(undefined);
  const [chromeExtensionImport, setChromeExtensionImport] = useState(() => getChromeExtensionImport(window.location.search));
  const videos = (data as Video[] | undefined) ?? [];
  const metadataSuggestions = useMemo(() => collectMetadataValueSuggestions(videos), [videos]);
  useEffect(() => {
    const targetId = new URLSearchParams(window.location.search).get("video");
    if (!targetId || videos.length === 0 || editorVideo !== undefined) return;
    const target = videos.find((video) => video.id === targetId);
    if (target) setEditorVideo(target);
  }, [videos, editorVideo]);
  useEffect(() => {
    if (!chromeExtensionImport || editorVideo !== undefined) return;
    setEditorVideo(null);
  }, [chromeExtensionImport, editorVideo]);
  const closeEditor = () => {
    setEditorVideo(undefined);
    if (!chromeExtensionImport) return;

    setChromeExtensionImport(null);
    const nextSearch = clearChromeExtensionImport(window.location.search);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${nextSearch}${window.location.hash}`);
  };
  const filteredVideos = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return videos;
    return videos.filter((video) => [video.title, video.channelTitle, ...video.allTags].join(" ").toLowerCase().includes(query));
  }, [search, videos]);

  const remove = async (video: Video) => {
    if (!window.confirm(`「${video.title}」を削除します。元に戻せません。`)) return;
    try {
      await deleteMutation.mutateAsync({ id: video.id });
      await utils.videos.list.invalidate();
      await utils.videos.count.invalidate();
      toast.success("動画を削除しました。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "削除に失敗しました。");
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/" className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> 公開サイトへ戻る</Link>
            <h1 className="text-2xl font-black tracking-tight">動画を編集</h1>
            <p className="mt-1 text-sm text-muted-foreground">誰でも動画を追加・編集・削除できます。削除は確認後に反映されます。</p>
          </div>
          <button onClick={() => setEditorVideo(null)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-cinematic-red px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-cinematic-red-light"><Plus className="h-4 w-4" />動画を追加</button>
        </div>

        <div className="mb-4 flex items-center gap-3 rounded-xl border border-white/10 bg-surface-1 px-3 py-2.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="タイトル・制作者・タグで検索" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/45" />
          <span className="text-xs tabular-nums text-muted-foreground">{filteredVideos.length} / {videos.length}</span>
        </div>

        <div className="overflow-hidden rounded-xl border border-white/10 bg-[oklch(0.12_0.006_285)]">
          <div className="hidden grid-cols-[72px_minmax(0,1fr)_140px_180px] gap-4 border-b border-white/10 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:grid"><span>媒体</span><span>動画</span><span>私的評価</span><span className="text-right">操作</span></div>
          {isLoading ? <div className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />読み込み中…</div> : filteredVideos.map((video) => (
            <div key={video.id} className="grid gap-3 border-b border-white/[0.06] px-4 py-3 last:border-b-0 md:grid-cols-[72px_minmax(0,1fr)_140px_180px] md:items-center md:gap-4">
              <div className="flex items-center gap-2"><img src={video.thumbnail || (video.platform === "youtube" ? `https://img.youtube.com/vi/${video.id}/default.jpg` : "")} alt="" className="h-10 w-16 rounded bg-black object-cover" /><span className="text-[10px] uppercase text-muted-foreground md:hidden">{video.platform}</span></div>
              <div className="min-w-0"><p className="line-clamp-1 text-sm font-medium">{video.title}</p><p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{video.channelTitle || "制作者未登録"}</p><div className="mt-1.5 flex flex-wrap gap-1">{[...video.genres, ...video.products, ...video.directions, ...video.tones].slice(0, 4).map((tag) => <span key={`${video.id}-${tag.slug}`} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">{tag.name}</span>)}</div></div>
              <div className="flex items-center gap-2"><span className={`rounded px-2 py-1 text-xs font-bold ${video.privateRating ? "bg-amber-400/15 text-amber-300" : "bg-white/5 text-muted-foreground"}`}>{video.privateRating || "未評価"}</span><span className="text-xs text-muted-foreground">{video.addedDate}</span></div>
              <div className="flex items-center gap-2 md:justify-end"><a href={video.videoUrl} target="_blank" rel="noreferrer" className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground" title="元動画を開く"><ExternalLink className="h-4 w-4" /></a><button onClick={() => setEditorVideo(video)} className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground" title="編集"><Pencil className="h-4 w-4" /></button><button onClick={() => remove(video)} disabled={deleteMutation.isPending} className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50" title="削除"><Trash2 className="h-4 w-4" /></button></div>
            </div>
          ))}
        </div>
      </div>
      {editorVideo !== undefined && <VideoEditor video={editorVideo} chromeExtensionImport={editorVideo === null ? chromeExtensionImport : null} metadataSuggestions={metadataSuggestions} onClose={closeEditor} />}
    </main>
  );
}

export default function ManageVideos() {
  return <VideoManagerContent />;
}
