import type { Feedback, Post, Ranked } from "./types";
export const defaultDigestFilters = {
  lowScores: false,
  repeatedText: false,
  repeatedAuthors: false,
  notUseful: false,
};
export type DigestFilters = typeof defaultDigestFilters;
export function readDigestFilters(raw: unknown): DigestFilters {
  const value =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(
    Object.keys(defaultDigestFilters).map((key) => [key, value[key] === true]),
  ) as DigestFilters;
}
const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
// Apply to the current sorted view so the first visible matching post is retained.
export function filterDigest(
  items: Ranked[],
  posts: Post[],
  feedback: Feedback[],
  filters: DigestFilters,
  blacklist: string[] = [],
): Ranked[] {
  const blocked = blacklist
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
  const byId = new Map(posts.map((p) => [p.id, p]));
  const rejected = new Set(
    feedback.filter((f) => f.value === "not-useful").map((f) => f.id),
  );
  const texts = new Set<string>();
  const authors = new Map<string, number>();
  return items.filter((item) => {
    const post = byId.get(item.id);
    if (
      !post ||
      blocked.some((word) =>
        `${post.text}\n${post.quotedText ?? ""}`.toLowerCase().includes(word),
      ) ||
      (filters.lowScores && item.mode === "ai" && item.score < 30) ||
      (filters.notUseful && rejected.has(item.id))
    )
      return false;
    const text = normalise(post.text);
    const author = post.handle.toLowerCase().replace(/^@/, "");
    if (filters.repeatedText && text && texts.has(text)) return false;
    if (filters.repeatedAuthors && (authors.get(author) ?? 0) >= 2)
      return false;
    if (text) texts.add(text);
    authors.set(author, (authors.get(author) ?? 0) + 1);
    return true;
  });
}
