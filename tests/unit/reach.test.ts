import { expect, it, vi } from "vitest";
import { matchesReach, viewFollowerRatio } from "../../src/shared/reach";
import { extract, engagement } from "../../src/content/adapter";
import { followerLookup, renderedFollowers } from "../../src/content/followers";
import { mergePost } from "../../src/storage/db";
import { validatePost } from "../../src/shared/types";
import { card, post } from "../fixtures/data";

it("filters at the exact ratio boundary and keeps unknown metrics distinct from zero views", () => {
  expect(matchesReach({ views: 200, followers: 100 }, 2)).toBe(true);
  expect(matchesReach({ views: 199, followers: 100 }, 2)).toBe(false);
  expect(matchesReach({ views: 1000, followers: 100 }, 10)).toBe(true);
  expect(viewFollowerRatio({ views: 0, followers: 100 })).toBe(0);
  for (const metrics of [
    {},
    { views: 200 },
    { views: 200, followers: 0 },
    { views: NaN, followers: 5 },
  ]) {
    expect(viewFollowerRatio(metrics)).toBeNull();
    expect(matchesReach(metrics, 2)).toBe(false);
    expect(matchesReach(metrics, 0)).toBe(true);
  }
});
it("extracts only the outer tweet's views and parses large counts", () => {
  document.body.innerHTML = card(
    "100",
    "Outer",
    `<div role="link">${card("200", "Quote", '<a href="/example/status/200/analytics"><span>99K</span></a>')}</div><a href="/example/status/100/analytics" aria-label="2.5M views"></a>`,
  );
  expect(
    extract(document.querySelector("article")!, "following", "run")?.views,
  ).toBe(2500000);
  expect(engagement("1,234,567")).toBe(1234567);
  expect(engagement("1.2B")).toBe(1200000000);
});
it("reads followers only for the matching author and prefers exact titles", () => {
  document.body.innerHTML =
    '<a href="/someone/followers">99K Followers</a><a href="/example/verified_followers"><span title="1,234">1.2K</span> Followers</a>';
  expect(renderedFollowers(document, "Example")).toBe(1234);
  expect(renderedFollowers(document, "missing")).toBeNull();
});
it("opens an author hover card once and reuses its count during the scan", async () => {
  document.body.innerHTML = card("100", "Post");
  const author =
    document.querySelector<HTMLAnchorElement>('a[href="/example"]')!;
  const hover = vi.fn(() => {
    const popup = document.createElement("div");
    popup.innerHTML = '<a href="/example/followers">500 Followers</a>';
    document.body.append(popup);
  });
  author.addEventListener("mouseover", hover);
  const lookup = followerLookup(document, new AbortController().signal);
  expect(await lookup("example", Date.now() + 2000)).toBe(500);
  expect(await lookup("example", Date.now() + 2000)).toBe(500);
  expect(hover).toHaveBeenCalledTimes(1);
});
it("keeps old archives valid, validates new counts, and preserves known metrics on an incomplete rescan", () => {
  expect(validatePost(post())).toBe(true);
  expect(validatePost(post("100", { views: -1 }))).toBe(false);
  expect(validatePost(post("100", { followers: Infinity }))).toBe(false);
  expect(validatePost(post("100", { views: 1000, followers: 500 }))).toBe(true);
  expect(
    mergePost(
      post("100", { views: 1000, followers: 500 }),
      post("100", { views: 2000, followers: null }),
    ),
  ).toMatchObject({ views: 2000, followers: 500 });
});

it("reads the outer role=link analytics counter without taking a quoted post's count", () => {
  document.body.innerHTML = card(
    "100",
    "Outer",
    `<div role="link"><div data-testid="User-Name">Quoted Author</div><a role="link" href="/quoted/status/200/analytics"><span>99K</span></a></div><a role="link" href="/example/status/100/analytics?source=feed"><span title="123,456">123K</span></a>`,
  );
  expect(
    extract(document.querySelector("article")!, "following", "run")?.views,
  ).toBe(123456);
});
it("reads aria-labelled views on the post's own link", () => {
  document.body.innerHTML = card(
    "100",
    "Outer",
    '<a role="link" href="/example/status/100/analytics" aria-label="2.5M views. View post analytics"></a>',
  );
  expect(
    extract(document.querySelector("article")!, "following", "run")?.views,
  ).toBe(2500000);
});
it("reads compact follower text and accessible labels while excluding verified-only counts", () => {
  document.body.innerHTML =
    '<a href="/example/verified_followers">12 Verified Followers</a><a href="/example/followers"><span>34.5K</span><span>Followers</span></a>';
  expect(renderedFollowers(document, "example")).toBe(34500);
  document.body.innerHTML =
    '<a href="/example/followers" aria-label="34.5K Followers"></a>';
  expect(renderedFollowers(document, "example")).toBe(34500);
});
it("dispatches pointer hover events to profile-card listeners and dismisses the card", async () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  document.body.innerHTML = card("100", "Post");
  const author =
    document.querySelector<HTMLAnchorElement>('a[href="/example"]')!;
  const leave = vi.fn();
  author.addEventListener("pointerover", () => {
    const popup = document.createElement("div");
    popup.innerHTML = '<a href="/example/followers">800Followers</a>';
    document.body.append(popup);
  });
  author.addEventListener("pointerout", leave);
  try {
    expect(
      await followerLookup(document, new AbortController().signal)(
        "example",
        Date.now() + 2000,
      ),
    ).toBe(800);
    expect(leave).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});
