// Popup controller. Talks to the background worker (single source of truth) via
// messages for all vault operations; runs the generator locally.

import { generatePassword, estimateStrength } from "./generator.js";

const $ = (sel) => document.querySelector(sel);
const screens = ["lock", "main", "detail", "add", "settings"];

function show(screen) {
  for (const s of screens) $(`#screen-${s}`).hidden = s !== screen;
}

/** Promise wrapper around chrome.runtime.sendMessage. */
function send(msg) {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.runtime) return resolve({ ok: false, error: "no runtime" });
    chrome.runtime.sendMessage(msg, (resp) => resolve(resp || { ok: false, error: "no response" }));
  });
}

let toastTimer;
function toast(text) {
  const t = $("#toast");
  t.textContent = text; t.hidden = false; t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove("show"); setTimeout(() => (t.hidden = true), 200); }, 1600);
}

async function copy(text, label = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(label); }
  catch { toast("Copy failed"); }
}

const ICONS = { login: "🔑", card: "💳", note: "📝" };
let currentCat = "all";

// ───────────────────────── Lock screen ─────────────────────────
async function refreshLockScreen() {
  const state = await send({ type: "getState" });
  $("#demo-note").hidden = !state.demo;
  if (state.unlocked) { enterMain(state); } else { show("lock"); $("#master-password").focus(); }
}

$("#unlock-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = $("#master-password").value;
  const err = $("#unlock-error"); err.hidden = true;
  const resp = await send({ type: "unlock", masterPassword: pw });
  if (resp.ok) { $("#master-password").value = ""; enterMain(await send({ type: "getState" })); }
  else { err.textContent = resp.error || "Unlock failed."; err.hidden = false; }
});

// ───────────────────────── Main ─────────────────────────
async function enterMain(state) {
  $("#demo-badge").hidden = !state.demo;
  $("#sync-status").textContent = state.lastSync
    ? `Last synced ${new Date(state.lastSync).toLocaleString()}` + (state.demo ? " (demo)" : "")
    : "Not synced";
  show("main");
  await renderList();
}

$("#btn-lock").addEventListener("click", async () => { await send({ type: "lock" }); show("lock"); $("#master-password").focus(); });

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
    li.className = "empty"; li.textContent = "No items.";
    list.appendChild(li); return;
  }
  for (const it of items) {
    const li = document.createElement("li");
    li.className = "item"; li.tabIndex = 0;
    li.innerHTML = `<span class="ico">${ICONS[it.type] || "•"}</span>
      <span class="meta"><div class="name"></div><div class="sub"></div></span>`;
    li.querySelector(".name").textContent = it.name;
    li.querySelector(".sub").textContent = it.username || (it.uris && it.uris[0]) || it.type;
    li.addEventListener("click", () => openDetail(it.id));
    list.appendChild(li);
  }
}

$("#btn-add").addEventListener("click", () => {
  editingId = null;
  document.querySelector("#screen-add .brand").textContent = "Add login";
  $("#add-form").reset(); $("#add-error").hidden = true; show("add"); $("#add-name").focus();
});

// ───────────────────────── Detail ─────────────────────────
function detailRow(label, value, { secret = false } = {}) {
  const row = document.createElement("div");
  row.className = "detail-row";
  const left = document.createElement("div");
  left.innerHTML = `<div class="label"></div><div class="value"></div>`;
  left.querySelector(".label").textContent = label;
  const valEl = left.querySelector(".value");
  valEl.textContent = secret ? "••••••••••" : value;
  const actions = document.createElement("div"); actions.className = "pw-row";
  if (secret) {
    const reveal = document.createElement("button");
    reveal.className = "btn-icon"; reveal.title = "Reveal"; reveal.textContent = "👁";
    let shown = false;
    reveal.addEventListener("click", () => { shown = !shown; valEl.textContent = shown ? value : "••••••••••"; });
    actions.appendChild(reveal);
  }
  const copyBtn = document.createElement("button");
  copyBtn.className = "btn-icon"; copyBtn.title = "Copy"; copyBtn.textContent = "📋";
  copyBtn.addEventListener("click", () => copy(value, `${label} copied`));
  actions.appendChild(copyBtn);
  row.append(left, actions);
  return row;
}

let currentDetailItem = null;

async function openDetail(id) {
  const resp = await send({ type: "getItem", id });
  const it = resp.item; if (!it) return;
  currentDetailItem = it;
  $("#detail-title").textContent = it.name;
  const body = $("#detail-body"); body.innerHTML = "";
  if (it.type === "login") {
    if (it.username) body.appendChild(detailRow("Username", it.username));
    if (it.password) body.appendChild(detailRow("Password", it.password, { secret: true }));
    (it.uris || []).forEach((u) => body.appendChild(detailRow("Website", u)));
  } else if (it.type === "card") {
    const c = it.card || {};
    if (c.number) body.appendChild(detailRow("Number", c.number, { secret: true }));
    if (c.brand) body.appendChild(detailRow("Brand", c.brand));
    if (c.exp) body.appendChild(detailRow("Expires", c.exp));
    if (c.code) body.appendChild(detailRow("Code", c.code, { secret: true }));
  }
  if (it.notes) body.appendChild(detailRow("Notes", it.notes));

  // Edit / Delete actions (logins only for edit; delete for any).
  const actions = document.createElement("div");
  actions.className = "pw-row"; actions.style.marginTop = "8px";
  if (it.type === "login") {
    const edit = document.createElement("button");
    edit.className = "btn-secondary"; edit.style.flex = "1"; edit.textContent = "Edit";
    edit.addEventListener("click", () => openEdit(it));
    actions.appendChild(edit);
  }
  const del = document.createElement("button");
  del.className = "btn-secondary"; del.style.flex = "1"; del.style.color = "var(--danger)";
  del.style.borderColor = "var(--danger)"; del.textContent = "Delete";
  del.addEventListener("click", () => deleteCurrent(it));
  actions.appendChild(del);
  body.appendChild(actions);

  show("detail");
}

async function deleteCurrent(it) {
  if (!confirm(`Delete "${it.name}"? This cannot be undone.`)) return;
  const resp = await send({ type: "deleteItem", id: it.id });
  if (resp.ok) { toast("Deleted"); show("main"); renderList(); }
  else { toast(resp.error || "Delete failed"); }
}

$("#detail-back").addEventListener("click", () => show("main"));
$("#add-back").addEventListener("click", () => show("main"));

// ───────────────────────── Add / Edit ─────────────────────────
let editingId = null;

function openEdit(it) {
  editingId = it.id;
  $("#add-form").reset(); $("#add-error").hidden = true;
  document.querySelector("#screen-add .brand").textContent = "Edit login";
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
  const resp = editingId
    ? await send({ type: "updateItem", id: editingId, item })
    : await send({ type: "addItem", item });
  if (resp.ok) { toast(editingId ? "Updated" : "Saved"); editingId = null; show("main"); renderList(); }
  else { err.textContent = resp.error || "Save failed."; err.hidden = false; }
});

// ───────────────────────── Settings ─────────────────────────
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

$("#settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const cur = (await send({ type: "getConfig" })).config || {};
  const secret = $("#cfg-clientsecret").value.trim();
  const config = {
    email: $("#cfg-email").value.trim(),
    clientId: $("#cfg-clientid").value.trim(),
    // keep existing secret if field left blank
    clientSecret: secret || (cur.hasSecret ? "__KEEP__" : ""),
    server: $("#cfg-server").value.trim(),
  };
  const err = $("#settings-error");
  if (!config.email || !config.clientId || (config.clientSecret === "" )) {
    err.textContent = "Email, Client ID, and Client Secret are required for live sync.";
    err.hidden = false; return;
  }
  if (config.clientSecret === "__KEEP__") delete config.clientSecret; // background preserves it
  await send({ type: "saveConfig", config });
  $("#settings-saved").hidden = false; err.hidden = true;
});

$("#cfg-clear").addEventListener("click", async () => {
  await send({ type: "saveConfig", config: { email: "", clientId: "", clientSecret: "", server: "" } });
  await send({ type: "lock" });
  refreshLockScreen();
});

// ───────────────────────── Generator ─────────────────────────
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
["gen-length", "gen-upper", "gen-lower", "gen-numbers", "gen-symbols", "gen-ambiguous"]
  .forEach((id) => $(`#${id}`).addEventListener("input", regenerate));
$("#gen-refresh").addEventListener("click", regenerate);
$("#gen-copy").addEventListener("click", () => copy($("#gen-value").textContent, "Password copied"));

// ───────────────────────── Boot ─────────────────────────
refreshLockScreen();
