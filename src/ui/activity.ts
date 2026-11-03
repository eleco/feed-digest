import { el, link, notice, shell } from "./common";
import { all } from "../storage/db";
import { active, canonical, type Run } from "../shared/types";
import { auditTotals, type AIUsage } from "../shared/audit";
import { categoryLabel } from "../shared/categories";

const main = shell(
  "AI activity",
  "See what each scan analysed, how posts were categorised, and the usage behind it. Updates automatically while a scan runs.",
);
const controls = el("div", undefined, "panel");
const label = el("label", "Scan");
label.htmlFor = "auditRun";
const chooser = el("select");
chooser.id = "auditRun";
const searchLabel = el("label", "Find a post, category or tone");
searchLabel.htmlFor = "auditSearch";
const search = el("input");
search.id = "auditSearch";
search.type = "search";
search.placeholder = "Search text, author, sector or tone";
const filterLabel = el("label", "Analysis status");
filterLabel.htmlFor = "auditFilter";
const filter = el("select");
filter.id = "auditFilter";
for (const [value, text] of [
  ["all", "All posts"],
  ["analysed", "New AI analysis"],
  ["cached", "Reused from cache"],
  ["error", "Failed"],
  ["skipped", "Skipped"],
  ["no-result", "No classification returned"],
]) {
  const o = el("option", text);
  o.value = value;
  filter.append(o);
}
let runs: Run[] = [];
let current: Run | undefined;
let signature = "";
controls.append(label, chooser, searchLabel, search, filterLabel, filter);
const output = el("section");
output.id = "auditContent";
main.append(
  controls,
  output,
  el(
    "p",
    "Activity is stored on this device with scan history for 30 days and removed by Delete all data. API keys and raw provider responses are not included. Older scans have no detailed log.",
    "muted",
  ),
);
const money = (n: number) => "$" + n.toFixed(6);
const amount = (n: number | null | undefined) =>
  n == null ? "Unavailable" : n.toLocaleString();
function cost(usage?: AIUsage) {
  return usage?.cost == null
    ? "Unavailable"
    : `${money(usage.cost)} ${usage.costKind === "reported" ? "reported" : "estimated"}`;
}
function render() {
  current = runs.find((r) => r.id === chooser.value);
  const expanded = new Set(
    [
      ...output.querySelectorAll<HTMLDetailsElement>(
        "details[open][data-post]",
      ),
    ].map((d) => d.dataset.post),
  );
  output.replaceChildren();
  if (!current) {
    output.append(
      el(
        "p",
        "No scans yet. Start a scan from Your digest to see AI activity here.",
      ),
    );
    return;
  }
  const r = current;
  const a = r.aiAudit;
  output.append(
    el("h2", `${new Date(r.startedAt).toLocaleString()} · ${r.state}`),
    el(
      "p",
      `${r.settings.provider} · ${r.settings.model || "No model"} · ${r.phase}`,
      "muted",
    ),
  );
  if (!a) {
    output.append(
      el(
        "p",
        !r.settings.enabled || r.settings.provider === "basic"
          ? "This run collected posts without AI analysis. Click Analyse visible posts beside Scan to categorise them. Analysis has its own entry in this activity history."
          : active(r)
            ? "Waiting for AI analysis to start. Collection runs first. Keep the digest tab open."
            : "AI was enabled for this scan, but no detailed activity log was saved. This may be an older scan or analysis may not have started. Reload the extension, reopen Settings and the digest, then start a new scan. Older logs cannot be reconstructed.",
      ),
    );
    return;
  }
  const t = auditTotals(a);
  const stats = el("div", undefined, "stats audit-stats");
  for (const [title, value] of [
    ["Posts collected", a.collected],
    ["Posts considered for AI", a.posts.length],
    ["Analysed (including cache)", t.analysed],
    ["Reused from local cache", t.cached],
    ["Analysis attempts", a.attempts.length],
    [
      t.unknownTokens ? "Known input tokens (partial)" : "Input tokens",
      t.input.toLocaleString(),
    ],
    [
      t.unknownTokens ? "Known output tokens (partial)" : "Output tokens",
      t.output.toLocaleString(),
    ],
    [
      t.unknownCost ? "Known cost subtotal (USD)" : "Scan cost (USD)",
      `${money(t.cost)}${a.attempts.some((x) => x.usage?.costKind === "estimated") ? " estimated" : ""}`,
    ],
  ]) {
    const box = el("div");
    box.append(el("strong", String(value)), el("span", String(title)));
    stats.append(box);
  }
  output.append(stats);
  if (t.unknownTokens || t.unknownCost)
    output.append(
      el(
        "p",
        `${t.unknownTokens} attempt(s) have incomplete token usage; ${t.unknownCost} have unknown cost. Missing usage is not treated as free.`,
        "muted",
      ),
    );
  output.append(
    el(
      "p",
      "Costs use provider-reported charges when available, otherwise standard USD token rates verified 27 September 2026. Estimates exclude account discounts and taxes; your provider’s bill is authoritative. Reusing local analysis makes no new AI request. Costs are per request, not per post.",
      "muted",
    ),
  );
  const sources = new Set(
    a.attempts
      .map((x) => x.usage?.pricingSource)
      .filter((x): x is string => !!x),
  );
  for (const source of sources) output.append(link("Pricing source", source));
  for (const message of a.notices) output.append(el("p", message, "notice"));
  if (!a.finishedAt && !active(r))
    output.append(
      el(
        "p",
        "This scan ended before its AI log was finalised. Running attempts have an unknown outcome.",
      ),
    );
  output.append(el("h2", "Requests"));
  if (!a.attempts.length)
    output.append(
      el(
        "p",
        t.cached
          ? "No new requests: analysis was reused from cache."
          : "No analysis requests recorded.",
      ),
    );
  else {
    const wrap = el("div", undefined, "audit-table-wrap");
    const table = el("table", undefined, "audit-table");
    const head = el("thead");
    const row = el("tr");
    for (const h of [
      "Attempt",
      "Status",
      "Posts",
      "Duration",
      "Input tokens",
      "Output tokens",
      "Cost (USD)",
    ])
      row.append(el("th", h));
    head.append(row);
    table.append(head);
    const body = el("tbody");
    for (const req of a.attempts) {
      const tr = el("tr");
      for (const value of [
        String(req.number),
        req.status === "running" && !active(r) ? "Outcome unknown" : req.status,
        req.postIds.join(", "),
        req.finishedAt
          ? `${((req.finishedAt - req.startedAt) / 1000).toFixed(1)}s`
          : "—",
        amount(req.usage?.input),
        amount(req.usage?.output),
        cost(req.usage),
      ])
        tr.append(el("td", value));
      body.append(tr);
      if (req.error) {
        const errorRow = el("tr");
        const cell = el("td", req.error);
        cell.colSpan = 7;
        errorRow.append(cell);
        body.append(errorRow);
      }
    }
    table.append(body);
    wrap.append(table);
    output.append(wrap);
  }
  const q = search.value.trim().toLowerCase();
  const posts = a.posts.filter(
    (p) =>
      (filter.value === "all" || p.status === filter.value) &&
      (!q ||
        [
          p.id,
          p.text,
          p.handle,
          p.result?.takeaway,
          p.result?.reason,
          ...(p.result?.sectors ?? []),
          ...(p.result?.tones ?? []),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q)),
  );
  output.append(
    el("h2", `Post analysis · ${posts.length} of ${a.posts.length}`),
  );
  output.append(
    el(
      "p",
      "All collected posts remain in the digest, including posts whose AI analysis was skipped or failed. Text shows the excerpt used for analysis. Categories and tone labels are the model’s assessments.",
      "muted",
    ),
  );
  for (const p of posts) {
    const card = el("details", undefined, "panel audit-post");
    card.dataset.post = p.id;
    card.open = expanded.has(p.id);
    const summary = el(
      "summary",
      `${p.handle} · ${p.status === "cached" ? "Reused from cache" : p.status} · ${p.text.slice(0, 100)}`,
    );
    card.append(summary, el("p", p.text));
    if (p.quotedText) card.append(el("blockquote", p.quotedText));
    if (canonical(p.url)) card.append(link("Open post on X", p.url));
    if (p.result) {
      card.append(
        el(
          "p",
          `Sector: ${(p.result.sectors ?? []).map(categoryLabel).join(", ") || "Uncategorised"}`,
        ),
        el(
          "p",
          `Tone: ${(p.result.tones ?? []).map(categoryLabel).join(", ") || "Unspecified"}`,
        ),
        el("p", `AI insight score: ${p.result.score}/100`),
      );
      if (p.result.flags.length)
        card.append(el("p", "Flags: " + p.result.flags.join(" · ")));
    }
    if (p.note) card.append(el("p", p.note));
    if (p.selected !== undefined)
      card.append(
        el(
          "p",
          p.selected
            ? "Included in the digest at scan completion"
            : "Not included in the digest at scan completion",
          "muted",
        ),
      );
    const attempts = a.attempts
      .filter((x) => x.postIds.includes(p.id))
      .map((x) => x.number);
    if (attempts.length)
      card.append(
        el(
          "p",
          (attempts.length === 1
            ? "Analysis request: "
            : "Analysis requests: ") + attempts.join(", "),
          "muted",
        ),
      );
    output.append(card);
  }
  if (!posts.length) output.append(el("p", "No posts match these filters."));
}
chooser.addEventListener("change", render);
search.addEventListener("input", render);
filter.addEventListener("change", render);
let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const next = (await all<Run>("runs")).sort(
      (a, b) => b.startedAt - a.startedAt,
    );
    const nextSignature = JSON.stringify(next);
    if (nextSignature === signature) return;
    signature = nextSignature;
    const previous = chooser.value;
    runs = next;
    chooser.replaceChildren();
    for (const run of runs) {
      const o = el(
        "option",
        `${new Date(run.startedAt).toLocaleString()} · ${run.settings.model || "No AI"} · ${run.state}`,
      );
      o.value = run.id;
      chooser.append(o);
    }
    if (runs.some((r) => r.id === previous)) chooser.value = previous;
    render();
  } catch {
    notice("Could not load AI activity. Reopen this page to try again.");
  } finally {
    refreshing = false;
  }
}
void refresh();
setInterval(() => {
  if (!document.hidden) void refresh();
}, 1500);
