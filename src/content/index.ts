import { isHome, type Feed, type Settings, type Post } from "../shared/types";
import {
  account,
  barrier,
  selectors,
  selected,
  switchFeed,
  waitFor,
} from "./adapter";
import { followerLookup } from "./followers";
import { extractionAttributes, extractionCache } from "./cache";
let controller: AbortController | undefined;
const send = async (message: unknown) => {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw Error(response?.error ?? "Scan no longer active");
  return response;
};
async function scan(runId: string, s: Settings, signal: AbortSignal) {
  const started = Date.now();
  const followers = followerLookup(document, signal);
  let identity: string | null = null;
  try {
    await waitFor(
      () =>
        !!barrier(document, location.href) ||
        !!document.querySelector(selectors.tab),
      signal,
      15000,
    );
    const blocked = barrier(document, location.href);
    if (blocked) throw Error(blocked);
    if (!document.querySelector(selectors.primary))
      throw Error("Unsupported X home layout");
    identity = account(document);
    if (!identity)
      throw Error("Cannot verify the signed-in account in this layout");
    await send({ op: "identity", runId, account: identity });
    for (const feed of ["following", "for-you"] as Feed[]) {
      signal.throwIfAborted();
      if (Date.now() - started > 205000)
        throw Error("Total collection deadline reached");
      const seen = new Set<string>();
      const cachedCards = extractionCache(feed, runId);
      let skipped = 0,
        steps = 0,
        reason = "",
        complete = false,
        exhausted = false,
        checkpointReached = false;
      let observer: MutationObserver | undefined;
      const pending = new Map<string, Post>();
      const malformed = new WeakSet<Element>();
      let unsafe = "";
      try {
        const response = await send({ op: "feed", runId, feed });
        const checkpoint = response.data?.checkpoint as string | null;
        const cutoff = response.data?.cutoff as number | null;
        let dateReached = false;
        // Old posts seen since the last new in-range post. For You is not
        // chronological and reposts carry old dates, so one old post is not
        // enough to stop; several in a row are.
        const oldStreak = new Set<string>();
        await switchFeed(document, feed, signal);
        await waitFor(
          () =>
            !!document.querySelector(selectors.card) ||
            !!barrier(document, location.href),
          signal,
          10000,
        );
        const capture = (cards: Element[]) => {
          const blocked = barrier(document, location.href);
          if (
            blocked ||
            !selected(document, feed) ||
            account(document) !== identity
          ) {
            unsafe = blocked ?? "Feed or account changed during scan";
            return;
          }
          for (const card of cards) {
            if (checkpointReached || dateReached || seen.size >= s.maxPosts)
              break;
            const p = cachedCards.read(card);
            if (!p) {
              if (!malformed.has(card)) {
                malformed.add(card);
                skipped++;
              }
              continue;
            }
            if (
              typeof cutoff === "number" &&
              p.publishedAt !== null &&
              p.publishedAt <= cutoff
            ) {
              if (!seen.has(p.id)) oldStreak.add(p.id);
              if (oldStreak.size >= 3) {
                dateReached = true;
                break;
              }
              continue;
            }
            if (!seen.has(p.id)) {
              seen.add(p.id);
              pending.set(p.id, p);
              oldStreak.clear();
            }
            if (p.id === checkpoint) checkpointReached = true;
          }
        };
        const captureAll = () =>
          capture([
            ...document
              .querySelector(selectors.primary)!
              .querySelectorAll(selectors.card),
          ]);
        observer = new MutationObserver((records) => {
          cachedCards.invalidate(records);
          captureAll();
          for (const record of records)
            for (const node of record.removedNodes)
              if (node instanceof Element) {
                const removed = node.matches(selectors.card)
                  ? [node]
                  : [...node.querySelectorAll(selectors.card)];
                capture(removed);
              }
        });
        observer.observe(
          document.querySelector(selectors.primary) ?? document.body,
          {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: extractionAttributes,
          },
        );
        const feedStart = Date.now();
        const flush = async () => {
          while (pending.size) {
            const posts = [...pending.values()].slice(0, 10);
            for (const p of posts) {
              pending.delete(p.id);
              p.followers = await followers(
                p.handle,
                Math.min(started + 205000, feedStart + s.maxSeconds * 1000),
              );
              signal.throwIfAborted();
              const blocked = barrier(document, location.href);
              if (
                blocked ||
                !selected(document, feed) ||
                account(document) !== identity
              )
                throw Error(blocked ?? "Feed or account changed during scan");
            }
            await send({ op: "batch", runId, feed, account: identity, posts });
          }
        };
        let empty = 0;
        while (!signal.aborted) {
          if (unsafe) throw Error(unsafe);
          if (!isHome(location.href)) throw Error("Scan tab left X home");
          captureAll();
          await flush();
          if (dateReached) {
            reason = "24-hour cutoff reached";
            complete = true;
            break;
          }
          if (checkpointReached) {
            reason = "Previous scan checkpoint reached";
            complete = true;
            break;
          }
          if (seen.size >= s.maxPosts) {
            reason = "Post limit reached";
            complete = true;
            break;
          }
          if (
            Date.now() - feedStart >= s.maxSeconds * 1000 ||
            Date.now() - started > 205000
          ) {
            reason = "Time limit reached";
            complete = true;
            break;
          }
          if (steps >= s.maxSteps) {
            reason = "Scroll limit reached";
            complete = true;
            break;
          }
          if (empty >= 3) {
            reason = "No new posts in three settled scroll cycles";
            complete = true;
            exhausted = true;
            break;
          }
          const before = seen.size;
          window.scrollBy({
            top: Math.max(500, innerHeight * 0.8),
            behavior: "instant",
          });
          steps++;
          // Give each scroll 1.5–3 seconds to settle, within collection deadlines.
          const pause = Math.min(
            1500 + Math.floor(Math.random() * 1501),
            Math.max(0, feedStart + s.maxSeconds * 1000 - Date.now()),
            Math.max(0, started + 205000 - Date.now()),
          );
          await new Promise((r) => setTimeout(r, pause));
          signal.throwIfAborted();
          captureAll();
          await flush();
          empty = seen.size === before ? empty + 1 : 0;
        }
        await flush();
        if (checkpoint && !checkpointReached && complete)
          reason += "; previous checkpoint not encountered";
      } catch (e) {
        reason = e instanceof Error ? e.message : "Feed unavailable";
        if (signal.aborted) throw e;
        if (/challenge|account|sign in|limiting|left X/i.test(reason)) throw e;
      } finally {
        observer?.disconnect();
      }
      await send({
        op: "feedDone",
        runId,
        feed,
        result: {
          count: seen.size,
          skipped,
          steps,
          reason,
          complete,
          checkpointReached,
          exhausted,
        },
      });
    }
    await send({ op: "collected", runId });
  } catch (e) {
    if (!signal.aborted)
      await send({
        op: "blocked",
        runId,
        reason: e instanceof Error ? e.message : "Collection unavailable",
      }).catch(() => {});
  }
}
chrome.runtime.onMessage.addListener((m, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    (sender.url && !sender.url.startsWith(chrome.runtime.getURL("")))
  )
    return;
  if (m?.op === "stop") {
    controller?.abort();
    respond({ ok: true });
  }
  if (m?.op === "scan" && isHome(location.href) && !controller) {
    controller = new AbortController();
    respond({ ok: true });
    void scan(m.runId, m.settings, controller.signal);
  }
});
