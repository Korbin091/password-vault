# chrome-extension/

Manifest V3 Chrome extension: vault popup + login-page auto-fill. Built in
**Phase 3** (extension) and **Phase 4** (Tailscale proxy panel) of
[`../ACTION_PLAN.md`](../ACTION_PLAN.md). Fully buildable/testable in this
environment.

## Planned files

```
manifest.json        ← MV3 manifest
popup.html/.js/.css   ← lock screen, vault list, detail, add, generator, lock
background.js         ← service worker: sync, alarms, proxy logic
content.js            ← auto-fill injector (handles shadow DOM / delayed render)
bitwarden.js          ← API helper module (per ../shared/API-CONTRACT.md)
icons/                ← extension icons
```

No external CDN dependencies — all logic self-contained.

## Security

- Session key in `chrome.storage.session` (cleared on browser close).
- Vault encrypted in `chrome.storage.local`.
- Auto-lock after 15 min via `chrome.alarms`.
- Master password never stored — only used to derive the key.

See [`../docs/security-model.md`](../docs/security-model.md).

## Load for development

`chrome://extensions` → enable Developer Mode → **Load unpacked** → select this
folder. Copy `.env.example` → `.env` (git-ignored) first.
