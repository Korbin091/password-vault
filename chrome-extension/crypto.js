// Bitwarden-compatible crypto, implemented on the Web Crypto API.
//
// Reference: Bitwarden security whitepaper / cipher format.
//   masterKey            = PBKDF2-SHA256(password, salt=email, iterations)         (32 bytes)
//   masterPasswordHash   = PBKDF2-SHA256(masterKey, salt=password, 1)              (auth proof)
//   stretchedMasterKey   = HKDF-Expand(masterKey): enc(32) || mac(32)
//   userKey (symmetric)  = decrypt(protectedUserKey EncString, stretchedEnc/mac)   (64 bytes)
//   each field           = decrypt(field EncString, userEnc/userMac)
//
// EncString type 2 (AesCbc256_HmacSha256_B64): "2.<ivB64>|<ctB64>|<macB64>"
//
// NOTE: This module is hand-rolled, security-sensitive code. It is unit-tested
// against published PBKDF2-HMAC-SHA256 vectors (see test/crypto.test.mjs) and
// must not be modified without re-running those tests. Whether we ultimately
// ship this or the official Bitwarden SDK is tracked in ADR 0001.

const enc = new TextEncoder();
const subtle = crypto.subtle;

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const bytesToHex = (bytes) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** PBKDF2-HMAC-SHA256 -> raw bytes. */
export async function pbkdf2(password, salt, iterations, lengthBytes = 32) {
  const baseKey = await subtle.importKey(
    "raw", typeof password === "string" ? enc.encode(password) : password,
    "PBKDF2", false, ["deriveBits"]
  );
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", salt: typeof salt === "string" ? enc.encode(salt) : salt,
      iterations, hash: "SHA-256" },
    baseKey, lengthBytes * 8
  );
  return new Uint8Array(bits);
}

/** Master key from the user's password + email (lowercased/trimmed). */
export async function makeMasterKey(password, email, iterations) {
  return pbkdf2(password, email.trim().toLowerCase(), iterations, 32);
}

/** Auth proof sent to the server — never reveals the password or master key. */
export async function makeMasterPasswordHash(masterKey, password) {
  const hash = await pbkdf2(masterKey, password, 1, 32);
  return bytesToB64(hash);
}

/** HKDF-Expand (RFC 5869) using HMAC-SHA256. Bitwarden expands the master key
 *  directly (PRK = masterKey), so we do expand-only, not extract+expand. */
async function hkdfExpand(prk, info, lengthBytes) {
  const key = await subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const infoBytes = enc.encode(info);
  const out = new Uint8Array(lengthBytes);
  let t = new Uint8Array(0);
  let pos = 0;
  for (let i = 1; pos < lengthBytes; i++) {
    const input = new Uint8Array(t.length + infoBytes.length + 1);
    input.set(t, 0); input.set(infoBytes, t.length); input[input.length - 1] = i;
    t = new Uint8Array(await subtle.sign("HMAC", key, input));
    out.set(t.subarray(0, Math.min(t.length, lengthBytes - pos)), pos);
    pos += t.length;
  }
  return out;
}

/** Stretch the master key into separate encryption + MAC keys (32 bytes each). */
export async function stretchMasterKey(masterKey) {
  return {
    encKey: await hkdfExpand(masterKey, "enc", 32),
    macKey: await hkdfExpand(masterKey, "mac", 32),
  };
}

/** Parse an EncString. Only type 2 (AesCbc256_HmacSha256_B64) is supported. */
export function parseEncString(s) {
  const dot = s.indexOf(".");
  const type = Number(s.slice(0, dot));
  if (type !== 2) throw new Error(`Unsupported EncString type ${type}`);
  const [ivB64, ctB64, macB64] = s.slice(dot + 1).split("|");
  return { iv: b64ToBytes(ivB64), ct: b64ToBytes(ctB64), mac: b64ToBytes(macB64) };
}

/** Constant-time-ish comparison of two byte arrays. */
function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Decrypt a type-2 EncString. Verifies HMAC over (iv || ct) before decrypting. */
export async function decryptEncString(encString, encKey, macKey) {
  const { iv, ct, mac } = parseEncString(encString);

  const macCryptoKey = await subtle.importKey("raw", macKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const data = new Uint8Array(iv.length + ct.length);
  data.set(iv, 0); data.set(ct, iv.length);
  const computed = new Uint8Array(await subtle.sign("HMAC", macCryptoKey, data));
  if (!bytesEqual(computed, mac)) throw new Error("MAC verification failed — wrong key or tampered data.");

  const aesKey = await subtle.importKey("raw", encKey, { name: "AES-CBC" }, false, ["decrypt"]);
  const plain = await subtle.decrypt({ name: "AES-CBC", iv }, aesKey, ct);
  return new Uint8Array(plain);
}

/**
 * Decrypt the protected user (symmetric) key with the stretched master key,
 * yielding the 64-byte key split into enc(32) + mac(32) used for vault items.
 */
export async function decryptUserKey(protectedUserKey, stretched) {
  const raw = await decryptEncString(protectedUserKey, stretched.encKey, stretched.macKey);
  if (raw.length !== 64) throw new Error(`Unexpected user key length ${raw.length}`);
  return { encKey: raw.slice(0, 32), macKey: raw.slice(32, 64) };
}

/** Decrypt a field EncString to a UTF-8 string using the user key. */
export async function decryptField(encString, userKey) {
  const bytes = await decryptEncString(encString, userKey.encKey, userKey.macKey);
  return new TextDecoder().decode(bytes);
}

/** Encrypt bytes into a type-2 EncString "2.<ivB64>|<ctB64>|<macB64>". */
export async function encryptEncString(plainBytes, encKey, macKey) {
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await subtle.importKey("raw", encKey, { name: "AES-CBC" }, false, ["encrypt"]);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-CBC", iv }, aesKey, plainBytes));

  const macCryptoKey = await subtle.importKey("raw", macKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const data = new Uint8Array(iv.length + ct.length);
  data.set(iv, 0); data.set(ct, iv.length);
  const mac = new Uint8Array(await subtle.sign("HMAC", macCryptoKey, data));

  return `2.${bytesToB64(iv)}|${bytesToB64(ct)}|${bytesToB64(mac)}`;
}

/** Encrypt a UTF-8 string into an EncString using the user key. */
export async function encryptField(text, userKey) {
  return encryptEncString(enc.encode(text), userKey.encKey, userKey.macKey);
}

export const _internal = { bytesToHex, bytesToB64, b64ToBytes };
