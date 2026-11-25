import type { Sector, Tone } from "./categories";
import { validPostLinks, type PostLink } from "./links";
export type Feed = "following" | "for-you";
export type State =
  | "idle"
  | "collecting"
  | "ranking"
  | "completed"
  | "partial"
  | "cancelled"
  | "blocked"
  | "interrupted";
export type Provider = "basic" | "openrouter" | "openai" | "anthropic";
export interface Observation {
  runId: string;
  feed: Feed;
  at: number;
}
export interface Post {
  id: string;
  url: string;
  handle: string;
  author: string;
  text: string;
  publishedAt: number | null;
  collectedAt: number;
  observations: Observation[];
  quotedText: string | null;
  reposter: string | null;
  reply: boolean;
  promoted: boolean;
  truncated: boolean;
  mediaOnly: boolean;
  likes: number | null;
  comments?: number | null;
  views?: number | null;
  followers?: number | null;
  links?: PostLink[];
  /** The post plays a video itself (not a link to one). Unknown on older posts. */
  video?: boolean;
  pinned: boolean;
}
export interface FeedResult {
  count: number;
  skipped: number;
  steps: number;
  reason: string;
  complete: boolean;
}
export interface Run {
  analysisOnly?: boolean;
  /** After scoring, pick the reader's top 20 with one editor request. */
  topPicks?: boolean;
  aiAudit?: import("./audit").AIAudit;
  id: string;
  state: State;
  phase: string;
  feed: Feed | null;
  startedAt: number;
  updatedAt: number;
  leaseUntil: number;
  tabId?: number;
  browserSession?: string;
  monitorTabId?: number;
  account?: string;
  reason: string;
  feeds: Record<Feed, FeedResult>;
  postIds: string[];
  /** Older runs only; superseded by newestCollected. */
  firstCollected?: Partial<Record<Feed, string>>;
  /** Screen area the scan's windows are laid out in. */
  screen?: { left: number; top: number; width: number; height: number };
  newestCollected?: Partial<
    Record<Feed, { postId: string; publishedAt: number }>
  >;
  lastCollected?: Partial<Record<Feed, string>>;
  requests: number;
  generation: string;
  settings: Settings;
}
export interface Ranked {
  id: string;
  score: number;
  takeaway: string;
  reason: string;
  flags: string[];
  mode: "basic" | "ai";
  sectors?: Sector[];
  tones?: Tone[];
  /** 0–100 match to Settings.priorities; only when priorities are set. */
  relevance?: number;
  recommendations?: {
    action: "buy" | "sell";
    asset: string;
    kind: "stock" | "crypto" | "fund" | "commodity" | "forex" | "other";
  }[];
}
export interface Digest {
  id: string;
  createdAt: number;
  items: Ranked[];
  mode: string;
  model: string;
  notices: string[];
  candidates: number;
  tokens: number;
  estimate?: number; // Historical digests only; new digests do not estimate costs.
}
export interface Feedback {
  id: string;
  value: "useful" | "not-useful";
  handle: string;
}
export const PRIORITIES_MAX = 600;
export interface TopPick {
  id: string;
  /** AI-written: why this post is worth the reader's time. */
  why: string;
  /** Posts about the same story, folded under this pick. */
  similar: string[];
}
export interface TopPicks {
  id: "topPicks";
  runId: string;
  createdAt: number;
  model: string;
  /** Posts the picks were chosen from (the selection that was analysed). */
  considered: number;
  /** Posts sent to the editor request. */
  shortlisted: number;
  picks: TopPick[];
  /** Set when the editor request failed and picks fall back to scores. */
  fallback?: string;
}
export interface Settings {
  provider: Provider;
  model: string;
  enabled: boolean;
  maxPosts: number;
  maxSteps: number;
  hideImages: boolean;
  /** Free text: what the reader cares about, used for relevance and top picks. */
  priorities: string;
  stopMode: "checkpoint" | "last24hours";
  requestsPerScan: number;
  requestsPerDay: number;
  inputTokens: number;
  outputTokens: number;
}
export const defaults: Settings = {
  provider: "basic",
  model: "",
  enabled: false,
  maxPosts: 100,
  maxSteps: 30,
  hideImages: false,
  priorities: "",
  stopMode: "checkpoint",
  requestsPerScan: 6,
  requestsPerDay: 12,
  inputTokens: 12000,
  outputTokens: 1600,
};
export const active = (r?: Run) =>
  !!r && (r.state === "collecting" || r.state === "ranking");
export function isHome(url: string) {
  try {
    const u = new URL(url);
    return u.origin === "https://x.com" && u.pathname === "/home";
  } catch {
    return false;
  }
}
export function canonical(url: string) {
  try {
    const u = new URL(url, "https://x.com");
    const m = u.pathname.match(/^\/([a-zA-Z0-9_]{1,15})\/status\/(\d{1,25})$/);
    return u.origin === "https://x.com" && m
      ? { id: m[2], handle: m[1], url: `https://x.com/${m[1]}/status/${m[2]}` }
      : null;
  } catch {
    return null;
  }
}
export function validatePost(p: unknown): p is Post {
  if (!p || typeof p !== "object") return false;
  const x = p as Post;
  const c = typeof x.url === "string" ? canonical(x.url) : null;
  return (
    !!c &&
    c.id === x.id &&
    c.handle === x.handle &&
    typeof x.author === "string" &&
    x.author.length <= 200 &&
    typeof x.text === "string" &&
    x.text.length <= 12000 &&
    (x.quotedText === null ||
      (typeof x.quotedText === "string" && x.quotedText.length <= 12000)) &&
    (x.reposter === null ||
      (typeof x.reposter === "string" && x.reposter.length <= 200)) &&
    [x.collectedAt].every(Number.isFinite) &&
    (x.publishedAt === null || Number.isFinite(x.publishedAt)) &&
    (x.likes === null || (Number.isFinite(x.likes) && x.likes >= 0)) &&
    (x.comments == null || (Number.isFinite(x.comments) && x.comments >= 0)) &&
    [x.views, x.followers].every(
      (value) => value == null || (Number.isSafeInteger(value) && value >= 0),
    ) &&
    (x.links === undefined || validPostLinks(x.links)) &&
    (x.video === undefined || typeof x.video === "boolean") &&
    ["reply", "promoted", "truncated", "mediaOnly", "pinned"].every(
      (k) => typeof x[k as keyof Post] === "boolean",
    )
  );
}
export function validateSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== "object") throw Error("Invalid settings");
  const x = raw as Settings;
  const s = { ...defaults };
  if (typeof x.model !== "string" || x.model.length > 2000)
    throw Error("Invalid settings");
  s.model = x.model;
  if (!["basic", "openrouter", "openai", "anthropic"].includes(x.provider))
    throw Error("Invalid settings");
  s.provider = x.provider;
  if (!["checkpoint", "last24hours"].includes(x.stopMode ?? "checkpoint"))
    throw Error("Invalid stop mode");
  s.stopMode = x.stopMode ?? "checkpoint";
  const priorities = x.priorities ?? "";
  if (typeof priorities !== "string" || priorities.length > PRIORITIES_MAX)
    throw Error("Invalid priorities");
  s.priorities = priorities;
  for (const k of ["enabled", "hideImages"] as const) {
    if (typeof x[k] !== "boolean") throw Error("Invalid settings");
    s[k] = x[k];
  }
  const ranges = {
    maxPosts: [1, 1000],
    maxSteps: [1, 100],
    requestsPerScan: [1, 6],
    requestsPerDay: [1, 12],
    inputTokens: [1000, 16000],
    outputTokens: [200, 2000],
  } as const;
  for (const k of Object.keys(ranges) as (keyof typeof ranges)[]) {
    const v = x[k];
    if (!Number.isFinite(v) || v < ranges[k][0] || v > ranges[k][1])
      throw Error("Invalid " + k);
    s[k] = v;
  }
  return s;
}
