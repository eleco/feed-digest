import { expect, it } from "vitest";
import { topRecommendedAssets } from "../../src/shared/recommended-assets";
import type { Ranked } from "../../src/shared/types";
function item(id: string, recommendations: Ranked["recommendations"]): Ranked {
  return {
    id,
    recommendations,
    mode: "ai",
    score: 50,
    takeaway: "",
    reason: "",
    flags: [],
  };
}
it("counts distinct posts, normalises tickers, and separates buy and sell calls", () => {
  const first = item("1", [
    { asset: "$btc", kind: "crypto", action: "buy" },
    { asset: " BTC ", kind: "crypto", action: "buy" },
    { asset: "BTC", kind: "crypto", action: "sell" },
  ]);
  expect(
    topRecommendedAssets([
      first,
      first,
      item("2", [{ asset: "btc", kind: "crypto", action: "sell" }]),
    ]),
  ).toEqual([{ asset: "BTC", kind: "crypto", posts: 2, buys: 1, sells: 2 }]);
});
it("keeps asset types separate and caps the ranking at ten with deterministic ties", () => {
  const rows = topRecommendedAssets([
    ...Array.from({ length: 12 }, (_, n) =>
      item(String(n), [
        {
          asset: `ASSET${String(n).padStart(2, "0")}`,
          kind: "stock",
          action: "buy",
        },
      ]),
    ),
    item("extra", [{ asset: "ASSET11", kind: "stock", action: "buy" }]),
  ]);
  expect(rows).toHaveLength(10);
  expect(rows[0]).toMatchObject({ asset: "ASSET11", posts: 2 });
  expect(rows[1].asset).toBe("ASSET00");
  expect(
    topRecommendedAssets([
      item("a", [
        { asset: "ABC", kind: "stock", action: "buy" },
        { asset: "ABC", kind: "crypto", action: "buy" },
      ]),
    ]),
  ).toHaveLength(2);
});
it("ignores unchecked, empty, and non-AI results", () => {
  expect(
    topRecommendedAssets([
      item("1", undefined),
      item("2", []),
      {
        ...item("3", [{ asset: "BTC", kind: "crypto", action: "buy" }]),
        mode: "basic",
      },
    ]),
  ).toEqual([]);
});
