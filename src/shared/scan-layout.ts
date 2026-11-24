// X picks its layout from the page width after browser zoom. Below roughly
// 1,000 CSS pixels it drops the feed column's test id and doubles tab labels,
// so the scan window is sized to give X at least this many CSS pixels.
export const SCAN_PAGE_WIDTH = 1280;
// Allowance for a vertical scrollbar, which media queries include.
export const WINDOW_FRAME = 16;
export const DIGEST_MIN_WIDTH = 420;

/** Scan window width for a screen of `screenWidth` at X's `zoom` factor. */
export function scanWindowWidth(screenWidth: number, zoom = 1) {
  return Math.min(
    screenWidth,
    Math.max(
      Math.ceil(SCAN_PAGE_WIDTH * zoom) + WINDOW_FRAME,
      Math.round(screenWidth * 0.6),
    ),
  );
}

/** Whether the live digest still fits beside a scan window of this width. */
export const digestFits = (screenWidth: number, scanWidth: number) =>
  screenWidth - scanWidth >= DIGEST_MIN_WIDTH;
