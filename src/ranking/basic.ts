import type { Post, Settings, Ranked, Feedback } from "../shared/types";
export function scoreBasic(
  posts: Post[],
  _settings: Settings,
  feedback: Feedback[],
  now = Date.now(),
): Ranked[] {
  const preferred = new Set(
    feedback
      .filter((f) => f.value === "useful")
      .map((f) => f.handle.toLowerCase()),
  );
  return posts
    .map((p): Ranked => {
      const age =
        p.publishedAt === null
          ? 7
          : Math.max(0, (now - p.publishedAt) / 86400000);
      return {
        id: p.id,
        score: Math.min(
          100,
          30 +
            (preferred.has(p.handle.toLowerCase()) ? 3 : 0) +
            Math.max(0, 12 - age) +
            (p.text.length > 160 ? 5 : 0) +
            Math.min(1, Math.log10((p.likes ?? 0) + 1) / 10),
        ),
        takeaway: p.text.slice(0, 320) || "No text was captured for this post.",
        reason: "Collected post; AI analysis is not available.",
        flags: [
          ...(p.truncated ? ["Excerpt — post is truncated"] : []),
          ...(p.quotedText ? ["Quoted text kept separate"] : []),
        ],
        mode: "basic" as const,
      };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
// Preserve every collected ID; annotations affect ordering and labels, never visibility.
export function allPostItems(
  posts: Post[],
  settings: Settings,
  annotations: Ranked[] = [],
  feedback: Feedback[] = [],
): Ranked[] {
  const byId = new Map(annotations.map((item) => [item.id, item]));
  return scoreBasic(posts, settings, feedback).map(
    (item) => byId.get(item.id) ?? item,
  );
}
