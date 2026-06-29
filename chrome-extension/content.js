// Auto-fill content script (classic script — no ES modules in content scripts).
// Detects login fields, shows a small Vault button on the username/password
// field, and on click offers matching logins (fetched from the background
// worker, which only returns data when the vault is unlocked).

(() => {
  "use strict";
  const MARK = "data-pv-attached";
  const BTN_CLASS = "pv-fill-btn";
  const MENU_ID = "pv-fill-menu";

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  }

  function passwordFields(root) {
    return [...root.querySelectorAll('input[type="password"]')].filter(isVisible);
  }

  // Best-effort username field: the visible text/email/tel input nearest before
  // a password field within the same form.
  function findUsernameField(pwField) {
    const form = pwField.form || document;
    const candidates = [...form.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="tel"], input:not([type])'
    )].filter(isVisible);
    let best = null;
    for (const c of candidates) {
      if (c.compareDocumentPosition(pwField) & Node.DOCUMENT_POSITION_FOLLOWING) best = c;
    }
    return best || candidates[0] || null;
  }

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function removeMenu() { document.getElementById(MENU_ID)?.remove(); }

  function fill(userField, pwField, match) {
    if (userField && match.username) setNativeValue(userField, match.username);
    if (pwField && match.password) setNativeValue(pwField, match.password);
    removeMenu();
  }

  function showMenu(anchor, matches, userField, pwField) {
    removeMenu();
    if (!matches.length) return;
    const menu = document.createElement("div");
    menu.id = MENU_ID;
    Object.assign(menu.style, {
      position: "absolute", zIndex: 2147483647, background: "#fff",
      border: "1px solid #d0d7e2", borderRadius: "8px",
      boxShadow: "0 6px 24px rgba(0,0,0,.18)", font: "13px system-ui, sans-serif",
      minWidth: "200px", overflow: "hidden",
    });
    const r = anchor.getBoundingClientRect();
    menu.style.left = `${window.scrollX + r.left}px`;
    menu.style.top = `${window.scrollY + r.bottom + 4}px`;

    for (const m of matches) {
      const row = document.createElement("div");
      Object.assign(row.style, { padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #eef2fb" });
      row.innerHTML = `<div style="font-weight:600">🔑 ${escapeHtml(m.name)}</div>
        <div style="color:#6b7280;font-size:12px">${escapeHtml(m.username || "")}</div>`;
      row.addEventListener("mousedown", (e) => { e.preventDefault(); fill(userField, pwField, m); });
      row.addEventListener("mouseenter", () => (row.style.background = "#eef2fb"));
      row.addEventListener("mouseleave", () => (row.style.background = "#fff"));
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function requestMatches() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: "getMatches", url: location.href });
      return resp?.ok ? resp.matches : [];
    } catch { return []; }
  }

  function attachButton(pwField) {
    if (pwField.getAttribute(MARK)) return;
    pwField.setAttribute(MARK, "1");

    const btn = document.createElement("button");
    btn.type = "button"; btn.className = BTN_CLASS; btn.textContent = "🔐";
    btn.title = "Fill from Password Vault";
    Object.assign(btn.style, {
      position: "absolute", zIndex: 2147483647, width: "22px", height: "22px",
      lineHeight: "20px", padding: "0", border: "1px solid #d0d7e2", borderRadius: "6px",
      background: "#fff", cursor: "pointer", fontSize: "12px",
    });

    function place() {
      const r = pwField.getBoundingClientRect();
      if (r.width === 0) { btn.style.display = "none"; return; }
      btn.style.display = "block";
      btn.style.left = `${window.scrollX + r.right - 28}px`;
      btn.style.top = `${window.scrollY + r.top + (r.height - 22) / 2}px`;
    }

    btn.addEventListener("click", async () => {
      const matches = await requestMatches();
      if (!matches.length) return;
      showMenu(pwField, matches, findUsernameField(pwField), pwField);
    });

    document.body.appendChild(btn);
    place();
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place, { passive: true });
  }

  function scan() { passwordFields(document).forEach(attachButton); }

  document.addEventListener("click", (e) => {
    if (!e.target.closest(`#${MENU_ID}, .${BTN_CLASS}`)) removeMenu();
  });

  // Initial scan + observe DOM for delayed-render / SPA login forms.
  scan();
  const observer = new MutationObserver(() => scan());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
