/* Payaco web app - no external dependencies.
   Talks to Supabase Auth + REST directly. All permissions are enforced in the database (RLS). */
(() => {
  "use strict";
  const CFG = window.PAYACO_CONFIG;
  const $app = document.getElementById("app");

  /* ------------------------------------------------------------------ storage */
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  /* ------------------------------------------------------------------ helpers */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const FA = "۰۱۲۳۴۵۶۷۸۹";
  const fa = (s) => String(s ?? "").replace(/\d/g, (d) => FA[d]);
  const toEn = (s) => String(s ?? "").replace(/[۰-۹]/g, (d) => FA.indexOf(d)).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
  const nf = new Intl.NumberFormat("fa-IR");
  // text from the database: Persian digits, and document numbers like 0507-08/12 kept left-to-right
  const txt = (s) => esc(fa(s)).replace(/([۰-۹]{4}-[۰-۹]{2}\/[۰-۹]+)/g, '<bdi dir="ltr">$1</bdi>');
  const num = (n) => nf.format(Number(n || 0));
  const parseAmount = (s) => { const v = Number(toEn(s).replace(/[^\d]/g, "")); return Number.isFinite(v) ? v : 0; };

  function money(rial, opts = {}) {
    const r = Number(rial || 0);
    return `<span class="amount ${opts.cls || ""}">${num(Math.round(r / 10))} تومان<span class="rial">${num(r)} ریال</span></span>`;
  }
  function balanceBadge(rial) {
    const r = Number(rial || 0);
    if (r > 0) return `<span class="badge danger">بدهکار</span>`;
    if (r < 0) return `<span class="badge ok">بستانکار</span>`;
    return `<span class="badge">تسویه</span>`;
  }

  // internal documents may carry a credit (customer in credit) instead of a debt
  function docAmount(i) {
    const cr = (i.invoice_items || []).filter((it) => it.debit_credit === "credit").reduce((a, it) => a + Number(it.amount_rial), 0);
    if (INTERNAL_DOC.includes(i.document_type) && cr > 0) return `<span class="credit">${money(cr)}</span><div class="small credit">بستانکار</div>`;
    return money(i.total_rial);
  }

  /* Dates: database stores Gregorian; everything shown and entered in Shamsi. */
  const jFmt = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" });
  const jFmtTime = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tehran" });
  const jdate = (d) => (d ? jFmt.format(new Date(String(d).slice(0, 10) + "T12:00:00Z")) : "—");
  const jtime = (d) => (d ? jFmtTime.format(new Date(d)).replace("، ", " · ").replace(", ", " · ") : "—");
  const todayTehran = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(new Date());

  // Jalali <-> Gregorian (jalaali algorithm; same rules as the database calendar table)
  const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
  const div = (a, b) => ~~(a / b);
  const mod = (a, b) => a - ~~(a / b) * b;
  function jalCal(jy) {
    const gy = jy + 621; let leapJ = -14, jp = BREAKS[0], jump = 0;
    for (let i = 1; i < BREAKS.length; i++) {
      const jm = BREAKS[i]; jump = jm - jp; if (jy < jm) break;
      leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4); jp = jm;
    }
    let n = jy - jp;
    leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    const march = 20 + leapJ - leapG;
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    let leap = mod(mod(n + 1, 33) - 1, 4); if (leap === -1) leap = 4;
    return { gy, march, leap };
  }
  function g2d(gy, gm, gd) {
    let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
    return d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  }
  function d2g(jdn) {
    let j = 4 * jdn + 139361631; j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    const i = div(mod(j, 1461), 4) * 5 + 308;
    const gd = div(mod(i, 153), 5) + 1, gm = mod(div(i, 153), 12) + 1;
    const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
    return { gy, gm, gd };
  }
  function j2g(jy, jm, jd) {
    const r = jalCal(jy);
    const jdn = g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
    return d2g(jdn);
  }
  function g2j(gy, gm, gd) {
    const jdn = g2d(gy, gm, gd); let jy = d2g(jdn).gy - 621; let r = jalCal(jy);
    let k = jdn - g2d(r.gy, 3, r.march);
    if (k >= 0) { if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 }; k -= 186; }
    else { jy -= 1; k += 179; if (jalCal(jy).leap === 0) k += 1; }
    return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
  }
  const jMonthLen = (jy, jm) => (jm <= 6 ? 31 : jm <= 11 ? 30 : (jalCal(jy).leap === 0 ? 30 : 29));
  const pad = (n) => String(n).padStart(2, "0");
  const MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

  function datePickerHtml(name, isoDate) {
    const [y, m, d] = (isoDate || todayTehran()).split("-").map(Number);
    const j = g2j(y, m, d);
    const years = []; for (let yy = j.jy - 2; yy <= j.jy + 1; yy++) years.push(yy);
    return `<div class="date-picker" data-date="${name}">
      <select data-part="d">${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${i + 1 === j.jd ? "selected" : ""}>${fa(i + 1)}</option>`).join("")}</select>
      <select data-part="m">${MONTHS.map((mn, i) => `<option value="${i + 1}" ${i + 1 === j.jm ? "selected" : ""}>${mn}</option>`).join("")}</select>
      <select data-part="y">${years.map((yy) => `<option value="${yy}" ${yy === j.jy ? "selected" : ""}>${fa(yy)}</option>`).join("")}</select>
    </div>`;
  }
  function readDate(root, name) {
    const el = root.querySelector(`[data-date="${name}"]`);
    const jy = +el.querySelector('[data-part="y"]').value, jm = +el.querySelector('[data-part="m"]').value;
    const jd = Math.min(+el.querySelector('[data-part="d"]').value, jMonthLen(jy, jm));
    const g = j2g(jy, jm, jd);
    return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
  }

  /* Amount input with toman/rial switch; database always receives rial. */
  function amountFieldHtml(name, label) {
    return `<label>${esc(label)}</label>
      <div class="row"><input type="text" inputmode="numeric" data-amount="${name}" class="ltr" placeholder="0" style="flex:1">
        <div class="seg" data-unit="${name}"><button type="button" data-u="toman" class="on">تومان</button><button type="button" data-u="rial">ریال</button></div></div>
      <div class="hint" data-preview="${name}">مبلغ را وارد کنید</div>`;
  }
  function bindAmount(root, name) {
    const input = root.querySelector(`[data-amount="${name}"]`), seg = root.querySelector(`[data-unit="${name}"]`), prev = root.querySelector(`[data-preview="${name}"]`);
    const update = () => {
      const v = parseAmount(input.value), unit = seg.querySelector(".on").dataset.u;
      if (v) input.value = nf.format(v);
      const rial = unit === "toman" ? v * 10 : v;
      prev.textContent = v ? `معادل ${num(rial)} ریال (${num(Math.round(rial / 10))} تومان) — مبنای ثبت: ریال` : "مبلغ را وارد کنید";
    };
    input.addEventListener("input", update);
    seg.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); update(); });
  }
  function readAmount(root, name) {
    const v = parseAmount(root.querySelector(`[data-amount="${name}"]`).value);
    const unit = root.querySelector(`[data-unit="${name}"] .on`).dataset.u;
    return { value: v, unit: unit, rial: unit === "toman" ? v * 10 : v };
  }

  /* ------------------------------------------------------------------ labels */
  const ROLE = { CEO: "مدیرعامل", REPAIR_MANAGER: "مدیر تعمیرات", EMPLOYEE: "کارمند", TECHNICIAN: "تکنسین", BUILDING_MANAGER: "مدیر ساختمان", EMPLOYER: "کارفرما", CLIENT: "مشتری" };
  const FAULT_STATUS = { reported: ["ثبت‌شده", "warn"], assigned: ["ارجاع‌شده", "info"], in_progress: ["در حال تعمیر", "info"], repaired: ["رفع‌شده", "ok"], closed: ["بسته", ""], cancelled: ["لغو", ""] };
  const PRIORITY = { emergency: ["اضطراری", "danger"], high: ["بالا", "warn"], normal: ["عادی", ""], low: ["کم", ""] };
  const SERVICE_STATUS = { scheduled: ["برنامه‌ریزی", ""], completed: ["انجام‌شده", "info"], pending_confirmation: ["منتظر تأیید", "warn"], confirmed: ["تأییدشده", "ok"], rejected: ["ردشده", "danger"], missed: ["انجام‌نشده", "danger"], cancelled: ["لغو", ""] };
  const INVOICE_STATUS = { draft: ["پیش‌نویس", ""], issued: ["پرداخت‌نشده", "warn"], partially_paid: ["پرداخت ناقص", "info"], paid: ["پرداخت‌شده", "ok"], cancelled: ["ابطال‌شده", ""] };
  const DOC_TYPE = { statement: "صورتحساب سرویس", repair_invoice: "فاکتور تعمیر", proforma: "پیش‌فاکتور", final_invoice: "فاکتور نهایی",
    opening_balance: "سند افتتاحیه (داخلی)", balance_transfer: "انتقال مانده (داخلی)" };
  const INTERNAL_DOC = ["opening_balance", "balance_transfer"];
  const METHOD = { bank_transfer: "انتقال بانکی", card: "کارت", cash: "نقد", cheque: "چک", other: "سایر" };
  const CONTRACT_STATUS = { active: ["فعال", "ok"], expired: ["تمام‌شده", ""], draft: ["پیش‌نویس", ""], terminated: ["فسخ‌شده", "danger"], suspended: ["معلق", "warn"] };
  const badge = (map, key) => { const v = map[key] || [key, ""]; return `<span class="badge ${v[1]}">${esc(v[0])}</span>`; };

  /* ------------------------------------------------------------------ auth + api */
  let session = store.get("payaco.session");
  const state = { profile: null, techs: null, contracts: null };

  class AuthError extends Error {}

  async function authCall(path, body, token) {
    const res = await fetch(`${CFG.supabaseUrl}/auth/v1/${path}`, {
      method: "POST",
      headers: { apikey: CFG.supabaseKey, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body || {})
    });
    const txt = await res.text(); const data = txt ? JSON.parse(txt) : {};
    if (!res.ok) throw new Error(translateError(data));
    return data;
  }
  function saveSession(d) {
    session = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (d.expires_in || 3600), user_id: d.user && d.user.id, email: d.user && d.user.email };
    store.set("payaco.session", session);
  }
  function clearSession() { session = null; state.profile = null; state.techs = null; state.contracts = null; state.myTech = undefined; store.del("payaco.session"); }
  async function token() {
    if (!session) throw new AuthError("not signed in");
    if (session.expires_at - 60 < Date.now() / 1000) {
      try { saveSession(await authCall("token?grant_type=refresh_token", { refresh_token: session.refresh_token })); }
      catch (e) { clearSession(); throw new AuthError("session expired"); }
    }
    return session.access_token;
  }
  async function api(path, { method = "GET", body, prefer } = {}) {
    const t = await token();
    const res = await fetch(`${CFG.supabaseUrl}/rest/v1/${path}`, {
      method,
      headers: { apikey: CFG.supabaseKey, Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (res.status === 401) { clearSession(); route(); throw new AuthError("unauthorized"); }
    const txt = await res.text(); const data = txt ? JSON.parse(txt) : null;
    if (!res.ok) throw new Error(translateError(data));
    return data;
  }
  const rpc = (fn, args) => api(`rpc/${fn}`, { method: "POST", body: args || {} });
  async function callFunction(name, body) {
    const t = await token();
    const res = await fetch(`${CFG.supabaseUrl}/functions/v1/${name}`, {
      method: "POST",
      headers: { apikey: CFG.supabaseKey, Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });
    const txt = await res.text(); let data = {}; try { data = txt ? JSON.parse(txt) : {}; } catch (e) { data = { error: txt }; }
    if (!res.ok) throw new Error(data.error || data.message || "خطا در ارتباط با سرور");
    return data;
  }
  function randomPassword() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    const a = new Uint32Array(10); crypto.getRandomValues(a);
    return Array.from(a, (x) => chars[x % chars.length]).join("");
  }

  function translateError(d) {
    const msg = (d && (d.message || d.msg || d.error_description || d.error)) || "خطای ناشناخته";
    if (/Invalid login credentials/i.test(msg)) return "نام کاربری یا رمز عبور نادرست است";
    if (/Email not confirmed/i.test(msg)) return "ایمیل هنوز تأیید نشده است";
    if (d && d.code === "42501" || /permission denied|row-level security/i.test(msg)) return "اجازه‌ی این کار را ندارید";
    if (d && d.code === "23505") return "این مورد قبلاً ثبت شده است (تکراری)";
    if (/Failed to fetch|NetworkError/i.test(msg)) return "اتصال به سرور برقرار نشد";
    return msg;
  }

  /* ------------------------------------------------------------------ ui utils */
  let toastTimer;
  function toast(msg) {
    const el = document.getElementById("toast"); el.textContent = msg; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  }
  function sheet(html, onMount) {
    const wrap = document.createElement("div");
    wrap.className = "sheet-backdrop";
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => wrap.remove();
    wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.closest("[data-close]")) close(); });
    document.body.appendChild(wrap);
    if (onMount) onMount(wrap.querySelector(".sheet"), close);
    return close;
  }
  async function guarded(btn, fn) {
    const old = btn.textContent; btn.disabled = true; btn.textContent = "در حال ثبت…";
    try { await fn(); } catch (e) { if (!(e instanceof AuthError)) toast(e.message); } finally { btn.disabled = false; btn.textContent = old; }
  }
  const role = () => (state.profile ? state.profile.role : null);
  const displayLogin = () => (state.profile && state.profile.username) || (session && session.email ? session.email.replace(/@users\.payaco\.org$/, "") : "");
  const isStaff = () => ["CEO", "REPAIR_MANAGER", "EMPLOYEE"].includes(role());
  const isExternal = () => ["BUILDING_MANAGER", "EMPLOYER", "CLIENT"].includes(role());
  const can = {
    approveService: () => ["CEO", "REPAIR_MANAGER"].includes(role()) || isExternal(),
    recordMissed: () => ["CEO", "REPAIR_MANAGER"].includes(role()),
    recordPayment: () => ["CEO", "EMPLOYEE"].includes(role()),
    cancelInvoice: () => role() === "CEO",
    reportFault: () => isStaff() || isExternal(),
    manageFaults: () => isStaff(),
    manageUsers: () => role() === "CEO",
    changeContract: () => ["CEO", "EMPLOYEE"].includes(role())
  };

  async function loadContracts() {
    if (!state.contracts) state.contracts = await api("v_contract_overview?select=id,contract_code,subscription_code,building_id,building_name,customer_name,status,services_per_month&status=eq.active&order=contract_code");
    return state.contracts;
  }
  async function loadTechs() {
    if (!state.techs) state.techs = await api("technicians?select=id,name,mobile,skills,status,user_id,notes&order=name");
    return state.techs;
  }
  const SKILL = { service: "سرویس‌کار", electrical: "تعمیرکار برق", mechanical: "تعمیرکار مکانیک" };
  const skillText = (t) => (t.skills || []).map((k) => SKILL[k] || k).join("، ");
  function contractSelectHtml(contracts, name = "contract") {
    return `<select data-field="${name}">${contracts.map((c) => `<option value="${c.id}">${esc(fa(c.contract_code))} — ${esc(c.building_name || "")}</option>`).join("")}</select>`;
  }

  /* ------------------------------------------------------------------ layout */
  // line icons (24px grid, stroke = currentColor)
  const ICONS = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5"/><path d="M12 18v.01"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
    doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 12h7M9 16h7"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5a4 4 0 0 0-2-2z"/>',
    siren: '<path d="M7 18v-6a5 5 0 0 1 10 0v6"/><path d="M5 18h14v3H5z"/><path d="M12 2v2M4.2 5.2l1.4 1.4M19.8 5.2l-1.4 1.4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    building: '<path d="M5 21V4h10v17"/><path d="M15 9h4v12"/><path d="M8 8h1M11 8h1M8 12h1M11 12h1M8 16h1M11 16h1"/><path d="M3 21h18"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    wallet: '<path d="M4 7h15a1 1 0 0 1 1 1v11H4a1 1 0 0 1-1-1V6a2 2 0 0 1 2-2h12v3"/><path d="M16 13h.01"/>',
    up: '<path d="M12 4l7 9H5z"/>'
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ""}</svg>`;
  function tabsFor() {
    if (role() === "TECHNICIAN") return [["faults", "wrench", "کارهای من"], ["services", "check", "سرویس‌ها"], ["more", "more", "بیشتر"]];
    if (isExternal()) return [["dashboard", "home", "خانه"], ["services", "check", "سرویس‌ها"], ["faults", "alert", "خرابی‌ها"], ["contracts", "doc", "صورتحساب"], ["more", "more", "بیشتر"]];
    return [["dashboard", "home", "داشبورد"], ["faults", "alert", "خرابی‌ها"], ["services", "check", "سرویس‌ها"], ["contracts", "doc", "قراردادها"], ["more", "more", "بیشتر"]];
  }
  function shell(title, current, body) {
    const p = state.profile;
    return `<header class="topbar"><div class="brand"><img src="icons/mark.png" alt="پایاکو" class="logo"><div><h1>${esc(title)}</h1>
      <div class="who">${esc(p.full_name || displayLogin())} · ${esc(ROLE[p.role] || p.role)}</div></div></div></header>
      <main id="view">${body}</main>
      <nav class="tabbar"><div class="side-brand"><img src="icons/logo.png" alt="پایاکو - آسانسور و پله‌برقی"></div>
        ${tabsFor().map(([k, ico, label]) => `<a href="#/${k}" class="${current === k ? "on" : ""}"><span class="ico">${icon(ico)}</span>${label}</a>`).join("")}
        <div class="side-foot">${esc(p.full_name || "")}<br><span>${esc(ROLE[p.role] || p.role)}</span></div></nav>`;
  }

  /* ------------------------------------------------------------------ views */
  // designer credit shown on the login screen and the settings page
  const NIMA_CREDIT = `<div class="nima-credit"><picture><source srcset="icons/nima-mark-dark.png" media="(prefers-color-scheme: dark)"><img src="icons/nima-mark.png" alt="" width="21" height="16"></picture><span>طراحی و توسعه: <bdi class="nima-name">NiMa</bdi></span></div>`;
  function viewLogin(error) {
    $app.innerHTML = `<div class="login-wrap"><form class="login-card" id="login">
      <img src="icons/logo.png" alt="پایاکو - آسانسور و پله‌برقی" class="login-logo"><p class="muted small">سامانه‌ی جامع اتوماسیون اداری پایاکو</p>
      <label for="email">نام کاربری</label><input id="email" type="text" class="ltr" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>
      <label for="password">رمز عبور</label><input id="password" type="password" class="ltr" autocomplete="current-password" required>
      <div style="height:14px"></div><button class="btn block" type="submit">ورود</button>
      ${error ? `<div class="error-box">${esc(error)}</div>` : ""}
      <p class="muted small" style="margin-top:14px">نسخه ${fa(CFG.version)}</p>${NIMA_CREDIT}</form></div>`;
    document.getElementById("login").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector("button");
      btn.disabled = true; btn.textContent = "در حال ورود…";
      try {
        const login = toEn(document.getElementById("email").value.trim().toLowerCase());
        const email = login.includes("@") ? login : `${login}@users.payaco.org`;
        saveSession(await authCall("token?grant_type=password", { email, password: document.getElementById("password").value }));
        location.hash = "#/";
        route();
      } catch (err) { viewLogin(err.message); }
    });
  }

  async function viewDashboard() {
    const d = await rpc("get_dashboard");
    const urgent = await api("faults?select=id,fault_number,fault_description,priority,status,reported_at,buildings(name)&status=in.(reported,assigned,in_progress)&order=priority.asc,reported_at.desc&limit=5");
    const stats = [];
    const st = (ico, label, v, cls = "") => `<div class="stat ${cls}"><span class="stat-ico">${icon(ico)}</span><div class="label">${label}</div><div class="value">${num(v)}</div></div>`;
    stats.push(st("siren", "خرابی اضطراری باز", d.emergency_faults, d.emergency_faults ? "danger" : "calm"));
    stats.push(st("alert", "خرابی‌های باز", d.open_faults, "tone-info"));
    stats.push(st("clock", "سرویس منتظر تأیید", d.pending_services, d.pending_services ? "warn" : "calm"));
    stats.push(st("receipt", "اسناد پرداخت‌نشده", d.open_invoices, "tone-brand"));
    if (isStaff()) {
      stats.push(st("building", "قرارداد فعال", d.active_contracts, "tone-brand"));
      stats.push(st("calendar", "پایان قرارداد تا ۳۰ روز", d.expiring_contracts, d.expiring_contracts ? "warn" : "calm"));
    }
    if (d.receivable_rial !== null && d.receivable_rial !== undefined) {
      stats.push(`<div class="stat wide money-stat"><span class="stat-ico">${icon("wallet")}</span><div class="label">${isExternal() ? "مانده حساب شما" : "مانده کل مطالبات"}</div><div class="value">${money(d.receivable_rial)}</div></div>`);
    }
    let closeNote = "";
    if (["CEO", "EMPLOYEE"].includes(role())) {
      try {
        const [setting] = await api("app_settings?key=eq.billing_start&select=value");
        const t = toEn(todayTehran()).split("-").map(Number), tj = g2j(t[0], t[1], t[2]);
        const prevYM = tj.jm === 1 ? (tj.jy - 1) * 100 + 12 : tj.jy * 100 + tj.jm - 1;
        const [sy, sm] = (setting ? setting.value : "1405-08").split("-").map(Number);
        if (prevYM >= sy * 100 + sm) {
          const c = await api(`month_closes?jalali_year=eq.${Math.floor(prevYM / 100)}&jalali_month=eq.${prevYM % 100}&status=eq.closed&select=id`);
          if (!c.length) closeNote = `<div class="card tap" data-act="go-close" style="border-color:var(--warn)"><div class="item-title">ماه ${MONTHS[prevYM % 100 - 1]} ${fa(Math.floor(prevYM / 100))} هنوز بسته نشده</div><div class="small muted">برای ثبت سرویس‌های انجام‌نشده و صدور صورتحساب‌ها، ماه را ببندید.</div></div>`;
        }
      } catch (e) { /* reminder only */ }
    }
    if (can.recordPayment()) {
      try {
        const pc = await api("payment_claims?status=eq.pending&select=id");
        if (pc.length) closeNote += `<div class="card tap" data-act="go-claims" style="border-color:var(--ok)"><div class="item-title">${fa(pc.length)} اعلام پرداخت منتظر بررسی</div><div class="small muted">مشترک‌ها واریز کرده‌اند؛ پس از بررسی حساب بانکی تأیید کنید.</div></div>`;
      } catch (e) { /* reminder only */ }
    }
    const quick = [];
    if (can.reportFault()) quick.push(`<button class="btn" data-act="new-fault">+ ثبت خرابی</button>`);
    if (isStaff()) quick.push(`<button class="btn secondary" data-act="new-service">+ ثبت گزارش سرویس</button>`);
    const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Tehran" }).format(new Date()));
    const focus = d.emergency_faults ? [d.emergency_faults, "خرابی اضطراری"] : d.pending_services ? [d.pending_services, "سرویس منتظر تأیید"] : [d.open_faults || 0, "خرابی باز"];
    const greet = hour < 12 ? "صبح بخیر" : hour < 17 ? "روز بخیر" : "عصر بخیر";
    return shell("داشبورد", "dashboard", `
      <div class="hero"><div class="hero-txt"><div class="hero-t">سلام ${esc((state.profile.full_name || "").split(" ")[0])}، ${greet}</div><div class="hero-s">${(() => { const t = toEn(todayTehran()).split("-").map(Number), j = g2j(t[0], t[1], t[2]); return `${new Intl.DateTimeFormat("fa-IR", { weekday: "long", timeZone: "Asia/Tehran" }).format(new Date())} ${fa(j.jd)} ${MONTHS[j.jm - 1]} ${fa(j.jy)}`; })()}</div><div class="hero-slogan">با شما تا اوج...</div></div><div class="floor-ind" aria-label="${esc(focus[1])}: ${num(focus[0])}"><div class="floor-screen"><span class="floor-arrow">${icon("up")}</span><span class="floor-num">${num(focus[0])}</span></div><div class="floor-lbl">${focus[1]}</div></div></div>
      ${closeNote}<div class="stats">${stats.join("")}</div>
      <div class="actions">${quick.join("")}</div>
      <div class="section-title"><h2>خرابی‌های باز</h2><a href="#/faults" class="small">همه</a></div>
      ${urgent.length ? urgent.map(faultCard).join("") : `<div class="card empty">خرابی بازی وجود ندارد</div>`}`);
  }

  function faultCard(f) {
    return `<div class="card tap" data-act="open-fault" data-id="${f.id}">
      <div class="item-head"><div><div class="item-title">${esc(f.buildings ? f.buildings.name : "")}</div>
      <div class="small muted">${txt(f.fault_description || "")}</div></div>
      <div style="text-align:left">${badge(PRIORITY, f.priority)}<div style="height:4px"></div>${badge(FAULT_STATUS, f.status)}</div></div>
      <div class="small muted">${f.fault_number ? "شماره " + esc(fa(f.fault_number)) + " · " : ""}${jtime(f.reported_at)}</div></div>`;
  }

  let faultFilter = "open";
  async function viewFaults() {
    const filters = { open: "&status=in.(reported,assigned,in_progress)", emergency: "&priority=eq.emergency&status=in.(reported,assigned,in_progress)", all: "" };
    const list = await api(`faults?select=id,fault_number,fault_description,priority,status,reported_at,buildings(name)&order=reported_at.desc&limit=100${filters[faultFilter]}`);
    const chips = [["open", "باز"], ["emergency", "اضطراری"], ["all", "همه"]];
    return shell(role() === "TECHNICIAN" ? "کارهای من" : "خرابی‌ها", "faults", `
      <div class="row">${can.reportFault() ? `<button class="btn" data-act="new-fault">+ ثبت خرابی</button>` : ""}</div>
      <div style="height:10px"></div>
      <div class="chips">${chips.map(([k, l]) => `<button data-act="fault-filter" data-k="${k}" class="${faultFilter === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${list.length ? list.map(faultCard).join("") : `<div class="card empty">موردی نیست</div>`}`);
  }

  let serviceFilter = "pending";
  async function viewServices() {
    const filt = serviceFilter === "pending" ? "&status=eq.pending_confirmation" : "";
    const list = await api(`service_reports?select=id,report_number,service_date,service_year,service_month,status,report_text,notes,rejection_note,contract_id,contracts(contract_code,buildings(name))&order=service_date.desc,id.desc&limit=100${filt}`);
    const chips = [["pending", "منتظر تأیید"], ["all", "همه"]];
    const top = [];
    if (isStaff()) top.push(`<button class="btn" data-act="go-plan">برنامه و ارجاع سرویس</button>`, `<button class="btn secondary" data-act="new-service">+ گزارش سرویس</button>`);
    if (can.recordMissed()) top.push(`<button class="btn secondary" data-act="new-missed">ثبت سرویس انجام‌نشده</button>`);
    return shell("سرویس‌ها", "services", `
      <div class="row">${top.join("")}</div><div style="height:10px"></div>
      <div class="chips">${chips.map(([k, l]) => `<button data-act="service-filter" data-k="${k}" class="${serviceFilter === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${list.length ? list.map(serviceCard).join("") : `<div class="card empty">موردی نیست</div>`}`);
  }
  function serviceCard(s) {
    const c = s.contracts || {};
    const period = s.service_year ? `${MONTHS[s.service_month - 1]} ${fa(s.service_year)}` : "";
    const approve = s.status === "pending_confirmation" && can.approveService()
      ? `<div class="actions"><button class="btn ok small" data-act="approve" data-id="${s.id}">تأیید سرویس</button><button class="btn secondary small" data-act="reject" data-id="${s.id}">رد</button></div>` : "";
    return `<div class="card"><div class="item-head"><div><div class="item-title">${esc(c.buildings ? c.buildings.name : "")}</div>
      <div class="small muted">قرارداد ${esc(fa(c.contract_code || ""))} · سرویس ${esc(period)}</div></div>${badge(SERVICE_STATUS, s.status)}</div>
      <div class="small">تاریخ: ${jdate(s.service_date)}${s.report_number ? " · گزارش " + esc(fa(s.report_number)) : ""}</div>
      ${s.report_text ? `<div class="small muted">${txt(s.report_text)}</div>` : ""}
      ${s.rejection_note ? `<div class="small debt">دلیل رد: ${esc(s.rejection_note)}</div>` : ""}
      ${s.notes ? `<div class="small muted">${txt(s.notes)}</div>` : ""}${approve}</div>`;
  }

  let contractSearch = "";
  async function viewContracts() {
    const list = await api("v_contract_overview?select=*&order=contract_code");
    const held = isStaff() ? new Set((await api("contracts?billing_hold=eq.true&select=id")).map((x) => x.id)) : new Set();
    const q = toEn(contractSearch).trim();
    const shown = q ? list.filter((c) => [c.contract_code, c.subscription_code, c.building_name, c.customer_name, c.manager_name].some((v) => toEn(v || "").includes(q))) : list;
    return shell(isExternal() ? "صورتحساب‌ها" : "قراردادها", "contracts", `
      ${list.length > 3 ? `<input type="search" id="csearch" placeholder="جست‌وجو: کد قرارداد، ساختمان، مدیر ساختمان" value="${esc(contractSearch)}"><div style="height:10px"></div>` : ""}
      ${shown.length ? shown.map((c) => `<div class="card tap" data-act="open-contract" data-id="${c.id}" data-search="${esc(toEn([c.contract_code, c.subscription_code, c.building_name, c.customer_name, c.manager_name].join(" ")))}">
        <div class="item-head"><div class="with-key"><span class="call-key" title="کد قرارداد">${esc(fa(String(c.contract_code).split("-")[0]))}</span><div><div class="item-title">${esc(c.building_name || "")}</div>
        <div class="small muted">قرارداد ${esc(fa(c.contract_code))} · ${esc(c.customer_name || "")}${c.status !== "active" ? " " + badge(CONTRACT_STATUS, c.status) : ""}${held.has(c.id) ? ` <span class="badge warn">صورتحساب معلق</span>` : ""}</div></div></div>
        <div style="text-align:left">${money(Math.abs(c.balance_rial), { cls: c.balance_rial > 0 ? "debt" : c.balance_rial < 0 ? "credit" : "" })}${balanceBadge(c.balance_rial)}</div></div></div>`).join("") : `<div class="card empty">قراردادی پیدا نشد</div>`}`);
  }

  async function viewContract(id) {
    const [c] = await api(`v_contract_overview?id=eq.${id}&select=*`);
    if (!c) return shell("قرارداد", "contracts", `<div class="card empty">پیدا نشد یا دسترسی ندارید</div>`);
    const allInvoices = await api(`invoices?contract_id=eq.${id}&select=id,document_type,document_number,issue_date,total_rial,status,opening_balance_rial,invoice_items(description,amount_rial,debit_credit)&order=issue_date.desc,id.desc`);
    // drafts (opening balances waiting for approval) are shown to the CEO only
    const invoices = allInvoices.filter((i) => i.status !== "draft" || role() === "CEO");
    const [next] = await api(`contracts?previous_contract_id=eq.${id}&select=id,contract_code`);
    const [hold] = await api(`contracts?id=eq.${id}&select=billing_hold,billing_hold_reason`);
    const prev = c.previous_contract_id ? (await api(`contracts?id=eq.${c.previous_contract_id}&select=id,contract_code`))[0] : null;
    const opening = allInvoices.find((i) => i.document_type === "opening_balance" && i.status !== "cancelled");
    const changes = isStaff() ? await api(`contract_change_requests?contract_id=eq.${id}&select=id,kind,payload,status,document_number,requested_at,decided_at,decision_note&order=id.desc`) : [];
    const terms = await api(`contract_terms?contract_id=eq.${id}&select=effective_ym,monthly_amount_rial,missed_service_deduction_rial,services_per_month,source&order=effective_ym`);
    const files = await api(`documents?contract_id=eq.${id}&storage_path=not.is.null&select=id,document_type,file_name,storage_path,uploaded_at,notes,change_request_id&order=uploaded_at.desc`);
    const ledger = await api(`ledger?contract_id=eq.${id}&select=id,transaction_date,description,debit_rial,credit_rial&order=transaction_date.asc,id.asc`);
    let run = 0;
    const rows = ledger.map((l) => { run += Number(l.debit_rial) - Number(l.credit_rial); return { ...l, run }; }).reverse();
    const open = invoices.filter((i) => ["issued", "partially_paid"].includes(i.status));
    const actions = [];
    if (can.recordPayment() && invoices.some((i) => !["cancelled", "draft"].includes(i.status) && Number(i.total_rial) > 0)) actions.push(`<button class="btn ok" data-act="pay" data-id="${id}">ثبت دریافت وجه</button>`);
    if (role() === "CEO" && (!opening || opening.status === "draft")) actions.push(`<button class="btn secondary" data-act="opening" data-id="${id}">${opening ? "مانده افتتاحیه (پیش‌نویس)" : "+ مانده افتتاحیه"}</button>`);
    actions.push(`<button class="btn secondary" data-act="contract-report" data-id="${id}">گزارش عملکرد</button>`);
    if (role() === "CEO" && hold && !hold.billing_hold && c.status === "active") actions.push(`<button class="btn secondary" data-act="set-hold" data-id="${id}">تعلیق صورتحساب</button>`);
    if (can.changeContract()) {
      actions.push(`<button class="btn secondary" data-act="edit-contract" data-id="${id}">ویرایش اطلاعات</button>`);
      if (c.status === "active") actions.push(`<button class="btn secondary" data-act="amend" data-id="${id}">الحاقیه</button>`);
      if (!next && ["active", "expired"].includes(c.status)) actions.push(`<button class="btn secondary" data-act="renew" data-id="${id}">تمدید قرارداد</button>`);
    }
    const locCard = ["BUILDING_MANAGER", "EMPLOYER"].includes(role()) ? `<div class="card"><div class="item-title">موقعیت ساختمان برای مسیریابی سرویس‌کار</div>
      <div class="small muted">داخل یا جلوی ساختمان دکمه را بزنید؛ پس از تأیید مدیر تعمیرات، سرویس‌کارها با یک لمس مسیریابی می‌کنند.</div>
      <div class="actions"><button class="btn secondary small" data-act="send-location" data-bid="${c.building_id}">ارسال موقعیت ساختمان</button></div></div>` : "";
    return shell(`قرارداد ${fa(c.contract_code)}`, "contracts", `${locCard}
      <a href="#/contracts" class="small">→ بازگشت</a>
      <div class="card" style="margin-top:8px"><div class="item-head"><div><div class="item-title">${esc(c.building_name || "")}</div>
        <div class="small muted">${esc(c.building_address || "")}</div></div><div style="text-align:left">${balanceBadge(c.balance_rial)}${c.status !== "active" ? `<div style="height:4px"></div>${badge(CONTRACT_STATUS, c.status)}` : ""}</div></div>
        ${next ? `<div class="small">تمدید شد: <a href="#/contract/${next.id}">قرارداد ${esc(fa(next.contract_code))}</a></div>` : ""}
        ${prev ? `<div class="small muted">دوره قبل: <a href="#/contract/${prev.id}">قرارداد ${esc(fa(prev.contract_code))}</a></div>` : ""}
        ${hold && hold.billing_hold && isStaff() ? `<div class="error-box" style="margin:8px 0">صورتحساب این قرارداد معلق است: ${esc(hold.billing_hold_reason || "")}<div class="small">سرویس‌ها ثبت می‌شوند ولی صورتحساب صادر نمی‌شود؛ با رفع تعلیق، صورتحساب‌های عقب‌افتاده صادر می‌شوند.</div>
          ${role() === "CEO" ? `<div class="actions"><button class="btn ok small" data-act="release-hold" data-id="${id}">رفع تعلیق و صدور صورتحساب‌ها</button></div>` : ""}</div>` : ""}
        <div style="margin:8px 0" class="${c.balance_rial > 0 ? "debt" : c.balance_rial < 0 ? "credit" : ""}">مانده: ${money(Math.abs(c.balance_rial))}</div>
        <dl class="kv"><dt>مشتری</dt><dd>${esc(c.customer_name || "—")}</dd>
        <dt>مدیر ساختمان</dt><dd>${esc(c.manager_name || "—")} ${c.manager_mobile ? `<a href="tel:${esc(c.manager_mobile)}" class="ltr">${esc(fa(c.manager_mobile))}</a>` : ""}</dd>
        <dt>مدت</dt><dd>${jdate(c.start_date)} تا ${jdate(c.end_date)}</dd>
        <dt>شارژ ماهانه</dt><dd>${money(c.monthly_amount_rial)}</dd>
        <dt>کسر سرویس انجام‌نشده</dt><dd>${money(c.missed_service_deduction_rial)}</dd>
        <dt>سرویس در ماه</dt><dd>${fa(c.services_per_month)}</dd></dl>
        <div class="actions">${actions.join("")}</div></div>

      <div class="section-title"><h2>فایل‌های قرارداد</h2>${isStaff() ? `<button class="btn small secondary" data-act="attach" data-id="${id}">+ پیوست</button>` : ""}</div>
      ${files.length ? `<div class="card">${files.map((f) => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><div class="spacer"><div>${esc(FILE_TYPE[f.document_type] || f.document_type)}${f.change_request_id && changes.find((k) => k.id === f.change_request_id && k.document_number) ? ` <bdi dir="ltr">${esc(fa(changes.find((k) => k.id === f.change_request_id).document_number))}</bdi>` : ""}</div>
        <div class="small muted">${esc(f.file_name)} · ${jtime(f.uploaded_at)}${f.notes ? " · " + esc(f.notes) : ""}</div></div>
        <button class="btn small secondary" data-act="open-file" data-path="${esc(f.storage_path)}">مشاهده</button></div>`).join("")}</div>` : `<div class="card empty small">فایلی پیوست نشده${isStaff() ? "؛ نسخه‌ی امضاشده‌ی قرارداد را پیوست کنید" : ""}</div>`}
      ${changes.length ? `<div class="section-title"><h2>تغییرات قرارداد</h2></div>${changes.map(changeCard).join("")}` : ""}
      ${terms.length > 1 ? `<div class="section-title"><h2>شرایط مالی به ترتیب زمان</h2></div><div class="card"><table class="list"><tbody>${terms.map((t) => `<tr><td>از ${MONTHS[t.effective_ym % 100 - 1]} ${fa(Math.floor(t.effective_ym / 100))}<div class="small muted">${t.source === "amendment" ? "الحاقیه" : "قرارداد"}</div></td>
        <td style="text-align:left">${num(Math.round(t.monthly_amount_rial / 10))} تومان<div class="small muted">کسر ${num(Math.round(t.missed_service_deduction_rial / 10))} · ${fa(t.services_per_month)} سرویس</div></td></tr>`).join("")}</tbody></table></div>` : ""}

      <div class="section-title"><h2>اسناد</h2><span class="small muted">${fa(open.length)} باز</span></div>
      ${invoices.length ? invoices.map((i) => `<div class="card"><div class="item-head"><div><div class="item-title">${i.document_number ? `<bdi dir="ltr">${esc(fa(i.document_number))}</bdi>` : `<span class="muted">بدون شماره</span>`}</div>
        <div class="small muted">${DOC_TYPE[i.document_type] || i.document_type} · ${jdate(i.issue_date)}</div></div>
        <div style="text-align:left">${docAmount(i)}${INTERNAL_DOC.includes(i.document_type) && i.status !== "draft" && i.status !== "cancelled" ? `<span class="badge info">ثبت‌شده</span>` : badge(INVOICE_STATUS, i.status)}</div></div>
        ${(i.invoice_items || []).map((it) => `<div class="small">${txt(it.description)}</div>`).join("")}
        ${!INTERNAL_DOC.includes(i.document_type) && i.status !== "draft" ? `<div class="actions"><a class="btn secondary small" href="#/doc/${i.id}">مشاهده، چاپ و لینک پرداخت</a></div>` : ""}
        ${i.status === "draft" && i.document_type === "opening_balance" && role() === "CEO" ? `<div class="actions"><button class="btn ok small" data-act="post-opening" data-id="${i.id}">تأیید و ثبت در حساب</button><button class="btn secondary small" data-act="opening" data-id="${id}">ویرایش</button></div>` : ""}
        ${i.opening_balance_rial ? `<div class="small muted">مانده قبل از این سند: ${num(Math.round(i.opening_balance_rial / 10))} تومان</div>` : ""}
        ${can.cancelInvoice() && !["cancelled", "draft"].includes(i.status) && i.document_type !== "balance_transfer" ? `<div class="actions"><button class="btn secondary small" data-act="cancel-invoice" data-id="${i.id}" data-no="${esc(i.document_number || "")}">ابطال سند</button></div>` : ""}
        </div>`).join("") : `<div class="card empty">سندی صادر نشده</div>`}

      <div class="section-title"><h2>گردش حساب</h2></div>
      <div class="card">${rows.length ? `<table class="list"><tbody>${rows.map((r) => `<tr><td><div>${txt(r.description)}</div><div class="small muted">${jdate(r.transaction_date)}</div></td>
        <td style="text-align:left;white-space:nowrap">${r.debit_rial > 0 ? `<span class="debt">بدهکار ${num(Math.round(r.debit_rial / 10))}</span>` : `<span class="credit">بستانکار ${num(Math.round(r.credit_rial / 10))}</span>`}
        <div class="small muted">مانده ${num(Math.round(r.run / 10))}</div></td></tr>`).join("")}</tbody></table><div class="hint">مبالغ به تومان</div>` : `<div class="empty">گردشی ثبت نشده</div>`}</div>`);
  }

  async function viewMore() {
    const p = state.profile;
    let users = "";
    if (can.manageUsers()) {
      const list = await api("user_profiles?select=id,full_name,username,role,is_active&order=is_active.desc,full_name.asc");
      users = `<div class="section-title"><h2>کاربران</h2><button class="btn small" data-act="new-user">+ کاربر جدید</button></div>
        ${list.map((u) => `<div class="card"><div class="item-head"><div><div class="item-title">${esc(u.full_name || "بدون نام")}</div>
          <div class="small muted">${esc(ROLE[u.role] || u.role)}${u.username ? ` · <bdi dir="ltr">${esc(u.username)}</bdi>` : ""} ${u.is_active ? "" : "· غیرفعال"}</div></div>
          <button class="btn secondary small" data-act="edit-user" data-id="${u.id}">ویرایش</button></div></div>`).join("")}
        <div class="hint">کاربر جدید با نام کاربری و رمز اولیه ساخته می‌شود؛ هر دو را به خودش بدهید.</div>`;
    }
    const pendingChanges = role() === "CEO" ? (await api("contract_change_requests?status=eq.pending&select=id")).length : 0;
    const pendingLocs = ["CEO", "REPAIR_MANAGER"].includes(role()) ? (await rpc("pending_building_locations").catch(() => [])).length : 0;
    return shell("بیشتر", "more", `
      <div class="card"><div class="item-title">${esc(p.full_name || "")}</div><div class="small muted"><bdi dir="ltr">${esc(displayLogin())}</bdi> · ${esc(ROLE[p.role] || p.role)}</div>
      <div class="actions"><button class="btn secondary small" data-act="change-pw">تغییر رمز من</button><button class="btn danger small" data-act="logout">خروج از حساب</button></div></div>
      ${isStaff() ? `<div class="card tap" data-act="go-plan"><div class="item-head"><div><div class="item-title">برنامه و ارجاع سرویس</div>
        <div class="small muted">ارجاع سرویس‌های هر روز به سرویس‌کارها</div></div><span>←</span></div></div>` : ""}
      ${["CEO", "REPAIR_MANAGER"].includes(role()) ? `<div class="card tap" data-act="go-locations"><div class="item-head"><div><div class="item-title">موقعیت ساختمان‌ها</div>
        <div class="small muted">تأیید موقعیت‌های ارسالی برای مسیریابی</div></div>${pendingLocs ? `<span class="badge warn">${fa(pendingLocs)} منتظر</span>` : "<span>←</span>"}</div></div>` : ""}
      ${["CEO", "REPAIR_MANAGER"].includes(role()) ? `<div class="card tap" data-act="go-team"><div class="item-head"><div><div class="item-title">سرویس‌کارها و تعمیرکارها</div>
        <div class="small muted">تعریف، تخصص، فعال/غیرفعال${role() === "CEO" ? "، ساخت حساب ورود" : ""}</div></div><span>←</span></div></div>` : ""}
      ${role() === "CEO" ? `<div class="card tap" data-act="go-reports"><div class="item-head"><div><div class="item-title">گزارش‌های مالی</div>
        <div class="small muted">تراز بازه‌ای، بدهکاران، دریافت‌ها — با خروجی اکسل</div></div><span>←</span></div></div>` : ""}
      ${["CEO", "EMPLOYEE"].includes(role()) ? `<div class="card tap" data-act="go-close"><div class="item-head"><div><div class="item-title">بستن ماه</div>
        <div class="small muted">سرویس‌های انجام‌نشده و صورتحساب ماه</div></div><span>←</span></div></div>` : ""}
      ${role() === "CEO" ? `<div class="card tap" data-act="go-requests"><div class="item-head"><div><div class="item-title">درخواست‌های تغییر قرارداد</div>
        <div class="small muted">ویرایش، الحاقیه و تمدیدهای ثبت‌شده توسط کارمند</div></div>${pendingChanges ? `<span class="badge warn">${fa(pendingChanges)} منتظر</span>` : "<span>←</span>"}</div></div>` : ""}
      ${can.recordPayment() ? `<div class="card tap" data-act="go-claims"><div class="item-head"><div><div class="item-title">اعلام پرداخت مشتریان</div>
        <div class="small muted">واریزهایی که مشترک‌ها از لینک صورتحساب اعلام کرده‌اند</div></div><span>←</span></div></div>` : ""}
      ${role() === "CEO" ? `<div class="card tap" data-act="go-company"><div class="item-head"><div><div class="item-title">اطلاعات شرکت روی اسناد</div>
        <div class="small muted">تلفن، سایت، اینستاگرام، آدرس، شماره کارت و شبا</div></div><span>←</span></div></div>` : ""}
      ${role() === "CEO" ? `<div class="card tap" data-act="go-opening"><div class="item-head"><div><div class="item-title">مانده‌های افتتاحیه</div>
        <div class="small muted">بررسی و تأیید مانده‌ی حساب مشترکین تا پایان آبان ۱۴۰۵</div></div><span>←</span></div></div>` : ""}
      ${users}
      <div class="hint" style="margin-top:16px">برای نصب روی آیفون: در Safari دکمه اشتراک‌گذاری ← Add to Home Screen. نسخه ${fa(CFG.version)}</div>${NIMA_CREDIT}`);
  }

  /* ------------------------------------------------------------------ sheets (forms) */
  async function sheetNewFault() {
    const contracts = await loadContracts();
    if (!contracts.length) return toast("قراردادی برای ثبت خرابی در دسترس نیست");
    sheet(`<h3>ثبت خرابی</h3>
      <label>ساختمان / قرارداد</label>${contractSelectHtml(contracts)}
      <div data-field="unit-wrap"></div>
      <label>شرح خرابی</label><textarea data-field="desc" placeholder="مثلاً: آسانسور خاموش است / شخص داخل کابین گیر کرده"></textarea>
      <div class="hint">اولویت خودکار تعیین می‌شود: گیر افتادن شخص = اضطراری، خاموش = بالا.</div>
      ${isStaff() ? `<label>اعلام‌کننده (تلفنی)</label><input type="text" data-field="by" placeholder="نام و شماره تماس">` : ""}
      <div class="actions"><button class="btn" data-act="save">ثبت</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      // a contract with several elevators (e.g. one contract for six codes) asks which unit failed,
      // so the fault lands on that unit's own code and building
      let units = [];
      const sel = el.querySelector('[data-field="contract"]');
      const wrap = el.querySelector('[data-field="unit-wrap"]');
      const loadUnits = async () => {
        const id = sel.value;
        units = [];
        wrap.innerHTML = "";
        const rows = await api(`elevators?contract_id=eq.${id}&is_active=eq.true&select=elevator_no,subscription_code,building_id&order=elevator_no`);
        if (sel.value !== id) return;
        units = rows || [];
        if (units.length > 1) {
          wrap.innerHTML = `<label>کدام دستگاه؟</label><select data-field="unit"><option value="">— انتخاب کنید —</option>
            ${units.map((u, i) => `<option value="${i}">دستگاه ${esc(fa(u.elevator_no))}${u.subscription_code ? ` · کد ${esc(fa(u.subscription_code))}` : ""}</option>`).join("")}</select>`;
        }
      };
      sel.addEventListener("change", () => loadUnits().catch(() => {}));
      loadUnits().catch(() => {});
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const c = contracts.find((x) => String(x.id) === sel.value);
        let buildingId = c.building_id, code = c.subscription_code;
        if (units.length > 1) {
          const pick = el.querySelector('[data-field="unit"]');
          if (!pick || pick.value === "") throw new Error("دستگاه خراب را انتخاب کنید");
          const u = units[Number(pick.value)];
          buildingId = u.building_id || c.building_id;
          code = u.subscription_code || c.subscription_code;
        } else if (units.length === 1) {
          buildingId = units[0].building_id || c.building_id;
          code = units[0].subscription_code || c.subscription_code;
        }
        const desc = el.querySelector('[data-field="desc"]').value.trim();
        if (!desc) throw new Error("شرح خرابی را بنویسید");
        const by = el.querySelector('[data-field="by"]');
        const [f] = await api("faults", { method: "POST", prefer: "return=representation", body: {
          contract_id: c.id, building_id: buildingId, subscription_code: code,
          fault_description: desc, reported_by: by ? by.value.trim() || null : null,
          reported_by_user_id: session.user_id, status: "reported", reported_at: new Date().toISOString() } });
        close(); toast(`خرابی ثبت شد · اولویت: ${(PRIORITY[f.priority] || [f.priority])[0]}`); route();
      }));
    });
  }

  async function sheetFault(id) {
    const [f] = await api(`faults?id=eq.${id}&select=*,buildings(name,address,manager_name,manager_mobile),technicians(name,mobile)`);
    if (!f) return;
    const repairs = isStaff() ? await api(`repairs?fault_id=eq.${id}&select=id,status,labor_cost_rial,parts_cost_rial,description,invoice_id`) : [];
    const repair = repairs[0];
    const techs = can.manageFaults() ? await loadTechs() : [];
    const isTech = role() === "TECHNICIAN";
    const b = f.buildings || {};
    let actions = "";
    if (can.manageFaults() && !["closed", "cancelled"].includes(f.status)) {
      actions += `<label>ارجاع به تکنسین</label><div class="row"><select data-field="tech" style="flex:1"><option value="">— انتخاب —</option>
        ${techs.filter((t) => t.status === "active" || t.id === f.technician_id).map((t) => `<option value="${t.id}" ${t.id === f.technician_id ? "selected" : ""}>${esc(t.name)}${t.skills && t.skills.length ? " — " + esc(skillText(t)) : ""}</option>`).join("")}</select>
        <button class="btn small" data-act="assign">ارجاع</button></div>
        ${techs.length ? "" : `<div class="hint">هنوز تکنسینی ثبت نشده است.</div>`}`;
    }
    const statusBtns = [];
    if ((can.manageFaults() || isTech) && ["reported", "assigned"].includes(f.status)) statusBtns.push(`<button class="btn small" data-act="status" data-s="in_progress">شروع تعمیر</button>`);
    if (isTech && f.status === "in_progress") statusBtns.push(`<button class="btn ok small" data-act="status" data-s="repaired">رفع شد</button>`);
    if (can.manageFaults() && f.status === "repaired") statusBtns.push(`<button class="btn secondary small" data-act="status" data-s="closed">بستن پرونده</button>`);
    if (can.manageFaults() && ["reported", "assigned"].includes(f.status)) statusBtns.push(`<button class="btn secondary small" data-act="status" data-s="cancelled">لغو</button>`);
    let rateHtml = "";
    if (canRate() && f.technician_id && ["repaired", "closed"].includes(f.status)) {
      const [mine] = await rpc("my_work_rating", { p_kind: "repair", p_ref_id: id }).catch(() => []);
      rateHtml = `<div class="card" style="margin-top:12px"><div class="item-title">امتیاز به تعمیر</div>${starsHtml(mine ? mine.stars : 0)}
        <div class="actions"><button class="btn small" data-act="rate-repair">${mine ? "به‌روزرسانی امتیاز" : "ثبت امتیاز"}</button></div></div>`;
    }
    let repairHtml = "";
    if (repair && repair.status !== "completed" && repair.status !== "cancelled" && isStaff()) {
      repairHtml = `<div class="card" style="margin-top:12px"><div class="item-title">تکمیل تعمیر و صدور فاکتور</div>
        <label>شرح کار انجام‌شده</label><textarea data-field="rdesc">${esc(repair.description || "")}</textarea>
        ${amountFieldHtml("labor", "دستمزد")}${amountFieldHtml("parts", "قطعات")}
        <div class="hint">با تکمیل، فاکتور تعمیر (کد ۰۸) خودکار صادر می‌شود.</div>
        <div class="actions"><button class="btn ok" data-act="complete-repair">تکمیل و صدور فاکتور</button></div></div>`;
    } else if (repair && repair.status === "completed") {
      repairHtml = `<div class="card" style="margin-top:12px"><div class="item-title">تعمیر تکمیل شده</div>
        <div class="small">مبلغ: ${money(Number(repair.labor_cost_rial) + Number(repair.parts_cost_rial))}</div></div>`;
    }
    sheet(`<h3>${esc(b.name || "خرابی")}</h3>
      <div class="row">${badge(PRIORITY, f.priority)} ${badge(FAULT_STATUS, f.status)}</div>
      <p>${esc(f.fault_description || "")}</p>
      <dl class="kv"><dt>زمان اعلام</dt><dd>${jtime(f.reported_at)}</dd>
      ${f.reported_by ? `<dt>اعلام‌کننده</dt><dd>${esc(f.reported_by)}</dd>` : ""}
      <dt>نشانی</dt><dd>${esc(b.address || "—")}</dd>
      <dt>مدیر ساختمان</dt><dd>${esc(b.manager_name || "—")} ${b.manager_mobile ? `<a href="tel:${esc(b.manager_mobile)}">${esc(fa(b.manager_mobile))}</a>` : ""}</dd>
      <dt>تکنسین</dt><dd>${esc(f.technicians ? f.technicians.name : "—")}</dd>
      ${f.repaired_at ? `<dt>زمان رفع</dt><dd>${jtime(f.repaired_at)}</dd>` : ""}</dl>
      ${actions}<div class="actions">${statusBtns.join("")}</div>${repairHtml}${rateHtml}
      <div class="actions"><button class="btn secondary" data-close>بستن</button></div>`,
    (el, close) => {
      if (el.querySelector('[data-amount="labor"]')) { bindAmount(el, "labor"); bindAmount(el, "parts"); }
      bindStars(el);
      el.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]"); if (!btn) return;
        const act = btn.dataset.act;
        if (act === "assign") guarded(btn, async () => {
          const t = el.querySelector('[data-field="tech"]').value; if (!t) throw new Error("تکنسین را انتخاب کنید");
          await api(`faults?id=eq.${id}`, { method: "PATCH", body: { technician_id: Number(t), status: f.status === "reported" ? "assigned" : f.status } });
          close(); toast("ارجاع شد"); route();
        });
        if (act === "rate-repair") guarded(btn, async () => {
          const r = readStars(el); if (!r) throw new Error("تعداد ستاره را انتخاب کنید");
          await rpc("rate_work", { p_kind: "repair", p_ref_id: id, p_stars: r.stars, p_note: r.note });
          close(); toast("امتیاز ثبت شد");
        });
        if (act === "status") guarded(btn, async () => {
          await api(`faults?id=eq.${id}`, { method: "PATCH", body: { status: btn.dataset.s } });
          close(); toast("وضعیت به‌روز شد"); route();
        });
        if (act === "complete-repair") guarded(btn, async () => {
          const labor = readAmount(el, "labor"), parts = readAmount(el, "parts");
          if (!labor.rial && !parts.rial && !confirm("مبلغ تعمیر صفر است. ادامه می‌دهید؟")) return;
          await api(`repairs?id=eq.${repair.id}`, { method: "PATCH", body: { labor_cost_rial: labor.rial, parts_cost_rial: parts.rial, description: el.querySelector('[data-field="rdesc"]').value.trim() || null } });
          await api(`repairs?id=eq.${repair.id}`, { method: "PATCH", body: { status: "completed", repair_end: new Date().toISOString() } });
          if (["in_progress", "assigned"].includes(f.status)) await api(`faults?id=eq.${id}`, { method: "PATCH", body: { status: "repaired" } });
          close(); toast("تعمیر تکمیل و فاکتور صادر شد"); route();
        });
      });
    });
  }

  async function sheetNewService(missed) {
    const contracts = await loadContracts();
    const techs = missed ? [] : await loadTechs();
    sheet(`<h3>${missed ? "ثبت سرویس انجام‌نشده" : "ثبت گزارش سرویس"}</h3>
      <label>قرارداد</label>${contractSelectHtml(contracts)}
      <label>${missed ? "تاریخ (ماهِ سرویس انجام‌نشده)" : "تاریخ سرویس"}</label>${datePickerHtml("sdate")}
      ${missed ? `<div class="hint">برای این ماه صورتحساب با کسر قراردادی صادر می‌شود (قرارداد چندسرویسه: سهم این سرویس حذف می‌شود).</div>` : `
      <label>شماره گزارش</label><input type="text" data-field="rno" class="ltr">
      <label>سرویس‌کار</label><select data-field="tech"><option value="">—</option>${techs.filter((t) => t.status === "active" && (t.skills || []).includes("service")).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select>
      <div class="hint">پس از ثبت، گزارش منتظر تأیید مدیر تعمیرات یا مدیر ساختمان می‌ماند و با تأیید، صورتحساب صادر می‌شود.</div>`}
      <label>توضیحات</label><textarea data-field="text"></textarea>
      <div class="actions"><button class="btn" data-act="save">ثبت</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const body = { contract_id: Number(el.querySelector('[data-field="contract"]').value), service_date: readDate(el, "sdate"),
          report_text: el.querySelector('[data-field="text"]').value.trim() || null, status: missed ? "missed" : "pending_confirmation" };
        if (!missed) {
          body.report_number = toEn(el.querySelector('[data-field="rno"]').value.trim()) || null;
          const t = el.querySelector('[data-field="tech"]').value; if (t) body.technician_id = Number(t);
        }
        if (missed && !confirm("سرویس این ماه «انجام‌نشده» ثبت و صورتحساب آن با کسر صادر شود؟")) return;
        await api("service_reports", { method: "POST", body });
        close(); toast(missed ? "ثبت شد؛ صورتحساب ماه صادر شد" : "گزارش سرویس ثبت شد؛ منتظر تأیید"); route();
      }));
    });
  }

  const canRate = () => ["CEO", "REPAIR_MANAGER", "BUILDING_MANAGER", "EMPLOYER"].includes(role());
  function starsHtml(value) {
    const side = ["CEO", "REPAIR_MANAGER"].includes(role()) ? "کیفیت فنی کار" : "رضایت شما از کار";
    return `<div class="rate" data-rate="${value || 0}"><label>امتیاز ${side} (اختیاری)</label>
      <div class="stars" role="group" aria-label="امتیاز ۱ تا ۵ ستاره">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star ${n <= (value || 0) ? "on" : ""}" data-star="${n}" aria-label="${fa(n)} ستاره">★</button>`).join("")}</div>
      <input type="text" data-field="rnote" placeholder="توضیح امتیاز (برای ۱ یا ۲ ستاره لازم است)"></div>`;
  }
  function bindStars(root) {
    const box = root.querySelector(".rate"); if (!box) return;
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-star]"); if (!b) return;
      const v = Number(b.dataset.star) === Number(box.dataset.rate) ? 0 : Number(b.dataset.star);
      box.dataset.rate = v; box.querySelectorAll("[data-star]").forEach((x) => x.classList.toggle("on", Number(x.dataset.star) <= v));
    });
  }
  function readStars(root) {
    const box = root.querySelector(".rate"); if (!box) return null;
    const stars = Number(box.dataset.rate || 0), note = box.querySelector('[data-field="rnote"]').value.trim();
    if (!stars) return null;
    if (stars <= 2 && !note) throw new Error("برای امتیاز ۱ یا ۲ ستاره، دلیل را بنویسید");
    return { stars, note: note || null };
  }
  function sheetApprove(id, approved) {
    sheet(`<h3>${approved ? "تأیید انجام سرویس" : "رد سرویس"}</h3>
      ${approved ? `<p class="small muted">با تأیید، صورتحساب این ماه صادر می‌شود. تأیید با نام و زمان شما ثبت می‌شود.</p>${canRate() ? starsHtml(0) : ""}` : `<label>دلیل رد</label><textarea data-field="note" required></textarea>`}
      <div class="actions"><button class="btn ${approved ? "ok" : "danger"}" data-act="save">${approved ? "تأیید" : "ثبت رد"}</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      bindStars(el);
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const note = el.querySelector('[data-field="note"]');
        if (!approved && !note.value.trim()) throw new Error("دلیل رد را بنویسید");
        const rating = approved ? readStars(el) : null;
        await api("service_approvals", { method: "POST", body: { service_report_id: id, approver_name: state.profile.full_name || session.email,
          status: approved ? "approved" : "rejected", approval_note: note ? note.value.trim() : null, approved_by_user_id: session.user_id } });
        if (rating) { try { await rpc("rate_work", { p_kind: "service", p_ref_id: id, p_stars: rating.stars, p_note: rating.note }); } catch (er) { toast("سرویس تأیید شد ولی امتیاز ثبت نشد: " + er.message); close(); route(); return; } }
        close(); toast(approved ? (rating ? "سرویس تأیید و امتیاز ثبت شد" : "سرویس تأیید شد") : "سرویس رد شد"); route();
      }));
    });
  }

  async function sheetPayment(contractId) {
    const invoices = await api(`invoices?contract_id=eq.${contractId}&status=not.in.(cancelled,draft)&total_rial=gt.0&select=id,document_number,document_type,total_rial,status,issue_date&order=issue_date.desc,id.desc`);
    sheet(`<h3>ثبت دریافت وجه</h3>
      <label>بابت سند</label><select data-field="inv">${invoices.map((i) => `<option value="${i.id}">${esc(fa(i.document_number || "بدون شماره"))} · ${DOC_TYPE[i.document_type] || ""} · ${(INVOICE_STATUS[i.status] || [i.status])[0]}</option>`).join("")}</select>
      <div class="hint">دریافتِ فاکتور تعمیر فقط همان فاکتور را تسویه می‌کند؛ دریافتِ صورتحساب سرویس از قدیمی‌ترین بدهی سرویس کم می‌شود. اضافه پرداخت بستانکار می‌ماند.</div>
      ${amountFieldHtml("amt", "مبلغ دریافتی")}
      <label>تاریخ دریافت</label>${datePickerHtml("pdate")}
      <label>روش پرداخت</label><select data-field="method">${Object.entries(METHOD).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
      <label>شماره پیگیری</label><input type="text" data-field="track" class="ltr">
      <label>توضیحات</label><input type="text" data-field="desc">
      <div class="actions"><button class="btn ok" data-act="save">ثبت دریافت</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      bindAmount(el, "amt");
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const a = readAmount(el, "amt");
        if (!a.value) throw new Error("مبلغ را وارد کنید");
        if (!confirm(`ثبت دریافت ${num(a.rial)} ریال (${num(Math.round(a.rial / 10))} تومان)؟ این ثبت قابل ویرایش نیست.`)) return;
        await rpc("record_payment", { p_invoice_id: Number(el.querySelector('[data-field="inv"]').value), p_amount: a.value, p_unit: a.unit,
          p_payment_date: readDate(el, "pdate"), p_method: el.querySelector('[data-field="method"]').value,
          p_tracking_number: toEn(el.querySelector('[data-field="track"]').value.trim()) || null, p_description: el.querySelector('[data-field="desc"]').value.trim() || null });
        close(); toast("دریافت ثبت شد"); route();
      }));
    });
  }

  async function sheetNewUser(pre) {
    pre = pre || {};
    const buildings = await api("buildings?select=id,name,building_code&order=name");
    const pw = randomPassword();
    sheet(`<h3>کاربر جدید</h3>
      <label>نام و نام خانوادگی</label><input type="text" data-field="name" value="${esc(pre.name || "")}">
      <label>نام کاربری ورود (حروف انگلیسی)</label><input type="text" data-field="username" class="ltr" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="مثلاً rezaei">
      <div class="hint">۳ تا ۳۰ حرف کوچک انگلیسی، عدد، نقطه یا خط تیره.</div>
      <label>رمز اولیه</label><div class="row"><input type="text" data-field="pw" class="ltr" value="${pw}" style="flex:1"><button type="button" class="btn secondary small" data-act="regen">رمز تازه</button></div>
      <div class="hint">حداقل ۸ کاراکتر. پس از ساخت، این رمز را به کاربر بدهید.</div>
      <label>نقش</label><select data-field="role">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${k === "EMPLOYEE" ? "selected" : ""}>${v}</option>`).join("")}</select>
      <div data-show="tech" hidden><label>موبایل تکنسین</label><input type="text" data-field="mobile" class="ltr" inputmode="tel"></div>
      <div data-show="ext" hidden><label>ساختمان‌های مجاز</label>
        <input type="search" data-field="bsearch" placeholder="جست‌وجوی ساختمان">
        <div data-field="blist" style="max-height:220px;overflow-y:auto;margin-top:6px">${buildings.map((b) => `<label class="row small" style="margin:4px 0;color:var(--text)" data-bname="${esc(toEn(b.name + " " + (b.building_code || "")))}"><input type="checkbox" value="${b.id}"> ${esc(b.name)}</label>`).join("")}</div></div>
      <div class="actions"><button class="btn" data-act="create">ساخت کاربر</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      const roleSel = el.querySelector('[data-field="role"]');
      const sync = () => {
        el.querySelector('[data-show="tech"]').hidden = roleSel.value !== "TECHNICIAN";
        el.querySelector('[data-show="ext"]').hidden = !["BUILDING_MANAGER", "EMPLOYER", "CLIENT"].includes(roleSel.value);
      };
      if (pre.role) roleSel.value = pre.role;
      if (pre.mobile) el.querySelector('[data-field="mobile"]').value = pre.mobile;
      roleSel.addEventListener("change", sync); sync();
      el.querySelector('[data-field="bsearch"]').addEventListener("input", (e) => {
        const q = toEn(e.target.value).trim();
        el.querySelectorAll("[data-bname]").forEach((l) => { l.style.display = !q || l.dataset.bname.includes(q) ? "" : "none"; });
      });
      el.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]"); if (!btn) return;
        if (btn.dataset.act === "regen") el.querySelector('[data-field="pw"]').value = randomPassword();
        if (btn.dataset.act === "create") guarded(btn, async () => {
          const body = {
            full_name: el.querySelector('[data-field="name"]').value.trim(),
            username: toEn(el.querySelector('[data-field="username"]').value.trim().toLowerCase()),
            password: el.querySelector('[data-field="pw"]').value,
            role: roleSel.value,
            mobile: toEn(el.querySelector('[data-field="mobile"]').value.trim()) || null,
            building_ids: Array.from(el.querySelectorAll('[data-field="blist"] input:checked')).map((i) => Number(i.value)),
            technician_id: roleSel.value === "TECHNICIAN" && pre.technician_id ? pre.technician_id : undefined
          };
          if (!body.full_name) throw new Error("نام را وارد کنید");
          if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(body.username)) throw new Error("نام کاربری: ۳ تا ۳۰ حرف کوچک انگلیسی، عدد، نقطه یا خط تیره");
          if (body.password.length < 8) throw new Error("رمز باید حداقل ۸ کاراکتر باشد");
          await callFunction("create-user", body);
          close(); state.techs = null;
          showCredentials(body.full_name, body.username, body.password, body.role);
          route();
        });
      });
    });
  }

  function showCredentials(name, username, password, r) {
    const text = `سامانه پایاکو\nآدرس: ${location.origin}\nنام: ${name}\nنقش: ${ROLE[r] || r}\nنام کاربری: ${username}\nرمز اولیه: ${password}`;
    sheet(`<h3>کاربر ساخته شد ✅</h3>
      <div class="card" style="white-space:pre-line;direction:rtl">${esc(text)}</div>
      <div class="hint">این اطلاعات را برای کاربر بفرستید. رمز فقط همین‌جا نمایش داده می‌شود.</div>
      <div class="actions"><button class="btn" data-act="copy">کپی متن</button><button class="btn secondary" data-close>بستن</button></div>`,
    (el) => {
      el.querySelector('[data-act="copy"]').addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(text); toast("کپی شد"); } catch (e) { toast("کپی نشد؛ متن را دستی انتخاب کنید"); }
      });
    });
  }

  function sheetChangePassword() {
    sheet(`<h3>تغییر رمز من</h3>
      <label>رمز جدید</label><input type="password" data-field="p1" class="ltr" autocomplete="new-password">
      <label>تکرار رمز جدید</label><input type="password" data-field="p2" class="ltr" autocomplete="new-password">
      <div class="hint">حداقل ۸ کاراکتر؛ ترکیب حرف و عدد پیشنهاد می‌شود.</div>
      <div class="actions"><button class="btn" data-act="save">ذخیره</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const p1 = el.querySelector('[data-field="p1"]').value, p2 = el.querySelector('[data-field="p2"]').value;
        if (p1.length < 8) throw new Error("رمز باید حداقل ۸ کاراکتر باشد");
        if (p1 !== p2) throw new Error("دو رمز یکی نیستند");
        const t = await token();
        const res = await fetch(`${CFG.supabaseUrl}/auth/v1/user`, { method: "PUT", headers: { apikey: CFG.supabaseKey, Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify({ password: p1 }) });
        if (!res.ok) { let d = {}; try { d = await res.json(); } catch (er) { /* ignore */ } throw new Error(/weak|short|pwned|leaked/i.test(JSON.stringify(d)) ? "این رمز ضعیف یا لو رفته است؛ رمز دیگری انتخاب کنید" : translateError(d)); }
        close(); toast("رمز تغییر کرد");
      }));
    });
  }

  async function sheetEditUser(id) {
    const [u] = await api(`user_profiles?id=eq.${id}&select=id,full_name,role,is_active`);
    const access = ["BUILDING_MANAGER", "EMPLOYER", "CLIENT"].includes(u.role) ? await api(`user_building_access?user_id=eq.${id}&select=id,building_id,is_active,buildings(name)`) : null;
    const buildings = access ? await api("buildings?select=id,name&order=name") : [];
    sheet(`<h3>ویرایش کاربر</h3>
      <label>نام</label><input type="text" data-field="name" value="${esc(u.full_name || "")}">
      <label>نقش</label><select data-field="role">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${k === u.role ? "selected" : ""}>${v}</option>`).join("")}</select>
      <label><input type="checkbox" data-field="active" ${u.is_active ? "checked" : ""}> فعال</label>
      ${access ? `<div class="section-title"><h2>ساختمان‌های مجاز</h2></div>
        ${access.map((a) => `<div class="row small"><span class="spacer">${esc(a.buildings ? a.buildings.name : a.building_id)} ${a.is_active ? "" : "(غیرفعال)"}</span>
          <button class="btn secondary small" data-act="toggle-access" data-id="${a.id}" data-on="${a.is_active}">${a.is_active ? "غیرفعال" : "فعال"}</button></div>`).join("") || `<div class="hint">هنوز ساختمانی تعیین نشده.</div>`}
        <div class="row" style="margin-top:8px"><select data-field="bld" style="flex:1">${buildings.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("")}</select>
        <button class="btn small" data-act="add-access">افزودن</button></div>` : ""}
      <div class="actions"><button class="btn" data-act="save">ذخیره</button><button class="btn secondary" data-act="reset-pw">رمز جدید</button><button class="btn secondary" data-close>بستن</button></div>`,
    (el, close) => {
      el.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]"); if (!btn) return;
        if (btn.dataset.act === "reset-pw") {
          if (!confirm("برای این کاربر رمز جدید ساخته شود؟ رمز قبلی دیگر کار نمی‌کند.")) return;
          const pw = randomPassword();
          guarded(btn, async () => {
            await callFunction("create-user", { action: "reset_password", user_id: id, password: pw });
            const [p2] = await api(`user_profiles?id=eq.${id}&select=full_name,username,role`);
            close(); showCredentials(p2.full_name || "", p2.username || "", pw, p2.role);
          });
        }
        if (btn.dataset.act === "save") guarded(btn, async () => {
          await api(`user_profiles?id=eq.${id}`, { method: "PATCH", body: { full_name: el.querySelector('[data-field="name"]').value.trim() || null,
            role: el.querySelector('[data-field="role"]').value, is_active: el.querySelector('[data-field="active"]').checked } });
          close(); toast("ذخیره شد"); route();
        });
        if (btn.dataset.act === "add-access") guarded(btn, async () => {
          await api("user_building_access", { method: "POST", body: { user_id: id, building_id: Number(el.querySelector('[data-field="bld"]').value), access_type: "manager", is_active: true } });
          close(); toast("دسترسی اضافه شد"); sheetEditUser(id);
        });
        if (btn.dataset.act === "toggle-access") guarded(btn, async () => {
          await api(`user_building_access?id=eq.${btn.dataset.id}`, { method: "PATCH", body: { is_active: btn.dataset.on !== "true" } });
          close(); sheetEditUser(id);
        });
      });
    });
  }

  /* ------------------------------------------------------------------ opening balances and renewal (CEO) */
  async function viewOpening() {
    const docs = await api("invoices?document_type=eq.opening_balance&status=neq.cancelled&select=id,status,total_rial,contract_id,invoice_items(amount_rial,debit_credit)&order=id");
    const contracts = await api("v_contract_overview?select=id,contract_code,building_name,status&status=eq.active&order=contract_code");
    const byContract = new Map(docs.map((d) => [d.contract_id, d]));
    const signed = (d) => (d.invoice_items || []).reduce((a, it) => a + (it.debit_credit === "credit" ? -1 : 1) * Number(it.amount_rial), 0);
    const drafts = docs.filter((d) => d.status === "draft"), posted = docs.filter((d) => d.status !== "draft");
    const missing = contracts.filter((c) => !byContract.has(c.id));
    const name = new Map(contracts.map((c) => [c.id, c]));
    const sum = (list) => list.reduce((a, d) => a + signed(d), 0);
    const row = (d) => { const c = name.get(d.contract_id) || {}; const v = signed(d);
      return `<div class="card tap" data-act="open-contract" data-id="${d.contract_id}"><div class="item-head"><div><div class="item-title">${esc(c.building_name || "")}</div>
        <div class="small muted">قرارداد ${esc(fa(c.contract_code || d.contract_id))}</div></div>
        <div style="text-align:left">${money(Math.abs(v), { cls: v > 0 ? "debt" : v < 0 ? "credit" : "" })}${balanceBadge(v)}</div></div></div>`; };
    return shell("مانده‌های افتتاحیه", "more", `
      <a href="#/more" class="small">→ بازگشت</a>
      <div class="card" style="margin-top:8px"><div class="small">مانده‌ی هر مشترک تا پایان ۳۰ مهر ۱۴۰۵. از آبان ۱۴۰۵ صورتحساب‌ها را سیستم صادر می‌کند.</div>
        <div class="small muted">این سند داخلی است و شماره نمی‌گیرد؛ ثبت‌کننده و تأییدکننده ذخیره می‌شود.</div></div>
      <div class="stats" style="margin-top:10px">
        <div class="stat warn"><div class="label">پیش‌نویس منتظر تأیید</div><div class="value">${num(drafts.length)}</div></div>
        <div class="stat"><div class="label">تأییدشده</div><div class="value">${num(posted.length)}</div></div>
        <div class="stat ${missing.length ? "danger" : ""}"><div class="label">قرارداد بدون مانده افتتاحیه</div><div class="value">${num(missing.length)}</div></div>
        <div class="stat"><div class="label">جمع پیش‌نویس‌ها</div><div class="value" style="font-size:15px">${money(Math.abs(sum(drafts)))}${balanceBadge(sum(drafts))}</div></div></div>
      ${drafts.length ? `<div class="section-title"><h2>پیش‌نویس‌ها</h2><button class="btn ok small" data-act="post-all-opening" data-n="${drafts.length}">تأیید همه</button></div>${drafts.map(row).join("")}` : ""}
      ${missing.length ? `<div class="section-title"><h2>بدون مانده افتتاحیه</h2></div>${missing.map((c) => `<div class="card tap" data-act="open-contract" data-id="${c.id}"><div class="item-title">${esc(c.building_name || "")}</div><div class="small muted">قرارداد ${esc(fa(c.contract_code))}</div></div>`).join("")}` : ""}
      ${posted.length ? `<div class="section-title"><h2>تأییدشده</h2></div>${posted.map(row).join("")}` : ""}`);
  }

  async function sheetOpening(contractId) {
    const [c] = await api(`v_contract_overview?id=eq.${contractId}&select=id,contract_code,building_name`);
    const [d] = await api(`invoices?contract_id=eq.${contractId}&document_type=eq.opening_balance&status=eq.draft&select=id,notes,invoice_items(amount_rial,debit_credit)`);
    const cur = d && d.invoice_items && d.invoice_items[0];
    const dir = cur ? (cur.debit_credit === "credit" ? "credit" : Number(cur.amount_rial) ? "debit" : "zero") : "debit";
    sheet(`<h3>مانده افتتاحیه — قرارداد ${esc(fa(c.contract_code))}</h3>
      <div class="small muted">${esc(c.building_name || "")} · مانده تا پایان ۳۰ مهر ۱۴۰۵</div>
      <label>وضعیت حساب مشترک</label>
      <div class="seg" data-field="dir"><button type="button" data-v="debit" class="${dir === "debit" ? "on" : ""}">بدهکار</button><button type="button" data-v="credit" class="${dir === "credit" ? "on" : ""}">بستانکار</button><button type="button" data-v="zero" class="${dir === "zero" ? "on" : ""}">تسویه</button></div>
      <div data-show="amt">${amountFieldHtml("amt", "مبلغ مانده")}</div>
      <label>توضیح (اختیاری)</label><input type="text" data-field="note" value="${esc((d && d.notes) || "")}">
      <div class="hint">ذخیره به‌صورت پیش‌نویس است و در حساب اثری ندارد تا وقتی آن را تأیید کنید.</div>
      <div class="actions"><button class="btn" data-act="save">ذخیره پیش‌نویس</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      bindAmount(el, "amt");
      const seg = el.querySelector('[data-field="dir"]');
      const sync = () => { el.querySelector('[data-show="amt"]').hidden = seg.querySelector(".on").dataset.v === "zero"; };
      seg.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); sync(); });
      if (cur && Number(cur.amount_rial)) {
        const inp = el.querySelector('[data-amount="amt"]'); inp.value = String(Math.round(Number(cur.amount_rial) / 10)); inp.dispatchEvent(new Event("input"));
      }
      sync();
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const v = seg.querySelector(".on").dataset.v;
        const a = v === "zero" ? { value: 0, unit: "rial" } : readAmount(el, "amt");
        if (v !== "zero" && !a.value) throw new Error("مبلغ را وارد کنید");
        await rpc("set_opening_balance", { p_contract_id: contractId, p_amount: v === "credit" ? -a.value : a.value, p_unit: a.unit,
          p_note: el.querySelector('[data-field="note"]').value.trim() || null });
        close(); toast("پیش‌نویس ذخیره شد"); route();
      }));
    });
  }

  async function sheetRenew(contractId) {
    const [c] = await api(`v_contract_overview?id=eq.${contractId}&select=*`);
    const end = new Date(String(c.end_date || todayTehran()).slice(0, 10) + "T12:00:00Z");
    const start = new Date(end.getTime() + 86400000);
    const iso = (d) => d.toISOString().slice(0, 10);
    const sj = g2j(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate());
    const eg = j2g(sj.jy + 1, sj.jm, 1); // one Jalali year later, minus one day
    const newEnd = new Date(Date.UTC(eg.gy, eg.gm - 1, eg.gd) + (sj.jd - 1) * 86400000 - 86400000);
    const bal = Number(c.balance_rial || 0);
    sheet(`<h3>تمدید قرارداد ${esc(fa(c.contract_code))}</h3>
      <div class="small muted">${esc(c.building_name || "")}</div>
      <label>شروع دوره جدید</label>${datePickerHtml("start", iso(start))}
      <label>پایان دوره جدید</label>${datePickerHtml("end", iso(newEnd))}
      ${amountFieldHtml("monthly", "مبلغ ماهانه دوره جدید (بدون ارزش افزوده)")}
      <div class="hint">برای قراردادهایی که از ۱ دی ۱۴۰۵ به بعد شروع می‌شوند، سیستم ۱۰٪ ارزش افزوده را روی هر صورتحساب جدا اضافه می‌کند.</div>
      ${amountFieldHtml("ded", "کسر سرویس انجام‌نشده")}
      <label>تعداد سرویس در ماه</label><input type="text" inputmode="numeric" data-field="spm" class="ltr" placeholder="طبق قرارداد جدید">
      <div class="hint">همه‌ی مبالغ و شرایط مالی را از قرارداد جدید وارد کنید؛ چیزی از سال قبل منتقل نمی‌شود. فقط مشخصات فنی دستگاه‌ها و مانده‌ی حساب منتقل می‌شود.</div>
      <label>کد قرارداد جدید (اختیاری)</label><input type="text" data-field="code" class="ltr" placeholder="${esc(c.subscription_code)}/${esc(String(sj.jy))}">
      <div class="card" style="margin-top:10px"><div class="small">مانده فعلی: <span class="${bal > 0 ? "debt" : bal < 0 ? "credit" : ""}">${money(Math.abs(bal))}</span> ${balanceBadge(bal)}</div>
        <div class="small muted">${bal ? "این مانده با یک جفت سند داخلی «انتقال مانده» به دوره جدید منتقل می‌شود." : "مانده‌ای برای انتقال نیست."} دوره فعلی «تمام‌شده» می‌شود و دستگاه‌ها به دوره جدید منتقل می‌شوند.</div></div>
      ${role() === "CEO" ? "" : `<div class="hint">تمدید پس از تأیید مدیرعامل اجرا می‌شود.</div>`}
      <div class="actions"><button class="btn" data-act="save">${role() === "CEO" ? "تمدید" : "ارسال برای تأیید"}</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      bindAmount(el, "monthly"); bindAmount(el, "ded");
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const m = readAmount(el, "monthly"), dd = readAmount(el, "ded");
        if (!m.value) throw new Error("مبلغ ماهانه قرارداد جدید را وارد کنید");
        if (!parseAmount(el.querySelector('[data-amount="ded"]').value) && !confirm("کسر سرویس انجام‌نشده صفر است. درست است؟")) return;
        const spm = Number(toEn(el.querySelector('[data-field="spm"]').value));
        if (!Number.isInteger(spm) || spm < 1 || spm > 8) throw new Error("تعداد سرویس در ماه را وارد کنید (۱ تا ۸)");
        const s = readDate(el, "start"), en = readDate(el, "end");
        if (en < s) throw new Error("پایان باید بعد از شروع باشد");
        if (!confirm(`قرارداد ${c.contract_code} از ${jdate(s)} تا ${jdate(en)} با ماهانه ${num(Math.round(m.rial / 10))} تومان تمدید شود؟`)) return;
        const reqId = await rpc("submit_contract_change", { p_contract_id: contractId, p_kind: "renewal", p_payload: { start_date: s, end_date: en,
          monthly_amount_rial: m.rial, missed_service_deduction_rial: dd.rial, services_per_month: spm,
          contract_code: toEn(el.querySelector('[data-field="code"]').value.trim()) || null } });
        close(); state.contracts = null;
        if (role() === "CEO") {
          const [rq] = await api(`contract_change_requests?id=eq.${reqId}&select=result_contract_id`);
          toast("قرارداد تمدید شد"); location.hash = `#/contract/${rq && rq.result_contract_id ? rq.result_contract_id : contractId}`;
        } else { toast("درخواست تمدید ثبت شد؛ پس از تأیید مدیرعامل اجرا می‌شود"); route(); }
      }));
    });
  }

  /* ------------------------------------------------------------------ contract changes: edit / amendment / renewal (employee asks, CEO approves) */
  const CHANGE_KIND = { edit: "ویرایش اطلاعات", amendment: "الحاقیه", renewal: "تمدید" };
  const CHANGE_STATUS = { pending: ["منتظر تأیید مدیرعامل", "warn"], approved: ["اعمال شد", "ok"], rejected: ["رد شد", "danger"], withdrawn: ["پس گرفته شد", ""] };
  const FIELD_LABEL = { manager_name: "مدیر ساختمان", manager_mobile: "موبایل مدیر", address: "نشانی", name: "نام", mobile: "موبایل", national_id: "کد/شناسه ملی", notes: "توضیحات",
    stops: "توقف", capacity_persons: "ظرفیت", motor_type: "موتور", cabin_door_type: "درب کابین", landing_door_type: "درب طبقات", controller_brand: "تابلو فرمان" };
  const ymText = (ym) => `${MONTHS[ym % 100 - 1]} ${fa(Math.floor(ym / 100))}`;
  function changeSummary(k) {
    const p = k.payload || {};
    if (k.kind === "amendment") return `از ${ymText(p.effective_ym)}: ماهانه ${num(Math.round(p.monthly_amount_rial / 10))} تومان، کسر ${num(Math.round(p.missed_service_deduction_rial / 10))} تومان، ${fa(p.services_per_month)} سرویس در ماه${p.end_date ? `، پایان ${jdate(p.end_date)}` : ""}${p.description ? ` — ${esc(p.description)}` : ""}`;
    if (k.kind === "renewal") return `${jdate(p.start_date)} تا ${jdate(p.end_date)}: ماهانه ${num(Math.round(p.monthly_amount_rial / 10))} تومان، کسر ${num(Math.round(p.missed_service_deduction_rial / 10))} تومان، ${fa(p.services_per_month)} سرویس در ماه`;
    const parts = [];
    ["building", "customer", "contract"].forEach((g) => Object.entries(p[g] || {}).forEach(([f, v]) => parts.push(`${FIELD_LABEL[f] || f}: ${esc(v || "—")}`)));
    (p.elevators || []).forEach((e) => Object.entries(e).filter(([f]) => f !== "id" && f !== "no").forEach(([f, v]) => parts.push(`دستگاه ${fa(e.no || "")} ${FIELD_LABEL[f] || f}: ${esc(v || "—")}`)));
    return parts.join("، ");
  }
  function changeCard(k) {
    const decide = k.status === "pending" && role() === "CEO" ? `<div class="actions"><button class="btn ok small" data-act="approve-change" data-id="${k.id}">تأیید و اعمال</button><button class="btn secondary small" data-act="reject-change" data-id="${k.id}">رد</button></div>` : "";
    return `<div class="card"><div class="item-head"><div><div class="item-title">${CHANGE_KIND[k.kind]}${k.document_number ? ` <bdi dir="ltr">${esc(fa(k.document_number))}</bdi>` : ""}</div>
      <div class="small muted">${jtime(k.requested_at)}</div></div>${badge(CHANGE_STATUS, k.status)}</div>
      <div class="small">${fa(changeSummary(k))}</div>${k.decision_note ? `<div class="small debt">دلیل رد: ${esc(k.decision_note)}</div>` : ""}${decide}</div>`;
  }

  async function viewRequests() {
    const list = await api("contract_change_requests?status=eq.pending&select=id,kind,payload,status,document_number,requested_at,decision_note,contract_id,contracts(contract_code,buildings(name))&order=id");
    return shell("درخواست‌های تغییر قرارداد", "more", `<a href="#/more" class="small">→ بازگشت</a><div style="height:8px"></div>
      ${list.length ? list.map((k) => `<div class="small muted" style="margin-top:6px"><a href="#/contract/${k.contract_id}">قرارداد ${esc(fa(k.contracts ? k.contracts.contract_code : ""))} · ${esc(k.contracts && k.contracts.buildings ? k.contracts.buildings.name : "")}</a></div>${changeCard(k)}`).join("") : `<div class="card empty">درخواستی منتظر تأیید نیست</div>`}`);
  }

  async function sheetEditContract(contractId) {
    const [c] = await api(`contracts?id=eq.${contractId}&select=id,contract_code,notes,buildings(manager_name,manager_mobile,address),customers(name,mobile,national_id,address)`);
    const elev = await api(`elevators?contract_id=eq.${contractId}&select=id,elevator_no,subscription_code,stops,capacity_persons,motor_type,cabin_door_type,landing_door_type,controller_brand,notes&order=elevator_no`);
    const b = c.buildings || {}, cu = c.customers || {};
    const inp = (grp, f, v, ltr) => `<label>${FIELD_LABEL[f]}</label><input type="text" data-g="${grp}" data-f="${f}" data-old="${esc(v ?? "")}" value="${esc(v ?? "")}" ${ltr ? 'class="ltr" inputmode="tel"' : ""}>`;
    sheet(`<h3>ویرایش اطلاعات قرارداد ${esc(fa(c.contract_code))}</h3>
      <div class="hint">شرایط مالی اینجا تغییر نمی‌کند؛ برای آن «الحاقیه» ثبت کنید.${role() === "CEO" ? "" : " تغییرات بعد از تأیید مدیرعامل اعمال می‌شود."}</div>
      <div class="section-title"><h2>ساختمان</h2></div>${inp("building", "manager_name", b.manager_name)}${inp("building", "manager_mobile", b.manager_mobile, true)}${inp("building", "address", b.address)}
      <div class="section-title"><h2>کارفرما</h2></div>${inp("customer", "name", cu.name)}${inp("customer", "mobile", cu.mobile, true)}${inp("customer", "national_id", cu.national_id, true)}${inp("customer", "address", cu.address)}
      ${elev.map((e) => `<div class="section-title"><h2>دستگاه ${fa(e.elevator_no)}${e.subscription_code ? ` · کد ${esc(fa(e.subscription_code))}` : ""}</h2></div>
        <div data-elev="${e.id}" data-no="${e.elevator_no}">${["stops", "capacity_persons", "motor_type", "cabin_door_type", "landing_door_type", "controller_brand", "notes"].map((f) => `<label>${FIELD_LABEL[f]}</label><input type="text" data-ef="${f}" data-old="${esc(e[f] ?? "")}" value="${esc(e[f] ?? "")}">`).join("")}</div>`).join("")}
      <div class="section-title"><h2>قرارداد</h2></div>${inp("contract", "notes", c.notes)}
      <div class="actions"><button class="btn" data-act="save">${role() === "CEO" ? "ذخیره" : "ارسال برای تأیید"}</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const payload = {};
        el.querySelectorAll("input[data-g]").forEach((i) => {
          const v = toEn(i.value.trim()), old = toEn(i.dataset.old);
          if (v !== old) { payload[i.dataset.g] = payload[i.dataset.g] || {}; payload[i.dataset.g][i.dataset.f] = i.value.trim(); }
        });
        const ev = [];
        el.querySelectorAll("[data-elev]").forEach((box) => {
          const ch = { id: Number(box.dataset.elev), no: Number(box.dataset.no) };
          box.querySelectorAll("input[data-ef]").forEach((i) => { if (i.value.trim() !== i.dataset.old) ch[i.dataset.ef] = ["stops", "capacity_persons"].includes(i.dataset.ef) ? toEn(i.value.trim()) : i.value.trim(); });
          if (Object.keys(ch).length > 2) ev.push(ch);
        });
        if (ev.length) payload.elevators = ev;
        if (!Object.keys(payload).length) throw new Error("چیزی تغییر نکرده است");
        await rpc("submit_contract_change", { p_contract_id: contractId, p_kind: "edit", p_payload: payload });
        close(); state.contracts = null; toast(role() === "CEO" ? "تغییرات ذخیره شد" : "درخواست ویرایش ثبت شد؛ پس از تأیید مدیرعامل اعمال می‌شود"); route();
      }));
    });
  }

  async function sheetAmendment(contractId) {
    const [c] = await api(`v_contract_overview?id=eq.${contractId}&select=id,contract_code,building_name,end_date`);
    const now = toEn(todayTehran()).split("-").map(Number); const tj = g2j(now[0], now[1], now[2]);
    const years = [tj.jy, tj.jy + 1];
    sheet(`<h3>الحاقیه قرارداد ${esc(fa(c.contract_code))}</h3>
      <div class="small muted">${esc(c.building_name || "")}</div>
      <div class="hint">شرایط مالی جدید را کامل وارد کنید. از ماهی که تعیین می‌کنید اجرا می‌شود؛ صورتحساب‌های ماه‌های قبل دست نمی‌خورند. الحاقیه پس از تأیید شماره‌ی ۰۶ می‌گیرد.</div>
      <label>اجرا از ماه</label><div class="row"><select data-field="m" style="flex:1">${MONTHS.map((mn, i) => `<option value="${i + 1}" ${i + 1 === tj.jm ? "selected" : ""}>${mn}</option>`).join("")}</select>
        <select data-field="y" style="flex:1">${years.map((y) => `<option value="${y}">${fa(y)}</option>`).join("")}</select></div>
      ${amountFieldHtml("monthly", "مبلغ ماهانه جدید")}
      ${amountFieldHtml("ded", "کسر سرویس انجام‌نشده")}
      <label>تعداد سرویس در ماه</label><input type="text" inputmode="numeric" data-field="spm" class="ltr">
      <label><input type="checkbox" data-field="chend"> تغییر تاریخ پایان قرارداد</label>
      <div data-show="end" hidden>${datePickerHtml("end", c.end_date)}</div>
      <label>شرح الحاقیه</label><input type="text" data-field="desc" placeholder="مثلاً افزایش نرخ طبق توافق">
      <div class="actions"><button class="btn" data-act="save">${role() === "CEO" ? "ثبت الحاقیه" : "ارسال برای تأیید"}</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      bindAmount(el, "monthly"); bindAmount(el, "ded");
      el.querySelector('[data-field="chend"]').addEventListener("change", (e) => { el.querySelector('[data-show="end"]').hidden = !e.target.checked; });
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const m = readAmount(el, "monthly"), dd = readAmount(el, "ded");
        if (!m.value) throw new Error("مبلغ ماهانه جدید را وارد کنید");
        if (!dd.value && !confirm("کسر سرویس انجام‌نشده صفر است. درست است؟")) return;
        const spm = Number(toEn(el.querySelector('[data-field="spm"]').value));
        if (!Number.isInteger(spm) || spm < 1 || spm > 8) throw new Error("تعداد سرویس در ماه را وارد کنید (۱ تا ۸)");
        const ym = Number(el.querySelector('[data-field="y"]').value) * 100 + Number(el.querySelector('[data-field="m"]').value);
        const payload = { effective_ym: ym, monthly_amount_rial: m.rial, missed_service_deduction_rial: dd.rial, services_per_month: spm,
          description: el.querySelector('[data-field="desc"]').value.trim() || null };
        if (el.querySelector('[data-field="chend"]').checked) payload.end_date = readDate(el, "end");
        if (!confirm(`الحاقیه: از ${ymText(ym)} ماهانه ${num(Math.round(m.rial / 10))} تومان. ثبت شود؟`)) return;
        await rpc("submit_contract_change", { p_contract_id: contractId, p_kind: "amendment", p_payload: payload });
        close(); state.contracts = null; toast(role() === "CEO" ? "الحاقیه ثبت شد" : "الحاقیه برای تأیید مدیرعامل ارسال شد"); route();
      }));
    });
  }

  /* ------------------------------------------------------------------ month close (employee prepares, CEO closes) */
  let closeYM = null;
  async function viewMonthClose() {
    const [setting] = await api("app_settings?key=eq.billing_start&select=value");
    const [sy, sm] = (setting ? setting.value : "1405-08").split("-").map(Number);
    const t = toEn(todayTehran()).split("-").map(Number), tj = g2j(t[0], t[1], t[2]);
    // months from the billing start up to the last finished month
    const months = []; let y = sy, m = sm;
    while (y * 100 + m < tj.jy * 100 + tj.jm) { months.push(y * 100 + m); m++; if (m > 12) { m = 1; y++; } }
    const closes = await api("month_closes?select=jalali_year,jalali_month,status,prepared_at,closed_at,summary&order=jalali_year.desc,jalali_month.desc");
    const st = new Map(closes.map((c) => [c.jalali_year * 100 + c.jalali_month, c]));
    if (!months.length) {
      return shell("بستن ماه", "more", `<a href="#/more" class="small">→ بازگشت</a>
        <div class="card empty" style="margin-top:8px">اولین ماهی که سیستم صورتحساب می‌زند ${MONTHS[sm - 1]} ${fa(sy)} است.<br>بستن آن بعد از پایان ماه ممکن می‌شود.</div>`);
    }
    if (!closeYM || !months.includes(closeYM)) closeYM = months.find((x) => !st.has(x) || st.get(x).status !== "closed") || months[months.length - 1];
    const jy = Math.floor(closeYM / 100), jm = closeYM % 100, cur = st.get(closeYM);
    const rows = await rpc("month_close_preview", { p_jy: jy, p_jm: jm });
    const pend = rows.filter((r) => r.unresolved > 0), add = rows.filter((r) => r.to_add > 0), done = rows.filter((r) => !r.unresolved && !r.to_add);
    const closed = cur && cur.status === "closed";
    const row = (r, note, cls) => `<tr><td><a href="#/contract/${r.contract_id}">${esc(fa(r.contract_code))}</a><div class="small muted">${esc(r.building_name || "")}</div></td>
      <td style="text-align:left" class="small ${cls || ""}">${note}</td></tr>`;
    let action = "";
    if (!closed) {
      if (role() === "CEO") action = `<button class="btn ${pend.length ? "secondary" : "ok"}" data-act="close-month" data-y="${jy}" data-m="${jm}" ${pend.length ? "disabled" : ""}>بستن ماه ${MONTHS[jm - 1]}</button>`;
      else if (role() === "EMPLOYEE") action = `<button class="btn" data-act="prepare-month" data-y="${jy}" data-m="${jm}">آماده برای تأیید مدیرعامل</button>`;
    }
    return shell("بستن ماه", "more", `<a href="#/more" class="small">→ بازگشت</a>
      <div class="chips" style="margin-top:8px">${months.slice().reverse().map((x) => { const c = st.get(x); return `<button data-act="pick-month" data-k="${x}" class="${x === closeYM ? "on" : ""}">${MONTHS[x % 100 - 1]} ${fa(Math.floor(x / 100))}${c && c.status === "closed" ? " ✓" : ""}</button>`; }).join("")}</div>
      <div class="card"><div class="item-head"><div><div class="item-title">${MONTHS[jm - 1]} ${fa(jy)}</div>
        <div class="small muted">${closed ? `بسته شد ${jtime(cur.closed_at)}` : cur && cur.prepared_at ? `آماده‌شده برای تأیید ${jtime(cur.prepared_at)}` : "باز"}</div></div>
        ${closed ? `<span class="badge ok">بسته</span>` : cur ? `<span class="badge warn">منتظر تأیید</span>` : `<span class="badge">باز</span>`}</div>
        ${closed && cur.summary ? `<div class="small">${fa(cur.summary.missed_added || 0)} سرویس انجام‌نشده ثبت شد · ${fa(cur.summary.statements_issued || 0)} صورتحساب صادر شد</div>` : ""}
        ${!closed ? `<div class="small muted" style="margin-top:6px">با بستن ماه، برای هر سرویسِ انجام‌نشده «سرویس انجام‌نشده» ثبت و طبق قرارداد صورتحساب می‌شود. بعد از آن ثبت یا تغییر سرویس این ماه ممکن نیست.</div>` : ""}
        <div class="actions">${action}</div>
        ${pend.length && !closed ? `<div class="error-box">${fa(pend.length)} قرارداد سرویس منتظر تأیید دارد؛ تا تکلیف آن‌ها روشن نشود ماه بسته نمی‌شود. <a href="#/services">رفتن به سرویس‌ها</a></div>` : ""}</div>
      <div class="stats" style="margin-top:10px">
        <div class="stat"><div class="label">قرارداد در این ماه</div><div class="value">${num(rows.length)}</div></div>
        <div class="stat ${pend.length ? "warn" : ""}"><div class="label">منتظر تأیید</div><div class="value">${num(pend.length)}</div></div>
        <div class="stat ${add.length ? "danger" : ""}"><div class="label">${closed ? "—" : "بدون سرویس کامل"}</div><div class="value">${closed ? "" : num(add.length)}</div></div>
        <div class="stat"><div class="label">کامل</div><div class="value">${num(done.length)}</div></div></div>
      ${pend.length ? `<div class="section-title"><h2>منتظر تأیید</h2></div><div class="card"><table class="list"><tbody>${pend.map((r) => row(r, `${fa(r.unresolved)} سرویس منتظر تأیید`, "warn")).join("")}</tbody></table></div>` : ""}
      ${add.length ? `<div class="section-title"><h2>${closed ? "" : "با بستن ماه «انجام‌نشده» ثبت می‌شود"}</h2></div><div class="card"><table class="list"><tbody>${add.map((r) => row(r, `${fa(r.to_add)} از ${fa(r.services_per_month)} سرویس${r.services_per_month > 1 ? " — سهم آن حذف می‌شود" : " — شارژ منهای کسر قراردادی"}`, "debt")).join("")}</tbody></table></div>` : ""}
      ${done.length ? `<div class="section-title"><h2>کامل</h2></div><div class="card"><table class="list"><tbody>${done.map((r) => row(r, `${fa(r.confirmed)} تأییدشده${r.missed ? ` · ${fa(r.missed)} انجام‌نشده` : ""}`, "credit")).join("")}</tbody></table></div>` : ""}`);
  }

  /* ------------------------------------------------------------------ reports (CEO) */
  const METHOD_ALL = { ...METHOD };
  const tom = (rial) => Math.round(Number(rial || 0) / 10);
  // CSV with BOM so Excel and the iPhone Files app show Persian correctly
  function downloadCsv(name, header, rows) {
    const cell = (v) => { const t = String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const csv = "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const jdLatin = (d) => toEn(jdate(d));
  let reportTab = "balance";
  const reportRange = { from: null, to: null };
  let reportData = null;
  async function viewReports() {
    const t = toEn(todayTehran()).split("-").map(Number), tj = g2j(t[0], t[1], t[2]);
    if (!reportRange.from) { const g = j2g(tj.jy, tj.jm, 1); reportRange.from = `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`; reportRange.to = todayTehran(); }
    const tabs = [["balance", "تراز"], ["debtors", "بدهکاران"], ["receipts", "دریافت‌ها"]];
    let body = "";
    if (reportTab === "balance") {
      const b = await rpc("report_balance", { p_from: reportRange.from, p_to: reportRange.to }); reportData = b;
      const line = (label, rial, cls) => `<tr><td>${label}</td><td style="text-align:left" class="${cls || ""}">${num(tom(rial))}</td></tr>`;
      body = `<div class="card"><table class="list"><tbody>
        ${line("مانده‌ی ابتدای دوره", b.opening)}
        ${line("+ صورتحساب سرویس (" + fa(b.statements_count) + " سند)", b.debit_statements, "debt")}
        ${line("+ فاکتور تعمیر (" + fa(b.repairs_count) + " سند)", b.debit_repairs, "debt")}
        ${b.debit_opening ? line("+ مانده‌ی افتتاحیه بدهکار", b.debit_opening, "debt") : ""}
        ${b.debit_other ? line("+ سایر اسناد", b.debit_other, "debt") : ""}
        ${line("− دریافت وجه (" + fa(b.receipts_count) + " مورد)", b.credit_received, "credit")}
        ${b.credit_opening ? line("− مانده‌ی افتتاحیه بستانکار", b.credit_opening, "credit") : ""}
        ${b.credit_cancelled ? line("− اسناد ابطال‌شده", b.credit_cancelled, "credit") : ""}
        ${b.transfer_net ? line("انتقال مانده (خالص)", b.transfer_net) : ""}
        <tr><td><b>مانده‌ی پایان دوره (طلب از مشترکین)</b></td><td style="text-align:left"><b>${num(tom(b.closing))}</b></td></tr></tbody></table>
        <div class="hint">مبالغ به تومان. انتقال مانده‌ی تمدیدها و بستانکاری‌های داخلی جزو «دریافت وجه» حساب نمی‌شوند.</div></div>
        ${Object.keys(b.received_by_method || {}).length ? `<div class="section-title"><h2>دریافت به تفکیک روش</h2></div><div class="card"><table class="list"><tbody>${Object.entries(b.received_by_method).map(([m, v]) => line(METHOD_ALL[m] || m, v)).join("")}</tbody></table></div>` : ""}`;
    } else if (reportTab === "debtors") {
      const list = await rpc("report_debtors", { p_date: reportRange.to }); reportData = list;
      const debt = list.filter((x) => x.balance_rial > 0), cred = list.filter((x) => x.balance_rial < 0);
      const sum = (l) => l.reduce((a, x) => a + Number(x.balance_rial), 0);
      const card = (x) => `<div class="card tap" data-act="open-contract" data-id="${x.contract_id}"><div class="item-head"><div><div class="item-title">${esc(x.building_name || "")}</div>
        <div class="small muted">قرارداد ${esc(fa(x.contract_code))}${x.manager_name ? " · " + esc(x.manager_name) : ""}${x.oldest_open_date ? " · قدیمی‌ترین بدهی " + jdate(x.oldest_open_date) : ""}</div></div>
        <div style="text-align:left">${money(Math.abs(x.balance_rial), { cls: x.balance_rial > 0 ? "debt" : "credit" })}</div></div></div>`;
      body = `<div class="stats"><div class="stat danger"><div class="label">بدهکاران (${fa(debt.length)})</div><div class="value" style="font-size:16px">${num(tom(sum(debt)))} تومان</div></div>
        <div class="stat"><div class="label">بستانکاران (${fa(cred.length)})</div><div class="value" style="font-size:16px">${num(tom(-sum(cred)))} تومان</div></div></div>
        <div class="hint">مانده تا ${jdate(reportRange.to)}</div>
        ${debt.map(card).join("") || `<div class="card empty">بدهکاری نیست</div>`}
        ${cred.length ? `<div class="section-title"><h2>بستانکاران</h2></div>${cred.map(card).join("")}` : ""}`;
    } else {
      const list = await rpc("report_receipts", { p_from: reportRange.from, p_to: reportRange.to }); reportData = list;
      const total = list.reduce((a, x) => a + Number(x.amount_rial), 0);
      body = `<div class="stats"><div class="stat wide"><div class="label">جمع دریافت‌های واقعی (${fa(list.length)} مورد)</div><div class="value">${money(total)}</div></div></div>
        ${list.length ? `<div class="card"><table class="list"><tbody>${list.map((x) => `<tr><td>${esc(x.building_name || "")}<div class="small muted">${jdate(x.payment_date)} · قرارداد ${esc(fa(x.contract_code || ""))} · ${esc(METHOD_ALL[x.method] || x.method)}${x.tracking_number ? " · پیگیری " + esc(fa(x.tracking_number)) : ""}</div></td>
          <td style="text-align:left;white-space:nowrap">${num(tom(x.amount_rial))}</td></tr>`).join("")}</tbody></table><div class="hint">مبالغ به تومان</div></div>` : `<div class="card empty">در این بازه دریافتی ثبت نشده</div>`}`;
    }
    return shell("گزارش‌های مالی", "more", `<a href="#/more" class="small">→ بازگشت</a>
      <div class="chips" style="margin-top:8px">${tabs.map(([k, l]) => `<button data-act="report-tab" data-k="${k}" class="${reportTab === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="card">${reportTab !== "debtors" ? `<label>از تاریخ</label>${datePickerHtml("rfrom", reportRange.from)}` : ""}
        <label>${reportTab === "debtors" ? "مانده تا تاریخ" : "تا تاریخ"}</label>${datePickerHtml("rto", reportRange.to)}
        <div class="actions"><button class="btn small" data-act="report-apply">نمایش</button><button class="btn secondary small" data-act="report-csv">خروجی اکسل</button></div></div>
      ${body}`);
  }
  function reportCsv() {
    const d = reportData, f = jdLatin(reportRange.from).replace(/\//g, "-"), t = jdLatin(reportRange.to).replace(/\//g, "-");
    if (!d) return;
    if (reportTab === "balance") {
      downloadCsv(`taraz-${f}-${t}.csv`, ["شرح", "مبلغ (تومان)"], [
        ["از تاریخ", jdLatin(d.from)], ["تا تاریخ", jdLatin(d.to)], ["مانده ابتدای دوره", tom(d.opening)], ["صورتحساب سرویس", tom(d.debit_statements)],
        ["فاکتور تعمیر", tom(d.debit_repairs)], ["مانده افتتاحیه بدهکار", tom(d.debit_opening)], ["سایر اسناد", tom(d.debit_other)],
        ["دریافت وجه", tom(d.credit_received)], ["مانده افتتاحیه بستانکار", tom(d.credit_opening)], ["اسناد ابطال‌شده", tom(d.credit_cancelled)],
        ["انتقال مانده (خالص)", tom(d.transfer_net)], ["مانده پایان دوره", tom(d.closing)]]);
    } else if (reportTab === "debtors") {
      downloadCsv(`mande-moshtarekin-${t}.csv`, ["کد قرارداد", "ساختمان", "کارفرما", "مدیر ساختمان", "موبایل", "وضعیت قرارداد", "مانده (تومان)", "بدهکار/بستانکار", "قدیمی‌ترین بدهی باز", "تعداد سند باز"],
        d.map((x) => [x.contract_code, x.building_name, x.customer_name, x.manager_name, x.manager_mobile, x.status, tom(Math.abs(x.balance_rial)), x.balance_rial > 0 ? "بدهکار" : x.balance_rial < 0 ? "بستانکار" : "تسویه", x.oldest_open_date ? jdLatin(x.oldest_open_date) : "", x.open_docs]));
    } else {
      downloadCsv(`daryaft-${f}-${t}.csv`, ["تاریخ", "کد قرارداد", "ساختمان", "مبلغ (تومان)", "روش", "شماره پیگیری", "بابت سند", "توضیح"],
        d.map((x) => [jdLatin(x.payment_date), x.contract_code, x.building_name, tom(x.amount_rial), METHOD_ALL[x.method] || x.method, x.tracking_number, x.document_number || "", x.description]));
    }
  }

  async function sheetContractReport(contractId) {
    const t = toEn(todayTehran()).split("-").map(Number), tj = g2j(t[0], t[1], t[2]);
    const g = j2g(tj.jy - 1, tj.jm, 1);
    const from0 = `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
    const load = async (el, from, to) => {
      const d = await rpc("report_contract_period", { p_contract_id: contractId, p_from: from, p_to: to });
      const SV = { confirmed: "انجام و تأیید", missed: "انجام‌نشده", pending_confirmation: "منتظر تأیید", rejected: "ردشده" };
      const done = d.services.filter((x) => x.status === "confirmed").length, missed = d.services.filter((x) => x.status === "missed").length;
      el.querySelector('[data-field="out"]').innerHTML = `
        <div class="section-title"><h2>بخش فنی</h2></div>
        <div class="card small">سرویس انجام‌شده: ${fa(done)} · انجام‌نشده: ${fa(missed)} · خرابی: ${fa(d.faults.length)} · تعمیر: ${fa(d.repairs.length)}
          ${d.services.length ? `<table class="list" style="margin-top:6px"><tbody>${d.services.map((x) => `<tr><td>${MONTHS[x.ym % 100 - 1]} ${fa(Math.floor(x.ym / 100))}</td><td>${jdate(x.date)}</td><td style="text-align:left">${SV[x.status] || x.status}</td></tr>`).join("")}</tbody></table>` : ""}
          ${d.faults.length ? `<div style="margin-top:6px">${d.faults.map((x) => `<div>• ${jdate(x.date)} — ${txt(x.description || "")}</div>`).join("")}</div>` : ""}</div>
        <div class="section-title"><h2>بخش مالی</h2></div>
        <div class="card"><table class="list"><tbody><tr><td>مانده ابتدای دوره</td><td style="text-align:left">${num(tom(d.opening))}</td></tr>
          ${d.ledger.map((x) => `<tr><td>${txt(x.description)}<div class="small muted">${jdate(x.date)}</div></td><td style="text-align:left;white-space:nowrap">${x.debit > 0 ? `<span class="debt">${num(tom(x.debit))}</span>` : `<span class="credit">−${num(tom(x.credit))}</span>`}</td></tr>`).join("")}
          <tr><td><b>مانده پایان دوره</b></td><td style="text-align:left"><b>${num(tom(Math.abs(d.closing)))}</b> ${balanceBadge(d.closing)}</td></tr></tbody></table><div class="hint">مبالغ به تومان</div></div>`;
      return d;
    };
    sheet(`<h3>گزارش عملکرد قرارداد</h3>
      <label>از تاریخ</label>${datePickerHtml("cfrom", from0)}<label>تا تاریخ</label>${datePickerHtml("cto", todayTehran())}
      <div class="actions"><button class="btn small" data-act="show">نمایش</button><button class="btn secondary small" data-act="csv">خروجی اکسل</button><button class="btn secondary small" data-close>بستن</button></div>
      <div data-field="out"><div class="loading">در حال بارگذاری…</div></div>`,
    (el) => {
      let last = null;
      const run = () => load(el, readDate(el, "cfrom"), readDate(el, "cto")).then((d) => { last = d; }).catch((e) => toast(e.message));
      run();
      el.querySelector('[data-act="show"]').addEventListener("click", run);
      el.querySelector('[data-act="csv"]').addEventListener("click", () => {
        if (!last) return;
        const rows = [["مانده ابتدای دوره", "", "", tom(last.opening)]];
        last.ledger.forEach((x) => rows.push([jdLatin(x.date), x.description, x.debit > 0 ? tom(x.debit) : "", x.credit > 0 ? tom(x.credit) : ""]));
        rows.push(["مانده پایان دوره", "", "", tom(last.closing)]);
        last.services.forEach((x) => rows.push(["سرویس", jdLatin(x.date), x.status === "confirmed" ? "انجام‌شده" : x.status === "missed" ? "انجام‌نشده" : x.status, ""]));
        downloadCsv(`gozaresh-gharardad-${(last.contract && last.contract.code || "").replace(/\//g, "-")}.csv`, ["تاریخ/شرح", "شرح", "بدهکار (تومان)", "بستانکار (تومان)"], rows);
      });
    });
  }

  /* ------------------------------------------------------------------ contract files (private storage) */
  const FILE_TYPE = { contract: "قرارداد امضاشده", amendment: "الحاقیه", renewal: "قرارداد تمدید", other: "سایر" };
  async function openFile(path, bucket = "contract-files") {
    const w = window.open("", "_blank"); // opened during the tap so iPhone Safari does not block it
    try {
      const t = await token();
      const res = await fetch(`${CFG.supabaseUrl}/storage/v1/object/sign/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, {
        method: "POST", headers: { apikey: CFG.supabaseKey, Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 600 }) });
      const d = await res.json();
      if (!res.ok || !d.signedURL) throw new Error(d.message || "فایل باز نشد");
      const url = `${CFG.supabaseUrl}/storage/v1${d.signedURL}`;
      if (w) w.location = url; else location.href = url;
    } catch (e) { if (w) w.close(); toast(e.message); }
  }
  async function sheetAttach(contractId) {
    const amendments = await api(`contract_change_requests?contract_id=eq.${contractId}&kind=eq.amendment&status=eq.approved&select=id,document_number&order=id.desc`);
    sheet(`<h3>پیوست فایل قرارداد</h3>
      <label>نوع فایل</label><select data-field="type">${Object.entries(FILE_TYPE).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
      <div data-show="amd" hidden><label>کدام الحاقیه؟</label><select data-field="amd">${amendments.map((a) => `<option value="${a.id}">${esc(fa(a.document_number || a.id))}</option>`).join("") || `<option value="">الحاقیه‌ی ثبت‌شده‌ای نیست</option>`}</select></div>
      <label>فایل (PDF، عکس یا Word؛ حداکثر ۲۰ مگابایت)</label><input type="file" data-field="file" accept="application/pdf,image/*,.doc,.docx">
      <label>توضیح (اختیاری)</label><input type="text" data-field="note">
      <div class="actions"><button class="btn" data-act="save">بارگذاری</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      const type = el.querySelector('[data-field="type"]');
      type.addEventListener("change", () => { el.querySelector('[data-show="amd"]').hidden = type.value !== "amendment"; });
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const f = el.querySelector('[data-field="file"]').files[0];
        if (!f) throw new Error("فایل را انتخاب کنید");
        if (f.size > 20 * 1024 * 1024) throw new Error("حجم فایل بیشتر از ۲۰ مگابایت است");
        const ext = (f.name.match(/\.([A-Za-z0-9]{1,5})$/) || [, "bin"])[1].toLowerCase();
        const rnd = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
        const path = `${contractId}/${Date.now()}-${rnd}.${ext}`;
        const t = await token();
        const res = await fetch(`${CFG.supabaseUrl}/storage/v1/object/contract-files/${path}`, {
          method: "POST", headers: { apikey: CFG.supabaseKey, Authorization: `Bearer ${t}`, "Content-Type": f.type || "application/octet-stream", "x-upsert": "false" }, body: f });
        if (!res.ok) { let m = "بارگذاری ناموفق بود"; try { const d = await res.json(); m = d.message || d.error || m; } catch (er) { /* keep */ } throw new Error(/mime|type/i.test(m) ? "این نوع فایل مجاز نیست" : m); }
        await api("documents", { method: "POST", body: { contract_id: contractId, document_type: type.value, file_name: f.name, storage_path: path, content_type: f.type || null,
          size_bytes: f.size, notes: el.querySelector('[data-field="note"]').value.trim() || null,
          change_request_id: type.value === "amendment" && el.querySelector('[data-field="amd"]').value ? Number(el.querySelector('[data-field="amd"]').value) : null } });
        close(); toast("فایل پیوست شد"); route();
      }));
    });
  }

  /* ------------------------------------------------------------------ technicians (team) */
  async function viewTeam() {
    state.techs = null;
    const list = await loadTechs();
    const act = list.filter((t) => t.status === "active"), off = list.filter((t) => t.status !== "active");
    const rt = await rpc("technician_ratings", { p_from: addDays(todayTehran(), -90), p_to: null }).catch(() => []);
    const rateLine = (t) => {
      const mine = rt.filter((r) => r.technician_id === t.id); if (!mine.length) return "";
      const part = (side, label) => {
        const rows = mine.filter((r) => r.rater_kind === side); if (!rows.length) return "";
        const n = rows.reduce((a, r) => a + Number(r.n), 0), avg = rows.reduce((a, r) => a + Number(r.avg_stars) * Number(r.n), 0) / n, low = rows.reduce((a, r) => a + Number(r.low_count), 0);
        return `<span class="rate-sum">${label}: <b>★ ${fa(avg.toFixed(1))}</b> <span class="muted">(${fa(n)} امتیاز${low ? "، " + fa(low) + " امتیاز پایین" : ""}${n < 10 ? "، هنوز کم برای قضاوت" : ""})</span></span>`;
      };
      return `<div class="small" style="display:flex;gap:14px;flex-wrap:wrap;margin-top:4px">${part("customer", "رضایت مشتری")}${part("manager", "کیفیت فنی")}</div>`;
    };
    const card = (t) => `<div class="card"><div class="item-head"><div><div class="item-title">${esc(t.name)}</div>
        <div class="small muted">${esc(skillText(t) || "بدون تخصص")}${t.mobile ? ` · <a href="tel:${esc(t.mobile)}" class="ltr">${esc(fa(t.mobile))}</a>` : ""}</div></div>
        <div style="text-align:left">${t.user_id ? `<span class="badge ok">حساب دارد</span>` : `<span class="badge">بدون حساب</span>`}</div></div>${rateLine(t)}
        <div class="actions"><button class="btn secondary small" data-act="edit-tech" data-id="${t.id}">ویرایش</button>
        ${role() === "CEO" && !t.user_id && t.status === "active" ? `<button class="btn small" data-act="tech-account" data-id="${t.id}">ساخت حساب ورود</button>` : ""}</div></div>`;
    return shell("سرویس‌کارها و تعمیرکارها", "more", `<a href="#/more" class="small">→ بازگشت</a>
      <div class="row" style="margin-top:8px"><button class="btn" data-act="new-tech">+ سرویس‌کار / تعمیرکار جدید</button></div>
      <div class="hint">امتیازها مربوط به ۹۰ روز اخیر است و فقط مدیرعامل و مدیر تعمیرات می‌بینند.</div>
      <div class="hint">همه در تمام مناطق کار می‌کنند. سرویس‌کار با حساب ورود، سرویس را خودش از گوشی ثبت می‌کند؛ تعمیرکار خرابی‌های ارجاع‌شده را می‌بیند.</div>
      ${act.map(card).join("") || `<div class="card empty">کسی تعریف نشده</div>`}
      ${off.length ? `<div class="section-title"><h2>غیرفعال</h2></div>${off.map(card).join("")}` : ""}`);
  }
  async function sheetTech(id) {
    const t = id ? (await loadTechs()).find((x) => x.id === id) : { name: "", mobile: "", skills: [], status: "active", notes: "" };
    sheet(`<h3>${id ? "ویرایش" : "سرویس‌کار / تعمیرکار جدید"}</h3>
      <label>نام و نام خانوادگی</label><input type="text" data-field="name" value="${esc(t.name || "")}">
      <label>موبایل</label><input type="text" data-field="mobile" class="ltr" inputmode="tel" value="${esc(t.mobile || "")}">
      <label>تخصص</label>${Object.entries(SKILL).map(([k, v]) => `<label class="row small" style="color:var(--text)"><input type="checkbox" data-skill="${k}" ${(t.skills || []).includes(k) ? "checked" : ""}> ${v}</label>`).join("")}
      <label>توضیح</label><input type="text" data-field="notes" value="${esc(t.notes || "")}">
      ${id ? `<label class="row small" style="color:var(--text)"><input type="checkbox" data-field="active" ${t.status === "active" ? "checked" : ""}> فعال</label>` : ""}
      <div class="actions"><button class="btn" data-act="save">ذخیره</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const name = el.querySelector('[data-field="name"]').value.trim();
        const mobile = toEn(el.querySelector('[data-field="mobile"]').value.trim()) || null;
        const skills = Array.from(el.querySelectorAll("[data-skill]:checked")).map((i) => i.dataset.skill);
        if (!name) throw new Error("نام را وارد کنید");
        if (mobile && !/^09\d{9}$/.test(mobile)) throw new Error("موبایل باید ۱۱ رقم و با ۰۹ شروع شود");
        if (!skills.length) throw new Error("حداقل یک تخصص انتخاب کنید");
        const body = { name, mobile, skills, notes: el.querySelector('[data-field="notes"]').value.trim() || null, service_region: "همه مناطق" };
        if (id) body.status = el.querySelector('[data-field="active"]').checked ? "active" : "inactive";
        if (id) await api(`technicians?id=eq.${id}`, { method: "PATCH", body });
        else await api("technicians", { method: "POST", body: { ...body, status: "active" } });
        state.techs = null; close(); toast("ذخیره شد"); route();
      }));
    });
  }

  // technician: own service reports and recording a new one
  async function myTech() {
    if (state.myTech === undefined) { const r = await api(`technicians?user_id=eq.${session.user_id}&select=id,name,skills,status`); state.myTech = r[0] || null; }
    return state.myTech;
  }
  async function viewTechServices() {
    const me = await myTech();
    const canService = me && me.status === "active" && (me.skills || []).includes("service");
    const list = me ? await api(`service_reports?technician_id=eq.${me.id}&select=id,report_number,service_date,service_year,service_month,status,report_text,rejection_note,contract_id&order=service_date.desc,id.desc&limit=100`) : [];
    const targets = canService ? await rpc("service_targets") : [];
    const asg = me ? await rpc("my_assignments", { p_from: addDays(todayTehran(), -45), p_to: null }) : [];
    const open = asg.filter((a) => a.status === "planned");
    const nameOf = new Map(targets.map((t) => [t.contract_id, `${t.building_name} (${t.contract_code})`]));
    asg.forEach((a) => nameOf.set(a.contract_id, `${a.building_name} (${a.contract_code})`));
    return shell("سرویس‌های من", "services", `
      <div class="section-title"><h2>ارجاع‌های من</h2></div>
      ${open.length ? open.map((a) => assignmentCard(a, true)).join("") : `<div class="card empty">سرویسی به شما ارجاع نشده است</div>`}
      <div class="section-title"><h2>سرویس‌های ثبت‌شده</h2></div>
      ${list.length ? list.map((x) => `<div class="card"><div class="item-head"><div><div class="item-title">${esc(nameOf.get(x.contract_id) || "قرارداد " + fa(x.contract_id))}</div>
        <div class="small muted">${jdate(x.service_date)}${x.report_number ? " · گزارش " + esc(fa(x.report_number)) : ""}</div></div>${badge(SERVICE_STATUS, x.status)}</div>
        ${x.rejection_note ? `<div class="small debt">دلیل رد: ${esc(x.rejection_note)}</div>` : ""}</div>`).join("") : `<div class="card empty">سرویسی ثبت نکرده‌اید</div>`}`);
  }
  function addDays(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function dayLabel(iso) {
    const t = todayTehran();
    if (iso === t) return "امروز"; if (iso === addDays(t, 1)) return "فردا"; if (iso === addDays(t, -1)) return "دیروز";
    return jdate(iso);
  }
  function navButtons(lat, lng) {
    return `<a class="btn small" href="https://nshn.ir/?lat=${lat}&lng=${lng}" target="_blank" rel="noopener">مسیریابی با نشان</a>
      <a class="btn secondary small" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank" rel="noopener">گوگل‌مپ</a>`;
  }
  // forTech: technician card (record + navigation + location); otherwise the office plan card (cancel)
  function assignmentCard(a, forTech) {
    const late = a.status === "planned" && a.planned_date < todayTehran();
    const acts = [];
    if (forTech) {
      acts.push(`<button class="btn ok small" data-act="tech-new-service" data-cid="${a.contract_id}">ثبت سرویس</button>`);
      if (a.lat != null) acts.push(navButtons(a.lat, a.lng));
      else if (!a.loc_pending) acts.push(`<button class="btn secondary small" data-act="send-location" data-bid="${a.building_id}">ثبت موقعیت ساختمان</button>`);
    } else if (a.status === "planned") {
      acts.push(`<button class="btn secondary small" data-act="cancel-assignment" data-id="${a.id}">لغو ارجاع</button>`);
    }
    const st = a.status === "done" ? `<span class="badge ok">ثبت شد</span>` : a.status === "cancelled" ? `<span class="badge">لغو شده</span>` : late ? `<span class="badge danger">عقب‌افتاده</span>` : `<span class="badge info">${dayLabel(a.planned_date)}</span>`;
    return `<div class="card"><div class="item-head"><div class="with-key"><span class="call-key">${esc(fa(String(a.contract_code).split("-")[0]))}</span><div>
      <div class="item-title">${esc(a.building_name || "")}</div>
      <div class="small muted">${[forTech ? jdate(a.planned_date) : "", esc(a.address || "")].filter(Boolean).join(" · ")}</div></div></div>${st}</div>
      ${a.manager_mobile && forTech ? `<div class="small">مدیر ساختمان: ${esc(a.manager_name || "")} <a href="tel:${esc(toEn(a.manager_mobile))}" class="ltr">${esc(fa(a.manager_mobile))}</a></div>` : ""}
      ${a.note ? `<div class="small muted">${txt(a.note)}</div>` : ""}
      ${forTech && a.lat == null && a.loc_pending ? `<div class="small muted">موقعیت ساختمان ثبت شده و منتظر تأیید مدیر تعمیرات است.</div>` : ""}
      ${acts.length ? `<div class="actions">${acts.join("")}</div>` : ""}</div>`;
  }
  async function sendLocation(buildingId) {
    if (!navigator.geolocation) throw new Error("این گوشی موقعیت‌یاب ندارد");
    toast("در حال گرفتن موقعیت… داخل یا جلوی ساختمان باشید");
    const pos = await new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, (e) => no(new Error(e.code === 1 ? "اجازه‌ی دسترسی به موقعیت داده نشد؛ از تنظیمات مرورگر اجازه دهید" : "موقعیت گرفته نشد؛ دوباره امتحان کنید")), { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }));
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    if (!confirm(`موقعیت با دقت حدود ${fa(Math.round(accuracy))} متر گرفته شد. برای تأیید مدیر تعمیرات فرستاده شود؟`)) return;
    await rpc("submit_building_location", { p_building_id: Number(buildingId), p_lat: lat, p_lng: lng });
    toast("موقعیت ثبت شد؛ پس از تأیید مدیر تعمیرات مسیریابی فعال می‌شود"); route();
  }

  /* office: daily service plan and assignment (D-50) */
  let planDate = null;
  async function viewPlan() {
    if (!planDate) planDate = addDays(todayTehran(), 1);
    const rows = await rpc("my_assignments", { p_from: planDate, p_to: planDate });
    const byTech = new Map();
    rows.filter((a) => a.status !== "cancelled").forEach((a) => { if (!byTech.has(a.technician_name)) byTech.set(a.technician_name, []); byTech.get(a.technician_name).push(a); });
    return shell("برنامه سرویس", "services", `
      <div class="card"><label>روز برنامه</label>${datePickerHtml("pday", planDate)}
        <div class="actions"><button class="btn secondary small" data-act="plan-day" data-d="-1">روز قبل</button><button class="btn secondary small" data-act="plan-go">نمایش</button><button class="btn secondary small" data-act="plan-day" data-d="1">روز بعد</button></div></div>
      <div class="row"><button class="btn" data-act="new-assignment">+ ارجاع سرویس</button></div>
      <div class="section-title"><h2>${dayLabel(planDate)} · ${fa(rows.filter((a) => a.status !== "cancelled").length)} سرویس</h2></div>
      ${byTech.size ? [...byTech.entries()].map(([t, list]) => `<div class="section-title"><h2 class="small">${esc(t)} (${fa(list.length)})</h2></div>${list.map((a) => assignmentCard(a, false)).join("")}`).join("")
        : `<div class="card empty">برای این روز سرویسی ارجاع نشده است</div>`}`);
  }
  async function sheetNewAssignment() {
    const techs = (await api("technicians?status=eq.active&select=id,name,skills&order=name")).filter((t) => (t.skills || []).includes("service"));
    const targets = await rpc("service_targets");
    sheet(`<h3>ارجاع سرویس</h3>
      <label>سرویس‌کار</label><select data-field="tech">${techs.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select>
      <label>روز سرویس</label>${datePickerHtml("adate", planDate || addDays(todayTehran(), 1))}
      <label>ساختمان‌ها <span class="small muted" data-field="cnt"></span></label>
      <input type="search" data-field="q" placeholder="جست‌وجوی ساختمان، کد یا آدرس">
      <div class="pick-list" data-field="list">${targets.map((t) => `<label class="pick" data-s="${esc(toEn(t.building_name + " " + t.contract_code + " " + (t.address || "")))}"><input type="checkbox" value="${t.contract_id}">
        <span><b>${esc(fa(t.contract_code))}</b> — ${esc(t.building_name)}<br><span class="small muted">${esc(t.address || "")}</span></span></label>`).join("")}</div>
      <label>توضیح برای سرویس‌کار</label><input type="text" data-field="note" placeholder="اختیاری">
      <div class="actions"><button class="btn" data-act="save">ارجاع</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      const cnt = () => { el.querySelector('[data-field="cnt"]').textContent = `(${fa(el.querySelectorAll(".pick input:checked").length)} انتخاب)`; };
      el.querySelector('[data-field="list"]').addEventListener("change", cnt); cnt();
      el.querySelector('[data-field="q"]').addEventListener("input", (e) => {
        const q = toEn(e.target.value).trim();
        el.querySelectorAll(".pick").forEach((o) => { o.style.display = !q || o.dataset.s.includes(q) ? "" : "none"; });
      });
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const ids = [...el.querySelectorAll(".pick input:checked")].map((i) => Number(i.value));
        if (!ids.length) throw new Error("حداقل یک ساختمان انتخاب کنید");
        const day = readDate(el, "adate"), tech = Number(el.querySelector('[data-field="tech"]').value), note = el.querySelector('[data-field="note"]').value.trim() || null;
        try {
          await api("service_assignments", { method: "POST", body: ids.map((cid) => ({ contract_id: cid, technician_id: tech, planned_date: day, note })) });
        } catch (er) {
          if (/duplicate|unique|23505/i.test(er.message)) throw new Error("یکی از این ساختمان‌ها برای همین روز قبلاً ارجاع شده است");
          throw er;
        }
        planDate = day; close(); toast(`${fa(ids.length)} سرویس ارجاع شد`); location.hash = "#/plan"; route();
      }));
    });
  }

  /* repair manager / CEO: approve building locations (D-51) */
  async function viewLocations() {
    const rows = await rpc("pending_building_locations");
    return shell("موقعیت ساختمان‌ها", "more", `
      <div class="hint">موقعیت‌هایی که سرویس‌کار یا مدیر ساختمان فرستاده؛ روی نقشه ببینید و تأیید کنید. بعد از تأیید، دکمه‌ی مسیریابی روی هر ارجاع همان ساختمان فعال می‌شود.</div>
      ${rows.length ? rows.map((r) => `<div class="card"><div class="item-title">${esc(r.building_name)}</div>
        <div class="small muted">${esc(r.address || "")}</div>
        <div class="small muted">فرستنده: ${esc(r.submitted_by_name || "—")} · ${r.submitted_at ? jdate(String(r.submitted_at).slice(0, 10)) : ""}${r.old_lat != null ? " · جایگزین موقعیت قبلی" : ""}</div>
        <div class="actions"><a class="btn secondary small" href="https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}" target="_blank" rel="noopener">دیدن روی نقشه</a>
          <a class="btn secondary small" href="https://nshn.ir/?lat=${r.lat}&lng=${r.lng}" target="_blank" rel="noopener">در نشان</a>
          <button class="btn ok small" data-act="loc-decide" data-id="${r.building_id}" data-ok="1">تأیید</button>
          <button class="btn danger small" data-act="loc-decide" data-id="${r.building_id}" data-ok="0">رد</button></div></div>`).join("") : `<div class="card empty">موقعیتی منتظر تأیید نیست</div>`}`);
  }
  async function sheetTechService(preCid) {
    const me = await myTech();
    const targets = await rpc("service_targets");
    sheet(`<h3>ثبت سرویس</h3>
      <input type="search" data-field="q" placeholder="جست‌وجوی ساختمان یا کد">
      <select data-field="contract" size="6" style="margin-top:6px;height:auto">${targets.map((t) => `<option value="${t.contract_id}" data-s="${esc(toEn(t.building_name + " " + t.contract_code + " " + (t.address || "")))}">${esc(fa(t.contract_code))} — ${esc(t.building_name)}</option>`).join("")}</select>
      <div class="small muted" data-field="info"></div>
      <label>تاریخ سرویس</label>${datePickerHtml("sdate")}
      <label>شماره گزارش (برگه سرویس)</label><input type="text" data-field="rno" class="ltr" inputmode="numeric">
      <label>توضیحات</label><textarea data-field="text" placeholder="کارهای انجام‌شده، ایرادهای دیده‌شده"></textarea>
      <div class="hint">بعد از ثبت، مدیر ساختمان، مدیر تعمیرات یا مدیرعامل تأیید می‌کند.</div>
      <div class="actions"><button class="btn" data-act="save">ثبت</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      const sel = el.querySelector('[data-field="contract"]');
      if (preCid) sel.value = String(preCid);
      const info = () => { const t = targets.find((x) => String(x.contract_id) === sel.value); el.querySelector('[data-field="info"]').textContent = t ? `${t.address || ""}${t.manager_name ? " · مدیر: " + t.manager_name : ""}` : ""; };
      sel.addEventListener("change", info); if (preCid) info();
      el.querySelector('[data-field="q"]').addEventListener("input", (e) => {
        const q = toEn(e.target.value).trim();
        Array.from(sel.options).forEach((o) => { o.hidden = !!q && !o.dataset.s.includes(q); });
      });
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        if (!sel.value) throw new Error("ساختمان را انتخاب کنید");
        await api("service_reports", { method: "POST", body: { contract_id: Number(sel.value), service_date: readDate(el, "sdate"), technician_id: me.id,
          report_number: toEn(el.querySelector('[data-field="rno"]').value.trim()) || null, report_text: el.querySelector('[data-field="text"]').value.trim() || null,
          status: "pending_confirmation" } });
        close(); toast("سرویس ثبت شد؛ منتظر تأیید"); route();
      }));
    });
  }

  /* ------------------------------------------------------------------ documents: print, public link, payment notices */
  // anyone holding a document link may call these two functions (no sign-in); the database returns only that document
  async function publicRpc(fn, args) {
    const res = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST", headers: { apikey: CFG.supabaseKey, "Content-Type": "application/json" }, body: JSON.stringify(args || {})
    });
    const t = await res.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { d = { message: t }; }
    if (!res.ok) throw new Error(translateError(d));
    return d;
  }

  // Persian words for an amount (used for "مبلغ به حروف")
  const W1 = ["", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه"];
  const W10 = ["ده", "یازده", "دوازده", "سیزده", "چهارده", "پانزده", "شانزده", "هفده", "هجده", "نوزده"];
  const W20 = ["", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود"];
  const W100 = ["", "یکصد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد"];
  const WSCALE = ["", "هزار", "میلیون", "میلیارد", "هزار میلیارد"];
  function words3(n) {
    const p = []; const h = Math.floor(n / 100), r = n % 100;
    if (h) p.push(W100[h]);
    if (r >= 10 && r < 20) p.push(W10[r - 10]);
    else { if (r >= 20) p.push(W20[Math.floor(r / 10)]); if (r % 10) p.push(W1[r % 10]); }
    return p.join(" و ");
  }
  function numWords(n) {
    n = Math.floor(Math.abs(Number(n || 0)));
    if (!n) return "صفر";
    const parts = []; let i = 0;
    while (n > 0 && i < WSCALE.length) { const g = n % 1000; if (g) parts.unshift(words3(g) + (WSCALE[i] ? " " + WSCALE[i] : "")); n = Math.floor(n / 1000); i++; }
    return parts.join(" و ");
  }
  window.__payacoWords = numWords;

  const DOC_TITLE = { statement: "صورتحساب سرویس و نگهداری", repair_invoice: "فاکتور تعمیرات", proforma: "پیش‌فاکتور", final_invoice: "فاکتور" };
  const docLink = (token) => `${location.origin}${location.pathname}#/p/${token}`;
  const rial = (n) => `${num(n)}`;
  // bank numbers stay in English digits: some banking apps reject Persian digits when pasted
  const groupCard = (s) => toEn(s).replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1-");

  function renderDoc(d, opts = {}) {
    const c = d.company || {};
    const items = d.items || [];
    const paid = (d.payments || []).reduce((a, p) => a + Number(p.amount), 0);
    const bal = Number(d.account_balance || 0);
    const payable = Math.max(bal, 0);
    const copyBtn = (val, label) => `<button type="button" class="doc-copy no-print" data-act="copy" data-val="${esc(val)}" aria-label="کپی ${esc(label)}">کپی</button>`;
    const bankRow = (label, val, shown, ltr = true) => val ? `<div class="doc-bank-row"><span class="doc-bank-label">${label}</span><bdi dir="${ltr ? "ltr" : "rtl"}" class="doc-bank-val">${shown}</bdi>${copyBtn(val, label)}</div>` : "";
    const contacts = [
      c.phone ? `<span>☎ <bdi dir="ltr">${esc(fa(c.phone))}</bdi></span>` : "",
      c.phone2 ? `<span>☎ <bdi dir="ltr">${esc(fa(c.phone2))}</bdi></span>` : "",
      c.website ? `<span>🌐 <bdi dir="ltr">${esc(c.website)}</bdi></span>` : "",
      c.instagram ? `<span>Instagram: <bdi dir="ltr">@${esc(c.instagram.replace(/^@/, ""))}</bdi></span>` : ""
    ].filter(Boolean).join("");
    return `<article class="doc" id="doc">
      ${d.status === "cancelled" ? `<div class="doc-void">ابطال‌شده</div>` : ""}
      <header class="doc-head">
        <img src="icons/logo.png" alt="پایاکو - آسانسور و پله‌برقی" class="doc-logo">
        <div class="doc-title"><h2>${esc(DOC_TITLE[d.type] || DOC_TYPE[d.type] || "سند")}</h2>
          <div>شماره: <bdi dir="ltr" class="doc-no">${esc(fa(d.number || "—"))}</bdi></div>
          <div>تاریخ: ${jdate(d.issue_date)}</div>
          ${d.due_date ? `<div>مهلت پرداخت: ${jdate(d.due_date)}</div>` : ""}</div>
      </header>
      <table class="doc-info"><tbody>
        <tr><th>مشترک</th><td>${esc((d.customer && d.customer.name) || "—")}</td><th>شماره قرارداد</th><td>${esc(fa((d.contract && d.contract.code) || "—"))}</td></tr>
        <tr><th>ساختمان</th><td>${esc((d.building && d.building.name) || "—")}</td><th>کد اشتراک</th><td><bdi dir="ltr">${esc(fa((d.contract && d.contract.subscription) || "—"))}</bdi></td></tr>
        ${d.building && d.building.address ? `<tr><th>نشانی</th><td colspan="3">${esc(fa(d.building.address))}</td></tr>` : ""}
      </tbody></table>
      <table class="doc-items"><thead><tr><th style="width:2.2em">ردیف</th><th>شرح</th><th style="width:9.5em">مبلغ (ریال)</th></tr></thead><tbody>
        ${items.map((it, k) => `<tr><td class="c">${fa(k + 1)}</td><td>${txt(it.description)}${Number(it.qty) > 1 ? `<div class="doc-sub">${fa(Number(it.qty))} × ${rial(it.unit_price)} ریال</div>` : ""}</td>
          <td class="n">${it.dc === "credit" ? "−" : ""}${rial(it.amount)}</td></tr>`).join("")}
      </tbody><tfoot>
        ${Number(d.discount) ? `<tr><td colspan="2">جمع</td><td class="n">${rial(d.subtotal)}</td></tr><tr><td colspan="2">تخفیف</td><td class="n">−${rial(d.discount)}</td></tr>` : ""}
        <tr class="strong"><td colspan="2">مبلغ این ${d.type === "statement" ? "صورتحساب" : "سند"}</td><td class="n">${rial(d.total)}</td></tr>
        ${d.previous_balance !== null && d.previous_balance !== undefined && Number(d.previous_balance) !== 0 ? `<tr><td colspan="2">مانده‌ی حساب پیش از این سند ${Number(d.previous_balance) < 0 ? "(بستانکار)" : ""}</td><td class="n">${rial(Math.abs(d.previous_balance))}</td></tr>` : ""}
        ${paid ? `<tr><td colspan="2">پرداخت‌شده بابت این سند</td><td class="n">−${rial(paid)}</td></tr>` : ""}
        <tr class="doc-payable"><td colspan="2">${bal < 0 ? "مانده‌ی بستانکاری شما" : "مبلغ قابل پرداخت (مانده‌ی فعلی حساب)"}</td><td class="n">${rial(Math.abs(bal))}</td></tr>
      </tfoot></table>
      <div class="doc-words">${payable ? `مبلغ قابل پرداخت به حروف: <b>${numWords(payable)} ریال</b> (معادل ${num(Math.round(payable / 10))} تومان)` : bal < 0 ? "حساب شما بستانکار است و از صورتحساب‌های بعدی کسر می‌شود." : "حساب شما تسویه است. سپاسگزاریم."}</div>
      ${d.notes ? `<div class="doc-notes">${txt(d.notes)}</div>` : ""}
      ${(d.payments || []).length ? `<div class="doc-pay-title">پرداخت‌های ثبت‌شده بابت این سند</div><table class="doc-items doc-pay"><thead><tr><th style="width:2.2em">ردیف</th><th>تاریخ و روش</th><th>پیگیری</th><th style="width:9.5em">مبلغ (ریال)</th></tr></thead><tbody>
        ${(d.payments || []).map((p, k) => `<tr><td class="c">${fa(k + 1)}</td><td>${jdate(p.date)} · ${esc(METHOD[p.method] || "")}</td><td><bdi dir="ltr">${esc(fa(p.tracking || "—"))}</bdi></td><td class="n">${rial(p.amount)}</td></tr>`).join("")}
        </tbody>${(d.payments || []).length > 1 ? `<tfoot><tr class="strong"><td colspan="3">جمع پرداخت‌ها</td><td class="n">${rial(paid)}</td></tr></tfoot>` : ""}</table>` : ""}
      ${(c.card_no || c.sheba || c.account_no) ? `<section class="doc-bank"><div class="doc-bank-title">اطلاعات واریز${c.bank ? " — " + esc(c.bank) : ""}${c.account_holder ? " — به نام " + esc(c.account_holder) : ""}</div>
        ${bankRow("شماره کارت", c.card_no, groupCard(c.card_no))}
        ${bankRow("شماره حساب", c.account_no, esc(toEn(c.account_no)))}
        ${bankRow("شماره شبا", c.sheba, esc(toEn(c.sheba).toUpperCase()))}
        <div class="doc-sub">لطفاً پس از واریز، ${opts.public ? "با دکمه‌ی «اعلام پرداخت» پایین همین صفحه" : "از راه لینک همین صورتحساب"} شماره پیگیری را اعلام کنید.</div></section>` : ""}
      <footer class="doc-foot">
        ${c.slogan ? `<div class="doc-slogan">${esc(c.slogan)}${c.slogan_en ? ` <span dir="ltr">${esc(c.slogan_en)}</span>` : ""}</div>` : ""}
        <div class="doc-contacts">${contacts}</div>
        ${c.address ? `<div>${esc(fa(c.address))}</div>` : ""}
        ${c.footer_note ? `<div>${esc(c.footer_note)}</div>` : ""}
      </footer>
    </article>`;
  }

  function docActions(d, pub) {
    const a = [`<button class="btn" data-act="doc-print">چاپ / ذخیره PDF</button>`];
    if (!pub && d.token) a.push(`<button class="btn secondary" data-act="doc-share" data-token="${esc(d.token)}" data-no="${esc(d.number || "")}">ارسال لینک برای مشترک</button>`);
    if (!pub && can.recordPayment() && d.status !== "cancelled") a.push(`<button class="btn secondary" data-act="doc-sms" data-id="${d.id}">ارسال پیامک</button>`);
    const open = ["issued", "partially_paid"].includes(d.status);
    if (pub && open) a.push(`<button class="btn ok" data-act="pub-claim">اعلام پرداخت</button>`);
    return `<div class="actions no-print doc-actions">${a.join("")}</div>
      ${Number(d.pending_claims) ? `<div class="hint no-print">${fa(d.pending_claims)} اعلام پرداخت برای این سند منتظر بررسی دفتر است.</div>` : ""}
      ${pub ? `<div class="hint no-print">برای ذخیره‌ی PDF در آیفون: «چاپ / ذخیره PDF» ← دکمه‌ی اشتراک‌گذاری ← Save to Files.</div>` : ""}`;
  }

  let publicDoc = null;
  async function viewPublicDoc(token, code) {
    $app.innerHTML = `<div class="loading">در حال بارگذاری…</div>`;
    try {
      if (code) { publicDoc = await publicRpc("get_invoice_document_by_code", { p_code: code }); publicDoc.__token = publicDoc.public_token; }
      else { publicDoc = await publicRpc("get_invoice_document", { p_token: token }); publicDoc.__token = token; }
      $app.innerHTML = `<main class="doc-page">${renderDoc(publicDoc, { public: true })}${docActions(publicDoc, true)}</main>`;
    } catch (e) {
      $app.innerHTML = `<div class="login-wrap"><div class="login-card"><img src="icons/logo.png" alt="پایاکو" class="doc-logo" style="margin:0 auto 10px;display:block">
        <h1>سند پیدا نشد</h1><p class="muted">لینک نادرست است یا سند در دسترس نیست. لطفاً با دفتر پایاکو تماس بگیرید.</p></div></div>`;
    }
  }

  async function viewDoc(id) {
    const d = await rpc("get_invoice_document", { p_invoice_id: id });
    const sms = isStaff() ? await api(`sms_log?invoice_id=eq.${id}&select=created_at,mobile,status,test_mode&order=created_at.desc&limit=5`).catch(() => []) : [];
    return shell(DOC_TITLE[d.type] || "سند", "contracts", `<a href="#/contracts" data-act="doc-back" class="small no-print">→ بازگشت</a>
      <div class="doc-page">${renderDoc(d)}${docActions(d, false)}
      ${sms.length ? `<div class="card no-print" style="margin-top:10px"><div class="item-title">پیامک‌های این سند</div>${sms.map((m) => `<div class="small">${jtime(m.created_at)} · <bdi dir="ltr">${esc(fa(m.mobile))}</bdi> · ${m.status === "sent" ? "ارسال شد" : "ناموفق"}${m.test_mode ? " (آزمایشی)" : ""}</div>`).join("")}</div>` : ""}</div>`);
  }

  async function sheetSms(id) {
    const pre = await callFunction("send-sms", { invoice_id: id, dry_run: true });
    sheet(`<h3>ارسال پیامک لینک سند</h3>
      ${pre.test ? `<div class="error-box" style="margin-top:0">حالت آزمایشی: پیامک فقط به شماره‌ی آزمایشی (<bdi dir="ltr">${esc(fa(pre.to))}</bdi>) فرستاده می‌شود، نه به مشترک. ${role() === "CEO" ? "تغییر در «اطلاعات شرکت روی اسناد»." : ""}</div>` : ""}
      <label>شماره همراه گیرنده</label><input type="text" data-field="mobile" class="ltr" inputmode="tel" value="${esc(pre.intended || "")}" placeholder="09xxxxxxxxx">
      <div class="hint">پیش‌فرض: موبایل مدیر ساختمان.</div>
      <label>متن پیامک</label><div class="receipt-text small">${esc(pre.text)}</div>
      ${pre.template ? `<div class="hint">ارسال با قالب شماره ${esc(fa(pre.template))}؛ متن نهایی همان قالب تأییدشده در SMS.ir است.</div>` : ""}
      <div class="actions"><button class="btn" data-act="save">ارسال</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const r = await callFunction("send-sms", { invoice_id: id, mobile: toEn(el.querySelector('[data-field="mobile"]').value.trim()) || null });
        close(); toast(r.test ? `پیامک آزمایشی به ${fa(r.to)} فرستاده شد` : `پیامک به ${fa(r.to)} فرستاده شد`); route();
      }));
    });
  }

  function sheetPublicClaim() {
    const d = publicDoc; if (!d) return;
    sheet(`<h3>اعلام پرداخت</h3>
      <div class="hint">پس از واریز به حساب پایاکو، مشخصات واریز را ثبت کنید. دریافت پس از بررسی دفتر در حساب شما ثبت می‌شود.</div>
      ${amountFieldHtml("amt", "مبلغ واریزی")}
      <label>تاریخ واریز</label>${datePickerHtml("pdate")}
      <label>شماره پیگیری یا ارجاع</label><input type="text" data-field="track" class="ltr" inputmode="numeric">
      <label>نام واریزکننده</label><input type="text" data-field="name">
      <label>شماره همراه (اختیاری)</label><input type="text" data-field="mobile" class="ltr" inputmode="tel">
      <label>عکس یا PDF رسید (اختیاری، حداکثر ۵ مگابایت)</label><input type="file" data-field="file" accept="image/*,application/pdf">
      <label>یا متن رسید را اینجا بچسبانید (اختیاری)</label><textarea data-field="rtext" placeholder="متن پیامک یا رسیدی که بانک داده است"></textarea>
      <label>توضیح (اختیاری)</label><input type="text" data-field="note">
      <div class="actions"><button class="btn ok" data-act="save">ثبت اعلام پرداخت</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      bindAmount(el, "amt");
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const a = readAmount(el, "amt");
        if (!a.value) throw new Error("مبلغ را وارد کنید");
        const track = toEn(el.querySelector('[data-field="track"]').value.trim());
        if (track.length < 4) throw new Error("شماره پیگیری را وارد کنید");
        const file = el.querySelector('[data-field="file"]').files[0];
        if (file && file.size > 5 * 1024 * 1024) throw new Error("حجم فایل رسید بیشتر از ۵ مگابایت است");
        const claimId = await publicRpc("submit_payment_claim", { p_receipt_text: el.querySelector('[data-field="rtext"]').value.trim() || null, p_token: d.__token, p_amount_rial: a.rial, p_paid_date: readDate(el, "pdate"), p_tracking: track,
          p_payer_name: el.querySelector('[data-field="name"]').value.trim() || null, p_payer_mobile: toEn(el.querySelector('[data-field="mobile"]').value.trim()) || null,
          p_note: el.querySelector('[data-field="note"]').value.trim() || null });
        let receiptOk = true;
        if (file) {
          try {
            const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf" })[file.type] || "jpg";
            const path = `${d.__token}/${claimId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
            const up = await fetch(`${CFG.supabaseUrl}/storage/v1/object/payment-receipts/${path}`, {
              method: "POST", headers: { apikey: CFG.supabaseKey, "Content-Type": file.type || "image/jpeg" }, body: file });
            if (!up.ok) throw new Error("upload");
            await publicRpc("attach_claim_receipt", { p_token: d.__token, p_claim_id: claimId, p_path: path });
          } catch (er) { receiptOk = false; }
        }
        close(); toast(receiptOk ? "اعلام پرداخت ثبت شد؛ پس از بررسی در حساب شما ثبت می‌شود" : "اعلام پرداخت ثبت شد ولی فایل رسید بارگذاری نشد؛ لطفاً رسید را برای دفتر بفرستید"); viewPublicDoc(d.__token);
      }));
    });
  }

  async function copyText(val) {
    try { await navigator.clipboard.writeText(val); toast("کپی شد"); }
    catch (e) {
      const t = document.createElement("textarea"); t.value = val; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); toast("کپی شد"); } catch (er) { prompt("کپی کنید:", val); }
      t.remove();
    }
  }
  async function shareDocLink(token, no) {
    const url = docLink(token);
    const text = `صورتحساب پایاکو${no ? " شماره " + fa(no) : ""}`;
    if (navigator.share) { try { await navigator.share({ title: text, text, url }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
    copyText(url);
  }

  async function viewClaims() {
    const pend = await api("payment_claims?status=eq.pending&select=*,invoices(id,document_number,contract_id,buildings(name))&order=created_at.asc");
    const done = await api("payment_claims?status=neq.pending&select=*,invoices(id,document_number,contract_id,buildings(name))&order=decided_at.desc&limit=10");
    const card = (k, open) => `<div class="card"><div class="item-head"><div><div class="item-title">${esc(k.invoices && k.invoices.buildings ? k.invoices.buildings.name : "")}</div>
        <div class="small muted">سند <bdi dir="ltr">${esc(fa(k.invoices ? k.invoices.document_number || "" : ""))}</bdi> · واریز ${jdate(k.paid_date)} · پیگیری <bdi dir="ltr">${esc(fa(k.tracking_number))}</bdi></div>
        <div class="small muted">${esc(k.payer_name || "")}${k.payer_mobile ? ` · <bdi dir="ltr">${esc(fa(k.payer_mobile))}</bdi>` : ""}${k.note ? " · " + esc(k.note) : ""} · ثبت ${jtime(k.created_at)}</div>
        ${k.receipt_text ? `<div class="small receipt-text">${esc(k.receipt_text)}</div>` : ""}</div>
        <div style="text-align:left">${money(k.amount_rial)}${open ? "" : k.status === "approved" ? `<span class="badge ok">ثبت شد</span>` : `<span class="badge danger">رد شد</span>`}</div></div>
        ${open ? `<div class="actions"><button class="btn ok small" data-act="claim-approve" data-id="${k.id}">تأیید و ثبت دریافت</button><button class="btn secondary small" data-act="claim-reject" data-id="${k.id}">رد</button>
          ${k.receipt_path ? `<button class="btn secondary small" data-act="open-receipt" data-path="${esc(k.receipt_path)}">مشاهده رسید</button>` : ""}
          <a class="btn secondary small" href="#/doc/${k.invoices ? k.invoices.id : ""}">مشاهده سند</a></div>` : k.decision_note ? `<div class="small muted">${esc(k.decision_note)}</div>` : ""}</div>`;
    return shell("اعلام پرداخت مشتریان", "more", `<a href="#/more" class="small">→ بازگشت</a>
      <div class="hint">مشترک بعد از واریز، از لینک صورتحساب مبلغ و شماره پیگیری را اعلام می‌کند. پیش از تأیید، واریز را در حساب بانکی بررسی کنید؛ با تأیید، دریافت در دفتر مالی ثبت می‌شود.</div>
      ${pend.length ? pend.map((k) => card(k, true)).join("") : `<div class="card empty">اعلام پرداختی منتظر بررسی نیست</div>`}
      ${done.length ? `<div class="section-title"><h2>بررسی‌شده‌های اخیر</h2></div>${done.map((k) => card(k, false)).join("")}` : ""}`);
  }
  function sheetClaimApprove(id) {
    sheet(`<h3>تأیید اعلام پرداخت</h3>
      <div class="hint">فقط اگر واریز را در حساب بانکی دیده‌اید تأیید کنید. دریافت ثبت‌شده قابل ویرایش نیست.</div>
      <label>روش پرداخت</label><select data-field="method"><option value="card">کارت به کارت</option><option value="bank_transfer">انتقال بانکی (شبا/حساب)</option><option value="cash">نقد</option><option value="other">سایر</option></select>
      <label>توضیح (اختیاری)</label><input type="text" data-field="note">
      <div class="actions"><button class="btn ok" data-act="save">تأیید و ثبت دریافت</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        await rpc("decide_payment_claim", { p_id: id, p_approve: true, p_method: el.querySelector('[data-field="method"]').value, p_note: el.querySelector('[data-field="note"]').value.trim() || null });
        close(); toast("دریافت ثبت شد"); route();
      }));
    });
  }

  async function viewCompany() {
    const c = await rpc("get_company_profile");
    const st = await api("app_settings?key=in.(sms.mode,sms.test_mobile,sms.template_id)&select=key,value");
    const tplId = (st.find((x) => x.key === "sms.template_id") || {}).value || "";
    const smsMode = (st.find((x) => x.key === "sms.mode") || {}).value || "test";
    const testMobile = (st.find((x) => x.key === "sms.test_mobile") || {}).value || "";
    const F = [["name", "نام روی اسناد"], ["slogan", "شعار"], ["slogan_en", "شعار انگلیسی"], ["phone", "تلفن", 1], ["phone2", "تلفن دوم", 1], ["website", "سایت", 1], ["instagram", "پیج اینستاگرام", 1],
      ["address", "آدرس دفتر"], ["bank", "بانک"], ["account_holder", "به نام"], ["card_no", "شماره کارت", 1], ["account_no", "شماره حساب", 1], ["sheba", "شماره شبا", 1], ["footer_note", "یادداشت پایین اسناد"]];
    return shell("اطلاعات شرکت روی اسناد", "more", `<a href="#/more" class="small">→ بازگشت</a>
      <div class="card" id="company-form">${F.map(([k, l, ltr]) => `<label>${l}</label><input type="text" data-field="${k}" value="${esc(c[k] || "")}" ${ltr ? 'class="ltr"' : ""}>`).join("")}
      <div class="hint">این اطلاعات روی همه‌ی صورتحساب‌ها، فاکتورها و لینک‌های پرداخت نمایش داده می‌شود. لوگو ثابت است.</div>
      <div class="actions"><button class="btn" data-act="company-save">ذخیره</button></div></div>
      <div class="section-title"><h2>پیامک</h2></div>
      <div class="card"><div class="item-title">حالت ارسال: ${smsMode === "live" ? `<span class="badge ok">واقعی</span>` : `<span class="badge warn">آزمایشی</span>`}</div>
        <div class="small muted">${smsMode === "live" ? "پیامک‌ها به شماره‌ی انتخاب‌شده (مدیر ساختمان) فرستاده می‌شوند." : "همه‌ی پیامک‌ها فقط به شماره‌ی آزمایشی زیر فرستاده می‌شوند تا قبل از شروع کار، هیچ مشترکی پیامکی نگیرد."}</div>
        <label>شماره قالب (پترن) SMS.ir</label><div class="row"><input type="text" data-field="sms-tpl" class="ltr" inputmode="numeric" value="${esc(tplId)}" placeholder="خالی = ارسال متنی معمولی" style="flex:1"><button class="btn secondary small" data-act="sms-tpl-save">ذخیره</button></div>
        <div class="hint">با قالب، پیامک به شماره‌های «لیست سیاه» هم می‌رسد و شب‌ها در صف نمی‌ماند.</div>
        <label>شماره‌ی آزمایشی پیامک</label><div class="row"><input type="text" data-field="sms-test" class="ltr" inputmode="tel" value="${esc(testMobile)}" placeholder="خالی = تلفن شرکت" style="flex:1"><button class="btn secondary small" data-act="sms-test-save">ذخیره</button></div>
        <div class="actions"><button class="btn secondary small" data-act="sms-ping">ارسال پیامک آزمایشی</button><button class="btn ${smsMode === "live" ? "secondary" : "danger"} small" data-act="sms-mode" data-k="${smsMode === "live" ? "test" : "live"}">${smsMode === "live" ? "برگشت به حالت آزمایشی" : "فعال‌سازی ارسال واقعی"}</button></div></div>`);
  }

  /* ------------------------------------------------------------------ router */
  async function ensureProfile() {
    if (state.profile) return state.profile;
    const rows = await api(`user_profiles?id=eq.${session.user_id}&select=id,full_name,username,role,is_active`);
    state.profile = rows[0] || null;
    return state.profile;
  }

  async function route() {
    const pm = location.hash.match(/^#\/p\/([0-9a-fA-F-]{36})$/);
    if (pm) return viewPublicDoc(pm[1]);
    const pc = location.hash.match(/^#\/c\/([a-zA-Z0-9]{6,16})$/);
    if (pc) return viewPublicDoc(null, pc[1]);
    // short SMS link form that works on any static host: https://app.payaco.org/?c=<code>
    const qc = new URLSearchParams(location.search).get("c");
    if (qc && /^[a-zA-Z0-9]{6,16}$/.test(qc) && !location.hash) { history.replaceState(null, "", location.pathname + "#/c/" + qc); return viewPublicDoc(null, qc); }
    if (!session) return viewLogin();
    let p;
    try { p = await ensureProfile(); } catch (e) { if (e instanceof AuthError) return viewLogin(); return viewError(e); }
    if (!p || !p.is_active) {
      $app.innerHTML = `<div class="login-wrap"><div class="login-card"><h1>حساب غیرفعال</h1><p class="muted">حساب شما هنوز فعال نشده یا نقشی ندارد. با مدیر سیستم تماس بگیرید.</p>
        <button class="btn block secondary" id="lo">خروج</button></div></div>`;
      document.getElementById("lo").onclick = logout; return;
    }
    const hash = location.hash.replace(/^#\/?/, "");
    const [page, arg] = hash.split("/");
    const def = role() === "TECHNICIAN" ? "faults" : "dashboard";
    if (!$app.querySelector("#view")) $app.innerHTML = `<div class="loading">در حال بارگذاری…</div>`;
    try {
      let html;
      switch (page || def) {
        case "faults": html = await viewFaults(); break;
        case "services": html = role() === "TECHNICIAN" ? await viewTechServices() : await viewServices(); break;
        case "plan": html = isStaff() ? await viewPlan() : await viewDashboard(); break;
        case "locations": html = ["CEO", "REPAIR_MANAGER"].includes(role()) ? await viewLocations() : await viewDashboard(); break;
        case "team": html = ["CEO", "REPAIR_MANAGER"].includes(role()) ? await viewTeam() : await viewDashboard(); break;
        case "contracts": html = role() === "TECHNICIAN" ? await viewFaults() : await viewContracts(); break;
        case "contract": html = await viewContract(Number(arg)); break;
        case "doc": html = await viewDoc(Number(arg)); break;
        case "claims": html = can.recordPayment() ? await viewClaims() : await viewDashboard(); break;
        case "company": html = role() === "CEO" ? await viewCompany() : await viewDashboard(); break;
        case "more": html = await viewMore(); break;
        case "opening": html = role() === "CEO" ? await viewOpening() : await viewDashboard(); break;
        case "requests": html = isStaff() ? await viewRequests() : await viewDashboard(); break;
        case "close": html = isStaff() ? await viewMonthClose() : await viewDashboard(); break;
        case "reports": html = role() === "CEO" ? await viewReports() : await viewDashboard(); break;
        case "dashboard": html = role() === "TECHNICIAN" ? await viewFaults() : await viewDashboard(); break;
        default: html = role() === "TECHNICIAN" ? await viewFaults() : await viewDashboard();
      }
      $app.innerHTML = html;
      const s = document.getElementById("csearch");
      if (s) s.addEventListener("input", () => {
        contractSearch = s.value; const q = toEn(s.value).trim();
        document.querySelectorAll("[data-search]").forEach((card) => { card.style.display = !q || card.dataset.search.includes(q) ? "" : "none"; });
      });
    } catch (e) {
      if (e instanceof AuthError) return viewLogin("لطفاً دوباره وارد شوید");
      viewError(e);
    }
  }
  function viewError(e) {
    $app.innerHTML = `<div class="login-wrap"><div class="login-card"><h1>خطا</h1><p class="muted">${esc(e.message)}</p>
      <button class="btn block" id="retry">تلاش دوباره</button></div></div>`;
    document.getElementById("retry").onclick = route;
  }
  async function logout() {
    try { if (session) await authCall("logout", {}, session.access_token); } catch (e) { /* ignore */ }
    clearSession(); location.hash = "#/"; viewLogin();
  }

  // global click delegation
  $app.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]"); if (!el) return;
    const act = el.dataset.act, id = Number(el.dataset.id);
    if (act === "new-fault") sheetNewFault().catch((er) => toast(er.message));
    if (act === "open-fault") sheetFault(id).catch((er) => toast(er.message));
    if (act === "fault-filter") { faultFilter = el.dataset.k; route(); }
    if (act === "service-filter") { serviceFilter = el.dataset.k; route(); }
    if (act === "new-service") sheetNewService(false).catch((er) => toast(er.message));
    if (act === "new-missed") sheetNewService(true).catch((er) => toast(er.message));
    if (act === "approve") sheetApprove(id, true);
    if (act === "reject") sheetApprove(id, false);
    if (act === "open-contract") location.hash = `#/contract/${id}`;
    if (act === "pay") sheetPayment(id).catch((er) => toast(er.message));
    if (act === "cancel-invoice") {
      if (confirm(`سند ${el.dataset.no} ابطال شود؟ مبلغ آن با یک ردیف برگشتی از حساب کسر می‌شود و قابل بازگشت نیست.`)) {
        api(`invoices?id=eq.${id}`, { method: "PATCH", body: { status: "cancelled" } }).then(() => { toast("سند ابطال شد"); route(); }).catch((er) => toast(er.message));
      }
    }
    if (act === "edit-user") sheetEditUser(el.dataset.id).catch((er) => toast(er.message));
    if (act === "go-opening") location.hash = "#/opening";
    if (act === "opening") sheetOpening(id).catch((er) => toast(er.message));
    if (act === "renew") sheetRenew(id).catch((er) => toast(er.message));
    if (act === "edit-contract") sheetEditContract(id).catch((er) => toast(er.message));
    if (act === "amend") sheetAmendment(id).catch((er) => toast(er.message));
    if (act === "go-requests") location.hash = "#/requests";
    if (act === "go-close") location.hash = "#/close";
    if (act === "go-team") location.hash = "#/team";
    if (act === "new-tech") sheetTech(null).catch((er) => toast(er.message));
    if (act === "edit-tech") sheetTech(id).catch((er) => toast(er.message));
    if (act === "tech-account") loadTechs().then((l) => { const t = l.find((x) => x.id === id); return sheetNewUser({ role: "TECHNICIAN", name: t.name, mobile: t.mobile, technician_id: t.id }); }).catch((er) => toast(er.message));
    if (act === "tech-new-service") sheetTechService(el.dataset.cid).catch((er) => toast(er.message));
    if (act === "send-location") { el.disabled = true; sendLocation(el.dataset.bid).catch((er) => toast(er.message)).finally(() => { el.disabled = false; }); }
    if (act === "go-plan") location.hash = "#/plan";
    if (act === "go-locations") location.hash = "#/locations";
    if (act === "new-assignment") sheetNewAssignment().catch((er) => toast(er.message));
    if (act === "plan-go") { planDate = readDate(document, "pday"); route(); }
    if (act === "plan-day") { planDate = addDays(readDate(document, "pday"), Number(el.dataset.d)); route(); }
    if (act === "cancel-assignment" && confirm("این ارجاع لغو شود؟")) api(`service_assignments?id=eq.${el.dataset.id}`, { method: "PATCH", body: { status: "cancelled", updated_at: new Date().toISOString() } }).then(() => { toast("ارجاع لغو شد"); route(); }).catch((er) => toast(er.message));
    if (act === "loc-decide") { const okd = el.dataset.ok === "1"; if (confirm(okd ? "این موقعیت تأیید شود؟" : "این موقعیت رد شود؟")) rpc("decide_building_location", { p_building_id: Number(el.dataset.id), p_approve: okd }).then(() => { toast(okd ? "موقعیت تأیید شد" : "موقعیت رد شد"); route(); }).catch((er) => toast(er.message)); }
    if (act === "go-reports") location.hash = "#/reports";
    if (act === "report-tab") { reportTab = el.dataset.k; route(); }
    if (act === "report-apply") {
      const v = document.getElementById("view");
      if (v.querySelector('[data-date="rfrom"]')) reportRange.from = readDate(v, "rfrom");
      reportRange.to = readDate(v, "rto");
      if (reportRange.from > reportRange.to) return toast("بازه‌ی تاریخ نامعتبر است");
      route();
    }
    if (act === "report-csv") reportCsv();
    if (act === "contract-report") sheetContractReport(id).catch((er) => toast(er.message));
    if (act === "attach") sheetAttach(id).catch((er) => toast(er.message));
    if (act === "open-file") openFile(el.dataset.path);
    if (act === "open-receipt") openFile(el.dataset.path, "payment-receipts");
    if (act === "pick-month") { closeYM = Number(el.dataset.k); route(); }
    if (act === "prepare-month") {
      rpc("prepare_month_close", { p_jy: Number(el.dataset.y), p_jm: Number(el.dataset.m) }).then(() => { toast("برای تأیید مدیرعامل آماده شد"); route(); }).catch((er) => toast(er.message));
    }
    if (act === "close-month") {
      const label = `${MONTHS[Number(el.dataset.m) - 1]} ${fa(el.dataset.y)}`;
      if (confirm(`ماه ${label} بسته شود؟ سرویس‌های انجام‌نشده ثبت و صورتحساب‌ها صادر می‌شوند و این کار برگشت‌پذیر نیست.`)) {
        el.disabled = true;
        rpc("close_month", { p_jy: Number(el.dataset.y), p_jm: Number(el.dataset.m) })
          .then((r) => { toast(`ماه بسته شد: ${fa(r.missed_added)} انجام‌نشده، ${fa(r.statements_issued)} صورتحساب`); route(); })
          .catch((er) => { el.disabled = false; toast(er.message); });
      }
    }
    if (act === "approve-change") {
      if (confirm("این تغییر تأیید و روی قرارداد اعمال شود؟")) rpc("decide_contract_change", { p_id: id, p_approve: true }).then(() => { state.contracts = null; toast("اعمال شد"); route(); }).catch((er) => toast(er.message));
    }
    if (act === "reject-change") {
      const note = prompt("دلیل رد:");
      if (note !== null) rpc("decide_contract_change", { p_id: id, p_approve: false, p_note: note.trim() || null }).then(() => { toast("رد شد"); route(); }).catch((er) => toast(er.message));
    }
    if (act === "post-opening") {
      if (confirm("این مانده تأیید و در حساب مشترک ثبت شود؟ بعد از تأیید قابل ویرایش نیست.")) {
        rpc("post_opening_balance", { p_invoice_id: id }).then(() => { toast("مانده افتتاحیه ثبت شد"); route(); }).catch((er) => toast(translateError({ message: er.message })));
      }
    }
    if (act === "post-all-opening") {
      if (confirm(`همه‌ی ${el.dataset.n} پیش‌نویس تأیید و در حساب‌ها ثبت شوند؟ بعد از تأیید قابل ویرایش نیستند.`)) {
        rpc("post_all_opening_balances").then((n) => { toast(`${fa(n)} سند افتتاحیه ثبت شد`); route(); }).catch((er) => toast(er.message));
      }
    }
    if (act === "go-claims") location.hash = "#/claims";
    if (act === "go-company") location.hash = "#/company";
    if (act === "doc-print") window.print();
    if (act === "doc-back") { e.preventDefault(); if (history.length > 1) history.back(); else location.hash = "#/contracts"; }
    if (act === "doc-share") shareDocLink(el.dataset.token, el.dataset.no);
    if (act === "copy") copyText(toEn(el.dataset.val));
    if (act === "pub-claim") sheetPublicClaim();
    if (act === "doc-sms") sheetSms(id).catch((er) => toast(er.message));
    if (act === "sms-tpl-save") guarded(el, async () => { await rpc("set_sms_template", { p_id: toEn(document.querySelector("[data-field=sms-tpl]").value.trim()) }); toast("ذخیره شد"); });
    if (act === "sms-test-save") guarded(el, async () => { await rpc("set_sms_test_mobile", { p_mobile: toEn(document.querySelector("[data-field=sms-test]").value.trim()) }); toast("ذخیره شد"); });
    if (act === "sms-ping") guarded(el, async () => { const r = await callFunction("send-sms", { kind: "ping" }); toast(`پیامک آزمایشی به ${fa(r.to)} فرستاده شد`); });
    if (act === "sms-mode") {
      const live = el.dataset.k === "live";
      if (confirm(live ? "ارسال واقعی فعال شود؟ از این به بعد پیامک‌ها به مشترک‌ها می‌رسد." : "به حالت آزمایشی برگردد؟")) rpc("set_sms_mode", { p_mode: el.dataset.k }).then(() => { toast("ذخیره شد"); route(); }).catch((er) => toast(er.message));
    }
    if (act === "claim-approve") sheetClaimApprove(id);
    if (act === "claim-reject") {
      const note = prompt("دلیل رد (مثلاً واریزی با این مشخصات در حساب نیست):");
      if (note !== null) rpc("decide_payment_claim", { p_id: id, p_approve: false, p_note: note.trim() || null }).then(() => { toast("رد شد"); route(); }).catch((er) => toast(er.message));
    }
    if (act === "company-save") {
      const f = document.getElementById("company-form"), body = {};
      f.querySelectorAll("[data-field]").forEach((i) => { body[i.dataset.field] = i.classList.contains("ltr") ? toEn(i.value.trim()) : i.value.trim(); });
      guarded(el, async () => { await rpc("set_company_settings", { p: body }); toast("ذخیره شد"); });
    }
    if (act === "new-user") sheetNewUser().catch((er) => toast(er.message));
    if (act === "logout") logout();
    if (act === "change-pw") sheetChangePassword();
    if (act === "set-hold") {
      const reason = prompt("دلیل تعلیق صورتحساب (مثلاً مغایرت مبلغ در قرارداد):");
      if (reason && reason.trim()) rpc("set_billing_hold", { p_contract_id: id, p_reason: reason.trim() }).then(() => { toast("صورتحساب معلق شد"); route(); }).catch((er) => toast(er.message));
    }
    if (act === "release-hold") {
      if (confirm("تعلیق برداشته شود؟ برای سرویس‌های ثبت‌شده از شروع صورتحساب (آبان ۱۴۰۵) که صورتحساب ندارند، همین حالا صورتحساب صادر می‌شود.")) {
        el.disabled = true;
        rpc("release_billing_hold", { p_contract_id: id }).then((n) => { state.contracts = null; toast(`تعلیق برداشته شد؛ ${fa(n)} صورتحساب صادر شد`); route(); }).catch((er) => { el.disabled = false; toast(er.message); });
      }
    }
  });

  window.addEventListener("hashchange", () => { document.querySelectorAll(".sheet-backdrop").forEach((b) => b.remove()); route(); });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  route();

  // exposed for automated tests only
  window.__payaco = { g2j, j2g, jMonthLen };
})();
