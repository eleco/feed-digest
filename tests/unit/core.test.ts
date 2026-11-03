import { sortDigest } from "../../src/shared/digest-sort";
import { extractionCache } from "../../src/content/cache";
import { describe, it, expect } from "vitest";
import {
  extract,
  selected,
  transitionSafe,
  engagement,
  feedTab,
  barrier,
  account,
} from "../../src/content/adapter";
import {
  canonical,
  defaults,
  isHome,
  validatePost,
  validateSettings,
} from "../../src/shared/types";
import { scoreBasic, allPostItems } from "../../src/ranking/basic";
import { validateOutput, makePrompt } from "../../src/ranking/prompt";
import { isFree } from "../../src/ranking/providers";
import { mergePost } from "../../src/storage/db";
import { card, post } from "../fixtures/data";
function fixture(html: string) {
  document.body.innerHTML = html;
  return document.querySelector("article")!;
}
describe("DOM identity and provenance", () => {
  it("reuses unchanged cards and invalidates edited or recycled DOM nodes", () => {
    const root = fixture(card("100", "Original text"));
    const cache = extractionCache("following", "run");
    const first = cache.read(root)!;
    expect(cache.read(root)).toBe(first);
    const observer = new MutationObserver(() => {});
    observer.observe(root, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });
    root.querySelector('[data-testid="tweetText"]')!.textContent =
      "Edited text";
    cache.invalidate(observer.takeRecords());
    expect(cache.read(root)?.text).toBe("Edited text");
    root
      .querySelector("time")!
      .closest("a")!
      .setAttribute("href", "/example/status/101");
    cache.invalidate(observer.takeRecords());
    expect(cache.read(root)?.id).toBe("101");
    expect(
      extractionCache("for-you", "next-run").read(root)?.observations[0],
    ).toMatchObject({ feed: "for-you", runId: "next-run" });
    observer.disconnect();
  });
  it("keeps extracted cards cached through presentation-only mutation bursts", () => {
    const root = fixture(card("100", "Original text"));
    const cache = extractionCache("following", "run");
    const first = cache.read(root)!;
    const observer = new MutationObserver(() => {});
    observer.observe(root, { subtree: true, attributes: true });
    const text = root.querySelector('[data-testid="tweetText"]')!;
    try {
      for (let i = 0; i < 100; i++) {
        text.setAttribute("style", `opacity: ${i / 100}`);
        text.setAttribute("class", `animation-${i}`);
        cache.invalidate(observer.takeRecords());
        expect(cache.read(root)).toBe(first);
      }
      root
        .querySelector("time")!
        .setAttribute("datetime", "2026-11-01T12:00:00Z");
      cache.invalidate(observer.takeRecords());
      expect(cache.read(root)?.publishedAt).toBe(1793534400000);
      expect(cache.read(root)).not.toBe(first);
    } finally {
      observer.disconnect();
    }
  });
  it("extracts an outer post, keeping quote identity and text separate", () => {
    const root = fixture(
      card(
        "100",
        "Outer author text",
        `<div role="link">${card("200", "Untrusted quoted text")}</div>`,
      ),
    );
    const p = extract(root, "following", "run")!;
    expect(p.id).toBe("100");
    expect(p.text).toBe("Outer author text");
    expect(p.quotedText).toBe("Untrusted quoted text");
    expect(p.url).toBe("https://x.com/example/status/100");
  });
  it("extracts outer reply counts without using quoted-post engagement", () => {
    const root = fixture(
      card(
        "100",
        "Outer",
        `<div role="link">${card("200", "Quote", '<button data-testid="reply"><span>999</span></button>')}</div><button data-testid="reply"><span>1.2K</span></button>`,
      ),
    );
    expect(extract(root, "following", "run")?.comments).toBe(1200);
    root.querySelector(':scope > button[data-testid="reply"]')!.remove();
    expect(extract(root, "following", "run")?.comments).toBeNull();
    root.insertAdjacentHTML(
      "beforeend",
      '<button data-testid="reply" aria-label="0 replies. Reply"></button>',
    );
    expect(extract(root, "following", "run")?.comments).toBe(0);
  });
  it("collects safe post and quote links, deduplicates and keeps t.co when no expanded URL is rendered", () => {
    const root = fixture(
      card(
        "100",
        "Outer",
        `<div data-testid="tweetText"><a href="https://t.co/a" title="https://example.org/report">report</a><a href="https://example.org/report" role="link">duplicate</a><a href="https://t.co/b">short</a><a href="javascript:alert(1)">unsafe</a><a href="https://user:secret@example.org/">credentials</a></div><div role="link">${card("200", "Quote", '<a href="https://example.net/source">source</a>')}</div>`,
      ),
    );
    expect(extract(root, "following", "run")?.links).toEqual([
      { url: "https://example.org/report", source: "post" },
      { url: "https://t.co/b", source: "post" },
      { url: "https://example.net/source", source: "quote" },
    ]);
  });
  it("does not use the quoted timestamp when the outer timestamp is absent", () => {
    const root = fixture(
      `<article data-testid="tweet"><div data-testid="User-Name">Outer</div><div role="link">${card("200")}</div></article>`,
    );
    expect(extract(root, "following", "run")).toBeNull();
  });
  it("extracts reply, repost, promoted and excerpt markers", () => {
    const p = extract(
      fixture(
        card(
          "100",
          "Replying to @someone\nA useful reply",
          `<span data-testid="socialContext">Someone reposted</span><span>Promoted</span><a data-testid="tweet-text-show-more-link">Show more</a><button data-testid="like"><span>1.2K</span></button>`,
        ),
      ),
      "for-you",
      "run",
    )!;
    expect(p).toMatchObject({
      reply: true,
      reposter: "Someone",
      promoted: true,
      truncated: true,
      likes: 1200,
    });
  });
  it("keeps unknown counts and missing text honest", () => {
    expect(extract(fixture(card("100", "")), "following", "run")).toMatchObject(
      { mediaOnly: true, likes: null },
    );
    expect(engagement("unknown")).toBeNull();
  });
  it("rejects malformed IDs and non-X links", () => {
    expect(
      extract(fixture(card("not-a-number")), "following", "run"),
    ).toBeNull();
    expect(canonical("https://evil.example/a/status/1")).toBeNull();
    expect(isHome("https://x.com/messages")).toBe(false);
  });
  it("waits for outgoing DOM removal even after tab selection changes", () => {
    fixture(
      `<button role="tab" aria-selected="true">For you</button>${card()}`,
    );
    const old = [document.querySelector("article")!];
    expect(selected(document, "for-you")).toBe(true);
    expect(transitionSafe(old, document, "for-you")).toBe(false);
    old[0].remove();
    document.body.insertAdjacentHTML("beforeend", card("200"));
    expect(transitionSafe(old, document, "for-you")).toBe(true);
  });
  it("does not guess localized tabs by index", () => {
    fixture(
      '<button role="tab">Para ti</button><button role="tab">Siguiendo</button>',
    );
    expect(feedTab(document, "for-you")).toBeNull();
  });
  it("detects login walls and challenges without interacting", () => {
    fixture('<div role="dialog">Verify you are human</div>');
    expect(barrier(document, "https://x.com/home")).toMatch(/challenge/i);
  });
  it("deduplicates across feeds and retains both observations", () => {
    const p = post();
    const q = post("100", {
      observations: [{ runId: "run", feed: "for-you", at: Date.now() }],
    });
    const merged = mergePost(p, q);
    expect(merged.observations).toHaveLength(2);
    expect(mergePost(merged, q).observations).toHaveLength(2);
  });
  it("validates payload types and canonical identity", () => {
    expect(validatePost(post())).toBe(true);
    expect(validatePost({ ...post(), handle: "other" })).toBe(false);
    expect(validatePost({ ...post(), text: "x".repeat(13000) })).toBe(false);
  });
});
describe("basic ranking and selection", () => {
  it("keeps all collected posts including negative feedback, media-only and ads", () => {
    const posts = [
      post("1", { text: "Cooking is an interesting topic to learn about." }),
      post("2", { promoted: true }),
      post("3", { mediaOnly: true }),
      post("4"),
    ];
    expect(
      scoreBasic(posts, defaults, [
        { id: "4", value: "not-useful", handle: "example" },
      ]),
    ).toHaveLength(4);
  });
  it("is deterministic, preserves distinct IDs with identical text and labels excerpts", () => {
    const p = post();
    expect(scoreBasic([p, post("2")], defaults, [], 123)).toHaveLength(2);
    expect(scoreBasic([p], defaults, [], 123)).toEqual(
      scoreBasic([p], defaults, [], 123),
    );
    expect(
      scoreBasic([post("3", { truncated: true })], defaults, [])[0].flags[0],
    ).toMatch(/Excerpt/);
  });
  it("keeps more than ten posts regardless of author or AI score", () => {
    const ps = Array.from({ length: 15 }, (_, i) =>
      post(String(i + 1), {
        handle: i < 5 ? "same" : "writer" + i,
        text: Array.from({ length: 12 }, (_, j) => `topic${i}word${j}`).join(
          " ",
        ),
        observations: [
          { runId: "run", feed: i === 14 ? "for-you" : "following", at: 0 },
        ],
      }),
    );
    const ranked = ps.map((p, i) => ({
      id: p.id,
      score: i === 0 ? 0 : 100 - i,
      takeaway: "text",
      reason: "reason",
      flags: [],
      mode: "basic" as const,
    }));
    const selected = allPostItems(ps, defaults, ranked);
    expect(selected).toHaveLength(15);
    expect(selected.some((p) => p.id === "15")).toBe(true);
    expect(selected.filter((r) => Number(r.id) <= 5)).toHaveLength(5);
  });
  it("ranks unanalysed posts from authors marked useful first", () => {
    const ps = [
      post("1", { handle: "other", url: "https://x.com/other/status/1" }),
      post("2", { handle: "liked", url: "https://x.com/liked/status/2" }),
    ];
    expect(allPostItems(ps, defaults).map((item) => item.id)).toEqual([
      "1",
      "2",
    ]);
    expect(
      allPostItems(
        ps,
        defaults,
        [],
        [{ id: "2", value: "useful", handle: "Liked" }],
      ).map((item) => item.id),
    ).toEqual(["2", "1"]);
  });
});
describe("hostile model output and pricing", () => {
  it("validates IDs, numeric ranges and bounded output", () => {
    const item = {
      id: "c0",
      score: 80,
      takeaway: "<img src=x onerror=alert(1)>",
      reason: "Reason",
      flags: [],
    };
    expect(
      validateOutput(JSON.stringify({ items: [item] }), [post()])[0].takeaway,
    ).toContain("<img");
    // Oversized optional text is dropped instead of rejecting the batch.
    expect(
      validateOutput(
        JSON.stringify({ items: [{ ...item, flags: ["x".repeat(101)] }] }),
        [post()],
      )[0].flags,
    ).toEqual([]);
    for (const patch of [{ id: "made-up" }, { score: 101 }])
      expect(() =>
        validateOutput(JSON.stringify({ items: [{ ...item, ...patch }] }), [
          post(),
        ]),
      ).toThrow();
    expect(() => validateOutput("not json", [post()])).toThrow();
  });
  it("does not send handles, URLs, engagement or credentials as fields", () => {
    const prompt = makePrompt([post()], defaults);
    expect(prompt).not.toContain("https://x.com/");
    expect(prompt).not.toContain("Example Author");
    expect(prompt).toContain("c0");
    expect(prompt).not.toContain("likes");
  });
  it("fails closed on missing or changed free pricing", () => {
    expect(
      isFree({
        id: "a",
        name: "a",
        pricing: { prompt: "0", completion: "0", request: "0" },
      }),
    ).toBe(true);
    for (const pricing of [
      { prompt: "0" },
      { prompt: "0", completion: "0.1" },
      { prompt: "0", completion: null },
      { prompt: "", completion: "0" },
      { prompt: "0", completion: "0", image: "1" },
    ])
      expect(
        isFree({
          id: "a",
          name: "a",
          pricing: pricing as Record<string, string | null>,
        }),
      ).toBe(false);
  });
  it("validates sampling limits", () => {
    expect(() =>
      validateSettings({ ...defaults, maxPosts: 1000, maxSteps: 100 }),
    ).not.toThrow();
    expect(() => validateSettings({ ...defaults, maxPosts: 1001 })).toThrow();
    expect(() => validateSettings({ ...defaults, maxSteps: 101 })).toThrow();
  });
});

describe("digest sorting", () => {
  it("orders dates, comments and likes with missing values last", () => {
    const posts = [
      post("100", { publishedAt: null, comments: undefined, likes: null }),
      post("200", { publishedAt: 2000, comments: 0, likes: 100 }),
      post("300", { publishedAt: 1000, comments: 12, likes: 2, pinned: true }),
    ];
    const items = posts.map((p, i) => ({
      id: p.id,
      score: 10 + i,
      takeaway: "",
      reason: "",
      flags: [],
      mode: "basic" as const,
    }));
    const ids = (sort: Parameters<typeof sortDigest>[2]) =>
      sortDigest(items, posts, sort).map((item) => item.id);
    expect(ids("newest")).toEqual(["200", "300", "100"]);
    expect(ids("oldest")).toEqual(["300", "200", "100"]);
    expect(ids("comments")).toEqual(["300", "200", "100"]);
    expect(ids("likes")).toEqual(["200", "300", "100"]);
    expect(items.map((item) => item.id)).toEqual(["100", "200", "300"]);
  });
});

it("validates AI sector/tone labels and drops invented categories", () => {
  const item = {
    id: "c0",
    score: 80,
    takeaway: "Text",
    reason: "Reason",
    flags: [],
    sectors: ["finance", "health"],
    tones: ["humour"],
  };
  expect(
    validateOutput(JSON.stringify({ items: [item] }), [post()])[0],
  ).toMatchObject({ sectors: ["finance", "health"], tones: ["humour"] });
  expect(
    validateOutput(
      JSON.stringify({
        items: [{ ...item, tones: ["invented", "humour"], sectors: "finance" }],
      }),
      [post()],
    )[0],
  ).toMatchObject({ score: 80, sectors: [], tones: ["humour"] });
  expect(
    validatePost(
      post("100", { links: [{ url: "javascript:alert(1)", source: "post" }] }),
    ),
  ).toBe(false);
});

it("sorts AI insight scores descending, including zero, before unanalysed posts", () => {
  const items = [
    {
      id: "1",
      score: 100,
      mode: "basic" as const,
      takeaway: "",
      reason: "",
      flags: [],
    },
    {
      id: "2",
      score: 0,
      mode: "ai" as const,
      takeaway: "",
      reason: "",
      flags: [],
    },
    {
      id: "3",
      score: 90,
      mode: "ai" as const,
      takeaway: "",
      reason: "",
      flags: [],
    },
  ];
  expect(
    sortDigest(items, [post("1"), post("2"), post("3")], "insight").map(
      (i) => i.id,
    ),
  ).toEqual(["3", "2", "1"]);
});

it("accepts compact AI metadata without generated explanations", () => {
  const result = validateOutput(
    JSON.stringify({
      items: [
        { id: "c0", score: 82, sectors: ["finance"], tones: ["analytical"] },
      ],
    }),
    [post()],
  );
  expect(result[0]).toMatchObject({
    score: 82,
    sectors: ["finance"],
    tones: ["analytical"],
    takeaway: "",
    reason: "",
    flags: [],
  });
  const prompt = makePrompt([post()], defaults);
  expect(prompt).not.toContain('"takeaway":');
  expect(prompt).not.toContain('"reason":');
});

it("validates buy/sell metadata without inventing assets and distinguishes unchecked posts", () => {
  const p = post("100", { text: "Buy BTC; sell TSLA. Consider gold." });
  const item = { id: "c0", score: 80, sectors: ["finance"], tones: [] };
  const recommendations = [
    { action: "buy", asset: "BTC", kind: "crypto" },
    { action: "sell", asset: "TSLA", kind: "stock" },
  ];
  const parse = (extra: object) =>
    validateOutput(JSON.stringify({ items: [{ ...item, ...extra }] }), [p])[0];
  expect(parse({ recommendations }).recommendations).toEqual(recommendations);
  expect(parse({ recommendations: [] }).recommendations).toEqual([]);
  // Missing recommendations mean unchecked, so the post stays pending.
  expect(parse({}).recommendations).toBeUndefined();
  expect(parse({ recommendations: "none" }).recommendations).toEqual([]);
  const example = makePrompt([p], defaults)
    .split("Return JSON only: ")[1]
    .split(". Scores")[0];
  expect(JSON.parse(example).items[0]).toHaveProperty("recommendations");
  // Invalid or invented recommendations are dropped; valid ones are kept.
  for (const rec of [
    { action: "hold", asset: "BTC", kind: "crypto" },
    { action: "buy", asset: "NVDA", kind: "stock" },
    { action: "buy", asset: "BTC", kind: "made-up" },
  ])
    expect(
      parse({ recommendations: [rec, recommendations[0]] }).recommendations,
    ).toEqual([recommendations[0]]);
  // Structural errors still reject the batch.
  expect(() =>
    validateOutput(JSON.stringify({ items: [{ ...item, score: 101 }] }), [p]),
  ).toThrow("Invalid result schema");
});

describe("signed-in account", () => {
  it("reads the handle from the full side menu, the collapsed avatar or the profile link", () => {
    document.body.innerHTML =
      '<button data-testid="SideNav_AccountSwitcher_Button">Name @Full_Name</button>';
    expect(account(document)).toBe("@full_name");
    document.body.innerHTML =
      '<button data-testid="SideNav_AccountSwitcher_Button"><div data-testid="UserAvatar-Container-Icon_Only"></div></button>';
    expect(account(document)).toBe("@icon_only");
    document.body.innerHTML =
      '<nav><a data-testid="AppTabBar_Profile_Link" href="/profile_link">Profile</a></nav>';
    expect(account(document)).toBe("@profile_link");
    document.body.innerHTML =
      '<a data-testid="AppTabBar_Profile_Link" href="/someone/status/1">Profile</a><div data-testid="UserAvatar-Container-author"></div>';
    expect(account(document)).toBeNull();
  });
});
