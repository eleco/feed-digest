import "./style.css";
import type { Run } from "../shared/types";
export const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}
export function link(text: string, url: string) {
  const a = el("a", text);
  const u = new URL(url, location.href);
  if (!["https:", "http:", "chrome-extension:"].includes(u.protocol))
    throw Error("Unsafe URL");
  a.href = u.href;
  if (u.protocol !== "chrome-extension:") {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.referrerPolicy = "no-referrer";
  }
  return a;
}
export function button(text: string, fn: () => unknown, className = "") {
  const b = el("button", text, className);
  b.type = "button";
  b.addEventListener("click", () => {
    void Promise.resolve()
      .then(fn)
      .catch((error) =>
        notice(error instanceof Error ? error.message : "Action failed"),
      );
  });
  return b;
}
export function notice(text: string) {
  const target = document.querySelector("#notice");
  if (target) target.textContent = text;
}
export async function command(op: string, data: Record<string, unknown> = {}) {
  const r = await chrome.runtime.sendMessage({ ...data, op });
  if (!r?.ok) throw Error(r?.error ?? "Action failed");
  return r.data;
}
// One brand mark and name on every extension page.
export function brand() {
  const logo = link("", "digest.html");
  logo.className = "brand";
  logo.append(
    el("span", undefined, "brand-mark"),
    document.createTextNode("X Feed Digest"),
  );
  return logo;
}
/** Short date for posts: time only today, otherwise the day and time. */
export function postTime(at: number, now = Date.now()) {
  const date = new Date(at);
  const today = new Date(now);
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (date.toDateString() === today.toDateString()) return time;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString())
    return "Yesterday " + time;
  return (
    date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      ...(date.getFullYear() === today.getFullYear()
        ? {}
        : { year: "numeric" }),
    }) +
    " " +
    time
  );
}
export function shell(title: string, subtitle: string) {
  const app = $("#app");
  const header = el("header");
  header.append(brand());
  const nav = el("nav");
  nav.setAttribute("aria-label", "Main navigation");
  nav.append(
    link("Your digest", "digest.html"),
    link("AI activity", "activity.html"),
    link("Settings", "settings.html"),
  );
  header.append(nav);
  const main = el("main");
  const eyebrow = el("p", "LESS SCROLLING. MORE SIGNAL.", "eyebrow");
  main.append(eyebrow, el("h1", title), el("p", subtitle, "lede"));
  const message = el("p", "", "notice");
  message.id = "notice";
  message.setAttribute("role", "status");
  main.append(message);
  app.append(header, main);
  return main;
}
export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** Plain-language state of a run for status lines. */
export function runSummary(run?: Run) {
  if (!run) return "No scans yet.";
  const n = run.postIds.length;
  const posts = `${n.toLocaleString()} post${n === 1 ? "" : "s"}`;
  if (run.state === "collecting")
    return `Scanning X · ${posts} collected so far.`;
  if (run.state === "ranking")
    return `AI analysis running on ${posts}. Keep the digest tab open.`;
  const what = run.analysisOnly ? "Last AI analysis" : "Last scan";
  const detail = run.reason ? ` ${run.reason}` : "";
  switch (run.state) {
    case "completed":
      // A scan can finish cleanly yet keep nothing; say where each feed stopped.
      return `${what} finished · ${posts}.${n || run.analysisOnly ? "" : ` ${feedReasons(run)}`}`;
    case "partial":
      return `${what} stopped early · ${posts}.${detail}`;
    case "cancelled":
      return `${what} stopped by you · ${posts} kept.`;
    case "blocked":
      return `${what} could not run.${detail}`;
    case "interrupted":
      return `${what} was interrupted · ${posts} kept.${detail}`;
    default:
      return `${what}: ${run.state}.`;
  }
}
/** Where each feed stopped, e.g. "Following: 24-hour cutoff reached." */
export function feedReasons(run: Run) {
  return (
    [
      ["Following", run.feeds.following],
      ["For you", run.feeds["for-you"]],
    ] as const
  )
    .map(([label, f]) => `${label}: ${f.reason || "no reason recorded"}.`)
    .join(" ");
}
