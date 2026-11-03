import { expect, it } from "vitest";
import { readUsage } from "../../src/ranking/usage";
import { auditTotals, type AIAudit } from "../../src/shared/audit";
it("prices standard OpenAI usage including discounted cached input", () => {
  expect(
    readUsage("openai", "gpt-4.1-mini", {
      prompt_tokens: 1000,
      completion_tokens: 100,
      prompt_tokens_details: { cached_tokens: 500 },
    }),
  ).toMatchObject({
    input: 1000,
    output: 100,
    cachedInput: 500,
    cost: 0.00041,
    costKind: "estimated",
  });
});
it("counts Anthropic cache reads separately and leaves unsupported cache writes unpriced", () => {
  expect(
    readUsage("anthropic", "claude-haiku-4-5-20251001", {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 1000,
    }),
  ).toMatchObject({ input: 1100, output: 20, cost: 0.0003 });
  expect(
    readUsage("anthropic", "claude-haiku-4-5-20251001", {
      input_tokens: 100,
      output_tokens: 20,
      cache_creation_input_tokens: 1000,
    }).cost,
  ).toBeNull();
});
it("distinguishes missing or invalid usage from zero and does not guess unknown model prices", () => {
  expect(readUsage("openai", "gpt-4.1-nano", {})).toMatchObject({
    input: null,
    output: null,
    cost: null,
  });
  expect(
    readUsage("openai", "gpt-4.1-nano", {
      prompt_tokens: -10,
      completion_tokens: 2,
    }).cost,
  ).toBeNull();
  expect(
    readUsage("openai", "unknown", { prompt_tokens: 10, completion_tokens: 2 })
      .cost,
  ).toBeNull();
  expect(
    readUsage("openai", "gpt-4.1-nano", {
      prompt_tokens: 0,
      completion_tokens: 0,
    }).cost,
  ).toBe(0);
});
it("prefers reported costs and labels incomplete totals", () => {
  const usage = readUsage("openrouter", "fixture/free", { cost: 0.0123 });
  expect(usage).toMatchObject({
    cost: 0.0123,
    costKind: "reported",
    input: null,
  });
  const audit: AIAudit = {
    version: 1,
    promptVersion: "5",
    updatedAt: 1,
    collected: 0,
    posts: [],
    notices: [],
    attempts: [
      { number: 1, postIds: [], startedAt: 1, status: "error" },
      { number: 2, postIds: [], startedAt: 2, status: "success", usage },
    ],
  };
  expect(auditTotals(audit)).toMatchObject({
    cost: 0.0123,
    unknownCost: 1,
    unknownTokens: 2,
  });
});
