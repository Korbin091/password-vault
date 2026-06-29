// Background service worker (MV3). The single source of truth for vault state.
// Owns: message routing for popup + content script, and the inactivity auto-lock
// timer via chrome.alarms.

import * as vault from "./vault.js";

const AUTO_LOCK_ALARM = "auto-lock";
const AUTO_LOCK_MINUTES = 15; // see ../docs/security-model.md

async function armAutoLock() {
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
  chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: AUTO_LOCK_MINUTES });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) {
    await vault.lock();
    // TODO(Phase 4): if a Tailscale proxy is active, clear it here too.
  }
});

// Any interaction reschedules the lock timer while unlocked.
async function touch() {
  const { unlocked } = await vault.getState();
  if (unlocked) await armAutoLock();
}

const handlers = {
  async getState() { return { ok: true, ...(await vault.getState()) }; },

  async unlock({ masterPassword }) {
    const res = await vault.unlock(masterPassword);
    if (res.ok) await armAutoLock();
    return res;
  },

  async lock() { await vault.lock(); await chrome.alarms.clear(AUTO_LOCK_ALARM); return { ok: true }; },

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
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) { sendResponse({ ok: false, error: `Unknown message: ${msg?.type}` }); return false; }
  // Reschedule auto-lock on every authenticated interaction (except state polls).
  if (msg.type !== "getState") touch();
  handler(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
  return true; // async response
});
