import { useState } from "react";
import { Check, Pencil, Plus, Trash2, UserRound, UsersRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type FavoriteProfile = {
  id: string;
  displayName: string;
  normalizedName: string;
  createdAt: Date;
  updatedAt: Date;
};

interface FavoriteProfileManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: FavoriteProfile[];
  activeProfile: FavoriteProfile | null;
  onSelectProfile: (profileId: string) => Promise<void> | void;
  onCreateProfile: (displayName: string) => Promise<FavoriteProfile>;
  onRenameProfile: (profileId: string, displayName: string) => Promise<FavoriteProfile>;
  onDeleteProfile: (profileId: string) => Promise<void>;
  legacyMigrationPending: boolean;
  onMigrateLegacyFavorites: () => Promise<void>;
  canEdit?: boolean;
}

export default function FavoriteProfileManager({
  open,
  onOpenChange,
  profiles,
  activeProfile,
  onSelectProfile,
  onCreateProfile,
  onRenameProfile,
  onDeleteProfile,
  legacyMigrationPending,
  onMigrateLegacyFavorites,
  canEdit = false,
}: FavoriteProfileManagerProps) {
  const [newName, setNewName] = useState("");
  const [editingName, setEditingName] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState("");

  const getErrorMessage = (reason: unknown) => reason instanceof Error ? reason.message : "操作を完了できませんでした。時間をおいてもう一度お試しください。";

  const createProfile = async () => {
    if (!newName.trim()) return;
    setIsWorking(true);
    setError("");
    try {
      await onCreateProfile(newName);
      setNewName("");
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setIsWorking(false);
    }
  };

  const startEditing = () => {
    if (!activeProfile) return;
    setEditingName(activeProfile.displayName);
    setIsEditing(true);
    setConfirmDelete(false);
    setError("");
  };

  const saveRename = async () => {
    if (!activeProfile || !editingName.trim()) return;
    setIsWorking(true);
    setError("");
    try {
      await onRenameProfile(activeProfile.id, editingName);
      setIsEditing(false);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setIsWorking(false);
    }
  };

  const removeProfile = async () => {
    if (!activeProfile) return;
    setIsWorking(true);
    setError("");
    try {
      await onDeleteProfile(activeProfile.id);
      setConfirmDelete(false);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(720px,calc(100vh-2rem))] overflow-y-auto border-white/10 bg-[oklch(0.12_0.005_285)] p-5 text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <UsersRound className="h-4 w-4 text-cinematic-red" />
            お気に入りの利用者
          </DialogTitle>
          <DialogDescription>
            動画と制作者のお気に入りは、ここで選ぶ名前ごとに保存されます。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {profiles.length > 0 ? profiles.map((profile) => {
            const selected = profile.id === activeProfile?.id;
            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => { void onSelectProfile(profile.id); setIsEditing(false); setConfirmDelete(false); }}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                  selected
                    ? "border-cinematic-red/50 bg-cinematic-red/10 text-white"
                    : "border-white/10 bg-white/[0.03] text-muted-foreground hover:bg-white/[0.07] hover:text-foreground"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2"><UserRound className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{profile.displayName}</span></span>
                {selected && <Check className="h-4 w-4 shrink-0 text-cinematic-red" />}
              </button>
            );
          }) : (
            <div className="rounded-lg border border-dashed border-white/15 px-3 py-5 text-center text-xs leading-relaxed text-muted-foreground">
              まだ利用者名がありません。下から名前を追加してください。
            </div>
          )}
        </div>

        {!canEdit ? (
          <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-100">
            お気に入りの作成・変更・保存には管理者または <code className="font-mono">@atsu-maru.co.jp</code> アカウントでのログインが必要です。
          </div>
        ) : (
        <div className="border-t border-white/10 pt-4">
          <label htmlFor="favorite-profile-new-name" className="mb-1.5 block text-xs font-medium text-foreground">新しい利用者名</label>
          <div className="flex gap-2">
            <input
              id="favorite-profile-new-name"
              value={newName}
              maxLength={80}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void createProfile(); }}
              placeholder="例：千葉"
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.05] px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-cinematic-red/60"
            />
            <button
              type="button"
              disabled={!newName.trim() || isWorking}
              onClick={() => void createProfile()}
              className="inline-flex items-center gap-1 rounded-md bg-cinematic-red px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-cinematic-red-light disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />追加
            </button>
          </div>
        </div>
        )}

        {canEdit && activeProfile && (
          <div className="space-y-3 rounded-lg border border-white/10 bg-white/[0.025] p-3">
            {isEditing ? (
              <>
                <label htmlFor="favorite-profile-rename" className="block text-xs font-medium">選択中の利用者名を変更</label>
                <div className="flex gap-2">
                  <input
                    id="favorite-profile-rename"
                    value={editingName}
                    maxLength={80}
                    onChange={(event) => setEditingName(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") void saveRename(); }}
                    className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.05] px-3 py-2 text-sm outline-none focus:border-cinematic-red/60"
                  />
                  <button type="button" disabled={!editingName.trim() || isWorking} onClick={() => void saveRename()} className="rounded-md border border-cinematic-red/40 px-3 py-2 text-xs font-bold text-cinematic-red hover:bg-cinematic-red/10 disabled:opacity-50">保存</button>
                </div>
                <button type="button" onClick={() => setIsEditing(false)} className="text-xs text-muted-foreground hover:text-foreground">キャンセル</button>
              </>
            ) : confirmDelete ? (
              <>
                <p className="text-xs leading-relaxed text-amber-300">「{activeProfile.displayName}」の動画・制作者のお気に入りがすべて削除されます。この操作は取り消せません。</p>
                <div className="flex gap-2">
                  <button type="button" disabled={isWorking} onClick={() => void removeProfile()} className="rounded-md bg-red-500/90 px-3 py-2 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-50">削除する</button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-md border border-white/10 px-3 py-2 text-xs text-muted-foreground hover:bg-white/[0.06] hover:text-foreground">戻る</button>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">選択中：<strong className="font-medium text-foreground">{activeProfile.displayName}</strong></span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={startEditing} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><Pencil className="h-3 w-3" />変更</button>
                  <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1 text-xs text-red-300 hover:text-red-200"><Trash2 className="h-3 w-3" />削除</button>
                </div>
              </div>
            )}
          </div>
        )}

        {canEdit && legacyMigrationPending && activeProfile && (
          <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-100">
            この端末にある既存のお気に入りをまだ引き継いでいません。
            <button type="button" disabled={isWorking} onClick={() => void onMigrateLegacyFavorites()} className="mt-2 block font-bold text-amber-300 hover:text-amber-200">「{activeProfile.displayName}」に引き継ぐ</button>
          </div>
        )}

        {error && <p role="alert" className="rounded-md border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-200">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
