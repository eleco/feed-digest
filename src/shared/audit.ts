import type { Post, Ranked } from "./types";

export interface AIUsage {
  input: number | null;
  output: number | null;
  cachedInput: number;
  cost: number | null;
  costKind: "reported" | "estimated" | "unavailable";
  pricingSource?: string;
  pricingDate?: string;
}
export interface AIAttempt {
  number: number;
  postIds: string[];
  startedAt: number;
  finishedAt?: number;
  status: "running" | "success" | "error";
  error?: string;
  usage?: AIUsage;
}
export interface AIPost {
  id: string;
  text: string;
  quotedText?: string;
  url: string;
  handle: string;
  status:
    | "pending"
    | "analysing"
    | "analysed"
    | "cached"
    | "skipped"
    | "error"
    | "no-result";
  result?: Ranked;
  note?: string;
  selected?: boolean;
}
export interface AIAudit {
  version: 1;
  promptVersion: string;
  updatedAt: number;
  finishedAt?: number;
  collected: number;
  posts: AIPost[];
  attempts: AIAttempt[];
  notices: string[];
}
export function auditPost(p: Post): AIPost {
  return {
    id: p.id,
    text: p.text.slice(0, 2200),
    quotedText: p.quotedText?.slice(0, 600),
    url: p.url,
    handle: p.handle,
    status: "pending",
  };
}
export function auditTotals(a: AIAudit) {
  return {
    input: a.attempts.reduce((n, r) => n + (r.usage?.input ?? 0), 0),
    output: a.attempts.reduce((n, r) => n + (r.usage?.output ?? 0), 0),
    cost: a.attempts.reduce((n, r) => n + (r.usage?.cost ?? 0), 0),
    unknownTokens: a.attempts.filter(
      (r) => r.usage?.input == null || r.usage?.output == null,
    ).length,
    unknownCost: a.attempts.filter((r) => r.usage?.cost == null).length,
    cached: a.posts.filter((p) => p.status === "cached").length,
    analysed: a.posts.filter((p) => !!p.result).length,
  };
}
