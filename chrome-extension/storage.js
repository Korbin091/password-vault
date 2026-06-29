// Thin wrappers over chrome.storage with an in-memory fallback so the modules
// can also be unit-tested in plain Node (where `chrome` is undefined).
//
// Storage policy (see ../docs/security-model.md):
//   - session  -> chrome.storage.session : cleared when the browser closes.
//                 Holds the derived session key + unlocked-vault cache.
//   - local    -> chrome.storage.local   : persists across restarts.
//                 Holds encrypted vault blob + non-secret config (proxy IP, etc).

const hasChrome = typeof chrome !== "undefined" && chrome.storage;

function memArea() {
  const map = new Map();
  return {
    async get(keys) {
      const out = {};
      const list = keys == null ? [...map.keys()] : [].concat(keys);
      for (const k of list) if (map.has(k)) out[k] = map.get(k);
      return out;
    },
    async set(obj) { for (const [k, v] of Object.entries(obj)) map.set(k, v); },
    async remove(keys) { for (const k of [].concat(keys)) map.delete(k); },
    async clear() { map.clear(); },
  };
}

const _memSession = memArea();
const _memLocal = memArea();

function area(name) {
  if (hasChrome && chrome.storage[name]) {
    const a = chrome.storage[name];
    return {
      get: (keys) => a.get(keys ?? null),
      set: (obj) => a.set(obj),
      remove: (keys) => a.remove(keys),
      clear: () => a.clear(),
    };
  }
  return name === "session" ? _memSession : _memLocal;
}

export const session = {
  get: async (k) => (await area("session").get(k))[k],
  set: (k, v) => area("session").set({ [k]: v }),
  remove: (k) => area("session").remove(k),
  clear: () => area("session").clear(),
};

export const local = {
  get: async (k) => (await area("local").get(k))[k],
  set: (k, v) => area("local").set({ [k]: v }),
  remove: (k) => area("local").remove(k),
  clear: () => area("local").clear(),
};
