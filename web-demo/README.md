# web-demo/

A hosted, clickable **UI preview** of the Chrome extension's popup — so you can
try the interface from any browser or phone **without installing anything**.

> **Demo data only.** The web demo cannot do live Bitwarden sync — that requires
> the installed extension's host permissions (a plain web page is blocked by
> CORS, and there's no service worker / `chrome.*` storage). For real sync, load
> `../chrome-extension/` unpacked in Chrome. See [`../ACTION_PLAN.md`](../ACTION_PLAN.md).

## How it works

`build.mjs` assembles `../_site/` from the **real** extension files (single
source of truth) plus a small shim:

- `chrome-shim.js` — provides a minimal `chrome.runtime.sendMessage` that routes
  popup messages straight to the in-page vault service (demo mode). `storage.js`
  falls back to in-memory automatically when `chrome.storage` is absent.
- `demo-init.js` (generated) — hides the live-sync Settings entry and shows a
  "demo data only" banner.

## Build & preview locally

```bash
node web-demo/build.mjs           # -> ../_site/
npx serve _site                   # or any static server; open the printed URL
```

(`_site/` is a build artifact and is git-ignored.)

## Hosting

`.github/workflows/pages.yml` builds this and deploys to **GitHub Pages** on
every push. One-time: repo **Settings → Pages → Source: "GitHub Actions"**.
Published at `https://<owner>.github.io/password-vault/`.
