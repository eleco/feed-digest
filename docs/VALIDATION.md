# Validation record — 27 September 2026

## Environment

- macOS 26.2, Apple Silicon; Node 24.6.0, npm 11.5.1.
- Playwright's Chrome for Testing 153.0.8010.12 (Chromium revision 1243), headless extension-enabled persistent context, disposable profile.
- No personal browser profile, signed-in X session or live provider credential used.

## Commands and results

| Command                                                                          | Result                                                                                |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `npm ci --cache /private/tmp/x-feed-digest-npm-cache --ignore-scripts --offline` | Clean lockfile install succeeded; 135 packages; audit reported 0 vulnerabilities      |
| `npm run typecheck`                                                              | Passed                                                                                |
| `npm test`                                                                       | 45 tests passed across 3 files                                                        |
| `npm run build`                                                                  | Installable MV3 build created in `dist/`                                              |
| `npm run build:site`                                                             | Static Vercel output created in `site-dist/`                                          |
| `npm run test:browser`                                                           | 19 browser cases passed across full/targeted runs; see Claude update                  |
| `npm run release`                                                                | ZIP created; 34 entries, 345,020 bytes                                                 |
| Release archive SHA-256                                                | `580ffb5a0f5fbee6ef1e2f9e0cf65e569298ec14f723a350a7015d8bfc701c32` |

The local sandbox blocks Chromium process startup and listening on localhost; browser fixture commands ran with approved process/network access. All application HTTPS requests in these tests were intercepted with synthetic responses or aborted. Dependency installation used network access; generation tests spent no credits. CI is prepared but has not run remotely.

## Coverage

Unit tests cover outer-vs-quoted post identity, missing data, malformed URLs/cards, markers, stale feed transitions, unsupported labels, challenges, provenance merging, deterministic Basic ranking, feedback/exclusions, author/source diversity, hostile model JSON, free-price validation, Markdown escaping, local alarm calculation, atomic quotas/spend reservations, retention/references, deletion, missing session keys, 429/changed-price fallback, partial valid AI batches, late-response deletion guards, cache reuse and Basic network isolation.

Browser fixtures cover settings/popup/digest loading, two-feed collection and deduplication, outgoing-card rejection, feedback/data deletion, cancellation and double starts, unrelated-tab preservation, session-only keys/removal, clearing legacy schedules when saving preferences, HTML rendered as text, partial feeds, expired leases/late messages, content-script key isolation, account-change blocking, direct mocked provider calls, worker restart, scroll caps, browser-session ownership and responsive website filtering/layout. The full scan fixture records 2 Following observations, 2 For You observations and 3 distinct posts. These are synthetic counts, not live X counts.

The mocked provider browser test copies the built extension into its temporary directory and pregrants the single mocked OpenRouter origin in that test copy. Native permission dialogs cannot be confirmed headlessly here; the production `dist/manifest.json` retains optional provider permissions. This test proves extension-page orchestration with a mocked provider, not real-provider or native-consent compatibility.

Desktop/mobile website and extension-digest screenshots were inspected visually. All displayed posts/authors are synthetic.

## Unverified / remaining release issues

- **Authenticated live X smoke test: blocked** because no authorized test session was supplied. Selectors, real virtualisation transitions, account markers and both-feed counts must be checked manually. No current live-X compatibility claim.
- **Real OpenRouter and OpenAI generation:** not performed. Native optional host-permission grant flow, actual extension-origin compatibility, model/account availability, billing, provider privacy behavior and outages need user-key smoke tests.
- **Scheduling:** fixture alarm behavior verified; actual browser sleep/wake, DST/timezone transitions, restart availability and unattended visible scans remain unverified. No inactive scanning is offered.
- **Platforms:** Chrome 120 minimum, Windows and Linux not run locally. CI targets Linux but is not a substitute for an authenticated/manual platform smoke test.
- **Ranking:** no independent truth verification, image/video/article/full-thread understanding or prior-digest novelty assessment. Near-duplicate detection is lexical. Results sample the loaded feed only.
- **Public release:** X automation rules expressly prohibit scripting the website and warn of account suspension. Resolve this platform-policy conflict before release. Replace the MIT owner placeholder and designate a private security contact.
- No repository created/published, release uploaded or Vercel deployment performed. Vercel configuration and local build are ready for a separate deployment action.

Use `docs/MANUAL_QA.md` to record live testing separately from these fixture results.

## Optional image hiding update

Added a default-off checkbox under Settings → Scan settings. The option uses tab-scoped CSS to hide post photos, image previews and avatars while preserving inline emoji and text, and is removed on stop/navigation away. No permissions were added and image requests are not blocked. Live performance improvement is unmeasured.

Typecheck, 30 unit tests and the rebuilt extension/release passed. The added browser fixtures check both toggle states, persistence, newly rendered cards, unchanged text/provenance, normal reading-tab isolation and restoration after same-document navigation. The final full suite passed 13 checks and encountered unusually long timeouts in the image-enabled and unchanged website checks (reported durations 16.8 and 20.2 minutes). Both affected checks passed on a targeted rerun in 9.6 seconds. All 15 browser cases therefore have passing results for this update; this is not a claim that the last full run passed without retries. An existing session-recovery fixture was also made deterministic by seeding an old run directly instead of racing a live collector.

## Scan settings copy update

Renamed the section to Scan settings, added accessible explanations for each per-feed limit, and removed scheduling controls. Saving preferences resets legacy scheduling to disabled and clears the daily alarm. Typecheck, extension build/release and the targeted settings browser test passed. Other browser results above refer to the preceding update.

## Higher configurable scan limits

Raised maximum posts per feed to 1,000 and scroll steps to 100, retaining defaults of 100 posts / 30 steps and the 90-second cap. Feed-result validation now checks the saved run’s scroll limit. Typecheck, all 30 unit tests (including updated limit boundaries), extension release and site build passed. Browser tests were not rerun for this change.

## Automatic preference saving

Removed the Save preferences button. Text and numeric edits save on input; toggles and selects save on change. Writes are serialized and invalid edits preserve the last persisted value while other valid fields can still save. API keys retain their explicit Save key action. Typecheck, 30 unit tests, extension build/release and all 16 browser tests passed (47.7 seconds). Browser coverage includes rapid edits, rejected out-of-range values, independent field persistence and settings reloads.

## Per-post and DOM caching

Typecheck, 39 unit tests, extension build/release and all 16 browser tests passed (48.2 seconds). New unit coverage verifies unchanged DOM card reuse, text/identity invalidation and new feed/run provenance, per-post AI reuse when batch membership changes, content/quote/excerpt/preference invalidation, corrupt-entry recovery and cache expiry. Existing tests verify cancellation/deletion cannot repopulate cached data and cache hits make no generation requests. Browser fixtures retain both-feed collection, account isolation, image hiding and mocked AI coverage. No live speed benchmark was performed; X loading and settled-scroll delays are unchanged.

## Feed stopping checkpoints

Typecheck, 39 unit tests, extension build/release and all 17 browser tests passed (59.8 seconds). The checkpoint fixture performs three scans to verify per-feed account-bound persistence, inclusion of newly prepended posts, stopping at the saved post before later cards, preservation when a shorter scan cannot reach the anchor, and explicit reset. Existing account-change, cancellation, partial-feed and deletion tests also pass. Live X feed reordering can prevent reaching an anchor; normal limits remain the fallback.

## Digest sorting and reply counts

Typecheck, 41 unit tests, extension build/release and all 18 browser tests passed (59.9 seconds). Unit coverage verifies all sort orders, missing values after known zeroes, stable ties, non-mutating sorting, abbreviated outer reply counts and quote exclusion. Browser coverage verifies date/comment/like/pinned ordering, feed-filter composition, legacy missing counts and sort persistence across reload. Live X selectors and localized/rounded engagement displays remain unverified.

## Claude, taxonomy and surfaced links

Typecheck, 46 unit tests, extension build/release and site build passed. The browser suite passed 18 existing cases; the new Claude case failed because its synthetic feeds supplied different text for the same post ID, causing the later observation to replace the financial text. The fixture now uses consistent shared content, and the targeted Claude rerun passed in 5.6 seconds. All 19 cases have passing results across these runs; the final full suite was not rerun.

Tests cover Anthropic Messages headers/body, Models connection checks without generation, paid budget reservations and accounting, cached category reuse, schema-enumerated labels, safe rendered links with quote provenance, category filters and links-only view. Browser Anthropic permission is pregranted only in a disposable fixture copy. No real Claude credentials, generation spending, native consent interaction or authenticated X session was used. Live Claude access/CORS, live extraction and classification quality remain to be manually verified.

## Randomized scroll timing

Each scroll now waits a fresh random 1.5–3 seconds, shortened to the remaining per-feed/overall collection time. Typecheck, all 46 unit tests, extension release, and the existing browser scroll-cap/cancellation checks passed (2 cases, 10.3 seconds). The full browser suite was not rerun for this timing-only change.

## Connection feedback fix

Typecheck, all 46 unit tests and extension build/release passed. Both targeted Claude browser cases passed in 22.8 seconds: the existing analysis/filter flow and the added inline connection feedback case. The new case verifies missing model/key feedback, immediate spinner/disabled state, HTTP 401 guidance, network failure, a real 15-second timeout and successful retry. The full browser suite was not rerun. No real API key or live provider call was used.

## Online-analysis enablement feedback

Typecheck, 46 unit tests and extension release passed. Five targeted browser tests passed (29.1 seconds): autosave, OpenRouter analysis, Claude analysis, connection feedback, and the new enablement case. The latter verifies visible missing prerequisites, rejected-enable feedback, successful setup, checked state after reload, and safe persistence/disabling when pricing confirmation or a required budget is removed. The full browser suite was not rerun.

## Combined provider connection

Typecheck, 46 unit tests and extension release passed. All five targeted provider browser checks passed (28.7 seconds), including OpenRouter model loading through Check connection and a simulated permission denial that verifies the request occurs in a user gesture, names only the selected origin, restores the button and makes no provider request. Native browser consent dialogs were not exercised; successful requests used pregranted disposable fixture manifests. The full browser suite was not rerun.

## Remove reading interests

Removed the interests field, Basic scoring boost, prompt input and cache-key component. Settings reads strip legacy interests; prompt version 4 invalidates older analyses. Typecheck, all 45 remaining unit tests (the removed interests-cache case no longer applies), extension/site builds and the two targeted settings/site browser cases passed (3.5 seconds). The full browser suite was not rerun.

## Simplified paid-provider setup

Removed manual prices, daily spend ceiling, pricing confirmation, their settings validation and generation gates, and dollar estimates. Legacy settings are ignored on read. Request/token limits and atomic request quotas remain. Typecheck, all 45 unit tests, extension release and all six targeted settings/provider browser tests passed (29.9 seconds), including Claude generation without price/budget setup and enablement persistence. Replaced obsolete spend-ceiling unit checks with daily request-limit checks. The full browser suite was not rerun.

## Automatic request and token limits

Removed the four generation-request/token-limit fields. Settings reads now apply the existing automatic defaults, overriding legacy custom values for new scans. Typecheck, 45 unit tests, extension release and the two targeted settings/Claude-enablement browser cases passed (3.6 seconds). The full browser suite was not rerun.

## Loaded-manifest permission diagnosis

An isolated fresh Chrome profile using the unmodified production manifest returned all three optional provider origins and reached the native permission wait without the reported manifest error; approval was not automated. This does not identify the user’s loaded-copy cause. Added a loaded-manifest preflight, actionable error mapping, extension-manager button and key-free permission details. Typecheck, 45 unit tests, extension release and three targeted browser cases passed (7.2 seconds): normal Claude flow, a fixture manifest missing Anthropic, and the exact Chrome rejection with a declared host. The full browser suite was not rerun.

## Entered API key connection regression

Check connection now prioritizes the entered key over a stored key, trims surrounding whitespace, saves it only after successful authentication, and preserves the stored key on rejection. Editing the key or storage choice cancels an active check. Authentication errors identify the selected provider host. Typecheck, 45 unit tests, release build and four targeted browser checks passed (24.8 seconds). Mocked tests cover stale-key replacement, failed replacement preserving the old key, successful replacement persistence, reuse with an empty field, loading/error/timeout feedback, enablement and OpenRouter analysis. No live credentials or provider requests were used; the reported account-specific rejection has not been independently reproduced.

## Post filters removal

Removed the section, exclusions and preferred-author settings and ranking effects. Legacy saved values are ignored. AI payloads no longer include exclusions; prompt version 5 invalidates older assessments. Typecheck, 44 unit tests, extension release, site build and the targeted settings autosave browser test passed (2.5 seconds).

## Configurable scan boundary

Added saved-checkpoint (default) and last-24-hours stopping modes. The date cutoff is fixed from run.startedAt for both feeds, excludes the boundary post, ignores saved checkpoints, and preserves existing checkpoint records. Undated parsed posts do not trigger the cutoff; normal scan limits still apply. Typecheck, 44 unit tests and release build passed. Targeted browser tests passed for autosave, existing checkpoint behavior and date cutoff persistence/collection. The date test initially used a fixture missing the timestamp element required to identify a post; after retaining that element without a datetime, the targeted rerun passed (8.2 seconds). No live X requests were used.

## AI activity and usage audit

Added a live extension page, navigation/popup links and per-run audit snapshots. Records every shortlisted post with bounded text/quote, classifications, score/reason/takeaway, local-cache status and inclusion at digest completion. Request attempts record timing, status/errors, available input/output usage and automatically estimated or reported USD costs. Missing usage stays unknown; failed output validation retains reported tokens. Retries and interrupted attempts remain distinct, including when ranking resumes after a reload. No raw provider response or API key is persisted in the audit. Existing run pruning and Delete all data cover logs.

Typecheck, 51 unit tests, release build and all 27 browser tests passed (1.7 minutes). Unit checks include usage/cost calculation, provider cache reads, unknown usage, failed validation, retries, resumed request history, cache reuse and deletion races. The browser test exercises live pending/success transitions, cost display, an analysed post omitted from the digest, inert hostile takeaway text, search/filtering, JSON export without the synthetic API key, second-scan local-cache reuse and reload persistence. Visually inspected the desktop activity screenshot. All provider traffic was mocked; no real account credentials, API charges or authenticated X requests were used.

Standard rates were verified against official Claude Haiku 4.5 pricing and OpenAI GPT-4.1 mini/nano model pages linked in README and the activity page. Costs remain estimates unless reported by the provider; bundled rates are dated 27 September 2026. Unknown charges are not represented as zero. Detailed logs only apply to new AI scans.

## All collected posts in the digest

Removed the ten-post selection, score floor, author caps, text-similarity filtering and negative-feedback hiding. Every collected ID gets a digest entry, including low-score, short, repeated-text and unanalysed posts. Existing digests hydrate missing entries from still-stored posts and audit classifications on display/export. Optional user-controlled display filters remain. AI considers all collected posts within existing request/token/time limits and falls back to source excerpts without hiding posts. Prompt version 6 requests a classification for every supplied item.

Typecheck, 51 unit tests, extension release and site build passed. Five targeted browser tests passed (25.3 seconds): scan/feedback/deletion, sorting, Claude classifications, live AI activity/cache reuse, and a new 15-post test with identical text and a short post. The latter confirms all 15 remain after negative feedback, reload of an older ten-item digest, and JSON export. No live account or provider traffic was used.

## Optional digest visibility filters

Added independent default-off switches for low AI scores (below 30), repeated normalised text, a two-post author limit and Not useful feedback. Filters apply to the current sorted/feed/category view and never alter stored digest items or exports. Preferences autosave; reset clears the four switches. A live count reports visible versus collected posts, and feedback changes refresh the view.

Typecheck, 54 unit tests, release build and three targeted browser tests passed (12.5 seconds). Unit coverage verifies independent/combined filters, invalid saved values, ordering, empty-text posts and Basic posts without AI scores. Browser coverage verifies each switch, author-filter persistence on reload, reset, immediate feedback hiding, full export while filtered, existing sorting and data deletion.

## AI insight sorting

Added Most insightful (AI) to the saved digest sort menu. AI scores sort descending, including zero; Basic posts follow without being hidden. Scores appear on AI post cards and in activity. Prompt version 7 clarifies useful detail, evidence described, explanations and actionable understanding as insight criteria, separate from popularity or dramatic tone. Typecheck, 55 unit tests, extension release and the targeted sorting browser test passed (4.0 seconds). Coverage includes mixed AI/Basic order, score display, sorting persistence and all posts remaining visible. No live API requests were made.

## Zero AI analysis diagnostics and batch splitting

Oversized batches now shrink to fit the existing conservative input bound rather than skipping all their posts. Only individually oversized posts fall back without a request. Digest AI counts include live audit results, with adjacent collection/running/off/failure status and an activity link. Audit classifications take precedence over Basic digest fallback annotations. Typecheck, 56 unit tests, release build and two targeted browser tests passed (16.4 seconds). A unit regression verifies ten long posts are split across bounded requests and all receive classifications. Browser checks verify progress and completion status beside the counter, Basic scans, activity and cache reuse. The user-specific zero count remains undiagnosed pending their activity message; all provider tests were mocked.

## AI toggle beside Scan

Removed the Settings outbound payload preview and billing paragraph. Added a shared, autosaved Enable online analysis toggle beside Scan in the digest and popup. Successful connection checks enable AI; missing setup keeps the toggle unavailable with guidance. Cross-page storage updates synchronise it, and scan actions await pending toggle writes. The toggle controls the next scan, not the current run snapshot. Existing connections can be checked once to activate the new default. Updated setup, activity and privacy documentation.

Typecheck, 56 unit tests, extension release and static site build passed. The full 28-test browser run passed 27 tests and exposed a legacy fixture with no saved run settings; added a defensive check in digest AI status. The failed legacy-rendering test and the new connection/toggle test then both passed on the final build (4.9 seconds). Toggle coverage includes automatic enablement, location beside Scan, disabled missing setup, cross-page synchronisation, reload persistence, manual override and immediate-scan settings capture. Visually inspected the digest screenshot. All provider requests were mocked.

## Separate Analyse with AI action — 28 September 2026

Replaced the Enable online analysis checkbox with Analyse with AI beside Scan in the digest and popup. Scanning only collects posts, including with a legacy enabled preference. Manual analysis processes every stored post from the current collection, regardless of display filters, using the current provider configuration. It creates a separate history entry, reuses cached classifications, and does not reopen or rescan X. Manual analysis is not limited by the former scan/day request caps; requests remain bounded, timed out and cancellable.

Typecheck, 57 unit tests, extension release and static site build passed. All 28 browser tests passed in a single run (1.9 minutes). Coverage includes no generation during scanning or connection checks, analysis of posts hidden by display filters, popup/digest controls, live activity and usage, repeat-analysis cache reuse, and processing 61 posts despite the old request ceilings. All provider and X traffic was synthetic; no live API credentials or paid requests were used.

## Model JSON recovery — 28 September 2026

Accept a complete Markdown JSON fence before strict JSON/schema validation. Detect Anthropic max_tokens and chat-completion length stops after recording reported usage. Set output allowance to at least 512 + 600 tokens per batch post. Malformed/truncated batches halve progressively; a single-post failure stops the run, preserving prior results and every attempt’s usage. Raw responses remain unrecorded. The supplied user log alone cannot establish whether their response was fenced, truncated or otherwise malformed. Anthropic stop semantics were checked against https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons.

Typecheck, 61 unit tests and extension release passed. Three targeted browser tests passed (19.8 seconds): manual Claude analysis with fenced JSON, activity/usage/cache reuse, and the existing alternate-provider flow. New unit regressions cover recovery of all ten posts from malformed and truncated batches, output sizing, cost preservation including failed attempts, and bounded persistent-malformation handling without invalid cache writes. All API requests were mocked. Full browser suite was not repeated for this update.

## Stop AI on first error — 28 September 2026

Removed both server-error retries and malformed/truncated-output batch retries at the user's request. Any thrown generation or validation error ends the batch loop immediately, records the error, marks remaining posts skipped, and retains completed results and available usage. Fenced valid JSON support and batch-sized output allowances remain.

Typecheck, all 61 unit tests and extension release passed. Regressions verify exactly one call on server error, malformed JSON and truncation, and no later batches after a failure with 21 collected posts. Existing tests cover preserving earlier successful classifications and failed-response usage. Browser tests were not repeated for this engine-only change.

## Live digest AI progress and cost — 28 September 2026

Added a labelled native progress bar showing successful classifications against all posts considered, including cached results. Current-run cost uses the existing audit totals, marks estimated prices and known subtotals, and distinguishes pending from unavailable usage. Counts/cost refresh with existing digest polling and remain visible after completion or interruption. No additional provider requests.

Typecheck and extension release passed. The targeted mocked Claude browser test passed (10.3 seconds), verifying 0/3 with pending usage, 3/3 with $0.001500 estimated cost, and repeat analysis at 3/3 cached with $0.000000 new cost. Unit and full browser suites were not repeated for this UI-only update.

## Collapsed visibility controls — 28 September 2026

Hide posts from this view now uses a native details/summary disclosure, collapsed on each page load and toggled by its heading. Typecheck, extension release and the existing digest filter browser test passed (5.9 seconds).

## Original posts and compact AI metadata — 28 September 2026

Digest cards and Markdown exports now show the original collected text, quotes and links, without AI prose, insight scores, sector/tone badges or generated flags. Scores and labels remain stored for sorting/filtering and audit inspection. Prompt version 8 requests only id, score, sectors and tones. Validators accept compact results and legacy cached prose; version 7 cache keys remain compatible to avoid re-analysis charges. Empty legacy prose fields maintain storage compatibility. Actual token savings depend on the provider's response; no live cost benchmark was run.

Typecheck, extension release and 63 unit tests passed. Five targeted browser tests passed (23.9 seconds): hostile source text/Markdown escaping, insight sorting without displayed scores, compact Claude classifications with category filters and links, live activity/cache reuse, and full-post display/visibility filters. New unit coverage verifies metadata-only output and version 7 cache reuse without generation. All provider traffic was mocked.

## Author browsing — 28 September 2026

Added an alphabetically sorted author sidebar for all posts in the current collection, grouped by case-insensitive handle with per-author counts. Selecting an author composes with existing filters and sorting; All authors clears the selection. Typecheck, extension release and the sorting/author browser fixture passed (3.9 seconds), including active selection and restoring the full sorted collection.

## Buy/sell recommendation filters — 28 September 2026

Added buy/sell/either and asset-type controls, composing with existing filters. Prompt version 9 extracts compact action/asset/kind metadata for explicit recommendations, excluding historical trades, predictions, negation and unendorsed quotes. Validation bounds results, restricts action/kind and requires asset text to appear in supplied content. Undefined metadata remains distinct from an empty checked result. Old caches are refreshed only when the user requests analysis. Original card text remains unchanged.

Typecheck, release and 64 unit tests passed. Three targeted browser tests passed (17.0 seconds): buy/sell and same-recommendation asset matching, original content/links, existing author sorting, and activity/cache reuse. Tests use synthetic provider output and do not establish real-model detection accuracy.

## Finance-only controls and persistent blacklist — 28 September 2026

Buy/sell and asset filters show only for Finance and reset on leaving that sector. The visibility disclosure includes a textarea of literal words/phrases, one per line, applied case-insensitively to post/quoted text before author and duplicate limits. Serialized local-storage autosaves persist across sessions. Reset clears the blacklist; exports still include hidden posts.

Typecheck, 65 unit tests and release passed. Two browser tests passed (10.9 seconds), covering Finance visibility/reset, buy/sell matching, blacklist filtering, saved local storage, reload persistence, clearing and existing visibility filters. No live provider requests.

## Saved collections and complete backup — 28 September 2026

The digest defaults to all saved posts, deduplicated by stored post ID, with latest-run and dated history views. Saved AI annotations remain available across later Basic collections. The digest analysis action uses the selected collection, including all archived posts when All saved posts is selected; popup analysis continues to use the latest run. Added a consistent IndexedDB snapshot export of posts/runs/digests/feedback plus allowed reading preferences as a readable JSON backup, excluding API-key storage. Existing 30-day/5,000-post retention remains. No backup import or automatic filesystem syncing was added.

Typecheck, 66 unit tests and extension release passed. The full 29-case browser run passed 28 cases and exposed a timing race in the existing expired-lease fixture. Replaced its live-start mutation with a seeded expired run and isolated its stale-message tab; the final targeted recovery test passed (1.7 seconds). The saved-history test was strengthened to use distinct posts in successive scans and passed on a targeted run (2.3 seconds), covering combined/latest/older views, retained AI metadata, reload and full backup contents. All 29 cases therefore have passing results across runs; the initial full run was not clean. No live X or provider requests.

## Publication-date filtering — 28 September 2026

Added local datetime From/To controls defaulting on page load to now minus 24 hours through now. Default bounds refresh on data changes and each minute. Custom input stops rolling; either bound can be cleared. Last 24 hours restores rolling bounds; All dates includes undated posts. Inverted ranges display an inline error and match no posts. Filters affect display only.

Typecheck, 68 unit tests and extension release passed. Five targeted browser tests passed (13.9 seconds), covering exact 24-hour defaults, a custom older range, reload defaults, shortcuts, unknown-date access and existing sorting/category/blacklist behavior. Standard browser fixtures now use recent timestamps; date-boundary fixtures retain explicit ages. No live provider requests.

## Digest layout 2a — 28 September 2026

Applied the supplied digest layout brief: sticky header, 280px filter rail, feed counts and pinned view, date presets/custom range, searchable author chips with expandable single-post authors, compact original-post cards with AI labels, and a mobile filter drawer. Existing scan history, feedback, blacklist, analysis progress/cost and cancellation remain available. Fonts and their OFL licenses are bundled locally. Author initials are used because stored posts do not contain avatar or media image URLs.

Typecheck, all 68 unit tests, extension release and the complete 29-test browser suite passed. Browser checks cover date presets, author selection/scroll preservation, pinned posts, category and finance filters, saved history, scanning and mocked AI analysis. Desktop and mobile screenshots were visually inspected and saved as digest-2a-desktop.png, digest-2a-mobile.png and digest-2a-mobile-filters.png in this directory. All X and provider traffic in browser validation was synthetic; no live API calls were made.

## Filtered author counts — 30 September 2026

Author chips and All authors totals now use the same filtered/sorted post set as the digest, before applying the author selection. This includes dates, feed/pinned scope, sector, tone, recommendations, links, blacklist and visibility controls. Selecting an author keeps other matching authors available; a selected author with no matches stays selected with a zero count. Author scroll/focus preservation remains.

Typecheck, release and four targeted browser regressions passed (16.2 seconds). Assertions cover changing author counts including zero matches, totals across date/category/finance/blacklist/visibility filters, saved scan scope and author scroll/focus preservation. All traffic was synthetic. Unit and full browser suites were not repeated for this UI-only correction.

## Buy/sell analysis completeness — 30 September 2026

The prompt example now includes recommendations, and new AI output must supply that field, with an empty array for checked posts without calls. Cache validation also requires the field, so incomplete version-9 entries are regenerated on user-requested analysis; complete caches remain reusable. Legacy stored classifications remain readable. Missing tags cause analysis to stop with an actionable error, preserving usage, and are not cached. Finance filtering includes posts with validated recommendation metadata even when the model assigned a different sector. The digest explicitly directs users to Analyse with AI for unchecked posts.

Typecheck, all 70 unit tests, release and five targeted browser tests passed (25.1 seconds). Unit coverage includes incomplete caches from versions 7 and 9, omitted-field failures, prompt schema, explicit empty results and usage preservation. Browser coverage verifies Finance buy/sell and same-call asset matching on a post labelled technology, analysis initiation, cache reuse/activity, authors and saved collections. All provider responses were synthetic; personal browser data and real-model extraction accuracy were not inspected.
