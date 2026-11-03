import type { Post, Run } from "../../src/shared/types";
import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm, cp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { card, post as fixturePost, run as fixtureRun } from "../fixtures/data";
let context: BrowserContext, profile: string, base: string;
let fixtureHtml: string;
let externalRequests: string[];
const fixture = `<!doctype html><html lang="en"><body><button data-testid="SideNav_AccountSwitcher_Button">Synthetic @fixture</button><main data-testid="primaryColumn"><div role="tablist"><button role="tab" data-feed="following" aria-selected="false">Following</button><button role="tab" data-feed="for-you" aria-selected="true">For you</button></div><section id="feed">${card("900", "Outgoing cards must not be labelled as Following.")}</section></main><script>
const feeds={following:${JSON.stringify(card("100", "Synthetic shared post: keep a record of observations before drawing conclusions.") + card("200", "This synthetic architecture note explains how a shaded courtyard moderates temperature."))},'for-you':${JSON.stringify(card("100", "Synthetic shared post: keep a record of observations before drawing conclusions.") + card("300", "A synthetic cooking note: weighing flour can improve the consistency of a bread recipe."))}};
for(const tab of document.querySelectorAll('[role=tab]'))tab.onclick=()=>{for(const t of document.querySelectorAll('[role=tab]'))t.setAttribute('aria-selected',String(t===tab));setTimeout(()=>{document.querySelector('#feed').innerHTML=feeds[tab.dataset.feed]},250)};
</script></body></html>`;
async function stores(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open("x-feed-digest", 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const values: Record<string, unknown[]> = {};
    for (const name of [
      "posts",
      "runs",
      "digests",
      "feedback",
      "meta",
      "cache",
    ])
      values[name] = await new Promise((res, rej) => {
        const r = db.transaction(name).objectStore(name).getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    db.close();
    return values;
  });
}
async function analyseCollected(page: Page) {
  await expect
    .poll(
      async () => {
        const runs = (await stores(page)).runs as {
          state: string;
          postIds: string[];
        }[];
        return (
          runs.length > 0 &&
          runs.every((r) => r.state !== "collecting" && r.state !== "ranking")
        );
      },
      { timeout: 20000 },
    )
    .toBe(true);
  const response = await page.evaluate(() =>
    chrome.runtime.sendMessage({ op: "analyse" }),
  );
  expect(response.ok).toBe(true);
}
test.beforeEach(async ({}, testInfo) => {
  fixtureHtml = fixture;
  externalRequests = [];
  profile = await mkdtemp(join(tmpdir(), "xfd-test-"));
  let path = resolve("dist");
  if (
    testInfo.title.includes("pregranted") ||
    testInfo.title.includes("stale manifest")
  ) {
    path = join(profile, "fixture-extension");
    await cp(resolve("dist"), path, { recursive: true });
    const manifest = JSON.parse(
      await readFile(join(path, "manifest.json"), "utf8"),
    );
    const providerOrigin = testInfo.title.includes("Jev")
      ? "https://api.typesafe.ai/*"
      : testInfo.title.includes("Claude")
        ? "https://api.anthropic.com/*"
        : "https://openrouter.ai/*";
    if (!testInfo.title.includes("stale manifest"))
      manifest.host_permissions.push(providerOrigin);
    manifest.optional_host_permissions =
      manifest.optional_host_permissions.filter(
        (x: string) => x !== providerOrigin,
      );
    await writeFile(join(path, "manifest.json"), JSON.stringify(manifest));
  }
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
  });
  await context.route("https://**/*", async (route) => {
    externalRequests.push(new URL(route.request().url()).origin);
    if (
      new URL(route.request().url()).origin === "https://x.com" &&
      new URL(route.request().url()).pathname === "/home"
    )
      await route.fulfill({
        contentType: "text/html",
        body: fixtureHtml.replaceAll(
          "2026-09-20T10:00:00Z",
          new Date(Date.now() - 3600000).toISOString(),
        ),
      });
    else await route.abort();
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  base = "chrome-extension://" + new URL(worker.url()).host;
});
test.afterEach(async () => {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
});
test("loads settings and popup; scans both feeds, deduplicates, gives feedback and deletes all data", async () => {
  const settings = await context.newPage();
  await settings.goto(base + "/settings.html");
  await expect(
    settings.getByRole("heading", { name: "Make it your kind of read." }),
  ).toBeVisible();
  await settings.locator("#maxPosts").fill("2");
  await expect(settings.locator("#saveStatus")).toContainText("Changes saved");

  const popup = await context.newPage();
  await popup.goto(base + "/popup.html");
  // Stop only appears while a scan or analysis is running.
  await expect(
    popup.getByRole("button", { name: "Stop", exact: true }),
  ).toBeHidden();
  await popup
    .getByRole("button", { name: "Scan both feeds", exact: true })
    .click();
  await expect
    .poll(
      async () => {
        const s = await stores(settings);
        const r = s.runs[0] as {
          state: string;
          reason: string;
          phase: string;
          postIds: string[];
          settings: { maxPosts: number };
        };
        return r?.state === "completed"
          ? "completed"
          : `${r?.state}: ${r?.reason}; phase=${r?.phase}; count=${r?.postIds?.length}; cap=${r?.settings?.maxPosts}`;
      },
      { timeout: 20000 },
    )
    .toBe("completed");
  const data = await stores(settings);
  expect(data.posts).toHaveLength(3);
  const shared = data.posts.find((p) => (p as { id: string }).id === "100") as {
    observations: unknown[];
  };
  expect(shared.observations).toHaveLength(2);
  expect(data.posts.some((p) => (p as { id: string }).id === "900")).toBe(
    false,
  );
  const run = data.runs[0] as { feeds: Record<string, { count: number }> };
  expect(run.feeds.following.count).toBe(2);
  expect(run.feeds["for-you"].count).toBe(2);
  const digest = context
    .pages()
    .find((p) => p.url() === base + "/digest.html")!;
  await expect(digest.locator("article")).toHaveCount(3);
  expect(externalRequests.every((origin) => origin === "https://x.com")).toBe(
    true,
  );
  await digest.screenshot({
    path: "docs/extension-digest.png",
    fullPage: true,
  });
  await digest
    .getByRole("button", { name: "Not useful", exact: true })
    .first()
    .click();
  await expect(digest.locator("article")).toHaveCount(3);
  await settings
    .getByText("I want to permanently remove all posts", { exact: false })
    .click();
  await Promise.all([
    settings.waitForEvent("domcontentloaded"),
    settings
      .getByRole("button", { name: "Delete all data", exact: true })
      .click(),
  ]);
  await expect
    .poll(async () => Object.values(await stores(settings)).flat().length)
    .toBe(0);
  expect(
    await settings.evaluate(async () =>
      Object.keys(await chrome.storage.session.get(null)),
    ),
  ).toEqual([]);
  expect(await settings.evaluate(async () => chrome.alarms.getAll())).toEqual(
    [],
  );
});
test("cancels without closing unrelated tabs and rejects double starts", async () => {
  const page = await context.newPage();
  await page.goto(base + "/popup.html");
  const unrelated = await context.newPage();
  await unrelated.goto("about:blank");
  const starts = await page.evaluate(async () =>
    Promise.all([
      chrome.runtime.sendMessage({ op: "start" }),
      chrome.runtime.sendMessage({ op: "start" }),
    ]),
  );
  expect(starts.filter((r) => r.ok)).toHaveLength(1);
  await page.evaluate(() => chrome.runtime.sendMessage({ op: "stop" }));
  await expect
    .poll(async () => ((await stores(page)).runs[0] as { state: string }).state)
    .toBe("cancelled");
  expect(unrelated.isClosed()).toBe(false);
  expect((await stores(page)).runs).toHaveLength(1);
});
test("keys stay in trusted storage; Basic makes no model calls; saving preferences clears legacy scheduling", async () => {
  const page = await context.newPage();
  await page.goto(base + "/settings.html");
  await page.locator("#provider").selectOption("openrouter");
  await page.locator("#apiKey").fill("synthetic-test-key");
  await page.getByRole("button", { name: "Save key", exact: true }).click();
  await expect(page.locator("#notice")).toContainText("Key saved");
  expect(
    await page.evaluate(async () =>
      Object.keys(await chrome.storage.local.get(null)),
    ),
  ).not.toContain("key:openrouter");
  expect(
    await page.evaluate(
      async () =>
        (await chrome.storage.session.get("key:openrouter"))["key:openrouter"],
    ),
  ).toBe("synthetic-test-key");
  await page.getByRole("button", { name: "Remove keys", exact: true }).click();
  await expect(page.locator("#notice")).toContainText("Keys removed");
  expect(
    await page.evaluate(
      async () =>
        (await chrome.storage.session.get("key:openrouter"))["key:openrouter"],
    ),
  ).toBeUndefined();
  await page.locator("#provider").selectOption("basic");
  await expect(
    page.getByRole("heading", { name: "Scan settings" }),
  ).toBeVisible();
  await expect(page.locator("#daily, #time, #allowFocus")).toHaveCount(0);
  await page.evaluate(async () => {
    const stored = (await chrome.storage.local.get("settings"))
      .settings as Record<string, unknown>;
    await chrome.storage.local.set({
      settings: { ...stored, daily: true, time: "09:00", allowFocus: true },
    });
  });
  await page.locator("#maxPosts").fill("1000");
  await expect(page.locator("#saveStatus")).toContainText("Changes saved");

  // Legacy scheduling fields are dropped on save; no alarm runs while idle.
  const saved = await page.evaluate(
    async () => (await chrome.storage.local.get("settings")).settings,
  );
  for (const legacy of ["daily", "time", "allowFocus"])
    expect(saved).not.toHaveProperty(legacy);
  expect(await page.evaluate(() => chrome.alarms.getAll())).toEqual([]);
  expect((await stores(page)).runs).toEqual([]);
});
test("settings autosave rapid edits, reject invalid limits and persist after reload", async () => {
  const page = await context.newPage();
  await page.goto(base + "/settings.html");
  await expect(
    page.getByRole("button", { name: "Save preferences", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator(
      "#exclusions, #authors, #interests, #requestsPerScan, #requestsPerDay, #inputTokens, #outputTokens",
    ),
  ).toHaveCount(0);
  await page.locator("#maxPosts").fill("500");
  await page.locator("#maxPosts").fill("1000");
  await page.locator("#maxSteps").fill("100");
  await page.locator("#hideImages").check();
  await expect(page.locator("#saveStatus")).toContainText("Changes saved");
  await page.locator("#maxPosts").fill("1001");
  await expect(page.locator("#saveStatus")).toContainText("Not saved");
  await page.locator("#maxSeconds").fill("60");
  await expect
    .poll(async () =>
      page.evaluate(
        async () => (await chrome.storage.local.get("settings")).settings,
      ),
    )
    .toMatchObject({
      maxSeconds: 60,
      maxPosts: 1000,
      maxSteps: 100,
      hideImages: true,
    });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Post filters", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#maxPosts")).toHaveValue("1000");
  await expect(page.locator("#maxSteps")).toHaveValue("100");
  await expect(page.locator("#hideImages")).toBeChecked();
});
test("renders hostile text as inert text and exports escaped Markdown", async () => {
  const page = await context.newPage();
  await page.goto(base + "/digest.html");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res) => {
      const r = indexedDB.open("x-feed-digest", 1);
      r.onsuccess = () => res(r.result);
    });
    const tx = db.transaction(
      ["posts", "runs", "digests", "meta"],
      "readwrite",
    );
    const p = {
      id: "100",
      url: "https://x.com/example/status/100",
      handle: "example",
      author: "Synthetic Author",
      text: "<img src=x onerror=alert(1)>",
      publishedAt: null,
      collectedAt: Date.now(),
      observations: [{ runId: "synthetic", feed: "following", at: Date.now() }],
      quotedText: null,
      truncated: true,
    };
    tx.objectStore("posts").put(p);
    tx.objectStore("runs").put({
      id: "synthetic",
      state: "completed",
      phase: "finished",
      postIds: ["100"],
      startedAt: Date.now(),
      updatedAt: Date.now(),
      feeds: {
        following: { count: 1, skipped: 0, reason: "limit" },
        "for-you": { count: 0, skipped: 0, reason: "none" },
      },
    });
    tx.objectStore("meta").put({ id: "current", runId: "synthetic" });
    tx.objectStore("digests").put({
      id: "synthetic",
      createdAt: Date.now(),
      mode: "Basic ranking — no AI analysis",
      notices: [],
      items: [
        {
          id: "100",
          score: 80,
          takeaway: p.text,
          reason: "Synthetic test",
          flags: [],
          mode: "basic",
        },
      ],
    });
    await new Promise<void>((res) => {
      tx.oncomplete = () => res();
    });
    db.close();
  });
  await page.getByLabel("When", { exact: true }).selectOption("all");
  await expect(page.locator("article")).toHaveCount(1);
  await expect(page.locator("article img")).toHaveCount(0);
  await expect(page.locator("article .excerpt").first()).toHaveText(
    "<img src=x onerror=alert(1)>",
  );
});

test("one unavailable feed produces a partial digest while the other completes", async () => {
  fixtureHtml = fixture.replace(
    ">Following</button>",
    ">Unsupported label</button>",
  );
  const page = await context.newPage();
  await page.goto(base + "/settings.html");
  await page.locator("#maxPosts").fill("1");
  await expect(page.locator("#saveStatus")).toContainText("Changes saved");
  await page.evaluate(() => chrome.runtime.sendMessage({ op: "start" }));
  await expect
    .poll(
      async () => ((await stores(page)).runs[0] as { state: string })?.state,
      { timeout: 20000 },
    )
    .toBe("partial");
  const data = await stores(page);
  expect(data.posts).toHaveLength(1);
  const run = data.runs[0] as {
    feeds: Record<string, { count: number; complete: boolean }>;
  };
  expect(run.feeds.following.complete).toBe(false);
  expect(run.feeds["for-you"].count).toBe(1);
});

test("expired leases interrupt the run and reject late content messages", async () => {
  const page = await context.newPage();
  await page.goto(base + "/popup.html");
  await page.evaluate(
    async (expired) => {
      const tab = await chrome.tabs.create({
        url: "https://x.com/home",
        active: false,
      });
      const session = await chrome.storage.session.get("browserSession");
      if (!session.browserSession) {
        session.browserSession = crypto.randomUUID();
        await chrome.storage.session.set({
          browserSession: session.browserSession,
        });
      }
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("x-feed-digest", 1);
        request.onsuccess = () => resolve(request.result);
      });
      const tx = db.transaction(["runs", "meta"], "readwrite");
      tx.objectStore("runs").put({
        ...expired,
        browserSession: session.browserSession,
        tabId: tab.id,
      });
      tx.objectStore("meta").put({ id: "current", runId: expired.id });
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      db.close();
    },
    fixtureRun({ state: "collecting", leaseUntil: 0, postIds: [] }),
  );
  await page.evaluate(() => chrome.runtime.sendMessage({ op: "recover" }));
  await expect
    .poll(async () => ((await stores(page)).runs[0] as { state: string }).state)
    .toBe("interrupted");
  const run = (await stores(page)).runs[0] as { id: string };
  await page.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: "https://x.com/*" });
    await Promise.all(tabs.map((tab) => chrome.tabs.remove(tab.id!)));
  });
  const other = await context.newPage();
  await other.goto("https://x.com/home");
  const result = await page.evaluate(async (runId) => {
    const tabs = await chrome.tabs.query({ url: "https://x.com/*" });
    return chrome.scripting.executeScript({
      target: { tabId: tabs[0].id! },
      func: async (id: string) =>
        chrome.runtime.sendMessage({
          op: "batch",
          runId: id,
          feed: "following",
          posts: [],
        }),
      args: [runId],
    });
  }, run.id);
  expect(result[0].result.ok).toBe(false);
  expect((await stores(page)).posts).toEqual([]);
});

test("content scripts cannot read keys and an account change cannot mix data", async () => {
  const page = await context.newPage();
  await page.goto(base + "/settings.html");
  await page.evaluate(async () => {
    await chrome.storage.session.set({ "key:openrouter": "synthetic-key" });
    await chrome.storage.local.set({
      "key:openai": "synthetic-persistent-key",
    });
  });
  const x = await context.newPage();
  await x.goto("https://x.com/home");
  const reads = await page.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: "https://x.com/*" });
    return chrome.scripting.executeScript({
      target: { tabId: tabs[0].id! },
      func: async () => {
        const results = [];
        for (const store of [chrome.storage.local, chrome.storage.session]) {
          try {
            results.push(await store.get(null));
          } catch {
            results.push("denied");
          }
        }
        return results;
      },
    });
  });
  expect(reads[0].result).toEqual(["denied", "denied"]);
  await page.locator("#maxPosts").fill("1");
  await expect(page.locator("#saveStatus")).toContainText("Changes saved");
  await page.evaluate(() => chrome.runtime.sendMessage({ op: "start" }));
  await expect
    .poll(
      async () => ((await stores(page)).runs[0] as { state: string })?.state,
      { timeout: 20000 },
    )
    .toBe("completed");
  const before = (await stores(page)).posts.length;
  fixtureHtml = fixture.replace("@fixture", "@another");
  await page.evaluate(() => chrome.runtime.sendMessage({ op: "start" }));
  await expect
    .poll(
      async () =>
        ((await stores(page)).runs as { state: string }[]).some(
          (r) => r.state === "blocked",
        ),
      { timeout: 20000 },
    )
    .toBe(true);
  expect((await stores(page)).posts).toHaveLength(before);
});

test("pregranted fixture provider makes direct mocked extension requests and produces AI output", async () => {
  let generations = 0;
  await context.route("https://openrouter.ai/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/models")
      return route.fulfill({
        json: {
          data: [
            {
              id: "fixture/free",
              name: "Synthetic free model",
              pricing: { prompt: "0", completion: "0", request: "0" },
            },
          ],
        },
      });
    if (path === "/api/v1/key")
      return route.fulfill({ json: { data: { label: "fixture" } } });
    if (path === "/api/v1/chat/completions") {
      generations++;
      const body = route.request().postDataJSON();
      expect(body.provider.allow_fallbacks).toBe(false);
      expect(body.messages[0].content).not.toContain("synthetic-key");
      return route.fulfill({
        json: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    {
                      id: "c0",
                      score: 90,
                      recommendations: [],
                      takeaway: "Synthetic model takeaway.",
                      reason: "Contains concrete observations.",
                      flags: ["Not independently verified"],
                    },
                  ],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 30 },
        },
      });
    }
    await route.abort();
  });
  const page = await context.newPage();
  await page.goto(base + "/settings.html");
  await page.locator("#provider").selectOption("openrouter");
  await page.locator("#apiKey").fill("synthetic-key");
  await page.getByRole("button", { name: "Save key", exact: true }).click();
  await expect(page.locator("#notice")).toContainText("Key saved");
  await expect(
    page.getByRole("button", {
      name: "Allow provider & refresh models",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Check connection", exact: true })
    .click();
  await expect(page.locator("#connectionStatus")).toContainText("Connected.");
  await expect(page.locator("#model")).toHaveValue("fixture/free");

  await page.locator("#maxPosts").fill("2");
  await expect(page.locator("#saveStatus")).toContainText("Changes saved");

  await page.evaluate(() => chrome.runtime.sendMessage({ op: "start" }));
  await analyseCollected(page);
  await expect
    .poll(
      async () =>
        (await stores(page)).digests.some((d) =>
          (d as { items: { mode: string }[] }).items.some(
            (i) => i.mode === "ai",
          ),
        ),
      { timeout: 20000 },
    )
    .toBe(true);
  await expect.poll(() => generations).toBe(1);
  const digest = (await stores(page)).digests.find((d) =>
    (d as { items: { mode: string }[] }).items.some((i) => i.mode === "ai"),
  ) as {
    items: { mode: string }[];
    tokens: number;
  };
  expect(digest.items.some((i) => i.mode === "ai")).toBe(true);
  expect(digest.tokens).toBe(130);
});

test("worker restart preserves committed batches and the single run lease", async () => {
  const page = await context.newPage();
  await page.goto(base + "/settings.html");
  await page.locator("#maxPosts").fill("2");
  await expect(page.locator("#saveStatus")).toContainText("Changes saved");
  await page.evaluate(() => chrome.runtime.sendMessage({ op: "start" }));
  await expect
    .poll(async () => (await stores(page)).posts.length, {
      intervals: [100],
      timeout: 10000,
    })
    .toBeGreaterThanOrEqual(2);
  const before = await stores(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await page.evaluate(() => chrome.runtime.sendMessage({ op: "recover" }));
  const after = await stores(page);
  expect(after.runs).toHaveLength(1);
  expect(after.posts.length).toBeGreaterThanOrEqual(before.posts.length);
  expect((after.runs[0] as { id: string }).id).toBe(
    (before.runs[0] as { id: string }).id,
  );
  await page.evaluate(() => chrome.runtime.sendMessage({ op: "stop" }));
});

test("a configured scroll cap stops both feeds without runaway scrolling", async () => {
  const page = await context.newPage();
  await page.goto(base + "/settings.html");
  await page.locator("#maxSteps").fill("1");
  await expect(page.locator("#saveStatus")).toContainText("Changes saved");
  await page.evaluate(() => chrome.runtime.sendMessage({ op: "start" }));
  await expect
    .poll(
      async () => ((await stores(page)).runs[0] as { state: string })?.state,
      { timeout: 20000 },
    )
    .toBe("completed");
  const run = (await stores(page)).runs[0] as {
    feeds: Record<string, { steps: number; reason: string }>;
  };
  for (const result of Object.values(run.feeds)) {
    expect(result.steps).toBe(1);
    expect(result.reason).toBe("Scroll limit reached");
  }
});

test("a browser-session change never closes a tab referenced by an old numeric ID", async () => {
  const page = await context.newPage();
  await page.goto(base + "/popup.html");
  await page.evaluate(() => chrome.runtime.sendMessage({ op: "recover" }));
  // Seed the state restored from an old session, without a live collector racing it.
  const staleRun = fixtureRun({
    state: "collecting",
    phase: "Reading feeds",
    postIds: [],
    browserSession: "previous-browser-session",
  });
  const unrelatedId = await page.evaluate(async (staleRun) => {
    const unrelated = await chrome.tabs.create({
      url: "about:blank",
      active: false,
    });
    const db = await new Promise<IDBDatabase>((res) => {
      const r = indexedDB.open("x-feed-digest", 1);
      r.onsuccess = () => res(r.result);
    });
    const tx = db.transaction(["runs", "meta"], "readwrite");
    tx.objectStore("runs").put({ ...staleRun, tabId: unrelated.id });
    tx.objectStore("meta").put({ id: "current", runId: staleRun.id });
    await new Promise<void>((res) => {
      tx.oncomplete = () => res();
    });
    db.close();
    return unrelated.id!;
  }, staleRun);
  await page.evaluate(() => chrome.runtime.sendMessage({ op: "recover" }));
  expect(
    await page.evaluate(
      async (id) => (await chrome.tabs.get(id)).id,
      unrelatedId,
    ),
  ).toBe(unrelatedId);
  expect(((await stores(page)).runs[0] as { state: string }).state).toBe(
    "interrupted",
  );
});

function addFixtureImages() {
  // Images are data URLs: the test cannot download real media.
  const image =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  fixtureHtml = fixture.replace(
    "</script>",
    `
    const decorate = () => {
      for (const article of document.querySelectorAll('article')) {
        if (article.querySelector('[data-fixture-photo]')) continue;
        const photo = document.createElement('div');
        photo.dataset.testid = 'tweetPhoto';
        const img = document.createElement('img');
        img.src = '${image}'; img.width = 80; img.height = 60;
        img.dataset.fixturePhoto = ''; photo.append(img); article.append(photo);
        const avatar = img.cloneNode(); avatar.removeAttribute('data-fixture-photo');
        avatar.dataset.fixtureAvatar = ''; article.prepend(avatar);
        const emoji = img.cloneNode(); emoji.removeAttribute('data-fixture-photo');
        emoji.dataset.fixtureEmoji = ''; emoji.width = 16; emoji.height = 16;
        article.querySelector('[data-testid="tweetText"]').append(emoji);
      }
    };
    decorate();
    new MutationObserver(decorate).observe(document.querySelector('#feed'), {childList:true,subtree:true});
  </script>`,
  );
}

for (const hideImages of [false, true]) {
  test(`image hiding ${hideImages ? "enabled" : "disabled"} preserves both-feed extraction and other reading tabs`, async () => {
    addFixtureImages();
    const page = await context.newPage();
    await page.goto(base + "/settings.html");
    await expect(page.locator("#hideImages")).not.toBeChecked();
    await page.locator("#hideImages").setChecked(hideImages);
    await page.locator("#maxSteps").fill("1");
    await expect(page.locator("#saveStatus")).toContainText("Changes saved");

    await page.reload();
    await expect(page.locator("#hideImages")).toBeChecked({
      checked: hideImages,
    });
    const reading = await context.newPage();
    await reading.goto("https://x.com/home");
    await expect(reading.locator("[data-fixture-photo]")).toBeVisible();
    await page.evaluate(() => chrome.runtime.sendMessage({ op: "start" }));
    await expect
      .poll(async () => (await stores(page)).posts.length, {
        intervals: [100],
        timeout: 10000,
      })
      .toBe(2);
    const scan = context
      .pages()
      .find((p) => p !== reading && p.url() === "https://x.com/home")!;
    await expect(scan.locator("[data-fixture-photo]").first()).toBeVisible({
      visible: !hideImages,
    });
    await expect(scan.locator("[data-fixture-avatar]").first()).toBeVisible({
      visible: !hideImages,
    });
    await expect(scan.locator("[data-fixture-emoji]").first()).toBeVisible();
    await expect(reading.locator("[data-fixture-photo]")).toBeVisible();
    const incoming = scan
      .locator("article")
      .filter({ has: scan.locator('a[href="/example/status/300"]') });
    await expect(incoming).toHaveCount(1);
    await expect(incoming.locator("[data-fixture-photo]")).toBeVisible({
      visible: !hideImages,
    });
    await expect
      .poll(
        async () => ((await stores(page)).runs[0] as { state: string }).state,
        { timeout: 15000 },
      )
      .toBe("completed");
    const data = await stores(page);
    expect(data.posts).toHaveLength(3);
    expect(
      data.posts.find((p) => (p as { id: string }).id === "100"),
    ).toMatchObject({
      text: "Synthetic shared post: keep a record of observations before drawing conclusions.",
      handle: "example",
      mediaOnly: false,
    });
    expect(reading.isClosed()).toBe(false);
    await expect(reading.locator("[data-fixture-photo]")).toBeVisible();
  });
}

test("image hiding is removed when the scan tab leaves home without reloading", async () => {
  addFixtureImages();
  const page = await context.newPage();
  await page.goto(base + "/settings.html");
  await page.locator("#hideImages").check();
  await expect(page.locator("#saveStatus")).toContainText("Changes saved");

  await page.evaluate(() => chrome.runtime.sendMessage({ op: "start" }));
  await expect
    .poll(async () => (await stores(page)).posts.length, {
      intervals: [100],
      timeout: 10000,
    })
    .toBe(2);
  const scan = context.pages().find((p) => p.url() === "https://x.com/home")!;
  await expect(scan.locator("[data-fixture-photo]").first()).toBeHidden();
  await scan.evaluate(() => history.pushState({}, "", "/example"));
  await expect
    .poll(async () => ((await stores(page)).runs[0] as { state: string }).state)
    .toBe("interrupted");
  await expect(scan.locator("[data-fixture-photo]").first()).toBeVisible();
  expect(scan.isClosed()).toBe(false);
  expect((await stores(page)).posts).toHaveLength(2);
});

test("the Following checkpoint advances to the newest post, stops later scans there and can be reset", async () => {
  const page = await context.newPage();
  await page.goto(base + "/settings.html");
  await page.locator("#maxPosts").fill("2");
  await expect(page.locator("#saveStatus")).toContainText("Changes saved");
  const scan = async (count: number) => {
    await page.evaluate(() => chrome.runtime.sendMessage({ op: "start" }));
    await expect
      .poll(
        async () =>
          (await stores(page)).runs.filter(
            (r) => (r as { state: string }).state === "completed",
          ).length,
        { timeout: 20000 },
      )
      .toBe(count);
  };
  const saved = async () =>
    Object.fromEntries(
      (await stores(page)).meta
        .filter((m) => (m as { id: string }).id.startsWith("checkpoint:"))
        .map((m) => [
          (m as { id: string }).id,
          (m as { postId: string; account: string }).postId,
        ]),
    );
  await scan(1);
  // The checkpoint is the newest (top) Following post of the completed scan.
  // For You is not chronological, so it has none.
  expect(await saved()).toEqual({ "checkpoint:following": "100" });
  expect(
    (await stores(page)).meta.find(
      (m) => (m as { id: string }).id === "checkpoint:following",
    ),
  ).toMatchObject({ account: "@fixture" });
  fixtureHtml =
    fixture +
    `<script>feeds.following=${JSON.stringify(card("50") + card("100") + card("200") + card("400"))};feeds['for-you']=${JSON.stringify(card("60") + card("100") + card("300") + card("500"))};</script>`;
  await page.reload();
  await page.locator("#maxPosts").fill("10");
  await expect(page.locator("#saveStatus")).toContainText("Changes saved");
  await scan(2);
  const data = await stores(page);
  const second = data.runs.find(
    (r) => (r as { settings: { maxPosts: number } }).settings.maxPosts === 10,
  ) as {
    postIds: string[];
    feeds: Record<string, { reason: string; steps: number }>;
  };
  // Following collects only posts newer than the previous scan's top post,
  // plus the checkpoint post itself as the overlap. For You reads everything.
  expect(second.postIds).toEqual(["50", "100", "60", "300", "500"]);
  expect(second.feeds.following).toMatchObject({
    reason: "Previous scan checkpoint reached",
    steps: 0,
  });
  expect(second.feeds["for-you"]).toMatchObject({
    reason: "No new posts in three settled scroll cycles",
  });
  // Reaching the checkpoint advances it to this scan's newest post.
  expect(await saved()).toEqual({ "checkpoint:following": "50" });
  // A scan stopped by a limit before reaching the checkpoint still advances
  // it; otherwise every later scan would start even further above it.
  fixtureHtml =
    fixture +
    `<script>feeds.following=${JSON.stringify(card("40") + card("45") + card("50"))};feeds['for-you']=${JSON.stringify(card("55") + card("58") + card("60"))};</script>`;
  await page.reload();
  await page.locator("#maxPosts").fill("1");
  await expect(page.locator("#saveStatus")).toContainText("Changes saved");
  await scan(3);
  expect(await saved()).toEqual({ "checkpoint:following": "40" });
  expect(
    (
      (await stores(page)).runs.find(
        (r) =>
          (r as { settings: { maxPosts: number } }).settings.maxPosts === 1,
      ) as { feeds: Record<string, { reason: string }> }
    ).feeds.following.reason,
  ).toBe("Post limit reached; previous checkpoint not encountered");
  await page
    .getByRole("button", { name: "Reset scan checkpoints", exact: true })
    .click();
  await expect(page.locator("#notice")).toContainText("Scan checkpoints reset");
  expect(
    (await stores(page)).meta.filter((m) =>
      (m as { id: string }).id.startsWith("checkpoint:"),
    ),
  ).toEqual([]);
});

test("digest sorting combines with feed filters and remembers the selected order", async () => {
  const page = await context.newPage();
  await page.goto(base + "/digest.html");
  const posts = [
    fixturePost("100", { publishedAt: null, likes: null }),
    fixturePost("200", {
      publishedAt: 2000,
      comments: 0,
      likes: 100,
      author: "Second Author",
      handle: "second",
    }),
    fixturePost("300", {
      publishedAt: 1000,
      comments: 12,
      likes: 2,
      pinned: true,
      observations: [{ runId: "run", feed: "for-you", at: Date.now() }],
    }),
  ];
  const run = fixtureRun({
    state: "completed",
    phase: "finished",
    postIds: posts.map((p) => p.id),
  });
  const digest = {
    id: "run",
    createdAt: Date.now(),
    mode: "Basic ranking — no AI analysis",
    notices: [],
    items: posts.map((p, i) => ({
      id: p.id,
      score: i === 0 ? 100 : i + 10,
      takeaway: p.text,
      reason: "Synthetic selection",
      flags: [],
      mode: i === 0 ? "basic" : "ai",
    })),
  };
  await page.evaluate(
    async ({ posts, run, digest }) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("x-feed-digest", 1);
        request.onsuccess = () => resolve(request.result);
      });
      const tx = db.transaction(
        ["posts", "runs", "digests", "meta"],
        "readwrite",
      );
      for (const post of posts) tx.objectStore("posts").put(post);
      tx.objectStore("runs").put(run);
      tx.objectStore("digests").put(digest);
      tx.objectStore("meta").put({ id: "current", runId: run.id });
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      db.close();
    },
    { posts, run, digest },
  );
  await page.getByLabel("When", { exact: true }).selectOption("all");
  await expect(page.locator("article.card")).toHaveCount(3);
  const order = () =>
    page
      .locator("article.card")
      .evaluateAll((cards) =>
        cards.map((card) => (card as HTMLElement).dataset.postId),
      );
  await page.getByLabel("Sort posts").selectOption("newest");
  expect(await order()).toEqual(["200", "300", "100"]);
  await page.getByLabel("Sort posts").selectOption("oldest");
  expect(await order()).toEqual(["300", "200", "100"]);
  await page.getByLabel("Sort posts").selectOption("comments");
  expect(await order()).toEqual(["300", "200", "100"]);
  await expect(page.locator('[data-post-id="100"]')).toContainText(
    "— replies · — likes",
  );
  await page.getByRole("button", { name: "Following", exact: true }).click();
  expect(await order()).toEqual(["200", "100"]);
  await expect
    .poll(async () =>
      page.evaluate(
        async () => (await chrome.storage.local.get("digestSort")).digestSort,
      ),
    )
    .toBe("comments");
  await page.reload();
  await expect(page.getByLabel("Sort posts")).toHaveValue("comments");
  await page.getByLabel("When", { exact: true }).selectOption("all");
  await expect(page.locator("article.card")).toHaveCount(3);
  await page.getByLabel("Sort posts").selectOption("likes");
  expect(await order()).toEqual(["200", "300", "100"]);
  await expect(
    page.getByLabel("Sort posts").locator('option[value="pinned"]'),
  ).toHaveCount(0);
  await page.getByLabel("Only pinned posts", { exact: true }).check();
  expect(await order()).toEqual(["300"]);
  await expect(page.locator(".all-authors")).toHaveText("All authors (1)");
  await page.getByLabel("Only posts with links").check();
  await expect(page.locator("article.card")).toHaveCount(0);
  await page.getByLabel("Only posts with links").uncheck();
  await expect(page.locator("article.card")).toHaveCount(1);
  await page.getByRole("button", { name: "Unpin", exact: true }).click();
  await expect(page.locator("article.card")).toHaveCount(0);
  await page.getByLabel("Only pinned posts", { exact: true }).uncheck();
  await page
    .locator('[data-post-id="300"]')
    .getByRole("button", { name: "Pin", exact: true })
    .click();
  await page.getByLabel("Sort posts").selectOption("insight");
  expect(await order()).toEqual(["300", "200", "100"]);
  await expect(page.locator('[data-post-id="300"]')).not.toContainText(
    "AI insight score: 12/100",
  );
  await expect
    .poll(async () =>
      page.evaluate(
        async () => (await chrome.storage.local.get("digestSort")).digestSort,
      ),
    )
    .toBe("insight");
  await page.reload();
  await expect(page.getByLabel("Sort posts")).toHaveValue("insight");
  await page.getByLabel("When", { exact: true }).selectOption("all");
  await expect(page.locator("article.card")).toHaveCount(3);
  expect(await order()).toEqual(["300", "200", "100"]);
  await page.getByLabel("Only pinned posts", { exact: true }).check();
  expect(await order()).toEqual(["300"]);
  await page.getByLabel("Only pinned posts", { exact: true }).uncheck();
  const authors = page.getByRole("region", { name: "Authors", exact: true });
  await authors
    .getByRole("button", { name: /single-post authors hidden/ })
    .click();
  await expect(authors.locator(".author-list button")).toHaveCount(3);
  const authorList = authors.locator(".author-list");
  const authorScroll = await authorList.evaluate((list) => {
    list.style.maxHeight = "40px";
    list.style.overflowY = "auto";
    list.style.display = "grid";
    list.scrollTop = list.scrollHeight;
    return list.scrollTop;
  });
  expect(authorScroll).toBeGreaterThan(0);

  await authors
    .getByRole("button", { name: "Second Author · @second (1)", exact: true })
    .click();
  expect(await order()).toEqual(["200"]);
  await expect
    .poll(() => authorList.evaluate((list) => list.scrollTop))
    .toBe(authorScroll);
  await expect(
    authors.getByRole("button", {
      name: "Second Author · @second (1)",
      exact: true,
    }),
  ).toBeFocused();

  await expect(
    authors.getByRole("button", {
      name: "Second Author · @second (1)",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#visibleCount")).toContainText("@second");
  await page.getByLabel("Only pinned posts", { exact: true }).check();
  await expect(page.locator("article.card")).toHaveCount(0);
  await expect(
    authors.getByRole("button", {
      name: "Second Author · @second (0)",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(authors.locator(".all-authors")).toHaveText("All authors (1)");
  await page.getByLabel("Only pinned posts", { exact: true }).uncheck();
  await expect(
    authors.getByRole("button", {
      name: "Second Author · @second (1)",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");

  await authors
    .getByRole("button", { name: "All authors (3)", exact: true })
    .click();
  expect(await order()).toEqual(["300", "200", "100"]);
});

test("pregranted Claude classifies sectors and tones and surfaces collected links", async () => {
  const financial = card(
    "100",
    "Financial outlook: buy BTC and sell TSLA. A detailed budget comparison explains changing costs.",
    '<a href="https://example.org/report">Source report</a>',
  );
  fixtureHtml =
    fixture +
    `<script>feeds.following=${JSON.stringify(financial + card("200", "Health research: a useful explanation of how clinical studies measure outcomes."))};feeds['for-you']=${JSON.stringify(financial + card("300", "A synthetic cooking note: weighing flour improves consistency."))};</script>`;
  let generations = 0;
  await context.route("https://api.anthropic.com/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    expect(route.request().headers()["x-api-key"]).toBe("synthetic-claude-key");
    if (path.startsWith("/v1/models/"))
      return route.fulfill({ json: { id: "claude-haiku-4-5-20251001" } });
    if (path !== "/v1/messages") return route.abort();
    generations++;
    const body = route.request().postDataJSON();
    expect(body.model).toBe("claude-haiku-4-5-20251001");
    expect(body.messages[0].content).not.toContain("synthetic-claude-key");
    const payload = JSON.parse(
      body.messages[0].content
        .split("UNTRUSTED_DATA_JSON\n")[1]
        .split("\nEND_DATA")[0],
    );
    return route.fulfill({
      json: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              items: payload.posts.map(
                (post: { id: string; text: string }) => ({
                  id: post.id,
                  score: 90,
                  sectors: [
                    post.text.includes("Financial") ? "technology" : "health",
                  ],
                  tones: ["humour"],
                  recommendations: post.text.includes("Financial")
                    ? [
                        { action: "buy", asset: "BTC", kind: "crypto" },
                        { action: "sell", asset: "TSLA", kind: "stock" },
                      ]
                    : [],
                }),
              ),
            }),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });
  });
  const page = await context.newPage();
  await page.goto(base + "/settings.html");
  await page.locator("#provider").selectOption("anthropic");
  await page.locator("#model").selectOption("claude-haiku-4-5-20251001");
  await page.locator("#apiKey").fill("synthetic-claude-key");
  await page.getByRole("button", { name: "Save key", exact: true }).click();
  await expect(page.locator("#notice")).toContainText("Key saved");
  await page
    .getByRole("button", { name: "Check connection", exact: true })
    .click();
  await expect(page.locator("#notice")).toContainText("Provider accepted");
  await page.locator("#maxPosts").fill("2");
  await expect(page.locator("#saveStatus")).toContainText("Changes saved");
  await page.evaluate(() => chrome.runtime.sendMessage({ op: "start" }));
  await analyseCollected(page);
  await expect
    .poll(
      async () =>
        (await stores(page)).digests.some((d) =>
          (d as { items: { mode: string }[] }).items.some(
            (i) => i.mode === "ai",
          ),
        ),
      { timeout: 20000 },
    )
    .toBe(true);
  expect(generations).toBe(1);
  await page.goto(base + "/digest.html");
  await expect(page.locator("article.card")).toHaveCount(3);
  await expect(page.locator(".all-authors")).toHaveText("All authors (3)");
  await page.getByLabel("Sector", { exact: true }).selectOption("finance");
  await page.getByLabel("Tone", { exact: true }).selectOption("humour");
  await expect(page.locator("article.card")).toHaveCount(1);
  await expect(page.locator(".all-authors")).toHaveText("All authors (1)");
  await expect(page.locator("article.card")).not.toContainText(
    "Sector: Finance",
  );
  await page.getByLabel("Only posts with links").check();
  await expect(
    page.locator('article.card a[href="https://example.org/report"]'),
  ).toBeVisible();
  await page.getByLabel("Tone", { exact: true }).selectOption("dramatic");
  await expect(page.locator("article.card")).toHaveCount(0);
  await expect(page.locator(".all-authors")).toHaveText("All authors (0)");
  expect(externalRequests).not.toContain("https://example.org");
  await page.getByLabel("Tone", { exact: true }).selectOption("all");
  await page.getByLabel("Sector", { exact: true }).selectOption("all");
  await expect(page.getByLabel("Buy/sell calls", { exact: true })).toBeHidden();
  await expect(page.getByLabel("Asset type", { exact: true })).toBeHidden();
  await page.getByLabel("Sector", { exact: true }).selectOption("finance");
  await page.getByLabel("Only posts with links").uncheck();
  await expect(page.getByLabel("Buy/sell calls", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Asset type", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Top 10 recommended assets" }),
  ).toBeVisible();
  await expect(page.locator("#recommendedAssets tbody tr")).toHaveCount(2);
  await expect(page.locator("#recommendedAssets tbody tr").first()).toHaveText(
    "BTCCrypto110",
  );
  await expect(page.locator("#recommendedAssets tbody tr").last()).toHaveText(
    "TSLAStock101",
  );
  await page.getByLabel("Tone", { exact: true }).selectOption("dramatic");
  await expect(page.locator("#recommendedAssets tbody tr")).toHaveCount(2);
  await page.getByLabel("Tone", { exact: true }).selectOption("all");
  await page.getByLabel("Sector", { exact: true }).selectOption("all");
  await expect(page.locator("#recommendedAssets")).toBeHidden();
  await expect(page.locator("article.card")).toHaveCount(3);
  await expect(page.locator(".all-authors")).toHaveText("All authors (3)");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() => document.fonts.check('500 30px "Newsreader"')),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/digest-2a-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".digest-rail")).toBeHidden();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(page.locator(".digest-rail")).toBeVisible();
  await page.getByLabel("Filter authors").fill("example");
  await expect(
    page.locator(".author-list button[data-author=example]"),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/digest-2a-mobile-filters.png",
    fullPage: true,
  });
  await page.locator(".drawer-close").click();
  await expect(page.locator(".digest-rail")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/digest-2a-mobile.png",
    fullPage: true,
  });
});

test("pregranted Claude connection shows loading, errors, timeout and retry success inline", async () => {
  const page = await context.newPage();
  await page.goto(base + "/settings.html");
  await page.locator("#provider").selectOption("anthropic");
  const check = page.getByRole("button", {
    name: "Check connection",
    exact: true,
  });
  const status = page.locator("#connectionStatus");
  await check.click();
  await expect(status).toContainText("Choose a model first");
  await page.locator("#model").selectOption("claude-haiku-4-5-20251001");
  await check.click();
  await expect(status).toContainText("Enter your API key");
  await page.locator("#apiKey").fill("synthetic-claude-key");
  await page.getByRole("button", { name: "Save key", exact: true }).click();
  await expect(page.locator("#notice")).toContainText("Key saved");
  let requests = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route("https://api.anthropic.com/**", async (route) => {
    requests++;
    if (requests === 1) {
      await gate;
      await route.fulfill({
        status: 401,
        json: { error: "synthetic rejection" },
      });
    } else if (requests === 2) await route.abort("failed");
    else if (requests === 3) {
      await new Promise((resolve) => setTimeout(resolve, 16000));
      await route
        .fulfill({ json: { id: "claude-haiku-4-5-20251001" } })
        .catch(() => {});
    } else await route.fulfill({ json: { id: "claude-haiku-4-5-20251001" } });
  });
  await check.click();
  const busy = page.getByRole("button", { name: "Checking…", exact: true });
  await expect(busy).toBeDisabled();
  await expect(busy).toHaveAttribute("aria-busy", "true");
  await expect(busy.locator(".spinner")).toBeVisible();
  await expect(status).toContainText("Checking the saved key");
  await expect.poll(() => requests).toBe(1);
  release();
  await expect(status).toContainText("HTTP 401");
  await expect(check).toBeEnabled();
  await check.click();
  await expect(status).toContainText("Could not reach the provider");
  await check.click();
  await expect(status).toContainText("timed out after 15 seconds", {
    timeout: 20000,
  });
  await expect(check).toBeEnabled();
  await check.click();
  await expect(status).toContainText("Connected.");
  await expect(status).toHaveAttribute("data-state", "success");
  await expect(check).toBeEnabled();
  expect(requests).toBe(4);
});

test("pregranted Claude visible analysis submits only matching pending posts and all-saved analysis is explicit", async () => {
  const page = await context.newPage();
  await page.goto(base + "/settings.html");
  await expect(page.locator("#enabled, #paid, #payload")).toHaveCount(0);
  const digest = await context.newPage();
  await digest.goto(base + "/digest.html");
  await expect(
    digest.getByRole("checkbox", { name: "Enable online analysis" }),
  ).toHaveCount(0);
  await expect(
    digest.getByRole("button", {
      name: "Analyse with AI (0)",
      exact: true,
    }),
  ).toBeDisabled();
  await page.locator("#provider").selectOption("anthropic");
  await page.locator("#model").selectOption("claude-haiku-4-5-20251001");
  await page.locator("#apiKey").fill("synthetic-claude-key");
  await context.route("https://api.anthropic.com/v1/models/**", (route) =>
    route.fulfill({ json: { id: "claude-haiku-4-5-20251001" } }),
  );
  let generations = 0;
  await context.route(
    "https://api.anthropic.com/v1/messages",
    async (route) => {
      generations++;
      const prompt = route.request().postDataJSON().messages[0].content;
      const payload = JSON.parse(
        prompt.split("UNTRUSTED_DATA_JSON\n")[1].split("\nEND_DATA")[0],
      );
      expect(payload.posts).toHaveLength(generations === 1 ? 1 : 2);
      await route.fulfill({
        json: {
          content: [
            {
              type: "text",
              text:
                "```json\n" +
                JSON.stringify({
                  items: payload.posts.map((p: { id: string }) => ({
                    id: p.id,
                    score: 80,
                    recommendations: [],
                    takeaway: "Text",
                    reason: "Reason",
                    flags: [],
                    sectors: ["finance"],
                    tones: ["analytical"],
                  })),
                }) +
                "\n```",
            },
          ],
          usage: { input_tokens: 100, output_tokens: 20 },
        },
      });
    },
  );
  await page
    .getByRole("button", { name: "Check connection", exact: true })
    .click();
  await expect(page.locator("#connectionStatus")).toContainText("Connected.");
  await page.locator("#maxPosts").fill("2");
  await expect(page.locator("#saveStatus")).toContainText("Changes saved");
  await page.evaluate(async () => {
    const saved = (await chrome.storage.local.get("settings"))
      .settings as Record<string, unknown>;
    await chrome.storage.local.set({ settings: { ...saved, enabled: true } });
  });
  await digest
    .getByRole("button", { name: "Scan both feeds ↗", exact: true })
    .click();
  await expect(digest.locator("article.card")).toHaveCount(3, {
    timeout: 20000,
  });
  expect(generations).toBe(0);
  const xRequests = externalRequests.filter(
    (o) => o === "https://x.com",
  ).length;
  await digest.getByLabel("Only posts with links").check();
  await expect(digest.locator("article.card")).toHaveCount(0);
  await expect(digest.locator("#analysisWarning")).toContainText(
    "3 unanalysed posts hidden",
  );
  await expect(digest.locator("#analysisWarning")).toContainText(
    "may use paid AI credits",
  );
  await expect(
    digest.getByRole("button", {
      name: "Analyse with AI (0)",
      exact: true,
    }),
  ).toBeDisabled();
  await digest.getByLabel("Only posts with links").uncheck();
  const todayPostId = await digest
    .locator("article.card")
    .first()
    .getAttribute("data-post-id");
  await digest.evaluate(async (todayPostId) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("x-feed-digest", 1);
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction("posts", "readwrite");
    const store = tx.objectStore("posts");
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.update({
        ...cursor.value,
        publishedAt:
          cursor.value.id === todayPostId
            ? midnight.getTime()
            : midnight.getTime() - 1,
      });
      cursor.continue();
    };
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
  }, todayPostId);
  await digest.reload();
  await digest.getByLabel("When", { exact: true }).selectOption("today");
  await expect(digest.locator("article.card")).toHaveCount(1);
  await expect(digest.locator("article.card")).toHaveAttribute(
    "data-post-id",
    todayPostId!,
  );
  await expect(digest.locator("#analysisWarning")).toContainText(
    "2 before your start date",
  );
  await digest
    .getByRole("button", { name: "Pin", exact: true })
    .first()
    .click();
  await digest.getByLabel("Only pinned posts", { exact: true }).check();
  await expect(digest.locator("article.card")).toHaveCount(1);
  await digest.getByLabel("Only posts with links").check();
  await expect(digest.locator("article.card")).toHaveCount(0);
  await expect(
    digest.getByRole("button", { name: "Analyse with AI (0)", exact: true }),
  ).toBeDisabled();
  await digest
    .getByRole("button", { name: "Analyse today's posts (1)", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await stores(page)).runs.some(
          (r) =>
            (r as { analysisOnly?: boolean; state: string }).analysisOnly &&
            (r as { state: string }).state === "completed",
        ),
      { timeout: 20000 },
    )
    .toBe(true);
  expect(generations).toBe(1);
  expect(externalRequests.filter((o) => o === "https://x.com").length).toBe(
    xRequests,
  );
  const data = await stores(page);
  expect(data.runs).toHaveLength(2);
  const analysed = data.digests.find((d) =>
    (d as { items: { mode: string }[] }).items.every((i) => i.mode === "ai"),
  ) as { items: unknown[] };
  expect(analysed.items).toHaveLength(1);
  const firstRun = data.runs.find(
    (r) => (r as { analysisOnly?: boolean }).analysisOnly,
  ) as { postIds: string[] };
  expect(firstRun.postIds).toHaveLength(1);
  expect(firstRun.postIds).toEqual([todayPostId]);
  await expect(
    digest.getByRole("button", {
      name: "Analyse today's posts (0)",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    digest.getByRole("button", {
      name: "Analyse with AI (0)",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    digest.getByRole("button", {
      name: "Analyse all saved posts (2)",
      exact: true,
    }),
  ).toBeEnabled();
  digest.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("2 unanalysed posts hidden");
    await dialog.dismiss();
  });
  await digest
    .getByRole("button", { name: "Analyse all saved posts (2)", exact: true })
    .click();
  expect((await stores(page)).runs).toHaveLength(2);
  digest.once("dialog", (dialog) => dialog.accept());
  await digest
    .getByRole("button", { name: "Analyse all saved posts (2)", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await stores(page)).runs.filter(
          (r) =>
            (r as { analysisOnly?: boolean; state: string }).analysisOnly &&
            (r as { state: string }).state === "completed",
        ).length,
    )
    .toBe(2);
  const finalRuns = (await stores(page)).runs as {
    analysisOnly?: boolean;
    postIds: string[];
  }[];
  const secondRun = finalRuns.find(
    (r) => r.analysisOnly && r.postIds.length === 2,
  )!;
  expect(secondRun.postIds).not.toContain(firstRun.postIds[0]);
  expect(generations).toBe(2);
  const popup = await context.newPage();
  await popup.goto(base + "/popup.html");
  await expect(
    popup.getByRole("button", {
      name: "Open digest",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    popup.getByRole("checkbox", { name: "Enable online analysis" }),
  ).toHaveCount(0);
});

test("pregranted Claude connection reports declined permission and requests only its provider", async () => {
  const page = await context.newPage();
  await page.goto(base + "/settings.html");
  await page.locator("#provider").selectOption("anthropic");
  await page.locator("#model").selectOption("claude-haiku-4-5-20251001");
  await page.locator("#apiKey").fill("synthetic-claude-key");
  await page.getByRole("button", { name: "Save key", exact: true }).click();
  await expect(page.locator("#notice")).toContainText("Key saved");
  await page.evaluate(() => {
    chrome.permissions.request = async (permission) => {
      const inGesture = navigator.userActivation.isActive;
      await chrome.storage.session.set({
        fixturePermission: { origins: permission.origins, inGesture },
      });
      return false;
    };
  });
  await page
    .getByRole("button", { name: "Check connection", exact: true })
    .click();
  await expect(page.locator("#connectionStatus")).toContainText(
    "Provider access was not allowed",
  );
  expect(
    await page.evaluate(
      async () =>
        (await chrome.storage.session.get("fixturePermission"))
          .fixturePermission,
    ),
  ).toEqual({ origins: ["https://api.anthropic.com/*"], inGesture: true });
  await expect(
    page.getByRole("button", { name: "Check connection", exact: true }),
  ).toBeEnabled();
  expect(externalRequests).not.toContain("https://api.anthropic.com");
});

test("stale manifest Claude access shows an actionable reload message without requesting undeclared permissions", async () => {
  const page = await context.newPage();
  await page.goto(base + "/settings.html");
  await page.locator("#provider").selectOption("anthropic");
  await page.locator("#model").selectOption("claude-haiku-4-5-20251001");
  await page.evaluate(() => {
    chrome.permissions.request = async () => {
      throw Error("Unexpected permission request");
    };
  });
  await page
    .getByRole("button", { name: "Check connection", exact: true })
    .click();
  await expect(page.locator("#connectionStatus")).toContainText(
    "does not declare access to api.anthropic.com",
  );
  await expect(page.locator("#connectionStatus")).toContainText("dist folder");
  await expect(
    page.getByRole("button", { name: "Open extension manager", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy permission details", exact: true }),
  ).toBeVisible();
});

test("pregranted Claude manifest rejection reports loaded-copy troubleshooting", async () => {
  const page = await context.newPage();
  await page.goto(base + "/settings.html");
  await page.locator("#provider").selectOption("anthropic");
  await page.locator("#model").selectOption("claude-haiku-4-5-20251001");
  await page.evaluate(() => {
    chrome.permissions.request = async () => {
      throw Error(
        "Only permissions specified in the manifest may be requested.",
      );
    };
  });
  await page
    .getByRole("button", { name: "Check connection", exact: true })
    .click();
  await expect(page.locator("#connectionStatus")).toContainText(
    "despite the loaded manifest declaring it",
  );
  await expect(
    page.getByRole("button", { name: "Copy permission details", exact: true }),
  ).toBeVisible();
});

test("pregranted Claude connection tests the entered key instead of a stale saved key", async () => {
  const page = await context.newPage();
  await page.goto(base + "/settings.html");
  await page.locator("#provider").selectOption("anthropic");
  await page.locator("#model").selectOption("claude-haiku-4-5-20251001");
  await page.locator("#apiKey").fill("synthetic-old-key");
  await page.getByRole("button", { name: "Save key", exact: true }).click();
  await expect(page.locator("#notice")).toContainText("Key saved");
  let accepted = false;
  await context.route("https://api.anthropic.com/**", async (route) => {
    expect(route.request().headers()["x-api-key"]).toBe("synthetic-new-key");
    await route.fulfill(
      accepted
        ? { json: { id: "claude-haiku-4-5-20251001" } }
        : { status: 401, json: { error: "synthetic rejection" } },
    );
  });
  await page.locator("#apiKey").fill("  synthetic-new-key  ");
  const check = page.getByRole("button", {
    name: "Check connection",
    exact: true,
  });
  await check.click();
  await expect(page.locator("#connectionStatus")).toContainText(
    "api.anthropic.com",
  );
  await expect(page.locator("#connectionStatus")).toContainText("HTTP 401");
  expect(
    await page.evaluate(
      async () =>
        (await chrome.storage.session.get("key:anthropic"))["key:anthropic"],
    ),
  ).toBe("synthetic-old-key");
  accepted = true;
  await check.click();
  await expect(page.locator("#connectionStatus")).toContainText("Connected.");
  await expect(page.locator("#apiKey")).toHaveValue("");
  expect(
    await page.evaluate(
      async () =>
        (await chrome.storage.session.get("key:anthropic"))["key:anthropic"],
    ),
  ).toBe("synthetic-new-key");
  await check.click();
  await expect(page.locator("#connectionStatus")).toContainText("Connected.");
});

test("24-hour stopping skips old posts, stops after three in a row, and preserves checkpoints", async () => {
  const page = await context.newPage();
  await page.goto(base + "/settings.html");
  await page.locator("#maxPosts").fill("1");
  await expect(page.locator("#saveStatus")).toContainText("Changes saved");
  const scan = async (count: number) => {
    await page.evaluate(() => chrome.runtime.sendMessage({ op: "start" }));
    await expect
      .poll(
        async () =>
          (await stores(page)).runs.filter(
            (r) => (r as { state: string }).state === "completed",
          ).length,
        { timeout: 20000 },
      )
      .toBe(count);
  };
  await scan(1);
  const checkpoints = (await stores(page)).meta.filter((m) =>
    (m as { id: string }).id.startsWith("checkpoint:"),
  );
  const dated = (id: string, hours: number) =>
    card(id).replace(
      "2026-09-20T10:00:00Z",
      new Date(Date.now() - hours * 3600000).toISOString(),
    );
  // The saved marker is 100. The date mode must continue past it, skip an
  // old repost between recent posts, collect an undated post, and stop after
  // three old posts in a row without collecting anything below them.
  const cards =
    dated("100", 1) +
    dated("120", 30) +
    card("150").replace(' datetime="2026-09-20T10:00:00Z"', "") +
    dated("200", 2) +
    dated("300", 25) +
    dated("400", 26) +
    dated("500", 27) +
    dated("600", 1);
  fixtureHtml =
    fixture +
    `<script>feeds.following=${JSON.stringify(cards)};feeds['for-you']=${JSON.stringify(cards)};</script>`;
  await page.locator("#maxPosts").fill("10");
  await page.locator("#stopMode").selectOption("last24hours");
  await expect(page.locator("#saveStatus")).toContainText("Changes saved");
  await page.reload();
  await expect(page.locator("#stopMode")).toHaveValue("last24hours");
  await scan(2);
  const data = await stores(page);
  const run = data.runs.find(
    (r) =>
      (r as { settings: { stopMode: string } }).settings.stopMode ===
      "last24hours",
  ) as {
    postIds: string[];
    feeds: Record<string, { reason: string; steps: number }>;
  };
  expect(run.postIds).toEqual(["100", "150", "200"]);
  for (const result of Object.values(run.feeds))
    expect(result).toMatchObject({
      reason: "24-hour cutoff reached",
      steps: 0,
    });
  expect(
    data.meta.filter((m) => (m as { id: string }).id.startsWith("checkpoint:")),
  ).toEqual(checkpoints);
});

test("pregranted Claude AI activity updates live, shows usage and classifications, and reuses cache", async () => {
  const settingsPage = await context.newPage();
  await settingsPage.goto(base + "/settings.html");
  await settingsPage.locator("#provider").selectOption("anthropic");
  await settingsPage
    .locator("#model")
    .selectOption("claude-haiku-4-5-20251001");
  await settingsPage.locator("#apiKey").fill("synthetic-audit-key");
  await settingsPage
    .getByRole("button", { name: "Save key", exact: true })
    .click();
  await expect(settingsPage.locator("#notice")).toContainText("Key saved");
  await context.route("https://api.anthropic.com/v1/models/**", (route) =>
    route.fulfill({ json: { id: "claude-haiku-4-5-20251001" } }),
  );
  await settingsPage
    .getByRole("button", { name: "Check connection", exact: true })
    .click();
  await expect(settingsPage.locator("#connectionStatus")).toContainText(
    "Connected.",
  );
  await settingsPage.locator("#maxPosts").fill("2");
  await expect(settingsPage.locator("#saveStatus")).toContainText(
    "Changes saved",
  );
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await context.route(
    "https://api.anthropic.com/v1/messages",
    async (route) => {
      requests++;
      const prompt = route.request().postDataJSON().messages[0].content;
      const payload = JSON.parse(
        prompt.split("UNTRUSTED_DATA_JSON\n")[1].split("\nEND_DATA")[0],
      );
      await gate;
      await route.fulfill({
        json: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                items: payload.posts.map((p: { id: string }, i: number) => ({
                  id: p.id,
                  score: i === 0 ? 20 : 90,
                  recommendations: [],
                  takeaway: "<img src=x onerror=alert(1)> Synthetic takeaway",
                  reason: "Specific evidence described",
                  sectors: ["finance"],
                  tones: ["analytical"],
                  flags: [],
                })),
              }),
            },
          ],
          usage: { input_tokens: 1000, output_tokens: 100 },
        },
      });
    },
  );
  const page = await context.newPage();
  await page.goto(base + "/activity.html");
  await expect(page.locator("#auditContent")).toContainText("No scans yet");
  await settingsPage.evaluate(() =>
    chrome.runtime.sendMessage({ op: "start" }),
  );
  await analyseCollected(settingsPage);
  await expect(page.locator("#auditRun option")).toHaveCount(2);
  await page.getByLabel("Scan", { exact: true }).selectOption({ index: 0 });
  await expect(page.locator(".audit-table")).toContainText("running", {
    timeout: 20000,
  });
  await expect(page.locator("#auditContent")).toContainText("Unavailable");
  const digestPage = context
    .pages()
    .find((p) => p.url() === base + "/digest.html")!;
  await expect(digestPage.locator("#aiStatus")).toContainText(
    "AI analysis is running",
  );
  await expect(digestPage.getByRole("progressbar")).toHaveAttribute(
    "value",
    "0",
  );
  await expect(digestPage.getByRole("progressbar")).toHaveAttribute("max", "3");
  await expect(digestPage.locator("#aiCost")).toContainText("awaiting usage");
  release();
  await expect(page.locator(".audit-table")).toContainText("success");
  await expect(digestPage.locator("#aiStatus")).toContainText(
    "3 of 3 posts in the selected collection have AI analysis",
  );
  await expect(page.locator("#auditContent")).toContainText(
    "$0.001500 estimated",
  );
  await expect(digestPage.getByRole("progressbar")).toHaveAttribute(
    "value",
    "3",
  );
  await expect(digestPage.locator("#aiCost")).toContainText(
    "$0.001500 USD estimated",
  );
  await expect(page.locator(".audit-post")).toHaveCount(3);
  await page.locator(".audit-post summary").first().click();
  await expect(page.locator(".audit-post").first()).toContainText(
    "Sector: Finance",
  );
  await expect(page.locator(".audit-post").first()).toContainText(
    "Tone: Analytical",
  );
  await expect(page.locator(".audit-post").first()).toContainText(
    "Included in the digest",
  );
  await expect(page.locator(".audit-post img")).toHaveCount(0);
  await expect(page.locator(".audit-post").first()).not.toContainText(
    "Synthetic takeaway",
  );
  await page
    .getByLabel("Find a post, category or tone")
    .fill("nonexistent-search");
  await expect(page.locator(".audit-post")).toHaveCount(0);
  await page.getByLabel("Find a post, category or tone").fill("finance");
  await expect(page.locator(".audit-post")).toHaveCount(3);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export scan log" }).click();
  const download = await downloaded;
  const exported = await readFile((await download.path())!, "utf8");
  expect(exported).not.toContain("synthetic-audit-key");
  expect(JSON.parse(exported).audit.posts).toHaveLength(3);
  await page.screenshot({
    path: "test-results/ai-activity.png",
    fullPage: true,
  });
  await analyseCollected(settingsPage);
  await expect
    .poll(
      async () =>
        (await stores(settingsPage)).runs.filter(
          (r) => (r as { state: string }).state === "completed",
        ).length,
      { timeout: 20000 },
    )
    .toBe(3);
  await expect(page.locator("#auditRun option")).toHaveCount(3);
  await page.getByLabel("Scan", { exact: true }).selectOption({ index: 0 });
  await expect(page.locator("#auditContent")).toContainText(
    "No new requests: analysis was reused from cache.",
  );
  await page.getByLabel("Analysis status").selectOption("cached");
  await expect(page.locator(".audit-post")).toHaveCount(3);
  await expect(digestPage.getByRole("progressbar")).toHaveAttribute(
    "value",
    "3",
  );
  await expect(digestPage.getByRole("progressbar")).toHaveAttribute(
    "aria-valuetext",
    /3 of 3 posts analysed · 3 cached/,
  );
  await expect(digestPage.locator("#aiCost")).toContainText("$0.000000 USD");
  expect(requests).toBe(1);
  await page.reload();
  await expect(page.locator("#auditContent")).toContainText(
    "No new requests: analysis was reused from cache.",
  );
});

test("digest shows every collected post beyond ten and restores older truncated digests", async () => {
  const feed = Array.from({ length: 15 }, (_, i) =>
    card(
      String(1000 + i),
      i === 0 ? "Short" : "The same text belongs to distinct collected posts.",
    ),
  ).join("");
  fixtureHtml =
    fixture +
    `<script>feeds.following=${JSON.stringify(feed)};feeds['for-you']=${JSON.stringify(feed)};</script>`;
  const page = await context.newPage();
  await page.goto(base + "/settings.html");
  await page.locator("#maxPosts").fill("15");
  await expect(page.locator("#saveStatus")).toContainText("Changes saved");
  await page.evaluate(() => chrome.runtime.sendMessage({ op: "start" }));
  await expect
    .poll(async () => (await stores(page)).digests.length, { timeout: 20000 })
    .toBe(1);
  const data = await stores(page);
  expect((data.digests[0] as { items: unknown[] }).items).toHaveLength(15);
  await page.goto(base + "/digest.html");
  await expect(page.locator("article.card")).toHaveCount(15);
  await expect(page.locator(".all-authors")).toHaveText("All authors (15)");
  await expect(page.getByText("selected for you", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Not useful", exact: true })
    .first()
    .click();
  await expect(page.locator("article.card")).toHaveCount(15);
  await expect(page.locator(".all-authors")).toHaveText("All authors (15)");
  await page.locator(".digest-visibility summary").click();
  await page.getByLabel("Blacklisted words", { exact: true }).fill("SAME TEXT");
  await expect(page.locator("article.card")).toHaveCount(1);
  await expect(page.locator(".all-authors")).toHaveText("All authors (1)");
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await chrome.storage.local.get("digestBlacklist")).digestBlacklist,
      ),
    )
    .toBe("SAME TEXT");
  await page.reload();
  await expect(page.locator("article.card")).toHaveCount(1);
  await expect(page.locator(".all-authors")).toHaveText("All authors (1)");
  await page.locator(".digest-visibility summary").click();
  await expect(
    page.getByLabel("Blacklisted words", { exact: true }),
  ).toHaveValue("SAME TEXT");
  await page.getByLabel("Blacklisted words", { exact: true }).fill("");
  await expect(page.locator("article.card")).toHaveCount(15);
  await expect(page.locator(".all-authors")).toHaveText("All authors (15)");
  await page.getByLabel("Hide posts marked Not useful").check();
  await expect(page.locator("article.card")).toHaveCount(14);
  await expect(page.locator(".all-authors")).toHaveText("All authors (14)");
  await expect(page.locator("#visibleCount")).toHaveText(
    "14 of 15 posts · last 24 hours",
  );
  await page.getByLabel("Hide posts marked Not useful").uncheck();
  await expect(page.locator("article.card")).toHaveCount(15);
  await expect(page.locator(".all-authors")).toHaveText("All authors (15)");
  await page.getByLabel("Hide repeated text", { exact: true }).check();
  await expect(page.locator("article.card")).toHaveCount(2);
  await expect(page.locator(".all-authors")).toHaveText("All authors (2)");
  await page.getByRole("button", { name: "Reset these filters" }).click();
  await page.getByLabel("Limit to 2 posts per author").check();
  await expect(page.locator("article.card")).toHaveCount(2);
  await expect(page.locator(".all-authors")).toHaveText("All authors (2)");
  await expect
    .poll(async () =>
      page.evaluate(
        async () =>
          (
            (await chrome.storage.local.get("digestVisibility"))
              .digestVisibility as { repeatedAuthors: boolean }
          ).repeatedAuthors,
      ),
    )
    .toBe(true);
  await page.reload();
  await page.locator(".digest-visibility summary").click();
  await expect(page.getByLabel("Limit to 2 posts per author")).toBeChecked();
  await expect(page.locator("article.card")).toHaveCount(2);
  await expect(page.locator(".all-authors")).toHaveText("All authors (2)");
  await page.getByRole("button", { name: "Reset these filters" }).click();
  await expect(page.locator("article.card")).toHaveCount(15);
  await expect(page.locator(".all-authors")).toHaveText("All authors (15)");
  // Simulate a digest saved by an older build with only ten chosen items.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open("x-feed-digest", 1);
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("digests", "readwrite");
      const store = tx.objectStore("digests");
      const req = store.getAll();
      req.onsuccess = () => {
        const d = req.result[0];
        d.items = d.items.slice(0, 10);
        d.items[0].mode = "ai";
        d.items[0].score = 10;
        store.put(d);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.locator("article.card")).toHaveCount(15);
  await expect(page.locator(".all-authors")).toHaveText("All authors (15)");
  await page.locator(".digest-visibility summary").click();
  await page.getByLabel("Hide low AI scores (below 30/100)").check();
  await expect(page.locator("article.card")).toHaveCount(14);
  await expect(page.locator(".all-authors")).toHaveText("All authors (14)");
  await page.getByLabel("Hide low AI scores (below 30/100)").uncheck();
  await expect(page.locator("article.card")).toHaveCount(15);
  await expect(page.locator(".all-authors")).toHaveText("All authors (15)");
  await page.getByLabel("Hide repeated text", { exact: true }).check();
  await expect(page.locator("article.card")).toHaveCount(2);
  await expect(page.locator(".all-authors")).toHaveText("All authors (2)");
  expect((await stores(page)).posts).toHaveLength(15);
});

test("starting a scan adds live results to all saved posts", async () => {
  const page = await context.newPage();
  await page.goto(base + "/digest.html");
  const post = fixturePost("777");
  const run = fixtureRun({ state: "completed", postIds: [post.id] });
  await page.evaluate(
    async ({ post, run }) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("x-feed-digest", 1);
        request.onsuccess = () => resolve(request.result);
      });
      const tx = db.transaction(["posts", "runs", "meta"], "readwrite");
      tx.objectStore("posts").put(post);
      tx.objectStore("runs").put(run);
      tx.objectStore("meta").put({ id: "current", runId: run.id });
      tx.objectStore("meta").put({ id: "lastScan", runId: run.id });
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      db.close();
      await chrome.storage.local.set({
        settings: { ...run.settings, maxPosts: 2, maxScrollSteps: 2 },
      });
    },
    { post, run },
  );
  await expect(page.locator("article.card")).toHaveCount(1);
  await page.locator(".scan-history summary").click();
  await page.getByLabel("Saved posts", { exact: true }).selectOption(run.id);
  await page
    .getByRole("button", { name: /more · single-post authors hidden/ })
    .click();
  await expect(
    page.locator('[data-author="example"] .author-count'),
  ).toHaveText("1");
  // A scan started by another surface (e.g. the popup) must refresh this tab too.
  const started = await page.evaluate(() =>
    chrome.runtime.sendMessage({ op: "start" }),
  );
  expect(started.ok).toBe(true);
  await expect(page.getByLabel("Saved posts", { exact: true })).toHaveValue(
    "all",
  );
  await expect(
    page.getByRole("button", { name: "Scan both feeds ↗", exact: true }),
  ).toBeEnabled({ timeout: 20000 });
  await expect(page.locator("article.card")).toHaveCount(4);
  await expect(page.locator(".all-authors")).toHaveText("All authors (4)");
  await expect(
    page.locator('[data-author="example"] .author-count'),
  ).toHaveText("4");
  expect(
    await page
      .locator("article.card")
      .evaluateAll((cards) =>
        cards.map((card) => (card as HTMLElement).dataset.postId).sort(),
      ),
  ).toEqual(["100", "200", "300", "777"]);
  await page.reload();
  await expect(page.getByLabel("Saved posts", { exact: true })).toHaveValue(
    "all",
  );
  await expect(page.locator("article.card")).toHaveCount(4);
  expect((await stores(page)).posts).toHaveLength(4);
  await page.evaluate(() =>
    chrome.storage.session.set({ "key:jev": "never-export-this-key" }),
  );
  await page.locator(".scan-history summary").click();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export for online reader", exact: true })
    .click();
  const file = await downloaded;
  const exported = gunzipSync(await readFile((await file.path())!)).toString();
  expect(JSON.parse(exported).posts).toHaveLength(4);
  expect(exported).not.toContain("never-export-this-key");
});

test("a second scan adds eight new posts to the existing twenty-four", async () => {
  const feedFixture = (count: number, firstId: number) => {
    const feeds = {
      following: Array.from({ length: count }, (_, i) =>
        card(String(firstId + i), `Synthetic following post ${firstId + i}`),
      ).join(""),
      "for-you": Array.from({ length: count }, (_, i) =>
        card(
          String(firstId + count + i),
          `Synthetic recommended post ${firstId + count + i}`,
        ),
      ).join(""),
    };
    return fixture.replace(
      /const feeds=.*?;\n/,
      `const feeds=${JSON.stringify(feeds)};\n`,
    );
  };
  fixtureHtml = feedFixture(12, 1000);
  const page = await context.newPage();
  await page.goto(base + "/digest.html");
  await page.evaluate(async (settings) => {
    await chrome.storage.local.set({ settings: { ...settings, maxPosts: 12 } });
  }, fixtureRun().settings);
  const scan = page.getByRole("button", {
    name: "Scan both feeds ↗",
    exact: true,
  });
  await scan.click();
  await expect(page.locator("article.card")).toHaveCount(24, {
    timeout: 20000,
  });
  await expect(scan).toBeEnabled({ timeout: 20000 });

  fixtureHtml = feedFixture(4, 2000);
  await page.evaluate(async (settings) => {
    await chrome.storage.local.set({ settings: { ...settings, maxPosts: 4 } });
  }, fixtureRun().settings);
  await scan.click();
  await expect(page.locator("article.card")).toHaveCount(32, {
    timeout: 20000,
  });
  await expect(scan).toBeEnabled({ timeout: 20000 });
  const ids = await page
    .locator("article.card")
    .evaluateAll((cards) =>
      cards.map((node) => (node as HTMLElement).dataset.postId),
    );
  expect(new Set(ids).size).toBe(32);
  expect(ids).toContain("1000");
  expect(ids).toContain("2007");
  expect((await stores(page)).posts).toHaveLength(32);
  await page.reload();
  await expect(page.locator("article.card")).toHaveCount(32);
  await page.locator(".scan-history summary").click();
  await expect(page.getByLabel("Saved posts", { exact: true })).toHaveValue(
    "all",
  );
  await page.getByLabel("Saved posts", { exact: true }).selectOption("latest");
  await expect(page.locator("article.card")).toHaveCount(8);
  await page.getByLabel("Saved posts", { exact: true }).selectOption("all");
  await expect(page.locator("article.card")).toHaveCount(32);
});

test("saved posts survive later scans and retain AI metadata", async () => {
  const page = await context.newPage();
  await page.goto(base + "/digest.html");
  const first = fixturePost("100");
  const second = fixturePost("200", {
    publishedAt: Date.now() - 48 * 3600000,
    observations: [{ runId: "second", feed: "following", at: Date.now() }],
  });
  const oldRun = fixtureRun({ state: "completed", postIds: [first.id] });
  const nextRun = fixtureRun({
    id: "second",
    state: "completed",
    postIds: [second.id],
    startedAt: Date.now() + 1000,
  });
  await page.evaluate(
    async ({ first, second, oldRun, nextRun }) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("x-feed-digest", 1);
        request.onsuccess = () => resolve(request.result);
      });
      const tx = db.transaction(
        ["posts", "runs", "digests", "meta"],
        "readwrite",
      );
      for (const post of [first, second]) tx.objectStore("posts").put(post);
      for (const run of [oldRun, nextRun]) tx.objectStore("runs").put(run);
      tx.objectStore("digests").put({
        id: oldRun.id,
        createdAt: oldRun.startedAt,
        mode: "AI",
        model: "fixture",
        notices: [],
        candidates: 1,
        tokens: 10,
        items: [
          {
            id: first.id,
            score: 88,
            mode: "ai",
            takeaway: "",
            reason: "",
            flags: [],
            sectors: ["finance"],
            tones: [],
            recommendations: [],
          },
        ],
      });
      tx.objectStore("meta").put({ id: "current", runId: nextRun.id });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { first, second, oldRun, nextRun },
  );
  await expect(page.locator("article.card")).toHaveCount(1);
  await expect(page.locator(".all-authors")).toHaveText("All authors (1)");
  await expect(page.locator("article.card")).toHaveAttribute(
    "data-post-id",
    first.id,
  );
  const range = await page.evaluate(() => {
    const from = (document.querySelector("#postStartDate") as HTMLInputElement)
      .value;
    const to = (document.querySelector("#postEndDate") as HTMLInputElement)
      .value;
    return new Date(to).getTime() - new Date(from).getTime();
  });
  expect(range).toBe(86400000);
  await page.getByLabel("When", { exact: true }).selectOption("3");
  await expect(page.locator("article.card")).toHaveCount(2);
  await expect(page.locator(".all-authors")).toHaveText("All authors (2)");
  await page.getByLabel("When", { exact: true }).selectOption("7");
  await expect(page.locator("article.card")).toHaveCount(2);
  await expect(page.locator(".all-authors")).toHaveText("All authors (2)");
  const values = await page.evaluate(() =>
    [72, 24].map((hours) => {
      const d = new Date(Date.now() - hours * 3600000);
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 19);
    }),
  );
  await page.getByLabel("When", { exact: true }).selectOption("custom");
  await page.getByLabel("From", { exact: true }).fill(values[0]);
  await page.getByLabel("To", { exact: true }).fill(values[1]);
  await expect(page.locator("article.card")).toHaveCount(1);
  await expect(page.locator(".all-authors")).toHaveText("All authors (1)");
  await expect(page.locator("article.card")).toHaveAttribute(
    "data-post-id",
    second.id,
  );
  await page.getByLabel("When", { exact: true }).selectOption("all");
  await expect(page.locator("article.card")).toHaveCount(2);
  await expect(page.locator(".all-authors")).toHaveText("All authors (2)");
  await page.getByLabel("Sector", { exact: true }).selectOption("finance");
  await expect(page.locator("article.card")).toHaveCount(1);
  await expect(page.locator(".all-authors")).toHaveText("All authors (1)");
  await page.getByLabel("Sector", { exact: true }).selectOption("all");
  await page.locator(".scan-history summary").click();
  await page.getByLabel("Saved posts", { exact: true }).selectOption("latest");
  await expect(page.locator("article.card")).toHaveCount(1);
  await expect(page.locator(".all-authors")).toHaveText("All authors (1)");
  await expect(page.locator("article.card")).toHaveAttribute(
    "data-post-id",
    second.id,
  );

  // Changing dates after a scan must include older saved scans, not just latest.
  await page.getByLabel("When", { exact: true }).selectOption("1");
  await expect(page.getByLabel("Saved posts", { exact: true })).toHaveValue(
    "all",
  );
  await expect(page.locator("article.card")).toHaveCount(1);
  await expect(page.locator("article.card")).toHaveAttribute(
    "data-post-id",
    first.id,
  );
  await expect(page.locator(".all-authors")).toHaveText("All authors (1)");
  await page.getByLabel("When", { exact: true }).selectOption("3");
  await expect(page.locator("article.card")).toHaveCount(2);
  await expect(page.locator(".all-authors")).toHaveText("All authors (2)");
  await expect(
    page.locator('[data-author="example"] .author-count'),
  ).toHaveText("2");
  await page.getByLabel("When", { exact: true }).selectOption("all");

  await page.getByLabel("Saved posts", { exact: true }).selectOption(oldRun.id);
  await expect(page.locator("article.card")).toHaveCount(1);
  await expect(page.locator(".all-authors")).toHaveText("All authors (1)");
  await page.getByLabel("When", { exact: true }).selectOption("3");
  await expect(page.getByLabel("Saved posts", { exact: true })).toHaveValue(
    oldRun.id,
  );
  await expect(page.locator("article.card")).toHaveCount(1);
  await page.getByLabel("When", { exact: true }).selectOption("all");
  await page.getByLabel("Saved posts", { exact: true }).selectOption("all");
  await expect(page.locator("article.card")).toHaveCount(2);
  await expect(page.locator(".all-authors")).toHaveText("All authors (2)");
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await chrome.storage.local.get("digestScope")).digestScope,
      ),
    )
    .toBe("all");
  await page.reload();
  await expect(page.locator("article.card")).toHaveCount(1);
  await expect(page.locator(".all-authors")).toHaveText("All authors (1)");
  await page.getByLabel("When", { exact: true }).selectOption("all");
  await expect(page.locator("article.card")).toHaveCount(2);
  await expect(page.locator(".all-authors")).toHaveText("All authors (2)");
  await page.getByLabel("When", { exact: true }).selectOption("1");
  await expect(page.locator("article.card")).toHaveCount(1);
  await expect(page.locator(".all-authors")).toHaveText("All authors (1)");
});

test("views relative to followers filter persists and limits the visible analysis selection", async () => {
  const page = await context.newPage();
  await page.goto(base + "/digest.html");
  const posts = [
    fixturePost("100", { views: 2000, followers: 1000 }),
    fixturePost("200", { views: 10000, followers: 1000 }),
    fixturePost("300", { views: 1999, followers: 1000 }),
    fixturePost("400"),
    fixturePost("500", { views: 90000, followers: 0 }),
  ];
  const run = fixtureRun({
    state: "completed",
    postIds: posts.map((p) => p.id),
  });
  await page.evaluate(
    async ({ posts, run }) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const req = indexedDB.open("x-feed-digest", 1);
        req.onsuccess = () => resolve(req.result);
      });
      const tx = db.transaction(["posts", "runs", "meta"], "readwrite");
      for (const post of posts) tx.objectStore("posts").put(post);
      tx.objectStore("runs").put(run);
      tx.objectStore("meta").put({ id: "current", runId: run.id });
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      db.close();
    },
    { posts, run },
  );
  await expect(page.locator("article.card")).toHaveCount(5);
  await page.getByLabel("High views vs followers", { exact: true }).check();
  await expect(
    page.getByLabel("Minimum views relative to followers"),
  ).toHaveValue("2");
  await expect(page.locator("article.card")).toHaveCount(2);
  await expect(
    page.getByRole("button", {
      name: "Analyse with AI (2)",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(page.locator("#reachHelp")).toContainText(
    "2 of 5 posts lack these counts",
  );
  await page
    .getByLabel("Minimum views relative to followers")
    .selectOption("10");
  await expect(page.locator("article.card")).toHaveCount(1);
  await expect(page.locator("article.card .engagement")).toContainText(
    "10.0× views/followers",
  );
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await chrome.storage.local.get("digestReach")).digestReach,
      ),
    )
    .toEqual({ enabled: true, threshold: 10 });
  await page.reload();
  await expect(
    page.getByLabel("High views vs followers", { exact: true }),
  ).toBeChecked();
  await expect(page.locator("article.card")).toHaveCount(1);
  await page.getByLabel("High views vs followers", { exact: true }).uncheck();
  await expect(page.locator("article.card")).toHaveCount(5);
});

test("daily themes filter relevant posts and clear back to the full view", async () => {
  const page = await context.newPage();
  await page.goto(base + "/digest.html");
  const posts = [
    fixturePost("100", {
      text: "AI software development",
      publishedAt: Date.now() - 1000,
    }),
    fixturePost("200", {
      text: "Bitcoin trading",
      publishedAt: Date.now() - 1000,
    }),
    fixturePost("300", {
      text: "AI from yesterday",
      publishedAt: Date.now() - 86400000,
    }),
  ];
  const run = fixtureRun({
    state: "completed",
    postIds: posts.map((p) => p.id),
  });
  await page.evaluate(
    async ({ posts, run }) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("x-feed-digest", 1);
        request.onsuccess = () => resolve(request.result);
      });
      const tx = db.transaction(["posts", "runs", "meta"], "readwrite");
      for (const post of posts) tx.objectStore("posts").put(post);
      tx.objectStore("runs").put(run);
      tx.objectStore("meta").put({ id: "current", runId: run.id });
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      db.close();
    },
    { posts, run },
  );
  await page.getByLabel("When", { exact: true }).selectOption("all");
  await expect(page.locator("article.card")).toHaveCount(3);
  const theme = page.locator('[data-theme="ai"]');
  await expect(theme).toHaveText("AI & machine learning · 1");
  await theme.click();
  await expect(theme).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("article.card")).toHaveCount(1);
  await expect(page.locator("article.card")).toHaveAttribute(
    "data-post-id",
    "100",
  );
  await page.getByRole("button", { name: "Clear theme filter" }).click();
  await expect(page.locator("article.card")).toHaveCount(3);
});

test("pregranted Jev saves a key, classifies daily themes and reuses cached results", async () => {
  let generations = 0;
  await context.route("https://api.typesafe.ai/v1/**", async (route) => {
    if (route.request().url().endsWith("/models")) {
      await route.fulfill({ json: { models: [{ name: "jev-latest" }] } });
      return;
    }
    generations++;
    const request = route.request().postDataJSON();
    expect(request.state.text).toBe("Models learn patterns from examples.");
    await route.fulfill({
      json: {
        model: "jev-1.13.0",
        answers: Object.fromEntries(
          Object.keys(request.questions).map((id) => [
            id,
            { type: "noul", noul: id === "ai" ? 0.95 : 0.05 },
          ]),
        ),
        usage: { input_tokens: 100, output_tokens: 18 },
      },
    });
  });
  const page = await context.newPage();
  await page.goto(base + "/settings.html");
  await page
    .getByLabel("Jev API key", { exact: true })
    .fill("synthetic-jev-key");
  await page
    .getByRole("button", { name: "Save and check Jev connection" })
    .click();
  await expect(page.locator("#jevSettings")).toContainText("Jev connected.");
  expect(generations).toBe(0);
  expect(
    await page.evaluate(
      async () => (await chrome.storage.session.get("key:jev"))["key:jev"],
    ),
  ).toBe("synthetic-jev-key");
  expect(
    await page.evaluate(
      async () => (await chrome.storage.local.get("key:jev"))["key:jev"],
    ),
  ).toBeUndefined();
  await page.goto(base + "/digest.html");
  await expect(
    page.getByRole("link", { name: "Set up Jev", exact: true }),
  ).toBeHidden();
  const post = fixturePost("882", {
    text: "Models learn patterns from examples.",
    publishedAt: Date.now() - 1000,
  });
  const run = fixtureRun({ state: "completed", postIds: [post.id] });
  await page.evaluate(
    async ({ post, run }) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("x-feed-digest", 1);
        request.onsuccess = () => resolve(request.result);
      });
      const tx = db.transaction(["posts", "runs", "meta"], "readwrite");
      tx.objectStore("posts").put(post);
      tx.objectStore("runs").put(run);
      tx.objectStore("meta").put({ id: "current", runId: run.id });
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      db.close();
    },
    { post, run },
  );
  const analyse = page.getByRole("button", {
    name: "Analyse themes with Jev",
    exact: true,
  });
  await expect(analyse).toBeEnabled();
  await expect(page.locator('[data-theme="other"]')).toBeVisible();
  await analyse.click();
  await expect(page.locator("#dailyThemes")).toContainText("Finished.");
  await expect(page.locator('[data-theme="ai"]')).toHaveText(
    "AI & machine learning · 1",
  );
  await page.locator('[data-theme="ai"]').click();
  await expect(page.locator("article.card")).toHaveCount(1);
  expect(generations).toBe(1);
  await page.reload();
  await expect(page.locator('[data-theme="ai"]')).toBeVisible();
  await expect(analyse).toBeDisabled();
  await expect(page.locator("#dailyThemes")).toContainText(
    "1 of 1 posts classified with Jev.",
  );
  expect(generations).toBe(1);
  await page.evaluate(async () => {
    await chrome.storage.session.remove("key:jev");
  });
  await expect(
    page.getByRole("link", { name: "Set up Jev", exact: true }),
  ).toBeHidden();
  await expect(analyse).toBeDisabled();
  await page.reload();
  await expect(page.locator('[data-theme="ai"]')).toBeVisible();
  await expect(analyse).toBeDisabled();
  await expect(page.locator("#dailyThemes")).not.toContainText("Open Settings");
  await page.evaluate(async () => {
    await chrome.storage.session.set({ "key:jev": "synthetic-jev-key" });
  });
  await expect(
    page.getByRole("link", { name: "Set up Jev", exact: true }),
  ).toBeHidden();
});

test("Jev setup link stays hidden for a stored key without host permission", async () => {
  const page = await context.newPage();
  await page.goto(base + "/digest.html");
  const setup = page.getByRole("link", { name: "Set up Jev", exact: true });
  await expect(setup).toBeVisible();
  expect(
    await page.evaluate(() =>
      chrome.permissions.contains({ origins: ["https://api.typesafe.ai/*"] }),
    ),
  ).toBe(false);
  await page.evaluate(() =>
    chrome.storage.local.set({ "key:jev": "synthetic-jev-key" }),
  );
  await expect(setup).toBeHidden();
  await page.reload();
  await expect(setup).toBeHidden();
  await page.evaluate(() => chrome.storage.local.remove("key:jev"));
  await expect(setup).toBeVisible();
});

test("stale manifest Jev explains how to reload before requesting missing access", async () => {
  const page = await context.newPage();
  await page.goto(base + "/settings.html");
  await page.getByLabel("Jev API key", { exact: true }).fill("fixture-key");
  await page
    .getByRole("button", { name: "Save and check Jev connection" })
    .click();
  await expect(page.locator("#jevSettings")).toContainText(
    "has not registered TypeSafe access",
  );
  await expect(
    page
      .locator("#jevSettings")
      .getByRole("button", { name: "Open extension manager" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save and check Jev connection" }),
  ).toBeEnabled();
});

test("scan captures role-link views and pointer-hover followers into stored posts", async () => {
  fixtureHtml = fixture.replace(
    /<\/body>/,
    `<script>
    const decorate = () => {
      for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
        if (article.querySelector('[data-metrics]')) continue;
        const status = article.querySelector('time').closest('a').getAttribute('href');
        const analytics = document.createElement('a');
        analytics.setAttribute('role', 'link');
        analytics.setAttribute('data-metrics', 'true');
        analytics.setAttribute('href', status + '/analytics?source=feed');
        analytics.innerHTML = '<span>24K</span>';
        article.append(analytics);
        const author = article.querySelector('a[href="/example"]');
        author.addEventListener('pointerover', () => {
          let profile = document.getElementById('fixture-profile');
          if (!profile) { profile = document.createElement('div'); profile.id = 'fixture-profile'; document.body.append(profile); }
          profile.innerHTML = '<a href="/example/followers"><span>3K</span><span>Followers</span></a>';
        });
      }
    };
    new MutationObserver(decorate).observe(document.getElementById('feed'), {childList:true, subtree:true});
    decorate();
  </script></body>`,
  );
  const page = await context.newPage();
  await page.goto(base + "/popup.html");
  await page.getByRole("button", { name: "Scan both feeds" }).click();
  await expect
    .poll(
      async () => ((await stores(page)).runs[0] as Run | undefined)?.state,
      { timeout: 30000 },
    )
    .toBe("completed");
  const data = await stores(page);
  expect(data.posts.length).toBe(3);
  for (const post of data.posts as Post[]) {
    expect(post.views).toBe(24000);
    expect(post.followers).toBe(3000);
  }
});
