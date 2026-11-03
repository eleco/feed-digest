import { expect, it } from "vitest";
import {
  defaultDigestFilters,
  filterDigest,
  readDigestFilters,
} from "../../src/shared/digest-filters";
import { post } from "../fixtures/data";
import type { Ranked } from "../../src/shared/types";
const posts = [
  post("1", { text: "Same text!", handle: "Example" }),
  post("2", { text: "same TEXT https://example.com", handle: "example" }),
  post("3", { text: "Different", handle: "example" }),
  post("4", { text: "", handle: "another" }),
  post("5", { text: "", handle: "another" }),
];
const items: Ranked[] = posts.map((p, i) => ({
  id: p.id,
  score: i === 0 || i === 3 ? 10 : 90,
  mode: i === 3 ? "basic" : "ai",
  takeaway: p.text,
  reason: "",
  flags: [],
}));
const feedback = [{ id: "2", handle: "example", value: "not-useful" as const }];
const ids = (filters = defaultDigestFilters, order = items) =>
  filterDigest(order, posts, feedback, filters).map((p) => p.id);
it("defaults to all visible and ignores invalid stored values", () => {
  expect(ids()).toEqual(["1", "2", "3", "4", "5"]);
  expect(readDigestFilters({ lowScores: "true", repeatedText: true })).toEqual({
    ...defaultDigestFilters,
    repeatedText: true,
  });
});
it("applies each visibility switch independently without dropping unscored or empty-text posts", () => {
  expect(ids({ ...defaultDigestFilters, lowScores: true })).toEqual([
    "2",
    "3",
    "4",
    "5",
  ]);
  expect(ids({ ...defaultDigestFilters, repeatedText: true })).toEqual([
    "1",
    "3",
    "4",
    "5",
  ]);
  expect(ids({ ...defaultDigestFilters, repeatedAuthors: true })).toEqual([
    "1",
    "2",
    "4",
    "5",
  ]);
  expect(ids({ ...defaultDigestFilters, notUseful: true })).toEqual([
    "1",
    "3",
    "4",
    "5",
  ]);
});
it("combines filters after ordering without excluded posts consuming author or duplicate slots", () => {
  expect(
    ids({
      lowScores: true,
      repeatedText: true,
      repeatedAuthors: true,
      notUseful: true,
    }),
  ).toEqual(["3", "4", "5"]);
  expect(
    ids({ ...defaultDigestFilters, repeatedText: true }, [...items].reverse()),
  ).toEqual(["5", "4", "3", "2"]);
  expect(items).toHaveLength(5);
});

it("hides literal blacklisted text case-insensitively in posts and quotes", () => {
  const sample = [
    post("1", { text: "A SPAM offer" }),
    post("2", { text: "Normal", quotedText: "spam inside a quote" }),
    post("3", { text: "A clean post" }),
  ];
  const ranked = sample.map((p) => ({ ...items[0], id: p.id }));
  expect(
    filterDigest(ranked, sample, [], defaultDigestFilters, [" Spam ", ""]).map(
      (p) => p.id,
    ),
  ).toEqual(["3"]);
  expect(
    filterDigest(ranked, sample, [], defaultDigestFilters, [".*"]),
  ).toHaveLength(3);
  expect(
    filterDigest(ranked, sample, [], defaultDigestFilters, []),
  ).toHaveLength(3);
});
