import { sectors, tones } from "./categories.js";
import type { Post, Ranked } from "./types";

export interface ReaderPost {
  id: string;
  author: string;
  handle: string;
  text: string;
  quotedText: string | null;
  publishedAt: number | null;
  pinned: boolean;
  url: string;
  links: string[];
  score: number | null;
  sectors: string[];
  tones: string[];
}
export interface ReaderSnapshot {
  format: "x-feed-digest-reader";
  version: 1;
  exportedAt: string;
  posts: ReaderPost[];
}
export function readerSnapshot(posts: Post[], items: Ranked[]): ReaderSnapshot {
  const results = new Map(items.map((item) => [item.id, item]));
  return parseReaderSnapshot({
    format: "x-feed-digest-reader",
    version: 1,
    exportedAt: new Date().toISOString(),
    posts: posts.map((post) => {
      const result = results.get(post.id);
      return {
        id: post.id,
        author: post.author,
        handle: post.handle,
        text: post.text,
        quotedText: post.quotedText,
        publishedAt: post.publishedAt,
        pinned: post.pinned,
        url: post.url,
        links: post.links?.map((link) => link.url) ?? [],
        score: result?.mode === "ai" ? result.score : null,
        sectors: result?.sectors ?? [],
        tones: result?.tones ?? [],
      };
    }),
  });
}
const safeLink = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 4096) return false;
  try {
    return ["https:", "http:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};
export function parseReaderSnapshot(raw: unknown): ReaderSnapshot {
  const data = raw as ReaderSnapshot;
  if (
    !data ||
    data.format !== "x-feed-digest-reader" ||
    data.version !== 1 ||
    typeof data.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(data.exportedAt)) ||
    !Array.isArray(data.posts) ||
    data.posts.length > 10000
  )
    throw Error("Choose an online-reader export from X Feed Digest.");
  const seen = new Set<string>();
  const posts = data.posts.map((post) => {
    if (
      !post ||
      typeof post.id !== "string" ||
      !/^\d{1,25}$/.test(post.id) ||
      seen.has(post.id) ||
      typeof post.author !== "string" ||
      post.author.length > 500 ||
      typeof post.handle !== "string" ||
      post.handle.length > 100 ||
      typeof post.text !== "string" ||
      post.text.length > 30000 ||
      !(
        post.quotedText === null ||
        (typeof post.quotedText === "string" && post.quotedText.length <= 30000)
      ) ||
      !(
        post.publishedAt === null ||
        (typeof post.publishedAt === "number" &&
          Number.isFinite(post.publishedAt) &&
          Math.abs(post.publishedAt) <= 8640000000000000)
      ) ||
      typeof post.pinned !== "boolean" ||
      !(
        post.score === null ||
        (typeof post.score === "number" &&
          Number.isFinite(post.score) &&
          post.score >= 0 &&
          post.score <= 100)
      ) ||
      !Array.isArray(post.links) ||
      post.links.length > 100 ||
      !post.links.every(safeLink) ||
      !Array.isArray(post.sectors) ||
      !Array.isArray(post.tones)
    )
      throw Error("Invalid post in reader export.");
    seen.add(post.id);
    return {
      id: post.id,
      author: post.author,
      handle: post.handle,
      text: post.text,
      quotedText: post.quotedText,
      publishedAt: post.publishedAt,
      pinned: post.pinned,
      url: `https://x.com/${encodeURIComponent(post.handle)}/status/${post.id}`,
      links: post.links,
      score: post.score,
      sectors: post.sectors
        .filter((label) => sectors.includes(label as (typeof sectors)[number]))
        .slice(0, 3),
      tones: post.tones
        .filter((label) => tones.includes(label as (typeof tones)[number]))
        .slice(0, 2),
    };
  });
  // Explicit fields only: uploads never carry credentials, settings or request logs.
  return {
    format: "x-feed-digest-reader",
    version: 1,
    exportedAt: new Date(data.exportedAt).toISOString(),
    posts,
  };
}
