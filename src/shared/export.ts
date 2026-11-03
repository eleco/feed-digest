import { validPostLinks } from "./links";
import { canonical, type Digest, type Post } from "./types";
export function markdownText(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_[\]{}()#+.!|~-])/g, "\\$1");
}
export function markdown(d: Digest, posts: Post[]) {
  const map = new Map(posts.map((p) => [p.id, p]));
  return (
    "# X Feed Digest\n\n" +
    markdownText(d.mode) +
    "\n\n" +
    d.items
      .map((r, i) => {
        const p = map.get(r.id);
        if (!p || !canonical(p.url)) return "";
        const links = validPostLinks(p.links)
          ? p.links.map((link) => `- ${link.source}: ${link.url}`).join("\n")
          : "";
        return `## ${i + 1}. ${markdownText(p.author)}\n\n${markdownText(p.text)}${p.quotedText ? "\n\n" + markdownText(p.quotedText) : ""}\n\n[Original post](${p.url})\n\n${markdownText(links)}\n`;
      })
      .join("\n")
  );
}
export function diagnostic(
  run:
    | { state: string; phase: string; feeds: unknown; postIds: string[] }
    | undefined,
) {
  return JSON.stringify(
    run
      ? {
          state: run.state,
          phase: run.phase,
          counts: run.postIds.length,
          feeds: run.feeds,
        }
      : { state: "idle" },
    null,
    2,
  );
}
