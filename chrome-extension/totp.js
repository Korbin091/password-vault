// RFC 6238 TOTP (SHA-1, 30-second step, 6 digits).
// Handles both raw base32 secrets and otpauth:// URIs stored by Bitwarden.

export async function generateTotp(rawSecret) {
  const secret = parseSecret(rawSecret);
  if (!secret) return null;
  const key = base32Decode(secret);
  if (!key.length) return null;
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / 30);
  const remaining = 30 - (epoch % 30);
  const code = await hotp(key, counter);
  return { code, remaining };
}

function parseSecret(raw) {
  if (!raw) return null;
  raw = raw.trim();
  if (raw.startsWith("otpauth://")) {
    try { return new URL(raw).searchParams.get("secret") || null; }
    catch { return null; }
  }
  return raw.toUpperCase().replace(/[\s=]/g, "") || null;
}

function base32Decode(str) {
  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, val = 0;
  const out = [];
  for (const c of str) {
    const idx = CHARS.indexOf(c);
    if (idx < 0) continue;
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

async function hotp(keyBytes, counter) {
  const msg = new Uint8Array(8);
  let c = BigInt(counter);
  for (let i = 7; i >= 0; i--) { msg[i] = Number(c & 0xffn); c >>= 8n; }
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, msg));
  const offset = sig[19] & 0xf;
  const code = (
    ((sig[offset] & 0x7f) << 24) | (sig[offset + 1] << 16) |
    (sig[offset + 2] << 8) | sig[offset + 3]
  ) % 1_000_000;
  return code.toString().padStart(6, "0");
}
