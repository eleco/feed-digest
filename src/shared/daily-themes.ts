import { categoryLabel } from "./categories";
import type { Post, Ranked } from "./types";

export interface DailyTheme {
  id: string;
  label: string;
  postIds: string[];
}
export const topics: [string, string, RegExp][] = [
  [
    "ai",
    "AI & machine learning",
    /\b(ai|artificial intelligence|llms?|chatgpt|claude|machine learning|openai)\b/i,
  ],
  [
    "crypto",
    "Crypto & digital assets",
    /\b(bitcoin|btc|ethereum|eth|crypto|blockchain|defi|stablecoins?)\b/i,
  ],
  [
    "markets",
    "Markets & investing",
    /\b(stocks?|investing|investors?|trading|equities|bonds?|inflation|interest rates?|earnings|nasdaq|s&p)\b/i,
  ],
  [
    "software",
    "Software & building products",
    /\b(software|coding|developers?|programming|github|javascript|typescript|apps?|saas)\b/i,
  ],
  [
    "politics",
    "Politics & world affairs",
    /\b(elections?|government|president|parliament|geopolitics|war|congress|policy)\b/i,
  ],
  [
    "health",
    "Health & wellbeing",
    /\b(health|medical|medicine|fitness|nutrition|sleep|workout|mental health)\b/i,
  ],
  [
    "business",
    "Business & startups",
    /\b(startups?|founders?|entrepreneurs?|business|marketing|fundraising|venture capital)\b/i,
  ],
  [
    "science",
    "Science & space",
    /\b(science|scientists?|physics|biology|nasa|space|researchers?)\b/i,
  ],
  [
    "energy",
    "Energy & climate",
    /\b(energy|climate|solar|renewables?|oil|emissions|electric vehicles?)\b/i,
  ],
];

/** Calendar day in the reader's local timezone; unknown publication dates stay out. */
export function dailyThemes(
  posts: Post[],
  items: Ranked[],
  now = Date.now(),
  semantic: Map<string, string[]> = new Map(),
) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = [
    ...new Map(
      posts
        .filter(
          (post) =>
            post.publishedAt !== null &&
            post.publishedAt >= start.getTime() &&
            post.publishedAt <= now,
        )
        .map((post) => [post.id, post]),
    ).values(),
  ];
  const ranked = new Map(items.map((item) => [item.id, item]));
  const groups = new Map<string, DailyTheme>();
  const add = (id: string, label: string, postId: string) => {
    if (!groups.has(id)) groups.set(id, { id, label, postIds: [] });
    groups.get(id)!.postIds.push(postId);
  };
  for (const post of today) {
    const assigned = semantic.get(post.id);
    if (assigned !== undefined) {
      for (const id of assigned) {
        const topic = topics.find(([topicId]) => topicId === id);
        if (topic) add(id, topic[1], post.id);
      }
      if (!assigned.length) add("other", "Other conversations", post.id);
      continue;
    }
    const text = `${post.text}\n${post.quotedText ?? ""}`.replace(
      /https?:\/\/\S+/gi,
      "",
    );
    const matches = topics.filter(([, , pattern]) => pattern.test(text));
    if (matches.length) {
      for (const [id, label] of matches) add(id, label, post.id);
    } else {
      const item = ranked.get(post.id);
      const labels =
        item?.mode === "ai"
          ? item.sectors?.filter((sector) => sector !== "other")
          : [];
      if (labels?.length) {
        for (const sector of labels)
          add(`sector-${sector}`, categoryLabel(sector), post.id);
      } else add("other", "Other conversations", post.id);
    }
  }
  const themes = [...groups.values()].sort(
    (a, b) =>
      Number(a.id === "other") - Number(b.id === "other") ||
      b.postIds.length - a.postIds.length ||
      a.label.localeCompare(b.label),
  );
  return { posts: today, themes };
}
