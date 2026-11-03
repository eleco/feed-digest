export type PostLink = { url: string; source: "post" | "quote" };
export function safePostUrl(value: string): string | null {
  if (value.length > 2048) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function validPostLinks(value: unknown): value is PostLink[] {
  return (
    Array.isArray(value) &&
    value.length <= 20 &&
    value.every(
      (link) =>
        link &&
        typeof link.url === "string" &&
        safePostUrl(link.url) !== null &&
        ["post", "quote"].includes(link.source),
    )
  );
}
