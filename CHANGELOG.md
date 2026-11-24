# Changelog

## Unreleased

- Read posts that X renders without test ids or <time> elements, as seen on live X: the permalink gives the ID and handle, the publish time is decoded from the post ID, text comes from [lang] blocks, exact reply, like and view counts from the action bar's aria-label, and reposts and quoted posts are detected structurally. Posts with test ids are read exactly as before.

- When a feed is not ready, report what X showed (tab state, post, article, text and cell counts, page visibility and width, and for a feed switch how many previous posts remain and how recently the page changed). Match post cards by their test id on any element.

- Find the signed-in account in more layouts: the side menu's Profile link or avatar, and the avatar beside the Home composer (never a post author's). A failure now reports which of these X showed.

- Size the scan window for X's zoom level once x.com loads, so X always gets at least 1,280 page pixels and its full layout. At 125% zoom a 1,080 px window was an 864 px page, which made X drop its feed column and double its tab labels.

- Recognise X's feed tabs when their labels render twice (for example "FollowingFollowing") and fall back to the main region when the feed column has no primaryColumn test id, as seen on live X in a zoomed window.

- Show the loaded version and build time (for example "v0.1.0 (2026-11-24 16:39)") beside the name on every extension page. The build stamps it into the manifest's version_name, which chrome://extensions also shows.

- Fix "Unsupported X home layout" scans: scan windows are now sized from the screen, not the window the scan was started from, and are never narrower than 1,024 pixels. The scan also waits for X's feed tabs to appear instead of continuing as soon as any tab-like element renders, and a layout failure reports the window size instead of suggesting you sign in.

- Watch results while scanning: the scan and a live digest now open as side-by-side windows, and the digest header shows which feed is being read and how many posts have been saved so far.

- Remove the scan time limits. Following now reads back to its boundary however long it takes, and post and scroll limits apply to For You only. The scan lease is renewed on every scroll instead of expiring after about four minutes.

- The Following checkpoint is now the newest original post (never a repost or ad) and is matched by date as well as ID. A repost of the checkpoint post no longer stops a scan early, and the checkpoint advances only after a scan reaches it, so gaps are filled by the next scan instead of lost. This replaces the earlier always-advance behaviour.

- 24-hour mode counts old posts only when they are consecutive in the feed, ignores reposts and ads, and stops after five instead of three. Previously, old posts spread across the visible page added up and ended the feed early, and recent reposts of older posts were dropped.

- New scans keep All saved posts selected so new posts appear alongside earlier scans; individual scan views remain available in Scan history.

- AI analysis retries rate limits, server errors, timeouts and network drops up to three times, honouring Retry-After. A batch that still fails or returns unusable output is skipped and later batches continue; three failed batches in a row, or a rejected key, model or price, stop the run.

- Always advance the Following checkpoint to the newest post of each completed scan, even when a limit stopped the scan before the old checkpoint, so one long gap no longer makes every later scan run to its limits. For You no longer uses a checkpoint.

- Fix digest rendering stopping at a post with an http link, make Useful feedback raise that author's unanalysed posts, remove TypeSafe access on Delete all data, and remove a developer path from the Jev help text.

- In 24-hour mode, skip old posts and stop only after three in a row, so old reposts and out-of-order For You posts no longer end a scan early.

- Drop invalid AI labels and unmatched buy/sell tags per post instead of failing the whole analysis. Posts missing the buy/sell check stay pending and are not cached.

- Keep Latest scan pointing at the last feed scan after AI analysis, hide analysis runs from scan history, and stop copying observations onto posts for each analysis.

- Run the recovery alarm only during active runs, prune only at install, startup and scan start, and write back only changed records. Remove leftover daily scheduling code.

- Digest: reload saved data only when the active run changes, look posts up by ID, and keep keyboard focus across updates.

- UI: fix the reach filter layout and provider-specific help showing for the wrong provider; show dates on older posts; one Analyse with AI name everywhere; compact analysis bar; rank numbers only for the insight sort; Not analysed tags; toggle feedback buttons; one brand and palette across pages; simpler popup and settings copy. Remove keys only stops a running AI analysis.

- Require buy/sell tags in new AI output and reject incomplete cache entries on analysis. Correct the prompt example and include detected investment calls in the Finance filter even when the model assigned another sector.

- Update author post counts and All authors totals with the active digest filters. Keep a selected author available with a zero count when no posts match.

- Apply layout 2a to the digest: sticky header, filter rail, pinned feed, date presets, author search/chips, compact original-post cards, feedback states and mobile drawer. Bundle local fonts and preserve saved history, AI progress/costs and existing controls.

- Add publication-date From/To filters, defaulting to the last 24 hours, with Last 24 hours and All dates shortcuts.

- Keep saved posts accessible across scans through a combined default view and dated history selector. Preserve AI annotations, analyse the selected collection.

- Restrict buy/sell and asset-type controls to Finance, clearing them when the sector changes. Add a persistent, autosaved word/phrase blacklist under digest visibility controls.

- Add buy/sell recommendation and asset-type filters, with compact AI metadata and explicit not-checked status for older posts. Prompt version 9 refreshes earlier assessments when analysis is requested.

- Display original collected posts and links instead of AI summaries, explanations, scores and category badges. Request only score/sector/tone metadata and preserve version 7 cache reuse.

- Show live analysed-post progress and current-run AI cost in the digest. Include cached progress, pending usage and incomplete-cost labels; retain the summary after analysis stops.

- Stop AI analysis on the first error without automatic retries or subsequent batches; preserve completed classifications and recorded usage.

- Accept JSON wrapped in Markdown fences, detect output truncation, size output allowances by batch and recover malformed/truncated batches by splitting them. Preserve usage and costs for every failed attempt.

- Replace the AI checkbox with Analyse with AI. Scanning only collects posts; manual analysis processes the full current collection without rescanning, preserves scan history, uses cached results and records a separate activity entry. Remove old request-count caps for this bounded manual action.

- Move Enable online analysis beside Scan in the digest and popup, synchronise the saved toggle and enable it after successful connection checks. Remove the Settings payload preview and billing paragraph.

- Split oversized AI input batches instead of skipping them wholesale. Show AI progress/off/failure status beside the digest count and include live audit results in the count.

- Add Most insightful (AI) sorting with visible AI insight scores and unanalysed posts last. Clarify insight scoring in prompt version 7 and preserve all collected posts.

- Add default-off digest visibility switches for low AI scores, repeated text, repeated authors and Not useful feedback, with autosave, reset and visible counts. Keep stored posts complete.

- Show every collected post in digests, including legacy digests. Remove the ten-post selection, score/author/text exclusions and feedback hiding. Consider all posts for AI within existing limits; keep unanalysed posts visible.

- Add a live AI activity page with per-scan usage/cost, request attempts and errors, all shortlisted classifications, cache status and search/filtering. Automatically estimate known model costs and mark unavailable usage explicitly; retain reported usage even when output validation fails.

- Add an autosaved stopping mode: saved scroll point or a shared 24-hour cutoff for both feeds. Date-based scans preserve checkpoints and exclude the boundary post.

- Remove Post filters and ignore previously saved exclusions and preferred authors. Remove exclusions from AI payloads and refresh the analysis cache version.

- Check connection uses a newly entered key before the stored key, saves it on success, and identifies the provider on authentication failure.

- Diagnose missing provider permissions against Chrome’s loaded manifest before requesting access. Explain manifest rejections inline and offer extension-manager access and key-free permission diagnostics.

- Remove request-count and token-limit fields from Settings. Use automatic defaults and ignore previous custom values for new scans.

- Remove manual token-price fields, daily estimated spend ceiling, pricing confirmation and their backend gates. Retain request/token limits and normal provider billing; stop displaying dollar estimates.

- Remove reading interests from Settings, Basic ranking and AI prompts; ignore legacy saved interests and invalidate older analysis caches.

- Remove Allow provider & refresh models. Check connection now requests optional provider access in the click gesture and loads OpenRouter free models as part of the same visible operation.

- Show missing online-analysis requirements beside the enable checkbox and confirm enabled state inline. Saving a removed budget/confirmation now turns analysis off instead of silently rejecting the settings edit.

- Show an immediate spinner and disabled state for Check connection, with inline success/error messages, a shared 15-second network deadline, and cancellation when connection details change.

- Vary pauses between scroll steps from 1.5 to 3 seconds, capped by the remaining collection time.

- Add optional direct Claude Haiku 4.5 API analysis with paid budgets, sector/tone tags and digest filters. Surface validated rendered links with post/quote/reply context; do not open threads or linked pages.

- Add remembered digest sorting by post date, comment count, likes, ranking score and pinned status. Collect outer-post reply counts, show date/count metadata, and sort unknown values last.

- Persist account-bound stopping checkpoints per feed and stop later scans at the saved post. Preserve boundaries when not reached; provide Reset scan checkpoints to scan deeper.

- Cache unchanged DOM cards within a feed scan and reuse independent AI assessments per post across scans for 30 days. Content/preferences/provider/model/prompt changes invalidate AI entries; digest notices report reuse.

- Save preferences automatically on edits, with serialized writes, validation and visible save status; remove the Save preferences button.

- Raise configurable per-feed maximums to 1,000 posts and 100 scroll steps; preserve defaults and the 90-second maximum.

- Rename the scan section to Scan settings, explain each per-feed limit, and remove daily scheduling controls. Saving preferences disables legacy schedules.

- Add an optional, default-off setting to hide post photos, image previews and avatars in the dedicated scan tab, preserving inline emoji and text. Newly loaded cards inherit it; cleanup removes it on stop or navigation away. This changes rendering, not image network requests.

## 0.1.0 — 2026-09-27 (unreleased developer preview)

- Original TypeScript/Vite Manifest V3 extension: bounded two-feed DOM sampling, local repository, Basic digest, feedback and deletion.
- Optional direct user-key OpenRouter free-only and paid OpenAI ranking with budgets, validation, cache and fallback.
- Best-effort scheduling with explicit focus opt-in and persisted run recovery.
- Standalone static Vercel install/help website, using synthetic examples.
- Focused Vitest and extension-enabled Playwright fixture tests, reproducible ZIP command, privacy/security/QA documentation.
- No repository publication, Vercel deployment, real provider generation or authenticated live X validation performed.
