import type { TagItem, Video } from "@/lib/types";

export type MetadataTagField = "genres" | "products" | "directions" | "tones";

export type MetadataValueSuggestions = {
  tags: string[];
  purposes: string[];
  expressions: string[];
  genres: TagItem[];
  products: TagItem[];
  directions: TagItem[];
  tones: TagItem[];
};

function uniqueSortedValues(values: unknown[]) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right, "ja"));
}

function uniqueSortedTags(values: unknown[]) {
  const byName = new Map<string, TagItem>();
  values.forEach((value) => {
    if (!value || typeof value !== "object" || typeof (value as TagItem).name !== "string") return;
    const tag = value as TagItem;
    const name = tag.name.trim();
    if (name && !byName.has(name)) byName.set(name, { ...tag, name });
  });
  return Array.from(byName.values()).sort((left, right) => left.name.localeCompare(right.name, "ja"));
}

export function collectMetadataValueSuggestions(videos: Video[]): MetadataValueSuggestions {
  return {
    tags: uniqueSortedValues(videos.flatMap((video) => video.allTags)),
    purposes: uniqueSortedValues(videos.flatMap((video) => video.purposes)),
    expressions: uniqueSortedValues(videos.flatMap((video) => video.expressions)),
    genres: uniqueSortedTags(videos.flatMap((video) => video.genres)),
    products: uniqueSortedTags(videos.flatMap((video) => video.products)),
    directions: uniqueSortedTags(videos.flatMap((video) => video.directions)),
    tones: uniqueSortedTags(videos.flatMap((video) => video.tones)),
  };
}

export function resolveSuggestedTagItems(names: string[], candidates: TagItem[]) {
  return names.map((name) => candidates.find((candidate) => candidate.name === name) ?? {
    name,
    slug: name.trim().toLowerCase().replace(/\s+/g, "-"),
  });
}
