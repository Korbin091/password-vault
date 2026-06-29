// Password generator — fully self-contained, no backend required.
// Uses crypto.getRandomValues for unbiased, cryptographically-secure selection.

const SETS = {
  lower: "abcdefghijkmnopqrstuvwxyz",          // no 'l'
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",           // no 'I', 'O'
  numbers: "23456789",                          // no '0','1'
  symbols: "!@#$%^&*()-_=+[]{};:,.?",
};
const AMBIGUOUS_EXTRA = { lower: "l", upper: "IO", numbers: "01", symbols: "" };

export const DEFAULT_OPTIONS = {
  length: 20,
  lower: true,
  upper: true,
  numbers: true,
  symbols: true,
  avoidAmbiguous: true,
};

/** Pick a uniformly-random index in [0, max) using rejection sampling. */
function secureIndex(max) {
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let v;
  do {
    crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= limit);
  return v % max;
}

/** Build the active character pool from the selected options. */
function buildPool(opts) {
  let pool = "";
  for (const key of ["lower", "upper", "numbers", "symbols"]) {
    if (!opts[key]) continue;
    pool += SETS[key];
    if (!opts.avoidAmbiguous) pool += AMBIGUOUS_EXTRA[key];
  }
  return pool;
}

/**
 * Generate a password. Guarantees at least one char from each selected set
 * (when length allows), then fills the rest from the combined pool and shuffles.
 */
export function generatePassword(options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  opts.length = Math.max(4, Math.min(128, opts.length | 0));

  const pool = buildPool(opts);
  if (!pool) throw new Error("Select at least one character type.");

  const required = [];
  for (const key of ["lower", "upper", "numbers", "symbols"]) {
    if (!opts[key]) continue;
    const set = SETS[key] + (opts.avoidAmbiguous ? "" : AMBIGUOUS_EXTRA[key]);
    required.push(set[secureIndex(set.length)]);
  }

  const chars = required.slice(0, opts.length);
  while (chars.length < opts.length) {
    chars.push(pool[secureIndex(pool.length)]);
  }

  // Fisher–Yates shuffle so required chars are not stuck at the front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Rough strength estimate (entropy bits) for UI feedback. */
export function estimateStrength(password, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const poolSize = buildPool(opts).length || 1;
  const bits = Math.round(password.length * Math.log2(poolSize));
  let label = "weak";
  if (bits >= 120) label = "very strong";
  else if (bits >= 80) label = "strong";
  else if (bits >= 60) label = "good";
  else if (bits >= 40) label = "fair";
  return { bits, label };
}
