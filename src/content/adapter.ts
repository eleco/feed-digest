import { safePostUrl, type PostLink } from "../shared/links";
import { canonical, isHome, type Feed, type Post } from "../shared/types";
export const selectors = {
  // Some X builds ship posts as plain <article> elements without test ids.
  card: ':is([data-testid="tweet"], article)',
  text: '[data-testid="tweetText"]',
  name: '[data-testid="User-Name"]',
  tab: '[role="tab"]',
  primary: '[data-testid="primaryColumn"]',
  account: '[data-testid="SideNav_AccountSwitcher_Button"]',
  quote: '[data-testid="quoteTweet"], [role="link"]',
  photo: '[data-testid="tweetPhoto"]',
};
// The feed column. Some X layouts (e.g. narrow or zoomed windows) drop its
// test id, so fall back to the main region that holds the timeline.
export function feedRoot(root: ParentNode): Element | null {
  return (
    root.querySelector(selectors.primary) ??
    root.querySelector('main[role="main"]') ??
    root.querySelector("main")
  );
}
const feedScope = `:is(${selectors.primary}, main)`;
// Applied only to the owned scan tab. Keep inline emoji and all post text intact.
// CSS also covers cards added by X's virtualised feed, without mutating its DOM.
export const HIDE_FEED_IMAGES_CSS = `
${feedScope} ${selectors.card} ${selectors.photo},
${feedScope} ${selectors.card} img:not(${selectors.text} img):not(${selectors.card} [lang] img),
${feedScope} ${selectors.card} [role="img"]:not(${selectors.text} [role="img"]) {
  display: none !important;
}`;
export function feedTab(root: ParentNode, feed: Feed): HTMLElement | null {
  const label = (feed === "following" ? "Following" : "For you").toLowerCase();
  const scope = feedRoot(root) ?? root;
  const text = (e: Element) =>
    (e.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  // X may render a tab's label twice (a hidden copy for measuring), so also
  // accept the doubled text or a single leaf element carrying the label.
  return (
    [...scope.querySelectorAll<HTMLElement>(selectors.tab)].find(
      (e) =>
        text(e) === label ||
        text(e) === label + label ||
        [...e.querySelectorAll("*")].some(
          (child) => !child.childElementCount && text(child) === label,
        ),
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
        .querySelector(
          'a[data-testid="AppTabBar_Profile_Link"], header[role="banner"] a[aria-label="Profile"], nav a[aria-label="Profile"]',
        )
        ?.getAttribute("href"),
      /^\/([a-zA-Z0-9_]{1,15})$/,
    ) ??
    handle(
      root
        .querySelector(
          'header[role="banner"] [data-testid^="UserAvatar-Container-"]',
        )
        ?.getAttribute("data-testid"),
      /^UserAvatar-Container-([a-zA-Z0-9_]{1,15})$/,
    ) ??
    composerHandle(root);
  return found ? "@" + found : null;
}
// The "What's happening?" composer at the top of Home shows the signed-in
// user's avatar. Only an avatar sharing a close ancestor with the composer
// counts, never one inside a post.
function composerHandle(root: ParentNode): string | null {
  let node = root.querySelector('[data-testid="tweetTextarea_0"]');
  for (let depth = 0; node && depth < 12; depth++) {
    node = node.parentElement;
    const avatar = [
      ...(node?.querySelectorAll('[data-testid^="UserAvatar-Container-"]') ??
        []),
    ].find((a) => !a.closest(selectors.card));
    if (avatar)
      return handle(
        avatar.getAttribute("data-testid"),
        /^UserAvatar-Container-([a-zA-Z0-9_]{1,15})$/,
      );
    if (node?.querySelector(selectors.card)) break;
  }
  return null;
}
/** What account detection could see, for error messages. */
export function accountClues(root: ParentNode) {
  const has = (selector: string) =>
    root.querySelector(selector) ? "yes" : "no";
  return `switcher ${has(selectors.account)}, profile link ${has('a[data-testid="AppTabBar_Profile_Link"], a[aria-label="Profile"]')}, side menu ${has('header[role="banner"]')}, composer ${has('[data-testid="tweetTextarea_0"]')}`;
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
function extractLinks(card: Element, postId: string): PostLink[] {
  const links: PostLink[] = [];
  const outer = card.querySelector(selectors.name);
  for (const anchor of card.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (anchor.closest(selectors.name) || anchor.querySelector("time"))
      continue;
    // The post's own permalink is not an outgoing link.
    if (canonical(anchor.getAttribute("href") ?? "")?.id === postId) continue;
    // Relative links are X's own pages, whatever origin this document has.
    let url: string | null;
    try {
      url = safePostUrl(
        new URL(anchor.getAttribute("href") ?? "", "https://x.com").href,
      );
    } catch {
      url = null;
    }
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
    const source = (
      outer
        ? quote &&
          quote !== card &&
          !quote.contains(outer) &&
          (quote.matches('[data-testid="quoteTweet"]') ||
            quote.querySelector(selectors.name))
        : nested(card, anchor)
    )
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
  if (!outer) return extractStructural(card, feed, runId, now);
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
    links: extractLinks(card, c.id),
    pinned: false,
  };
}
// X post IDs (snowflakes) encode their creation time in milliseconds.
const SNOWFLAKE_EPOCH = 1288834974657;
export function idTime(id: string, now = Date.now()): number | null {
  if (!/^\d{1,25}$/.test(id)) return null;
  const at = Math.floor(Number(id) / 2 ** 22) + SNOWFLAKE_EPOCH;
  // Pre-2010 IDs are sequential and carry no time.
  return at > Date.UTC(2010, 10, 4) && at <= now + 86400000 ? at : null;
}
// Inside a quoted post (a role=link block within the card), not the card itself.
function nested(card: Element, element: Element) {
  const block = element.closest('[role="link"], [data-testid="quoteTweet"]');
  return !!block && block !== card && card.contains(block);
}
const leafText = (e: Element) => (e.textContent ?? "").trim();
// Posts without test ids: the permalink, profile links, a [lang] text block
// and an action bar whose aria-label carries exact counts.
function extractStructural(
  card: Element,
  feed: Feed,
  runId: string,
  now: number,
): Post | null {
  // A quoted post rendered as its own article belongs to the outer card.
  if (card.parentElement?.closest(selectors.card)) return null;
  const own = (e: Element) => !nested(card, e);
  // Post text is a [lang] block inside the card; <html lang> does not count.
  const inPostText = (e: Element) => {
    const block = e.closest("[lang]");
    return !!block && card.contains(block);
  };
  const c =
    [...card.querySelectorAll('a[href*="/status/"]')]
      .filter(own)
      .map((a) => canonical(a.getAttribute("href") ?? ""))
      .find((value) => value !== null) ?? null;
  if (!c) return null;
  const profile = `/${c.handle.toLowerCase()}`;
  // Profile links hold the avatar, display name and @handle; prefer the name.
  const author =
    [...card.querySelectorAll("a[href]")]
      .filter(
        (a) => own(a) && a.getAttribute("href")?.toLowerCase() === profile,
      )
      .map(leafText)
      .find((text) => text && !text.startsWith("@")) ?? c.handle;
  const texts = [...card.querySelectorAll<HTMLElement>("[lang]")];
  const join = (list: HTMLElement[]) =>
    list.map((t) => t.innerText ?? t.textContent ?? "").join("\n");
  const rawText = join(texts.filter(own));
  const quoted = texts.filter((t) => !own(t));
  const text = rawText.slice(0, 12000);
  const context =
    card.querySelector('[data-testid="socialContext"]')?.textContent ??
    [...card.querySelectorAll("span, a")]
      .filter((e) => own(e) && !inPostText(e) && !e.childElementCount)
      .map(leafText)
      .find((value) => /^.{1,100} reposted$/i.test(value)) ??
    "";
  const group =
    [...card.querySelectorAll('[role="group"][aria-label]')]
      .find(own)
      ?.getAttribute("aria-label") ?? null;
  // "78 replies, 96 reposts, 3153 likes, 161 bookmarks, 266581 views". X
  // leaves out zero counts, except views, which may simply be hidden.
  const counted = (word: string, zero: boolean) => {
    if (group === null) return null;
    const m = group.match(new RegExp(`([\\d.,]+[KMB]?)\\s+${word}\\b`, "i"));
    return m ? engagement(m[1]) : zero ? 0 : null;
  };
  return {
    ...c,
    author: author.slice(0, 200),
    text,
    publishedAt: idTime(c.id, now),
    collectedAt: now,
    observations: [{ runId, feed, at: now }],
    quotedText: quoted.length ? join(quoted).slice(0, 12000) : null,
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
      [...card.querySelectorAll("a, button, span")].some(
        (e) => own(e) && !e.childElementCount && leafText(e) === "Show more",
      ),
    mediaOnly: !text.trim(),
    likes: counted("likes?", true),
    comments: counted("repl(?:y|ies)", true),
    views: counted("views?", false),
    links: extractLinks(card, c.id),
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
/** What the page showed when a feed was not ready, for error messages. */
export function feedClues(root: Document, feed: Feed) {
  const tab = feedTab(root, feed);
  const count = (selector: string) => root.querySelectorAll(selector).length;
  return [
    `${feed === "following" ? "Following" : "For you"} tab ${!tab ? "missing" : selected(root, feed) ? "selected" : "not selected"}`,
    `posts ${count(selectors.card)}`,
    `articles ${count("article")}`,
    `post text ${count(selectors.text)}`,
    `cells ${count('[data-testid="cellInnerDiv"]')}`,
    root.visibilityState,
    `page ${innerWidth}px`,
  ].join(", ");
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
  observer.observe(feedRoot(root) ?? root.body, {
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
    ).catch((error) => {
      if (signal.aborted) throw error;
      const label = feed === "following" ? "Following" : "For you";
      const left = outgoing.filter((e) => e.isConnected).length;
      throw Error(
        `Switching to ${label} did not finish: ${feedClues(root, feed)}, ${left} of ${outgoing.length} previous posts still shown, last change ${Date.now() - changedAt}ms ago`.slice(
          0,
          290,
        ),
      );
    });
  } finally {
    observer.disconnect();
  }
}
