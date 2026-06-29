// Content script: floating vault FAB + focus-triggered credential dropdown.
// No per-field buttons — the FAB lives in the bottom-right corner and the
// dropdown appears below any login field when it receives focus.

(() => {
  "use strict";

  // Don't interfere with password-manager interfaces themselves
  const SKIP = ["bitwarden.com", "vault.bitwarden.com", "lastpass.com",
    "1password.com", "dashlane.com", "keepassweb.app"];
  if (SKIP.some((d) => location.hostname === d || location.hostname.endsWith("." + d))) return;

  const MENU_ID = "pv-fill-menu";
  const FAB_ID  = "pv-fab";
  const MARK    = "data-pv-attached";

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ─── Floating Action Button ──────────────────────────────────
  function createFab() {
    if (document.getElementById(FAB_ID)) return;
    const btn = document.createElement("button");
    btn.id = FAB_ID;
    btn.type = "button";
    btn.title = "Password Vault";
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" width="26" height="26">
      <path d="M12 2L4 6v6c0 5.3 3.7 9.5 8 11 4.3-1.5 8-5.7 8-11V6l-8-4z"
        fill="rgba(255,255,255,.15)" stroke="rgba(255,255,255,.85)" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M9 11a3 3 0 1 1 6 0v.5H9V11z" fill="rgba(255,255,255,.9)"/>
      <rect x="8" y="11.5" width="8" height="5.5" rx="1.2" fill="white"/>
    </svg>`;
    Object.assign(btn.style, {
      position: "fixed", bottom: "24px", right: "24px",
      zIndex: "2147483646",
      width: "52px", height: "52px", borderRadius: "50%",
      background: "linear-gradient(135deg,#7B5CFF 0%,#5F37E8 100%)",
      border: "none", cursor: "pointer",
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 4px 20px rgba(108,71,255,.55)",
      transition: "transform .15s, box-shadow .15s",
      padding: "0", outline: "none",
    });
    btn.addEventListener("mouseenter", () => {
      btn.style.transform = "scale(1.1)";
      btn.style.boxShadow = "0 6px 28px rgba(108,71,255,.75)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "scale(1)";
      btn.style.boxShadow = "0 4px 20px rgba(108,71,255,.55)";
    });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeMenu();
      try { chrome.runtime.sendMessage({ type: "openSidePanel" }); } catch (_) {}
    });
    document.body.appendChild(btn);
  }

  // ─── Credential Dropdown ─────────────────────────────────────
  function removeMenu() { document.getElementById(MENU_ID)?.remove(); }

  function setNativeValue(el, value) {
    const proto  = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findPasswordField(anchorField) {
    const form = anchorField.form || document;
    return [...form.querySelectorAll('input[type="password"]')]
      .find((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }) || null;
  }

  function showMenu(anchorField, matches) {
    removeMenu();
    if (!matches?.length) return;

    const r = anchorField.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.id = MENU_ID;
    Object.assign(menu.style, {
      position: "fixed",
      zIndex: "2147483647",
      background: "#14102B",
      borderRadius: "12px",
      boxShadow: "0 8px 36px rgba(0,0,0,.5)",
      font: "14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      minWidth: `${Math.max(r.width, 260)}px`,
      maxWidth: "360px",
      overflow: "hidden",
      left: `${r.left}px`,
      top: `${r.bottom + 6}px`,
    });

    // Header row
    const header = document.createElement("div");
    Object.assign(header.style, {
      padding: "10px 14px 8px",
      fontSize: "10px", fontWeight: "700",
      color: "rgba(255,255,255,.38)",
      letterSpacing: ".1em", textTransform: "uppercase",
      borderBottom: "1px solid rgba(255,255,255,.07)",
      display: "flex", alignItems: "center", gap: "7px",
    });
    header.innerHTML = `<svg viewBox="0 0 24 24" fill="none" width="14" height="14">
      <path d="M12 2L4 6v6c0 5.3 3.7 9.5 8 11 4.3-1.5 8-5.7 8-11V6l-8-4z"
        fill="rgba(255,255,255,.1)" stroke="rgba(255,255,255,.5)" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M9 11a3 3 0 1 1 6 0v.5H9V11z" fill="rgba(255,255,255,.8)"/>
      <rect x="8" y="11.5" width="8" height="5.5" rx="1.2" fill="white"/>
    </svg> Password Vault`;
    menu.appendChild(header);

    for (const m of matches) {
      const row = document.createElement("div");
      Object.assign(row.style, {
        padding: "11px 14px",
        cursor: "pointer",
        borderBottom: "1px solid rgba(255,255,255,.05)",
        transition: "background .1s",
      });
      row.innerHTML = `
        <div style="color:#fff;font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${escapeHtml(m.username || m.name)}
        </div>
        ${m.name ? `<div style="color:rgba(255,255,255,.4);font-size:12px;margin-top:2px">${escapeHtml(m.name)}</div>` : ""}
      `;
      row.addEventListener("mouseenter", () => (row.style.background = "rgba(108,71,255,.28)"));
      row.addEventListener("mouseleave", () => (row.style.background = ""));
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const pwField = findPasswordField(anchorField);
        setNativeValue(anchorField, m.username || "");
        if (pwField && m.password) setNativeValue(pwField, m.password);
        removeMenu();
      });
      menu.appendChild(row);
    }

    document.documentElement.appendChild(menu);

    // Flip up if it clips below viewport
    requestAnimationFrame(() => {
      const mr = menu.getBoundingClientRect();
      if (mr.bottom > window.innerHeight - 8) menu.style.top = `${r.top - mr.height - 6}px`;
      if (mr.right  > window.innerWidth  - 8) menu.style.left = `${r.right - mr.width}px`;
    });
  }

  async function requestMatches() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: "getMatches", url: location.href });
      return resp?.ok ? resp.matches : [];
    } catch { return []; }
  }

  // ─── Login Field Detection ───────────────────────────────────
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  }

  function isLoginField(el) {
    const type = (el.type || "text").toLowerCase();
    const ac   = (el.autocomplete || "").toLowerCase();
    const nm   = (el.name || el.id || "").toLowerCase();
    if (type === "password") return true;
    if (type === "email")    return true;
    if (ac.includes("username") || ac.includes("email") || ac === "on") return true;
    if (/\b(user|email|login|mail|account)\b/.test(nm)) return true;
    return false;
  }

  function attachField(field) {
    if (field.getAttribute(MARK)) return;
    field.setAttribute(MARK, "1");

    field.addEventListener("focus", async () => {
      const matches = await requestMatches();
      if (matches?.length) showMenu(field, matches);
    });
    field.addEventListener("blur", () => {
      setTimeout(() => {
        const m = document.getElementById(MENU_ID);
        if (!m || !m.matches(":hover")) removeMenu();
      }, 180);
    });
  }

  function scan() {
    document.querySelectorAll(
      'input[type="password"],input[type="email"],input[type="text"],input[type="tel"],input:not([type])'
    ).forEach((el) => { if (isVisible(el) && isLoginField(el)) attachField(el); });
  }

  document.addEventListener("click", (e) => {
    if (!e.target.closest(`#${MENU_ID},#${FAB_ID}`)) removeMenu();
  });

  // ─── Boot ────────────────────────────────────────────────────
  createFab();
  scan();
  new MutationObserver(() => { createFab(); scan(); })
    .observe(document.documentElement, { childList: true, subtree: true });
})();
