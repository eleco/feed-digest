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

// A post as some X builds render it: no test ids, no <time>; modelled on a
// live outline. The ID encodes 2026-11-24T14:20:26.290Z.
export const plainCard = (
  id = "2125233081846223231",
  text = "A synthetic post rendered without test ids.",
  extra = "",
  group = "78 replies, 96 reposts, 3153 likes, 161 bookmarks, 266581 views",
) =>
  `<div role="link"><article>${extra}<a href="/example"><img alt=""></a><a href="/example"><div>Example Author</div></a><a href="/example"><span>@example</span></a><a href="/example/status/${id}">5h</a><button aria-label="More">…</button><div lang="en"><span>${text}</span></div>${group ? `<div role="group" aria-label="${group}"><a aria-label="Reply" href="/compose/post?in_reply_to=${id}"><span>78</span></a><a aria-label="View count" href="/example/status/${id}/analytics"><span>266K</span></a></div>` : ""}</article></div>`;
