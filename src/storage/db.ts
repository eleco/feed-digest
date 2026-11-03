import type { Post, Run, Digest, Feedback } from "../shared/types";
const stores = [
  "posts",
  "runs",
  "digests",
  "feedback",
  "meta",
  "cache",
] as const;
type Store = (typeof stores)[number];
let connection: Promise<IDBDatabase> | undefined;
export function db() {
  return (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("x-feed-digest", 1);
    r.onupgradeneeded = () => {
      for (const s of stores) r.result.createObjectStore(s, { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
export function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function transaction<T>(
  names: Store[],
  fn: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const d = await db();
  const tx = d.transaction(names, "readwrite");
  const done = new Promise<void>((res, rej) => {
    tx.oncomplete = () => res();
    tx.onabort = tx.onerror = () =>
      rej(tx.error ?? Error("Storage transaction failed"));
  });
  try {
    const result = await fn(tx);
    await done;
    return result;
  } catch (e) {
    try {
      tx.abort();
    } catch {}
    await done.catch(() => {});
    throw e;
  }
}
export async function get<T>(s: Store, id: string): Promise<T | undefined> {
  return request((await db()).transaction(s).objectStore(s).get(id));
}
export async function all<T>(s: Store): Promise<T[]> {
  return request((await db()).transaction(s).objectStore(s).getAll());
}
export async function savedArchive() {
  const tx = (await db()).transaction(
    ["posts", "runs", "digests", "feedback"],
    "readonly",
  );
  const [posts, runs, digests, feedback] = await Promise.all([
    request<Post[]>(tx.objectStore("posts").getAll()),
    request<Run[]>(tx.objectStore("runs").getAll()),
    request<Digest[]>(tx.objectStore("digests").getAll()),
    request<Feedback[]>(tx.objectStore("feedback").getAll()),
  ]);
  return {
    format: "x-feed-digest-archive",
    version: 1,
    exportedAt: new Date().toISOString(),
    posts,
    runs,
    digests,
    feedback,
  };
}
export async function put<T extends { id: string }>(s: Store, v: T) {
  await transaction([s], async (tx) => {
    await request(tx.objectStore(s).put(v));
  });
}
export async function current() {
  const m = await get<{ id: string; runId: string }>("meta", "current");
  return m ? get<Run>("runs", m.runId) : undefined;
}
// The most recent feed scan. AI analysis runs never replace it.
export async function lastScan() {
  const m = await get<{ id: string; runId: string }>("meta", "lastScan");
  const run = m ? await get<Run>("runs", m.runId) : undefined;
  if (run) return run;
  return latestScanOf(await all<Run>("runs"));
}
export function latestScanOf(runs: Run[]) {
  return runs
    .filter((r) => !r.analysisOnly)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
}
export function mergePost(old: Post | undefined, p: Post): Post {
  const observations = [...(old?.observations ?? [])];
  for (const o of p.observations)
    if (!observations.some((x) => x.runId === o.runId && x.feed === o.feed))
      observations.push(o);
  return {
    ...old,
    ...p,
    text: p.text || old?.text || "",
    views: p.views ?? old?.views ?? null,
    followers: p.followers ?? old?.followers ?? null,
    pinned: old?.pinned ?? false,
    observations,
  };
}
export async function prune(now = Date.now()) {
  await transaction([...stores], async (tx) => {
    const posts = await request<Post[]>(tx.objectStore("posts").getAll());
    const sorted = posts
      .filter((p) => !p.pinned)
      .sort((a, b) => a.collectedAt - b.collectedAt);
    let count = posts.length;
    const removed = new Set<string>();
    for (const p of sorted)
      if (p.collectedAt < now - 30 * 86400000 || count > 5000) {
        removed.add(p.id);
        tx.objectStore("posts").delete(p.id);
        tx.objectStore("feedback").delete(p.id);
        count--;
      }
    const runs = await request<Run[]>(tx.objectStore("runs").getAll());
    const expired = new Set<string>();
    // Older versions copied observations onto posts for each AI analysis run.
    const analysisRuns = new Set(
      runs.filter((r) => r.analysisOnly).map((r) => r.id),
    );
    for (const r of runs) {
      if (r.updatedAt < now - 30 * 86400000) {
        expired.add(r.id);
        tx.objectStore("runs").delete(r.id);
        tx.objectStore("digests").delete(r.id);
      } else if (r.postIds.some((id) => removed.has(id))) {
        r.postIds = r.postIds.filter((id) => !removed.has(id));
        tx.objectStore("runs").put(r);
      }
    }
    // Write back only records that changed, so routine pruning stays cheap.
    for (const p of posts)
      if (!removed.has(p.id)) {
        const kept = p.observations.filter(
          (o) => !expired.has(o.runId) && !analysisRuns.has(o.runId),
        );
        if (kept.length !== p.observations.length) {
          p.observations = kept;
          tx.objectStore("posts").put(p);
        }
      }
    for (const d of await request<Digest[]>(tx.objectStore("digests").getAll()))
      if (!expired.has(d.id) && d.items.some((i) => removed.has(i.id))) {
        d.items = d.items.filter((i) => !removed.has(i.id));
        tx.objectStore("digests").put(d);
      }
    for (const c of await request<{ id: string; at: number }[]>(
      tx.objectStore("cache").getAll(),
    ))
      if (c.at < now - 30 * 86400000) tx.objectStore("cache").delete(c.id);
  });
}
export async function clearDatabase() {
  await transaction([...stores], async (tx) => {
    for (const s of stores) tx.objectStore(s).clear();
  });
}
export async function feedback(id: string, value: Feedback["value"]) {
  await transaction(["posts", "feedback", "digests"], async (tx) => {
    const p = await request<Post | undefined>(tx.objectStore("posts").get(id));
    if (!p) return;
    tx.objectStore("feedback").put({ id, value, handle: p.handle });
  });
}
export async function setPinned(id: string, pinned: boolean) {
  await transaction(["posts"], async (tx) => {
    const p = await request<Post | undefined>(tx.objectStore("posts").get(id));
    if (p) tx.objectStore("posts").put({ ...p, pinned });
  });
}
