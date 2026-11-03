import type { Feed, Post } from "../shared/types";
import { extract, selectors } from "./adapter";

// Only attributes read by extraction or used by its selectors. X changes
// presentation attributes frequently while scrolling and playing media.
export const extractionAttributes = [
  "href",
  "datetime",
  "aria-label",
  "title",
  "data-testid",
  "role",
];

// Scoped to one feed in one scan. Weak keys release virtualized cards naturally.
export function extractionCache(feed: Feed, runId: string) {
  const entries = new WeakMap<Element, Post>();
  return {
    read(card: Element) {
      const cached = entries.get(card);
      if (cached) return cached;
      const post = extract(card, feed, runId);
      // Incomplete cards must be retried as X hydrates them.
      if (post) entries.set(card, post);
      return post;
    },
    invalidate(records: MutationRecord[]) {
      for (const record of records) {
        if (
          record.type === "attributes" &&
          !extractionAttributes.includes(record.attributeName ?? "")
        )
          continue;
        let element =
          record.target instanceof Element
            ? record.target
            : record.target.parentElement;
        while (element) {
          if (element.matches(selectors.card)) entries.delete(element);
          element = element.parentElement;
        }
      }
    },
  };
}
