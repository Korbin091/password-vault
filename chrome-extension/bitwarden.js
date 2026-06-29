// Live Bitwarden client: API-key auth, sync, and the decrypt pipeline that turns
// encrypted ciphers into our shared vault-item model. Works against Bitwarden
// cloud or a self-hosted Vaultwarden (base URL chosen by config.server).
//
// Crypto is delegated to ./crypto.js. Today only the PBKDF2 KDF is supported;
// an Argon2id account fails safe with a clear error (see ADR 0001). The crypto
// implementation is intentionally pluggable so B1/B2 can be swapped later.

import {
  makeMasterKey, stretchMasterKey, decryptUserKey,
  decryptField, encryptField,
} from "./crypto.js";

const KDF_PBKDF2 = 0;
const KDF_ARGON2ID = 1;

// Bitwarden cipher.type -> our item.type
const CIPHER_TYPE = { 1: "login", 2: "note", 3: "card" };

/** Resolve identity + api base URLs from config. */
export function resolveUrls(config) {
  if (config.server) {
    const base = config.server.replace(/\/+$/, "");
    return { identity: `${base}/identity`, api: `${base}/api` };
  }
  return { identity: "https://identity.bitwarden.com", api: "https://api.bitwarden.com" };
}

async function postForm(url, params) {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}: ${await res.text().catch(() => "")}`);
  return res.json();
}

/** KDF parameters for an account (type + iterations). */
export async function prelogin(config) {
  const { api } = resolveUrls(config);
  const res = await fetch(`${api}/accounts/prelogin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: config.email }),
  });
  if (!res.ok) throw new Error(`prelogin failed: HTTP ${res.status}`);
  const j = await res.json();
  return {
    kdf: j.kdf ?? j.Kdf ?? KDF_PBKDF2,
    iterations: j.kdfIterations ?? j.KdfIterations ?? 600000,
  };
}

/** Authenticate with the personal API key (client_credentials grant). */
export async function getToken(config) {
  const { identity } = resolveUrls(config);
  const deviceId = (globalThis.crypto?.randomUUID?.() || "00000000-0000-0000-0000-000000000000");
  const tok = await postForm(`${identity}/connect/token`, {
    grant_type: "client_credentials",
    scope: "api",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    deviceType: 2,
    deviceIdentifier: deviceId,
    deviceName: "password-vault-extension",
  });
  return tok.access_token;
}

/** Pull the full encrypted vault. */
export async function fetchSync(token, config) {
  const { api } = resolveUrls(config);
  const res = await fetch(`${api}/sync?excludeDomains=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`sync failed: HTTP ${res.status}`);
  return res.json();
}

/**
 * Derive the user (symmetric) key from the master password + the account's
 * protected key. PBKDF2 only for now.
 */
export async function deriveUserKey({ email, masterPassword, kdf, iterations, protectedKey }) {
  if (kdf === KDF_ARGON2ID) {
    throw new Error("This account uses the Argon2id KDF, which isn't supported yet (see ADR 0001).");
  }
  if (kdf !== KDF_PBKDF2) throw new Error(`Unsupported KDF type ${kdf}.`);
  const masterKey = await makeMasterKey(masterPassword, email, iterations);
  const stretched = await stretchMasterKey(masterKey);
  return decryptUserKey(protectedKey, stretched);
}

const dec = async (encString, userKey) => (encString ? decryptField(encString, userKey) : "");

/** Decrypt one cipher into our shared item model. */
export async function decryptCipher(cipher, userKey) {
  const type = CIPHER_TYPE[cipher.type] || "note";
  const item = {
    id: cipher.id,
    type,
    name: await dec(cipher.name, userKey),
    favorite: !!cipher.favorite,
    notes: await dec(cipher.notes, userKey),
    revisionDate: cipher.revisionDate,
  };
  if (type === "login" && cipher.login) {
    item.username = await dec(cipher.login.username, userKey);
    item.password = await dec(cipher.login.password, userKey);
    item.uris = [];
    for (const u of cipher.login.uris || []) item.uris.push(await dec(u.uri, userKey));
  } else if (type === "card" && cipher.card) {
    item.card = {
      number: await dec(cipher.card.number, userKey),
      brand: await dec(cipher.card.brand, userKey),
      exp: [await dec(cipher.card.expMonth, userKey), await dec(cipher.card.expYear, userKey)]
        .filter(Boolean).join("/"),
      code: await dec(cipher.card.code, userKey),
    };
  }
  return item;
}

/** Decrypt an entire sync payload into a list of items. */
export async function decryptVault(sync, userKey) {
  const ciphers = sync.ciphers || sync.Ciphers || [];
  const items = [];
  for (const c of ciphers) {
    if (c.deletedDate) continue;
    items.push(await decryptCipher(c, userKey));
  }
  return items;
}

/** Full unlock: auth -> sync -> derive key -> decrypt. Returns { items, userKey }. */
export async function unlockAndSync(masterPassword, config) {
  const { kdf, iterations } = await prelogin(config);
  const token = await getToken(config);
  const sync = await fetchSync(token, config);
  const protectedKey = sync.profile?.key || sync.Profile?.Key;
  if (!protectedKey) throw new Error("Sync response missing the protected user key.");
  const userKey = await deriveUserKey({ email: config.email, masterPassword, kdf, iterations, protectedKey });
  const items = await decryptVault(sync, userKey);
  return { items, token, userKey };
}

/** Encrypt a login item into a Bitwarden cipher payload. */
async function buildLoginPayload(item, userKey) {
  return {
    type: 1,
    name: await encryptField(item.name, userKey),
    notes: item.notes ? await encryptField(item.notes, userKey) : null,
    favorite: !!item.favorite,
    login: {
      username: item.username ? await encryptField(item.username, userKey) : null,
      password: item.password ? await encryptField(item.password, userKey) : null,
      uris: await Promise.all((item.uris || []).filter(Boolean).map(async (u) => ({
        uri: await encryptField(u, userKey), match: null,
      }))),
    },
  };
}

/** Encrypt + create a new login cipher. Returns the server cipher. */
export async function createLogin(item, userKey, token, config) {
  const { api } = resolveUrls(config);
  const res = await fetch(`${api}/ciphers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(await buildLoginPayload(item, userKey)),
  });
  if (!res.ok) throw new Error(`create failed: HTTP ${res.status}`);
  return res.json();
}

/** Encrypt + update an existing login cipher. Returns the server cipher. */
export async function updateLogin(item, userKey, token, config) {
  const { api } = resolveUrls(config);
  const res = await fetch(`${api}/ciphers/${item.id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(await buildLoginPayload(item, userKey)),
  });
  if (!res.ok) throw new Error(`update failed: HTTP ${res.status}`);
  return res.json();
}

/** Delete a cipher. Treats 404 as already-gone. */
export async function deleteCipher(id, token, config) {
  const { api } = resolveUrls(config);
  const res = await fetch(`${api}/ciphers/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`delete failed: HTTP ${res.status}`);
  return true;
}
