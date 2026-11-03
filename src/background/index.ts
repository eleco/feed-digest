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
async function start() {
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
    leaseUntil: Date.now() + 230000,
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
    const monitor = await chrome.tabs.create({
      url: chrome.runtime.getURL("digest.html"),
      active: false,
    });
    r.monitorTabId = monitor.id;
    const tab = await chrome.tabs.create({ url: "about:blank", active: false });
    r.tabId = tab.id;
    await put("runs", r);
    await chrome.action.setBadgeText({ text: "…" });
    const navigating = await chrome.tabs.update(tab.id!, {
      url: "https://x.com/home",
      active: true,
    });
    if (navigating?.status === "complete" && isHome(navigating.url ?? ""))
      await launch(tab.id!);
  } catch {
    await finish(r, "blocked", "Could not open the scan tab");
  }
  return r.id;
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
        maxSeconds: r.settings.maxSeconds,
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
async function analyse(scope: unknown = "latest", postIds?: unknown) {
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
    phase: "Analysing collected posts",
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
    if (m.op === "start") return start();
    if (m.op === "analyse") return analyse(m.scope ?? "latest", m.postIds);
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
    const checkpoint = await get<{ account: string; postId: string }>(
      "meta",
      "checkpoint:" + m.feed,
    );
    return {
      // For You is not chronological, so a saved post is no boundary there.
      checkpoint:
        r.settings.stopMode !== "last24hours" &&
        m.feed === "following" &&
        checkpoint &&
        checkpoint.account === r.account
          ? checkpoint.postId
          : null,
      cutoff:
        r.settings.stopMode === "last24hours"
          ? r.startedAt - 24 * 60 * 60 * 1000
          : null,
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
        if (r.feeds[feed].count >= r.settings.maxPosts) break;
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
          // The first accepted post is the top of the feed for this scan.
          if (!r.firstCollected?.[feed])
            r.firstCollected = { ...r.firstCollected, [feed]: p.id };
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
      Number(f.steps) > r.settings.maxSteps ||
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
    await transaction(["runs", "meta"], async (tx) => {
      const postId = r.firstCollected?.[r.feed!];
      const id = "checkpoint:" + r.feed;
      // Always advance to the newest post of this scan. Every scan starts at
      // the top, so an old boundary a limit kept us from reaching only gets
      // further away; keeping it would make every later scan run to its limits.
      if (
        r.settings.stopMode !== "last24hours" &&
        r.feed === "following" &&
        f.complete &&
        postId
      )
        tx.objectStore("meta").put({
          id,
          account: r.account,
          postId,
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
  } else if (m.op === "collected") {
    r.reason = Object.values(r.feeds)
      .filter((f) => !f.complete)
      .map((f) => f.reason)
      .join("; ");
    await finish(r, r.reason ? "partial" : "completed", r.reason);
    await chrome.tabs.update(r.monitorTabId!, { active: true }).catch(() => {});
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
