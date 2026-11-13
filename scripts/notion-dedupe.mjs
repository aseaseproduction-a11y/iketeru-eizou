export function normalizedTitle(value) {
  return String(value ?? "").trim().toLocaleLowerCase("ja-JP").replace(/\s+/g, " ");
}

export function normalizedUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_")) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return String(value ?? "").trim().replace(/\/$/, "");
  }
}

export function urlTitleKey(url, title) {
  return `${normalizedUrl(url)}\u0000${normalizedTitle(title)}`;
}

export function buildExistingIndexes(videos) {
  const byId = new Map(videos.map((video) => [video.id, video]));
  const byUrlTitle = new Map(videos.map((video) => [urlTitleKey(video.videoUrl, video.title), video]));
  const byUrl = new Map();
  for (const video of videos) {
    const key = normalizedUrl(video.videoUrl);
    const candidates = byUrl.get(key) || [];
    candidates.push(video);
    byUrl.set(key, candidates);
  }
  return { byId, byUrlTitle, byUrl };
}

export function findExistingVideo(indexes, incoming) {
  const byId = indexes.byId.get(incoming.id);
  if (byId) return { video: byId, matchedBy: "id" };

  const byUrlTitle = indexes.byUrlTitle.get(urlTitleKey(incoming.videoUrl, incoming.title));
  if (byUrlTitle) return { video: byUrlTitle, matchedBy: "url" };

  const candidates = indexes.byUrl.get(normalizedUrl(incoming.videoUrl)) || [];
  if (candidates.length === 1) return { video: candidates[0], matchedBy: "url" };
  return { video: undefined, matchedBy: null };
}
