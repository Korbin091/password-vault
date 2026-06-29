# Troubleshooting Playbook

Targeted follow-up prompts from the framework, kept here for use during each
phase. Paste the relevant one (with the real error) when a step gets stuck.

## Bitwarden / sync

- **Auth fails:** "Fix the Bitwarden authentication. Error: [paste]. Use the
  `/identity/connect/token` endpoint with `client_credentials` grant type."
- **Sync conflict between devices:** "Add conflict resolution: if the same item
  was edited on both devices, keep the most recently modified version using the
  `revisionDate` field."

## iPhone app

- **Face ID not triggering:** "The `LAContext.evaluatePolicy` call is not showing
  the Face ID prompt. Fix the `LocalAuthentication` implementation in
  `AuthViewModel.swift`."
- **Xcode signing error:** "Fix the code signing error: [paste]. Set up automatic
  signing with my Apple ID and use a personal team for development."

## Chrome extension

- **Auto-fill not detecting fields:** "The content script is not detecting the
  username field on [URL]. Update the field-detection logic to handle this site's
  DOM structure."
- **Extension loses session on restart:** "Implement persistent session using
  `chrome.storage.local` with an expiry timestamp."

## Tailscale VPN

- **iOS permission dialog never appears:** "`NEVPNManager.saveToPreferences` is
  not triggering the iOS VPN permission dialog. Check entitlements and fix the
  permission request in `TailscaleManager.swift`."
- **Connected but traffic not routing (iOS):** "Check `NEPacketTunnelProvider`
  config and ensure the IPv4 default route `0.0.0.0/0` is in `includedRoutes`."
- **Chrome proxy has no effect:** "Switch from `fixed_servers` to a PAC script
  that routes all traffic through SOCKS5 at `[IP]:1055`."
- **Auth key rejected (401):** "Confirm the key is read from Keychain correctly.
  Auth keys expire after 90 days — generate a reusable key in the Tailscale admin."
- **Device list empty:** "Fetch peer list from
  `GET https://api.tailscale.com/api/v2/tailnet/-/devices` with Bearer auth using
  the API key from Keychain."
- **VPN drops on background (iOS):** "Add an `NEVPNManager` on-demand rule to keep
  the tunnel alive and reconnect automatically."
