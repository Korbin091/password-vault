// Background service worker (MV3). The single source of truth for vault state.
// Owns: message routing for popup + content script, and the inactivity auto-lock
// timer via chrome.alarms.

import * as vault from "./vault.js";

// Open the side panel when the toolbar icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const AUTO_LOCK_ALARM = "auto-lock";
const SYNC_ALARM = "periodic-sync";
const SYNC_MINUTES = 5;

async function armAutoLock() {
  const minutes = await vault.getLockMinutes();
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
  if (minutes === 0) return; // "never" option
  chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: minutes });
}

async function armPeriodicSync() {
  await chrome.alarms.clear(SYNC_ALARM);
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_MINUTES });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) {
    await vault.lock();
    await chrome.alarms.clear(SYNC_ALARM);
  } else if (alarm.name === SYNC_ALARM) {
    const { unlocked, demo } = await vault.getState();
    if (unlocked && !demo) await vault.sync().catch(() => {});
  }
});

// Keyboard shortcut: Ctrl+Shift+L / Cmd+Shift+L opens side panel
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "open-vault") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
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
    if (res.ok) { await armAutoLock(); await armPeriodicSync(); }
    return res;
  },

  async lock() {
    await vault.lock();
    await chrome.alarms.clear(AUTO_LOCK_ALARM);
    await chrome.alarms.clear(SYNC_ALARM);
    return { ok: true };
  },

  async sync() { return vault.sync(); },

  async getConfig() {
    const c = await vault.getConfig();
    return {
      ok: true,
      config: {
        clientId: c.clientId || "",
        email: c.email || "",
        server: c.server || "",
        lockMinutes: c.lockMinutes ?? 15,
        hasSecret: !!c.clientSecret,
      },
    };
  },

  async saveConfig({ config }) { await vault.saveConfig(config); return { ok: true }; },

  async listItems({ category, query }) {
    try { return { ok: true, items: await vault.listItems({ category, query }) }; }
    catch (e) { return { ok: false, error: e.message }; }
  },

  async getRecentItems() {
    try { return { ok: true, items: await vault.getRecentItems() }; }
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

  async updateItem({ id, item }) {
    try { return { ok: true, item: await vault.updateItem(id, item) }; }
    catch (e) { return { ok: false, error: e.message }; }
  },

  async deleteItem({ id }) {
    try { await vault.deleteItem(id); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // FAB button in content script asks us to open the side panel
  if (msg?.type === "openSidePanel") {
    if (sender.tab?.id) {
      chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
    }
    sendResponse({ ok: true });
    return false;
  }
  const handler = handlers[msg?.type];
  if (!handler) { sendResponse({ ok: false, error: `Unknown message: ${msg?.type}` }); return false; }
  if (msg.type !== "getState") touch();
  handler(msg, sender).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
  return true;
});
