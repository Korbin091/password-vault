// Self-contained tests for crypto.js. Run: node test/crypto.test.mjs
// No test framework — exits non-zero on first failure.

import {
  pbkdf2, makeMasterPasswordHash, parseEncString,
  decryptEncString, _internal,
} from "../crypto.js";

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error("✗ FAIL:", msg); process.exit(1); }
  passed++; console.log("✓", msg);
}

// 1) PBKDF2-HMAC-SHA256 known-answer vector.
//    password="password", salt="salt", iter=1, dkLen=32
const v1 = _internal.bytesToHex(await pbkdf2("password", "salt", 1, 32));
ok(v1 === "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b",
   "PBKDF2-SHA256 vector (iter=1) matches RFC known answer");

//    iter=2 vector
const v2 = _internal.bytesToHex(await pbkdf2("password", "salt", 2, 32));
ok(v2 === "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43",
   "PBKDF2-SHA256 vector (iter=2) matches RFC known answer");

// 2) masterPasswordHash is deterministic base64 of the right length.
const mk = await pbkdf2("correct horse", "user@example.com", 600000, 32);
const mph = await makeMasterPasswordHash(mk, "correct horse");
ok(typeof mph === "string" && _internal.b64ToBytes(mph).length === 32,
   "masterPasswordHash produces a 32-byte base64 value");

// 3) EncString round-trip: build a type-2 EncString, then decrypt it back.
const encKey = crypto.getRandomValues(new Uint8Array(32));
const macKey = crypto.getRandomValues(new Uint8Array(32));
const iv = crypto.getRandomValues(new Uint8Array(16));
const plaintext = new TextEncoder().encode("super-secret-value-🔐");

const aesKey = await crypto.subtle.importKey("raw", encKey, { name: "AES-CBC" }, false, ["encrypt"]);
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv }, aesKey, plaintext));
const macImport = await crypto.subtle.importKey("raw", macKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const macData = new Uint8Array(iv.length + ct.length); macData.set(iv, 0); macData.set(ct, iv.length);
const mac = new Uint8Array(await crypto.subtle.sign("HMAC", macImport, macData));

const encString = `2.${_internal.bytesToB64(iv)}|${_internal.bytesToB64(ct)}|${_internal.bytesToB64(mac)}`;
ok(parseEncString(encString).iv.length === 16, "parseEncString extracts a 16-byte IV");

const decrypted = new TextDecoder().decode(await decryptEncString(encString, encKey, macKey));
ok(decrypted === "super-secret-value-🔐", "EncString decrypt round-trips the plaintext");

// 4) Tampered ciphertext must fail MAC verification.
let tamperedFailed = false;
try {
  const bad = encString.replace(/\|/, "X|"); // corrupt the ciphertext segment
  await decryptEncString(bad, encKey, macKey);
} catch { tamperedFailed = true; }
ok(tamperedFailed, "Tampered EncString is rejected by MAC verification");

// 5) Unsupported EncString type is rejected.
let typeRejected = false;
try { parseEncString("0.abc|def"); } catch { typeRejected = true; }
ok(typeRejected, "Unsupported EncString type is rejected");

console.log(`\nAll ${passed} crypto checks passed.`);
