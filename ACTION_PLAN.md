# Action Plan — Bitwarden Personal Sync System

Derived from the **Bitwarden Sync Framework** document. This plan turns that
framework into an ordered, trackable build, and keeps the project ready to drop
into the future **Tailscale Funnel App Hub** (separate framework).

**Scope decisions for this branch (`claude/epic-clarke-7mtm6z`):**
- Deliverable now = this plan **+ skeleton scaffold** (folders, `.gitignore`,
  `.env` templates, docs). No feature code yet.
- Sync backend = **decide later**. The plan is written backend-agnostic; every
  phase works against either Bitwarden cloud or a self-hosted Vaultwarden by
  swapping `BW_SERVER`. The decision is locked in Phase 0.

---

## 1. Goal

One personal vault, two clients, always in sync, fully end-to-end encrypted:

| Component        | Tech                                              | Builds where |
|------------------|---------------------------------------------------|--------------|
| Sync engine      | Bitwarden API (cloud) **or** Vaultwarden (self-host) | n/a (service) |
| iPhone app       | Swift + SwiftUI + Face ID + Bitwarden SDK         | **macOS + Xcode required** |
| Chrome extension | Manifest V3 + JS + auto-fill                       | this environment OK |
| Encryption       | AES-256 / PBKDF2 (master password = only key)     | — |
| Private network  | Tailscale (VPN in app, SOCKS5 proxy in extension) | partial |

Non-negotiables (from the framework's SYSTEM REQUIREMENTS):
1. End-to-end encryption via the Bitwarden API.
2. Native iPhone app with Face ID / Touch ID.
3. Chrome extension with auto-fill on login pages.
4. Real-time-ish sync: a change on one device shows on the other.
5. Zero knowledge: the master password never reaches any server.

---

## 2. Environment reality check

This is a Linux cloud session. That shapes *where* each phase can actually be
executed and verified:

- ✅ **Buildable & testable here:** Chrome extension (MV3, plain JS), the shared
  data-model / API-contract docs, any Node tooling, all planning docs.
- ⚠️ **Authorable here, must build on macOS:** the SwiftUI iPhone app and its
  Tailscale `NetworkExtension` integration require **Xcode + a Mac + an Apple
  Developer account**. We can write and review Swift here, but compile/sign/run
  happens on the user's Mac.
- 🔑 **User-provided, out of band:** Bitwarden/Vaultwarden credentials, Tailscale
  auth key + API token, Apple signing identity. The agent must **ask for these
  and never hardcode them** — they go only in local `.env` / Keychain.

---

## 3. Architecture

```
        ┌───────────────┐         ┌──────────────────┐
        │  iPhone app    │         │ Chrome extension  │
        │  (SwiftUI)     │         │  (Manifest V3)    │
        └──────┬────────┘         └─────────┬────────┘
               │  Bitwarden REST API (E2E encrypted)  │
               └──────────────┬───────────────────────┘
                              ▼
                ┌──────────────────────────────┐
                │ Bitwarden cloud  OR  Vaultwarden │  ← sync backbone
                └──────────────────────────────┘

   Master password ── derives key on-device (PBKDF2) ── decrypts vault locally
   (never transmitted, never stored in source/logs)
```

Tailscale (Phase 4) wraps all client traffic in a private mesh: the iPhone app
gets a real OS VPN toggle; the extension routes browser traffic through a
SOCKS5 proxy served by a tailnet device.

See [`docs/architecture.md`](docs/architecture.md) for the detailed diagram and
[`shared/DATA-MODEL.md`](shared/DATA-MODEL.md) for the vault item schema both
clients share.

---

## 4. Phased plan

Each phase lists **deliverables** and **acceptance criteria**. Phases are
ordered; later phases assume earlier ones are green. Map to the framework: its
Phase 1→2→3→4 are our Phases 0→2→3→4, with an added Phase 1 (shared contract)
and Phase 5 (hub integration).

### Phase 0 — Provisioning & backend decision  *(blocks everything)*
The framework's "Phase 1: Bitwarden Account Setup" + the deferred backend call.
- [ ] **Decide backend:** Bitwarden cloud *or* self-hosted Vaultwarden. Record
      the choice in `docs/architecture.md`. (Vaultwarden Docker recipe is in
      that doc; both clients connect via `BW_SERVER` with zero code change.)
- [ ] Create the account / stand up the server; enable 2FA on the account.
- [ ] Generate API key → obtain `BW_CLIENTID`, `BW_CLIENTSECRET`, `BW_EMAIL`.
- [ ] Confirm `.env` files are git-ignored (already enforced by `.gitignore`).
- **Acceptance:** a `bw login --apikey` (or Vaultwarden equivalent) succeeds
  locally and lists vault items. No secret appears anywhere in git.

### Phase 1 — Shared contract  *(buildable here)*
Not in the original framework, but it prevents the two clients from drifting.
- [ ] `shared/DATA-MODEL.md` — vault item shape (login, secure note, card),
      field names, the `revisionDate` used for conflict resolution.
- [ ] `shared/API-CONTRACT.md` — the exact Bitwarden REST calls both clients
      use: `/identity/connect/token` (client_credentials grant), sync, item
      CRUD, and how `BW_SERVER` selects cloud vs self-host.
- [ ] Conflict rule: **last-write-wins by `revisionDate`** (documented once,
      implemented identically on both clients).
- **Acceptance:** both client phases can be implemented from these docs without
  re-reading the Bitwarden API from scratch.

### Phase 2 — iPhone app  *(author here, build on macOS)*
Framework "Phase 2: iPhone App". Run inside `ios-app/`.
- [ ] App shell: SwiftUI, iOS 17+, async/await for all network calls.
- [ ] **Auth:** Face ID / Touch ID via `LocalAuthentication`; master-password
      fallback; auto-lock after 30 s in background (`ScenePhase`).
- [ ] **Vault:** searchable list, category tabs (All / Logins / Cards / Notes),
      pull-to-refresh sync.
- [ ] **Detail:** reveal toggle, copy username/password/URL with haptics, edit + delete.
- [ ] **Generator:** length slider 8–64, toggles (upper/lower/numbers/symbols), one-tap copy.
- [ ] **Sync:** Bitwarden REST per the shared contract; CoreData offline cache;
      "last synced" timestamp; credentials in **iOS Keychain** only.
- **Acceptance:** the framework's "iPhone App" deployment checklist passes on a
  real device (builds on iPhone 15 sim iOS 17, Face ID prompts, vault syncs,
  copy works, auto-lock works, new entry round-trips to the backend).

### Phase 3 — Chrome extension  *(fully buildable here)*
Framework "Phase 3: Chrome Extension". Run inside `chrome-extension/`.
- [ ] **Files:** `manifest.json` (MV3), `popup.{html,js,css}`, `background.js`
      (service worker), `content.js` (auto-fill), `bitwarden.js` (API module).
      No external CDN deps — all logic self-contained.
- [ ] **Popup:** master-password lock screen → searchable vault list → item
      detail with copy buttons → Add New → Generator tab → Lock button.
- [ ] **Auto-fill:** content script detects user/pass fields (incl. shadow DOM /
      delayed render), shows a Bitwarden icon, click → matching logins → fills.
- [ ] **Security:** session key in `chrome.storage.session` (cleared on browser
      close); vault encrypted in `chrome.storage.local`; auto-lock after 15 min
      via `chrome.alarms`; master password used only to derive the key, never stored.
- [ ] **Sync:** same backend + credentials as the app; sync on unlock + every 5
      min; status + last-updated in the popup footer.
- **Acceptance:** the framework's "Chrome Extension" checklist passes (loads
  unpacked, unlocks, auto-fills a login page, new entry appears in the web vault
  *and* in the iPhone app after sync).

### Phase 4 — Tailscale VPN integration
Framework "Phase 4: Tailscale VPN Integration". Two sub-tracks.
- [ ] **iOS (author here, build on macOS):** add Tailscale Swift SDK; entitlements
      (Network Extensions, Personal VPN, App Groups, Keychain Sharing); a 4th
      "VPN" tab with toggle, status, assigned `100.x.x.x` IP, tailnet peer list,
      exit-node picker; `NEVPNManager` lifecycle handling all `NEVPNStatus`
      cases; auth key from Keychain only; auto-reconnect. New files under
      `ios-app/BitwardenSync/VPN/`.
- [ ] **Extension (buildable here):** a "VPN Protection" panel that toggles
      `chrome.proxy` to a SOCKS5 proxy (`tailscale serve --bg socks5 1055` on a
      tailnet device); verify via `api.ipify.org`; proxy only while unlocked;
      clear proxy on auto-lock; warn before locking if proxy is active.
- **Acceptance:** iPhone shows a real VPN toggle that connects and routes
  traffic; extension proxy makes the browser's public IP match the Tailscale
  device IP; both fail safe (no silent un-protected state).

### Phase 5 — Hub readiness *(forward-looking, low effort)*
Prepare for the **Tailscale Funnel App Hub** (separate framework) without
building the hub here.
- [ ] Reserve **port 8080**, category **Security** for this app.
- [ ] Provide the `apps.json` registry entry (see `docs/hub-integration.md`).
- [ ] Ensure **`funnelEnabled: false` permanently** — a Security app is never
      exposed publicly via Funnel.
- [ ] If/when a web surface exists, add the standard `GET /health` endpoint the
      hub's monitor expects.
- **Acceptance:** the hub can register and health-check this app, and its UI
  correctly disables the public/Funnel toggle for it.

---

## 5. Security guardrails (apply in every phase)

From the framework's security warnings + standard practice. Full detail in
[`docs/security-model.md`](docs/security-model.md).

- The **master password** must never appear in source, logs, commit history, or
  any network request. If it ever leaks, rotate it immediately.
- `.env` is **never** committed (enforced by `.gitignore`; verify before every push).
- Secrets at rest: **iOS Keychain** (app) / **`chrome.storage.session`** (extension).
  Never `UserDefaults`, plain files, or `localStorage`.
- Tailscale auth key / API token: Keychain or `.env` only, never hardcoded.
- Treat this repo as public: assume anything committed is exposed forever.

---

## 6. Troubleshooting playbook

The framework ships targeted follow-up prompts for the common failure modes
(Bitwarden auth, Face ID not triggering, auto-fill detection, sync conflicts,
extension session loss, Xcode signing, and every VPN failure mode). These are
collected verbatim in [`docs/troubleshooting.md`](docs/troubleshooting.md) so
they're at hand during each phase.

---

## 7. Open questions / decisions to lock

1. **Backend** (Phase 0): Bitwarden cloud vs Vaultwarden self-host. *Deferred.*
2. **iOS build host:** confirmed access to a Mac + Xcode + Apple Developer
   account for Phases 2 & 4 (the iOS half cannot be compiled in this session).
3. **Bitwarden SDK vs raw REST:** the SDK simplifies crypto but the raw
   `/identity/connect/token` + sync endpoints are the documented fallback. Lock
   in Phase 1.
4. **Hub host:** which Mac/device hosts the future hub (sets the MagicDNS
   `privateUrl` for the `apps.json` entry).

---

## 8. Suggested milestones

| Milestone | Contents | Branch / PR |
|-----------|----------|-------------|
| **M0** | This plan + skeleton scaffold | `claude/epic-clarke-7mtm6z` (this PR) |
| **M1** | Phase 0 + Phase 1 (backend chosen, shared contract) | follow-up PR |
| **M2** | Phase 3 Chrome extension (end-to-end, buildable here) | follow-up PR |
| **M3** | Phase 2 iOS app (authored here, built on macOS) | follow-up PR |
| **M4** | Phase 4 Tailscale (both clients) | follow-up PR |
| **M5** | Phase 5 hub registration | folds into hub project |

Each milestone is self-contained and independently reviewable, matching the
framework's "each prompt is self-contained" design.
