import type { Post, Ranked } from "./types";

export const digestSorts = {
  insight: "Most insightful (AI)",
  newest: "Newest posts first",
  oldest: "Oldest posts first",
  comments: "Most comments",
  likes: "Most likes",
} as const;
export type DigestSort = keyof typeof digestSorts;
export function isDigestSort(value: unknown): value is DigestSort {
  return typeof value === "string" && Object.hasOwn(digestSorts, value);
}
export function sortDigest(
  items: Ranked[],
  posts: Post[],
  sort: DigestSort,
): Ranked[] {
  const byId = new Map(posts.map((post) => [post.id, post]));
  const metric = (item: Ranked): number | null | undefined => {
    const post = byId.get(item.id);
    switch (sort) {
      case "insight":
        return item.mode === "ai" ? item.score : null;
      case "newest":
      case "oldest":
        return post?.publishedAt;
      case "comments":
        return post?.comments;
      case "likes":
        return post?.likes;
      default:
        return item.score;
    }
  };
  return [...items].sort((a, b) => {
    const av = metric(a),
      bv = metric(b);
    // Unknown measurements always come last, including oldest-first sorting.
    const aMissing = av == null || !Number.isFinite(av);
    const bMissing = bv == null || !Number.isFinite(bv);
    if (aMissing || bMissing) return Number(aMissing) - Number(bMissing);
    return sort === "oldest" ? av! - bv! : bv! - av!;
  });
}
