// Tests the live decrypt pipeline (bitwarden.js) end-to-end against synthetic,
// locally-constructed encrypted data — no network. Builds a protected user key
// and an encrypted cipher exactly as Bitwarden would, then verifies the client
// derives the key and decrypts the vault back to plaintext.
//
// Run: node test/bitwarden.test.mjs

import {
  makeMasterKey, stretchMasterKey, encryptEncString, encryptField,
} from "../crypto.js";
import { deriveUserKey, decryptVault, resolveUrls } from "../bitwarden.js";

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error("✗ FAIL:", msg); process.exit(1); }
  passed++; console.log("✓", msg);
}

// URL resolution: cloud vs self-host.
ok(resolveUrls({}).api === "https://api.bitwarden.com", "cloud API URL by default");
ok(resolveUrls({ server: "http://host:8080/" }).identity === "http://host:8080/identity",
   "self-host identity URL derived from config.server");

// ── Build a synthetic account exactly like Bitwarden's key hierarchy ──
const email = "user@example.com";
const masterPassword = "correct horse battery staple";
const iterations = 100000; // smaller for a fast test

const masterKey = await makeMasterKey(masterPassword, email, iterations);
const stretched = await stretchMasterKey(masterKey);

// The real user (symmetric) key: 64 random bytes = enc(32) || mac(32).
const userEnc = crypto.getRandomValues(new Uint8Array(32));
const userMac = crypto.getRandomValues(new Uint8Array(32));
const userKey = { encKey: userEnc, macKey: userMac };
const rawUserKey = new Uint8Array(64); rawUserKey.set(userEnc, 0); rawUserKey.set(userMac, 32);

// Protected user key = userKey encrypted under the stretched master key.
const protectedKey = await encryptEncString(rawUserKey, stretched.encKey, stretched.macKey);

// Derive it back from the master password — must reconstruct the same userKey.
const derived = await deriveUserKey({ email, masterPassword, kdf: 0, iterations, protectedKey });
ok(derived.encKey.length === 32 && derived.macKey.length === 32, "derived user key has correct shape");
ok([...derived.encKey].every((b, i) => b === userEnc[i]), "derived encKey matches original");
ok([...derived.macKey].every((b, i) => b === userMac[i]), "derived macKey matches original");

// Build an encrypted login cipher with the user key.
const sync = {
  profile: { key: protectedKey },
  ciphers: [
    {
      id: "abc-123", type: 1, favorite: true, revisionDate: "2026-06-20T00:00:00Z",
      name: await encryptField("GitHub", userKey),
      notes: await encryptField("2fa in authenticator", userKey),
      login: {
        username: await encryptField("octocat", userKey),
        password: await encryptField("s3cr3t-token", userKey),
        uris: [{ uri: await encryptField("https://github.com", userKey) }],
      },
    },
    { id: "deleted-1", type: 1, deletedDate: "2026-06-01T00:00:00Z", name: await encryptField("Trashed", userKey) },
  ],
};

const items = await decryptVault(sync, derived);
ok(items.length === 1, "deleted ciphers are excluded from the decrypted vault");

const it = items[0];
ok(it.name === "GitHub", "cipher name decrypts");
ok(it.username === "octocat", "login username decrypts");
ok(it.password === "s3cr3t-token", "login password decrypts");
ok(it.uris[0] === "https://github.com", "login URI decrypts");
ok(it.notes === "2fa in authenticator", "notes decrypt");
ok(it.type === "login" && it.favorite === true, "type + favorite mapped correctly");

// Wrong master password must fail to derive the key (MAC mismatch).
let wrongFailed = false;
try {
  await deriveUserKey({ email, masterPassword: "wrong", kdf: 0, iterations, protectedKey });
} catch { wrongFailed = true; }
ok(wrongFailed, "wrong master password is rejected (MAC verification)");

// Argon2id accounts fail safe with a clear error.
let argonRejected = false;
try {
  await deriveUserKey({ email, masterPassword, kdf: 1, iterations, protectedKey });
} catch (e) { argonRejected = /Argon2id/.test(e.message); }
ok(argonRejected, "Argon2id KDF fails safe with a clear message");

console.log(`\nAll ${passed} bitwarden pipeline checks passed.`);
