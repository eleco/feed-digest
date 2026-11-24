import { isHome, type Feed, type Settings, type Post } from "../shared/types";
import {
  account,
  barrier,
  feedTab,
  selectors,
  selected,
  switchFeed,
  waitFor,
} from "./adapter";
import { followerLookup } from "./followers";
import { extractionAttributes, extractionCache } from "./cache";
let controller: AbortController | undefined;
// Consecutive dated originals at or below the boundary that end a feed. Reply
// threads show up to two older parents above a new reply, so three is too few.
const OLD_RUN = 5;
const send = async (message: unknown) => {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw Error(response?.error ?? "Scan no longer active");
  return response;
};
async function scan(runId: string, s: Settings, signal: AbortSignal) {
  const followers = followerLookup(document, signal);
  let identity: string | null = null;
  try {
    // X renders its shell before the feed column, so wait for a feed tab
    // itself rather than any tab-like element. A missing tab only makes that
    // one feed unavailable.
    const ready = () =>
      !!document.querySelector(selectors.primary) &&
      (!!feedTab(document, "following") || !!feedTab(document, "for-you"));
    await waitFor(
      () => !!barrier(document, location.href) || ready(),
      signal,
      20000,
    ).catch((error) => {
      if (signal.aborted) throw error;
    });
    const blocked = barrier(document, location.href);
    if (blocked) throw Error(blocked);
    if (!ready())
      throw Error(
        `Unsupported X home layout: neither the Following nor the For you tab appeared (window ${innerWidth}×${innerHeight}px)`,
      );
    identity = account(document);
    if (!identity)
      throw Error("Cannot verify the signed-in account in this layout");
    await send({ op: "identity", runId, account: identity });
    for (const feed of ["following", "for-you"] as Feed[]) {
      signal.throwIfAborted();
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
        // Posts published at or before this time are older than the scan wants.
        const boundary = response.data?.boundary as number | null;
        // Following ends at its boundary; only For You needs post/scroll limits.
        const limited = response.data?.limited !== false;
        const atPostLimit = () => limited && seen.size >= s.maxPosts;
        let dateReached = false;
        await switchFeed(document, feed, signal);
        await waitFor(
          () =>
            !!document.querySelector(selectors.card) ||
            !!barrier(document, location.href),
          signal,
          10000,
        );
        // Cards are in feed order. A feed ends after OLD_RUN old originals in a
        // row. Reposts show the original's date, not when they were reposted,
        // so they never count as old, and ads are ignored.
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
          let oldRun = 0;
          for (const card of cards) {
            if (checkpointReached || dateReached || atPostLimit()) break;
            const p = cachedCards.read(card);
            if (!p) {
              if (!malformed.has(card)) {
                malformed.add(card);
                skipped++;
              }
              continue;
            }
            const original = !p.reposter && !p.promoted;
            // A repost of the checkpoint post can surface above newer posts;
            // only the original marks where the previous scan started.
            if (p.id === checkpoint && original) checkpointReached = true;
            else if (
              typeof boundary === "number" &&
              p.publishedAt !== null &&
              p.publishedAt <= boundary
            ) {
              if (!p.reposter) {
                if (!p.promoted && ++oldRun >= OLD_RUN) dateReached = true;
                continue;
              }
              // Old reposts are kept: their place in the feed is the repost.
            } else if (original) oldRun = 0;
            if (!seen.has(p.id)) {
              seen.add(p.id);
              pending.set(p.id, p);
            }
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
        const flush = async () => {
          while (pending.size) {
            const posts = [...pending.values()].slice(0, 10);
            for (const p of posts) {
              pending.delete(p.id);
              p.followers = await followers(p.handle, Infinity);
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
            reason = checkpoint
              ? "Posts older than the previous scan reached"
              : "24-hour cutoff reached";
            complete = true;
            break;
          }
          if (checkpointReached) {
            reason = "Previous scan checkpoint reached";
            complete = true;
            break;
          }
          if (atPostLimit()) {
            reason = "Post limit reached";
            complete = true;
            break;
          }
          if (limited && steps >= s.maxSteps) {
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
          // Renews the scan lease; scans have no overall time limit.
          await send({ op: "heartbeat", runId });
          const before = seen.size;
          window.scrollBy({
            top: Math.max(500, innerHeight * 0.8),
            behavior: "instant",
          });
          steps++;
          // Give each scroll 1.5–3 seconds to settle.
          const pause = 1500 + Math.floor(Math.random() * 1501);
          await new Promise((r) => setTimeout(r, pause));
          signal.throwIfAborted();
          captureAll();
          await flush();
          empty = seen.size === before ? empty + 1 : 0;
        }
        await flush();
        // Reading past the checkpoint's date also reaches it, e.g. when the
        // checkpoint post was deleted.
        if (checkpoint && dateReached) checkpointReached = true;
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
