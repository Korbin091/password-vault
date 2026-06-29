// Web-demo shim. Lets the unmodified popup run as a plain web page (e.g. on
// GitHub Pages) by providing a minimal `chrome.runtime.sendMessage` that routes
// straight to the in-page vault service. Demo mode only — there is no service
// worker, no chrome.storage (storage.js falls back to in-memory), and live
// Bitwarden sync is intentionally unavailable here (it requires the installed
// extension's host permissions). This mirrors background.js's message handlers.

import * as vault from "./vault.js";

const handlers = {
  async getState() { return { ok: true, ...(await vault.getState()) }; },
  async unlock({ masterPassword }) { return vault.unlock(masterPassword); },
  async lock() { await vault.lock(); return { ok: true }; },
  async listItems({ category, query }) {
    try { return { ok: true, items: await vault.listItems({ category, query }) }; }
    catch (e) { return { ok: false, error: e.message }; }
  },
  async getItem({ id }) {
    try { return { ok: true, item: await vault.getItem(id) }; }
    catch (e) { return { ok: false, error: e.message }; }
  },
  async getMatches({ url }) {
    try { return { ok: true, matches: await vault.getMatches(url) }; }
    catch (e) { return { ok: false, error: e.message }; }
  },
  async addItem({ item }) {
    try { return { ok: true, item: await vault.addItem(item) }; }
    catch (e) { return { ok: false, error: e.message }; }
  },
  async sync() { return vault.sync(); },
  async getConfig() {
    const c = await vault.getConfig();
    return { ok: true, config: { clientId: c.clientId || "", email: c.email || "", server: c.server || "", hasSecret: !!c.clientSecret } };
  },
  // Live sync is disabled in the web demo; saving config is a no-op.
  async saveConfig() { return { ok: true }; },
};

const runtime = {
  sendMessage(msg, cb) {
    const h = handlers[msg?.type];
    const p = h ? h(msg) : Promise.resolve({ ok: false, error: `Unknown message: ${msg?.type}` });
    p.then((r) => typeof cb === "function" && cb(r))
     .catch((e) => typeof cb === "function" && cb({ ok: false, error: e.message }));
    return true;
  },
};

globalThis.chrome = Object.assign(globalThis.chrome || {}, { runtime });
