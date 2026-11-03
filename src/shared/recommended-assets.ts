import type { Ranked } from "./types";

type Recommendation = NonNullable<Ranked["recommendations"]>[number];
export function topRecommendedAssets(items: Ranked[]) {
  const assets = new Map<
    string,
    {
      asset: string;
      kind: Recommendation["kind"];
      posts: Set<string>;
      buys: Set<string>;
      sells: Set<string>;
    }
  >();
  for (const item of items) {
    if (item.mode !== "ai") continue;
    for (const recommendation of item.recommendations ?? []) {
      const asset = recommendation.asset
        .trim()
        .replace(/^\$/, "")
        .replace(/\s+/g, " ")
        .toUpperCase();
      if (!asset) continue;
      const key = `${recommendation.kind}:${asset}`;
      let row = assets.get(key);
      if (!row) {
        row = {
          asset,
          kind: recommendation.kind,
          posts: new Set(),
          buys: new Set(),
          sells: new Set(),
        };
        assets.set(key, row);
      }
      row.posts.add(item.id);
      (recommendation.action === "buy" ? row.buys : row.sells).add(item.id);
    }
  }
  return [...assets.values()]
    .map((row) => ({
      asset: row.asset,
      kind: row.kind,
      posts: row.posts.size,
      buys: row.buys.size,
      sells: row.sells.size,
    }))
    .sort(
      (a, b) =>
        b.posts - a.posts ||
        b.buys - a.buys ||
        a.asset.localeCompare(b.asset) ||
        a.kind.localeCompare(b.kind),
    )
    .slice(0, 10);
}
