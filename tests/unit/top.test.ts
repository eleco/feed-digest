import { describe, it, expect } from "vitest";
import {
  buzz,
  linkKind,
  pickValue,
  fallbackPicks,
  feedbackExamples,
  makeEditorPrompt,
  shortlist,
  validateEditor,
} from "../../src/ranking/top";
import { makePrompt, validateOutput } from "../../src/ranking/prompt";
import { defaults, type Ranked } from "../../src/shared/types";
import { post } from "../fixtures/data";

const ai = (id: string, score: number, relevance?: number): Ranked => ({
  id,
  score,
  ...(relevance === undefined ? {} : { relevance }),
  takeaway: "",
  reason: "",
  flags: [],
  mode: "ai",
  recommendations: [],
});

describe("top 20 shortlist", () => {
  const settings = { ...defaults, priorities: "AI engineering" };
  it("ranks by relevance and insight, nudged by feedback and reach", () => {
    const posts = [
      post("1", { handle: "deep" }),
      post("2", { handle: "relevant" }),
      post("3", { handle: "liked" }),
      post("4", { handle: "disliked" }),
      post("5", { handle: "viral", views: 50000, followers: 1000 }),
    ];
    const results = [
      ai("1", 90, 10), // insightful but off-topic: 0.6*10 + 0.4*90 = 42
      ai("2", 50, 90), // on-topic: 74
      ai("3", 40, 40), // 40 + 8 for a useful author
      ai("4", 55, 55), // 55 - 15 for a not-useful author
      ai("5", 40, 40), // 40 + 5 for reach
    ];
    const feedback = [
      { id: "x", value: "useful" as const, handle: "liked" },
      { id: "y", value: "not-useful" as const, handle: "disliked" },
    ];
    expect(
      shortlist(posts, results, feedback, settings).map((c) => c.post.id),
    ).toEqual(["2", "3", "5", "1", "4"]);
  });
  it("uses insight alone without priorities, and skips ads, rejected and unscored posts", () => {
    const posts = [
      post("1"),
      post("2", { promoted: true }),
      post("3"),
      post("4"),
      post("5", { text: "", mediaOnly: true }),
    ];
    const results = [ai("1", 30, 99), ai("2", 99), ai("3", 80), ai("5", 99)];
    const feedback = [
      { id: "3", value: "not-useful" as const, handle: "someone-else" },
    ];
    expect(
      shortlist(posts, results, feedback, defaults).map((c) => c.post.id),
    ).toEqual(["1"]);
  });
});

describe("most interesting, without priorities", () => {
  it("fills half the shortlist by depth and half by unusual attention", () => {
    const posts = [
      post("deep1", { likes: 1 }),
      post("deep2", { likes: 2 }),
      post("deep3", { likes: 3 }),
      post("news", { likes: 9000 }),
      post("joke", { likes: 50, views: 400000, followers: 2000 }),
      post("quiet", { likes: 0 }),
    ];
    const results = [
      ai("deep1", 90),
      ai("deep2", 85),
      ai("deep3", 80),
      ai("news", 15), // a one-line headline: low insight, lots of attention
      ai("joke", 10), // read far beyond the author's following
      ai("quiet", 5),
    ];
    // Four places: two by insight, two by attention, in insight order (the
    // joke's reach bonus ties it with the headline; ties go by ID).
    expect(
      shortlist(posts, results, [], defaults, 4).map((c) => c.post.id),
    ).toEqual(["deep1", "deep2", "joke", "news"]);
    // With priorities the shortlist stays relevance and insight only.
    expect(
      shortlist(
        posts,
        results.map((r) => ({ ...r, relevance: r.score })),
        [],
        { ...defaults, priorities: "anything" },
        4,
      ).map((c) => c.post.id),
    ).toEqual(["deep1", "deep2", "deep3", "joke"]);
  });
  it("measures attention by reach beyond followers or likes percentile", () => {
    const ranks = new Map([["a", 40]]);
    expect(buzz(post("a", { views: 100, followers: 100 }), ranks)).toBe(50);
    expect(buzz(post("a", { views: 10000, followers: 100 }), ranks)).toBe(100);
    expect(buzz(post("a"), ranks)).toBe(40);
    expect(buzz(post("b"), ranks)).toBe(0);
  });
  it("asks the editor for the most interesting posts", () => {
    const prompt = makeEditorPrompt(
      [{ post: post("1"), ranked: ai("1", 50), value: 50 }],
      defaults,
      { useful: [], notUseful: [] },
    );
    expect(prompt).toContain("they want the most interesting posts");
    expect(prompt).toContain("important news worth knowing");
    expect(prompt).not.toContain("readerPriorities");
  });
});

describe("top 20 editor", () => {
  const candidates = ["10", "20", "30", "40"].map((id, i) => ({
    post: post(id, { handle: "h" + id, text: "Post " + id }),
    ranked: ai(id, 80 - i, 50),
    value: 80 - i,
  }));
  it("sends priorities, feedback examples and scores as data", () => {
    const prompt = makeEditorPrompt(
      candidates,
      { ...defaults, priorities: "AI engineering; skip politics" },
      { useful: ["A useful example"], notUseful: ["A bait example"] },
    );
    const data = JSON.parse(
      prompt.split("UNTRUSTED_DATA_JSON\n")[1].split("\nEND_DATA")[0],
    );
    expect(data.readerPriorities).toBe("AI engineering; skip politics");
    expect(data.markedUseful).toEqual(["A useful example"]);
    expect(data.markedNotUseful).toEqual(["A bait example"]);
    expect(data.posts[0]).toMatchObject({
      id: "c0",
      author: "@h10",
      text: "Post 10",
      insight: 80,
      relevance: 50,
    });
    expect(prompt).toContain("Group posts about the same story");
  });
  it("maps picks back to post IDs and drops invented or repeated IDs", () => {
    const picks = validateEditor(
      "```json\n" +
        JSON.stringify({
          picks: [
            {
              id: "c2",
              why: "  Explains   the method. ",
              similar: ["c0", "c9", "c2"],
            },
            { id: "c0", why: "Duplicate of a similar post" },
            { id: "c7", why: "Invented" },
            { id: "c1", why: 5, similar: "c3" },
          ],
        }) +
        "\n```",
      candidates,
    );
    expect(picks).toEqual([
      { id: "30", why: "Explains the method.", similar: ["10"] },
      { id: "20", why: "", similar: [] },
    ]);
  });
  it("rejects output without any valid pick", () => {
    expect(() => validateEditor("not json", candidates)).toThrow(/malformed/);
    expect(() =>
      validateEditor(JSON.stringify({ picks: [{ id: "c9" }] }), candidates),
    ).toThrow(/no valid picks/);
  });
  it("falls back to the top of the shortlist", () => {
    expect(fallbackPicks(candidates).map((p) => p.id)).toEqual([
      "10",
      "20",
      "30",
      "40",
    ]);
  });
  it("uses the most recent feedback that still has a stored post", () => {
    const examples = feedbackExamples(
      [post("1", { text: "Kept" }), post("2", { text: "Dropped" })],
      [
        { id: "1", value: "useful", handle: "a" },
        { id: "gone", value: "useful", handle: "b" },
        { id: "2", value: "not-useful", handle: "c" },
      ],
    );
    expect(examples).toEqual({ useful: ["Kept"], notUseful: ["Dropped"] });
  });
});

describe("relevance scoring", () => {
  it("asks for relevance only when priorities are set", () => {
    const plain = makePrompt([post("1")], defaults);
    expect(plain).not.toContain('"relevance"');
    expect(plain).not.toContain("READER_PRIORITIES_JSON");
    const prompt = makePrompt([post("1")], {
      ...defaults,
      priorities: "AI engineering",
    });
    expect(prompt).toContain('"relevance":0');
    expect(prompt).toContain('READER_PRIORITIES_JSON "AI engineering"');
  });
  it("keeps a valid relevance and ignores an invalid one", () => {
    const parse = (relevance: unknown) =>
      validateOutput(
        JSON.stringify({
          items: [
            {
              id: "c0",
              score: 50,
              relevance,
              sectors: [],
              tones: [],
              recommendations: [],
            },
          ],
        }),
        [post("1")],
      )[0].relevance;
    expect(parse(72)).toBe(72);
    expect(parse(140)).toBeUndefined();
    expect(parse("high")).toBeUndefined();
  });
});

describe("documents and videos", () => {
  const withLinks = (...urls: string[]) =>
    post("1", { links: urls.map((url) => ({ url, source: "post" as const })) });
  it("classifies what a post points to", () => {
    expect(linkKind(withLinks("https://example.com/report"))).toBe("document");
    expect(linkKind(withLinks("https://arxiv.org/pdf/2401.00001.pdf"))).toBe(
      "document",
    );
    expect(linkKind(withLinks("https://www.youtube.com/watch?v=abc"))).toBe(
      "video",
    );
    expect(linkKind(withLinks("https://youtu.be/abc"))).toBe("video");
    expect(linkKind(withLinks("https://cdn.example.com/clip.mp4"))).toBe(
      "video",
    );
    expect(linkKind(withLinks("https://x.com/someone/status/1/video/1"))).toBe(
      "video",
    );
    // A video anywhere outweighs a document link.
    expect(
      linkKind(
        withLinks("https://example.com/report", "https://vimeo.com/123"),
      ),
    ).toBe("video");
    expect(linkKind(post("1", { video: true }))).toBe("video");
    // Other X posts and unresolved short links say nothing.
    expect(linkKind(withLinks("https://x.com/someone/status/1"))).toBeNull();
    expect(linkKind(withLinks("https://t.co/abc"))).toBeNull();
    expect(linkKind(post("1"))).toBeNull();
  });
  it("nudges documents up and videos down", () => {
    const value = (p: ReturnType<typeof post>) =>
      pickValue(p, ai(p.id, 50), defaults, new Set(), new Set());
    expect(value(post("1"))).toBe(50);
    expect(value(withLinks("https://example.com/report"))).toBe(56);
    expect(value(withLinks("https://youtu.be/abc"))).toBe(42);
    expect(value(post("1", { video: true }))).toBe(42);
  });
  it("tells the editor what each post links to", () => {
    const prompt = makeEditorPrompt(
      [
        {
          post: withLinks("https://example.com/report"),
          ranked: ai("1", 50),
          value: 56,
        },
      ],
      defaults,
      { useful: [], notUseful: [] },
    );
    expect(prompt).toContain('"links":"document"');
    expect(prompt).toContain('slightly prefer "document"');
  });
});
