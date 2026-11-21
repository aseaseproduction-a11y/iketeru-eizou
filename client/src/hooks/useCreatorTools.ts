/**
 * Creator tools hook — profile-scoped favorites, legacy migration and notes.
 * お気に入りは共有端末でも利用者名で分離してDBへ保存し、メモは既存の端末ローカル保存を維持する。
 */
import { useState, useCallback, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";

const FAVORITES_KEY = "iketeru_favorites";
const CREATOR_FAVORITES_KEY = "iketeru_creator_favorites";
const NOTES_KEY = "iketeru_notes";
const ACTIVE_PROFILE_KEY = "iketeru_active_favorite_profile_id";
const LEGACY_MIGRATED_KEY = "iketeru_favorite_legacy_migrated_v1";
const EMPTY_PROFILE_ID = "00000000-0000-0000-0000-000000000000";

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage errors
  }
}

export function toggleStoredFavorite(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function useCreatorTools() {
  const [legacyFavorites] = useState<string[]>(() =>
    loadFromStorage<string[]>(FAVORITES_KEY, []).filter((value): value is string => typeof value === "string" && value.trim().length > 0)
  );
  const [legacyCreatorFavorites] = useState<string[]>(() =>
    loadFromStorage<string[]>(CREATOR_FAVORITES_KEY, []).filter((value): value is string => typeof value === "string" && value.trim().length > 0)
  );
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    loadFromStorage<Record<string, string>>(NOTES_KEY, {})
  );
  const [activeProfileId, setActiveProfileId] = useState<string | null>(() =>
    loadFromStorage<string | null>(ACTIVE_PROFILE_KEY, null)
  );
  const utils = trpc.useUtils();
  const meQuery = trpc.auth.me.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const canEditFavorites = useMemo(() => {
    const user = meQuery.data;
    if (user?.role === "admin") return true;
    const email = (user?.email ?? "").trim().toLowerCase();
    if (email.endsWith("@atsu-maru.co.jp")) return true;
    try {
      return Boolean(window.sessionStorage.getItem("iketeru_admin_api_key"));
    } catch {
      return false;
    }
  }, [meQuery.data]);
  const profilesQuery = trpc.favorites.profiles.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const profileItemsQuery = trpc.favorites.items.useQuery(
    { profileId: activeProfileId ?? EMPTY_PROFILE_ID },
    { enabled: Boolean(activeProfileId), staleTime: 30_000 },
  );

  const profiles = profilesQuery.data ?? [];
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null;
  const favorites = profileItemsQuery.data?.videoIds ?? [];
  const creatorFavorites = profileItemsQuery.data?.creatorNames ?? [];
  const hasLegacyFavorites = legacyFavorites.length > 0 || legacyCreatorFavorites.length > 0;
  const legacyMigrationPending = hasLegacyFavorites && !loadFromStorage<boolean>(LEGACY_MIGRATED_KEY, false);

  const invalidateProfileItems = useCallback(async () => {
    if (activeProfileId) await utils.favorites.items.invalidate({ profileId: activeProfileId });
  }, [activeProfileId, utils.favorites.items]);

  const toggleVideoMutation = trpc.favorites.toggleVideo.useMutation({
    onSuccess: invalidateProfileItems,
  });
  const toggleCreatorMutation = trpc.favorites.toggleCreator.useMutation({
    onSuccess: invalidateProfileItems,
  });
  const createProfileMutation = trpc.favorites.createProfile.useMutation({
    onSuccess: async () => { await utils.favorites.profiles.invalidate(); },
  });
  const renameProfileMutation = trpc.favorites.renameProfile.useMutation({
    onSuccess: async () => { await utils.favorites.profiles.invalidate(); },
  });
  const deleteProfileMutation = trpc.favorites.deleteProfile.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.favorites.profiles.invalidate(), invalidateProfileItems()]);
    },
  });
  const migrateLegacyMutation = trpc.favorites.migrateLegacy.useMutation();

  const migrateLegacyFavorites = useCallback(async (profileId: string) => {
    if (!legacyMigrationPending) return;
    await migrateLegacyMutation.mutateAsync({
      profileId,
      videoIds: legacyFavorites,
      creatorNames: legacyCreatorFavorites,
    });
    saveToStorage(LEGACY_MIGRATED_KEY, true);
    await utils.favorites.items.invalidate({ profileId });
  }, [legacyCreatorFavorites, legacyFavorites, legacyMigrationPending, migrateLegacyMutation, utils.favorites.items]);

  const selectProfile = useCallback(async (profileId: string | null) => {
    setActiveProfileId(profileId);
    saveToStorage(ACTIVE_PROFILE_KEY, profileId);
    if (profileId) await migrateLegacyFavorites(profileId);
  }, [migrateLegacyFavorites]);

  useEffect(() => {
    if (!profilesQuery.isLoading && activeProfileId && !activeProfile) {
      setActiveProfileId(null);
      saveToStorage(ACTIVE_PROFILE_KEY, null);
    }
  }, [activeProfile, activeProfileId, profilesQuery.isLoading]);

  useEffect(() => {
    if (canEditFavorites && activeProfileId && activeProfile && legacyMigrationPending && !migrateLegacyMutation.isPending) {
      void migrateLegacyFavorites(activeProfileId);
    }
  }, [activeProfile, activeProfileId, canEditFavorites, legacyMigrationPending, migrateLegacyFavorites, migrateLegacyMutation.isPending]);

  const toggleFavorite = useCallback((id: string) => {
    if (!activeProfileId || toggleVideoMutation.isPending) return;
    const current = profileItemsQuery.data;
    const isCurrentFavorite = current?.videoIds.includes(id) ?? false;
    utils.favorites.items.setData({ profileId: activeProfileId }, {
      videoIds: isCurrentFavorite ? (current?.videoIds ?? []).filter((videoId) => videoId !== id) : [...(current?.videoIds ?? []), id],
      creatorNames: current?.creatorNames ?? [],
    });
    toggleVideoMutation.mutate({ profileId: activeProfileId, videoId: id }, {
      onError: () => { void utils.favorites.items.invalidate({ profileId: activeProfileId }); },
    });
  }, [activeProfileId, profileItemsQuery.data, toggleVideoMutation, utils.favorites.items]);

  const isFavorite = useCallback(
    (id: string) => favorites.includes(id),
    [favorites]
  );

  const toggleCreatorFavorite = useCallback((name: string) => {
    if (!activeProfileId || toggleCreatorMutation.isPending) return;
    const current = profileItemsQuery.data;
    const isCurrentFavorite = current?.creatorNames.includes(name) ?? false;
    utils.favorites.items.setData({ profileId: activeProfileId }, {
      videoIds: current?.videoIds ?? [],
      creatorNames: isCurrentFavorite ? (current?.creatorNames ?? []).filter((creatorName) => creatorName !== name) : [...(current?.creatorNames ?? []), name],
    });
    toggleCreatorMutation.mutate({ profileId: activeProfileId, creatorName: name }, {
      onError: () => { void utils.favorites.items.invalidate({ profileId: activeProfileId }); },
    });
  }, [activeProfileId, profileItemsQuery.data, toggleCreatorMutation, utils.favorites.items]);

  const isCreatorFavorite = useCallback(
    (name: string) => creatorFavorites.includes(name),
    [creatorFavorites]
  );

  const saveNote = useCallback((id: string, note: string) => {
    setNotes((prev) => {
      const next = { ...prev };
      if (note.trim()) {
        next[id] = note;
      } else {
        delete next[id];
      }
      saveToStorage(NOTES_KEY, next);
      return next;
    });
  }, []);

  const getNote = useCallback((id: string) => notes[id] || "", [notes]);

  const favoriteCount = favorites.length;
  const creatorFavoriteCount = creatorFavorites.length;
  const noteCount = useMemo(() => Object.keys(notes).length, [notes]);

  return {
    favorites,
    toggleFavorite,
    isFavorite,
    creatorFavorites,
    toggleCreatorFavorite,
    isCreatorFavorite,
    saveNote,
    getNote,
    favoriteCount,
    creatorFavoriteCount,
    noteCount,
    profiles,
    activeProfile,
    activeProfileId,
    selectProfile,
    createProfile: async (displayName: string) => {
      const profile = await createProfileMutation.mutateAsync({ displayName });
      await selectProfile(profile.id);
      return profile;
    },
    renameProfile: async (profileId: string, displayName: string) => renameProfileMutation.mutateAsync({ profileId, displayName }),
    deleteProfile: async (profileId: string) => {
      await deleteProfileMutation.mutateAsync({ profileId });
      if (profileId === activeProfileId) await selectProfile(null);
    },
    legacyMigrationPending,
    migrateLegacyFavorites: async () => {
      if (activeProfileId) await migrateLegacyFavorites(activeProfileId);
    },
    isProfilesLoading: profilesQuery.isLoading,
    isProfileItemsLoading: profileItemsQuery.isLoading,
    profileError: profilesQuery.error ?? profileItemsQuery.error ?? createProfileMutation.error ?? renameProfileMutation.error ?? deleteProfileMutation.error ?? toggleVideoMutation.error ?? toggleCreatorMutation.error,
  };
}
