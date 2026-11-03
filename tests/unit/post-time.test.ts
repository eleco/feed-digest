import { describe, it, expect } from "vitest";
import { link, postTime } from "../../src/ui/common";

describe("post time labels", () => {
  const now = new Date(2026, 9, 2, 9, 30).getTime();
  it("shows only the time for today", () => {
    expect(postTime(new Date(2026, 9, 2, 6, 5).getTime(), now)).toMatch(
      /^06:05$/,
    );
  });
  it("marks yesterday explicitly", () => {
    expect(postTime(new Date(2026, 9, 1, 20, 7).getTime(), now)).toMatch(
      /^Yesterday 20:07$/,
    );
  });
  it("includes the date for older posts and the year when it differs", () => {
    const older = postTime(new Date(2026, 8, 28, 8, 0).getTime(), now);
    expect(older).toContain("28");
    expect(older).not.toContain("2026");
    expect(postTime(new Date(2025, 11, 31, 8, 0).getTime(), now)).toContain(
      "2025",
    );
  });
});

describe("links", () => {
  it("opens http and https post links safely and rejects other schemes", () => {
    for (const url of ["http://example.com/a", "https://example.com/a"]) {
      const a = link("example.com/a", url);
      expect(a.href).toBe(url);
      expect(a.target).toBe("_blank");
      expect(a.rel).toBe("noopener noreferrer");
    }
    expect(() => link("x", "javascript:alert(1)")).toThrow("Unsafe URL");
  });
});
