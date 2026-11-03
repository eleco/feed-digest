import type { Provider } from "../shared/types";
import type { AIUsage } from "../shared/audit";
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
// Standard text rates per million tokens, verified against the linked official pages.
const rates: Record<string, [number, number, number, string]> = {
  "anthropic:claude-haiku-4-5-20251001": [
    1,
    5,
    0.1,
    "https://platform.claude.com/docs/en/about-claude/pricing",
  ],
  "openai:gpt-4.1-mini": [
    0.4,
    1.6,
    0.1,
    "https://developers.openai.com/api/docs/models/gpt-4.1-mini",
  ],
  "openai:gpt-4.1-nano": [
    0.1,
    0.4,
    0.025,
    "https://developers.openai.com/api/docs/models/gpt-4.1-nano",
  ],
};
export function readUsage(
  provider: Provider,
  model: string,
  raw: Record<string, any>,
): AIUsage {
  const anthropic = provider === "anthropic";
  let input = count(anthropic ? raw.input_tokens : raw.prompt_tokens);
  const output = count(anthropic ? raw.output_tokens : raw.completion_tokens);
  const cachedInput =
    count(
      anthropic
        ? raw.cache_read_input_tokens
        : raw.prompt_tokens_details?.cached_tokens,
    ) ?? 0;
  const writes = anthropic ? (count(raw.cache_creation_input_tokens) ?? 0) : 0;
  if (anthropic && input !== null) input += cachedInput + writes;
  const usage: AIUsage = {
    input,
    output,
    cachedInput,
    cost: null,
    costKind: "unavailable",
  };
  if (
    provider === "openrouter" &&
    typeof raw.cost === "number" &&
    Number.isFinite(raw.cost) &&
    raw.cost >= 0
  ) {
    usage.cost = raw.cost;
    usage.costKind = "reported";
  } else if (
    input !== null &&
    output !== null &&
    cachedInput <= input &&
    writes === 0
  ) {
    const rate = rates[provider + ":" + model];
    if (rate) {
      usage.cost =
        ((input - cachedInput) * rate[0] +
          output * rate[1] +
          cachedInput * rate[2]) /
        1e6;
      usage.costKind = "estimated";
      usage.pricingSource = rate[3];
      usage.pricingDate = "2026-09-27";
    } else if (provider === "openrouter") {
      // generate() verifies all catalogue prices are zero immediately before calling.
      usage.cost = 0;
      usage.costKind = "estimated";
    }
  }
  return usage;
}
