# Architecture

## Overview

Two clients, one encrypted backend. Bitwarden (cloud or self-hosted Vaultwarden)
is the **sync backbone only** — it stores ciphertext. All encryption and
decryption happen on-device with a key derived from the master password.

```
   ┌────────────────┐                    ┌────────────────────┐
   │  iPhone app     │                    │ Chrome extension    │
   │  SwiftUI        │                    │ Manifest V3         │
   │  Keychain       │                    │ chrome.storage.*    │
   └───────┬────────┘                    └──────────┬─────────┘
           │                                         │
           │     Bitwarden REST API (ciphertext)     │
           └────────────────────┬────────────────────┘
                                ▼
              ┌──────────────────────────────────┐
              │  Bitwarden cloud  OR  Vaultwarden   │
              │  (selected by BW_SERVER)            │
              └──────────────────────────────────┘
```

## Backend selection (decided in Phase 0)

Both clients pick their backend from a single `BW_SERVER` value:

- **Bitwarden cloud (default):** leave `BW_SERVER` unset → clients use the
  official `https://api.bitwarden.com` / `https://identity.bitwarden.com`.
- **Vaultwarden self-host:** set `BW_SERVER=http://your-server-ip:8080` →
  clients talk to your own server. **No other code changes.**

> Record the final decision here once made: `BACKEND = <cloud | vaultwarden>`.

### Vaultwarden self-host recipe (option)

```bash
docker pull vaultwarden/server:latest
docker run -d \
  --name vaultwarden \
  -v /vw-data/:/data/ \
  -p 8080:80 \
  -e SIGNUPS_ALLOWED=false \
  -e ADMIN_TOKEN=your-secret-admin-token \
  vaultwarden/server:latest
```

Then set `BW_SERVER=http://your-server-ip:8080` in both clients' `.env`.

## Encryption model

- Master password → **PBKDF2** → symmetric key (never leaves the device).
- Vault items encrypted with **AES-256** before they ever hit the network.
- The server never sees plaintext or the master password = **zero knowledge**.

## Tailscale layer (Phase 4)

- **iPhone:** `NetworkExtension` (`NEVPNManager`) + Tailscale Swift SDK = a real
  OS-level VPN tunnel into the private tailnet.
- **Chrome:** extensions cannot make OS VPNs, so the extension uses
  `chrome.proxy` to route browser traffic through a **SOCKS5 proxy** served by a
  tailnet device (`tailscale serve --bg socks5 1055`).

## Hub relationship

This app is a future registered app in the **Tailscale Funnel App Hub**
(separate project). It is **private-by-default and never funneled** — see
[`hub-integration.md`](hub-integration.md).
