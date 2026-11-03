import { CLAUDE_MODEL, connection } from "../../src/ranking/providers";
// @vitest-environment node
import "fake-indexeddb/auto";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { clearDatabase, all, put, get } from "../../src/storage/db";
import { rankRun } from "../../src/ranking/engine";
import { defaults, type Digest, type Run } from "../../src/shared/types";
import { post, run } from "../fixtures/data";
const fetchMock = vi.fn();
let storedKey: string | undefined = "fixture-key";
beforeEach(async () => {
  await clearDatabase();
  storedKey = "fixture-key";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.stubGlobal("chrome", {
    storage: {
      session: {
        get: async () => ({
          "key:openrouter": storedKey,
          "key:anthropic": storedKey,
        }),
      },
      local: { get: async () => ({}) },
    },
    permissions: { contains: async () => true },
  });
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        _name: unknown,
        _options: unknown,
        fn: (lock: unknown) => Promise<void>,
      ) => fn({}),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
const catalog = (price = "0") =>
  new Response(
    JSON.stringify({
      data: [
        {
          id: "fixture/free",
          name: "Fixture",
          pricing: { prompt: price, completion: "0", request: "0" },
        },
      ],
    }),
    { status: 200 },
  );
async function seed(count = 1) {
  const posts = Array.from({ length: count }, (_, i) =>
    post(String(i + 100), {
      text: Array.from({ length: 15 }, (_, j) => `idea${i}detail${j}`).join(
        " ",
      ),
    }),
  );
  for (const p of posts) await put("posts", p);
  await put(
    "runs",
    run({
      postIds: posts.map((p) => p.id),
      settings: {
        ...defaults,
        provider: "openrouter",
        enabled: true,
        model: "fixture/free",
        inputTokens: 16000,
      },
    }),
  );
}
it("makes no requests when session key is missing after restart", async () => {
  await seed();
  storedKey = undefined;
  await rankRun("run", new AbortController().signal);
  expect(fetchMock).not.toHaveBeenCalled();
  expect((await get<Digest>("digests", "run"))?.mode).toContain("Basic");
});
const noPause = vi.fn(async (_ms: number, _signal: AbortSignal) => {});
it("retries a 429 three times after Retry-After, then falls back without switching providers", async () => {
  await seed();
  noPause.mockClear();
  fetchMock.mockImplementation(async (url: string) =>
    url.endsWith("/models")
      ? catalog()
      : new Response("", { status: 429, headers: { "Retry-After": "20" } }),
  );
  await rankRun("run", new AbortController().signal, noPause);
  expect(
    fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/chat/completions"),
    ),
  ).toHaveLength(3);
  expect(noPause.mock.calls.map(([ms]) => ms)).toEqual([20000, 20000]);
  expect((await get<Run>("runs", "run"))!.requests).toBe(3);
  expect(
    fetchMock.mock.calls.every(([url]) =>
      String(url).startsWith("https://openrouter.ai/"),
    ),
  ).toBe(true);
  expect((await get<Digest>("digests", "run"))?.notices.join(" ")).toContain(
    "429",
  );
  expect((await all("posts")).length).toBe(1);
});
it("changed free pricing prevents generation", async () => {
  await seed();
  fetchMock.mockResolvedValue(catalog("0.01"));
  await rankRun("run", new AbortController().signal);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect((await get<Digest>("digests", "run"))?.notices.join(" ")).toContain(
    "pricing changed",
  );
});
it("keeps a valid AI batch when the next batch returns invented IDs", async () => {
  await seed(11);
  let generations = 0;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/models")) return catalog();
    generations++;
    const body = JSON.parse(String(init?.body));
    expect(body.provider.allow_fallbacks).toBe(false);
    expect(body.provider.max_price.prompt).toBe(0);
    expect(body).not.toHaveProperty("tools");
    expect(body.messages[0].content).not.toContain("fixture-key");
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                items: [
                  {
                    id: generations === 1 ? "c0" : "fake",
                    score: 90,
                    recommendations: [],
                    takeaway: "A synthetic takeaway",
                    reason: "Concrete details",
                    flags: [],
                  },
                ],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
    );
  });
  await rankRun("run", new AbortController().signal);
  const digest = await get<Digest>("digests", "run");
  expect(generations).toBe(2);
  expect(digest?.items).toHaveLength(11);
  expect(digest?.mode).toContain("Mixed");
  expect(digest?.items.some((i) => i.mode === "ai")).toBe(true);
  expect(digest?.items.every((i) => i.id !== "fake")).toBe(true);
  expect((await all("cache")).length).toBe(1);
  const audit = (await get<Run>("runs", "run"))!.aiAudit!;
  expect(audit.posts).toHaveLength(11);
  expect(audit.attempts.map((a) => a.status)).toEqual(["success", "error"]);
  expect(audit.attempts[1].usage).toMatchObject({ input: 100, output: 20 });
  expect(digest?.tokens).toBe(240);
  expect(JSON.stringify(audit)).not.toContain("fixture-key");
});
it("cancelled generation cannot repopulate deleted cache or digests", async () => {
  await seed();
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/models")) return catalog();
    await clearDatabase();
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                items: [
                  {
                    id: "c0",
                    score: 90,
                    recommendations: [],
                    takeaway: "text",
                    reason: "reason",
                    flags: [],
                  },
                ],
              }),
            },
          },
        ],
      }),
    );
  });
  await rankRun("run", new AbortController().signal);
  expect(await all("cache")).toEqual([]);
  expect(await all("digests")).toEqual([]);
});

it("reuses an unchanged batch cache without a new generation request", async () => {
  await seed();
  fetchMock.mockImplementation(async (url: string) =>
    url.endsWith("/models")
      ? catalog()
      : new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    items: [
                      {
                        id: "c0",
                        score: 90,
                        recommendations: [],
                        takeaway: "Takeaway",
                        reason: "Specificity",
                        flags: [],
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        ),
  );
  await rankRun("run", new AbortController().signal);
  const count = fetchMock.mock.calls.length;
  await seed();
  await rankRun("run", new AbortController().signal);
  expect(fetchMock).toHaveBeenCalledTimes(count);
  expect((await get<Digest>("digests", "run"))?.items[0].mode).toBe("ai");
});

it("Basic mode never calls a provider even if a key exists", async () => {
  await seed();
  await put("runs", run({ settings: { ...defaults, provider: "basic" } }));
  await rankRun("run", new AbortController().signal);
  expect(fetchMock).not.toHaveBeenCalled();
});

function mockAssessment() {
  fetchMock.mockImplementation(async (url: string) =>
    url.endsWith("/models")
      ? catalog()
      : new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    items: [
                      {
                        id: "c0",
                        score: 90,
                        recommendations: [],
                        takeaway: "Cached takeaway",
                        reason: "Specific",
                        flags: [],
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        ),
  );
}
const generationCalls = () =>
  fetchMock.mock.calls.filter(([url]) => !url.endsWith("/models"));

it("reuses individual posts when a later scan adds posts to the batch", async () => {
  mockAssessment();
  await seed();
  await rankRun("run", new AbortController().signal);
  await seed(2);
  await rankRun("run", new AbortController().signal);
  const calls = generationCalls();
  expect(calls).toHaveLength(2);
  expect(calls[1][1].body).toContain("idea1detail0");
  expect(calls[1][1].body).not.toContain("idea0detail0");
  const digest = await get<Digest>("digests", "run");
  expect(digest?.notices).toContain(
    "Reused cached AI analysis for 1 unchanged post.",
  );
  expect(
    digest?.items
      .filter((i) => i.mode === "ai")
      .map((i) => i.id)
      .sort(),
  ).toEqual(["100", "101"]);
});

it.each(["text", "quotedText", "truncated", "expired", "corrupt"])(
  "invalidates cached analysis after %s changes",
  async (change) => {
    mockAssessment();
    await seed();
    await rankRun("run", new AbortController().signal);
    await seed();
    if (["text", "quotedText", "truncated"].includes(change)) {
      const p = (await get<import("../../src/shared/types").Post>(
        "posts",
        "100",
      ))!;
      await put("posts", {
        ...p,
        [change]:
          change === "truncated"
            ? true
            : "Changed content with detailed explanation and practical examples.",
      });
    } else {
      const entry = (
        await all<{ id: string; at: number; content: string }>("cache")
      )[0];
      await put("cache", {
        ...entry,
        ...(change === "expired" ? { at: 0 } : { content: "invalid JSON" }),
      });
    }
    await rankRun("run", new AbortController().signal);
    expect(generationCalls()).toHaveLength(2);
  },
);

async function seedClaude() {
  await seed();
  const r = (await get<import("../../src/shared/types").Run>("runs", "run"))!;
  r.settings = {
    ...r.settings,
    provider: "anthropic",
    model: CLAUDE_MODEL,
  };
  await put("runs", r);
}
it("uses Anthropic Messages headers, validates labels, tracks token usage and reuses cache", async () => {
  await seedClaude();
  fetchMock.mockImplementation(async (url: string, options: RequestInit) => {
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(options.headers).toMatchObject({
      "x-api-key": "fixture-key",
      "anthropic-version": "2023-06-01",
    });
    const body = JSON.parse(options.body as string);
    expect(body.model).toBe(CLAUDE_MODEL);
    expect(body.response_format).toBeUndefined();
    expect(body.messages[0].content).not.toContain("fixture-key");
    return new Response(
      JSON.stringify({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              items: [
                {
                  id: "c0",
                  score: 90,
                  recommendations: [],
                  takeaway: "Text",
                  reason: "Reason",
                  flags: [],
                  sectors: ["finance"],
                  tones: ["humour"],
                },
              ],
            }),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    );
  });
  await rankRun("run", new AbortController().signal);
  const digest = await get<Digest>("digests", "run");
  expect(digest?.items[0]).toMatchObject({
    sectors: ["finance"],
    tones: ["humour"],
  });
  expect(digest?.tokens).toBe(120);
  expect(digest?.estimate).toBeUndefined();
  const audit = (await get<Run>("runs", "run"))!.aiAudit!;
  expect(audit.attempts[0].usage).toMatchObject({
    input: 100,
    output: 20,
    cost: 0.0002,
    costKind: "estimated",
  });
  expect(audit.posts[0]).toMatchObject({
    status: "analysed",
    selected: true,
    result: { sectors: ["finance"], tones: ["humour"] },
  });
  await seedClaude();
  await rankRun("run", new AbortController().signal);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const cached = (await get<Run>("runs", "run"))!.aiAudit!;
  expect(cached.attempts).toEqual([]);
  expect(cached.posts[0].status).toBe("cached");
});
it("enforces the daily request limit before calling Claude", async () => {
  await seedClaude();
  await put("meta", {
    id: "usage:" + new Date().toISOString().slice(0, 10),
    requests: defaults.requestsPerDay,
    tokens: 0,
  });
  await rankRun("run", new AbortController().signal);
  expect(fetchMock).not.toHaveBeenCalled();
  expect((await get<Digest>("digests", "run"))?.notices).toContain(
    "Request budget exhausted",
  );
});
it("checks Claude model access without a generation request", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ id: CLAUDE_MODEL })),
  );
  await connection("anthropic", "fixture-key", CLAUDE_MODEL);
  expect(fetchMock.mock.calls[0][0]).toBe(
    "https://api.anthropic.com/v1/models/" + CLAUDE_MODEL,
  );
  expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
});

it("keeps unknown usage on a failed request and records its failure", async () => {
  await seedClaude();
  fetchMock.mockResolvedValue(new Response("", { status: 401 }));
  await rankRun("run", new AbortController().signal);
  const audit = (await get<Run>("runs", "run"))!.aiAudit!;
  expect(audit.attempts[0]).toMatchObject({
    status: "error",
    error: "Provider HTTP 401",
  });
  expect(audit.attempts[0].usage).toBeUndefined();
  expect(audit.posts[0].status).toBe("error");
});

it("retries a server error and records both attempts without inventing usage", async () => {
  await seedClaude();
  noPause.mockClear();
  fetchMock
    .mockResolvedValueOnce(new Response("", { status: 503 }))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: JSON.stringify({ items: [] }) }],
          usage: { input_tokens: 10, output_tokens: 2 },
        }),
      ),
    );
  await rankRun("run", new AbortController().signal, noPause);
  const audit = (await get<Run>("runs", "run"))!.aiAudit!;
  expect(audit.attempts.map((a) => a.status)).toEqual(["error", "success"]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(noPause.mock.calls.map(([ms]) => ms)).toEqual([2000]);
  expect(audit.attempts[0].usage).toBeUndefined();
  expect(audit.attempts[1].usage).toMatchObject({ input: 10, output: 2 });
  expect(audit.posts[0].status).toBe("no-result");
});

it("stops on a rejected key without retrying or sending later batches", async () => {
  await seed(21);
  const r = (await get<Run>("runs", "run"))!;
  r.analysisOnly = true;
  r.settings.provider = "anthropic";
  r.settings.model = CLAUDE_MODEL;
  await put("runs", r);
  fetchMock.mockImplementation(async () => new Response("", { status: 401 }));
  await rankRun("run", new AbortController().signal, noPause);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const audit = (await get<Run>("runs", "run"))!.aiAudit!;
  expect(audit.posts.filter((p) => p.status === "error")).toHaveLength(10);
  expect(audit.posts.filter((p) => p.status === "skipped")).toHaveLength(11);
});

it("skips a batch with unusable output and analyses the later batches", async () => {
  await seed(21);
  const r = (await get<Run>("runs", "run"))!;
  r.analysisOnly = true;
  r.settings.provider = "anthropic";
  r.settings.model = CLAUDE_MODEL;
  await put("runs", r);
  let calls = 0;
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
    const payload = JSON.parse(
      JSON.parse(String(init.body))
        .messages[0].content.split("UNTRUSTED_DATA_JSON\n")[1]
        .split("\nEND_DATA")[0],
    );
    const text =
      ++calls === 1
        ? '{"items":['
        : JSON.stringify({
            items: payload.posts.map((p: { id: string }) => ({
              id: p.id,
              score: 80,
              sectors: [],
              tones: [],
              recommendations: [],
            })),
          });
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );
  });
  await rankRun("run", new AbortController().signal, noPause);
  expect(calls).toBe(3);
  const saved = (await get<Run>("runs", "run"))!;
  expect(saved.state).toBe("partial");
  expect(saved.aiAudit!.attempts.map((a) => a.status)).toEqual([
    "error",
    "success",
    "success",
  ]);
  expect(
    saved.aiAudit!.posts.filter((p) => p.status === "analysed"),
  ).toHaveLength(11);
  expect(saved.aiAudit!.posts.filter((p) => p.status === "error")).toHaveLength(
    10,
  );
  const digest = (await get<Digest>("digests", "run"))!;
  expect(digest.items.filter((p) => p.mode === "ai")).toHaveLength(11);
  expect(digest.notices.join(" ")).toContain(
    "10 posts could not be analysed: Provider returned malformed JSON",
  );
  expect(await all("cache")).toHaveLength(11);
});

it("preserves request history when ranking resumes after a page reload", async () => {
  await seedClaude();
  const r = (await get<Run>("runs", "run"))!;
  r.aiAudit = {
    version: 1,
    promptVersion: "5",
    updatedAt: Date.now(),
    collected: 1,
    posts: [],
    notices: [],
    attempts: [
      {
        number: 1,
        postIds: ["100"],
        startedAt: Date.now() - 1000,
        status: "running",
      },
    ],
  };
  await put("runs", r);
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        content: [{ type: "text", text: '{"items":[]}' }],
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
    ),
  );
  await rankRun("run", new AbortController().signal);
  const audit = (await get<Run>("runs", "run"))!.aiAudit!;
  expect(audit.attempts).toHaveLength(2);
  expect(audit.attempts[0]).toMatchObject({
    status: "error",
    error: "Interrupted before the response was recorded; outcome unknown",
  });
  expect(audit.attempts[1]).toMatchObject({ number: 2, status: "success" });
});

it("splits long post batches instead of skipping every post over the input limit", async () => {
  await seed(10);
  for (const p of await all<import("../../src/shared/types").Post>("posts"))
    await put("posts", {
      ...p,
      text: p.id + " detailed explanation".repeat(110),
    });
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/models")) return catalog();
    const prompt = JSON.parse(String(init?.body)).messages[0].content;
    expect(
      new TextEncoder().encode(prompt).byteLength + 512,
    ).toBeLessThanOrEqual(16000);
    const payload = JSON.parse(
      prompt.split("UNTRUSTED_DATA_JSON\n")[1].split("\nEND_DATA")[0],
    );
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                items: payload.posts.map((p: { id: string }) => ({
                  id: p.id,
                  score: 80,
                  recommendations: [],
                  takeaway: "Summary",
                  reason: "Specific explanation",
                  flags: [],
                  sectors: ["technology"],
                  tones: ["analytical"],
                })),
              }),
            },
          },
        ],
        usage: { prompt_tokens: 1000, completion_tokens: 200 },
      }),
    );
  });
  await rankRun("run", new AbortController().signal);
  expect(generationCalls().length).toBeGreaterThan(1);
  const digest = (await get<Digest>("digests", "run"))!;
  expect(digest.items.filter((p) => p.mode === "ai")).toHaveLength(10);
  expect(
    (await get<Run>("runs", "run"))!.aiAudit!.posts.every(
      (p) => p.status === "analysed",
    ),
  ).toBe(true);
});

it("manual analysis processes the full collection beyond old scan and daily request caps", async () => {
  await seed(61);
  const r = (await get<Run>("runs", "run"))!;
  r.analysisOnly = true;
  await put("runs", r);
  await put("meta", {
    id: "usage:" + new Date().toISOString().slice(0, 10),
    requests: 999,
    tokens: 0,
  });
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/models")) return catalog();
    const prompt = JSON.parse(String(init?.body)).messages[0].content;
    const payload = JSON.parse(
      prompt.split("UNTRUSTED_DATA_JSON\n")[1].split("\nEND_DATA")[0],
    );
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                items: payload.posts.map((p: { id: string }) => ({
                  id: p.id,
                  score: 80,
                  recommendations: [],
                  takeaway: "Summary",
                  reason: "Explanation",
                  flags: [],
                  sectors: ["technology"],
                  tones: ["analytical"],
                })),
              }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    );
  });
  await rankRun("run", new AbortController().signal);
  expect(generationCalls()).toHaveLength(7);
  const digest = (await get<Digest>("digests", "run"))!;
  expect(digest.items).toHaveLength(61);
  expect(digest.items.every((item) => item.mode === "ai")).toBe(true);
  expect((await get<Run>("runs", "run"))!.aiAudit!.posts).toHaveLength(61);
});

it.each(["fenced", "truncated", "malformed"])(
  "handles %s Claude output without retrying output errors and preserves accurate usage",
  async (format) => {
    await seed(10);
    const r = (await get<Run>("runs", "run"))!;
    r.analysisOnly = true;
    r.settings.provider = "anthropic";
    r.settings.model = CLAUDE_MODEL;
    await put("runs", r);
    let calls = 0;
    const sizes: number[] = [];
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      calls++;
      const body = JSON.parse(String(init.body));
      const payload = JSON.parse(
        body.messages[0].content
          .split("UNTRUSTED_DATA_JSON\n")[1]
          .split("\nEND_DATA")[0],
      );
      sizes.push(payload.posts.length);
      expect(body.max_tokens).toBeGreaterThanOrEqual(
        512 + payload.posts.length * 600,
      );
      const content = JSON.stringify({
        items: payload.posts.map((p: { id: string }) => ({
          id: p.id,
          score: 80,
          recommendations: [],
          takeaway: "Summary",
          reason: "Specific detail",
          flags: [],
          sectors: ["finance"],
          tones: ["analytical"],
        })),
      });
      const fail = calls === 1 && format !== "fenced";
      return new Response(
        JSON.stringify({
          stop_reason:
            fail && format === "truncated" ? "max_tokens" : "end_turn",
          content: [
            {
              type: "text",
              text: fail ? '{"items":[' : "```json\n" + content + "\n```",
            },
          ],
          usage: { input_tokens: 1177, output_tokens: 1172 },
        }),
      );
    });
    await rankRun("run", new AbortController().signal);
    const digest = (await get<Digest>("digests", "run"))!;
    const audit = (await get<Run>("runs", "run"))!.aiAudit!;
    expect(digest.items.filter((p) => p.mode === "ai")).toHaveLength(
      format === "fenced" ? 10 : 0,
    );
    expect(sizes).toEqual([10]);
    expect(audit.attempts).toHaveLength(calls);
    expect(digest.tokens).toBe(calls * (1177 + 1172));
    expect(audit.attempts.every((a) => a.usage?.cost === 0.007037)).toBe(true);
    if (format !== "fenced") expect(audit.attempts[0].status).toBe("error");
    expect(
      audit.posts.every(
        (p) => p.status === (format === "fenced" ? "analysed" : "error"),
      ),
    ).toBe(true);
  },
);

it("stops after three failed batches in a row and never caches incomplete JSON", async () => {
  await seed(41);
  const r = (await get<Run>("runs", "run"))!;
  r.analysisOnly = true;
  r.settings.provider = "anthropic";
  r.settings.model = CLAUDE_MODEL;
  await put("runs", r);
  fetchMock.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: '{"items":[' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      ),
  );
  await rankRun("run", new AbortController().signal, noPause);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(noPause).not.toHaveBeenCalled();
  expect(await all("cache")).toEqual([]);
  expect((await get<Run>("runs", "run"))!.state).toBe("partial");
  const digest = (await get<Digest>("digests", "run"))!;
  expect(digest.items).toHaveLength(41);
  expect(digest.notices.join(" ")).toContain(
    "Stopped after three batches in a row failed",
  );
  const audit = (await get<Run>("runs", "run"))!.aiAudit!;
  expect(audit.posts.filter((p) => p.status === "error")).toHaveLength(30);
  expect(audit.posts.filter((p) => p.status === "skipped")).toHaveLength(11);
});

it.each(["7", "9"])(
  "refreshes version %s classifications missing buy/sell tags",
  async (version) => {
    await seedClaude();
    const { hash } = await import("../../src/ranking/prompt");
    const p = (await all<import("../../src/shared/types").Post>("posts"))[0];
    const id =
      "post:" +
      (await hash(
        JSON.stringify([
          version,
          "anthropic",
          CLAUDE_MODEL,
          p.id,
          p.text,
          p.quotedText,
          p.truncated,
        ]),
      ));
    await put("cache", {
      id,
      at: Date.now(),
      content: JSON.stringify({
        items: [
          {
            id: "c0",
            score: 88,
            takeaway: "Legacy summary",
            reason: "Legacy explanation",
            flags: [],
            sectors: ["finance"],
            tones: ["analytical"],
          },
        ],
      }),
    });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                items: [
                  {
                    id: "c0",
                    score: 88,
                    sectors: ["finance"],
                    tones: [],
                    recommendations: [],
                  },
                ],
              }),
            },
          ],
        }),
      ),
    );
    await rankRun("run", new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await get<Digest>("digests", "run"))!.items[0]).toMatchObject({
      score: 88,
      sectors: ["finance"],
    });
    expect((await get<Run>("runs", "run"))!.aiAudit!.posts[0].status).toBe(
      "analysed",
    );
  },
);

it("keeps going when AI output omits buy/sell tags, without caching the incomplete result", async () => {
  await seedClaude();
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              items: [{ id: "c0", score: 80, sectors: ["finance"], tones: [] }],
            }),
          },
        ],
        usage: { input_tokens: 20, output_tokens: 10 },
      }),
    ),
  );
  await rankRun("run", new AbortController().signal);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await all("cache")).toEqual([]);
  const saved = (await get<Run>("runs", "run"))!;
  expect(saved.state).toBe("completed");
  expect(saved.aiAudit!.attempts[0].status).toBe("success");
  expect(saved.aiAudit!.posts[0]).toMatchObject({ status: "no-result" });
  expect(saved.aiAudit!.posts[0].note).toContain("stays pending");
  expect(saved.aiAudit!.attempts[0].usage?.input).toBe(20);
});
