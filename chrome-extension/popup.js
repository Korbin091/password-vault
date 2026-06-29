// Popup / side-panel controller. All vault operations go through the background
// service worker via chrome.runtime.sendMessage.

import { generatePassword, estimateStrength } from "./generator.js";
import { generateTotp } from "./totp.js";

const $ = (sel) => document.querySelector(sel);
const screens = ["lock", "main", "detail", "add", "settings"];

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
    $("#tab-vault").hidden     = tab.dataset.tab !== "vault";
    $("#tab-generator").hidden = tab.dataset.tab !== "generator";
    $("#tab-health").hidden    = tab.dataset.tab !== "health";
    if (tab.dataset.tab === "generator") regenerate();
    if (tab.dataset.tab === "health")    renderHealth();
  });
});

$("#filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip"); if (!chip) return;
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
  currentCat = chip.dataset.cat; renderList();
});
$("#search").addEventListener("input", () => renderList());

// ─── Favicon helper ───────────────────────────────────────────
function faviconUrl(uris) {
  const uri = (uris || []).find(Boolean);
  if (!uri) return null;
  try { return `https://www.google.com/s2/favicons?domain=${new URL(uri).hostname}&sz=32`; }
  catch { return null; }
}

function buildItemIcon(it) {
  const iconDiv = document.createElement("div");
  iconDiv.className = `item-icon type-${it.type}`;
  const fav = it.type === "login" ? faviconUrl(it.uris) : null;
  if (fav) {
    const img = document.createElement("img");
    img.src = fav; img.alt = "";
    img.onerror = () => { img.remove(); iconDiv.textContent = ICONS[it.type] || "•"; };
    iconDiv.appendChild(img);
  } else {
    iconDiv.textContent = ICONS[it.type] || "•";
  }
  return iconDiv;
}

// ─── Item List ────────────────────────────────────────────────
function buildItemLi(it) {
  const li = document.createElement("li");
  li.className = "item"; li.tabIndex = 0;
  const meta = document.createElement("div"); meta.className = "meta";
  const name = document.createElement("div"); name.className = "name"; name.textContent = it.name;
  const sub  = document.createElement("div"); sub.className  = "sub";
  sub.textContent = it.username || (it.uris && it.uris[0]) || it.type;
  meta.append(name, sub);
  const arrow = document.createElement("span"); arrow.className = "item-arrow"; arrow.textContent = "›";
  li.append(buildItemIcon(it), meta, arrow);
  li.addEventListener("click", () => openDetail(it.id));
  li.addEventListener("keydown", (e) => { if (e.key === "Enter") openDetail(it.id); });
  return li;
}

async function renderList() {
  const query = $("#search").value;
  const [listResp, recentResp] = await Promise.all([
    send({ type: "listItems", category: currentCat, query }),
    send({ type: "getRecentItems" }),
  ]);
  const items = listResp.items || [];
  const recents = (recentResp.items || []).filter((r) => items.find((i) => i.id === r.id));

  const recentsSection = $("#recents-section");
  const recentsList = $("#recents-list");
  if (recents.length && !query && currentCat === "all") {
    recentsList.innerHTML = "";
    recents.forEach((r) => recentsList.appendChild(buildItemLi(r)));
    recentsSection.hidden = false;
  } else {
    recentsSection.hidden = true;
  }

  const list = $("#item-list"); list.innerHTML = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = query ? "No results." : "No items yet.";
    list.appendChild(li); return;
  }
  items.forEach((it) => list.appendChild(buildItemLi(it)));
}

$("#btn-add").addEventListener("click", () => openAdd());

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

let totpInterval = null;

function buildTotpRow(rawSecret) {
  const row = document.createElement("div");
  row.className = "totp-row";
  const left = document.createElement("div"); left.className = "totp-row-left";
  const lbl  = document.createElement("div"); lbl.className = "label"; lbl.textContent = "Authenticator Code";
  const code = document.createElement("div"); code.className = "totp-code"; code.textContent = "--- ---";
  const timer = document.createElement("div"); timer.className = "totp-timer";
  left.append(lbl, code, timer);
  const countdown = document.createElement("div"); countdown.className = "totp-countdown";
  const acts = document.createElement("div"); acts.className = "detail-actions";
  const cp = document.createElement("button");
  cp.className = "btn-icon"; cp.title = "Copy"; cp.textContent = "📋";
  cp.addEventListener("click", () => copy(code.textContent.replace(/\s/g, ""), "Code copied"));
  acts.appendChild(cp);
  row.append(left, countdown, acts);

  if (totpInterval) clearInterval(totpInterval);
  async function tick() {
    const result = await generateTotp(rawSecret);
    if (!result) return;
    code.textContent = result.code.slice(0, 3) + " " + result.code.slice(3);
    timer.textContent = `Refreshes in ${result.remaining}s`;
    countdown.textContent = result.remaining;
    countdown.classList.toggle("urgent", result.remaining <= 5);
  }
  tick();
  totpInterval = setInterval(tick, 1000);
  return row;
}

async function openDetail(id) {
  if (totpInterval) { clearInterval(totpInterval); totpInterval = null; }
  const resp = await send({ type: "getItem", id });
  const it = resp.item; if (!it) return;
  $("#detail-title").textContent = it.name;
  const body = $("#detail-body"); body.innerHTML = "";
  body.appendChild(detailRow("Name", it.name));
  if (it.type === "login") {
    if (it.username) body.appendChild(detailRow("Username", it.username));
    if (it.password) body.appendChild(detailRow("Password", it.password, { secret: true }));
    if (it.totp)     body.appendChild(buildTotpRow(it.totp));
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

$("#detail-back").addEventListener("click", () => {
  if (totpInterval) { clearInterval(totpInterval); totpInterval = null; }
  show("main");
});
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
  $("#add-name").value     = it.name || "";
  $("#add-uri").value      = (it.uris && it.uris[0]) || "";
  $("#add-username").value = it.username || "";
  $("#add-password").value = it.password || "";
  $("#add-notes").value    = it.notes || "";
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
  $("#cfg-email").value    = c.email || "";
  $("#cfg-clientid").value = c.clientId || "";
  $("#cfg-clientsecret").value = "";
  $("#cfg-clientsecret").placeholder = c.hasSecret ? "•••••• (leave blank to keep)" : "Client secret";
  $("#cfg-server").value   = c.server || "";
  const sel = $("#cfg-lock-minutes");
  if (sel) sel.value = String(c.lockMinutes ?? 15);
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
    clientSecret: secret || (cur.hasSecret ? "__KEEP__" : ""),
    server: $("#cfg-server").value.trim(),
    lockMinutes: Number($("#cfg-lock-minutes")?.value ?? 15),
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
  await send({ type: "saveConfig", config: { email: "", clientId: "", clientSecret: "", server: "", lockMinutes: 15 } });
  await send({ type: "lock" });
  refreshLockScreen();
});

// ─── Health Dashboard ─────────────────────────────────────────
async function renderHealth() {
  const resp = await send({ type: "listItems", category: "all", query: "" });
  const logins = (resp.items || []).filter((it) => it.type === "login" && it.password);

  const weak = logins.filter((it) => {
    try { return estimateStrength(it.password, {}).bits < 40; } catch { return false; }
  });

  const byPw = new Map();
  for (const it of logins) {
    if (!byPw.has(it.password)) byPw.set(it.password, []);
    byPw.get(it.password).push(it);
  }
  const reused = [...byPw.values()].filter((g) => g.length > 1).flat();

  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const old = logins.filter((it) => it.revisionDate && new Date(it.revisionDate).getTime() < cutoff);

  const issueIds = new Set([...weak, ...reused, ...old].map((it) => it.id));
  const score = logins.length ? Math.round((1 - issueIds.size / logins.length) * 100) : 100;
  $("#health-score-num").textContent = score;
  const count = issueIds.size;
  $("#health-score-sub").textContent = count
    ? `${count} issue${count !== 1 ? "s" : ""} found across ${logins.length} logins`
    : `All ${logins.length} passwords look healthy!`;

  const container = $("#health-sections");
  container.innerHTML = "";

  const addGroup = (icon, title, items, subFn) => {
    const group = document.createElement("div");
    group.className = "health-group";
    const header = document.createElement("div"); header.className = "health-group-header";
    const ic  = document.createElement("span"); ic.className = "health-group-icon"; ic.textContent = icon;
    const ttl = document.createElement("span"); ttl.className = "health-group-title"; ttl.textContent = title;
    const cnt = document.createElement("span");
    cnt.className = "health-group-count" + (items.length === 0 ? " ok" : "");
    cnt.textContent = items.length === 0 ? "✓ None" : String(items.length);
    header.append(ic, ttl, cnt);
    group.appendChild(header);
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "health-empty";
      empty.textContent = "✓ No issues found";
      group.appendChild(empty);
    } else {
      const unique = [...new Map(items.map((i) => [i.id, i])).values()];
      for (const it of unique) {
        const row = document.createElement("div"); row.className = "health-item";
        row.append(buildItemIcon(it));
        const meta = document.createElement("div"); meta.style.flex = "1"; meta.style.minWidth = "0";
        const nm  = document.createElement("div"); nm.className  = "health-item-name"; nm.textContent  = it.name;
        const sub = document.createElement("div"); sub.className = "health-item-sub";  sub.textContent = subFn(it);
        meta.append(nm, sub);
        const arrow = document.createElement("span"); arrow.style.color = "var(--border)"; arrow.textContent = "›";
        row.append(meta, arrow);
        row.addEventListener("click", () => openDetail(it.id));
        group.appendChild(row);
      }
    }
    container.appendChild(group);
  };

  addGroup("⚠️", "Weak Passwords", weak, (it) => {
    try { const s = estimateStrength(it.password, {}); return `~${s.bits} bits — ${s.label}`; }
    catch { return "Weak"; }
  });
  addGroup("♻️", "Reused Passwords", reused, () => "Same password used elsewhere");
  addGroup("🕐", "Old Passwords", old, (it) => {
    const days = Math.floor((Date.now() - new Date(it.revisionDate).getTime()) / 86400000);
    return `${days} days since last change`;
  });
}

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

// ─── Boot ─────────────────────────────────────────────────────
refreshLockScreen();
