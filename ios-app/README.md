# ios-app/

Native SwiftUI iPhone password manager. Built in **Phase 2** (app) and
**Phase 4** (Tailscale VPN) of [`../ACTION_PLAN.md`](../ACTION_PLAN.md).

> ⚠️ **Requires macOS + Xcode + an Apple Developer account.** Swift can be
> authored in any environment, but compiling, signing, and running happen on a
> Mac. This folder is a scaffold; the Xcode project is created in Phase 2.

## Target

- iOS 17+, SwiftUI throughout, `async/await` for all network calls.
- API credentials live in the **iOS Keychain** — never `UserDefaults` or files.

## Planned structure

```
BitwardenSync/
├── App/           ← entry point, scene lifecycle
├── Auth/          ← Face ID / Touch ID, master-password fallback, auto-lock
├── Vault/         ← list, detail, add/edit views
├── Generator/     ← password generator
├── Services/      ← BitwardenAPI.swift, KeychainService.swift
├── Models/        ← VaultItem.swift, SyncState.swift
└── VPN/           ← (Phase 4) VPNView, VPNViewModel, TailscaleManager, DeviceListView
```

## Setup

Copy `.env.example` → `.env` (git-ignored). On-device, secrets are read from the
Keychain; `.env` is only for local tooling. See
[`../docs/security-model.md`](../docs/security-model.md).
