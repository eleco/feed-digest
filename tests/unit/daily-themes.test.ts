import { expect, it } from "vitest";
import { dailyThemes } from "../../src/shared/daily-themes";
import { post } from "../fixtures/data";

it("groups today's distinct posts across themes, including quotes, and excludes other days and unknown dates", () => {
  const now = new Date(2026, 9, 2, 14).getTime();
  const today = new Date(2026, 9, 2, 0).getTime();
  const ai = post("1", { text: "AI software is changing", publishedAt: today });
  const result = dailyThemes(
    [
      ai,
      ai,
      post("2", {
        text: "A note",
        quotedText: "Bitcoin trading",
        publishedAt: now,
      }),
      post("3", { text: "AI", publishedAt: today - 1 }),
      post("4", { text: "AI", publishedAt: null }),
      post("5", { text: "AI", publishedAt: now + 1 }),
    ],
    [],
    now,
  );
  expect(result.posts.map((p) => p.id)).toEqual(["1", "2"]);
  expect(result.themes.find((t) => t.id === "ai")?.postIds).toEqual(["1"]);
  expect(result.themes.find((t) => t.id === "crypto")?.postIds).toEqual(["2"]);
  expect(result.themes.find((t) => t.id === "markets")?.postIds).toEqual(["2"]);
});
it("uses AI categories as a fallback and retains unmatched conversations", () => {
  const now = Date.now();
  const result = dailyThemes(
    [
      post("1", { text: "A championship final", publishedAt: now }),
      post("2", { text: "A quiet afternoon", publishedAt: now }),
    ],
    [
      {
        id: "1",
        mode: "ai",
        sectors: ["sports"],
        score: 1,
        takeaway: "",
        reason: "",
        flags: [],
      },
    ],
    now,
  );
  expect(result.themes.map((t) => t.id)).toEqual(["sector-sports", "other"]);
  expect(dailyThemes([], [], now).themes).toEqual([]);
});
