import { test, expect, type BrowserContext } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";
import { serveReader } from "../../server/node-reader";
import { readerSnapshot } from "../../src/shared/online-reader";
import { post } from "../fixtures/data";
let server: Server,
  base: string,
  saved: Uint8Array | null,
  context: BrowserContext;
test.beforeEach(async ({ browser }) => {
  saved = null;
  server = createServer((req, res) => {
    const path = req.url?.split("?")[0];
    if (path?.startsWith("/assets/")) {
      void readFile(resolve("site-dist" + path)).then((bytes) => {
        res.setHeader(
          "Content-Type",
          path.endsWith(".css") ? "text/css" : "application/javascript",
        );
        res.end(bytes);
      });
      return;
    }
    void serveReader(
      req,
      res,
      {
        read: async () => saved,
        write: async (value) => {
          saved = value;
        },
      },
      () => readFile("site-dist/reader.html", "utf8"),
      { READER_USERNAME: "reader", READER_PASSWORD: "test-password" },
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  context = await browser.newContext({
    httpCredentials: { username: "reader", password: "test-password" },
  });
});
test.afterEach(async () => {
  await context.close();
  await new Promise<void>((done) => server.close(() => done()));
});
test("Basic Auth protects the online reader and uploads support mobile filters without executing post HTML", async () => {
  const denied = await fetch(base + "/reader");
  expect(denied.status).toBe(401);
  expect(denied.headers.get("www-authenticate")).toContain("Basic");
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/reader");
  await expect(page.locator("#count")).toHaveText("0 of 0 posts");
  const posts = [
    post("100", {
      text: '<img src=x onerror="window.hacked=true">',
      pinned: true,
      publishedAt: Date.now() - 1000,
    }),
    post("200", {
      text: "An older post with a link",
      publishedAt: Date.now() - 86400000,
      links: [{ url: "https://example.org/report", source: "post" }],
    }),
  ];
  const snapshot = readerSnapshot(posts, []);
  await page
    .locator("#upload")
    .setInputFiles({
      name: "posts.json.gz",
      mimeType: "application/gzip",
      buffer: gzipSync(JSON.stringify(snapshot)),
    });
  await expect(page.locator("#status")).toHaveText(
    "Your online collection is updated.",
  );
  await expect(page.locator("article")).toHaveCount(2);
  expect(await page.evaluate(() => "hacked" in window)).toBe(false);
  await expect(page.locator("article img")).toHaveCount(0);
  await page.getByLabel("Only pinned posts").check();
  await expect(page.locator("article")).toHaveCount(1);
  await page.getByLabel("Only posts with links").check();
  await expect(page.locator("article")).toHaveCount(0);
  await page.getByLabel("Only pinned posts").uncheck();
  await expect(page.locator("article")).toHaveCount(1);
  await page.getByLabel("Only posts with links").uncheck();
  await page.getByLabel("When", { exact: true }).selectOption("today");
  await expect(page.locator("article")).toHaveCount(1);
  await page.getByLabel("When", { exact: true }).selectOption("all");
  await page.getByLabel("Search", { exact: true }).fill("older");
  await expect(page.locator("article")).toHaveAttribute("data-post-id", "200");
  await page.reload();
  await expect(page.locator("article")).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/online-reader-mobile.png",
    fullPage: true,
  });
});
