// Assembles the static web-demo site into ../_site for GitHub Pages.
// Single source of truth: reuses the real extension files; only injects the
// chrome shim + a demo banner so the popup runs as a plain web page.
//
// Run: node web-demo/build.mjs

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "chrome-extension");
const OUT = path.join(ROOT, "_site");

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// Reuse the real extension modules + styles.
const files = ["generator.js", "storage.js", "crypto.js", "vault.js", "bitwarden.js", "popup.js", "popup.css"];
for (const f of files) fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));
fs.cpSync(path.join(SRC, "icons"), path.join(OUT, "icons"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "web-demo", "chrome-shim.js"), path.join(OUT, "chrome-shim.js"));

// Build index.html from popup.html: load the shim before popup.js, add demo init.
let html = fs.readFileSync(path.join(SRC, "popup.html"), "utf8");
html = html.replace(
  "<title>Password Vault</title>",
  '<title>Password Vault — Web Demo</title>\n  <link rel="icon" href="icons/icon-32.png" />'
);
html = html.replace(
  '<script type="module" src="popup.js"></script>',
  [
    '<script type="module" src="chrome-shim.js"></script>',
    '  <script type="module" src="popup.js"></script>',
    '  <script type="module" src="demo-init.js"></script>',
  ].join("\n")
);
fs.writeFileSync(path.join(OUT, "index.html"), html);

// Demo init: hide the live-sync Settings entry and show a clarifying banner.
fs.writeFileSync(path.join(OUT, "demo-init.js"), `addEventListener("DOMContentLoaded", () => {
  const s = document.getElementById("open-settings");
  if (s) s.style.display = "none";
  const b = document.createElement("div");
  b.textContent = "UI preview \\u2014 demo data only. Install the extension for live Bitwarden sync.";
  Object.assign(b.style, {
    position: "fixed", bottom: "0", left: "0", right: "0", background: "#175ddc",
    color: "#fff", font: "11px system-ui, sans-serif", padding: "6px 8px",
    textAlign: "center", zIndex: "9999",
  });
  document.body.appendChild(b);
});
`);

// A tiny landing note for anyone hitting the repo's Pages root directly.
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");

console.log("Built web demo into", OUT);
