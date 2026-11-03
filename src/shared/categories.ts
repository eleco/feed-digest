export const sectors = [
  "finance",
  "health",
  "technology",
  "business",
  "science",
  "politics",
  "education",
  "energy",
  "real-estate",
  "entertainment",
  "sports",
  "lifestyle",
  "other",
] as const;
export const tones = [
  "humour",
  "dramatic",
  "informative",
  "analytical",
  "optimistic",
  "critical",
  "promotional",
  "neutral",
] as const;
export type Sector = (typeof sectors)[number];
export type Tone = (typeof tones)[number];
export const categoryLabel = (value: string) =>
  value.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
