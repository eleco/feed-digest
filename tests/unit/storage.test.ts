import "fake-indexeddb/auto";
import { beforeEach, describe, it, expect } from "vitest";
import {
  all,
  clearDatabase,
  get,
  put,
  prune,
  savedArchive,
} from "../../src/storage/db";
import { reserve, basicDigest } from "../../src/ranking/engine";
import { defaults } from "../../src/shared/types";
import { post, run } from "../fixtures/data";
beforeEach(clearDatabase);
describe("atomic storage and quotas", () => {
  it("allows only the configured request count under concurrent reservations", async () => {
    await put("runs", run({ settings: { ...defaults, requestsPerScan: 1 } }));
    const results = await Promise.allSettled([reserve("run"), reserve("run")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await get<{ requests: number }>("runs", "run"))?.requests).toBe(1);
  });
  it("blocks calls after reaching the daily request limit", async () => {
    await put(
      "runs",
      run({
        settings: { ...defaults, provider: "openai", requestsPerDay: 1 },
      }),
    );
    await reserve("run");
    await expect(reserve("run")).rejects.toThrow(/Request budget/);
  });
  it("rejects cancelled runs and stale reservations", async () => {
    await put("runs", run({ state: "cancelled" }));
    await expect(reserve("run")).rejects.toThrow(/stopped/);
  });
  it("prunes old unpinned posts, references, feedback and caches", async () => {
    await put("posts", post("100", { collectedAt: 0 }));
    await put("posts", post("200", { collectedAt: 0, pinned: true }));
    await put("runs", run());
    await put("feedback", { id: "100", value: "useful", handle: "example" });
    await put("digests", await basicDigest(run()));
    await put("cache", { id: "cache", at: 0 });
    await prune();
    expect((await all("posts")).length).toBe(1);
    expect((await get<{ postIds: string[] }>("runs", "run"))?.postIds).toEqual(
      [],
    );
    expect(await all("feedback")).toEqual([]);
    expect(await all("cache")).toEqual([]);
  });
  it("deletes all stores including usage and checkpoints", async () => {
    await put("posts", post());
    await put("runs", run());
    await put("meta", { id: "usage", requests: 2 });
    await put("cache", { id: "cache", content: "x" });
    await clearDatabase();
    for (const store of ["posts", "runs", "meta", "cache"] as const)
      expect(await all(store)).toEqual([]);
  });
});

it("backs up every retained scan and deduplicated post, not only the current run", async () => {
  await put("posts", post("100"));
  await put("posts", post("200"));
  for (const id of ["older", "newer"]) {
    const r = run({ id, postIds: [id === "older" ? "100" : "200"] });
    await put("runs", r);
    await put("digests", await basicDigest(r));
  }
  await put("meta", { id: "current", runId: "newer" });
  const archive = await savedArchive();
  expect(archive.posts).toHaveLength(2);
  expect(archive.runs).toHaveLength(2);
  expect(archive.digests).toHaveLength(2);
  expect(archive).not.toHaveProperty("meta");
  expect(archive).not.toHaveProperty("cache");
});
describe("latest scan and lightweight pruning", () => {
  it("keeps the latest scan separate from later AI analysis runs", async () => {
    const { lastScan, current } = await import("../../src/storage/db");
    await put("runs", run({ id: "scan-1", startedAt: 1 }));
    await put("runs", run({ id: "scan-2", startedAt: 2 }));
    await put("runs", run({ id: "ai", startedAt: 3, analysisOnly: true }));
    await put("meta", { id: "current", runId: "ai" });
    expect((await current())?.id).toBe("ai");
    // Without a stored pointer the newest non-analysis run is used.
    expect((await lastScan())?.id).toBe("scan-2");
    await put("meta", { id: "lastScan", runId: "scan-1" });
    expect((await lastScan())?.id).toBe("scan-1");
  });
  it("removes observations copied by older analysis runs and skips unchanged writes", async () => {
    const now = Date.now();
    await put("runs", run({ id: "scan", updatedAt: now }));
    await put("runs", run({ id: "ai", updatedAt: now, analysisOnly: true }));
    await put(
      "posts",
      post("100", {
        collectedAt: now,
        observations: [
          { runId: "scan", feed: "following", at: now },
          { runId: "ai", feed: "following", at: now },
        ],
      }),
    );
    await put(
      "posts",
      post("200", {
        collectedAt: now,
        observations: [{ runId: "scan", feed: "for-you", at: now }],
      }),
    );
    const before = await get<Record<string, unknown>>("posts", "200");
    await prune(now);
    expect(
      (await get<{ observations: { runId: string }[] }>("posts", "100"))!
        .observations,
    ).toEqual([{ runId: "scan", feed: "following", at: now }]);
    expect(await get("posts", "200")).toEqual(before);
  });
});
