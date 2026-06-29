# ADR 0001 — Extension sync backend + crypto approach

- **Status:** Proposed (awaiting confirmation)
- **Date:** 2026-06-29
- **Context:** Phase 3 (Chrome extension) needs to turn the master password into
  a decryption key and talk to a Bitwarden-compatible server. Two independent
  decisions block live sync. The UI, generator, storage, session, and auto-fill
  are all built and tested **without** needing either decision (demo mode).

---

## Decision A — Sync backend (cloud vs self-host)

**Per the user, this is deferred ("decide later").** The codebase is written so
the choice is a single `BW_SERVER` value (see `shared/API-CONTRACT.md`):

| Option | Pros | Cons |
|--------|------|------|
| **Bitwarden cloud** (recommended default) | Zero ops; official uptime; easiest start | Data lives on Bitwarden's servers (still E2E encrypted) |
| **Vaultwarden self-host** | 100% data control; free | You run/patch a server; another moving part |

**Recommendation:** start on **Bitwarden cloud** to get end-to-end sync working,
then optionally point `BW_SERVER` at a Vaultwarden box later — no code change.
Either way, the server only ever holds ciphertext.

---

## Decision B — Crypto implementation (the real choice for this phase)

How does the extension perform Bitwarden's key derivation + cipher decryption?

### Option B1 — Hand-rolled WebCrypto (raw REST)  ★ recommended to start
Implement Bitwarden's scheme directly on the Web Crypto API and call the REST
API ourselves. **This is already built and tested** in `crypto.js`
(`test/crypto.test.mjs` passes, including RFC PBKDF2-SHA256 known-answer
vectors and an encrypt→decrypt→MAC round-trip).

- **Pros:** zero dependencies; no build step; loads unpacked as-is; satisfies the
  framework's "no external CDN, all logic self-contained" rule; small, auditable.
- **Cons:** we own security-sensitive code; must cover protocol details
  (PBKDF2 *and* the newer **Argon2id** KDF, key rotation, item types). Today
  `crypto.js` covers the **PBKDF2** path only.

### Option B2 — Official Bitwarden SDK (WASM)
Bundle `@bitwarden/sdk-wasm` and let it do the crypto.

- **Pros:** battle-tested; tracks protocol changes (Argon2id, sends, attachments).
- **Cons:** WASM blob + a bundler/build step (no more "load unpacked" directly);
  larger; more opaque; heavier than a personal vault needs.

### Recommendation
**Start with B1 (hand-rolled WebCrypto), ship the PBKDF2 path, keep B2 as a
documented fallback.** Rationale: it's already working and tested, needs no build
tooling, and matches the framework's self-contained constraint. We add **Argon2id**
support (a small, well-specified addition) before relying on it for an account
configured with Argon2id. If we later need sends/attachments/org features, revisit B2.

**Guardrails if we keep B1:**
- Treat `crypto.js` as frozen-by-default: no edits without re-running the tests.
- Add Argon2id KDF support + tests before live use (Bitwarden's default for new
  accounts can be Argon2id).
- Verify against a *real* throwaway Bitwarden account's `/api/sync` payload
  before trusting it with real data.

---

## Consequences / next steps (once confirmed)
1. Wire `bitwarden.js`: `POST /identity/connect/token` (client_credentials) →
   `GET /api/sync` → decrypt with `crypto.js` → hand items to `vault.js` live mode.
2. Replace `vault.unlock()`'s demo branch with the live path (the seam is already
   marked in `vault.js`).
3. Add Argon2id to `crypto.js` (if B1) **or** integrate the SDK (if B2).
4. End-to-end test against a throwaway account, then against the real vault.
