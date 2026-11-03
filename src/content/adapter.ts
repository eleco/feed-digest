import { safePostUrl, type PostLink } from "../shared/links";
import { canonical, isHome, type Feed, type Post } from "../shared/types";
export const selectors = {
  card: 'article[data-testid="tweet"]',
  text: '[data-testid="tweetText"]',
  name: '[data-testid="User-Name"]',
  tab: '[role="tab"]',
  primary: '[data-testid="primaryColumn"]',
  account: '[data-testid="SideNav_AccountSwitcher_Button"]',
  quote: '[data-testid="quoteTweet"], [role="link"]',
  photo: '[data-testid="tweetPhoto"]',
};
// Applied only to the owned scan tab. Keep inline emoji and all post text intact.
// CSS also covers cards added by X's virtualised feed, without mutating its DOM.
export const HIDE_FEED_IMAGES_CSS = `
${selectors.primary} ${selectors.card} ${selectors.photo},
${selectors.primary} ${selectors.card} img:not(${selectors.text} img),
${selectors.primary} ${selectors.card} [role="img"]:not(${selectors.text} [role="img"]) {
  display: none !important;
}`;
export function feedTab(root: ParentNode, feed: Feed): HTMLElement | null {
  const label = feed === "following" ? "Following" : "For you";
  const scope = root.querySelector(selectors.primary) ?? root;
  return (
    [...scope.querySelectorAll<HTMLElement>(selectors.tab)].find(
      (e) => (e.textContent ?? "").trim().toLowerCase() === label.toLowerCase(),
    ) ?? null
  );
}
export const selected = (root: ParentNode, feed: Feed) =>
  feedTab(root, feed)?.getAttribute("aria-selected") === "true";
const handle = (value: string | null | undefined, pattern: RegExp) =>
  value?.match(pattern)?.[1]?.toLowerCase() ?? null;
export function account(root: ParentNode): string | null {
  const switcher = root.querySelector(selectors.account);
  // In narrower windows X collapses the side menu to icons and drops the
  // "@handle" text, so fall back to the avatar and profile link, which keep it.
  const found =
    handle(switcher?.textContent, /@([a-zA-Z0-9_]{1,15})\b/) ??
    handle(
      root
        .querySelector(
          `${selectors.account} [data-testid^="UserAvatar-Container-"], [data-testid="DashButton_ProfileIcon_Link"] [data-testid^="UserAvatar-Container-"]`,
        )
        ?.getAttribute("data-testid"),
      /^UserAvatar-Container-([a-zA-Z0-9_]{1,15})$/,
    ) ??
    handle(
      root
        .querySelector('a[data-testid="AppTabBar_Profile_Link"]')
        ?.getAttribute("href"),
      /^\/([a-zA-Z0-9_]{1,15})$/,
    );
  return found ? "@" + found : null;
}
export function barrier(root: Document, url: string): string | null {
  if (!isHome(url)) return "Not on X home; sign in normally, then retry";
  const notices = [
    ...root.querySelectorAll('[role="alert"], [role="dialog"], main > div'),
  ]
    .filter(
      (e) => !e.querySelector(selectors.card) && !e.closest(selectors.card),
    )
    .map((e) => e.textContent ?? "")
    .join(" ")
    .slice(0, 30000);
  if (
    /verify (your|you are)|unusual activity|authenticate your|captcha/i.test(
      notices,
    ) ||
    root.querySelector('iframe[src*="arkoselabs"], iframe[src*="captcha"]')
  )
    return "Verification challenge — scan stopped";
  if (
    /rate limit exceeded|too many requests|something went wrong.*reload/i.test(
      notices,
    )
  )
    return "X is limiting or blocking page rendering";
  if (
    root.querySelector(
      'input[autocomplete="username"], input[autocomplete="current-password"]',
    )
  )
    return "Sign in to X normally, then retry";
  return null;
}
export function engagement(value: string | null): number | null {
  if (!value) return null;
  const m = value
    .trim()
    .match(/^(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)([KMB])?$/i);
  if (!m) return null;
  return Math.round(
    Number(m[1].replace(/,/g, "")) *
      ({ k: 1000, m: 1e6, b: 1e9 }[m[2]?.toLowerCase()] ?? 1),
  );
}
function cardEngagement(card: Element, selector: string): number | null {
  const outer = card.querySelector(selectors.name);
  const control = [...card.querySelectorAll(selector)].find((element) => {
    if (element.closest(selectors.card) !== card) return false;
    for (
      let parent = element.parentElement;
      parent && parent !== card;
      parent = parent.parentElement
    ) {
      if (
        parent.matches(selectors.quote) &&
        (parent.matches('[data-testid="quoteTweet"]') ||
          parent.querySelector(selectors.name)) &&
        (!outer || !parent.contains(outer))
      )
        return false;
    }
    return true;
  });
  if (!control) return null;
  const spans = [control, ...control.querySelectorAll("span")];
  for (const span of spans) {
    const exact = engagement(span.getAttribute("title"));
    if (exact !== null) return exact;
  }
  for (const span of spans) {
    const count = engagement(span.textContent);
    if (count !== null) return count;
  }
  const label = control
    .getAttribute("aria-label")
    ?.match(/^([\d.,]+[KMB]?)\s+(?:repl(?:y|ies)|likes?|views?)\b/i);
  return label ? engagement(label[1]) : null;
}
function extractLinks(card: Element): PostLink[] {
  const links: PostLink[] = [];
  const outer = card.querySelector(selectors.name);
  for (const anchor of card.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (anchor.closest(selectors.name) || anchor.querySelector("time"))
      continue;
    let url = safePostUrl(anchor.href);
    if (!url) continue;
    if (new URL(url).hostname === "t.co")
      url = safePostUrl(anchor.title) ?? url;
    const parsed = new URL(url);
    if (
      ["x.com", "twitter.com"].includes(parsed.hostname) &&
      !/^\/[^/]+\/status\/\d+$/.test(parsed.pathname)
    )
      continue;
    const quote = anchor.closest(selectors.quote);
    const source =
      quote &&
      quote !== card &&
      !quote.contains(outer) &&
      (quote.matches('[data-testid="quoteTweet"]') ||
        quote.querySelector(selectors.name))
        ? "quote"
        : "post";
    if (!links.some((link) => link.url === url && link.source === source))
      links.push({ url, source });
    if (links.length >= 20) break;
  }
  return links;
}
export function extract(
  card: Element,
  feed: Feed,
  runId: string,
  now = Date.now(),
): Post | null {
  const names = [...card.querySelectorAll(selectors.name)];
  const outer = names[0];
  if (!outer) return null;
  const timestamp = outer.querySelector("time");
  const link = timestamp?.closest("a");
  const c = link ? canonical(link.getAttribute("href") ?? "") : null;
  if (!c) return null;
  const texts = [...card.querySelectorAll<HTMLElement>(selectors.text)];
  const quoted = texts.filter((t) => {
    const q = t.closest(selectors.quote);
    return q !== null && q !== card && !q.contains(outer);
  });
  const main = texts.filter((t) => !quoted.includes(t));
  const rawText = main
    .map((t) => t.innerText ?? t.textContent ?? "")
    .join("\n");
  const text = rawText.slice(0, 12000);
  const context =
    card.querySelector('[data-testid="socialContext"]')?.textContent ?? "";
  const rawTime = timestamp?.getAttribute("datetime");
  const published = rawTime ? Date.parse(rawTime) : NaN;
  const nameText = outer.querySelector("a span")?.textContent ?? c.handle;
  return {
    ...c,
    author: nameText.slice(0, 200),
    text,
    publishedAt: Number.isFinite(published) ? published : null,
    collectedAt: now,
    observations: [{ runId, feed, at: now }],
    quotedText: quoted.length
      ? quoted
          .map((t) => t.innerText ?? t.textContent ?? "")
          .join("\n")
          .slice(0, 12000)
      : null,
    reposter: /reposted/i.test(context)
      ? context.replace(/\s+reposted.*$/i, "").slice(0, 200)
      : null,
    reply: [...card.querySelectorAll("div,span")].some((e) =>
      /^Replying to\b/.test(e.textContent ?? ""),
    ),
    promoted:
      !!card.querySelector('[data-testid="placementTracking"]') ||
      [...card.querySelectorAll("span")].some(
        (s) => s.textContent === "Ad" || s.textContent === "Promoted",
      ),
    truncated:
      rawText.length > 12000 ||
      !!card.querySelector('[data-testid="tweet-text-show-more-link"]'),
    mediaOnly: !text.trim(),
    likes: cardEngagement(card, '[data-testid="like"], [data-testid="unlike"]'),
    comments: cardEngagement(card, '[data-testid="reply"]'),
    views: cardEngagement(card, `a[href*="/status/${c.id}/analytics"]`),
    links: extractLinks(card),
    pinned: false,
  };
}
export function transitionSafe(
  outgoing: Element[],
  root: ParentNode,
  feed: Feed,
) {
  return (
    selected(root, feed) &&
    outgoing.every((e) => !e.isConnected) &&
    root.querySelectorAll(selectors.card).length > 0
  );
}
export async function waitFor(
  check: () => boolean,
  signal: AbortSignal,
  ms: number,
) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    signal.throwIfAborted();
    if (check()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error("Page did not become ready before the deadline");
}
export async function switchFeed(
  root: Document,
  feed: Feed,
  signal: AbortSignal,
) {
  const tab = feedTab(root, feed);
  if (!tab)
    throw Error("Unsupported X layout or UI language; English tabs required");
  if (selected(root, feed)) return;
  const outgoing = [...root.querySelectorAll(selectors.card)];
  let changedAt = Date.now();
  const observer = new MutationObserver(() => {
    changedAt = Date.now();
  });
  observer.observe(root.querySelector(selectors.primary) ?? root.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  try {
    tab.click();
    await waitFor(
      () =>
        transitionSafe(outgoing, root, feed) && Date.now() - changedAt > 800,
      signal,
      12000,
    );
  } finally {
    observer.disconnect();
  }
}
