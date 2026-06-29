// Tests for generator.js. Run: node test/generator.test.mjs
import { generatePassword, estimateStrength, DEFAULT_OPTIONS } from "../generator.js";

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error("✗ FAIL:", msg); process.exit(1); }
  passed++; console.log("✓", msg);
}

// Length is honored and clamped to [4, 128].
ok(generatePassword({ length: 20 }).length === 20, "respects requested length");
ok(generatePassword({ length: 2 }).length === 4, "clamps length up to minimum 4");
ok(generatePassword({ length: 999 }).length === 128, "clamps length down to maximum 128");

// Character-class inclusion.
const digits = generatePassword({ length: 64, lower: false, upper: false, numbers: true, symbols: false });
ok(/^[0-9]+$/.test(digits), "numbers-only set contains only digits");

const noSymbols = generatePassword({ length: 64, symbols: false });
ok(!/[!@#$%^&*()\-_=+\[\]{};:,.?]/.test(noSymbols), "symbols excluded when disabled");

// avoidAmbiguous removes l, I, O, 0, 1.
const unambiguous = generatePassword({ length: 200, avoidAmbiguous: true });
ok(!/[lIO01]/.test(unambiguous), "ambiguous characters removed when avoidAmbiguous=true");

// At least one of each selected class appears (probabilistically guaranteed by construction).
const all = generatePassword({ length: 8, ...DEFAULT_OPTIONS });
ok(/[a-z]/.test(all) && /[A-Z]/.test(all) && /[0-9]/.test(all), "includes each selected class");

// No type selected -> throws.
let threw = false;
try { generatePassword({ lower: false, upper: false, numbers: false, symbols: false }); }
catch { threw = true; }
ok(threw, "throws when no character type is selected");

// Uniqueness sanity: 100 generated passwords should all differ.
const seen = new Set();
for (let i = 0; i < 100; i++) seen.add(generatePassword({ length: 24 }));
ok(seen.size === 100, "100 generated passwords are all unique");

// Strength estimate scales with length.
ok(estimateStrength(generatePassword({ length: 8 }), DEFAULT_OPTIONS).bits <
   estimateStrength(generatePassword({ length: 32 }), DEFAULT_OPTIONS).bits,
   "entropy estimate increases with length");

console.log(`\nAll ${passed} generator checks passed.`);
