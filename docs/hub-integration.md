# Tailscale Funnel Hub Integration

This password manager is designed to register as an app in a future **Tailscale
Funnel App Hub** (a separate project, built from the *Tailscale Funnel Hub
Framework*). The hub is **not** built in this repo — this doc only captures the
contract so registration later is trivial.

## Hard rule: never public

This is a **Security**-category app. It must stay **private-by-default** and
**never** be exposed via Tailscale Funnel.

- `funnelEnabled` must remain `false` permanently.
- The hub disables the "Make Public" toggle for any `category: "Security"` app
  and shows: *"Security apps cannot be made public."*

## Registry entry (`apps.json`)

When the hub exists, add this entry (fill in the bracketed values):

```json
{
  "id": "password-manager",
  "name": "Password Manager",
  "description": "Bitwarden-synced vault with Tailscale VPN",
  "port": 8080,
  "privateUrl": "http://[your-mac-hostname].[tailnet]:8080",
  "funnelEnabled": false,
  "publicUrl": null,
  "icon": "🔐",
  "category": "Security",
  "addedDate": "[today]"
}
```

## Reservations

- **Port:** `8080` (reserved for this app on the tailnet host).
- **Category:** `Security`.
- **Access:** tailnet/MagicDNS only.

## Health endpoint standard

If/when this app exposes a web surface that the hub monitors, it must implement
the hub's standard health endpoint so the dashboard's monitor can ping it:

```js
// Standard hub health endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: "password-manager",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});
```

The hub health-checks `privateUrl` every 30 s and treats HTTP `200–399` as
online.
