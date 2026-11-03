import "./reader.css";
import {
  parseReaderSnapshot,
  type ReaderSnapshot,
  type ReaderPost,
} from "../src/shared/online-reader";
import { categoryLabel, sectors } from "../src/shared/categories";
let snapshot: ReaderSnapshot | undefined;
const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const text = (tag: string, value: string, className = "") => {
  const node = document.createElement(tag);
  node.textContent = value;
  node.className = className;
  return node;
};
const search = $<HTMLInputElement>("#search"),
  when = $<HTMLSelectElement>("#when"),
  sort = $<HTMLSelectElement>("#sort"),
  sector = $<HTMLSelectElement>("#sector"),
  pins = $<HTMLInputElement>("#pins"),
  links = $<HTMLInputElement>("#links");
for (const label of sectors) {
  const option = document.createElement("option");
  option.value = label;
  option.textContent = categoryLabel(label);
  sector.append(option);
}
function link(label: string, url: string) {
  const node = text("a", label) as HTMLAnchorElement;
  node.href = url;
  node.target = "_blank";
  node.rel = "noopener noreferrer";
  return node;
}
function card(post: ReaderPost) {
  const node = document.createElement("article");
  node.dataset.postId = post.id;
  const byline = text("div", `${post.author} · @${post.handle}`, "byline");
  byline.append(
    text(
      "time",
      post.publishedAt === null
        ? "Undated"
        : new Date(post.publishedAt).toLocaleString(),
    ),
  );
  node.append(byline, text("p", post.text, "post-text"));
  if (post.quotedText) node.append(text("blockquote", post.quotedText));
  const tags = text("div", "", "tags");
  for (const label of [...post.sectors, ...post.tones])
    tags.append(text("span", categoryLabel(label)));
  if (post.pinned) tags.append(text("span", "Pinned"));
  if (post.score === null) tags.append(text("span", "Not analysed"));
  node.append(tags);
  const footer = document.createElement("footer");
  footer.append(link("Open on X ↗", post.url));
  for (const url of post.links)
    footer.append(link(new URL(url).hostname + " ↗", url));
  node.append(footer);
  return node;
}
function render() {
  const query = search.value.trim().toLowerCase();
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const now = Date.now();
  const from =
    when.value === "today"
      ? midnight.getTime()
      : when.value === "week"
        ? now - 7 * 86400000
        : null;
  const posts = (snapshot?.posts ?? []).filter(
    (post) =>
      (!query ||
        `${post.text} ${post.quotedText ?? ""} ${post.author} ${post.handle}`
          .toLowerCase()
          .includes(query)) &&
      (!pins.checked || post.pinned) &&
      (!links.checked || post.links.length > 0) &&
      (sector.value === "all" || post.sectors.includes(sector.value)) &&
      (from === null ||
        (post.publishedAt !== null &&
          post.publishedAt >= from &&
          post.publishedAt <= now)),
  );
  posts.sort((a, b) => {
    if (sort.value === "insight") return (b.score ?? -1) - (a.score ?? -1);
    if (a.publishedAt === null || b.publishedAt === null)
      return Number(a.publishedAt === null) - Number(b.publishedAt === null);
    return sort.value === "oldest"
      ? a.publishedAt - b.publishedAt
      : b.publishedAt - a.publishedAt;
  });
  $("#count").textContent =
    `${posts.length} of ${snapshot?.posts.length ?? 0} posts`;
  $("#posts").replaceChildren(...posts.map(card));
  if (!posts.length)
    $("#posts").append(
      text(
        "p",
        snapshot?.posts.length
          ? "No posts match these filters."
          : "Upload your saved posts from the Chrome extension to start reading here.",
        "empty",
      ),
    );
}
async function load() {
  const response = await fetch("/api/reader?data=1", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok)
    throw Error(
      response.status === 401
        ? "Sign in again to load your posts."
        : "Could not load your posts. Check the reader setup.",
    );
  const data = await response.json();
  snapshot = data.empty ? undefined : parseReaderSnapshot(data);
  $("#snapshotDate").textContent = snapshot
    ? `Updated ${new Date(snapshot.exportedAt).toLocaleString()}`
    : "Your online collection is empty.";
  render();
}
for (const input of [search, when, sort, sector, pins, links])
  input.addEventListener("input", render);
$<HTMLInputElement>("#upload").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  input.disabled = true;
  $("#status").textContent = "Uploading your saved posts…";
  try {
    if (file.size > 4_000_000)
      throw Error("Choose an export smaller than 4 MB.");
    const response = await fetch("/api/reader?data=1", {
      method: "PUT",
      headers: { "Content-Type": "application/gzip" },
      body: file,
      credentials: "same-origin",
    });
    if (!response.ok) throw Error(await response.text());
    await load();
    $("#status").textContent = "Your online collection is updated.";
  } catch (error) {
    $("#status").textContent =
      error instanceof Error ? error.message : "Upload failed.";
  } finally {
    input.disabled = false;
    input.value = "";
  }
});
void load().catch((error) => {
  $("#snapshotDate").textContent = "";
  $("#status").textContent = error.message;
});
