import { origins } from "../ranking/providers";
import {
  active,
  isHome,
  validatePost,
  type Run,
  type Post,
  type Feed,
} from "../shared/types";
import {
  all,
  current,
  get,
  lastScan,
  mergePost,
  put,
  prune,
  request,
  transaction,
  clearDatabase,
} from "../storage/db";
import { key, settings, secureStorage } from "../storage/settings";
import { basicDigest } from "../ranking/engine";
import { HIDE_FEED_IMAGES_CSS } from "../content/adapter";
import { digestFits, scanWindowWidth } from "../shared/scan-layout";
const ready = secureStorage();
async function browserSession() {
  const stored = (await chrome.storage.session.get("browserSession"))
    .browserSession;
  if (typeof stored === "string") return stored;
  const id = crypto.randomUUID();
  await chrome.storage.session.set({ browserSession: id });
  return id;
}
// The recovery alarm only runs while a scan or analysis is active.
// Every scan-tab message renews the lease, so a scan has no overall time limit
// but one that stops reporting is interrupted by the recovery alarm.
const SCAN_LEASE = 120000;
const DAY = 24 * 60 * 60 * 1000;
const watchRun = () => chrome.alarms.create("recovery", { periodInMinutes: 1 });
const unwatchRun = () => chrome.alarms.clear("recovery");
let queue = Promise.resolve<unknown>(undefined);
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const task = queue.then(fn, fn);
  queue = task.catch(() => {});
  return task;
}
async function finish(run: Run, state: Run["state"], reason: string) {
  run.state = state;
  run.reason = reason;
  run.phase = "finished";
  run.updatedAt = Date.now();
  run.leaseUntil = 0;
  await put("runs", run);
  await chrome.runtime
    .sendMessage({ op: "runStopped", runId: run.id })
    .catch(() => {});
  await put("digests", await basicDigest(run));
  if (
    run.tabId !== undefined &&
    run.browserSession === (await browserSession())
  ) {
    await chrome.tabs.sendMessage(run.tabId, { op: "stop" }).catch(() => {});
    if (run.settings.hideImages)
      await chrome.scripting
        .removeCSS({
          target: { tabId: run.tabId },
          css: HIDE_FEED_IMAGES_CSS,
          origin: "USER",
        })
        .catch(() => {});
    const tab = await chrome.tabs.get(run.tabId).catch(() => undefined);
    if (tab && (isHome(tab.url ?? "") || tab.url === "about:blank"))
      await chrome.tabs.remove(run.tabId).catch(() => {});
  }
  await chrome.action.setBadgeText({ text: "" });
  await unwatchRun();
}
async function recover() {
  const run = await current();
  if (active(run)) {
    if (run!.browserSession !== (await browserSession())) {
      run!.tabId = undefined;
      run!.monitorTabId = undefined;
      await finish(
        run!,
        "interrupted",
        "Browser session changed; captured posts preserved. Start a new scan.",
      );
      return;
    }
    let missing = false;
    try {
      await chrome.tabs.get(
        run!.state === "ranking" ? run!.monitorTabId! : run!.tabId!,
      );
    } catch {
      missing = true;
    }
    if (missing || run!.leaseUntil < Date.now())
      await finish(
        run!,
        "interrupted",
        "Scan or ranking interrupted; captured posts were preserved. Start a new scan.",
      );
  }
}
type Area = { left: number; top: number; width: number; height: number };
// The usable screen area sent by the page that started the scan. The service
// worker cannot read screen size itself.
function screenArea(raw: unknown): Area | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as Record<string, unknown>;
  const values = [a.left, a.top, a.width, a.height];
  if (!values.every((v) => Number.isInteger(v) && Math.abs(v as number) < 1e5))
    return undefined;
  const area = a as Area;
  return area.width > 0 && area.height > 0 ? area : undefined;
}
// X may stop loading posts in a hidden tab, so the scan tab cannot share a
// window with the live digest. Open both as new windows side by side across
// the screen; existing windows are untouched.
async function openScanWindows(screen?: Area) {
  const base: Partial<Area> =
    screen ??
    (await chrome.windows.getLastFocused().catch(() => undefined)) ??
    {};
  const left = base.left ?? 0,
    top = base.top ?? 0,
    width = base.width ?? 1280,
    height = base.height ?? 800;
  // X's zoom is unknown until it loads; fitScanWindow widens this if needed.
  const scanWidth = scanWindowWidth(width);
  // Without room for both, the digest opens behind the scan window instead.
  const split = digestFits(width, scanWidth);
  // Chrome rejects bounds mostly off-screen (e.g. after a display change);
  // fall back to its default placement rather than failing the scan.
  const open = (
    data: chrome.windows.CreateData,
    bounds: Pick<
      chrome.windows.CreateData,
      "left" | "top" | "width" | "height"
    >,
  ) =>
    chrome.windows
      .create({ ...data, ...bounds })
      .catch(() => chrome.windows.create(data));
  const monitor = await open(
    { url: chrome.runtime.getURL("digest.html"), focused: false },
    split
      ? { left: left + scanWidth, top, width: width - scanWidth, height }
      : {},
  );
  const scan = await open(
    { url: "about:blank", focused: true },
    { left, top, width: scanWidth, height },
  );
  const monitorTabId = monitor?.tabs?.[0]?.id;
  const tabId = scan?.tabs?.[0]?.id;
  if (monitorTabId === undefined || tabId === undefined)
    throw Error("Could not open the scan windows");
  return { monitorTabId, tabId, area: { left, top, width, height } };
}
async function start(screen?: Area) {
  await ready;
  await recover();
  await prune();
  const s = await settings();
  const r: Run = {
    id: crypto.randomUUID(),
    browserSession: await browserSession(),
    state: "collecting",
    phase: "Opening X",
    feed: null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    leaseUntil: Date.now() + SCAN_LEASE,
    reason: "",
    feeds: {
      following: {
        count: 0,
        skipped: 0,
        steps: 0,
        reason: "Not scanned",
        complete: false,
      },
      "for-you": {
        count: 0,
        skipped: 0,
        steps: 0,
        reason: "Not scanned",
        complete: false,
      },
    },
    postIds: [],
    requests: 0,
    generation: crypto.randomUUID(),
    settings: { ...s, enabled: false },
  };
  await transaction(["meta", "runs"], async (tx) => {
    const pointer = await request<{ runId: string } | undefined>(
      tx.objectStore("meta").get("current"),
    );
    if (pointer) {
      const existing = await request<Run>(
        tx.objectStore("runs").get(pointer.runId),
      );
      if (active(existing)) throw Error("A scan is already running");
    }
    tx.objectStore("runs").put(r);
    tx.objectStore("meta").put({ id: "current", runId: r.id });
    tx.objectStore("meta").put({ id: "lastScan", runId: r.id });
  });
  await watchRun();
  try {
    // A new scan adds to the saved collection. Set this before opening the
    // monitor so popup-started scans cannot inherit an older scan-only view.
    await chrome.storage.local.set({ digestScope: "all" });
    const opened = await openScanWindows(screen);
    r.monitorTabId = opened.monitorTabId;
    r.tabId = opened.tabId;
    r.screen = opened.area;
    await put("runs", r);
    await chrome.action.setBadgeText({ text: "…" });
    const navigating = await chrome.tabs.update(opened.tabId, {
      url: "https://x.com/home",
      active: true,
    });
    if (navigating?.status === "complete" && isHome(navigating.url ?? ""))
      await launch(opened.tabId);
  } catch {
    await finish(r, "blocked", "Could not open the scan tab");
  }
  return r.id;
}
// Once X has loaded, its zoom is known (zoom is per site). Widen the scan
// window so X gets its full layout (see scan-layout.ts), within the screen, and
// keep the digest beside it only if it still fits.
async function fitScanWindow(r: Run, tabId: number) {
  const area = r.screen;
  if (!area) return;
  try {
    const zoom = await chrome.tabs.getZoom(tabId);
    const tab = await chrome.tabs.get(tabId);
    const win = await chrome.windows.get(tab.windowId);
    const needed = scanWindowWidth(area.width, zoom);
    if ((win.width ?? 0) >= needed) return;
    await chrome.windows.update(tab.windowId, {
      state: "normal",
      left: area.left,
      top: area.top,
      width: needed,
      height: area.height,
    });
    if (r.monitorTabId === undefined || !digestFits(area.width, needed)) return;
    const monitor = await chrome.tabs.get(r.monitorTabId);
    await chrome.windows.update(monitor.windowId, {
      left: area.left + needed,
      top: area.top,
      width: area.width - needed,
      height: area.height,
    });
  } catch {
    // Sizing is best effort; the scan still runs at the current size.
  }
}
async function launch(tabId: number) {
  const r = await current();
  if (
    !r ||
    r.tabId !== tabId ||
    r.state !== "collecting" ||
    r.phase !== "Opening X" ||
    r.browserSession !== (await browserSession())
  )
    return;
  const tab = await chrome.tabs.get(tabId);
  if (tab.status !== "complete" || tab.pendingUrl) return;
  if (!isHome(tab.url ?? "")) {
    await finish(
      r,
      "blocked",
      "Sign in to X normally, then retry from the extension.",
    );
    return;
  }
  r.phase = "Reading feeds";
  await put("runs", r);
  await fitScanWindow(r, tabId);
  try {
    if (r.settings.hideImages)
      await chrome.scripting.insertCSS({
        target: { tabId },
        css: HIDE_FEED_IMAGES_CSS,
        origin: "USER",
      });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    await chrome.tabs.sendMessage(tabId, {
      op: "scan",
      runId: r.id,
      settings: {
        maxPosts: r.settings.maxPosts,
        maxSteps: r.settings.maxSteps,
      },
    });
  } catch (error) {
    await finish(
      r,
      "blocked",
      "X page could not be read: " +
        (error instanceof Error
          ? error.message.slice(0, 200)
          : "unknown browser error"),
    );
  }
}
async function analyse(
  scope: unknown = "latest",
  postIds?: unknown,
  top?: unknown,
) {
  await recover();
  if (active(await current()))
    throw Error(
      "Wait for the current collection or analysis to finish, or stop it first.",
    );
  if (typeof scope !== "string") throw Error("Invalid saved-post selection");
  const latest = await lastScan();
  const source =
    scope === "all" || scope === "latest"
      ? latest
      : await get<Run>("runs", scope);
  if (!source || (scope !== "all" && !source.postIds.length))
    throw Error("Collect posts before analysing them.");
  if (source.account !== latest?.account)
    throw Error("Saved posts belong to a different account.");
  if (
    postIds !== undefined &&
    (!Array.isArray(postIds) ||
      !postIds.length ||
      postIds.some((id) => typeof id !== "string") ||
      new Set(postIds).size !== postIds.length)
  )
    throw Error("Invalid post selection");
  const configured = await settings();
  if (
    configured.provider === "basic" ||
    !configured.model ||
    !(await key(configured.provider))
  )
    throw Error(
      "Set up a provider, model and API key in Settings, then check the connection.",
    );
  if (
    !(await chrome.permissions.contains({
      origins: [origins[configured.provider]],
    }))
  )
    throw Error(
      "Click Check connection in Settings to approve provider access.",
    );
  const posts = (await all<Post>("posts")).filter(
    (p) =>
      (scope === "all" || source.postIds.includes(p.id)) &&
      (postIds === undefined || (postIds as string[]).includes(p.id)),
  );
  if (Array.isArray(postIds) && posts.length !== postIds.length)
    throw Error(
      "The selected posts changed or are no longer stored. Refresh the digest and try again.",
    );
  if (!posts.length)
    throw Error("These posts are no longer stored. Run a new scan.");
  const now = Date.now();
  const run: Run = {
    id: crypto.randomUUID(),
    analysisOnly: true,
    state: "ranking",
    phase: top === true ? "Picking your top 20" : "Analysing collected posts",
    ...(top === true ? { topPicks: true } : {}),
    startedAt: now,
    updatedAt: now,
    leaseUntil: now + 180000,
    browserSession: await browserSession(),
    account: source.account,
    feed: null,
    reason: "",
    feeds: structuredClone(source.feeds),
    postIds: posts.map((p) => p.id),
    requests: 0,
    generation: crypto.randomUUID(),
    settings: { ...configured, enabled: true },
  };
  const baseline = {
    ...(await basicDigest({ ...run, id: source.id })),
    id: run.id,
  };
  const monitor = await chrome.tabs.create({
    url: chrome.runtime.getURL("digest.html"),
    active: true,
  });
  run.monitorTabId = monitor.id;
  try {
    // Analysis runs reference posts by ID; post observations stay scan-only.
    await transaction(["runs", "meta", "digests"], async (tx) => {
      tx.objectStore("runs").put(run);
      tx.objectStore("digests").put(baseline);
      tx.objectStore("meta").put({ id: "current", runId: run.id });
    });
  } catch (error) {
    if (monitor.id !== undefined)
      await chrome.tabs.remove(monitor.id).catch(() => {});
    throw error;
  }
  await watchRun();
}
function uiSender(sender: chrome.runtime.MessageSender) {
  return (
    sender.id === chrome.runtime.id &&
    ["popup.html", "digest.html", "settings.html"].some(
      (p) => sender.url?.split("?")[0] === chrome.runtime.getURL(p),
    )
  );
}
async function message(
  m: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
) {
  await ready;
  if (!m || typeof m !== "object" || JSON.stringify(m).length > 300000)
    throw Error("Invalid message");
  if (uiSender(sender)) {
    if (m.op === "start") return start(screenArea(m.screen));
    if (m.op === "analyse")
      return analyse(m.scope ?? "latest", m.postIds, m.top);
    if (m.op === "stop") {
      const r = await current();
      if (active(r))
        await finish(
          r!,
          "cancelled",
          "Cancelled by you; captured posts preserved.",
        );
      return;
    }
    if (m.op === "resetCheckpoints") {
      if (active(await current()))
        throw Error("Stop the current scan before resetting checkpoints.");
      await transaction(["meta"], async (tx) => {
        for (const feed of ["following", "for-you"])
          tx.objectStore("meta").delete("checkpoint:" + feed);
      });
      return;
    }
    if (m.op === "delete") {
      const r = await current();
      if (active(r)) await finish(r!, "cancelled", "Data deleted");
      await chrome.alarms.clearAll();
      await clearDatabase();
      await chrome.storage.local.clear();
      await chrome.storage.session.clear();
      await secureStorage();
      await chrome.permissions.remove({
        origins: [
          "https://openrouter.ai/*",
          "https://api.openai.com/*",
          "https://api.anthropic.com/*",
          "https://api.typesafe.ai/*",
        ],
      });
      await chrome.action.setBadgeText({ text: "" });
      return;
    }
    if (m.op === "recover") {
      await recover();
      return;
    }
    throw Error("Unknown operation");
  }
  const r = await current();
  if (
    sender.id !== chrome.runtime.id ||
    sender.frameId !== 0 ||
    !sender.url ||
    !isHome(sender.url) ||
    !r ||
    r.state !== "collecting" ||
    r.browserSession !== (await browserSession()) ||
    sender.tab?.id !== r.tabId ||
    m.runId !== r.id ||
    r.leaseUntil < Date.now()
  )
    throw Error("Stale or untrusted scan message");
  const tab = await chrome.tabs.get(r.tabId!);
  if (!isHome(tab.url ?? "")) throw Error("Scan left home");
  r.leaseUntil = Date.now() + SCAN_LEASE;
  if (m.op === "identity") {
    if (
      typeof m.account !== "string" ||
      !/^@[a-zA-Z0-9_]{1,15}$/.test(m.account)
    )
      throw Error("Invalid account");
    const old = await get<{ account: string }>("meta", "account");
    if (old && old.account !== m.account) {
      await finish(
        r,
        "blocked",
        "The signed-in X account changed. Delete all data before scanning this account, or use a separate browser profile.",
      );
      throw Error("Account changed");
    }
    await put("meta", { id: "account", account: m.account });
    r.account = m.account;
  } else if (m.op === "feed") {
    if (m.feed !== "following" && m.feed !== "for-you")
      throw Error("Invalid feed");
    r.feed = m.feed;
    r.phase = "Reading " + m.feed;
    r.updatedAt = Date.now();
    await put("runs", r);
    const dayAgo = r.startedAt - DAY;
    const dated = r.settings.stopMode === "last24hours";
    // For You is not chronological: no checkpoint, and limits always apply.
    if (m.feed === "for-you")
      return {
        checkpoint: null,
        boundary: dated ? dayAgo : null,
        limited: true,
      };
    // Following runs to its boundary, however long that takes.
    const saved = await get<{
      account: string;
      postId: string;
      publishedAt?: number;
    }>("meta", "checkpoint:following");
    const checkpoint =
      !dated && saved && saved.account === r.account ? saved : undefined;
    // Checkpoints from older versions only stored the post ID.
    const since =
      checkpoint?.publishedAt ??
      (checkpoint
        ? (await get<Post>("posts", checkpoint.postId))?.publishedAt
        : null);
    return {
      checkpoint: checkpoint?.postId ?? null,
      // Never reach back past saved-post retention; with no checkpoint, read
      // the last 24 hours.
      boundary:
        typeof since === "number"
          ? Math.max(since, r.startedAt - 30 * DAY)
          : dayAgo,
      limited: false,
    };
  } else if (m.op === "batch") {
    if (
      !r.account ||
      m.account !== r.account ||
      m.feed !== r.feed ||
      !Array.isArray(m.posts) ||
      m.posts.length > 20 ||
      !m.posts.every(validatePost)
    )
      throw Error("Invalid batch");
    const feed = r.feed as Feed;
    await transaction(["posts", "runs"], async (tx) => {
      for (const raw of m.posts as Post[]) {
        if (feed === "for-you" && r.feeds[feed].count >= r.settings.maxPosts)
          break;
        const p = {
          ...raw,
          pinned: false,
          observations: [{ runId: r.id, feed, at: Date.now() }],
          collectedAt: Date.now(),
        };
        const old = await request<Post | undefined>(
          tx.objectStore("posts").get(p.id),
        );
        if (
          !old?.observations.some((o) => o.runId === r.id && o.feed === feed)
        ) {
          r.feeds[feed].count++;
          // The next checkpoint is the newest dated original post. Reposts
          // and ads can be re-shown above newer posts, so they never qualify.
          const newest = r.newestCollected?.[feed];
          if (
            !p.reposter &&
            !p.promoted &&
            p.publishedAt !== null &&
            (!newest || p.publishedAt > newest.publishedAt)
          )
            r.newestCollected = {
              ...r.newestCollected,
              [feed]: { postId: p.id, publishedAt: p.publishedAt },
            };
          r.lastCollected = { ...r.lastCollected, [feed]: p.id };
        }
        tx.objectStore("posts").put(mergePost(old, p));
        if (!r.postIds.includes(p.id)) r.postIds.push(p.id);
      }
      r.updatedAt = Date.now();
      tx.objectStore("runs").put(r);
    });
    return;
  } else if (m.op === "feedDone") {
    if (m.feed !== r.feed || !m.result || typeof m.result !== "object")
      throw Error("Invalid feed result");
    const f = m.result as Record<string, unknown>;
    if (
      typeof f.reason !== "string" ||
      f.reason.length > 300 ||
      typeof f.complete !== "boolean" ||
      (f.checkpointReached !== undefined &&
        typeof f.checkpointReached !== "boolean") ||
      (f.exhausted !== undefined && typeof f.exhausted !== "boolean") ||
      !Number.isInteger(f.skipped) ||
      !Number.isInteger(f.steps) ||
      (r.feed === "for-you" && Number(f.steps) > r.settings.maxSteps) ||
      Number(f.steps) < 0 ||
      Number(f.skipped) < 0
    )
      throw Error("Invalid counters");
    r.feeds[r.feed!] = {
      count: r.feeds[r.feed!].count,
      skipped: Number(f.skipped),
      steps: Number(f.steps),
      reason: f.reason,
      complete: f.complete,
    };
    r.updatedAt = Date.now();
    const id = "checkpoint:" + r.feed;
    const previous = await get<{ account: string }>("meta", id);
    await transaction(["runs", "meta"], async (tx) => {
      const newest = r.newestCollected?.[r.feed!];
      // Advance only once this scan has read back to the previous boundary.
      // Otherwise the posts between where it stopped and the old checkpoint
      // would never be collected; the next scan reads down to it instead.
      if (
        r.settings.stopMode !== "last24hours" &&
        r.feed === "following" &&
        f.complete &&
        newest &&
        (f.checkpointReached || !previous || previous.account !== r.account)
      )
        tx.objectStore("meta").put({
          id,
          account: r.account,
          postId: newest.postId,
          publishedAt: newest.publishedAt,
          at: Date.now(),
        });
      tx.objectStore("runs").put(r);
    });
    return;
  } else if (m.op === "blocked") {
    await finish(
      r,
      r.postIds.length ? "partial" : "blocked",
      typeof m.reason === "string"
        ? m.reason.slice(0, 300)
        : "Collection blocked",
    );
    return;
  } else if (m.op === "heartbeat") {
    // Only the lease changes; leaving updatedAt alone keeps the live digest
    // from re-rendering on every scroll.
    await put("runs", r);
    return;
  } else if (m.op === "collected") {
    r.reason = Object.values(r.feeds)
      .filter((f) => !f.complete)
      .map((f) => f.reason)
      .join("; ");
    await finish(r, r.reason ? "partial" : "completed", r.reason);
    await chrome.tabs
      .update(r.monitorTabId!, { active: true })
      .then((monitor) =>
        monitor
          ? chrome.windows.update(monitor.windowId, { focused: true })
          : undefined,
      )
      .catch(() => {});
    return;
  } else throw Error("Unknown scan operation");
  r.updatedAt = Date.now();
  await put("runs", r);
}
chrome.runtime.onMessage.addListener((m, sender, respond) => {
  void serial(() => message(m, sender)).then(
    (data) => respond({ ok: true, data }),
    (error) =>
      respond({
        ok: false,
        error: error instanceof Error ? error.message : "Operation failed",
      }),
  );
  return true;
});
chrome.tabs.onUpdated.addListener((id, change) => {
  if (change.url && !isHome(change.url))
    void serial(async () => {
      const run = await current();
      if (
        run?.state === "collecting" &&
        run.phase !== "Opening X" &&
        run.tabId === id &&
        run.browserSession === (await browserSession())
      )
        await finish(
          run,
          "interrupted",
          "Scan tab left X home; captured posts preserved.",
        );
    });
  if (change.status === "complete") void serial(() => launch(id));
});
chrome.tabs.onRemoved.addListener((id) => {
  void serial(async () => {
    const r = await current();
    if (
      active(r) &&
      ((r!.state === "collecting" && r!.tabId === id) ||
        (r!.state === "ranking" && r!.monitorTabId === id))
    )
      await finish(
        r!,
        "interrupted",
        "Required tab closed; captured posts preserved.",
      );
  });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  void serial(async () => {
    await ready;
    if (alarm.name !== "recovery") {
      // Daily scheduling was removed; clear any alarm left by older versions.
      await chrome.alarms.clear(alarm.name);
      return;
    }
    await recover();
    if (!active(await current())) await unwatchRun();
  });
});
async function housekeeping() {
  await ready;
  await chrome.alarms.clear("daily");
  await chrome.storage.local.remove(["scheduleNotice", "timezone"]);
  await recover();
  if (active(await current())) await watchRun();
  else await unwatchRun();
  await prune();
}
chrome.runtime.onInstalled.addListener(() => void serial(housekeeping));
chrome.runtime.onStartup.addListener(() => void serial(housekeeping));
