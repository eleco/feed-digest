import { auditPost, type AIAudit, type AIAttempt } from "../shared/audit";
import {
  active,
  type Digest,
  type Feedback,
  type Post,
  type Ranked,
  type Run,
} from "../shared/types";
import { all, get, put, request, transaction } from "../storage/db";
import { key } from "../storage/settings";
import { scoreBasic, allPostItems } from "./basic";
import { generate, origins, ProviderError } from "./providers";
import { hash, makePrompt, PROMPT_VERSION, validateOutput } from "./prompt";
interface Usage {
  id: string;
  requests: number;
  tokens: number;
}
export async function reserve(runId: string) {
  return transaction(["runs", "meta"], async (tx) => {
    const run = await request<Run>(tx.objectStore("runs").get(runId));
    if (!run || run.state !== "ranking") throw Error("Run stopped");
    const now = Date.now();
    if (now - run.updatedAt > 120000) throw Error("Ranking interrupted");
    const id = "usage:" + new Date(now).toISOString().slice(0, 10);
    const u = (await request<Usage | undefined>(
      tx.objectStore("meta").get(id),
    )) ?? { id, requests: 0, tokens: 0 };
    if (
      !run.analysisOnly &&
      (run.requests >= run.settings.requestsPerScan ||
        u.requests >= run.settings.requestsPerDay)
    )
      throw Error("Request budget exhausted");
    u.requests++;
    run.requests++;
    run.updatedAt = now;
    run.leaseUntil = now + 120000;
    tx.objectStore("runs").put(run);
    tx.objectStore("meta").put(u);
  });
}
// Analysis runs do not add observations, so they use every scan that saw the post.
const feedsOf = (post: Post, run: Run) =>
  post.observations
    .filter((o) => run.analysisOnly || o.runId === run.id)
    .map((o) => o.feed);
export async function basicDigest(run: Run): Promise<Digest> {
  const posts = (await all<Post>("posts")).filter((p) =>
    run.postIds.includes(p.id),
  );
  const ranked = scoreBasic(
    posts,
    run.settings,
    await all<Feedback>("feedback"),
  );
  const items = ranked;
  const byId = new Map(posts.map((p) => [p.id, p]));
  const sources = new Set(items.flatMap((i) => feedsOf(byId.get(i.id)!, run)));
  return {
    id: run.id,
    createdAt: Date.now(),
    items,
    mode: "Basic ranking — no AI analysis",
    model: "",
    notices: [
      ...(run.reason ? [run.reason] : []),
      ...(sources.size < 2 ? ["Collected posts do not cover both feeds."] : []),
    ],
    candidates: posts.length,
    tokens: 0,
  };
}
// Rejected keys, models and pricing fail every batch, so they stop the run.
const fatal = (error: unknown) =>
  error instanceof ProviderError
    ? error.status < 500 && ![408, 429].includes(error.status)
    : error instanceof Error &&
      /pricing changed|Unsupported text model|Online provider required/.test(
        error.message,
      );
// Rate limits, server errors, timeouts and network drops are worth another try.
const transient = (error: unknown) =>
  error instanceof ProviderError ||
  error instanceof TypeError ||
  (error instanceof Error && error.name === "TimeoutError");
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal.addEventListener("abort", stop, { once: true });
  });
export async function rankRun(
  runId: string,
  signal: AbortSignal,
  pause = sleep,
) {
  await navigator.locks.request(
    "ranking",
    { ifAvailable: true },
    async (lock) => {
      if (!lock) return;
      const run = await get<Run>("runs", runId);
      if (!run || run.state !== "ranking") return;
      const baseline = await basicDigest(run);
      const s = run.settings;
      const results: Ranked[] = [];
      const notices: string[] = [];
      let cacheHits = 0;
      let tokens = 0;
      let failedPosts = 0;
      let failedBatches = 0;
      let failure = "";
      const deadline =
        Date.now() +
        (run.analysisOnly
          ? Math.max(150000, run.postIds.length * 65000)
          : 150000);
      const posts = (await all<Post>("posts")).filter((p) =>
        run.postIds.includes(p.id),
      );
      const analysisPosts = posts;
      const audit: AIAudit | undefined =
        s.enabled && s.provider !== "basic"
          ? {
              version: 1,
              promptVersion: PROMPT_VERSION,
              updatedAt: Date.now(),
              collected: posts.length,
              posts: analysisPosts.map(auditPost),
              attempts: run.aiAudit?.attempts ?? [],
              notices: [],
            }
          : undefined;
      for (const previous of audit?.attempts ?? []) {
        tokens += (previous.usage?.input ?? 0) + (previous.usage?.output ?? 0);
        if (previous.status === "running") {
          previous.status = "error";
          previous.finishedAt = Date.now();
          previous.error =
            "Interrupted before the response was recorded; outcome unknown";
        }
      }
      const saveAudit = async () => {
        if (!audit) return;
        audit.updatedAt = Date.now();
        await transaction(["runs"], async (tx) => {
          const live = await request<Run | undefined>(
            tx.objectStore("runs").get(run.id),
          );
          if (live && live.generation === run.generation) {
            live.aiAudit = audit;
            tx.objectStore("runs").put(live);
          }
        });
      };
      await saveAudit();
      try {
        if (!s.enabled || s.provider === "basic")
          throw Error("Basic mode selected");
        const token = await key(s.provider);
        if (!token)
          throw Error(
            "Provider key missing after restart or not configured; using Basic",
          );
        if (
          !(await chrome.permissions.contains({
            origins: [origins[s.provider]],
          }))
        )
          throw Error("Provider permission missing");
        // Cache independent assessments, not batch positions or feed ordering.
        const cacheKeys = new Map<string, string>();
        const uncached: Post[] = [];
        for (const post of analysisPosts) {
          signal.throwIfAborted();
          const postCacheId = async (version: string) =>
            "post:" +
            (await hash(
              JSON.stringify([
                version,
                s.provider,
                s.model,
                post.id,
                post.text,
                post.quotedText,
                post.truncated,
              ]),
            ));
          const cacheId = await postCacheId(PROMPT_VERSION);
          cacheKeys.set(post.id, cacheId);
          // Cache keys include the scoring rubric version; older scores are not reused.
          const cached = await get<{ id: string; content: string; at: number }>(
            "cache",
            cacheId,
          );
          let valid: Ranked[] = [];
          if (cached && cached.at > Date.now() - 30 * 86400000) {
            try {
              valid = validateOutput(cached.content, [post]).filter(
                (item) => item.recommendations !== undefined,
              );
            } catch {
              /* Regenerate invalid cache entries. */
            }
          }
          if (valid.length) {
            results.push(...valid);
            cacheHits++;
            const entry = audit?.posts.find((p) => p.id === post.id);
            if (entry) {
              entry.status = "cached";
              entry.result = valid[0];
            }
          } else uncached.push(post);
        }
        await saveAudit();
        for (let start = 0; start < uncached.length; ) {
          signal.throwIfAborted();
          if (Date.now() >= deadline) throw Error("Ranking deadline reached");
          const live = await get<Run>("runs", run.id);
          if (!active(live) || live?.generation !== run.generation)
            throw Error("Run stopped");
          const batch = uncached.slice(start, start + 10);
          let prompt = makePrompt(batch, s);
          let upperTokens = new TextEncoder().encode(prompt).byteLength + 512;
          while (upperTokens > s.inputTokens && batch.length > 1) {
            batch.pop();
            prompt = makePrompt(batch, s);
            upperTokens = new TextEncoder().encode(prompt).byteLength + 512;
          }
          start += batch.length;
          if (upperTokens > s.inputTokens) {
            notices.push(
              "One post exceeded the input token limit; its source text is still shown.",
            );
            for (const p of audit?.posts ?? [])
              if (batch.some((b) => b.id === p.id)) {
                p.status = "skipped";
                p.note = "Post exceeded the input token limit";
              }
            await saveAudit();
            continue;
          }
          const postIds = batch.map((p) => p.id);
          const auditPosts = (audit?.posts ?? []).filter((p) =>
            postIds.includes(p.id),
          );
          let valid: Ranked[] | undefined;
          for (let tries = 1; !valid; tries++) {
            signal.throwIfAborted();
            if (Date.now() >= deadline) throw Error("Ranking deadline reached");
            await reserve(run.id);
            const entry: AIAttempt = {
              number: (audit?.attempts.length ?? 0) + 1,
              postIds,
              startedAt: Date.now(),
              status: "running",
            };
            audit?.attempts.push(entry);
            for (const p of auditPosts) {
              p.status = "analysing";
              delete p.note;
            }
            await saveAudit();
            try {
              const response = await generate(
                {
                  ...s,
                  outputTokens: Math.max(
                    s.outputTokens,
                    512 + batch.length * 600,
                  ),
                },
                token,
                prompt,
                AbortSignal.any([
                  signal,
                  AbortSignal.timeout(
                    Math.min(30000, Math.max(1, deadline - Date.now())),
                  ),
                ]),
                (usage) => {
                  entry.usage = usage;
                  tokens += (usage.input ?? 0) + (usage.output ?? 0);
                },
              );
              const parsed = validateOutput(response.content, batch);
              signal.throwIfAborted();
              entry.status = "success";
              entry.finishedAt = Date.now();
              valid = parsed;
            } catch (error) {
              entry.status = "error";
              entry.finishedAt = Date.now();
              entry.error = signal.aborted
                ? "Cancelled"
                : error instanceof Error
                  ? error.message
                  : "Analysis failed";
              failure = entry.error;
              for (const p of auditPosts) {
                p.status = "error";
                p.note = entry.error;
              }
              await saveAudit();
              if (signal.aborted || fatal(error)) throw error;
              if (!transient(error) || tries >= 3) break;
              await pause(
                Math.min(
                  30000,
                  Math.max(
                    error instanceof ProviderError ? error.retryAfter : 0,
                    2000 * 2 ** (tries - 1),
                  ),
                ),
                signal,
              );
            }
          }
          if (!valid) {
            // One bad batch must not cost the rest of the run; a streak of them
            // means the provider is down, so stop spending requests.
            failedPosts += batch.length;
            if (++failedBatches >= 3)
              throw Error(
                "Stopped after three batches in a row failed: " + failure,
              );
            continue;
          }
          failedBatches = 0;
          results.push(...valid);
          for (const p of auditPosts) {
            p.result = valid.find((r) => r.id === p.id);
            p.status = p.result ? "analysed" : "no-result";
            if (!p.result)
              p.note = "Provider returned no classification for this post";
            else if (p.result.recommendations === undefined) {
              p.status = "no-result";
              p.note =
                "Buy/sell check missing; the post stays pending for the next analysis";
            }
          }
          await saveAudit();
          const saved = valid;
          await transaction(["cache", "runs"], async (tx) => {
            const live = await request<Run | undefined>(
              tx.objectStore("runs").get(run.id),
            );
            if (live?.state === "ranking" && live.generation === run.generation)
              // Results missing the buy/sell check are re-analysed later.
              for (const result of saved.filter(
                (item) => item.recommendations !== undefined,
              ))
                tx.objectStore("cache").put({
                  id: cacheKeys.get(result.id)!,
                  content: JSON.stringify({
                    items: [{ ...result, id: "c0" }],
                  }),
                  at: Date.now(),
                });
          });
        }
      } catch (error) {
        notices.push(
          signal.aborted
            ? "Ranking cancelled"
            : error instanceof Error
              ? error.message
              : "Online ranking unavailable",
        );
      }
      if (failedPosts)
        notices.unshift(
          `${failedPosts} post${failedPosts === 1 ? "" : "s"} could not be analysed: ${failure}. Analyse again to retry.`,
        );
      const aiIds = new Set(results.map((r) => r.id));
      const basic = scoreBasic(
        posts,
        s,
        await all<Feedback>("feedback"),
      ).filter((r) => !aiIds.has(r.id));
      const items = allPostItems(posts, s, results);
      if (audit) {
        audit.finishedAt = Date.now();
        audit.notices = [...notices];
        for (const p of audit.posts) {
          if (p.status === "pending" || p.status === "analysing") {
            p.status = "skipped";
            p.note = notices.at(-1) ?? "Analysis did not complete";
          }
        }
        await saveAudit();
      }
      await transaction(["runs", "digests"], async (tx) => {
        const live = await request<Run>(tx.objectStore("runs").get(run.id));
        if (
          !live ||
          live.state !== "ranking" ||
          live.generation !== run.generation
        )
          return;
        const digest: Digest = {
          ...baseline,
          items,
          mode: results.length
            ? basic.length
              ? "Mixed AI + Basic ranking"
              : "AI ranking"
            : baseline.mode,
          model: results.length ? s.model : "",
          notices: [
            ...(run.reason ? [run.reason] : []),
            ...(new Set(
              items.flatMap((i) =>
                feedsOf(posts.find((p) => p.id === i.id)!, run),
              ),
            ).size < 2
              ? ["Collected posts do not cover both feeds."]
              : []),
            ...notices,
            ...(cacheHits
              ? [
                  `Reused cached AI analysis for ${cacheHits} unchanged post${cacheHits === 1 ? "" : "s"}.`,
                ]
              : []),
            `AI analysis available for ${results.length} of ${posts.length} collected posts. All collected posts are shown, including posts without AI analysis.`,
          ],
          tokens,
        };
        live.state = signal.aborted
          ? "cancelled"
          : notices.length || Object.values(live.feeds).some((f) => !f.complete)
            ? "partial"
            : "completed";
        live.phase = "finished";
        live.updatedAt = Date.now();
        live.leaseUntil = 0;
        if (audit) {
          for (const p of audit.posts)
            p.selected = items.some((i) => i.id === p.id);
          live.aiAudit = audit;
        }
        tx.objectStore("digests").put(digest);
        tx.objectStore("runs").put(live);
      });
    },
  );
}
