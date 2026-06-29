// Tests the vault service in demo mode (no chrome, no network — storage.js
// falls back to in-memory). Covers unlock/list/add/update/delete/getMatches.
// Run: node test/vault.test.mjs

import * as vault from "../vault.js";

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error("✗ FAIL:", msg); process.exit(1); }
  passed++; console.log("✓", msg);
}

ok((await vault.isDemo()) === true, "demo mode when no credentials configured");

// Locked by default.
let threw = false;
try { await vault.listItems(); } catch { threw = true; }
ok(threw, "listItems throws while locked");

// Unlock (demo accepts any password).
ok((await vault.unlock("anything")).ok, "unlock succeeds in demo mode");
const initial = await vault.listItems();
ok(initial.length >= 4, "demo vault has sample items");

// Add.
const added = await vault.addItem({ name: "ExampleApp", username: "u", password: "p", uris: ["https://example.com"] });
ok(added.id.startsWith("local-"), "addItem returns a local id in demo mode");
ok((await vault.listItems({ query: "exampleapp" })).length === 1, "added item is searchable");

// getMatches by host.
const matches = await vault.getMatches("https://example.com/login");
ok(matches.length === 1 && matches[0].username === "u", "getMatches finds the added login by host");

// Update.
const updated = await vault.updateItem(added.id, { username: "u2", password: "p2" });
ok(updated.username === "u2", "updateItem changes fields");
ok((await vault.getItem(added.id)).username === "u2", "update persists");

// Delete.
await vault.deleteItem(added.id);
ok((await vault.getItem(added.id)) === null, "deleteItem removes the item");

// Category filter.
const cards = await vault.listItems({ category: "card" });
ok(cards.every((i) => i.type === "card"), "category filter returns only that type");

// Lock clears the vault.
await vault.lock();
let lockedAfter = false;
try { await vault.listItems(); } catch { lockedAfter = true; }
ok(lockedAfter, "lock() re-locks the vault");

console.log(`\nAll ${passed} vault checks passed.`);
