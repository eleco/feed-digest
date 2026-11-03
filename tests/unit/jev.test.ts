import { afterEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { topics, dailyThemes } from "../../src/shared/daily-themes";
import {
  analyseTheme,
  cachedTheme,
  checkJev,
  matchedThemes,
  validateThemeAnswers,
  JEV_MODEL,
} from "../../src/ranking/jev";
import { post } from "../fixtures/data";
vi.stubGlobal("indexedDB", new IDBFactory());
afterEach(() => vi.unstubAllGlobals());
const answers = () =>
  Object.fromEntries(
    topics.map(([id]) => [id, { type: "noul", noul: id === "ai" ? 0.9 : 0.1 }]),
  );
it("rejects missing, malformed and out of range probabilities", () => {
  expect(() => validateThemeAnswers({ answers: {} })).toThrow();
  expect(() =>
    validateThemeAnswers({
      answers: { ...answers(), ai: { type: "noul", noul: 2 } },
    }),
  ).toThrow();
  expect(matchedThemes(validateThemeAnswers({ answers: answers() }))).toEqual([
    "ai",
  ]);
});
it("checks models without sending a generation request", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: "jev-latest" }] })),
    );
  vi.stubGlobal("fetch", fetch);
  await checkJev("fixture-key", new AbortController().signal);
  expect(fetch.mock.calls[0][0]).toBe("https://api.typesafe.ai/v1/models");
  expect(fetch.mock.calls[0][1].method).toBe("GET");
});
it("saves complete assessments, reuses unchanged content, and invalidates changed content", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        model: JEV_MODEL,
        answers: answers(),
        usage: { input_tokens: 100 },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const p = post("881", {
    text: "Models learn from examples.",
    publishedAt: Date.now(),
  });
  const result = await analyseTheme(
    p,
    "fixture-key",
    new AbortController().signal,
  );
  expect(result.inputTokens).toBe(100);
  expect(await cachedTheme(p)).toEqual(result.assessment);
  expect(await cachedTheme({ ...p, text: "Changed" })).toBeUndefined();
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.model).toBe(JEV_MODEL);
  expect(Object.keys(body.questions)).toHaveLength(topics.length);
  expect(body.state.text).toBe(p.text);
  expect(
    dailyThemes([p], [], Date.now(), new Map([[p.id, ["ai"]]])).themes[0].id,
  ).toBe("ai");
  expect(
    dailyThemes([p], [], Date.now(), new Map([[p.id, []]])).themes[0].id,
  ).toBe("other");
});
it("reports HTTP failures without exposing credentials", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("", { status: 401 })),
  );
  await expect(
    checkJev("secret", new AbortController().signal),
  ).rejects.toThrow("Jev HTTP 401");
});

it("does not save results when analysis is cancelled", async () => {
  const controller = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => {
      controller.abort();
      return new Response(
        JSON.stringify({ model: JEV_MODEL, answers: answers() }),
      );
    }),
  );
  const p = post("cancelled-jev");
  await expect(
    analyseTheme(p, "fixture-key", controller.signal),
  ).rejects.toThrow();
  expect(await cachedTheme(p)).toBeUndefined();
});

it("loads thousands of saved theme results in one transaction and rejects stale content", async () => {
  const { db, put } = await import("../../src/storage/db");
  const { cachedThemes } = await import("../../src/ranking/jev");
  const posts = Array.from({ length: 3742 }, (_, i) => post(`bulk-${i}`));
  const assessment = {
    id: "jev-themes:bulk-0",
    at: Date.now(),
    version: "1",
    model: JEV_MODEL,
    content: JSON.stringify({
      text: posts[0].text.slice(0, 2200),
      quotedText: null,
    }),
    probabilities: Object.fromEntries(
      topics.map(([id]) => [id, id === "ai" ? 0.9 : 0.1]),
    ),
  };
  await put("cache", assessment);
  await put("cache", {
    ...assessment,
    id: "jev-themes:bulk-1",
    content: "old text",
  });
  await put("cache", { ...assessment, id: "jev-themes:bulk-2", at: 0 });
  await put("cache", {
    ...assessment,
    id: "jev-themes:bulk-3",
    probabilities: {},
  });
  const database = await db();
  const transactions = vi.spyOn(database, "transaction");
  try {
    const results = await cachedThemes(posts);
    expect([...results]).toEqual([["bulk-0", assessment]]);
    expect(transactions).toHaveBeenCalledTimes(1);
  } finally {
    transactions.mockRestore();
  }
});
