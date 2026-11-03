# Contributing

Use Node 24 and `npm ci`. Keep the extension framework-free and the X selectors confined to `src/content/adapter.ts`. Changes need `npm run typecheck`, `npm test`, `npm run build`, `npm run build:site`, and relevant `npm run test:browser` coverage. Format with `npx prettier --write` on changed files.

Use only synthetic fixtures, screenshots and provider responses. Never commit `.env`, real exports, credentials, post-text logs, browser profiles or personal notes. Do not copy unlicensed third-party source. The project implementation is original; npm dependencies retain their own licenses.

Report selector breakage with Chrome/OS, language, date and non-sensitive counts/error codes. Do not attach full X page HTML or network captures. Follow `docs/MANUAL_QA.md` for any authorized live session and identify it separately from fixture tests.

Publishing a repository, release or Vercel deployment is a separate maintainer action. Before release, resolve X platform-policy compatibility, complete live smoke testing, replace the license owner placeholder and configure a private security-reporting channel.
