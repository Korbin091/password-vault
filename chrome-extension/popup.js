// Popup controller. All vault operations go through the background worker via
// chrome.runtime.sendMessage. Generator and CSV import run entirely in this context.

import { generatePassword, estimateStrength } from "./generator.js";

const $ = (sel) => document.querySelector(sel);
const screens = ["lock", "main", "detail", "add", "settings", "import"];

function show(screen) {
  for (const s of screens) $(`#screen-${s}`).hidden = s !== screen;
}

function send(msg) {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.runtime)
      return resolve({ ok: false, error: "no runtime" });
    chrome.runtime.sendMessage(msg, (resp) =>
      resolve(resp || { ok: false, error: "no response" }));
  });
}

let toastTimer;
function toast(text) {
  const t = $("#toast");
  t.textContent = text; t.hidden = false; t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => (t.hidden = true), 200);
  }, 1800);
}

async function copy(text, label = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(`✓ ${label}`); }
  catch { toast("Copy failed"); }
}

const ICONS = { login: "🔑", card: "💳", note: "📝" };
let currentCat = "all";

// ─── Lock Screen ──────────────────────────────────────────────
async function refreshLockScreen() {
  const state = await send({ type: "getState" });
  $("#demo-note").hidden = !state.demo;
  if (state.unlocked) { enterMain(state); } else { show("lock"); $("#master-password").focus(); }
}

$("#unlock-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = $("#master-password").value;
  const err = $("#unlock-error"); err.hidden = true;
  const btn = $("#unlock-form .btn-primary");
  btn.textContent = "Unlocking…"; btn.disabled = true;
  const resp = await send({ type: "unlock", masterPassword: pw });
  btn.textContent = "Unlock"; btn.disabled = false;
  if (resp.ok) { $("#master-password").value = ""; enterMain(await send({ type: "getState" })); }
  else { err.textContent = resp.error || "Unlock failed."; err.hidden = false; }
});

// ─── Main Screen ──────────────────────────────────────────────
async function enterMain(state) {
  $("#demo-badge").hidden = !state.demo;
  updateSyncStatus(state.lastSync, state.demo);
  show("main");
  await renderList();
}

function updateSyncStatus(lastSync, demo) {
  $("#sync-status").textContent = lastSync
    ? `Synced ${new Date(lastSync).toLocaleTimeString()}` + (demo ? " (demo)" : "")
    : "Not yet synced";
}

$("#btn-lock").addEventListener("click", async () => {
  await send({ type: "lock" }); show("lock"); $("#master-password").focus();
});

$("#btn-sync").addEventListener("click", async () => {
  const el = $("#btn-sync"); el.textContent = "⟳"; el.disabled = true;
  const resp = await send({ type: "sync" });
  el.disabled = false;
  if (resp.ok) {
    const state = await send({ type: "getState" });
    updateSyncStatus(state.lastSync, state.demo);
    renderList(); toast("✓ Synced");
  } else {
    toast(resp.error || "Sync failed");
  }
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    $("#tab-vault").hidden = tab.dataset.tab !== "vault";
    $("#tab-generator").hidden = tab.dataset.tab !== "generator";
    if (tab.dataset.tab === "generator") regenerate();
  });
});

$("#filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip"); if (!chip) return;
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
  currentCat = chip.dataset.cat; renderList();
});
$("#search").addEventListener("input", () => renderList());

async function renderList() {
  const query = $("#search").value;
  const resp = await send({ type: "listItems", category: currentCat, query });
  const list = $("#item-list"); list.innerHTML = "";
  const items = resp.items || [];
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = query ? "No results." : "No items yet.";
    list.appendChild(li); return;
  }
  for (const it of items) {
    const li = document.createElement("li");
    li.className = "item"; li.tabIndex = 0;
    const iconDiv = document.createElement("div");
    iconDiv.className = `item-icon type-${it.type}`;
    iconDiv.textContent = ICONS[it.type] || "•";
    const meta = document.createElement("div"); meta.className = "meta";
    const name = document.createElement("div"); name.className = "name"; name.textContent = it.name;
    const sub = document.createElement("div"); sub.className = "sub";
    sub.textContent = it.username || (it.uris && it.uris[0]) || it.type;
    meta.append(name, sub);
    const arrow = document.createElement("span"); arrow.className = "item-arrow"; arrow.textContent = "›";
    li.append(iconDiv, meta, arrow);
    li.addEventListener("click", () => openDetail(it.id));
    li.addEventListener("keydown", (e) => { if (e.key === "Enter") openDetail(it.id); });
    list.appendChild(li);
  }
}

$("#btn-add").addEventListener("click", () => openAdd());
$("#btn-import-quick").addEventListener("click", () => openImport("main"));

// ─── Detail View ──────────────────────────────────────────────
function detailRow(label, value, { secret = false } = {}) {
  const row = document.createElement("div");
  row.className = "detail-row";
  const left = document.createElement("div"); left.className = "detail-row-left";
  const lbl = document.createElement("div"); lbl.className = "label"; lbl.textContent = label;
  const val = document.createElement("div"); val.className = "value";
  val.textContent = secret ? "••••••••••" : (value || "—");
  left.append(lbl, val);
  const acts = document.createElement("div"); acts.className = "detail-actions";
  if (secret && value) {
    const eye = document.createElement("button");
    eye.className = "btn-icon"; eye.title = "Reveal"; eye.textContent = "👁";
    let shown = false;
    eye.addEventListener("click", () => {
      shown = !shown; val.textContent = shown ? value : "••••••••••";
    });
    acts.appendChild(eye);
  }
  if (value) {
    const cp = document.createElement("button");
    cp.className = "btn-icon"; cp.title = "Copy"; cp.textContent = "📋";
    cp.addEventListener("click", () => copy(value, `${label} copied`));
    acts.appendChild(cp);
  }
  row.append(left, acts);
  return row;
}

async function openDetail(id) {
  const resp = await send({ type: "getItem", id });
  const it = resp.item; if (!it) return;
  $("#detail-title").textContent = it.name;
  const body = $("#detail-body"); body.innerHTML = "";
  if (it.type === "login") {
    if (it.username) body.appendChild(detailRow("Username", it.username));
    if (it.password) body.appendChild(detailRow("Password", it.password, { secret: true }));
    (it.uris || []).filter(Boolean).forEach((u) => body.appendChild(detailRow("Website", u)));
  } else if (it.type === "card") {
    const c = it.card || {};
    if (c.number) body.appendChild(detailRow("Card Number", c.number, { secret: true }));
    if (c.brand)  body.appendChild(detailRow("Brand", c.brand));
    if (c.exp)    body.appendChild(detailRow("Expires", c.exp));
    if (c.code)   body.appendChild(detailRow("Security Code", c.code, { secret: true }));
  }
  if (it.notes) body.appendChild(detailRow("Notes", it.notes));

  const footer = document.createElement("div"); footer.className = "detail-footer-actions";
  if (it.type === "login") {
    const edit = document.createElement("button");
    edit.className = "btn-secondary"; edit.textContent = "Edit";
    edit.addEventListener("click", () => openEdit(it));
    footer.appendChild(edit);
  }
  const del = document.createElement("button");
  del.className = "btn-danger"; del.textContent = "Delete";
  del.addEventListener("click", () => deleteItem(it));
  footer.appendChild(del);
  body.appendChild(footer);
  show("detail");
}

async function deleteItem(it) {
  if (!confirm(`Delete "${it.name}"? This cannot be undone.`)) return;
  const resp = await send({ type: "deleteItem", id: it.id });
  if (resp.ok) { toast("Deleted"); show("main"); renderList(); }
  else { toast(resp.error || "Delete failed"); }
}

$("#detail-back").addEventListener("click", () => show("main"));
$("#add-back").addEventListener("click", () => show("main"));

// ─── Add / Edit ───────────────────────────────────────────────
let editingId = null;

function openAdd() {
  editingId = null;
  $("#add-title").textContent = "Add password";
  $("#add-form").reset(); $("#add-error").hidden = true;
  show("add"); $("#add-name").focus();
}

function openEdit(it) {
  editingId = it.id;
  $("#add-title").textContent = "Edit password";
  $("#add-form").reset(); $("#add-error").hidden = true;
  $("#add-name").value = it.name || "";
  $("#add-uri").value = (it.uris && it.uris[0]) || "";
  $("#add-username").value = it.username || "";
  $("#add-password").value = it.password || "";
  $("#add-notes").value = it.notes || "";
  show("add"); $("#add-name").focus();
}

$("#add-gen").addEventListener("click", () => { $("#add-password").value = generatePassword(readGenOptions()); });

$("#add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#add-error"); err.hidden = true;
  const uri = $("#add-uri").value.trim();
  const item = {
    type: "login",
    name: $("#add-name").value.trim(),
    username: $("#add-username").value.trim(),
    password: $("#add-password").value,
    uris: uri ? [uri] : [],
    notes: $("#add-notes").value.trim(),
  };
  const btn = $("#add-form .btn-primary");
  btn.disabled = true; btn.textContent = "Saving…";
  const resp = editingId
    ? await send({ type: "updateItem", id: editingId, item })
    : await send({ type: "addItem", item });
  btn.disabled = false; btn.textContent = "Save";
  if (resp.ok) { toast(editingId ? "✓ Updated" : "✓ Saved"); editingId = null; show("main"); renderList(); }
  else { err.textContent = resp.error || "Save failed."; err.hidden = false; }
});

// ─── Settings ─────────────────────────────────────────────────
async function openSettings() {
  const resp = await send({ type: "getConfig" });
  const c = resp.config || {};
  $("#cfg-email").value = c.email || "";
  $("#cfg-clientid").value = c.clientId || "";
  $("#cfg-clientsecret").value = "";
  $("#cfg-clientsecret").placeholder = c.hasSecret ? "•••••• (leave blank to keep)" : "Client secret";
  $("#cfg-server").value = c.server || "";
  $("#settings-error").hidden = true; $("#settings-saved").hidden = true;
  show("settings");
}

$("#open-settings").addEventListener("click", openSettings);
$("#settings-back").addEventListener("click", () => refreshLockScreen());
$("#open-import").addEventListener("click", () => openImport("settings"));

$("#settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const cur = (await send({ type: "getConfig" })).config || {};
  const secret = $("#cfg-clientsecret").value.trim();
  const config = {
    email: $("#cfg-email").value.trim(),
    clientId: $("#cfg-clientid").value.trim(),
    clientSecret: secret || (cur.hasSecret ? "__KEEP__" : ""),
    server: $("#cfg-server").value.trim(),
  };
  const err = $("#settings-error");
  if (!config.email || !config.clientId || config.clientSecret === "") {
    err.textContent = "Email, Client ID, and Client Secret are required for live sync.";
    err.hidden = false; return;
  }
  if (config.clientSecret === "__KEEP__") delete config.clientSecret;
  await send({ type: "saveConfig", config });
  $("#settings-saved").hidden = false; err.hidden = true;
});

$("#cfg-clear").addEventListener("click", async () => {
  await send({ type: "saveConfig", config: { email: "", clientId: "", clientSecret: "", server: "" } });
  await send({ type: "lock" });
  refreshLockScreen();
});

// ─── Generator ────────────────────────────────────────────────
function readGenOptions() {
  return {
    length: Number($("#gen-length").value),
    upper: $("#gen-upper").checked,
    lower: $("#gen-lower").checked,
    numbers: $("#gen-numbers").checked,
    symbols: $("#gen-symbols").checked,
    avoidAmbiguous: $("#gen-ambiguous").checked,
  };
}
function regenerate() {
  const opts = readGenOptions();
  $("#gen-len-val").textContent = opts.length;
  try {
    const pw = generatePassword(opts);
    $("#gen-value").textContent = pw;
    const s = estimateStrength(pw, opts);
    $("#gen-strength").textContent = `Strength: ${s.label} (~${s.bits} bits)`;
  } catch (e) {
    $("#gen-value").textContent = "—";
    $("#gen-strength").textContent = e.message;
  }
}
["gen-length","gen-upper","gen-lower","gen-numbers","gen-symbols","gen-ambiguous"]
  .forEach((id) => $(`#${id}`).addEventListener("input", regenerate));
$("#gen-refresh").addEventListener("click", regenerate);
$("#gen-copy").addEventListener("click", () => copy($("#gen-value").textContent, "Password copied"));

// ─── Import ───────────────────────────────────────────────────
let importReturnScreen = "settings";
let importParsedItems = [];

function openImport(returnTo = "settings") {
  importReturnScreen = returnTo;
  importParsedItems = [];
  $("#import-zone").hidden = false;
  $("#import-zone").classList.remove("dragover");
  $("#import-preview").hidden = true;
  $("#import-progress").hidden = true;
  $("#import-progress").textContent = "";
  show("import");
}

$("#import-back").addEventListener("click", () => {
  if (importReturnScreen === "main") show("main");
  else openSettings();
});

// Click on drop zone opens file picker
$("#import-zone").addEventListener("click", () => $("#import-file").click());

// Drag-and-drop
const zone = $("#import-zone");
zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
zone.addEventListener("drop", (e) => {
  e.preventDefault(); zone.classList.remove("dragover");
  const f = e.dataTransfer.files[0];
  if (f) readCsvFile(f);
});

$("#import-file").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (f) readCsvFile(f);
  e.target.value = ""; // reset so same file can be re-selected
});

function readCsvFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      importParsedItems = parsePasswordCsv(e.target.result);
      showImportPreview();
    } catch (err) {
      toast("Could not parse CSV: " + err.message);
    }
  };
  reader.readAsText(file, "utf-8");
}

/**
 * Parse a password-manager CSV export.
 *
 * Fixes vs. the naive line-split approach:
 *   1. Strips the UTF-8 BOM that Aura (and many Windows apps) prepend — without
 *      this the first header column is "﻿name" not "name" and goes undetected.
 *   2. Parses the entire file character-by-character so quoted fields that
 *      contain embedded newlines (common in notes) are handled correctly instead
 *      of being split across records.
 *
 * Column matching is case-insensitive and covers the exact Aura header
 * (name, url, username, password, note, OTPAuth) plus Chrome, Bitwarden,
 * 1Password, and LastPass variants. Unknown columns (e.g. OTPAuth) are ignored.
 */
function parsePasswordCsv(text) {
  // 1. Strip UTF-8 BOM (﻿) that Aura prepends
  text = text.replace(/^﻿/, "");

  // 2. Full-file character-by-character CSV parser (handles multiline quoted fields)
  const records = [];
  let row = [], field = "", inQ = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      if (inQ && text[i + 1] === '"') { field += '"'; i += 2; continue; } // escaped quote
      inQ = !inQ;
    } else if (c === "," && !inQ) {
      row.push(field); field = "";
    } else if (c === "\r" && !inQ) {
      // skip bare CR (handles \r\n — the \n is consumed in the \n branch)
    } else if (c === "\n" && !inQ) {
      row.push(field); field = "";
      if (row.some((f) => f.trim())) records.push(row);
      row = [];
    } else {
      field += c;
    }
    i++;
  }
  // flush last record if file doesn't end with newline
  row.push(field);
  if (row.some((f) => f.trim())) records.push(row);

  if (records.length < 2) throw new Error("File appears empty or has no data rows.");

  const headers = records[0].map((h) => h.trim().toLowerCase());

  const col = (...names) => {
    for (const n of names) {
      const idx = headers.indexOf(n);
      if (idx >= 0) return idx;
    }
    return -1;
  };

  // Aura: name, url, username, password, note, OTPAuth
  const iName = col("name", "title", "service", "account", "site name", "label");
  const iUrl  = col("url", "website", "uri", "login_uri", "site", "web site", "origin");
  const iUser = col("username", "login", "email", "user", "login_username", "login name", "user name");
  const iPass = col("password", "pass", "login_password", "pwd", "secret");
  const iNote = col("note", "notes", "comment", "comments", "extra", "description");

  if (iName < 0 && iUser < 0) {
    throw new Error(
      `Couldn't find a name or username column. Headers found: ${headers.join(", ")}`
    );
  }

  const items = [];
  for (let r = 1; r < records.length; r++) {
    const f = records[r];
    const name = (iName >= 0 ? f[iName] || "" : "").trim();
    const user = (iUser >= 0 ? f[iUser] || "" : "").trim();
    const displayName = name || user || `Import ${items.length + 1}`;
    const url = (iUrl >= 0 ? f[iUrl] || "" : "").trim();
    const pass = (iPass >= 0 ? f[iPass] || "" : "").trim();
    const note = (iNote >= 0 ? f[iNote] || "" : "").trim();
    if (!displayName && !url && !pass) continue;
    items.push({
      type: "login",
      name: displayName,
      username: user,
      password: pass,
      uris: url ? [url] : [],
      notes: note,
      favorite: false,
    });
  }
  if (!items.length) throw new Error("No password entries found in this file.");
  return items;
}

function showImportPreview() {
  const count = importParsedItems.length;
  $("#import-count").textContent = count;
  const previewList = $("#import-preview-list");
  previewList.innerHTML = "";
  const show5 = importParsedItems.slice(0, 5);
  for (const it of show5) {
    const d = document.createElement("div");
    d.textContent = `${ICONS.login} ${it.name}${it.username ? " — " + it.username : ""}`;
    previewList.appendChild(d);
  }
  if (count > 5) {
    const more = document.createElement("div");
    more.textContent = `…and ${count - 5} more`;
    previewList.appendChild(more);
  }
  $("#import-preview").hidden = false;
  $("#import-zone").hidden = true;
}

$("#import-cancel").addEventListener("click", () => {
  importParsedItems = [];
  $("#import-preview").hidden = true;
  $("#import-zone").hidden = false;
});

$("#import-go").addEventListener("click", async () => {
  if (!importParsedItems.length) return;
  const total = importParsedItems.length;
  const progEl = $("#import-progress");
  const goBtn = $("#import-go");
  goBtn.disabled = true;
  $("#import-preview").hidden = true;
  progEl.hidden = false;

  let done = 0, failed = 0;
  for (const item of importParsedItems) {
    progEl.textContent = `Importing… ${done + 1} / ${total}`;
    const resp = await send({ type: "addItem", item });
    if (resp.ok) done++;
    else failed++;
  }

  progEl.hidden = true;
  goBtn.disabled = false;
  importParsedItems = [];
  $("#import-zone").hidden = false;

  const msg = failed
    ? `Imported ${done}, failed ${failed}`
    : `✓ Imported ${done} password${done !== 1 ? "s" : ""}`;
  toast(msg);

  if (importReturnScreen === "main") { show("main"); renderList(); }
  else { openSettings(); }
});

// ─── Boot ─────────────────────────────────────────────────────
refreshLockScreen();
