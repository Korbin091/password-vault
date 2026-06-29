# 🔐 Password Vault

A personal, end-to-end encrypted password manager that syncs between a **native
iPhone app** and a **Chrome extension**, using **Bitwarden** (cloud or
self-hosted Vaultwarden) as the encrypted sync backbone. Built for **personal
use only**.

This repository is also designed to plug into a future **Tailscale Funnel App
Hub** as a registered, private-by-default app (see
[`docs/hub-integration.md`](docs/hub-integration.md)).

> **Status:** Planning + skeleton scaffold. No feature code yet.
> The build is broken into phases — see **[`ACTION_PLAN.md`](ACTION_PLAN.md)**.

## Repository layout

```
password-vault/
├── ACTION_PLAN.md         ← the phased build plan (start here)
├── ios-app/               ← native SwiftUI iPhone app (Phase 2 + 4)
├── chrome-extension/      ← Manifest V3 extension (Phase 3 + 4)
├── shared/                ← cross-platform notes: data model, API contract
├── docs/                  ← architecture, security model, hub integration
└── .gitignore             ← ensures .env / secrets never get committed
```

## Quick start

1. Read **[`ACTION_PLAN.md`](ACTION_PLAN.md)** for the full phased plan.
2. Read **[`docs/security-model.md`](docs/security-model.md)** before touching auth code.
3. Provision a Bitwarden account / Vaultwarden instance (Phase 0 in the plan).
4. Copy each `.env.example` to `.env` and fill it in locally — **never commit it.**

## Security at a glance

- **Zero-knowledge:** the master password never leaves the device and is never
  written to source, logs, or any server.
- **AES-256 + PBKDF2** encryption, handled by the Bitwarden crypto layer.
- Secrets live in the **iOS Keychain** (app) and **`chrome.storage.session`**
  (extension) — never in `UserDefaults`, plain files, or `localStorage`.
- This app is a **Security**-category hub app: it must **never** be exposed
  publicly via Tailscale Funnel.
