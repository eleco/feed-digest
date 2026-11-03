# Security

This is a developer preview. Before publication the maintainer must configure a private vulnerability-reporting channel (for example GitHub private vulnerability reporting). Do not post keys, account information, feed captures or exploit payloads containing personal information in public issues.

Security boundaries:

- Content-script operations are allowlisted, payloads bounded, sender ID/frame/owned tab/home URL checked, and active run IDs/leases verified. UI messages are limited to known extension pages. There are no external message listeners or arbitrary HTTP proxy operations.
- Provider keys are restricted to trusted storage and never passed to the content script. Only a selected optional origin can be used. Requests omit cookies and reject redirects. No shared key ships in source or CI.
- Untrusted social/model content is rendered with `textContent`. Canonical X URLs are validated; external links use noopener/noreferrer. Markdown exports escape markup. Model IDs/scores/strings are validated before local ID mapping.
- CSP blocks remote scripts, objects and arbitrary connections. Prompt instructions plus strict schema/ID validation reduce prompt-injection impact; model claims still require reader judgment.
- Quota/spend reservations precede requests in IndexedDB transactions. Free pricing is checked before each request with no paid fallback. Error text is bounded and does not include response bodies or prompts.
- Delete all data cancels jobs before clearing stores. A cancelled generation cannot write a cache or digest after the run is removed.

Remaining risks: changing X DOM, non-API automation rules/account enforcement, provider policies/prices/availability, user device or trusted-extension compromise, mistaken content/model claims, and unverified cross-platform/real-provider behavior. Browser storage is not a secrets vault. Set provider account billing limits independently.
