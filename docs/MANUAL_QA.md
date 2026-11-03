# Manual QA / release checklist

Synthetic fixtures are not proof of current X behavior. Do not run these steps against an account without the account owner's authorization. Resolve X platform-rule compatibility before release. Do not click through verification challenges or unrelated prompts.

## Required live smoke record

- Date/time:
- Chrome version and OS (Windows, macOS or Linux):
- X UI language (English is the only implemented language):
- Authorized session available: yes/no (do not record account handle):
- Following distinct count / reason / skipped cards:
- For You distinct count / reason / skipped cards:
- Union count / overlaps:
- Observed limitations:
- Real provider tested / model / result (no key or post text):

Current status: **blocked — no authorized logged-in X test session or provider credentials supplied.** No live counts exist.

## Installation and Basic scan

1. Run build/check commands from README and load `dist/` unpacked. Verify no extension errors in `chrome://extensions`.
2. Open popup/settings/digest. Basic must be usable without key or host permission for providers. Leave optional filters empty initially.
3. Sign in normally in an ordinary X tab. Set English UI. Keep the reading tab's scroll position visible for comparison. Start the scan from the extension.
4. Confirm a separate visible tab opens, switches feeds by their accessible labels, waits for old cards to leave, reads/scrolls itself, then closes only its own tab. The original reading tab must remain unchanged.
5. Confirm real outer-author IDs/links on ordinary, reply, quote and repost cards. Quote text must not be attributed to the outer author. Check excerpts, promoted and media-only labels, null unknown counts/timestamps.
6. Compare observed counts/provenance with the digest. Same ID in both feeds must merge. Lower caps to 2 posts, 5 seconds or one scroll and verify each bound. Try cancellation while scrolling and during feed switching.
7. Enable **Hide post images while scanning**, save, and start a new scan. Verify photos/previews/avatars collapse in the dedicated scan tab (including incoming cards), inline emoji/text remain, and normal reading tabs are unaffected. Turn the option off and confirm the next scan displays images. Navigate the scan tab away from home without reloading: it should stop and restore images. This does not block downloads; benchmark performance separately on a consented live session.
8. Sign out or encounter a normal login wall: expect blocked/partial without clicking unrelated controls. Non-English/missing tabs must not be guessed by index. Never manufacture an account challenge.
9. Close the scan tab: committed posts survive with interrupted status. Stop the worker through extension debugging, then allow the content script's next message to wake it. No duplicate jobs or discarded committed records. Start twice quickly: only one run.
10. Change the visible X account: expect explicit reset requirement before new account data enters storage. Use separate profiles as the supported alternative.

## Provider and privacy checks

1. Inspect extension network activity in Basic mode: no OpenRouter/OpenAI requests. Normal X page traffic is expected.
2. Use only a user-owned test key, explicitly authorize disclosure and selected-origin permission. Key defaults to session-only; do not print it. Check connection and select a catalogue model.
3. OpenRouter: verify current zero-priced entries only. Simulate changed/missing pricing with fixtures: generation must stop, never use a paid model. Real free availability cannot be assumed.
4. OpenAI: select a supported model, save a key, check connection and enable analysis without entering prices or a spend ceiling. Verify token usage and request limits.
5. Inspect a consented request locally: opaque IDs/text/preferences only, no structured author/URL/engagement metadata, no key in prompt. Do not save actual text in public logs/screenshots.
6. Test 401/402/429, quota exhaustion, one server retry with Retry-After, malformed JSON, fake IDs and HTML via mocks. Preserve prior valid batches and label mixed/fallback output.
7. Restart Chrome with session-only key: Basic fallback with reason. Remember-key opt-in: key available only in trusted contexts. Remove key: absent from both session/local storage. Content-script storage reads must be denied.
8. Close digest during inference or cancel: no further generation, preserve collected posts. Delete during pending inference: no cached/digest data may be recreated by late results.

## Scheduling and data

1. Confirm Scan settings explains all three limits and has no daily scheduling, local-time or Save preferences controls. Edit text, limits and toggles; wait for Changes saved, reopen Settings and verify persistence. Invalid limits should display an error and preserve the last saved value.
2. Change a preference with a legacy daily schedule configured: daily/allowFocus should become false and the daily alarm should be cleared.
3. Start a scan manually and confirm the configured limits apply separately to each feed.
4. Give useful/not-useful feedback, reset it, pin/unpin. Feedback must take effect; post text must remain inert and original links must stay usable.
5. Seed old synthetic records to test retention, 5,000-post cap, pinned exemptions and reference cleanup.
6. Delete all data: confirm IndexedDB stores, keys, settings, cache, usage, alarms and optional provider permissions are cleared. Previously downloaded files and provider-held data cannot be retracted.

## Publication

- Replace license owner placeholder and add private security-reporting contact.
- Review permissions, provider/X terms, and platform-policy compatibility.
- Record real supported browser/OS/provider combinations, not fixture equivalents.
- Keep real data/profiles out of source, CI and release archives.
- Build ZIP from the documented command; inspect contents. Deploy only `site-dist/` to Vercel when separately authorized. Publication remains a separate action.

## Feed checkpoints

Complete a short scan, then increase the post cap and scan again. Verify each feed stops at its previously saved final post and reports the checkpoint reason. Check the boundary persists after extension/browser restart. If an anchor is absent or beyond the current limit, normal bounds must end collection and preserve the old checkpoint. Reset scan checkpoints and verify the next completed feed saves a new boundary. Reset during an active run must be rejected; Delete all data must remove the checkpoints. For You can reorder cards, so record skipped or missing coverage separately.

## Digest sorting

Verify Sort posts changes the order of the selected digest for newest/oldest, most comments/likes, highest score and pinned first; combine with feed filters and reopen the page to verify saved sort choice. Missing values must appear last, including in oldest-first order. On live X, compare outer-post reply counts with the captured snapshot; quoted-post counts must not be substituted. Old saved posts without comment counts should show unknown until recollected.

## Claude, category filters and links

With a test Anthropic API key, grant only the Anthropic origin, select Haiku 4.5 and confirm Check connection makes a Models GET without generation. Verify no price, spend-ceiling or pricing-confirmation fields are required. Confirm sector/tone filters and cached reuse; labels are subjective. Remove keys and Delete all data must remove the Anthropic key and permission too. Verify HTTP(S) post/quote/reply links against rendered X content; unknown t.co destinations must remain short links and no destinations or comment threads should load automatically.

## Connection feedback

Click Check connection with missing model/key and verify inline instructions near the button. With a saved key, verify Checking… and the spinner appear immediately and duplicate clicks are disabled. Test invalid key, unavailable network, a stalled connection (15-second timeout) and retry success. Changing provider/model or saving/removing keys during a check must cancel it. Check native host permission prompts separately.

## Enabling online analysis

With incomplete setup, verify the checklist beside Enable online analysis lists each missing requirement and a rejected click reports its reason there. After setting the model/key/permission, enabling should persist across reload. Confirm the removed price/spend/pricing-confirmation inputs are absent and do not gate requests. Removing keys must disable analysis.

## Combined provider connection

Confirm the separate Allow provider & refresh models button is absent. After saving a key, Check connection must request only the chosen provider origin when Chrome needs consent. Decline and verify an inline error without network requests; retry and approve. OpenRouter must populate current free models during the same check and preserve a still-valid choice, otherwise selecting the first available model. Claude/OpenAI checks use their selected model. Native permission dialogs still require manual validation.
