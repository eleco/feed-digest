import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
test("Vercel static site renders on desktop and mobile; sample feed filters work", async () => {
  const root = resolve("site-dist");
  const server = createServer(async (req, res) => {
    try {
      const path = resolve(
        root,
        "." + (req.url === "/" ? "/index.html" : (req.url ?? "/index.html")),
      );
      if (!path.startsWith(root + "/")) throw Error();
      const data = await readFile(path);
      res.setHeader(
        "Content-Type",
        (
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
          } as Record<string, string>
        )[extname(path)] ?? "application/octet-stream",
      );
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const address = server.address() as { port: number };
  const browser = await chromium.launch({ channel: "chromium" });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    await page.goto(`http://127.0.0.1:${address.port}`);
    await expect(
      page.getByRole("heading", { name: "Good ideas. A little less noise." }),
    ).toBeVisible();
    await expect(page.getByText(/export|upload|online reader/i)).toHaveCount(0);
    const removedReader = await page.request.get(
      `http://127.0.0.1:${address.port}/reader.html`,
    );
    expect(removedReader.status()).toBe(404);
    await page.getByRole("button", { name: "Following", exact: true }).click();
    await expect(page.locator("article:visible")).toHaveCount(1);
    await page.getByRole("button", { name: "All posts", exact: true }).click();
    await page.screenshot({ path: "docs/site-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: "docs/site-mobile.png", fullPage: true });
  } finally {
    await browser.close();
    await new Promise<void>((res) => server.close(() => res()));
  }
});
