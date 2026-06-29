# Security Model

Read this before writing any auth, crypto, or storage code.

## Core principles

1. **Zero knowledge.** The master password is the only key. It must never be
   transmitted, logged, or written to source/config/commit history. It exists
   only transiently in memory to derive the decryption key.
2. **Server stores ciphertext only.** Bitwarden / Vaultwarden never receives
   plaintext vault data or the master password.
3. **Assume the repo is public.** Anything committed is exposed forever. Treat a
   leaked secret as compromised and rotate it.

## Secret handling by surface

| Secret                     | iPhone app            | Chrome extension                 |
|----------------------------|-----------------------|----------------------------------|
| API client id / secret     | iOS Keychain          | `chrome.storage.local` (encrypted) |
| Derived session key        | in-memory / Keychain  | `chrome.storage.session` (cleared on close) |
| Master password            | never stored          | never stored                     |
| Tailscale auth key / token | Keychain (`tailscale-auth-key`) | `chrome.storage.local`, never plaintext |

**Never** use `UserDefaults`, plain files, or `localStorage` for any secret.

## Auto-lock

- iPhone: lock after **30 s** in background (`ScenePhase`).
- Extension: lock after **15 min** inactivity (`chrome.alarms`); clear the
  session key and any active proxy on lock.

## `.env` discipline

- `.env` is git-ignored (`.gitignore` enforces it; `!.env.example` keeps the
  template). **Verify `git status` shows no `.env` before every push.**
- If a secret is ever committed: rotate it immediately (master password at
  bitwarden.com; regenerate API keys / Tailscale keys) and purge from history.

## Tailscale fail-safe

The VPN/proxy must never leave the user in a silent unprotected state:
- iOS: handle every `NEVPNStatus`; auto-reconnect on unexpected drop.
- Extension: proxy active **only** while unlocked; warn before locking if the
  proxy is on; clear `chrome.proxy.settings` on lock.
