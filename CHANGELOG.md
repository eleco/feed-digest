# Changelog

## Unreleased

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

- Keep saved posts accessible across scans through a combined default view and dated history selector. Preserve AI annotations, analyse the selected collection, and export all saved scans as a JSON backup.

- Restrict buy/sell and asset-type controls to Finance, clearing them when the sector changes. Add a persistent, autosaved word/phrase blacklist under digest visibility controls.

- Add buy/sell recommendation and asset-type filters, with compact AI metadata and explicit not-checked status for older posts. Prompt version 9 refreshes earlier assessments when analysis is requested.

- Display original collected posts and links instead of AI summaries, explanations, scores and category badges. Request only score/sector/tone metadata and preserve version 7 cache reuse; Markdown exports also use original text.

- Show live analysed-post progress and current-run AI cost in the digest. Include cached progress, pending usage and incomplete-cost labels; retain the summary after analysis stops.

- Stop AI analysis on the first error without automatic retries or subsequent batches; preserve completed classifications and recorded usage.

- Accept JSON wrapped in Markdown fences, detect output truncation, size output allowances by batch and recover malformed/truncated batches by splitting them. Preserve usage and costs for every failed attempt.

- Replace the AI checkbox with Analyse with AI. Scanning only collects posts; manual analysis processes the full current collection without rescanning, preserves scan history, uses cached results and records a separate activity entry. Remove old request-count caps for this bounded manual action.

- Move Enable online analysis beside Scan in the digest and popup, synchronise the saved toggle and enable it after successful connection checks. Remove the Settings payload preview and billing paragraph.

- Split oversized AI input batches instead of skipping them wholesale. Show AI progress/off/failure status beside the digest count and include live audit results in the count.

- Add Most insightful (AI) sorting with visible AI insight scores and unanalysed posts last. Clarify insight scoring in prompt version 7 and preserve all collected posts.

- Add default-off digest visibility switches for low AI scores, repeated text, repeated authors and Not useful feedback, with autosave, reset and visible counts. Keep exports and stored posts complete.

- Show every collected post in digests and exports, including legacy digests. Remove the ten-post selection, score/author/text exclusions and feedback hiding. Consider all posts for AI within existing limits; keep unanalysed posts visible.

- Add a live AI activity page with per-scan usage/cost, request attempts and errors, all shortlisted classifications, cache status, search/filtering and JSON export. Automatically estimate known model costs and mark unavailable usage explicitly; retain reported usage even when output validation fails.

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

- Original TypeScript/Vite Manifest V3 extension: bounded two-feed DOM sampling, local repository, Basic digest, feedback, export and deletion.
- Optional direct user-key OpenRouter free-only and paid OpenAI ranking with budgets, validation, cache and fallback.
- Best-effort scheduling with explicit focus opt-in and persisted run recovery.
- Standalone static Vercel install/help website, using synthetic examples.
- Focused Vitest and extension-enabled Playwright fixture tests, reproducible ZIP command, privacy/security/QA documentation.
- No repository publication, Vercel deployment, real provider generation or authenticated live X validation performed.
