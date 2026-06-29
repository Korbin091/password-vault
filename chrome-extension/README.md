# chrome-extension/

Manifest V3 Chrome extension: vault popup + login-page auto-fill. Built in
**Phase 3** (extension) and **Phase 4** (Tailscale proxy panel) of
[`../ACTION_PLAN.md`](../ACTION_PLAN.md). Fully buildable/testable in this
environment.

> **Status:** v0.1 — UI, generator, storage, session, auto-lock, auto-fill, and
> the Bitwarden crypto primitives are built and tested. The extension runs in
> **demo mode** (bundled sample vault) until live sync is wired — that step is
> gated on [ADR 0001](../docs/decisions/0001-extension-crypto.md).

## Files

```
manifest.json     MV3 manifest (popup, service worker, content script, permissions)
popup.html/.css/.js  lock screen, vault list, detail, add form, generator, lock
background.js     service worker: message router + chrome.alarms auto-lock
content.js        auto-fill injector (field detection, shadow-DOM aware, MutationObserver)
vault.js          vault service — demo + live modes, config storage
bitwarden.js      live REST client — prelogin/token/sync/decrypt + create, per ../shared/API-CONTRACT.md
crypto.js         Bitwarden-compatible crypto on Web Crypto API (PBKDF2/HKDF/AES-CBC+HMAC)
generator.js      cryptographically-secure password generator
storage.js        chrome.storage wrappers (session/local) with in-memory fallback
test/             unit tests (crypto known-answer vectors + generator)
icons/            extension icons
```

No external CDN dependencies — all logic self-contained.

## Demo mode vs live sync

- **Demo mode (default):** with no credentials configured, the extension loads a
  small **sample vault** so the whole UI is usable without an account. A `DEMO`
  badge shows; nothing is written to any server.
- **Live sync:** open **⚙ Settings** (lock screen) and enter your Bitwarden API
  key — Email, Client ID, Client Secret (Settings → Security → API Key), and an
  optional **Server URL** for self-hosted Vaultwarden. Then unlock with your
  master password. The extension runs `prelogin → token → /api/sync`, derives the
  key from your master password, and decrypts locally. It re-syncs every 5 min
  while unlocked. Credentials live in `chrome.storage.local`; the master password
  is never stored.

> **KDF support:** PBKDF2 accounts (Bitwarden's default) work today. Argon2id
> accounts fail safe with a clear message until that KDF is added — see
> [ADR 0001](../docs/decisions/0001-extension-crypto.md).

## Develop

```bash
npm test          # run crypto + generator unit tests (Node 18+, no deps)
```

Load in the browser: `chrome://extensions` → enable **Developer Mode** →
**Load unpacked** → select this folder. Copy `.env.example` → `.env`
(git-ignored) first if configuring live sync.

### Automated end-to-end check (optional)

The popup + service worker + demo flow are verified by an automated Playwright
script that loads the unpacked extension in Chromium and exercises unlock →
list → search → filter → detail → generator → add → lock. (Kept out of the repo
since Playwright isn't a project dependency; ask if you want it added under a
`devDependencies` + `e2e` script.)

## Security

- Session key in `chrome.storage.session` (cleared on browser close).
- Vault cache in `chrome.storage.local`; master password never stored.
- Auto-lock after 15 min via `chrome.alarms`.

See [`../docs/security-model.md`](../docs/security-model.md).
