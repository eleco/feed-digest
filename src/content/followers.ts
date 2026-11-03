import { engagement, selectors } from "./adapter";

function followerUrl(link: HTMLAnchorElement): URL | null {
  try {
    return new URL(link.getAttribute("href")!, "https://x.com");
  } catch {
    return null;
  }
}

// Read only rendered follower links for the exact post author, never a quoted author.
export function renderedFollowers(
  root: ParentNode,
  handle: string,
): number | null {
  const expected = handle.toLowerCase().replace(/^@/, "");
  for (const link of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const url = followerUrl(link);
    if (
      !url ||
      url.origin !== "https://x.com" ||
      ![`/${expected}/followers`, `/${expected}/verified_followers`].includes(
        url.pathname.toLowerCase(),
      )
    )
      continue;
    const text = (link.getAttribute("aria-label") || link.textContent || "")
      .replace(/[\u00a0\u202f]/g, " ")
      .trim();
    if (!/followers\b/i.test(text) || /verified\s+followers/i.test(text))
      continue;
    for (const element of [link, ...link.querySelectorAll("span")]) {
      const exact = engagement(element.getAttribute("title"));
      if (exact !== null) return exact;
    }
    const count = text.match(/^([\d,.]+\s*[KMB]?)\s*followers\b/i);
    if (count) return engagement(count[1].replace(/\s/g, ""));
  }
  return null;
}

// One attempt per author per scan; stop looking up cards after a small time budget.
export function followerLookup(root: Document, signal: AbortSignal) {
  const counts = new Map<string, number | null>();
  let spent = 0;
  return async (handle: string, deadline: number): Promise<number | null> => {
    const key = handle.toLowerCase();
    if (counts.has(key)) return counts.get(key)!;
    const visible = renderedFollowers(root, key);
    if (visible !== null) {
      counts.set(key, visible);
      return visible;
    }
    if (spent >= 12000 || Date.now() >= deadline) return null;
    const anchor = [
      ...root.querySelectorAll<HTMLAnchorElement>(
        `${selectors.card} ${selectors.name} a[href]`,
      ),
    ].find((link) => {
      const url = followerUrl(link);
      return (
        url?.origin === "https://x.com" &&
        url.pathname.toLowerCase() === `/${key}`
      );
    });
    if (!anchor) return null;
    const start = Date.now();
    let count: number | null = null;
    try {
      if (typeof PointerEvent !== "undefined")
        anchor.dispatchEvent(
          new PointerEvent("pointerover", {
            bubbles: true,
            pointerType: "mouse",
            relatedTarget: root.body,
          }),
        );
      anchor.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: root.body,
        }),
      );
      const end = Math.min(start + 1000, deadline, start + 12000 - spent);
      while (Date.now() < end) {
        signal.throwIfAborted();
        count = renderedFollowers(root, key);
        if (count !== null) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally {
      if (typeof PointerEvent !== "undefined")
        anchor.dispatchEvent(
          new PointerEvent("pointerout", {
            bubbles: true,
            pointerType: "mouse",
            relatedTarget: root.body,
          }),
        );
      anchor.dispatchEvent(
        new MouseEvent("mouseout", { bubbles: true, relatedTarget: root.body }),
      );
      spent += Date.now() - start;
    }
    counts.set(key, count);
    return count;
  };
}
