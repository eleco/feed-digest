import {
  cachedTheme,
  cachedThemes,
  analyseTheme,
  matchedThemes,
  JEV_ORIGIN,
} from "../ranking/jev";
import { key } from "../storage/settings";
import { readerSnapshot } from "../shared/online-reader";
import { dailyThemes } from "../shared/daily-themes";
import { topRecommendedAssets } from "../shared/recommended-assets";
import { matchesReach, viewFollowerRatio } from "../shared/reach";
import {
  analysisButton,
  pendingAnalysisPosts,
  updateAnalysisButton,
} from "./analysis-button";
import { inDateRange, localDateTime } from "../shared/date-filter";
import { auditTotals } from "../shared/audit";
import {
  defaultDigestFilters,
  readDigestFilters,
  filterDigest,
  type DigestFilters,
} from "../shared/digest-filters";
import { sectors, tones, categoryLabel } from "../shared/categories";
import { validPostLinks } from "../shared/links";
import {
  digestSorts,
  isDigestSort,
  sortDigest,
  type DigestSort,
} from "../shared/digest-sort";
import {
  brand,
  button,
  command,
  el,
  link,
  notice,
  postTime,
  runSummary,
} from "./common";
import {
  all,
  current,
  feedback,
  lastScan,
  latestScanOf,
  savedArchive,
  setPinned,
  transaction,
} from "../storage/db";
import {
  active,
  defaults,
  type Digest,
  type Feedback,
  type Post,
  type Ranked,
  type Run,
} from "../shared/types";
import "./digest.css";
import { rankRun } from "../ranking/engine";
import { allPostItems } from "../ranking/basic";
const app = document.querySelector<HTMLDivElement>("#app")!;
const header = el("header", undefined, "digest-header");
const nav = el("nav");
nav.setAttribute("aria-label", "Main navigation");
const digestLink = link("Digest", "digest.html");
digestLink.setAttribute("aria-current", "page");
nav.append(
  digestLink,
  link("AI activity", "activity.html"),
  link("Settings", "settings.html"),
);
const main = el("main");
const message = el("p", "", "notice");
message.id = "notice";
message.setAttribute("role", "status");
const headerState = el("span", "Ready", "header-state");
header.append(brand(), nav);
app.append(header, main);
const actions = el("div", undefined, "actions");
const savedScope = (await chrome.storage.local.get("digestScope")).digestScope;
let scope = typeof savedScope === "string" ? savedScope : "all";
let visiblePendingIds: string[] = [];
let allPendingPosts: Post[] = [];
let allAnalysisWarning = "";
const analyse = analysisButton("Analyse with AI", () => ({
  scope,
  postIds: [...visiblePendingIds],
}));
const analyseToday = analysisButton("Analyse today's posts", () => ({
  scope: "all",
  postIds: dailyThemes(allPendingPosts, []).posts.map((post) => post.id),
}));
analyseToday.title =
  "Analyses unanalysed saved posts published from midnight to now in your local time, across all scans and filters. May use paid AI credits.";
const analyseAll = analysisButton(
  "Analyse all saved posts",
  () => ({
    scope: "all",
    postIds: allPendingPosts.map((post) => post.id),
  }),
  () =>
    window.confirm(
      `${allAnalysisWarning}\n\nAnalyse all ${allPendingPosts.length} pending saved posts?`,
    ),
);
const collectionControl = el("div", undefined, "digest-sort");
const collectionLabel = el("label", "Saved posts");
collectionLabel.htmlFor = "collectionScope";
const collectionSelect = el("select");
collectionSelect.id = "collectionScope";
let scopeOptions = "";
let savedCount = 0;
collectionSelect.addEventListener("change", () => {
  scope = collectionSelect.value;
  void chrome.storage.local.set({ digestScope: scope });
  void refresh(true);
});
collectionControl.append(collectionLabel, collectionSelect);
const scan = button(
  "Scan both feeds ↗",
  async () => {
    await command("start");
    scope = "all";
    await chrome.storage.local.set({ digestScope: scope });
    await refresh(true);
  },
  "primary",
);
const stop = button("Stop", async () => {
  abort?.abort();
  await command("stop");
  await refresh(true);
});
scan.title =
  "Scanning opens a visible, dedicated X tab. Stop at any time; saved posts stay on this device.";
actions.append(analyse, scan, stop);
const stats = el("div", undefined, "header-stats");
header.append(stats, headerState, actions);
analyse.title =
  "Adds sector and tone labels, insight scores and buy/sell tags to unanalysed posts in this view.";
// One compact bar holds AI status and saved-post analysis options.
const analysisBar = el("section", undefined, "analysis-bar");
analysisBar.setAttribute("aria-label", "AI analysis");
const analysisWarning = el("p", undefined, "analysis-warning");
analysisWarning.id = "analysisWarning";
analysisWarning.setAttribute("aria-live", "polite");
analysisWarning.hidden = true;
analyseAll.setAttribute("aria-describedby", analysisWarning.id);
const aiStatus = el("p", undefined, "muted ai-status");
aiStatus.id = "aiStatus";
aiStatus.setAttribute("aria-live", "polite");
const analysisText = el("div", undefined, "analysis-text");
analysisText.append(aiStatus, analysisWarning);
analysisBar.append(analysisText, analyseToday, analyseAll);
const exportOnline = button("Export for online reader", async () => {
  const archive = await savedArchive();
  const annotations: Ranked[] = [];
  for (const run of [...archive.runs].sort(
    (a, b) => a.startedAt - b.startedAt,
  )) {
    annotations.push(
      ...(archive.digests
        .find((digest) => digest.id === run.id)
        ?.items.filter((item) => item.mode === "ai") ?? []),
    );
    annotations.push(
      ...(run.aiAudit?.posts.flatMap((post) =>
        post.result ? [post.result] : [],
      ) ?? []),
    );
  }
  const snapshot = readerSnapshot(archive.posts, annotations);
  const stream = new Blob([JSON.stringify(snapshot)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const blob = await new Response(stream).blob();
  if (blob.size > 4_000_000)
    throw Error(
      "This collection is too large for the online reader (4 MB compressed maximum).",
    );
  const url = URL.createObjectURL(blob);
  const download = document.createElement("a");
  download.href = url;
  download.download = "x-feed-digest-reader.json.gz";
  download.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  notice(
    `Exported ${snapshot.posts.length} saved posts. Upload the file on your online reader.`,
  );
});
const aiProgressPanel = el("section", undefined, "panel ai-progress");
aiProgressPanel.hidden = true;
aiProgressPanel.setAttribute("aria-label", "AI analysis progress");
const aiProgressLabel = el("label");
aiProgressLabel.htmlFor = "aiProgress";
const aiProgress = el("progress");
aiProgress.id = "aiProgress";
const aiCost = el("output");
aiCost.id = "aiCost";
aiCost.setAttribute("aria-label", "AI cost this run");
aiProgressPanel.append(aiProgressLabel, aiProgress, aiCost);

const layout = el("div", undefined, "layout");
const list = el("section", undefined, "digest-feed");
const filters = el("div", undefined, "filters");
const cards = el("div", undefined, "post-stack");
const themesPanel = el("section", undefined, "daily-themes panel");
themesPanel.id = "dailyThemes";
themesPanel.setAttribute(
  "aria-label",
  "What is your feed talking about today?",
);
let selectedTheme = "";
let semanticThemes = new Map<string, string[]>();
let themeAbort: AbortController | undefined;
let themeMessage = "";
let jevConfigured = false;
let themeSetupMessage = false;
const themeStatus = el("p", undefined, "muted");
themeStatus.setAttribute("role", "status");
const themeSetup = link("Set up Jev", "settings.html#jevSettings");
themeSetup.hidden = true;
async function updateJevSetup() {
  jevConfigured = !!(await key("jev"));
  if (jevConfigured && themeSetupMessage) {
    themeMessage = "";
    themeSetupMessage = false;
  }
}
const themeAnalyse = button("Analyse themes with Jev", async () => {
  if (themeAbort) return;
  const token = await key("jev");
  if (!token) {
    themeSetupMessage = true;
    themeMessage = semanticThemes.size
      ? "Saved Jev results are available. Add your key in Settings to analyse new posts."
      : "Add your Jev key in Settings to analyse themes.";
    render();
    return;
  }
  if (!(await chrome.permissions.contains({ origins: [JEV_ORIGIN] }))) {
    themeSetupMessage = true;
    themeMessage =
      "Your Jev key is saved. Check the connection in Settings to restore TypeSafe access.";
    render();
    return;
  }
  themeSetupMessage = false;
  const controller = new AbortController();
  themeAbort = controller;
  const selectedPosts = dailyThemes(posts, digest?.items ?? []).posts;
  let done = 0,
    reused = 0,
    tokens = 0,
    missingUsage = false;
  const progress = () => {
    themeMessage = `${done} of ${selectedPosts.length} posts classified · ${reused} cached · $${((tokens * 0.042) / 1000000).toFixed(6)} USD estimated${missingUsage ? " (partial usage)" : ""}. Keep this tab open.`;
    render();
  };
  progress();
  try {
    for (const post of selectedPosts) {
      controller.signal.throwIfAborted();
      if (!(await key("jev")))
        throw Error("Jev key removed. Analysis stopped.");
      const cached = await cachedTheme(post);
      if (cached) reused++;
      const result = cached
        ? { assessment: cached, inputTokens: 0 }
        : await analyseTheme(
            post,
            token,
            AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
          );
      if (result.inputTokens === null) missingUsage = true;
      else tokens += result.inputTokens;
      semanticThemes.set(
        post.id,
        matchedThemes(result.assessment.probabilities),
      );
      done++;
      progress();
    }
    themeMessage += " Finished.";
  } catch (error) {
    themeMessage += controller.signal.aborted
      ? " Stopped; completed results are saved."
      : ` ${error instanceof Error ? error.message : "Jev analysis failed."} Completed results are saved; remaining posts use local matching. Usage for the interrupted or failed request may be unavailable.`;
  } finally {
    themeAbort = undefined;
    await refresh();
    render();
  }
});
const themeStop = button("Stop theme analysis", () => themeAbort?.abort());
const sortControl = el("div", undefined, "digest-sort");
const sortLabel = el("label", "Sort posts");
sortLabel.htmlFor = "digestSort";
const sortSelect = el("select");
sortSelect.id = "digestSort";
for (const [value, label] of Object.entries(digestSorts)) {
  const option = el("option", label);
  option.value = value;
  sortSelect.append(option);
}
const savedSort = (await chrome.storage.local.get("digestSort")).digestSort;
let sort: DigestSort = isDigestSort(savedSort) ? savedSort : "insight";
if (savedSort === "score" || savedSort === "pinned")
  await chrome.storage.local.set({ digestSort: sort });
sortSelect.value = sort;
let sortWrite = Promise.resolve();
sortSelect.addEventListener("change", () => {
  if (!isDigestSort(sortSelect.value)) return;
  sort = sortSelect.value;
  render();
  const selectedSort = sort;
  sortWrite = sortWrite
    .then(() => chrome.storage.local.set({ digestSort: selectedSort }))
    .catch(() => notice("Could not save the sort preference."));
});
sortControl.append(sortLabel, sortSelect);
let rollingDates = true;
let dateMinute = 0;
let rollingDays = 1;
function refreshDateView() {
  if (scope === "latest") {
    scope = "all";
    void chrome.storage.local.set({ digestScope: scope });
    void refresh(true).catch((error) => notice(error.message));
  } else render();
}
const dateControls = el("div", undefined, "form-grid");
function dateInput(id: string, label: string) {
  const wrapper = el("div");
  const caption = el("label", label);
  caption.htmlFor = id;
  const input = el("input");
  input.id = id;
  input.type = "datetime-local";
  input.step = "1";
  input.addEventListener("change", () => {
    rollingDates = false;
    whenSelect.value = "custom";
    refreshDateView();
  });
  wrapper.append(caption, input);
  dateControls.append(wrapper);
  return input;
}
const startDate = dateInput("postStartDate", "From");
const endDate = dateInput("postEndDate", "To");
const whenControl = el("div", undefined, "filter-row");
const whenLabel = el("label", "When");
whenLabel.htmlFor = "whenFilter";
const whenSelect = el("select");
whenSelect.id = "whenFilter";
for (const [value, title] of [
  ["today", "Today"],
  ["1", "Last 24 hours"],
  ["3", "3 days"],
  ["7", "Week"],
  ["all", "All"],
  ["custom", "Custom…"],
]) {
  const option = el("option", title);
  option.value = value;
  whenSelect.append(option);
}
whenSelect.value = "1";
whenSelect.addEventListener("change", () => {
  rollingDates = ["today", "1", "3", "7"].includes(whenSelect.value);
  if (rollingDates && whenSelect.value !== "today")
    rollingDays = Number(whenSelect.value);
  if (whenSelect.value === "all") {
    startDate.value = "";
    endDate.value = "";
  }
  refreshDateView();
});
whenControl.append(whenLabel, whenSelect);
const dateError = el("p", undefined, "muted");
dateError.setAttribute("role", "status");
const categoryFilters = el("div", undefined, "form-grid");
function categorySelect(id: string, label: string, values: readonly string[]) {
  const wrapper = el("div", undefined, "filter-row");
  const caption = el("label", label);
  caption.htmlFor = id;
  const select = el("select");
  select.id = id;
  for (const [value, text] of [
    ["all", "All"],
    ["unclassified", "Unclassified"],
    ...values.map((value) => [value, categoryLabel(value)]),
  ]) {
    const option = el("option", text);
    option.value = value;
    select.append(option);
  }
  select.addEventListener("change", () => render());
  wrapper.append(caption, select);
  categoryFilters.append(wrapper);
  return select;
}
const sectorFilter = categorySelect("sectorFilter", "Sector", sectors);
const toneFilter = categorySelect("toneFilter", "Tone", tones);
const recommendedAssets = el("section", undefined, "recommended-assets panel");
recommendedAssets.id = "recommendedAssets";
recommendedAssets.setAttribute("aria-label", "Top 10 recommended assets");
recommendedAssets.hidden = true;
let selectedAuthor = "";
const authorPanel = el("section", undefined, "authors-section");
authorPanel.setAttribute("aria-label", "Authors");
const authorHeading = el("h3", "Authors");
const authorList = el("div", undefined, "author-list");
const authorSearch = el("input");
authorSearch.type = "search";
authorSearch.placeholder = "Filter by name or @handle";
authorSearch.setAttribute("aria-label", "Filter authors");
authorSearch.addEventListener("input", () => render());
let showSingleAuthors = false;
const moreAuthors = button(
  "",
  () => {
    showSingleAuthors = !showSingleAuthors;
    render();
  },
  "more-authors",
);
authorPanel.append(authorHeading, authorSearch, authorList, moreAuthors);
const linksFilter = el("input");
linksFilter.type = "checkbox";
linksFilter.addEventListener("change", () => render());
const linksLabel = el("label", undefined, "check");
linksLabel.append(
  linksFilter,
  document.createTextNode("Only posts with links"),
);
const pinsFilter = el("input");
pinsFilter.type = "checkbox";
pinsFilter.addEventListener("change", () => render());
const pinsLabel = el("label", undefined, "check");
pinsLabel.append(pinsFilter, document.createTextNode("Only pinned posts"));
const reachControl = el("div", undefined, "reach-control");
const reachEnabled = el("input");
reachEnabled.type = "checkbox";
const reachLabel = el("label", undefined, "check");
reachLabel.append(
  reachEnabled,
  document.createTextNode("High views vs followers"),
);
const reachThreshold = el("select");
reachThreshold.setAttribute(
  "aria-label",
  "Minimum views relative to followers",
);
for (const value of [2, 5, 10]) {
  const option = el("option", `At least ${value}× followers`);
  option.value = String(value);
  reachThreshold.append(option);
}
const rawReach = (await chrome.storage.local.get("digestReach")).digestReach;
const savedReach =
  rawReach && typeof rawReach === "object"
    ? (rawReach as Record<string, unknown>)
    : {};
reachEnabled.checked = savedReach?.enabled === true;
reachThreshold.value = [2, 5, 10].includes(Number(savedReach.threshold))
  ? String(savedReach.threshold)
  : "2";
const reachHelp = el("small");
reachHelp.id = "reachHelp";
reachEnabled.setAttribute("aria-describedby", reachHelp.id);
let reachWrite = Promise.resolve();
const changeReach = () => {
  const snapshot = {
    enabled: reachEnabled.checked,
    threshold: Number(reachThreshold.value),
  };
  reachWrite = reachWrite
    .then(() => chrome.storage.local.set({ digestReach: snapshot }))
    .catch(() => notice("Could not save the reach filter."));
  render();
};
reachEnabled.addEventListener("change", changeReach);
reachThreshold.addEventListener("change", changeReach);
reachControl.append(reachLabel, reachThreshold, reachHelp);
let visibility = readDigestFilters(
  (await chrome.storage.local.get("digestVisibility")).digestVisibility,
);
let visibilityWrite = Promise.resolve();
const visibilityControls = el("details", undefined, "digest-visibility panel");
visibilityControls.append(el("summary", "Hide posts from this view"));
const blacklistLabel = el("label", "Blacklisted words");
blacklistLabel.htmlFor = "postBlacklist";
const blacklistInput = el("textarea");
blacklistInput.id = "postBlacklist";
blacklistInput.rows = 4;
blacklistInput.maxLength = 10000;
blacklistInput.placeholder = "One word or phrase per line";
const savedBlacklist = (await chrome.storage.local.get("digestBlacklist"))
  .digestBlacklist;
blacklistInput.value =
  typeof savedBlacklist === "string" ? savedBlacklist.slice(0, 10000) : "";
const saveBlacklist = () => {
  const snapshot = blacklistInput.value;
  visibilityWrite = visibilityWrite
    .then(() => chrome.storage.local.set({ digestBlacklist: snapshot }))
    .catch(() => notice("Could not save blacklisted words."));
  render();
};
blacklistInput.addEventListener("input", saveBlacklist);
const visibilityInputs = new Map<keyof DigestFilters, HTMLInputElement>();
const saveVisibility = () => {
  const snapshot = { ...visibility };
  visibilityWrite = visibilityWrite
    .then(() => chrome.storage.local.set({ digestVisibility: snapshot }))
    .catch(() => notice("Could not save display filters."));
  render();
};
for (const [key, label] of [
  ["lowScores", "Hide low AI scores (below 30/100)"],
  ["repeatedText", "Hide repeated text"],
  ["repeatedAuthors", "Limit to 2 posts per author"],
  ["notUseful", "Hide posts marked Not useful"],
] as const) {
  const input = el("input");
  input.type = "checkbox";
  input.checked = visibility[key];
  input.addEventListener("change", () => {
    visibility[key] = input.checked;
    saveVisibility();
  });
  const labelElement = el("label", undefined, "check");
  labelElement.append(input, document.createTextNode(label));
  visibilityInputs.set(key, input);
  visibilityControls.append(labelElement);
}
visibilityControls.append(
  blacklistLabel,
  blacklistInput,
  el(
    "small",
    "One word or phrase per line. Matches any part of post or quoted text, ignoring case. Saves automatically.",
  ),
  button("Reset these filters", () => {
    visibility = { ...defaultDigestFilters };
    for (const input of visibilityInputs.values()) input.checked = false;
    saveVisibility();
    blacklistInput.value = "";
    saveBlacklist();
  }),
);
const visibleCount = el("p", undefined, "muted");
visibleCount.id = "visibleCount";
visibleCount.setAttribute("aria-live", "polite");
const feedHeading = el("div", undefined, "feed-heading");
feedHeading.append(el("h1", "Your digest"), visibleCount);
list.append(
  feedHeading,
  message,
  analysisBar,
  aiProgressPanel,
  recommendedAssets,
  themesPanel,
  cards,
);
const aside = el("aside", undefined, "digest-rail");
aside.id = "digestRail";
aside.setAttribute("aria-label", "Reading filters");
const filterSection = el("section", undefined, "rail-filters");
filterSection.append(
  el("h3", "Filters", "rail-title"),
  whenControl,
  dateControls,
  dateError,
  categoryFilters,
  sortControl,
  linksLabel,
  pinsLabel,
  reachControl,
);
sortControl.className = "filter-row";
sortLabel.textContent = "Sort";
sortSelect.setAttribute("aria-label", "Sort posts");
const historyDetails = el("details", undefined, "scan-history");
historyDetails.append(el("summary", "Scan history"), collectionControl);
historyDetails.append(exportOnline);
const drawerClose = button(
  "Close filters",
  () => closeDrawer(),
  "drawer-close",
);
aside.append(
  drawerClose,
  filters,
  filterSection,
  authorPanel,
  historyDetails,
  visibilityControls,
);
const drawerToggle = button(
  "Filters",
  () => {
    const opened = aside.classList.toggle("is-open");
    drawerToggle.setAttribute("aria-expanded", String(opened));
    drawerBackdrop.hidden = !opened;
    document.body.classList.toggle("drawer-open", opened);
    if (opened) drawerClose.focus();
  },
  "drawer-toggle",
);
drawerToggle.setAttribute("aria-controls", "digestRail");
drawerToggle.setAttribute("aria-expanded", "false");
const drawerBackdrop = button(
  "Close filters",
  () => closeDrawer(),
  "drawer-backdrop",
);
drawerBackdrop.hidden = true;
function closeDrawer() {
  aside.classList.remove("is-open");
  drawerToggle.setAttribute("aria-expanded", "false");
  drawerBackdrop.hidden = true;
  document.body.classList.remove("drawer-open");
  drawerToggle.focus();
}
aside.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDrawer();
  if (event.key === "Tab" && aside.classList.contains("is-open")) {
    const controls = [
      ...aside.querySelectorAll<HTMLElement>(
        "button, input, select, textarea, summary",
      ),
    ].filter(
      (node) =>
        node.getClientRects().length && !(node as HTMLButtonElement).disabled,
    );
    const first = controls[0],
      last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
});
window.matchMedia("(min-width: 900px)").addEventListener("change", (event) => {
  if (event.matches && aside.classList.contains("is-open")) closeDrawer();
});
feedHeading.append(drawerToggle);
layout.append(aside, list);
main.append(layout, drawerBackdrop);
new ResizeObserver(() =>
  document.documentElement.style.setProperty(
    "--digest-header-height",
    `${header.offsetHeight}px`,
  ),
).observe(header);
let filter = "all",
  run: Run | undefined,
  digest: Digest | undefined,
  posts: Post[] = [];
let postFeedback: Feedback[] = [];
let postById = new Map<string, Post>();
// AI analysis runs are not scans; "Latest scan" always means the last feed scan.
let latestScanId = "";
let abort: AbortController | undefined;
let rankingId = "";
for (const [id, label] of [
  ["all", "All posts"],
  ["following", "Following"],
  ["for-you", "For You"],
]) {
  const b = button(label, () => {
    filter = id;
    render();
  });
  b.dataset.filter = id;
  b.setAttribute("aria-label", label);
  b.replaceChildren(el("span", label), el("span", "0", "feed-count"));
  filters.append(b);
}
const PAGE_SIZE = 50;
let cardPage = 0;
let pageView = "";
const compactNumber = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
function render() {
  const now = Date.now();
  dateMinute = Math.floor(now / 60000);
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const rollingStart =
    whenSelect.value === "today"
      ? midnight.getTime()
      : now - rollingDays * 86400000;
  if (rollingDates) {
    startDate.value = localDateTime(rollingStart);
    endDate.value = localDateTime(now);
  }
  const from = rollingDates
    ? rollingStart
    : startDate.value
      ? new Date(startDate.value).getTime()
      : null;
  const to = rollingDates
    ? now
    : endDate.value
      ? new Date(endDate.value).getTime()
      : null;
  dateError.textContent =
    from !== null && to !== null && from > to
      ? "Start must be before end."
      : "";
  dateError.hidden = !dateError.textContent;
  dateControls.hidden = whenSelect.value !== "custom";
  reachThreshold.disabled = !reachEnabled.checked;
  const unknownReach = posts.filter(
    (post) => viewFollowerRatio(post) === null,
  ).length;
  reachHelp.textContent = `Views divided by followers when collected. ${unknownReach} of ${posts.length} posts lack these counts and are hidden while this is on.`;
  const daily = dailyThemes(posts, digest?.items ?? [], now, semanticThemes);
  if (!daily.themes.some((theme) => theme.id === selectedTheme))
    selectedTheme = "";
  const activeTheme = daily.themes.find((theme) => theme.id === selectedTheme);
  const themeIds = activeTheme ? new Set(activeTheme.postIds) : null;
  themesPanel.replaceChildren(
    el("h2", "What is your feed talking about today?"),
  );
  const classifiedThemes = daily.posts.filter((post) =>
    semanticThemes.has(post.id),
  ).length;
  const pendingThemes = daily.posts.length - classifiedThemes;
  themeAnalyse.disabled = !!themeAbort || pendingThemes === 0;
  themeSetup.hidden =
    jevConfigured || (classifiedThemes > 0 && pendingThemes === 0);
  themeSetup.textContent =
    classifiedThemes > 0 ? "Reconnect Jev" : "Set up Jev";
  themeStop.hidden = !themeAbort;
  themeStatus.textContent =
    (themeSetupMessage && pendingThemes === 0 ? "" : themeMessage) ||
    `${classifiedThemes} of ${daily.posts.length} posts classified with Jev.${pendingThemes ? " Remaining posts use local matching." : ""}`;
  themesPanel.append(themeAnalyse, themeStop, themeStatus, themeSetup);
  const mainThemes = daily.themes
    .filter((theme) => theme.id !== "other")
    .slice(0, 3);
  themesPanel.append(
    el(
      "p",
      daily.posts.length
        ? `Today's ${daily.posts.length} collected posts${mainThemes.length ? ` mainly cover ${mainThemes.map((theme) => `${theme.label.toLowerCase()} (${theme.postIds.length})`).join(", ")}` : " cover a mix of other conversations"}.`
        : "No posts published today in this collection yet. Scan your feeds to collect more posts.",
    ),
  );
  themesPanel.title =
    "Today means midnight to now in your local time. Topics use post text and AI labels, and a post can appear in several themes.";
  const themeControls = el("div", undefined, "theme-controls");
  for (const theme of daily.themes) {
    const control = button(`${theme.label} · ${theme.postIds.length}`, () => {
      selectedTheme = selectedTheme === theme.id ? "" : theme.id;
      render();
      themesPanel
        .querySelector<HTMLButtonElement>(`[data-theme="${theme.id}"]`)
        ?.focus({ preventScroll: true });
    });
    control.dataset.theme = theme.id;
    control.setAttribute("aria-pressed", String(selectedTheme === theme.id));
    themeControls.append(control);
  }
  themesPanel.append(themeControls);
  if (activeTheme)
    themesPanel.append(
      button("Clear theme filter", () => {
        selectedTheme = "";
        render();
      }),
    );
  const financeSelected = sectorFilter.value === "finance";
  const sortedItems = sortDigest(
    (digest?.items ?? []).filter((r) => {
      const p = postById.get(r.id);
      return (
        p &&
        (!themeIds || themeIds.has(p.id)) &&
        inDateRange(p.publishedAt, from, to) &&
        matchesReach(
          p,
          reachEnabled.checked ? Number(reachThreshold.value) : 0,
        ) &&
        (sectorFilter.value === "all" ||
          (sectorFilter.value === "finance" && !!r.recommendations?.length) ||
          (sectorFilter.value === "unclassified"
            ? !r.sectors?.length
            : r.sectors?.some((value) => value === sectorFilter.value))) &&
        (toneFilter.value === "all" ||
          (toneFilter.value === "unclassified"
            ? !r.tones?.length
            : r.tones?.some((value) => value === toneFilter.value))) &&
        (!linksFilter.checked || !!p.links?.length) &&
        (!pinsFilter.checked || p.pinned) &&
        (filter === "all" ||
          p.observations.some(
            (o) =>
              o.feed === filter &&
              (scope === "all" ||
                o.runId === (scope === "latest" ? latestScanId : scope)),
          ))
      );
    }),
    posts,
    sort,
  );
  const matchingItems = filterDigest(
    sortedItems,
    posts,
    postFeedback,
    visibility,
    blacklistInput.value.split(/\r?\n/),
  );
  const authorScrollTop = authorList.scrollTop;
  const railScrollTop = aside.scrollTop;
  const focusedAuthor = authorList.contains(document.activeElement)
    ? (document.activeElement as HTMLElement).dataset.author
    : undefined;
  const authors = new Map<
    string,
    { name: string; handle: string; count: number }
  >();
  const matchingIds = new Set(matchingItems.map((item) => item.id));
  for (const post of posts.filter((post) => matchingIds.has(post.id))) {
    const id = post.handle.toLowerCase();
    const author = authors.get(id);
    if (author) author.count++;
    else authors.set(id, { name: post.author, handle: post.handle, count: 1 });
  }
  // Keep an active author selectable even when another filter leaves zero posts.
  if (selectedAuthor && !authors.has(selectedAuthor)) {
    const post = posts.find(
      (post) => post.handle.toLowerCase() === selectedAuthor,
    );
    if (post)
      authors.set(selectedAuthor, {
        name: post.author,
        handle: post.handle,
        count: 0,
      });
    else selectedAuthor = "";
  }
  const items = matchingItems.filter(
    (item) =>
      !selectedAuthor ||
      postById.get(item.id)?.handle.toLowerCase() === selectedAuthor,
  );
  const view = JSON.stringify([
    scope,
    filter,
    sort,
    whenSelect.value,
    rollingDates ? null : [startDate.value, endDate.value],
    sectorFilter.value,
    toneFilter.value,
    linksFilter.checked,
    pinsFilter.checked,
    reachEnabled.checked,
    reachThreshold.value,
    visibility,
    blacklistInput.value,
    selectedTheme,
    selectedAuthor,
  ]);
  if (view !== pageView) cardPage = 0;
  pageView = view;
  cardPage = Math.min(
    cardPage,
    Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1),
  );
  const pageStart = cardPage * PAGE_SIZE;
  const pageItems = items.slice(pageStart, pageStart + PAGE_SIZE);
  const feedbackById = new Map(
    postFeedback.map((entry) => [entry.id, entry.value]),
  );
  authorHeading.replaceChildren(
    el("span", "Authors"),
    el("span", String(authors.size), "author-total"),
  );
  authorList.replaceChildren();
  const authorButton = (id: string, label: string) => {
    const control = button(label, () => {
      selectedAuthor = id;
      render();
    });
    control.setAttribute("aria-pressed", String(selectedAuthor === id));
    control.dataset.author = id;
    control.title = label;
    control.setAttribute("aria-label", label);
    if (id) {
      const author = authors.get(id)!;
      control.replaceChildren(
        el("span", author.name.slice(0, 2).toUpperCase(), "avatar"),
        el(
          "span",
          author.name.trim().split(/\s+/)[0] || "@" + author.handle,
          "author-name",
        ),
        el("span", String(author.count), "author-count"),
      );
    } else control.className = "all-authors";
    authorList.append(control);
  };
  authorButton("", `All authors (${matchingItems.length})`);
  const search = authorSearch.value.trim().toLowerCase();
  const singleCount = [...authors.values()].filter(
    (author) => author.count === 1,
  ).length;
  for (const [id, author] of [...authors].sort(
    (a, b) => b[1].count - a[1].count || a[1].name.localeCompare(b[1].name),
  )) {
    if (
      search &&
      !`${author.name} @${author.handle}`.toLowerCase().includes(search)
    )
      continue;
    if (
      !search &&
      !showSingleAuthors &&
      author.count === 1 &&
      id !== selectedAuthor
    )
      continue;
    authorButton(id, `${author.name} · @${author.handle} (${author.count})`);
  }
  moreAuthors.hidden = singleCount === 0 || !!search;
  moreAuthors.textContent = showSingleAuthors
    ? "Show fewer authors"
    : `+${singleCount} more · single-post authors hidden`;
  moreAuthors.setAttribute("aria-expanded", String(showSingleAuthors));
  scan.disabled = active(run);
  stop.disabled = !active(run);
  stop.hidden = !active(run);
  const visibleIds = new Set(items.map((item) => item.id));
  visiblePendingIds = pendingAnalysisPosts(
    posts.filter((post) => visibleIds.has(post.id)),
    digest?.items ?? [],
  ).map((post) => post.id);
  updateAnalysisButton(analyse, run, visiblePendingIds.length);
  updateAnalysisButton(analyseAll, run, allPendingPosts.length);
  updateAnalysisButton(
    analyseToday,
    run,
    dailyThemes(allPendingPosts, [], now).posts.length,
  );
  const hiddenPending = allPendingPosts.filter(
    (post) => !visibleIds.has(post.id),
  ).length;
  const olderPending = allPendingPosts.filter(
    (post) =>
      from !== null && post.publishedAt !== null && post.publishedAt < from,
  ).length;
  const otherHiddenPending = hiddenPending - olderPending;
  const hiddenReasons = [
    olderPending ? `${olderPending} before your start date` : "",
    otherHiddenPending
      ? `${otherHiddenPending} excluded by filters or scan`
      : "",
  ].filter(Boolean);
  allAnalysisWarning = `${hiddenPending} unanalysed post${hiddenPending === 1 ? "" : "s"} hidden: ${hiddenReasons.join("; ")}. Analyse all saved posts includes them and may use paid AI credits.`;
  // Only warn when Analyse all would actually reach beyond this view.
  analysisWarning.hidden = hiddenPending === 0;
  analyseAll.hidden = hiddenPending === 0;
  analysisWarning.classList.toggle("has-hidden-posts", hiddenPending > 0);
  analysisWarning.textContent = `${allAnalysisWarning} Analyse with AI covers shown posts only.`;
  stats.replaceChildren();
  const analysed = (digest?.items ?? []).filter(
    (item) => item.mode === "ai",
  ).length;
  let analysisMessage =
    "Scan your feeds, then click Analyse with AI to add labels and insight scores.";
  if (run) {
    if (run.state === "collecting")
      analysisMessage =
        "Collecting posts. When finished, click Analyse with AI.";
    else if (!run.settings?.enabled || run.settings?.provider === "basic")
      analysisMessage = `${analysed} of ${posts.length} posts have AI labels. Click Analyse with AI to label the rest in this view.`;
    else if (run.state === "ranking")
      analysisMessage = `AI analysis is running for ${run.postIds.length} posts. The selected collection has ${posts.length} posts. Keep the digest tab open.`;
    else {
      const reason =
        run.aiAudit?.notices.at(-1) ??
        [...(run.aiAudit?.attempts ?? [])]
          .reverse()
          .find((attempt) => attempt.error)?.error;
      analysisMessage = analysed
        ? `${analysed} of ${posts.length} posts in the selected collection have AI analysis.${reason ? " " + reason : ""}`
        : `No AI classifications were saved. ${reason ?? run.reason ?? ""}`;
    }
  }
  aiStatus.replaceChildren(
    document.createTextNode(analysisMessage + " "),
    link("View AI activity", "activity.html"),
  );
  const audit = run?.aiAudit;
  aiProgressPanel.hidden = !audit && run?.state !== "ranking";
  const total = audit?.posts.length ?? run?.postIds.length ?? 0;
  const totals = audit ? auditTotals(audit) : undefined;
  const done = totals?.analysed ?? 0;
  aiProgress.max = Math.max(1, total);
  aiProgress.value = done;
  const progressText = `${run?.state === "ranking" ? "Current" : "Latest"} run: ${done} of ${total} posts analysed${totals?.cached ? ` · ${totals.cached} cached (included)` : ""}. Progress is for this run only.`;
  aiProgressLabel.textContent = progressText;
  aiProgress.setAttribute("aria-valuetext", progressText);
  const pending =
    audit?.attempts.filter((a) => a.status === "running").length ?? 0;
  const missing =
    audit?.attempts.filter(
      (a) => a.status !== "running" && a.usage?.cost == null,
    ).length ?? 0;
  const known = audit?.attempts.some((a) => a.usage?.cost != null);
  const estimated = audit?.attempts.some(
    (a) => a.usage?.costKind === "estimated",
  );
  aiCost.textContent =
    !known && (pending || missing)
      ? `AI cost this run: ${pending ? "awaiting usage" : "unavailable"}`
      : `AI cost this run: $${(totals?.cost ?? 0).toFixed(6)} USD${estimated ? " estimated" : ""}${pending || missing ? " · known subtotal" : ""}`;
  for (const [value, label] of [
    [posts.length, "collected"],
    [analysed, "analysed"],
  ] as const) {
    const stat = el("span");
    stat.append(
      el("strong", value.toLocaleString()),
      document.createTextNode(" " + label),
    );
    stats.append(stat);
  }
  headerState.textContent = !run
    ? "No scans yet"
    : run.state === "collecting"
      ? "Scanning…"
      : run.state === "ranking"
        ? "Analysing…"
        : run.state === "completed"
          ? "Last run complete"
          : run.state === "partial"
            ? "Last run stopped early"
            : run.state === "cancelled"
              ? "Last run stopped"
              : run.state === "blocked"
                ? "Last run blocked"
                : "Last run interrupted";
  headerState.title = runSummary(run);
  for (const b of filters.querySelectorAll<HTMLButtonElement>("button")) {
    const id = b.dataset.filter!;
    b.setAttribute("aria-pressed", String(id === filter));
    const count = posts.filter(
      (p) =>
        id === "all" ||
        p.observations.some(
          (o) =>
            o.feed === id &&
            (scope === "all" ||
              o.runId === (scope === "latest" ? latestScanId : scope)),
        ),
    ).length;
    b.querySelector(".feed-count")!.textContent = count.toLocaleString();
  }
  // Re-rendering replaces the cards; remember which card control had focus.
  const focusedCard = cards.contains(document.activeElement)
    ? {
        id: (document.activeElement as HTMLElement).closest<HTMLElement>(
          "article[data-post-id]",
        )?.dataset.postId,
        label: document.activeElement?.textContent ?? "",
      }
    : undefined;
  cards.replaceChildren();
  recommendedAssets.hidden = !financeSelected;
  recommendedAssets.replaceChildren();
  if (financeSelected) {
    const ranked = digest?.items ?? [];
    const checked = ranked.filter(
      (item) => item.mode === "ai" && item.recommendations !== undefined,
    ).length;
    const rows = topRecommendedAssets(ranked);
    const collectionName =
      collectionSelect.selectedOptions[0]?.textContent ?? "Selected collection";
    recommendedAssets.append(
      el("h2", "Top 10 recommended assets"),
      el(
        "p",
        `${collectionName}. Ranked by distinct posts with buy or sell recommendations; display filters do not change this ranking.`,
        "muted",
      ),
      el(
        "p",
        `${checked} of ${posts.length} posts checked for recommendations.${checked < posts.length ? " Ranking is incomplete until the remaining posts are analysed." : ""}`,
        "muted",
      ),
    );
    if (!rows.length) {
      recommendedAssets.append(
        el(
          "p",
          checked
            ? "No asset recommendations found in the analysed posts."
            : "Analyse posts to see recommended assets here.",
        ),
      );
    } else {
      const table = el("table");
      const head = el("thead");
      const headings = el("tr");
      for (const label of ["Asset", "Type", "Posts", "Buy", "Sell"]) {
        const th = el("th", label);
        th.scope = "col";
        headings.append(th);
      }
      head.append(headings);
      const body = el("tbody");
      for (const row of rows) {
        const tr = el("tr");
        for (const value of [
          row.asset,
          categoryLabel(row.kind),
          row.posts,
          row.buys,
          row.sells,
        ])
          tr.append(el("td", String(value)));
        body.append(tr);
      }
      table.append(head, body);
      recommendedAssets.append(table);
    }
  }
  visibleCount.textContent = `${items.length} of ${posts.length} posts${activeTheme ? ` · ${activeTheme.label}` : ""} · ${whenSelect.options[whenSelect.selectedIndex].text.toLowerCase().replace("…", "")}${selectedAuthor ? ` · @${authors.get(selectedAuthor)!.handle}` : ""}`;
  if (!items.length) {
    // A scan that ends at once closes its X tab and lands here; say why
    // rather than showing an empty page with the reason in a tooltip. That
    // includes a scan that finished cleanly but kept nothing.
    const scanFailed =
      !!run &&
      !active(run) &&
      !run.analysisOnly &&
      run.state !== "cancelled" &&
      run.postIds.length === 0;
    const empty = el("div", undefined, "empty");
    empty.append(
      el("p", "◒", "stat"),
      el(
        "h2",
        active(run)
          ? "Gathering the good stuff."
          : scanFailed
            ? "The last scan collected no posts."
            : digest?.items.length
              ? "No posts match these filters."
              : "Make room for a better read.",
      ),
      el(
        "p",
        active(run)
          ? "Keep the scan tab open. Saved posts will appear here when collection finishes."
          : scanFailed
            ? `${runSummary(run)} Check that you are signed in to X in this browser, then scan again.`
            : digest?.items.length
              ? "Try All dates, or change an author, category or display filter."
              : "Start a scan to create your first digest, or choose another feed filter.",
        "muted",
      ),
    );
    // The empty latest scan hides older saved posts; offer the way back.
    if (scanFailed && scope === "latest" && savedCount)
      empty.append(
        button(`Show all saved posts (${savedCount})`, async () => {
          scope = "all";
          await chrome.storage.local.set({ digestScope: scope });
          await refresh(true);
        }),
      );
    cards.append(empty);
  }
  // Rank numbers only mean something when ordered by AI insight.
  const ranked = sort === "insight";
  cards.classList.toggle("unranked", !ranked);
  for (const [pageIndex, item] of pageItems.entries()) {
    const index = pageStart + pageIndex;
    const p = postById.get(item.id)!;
    const card = el("article", undefined, "card");
    card.dataset.postId = p.id;
    const content = el("div");
    if (ranked && item.mode === "ai")
      card.append(el("div", String(index + 1).padStart(2, "0"), "rank"));
    else card.append(el("div", undefined, "rank"));
    card.append(content);
    const byline = el("div", undefined, "byline");
    byline.append(
      el("span", p.author.slice(0, 2).toUpperCase(), "avatar"),
      el("strong", p.author),
      el("span", "@" + p.handle, "muted"),
    );
    const time = el(
      "time",
      p.publishedAt == null ? "Undated" : postTime(p.publishedAt, now),
    );
    if (p.publishedAt != null) {
      time.dateTime = new Date(p.publishedAt).toISOString();
      time.title = new Date(p.publishedAt).toLocaleString();
    }
    byline.append(el("span", "·", "meta-separator"), time);
    const sources = new Set(
      p.observations
        .filter(
          (o) =>
            scope === "all" ||
            o.runId === (scope === "latest" ? latestScanId : scope),
        )
        .map((o) => o.feed),
    );
    const sourcePills = el("span", undefined, "source-pills");
    for (const source of sources)
      sourcePills.append(
        el(
          "span",
          source === "following" ? "Following" : "For You",
          "source-pill",
        ),
      );
    byline.append(sourcePills);
    content.append(byline);
    content.append(el("p", p.text || "No text collected", "excerpt"));
    if (validPostLinks(p.links) && p.links.length) {
      const links = el("ul", undefined, "post-links");
      content.append(el("h3", "Links in this post"));
      for (const found of p.links) {
        const row = el("li");
        const url = new URL(found.url);
        row.append(
          link(
            url.hostname +
              (url.pathname === "/" ? "" : url.pathname.slice(0, 100)),
            found.url,
          ),
          el(
            "small",
            found.source === "quote"
              ? " · Quoted post"
              : p.reply
                ? " · Collected reply"
                : " · Post",
          ),
        );
        links.append(row);
      }
      content.append(links);
    }
    if (p.quotedText)
      content.append(el("blockquote", "Quoted content: " + p.quotedText));
    const foot = el("footer");
    const tags = el("div", undefined, "post-tags");
    if (item.mode === "ai") {
      for (const sector of item.sectors ?? [])
        tags.append(el("span", categoryLabel(sector), "sector-tag"));
      for (const tone of item.tones ?? [])
        tags.append(el("span", categoryLabel(tone), "tone-tag"));
    } else {
      const pending = el("span", "Not analysed", "pending-tag");
      pending.title = "No AI labels yet. Use Analyse with AI to add them.";
      tags.append(pending);
    }
    const compact = (n: number | null | undefined) =>
      n == null ? "—" : compactNumber.format(n).toLowerCase();
    foot.append(
      tags,
      el(
        "span",
        `${compact(p.comments)} replies · ${compact(p.likes)} likes · ${compact(p.views)} views · ${compact(p.followers)} followers${viewFollowerRatio(p) !== null ? ` · ${viewFollowerRatio(p)!.toFixed(1)}× views/followers` : ""}`,
        "engagement",
      ),
    );
    const postActions = el("div", undefined, "post-actions");
    const feedbackValue = feedbackById.get(p.id);
    // Useful and Not useful are toggles: pressing the active one clears it.
    const clearFeedback = () =>
      transaction(["feedback"], async (tx) => {
        tx.objectStore("feedback").delete(p.id);
      });
    postActions.append(
      button("Useful", async () => {
        if (feedbackValue === "useful") {
          await clearFeedback();
          await refresh(true);
          notice("Feedback removed.");
          return;
        }
        await feedback(p.id, "useful");
        await refresh(true);
        notice(
          "Saved as useful. Unanalysed posts from this author now rank slightly higher. Press again to undo.",
        );
      }),
      button("Not useful", async () => {
        if (feedbackValue === "not-useful") {
          await clearFeedback();
          await refresh(true);
          notice("Feedback removed.");
          return;
        }
        await feedback(p.id, "not-useful");
        await refresh(true);
        notice(
          visibility.notUseful
            ? "Feedback saved. Hidden by your Not useful filter."
            : "Feedback saved. Press again to undo.",
        );
      }),
      button(p.pinned ? "Unpin" : "Pin", async () => {
        p.pinned = !p.pinned;
        await setPinned(p.id, p.pinned);
        render();
      }),
    );
    const controls = postActions.querySelectorAll("button");
    controls[0].setAttribute(
      "aria-pressed",
      String(feedbackValue === "useful"),
    );
    controls[1].setAttribute(
      "aria-pressed",
      String(feedbackValue === "not-useful"),
    );
    controls[2].setAttribute("aria-pressed", String(p.pinned));
    postActions.append(link("Open on X ↗", p.url));
    foot.append(postActions);
    content.append(foot);
    cards.append(card);
  }
  if (items.length > PAGE_SIZE) {
    const pagination = el("nav", undefined, "actions");
    pagination.setAttribute("aria-label", "Post pages");
    const changePage = (offset: number) => {
      cardPage += offset;
      render();
      cards.scrollIntoView({ block: "start" });
      cards
        .querySelector<HTMLButtonElement>(
          '[aria-label="Post pages"] button:not(:disabled)',
        )
        ?.focus({ preventScroll: true });
    };
    const previous = button("Previous page", () => changePage(-1));
    previous.disabled = cardPage === 0;
    const next = button("Next page", () => changePage(1));
    next.disabled = pageStart + PAGE_SIZE >= items.length;
    pagination.append(
      previous,
      el(
        "span",
        `${pageStart + 1}–${Math.min(pageStart + PAGE_SIZE, items.length)} of ${items.length} posts`,
      ),
      next,
    );
    cards.append(pagination);
  }
  if (focusedCard?.id) {
    const card = [...cards.querySelectorAll<HTMLElement>("article")].find(
      (node) => node.dataset.postId === focusedCard.id,
    );
    const controls = [
      ...(card?.querySelectorAll<HTMLElement>("button, a") ?? []),
    ];
    (
      controls.find((node) => node.textContent === focusedCard.label) ??
      controls[0]
    )?.focus({ preventScroll: true });
  }
  authorList.scrollTop = authorScrollTop;
  aside.scrollTop = railScrollTop;
  if (focusedAuthor !== undefined)
    [...authorList.querySelectorAll("button")]
      .find((control) => control.dataset.author === focusedAuthor)
      ?.focus({ preventScroll: true });
}
// Polling reads only the active run and latest scan. The full archive is
// reloaded when either changes, on explicit actions, or every 30 seconds.
let loadedSignature = "";
let loadedAt = 0;
let refreshing: Promise<void> | undefined;
let refreshAgain = false;
function refresh(force = false): Promise<void> {
  if (refreshing) {
    refreshAgain ||= force;
    return refreshing;
  }
  refreshing = (async () => {
    try {
      await refreshNow(force);
      while (refreshAgain) {
        refreshAgain = false;
        await refreshNow(true);
      }
    } finally {
      refreshing = undefined;
    }
  })();
  return refreshing;
}
async function refreshNow(force: boolean) {
  const [next, latest] = await Promise.all([current(), lastScan()]);
  if (latestScanId && latest && latest.id !== latestScanId) {
    scope = "all";
    await chrome.storage.local.set({ digestScope: scope });
  }
  if (abort && (!next || next.id !== rankingId || next.state !== "ranking"))
    abort.abort();
  run = next;
  const signature = JSON.stringify([
    next?.id,
    next?.state,
    next?.updatedAt,
    next?.postIds,
    next?.aiAudit?.updatedAt,
    latest?.id,
    latest?.state,
    latest?.updatedAt,
    latest?.postIds,
    scope,
  ]);
  const stale = Date.now() - loadedAt > 30000;
  if (force || stale || signature !== loadedSignature) {
    loadedSignature = signature;
    loadedAt = Date.now();
    await load();
    render();
  } else if (rollingDates && dateMinute !== Math.floor(Date.now() / 60000))
    render();
  if (
    run?.state === "ranking" &&
    rankingId !== run.id &&
    (await chrome.tabs.getCurrent())?.id === run.monitorTabId
  ) {
    rankingId = run.id;
    abort = new AbortController();
    void rankRun(run.id, abort.signal)
      .then(() => refresh(true))
      .catch((e) => notice(e.message));
  }
}
async function load() {
  await updateJevSetup();
  const archive = await savedArchive();
  const history = archive.runs
    .filter((r) => !r.analysisOnly)
    .sort((a, b) => b.startedAt - a.startedAt);
  const latestScan = latestScanOf(archive.runs);
  savedCount = archive.posts.length;
  latestScanId = latestScan?.id ?? "";
  if (
    scope !== "all" &&
    scope !== "latest" &&
    !history.some((r) => r.id === scope)
  )
    scope = "all";
  const options = [
    ["all", `All saved posts (${archive.posts.length})`],
    ["latest", "Latest scan"],
    ...history.map((r) => [
      r.id,
      `${new Date(r.startedAt).toLocaleString()} · ${r.postIds.length} posts`,
    ]),
  ];
  const optionKey = JSON.stringify(options);
  if (scopeOptions !== optionKey) {
    scopeOptions = optionKey;
    collectionSelect.replaceChildren(
      ...options.map(([value, label]) => {
        const option = el("option", label);
        option.value = value;
        return option;
      }),
    );
  }
  collectionSelect.value = scope;
  const selectedRun =
    scope === "all"
      ? run
      : scope === "latest"
        ? latestScan
        : history.find((r) => r.id === scope);
  const selectedIds = new Set(selectedRun?.postIds ?? []);
  posts =
    scope === "all"
      ? archive.posts
      : archive.posts.filter((p) => selectedIds.has(p.id));
  postById = new Map(posts.map((p) => [p.id, p]));
  const themeRecords = await cachedThemes(posts);
  semanticThemes = new Map(
    [...themeRecords].map(([id, cached]) => [
      id,
      matchedThemes(cached.probabilities),
    ]),
  );
  allPendingPosts = [];
  digest = archive.digests.find((d) => d.id === selectedRun?.id);
  if (run || posts.length) {
    const annotations = archive.digests
      .sort((a, b) => a.createdAt - b.createdAt)
      .flatMap((d) => d.items.filter((item) => item.mode === "ai"));
    for (const r of [...archive.runs].sort((a, b) => a.startedAt - b.startedAt))
      annotations.push(
        ...(r.aiAudit?.posts.flatMap((p) => (p.result ? [p.result] : [])) ??
          []),
      );
    const pendingIds = new Set(
      pendingAnalysisPosts(archive.posts, annotations).map((post) => post.id),
    );
    allPendingPosts = archive.posts.filter((post) => pendingIds.has(post.id));
    digest = {
      ...(digest ?? {
        id: run?.id ?? "saved",
        createdAt: run?.startedAt ?? 0,
        mode: "Saved posts",
        model: "",
        notices: [],
        candidates: posts.length,
        tokens: 0,
      }),
      items: allPostItems(
        posts,
        run?.settings ?? defaults,
        annotations,
        archive.feedback,
      ),
    };
    digest.notices = digest.notices.filter(
      (n) => !/Fewer than 10|Selected posts|AI shortlist:/.test(n),
    );
  }
  postFeedback = await all<Feedback>("feedback");
}
chrome.storage.onChanged.addListener((changes) => {
  if (changes["key:jev"]) void updateJevSetup().then(() => render());
  if (themeAbort && changes["key:jev"]) {
    void key("jev").then((token) => {
      if (!token) themeAbort?.abort();
    });
  }
});
window.addEventListener("pagehide", () => {
  abort?.abort();
  themeAbort?.abort();
});
void command("recover")
  .then(() => refresh(true))
  .catch((e) => notice(e.message));
setInterval(() => void refresh().catch((error) => notice(error.message)), 1200);

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id === chrome.runtime.id &&
    message?.op === "runStopped" &&
    message.runId === rankingId
  ) {
    abort?.abort();
    respond({ ok: true });
  }
});
