import { defaults, type Post, type Run } from "../../src/shared/types";
export function post(id = "100", overrides: Partial<Post> = {}): Post {
  return {
    id,
    url: `https://x.com/example/status/${id}`,
    handle: "example",
    author: "Example Author",
    text: "A synthetic post about designing a practical experiment and documenting the results.",
    publishedAt: Date.now() - 3600000,
    collectedAt: Date.now(),
    observations: [{ runId: "run", feed: "following", at: Date.now() }],
    quotedText: null,
    reposter: null,
    reply: false,
    promoted: false,
    truncated: false,
    mediaOnly: false,
    likes: null,
    pinned: false,
    ...overrides,
  };
}
export function run(overrides: Partial<Run> = {}): Run {
  return {
    id: "run",
    state: "ranking",
    phase: "Ranking",
    feed: null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    leaseUntil: Date.now() + 100000,
    reason: "",
    feeds: {
      following: {
        count: 1,
        skipped: 0,
        steps: 1,
        reason: "limit",
        complete: true,
      },
      "for-you": {
        count: 1,
        skipped: 0,
        steps: 1,
        reason: "limit",
        complete: true,
      },
    },
    postIds: ["100"],
    requests: 0,
    generation: "generation",
    settings: { ...defaults },
    ...overrides,
  };
}
export const card = (
  id = "100",
  text = "A synthetic original post with useful text.",
  extra = "",
) =>
  `<article data-testid="tweet"><div data-testid="User-Name"><a href="/example"><span>Example Author</span></a><a href="/example/status/${id}"><time datetime="2026-09-20T10:00:00Z"></time></a></div><div data-testid="tweetText">${text}</div>${extra}</article>`;
