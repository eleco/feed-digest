import { expect, it } from "vitest";
import { inDateRange, localDateTime } from "../../src/shared/date-filter";
it("filters inclusively by publication time, with open bounds and unknown dates", () => {
  expect(inDateRange(100, 100, 200)).toBe(true);
  expect(inDateRange(200, 100, 200)).toBe(true);
  expect(inDateRange(99, 100, 200)).toBe(false);
  expect(inDateRange(201, 100, 200)).toBe(false);
  expect(inDateRange(null, 100, 200)).toBe(false);
  expect(inDateRange(null, null, null)).toBe(true);
  expect(inDateRange(100, null, 200)).toBe(true);
  expect(inDateRange(200, 100, null)).toBe(true);
  expect(inDateRange(150, 200, 100)).toBe(false);
  expect(inDateRange(150, NaN, 200)).toBe(false);
});
it("formats date/time controls in local time", () => {
  const date = new Date(2026, 8, 28, 9, 5, 3);
  expect(localDateTime(date.getTime())).toBe("2026-09-28T09:05:03");
  expect(new Date(localDateTime(date.getTime())).getTime()).toBe(
    date.getTime(),
  );
});
