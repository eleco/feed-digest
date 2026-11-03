import type { AIUsage } from "../shared/audit";
import { readUsage } from "./usage";
import { ModelOutputError } from "./prompt";
import type { Provider, Settings } from "../shared/types";
export const origins = {
  openrouter: "https://openrouter.ai/*",
  openai: "https://api.openai.com/*",
  anthropic: "https://api.anthropic.com/*",
} as const;
export const CLAUDE_MODEL = "claude-haiku-4-5-20251001";
export const isPaid = (provider: Provider) =>
  provider === "openai" || provider === "anthropic";
const anthropicHeaders = (key: string) => ({
  "Content-Type": "application/json",
  "x-api-key": key,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
});
export interface Model {
  id: string;
  name: string;
  pricing: Record<string, string | number | null>;
}
export function isFree(m: Model) {
  const p = m.pricing;
  return (
    !!p &&
    ["prompt", "completion"].every(
      (k) =>
        p[k] !== undefined &&
        p[k] !== null &&
        String(p[k]).trim() !== "" &&
        Number(p[k]) === 0,
    ) &&
    Object.values(p).every(
      (v) =>
        v !== null &&
        String(v).trim() !== "" &&
        Number.isFinite(Number(v)) &&
        Number(v) === 0,
    )
  );
}
async function json(response: Response) {
  if (!response.ok) throw Error("Provider HTTP " + response.status);
  const text = await response.text();
  if (text.length > 4_000_000) throw Error("Provider response too large");
  try {
    return JSON.parse(text);
  } catch {
    throw Error("Invalid provider JSON");
  }
}
export async function catalogue(signal?: AbortSignal): Promise<Model[]> {
  const data = await json(
    await fetch("https://openrouter.ai/api/v1/models", {
      signal: signal ?? AbortSignal.timeout(15000),
      credentials: "omit",
      redirect: "error",
    }),
  );
  if (!Array.isArray(data.data)) throw Error("Invalid model catalogue");
  return data.data.filter((m: Model) => typeof m.id === "string" && isFree(m));
}
export async function connection(
  provider: Exclude<Provider, "basic">,
  key: string,
  model: string,
  signal: AbortSignal = AbortSignal.timeout(15000),
) {
  if (provider === "anthropic") {
    if (model !== CLAUDE_MODEL) throw Error("Unsupported Claude model");
    await json(
      await fetch(
        "https://api.anthropic.com/v1/models/" + encodeURIComponent(model),
        {
          headers: anthropicHeaders(key),
          signal,
          credentials: "omit",
          redirect: "error",
        },
      ),
    );
  } else if (provider === "openrouter") {
    if (!(await catalogue(signal)).some((m) => m.id === model))
      throw Error("Selected model is not currently free");
    await json(
      await fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${key}` },
        signal,
        credentials: "omit",
        redirect: "error",
      }),
    );
  } else {
    if (!["gpt-4.1-mini", "gpt-4.1-nano"].includes(model))
      throw Error("Unsupported text model");
    await json(
      await fetch(
        "https://api.openai.com/v1/models/" + encodeURIComponent(model),
        {
          headers: { Authorization: `Bearer ${key}` },
          signal,
          credentials: "omit",
          redirect: "error",
        },
      ),
    );
  }
}
export class ProviderError extends Error {
  constructor(
    public status: number,
    public retryAfter: number,
  ) {
    super("Provider HTTP " + status);
  }
}
export async function generate(
  s: Settings,
  key: string,
  prompt: string,
  signal: AbortSignal,
  onUsage?: (usage: AIUsage) => void,
) {
  const openrouter = s.provider === "openrouter";
  const anthropic = s.provider === "anthropic";
  if (!openrouter && !isPaid(s.provider))
    throw Error("Online provider required");
  if (openrouter && !(await catalogue(signal)).some((m) => m.id === s.model))
    throw Error("Free model unavailable or pricing changed");
  if (
    !openrouter &&
    !(anthropic
      ? s.model === CLAUDE_MODEL
      : ["gpt-4.1-mini", "gpt-4.1-nano"].includes(s.model))
  )
    throw Error("Unsupported text model");
  const body = anthropic
    ? {
        model: s.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: s.outputTokens,
        temperature: 0,
      }
    : {
        model: s.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: s.outputTokens,
        temperature: 0,
        response_format: { type: "json_object" },
        ...(openrouter
          ? {
              provider: {
                allow_fallbacks: false,
                max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
              },
              plugins: [],
            }
          : { store: false }),
      };
  const r = await fetch(
    anthropic
      ? "https://api.anthropic.com/v1/messages"
      : openrouter
        ? "https://openrouter.ai/api/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: anthropic
        ? anthropicHeaders(key)
        : {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
      body: JSON.stringify(body),
      credentials: "omit",
      redirect: "error",
      signal,
    },
  );
  if (!r.ok) {
    const retry = r.headers.get("retry-after");
    const ms = retry
      ? Number.isFinite(Number(retry))
        ? Number(retry) * 1000
        : Date.parse(retry) - Date.now()
      : 1000;
    throw new ProviderError(r.status, Math.max(1000, ms || 1000));
  }
  const data = await json(r);
  onUsage?.(readUsage(s.provider, s.model, data.usage ?? {}));
  if (
    (anthropic && data.stop_reason === "max_tokens") ||
    (!anthropic && data.choices?.[0]?.finish_reason === "length")
  )
    throw new ModelOutputError(
      "Provider response was cut off at the output token limit",
    );
  const content = anthropic
    ? Array.isArray(data.content)
      ? data.content
          .filter((block: { type: string }) => block.type === "text")
          .map((block: { text: string }) => block.text)
          .join("")
      : undefined
    : data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length > 24000)
    throw Error("Invalid model response");
  const usage = data.usage ?? {};
  if (anthropic)
    return {
      content,
      input: Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0,
      output: Number.isFinite(usage.output_tokens) ? usage.output_tokens : 0,
    };
  return {
    content,
    input: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : 0,
    output: Number.isFinite(usage.completion_tokens)
      ? usage.completion_tokens
      : 0,
  };
}
