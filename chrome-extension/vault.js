// Vault service — the single source of truth the popup and content script talk
// to (via the background worker's message router). It is storage-backed so it
// survives service-worker restarts within a browser session.
//
// MODES
//   - demo  : no credentials present -> serves bundled DEMO items so the whole
//             UI is usable/testable without a Bitwarden account. NEVER writes
//             anything real; clearly flagged in the UI.
//   - live  : credentials present -> delegates to ./bitwarden.js for auth, sync,
//             decrypt, and CRUD. Wired once the backend + crypto decision lands
//             (see ../docs/decisions/0001-extension-crypto.md).

import { session, local } from "./storage.js";
import { _internal } from "./crypto.js";
import * as bw from "./bitwarden.js";

const SESSION_VAULT = "vault.items";     // decrypted items, session-only
const SESSION_UNLOCKED = "vault.unlocked";
const SESSION_LASTSYNC = "vault.lastSync";
const SESSION_USERKEY = "vault.userKey";  // {encKey,macKey} base64 — session-only
const SESSION_TOKEN = "vault.token";      // access token — session-only

const { bytesToB64, b64ToBytes } = _internal;

/** Read the stored (non-secret) credentials/config. */
export async function getConfig() { return (await local.get("config")) || {}; }

/**
 * Persist credentials/config. (clientSecret is sensitive; stored in
 * chrome.storage.local.) If `clientSecret` is omitted from `cfg`, the existing
 * stored secret is preserved (so the UI can leave the field blank).
 */
export async function saveConfig(cfg) {
  const existing = await getConfig();
  const hasSecret = Object.prototype.hasOwnProperty.call(cfg, "clientSecret");
  const clean = {
    clientId: (cfg.clientId || "").trim(),
    clientSecret: hasSecret ? (cfg.clientSecret || "").trim() : (existing.clientSecret || ""),
    email: (cfg.email || "").trim(),
    server: (cfg.server || "").trim() || null,
  };
  await local.set("config", clean);
  return clean;
}

const DEMO_ITEMS = [
  {
    id: "demo-1", type: "login", name: "GitHub",
    username: "octocat@example.com", password: "demo-not-a-real-password",
    uris: ["https://github.com"], notes: "", favorite: true,
    revisionDate: "2026-06-01T10:00:00Z",
  },
  {
    id: "demo-2", type: "login", name: "Gmail",
    username: "me@example.com", password: "demo-also-fake-1234",
    uris: ["https://accounts.google.com", "https://mail.google.com"], notes: "",
    favorite: false, revisionDate: "2026-06-10T08:30:00Z",
  },
  {
    id: "demo-3", type: "card", name: "Visa •••• 4242",
    card: { number: "4242424242424242", brand: "Visa", exp: "12/29", code: "123" },
    notes: "Demo card", favorite: false, revisionDate: "2026-05-20T12:00:00Z",
  },
  {
    id: "demo-4", type: "note", name: "Recovery codes",
    notes: "DEMO secure note — backup codes would live here.",
    favorite: false, revisionDate: "2026-04-15T09:00:00Z",
  },
];

/** True when no real credentials are configured (demo mode). */
export async function isDemo() {
  const cfg = (await local.get("config")) || {};
  return !(cfg.clientId && cfg.clientSecret && cfg.email);
}

export async function getState() {
  return {
    unlocked: (await session.get(SESSION_UNLOCKED)) === true,
    demo: await isDemo(),
    lastSync: (await session.get(SESSION_LASTSYNC)) || null,
  };
}

/** Unlock with the master password. Returns { ok, error? }. */
export async function unlock(masterPassword) {
  if (!masterPassword) return { ok: false, error: "Master password required." };

  if (await isDemo()) {
    await session.set(SESSION_VAULT, DEMO_ITEMS);
    await session.set(SESSION_UNLOCKED, true);
    await session.set(SESSION_LASTSYNC, new Date().toISOString());
    return { ok: true, demo: true };
  }

  // LIVE MODE
  try {
    const config = await getConfig();
    const { items, token, userKey } = await bw.unlockAndSync(masterPassword, config);
    await session.set(SESSION_VAULT, items);
    await session.set(SESSION_USERKEY, { encKey: bytesToB64(userKey.encKey), macKey: bytesToB64(userKey.macKey) });
    await session.set(SESSION_TOKEN, token);
    await session.set(SESSION_UNLOCKED, true);
    await session.set(SESSION_LASTSYNC, new Date().toISOString());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || "Unlock failed." };
  }
}

/** Re-pull and decrypt the vault while unlocked (live mode only). */
export async function sync() {
  if (await isDemo()) return { ok: true, demo: true };
  if ((await session.get(SESSION_UNLOCKED)) !== true) return { ok: false, error: "locked" };
  try {
    const config = await getConfig();
    const token = await session.get(SESSION_TOKEN);
    const stored = await session.get(SESSION_USERKEY);
    const userKey = { encKey: b64ToBytes(stored.encKey), macKey: b64ToBytes(stored.macKey) };
    const fresh = await bw.fetchSync(token, config);
    const items = await bw.decryptVault(fresh, userKey);
    await session.set(SESSION_VAULT, items);
    await session.set(SESSION_LASTSYNC, new Date().toISOString());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function lock() {
  await session.remove(SESSION_VAULT);
  await session.remove(SESSION_UNLOCKED);
  await session.remove(SESSION_USERKEY);
  await session.remove(SESSION_TOKEN);
}

async function requireUnlocked() {
  if ((await session.get(SESSION_UNLOCKED)) !== true) throw new Error("Vault is locked.");
  return (await session.get(SESSION_VAULT)) || [];
}

/** List items, optionally filtered by category ('all'|'login'|'card'|'note') and query. */
export async function listItems({ category = "all", query = "" } = {}) {
  const items = await requireUnlocked();
  const q = query.trim().toLowerCase();
  return items.filter((it) => {
    if (category !== "all" && it.type !== category) return false;
    if (!q) return true;
    return [it.name, it.username, ...(it.uris || [])]
      .filter(Boolean).some((s) => s.toLowerCase().includes(q));
  });
}

export async function getItem(id) {
  const items = await requireUnlocked();
  return items.find((it) => it.id === id) || null;
}

/** Logins whose URIs match the given page URL's host (for auto-fill). */
export async function getMatches(pageUrl) {
  let host;
  try { host = new URL(pageUrl).host; } catch { return []; }
  const items = await requireUnlocked();
  return items
    .filter((it) => it.type === "login" && (it.uris || []).some((u) => {
      try { return new URL(u).host === host; } catch { return false; }
    }))
    .map(({ id, name, username, password }) => ({ id, name, username, password }));
}

/** Add a new item. In demo mode it persists only to the session cache. */
export async function addItem(partial) {
  const items = await requireUnlocked();
  const item = {
    id: `local-${Date.now()}`,
    type: "login",
    favorite: false,
    revisionDate: new Date().toISOString(),
    ...partial,
  };
  if (!item.name) throw new Error("Name is required.");

  if (!(await isDemo())) {
    // LIVE MODE: encrypt + POST, then use the server's canonical cipher id/date.
    const config = await getConfig();
    const token = await session.get(SESSION_TOKEN);
    const stored = await session.get(SESSION_USERKEY);
    const userKey = { encKey: b64ToBytes(stored.encKey), macKey: b64ToBytes(stored.macKey) };
    const created = await bw.createLogin(item, userKey, token, config);
    item.id = created.id || created.Id || item.id;
    item.revisionDate = created.revisionDate || created.RevisionDate || item.revisionDate;
  }

  items.unshift(item);
  await session.set(SESSION_VAULT, items);
  return item;
}

async function liveContext() {
  const config = await getConfig();
  const token = await session.get(SESSION_TOKEN);
  const stored = await session.get(SESSION_USERKEY);
  const userKey = { encKey: b64ToBytes(stored.encKey), macKey: b64ToBytes(stored.macKey) };
  return { bw, config, token, userKey };
}

/** Update an existing item (login fields). */
export async function updateItem(id, partial) {
  const items = await requireUnlocked();
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) throw new Error("Item not found.");
  const merged = { ...items[idx], ...partial, id, revisionDate: new Date().toISOString() };
  if (!merged.name) throw new Error("Name is required.");

  if (!(await isDemo())) {
    const { bw, config, token, userKey } = await liveContext();
    const updated = await bw.updateLogin(merged, userKey, token, config);
    merged.revisionDate = updated.revisionDate || updated.RevisionDate || merged.revisionDate;
  }

  items[idx] = merged;
  await session.set(SESSION_VAULT, items);
  return merged;
}

/** Delete an item. */
export async function deleteItem(id) {
  const items = await requireUnlocked();
  if (!(await isDemo())) {
    const { bw, config, token } = await liveContext();
    await bw.deleteCipher(id, token, config);
  }
  await session.set(SESSION_VAULT, items.filter((i) => i.id !== id));
  return true;
}
