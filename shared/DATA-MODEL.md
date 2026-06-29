# Shared Data Model

Both clients (iPhone app + Chrome extension) operate on the same vault item
shape so they stay interoperable. This mirrors the Bitwarden cipher model.

## Vault item

| Field          | Type                                  | Notes |
|----------------|---------------------------------------|-------|
| `id`           | string (uuid)                         | server-assigned |
| `type`         | enum: `login` \| `card` \| `note`     | drives which fields apply |
| `name`         | string                                | display title |
| `username`     | string (login)                        | |
| `password`     | string (login, encrypted)             | revealed on demand only |
| `uris`         | string[] (login)                      | used for auto-fill matching |
| `notes`        | string                                | secure note body / extra notes |
| `card`         | object (card type)                    | number, brand, exp, code |
| `favorite`     | bool                                  | |
| `folderId`     | string \| null                        | category grouping |
| `revisionDate` | ISO 8601 timestamp                    | **conflict-resolution key** |

## Categories (UI tabs)

`All` · `Logins` · `Cards` · `Notes` — both clients use the same set.

## Conflict resolution

**Last-write-wins by `revisionDate`.** If the same item was edited on two
devices, keep the one with the newer `revisionDate`. Implemented identically on
both clients (see `API-CONTRACT.md`).

## Auto-fill matching (extension)

Match the active page's origin against each item's `uris` (host match, with
support for `uris` that specify match strategies). On a match, offer the item's
`username` + `password` for injection.
