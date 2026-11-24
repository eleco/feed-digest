import { describe, it, expect } from "vitest";
import { digestFits, scanWindowWidth } from "../../src/shared/scan-layout";

describe("scan window layout", () => {
  it("gives X 1,280 CSS pixels at 100% zoom and keeps the digest beside it", () => {
    expect(scanWindowWidth(1800)).toBe(1296);
    expect(digestFits(1800, 1296)).toBe(true);
  });
  it("widens for zoom so X still gets its full layout", () => {
    // The live failure: 125% zoom made a 1,080 px window an 864 px page.
    const width = scanWindowWidth(1800, 1.25);
    expect(width).toBe(1616);
    expect((width - 16) / 1.25).toBeGreaterThanOrEqual(1280);
    expect(digestFits(1800, width)).toBe(false);
  });
  it("uses 60% of large screens and never exceeds the screen", () => {
    expect(scanWindowWidth(2560)).toBe(1536);
    expect(scanWindowWidth(1280, 1.5)).toBe(1280);
  });
});
