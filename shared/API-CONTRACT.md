# Shared API Contract

The exact Bitwarden REST surface both clients use. Works against Bitwarden cloud
or self-hosted Vaultwarden — the base URL is chosen by `BW_SERVER`.

## Base URL resolution

```
if BW_SERVER set   ->  base = BW_SERVER            (e.g. http://host:8080)
else (cloud)       ->  identity = https://identity.bitwarden.com
                       api      = https://api.bitwarden.com
```

Vaultwarden serves identity + api under the same `BW_SERVER` origin.

## 1. Authenticate — `POST /identity/connect/token`

`client_credentials` grant using the API key:

```
grant_type=client_credentials
scope=api
client_id=<BW_CLIENTID>
client_secret=<BW_CLIENTSECRET>
deviceType=<platform>
deviceIdentifier=<uuid>
deviceName=<client name>
```

Returns an access token. The **master password** is then used *locally* (PBKDF2)
to derive the symmetric key that decrypts the sync payload — it is **never** part
of any request.

## 2. Sync — `GET /api/sync`

Pulls all ciphers, folders, and the user's encrypted key material. Decrypt
locally. Cache for offline use (CoreData on iOS, `chrome.storage.local` in the
extension).

## 3. Item CRUD

- Create: `POST /api/ciphers`
- Update: `PUT /api/ciphers/{id}`
- Delete: `DELETE /api/ciphers/{id}`

All item payloads are encrypted client-side before sending.

## 4. Sync cadence

- iPhone: on launch + pull-to-refresh.
- Extension: on unlock + every 5 minutes while unlocked.

## 5. Conflict resolution

On write, compare `revisionDate`. **Last-write-wins** by newest `revisionDate`
(see `DATA-MODEL.md`).

## Decision to lock (Phase 1)

**Bitwarden SDK vs raw REST.** The official SDK wraps the crypto; the raw
endpoints above are the documented fallback. Choose one and use it consistently
across both clients.
