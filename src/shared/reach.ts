import type { Post } from "./types";

export function viewFollowerRatio(
  post: Pick<Post, "views" | "followers">,
): number | null {
  if (
    post.views == null ||
    post.followers == null ||
    !Number.isFinite(post.views) ||
    !Number.isFinite(post.followers) ||
    post.views < 0 ||
    post.followers <= 0
  )
    return null;
  return post.views / post.followers;
}
export function matchesReach(
  post: Pick<Post, "views" | "followers">,
  threshold: number,
) {
  if (threshold === 0) return true;
  const ratio = viewFollowerRatio(post);
  return ratio !== null && ratio >= threshold;
}
