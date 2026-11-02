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
    // the list always reaches this year and next year too, whatever the preset date (e.g. renewing a contract that ended years ago)
    const t = toEn(todayTehran()).split("-").map(Number), ty = g2j(t[0], t[1], t[2]).jy;
    const years = []; for (let yy = Math.min(j.jy, ty) - 2; yy <= Math.max(j.jy, ty) + 1; yy++) years.push(yy);
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
  const DOC_TYPE = { statement: "صورتحساب سرویس", repair_invoice: "فاکتور تعمیر", insurance_invoice: "فاکتور بیمه", proforma: "پیش‌فاکتور", final_invoice: "فاکتور نهایی",
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
  let listCache = null; // contracts list, kept for 2 minutes and dropped on any write
  async function api(path, { method = "GET", body, prefer } = {}) {
    if (method !== "GET" && !/^rpc\/(get_|my_|service_targets|pending_|technician_ratings|report_|month_close_preview)/.test(path)) listCache = null;
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
  // D-98: every contract picker has a search box (code or building name); iOS ignores hidden <option>, so the list is rebuilt
  const CSEL_Q = `<input type="search" class="csel-q" placeholder="جست‌وجو با کد یا نام ساختمان" enterkeyhint="search" autocomplete="off">`;
  function contractSelectHtml(contracts, name = "contract") {
    return `${CSEL_Q}<select data-field="${name}" class="csel">${contracts.map((c) => `<option value="${c.id}">${esc(fa(c.contract_code))} — ${esc(c.building_name || "")}</option>`).join("")}</select>`;
  }
  const normQ = (x) => toEn(String(x || "")).replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/\u200c/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const cselAll = new WeakMap();
  document.addEventListener("input", (e) => {
    const box = e.target.closest && e.target.closest(".csel-q"); if (!box) return;
    let sel = box.nextElementSibling; while (sel && sel.tagName !== "SELECT") sel = sel.nextElementSibling;
    if (!sel) return;
    if (!cselAll.has(sel)) cselAll.set(sel, Array.from(sel.options).map((o) => ({ v: o.value, t: o.textContent, s: normQ(o.textContent) })));
    const all = cselAll.get(sel), q = normQ(box.value), before = sel.value;
    const hits = q ? all.filter((o) => q.split(" ").every((w) => o.s.includes(w))) : all;
    sel.innerHTML = hits.map((o) => `<option value="${esc(o.v)}">${esc(o.t)}</option>`).join("") || `<option value="" disabled selected>چیزی پیدا نشد</option>`;
    if (hits.some((o) => o.v === before)) sel.value = before;
    if (sel.value !== before) sel.dispatchEvent(new Event("change", { bubbles: true }));
  });

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
    up: '<path d="M12 4l7 9H5z"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.6L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.5 4.6L20 16"/><path d="M20 21v-5h-5"/>'
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ""}</svg>`;
  function tabsFor() {
    if (role() === "TECHNICIAN") return [["faults", "wrench", "کارهای من"], ["services", "check", "سرویس‌ها"], ["more", "more", "بیشتر"]];
    if (isExternal()) return [["dashboard", "home", "خانه"], ["services", "check", "سرویس‌ها"], ["faults", "alert", "خرابی‌ها"], ["contracts", "doc", "صورتحساب"], ["more", "more", "بیشتر"]];
    return [["dashboard", "home", "داشبورد"], ["faults", "alert", "خرابی‌ها"], ["services", "check", "سرویس‌ها"], ["contracts", "doc", "قراردادها"], ["more", "more", "بیشتر"]];
  }
  // D-101: one primary action on the contract page; the rest grouped in a sheet (finance / contract / documents, termination apart)
  function contractActionsHtml(actions) {
    const act = (h) => (h.match(/data-act="([^"]+)"/) || [])[1] || "";
    const primary = actions.find((h) => act(h) === "pay") || actions.find((h) => act(h) === "approve-contract");
    const rest = actions.filter((h) => h !== primary);
    if (rest.length <= 2) return `<div class="actions">${actions.join("")}</div>`;
    const G = [["مالی", ["opening", "contract-report", "period-statement", "set-hold", "vat-exempt"]], ["اسناد", ["new-proforma", "new-invoice", "print-contract"]],
      ["قرارداد", ["edit-contract", "amend", "renew"]], ["", ["terminate"]]];
    const used = new Set();
    const groups = G.map(([t, keys]) => { const hs = rest.filter((h) => keys.includes(act(h))); hs.forEach((h) => used.add(h)); return [t, hs]; });
    const other = rest.filter((h) => !used.has(h));
    if (other.length) groups.splice(3, 0, ["سایر", other]);
    // the real buttons stay in the page (hidden) so the page's own click handler runs them; the sheet shows copies that point at them
    let k = 0; const src = [];
    const sheetHtml = groups.filter(([, hs]) => hs.length).map(([t, hs]) => `${t ? `<div class="menu-group">${t}</div>` : `<div class="menu-sep"></div>`}<div class="menu-acts">${hs.map((h) => {
      const i = k++; src.push(h.replace(/^<button /, `<button data-mi="${i}" `));
      return h.replace(/^<button /, `<button data-menu="${i}" `).replace(/ data-act="[^"]+"/, "").replace(/ btn small/, " btn"); }).join("")}</div>`).join("");
    return `<div class="actions">${primary || ""}<button class="btn secondary" data-act="contract-menu">کارهای دیگر…</button></div><div class="menu-src" hidden>${src.join("")}</div><template id="contract-menu">${sheetHtml}</template>`;
  }

  // D-101: the letterhead's line-work (circuit lines with the little standing figures, the two call keys) as an app motif
  const BRAND_LINES = `<svg class="brand-lines" viewBox="0 30 118 18" preserveAspectRatio="xMaxYMax meet" width="354" height="54" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width=".42" stroke-linejoin="round" stroke-linecap="round">
    <path d="M2 38.3 H29 L31.6 36.3 H50 L53.6 39.9 H66 M83.6 39.9 H90 L92 37.9 H104 L112.4 46.4"/><path d="M2 39.6 H29.6 L32.2 37.6 H49.4 L53 41.2 H66 M83.6 41.2 H90.6 L92.6 39.2 H103.4 L110.6 46.4"/>
    <path d="M24 38.3 v-2.2 M25 38.3 v-2.2 M35 36.3 v-2.2 M36 36.3 v-2.2 M40 36.3 v-3.2 M45.5 36.3 v-2.2 M46.5 36.3 v-2.2 M57 39.9 v-2.4 M58 39.9 v-2.4 M62 39.9 v-2.4 M94 37.9 v-2 M95 37.9 v-2 M99.5 37.9 v-2.2 M100.5 37.9 v-2.2 M104.6 38.4 v-2"/>
    <rect x="66.6" y="32.4" width="7.6" height="7.6" rx="1.3"/><rect x="75.6" y="32.4" width="7.6" height="7.6" rx="1.3"/>
    <path d="M68.2 38.4 H69.6 L72.4 34.6 H73"/><rect x="77.2" y="33.6" width="2.6" height="5.2" rx=".3"/><path d="M81.4 34 v4.4 M80.8 34.8 l.6-.8 .6 .8 M80.8 37.6 l.6 .8 .6-.8"/></g></svg>`;
  // the full yellow corner of the letterhead (shape + line-work + LIFT), for the login screen and the subscriber's document page
  function shell(title, current, body) {
    const p = state.profile;
    return `<header class="topbar"><div class="brand"><img src="icons/mark.png" alt="پایاکو" class="logo"><div><h1>${esc(title)}</h1>
      <div class="who">${esc(p.full_name || displayLogin())} · ${esc(ROLE[p.role] || p.role)}</div></div></div>
      <button class="refresh-btn" data-act="refresh" aria-label="به‌روزرسانی">${icon("refresh")}</button></header>
      <main id="view">${body}${current === "more" && !/data-act="logout"/.test(body) || current !== "more" ? `<footer class="page-credit">${NIMA_CREDIT}</footer>` : ""}</main>
      <nav class="tabbar"><div class="side-brand"><img src="icons/logo.png" alt="پایاکو - آسانسور و پله‌برقی"></div>
        ${tabsFor().map(([k, ico, label]) => `<a href="#/${k}" class="${current === k ? "on" : ""}"><span class="ico">${icon(ico)}${state.badges && state.badges[k] ? `<b class="tab-badge">${fa(state.badges[k])}</b>` : ""}</span>${label}</a>`).join("")}
        <div class="side-foot">${esc(p.full_name || "")}<br><span>${esc(ROLE[p.role] || p.role)}</span></div></nav>`;
  }

  /* ------------------------------------------------------------------ views */
  // designer credit shown on the login screen and the settings page
  const NIMA_CREDIT = `<${CFG.nimaUrl ? `a href="${CFG.nimaUrl}" target="_blank" rel="noopener"` : "div"} class="nima-credit"><picture><source srcset="icons/nima-mark-dark.png" media="(prefers-color-scheme: dark)"><img src="icons/nima-mark.png" alt="" width="21" height="16"></picture><span>طراحی و توسعه: <bdi class="nima-name">NiMa</bdi></span></${CFG.nimaUrl ? "a" : "div"}>`;
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

  // D-104: the CEO's dashboard has two areas — sales & installation, after-sales service — so their workflows don't mix
  let dashArea = "service";
  try { dashArea = localStorage.getItem("dash-area") || "service"; } catch (e) { /* per-device convenience */ }
  const areaSwitch = () => role() === "CEO" ? `<div class="area-switch" role="tablist">
      <button type="button" role="tab" data-act="dash-area" data-k="sales" class="${dashArea === "sales" ? "on" : ""}" aria-selected="${dashArea === "sales"}"><b>فروش و نصب</b><span>برآورد، پیشنهاد قیمت، پروژه‌های نصب</span></button>
      <button type="button" role="tab" data-act="dash-area" data-k="service" class="${dashArea === "service" ? "on" : ""}" aria-selected="${dashArea === "service"}"><b>خدمات پس از فروش</b><span>سرویس، خرابی، قراردادها و صورتحساب‌ها</span></button></div>` : "";
  // D-107: pending cheques of installation projects that are due (or due within a week); a due cheque is not "bounced" by itself
  async function dueCheques(days) {
    const lim = (() => { const d = new Date(toEn(todayTehran()) + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); })();
    return api(`install_receipts?active=eq.true&method=eq.cheque&status=eq.pending&cheque_due=lte.${lim}&select=id,project_id,amount_rial,cheque_no,cheque_due,bank,install_projects(title,install_code)&order=cheque_due`).catch(() => []);
  }
  const chequeRow = (r) => { const od = r.cheque_due <= toEn(todayTehran()), p = r.install_projects || {};
    return `<div class="card tap" data-act="go" data-href="#/install/${r.project_id}"${od ? ' style="border-color:var(--warn)"' : ""}><div class="item-head"><div><div class="item-title">${money(r.amount_rial)} · چک <bdi dir="ltr">${esc(fa(r.cheque_no || ""))}</bdi></div>
      <div class="small muted">${p.install_code ? `کد ${fa(p.install_code)} · ` : ""}${esc(p.title || "")} · سررسید ${jdate(r.cheque_due)}${r.bank ? ` · ${esc(r.bank)}` : ""}</div></div>
      <div style="text-align:left"><span class="badge ${od ? "warn" : "info"}">${od ? "سررسید شده" : "سررسید نزدیک"}</span><button class="btn small" data-act="ip-rc-clear" data-rid="${r.id}">پاس شد</button></div></div></div>`; };
  async function viewSalesDashboard() {
    const [ps, qs, chq] = await Promise.all([api("install_projects?select=id,title,client_name,city,stage,updated_at&order=updated_at.desc"),
      api("install_quotes?select=id,project_id,status,valid_until,document_number,options&order=id.desc"), dueCheques(7)]);
    const now = new Date(), by = (k) => ps.filter((p) => p.stage === k).length;
    const open = new Set(ps.filter((p) => ["estimate", "quoted"].includes(p.stage)).map((p) => p.id));
    const drafts = qs.filter((q) => q.status === "draft" && open.has(q.project_id)), valid = qs.filter((q) => q.status === "issued" && open.has(q.project_id) && new Date(q.valid_until) > now);
    const st = (label, v, cls, href) => `<div class="stat ${cls} tap" data-act="go" data-href="${href}"><div class="label">${label}</div><div class="value">${num(v)}</div></div>`;
    const draftSet = new Set(drafts.map((q) => q.project_id));
    const card = (p) => { const s2 = IP_STAGE[p.stage] || [p.stage, ""];
      return `<div class="card tap" data-act="go" data-href="#/install/${p.id}"><div class="item-head"><div><div class="item-title">${esc(p.title)}</div><div class="small muted">${esc(p.client_name)} · ${esc(p.city || "")} · ${jdate(p.updated_at)}</div></div>
        <div style="text-align:left"><span class="badge ${s2[1]}">${s2[0]}</span>${draftSet.has(p.id) ? `<span class="badge warn">پیش‌نویس باز</span>` : ""}</div></div></div>`; };
    return shell("داشبورد", "dashboard", `${areaSwitch()}
      <div class="page-actions"><button class="btn" data-act="ip-new">+ پروژه‌ی نصب جدید</button><button class="btn secondary" data-act="go" data-href="#/install">همه‌ی پروژه‌ها</button><button class="btn secondary" data-act="go" data-href="#/install-matrix">پیشرفت فیزیکی پروژه‌ها</button><button class="btn secondary" data-act="ip-defaults">متن‌های پیش‌فرض پیشنهاد</button></div>
      <div class="stats">${st("در مرحله‌ی برآورد", by("estimate"), by("estimate") ? "warn" : "calm", "#/install")}${st("پیشنهاد داده شده", by("quoted"), "tone-info", "#/install")}
        ${st("قرارداد بسته شد", by("won"), "tone-brand", "#/install")}${st("پیشنهاد معتبر (منتظر پاسخ)", valid.length, valid.length ? "tone-brand" : "calm", "#/install")}</div>
      ${drafts.length ? `<div class="hint">${fa(drafts.length)} پیش‌نویس پیشنهاد هنوز صادر نشده است.</div>` : ""}
      ${chq.length ? `<div class="section-title"><h2>چک‌های سررسید (وصول ثبت نشده)</h2></div>${chq.map(chequeRow).join("")}` : ""}
      <div class="section-title"><h2>آخرین پروژه‌ها</h2><a href="#/install" class="small">همه</a></div>
      ${ps.length ? ps.slice(0, 8).map(card).join("") : `<div class="card empty">هنوز پروژه‌ی نصبی ثبت نشده</div>`}
      <div class="hint">قرارداد نصب قدم بعدی این بخش است و به همین پرونده‌ها وصل می‌شود.</div>`);
  }
  async function viewDashboard() {
    if (role() === "CEO" && dashArea === "sales") return viewSalesDashboard();
    const [d, chqDue] = await Promise.all([rpc("get_dashboard"), role() === "CEO" ? dueCheques(0) : []]);
    const urgent = await api("faults?select=id,fault_number,fault_description,priority,status,reported_at,subscription_code,needs_text,buildings(name)&status=in.(reported,assigned,in_progress)&order=priority.asc,reported_at.desc&limit=5");
    const stats = [];
    // every tile opens the page behind its number (D-66)
    const go = (href, ff, sf) => ` tap" data-act="go" data-href="${href}"${ff ? ` data-ff="${ff}"` : ""}${sf ? ` data-sf="${sf}"` : ""}`;
    const st = (ico, label, v, cls = "", to = "") => `<div class="stat ${cls}${to || '"'}><span class="stat-ico">${icon(ico)}</span><div class="label">${label}</div><div class="value">${num(v)}</div></div>`;
    const debtsHref = can.recordPayment() ? "#/debts" : "#/contracts";
    stats.push(st("siren", "خرابی اضطراری باز", d.emergency_faults, d.emergency_faults ? "danger" : "calm", go("#/faults", "emergency")));
    stats.push(st("alert", "خرابی‌های باز", d.open_faults, "tone-info", go("#/faults", "open")));
    stats.push(st("clock", "سرویس منتظر تأیید", d.pending_services, d.pending_services ? "warn" : "calm", go("#/services", "", "pending")));
    stats.push(st("receipt", "اسناد پرداخت‌نشده", d.open_invoices, "tone-brand", go(can.recordPayment() ? "#/debts?docs" : "#/contracts")));
    if (isStaff()) {
      stats.push(st("building", "قرارداد فعال", d.active_contracts, "tone-brand", go("#/contracts")));
      stats.push(st("calendar", "پایان قرارداد تا ۳۰ روز", d.expiring_contracts, d.expiring_contracts ? "warn" : "calm", go(can.changeContract() ? "#/renewals" : "#/contracts")));
    }
    if (d.receivable_rial !== null && d.receivable_rial !== undefined) {
      stats.push(`<div class="stat wide money-stat${go(debtsHref)}><span class="stat-ico">${icon("wallet")}</span><div class="label">${isExternal() ? "مانده حساب شما" : "مانده کل مطالبات"}</div><div class="value">${money(d.receivable_rial)}</div></div>`);
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
    if (role() === "CEO") {
      try { // D-79: nightly backup on the company server reports here
        const [b] = await api("app_settings?key=eq.backup.last&select=value");
        const v = b ? JSON.parse(b.value) : null, age = v ? (Date.now() - new Date(v.at).getTime()) / 3600000 : Infinity;
        if (!v || age > 36 || !String(v.note).startsWith("ok")) closeNote += `<div class="card" style="border-color:var(--danger)"><div class="item-title">بک‌آپ شبانه ${v ? (String(v.note).startsWith("ok") ? `${fa(Math.floor(age / 24))} روز است انجام نشده` : "ناموفق بود") : "هنوز راه‌اندازی نشده"}</div>
          <div class="small muted">${v ? `آخرین گزارش: ${jtime(v.at)} · ${esc(v.note)}` : "نسخه‌ی پشتیبان روی سرور پایاکو هنوز گرفته نشده است."}</div></div>`;
      } catch (e) { /* reminder only */ }
    }
    if (can.changeContract()) {
      try {
        const r = renewalBuckets(await contractsList());
        const n = r.overdue.length + r.thisMonth.length + r.nextMonth.length;
        if (n) closeNote += `<div class="card tap" data-act="go" data-href="#/renewals" style="border-color:var(--warn)"><div class="item-title">یادآوری تمدید قرارداد — ${MONTHS[r.jm - 1]} ${fa(r.jy)}</div>
          <div class="small muted">${[r.overdue.length ? `${fa(r.overdue.length)} تمام‌شده و تمدیدنشده` : "", r.thisMonth.length ? `${fa(r.thisMonth.length)} پایان در همین ماه` : "", r.nextMonth.length ? `${fa(r.nextMonth.length)} پایان در ${MONTHS[r.nextJm - 1]}` : ""].filter(Boolean).join(" · ")}</div></div>`;
      } catch (e) { /* reminder only */ }
    }
    if (can.changeContract()) {
      try { // D-91: issued contract documents whose paper signature cycle is not finished
        const sg = await api("contracts?doc_number=not.is.null&sign_returned_at=is.null&status=in.(active,draft)&select=id,contract_code,sign_ceo_at,sign_sent_at,buildings(name)&order=doc_issued_at.asc&limit=50");
        if (sg.length) {
          const stage = (x) => !x.sign_ceo_at ? "منتظر امضای مدیرعامل" : !x.sign_sent_at ? "منتظر ارسال برای مشترک" : `منتظر عودت (${fa(Math.max(0, Math.round((new Date(todayTehran()) - new Date(x.sign_sent_at)) / 86400000)))} روز)`;
          closeNote += `<div class="card" style="border-color:var(--warn)"><div class="item-title">قرارداد در چرخه‌ی امضا (${fa(sg.length)})</div>
            ${sg.slice(0, 6).map((x) => `<div class="small tap" data-act="go" data-href="#/contract/${x.id}" style="padding:4px 0">${esc(x.buildings ? x.buildings.name : "")} · قرارداد ${esc(fa(x.contract_code))} · ${stage(x)}</div>`).join("")}
            ${sg.length > 6 ? `<div class="small muted">و ${fa(sg.length - 6)} مورد دیگر</div>` : ""}</div>`;
        }
      } catch (e) { /* reminder only */ }
    }
    if (isStaff()) {
      try { // D-90: insurance policies ending within 30 days or expired in the last 90 days
        const ir = await rpc("insurance_reminders");
        if (ir.length) closeNote += `<div class="card" style="border-color:var(--warn)"><div class="item-title">یادآوری تمدید بیمه‌نامه (${fa(ir.length)})</div>
          ${ir.slice(0, 6).map((x) => `<div class="small tap" data-act="go" data-href="#/contract/${x.contract_id}" style="padding:4px 0">${esc(x.building_name || "")} · اشتراک ${esc(fa(x.subscription_code))} · ${esc(x.insurer)} · ${x.days_left < 0 ? `<span class="debt">${fa(-x.days_left)} روز است تمام شده</span>` : x.days_left === 0 ? "امروز تمام می‌شود" : `${fa(x.days_left)} روز مانده`}</div>`).join("")}
          ${ir.length > 6 ? `<div class="small muted">و ${fa(ir.length - 6)} مورد دیگر</div>` : ""}</div>`;
      } catch (e) { /* reminder only */ }
    }
    const waiting = await pendingForMe().catch(() => "");
    const quick = [];
    if (can.reportFault()) quick.push(`<button class="btn" data-act="new-fault">+ ثبت خرابی</button>`);
    if (isStaff()) quick.push(`<button class="btn secondary" data-act="new-service">+ ثبت گزارش سرویس</button>`);
    if (can.changeContract()) quick.push(`<button class="btn secondary" data-act="new-contract">+ قرارداد جدید</button>`);
    if (canDocs()) quick.push(`<button class="btn secondary" data-act="new-proforma">+ پیش‌فاکتور</button>`, `<button class="btn secondary" data-act="new-invoice">+ فاکتور</button>`);
    if (isStaff()) quick.push(`<button class="btn secondary" data-act="go" data-href="#/docs">اسناد</button>`);
    const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Tehran" }).format(new Date()));
    const focus = d.emergency_faults ? [d.emergency_faults, "خرابی اضطراری"] : d.pending_services ? [d.pending_services, "سرویس منتظر تأیید"] : [d.open_faults || 0, "خرابی باز"];
    const greet = hour < 12 ? "صبح بخیر" : hour < 17 ? "روز بخیر" : "عصر بخیر";
    return shell("داشبورد", "dashboard", `${areaSwitch()}${chqDue.length ? `<div class="card tap" data-act="dash-area" data-k="sales" style="border-color:var(--warn)"><div class="small"><b>${fa(chqDue.length)} چک پروژه‌های نصب سررسید شده و وصولش ثبت نشده</b> — برای دیدن و ثبت «پاس شد» بزنید.</div></div>` : ""}
      <div class="hero">${BRAND_LINES}<div class="hero-txt"><div class="hero-t">سلام ${esc((state.profile.full_name || "").split(" ")[0])}، ${greet}</div><div class="hero-s">${(() => { const t = toEn(todayTehran()).split("-").map(Number), j = g2j(t[0], t[1], t[2]); return `${new Intl.DateTimeFormat("fa-IR", { weekday: "long", timeZone: "Asia/Tehran" }).format(new Date())} ${fa(j.jd)} ${MONTHS[j.jm - 1]} ${fa(j.jy)}`; })()}</div><div class="hero-slogan">با شما تا اوج...</div></div><div class="floor-ind tap" data-act="go" data-href="${d.emergency_faults ? "#/faults" : d.pending_services ? "#/services" : "#/faults"}" data-ff="${d.emergency_faults ? "emergency" : "open"}" data-sf="pending" aria-label="${esc(focus[1])}: ${num(focus[0])}"><div class="floor-screen"><span class="floor-arrow">${icon("up")}</span><span class="floor-num">${num(focus[0])}</span></div><div class="floor-lbl">${focus[1]}</div></div></div>
      <div class="dash${closeNote ? " has-side" : ""}"><div class="dash-main">
      ${isStaff() ? `<div class="row dash-search"><input type="search" id="dsearch" placeholder="جست‌وجوی قرارداد: کد یا نام ساختمان" style="flex:1" enterkeyhint="search"><button class="btn secondary small" data-act="dash-search">جست‌وجو</button></div>` : ""}
      <div class="actions dash-quick">${quick.join("")}</div>
      ${waiting}<div class="stats">${stats.join("")}</div></div>
      ${closeNote ? `<aside class="dash-side"><div class="section-title"><h2>یادآوری‌ها</h2></div><div class="reminders">${closeNote}</div></aside>` : ""}</div>
      <div class="section-title"><h2>خرابی‌های باز</h2><a href="#/faults" class="small">همه</a></div>
      ${urgent.length ? urgent.map(faultCard).join("") : `<div class="card empty">خرابی بازی وجود ندارد</div>`}`);
  }

  /* D-95/D-97: everything someone sent that waits for this user's approval or action; summary card on the dashboard, full list at #/pending */
  async function pendingGroups() {
    const r = role(), now = new Date().toISOString(), q = (p) => p.catch(() => []);
    const none = Promise.resolve([]);
    const bld = "contracts(contract_code,buildings(name))";
    const [svc, chg, drafts, opening, claims, locs, pfWait, pfInv, needs, sign] = await Promise.all([
      can.approveService() ? q(api(`service_reports?status=eq.pending_confirmation&select=id,report_number,service_date,service_year,service_month,status,report_text,notes,rejection_note,contract_id,${bld}&order=service_date.desc,id.desc&limit=100`)) : none,
      r === "CEO" ? q(api(`contract_change_requests?status=eq.pending&select=id,kind,requested_at,contract_id,contracts!contract_change_requests_contract_id_fkey(contract_code,buildings(name))&order=id.desc`)) : none,
      r === "CEO" ? q(api("contracts?status=eq.draft&select=id,contract_code,created_at,buildings(name)&order=id.desc")) : none,
      r === "CEO" ? q(api(`invoices?status=eq.draft&document_type=eq.opening_balance&select=id,total_rial,contract_id,${bld}&order=id`)) : none,
      can.recordPayment() ? q(api("payment_claims?status=eq.pending&select=id")) : none,
      ["CEO", "REPAIR_MANAGER"].includes(r) ? q(rpc("pending_building_locations")) : none,
      r === "CEO" ? q(api(`proformas?status=eq.issued&valid_until=gt.${encodeURIComponent(now)}&select=id,document_number,total_rial,issued_at,subject,${bld}&order=id.desc`)) : none,
      canDocs() ? q(api(`proformas?status=eq.approved&invoice_id=is.null&select=id,document_number,total_rial,decided_at,subject,${bld}&order=id.desc`)) : none,
      canDocs() ? q(api("faults?needs_text=not.is.null&status=in.(reported,assigned,in_progress)&select=id,fault_number,needs_text,needs_at,buildings(name),proformas(id,status)&order=needs_at.desc")) : none,
      r === "CEO" ? q(api("contracts?doc_number=not.is.null&sign_ceo_at=is.null&status=in.(active,draft)&select=id,contract_code,doc_number,buildings(name)&order=doc_issued_at")) : none]);
    const bn = (x) => esc((x.contracts && x.contracts.buildings && x.contracts.buildings.name) || (x.buildings && x.buildings.name) || "");
    const cc = (x) => esc(fa((x.contracts && x.contracts.contract_code) || x.contract_code || ""));
    const item = (href, title, sub, right = "") => `<div class="card tap" data-act="go" data-href="${href}"><div class="item-head"><div><div class="item-title">${title}</div><div class="small muted">${sub}</div></div>${right}<span>←</span></div></div>`;
    const KIND = { amendment: "الحاقیه", edit: "ویرایش اطلاعات", renewal: "تمدید" };
    const needOpen = needs.filter((f) => !(f.proformas || []).some((p) => p.status !== "cancelled" && p.status !== "rejected"));
    return [
      { key: "services", label: "گزارش سرویس منتظر تأیید", n: svc.length, html: svc.map(serviceCard) },
      { key: "changes", label: "درخواست تغییر قرارداد", n: chg.length, html: chg.map((x) => item("#/requests", `${KIND[x.kind] || x.kind} · ${bn(x)}`, `قرارداد ${cc(x)} · ${jtime(x.requested_at)}`)) },
      { key: "drafts", label: "قرارداد جدید منتظر تأیید", n: drafts.length, html: drafts.map((x) => item(`#/contract/${x.id}`, bn(x), `قرارداد ${cc(x)} · ثبت ${jtime(x.created_at)}`)) },
      { key: "opening", label: "مانده‌ی افتتاحیه‌ی پیش‌نویس", n: opening.length, html: opening.map((x) => item(`#/contract/${x.contract_id}`, bn(x), `قرارداد ${cc(x)} · ${num(tom(x.total_rial))} تومان`)) },
      { key: "claims", label: "اعلام پرداخت مشترک‌ها", n: claims.length, html: claims.length ? [item("#/claims", `${fa(claims.length)} اعلام پرداخت`, "پس از بررسی حساب بانکی تأیید یا رد کنید")] : [] },
      { key: "locations", label: "موقعیت ساختمان ارسالی", n: locs.length, html: locs.length ? [item("#/locations", `${fa(locs.length)} موقعیت ساختمان`, "برای مسیریابی سرویس‌کارها تأیید کنید")] : [] },
      { key: "proformas", label: "پیش‌فاکتور منتظر تأیید", n: pfWait.length, html: pfWait.map((x) => item(`#/proforma/${x.id}`, bn(x), `پیش‌فاکتور <bdi dir="ltr">${esc(fa(x.document_number || ""))}</bdi> · ${num(tom(x.total_rial))} تومان${x.subject ? " · " + esc(x.subject) : ""}`)) },
      { key: "toinvoice", label: "پیش‌فاکتور تأییدشده که هنوز فاکتور نشده", n: pfInv.length, html: pfInv.map((x) => item(`#/proforma/${x.id}`, bn(x), `پیش‌فاکتور <bdi dir="ltr">${esc(fa(x.document_number || ""))}</bdi> · ${num(tom(x.total_rial))} تومان`)) },
      { key: "needs", label: "اعلام نیاز تعمیرکار بدون پیش‌فاکتور", n: needOpen.length, html: needOpen.map((f) => `<div class="card tap" data-act="open-fault" data-id="${f.id}"><div class="item-head"><div><div class="item-title">${bn(f)}</div><div class="small muted">${txt(f.needs_text || "")}${f.needs_at ? " · " + jtime(f.needs_at) : ""}</div></div><span>←</span></div></div>`) },
      { key: "sign", label: "قرارداد صادرشده منتظر امضای شما", n: sign.length, html: sign.map((x) => item(`#/contract/${x.id}`, bn(x), `قرارداد ${cc(x)} · فایل <bdi dir="ltr">${esc(fa(x.doc_number))}</bdi>`)) }
    ].filter((g) => g.n > 0);
  }
  async function pendingForMe() {
    const groups = await pendingGroups();
    if (!groups.length) return "";
    const total = groups.reduce((a, g) => a + g.n, 0);
    return `<div class="card pending-card"><div class="item-head tap" data-act="go" data-href="#/pending"><div class="item-title">در انتظار تأیید یا اقدام شما (${fa(total)})</div><span class="small">همه ←</span></div>
      ${groups.map((g) => `<div class="row tap pending-row" data-act="go" data-href="#/pending/${g.key}"><span class="spacer">${g.label}</span><span class="badge warn">${fa(g.n)}</span><span>←</span></div>`).join("")}</div>`;
  }
  async function viewPending(key) {
    const groups = await pendingGroups();
    const html = groups.length ? groups.map((g) => `<div class="section-title" id="pend-${g.key}"><h2>${g.label} (${fa(g.n)})</h2></div>${g.html.join("")}`).join("")
      : `<div class="card empty">چیزی منتظر تأیید یا اقدام شما نیست</div>`;
    if (key) setTimeout(() => { const t = document.getElementById(`pend-${key}`); if (t) t.scrollIntoView({ block: "start" }); }, 50);
    return shell("در انتظار تأیید", "dashboard", `<a href="#/dashboard" data-act="back" class="small">→ بازگشت</a><div style="height:8px"></div>${html}`);
  }

  function faultCard(f) {
    return `<div class="card tap" data-act="open-fault" data-id="${f.id}">
      <div class="item-head"><div><div class="item-title">${esc(f.buildings ? f.buildings.name : "")}</div>
      <div class="small muted">${txt(f.fault_description || "")}</div></div>
      <div style="text-align:left">${badge(PRIORITY, f.priority)}<div style="height:4px"></div>${badge(FAULT_STATUS, f.status)}${f.needs_text ? `<div style="height:4px"></div><span class="badge warn">اعلام نیاز</span>` : ""}</div></div>
      <div class="small muted">${f.subscription_code ? "کد " + esc(fa(f.subscription_code)) + " · " : ""}${f.fault_number ? "شماره " + esc(fa(f.fault_number)) + " · " : ""}اعلام ${jtime(f.reported_at)}</div>
      ${f.repaired_at ? `<div class="small">رفع ${jtime(f.repaired_at)}${f.technicians ? " · " + esc(f.technicians.name) : ""} · ${durFa((new Date(f.repaired_at) - new Date(f.reported_at)) / 60000)} پس از اعلام</div>` : ""}
      ${f.repair_description ? `<div class="small muted">${txt(f.repair_description)}</div>` : ""}</div>`;
  }

  let faultFilter = "open";
  async function viewFaults() {
    const filters = { open: "&status=in.(reported,assigned,in_progress)", emergency: "&priority=eq.emergency&status=in.(reported,assigned,in_progress)",
      done: "&status=in.(repaired,closed)", all: "" };
    const order = faultFilter === "done" ? "repaired_at.desc.nullslast,reported_at.desc" : "reported_at.desc";
    const list = await api(`faults?select=id,fault_number,fault_description,priority,status,reported_at,repaired_at,repair_description,subscription_code,needs_text,buildings(name),technicians(name)&order=${order}&limit=${faultFilter === "open" || faultFilter === "emergency" ? 100 : 300}${filters[faultFilter]}`);
    const chips = [["open", "باز"], ["emergency", "اضطراری"], ["done", "رفع‌شده"], ["all", "همه"]];
    return shell(role() === "TECHNICIAN" ? "کارهای من" : "خرابی‌ها", "faults", `
      ${can.reportFault() ? `<div class="page-actions"><button class="btn" data-act="new-fault">+ ثبت خرابی</button></div>` : ""}
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
      ${top.length ? `<div class="page-actions">${top.join("")}</div>` : ""}
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
  let contractTab = "current";
  async function viewContracts() {
    await contractsList();
    const list = listCache.list, held = listCache.held;
    const archived = (c) => ["expired", "terminated"].includes(c.status);
    const cur = list.filter((c) => !archived(c)), arc = list.filter(archived);
    const base = contractTab === "archive" ? arc : cur;
    const q = toEn(contractSearch).trim();
    const key = (c) => toEn([c.contract_code, c.subscription_code, c.building_name, c.customer_name, c.manager_name].join(" "));
    const shown = base;
    otherTabKeys = (contractTab === "archive" ? cur : arc).map(key);
    const card = (c) => `<div class="card tap" data-act="open-contract" data-id="${c.id}" data-search="${esc(key(c))}"${q && !key(c).includes(q) ? ` style="display:none"` : ""}>
        <div class="item-head"><div class="with-key"><span class="call-key" title="کد قرارداد">${esc(fa(String(c.contract_code).split(/[-/]/)[0]))}</span><div><div class="item-title">${esc(c.building_name || "")}</div>
        <div class="small muted">قرارداد ${esc(fa(c.contract_code))} · ${esc(c.customer_name || "")}${c.cooperation_year ? ` · ${fa(c.cooperation_year)} سال همکاری` : ""}${c.status !== "active" ? " " + badge(CONTRACT_STATUS, c.status) : ""}${held.has(c.id) ? ` <span class="badge warn">صورتحساب معلق</span>` : ""}</div>
        ${contractTab === "archive" && c.start_date ? `<div class="small muted">${jdate(c.start_date)} تا ${jdate(c.end_date)}</div>` : ""}</div></div>
        <div style="text-align:left">${money(Math.abs(c.balance_rial), { cls: c.balance_rial > 0 ? "debt" : c.balance_rial < 0 ? "credit" : "" })}${balanceBadge(c.balance_rial)}</div></div></div>`;
    let body;
    if (!shown.length) body = `<div class="card empty">${contractTab === "archive" ? "قراردادی در بایگانی نیست" : "قراردادی پیدا نشد"}</div>`;
    else if (contractTab === "archive") {
      // archive grouped by the Jalali year the contract period started
      const yearOf = (c) => { if (!c.start_date) return 0; const [y, m, d] = c.start_date.split("-").map(Number); return g2j(y, m, d).jy; };
      const groups = new Map();
      shown.slice().sort((x, y) => yearOf(y) - yearOf(x)).forEach((c) => { const k = yearOf(c); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); });
      body = [...groups.entries()].map(([y, cs]) => `<div class="cgroup"><div class="section-title"><h2>قراردادهای سال ${y ? fa(y) : "نامشخص"} (${fa(cs.length)})</h2></div>${cs.map(card).join("")}</div>`).join("");
    } else body = shown.map(card).join("");
    return shell(isExternal() ? "صورتحساب‌ها" : "قراردادها", "contracts", `
      ${can.changeContract() ? `<div class="page-actions"><button class="btn" data-act="new-contract">+ قرارداد جدید</button></div>` : ""}
      ${arc.length ? `<div class="chips"><button data-act="contract-tab" data-k="current" class="${contractTab === "current" ? "on" : ""}">جاری (${fa(cur.length)})</button><button data-act="contract-tab" data-k="archive" class="${contractTab === "archive" ? "on" : ""}">بایگانی (${fa(arc.length)})</button></div>` : ""}
      ${list.length > 3 ? `<div class="row"><input type="search" id="csearch" placeholder="جست‌وجو: کد قرارداد، ساختمان، مدیر ساختمان" value="${esc(contractSearch)}" style="flex:1"><button class="btn secondary small" data-act="csearch-clear" aria-label="پاک کردن جست‌وجو">پاک کن</button></div><div style="height:10px"></div>` : ""}
      ${body}<div class="card empty" id="cnone" style="display:none">قراردادی با این جست‌وجو پیدا نشد</div>
      <div class="card tap" id="cother" data-act="contract-tab" data-k="${contractTab === "archive" ? "current" : "archive"}" style="display:none"></div>`);
  }
  let otherTabKeys = [];
  // client-side filter: every card stays rendered, so clearing the box shows the full list at once
  function applyContractSearch() {
    const q = toEn(contractSearch).trim();
    let shownN = 0;
    document.querySelectorAll("[data-search]").forEach((card) => { const on = !q || card.dataset.search.includes(q); card.style.display = on ? "" : "none"; if (on) shownN++; });
    document.querySelectorAll(".cgroup").forEach((g) => { g.style.display = g.querySelector('[data-search]:not([style*="none"])') ? "" : "none"; });
    const none = document.getElementById("cnone"), other = document.getElementById("cother");
    if (none) none.style.display = q && !shownN ? "" : "none";
    if (other) {
      const n = q ? otherTabKeys.filter((k) => k.includes(q)).length : 0;
      other.style.display = n ? "" : "none";
      other.textContent = n ? `${fa(n)} قرارداد هم در ${contractTab === "archive" ? "قراردادهای جاری" : "بایگانی"} پیدا شد؛ برای دیدن بزنید` : "";
    }
  }

  async function sheetNewContract() {
    const ceo = role() === "CEO";
    const [blds, nextCode] = await Promise.all([api("buildings?is_active=eq.true&select=id,name,address&order=name"), rpc("next_subscription_code").catch(() => "")]);
    const base = /^\d+$/.test(String(nextCode || "")) ? Number(nextCode) : null; let elevN = 0; // D-77: next free code after the last one
    const f = (k, label, ltr, ph) => `<label>${label}</label><input type="text" data-nc="${k}" ${ltr ? 'class="ltr" inputmode="numeric"' : ""} placeholder="${ph || ""}">`;
    const ne = (k, ltr) => `<label>${FIELD_LABEL[k]}</label><input type="text" data-ne="${k}"${ltr ? ' class="ltr" inputmode="numeric"' : ""}${SPEC_LIST[k] ? ` list="dl-${k}"` : ""}>`;
    const elevRow = () => { const code = base ? String(base + elevN) : ""; elevN++;
      return `<div class="card" data-ncelev="1"><label>کد اشتراک دستگاه</label><input type="text" class="ltr" inputmode="numeric" data-ne="subscription_code" value="${esc(code)}">
      ${ne("stops", 1)}${ne("capacity_persons", 1)}${ne("usage_type")}${ne("traffic")}${ne("motor_type")}${ne("cabin_door_type")}${ne("landing_door_type")}${ne("controller_brand")}</div>`; };
    sheet(`<h3>قرارداد جدید</h3>
      <div class="hint">${ceo ? "با ذخیره، قرارداد فعال می‌شود. می‌توانید با اطلاعات ناقص هم ثبت کنید و بعد کامل کنید." : "قرارداد پس از تأیید مدیرعامل فعال می‌شود. همه‌ی خانه‌ها لازم است."}</div>
      <div class="section-title"><h2>ساختمان</h2></div>
      <label>ساختمان</label><select data-nc="building_id"><option value="">— ساختمان جدید —</option>${blds.map((b) => `<option value="${b.id}">${esc(b.name)}${b.address ? " · " + esc(b.address) : ""}</option>`).join("")}</select>
      <div data-field="newb">${f("b_name", "نام ساختمان")}${f("b_address", "نشانی")}${f("b_postal", "کد پستی", true)}${f("b_mname", "نام مدیر ساختمان")}${f("b_mmobile", "موبایل مدیر ساختمان", true, "09")}</div>
      <div class="section-title"><h2>کارفرما</h2></div>${f("cu_name", "نام کارفرما")}${f("cu_nid", "کد/شناسه ملی", true)}${f("cu_mobile", "موبایل", true, "09")}${f("cu_address", "نشانی کارفرما")}
      <div class="section-title"><h2>قرارداد</h2></div><label>کد قرارداد</label><input type="text" data-nc="code" class="ltr" inputmode="numeric" value="${esc(nextCode || "")}">
      ${base ? `<div class="hint">پیشنهاد سیستم: کد بعد از آخرین کد ثبت‌شده (${fa(base - 1)}). در صورت نیاز تغییر دهید.</div>` : ""}
      <label>تاریخ شروع</label>${datePickerHtml("ncstart")}<label>تاریخ پایان</label>${datePickerHtml("ncend", addDays(todayTehran(), 364))}
      ${amountFieldHtml("ncm", "مبلغ ماهانه (بدون ارزش افزوده)")}${amountFieldHtml("ncd", "کسر سرویس انجام‌نشده")}
      ${f("spm", "تعداد سرویس در ماه", true, "1")}${f("coop", "سال‌های همکاری (تعداد سال)", true, "1")}
      <label class="check"><input type="checkbox" data-nc="vat_exempt"> معاف از مالیات بر ارزش افزوده (صورتحساب بدون ۱۰٪)</label>
      <div class="section-title"><h2>دستگاه‌ها</h2></div><div data-field="elevs">${elevRow()}</div>${specDatalists()}
      <button type="button" class="btn secondary small" data-act="nc-add-elev">+ دستگاه دیگر</button>
      <div class="actions"><button class="btn" data-act="save">${ceo ? "ثبت قرارداد" : "ارسال برای تأیید"}</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      bindAmount(el, "ncm"); bindAmount(el, "ncd");
      const v = (k) => toEn((el.querySelector(`[data-nc="${k}"]`) || {}).value || "").trim();
      const bsel = el.querySelector('[data-nc="building_id"]');
      bsel.addEventListener("change", () => { el.querySelector('[data-field="newb"]').style.display = bsel.value ? "none" : ""; });
      el.querySelector('[data-act="nc-add-elev"]').addEventListener("click", () => el.querySelector('[data-field="elevs"]').insertAdjacentHTML("beforeend", elevRow()));
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const raw = (k) => ((el.querySelector(`[data-nc="${k}"]`) || {}).value || "").trim();
        const elevators = [...el.querySelectorAll("[data-ncelev]")].map((b) => { const o = {}; b.querySelectorAll("[data-ne]").forEach((i) => { o[i.dataset.ne] = ["subscription_code", "stops", "capacity_persons"].includes(i.dataset.ne) ? toEn(i.value.trim()) : i.value.trim(); }); return o; })
          .filter((x) => x.stops || x.capacity_persons || x.motor_type || x.usage_type || (x.subscription_code && x !== null));
        const m = readAmount(el, "ncm"), d = readAmount(el, "ncd");
        const payload = {
          building: bsel.value ? { id: Number(bsel.value) } : { name: raw("b_name"), address: raw("b_address"), postal_code: v("b_postal"), manager_name: raw("b_mname"), manager_mobile: v("b_mmobile") },
          customer: { name: raw("cu_name"), national_id: v("cu_nid"), mobile: v("cu_mobile"), address: raw("cu_address") },
          contract: { contract_code: v("code"), start_date: readDate(el, "ncstart"), end_date: readDate(el, "ncend"), monthly_amount_rial: m.value ? m.rial : "",
            missed_service_deduction_rial: d.value ? d.rial : "", services_per_month: v("spm") || "1", cooperation_year: v("coop") || "1" },
          elevators };
        if (!payload.contract.contract_code) throw new Error("کد قرارداد را وارد کنید");
        if (payload.contract.end_date < payload.contract.start_date) throw new Error("تاریخ پایان باید بعد از شروع باشد");
        const newId = await rpc("create_contract", { p: payload });
        if (el.querySelector('[data-nc="vat_exempt"]').checked) await rpc("set_vat_exempt", { p_contract_id: newId, p_exempt: true });
        close(); toast(ceo ? "قرارداد ثبت و فعال شد" : "قرارداد ثبت شد؛ منتظر تأیید مدیرعامل"); location.hash = `#/contract/${newId}`;
      }));
    });
  }

  async function viewContract(id) {
    const [[c], allInvoices, [next], [hold], changes, terms, files] = await Promise.all([
      api(`v_contract_overview?id=eq.${id}&select=*`),
      api(`invoices?contract_id=eq.${id}&select=id,document_type,document_number,issue_date,total_rial,status,opening_balance_rial,invoice_items(description,amount_rial,debit_credit)&order=issue_date.desc,id.desc`),
      api(`contracts?previous_contract_id=eq.${id}&select=id,contract_code`),
      api(`contracts?id=eq.${id}&select=billing_hold,billing_hold_reason,doc_number,doc_issued_at,sign_ceo_at,sign_sent_at,sign_sent_note,sign_returned_at,sign_returned_doc_id`),
      isStaff() ? api(`contract_change_requests?contract_id=eq.${id}&select=id,kind,payload,status,document_number,requested_at,decided_at,decision_note&order=id.desc`) : Promise.resolve([]),
      api(`contract_terms?contract_id=eq.${id}&select=effective_ym,monthly_amount_rial,missed_service_deduction_rial,services_per_month,source&order=effective_ym`),
      api(`documents?contract_id=eq.${id}&storage_path=not.is.null&select=id,document_type,file_name,storage_path,uploaded_at,notes,change_request_id&order=uploaded_at.desc`)]);
    const faultsHist = isStaff() ? await api(`faults?contract_id=eq.${id}&select=id,fault_number,fault_description,priority,status,reported_at,repaired_at,repair_description,subscription_code,needs_text,buildings(name),technicians(name)&order=reported_at.desc&limit=30`).catch(() => []) : [];
    if (!c) return shell("قرارداد", "contracts", `<div class="card empty">پیدا نشد یا دسترسی ندارید</div>`);
    // drafts (opening balances waiting for approval) are shown to the CEO only
    const invoices = allInvoices.filter((i) => i.status !== "draft" || role() === "CEO");
    const opening = allInvoices.find((i) => i.document_type === "opening_balance" && i.status !== "cancelled");
    const [ledger, prevL] = await Promise.all([api(`ledger?contract_id=eq.${id}&select=id,transaction_date,description,debit_rial,credit_rial&order=transaction_date.asc,id.asc`),
      c.previous_contract_id ? api(`contracts?id=eq.${c.previous_contract_id}&select=id,contract_code`) : Promise.resolve([])]);
    const prev = prevL[0] || null;
    let run = 0;
    const rows = ledger.map((l) => { run += Number(l.debit_rial) - Number(l.credit_rial); return { ...l, run }; }).reverse();
    const open = invoices.filter((i) => ["issued", "partially_paid"].includes(i.status));
    const actions = [];
    if (can.recordPayment() && invoices.some((i) => !["cancelled", "draft"].includes(i.status) && Number(i.total_rial) > 0)) actions.push(`<button class="btn ok" data-act="pay" data-id="${id}">ثبت دریافت وجه</button>`);
    if (role() === "CEO" && (!opening || opening.status === "draft")) actions.push(`<button class="btn secondary" data-act="opening" data-id="${id}">${opening ? "مانده افتتاحیه (پیش‌نویس)" : "+ مانده افتتاحیه"}</button>`);
    actions.push(`<button class="btn secondary" data-act="contract-report" data-id="${id}">گزارش عملکرد</button>`);
    if (isStaff() || isExternal()) actions.push(`<button class="btn secondary" data-act="period-statement" data-id="${id}">صورت‌حساب بازه‌ای</button>`);
    if (canDocs() && ["active", "expired"].includes(c.status)) actions.push(`<button class="btn secondary" data-act="new-proforma" data-id="${id}">+ پیش‌فاکتور</button>`, `<button class="btn secondary" data-act="new-invoice" data-id="${id}">+ فاکتور</button>`);
    if (can.changeContract() && hold && (hold.doc_number || c.status === "active")) actions.push(`<button class="btn secondary" data-act="print-contract" data-id="${id}">${hold.doc_number ? `فایل قرارداد <bdi dir="ltr">${esc(fa(hold.doc_number))}</bdi>` : "فایل قرارداد (پیش‌نویس و صدور)"}</button>`);
    if (role() === "CEO" && hold && !hold.billing_hold && c.status === "active") actions.push(`<button class="btn secondary" data-act="set-hold" data-id="${id}">تعلیق صورتحساب</button>`);
    if (can.changeContract()) {
      actions.push(`<button class="btn secondary" data-act="edit-contract" data-id="${id}">ویرایش اطلاعات</button>`);
      if (c.status === "active") actions.push(`<button class="btn secondary" data-act="amend" data-id="${id}">الحاقیه</button>`);
      if (!next && ["active", "expired"].includes(c.status)) actions.push(`<button class="btn secondary" data-act="renew" data-id="${id}">تمدید قرارداد</button>`);
      if (["active", "draft"].includes(c.status)) actions.push(`<button class="btn secondary" data-act="vat-exempt" data-id="${id}" data-on="${c.vat_exempt ? "0" : "1"}">${c.vat_exempt ? "برداشتن معافیت ارزش افزوده" : "معاف از ارزش افزوده"}</button>`);
    }
    if (role() === "CEO" && ["active", "draft"].includes(c.status)) actions.push(`<button class="btn danger" data-act="terminate" data-id="${id}">فسخ قرارداد</button>`);
    const missing = isStaff() ? await rpc("contract_missing_fields", { p_contract_id: id }).catch(() => []) : [];
    const insHtml = isStaff() ? await insuranceSection(id).catch(() => "") : "";
    const signHtml = isStaff() && hold && hold.doc_number ? signatureCard(id, hold, files) : "";
    const draftCard = c.status === "draft" ? `<div class="card" style="border-color:var(--warn)"><div class="item-title">قرارداد جدید منتظر تأیید مدیرعامل</div>
      <div class="small muted">تا تأیید نشود سرویس و صورتحساب نمی‌گیرد.</div>
      ${role() === "CEO" ? `<div class="actions"><button class="btn ok small" data-act="approve-contract" data-id="${id}">تأیید قرارداد</button><button class="btn danger small" data-act="reject-contract" data-id="${id}">رد</button></div>` : ""}</div>` : "";
    const missCard = missing && missing.length && !["expired", "terminated"].includes(c.status) ? `<div class="card" style="border-color:var(--danger)"><div class="item-title">اطلاعات ناقص قرارداد</div>
      <div class="small">${missing.map(esc).join("، ")}</div><div class="small muted">تا کامل نشود، تمدید توسط کارمند ممکن نیست. از «ویرایش اطلاعات» وارد کنید.</div></div>` : "";
    const locCard = ["BUILDING_MANAGER", "EMPLOYER"].includes(role()) ? `<div class="card"><div class="item-title">موقعیت ساختمان برای مسیریابی سرویس‌کار</div>
      <div class="small muted">داخل یا جلوی ساختمان دکمه را بزنید؛ پس از تأیید مدیر تعمیرات، سرویس‌کارها با یک لمس مسیریابی می‌کنند.</div>
      <div class="actions"><button class="btn secondary small" data-act="send-location" data-bid="${c.building_id}">ارسال موقعیت ساختمان</button></div></div>` : "";
    return shell(`قرارداد ${fa(c.contract_code)}`, "contracts", `<a href="#/contracts" data-act="back" class="small">→ بازگشت</a>${draftCard}${missCard}${locCard}
      <div class="card" style="margin-top:8px"><div class="item-head"><div><div class="item-title">${esc(c.building_name || "")}</div>
        <div class="small muted">${esc(c.building_address || "")}</div>${c.cooperation_year ? `<div class="small"><span class="badge info">سال‌های همکاری: ${fa(c.cooperation_year)} سال</span></div>` : ""}</div><div style="text-align:left">${balanceBadge(c.balance_rial)}${c.status !== "active" ? `<div style="height:4px"></div>${badge(CONTRACT_STATUS, c.status)}` : ""}</div></div>
        ${next ? `<div class="small">تمدید شد: <a href="#/contract/${next.id}">قرارداد ${esc(fa(next.contract_code))}</a></div>` : ""}
        ${prev ? `<div class="small muted">دوره قبل: <a href="#/contract/${prev.id}">قرارداد ${esc(fa(prev.contract_code))}</a></div>` : ""}
        ${hold && hold.billing_hold && isStaff() ? `<div class="error-box" style="margin:8px 0">صورتحساب این قرارداد معلق است: ${esc(hold.billing_hold_reason || "")}<div class="small">سرویس‌ها ثبت می‌شوند ولی صورتحساب صادر نمی‌شود؛ با رفع تعلیق، صورتحساب‌های عقب‌افتاده صادر می‌شوند.</div>
          ${role() === "CEO" ? `<div class="actions"><button class="btn ok small" data-act="release-hold" data-id="${id}">رفع تعلیق و صدور صورتحساب‌ها</button></div>` : ""}</div>` : ""}
        <div class="big-balance ${c.balance_rial > 0 ? "debt" : c.balance_rial < 0 ? "credit" : ""}"><span>${c.balance_rial > 0 ? "بدهی" : c.balance_rial < 0 ? "بستانکاری" : "مانده"}</span>${money(Math.abs(c.balance_rial))}</div>
        <dl class="kv"><dt>مشتری</dt><dd>${esc(c.customer_name || "—")}</dd>
        <dt>مدیر ساختمان</dt><dd>${esc(c.manager_name || "—")} ${c.manager_mobile ? `<a href="tel:${esc(c.manager_mobile)}" class="ltr">${esc(fa(c.manager_mobile))}</a>` : ""}</dd>
        <dt>مدت</dt><dd>${jdate(c.start_date)} تا ${jdate(c.end_date)}</dd>
        <dt>شارژ ماهانه</dt><dd>${money(c.monthly_amount_rial)}</dd>
        <dt>کسر سرویس انجام‌نشده</dt><dd>${money(c.missed_service_deduction_rial)}</dd>
        <dt>سرویس در ماه</dt><dd>${fa(c.services_per_month)}</dd>
        ${isStaff() ? `<dt>ارزش افزوده</dt><dd>${c.vat_exempt ? `<span class="badge info">معاف</span>` : "۱۰٪ روی صورتحساب‌ها"}</dd>` : ""}
        ${c.terminated_at ? `<dt>فسخ</dt><dd class="debt">${jdate(c.terminated_at)}${c.termination_reason ? " · " + esc(c.termination_reason) : ""}</dd>` : ""}</dl>
        ${contractActionsHtml(actions)}</div>

      ${signHtml}${insHtml}
      <div class="section-title"><h2>فایل‌های قرارداد</h2>${isStaff() ? `<button class="btn small secondary" data-act="attach" data-id="${id}">+ پیوست</button>` : ""}</div>
      ${files.length ? `<div class="card">${files.map((f) => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><div class="spacer"><div>${esc(FILE_TYPE[f.document_type] || f.document_type)}${f.change_request_id && changes.find((k) => k.id === f.change_request_id && k.document_number) ? ` <bdi dir="ltr">${esc(fa(changes.find((k) => k.id === f.change_request_id).document_number))}</bdi>` : ""}</div>
        <div class="small muted">${esc(f.file_name)} · ${jtime(f.uploaded_at)}${f.notes ? " · " + esc(f.notes) : ""}</div></div>
        <button class="btn small secondary" data-act="open-file" data-path="${esc(f.storage_path)}">مشاهده</button></div>`).join("")}</div>` : `<div class="card empty small">فایلی پیوست نشده${isStaff() ? "؛ نسخه‌ی امضاشده‌ی قرارداد را پیوست کنید" : ""}</div>`}
      ${changes.length ? `<div class="section-title"><h2>تغییرات قرارداد</h2></div>${changes.map(changeCard).join("")}` : ""}
      ${terms.length > 1 ? `<div class="section-title"><h2>شرایط مالی به ترتیب زمان</h2></div><div class="card"><table class="list"><tbody>${terms.map((t) => `<tr><td>از ${MONTHS[t.effective_ym % 100 - 1]} ${fa(Math.floor(t.effective_ym / 100))}<div class="small muted">${t.source === "amendment" ? "الحاقیه" : "قرارداد"}</div></td>
        <td style="text-align:left">${num(Math.round(t.monthly_amount_rial / 10))} تومان<div class="small muted">کسر ${num(Math.round(t.missed_service_deduction_rial / 10))} · ${fa(t.services_per_month)} سرویس</div></td></tr>`).join("")}</tbody></table></div>` : ""}

      ${isStaff() ? `<div class="section-title"><h2>سابقه‌ی خرابی‌ها</h2><span class="small muted">${fa(faultsHist.length)} مورد${faultsHist.length === 30 ? " (۳۰ مورد آخر)" : ""}</span></div>
        ${faultsHist.length ? faultsHist.map(faultCard).join("") : `<div class="card empty">خرابی‌ای برای این قرارداد ثبت نشده</div>`}` : ""}
      <div class="section-title"><h2>اسناد</h2><span class="small muted">${fa(open.length)} باز</span></div>
      ${invoices.length ? invoices.map((i) => `<div class="card"><div class="item-head"><div><div class="item-title">${i.document_number ? `<bdi dir="ltr">${esc(fa(i.document_number))}</bdi>` : `<span class="muted">بدون شماره</span>`}</div>
        <div class="small muted">${DOC_TYPE[i.document_type] || i.document_type} · ${jdate(i.issue_date)}</div></div>
        <div style="text-align:left">${docAmount(i)}${INTERNAL_DOC.includes(i.document_type) && i.status !== "draft" && i.status !== "cancelled" ? `<span class="badge info">ثبت‌شده</span>` : badge(INVOICE_STATUS, i.status)}</div></div>
        ${(i.invoice_items || []).map((it) => `<div class="small">${txt(it.description)}</div>`).join("")}

        ${i.status === "draft" && i.document_type === "opening_balance" && role() === "CEO" ? `<div class="actions"><button class="btn ok small" data-act="post-opening" data-id="${i.id}">تأیید و ثبت در حساب</button><button class="btn secondary small" data-act="opening" data-id="${id}">ویرایش</button></div>` : ""}
        ${i.opening_balance_rial ? `<div class="small muted">مانده قبل از این سند: ${num(Math.round(i.opening_balance_rial / 10))} تومان</div>` : ""}
        ${(() => { const view = !INTERNAL_DOC.includes(i.document_type) && i.status !== "draft" ? `<a class="btn secondary small" href="#/doc/${i.id}">مشاهده، چاپ و لینک پرداخت</a>` : "";
          const cancel = can.cancelInvoice() && !["cancelled", "draft"].includes(i.status) && i.document_type !== "balance_transfer" ? `<button class="btn secondary small danger-text" data-act="cancel-invoice" data-id="${i.id}" data-no="${esc(i.document_number || "")}">ابطال سند</button>` : "";
          return view || cancel ? `<div class="actions">${view}${cancel}</div>` : ""; })()}
        </div>`).join("") : `<div class="card empty">سندی صادر نشده</div>`}

      <div class="section-title"><h2>گردش حساب</h2></div>
      <div class="card">${rows.length ? `<table class="list"><tbody>${rows.map((r) => `<tr><td><div>${txt(r.description)}</div><div class="small muted">${jdate(r.transaction_date)}</div></td>
        <td style="text-align:left;white-space:nowrap">${r.debit_rial > 0 ? `<span class="debt">بدهکار ${num(Math.round(r.debit_rial / 10))}</span>` : `<span class="credit">بستانکار ${num(Math.round(r.credit_rial / 10))}</span>`}
        <div class="small muted">مانده ${num(Math.round(r.run / 10))}</div></td></tr>`).join("")}</tbody></table><div class="hint">مبالغ به تومان</div>` : `<div class="empty">گردشی ثبت نشده</div>`}</div>`);
  }

  let usersOpen = false;
  async function viewMore() {
    const p = state.profile;
    let users = "";
    if (can.manageUsers()) {
      const list = await api("user_profiles?select=id,full_name,username,role,is_active&order=is_active.desc,full_name.asc");
      users = `<details class="card fold"${usersOpen ? " open" : ""}><summary data-act="users-fold"><span class="item-title">کاربران</span> <span class="small muted">${fa(list.filter((u) => u.is_active).length)} فعال از ${fa(list.length)}</span></summary>
        <div class="row" style="margin:8px 0"><button class="btn small" data-act="new-user">+ کاربر جدید</button></div>
        ${list.map((u) => `<div class="card"><div class="item-head"><div><div class="item-title">${esc(u.full_name || "بدون نام")}</div>
          <div class="small muted">${esc(ROLE[u.role] || u.role)}${u.username ? ` · <bdi dir="ltr">${esc(u.username)}</bdi>` : ""} ${u.is_active ? "" : "· غیرفعال"}</div></div>
          <button class="btn secondary small" data-act="edit-user" data-id="${u.id}">ویرایش</button></div></div>`).join("")}
        <div class="hint">کاربر جدید با نام کاربری و رمز اولیه ساخته می‌شود؛ هر دو را به خودش بدهید.</div></details>`;
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
      ${isStaff() ? `<div class="card tap" data-act="go" data-href="#/docs"><div class="item-head"><div><div class="item-title">اسناد</div>
        <div class="small muted">پیش‌فاکتورها، فاکتورها و صورتحساب‌ها — مشاهده، چاپ و ارسال</div></div><span>←</span></div></div>` : ""}
      ${can.recordPayment() ? `<div class="card tap" data-act="go" data-href="#/debts"><div class="item-head"><div><div class="item-title">بدهکاران و اسناد پرداخت‌نشده</div>
        <div class="small muted">پیگیری وصول مطالبات</div></div><span>←</span></div></div>` : ""}
      ${can.changeContract() ? `<div class="card tap" data-act="go" data-href="#/renewals"><div class="item-head"><div><div class="item-title">تمدید قراردادها</div>
        <div class="small muted">قراردادهای رو به پایان این ماه و ماه بعد</div></div><span>←</span></div></div>` : ""}
      ${canInstall() ? `<div class="card tap" data-act="go" data-href="#/install"><div class="item-head"><div><div class="item-title">پروژه‌های نصب</div>
        <div class="small muted">${role() === "CEO" ? "پیشنهاد قیمت، کنترل پروژه و پیشرفت فیزیکی" : "کنترل پروژه و پیشرفت فیزیکی نصب"}</div></div><span>←</span></div></div>` : ""}
      ${role() === "CEO" ? `<div class="card tap" data-act="go-reports"><div class="item-head"><div><div class="item-title">گزارش‌های مالی</div>
        <div class="small muted">تراز بازه‌ای، بدهکاران، دریافت‌ها — با خروجی اکسل</div></div><span>←</span></div></div>` : ""}
      ${["CEO", "EMPLOYEE"].includes(role()) ? `<div class="card tap" data-act="go-close"><div class="item-head"><div><div class="item-title">بستن ماه</div>
        <div class="small muted">سرویس‌های انجام‌نشده و صورتحساب ماه</div></div><span>←</span></div></div>` : ""}
      ${role() === "CEO" ? `<div class="card tap" data-act="go-requests"><div class="item-head"><div><div class="item-title">درخواست‌های تغییر قرارداد</div>
        <div class="small muted">ویرایش، الحاقیه و تمدیدهای ثبت‌شده توسط کارمند</div></div>${pendingChanges ? `<span class="badge warn">${fa(pendingChanges)} منتظر</span>` : "<span>←</span>"}</div></div>` : ""}
      ${can.recordPayment() ? `<div class="card tap" data-act="go-claims"><div class="item-head"><div><div class="item-title">اعلام پرداخت مشتریان</div>
        <div class="small muted">واریزهایی که مشترک‌ها از لینک صورتحساب اعلام کرده‌اند</div></div><span>←</span></div></div>` : ""}
      ${role() === "CEO" ? `<div class="card tap" data-act="go" data-href="#/templates"><div class="item-head"><div><div class="item-title">متن قرارداد</div>
        <div class="small muted">ویرایش متن قرارداد سرویس و نگهداری با ثبت بازنگری (PY-FO-PC-G08)</div></div><span>←</span></div></div>` : ""}
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
        if (!c) throw new Error("ساختمان را از فهرست انتخاب کنید");
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
    const [repairs, fpf] = isStaff() ? await Promise.all([api(`repairs?fault_id=eq.${id}&select=id,status,labor_cost_rial,parts_cost_rial,description,invoice_id`),
      api(`proformas?fault_id=eq.${id}&select=id,document_number,status,invoice_id,total_rial,valid_until&order=id.desc`)]) : [[], []];
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
    // D-87: a fault is marked repaired regardless of any invoice; the office decides about invoicing separately
    if ((isTech && f.status === "in_progress") || (can.manageFaults() && ["reported", "assigned", "in_progress"].includes(f.status))) statusBtns.push(`<button class="btn ok small" data-act="fixed">رفع شد</button>`);
    if (can.manageFaults() && f.status === "repaired") statusBtns.push(`<button class="btn secondary small" data-act="status" data-s="closed">بستن پرونده</button>`);
    if (can.manageFaults() && ["reported", "assigned"].includes(f.status)) statusBtns.push(`<button class="btn secondary small" data-act="status" data-s="cancelled">لغو</button>`);
    let rateHtml = "";
    if (canRate() && f.technician_id && ["repaired", "closed"].includes(f.status)) {
      const [mine] = await rpc("my_work_rating", { p_kind: "repair", p_ref_id: id }).catch(() => []);
      rateHtml = `<div class="card" style="margin-top:12px"><div class="item-title">امتیاز به تعمیر</div>${starsHtml(mine ? mine.stars : 0)}
        <div class="actions"><button class="btn small" data-act="rate-repair">${mine ? "به‌روزرسانی امتیاز" : "ثبت امتیاز"}</button></div></div>`;
    }
    let repairHtml = "";
    if (f.repair_description) repairHtml = `<div class="card" style="margin-top:12px"><div class="item-title">کار انجام‌شده</div><div class="small">${txt(f.repair_description)}</div></div>`;
    sheet(`<h3>${esc(b.name || "خرابی")}</h3>
      <div class="row">${badge(PRIORITY, f.priority)} ${badge(FAULT_STATUS, f.status)}</div>
      <p>${esc(f.fault_description || "")}</p>
      <dl class="kv"><dt>زمان اعلام</dt><dd>${jtime(f.reported_at)}</dd>
      ${f.reported_by ? `<dt>اعلام‌کننده</dt><dd>${esc(f.reported_by)}</dd>` : ""}
      <dt>نشانی</dt><dd>${esc(b.address || "—")}</dd>
      <dt>مدیر ساختمان</dt><dd>${esc(b.manager_name || "—")} ${b.manager_mobile ? `<a href="tel:${esc(b.manager_mobile)}">${esc(fa(b.manager_mobile))}</a>` : ""}</dd>
      <dt>تکنسین</dt><dd>${esc(f.technicians ? f.technicians.name : "—")}</dd>
      ${f.repaired_at ? `<dt>زمان رفع</dt><dd>${jtime(f.repaired_at)}</dd>` : ""}</dl>
      ${actions}<div class="actions">${statusBtns.join("")}</div>
      ${isTech && !["closed", "cancelled"].includes(f.status) ? `<div class="card" style="margin-top:12px"><div class="item-title">اعلام نیاز (قطعه یا تعمیر اساسی)</div>
        <textarea data-field="needs" placeholder="مثلاً: شستی طبقه دوم و میکروسوئیچ درب کابین باید تعویض شود">${esc(f.needs_text || "")}</textarea>
        <div class="hint">دفتر بر اساس این، پیش‌فاکتور برای مشتری صادر می‌کند.</div>
        <div class="actions"><button class="btn small" data-act="save-needs">ثبت اعلام نیاز</button></div></div>` : ""}
      ${!isTech && f.needs_text ? `<div class="card" style="margin-top:12px;border-color:var(--warn)"><div class="item-title">اعلام نیاز تعمیرکار</div><div class="small">${txt(f.needs_text)}</div><div class="small muted">${jtime(f.needs_at)}</div></div>` : ""}
      ${(fpf || []).map((q) => `<div class="card tap" data-act="go-pf" data-id="${q.id}" style="margin-top:8px"><div class="item-head"><div><div class="item-title">پیش‌فاکتور <bdi dir="ltr">${esc(fa(q.document_number))}</bdi></div>
        <div class="small muted">${q.invoice_id ? "فاکتور شده" : q.status === "approved" ? "تأییدشده — منتظر پرداخت و صدور فاکتور" : ""}</div></div><div style="text-align:left">${money(q.total_rial)}<span class="badge ${pfState(q)[1]}">${pfState(q)[0]}</span></div></div></div>`).join("")}
      ${repairHtml}
      ${canDocs() && f.contract_id ? `<div class="actions"><button class="btn secondary small" data-act="fault-proforma">پیش‌فاکتور این خرابی</button><button class="btn secondary small" data-act="fault-invoice">صدور فاکتور این خرابی</button></div>` : ""}${rateHtml}
      <div class="actions"><button class="btn secondary" data-close>بستن</button></div>`,
    (el, close) => {
      bindStars(el);
      el.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]"); if (!btn) return;
        const act = btn.dataset.act;
        if (act === "assign") guarded(btn, async () => {
          const t = el.querySelector('[data-field="tech"]').value; if (!t) throw new Error("تکنسین را انتخاب کنید");
          await api(`faults?id=eq.${id}`, { method: "PATCH", body: { technician_id: Number(t), status: f.status === "reported" ? "assigned" : f.status } });
          close(); toast("ارجاع شد؛ در حال ارسال پیامک به تعمیرکار…"); route();
          callFunction("notify-tech", { kind: "fault", fault_id: id })
            .then((r) => toast(r.test ? `پیامک ارجاع (آزمایشی) به ${fa(r.to)} رفت` : "پیامک ارجاع برای تعمیرکار فرستاده شد"))
            .catch((er) => toast(er.message));
        });
        if (act === "fault-proforma" || act === "fault-invoice") { close(); sheetDoc(act === "fault-proforma" ? "proforma" : "invoice", { contractId: f.contract_id, faultId: id, subject: f.needs_text || f.fault_description }).catch((er) => toast(er.message)); return; }
        if (act === "go-pf") { close(); location.hash = `#/proforma/${btn.dataset.id}`; return; }
        if (act === "save-needs") guarded(btn, async () => {
          await rpc("report_fault_needs", { p_fault_id: id, p_text: el.querySelector('[data-field="needs"]').value.trim() });
          close(); toast("اعلام نیاز ثبت شد؛ دفتر پیش‌فاکتور صادر می‌کند"); route();
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
        if (act === "fixed") guarded(btn, async () => {
          const what = prompt("شرح کار انجام‌شده (اختیاری):", f.repair_description || "");
          if (what === null) return;
          await api(`faults?id=eq.${id}`, { method: "PATCH", body: { status: "repaired", repair_description: what.trim() || f.repair_description || null } });
          if (repair && !["completed", "cancelled"].includes(repair.status) && isStaff())
            await api(`repairs?id=eq.${repair.id}`, { method: "PATCH", body: { status: "completed", repair_end: new Date().toISOString(), description: what.trim() || repair.description } }).catch(() => {});
          close(); toast("خرابی رفع شد");
          // D-85/D-87: invoicing is a separate, optional step
          if (canDocs()) {
            const pend = (fpf || []).filter((q) => q.status === "approved" && !q.invoice_id);
            if (pend.length && confirm(`پیش‌فاکتور ${fa(pend[0].document_number)} تأیید شده ولی هنوز فاکتور نشده. اگر مشتری پرداخت کرده، فاکتور صادر شود؟`)) {
              const inv = await rpc("invoice_from_proforma", { p_id: pend[0].id }); toast("فاکتور صادر شد"); payOffer = inv; location.hash = `#/doc/${inv}`; return;
            }
            if (!pend.length && !(fpf || []).some((q) => q.invoice_id) && confirm("خرابی رفع شد. آیا برای آن چیزی باید فاکتور شود؟ (اگر نه، «Cancel» را بزنید)")) {
              sheetDoc("invoice", { contractId: f.contract_id, faultId: id }).catch((er) => toast(er.message)); return;
            }
          }
          route();
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
        const [sr] = await api("service_reports", { method: "POST", prefer: "return=representation", body });
        if (!missed && sr) notifyServiceLink(sr.id);
        close(); toast(missed ? "ثبت شد؛ صورتحساب ماه صادر شد" : "گزارش سرویس ثبت شد؛ لینک تأیید برای مدیر ساختمان پیامک می‌شود"); route();
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

  async function sheetPaymentForInvoice(invId) {
    const [i] = await api(`invoices?id=eq.${invId}&select=contract_id`);
    const rem = await rpc("get_invoice_document", { p_invoice_id: invId }).then((d) => Number(d.remaining) || 0).catch(() => 0);
    return sheetPayment(i.contract_id, invId, rem);
  }

  /* item 17 (D-92): monthly archive — every document issued in a Jalali month, one PDF each, in folders by subscription code,
     built on the device (iPhone included) and saved locally; no server needed to open it later. */
  const loadScript = (src) => new Promise((ok, bad) => { if (document.querySelector(`script[src="${src}"]`)) return ok();
    const t = document.createElement("script"); t.src = src; t.onload = ok; t.onerror = () => bad(new Error("بارگذاری ابزار ساخت فایل ناموفق بود")); document.head.appendChild(t); });
  function jpegPdf(pages) { // pages: [{ bytes: Uint8Array (JPEG), w, h }] -> one A4 page per image
    const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
    const put = (x) => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); len += b.length; };
    const obj = (n, body, stream) => { offs[n] = len; put(`${n} 0 obj\n${body}\n`); if (stream) { put("stream\n"); put(stream); put("\nendstream\n"); } put("endobj\n"); };
    put("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    const W = 595.28, H = 841.89, n = pages.length, kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>"); obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
    pages.forEach((pg, i) => {
      const po = 3 + i * 3, co = po + 1, im = po + 2, cs = enc.encode(`q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`);
      obj(po, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${co} 0 R >>`);
      obj(co, `<< /Length ${cs.length} >>`, cs);
      obj(im, `<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.bytes.length} >>`, pg.bytes);
    });
    const total = 3 + n * 3, xref = len;
    put(`xref\n0 ${total}\n0000000000 65535 f \n`); for (let i = 1; i < total; i++) put(`${String(offs[i]).padStart(10, "0")} 00000 n \n`);
    put(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(len); let o = 0; for (const b of parts) { out.set(b, o); o += b.length; } return out;
  }
  const safeName = (x) => String(x || "").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 80);
  async function pagesToPdf(host) {
    const out = [];
    for (const pg of host.querySelectorAll(".pp-page")) {
      const opt = { pixelRatio: 1.6, quality: 0.82, backgroundColor: "#ffffff", cacheBust: false };
      if (!pagesToPdf.warm) { await htmlToImage.toJpeg(pg, opt).catch(() => null); pagesToPdf.warm = true; } // Safari draws images on the second pass
      const url = await htmlToImage.toJpeg(pg, opt);
      const bin = atob(url.slice(url.indexOf(",") + 1)), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const img = await new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = url; });
      out.push({ bytes, w: img.naturalWidth, h: img.naturalHeight });
    }
    if (!out.length) throw new Error("صفحه‌ای ساخته نشد");
    return jpegPdf(out);
  }
  async function buildMonthArchive(jy, jm, progress, isCancelled) {
    await Promise.all([loadScript("vendor/jszip.min.js"), loadScript("vendor/html-to-image.js")]);
    const g1 = j2g(jy, jm, 1), g2 = jm === 12 ? j2g(jy + 1, 1, 1) : j2g(jy, jm + 1, 1);
    const from = `${g1.gy}-${pad(g1.gm)}-${pad(g1.gd)}`, to = `${g2.gy}-${pad(g2.gm)}-${pad(g2.gd)}`; // [from, to)
    const tsFrom = new Date(`${from}T00:00:00+03:30`).toISOString(), tsTo = new Date(`${to}T00:00:00+03:30`).toISOString();
    const [invs, pfs, cts] = await Promise.all([
      api(`invoices?issue_date=gte.${from}&issue_date=lt.${to}&status=neq.draft&document_type=not.in.(opening_balance,balance_transfer)&select=id,document_type,document_number,issue_date,total_rial,status,contracts(contract_code,subscription_code,buildings(name))&order=issue_date,id`),
      api(`proformas?issued_at=gte.${tsFrom}&issued_at=lt.${tsTo}&select=id,document_number,issued_at,total_rial,status,contracts(contract_code,subscription_code,buildings(name))&order=issued_at,id`),
      api(`contracts?doc_issued_at=gte.${tsFrom}&doc_issued_at=lt.${tsTo}&select=id,doc_number,doc_issued_at,contract_code,subscription_code,buildings(name)&order=doc_issued_at,id`)]);
    const jobs = [
      ...cts.map((c) => ({ kind: "contract", id: c.id, no: c.doc_number, date: c.doc_issued_at, sub: c.subscription_code, code: c.contract_code, bname: c.buildings && c.buildings.name, label: "قرارداد", status: "صادرشده", total: null })),
      ...pfs.map((p) => ({ kind: "proforma", id: p.id, no: p.document_number, date: p.issued_at, sub: p.contracts && p.contracts.subscription_code, code: p.contracts && p.contracts.contract_code, bname: p.contracts && p.contracts.buildings && p.contracts.buildings.name, label: "پیش‌فاکتور", status: (PF_STATUS[p.status] || [p.status])[0], total: p.total_rial })),
      ...invs.map((i) => ({ kind: "invoice", id: i.id, no: i.document_number, date: i.issue_date, sub: i.contracts && i.contracts.subscription_code, code: i.contracts && i.contracts.contract_code, bname: i.contracts && i.contracts.buildings && i.contracts.buildings.name, label: DOC_TYPE[i.document_type] || i.document_type, status: (INVOICE_STATUS[i.status] || [i.status])[0], total: i.total_rial }))];
    if (!jobs.length) throw new Error(`در ${MONTHS[jm - 1]} ${fa(jy)} سندی صادر نشده است`);
    const zip = new JSZip(), root = `Payaco-${jy}-${pad(jm)}`, rows = [], failed = [];
    const stage = document.createElement("div"); stage.className = "pp-stage";
    stage.innerHTML = `<div class="pp-pages" style="--z:1"></div>`; document.body.appendChild(stage);
    const host = stage.firstChild;
    try {
      for (let k = 0; k < jobs.length; k++) {
        if (isCancelled()) throw new Error("لغو شد");
        const j = jobs[k]; progress(k, jobs.length, j);
        const folder = `${root}/${safeName((j.sub || j.code || "بدون-کد") + (j.bname ? " - " + j.bname : ""))}`;
        const file = `${safeName(j.label)} ${safeName(toEn(j.no || String(j.id)))}.pdf`;
        try {
          host.innerHTML = "";
          if (j.kind === "contract") renderContract(host, await contractPrintData(j.id));
          else if (j.kind === "proforma") renderProformaPages(host, await rpc("get_proforma", { p_id: j.id }));
          else renderInvoicePages(host, await rpc("get_invoice_document", { p_invoice_id: j.id }));
          await (document.fonts ? document.fonts.ready : Promise.resolve());
          zip.file(`${folder}/${file}`, await pagesToPdf(host));
          rows.push([j.sub, j.code, j.bname, j.label, toEn(j.no || ""), jdLatin(j.date), j.total === null ? "" : tom(j.total), j.status, `${folder.slice(root.length + 1)}/${file}`]);
        } catch (er) { failed.push(`${j.label} ${toEn(j.no || j.id)}: ${er.message}`); rows.push([j.sub, j.code, j.bname, j.label, toEn(j.no || ""), jdLatin(j.date), j.total === null ? "" : tom(j.total), j.status, "ساخته نشد: " + er.message]); }
      }
    } finally { stage.remove(); }
    const csv = "﻿" + [["کد اشتراک", "کد قرارداد", "ساختمان", "نوع سند", "شماره", "تاریخ", "مبلغ (تومان)", "وضعیت", "فایل"], ...rows]
      .map((r) => r.map((x) => `"${String(x === null || x === undefined ? "" : x).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    zip.file(`${root}/فهرست اسناد.csv`, csv);
    progress(jobs.length, jobs.length, null);
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
    return { blob, name: `${root}.zip`, count: jobs.length - failed.length, failed };
  }
  async function saveBlob(blob, name) {
    const file = new File([blob], name, { type: "application/zip" });
    if (navigator.canShare && navigator.share && /iPhone|iPad|Android/i.test(navigator.userAgent) && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return "share"; } catch (er) { if (er && er.name === "AbortError") return "abort"; }
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); return "download";
  }
  function sheetMonthArchive() {
    const t = toEn(todayTehran()).split("-").map(Number), tj = g2j(t[0], t[1], t[2]);
    const py = tj.jm === 1 ? tj.jy - 1 : tj.jy, pm = tj.jm === 1 ? 12 : tj.jm - 1;
    sheet(`<h3>بایگانی ماهانه‌ی اسناد (ZIP)</h3>
      <div class="hint">همه‌ی اسناد صادرشده‌ی ماه (قرارداد، پیش‌فاکتور، فاکتور تعمیر و بیمه، صورتحساب) هر کدام یک PDF، در پوشه‌ی کد اشتراک، به‌همراه فهرست اکسل. فایل روی همین دستگاه ساخته و ذخیره می‌شود؛ در آیفون «Save to Files» را بزنید.</div>
      <div class="row"><select data-field="m">${MONTHS.map((m, i) => `<option value="${i + 1}" ${i + 1 === pm ? "selected" : ""}>${m}</option>`).join("")}</select>
        <select data-field="y">${[py - 1, py, py + 1].filter((y) => y <= tj.jy).map((y) => `<option value="${y}" ${y === py ? "selected" : ""}>${fa(y)}</option>`).join("")}</select></div>
      <div data-field="prog" class="small muted" style="margin-top:8px"></div><div class="progress" hidden><div></div></div>
      <div class="actions"><button class="btn" data-act="go">ساخت و ذخیره</button><button class="btn secondary" data-close>بستن</button></div>`,
    (el) => {
      let cancelled = false, busy = false;
      el.querySelector("[data-close]").addEventListener("click", () => { cancelled = true; });
      const prog = el.querySelector('[data-field="prog"]'), bar = el.querySelector(".progress"), btn = el.querySelector('[data-act="go"]');
      btn.addEventListener("click", async () => {
        if (busy) return; busy = true; btn.disabled = true; cancelled = false; bar.hidden = false;
        const jy = Number(el.querySelector('[data-field="y"]').value), jm = Number(el.querySelector('[data-field="m"]').value);
        try {
          prog.textContent = "در حال آماده‌سازی…";
          const r = await buildMonthArchive(jy, jm, (k, n, j) => { bar.firstChild.style.width = `${Math.round((k / n) * 100)}%`;
            prog.textContent = j ? `سند ${fa(k + 1)} از ${fa(n)}: ${j.label} ${fa(j.no || "")}` : "در حال بستن فایل ZIP…"; }, () => cancelled);
          const how = await saveBlob(r.blob, r.name);
          prog.innerHTML = `${how === "abort" ? "ذخیره لغو شد." : `فایل <bdi dir="ltr">${esc(r.name)}</bdi> با ${fa(r.count)} سند آماده شد (${fa((r.blob.size / 1048576).toFixed(1))} مگابایت).`}${r.failed.length ? `<div class="debt">${fa(r.failed.length)} سند ساخته نشد: ${r.failed.map(esc).join("؛ ")}</div>` : ""}`;
        } catch (er) { prog.innerHTML = `<span class="debt">${esc(er.message)}</span>`; }
        busy = false; btn.disabled = false;
      });
    });
  }

  // line icons that replace the old emoji (D-101): same stroke family as the tab bar, coloured by currentColor
  const svgI = (d) => `<svg class="ico-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICO_PHONE = svgI('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>');
  const ICO_WEB = svgI('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>');
  const ICO_CHECK = `<span style="color:var(--ok)">${svgI('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.6 2.6L16 9.5"/>')}</span>`;
  const ICO_TODO = `<span class="muted">${svgI('<circle cx="12" cy="12" r="9"/>')}</span>`;
  /* item 15 (D-91): paper signature cycle of an issued contract — the system only records the steps */
  function signatureCard(id, h, files) {
    const step = (done, label, when, btn) => `<div class="row" style="padding:6px 0;border-top:1px solid var(--line)"><div class="spacer"><div>${done ? ICO_CHECK : ICO_TODO} ${label}</div>${when ? `<div class="small muted">${when}</div>` : ""}</div>${btn || ""}</div>`;
    const ch = can.changeContract(), signed = files.find((f) => f.id === h.sign_returned_doc_id);
    const s1 = step(!!h.sign_ceo_at, "امضای مدیرعامل", h.sign_ceo_at ? jtime(h.sign_ceo_at) : "",
      !h.sign_ceo_at && role() === "CEO" ? `<button class="btn ok small" data-act="sign-step" data-step="ceo" data-id="${id}">امضا کردم</button>` : "");
    const s2 = step(!!h.sign_sent_at, "ارسال برای مشترک", h.sign_sent_at ? jdate(h.sign_sent_at) + (h.sign_sent_note ? " · " + esc(h.sign_sent_note) : "") : "",
      h.sign_ceo_at && !h.sign_sent_at && ch ? `<button class="btn ok small" data-act="sign-step" data-step="sent" data-id="${id}">ثبت ارسال</button>` : "");
    const waited = h.sign_sent_at && !h.sign_returned_at ? Math.round((new Date(todayTehran()) - new Date(h.sign_sent_at)) / 86400000) : 0;
    const s3 = step(!!h.sign_returned_at, "امضای مشترک و عودت", h.sign_returned_at ? jdate(h.sign_returned_at) + (signed ? ` · <a href="#" data-act="open-file" data-path="${esc(signed.storage_path)}">نسخه‌ی امضاشده</a>` : "") : waited > 0 ? `${fa(waited)} روز از ارسال گذشته` : "",
      h.sign_sent_at && !h.sign_returned_at && ch ? `<button class="btn ok small" data-act="sign-step" data-step="returned" data-id="${id}">ثبت عودت</button>` : "");
    const undo = role() === "CEO" && (h.sign_ceo_at || h.sign_sent_at || h.sign_returned_at) ? `<div class="actions"><button class="btn secondary small" data-act="sign-step" data-step="undo" data-id="${id}">برگرداندن آخرین مرحله</button></div>` : "";
    const stateBadge = h.sign_returned_at ? `<span class="badge ok">کامل</span>` : `<span class="badge warn">در جریان</span>`;
    return `<div class="section-title"><h2>امضای قرارداد</h2></div><div class="card"><div class="item-head"><div class="small muted">فایل قرارداد <bdi dir="ltr">${esc(fa(h.doc_number))}</bdi>${h.doc_issued_at ? " · صادر " + jdate(h.doc_issued_at) : ""} · امضا روی نسخه‌ی کاغذی</div>${stateBadge}</div>${s1}${s2}${s3}${undo}</div>`;
  }
  async function signStep(id, stepName) {
    if (stepName === "ceo") { if (!confirm("امضای شما روی نسخه‌ی کاغذی ثبت شود؟")) return; await rpc("record_contract_signature", { p_contract_id: id, p_step: "ceo" }); toast("امضای مدیرعامل ثبت شد"); return route(); }
    if (stepName === "undo") { if (!confirm("آخرین مرحله‌ی امضا برگردانده شود؟")) return; await rpc("record_contract_signature", { p_contract_id: id, p_step: "undo" }); toast("برگردانده شد"); return route(); }
    const docs = stepName === "returned" ? await api(`documents?contract_id=eq.${id}&storage_path=not.is.null&select=id,document_type,file_name,uploaded_at&order=uploaded_at.desc`) : [];
    sheet(`<h3>${stepName === "sent" ? "ثبت ارسال قرارداد برای مشترک" : "ثبت عودت قرارداد امضاشده"}</h3>
      <label>تاریخ</label>${datePickerHtml("sgd", todayTehran())}
      ${stepName === "sent" ? `<label>روش یا توضیح (اختیاری)</label><input type="text" data-field="note" placeholder="مثلاً تحویل به مدیر ساختمان، پیک، پست">`
        : `<label>نسخه‌ی اسکن‌شده (اختیاری)</label><select data-field="doc"><option value="">— بدون فایل —</option>${docs.map((f) => `<option value="${f.id}" ${f.document_type === "contract" ? "selected" : ""}>${esc(FILE_TYPE[f.document_type] || f.document_type)} · ${esc(f.file_name || "")} · ${jdate(f.uploaded_at)}</option>`).join("")}</select>
          <div class="hint">اگر اسکن را هنوز بارگذاری نکرده‌اید، اول از «فایل‌های قرارداد ← + پیوست» با نوع «قرارداد امضاشده» بارگذاری کنید.</div>`}
      <div class="actions"><button class="btn ok" data-act="save">ثبت</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const docSel = el.querySelector('[data-field="doc"]'), note = el.querySelector('[data-field="note"]');
        await rpc("record_contract_signature", { p_contract_id: id, p_step: stepName, p_date: readDate(el, "sgd"),
          p_note: note ? note.value.trim() || null : null, p_doc_id: docSel && docSel.value ? Number(docSel.value) : null });
        close(); toast(stepName === "sent" ? "ارسال ثبت شد" : "عودت قرارداد ثبت شد"); route();
      }));
    });
  }

  /* item 13 (D-90): insurance policy per elevator; history follows the subscription code across renewals */
  async function insuranceSection(contractId) {
    const elev = await api(`elevators?contract_id=eq.${contractId}&is_active=eq.true&select=id,elevator_no,subscription_code&order=elevator_no`);
    if (!elev.length) return "";
    const subs = elev.map((e) => e.subscription_code).filter(Boolean);
    const list = subs.length ? await api(`elevator_insurances?subscription_code=in.(${subs.map((x) => `"${encodeURIComponent(x)}"`).join(",")})&select=id,elevator_id,subscription_code,insurer,policy_number,start_date,end_date,amount_rial,invoice_id,notes,invoices(document_number,status)&order=end_date.desc`) : [];
    const today = todayTehran();
    const card = (e) => {
      const mine = list.filter((x) => x.subscription_code === e.subscription_code), last = mine[0];
      const left = last ? Math.round((new Date(last.end_date) - new Date(today)) / 86400000) : null;
      const state = !last ? `<span class="badge">بیمه ثبت نشده</span>` : left < 0 ? `<span class="badge danger">منقضی</span>` : left <= 30 ? `<span class="badge warn">${fa(left)} روز مانده</span>` : `<span class="badge ok">معتبر</span>`;
      return `<div class="card"><div class="item-head"><div><div class="item-title">دستگاه ${fa(e.elevator_no || 1)}${e.subscription_code ? " · اشتراک " + esc(fa(e.subscription_code)) : ""}</div></div>${state}</div>
        ${mine.map((x) => `<div class="row" style="padding:6px 0;border-top:1px solid var(--line)"><div class="spacer"><div>${esc(x.insurer)}${x.policy_number ? ` · <bdi dir="ltr">${esc(fa(x.policy_number))}</bdi>` : ""}</div>
          <div class="small muted">${jdate(x.start_date)} تا ${jdate(x.end_date)}${x.amount_rial ? " · " + num(tom(x.amount_rial)) + " تومان" : ""}${x.invoice_id && x.invoices && x.invoices.status !== "cancelled" ? ` · فاکتور <a href="#/doc/${x.invoice_id}"><bdi dir="ltr">${esc(fa(x.invoices.document_number || ""))}</bdi></a>` : ""}</div></div>
          ${can.changeContract() ? `<button class="btn secondary small" data-act="ins-edit" data-id="${x.id}" data-c="${contractId}">ویرایش</button>` : ""}</div>`).join("")}
        ${can.changeContract() ? `<div class="actions"><button class="btn secondary small" data-act="ins-new" data-e="${e.id}" data-c="${contractId}" data-last="${last ? last.id : ""}">+ بیمه‌نامه${last ? " (تمدید)" : ""}</button></div>` : ""}</div>`;
    };
    return `<div class="section-title"><h2>بیمه‌نامه‌ها</h2></div>${elev.map(card).join("")}`;
  }
  async function sheetInsurance({ elevatorId, contractId, id, fromId }) {
    const [cur] = id ? await api(`elevator_insurances?id=eq.${id}&select=*,invoices(status,document_number)`) : [null];
    const [prev] = !id && fromId ? await api(`elevator_insurances?id=eq.${fromId}&select=insurer,end_date,amount_rial`) : [null];
    const hasInv = cur && cur.invoice_id && cur.invoices && cur.invoices.status !== "cancelled";
    const addDay = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const start = cur ? cur.start_date : prev ? addDay(prev.end_date, 1) : todayTehran();
    const yearLater = (d) => { const [y, m, dd] = d.split("-").map(Number), j = g2j(y, m, dd), g = j2g(j.jy + 1, j.jm, Math.min(j.jd, j.jm <= 6 ? 31 : 30)); return addDay(`${g.gy}-${pad(g.gm)}-${pad(g.gd)}`, -1); };
    const end = cur ? cur.end_date : yearLater(start);
    sheet(`<h3>${cur ? "ویرایش بیمه‌نامه" : "ثبت بیمه‌نامه"}</h3>
      <label>بیمه‌گر</label><input type="text" data-field="insurer" value="${esc(cur ? cur.insurer : prev ? prev.insurer : "")}" placeholder="نام شرکت بیمه">
      <label>شماره بیمه‌نامه</label><input type="text" data-field="pno" class="ltr" value="${esc(cur && cur.policy_number || "")}">
      <label>شروع</label>${datePickerHtml("istart", start)}<label>پایان</label>${datePickerHtml("iend", end)}
      ${amountFieldHtml("iamt", "مبلغ بیمه برای مشترک (ارزش افزوده اضافه نمی‌شود)")}
      ${hasInv ? `<div class="hint">فاکتور <bdi dir="ltr">${esc(fa(cur.invoices.document_number || ""))}</bdi> صادر شده؛ برای تغییر مبلغ اول فاکتور را ابطال کنید.</div>` : `<label class="check"><input type="checkbox" data-field="issue" ${cur ? "" : "checked"}> صدور فاکتور بیمه برای مشترک</label>`}
      <label>توضیحات</label><input type="text" data-field="notes" value="${esc(cur && cur.notes || "")}">
      <div class="actions"><button class="btn ok" data-act="save">ذخیره</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      bindAmount(el, "iamt");
      const amt0 = cur ? cur.amount_rial : prev ? prev.amount_rial : null;
      if (amt0) { const inp = el.querySelector('[data-amount="iamt"]'); inp.value = String(Math.round(amt0 / 10)); inp.dispatchEvent(new Event("input")); }
      if (hasInv) el.querySelector('[data-amount="iamt"]').disabled = true;
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const a = readAmount(el, "iamt"), issue = !hasInv && el.querySelector('[data-field="issue"]').checked;
        const rial = hasInv ? cur.amount_rial : (a.value ? a.rial : null);
        if (issue && !rial) throw new Error("برای صدور فاکتور مبلغ را وارد کنید");
        if (issue && !confirm(`فاکتور بیمه به مبلغ ${num(Math.round(rial / 10))} تومان برای مشترک صادر شود؟`)) return;
        const r = await rpc("save_insurance", { p_id: id || null, p: { elevator_id: elevatorId, insurer: el.querySelector('[data-field="insurer"]').value.trim(),
          policy_number: toEn(el.querySelector('[data-field="pno"]').value.trim()), start_date: readDate(el, "istart"), end_date: readDate(el, "iend"),
          amount_rial: rial, notes: el.querySelector('[data-field="notes"]').value.trim(), issue_invoice: issue } });
        close();
        if (r.invoice_id) { toast("بیمه‌نامه ثبت و فاکتور صادر شد"); payOffer = r.invoice_id; location.hash = `#/doc/${r.invoice_id}`; }
        else { toast("بیمه‌نامه ذخیره شد"); route(); }
      }));
    });
  }

  async function sheetPayment(contractId, preInvoiceId, preRial) {
    const invoices = await api(`invoices?contract_id=eq.${contractId}&status=not.in.(cancelled,draft)&total_rial=gt.0&select=id,document_number,document_type,total_rial,status,issue_date&order=issue_date.desc,id.desc`);
    sheet(`<h3>ثبت دریافت وجه</h3>
      <label>بابت سند</label><select data-field="inv">${invoices.map((i) => `<option value="${i.id}" ${i.id === preInvoiceId ? "selected" : ""}>${esc(fa(i.document_number || "بدون شماره"))} · ${DOC_TYPE[i.document_type] || ""} · ${(INVOICE_STATUS[i.status] || [i.status])[0]}</option>`).join("")}</select>
      <div class="hint">دریافتِ فاکتور تعمیر فقط همان فاکتور را تسویه می‌کند؛ دریافتِ صورتحساب سرویس از قدیمی‌ترین بدهی سرویس کم می‌شود. اضافه پرداخت بستانکار می‌ماند.</div>
      ${amountFieldHtml("amt", "مبلغ دریافتی")}
      <label>تاریخ دریافت</label>${datePickerHtml("pdate")}
      <label>روش پرداخت</label><select data-field="method">${Object.entries(METHOD).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
      <label>شماره پیگیری</label><input type="text" data-field="track" class="ltr">
      <label>توضیحات</label><input type="text" data-field="desc">
      <div class="actions"><button class="btn ok" data-act="save">ثبت دریافت</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      bindAmount(el, "amt");
      if (preRial > 0) { const inp = el.querySelector('[data-amount="amt"]'); inp.value = String(Math.round(preRial / 10)); inp.dispatchEvent(new Event("input")); }
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
    sheet(`<h3>کاربر ساخته شد</h3>
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

  /* ------------------------------------------------------------------ renewals, debts, termination */
  async function contractsList() {
    if (!listCache || Date.now() - listCache.t > 120000) {
      const [l, h] = await Promise.all([api("v_contract_overview?select=*&order=contract_code"), isStaff() ? api("contracts?billing_hold=eq.true&select=id") : Promise.resolve([])]);
      listCache = { t: Date.now(), list: l, held: new Set(h.map((x) => x.id)) };
    }
    return listCache.list;
  }
  // D-67: from the first day of every Jalali month, contracts ending this month or next month (and ended ones not yet renewed)
  function renewalBuckets(list) {
    const t = todayTehran(), [y, m, d] = t.split("-").map(Number), j = g2j(y, m, d);
    const nextJm = j.jm === 12 ? 1 : j.jm + 1, nextJy = j.jm === 12 ? j.jy + 1 : j.jy;
    const iso = (g) => `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
    const endThis = iso(j2g(j.jy, j.jm, jMonthLen(j.jy, j.jm))), endNext = iso(j2g(nextJy, nextJm, jMonthLen(nextJy, nextJm)));
    const renewed = new Set(list.filter((c) => c.previous_contract_id && c.status !== "terminated").map((c) => c.previous_contract_id));
    const open = list.filter((c) => ["active", "expired"].includes(c.status) && c.end_date && !renewed.has(c.id)).sort((a, b) => (a.end_date < b.end_date ? -1 : 1));
    return { jy: j.jy, jm: j.jm, nextJm, nextJy,
      overdue: open.filter((c) => c.end_date < t && c.end_date >= addDays(t, -120)),
      thisMonth: open.filter((c) => c.end_date >= t && c.end_date <= endThis),
      nextMonth: open.filter((c) => c.end_date > endThis && c.end_date <= endNext) };
  }
  async function viewRenewals() {
    const r = renewalBuckets(await contractsList());
    const card = (c) => `<div class="card tap" data-act="open-contract" data-id="${c.id}"><div class="item-head"><div><div class="item-title">${esc(c.building_name || "")}</div>
      <div class="small muted">قرارداد ${esc(fa(c.contract_code))} · پایان ${jdate(c.end_date)}${c.manager_mobile ? ` · <bdi dir="ltr">${esc(fa(c.manager_mobile))}</bdi>` : ""}</div></div>
      <button class="btn secondary small" data-act="renew" data-id="${c.id}">تمدید</button></div></div>`;
    const sec = (title, l, cls) => l.length ? `<div class="section-title"><h2 class="${cls || ""}">${title} (${fa(l.length)})</h2></div>${l.map(card).join("")}` : "";
    const none = !r.overdue.length && !r.thisMonth.length && !r.nextMonth.length;
    return shell("تمدید قراردادها", "more", `<a href="#/more" data-act="back" class="small">→ بازگشت</a>
      <div class="card" style="margin-top:8px"><div class="small">فهرست هر ماه از روز اول همان ماه: قراردادهایی که در ${MONTHS[r.jm - 1]} یا ${MONTHS[r.nextJm - 1]} تمام می‌شوند و هنوز تمدید نشده‌اند.</div></div>
      ${sec("تمام‌شده و تمدیدنشده", r.overdue, "debt")}${sec(`پایان در ${MONTHS[r.jm - 1]} ${fa(r.jy)}`, r.thisMonth)}${sec(`پایان در ${MONTHS[r.nextJm - 1]} ${fa(r.nextJy)}`, r.nextMonth)}
      ${none ? `<div class="card empty">قراردادی در این دو ماه تمام نمی‌شود</div>` : ""}`);
  }
  let debtTab = "debtors";
  async function viewDebts() {
    const tabs = `<div class="chips"><button data-act="debt-tab" data-k="debtors" class="${debtTab !== "docs" ? "on" : ""}">بدهکاران</button><button data-act="debt-tab" data-k="docs" class="${debtTab === "docs" ? "on" : ""}">اسناد پرداخت‌نشده</button></div>`;
    let body;
    if (debtTab === "docs") {
      const docs = await api("invoices?status=in.(issued,partially_paid)&document_type=neq.opening_balance&select=id,document_type,document_number,issue_date,total_rial,status,contract_id,contracts(contract_code,buildings(name))&order=issue_date.asc,id.asc");
      body = docs.length ? docs.map((i) => { const c = i.contracts || {}; return `<div class="card"><div class="item-head"><div class="tap spacer" data-act="open-contract" data-id="${i.contract_id}"><div class="item-title">${esc(c.buildings ? c.buildings.name : "")}</div>
        <div class="small muted">قرارداد ${esc(fa(c.contract_code || ""))} · ${DOC_TYPE[i.document_type] || i.document_type} <bdi dir="ltr">${esc(fa(i.document_number || ""))}</bdi> · ${jdate(i.issue_date)}</div></div>
        <div style="text-align:left">${money(i.total_rial)}${badge(INVOICE_STATUS, i.status)}</div></div>
        <div class="actions"><a class="btn secondary small" href="#/doc/${i.id}">مشاهده و ارسال</a></div></div>`; }).join("") : `<div class="card empty">سند پرداخت‌نشده‌ای نیست</div>`;
    } else {
      const rows = (await rpc("report_debtors", { p_date: todayTehran() })).filter((r) => Number(r.balance_rial) > 0).sort((a, b) => b.balance_rial - a.balance_rial);
      const total = rows.reduce((a, r) => a + Number(r.balance_rial), 0);
      body = `<div class="stats"><div class="stat wide money-stat"><div class="label">جمع بدهی ${fa(rows.length)} مشترک</div><div class="value">${money(total)}</div></div></div>` +
        (rows.length ? rows.map((r) => `<div class="card"><div class="item-head"><div class="tap spacer" data-act="open-contract" data-id="${r.contract_id}"><div class="item-title">${esc(r.building_name || "")}</div>
        <div class="small muted">قرارداد ${esc(fa(r.contract_code))} · ${esc(r.manager_name || r.customer_name || "")}${r.open_docs ? ` · ${fa(r.open_docs)} سند باز از ${jdate(r.oldest_open_date)}` : ""}</div></div>
        <div style="text-align:left">${money(r.balance_rial, { cls: "debt" })}</div></div>
        ${r.manager_mobile ? `<div class="actions"><a class="btn secondary small" href="tel:${esc(r.manager_mobile)}">تماس <bdi dir="ltr">${esc(fa(r.manager_mobile))}</bdi></a></div>` : ""}</div>`).join("") : `<div class="card empty">بدهکاری نیست</div>`);
    }
    return shell("بدهکاران و اسناد پرداخت‌نشده", "more", `<a href="#/more" data-act="back" class="small">→ بازگشت</a><div style="height:8px"></div>${tabs}${body}`);
  }
  async function sheetTerminate(id) {
    const [c] = await api(`v_contract_overview?id=eq.${id}&select=id,contract_code,building_name,start_date,end_date`);
    sheet(`<h3>فسخ قرارداد ${esc(fa(c.contract_code))}</h3>
      <div class="small muted">${esc(c.building_name || "")} · ${jdate(c.start_date)} تا ${jdate(c.end_date)}</div>
      <label>تاریخ فسخ</label>${datePickerHtml("tdate")}
      <label>دلیل فسخ</label><textarea data-field="reason" placeholder="مثلاً: درخواست کارفرما / عدم پرداخت"></textarea>
      <div class="error-box" style="margin:10px 0">با فسخ، قرارداد به بایگانی می‌رود، پایان آن همان تاریخ فسخ می‌شود، ارجاع‌های بعد از آن لغو می‌شوند و از ماه‌های بعد صورتحساب صادر نمی‌شود. مانده‌ی حساب و اسناد قبلی سر جای خود می‌مانند. این کار برگشت‌پذیر نیست.</div>
      <div class="actions"><button class="btn danger" data-act="save">فسخ قرارداد</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const reason = el.querySelector('[data-field="reason"]').value.trim();
        if (!reason) throw new Error("دلیل فسخ را بنویسید");
        const dt = readDate(el, "tdate");
        if (!confirm(`قرارداد ${fa(c.contract_code)} از تاریخ ${jdate(dt)} فسخ شود؟`)) return;
        await rpc("terminate_contract", { p_id: id, p_date: dt, p_reason: reason });
        close(); toast("قرارداد فسخ شد"); route();
      }));
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
      <a href="#/more" data-act="back" class="small">→ بازگشت</a>
      <div class="card" style="margin-top:8px"><div class="small">مانده‌ی هر مشترک تا پایان ۳۰ مهر ۱۴۰۵. از آبان ۱۴۰۵ صورتحساب‌ها را سیستم صادر می‌کند.</div>
        <div class="small muted">این سند داخلی است و شماره نمی‌گیرد؛ ثبت‌کننده و تأییدکننده ذخیره می‌شود.</div></div>
      <div class="stats" style="margin-top:10px">
        <div class="stat warn"><div class="label">پیش‌نویس منتظر تأیید</div><div class="value">${num(drafts.length)}</div></div>
        <div class="stat"><div class="label">تأییدشده</div><div class="value">${num(posted.length)}</div></div>
        <div class="stat ${missing.length ? "danger" : ""}"><div class="label">قرارداد بدون مانده افتتاحیه</div><div class="value">${num(missing.length)}</div></div>
        <div class="stat"><div class="label">جمع پیش‌نویس‌ها</div><div class="value" style="font-size:15px">${money(Math.abs(sum(drafts)))}${balanceBadge(sum(drafts))}</div></div></div>
      ${drafts.length ? `<div class="section-title"><h2>پیش‌نویس‌ها</h2><button class="btn ok small" data-act="post-all-opening" data-n="${drafts.length}">تأیید همه</button></div>${drafts.map(row).join("")}` : ""}
      ${missing.length ? `<div class="section-title"><h2>بدون مانده افتتاحیه</h2></div><div class="hint">برای حساب‌های تسویه‌شده «تسویه» را بزنید؛ برای مانده‌ی بدهکار یا بستانکار روی قرارداد بزنید.</div>${missing.map((c) => `<div class="card"><div class="item-head"><div class="tap spacer" data-act="open-contract" data-id="${c.id}"><div class="item-title">${esc(c.building_name || "")}</div><div class="small muted">قرارداد ${esc(fa(c.contract_code))}</div></div>
        <div class="row"><button class="btn ok small" data-act="opening-zero" data-id="${c.id}" data-code="${esc(fa(c.contract_code))}">تسویه</button><button class="btn secondary small" data-act="opening" data-id="${c.id}">مبلغ</button></div></div></div>`).join("")}` : ""}
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
    const miss = await rpc("contract_missing_fields", { p_contract_id: contractId }).catch(() => []);
    sheet(`<h3>تمدید قرارداد ${esc(fa(c.contract_code))}</h3>
      <div class="small muted">${esc(c.building_name || "")}</div>
      ${miss && miss.length ? `<div class="error-box" style="margin:8px 0">اطلاعات ناقص: ${miss.map(esc).join("، ")}${role() === "CEO" ? "<div class=\"small\">شما می‌توانید با اطلاعات ناقص تمدید کنید؛ بعد از «ویرایش اطلاعات» کامل کنید.</div>" : "<div class=\"small\">تا این‌ها از «ویرایش اطلاعات» وارد نشود، تمدید ثبت نمی‌شود.</div>"}</div>` : ""}
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
      // the suggested code follows the chosen start year: <subscription>/<Jalali year of the new start>
      const codeIn = el.querySelector('[data-field="code"]');
      const autoCode = () => { const [y, mo, d] = readDate(el, "start").split("-").map(Number); return `${c.subscription_code}/${g2j(y, mo, d).jy}`; };
      const syncCode = () => { codeIn.placeholder = autoCode(); };
      el.querySelector('[data-date="start"]').addEventListener("change", syncCode); syncCode();
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const m = readAmount(el, "monthly"), dd = readAmount(el, "ded");
        const newCode = toEn(codeIn.value.trim()) || autoCode();
        const dup = await api(`contracts?contract_code=eq.${encodeURIComponent(newCode)}&select=id,contract_code`);
        if (dup.length) throw new Error(`کد قرارداد «${fa(newCode)}» قبلاً برای قرارداد دیگری ثبت شده است. کد دیگری بنویسید${codeIn.value.trim() ? ` یا خانه را خالی بگذارید تا «${fa(autoCode())}» شود` : ""}.`);
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
  const FIELD_LABEL = { postal_code: "کد پستی", cooperation_year: "سال‌های همکاری (تعداد سال)", subscription_code: "کد اشتراک", contract_code: "کد قرارداد", start_date: "تاریخ شروع", end_date: "تاریخ پایان", monthly_amount_rial: "مبلغ ماهانه (ریال)", missed_service_deduction_rial: "کسر سرویس انجام‌نشده (ریال)", services_per_month: "سرویس در ماه", manager_name: "مدیر ساختمان", manager_mobile: "موبایل مدیر", address: "نشانی", name: "نام", mobile: "موبایل", national_id: "کد/شناسه ملی", notes: "توضیحات",
    stops: "توقف", capacity_persons: "ظرفیت", motor_type: "موتور", cabin_door_type: "درب کابین", landing_door_type: "درب طبقات", controller_brand: "تابلو فرمان", usage_type: "نوع کاربری", traffic: "میزان ترافیک" };
  // suggestions only; any text can be typed
  const SPEC_LIST = { usage_type: ["مسکونی", "اداری", "تجاری", "درمانی", "هتل", "آموزشی"], traffic: ["کم", "متوسط", "زیاد"] };
  const specDatalists = () => Object.entries(SPEC_LIST).map(([k, l]) => `<datalist id="dl-${k}">${l.map((x) => `<option value="${x}">`).join("")}</datalist>`).join("");
  const ymText = (ym) => `${MONTHS[ym % 100 - 1]} ${fa(Math.floor(ym / 100))}`;
  function changeSummary(k) {
    const p = k.payload || {};
    if (k.kind === "amendment") return `از ${ymText(p.effective_ym)}: ماهانه ${num(Math.round(p.monthly_amount_rial / 10))} تومان، کسر ${num(Math.round(p.missed_service_deduction_rial / 10))} تومان، ${fa(p.services_per_month)} سرویس در ماه${p.end_date ? `، پایان ${jdate(p.end_date)}` : ""}${p.description ? ` — ${esc(p.description)}` : ""}`;
    if (k.kind === "renewal") return `${jdate(p.start_date)} تا ${jdate(p.end_date)}: ماهانه ${num(Math.round(p.monthly_amount_rial / 10))} تومان، کسر ${num(Math.round(p.missed_service_deduction_rial / 10))} تومان، ${fa(p.services_per_month)} سرویس در ماه`;
    const parts = [];
    ["building", "customer", "contract"].forEach((g) => Object.entries(p[g] || {}).forEach(([f, v]) => parts.push(`${FIELD_LABEL[f] || f}: ${esc(v || "—")}`)));
    (p.new_elevators || []).forEach((e) => parts.push(`دستگاه جدید: کد اشتراک ${esc(fa(e.subscription_code || "—"))}${e.stops ? "، " + fa(e.stops) + " توقف" : ""}`));
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
    const list = await api("contract_change_requests?status=eq.pending&select=id,kind,payload,status,document_number,requested_at,decision_note,contract_id,contracts!contract_change_requests_contract_id_fkey(contract_code,buildings(name))&order=id");
    return shell("درخواست‌های تغییر قرارداد", "more", `<a href="#/more" data-act="back" class="small">→ بازگشت</a><div style="height:8px"></div>
      ${list.length ? list.map((k) => `<div class="small muted" style="margin-top:6px"><a href="#/contract/${k.contract_id}">قرارداد ${esc(fa(k.contracts ? k.contracts.contract_code : ""))} · ${esc(k.contracts && k.contracts.buildings ? k.contracts.buildings.name : "")}</a></div>${changeCard(k)}`).join("") : `<div class="card empty">درخواستی منتظر تأیید نیست</div>`}`);
  }

  async function sheetEditContract(contractId) {
    const [c] = await api(`contracts?id=eq.${contractId}&select=id,contract_code,notes,cooperation_year,start_date,end_date,monthly_amount_rial,missed_service_deduction_rial,services_per_month,buildings(name,postal_code,manager_name,manager_mobile,address),customers(name,mobile,national_id,address)`);
    const ceo = role() === "CEO";
    const ceoFix = ceo ? `<div class="section-title"><h2>اصلاح قرارداد (فقط مدیرعامل)</h2></div>
      <div class="hint">برای اصلاح اشتباه ورود اطلاعات. تاریخ شروع و مبالغ فقط تا وقتی قابل اصلاح است که صورتحسابی برای این قرارداد صادر نشده باشد؛ بعد از آن با «الحاقیه».</div>
      <label>کد قرارداد</label><input type="text" data-cf="contract_code" data-old="${esc(c.contract_code)}" value="${esc(c.contract_code)}" class="ltr">
      <label>تاریخ شروع</label>${datePickerHtml("fix-start", c.start_date)}
      <label>تاریخ پایان</label>${datePickerHtml("fix-end", c.end_date)}
      <label>مبلغ ماهانه (ریال)</label><input type="text" inputmode="numeric" class="ltr" data-cf="monthly_amount_rial" data-old="${c.monthly_amount_rial}" value="${c.monthly_amount_rial}">
      <label>کسر سرویس انجام‌نشده (ریال)</label><input type="text" inputmode="numeric" class="ltr" data-cf="missed_service_deduction_rial" data-old="${c.missed_service_deduction_rial}" value="${c.missed_service_deduction_rial}">
      <label>تعداد سرویس در ماه</label><input type="text" inputmode="numeric" class="ltr" data-cf="services_per_month" data-old="${c.services_per_month}" value="${c.services_per_month}">
      <div class="hint" data-field="fix-preview"></div>` : "";
    const elev = await api(`elevators?contract_id=eq.${contractId}&select=id,elevator_no,subscription_code,stops,capacity_persons,usage_type,traffic,motor_type,cabin_door_type,landing_door_type,controller_brand,notes&order=elevator_no`);
    const b = c.buildings || {}, cu = c.customers || {};
    const inp = (grp, f, v, ltr) => `<label>${FIELD_LABEL[f]}</label><input type="text" data-g="${grp}" data-f="${f}" data-old="${esc(v ?? "")}" value="${esc(v ?? "")}" ${ltr ? 'class="ltr" inputmode="tel"' : ""}>`;
    sheet(`<h3>ویرایش اطلاعات قرارداد ${esc(fa(c.contract_code))}</h3>
      <div class="hint">${ceo ? "تغییر شرایط مالی از ماه مشخص به بعد با «الحاقیه» است؛ اصلاح اشتباه ورود در بخش «اصلاح قرارداد»." : "شرایط مالی اینجا تغییر نمی‌کند؛ برای آن «الحاقیه» ثبت کنید. تغییرات بعد از تأیید مدیرعامل اعمال می‌شود."}</div>
      ${ceoFix}
      <div class="section-title"><h2>ساختمان</h2></div><label>نام ساختمان</label><input type="text" data-g="building" data-f="name" data-old="${esc(b.name ?? "")}" value="${esc(b.name ?? "")}">${inp("building", "postal_code", b.postal_code, true)}${inp("building", "manager_name", b.manager_name)}${inp("building", "manager_mobile", b.manager_mobile, true)}${inp("building", "address", b.address)}
      <div class="section-title"><h2>کارفرما</h2></div>${inp("customer", "name", cu.name)}${inp("customer", "mobile", cu.mobile, true)}${inp("customer", "national_id", cu.national_id, true)}${inp("customer", "address", cu.address)}
      ${elev.map((e) => `<div class="section-title"><h2>دستگاه ${fa(e.elevator_no)}${e.subscription_code ? ` · کد ${esc(fa(e.subscription_code))}` : ""}</h2></div>
        <div data-elev="${e.id}" data-no="${e.elevator_no}">${["usage_type", "traffic", "stops", "capacity_persons", "motor_type", "cabin_door_type", "landing_door_type", "controller_brand", "notes"].map((f) => `<label>${FIELD_LABEL[f]}</label><input type="text" data-ef="${f}" data-old="${esc(e[f] ?? "")}" value="${esc(e[f] ?? "")}"${SPEC_LIST[f] ? ` list="dl-${f}"` : ""}>`).join("")}</div>`).join("")}${specDatalists()}
      <div class="section-title"><h2>دستگاه جدید</h2></div><div data-field="newelev"></div>
      <button type="button" class="btn secondary small" data-act="add-elev">+ افزودن دستگاه به این قرارداد</button>
      <div class="section-title"><h2>قرارداد</h2></div>${inp("contract", "cooperation_year", c.cooperation_year, true)}${inp("contract", "notes", c.notes)}
      <div class="actions"><button class="btn" data-act="save">${role() === "CEO" ? "ذخیره" : "ارسال برای تأیید"}</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      el.querySelector('[data-act="add-elev"]').addEventListener("click", () => {
        const box = document.createElement("div"); box.setAttribute("data-newelev", "1"); box.className = "card";
        box.innerHTML = `<label>کد اشتراک دستگاه جدید</label><input type="text" class="ltr" data-nf="subscription_code" inputmode="numeric">
          <label>تعداد توقف</label><input type="text" class="ltr" data-nf="stops" inputmode="numeric"><label>ظرفیت (نفر)</label><input type="text" class="ltr" data-nf="capacity_persons" inputmode="numeric">`;
        el.querySelector('[data-field="newelev"]').appendChild(box); box.querySelector("input").focus();
      });
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
        const ne = [...el.querySelectorAll("[data-newelev]")].map((box) => ({ subscription_code: toEn(box.querySelector("[data-nf=subscription_code]").value.trim()),
          stops: toEn(box.querySelector("[data-nf=stops]").value.trim()), capacity_persons: toEn(box.querySelector("[data-nf=capacity_persons]").value.trim()) }))
          .filter((x) => x.subscription_code || x.stops);
        if (ne.some((x) => !x.subscription_code)) throw new Error("کد اشتراک دستگاه جدید را وارد کنید");
        if (ne.length) payload.new_elevators = ne;
        if (ceo) {
          const fix = {};
          el.querySelectorAll("input[data-cf]").forEach((i) => { const v = toEn(i.value.trim()).replace(/[,٬\s]/g, ""); if (v !== toEn(i.dataset.old)) fix[i.dataset.cf] = v; });
          ["monthly_amount_rial", "missed_service_deduction_rial", "services_per_month"].forEach((k) => { if (k in fix && !/^\d+$/.test(fix[k])) throw new Error("مبلغ‌ها و تعداد سرویس باید عدد باشند"); });
          const st = readDate(el, "fix-start"), en = readDate(el, "fix-end");
          if (c.start_date && st !== c.start_date) fix.start_date = st;
          if (c.end_date && en !== c.end_date) fix.end_date = en;
          if (en < st) throw new Error("تاریخ پایان باید بعد از شروع باشد");
          if (Object.keys(fix).length) {
            payload.contract = { ...(payload.contract || {}), ...fix };
            const parts = [];
            if (fix.start_date || fix.end_date) parts.push(`تاریخ: ${jdate(st)} تا ${jdate(en)}`);
            if (fix.monthly_amount_rial) parts.push(`ماهانه: ${num(Math.round(fix.monthly_amount_rial / 10))} تومان`);
            if (fix.missed_service_deduction_rial) parts.push(`کسر: ${num(Math.round(fix.missed_service_deduction_rial / 10))} تومان`);
            if (fix.services_per_month) parts.push(`سرویس در ماه: ${fa(fix.services_per_month)}`);
            if (fix.contract_code) parts.push(`کد: ${fa(fix.contract_code)}`);
            if (!confirm("اصلاح قرارداد ثبت شود؟\n" + parts.join("\n"))) return;
          }
        }
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
      return shell("بستن ماه", "more", `<a href="#/more" data-act="back" class="small">→ بازگشت</a>
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
    return shell("بستن ماه", "more", `<a href="#/more" data-act="back" class="small">→ بازگشت</a>
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
  const durFa = (m) => { m = Math.round(Number(m)); if (m < 60) return fa(m) + " دقیقه"; const h = Math.floor(m / 60), r = m % 60;
    if (h < 24) return fa(h) + " ساعت" + (r ? " و " + fa(r) + " دقیقه" : ""); const d = Math.floor(h / 24), hh = h % 24; return fa(d) + " روز" + (hh ? " و " + fa(hh) + " ساعت" : ""); };
  let reportTab = "balance";
  const reportRange = { from: null, to: null };
  let reportData = null;
  async function viewReports() {
    const t = toEn(todayTehran()).split("-").map(Number), tj = g2j(t[0], t[1], t[2]);
    if (!reportRange.from) { const g = j2g(tj.jy, tj.jm, 1); reportRange.from = `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`; reportRange.to = todayTehran(); }
    const tabs = [["balance", "تراز"], ["contracts", "تفکیکی"], ["ops", "گردش کار"], ["debtors", "بدهکاران"], ["receipts", "دریافت‌ها"]];
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
    } else if (reportTab === "contracts") {
      const list = await rpc("report_by_contract", { p_from: reportRange.from, p_to: reportRange.to }); reportData = list;
      const S = (k) => list.reduce((a, x) => a + Number(x[k] || 0), 0);
      body = `<div class="stats"><div class="stat"><div class="label">قرارداد</div><div class="value">${fa(list.length)}</div></div>
          <div class="stat"><div class="label">صورتحساب و فاکتور</div><div class="value" style="font-size:15px">${num(tom(S("statements") + S("repairs") + S("other_net")))}</div></div>
          <div class="stat"><div class="label">دریافت</div><div class="value" style="font-size:15px">${num(tom(S("received")))}</div></div>
          <div class="stat danger"><div class="label">مانده پایان دوره</div><div class="value" style="font-size:15px">${num(tom(S("closing")))}</div></div></div>
        <div class="hint">مبالغ به تومان. «اسناد دیگر» = افتتاحیه و سایر اسناد پس از کسر افتتاحیه‌ی بستانکار.</div>
        ${list.map((x) => `<div class="card tap" data-act="open-contract" data-id="${x.contract_id}"><div class="item-head"><div><div class="item-title">${esc(x.building_name || "")}</div>
          <div class="small muted">قرارداد ${esc(fa(x.contract_code))}${x.subscription_code ? " · اشتراک " + esc(fa(x.subscription_code)) : ""}${x.status !== "active" ? " · " + esc((CONTRACT_STATUS[x.status] || [x.status])[0]) : ""}</div></div>
          <div style="text-align:left">${money(Math.abs(x.closing), { cls: x.closing > 0 ? "debt" : x.closing < 0 ? "credit" : "" })}</div></div>
          <div class="small" style="margin-top:4px">ابتدای دوره ${num(tom(x.opening))} · سرویس ${num(tom(x.statements))}${Number(x.repairs) ? " · تعمیر " + num(tom(x.repairs)) : ""}${Number(x.other_net) ? " · اسناد دیگر " + num(tom(x.other_net)) : ""} · دریافت ${num(tom(x.received))}${Number(x.cancelled) ? " · ابطال " + num(tom(x.cancelled)) : ""}${Number(x.transfer_net) ? " · انتقال " + num(tom(x.transfer_net)) : ""}</div>
          <div class="small muted">سرویس انجام‌شده ${fa(x.services_done)} · انجام‌نشده ${fa(x.services_missed)} · خرابی ${fa(x.faults)}</div></div>`).join("") || `<div class="card empty">در این بازه چیزی نیست</div>`}`;
    } else if (reportTab === "ops") {
      const o = await rpc("report_operations", { p_from: reportRange.from, p_to: reportRange.to }); reportData = o;
      const sv = o.services.by_status || {}, fl = o.faults, dc = o.docs;
      const svDone = (sv.confirmed || 0) + (sv.completed || 0);
      const line = (label, v) => `<tr><td>${label}</td><td style="text-align:left">${v}</td></tr>`;
      body = `<div class="section-title"><h2>سرویس دوره‌ای</h2></div>
        <div class="card"><table class="list"><tbody>
          ${line("قرارداد فعال در بازه", fa(o.services.active_contracts))}
          ${line("ارجاع برنامه‌ریزی‌شده", fa(o.services.planned))}
          ${line("انجام و تأییدشده", fa(svDone))}
          ${line("منتظر تأیید", fa(sv.pending_confirmation || 0))}
          ${line("انجام‌نشده", fa(sv.missed || 0))}
          ${sv.rejected ? line("ردشده", fa(sv.rejected)) : ""}</tbody></table></div>
        <div class="section-title"><h2>خرابی و تعمیر</h2></div>
        <div class="card"><table class="list"><tbody>
          ${line("خرابی ثبت‌شده", fa(fl.count))}
          ${Object.entries(fl.by_priority || {}).map(([k, v]) => line("— " + ((PRIORITY[k] || [k])[0]), fa(v))).join("")}
          ${line("رفع‌شده یا بسته", fa((fl.by_status.repaired || 0) + (fl.by_status.closed || 0)))}
          ${line("میانگین اعلام تا ارجاع به تکنسین", fl.avg_notify_min == null ? "—" : durFa(fl.avg_notify_min))}
          ${line("میانگین اعلام تا رفع", fl.avg_repair_min == null ? "—" : durFa(fl.avg_repair_min))}
          ${line("خرابی باز (همین حالا)", fa(fl.open_now))}</tbody></table></div>
        <div class="section-title"><h2>اسناد و دریافت</h2></div>
        <div class="card"><table class="list"><tbody>
          ${line("پیش‌فاکتور صادرشده", fa(dc.proformas) + " · تأییدشده " + fa(dc.proformas_approved) + " · " + num(tom(dc.proformas_total)))}
          ${line("فاکتور تعمیر", fa(dc.repair_invoices) + " · " + num(tom(dc.repair_total)))}
          ${line("صورتحساب سرویس", fa(dc.statements) + " · " + num(tom(dc.statements_total)))}
          ${line("دریافت وجه", num(tom(dc.received)))}</tbody></table><div class="hint">مبالغ به تومان</div></div>
        ${o.technicians.length ? `<div class="section-title"><h2>عملکرد سرویس‌کارها</h2></div><div class="card"><table class="list"><tbody>
          ${o.technicians.map((t) => line(esc(t.name), "سرویس " + fa(t.services) + " · خرابی " + fa(t.faults) + " · رفع " + fa(t.repaired))).join("")}</tbody></table></div>` : ""}
        <div class="hint">خروجی اکسل این بخش، فهرست کامل خرابی‌ها با زمان اعلام، ارجاع و رفع است.</div>`;
    } else {
      const list = await rpc("report_receipts", { p_from: reportRange.from, p_to: reportRange.to }); reportData = list;
      const total = list.reduce((a, x) => a + Number(x.amount_rial), 0);
      body = `<div class="stats"><div class="stat wide"><div class="label">جمع دریافت‌های واقعی (${fa(list.length)} مورد)</div><div class="value">${money(total)}</div></div></div>
        ${list.length ? `<div class="card"><table class="list"><tbody>${list.map((x) => `<tr><td>${esc(x.building_name || "")}<div class="small muted">${jdate(x.payment_date)} · قرارداد ${esc(fa(x.contract_code || ""))} · ${esc(METHOD_ALL[x.method] || x.method)}${x.tracking_number ? " · پیگیری " + esc(fa(x.tracking_number)) : ""}</div></td>
          <td style="text-align:left;white-space:nowrap">${num(tom(x.amount_rial))}</td></tr>`).join("")}</tbody></table><div class="hint">مبالغ به تومان</div></div>` : `<div class="card empty">در این بازه دریافتی ثبت نشده</div>`}`;
    }
    return shell("گزارش‌های مالی", "more", `<a href="#/more" data-act="back" class="small">→ بازگشت</a>
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
    } else if (reportTab === "contracts") {
      downloadCsv(`tafkiki-${f}-${t}.csv`, ["کد قرارداد", "کد اشتراک", "ساختمان", "کارفرما", "وضعیت", "مانده ابتدای دوره", "صورتحساب سرویس", "فاکتور تعمیر", "اسناد دیگر", "دریافت", "ابطال", "انتقال مانده", "مانده پایان دوره", "سرویس انجام‌شده", "سرویس انجام‌نشده", "خرابی"],
        d.map((x) => [x.contract_code, x.subscription_code, x.building_name, x.customer_name, (CONTRACT_STATUS[x.status] || [x.status])[0], tom(x.opening), tom(x.statements), tom(x.repairs), tom(x.other_net), tom(x.received), tom(x.cancelled), tom(x.transfer_net), tom(x.closing), x.services_done, x.services_missed, x.faults]));
    } else if (reportTab === "ops") {
      const tm = (v) => v ? toEn(jdate(v)) + " " + new Date(v).toLocaleTimeString("en-GB", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit" }) : "";
      const mins = (a, b) => a && b ? Math.round((new Date(b) - new Date(a)) / 60000) : "";
      downloadCsv(`gardesh-kar-${f}-${t}.csv`, ["شماره خرابی", "ساختمان", "کد قرارداد", "اولویت", "وضعیت", "تکنسین", "زمان اعلام", "زمان ارجاع", "زمان رفع", "اعلام تا ارجاع (دقیقه)", "اعلام تا رفع (دقیقه)", "شرح خرابی", "شرح رفع"],
        (d.faults.list || []).map((x) => [x.number, x.building, x.contract, (PRIORITY[x.priority] || [x.priority])[0], (FAULT_STATUS[x.status] || [x.status])[0], x.technician, tm(x.reported_at), tm(x.notified_at), tm(x.repaired_at), mins(x.reported_at, x.notified_at), mins(x.reported_at, x.repaired_at), x.description, x.repair]));
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
    return shell("سرویس‌کارها و تعمیرکارها", "more", `<a href="#/more" data-act="back" class="small">→ بازگشت</a>
      <div class="page-actions"><button class="btn" data-act="new-tech">+ سرویس‌کار / تعمیرکار جدید</button></div>
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
      acts.push(`<button class="btn secondary small" data-act="assignment-note" data-id="${a.id}" data-note="${esc(a.note || "")}">${a.note ? "ویرایش کار اضافه" : "+ کار اضافه"}</button>`);
      acts.push(`<button class="btn secondary small" data-act="cancel-assignment" data-id="${a.id}">لغو ارجاع</button>`);
    }
    const st = a.status === "done" ? `<span class="badge ok">ثبت شد</span>` : a.status === "cancelled" ? `<span class="badge">لغو شده</span>` : late ? `<span class="badge danger">عقب‌افتاده</span>` : `<span class="badge info">${dayLabel(a.planned_date)}</span>`;
    return `<div class="card"><div class="item-head"><div class="with-key"><span class="call-key">${esc(fa(String(a.contract_code).split("-")[0]))}</span><div>
      <div class="item-title">${esc(a.building_name || "")}</div>
      <div class="small muted">${[forTech ? jdate(a.planned_date) : "", esc(a.address || "")].filter(Boolean).join(" · ")}</div></div></div>${st}</div>
      ${a.manager_mobile && forTech ? `<div class="small">مدیر ساختمان: ${esc(a.manager_name || "")} <a href="tel:${esc(toEn(a.manager_mobile))}" class="ltr">${esc(fa(a.manager_mobile))}</a></div>` : ""}
      ${a.note ? `<div class="assign-note"><b>کار اضافه:</b> ${txt(a.note)}</div>` : ""}
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
      <div class="page-actions"><button class="btn" data-act="new-assignment">+ ارجاع سرویس</button>${byTech.size ? `<button class="btn secondary" data-act="plan-print">چاپ برنامه‌ی این روز</button>` : ""}</div>
      <div class="section-title"><h2>${dayLabel(planDate)} · ${fa(rows.filter((a) => a.status !== "cancelled").length)} سرویس</h2></div>
      ${byTech.size ? [...byTech.entries()].map(([t, list]) => `<div class="section-title"><h2 class="small">${esc(t)} (${fa(list.length)})</h2></div>${list.map((a) => assignmentCard(a, false)).join("")}`).join("")
        : `<div class="card empty">برای این روز سرویسی ارجاع نشده است</div>`}`);
  }
  /* D-96: printed daily service plan, one sheet per technician (form PY-FO-PC-G10) */
  async function printPlan(day) {
    const [rows, company] = await Promise.all([rpc("my_assignments", { p_from: day, p_to: day }), rpc("get_company_profile")]);
    const live = rows.filter((a) => a.status !== "cancelled");
    if (!live.length) return toast("برای این روز سرویسی ارجاع نشده است");
    const byTech = new Map(); live.forEach((a) => { const k = a.technician_name || "—"; if (!byTech.has(k)) byTech.set(k, []); byTech.get(k).push(a); });
    const cols = [["ردیف", "8mm"], ["کد", "15mm"], ["ساختمان و نشانی"], ["مدیر ساختمان", "32mm"], ["کار اضافه / توضیح", "62mm"]];
    const cg = `<colgroup>${cols.map(([, w]) => `<col${w ? ` style="width:${w}"` : ""}>`).join("")}</colgroup>`;
    openPrint(`برنامه‌ی سرویس ${jdate(day)}`, (host) => {
      for (const [tech, list] of byTech) {
        const head = `<div class="pp-title"><h1>برنامه‌ی سرویس روزانه</h1><span class="pp-chip">${fa(list.length)} سرویس</span></div><div class="pp-rule"></div>
          ${ppInfo([[["سرویس‌کار", esc(tech)], ["روز", `${new Intl.DateTimeFormat("fa-IR", { weekday: "long", timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"))} ${jdate(day)}`]]])}
          <table class="pp-items pp-plan">${cg}<thead><tr>${cols.map(([h]) => `<th>${h}</th>`).join("")}</tr></thead></table>`;
        const blocks = list.map((a, k) => `<table class="pp-items pp-plan">${cg}<tbody><tr><td class="c">${fa(k + 1)}</td><td class="c"><b>${esc(fa(a.contract_code))}</b></td>
          <td><b>${esc(a.building_name || "")}</b><div class="small">${esc(fa(a.address || ""))}</div></td>
          <td>${esc(a.manager_name || "")}${a.manager_mobile ? `<div><bdi dir="ltr">${esc(fa(a.manager_mobile))}</bdi></div>` : ""}</td>
          <td>${a.note ? txt(a.note) : ""}</td></tr></tbody></table>`);
        paginate(host, { no: "", date: jdate(day), form: "PY-FO-PC-G10", rev: 0, issued: "۱۴۰۵/۰۸/۱۱" }, company, head, blocks, {});
      }
    });
  }
  async function sheetNewAssignment() {
    const techs = (await api("technicians?status=eq.active&select=id,name,skills&order=name")).filter((t) => (t.skills || []).includes("service"));
    const targets = await rpc("service_targets");
    sheet(`<h3>ارجاع سرویس</h3>
      <label>سرویس‌کار</label><select data-field="tech">${techs.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select>
      <label>روز سرویس</label>${datePickerHtml("adate", planDate || addDays(todayTehran(), 1))}
      <label>ساختمان‌ها <span class="small muted" data-field="cnt"></span></label>
      <input type="search" data-field="q" placeholder="جست‌وجوی ساختمان، کد یا آدرس">
      <div class="pick-list" data-field="list">${targets.map((t) => `<div class="pick-wrap" data-s="${esc(toEn(t.building_name + " " + t.contract_code + " " + (t.address || "")))}"><label class="pick"><input type="checkbox" value="${t.contract_id}">
        <span><b>${esc(fa(t.contract_code))}</b> — ${esc(t.building_name)}<br><span class="small muted">${esc(t.address || "")}</span></span></label>
        <input type="text" class="pick-note" data-note="${t.contract_id}" placeholder="کار اضافه برای این کد (اختیاری)" hidden></div>`).join("")}</div>
      <label>توضیح مشترک برای همه‌ی ارجاع‌ها</label><input type="text" data-field="note" placeholder="اختیاری">
      <div class="actions"><button class="btn" data-act="save">ارجاع</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      const cnt = () => { el.querySelector('[data-field="cnt"]').textContent = `(${fa(el.querySelectorAll(".pick input:checked").length)} انتخاب)`; };
      el.querySelector('[data-field="list"]').addEventListener("change", (e) => {
        if (e.target.type === "checkbox") { const n = el.querySelector(`[data-note="${e.target.value}"]`); n.hidden = !e.target.checked; if (e.target.checked) n.focus(); }
        cnt();
      }); cnt();
      el.querySelector('[data-field="q"]').addEventListener("input", (e) => {
        const q = toEn(e.target.value).trim();
        el.querySelectorAll(".pick-wrap").forEach((o) => { o.style.display = !q || o.dataset.s.includes(q) || o.querySelector("input:checked") ? "" : "none"; });
      });
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const ids = [...el.querySelectorAll(".pick input:checked")].map((i) => Number(i.value));
        if (!ids.length) throw new Error("حداقل یک ساختمان انتخاب کنید");
        const day = readDate(el, "adate"), tech = Number(el.querySelector('[data-field="tech"]').value), common = el.querySelector('[data-field="note"]').value.trim();
        const noteFor = (cid) => [el.querySelector(`[data-note="${cid}"]`).value.trim(), common].filter(Boolean).join("\n") || null;
        try {
          await api("service_assignments", { method: "POST", body: ids.map((cid) => ({ contract_id: cid, technician_id: tech, planned_date: day, note: noteFor(cid) })) });
        } catch (er) {
          if (/duplicate|unique|23505/i.test(er.message)) throw new Error("یکی از این ساختمان‌ها برای همین روز قبلاً ارجاع شده است");
          throw er;
        }
        planDate = day; close(); toast(`${fa(ids.length)} سرویس ارجاع شد`); location.hash = "#/plan"; route();
      }));
    });
  }

  function sheetAssignmentNote(id, cur) {
    sheet(`<h3>کار اضافه برای سرویس‌کار</h3>
      <label>توضیح (سرویس‌کار روی کارت همین ارجاع می‌بیند)</label><textarea data-field="note" rows="4" placeholder="مثلاً: روغن‌کاری ریل، بررسی صدای درب طبقه‌ی ۳">${esc(cur)}</textarea>
      <div class="actions"><button class="btn" data-act="save">ذخیره</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        await api(`service_assignments?id=eq.${id}`, { method: "PATCH", body: { note: el.querySelector('[data-field="note"]').value.trim() || null, updated_at: new Date().toISOString() } });
        close(); toast("توضیح ذخیره شد"); route();
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
        const [sr] = await api("service_reports", { method: "POST", prefer: "return=representation", body: { contract_id: Number(sel.value), service_date: readDate(el, "sdate"), technician_id: me.id,
          report_number: toEn(el.querySelector('[data-field="rno"]').value.trim()) || null, report_text: el.querySelector('[data-field="text"]').value.trim() || null,
          status: "pending_confirmation" } });
        if (sr) notifyServiceLink(sr.id);
        close(); toast("سرویس ثبت شد؛ لینک تأیید برای مدیر ساختمان پیامک می‌شود"); route();
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

  const DOC_TITLE = { opening_balance: "صورت‌حساب مانده‌ی حساب", statement: "صورتحساب سرویس و نگهداری", repair_invoice: "فاکتور تعمیرات", insurance_invoice: "فاکتور بیمه‌ی آسانسور", proforma: "پیش‌فاکتور", final_invoice: "فاکتور" };
  const docLink = (token) => `${location.origin}${location.pathname}#/p/${token}`;
  const rial = (n) => `${num(n)}`;
  // bank numbers stay in English digits: some banking apps reject Persian digits when pasted
  const groupCard = (s) => toEn(s).replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1-");

  function renderDoc(d, opts = {}) {
    const c = d.company || {};
    const items = d.items || [];
    const paid = (d.payments || []).reduce((a, p) => a + Number(p.amount), 0);
    const bal = Number(d.account_balance || 0), st = d.type === "statement" || d.type === "opening_balance"; // opening balance link (debt reminder) asks for the whole account
    const invRem = d.status === "cancelled" ? 0 : Math.max(Number(d.remaining ?? (Number(d.total) - paid)), 0), other = bal - invRem;
    const payable = st ? Math.max(bal, 0) : invRem; // D-93
    const copyBtn = (val, label) => `<button type="button" class="doc-copy no-print" data-act="copy" data-val="${esc(val)}" aria-label="کپی ${esc(label)}">کپی</button>`;
    const bankRow = (label, val, shown, ltr = true) => val ? `<div class="doc-bank-row"><span class="doc-bank-label">${label}</span><bdi dir="${ltr ? "ltr" : "rtl"}" class="doc-bank-val">${shown}</bdi>${copyBtn(val, label)}</div>` : "";
    const contacts = [
      c.phone ? `<span>${ICO_PHONE} <bdi dir="ltr">${esc(fa(c.phone))}</bdi></span>` : "",
      c.phone2 ? `<span>${ICO_PHONE} <bdi dir="ltr">${esc(fa(c.phone2))}</bdi></span>` : "",
      c.website ? `<span>${ICO_WEB} <bdi dir="ltr">${esc(c.website)}</bdi></span>` : "",
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
        ${st && d.previous_balance !== null && d.previous_balance !== undefined && Number(d.previous_balance) !== 0 ? `<tr><td colspan="2">مانده‌ی حساب پیش از این سند ${Number(d.previous_balance) < 0 ? "(بستانکار)" : ""}</td><td class="n">${rial(Math.abs(d.previous_balance))}</td></tr>` : ""}
        ${paid ? `<tr><td colspan="2">پرداخت‌شده بابت این سند</td><td class="n">−${rial(paid)}</td></tr>` : ""}
        ${st ? `<tr class="doc-payable"><td colspan="2">${bal < 0 ? "مانده‌ی بستانکاری شما" : "مبلغ قابل پرداخت (مانده‌ی فعلی حساب)"}</td><td class="n">${rial(Math.abs(bal))}</td></tr>`
          : `<tr class="doc-payable"><td colspan="2">مبلغ قابل پرداخت این فاکتور</td><td class="n">${rial(invRem)}</td></tr>`}
      </tfoot></table>
      <div class="doc-words">${payable ? `مبلغ قابل پرداخت به حروف: <b>${numWords(payable)} ریال</b> (معادل ${num(Math.round(payable / 10))} تومان)` : !st ? "این فاکتور تسویه است. سپاسگزاریم." : bal < 0 ? "حساب شما بستانکار است و از صورتحساب‌های بعدی کسر می‌شود." : "حساب شما تسویه است. سپاسگزاریم."}</div>
      ${!st && other ? `<div class="doc-notes">${other > 0 ? `مانده‌ی دیگر حساب شما (جدا از این فاکتور و قابل پرداخت جداگانه): <b>${rial(other)} ریال</b>` : `بستانکاری دیگر حساب شما: <b>${rial(-other)} ریال</b>`} · مانده‌ی کل حساب: ${rial(Math.abs(bal))} ریال${bal < 0 ? " بستانکار" : ""}</div>` : ""}
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
    const a = [pub ? `<button class="btn" data-act="doc-print">چاپ / ذخیره PDF</button>` : `<button class="btn" data-act="inv-print" data-id="${d.id}">چاپ روی سربرگ / PDF</button>`];
    if (!pub && d.token) a.push(`<button class="btn secondary" data-act="doc-share" data-token="${esc(d.token)}" data-no="${esc(d.number || "")}">ارسال لینک برای مشترک</button>`);
    if (!pub && can.recordPayment() && ["issued", "partially_paid"].includes(d.status)) a.splice(1, 0, `<button class="btn ok" data-act="doc-pay" data-id="${d.id}">ثبت دریافت وجه</button>`);
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
    return shell(DOC_TITLE[d.type] || "سند", "contracts", `<a href="#/contracts" data-act="back" class="small no-print">→ بازگشت</a>
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
    return shell("اعلام پرداخت مشتریان", "more", `<a href="#/more" data-act="back" class="small">→ بازگشت</a>
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
    const st = await api("app_settings?key=in.(sms.mode,sms.test_mobile,sms.template_id,sms.tpl_plan,sms.tpl_fault,sms.tpl_proforma,sms.tpl_service,sms.tpl_renewal,sms.tpl_insurance,sms.tpl_install,sms.debt_day)&select=key,value");
    const sv = (k) => (st.find((x) => x.key === k) || {}).value || "";
    const tplId = (st.find((x) => x.key === "sms.template_id") || {}).value || "";
    const tplPlan = (st.find((x) => x.key === "sms.tpl_plan") || {}).value || "", tplFault = (st.find((x) => x.key === "sms.tpl_fault") || {}).value || "";
    const smsMode = (st.find((x) => x.key === "sms.mode") || {}).value || "test";
    const testMobile = (st.find((x) => x.key === "sms.test_mobile") || {}).value || "";
    const F = [["name", "نام روی اسناد"], ["slogan", "شعار"], ["slogan_en", "شعار انگلیسی"], ["phone", "تلفن", 1], ["phone2", "تلفن دوم", 1], ["website", "سایت", 1], ["instagram", "پیج اینستاگرام", 1],
      ["address", "آدرس دفتر"], ["bank", "بانک"], ["account_holder", "به نام"], ["card_no", "شماره کارت", 1], ["account_no", "شماره حساب", 1], ["sheba", "شماره شبا", 1], ["footer_note", "یادداشت پایین اسناد"],
      ["legal_name", "نام حقوقی شرکت در قرارداد"], ["representative", "نماینده‌ی شرکت در قرارداد (مثلاً: آقای ...)"], ["parts_cap_rial", "سقف تعویض قطعه بدون اجازه‌ی کارفرما (ریال، تبصره ۳)", 1]];
    return shell("اطلاعات شرکت روی اسناد", "more", `<a href="#/more" data-act="back" class="small">→ بازگشت</a>
      <div class="card" id="company-form">${F.map(([k, l, ltr]) => `<label>${l}</label><input type="text" data-field="${k}" value="${esc(c[k] || "")}" ${ltr ? 'class="ltr"' : ""}>`).join("")}
      <div class="hint">این اطلاعات روی همه‌ی صورتحساب‌ها، فاکتورها و لینک‌های پرداخت نمایش داده می‌شود. لوگو ثابت است.</div>
      <div class="actions"><button class="btn" data-act="company-save">ذخیره</button></div></div>
      <div class="section-title"><h2>پیامک</h2></div>
      <div class="card"><div class="item-title">حالت ارسال: ${smsMode === "live" ? `<span class="badge ok">واقعی</span>` : `<span class="badge warn">آزمایشی</span>`}</div>
        <div class="small muted">${smsMode === "live" ? "پیامک‌ها به شماره‌ی انتخاب‌شده (مدیر ساختمان) فرستاده می‌شوند." : "همه‌ی پیامک‌ها فقط به شماره‌ی آزمایشی زیر فرستاده می‌شوند تا قبل از شروع کار، هیچ مشترکی پیامکی نگیرد."}</div>
        <label>شماره قالب (پترن) SMS.ir</label><div class="row"><input type="text" data-field="sms-tpl" class="ltr" inputmode="numeric" value="${esc(tplId)}" placeholder="خالی = ارسال متنی معمولی" style="flex:1"><button class="btn secondary small" data-act="sms-tpl-save">ذخیره</button></div>
        <div class="hint">با قالب، پیامک به شماره‌های «لیست سیاه» هم می‌رسد و شب‌ها در صف نمی‌ماند.</div>
        <label>قالب پیامک برنامه‌ی فردای سرویس‌کار (ساعت ۲۱)</label><input type="text" data-field="sms-tpl-plan" class="ltr" inputmode="numeric" value="${esc(tplPlan)}" placeholder="پارامترها: COUNT، DAY">
        <label>قالب پیامک ارجاع خرابی به تعمیرکار</label><input type="text" data-field="sms-tpl-fault" class="ltr" inputmode="numeric" value="${esc(tplFault)}" placeholder="پارامترها: PRIORITY، BUILDING، NUMBER">
        <div class="actions"><button class="btn secondary small" data-act="sms-tech-tpl-save">ذخیره‌ی قالب‌های سرویس‌کار</button></div>
        <div class="item-title" style="margin-top:12px">پیامک‌های مدیر ساختمان</div>
        <div class="small muted">لینک تأیید سرویس پس از ثبت هر سرویس؛ لینک پیش‌فاکتور با دکمه‌ی روی پیش‌فاکتور؛ یادآوری‌ها هر روز ساعت ۱۰ صبح فقط در حالت واقعی (هر کدام یک بار): بدهی در روز تعیین‌شده‌ی هر ماه با قالب بالا، پایان قرارداد و بیمه‌نامه ۳۰ و ۷ روز مانده.</div>
        <label>قالب لینک پیش‌فاکتور</label><input type="text" data-field="sms-tpl-proforma" class="ltr" inputmode="numeric" value="${esc(sv("sms.tpl_proforma"))}" placeholder="پارامترها: BUILDING، NUMBER، AMOUNT، CODE">
        <label>قالب لینک تأیید سرویس</label><input type="text" data-field="sms-tpl-service" class="ltr" inputmode="numeric" value="${esc(sv("sms.tpl_service"))}" placeholder="پارامترها: BUILDING، DATE، CODE">
        <label>قالب یادآوری تمدید قرارداد</label><input type="text" data-field="sms-tpl-renewal" class="ltr" inputmode="numeric" value="${esc(sv("sms.tpl_renewal"))}" placeholder="پارامترها: BUILDING، DATE">
        <label>قالب یادآوری تمدید بیمه‌نامه</label><input type="text" data-field="sms-tpl-insurance" class="ltr" inputmode="numeric" value="${esc(sv("sms.tpl_insurance"))}" placeholder="پارامترها: BUILDING، DATE">
        <label>قالب لینک پیشنهاد قیمت نصب (به کارفرما)</label><input type="text" data-field="sms-tpl-install" class="ltr" inputmode="numeric" value="${esc(sv("sms.tpl_install"))}" placeholder="پارامترها: PROJECT، NUMBER، CODE، HOURS">
        <label>روز یادآوری بدهی در هر ماه شمسی</label><input type="text" data-field="sms-debt-day" class="ltr" inputmode="numeric" value="${esc(fa(sv("sms.debt_day") || "5"))}">
        <div class="actions"><button class="btn secondary small" data-act="sms-cust-tpl-save">ذخیره</button><button class="btn secondary small" data-act="sms-sample">ارسال نمونه‌ی همه‌ی پیامک‌ها به شماره‌ی آزمایشی</button></div>
        <label>شماره‌ی آزمایشی پیامک</label><div class="row"><input type="text" data-field="sms-test" class="ltr" inputmode="tel" value="${esc(testMobile)}" placeholder="خالی = تلفن شرکت" style="flex:1"><button class="btn secondary small" data-act="sms-test-save">ذخیره</button></div>
        <div class="actions"><button class="btn secondary small" data-act="sms-ping">ارسال پیامک آزمایشی</button><button class="btn ${smsMode === "live" ? "secondary" : "danger"} small" data-act="sms-mode" data-k="${smsMode === "live" ? "test" : "live"}">${smsMode === "live" ? "برگشت به حالت آزمایشی" : "فعال‌سازی ارسال واقعی"}</button></div></div>`);
  }

  /* ------------------------------------------------------------------ A4 print on the letterhead (D-71..D-75) */
  const jdateTz = (d) => (d ? new Intl.DateTimeFormat("fa-IR-u-ca-persian", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tehran" }).format(new Date(d)) : "—");
  const LH_ICON = (p) => `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#7d8591" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  function letterheadHtml(meta, company) {
    const c = company || {};
    return `<svg class="pp-art" viewBox="0 0 210 297" aria-hidden="true">
      <path d="M0 0 H78.9 L87.6 10.6 L85.6 14.4 L116 44.2 Q117.6 46 116.4 47.2 Q115.6 47.9 114 47.9 H71.4 L67 40.6 H0 Z" fill="#f2b51c"/>
      <g fill="none" stroke="#fff" stroke-width=".42" stroke-linejoin="round" stroke-linecap="round">
        <path d="M2 38.3 H29 L31.6 36.3 H50 L53.6 39.9 H66 M83.6 39.9 H90 L92 37.9 H104 L112.4 46.4"/>
        <path d="M2 39.6 H29.6 L32.2 37.6 H49.4 L53 41.2 H66 M83.6 41.2 H90.6 L92.6 39.2 H103.4 L110.6 46.4"/>
        <path d="M24 38.3 v-2.2 M25 38.3 v-2.2 M35 36.3 v-2.2 M36 36.3 v-2.2 M40 36.3 v-3.2 M45.5 36.3 v-2.2 M46.5 36.3 v-2.2 M57 39.9 v-2.4 M58 39.9 v-2.4 M62 39.9 v-2.4 M94 37.9 v-2 M95 37.9 v-2 M99.5 37.9 v-2.2 M100.5 37.9 v-2.2 M104.6 38.4 v-2"/>
        <rect x="66.6" y="32.4" width="7.6" height="7.6" rx="1.3"/><rect x="75.6" y="32.4" width="7.6" height="7.6" rx="1.3"/>
        <path d="M68.2 38.4 H69.6 L72.4 34.6 H73"/><rect x="77.2" y="33.6" width="2.6" height="5.2" rx=".3"/><path d="M81.4 34 v4.4 M80.8 34.8 l.6-.8 .6 .8 M80.8 37.6 l.6 .8 .6-.8"/>
      </g><text x="74.9" y="45.6" fill="#fff" font-size="2.6" font-weight="800" text-anchor="middle" letter-spacing=".3">LIFT</text></svg>
      <img class="pp-logo" src="icons/logo_lh.png" alt="">
      <div class="pp-member">عضو رسمی اتحادیه کشوری صنایع آسانسور و پله برقی ایران</div>
      <div class="pp-addr"><b>دفتر مرکزی:</b> کیان‌آباد، خیابان ۱۵ شرقی<br>بین اصلی و احداثی، پلاک ۱۶<br><b>سرویس و نگهداری:</b> ${esc(fa(c.phone || ""))}</div>
      <div class="pp-meta"><div><span>شماره:</span><bdi dir="ltr">${esc(fa(meta.no || "—"))}</bdi></div><div><span>تاریخ:</span><bdi>${esc(meta.date || "—")}</bdi></div><div><span>پیوست:</span><bdi>${esc(meta.att || "ندارد")}</bdi></div></div>
      <div class="pp-foot"><span>${LH_ICON('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>')}${esc(c.website || "www.payaco.org")}</span><span>${LH_ICON('<rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.6"/>')}${esc(c.instagram || "payacolift")}</span><span>${LH_ICON('<path d="M21 4 3 11l6 2 2 6 3-4 5 4z"/><path d="m9 13 8-6"/>')}${esc(c.instagram || "payacolift")}</span></div>`;
  }
  // lays blocks out on A4 pages; a block that does not fit starts the next page
  function paginate(host, meta, company, head, blocks, opt = {}) {
    const pages = [];
    const newPage = () => {
      const p = document.createElement("section"); p.className = "pp-page" + (opt.sign ? " compact" : "");
      p.innerHTML = `${letterheadHtml(meta, company)}<div class="pp-body"></div>${opt.sign ? `<div class="pp-sign"><div>امضای پیمانکار</div><div>امضای کارفرما</div></div>` : ""}<div class="pp-no"></div>${opt.draft ? `<div class="pp-draft">پیش‌نویس — بدون شماره</div>` : ""}`;
      host.appendChild(p); pages.push(p); return p.querySelector(".pp-body");
    };
    let body = newPage(); body.innerHTML = head;
    const over = () => body.scrollHeight > body.clientHeight + 1;
    for (const b0 of blocks) {
      // a block is HTML, or { html, newPage: start on a fresh page, fit: shrink its text until it fits the rest of this page }
      const b = typeof b0 === "string" ? { html: b0 } : b0;
      if (b.newPage && body.children.length) body = newPage();
      body.insertAdjacentHTML("beforeend", `<div class="pp-blk">${b.html}</div>`);
      if (over() && b.fit) { const el = body.lastElementChild; for (let k = 0.95; k >= 0.6 && over(); k -= 0.05) el.style.setProperty("--fit", k.toFixed(2)); }
      if (over() && body.children.length > 1) { body.lastElementChild.remove(); body = newPage(); body.insertAdjacentHTML("beforeend", `<div class="pp-blk">${b.html}</div>`); }
    }
    pages.forEach((p, i) => { p.querySelector(".pp-no").innerHTML = `<span>صفحه ${fa(i + 1)} از ${fa(pages.length)}</span>${meta.form ? `<span>·</span><span class="pp-iso">${esc(meta.form)} · Rev.${String(meta.rev || 0).padStart(2, "0")}</span><span>· ابلاغ ${esc(meta.issued || "")}</span>` : ""}`; });
    return pages;
  }
  let ppPaper = true; // D-71: default = office paper that already carries the letterhead
  try { ppPaper = localStorage.getItem("pp-paper") !== "0"; } catch (e) { /* default */ }
  function openPrint(title, build, extra = "") {
    document.querySelectorAll(".pp-wrap").forEach((x) => x.remove());
    const w = document.createElement("div"); w.className = "pp-wrap";
    w.innerHTML = `<div class="pp-bar no-print"><b>${esc(title)}</b><span class="spacer"></span>
      <label class="pp-toggle"><input type="checkbox" data-pp="paper" ${ppPaper ? "checked" : ""}> چاپ روی کاغذ سربرگ‌دار</label>
      ${extra}<button class="btn small" data-pp="print">چاپ / PDF</button><button class="btn secondary small" data-pp="close">بستن</button></div>
      <div class="pp-pages${ppPaper ? " paper" : ""}"></div>`;
    document.body.appendChild(w); document.body.classList.add("pp-open");
    const host = w.querySelector(".pp-pages");
    const fit = () => { host.style.setProperty("--z", String(Math.min(1, (window.innerWidth - 16) / 794))); };
    fit(); window.addEventListener("resize", fit);
    const close = () => { w.remove(); document.body.classList.remove("pp-open"); window.removeEventListener("resize", fit); };
    w.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pp]"); if (!b) return;
      if (b.dataset.pp === "print") window.print();
      if (b.dataset.pp === "close") close();
    });
    w.querySelector('[data-pp="paper"]').addEventListener("change", (e) => {
      ppPaper = e.target.checked; host.classList.toggle("paper", ppPaper);
      try { localStorage.setItem("pp-paper", ppPaper ? "1" : "0"); } catch (er) { /* per-device convenience only */ }
    });
    build(host); fit(); // zoom stays fitted while laying out: page overflow is measured in the same zoomed units
    return { wrap: w, close };
  }

  /* contract text: template markup -> blocks */
  const CT_KEYS = ["شرکت", "نشانی_شرکت", "نماینده_شرکت", "تلفن_شرکت", "کارفرما", "نماینده_کارفرما", "شناسه_ملی_کارفرما", "تلفن_کارفرما", "نشانی_کارفرما", "نام_ساختمان", "نشانی_ساختمان",
    "تعداد_دستگاه", "مدت", "تاریخ_شروع", "تاریخ_پایان", "مبلغ_خالص_سالانه", "مبلغ_ماهانه", "سقف_قطعات", "کسر_عدم_سرویس", "شماره_کارت", "بانک", "صاحب_حساب", "سال_همکاری", "تعداد_مواد_و_تبصره‌ها"];
  const CT_TABLES = ["[[جدول_مشخصات]]", "[[جدول_مبلغ]]"];
  function contractBlocks(body, v, tables) {
    const lines = String(body || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const nArt = lines.filter((l) => l.startsWith("# ")).length, nNote = lines.filter((l) => /^تبصره/.test(l)).length;
    const vals = { ...v, "تعداد_مواد_و_تبصره‌ها": `${numWords(nArt)} ماده${nNote ? ` و ${numWords(nNote)} تبصره` : ""}` };
    const fill = (s) => esc(s).replace(/\{([^{}\s]+)\}/g, (m, k) => (k in vals && vals[k] !== null && vals[k] !== undefined && vals[k] !== "" ? `<span class="pp-fill">${vals[k]}</span>` : `<span class="pp-miss" title="${esc(k)}">……………</span>`));
    const blocks = []; let head = "";
    for (const l of lines) {
      if (l.startsWith("# ")) { head = `<h4>${fill(l.slice(2))}</h4>`; continue; }
      let h;
      if (CT_TABLES.includes(l)) h = tables[l] || "";
      else if (l.startsWith("- ")) h = `<ul><li>${fill(l.slice(2))}</li></ul>`;
      else if (/^تبصره[^:]{0,12}:/.test(l)) { const i = l.indexOf(":"); h = `<p class="tb"><b>${fill(l.slice(0, i + 1))}</b>${fill(l.slice(i + 1))}</p>`; }
      else h = `<p>${fill(l)}</p>`;
      blocks.push(`<div class="pp-a${head ? "" : " cont"}">${head}${h}</div>`); head = "";
    }
    return blocks;
  }
  const rialText = (n) => `${num(n)} ریال`;
  async function contractPrintData(id, templateId) {
    const [[c], [k], company] = await Promise.all([
      api(`v_contract_overview?id=eq.${id}&select=*`),
      api(`contracts?id=eq.${id}&select=doc_number,doc_issued_at,doc_template_id,legacy,customers(name,national_id,mobile,address),buildings(name,address)`),
      rpc("get_company_profile")]);
    const elev = await api(`elevators?contract_id=eq.${id}&is_active=eq.true&select=elevator_no,subscription_code,stops,capacity_persons,usage_type,traffic,motor_type,cabin_door_type,landing_door_type,controller_brand&order=elevator_no`);
    const tid = templateId || k.doc_template_id;
    const [t] = await api(`doc_templates?form_code=eq.PY-FO-PC-G08&select=id,rev,title,body,issued_on${tid ? `&id=eq.${tid}` : "&order=rev.desc&limit=1"}`);
    return { c, k, company, elev, t };
  }
  function renderContract(host, d) {
    const { c, k, company, elev, t } = d, cu = k.customers || {}, b = k.buildings || {};
    const days = Math.round((new Date(c.end_date) - new Date(c.start_date)) / 86400000) + 1;
    const months = Math.max(1, Math.round(days / 30.44));
    const monthly = Number(c.monthly_amount_rial || 0), yearNet = monthly * months;
    const vat = c.vat_exempt ? 0 : 10, vatAmt = Math.round(yearNet * vat / 100);
    const cap = Number(toEn(company.parts_cap_rial || "").replace(/\D/g, "")) || null;
    const v = { "شرکت": esc(company.legal_name || company.name || ""), "نشانی_شرکت": esc(fa(company.address || "")), "نماینده_شرکت": esc(company.representative || ""), "تلفن_شرکت": esc(fa(company.phone || "")),
      "کارفرما": esc(cu.name || c.customer_name || ""), "نماینده_کارفرما": esc(c.manager_name || ""), "شناسه_ملی_کارفرما": esc(fa(cu.national_id || "")), "تلفن_کارفرما": esc(fa(cu.mobile || c.manager_mobile || "")),
      "نشانی_کارفرما": esc(fa(cu.address || b.address || "")), "نام_ساختمان": esc(b.name || ""), "نشانی_ساختمان": esc(fa(b.address || "")),
      "تعداد_دستگاه": `${numWords(elev.length || 1)} دستگاه`, "مدت": `${fa(months)} ماه`, "تاریخ_شروع": jdate(c.start_date), "تاریخ_پایان": jdate(c.end_date),
      "مبلغ_خالص_سالانه": rialText(yearNet), "مبلغ_ماهانه": rialText(monthly), "سقف_قطعات": cap ? rialText(cap) : "", "کسر_عدم_سرویس": rialText(c.missed_service_deduction_rial || 0),
      "شماره_کارت": company.card_no ? `<bdi dir="ltr">${esc(groupCard(company.card_no))}</bdi>` : "", "بانک": esc(company.bank || ""), "صاحب_حساب": esc(company.account_holder || ""), "سال_همکاری": c.cooperation_year ? fa(c.cooperation_year) : "" };
    const row = (label, f) => `<tr><td class="k">${label}</td>${elev.map((e) => `<td>${f(e) ? esc(fa(f(e))) : `<span class="pp-miss">……………</span>`}</td>`).join("")}</tr>`;
    const tables = {
      "[[جدول_مشخصات]]": `<table class="pp-spec"><thead><tr><th></th>${elev.map((e) => `<th>دستگاه ${fa(e.elevator_no)}${e.subscription_code ? ` · کد ${esc(fa(e.subscription_code))}` : ""}</th>`).join("")}</tr></thead><tbody>
        ${row("نوع کاربری", (e) => e.usage_type)}${row("میزان ترافیک", (e) => e.traffic)}${row("تعداد توقف", (e) => (e.stops ? `${e.stops} توقف` : ""))}${row("ظرفیت", (e) => (e.capacity_persons ? `${e.capacity_persons} نفره` : ""))}
        ${row("نوع موتور", (e) => e.motor_type)}${row("نوع درب کابین", (e) => e.cabin_door_type)}${row("نوع درب طبقات", (e) => e.landing_door_type)}${row("تابلو فرمان", (e) => e.controller_brand)}</tbody></table>`,
      "[[جدول_مبلغ]]": `<table class="pp-money"><thead><tr><th>مبلغ خالص سالانه</th><th>مالیات و عوارض ${vat ? `(${fa(vat)}٪)` : ""}</th><th>جمع کل سالانه</th><th>قابل پرداخت ماهانه</th></tr></thead>
        <tbody><tr><td>${num(yearNet)}</td><td>${vat ? num(vatAmt) : "معاف"}</td><td>${num(yearNet + vatAmt)}</td><td class="hl">${num(Math.round((yearNet + vatAmt) / months))}</td></tr></tbody></table><div class="pp-sub">مبالغ به ریال</div>` };
    const blocks = contractBlocks(t.body, v, tables);
    blocks.push(`<div class="pp-csign"><div><b>پیمانکار: ${v["شرکت"]}</b>${v["نماینده_شرکت"]} — مهر و امضا</div><div><b>کارفرما: ${v["کارفرما"]}</b>${v["نماینده_کارفرما"]} — مهر و امضا</div></div>`);
    const codes = [...new Set(elev.map((e) => e.subscription_code).filter(Boolean))];
    const head = `<div class="pp-ctitle"><div class="bis">بسمه تعالی</div><div class="ayah">یا أَیُّهَا الَّذینَ آمَنُوا أَوْفُوا بِالْعُقُود (مائده: ۱)</div><h1>${esc(t.title)}</h1></div>
      <div class="pp-tags">${codes.length ? `<span class="pp-chip">کد اشتراک ${esc(fa(codes.join("، ")))}</span>` : ""}${c.cooperation_year ? `<span class="pp-chip y">سال‌های همکاری: ${fa(c.cooperation_year)} سال</span>` : ""}</div>`;
    paginate(host, { no: k.doc_number, date: k.doc_issued_at ? jdateTz(k.doc_issued_at) : "", form: "PY-FO-PC-G08", rev: t.rev, issued: jdate(t.issued_on) }, company, head, blocks, { sign: true, draft: !k.doc_number });
  }
  async function printContract(id) {
    const d = await contractPrintData(id);
    if (!d.t) return toast("متن قرارداد تعریف نشده است");
    const draft = !d.k.doc_number;
    const miss = draft && !d.k.legacy ? await rpc("contract_missing_fields", { p_contract_id: id }).catch(() => []) : [];
    const ui = openPrint(`قرارداد ${fa(d.c.contract_code)}${draft ? " — پیش‌نویس" : ""}`, (host) => renderContract(host, d),
      draft && can.changeContract() ? (miss && miss.length ? `<span class="small debt">برای صدور کامل کنید: ${miss.map(esc).join("، ")}</span>`
        : `<button class="btn ok small" data-pp="issue">صدور و گرفتن شماره</button>${d.k.legacy ? `<span class="small muted">قرارداد موجود از قبل: جاهای خالی با نقطه‌چین چاپ می‌شوند.</span>` : ""}`) : "");
    const issue = ui.wrap.querySelector('[data-pp="issue"]');
    if (issue) issue.addEventListener("click", () => {
      if (!confirm("قرارداد صادر شود؟ شماره‌ی قرارداد (کد ۰۲) گرفته می‌شود و دیگر عوض نمی‌شود. چاپ‌های بعدی همین شماره را دارند.")) return;
      issue.disabled = true;
      rpc("issue_contract_document", { p_contract_id: id }).then(() => { ui.close(); toast("قرارداد صادر شد"); return printContract(id); })
        .catch((er) => { issue.disabled = false; toast(er.message); });
    });
  }

  /* template editor (CEO): every save is a new revision of PY-FO-PC-G08 (D-74) */
  async function viewTemplates() {
    const revs = await api("doc_templates?form_code=eq.PY-FO-PC-G08&select=id,rev,title,body,issued_on,change_note,created_at&order=rev.desc");
    const cur = revs[0];
    if (!cur) return shell("متن قرارداد", "more", `<div class="card empty">متن قرارداد هنوز تعریف نشده است</div>`);
    return shell("متن قرارداد", "more", `<a href="#/more" data-act="back" class="small">→ بازگشت</a>
      <div class="card" style="margin-top:8px"><div class="item-title">${esc(cur.title)} · <bdi dir="ltr">PY-FO-PC-G08 · Rev.${String(cur.rev).padStart(2, "0")}</bdi></div>
        <div class="small muted">ابلاغ ${jdate(cur.issued_on)}${cur.change_note ? " · " + esc(cur.change_note) : ""}. قراردادهای صادرشده با همان نسخه‌ای که صادر شده‌اند چاپ می‌شوند؛ ذخیره‌ی متن جدید فقط روی قراردادهایی اثر دارد که از این به بعد صادر می‌شوند.</div></div>
      <div class="card"><label>متن قرارداد</label><textarea id="tpl-body" class="tpl-body" spellcheck="false">${esc(cur.body)}</textarea>
        <div class="hint">راهنما: خطی که با «# » شروع شود عنوان ماده است؛ «- » بند؛ خطی که با «تبصره ...:» شروع شود تبصره است. جدول‌ها و مقدارهای خودکار را با لمس اضافه کنید:</div>
        <div class="chips tpl-keys">${CT_TABLES.map((x) => `<button type="button" data-act="tpl-key" data-k="${esc(x)}">${esc(x)}</button>`).join("")}${CT_KEYS.map((x) => `<button type="button" data-act="tpl-key" data-k="{${esc(x)}}">${esc(x.replace(/_/g, " "))}</button>`).join("")}</div>
        <label>توضیح تغییر (برای شناسنامه)</label><input type="text" id="tpl-note" placeholder="مثلاً: اصلاح تبصره ۳">
        <div class="actions"><button class="btn secondary" data-act="tpl-preview">پیش‌نمایش با نمونه</button><button class="btn" data-act="tpl-save">ذخیره به‌عنوان بازنگری Rev.${String(cur.rev + 1).padStart(2, "0")}</button></div></div>
      <div class="section-title"><h2>تاریخچه‌ی بازنگری‌ها</h2></div>
      ${revs.map((r) => `<div class="card"><div class="item-head"><div><div class="item-title"><bdi dir="ltr">Rev.${String(r.rev).padStart(2, "0")}</bdi> · ابلاغ ${jdate(r.issued_on)}</div><div class="small muted">${esc(r.change_note || "—")}</div></div>
        <button class="btn secondary small" data-act="tpl-view" data-id="${r.id}">مشاهده</button></div></div>`).join("")}`);
  }
  const SAMPLE_CONTRACT = () => ({
    c: { contract_code: "نمونه", start_date: addDays(todayTehran(), 1), end_date: addDays(todayTehran(), 365), monthly_amount_rial: 8000000, missed_service_deduction_rial: 4000000,
      cooperation_year: 3, vat_exempt: false, customer_name: "مجتمع مسکونی نمونه", manager_name: "آقای نمونه", manager_mobile: "09160000000" },
    k: { doc_number: null, customers: { name: "مجتمع مسکونی نمونه", national_id: "0000000000", mobile: "09160000000", address: "اهواز، خیابان نمونه" }, buildings: { name: "مجتمع نمونه", address: "اهواز، خیابان نمونه" } },
    elev: [{ elevator_no: 1, subscription_code: "000", stops: 6, capacity_persons: 6, usage_type: "مسکونی", traffic: "متوسط", motor_type: "گیربکس ۷.۵ کیلووات", cabin_door_type: "تلسکوپی", landing_door_type: "لولایی", controller_brand: "نمونه" }] });
  async function previewTemplate(body, rev, issued) {
    const company = await rpc("get_company_profile");
    openPrint(`پیش‌نمایش متن قرارداد (داده‌ی نمونه)`, (host) => renderContract(host, { ...SAMPLE_CONTRACT(), company, t: { title: "قرارداد سرویس و نگهداری آسانسور", body, rev, issued_on: issued } }));
  }

  /* ------------------------------------------------------------------ proforma & repair invoice (M36, D-81..D-84) */
  const canDocs = () => ["CEO", "EMPLOYEE", "REPAIR_MANAGER"].includes(role());
  const PF_STATUS = { issued: ["منتظر تأیید", "warn"], approved: ["تأییدشده", "ok"], rejected: ["ردشده", "danger"], cancelled: ["لغوشده", ""] };
  const pfState = (p) => (p.status === "issued" && (p.expired || new Date(p.valid_until) < new Date()) ? ["اعتبار تمام‌شده", "danger"] : PF_STATUS[p.status] || [p.status, ""]);
  const VAT_RATE = 10; // shown in previews only; the database computes the final amounts
  function docTotalsPreview(items, discount, exempt) {
    const sub = items.reduce((a, x) => a + Math.round(x.qty * x.unit_price), 0), d = Math.min(Math.max(discount || 0, 0), sub);
    const vat = exempt ? 0 : Math.round((sub - d) * VAT_RATE / 100);
    return { sub, d, vat, total: sub - d + vat };
  }
  // kind: "proforma" | "invoice"; opts: { contractId, faultId, edit (proforma json) }
  async function sheetDoc(kind, opts = {}) {
    const all = (await contractsList()).filter((c) => ["active", "expired"].includes(c.status));
    if (!all.length) return toast("قراردادی در دسترس نیست");
    const ed = opts.edit || null, pf = kind === "proforma";
    const cid = ed ? ed.contract_id : opts.contractId;
    const rowHtml = (it = {}) => `<div class="card doc-row" data-row="1">
      <label>شرح کالا / خدمات</label><input type="text" data-r="description" value="${esc(it.description || "")}">
      <div class="row"><div style="flex:1"><label>تعداد</label><input type="text" class="ltr" inputmode="decimal" data-r="qty" value="${esc(fa(it.qty ?? 1))}"></div>
        <div style="flex:1"><label>واحد</label><input type="text" data-r="unit" list="dl-unit" value="${esc(it.unit || "")}" placeholder="عدد"></div></div>
      <label>قیمت واحد</label><input type="text" class="ltr" inputmode="numeric" data-r="price" value="${it.unit_price ? esc(nf.format(it.unit_price / 10)) : ""}">
      <button type="button" class="btn secondary small" data-act="row-del">حذف ردیف</button></div>`;
    sheet(`<h3>${ed ? `ویرایش پیش‌فاکتور ${esc(fa(ed.number))}` : pf ? "صدور پیش‌فاکتور" : "صدور فاکتور تعمیرات"}</h3>
      ${ed ? `<div class="small muted">${esc(ed.building ? ed.building.name : "")}</div>` : `<label>ساختمان / قرارداد</label>${CSEL_Q}<select data-field="contract" class="csel">${all.map((c) => `<option value="${c.id}" ${c.id === cid ? "selected" : ""}>${esc(fa(c.contract_code))} · ${esc(c.building_name || "")}</option>`).join("")}</select>`}
      ${pf ? `<label>موضوع</label><input type="text" data-field="subject" value="${esc((ed && ed.subject) || opts.subject || "")}" placeholder="مثلاً: تعویض تابلو فرمان">` : ""}
      <label>واحد مبلغ‌ها</label><div class="seg" data-field="unit"><button type="button" data-u="toman" class="on">تومان</button><button type="button" data-u="rial">ریال</button></div>
      <div data-field="rows">${(ed ? ed.items : [{}]).map(rowHtml).join("")}</div>
      <datalist id="dl-unit">${["عدد", "دستگاه", "سرویس", "متر", "سری", "دست", "کیلوگرم"].map((x) => `<option value="${x}">`).join("")}</datalist>
      <button type="button" class="btn secondary small" data-act="row-add">+ ردیف دیگر</button>
      <label>تخفیف</label><input type="text" class="ltr" inputmode="numeric" data-field="discount" value="${ed && ed.discount ? esc(nf.format(ed.discount / 10)) : ""}" placeholder="0">
      <label class="check"><input type="checkbox" data-field="exempt"> بدون مالیات بر ارزش افزوده (معاف)</label>
      <label>توضیحات (اختیاری)</label><input type="text" data-field="notes" value="${esc((ed && ed.notes) || "")}">
      <div class="card doc-sum" data-field="sum"></div>
      ${pf ? `<div class="hint">پیش‌فاکتور ۷۲ ساعت از صدور معتبر است و در حساب مشترک اثری ندارد. مدیر ساختمان (از لینک) یا مدیرعامل تأیید می‌کند؛ پس از پرداخت مشتری، دفتر از روی آن فاکتور صادر می‌کند.</div>` : `<div class="hint">فاکتور با صدور در حساب مشترک ثبت می‌شود و فقط با ابطال برمی‌گردد.</div>`}
      <div class="actions"><button class="btn" data-act="save">${ed ? "ذخیره و صدور دوباره (اعتبار ۷۲ ساعت از نو)" : pf ? "صدور پیش‌فاکتور" : "صدور فاکتور"}</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      const sel = el.querySelector('[data-field="contract"]'), ex = el.querySelector('[data-field="exempt"]'), seg = el.querySelector('[data-field="unit"]');
      const contractOf = () => all.find((c) => c.id === (ed ? ed.contract_id : Number(sel.value))) || {};
      ex.checked = ed ? !!ed.vat_exempt : !!contractOf().vat_exempt;
      if (sel) sel.addEventListener("change", () => { ex.checked = !!contractOf().vat_exempt; calc(); });
      const mult = () => (seg.querySelector(".on").dataset.u === "toman" ? 10 : 1);
      const read = () => [...el.querySelectorAll("[data-row]")].map((r) => ({ description: r.querySelector("[data-r=description]").value.trim(),
        qty: Number(toEn(r.querySelector("[data-r=qty]").value).replace(/[^\d.]/g, "")) || 0, unit: r.querySelector("[data-r=unit]").value.trim(),
        unit_price: parseAmount(r.querySelector("[data-r=price]").value) * mult() })).filter((x) => x.description || x.unit_price);
      const calc = () => {
        const t = docTotalsPreview(read(), parseAmount(el.querySelector('[data-field="discount"]').value) * mult(), ex.checked);
        el.querySelector('[data-field="sum"]').innerHTML = `<div class="row"><span class="spacer">جمع اقلام</span><b>${money(t.sub)}</b></div>
          ${t.d ? `<div class="row"><span class="spacer">تخفیف</span><b>−${money(t.d)}</b></div>` : ""}
          <div class="row"><span class="spacer">مالیات بر ارزش افزوده ${ex.checked ? "(معاف)" : `${fa(VAT_RATE)}٪`}</span><b>${money(t.vat)}</b></div>
          <div class="row" style="border-top:1px solid var(--line);padding-top:6px"><span class="spacer"><b>${pf ? "جمع پیش‌فاکتور" : "مبلغ فاکتور"}</b></span><b>${money(t.total)}</b></div>`;
      };
      el.addEventListener("input", (e) => { const i = e.target; if (i.matches("[data-r=price], [data-field=discount]")) { const v = parseAmount(i.value); i.value = v ? nf.format(v) : ""; } calc(); });
      ex.addEventListener("change", calc);
      seg.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); calc(); });
      el.addEventListener("click", (e) => {
        const a = e.target.closest("[data-act]"); if (!a) return;
        if (a.dataset.act === "row-add") { el.querySelector('[data-field="rows"]').insertAdjacentHTML("beforeend", rowHtml()); calc(); }
        if (a.dataset.act === "row-del") { if (el.querySelectorAll("[data-row]").length > 1) a.closest("[data-row]").remove(); calc(); }
      });
      calc();
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const items = read();
        if (!items.length) throw new Error("حداقل یک ردیف وارد کنید");
        if (items.some((x) => !x.description || !x.qty || !x.unit_price)) throw new Error("برای هر ردیف شرح، تعداد و قیمت واحد لازم است");
        const p = { contract_id: ed ? ed.contract_id : Number(sel.value), items, discount_rial: parseAmount(el.querySelector('[data-field="discount"]').value) * mult(),
          vat_exempt: ex.checked, notes: el.querySelector('[data-field="notes"]').value.trim() || null, fault_id: (ed && ed.fault_id) || opts.faultId || null };
        if (pf) p.subject = el.querySelector('[data-field="subject"]').value.trim() || null;
        const t = docTotalsPreview(items, p.discount_rial, p.vat_exempt);
        if (!pf && !confirm(`فاکتور به مبلغ ${num(Math.round(t.total / 10))} تومان صادر و در حساب مشترک ثبت شود؟`)) return;
        if (pf) { const id = await rpc("save_proforma", { p_id: ed ? ed.id : null, p }); close(); toast(ed ? "پیش‌فاکتور ویرایش شد" : "پیش‌فاکتور صادر شد"); location.hash = `#/proforma/${id}`; if (ed) route(); }
        else { const id = await rpc("create_repair_invoice_manual", { p }); close(); toast("فاکتور صادر شد"); payOffer = id; location.hash = `#/doc/${id}`; }
      }));
    });
  }

  let docsTab = "proforma";
  async function viewDocs() {
    const tabs = [["proforma", "پیش‌فاکتورها"], ["repair_invoice", "فاکتورها"], ["insurance_invoice", "بیمه"], ["statement", "صورتحساب‌ها"]];
    let list;
    if (docsTab === "proforma") {
      const rows = await api("proformas?select=id,document_number,status,total_rial,issued_at,valid_until,subject,contract_id,contracts(contract_code,buildings(name))&order=id.desc&limit=300");
      list = rows.map((p) => { const c = p.contracts || {}, st = pfState(p);
        return `<div class="card tap" data-act="go" data-href="#/proforma/${p.id}"><div class="item-head"><div><div class="item-title">${esc(c.buildings ? c.buildings.name : "")}</div>
          <div class="small muted">پیش‌فاکتور <bdi dir="ltr">${esc(fa(p.document_number))}</bdi> · قرارداد ${esc(fa(c.contract_code || ""))} · ${jtime(p.issued_at)}${p.subject ? " · " + esc(p.subject) : ""}</div></div>
          <div style="text-align:left">${money(p.total_rial)}<span class="badge ${st[1]}">${st[0]}</span></div></div></div>`; });
    } else {
      const rows = await api(`invoices?document_type=eq.${docsTab}&select=id,document_number,issue_date,total_rial,status,contract_id,contracts(contract_code,buildings(name))&order=id.desc&limit=300`);
      list = rows.map((i) => { const c = i.contracts || {};
        return `<div class="card tap" data-act="go" data-href="#/doc/${i.id}"><div class="item-head"><div><div class="item-title">${esc(c.buildings ? c.buildings.name : "")}</div>
          <div class="small muted">${DOC_TYPE[docsTab]} <bdi dir="ltr">${esc(fa(i.document_number || ""))}</bdi> · قرارداد ${esc(fa(c.contract_code || ""))} · ${jdate(i.issue_date)}</div></div>
          <div style="text-align:left">${money(i.total_rial)}${badge(INVOICE_STATUS, i.status)}</div></div></div>`; });
    }
    const qb = (canDocs() ? `<button class="btn" data-act="new-proforma">+ پیش‌فاکتور</button><button class="btn secondary" data-act="new-invoice">+ فاکتور</button>` : "")
      + (can.changeContract() ? `<button class="btn secondary" data-act="month-archive">بایگانی ماهانه (ZIP)</button>` : "");
    const quick = qb ? `<div class="page-actions">${qb}</div>` : "";
    return shell("اسناد", "more", `<a href="#/more" data-act="back" class="small">→ بازگشت</a>${quick}
      <div class="chips">${tabs.map(([k, l]) => `<button data-act="docs-tab" data-k="${k}" class="${docsTab === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${list.length ? list.join("") : `<div class="card empty">سندی نیست</div>`}`);
  }

  async function viewProforma(id) {
    const p = await rpc("get_proforma", { p_id: id });
    const st = pfState(p), open = p.status === "issued" && !(p.expired || new Date(p.valid_until) < new Date());
    const items = (p.items || []).map((it, k) => `<tr><td class="c">${fa(k + 1)}</td><td>${esc(it.description)}<div class="small muted">${fa(it.qty)} ${esc(it.unit || "")} × ${num(Math.round(it.unit_price / 10))} تومان</div></td><td class="n">${num(Math.round(it.amount / 10))}</td></tr>`).join("");
    const acts = [`<button class="btn" data-act="pf-print" data-id="${id}">چاپ / PDF</button>`];
    if (p.status === "issued" && canDocs() && open) acts.push(`<button class="btn" data-act="pf-sms" data-id="${id}">ارسال پیامک به مدیر ساختمان</button>`);
    if (p.status === "issued" && canDocs()) acts.push(`<button class="btn secondary" data-act="pf-share" data-code="${esc(p.code || "")}" data-no="${esc(p.number)}">لینک تأیید برای مدیر ساختمان</button>`, `<button class="btn secondary" data-act="pf-edit" data-id="${id}">ویرایش${open ? "" : " و صدور دوباره"}</button>`);
    if (open && role() === "CEO") acts.push(`<button class="btn ok" data-act="pf-approve" data-id="${id}">تأیید از طرف کارفرما</button>`, `<button class="btn danger" data-act="pf-reject" data-id="${id}">رد</button>`);
    if (p.status === "issued" && canDocs()) acts.push(`<button class="btn secondary" data-act="pf-cancel" data-id="${id}">لغو</button>`);
    if (p.status === "approved" && !p.invoice_id && canDocs()) acts.unshift(`<button class="btn ok" data-act="pf-invoice" data-id="${id}">صدور فاکتور (پس از پرداخت مشتری)</button>`);
    return shell(`پیش‌فاکتور ${fa(p.number)}`, "more", `<a href="#/docs" data-act="back" class="small">→ بازگشت</a>
      <div class="card" style="margin-top:8px"><div class="item-head"><div><div class="item-title">${esc(p.building ? p.building.name : "")}</div>
        <div class="small muted">قرارداد ${esc(fa(p.contract ? p.contract.code : ""))}${p.subject ? " · " + esc(p.subject) : ""}</div></div><span class="badge ${st[1]}">${st[0]}</span></div>
        <div class="small">صدور ${jtime(p.issued_at)} · اعتبار تا ${jtime(p.valid_until)}</div>
        ${p.status === "approved" ? `<div class="small ok">تأیید: ${esc(p.decided_name || "")} · ${jtime(p.decided_at)}${p.invoice_id ? ` — فاکتور <a href="#/doc/${p.invoice_id}"><bdi dir="ltr">${esc(fa(p.invoice_number || ""))}</bdi></a>` : " — منتظر پرداخت مشتری و صدور فاکتور"}</div>` : ""}
        ${p.status === "rejected" || p.status === "cancelled" ? `<div class="small debt">${p.status === "rejected" ? "رد" : "لغو"}: ${esc(p.decided_name || "")} ${p.decision_note ? "· " + esc(p.decision_note) : ""}</div>` : ""}
        <table class="list doc-items" style="margin-top:8px"><thead><tr><th>ردیف</th><th>شرح</th><th>مبلغ (تومان)</th></tr></thead><tbody>${items}</tbody></table>
        <dl class="kv"><dt>جمع</dt><dd>${money(p.subtotal)}</dd>${p.discount ? `<dt>تخفیف</dt><dd>−${money(p.discount)}</dd>` : ""}
        <dt>مالیات بر ارزش افزوده</dt><dd>${p.vat_exempt ? "معاف" : money(p.vat)}</dd><dt><b>جمع کل</b></dt><dd><b>${money(p.total)}</b></dd></dl>
        <div class="actions">${acts.join("")}</div></div>`);
  }

  // approval: keep some rows or lower quantities (D-83/D-84)
  function sheetApproveProforma(p, onDone, publicCode) {
    sheet(`<h3>تأیید پیش‌فاکتور ${esc(fa(p.number))}</h3>
      <div class="hint">ردیف‌هایی را که تأیید نمی‌شوند از تیک خارج کنید یا تعدادشان را کم کنید${p.discount ? "؛ تخفیف به همان نسبت کم می‌شود" : ""}. پس از پرداخت، دفتر فاکتور همین ردیف‌ها را صادر می‌کند.</div>
      ${(p.items || []).map((it, k) => `<div class="card" data-ai="${k}"><label class="check"><input type="checkbox" data-a="on" checked> ${esc(it.description)}</label>
        <div class="row"><span class="small muted spacer">${num(Math.round(it.unit_price / 10))} تومان × </span><input type="text" class="ltr" inputmode="decimal" data-a="qty" value="${esc(fa(it.qty))}" style="width:80px"> <span class="small">${esc(it.unit || "")} (حداکثر ${fa(it.qty)})</span></div></div>`).join("")}
      ${publicCode ? `<label>نام تأییدکننده</label><input type="text" data-field="name" placeholder="نام و نام خانوادگی">` : ""}
      <label>توضیح (اختیاری)</label><input type="text" data-field="note" placeholder="${publicCode ? "" : "مثلاً: تأیید تلفنی آقای ..."}">
      <div class="card doc-sum" data-field="sum"></div>
      <div class="actions"><button class="btn ok" data-act="save">تأیید پیش‌فاکتور</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      const rows = () => [...el.querySelectorAll("[data-ai]")].map((b) => ({ i: Number(b.dataset.ai), on: b.querySelector("[data-a=on]").checked, qty: Number(toEn(b.querySelector("[data-a=qty]").value).replace(/[^\d.]/g, "")) || 0 }));
      const calc = () => {
        const sel = rows().filter((r) => r.on && r.qty > 0).map((r) => ({ qty: r.qty, unit_price: p.items[r.i].unit_price }));
        const sub = sel.reduce((a, x) => a + Math.round(x.qty * x.unit_price), 0), d = p.subtotal ? Math.round(p.discount * sub / p.subtotal) : 0;
        const vat = p.vat_exempt ? 0 : Math.round((sub - d) * VAT_RATE / 100);
        el.querySelector('[data-field="sum"]').innerHTML = `<div class="row"><span class="spacer">مبلغ قابل پرداخت</span><b>${money(sub - d + vat)}</b></div><div class="small muted">اقلام ${money(sub)}${d ? ` · تخفیف ${money(d)}` : ""} · مالیات ${p.vat_exempt ? "معاف" : money(vat)}</div>`;
      };
      el.addEventListener("input", calc); el.addEventListener("change", calc); calc();
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const rs = rows();
        for (const r of rs) if (r.on && r.qty > Number(p.items[r.i].qty)) throw new Error("تعداد تأییدشده از پیش‌فاکتور بیشتر است");
        const sel = rs.filter((r) => r.on && r.qty > 0).map((r) => ({ i: r.i, qty: r.qty }));
        if (!sel.length) throw new Error("هیچ ردیفی تأیید نشده است");
        const note = el.querySelector('[data-field="note"]').value.trim() || null;
        if (publicCode) {
          const name = el.querySelector('[data-field="name"]').value.trim(); if (!name) throw new Error("نام خود را بنویسید");
          const r = await publicRpc("decide_proforma_by_code", { p_code: publicCode, p_approve: true, p_rows: sel, p_name: name, p_note: note });
          close(); onDone(r);
        } else {
          if (!confirm("پیش‌فاکتور از طرف کارفرما تأیید شود؟")) return;
          const inv = await rpc("decide_proforma", { p_id: p.id, p_approve: true, p_rows: sel, p_note: note });
          close(); onDone(inv);
        }
      }));
    });
  }

  // public page for the building manager: /?p=<code> or #/pf/<code>
  // D-99: approval link to the building manager right after a service is recorded (the morning job retries misses)
  function notifyServiceLink(id) { callFunction("notify-customers", { kind: "service", service_report_id: id }).catch(() => {}); }
  async function sendProformaSms(id) {
    const pre = await callFunction("notify-customers", { kind: "proforma", proforma_id: id, dry_run: true });
    sheet(`<h3>ارسال لینک پیش‌فاکتور با پیامک</h3>
      ${pre.test ? `<div class="hint">حالت آزمایشی: پیامک به شماره‌ی آزمایشی <bdi dir="ltr">${esc(fa(pre.to || ""))}</bdi> می‌رود.</div>` : ""}
      <label>شماره‌ی مدیر ساختمان</label><input type="text" data-field="mobile" class="ltr" inputmode="tel" value="${esc(fa(pre.intended || ""))}">
      <div class="card small" style="white-space:pre-line">${esc(pre.text)}</div>
      <div class="actions"><button class="btn" data-act="save">ارسال</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
      const r = await callFunction("notify-customers", { kind: "proforma", proforma_id: id, mobile: toEn(el.querySelector('[data-field="mobile"]').value.trim()) || null });
      close(); toast(`پیامک به ${fa(r.to)} فرستاده شد${r.test ? " (آزمایشی)" : ""}`);
    })));
  }
  async function viewPublicService(code) {
    $app.innerHTML = `<div class="loading">در حال بارگذاری…</div>`;
    let s;
    try { s = await publicRpc("get_service_by_code", { p_code: code }); } catch (e) {
      $app.innerHTML = `<div class="login-wrap"><div class="login-card"><h1>گزارش سرویس پیدا نشد</h1><p class="muted">لینک نادرست است. با دفتر پایاکو تماس بگیرید.</p></div></div>`; return;
    }
    const open = s.status === "pending_confirmation";
    const ST = { confirmed: ["تأیید شد", "ok"], rejected: ["رد شد", "danger"], pending_confirmation: ["منتظر تأیید شما", "warn"] };
    const stt = ST[s.status] || [s.status, ""];
    $app.innerHTML = `<main class="doc-page"><div class="card" style="max-width:560px;margin:12px auto">
      <div class="item-head"><div><img src="icons/logo.png" alt="پایاکو" style="height:44px"></div><span class="badge ${stt[1]}">${stt[0]}</span></div>
      <h2 style="margin:10px 0 4px">تأیید سرویس ماهانه‌ی آسانسور</h2>
      <dl class="kv"><dt>ساختمان</dt><dd>${esc(s.building || "")}</dd><dt>تاریخ سرویس</dt><dd>${jdate(s.date)}</dd>
        ${s.month ? `<dt>سرویس ماه</dt><dd>${MONTHS[s.month - 1]} ${fa(s.year)}</dd>` : ""}${s.technician ? `<dt>سرویس‌کار</dt><dd>${esc(s.technician)}</dd>` : ""}
        ${s.report_number ? `<dt>شماره برگه</dt><dd>${esc(fa(s.report_number))}</dd>` : ""}</dl>
      ${s.text ? `<div class="small muted" style="margin:6px 0">${txt(s.text)}</div>` : ""}
      ${open ? `<label>امتیاز شما به این سرویس</label><div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star" data-star="${n}">★</button>`).join("")}</div>
        <label>نام شما (اختیاری)</label><input type="text" data-field="name">
        <label>توضیح (برای رد یا امتیاز ۱ و ۲ ستاره لازم است)</label><textarea data-field="note"></textarea>
        <div class="actions"><button class="btn ok" data-act="sv-ok">تأیید انجام سرویس</button><button class="btn secondary" data-act="sv-no">سرویس انجام نشده / رد</button></div>`
        : `<div class="hint">${s.status === "confirmed" ? `این سرویس تأیید شده است${s.stars ? ` · امتیاز ${fa(s.stars)} از ۵` : ""}. سپاسگزاریم.` : s.status === "rejected" ? `این سرویس رد شده است${s.rejection_note ? ": " + esc(s.rejection_note) : ""}. همکاران ما پیگیری می‌کنند.` : ""}</div>`}
      ${s.company_phone ? `<div class="small muted" style="margin-top:10px">تماس با پایاکو: <a href="tel:${esc(toEn(s.company_phone))}" class="ltr">${esc(fa(s.company_phone))}</a></div>` : ""}
    </div></main>`;
    let stars = null;
    $app.onclick = (e) => {
      const st = e.target.closest(".star");
      if (st) { stars = Number(st.dataset.star); $app.querySelectorAll(".star").forEach((x) => x.classList.toggle("on", Number(x.dataset.star) <= stars)); return; }
      const a = e.target.closest("[data-act]"); if (!a) return;
      const name = ($app.querySelector('[data-field="name"]') || {}).value || null, note = ($app.querySelector('[data-field="note"]') || {}).value || null;
      if (a.dataset.act === "sv-ok") publicRpc("decide_service_by_code", { p_code: code, p_approve: true, p_stars: stars, p_note: note, p_name: name }).then(() => { toast("تأیید شد؛ سپاسگزاریم"); viewPublicService(code); }).catch((er) => toast(er.message));
      if (a.dataset.act === "sv-no") { if (!confirm("سرویس رد شود؟")) return; publicRpc("decide_service_by_code", { p_code: code, p_approve: false, p_stars: null, p_note: note, p_name: name }).then(() => { toast("ثبت شد؛ پیگیری می‌کنیم"); viewPublicService(code); }).catch((er) => toast(er.message)); }
    };
  }

  async function viewPublicProforma(code) {
    $app.innerHTML = `<div class="loading">در حال بارگذاری…</div>`;
    let p;
    try { p = await publicRpc("get_proforma_by_code", { p_code: code }); } catch (e) {
      $app.innerHTML = `<div class="login-wrap"><div class="login-card"><h1>پیش‌فاکتور پیدا نشد</h1><p class="muted">لینک نادرست است. با دفتر پایاکو تماس بگیرید.</p></div></div>`; return;
    }
    const st = pfState(p), open = p.status === "issued" && !p.expired;
    $app.innerHTML = `<main class="doc-page"><div class="pp-pages screen-doc"></div>
      <div class="actions no-print doc-actions">${open ? `<button class="btn ok" data-act="pub-pf-approve">تأیید پیش‌فاکتور</button><button class="btn secondary" data-act="pub-pf-reject">رد</button>` : `<span class="badge ${st[1]}">${st[0]}</span>`}
      <button class="btn secondary" data-act="doc-print">چاپ / ذخیره PDF</button></div>
      ${open ? `<div class="hint no-print">اعتبار تا ${jtime(p.valid_until)}. می‌توانید فقط بخشی از ردیف‌ها را تأیید کنید. پس از تأیید و پرداخت، فاکتور صادر و تعمیر انجام می‌شود.</div>` : ""}
      ${p.status === "approved" ? `<div class="hint">این پیش‌فاکتور در ${jtime(p.decided_at)} تأیید شد.</div>` : ""}</main>`;
    const host = $app.querySelector(".pp-pages"); host.style.setProperty("--z", String(Math.min(1, (window.innerWidth - 16) / 794)));
    renderProformaPages(host, p);
    $app.onclick = (e) => {
      const a = e.target.closest("[data-act]"); if (!a) return;
      if (a.dataset.act === "pub-pf-approve") sheetApproveProforma(p, () => { toast("تأیید شد؛ سپاسگزاریم"); viewPublicProforma(code); }, code);
      if (a.dataset.act === "pub-pf-reject") {
        const name = prompt("نام شما:"); if (!name) return;
        const note = prompt("دلیل رد (اختیاری):") || null;
        publicRpc("decide_proforma_by_code", { p_code: code, p_approve: false, p_rows: null, p_name: name, p_note: note }).then(() => { toast("رد شد"); viewPublicProforma(code); }).catch((er) => toast(er.message));
      }
      if (a.dataset.act === "doc-print") window.print();
    };
  }

  /* ------------------------------------------------------------------ installation projects (D-103, CEO only)
     step 1: project file + internal estimate + numbered price quotation (code 10) sent as a link and printed.
     Later steps (installation contract, procurement, installation, handover, service contract) attach to the project. */
  const IP_STAGE = { estimate: ["برآورد", "warn"], quoted: ["پیشنهاد داده شد", "info"], won: ["قرارداد بسته شد", "ok"], lost: ["از دست رفت", ""], cancelled: ["لغو", ""] };
  const IQ_STATE = (q, pstage) => pstage === "won" && q.status === "issued" ? ["پذیرفته شد (قرارداد)", "ok"] : q.status === "draft" ? ["پیش‌نویس", "warn"] : q.status === "cancelled" ? ["لغو", "danger"] : q.status === "superseded" ? ["جایگزین شد", ""]
    : (q.expired || (q.valid_until && new Date(q.valid_until) < new Date())) ? ["اعتبار تمام شد", ""] : ["معتبر", "ok"];
  const IQ_SPEC = { drive: ["کششی", "هیدرولیک"], room: ["موتورخانه‌دار", "بدون موتورخانه"], usage: ["مسافربر", "باربر", "تخت‌بر", "خودروبر"], speed: ["0.63", "1", "1.6", "2", "2.5"], susp: ["2:1", "1:1"] };
  const DOOR_TXT = ["", "تک درب", "دو درب", "سه درب"];
  const rangeTxt = (a, b) => (a && b && Number(a) !== Number(b) ? `${fa(a)} تا ${fa(b)}` : fa(a || b || ""));
  function iqIntro(s, pr) {
    const units = Number(s.units || 1);
    const parts = [s.drive, s.room, DOOR_TXT[Number(s.doors)] || "", s.stops ? `${fa(s.stops)} توقف` : ""].filter(Boolean).join(" – ");
    const cap = s.persons_from ? ` به ظرفیت ${rangeTxt(s.persons_from, s.persons_to)} نفر${s.kg_from ? `، معادل ${rangeTxt(s.kg_from, s.kg_to)} کیلوگرم` : ""}` : "";
    const sp = s.speed ? ` با سرعت نامی ${fa(String(s.speed).replace(".", "٫"))} متر بر ثانیه` : "";
    const su = s.susp && s.drive !== "هیدرولیک" ? ` و سیستم تعلیق ${fa(s.susp)}` : "";
    return `با سلام و آرزوی سلامتی، بدین‌وسیله قیمت فروش ${numWords(units)} دستگاه آسانسور ${parts} – ${s.usage || "مسافربر"}${cap}${sp}${su} جهت نصب در شهرستان ${pr.city || "اهواز"} (${pr.title || ""}) حضورتان اعلام می‌گردد.`;
  }
  const lines = (v) => String(v || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

  async function viewInstall() {
    const [ps, qs] = await Promise.all([api("install_projects?select=*&order=id.desc"), api("install_quotes?select=id,project_id,version,status,document_number,valid_until,options&order=version.desc")]);
    const latest = new Map(), drafts = new Set(); qs.forEach((q) => { if (q.status === "draft") drafts.add(q.project_id); else if (!latest.has(q.project_id)) latest.set(q.project_id, q); });
    const card = (p) => { const q = latest.get(p.id), st = IP_STAGE[p.stage] || [p.stage, ""];
      const prices = q ? (q.options || []).map((o) => Number(o.total_rial || o.amount_rial)) : [];
      return `<div class="card tap" data-act="go" data-href="#/install/${p.id}" data-s="${esc([p.install_code || "", p.title, p.client_name, p.address || ""].join(" "))}"><div class="item-head"><div><div class="item-title">${p.install_code ? `<span class="badge ok">کد ${fa(p.install_code)}</span> ` : ""}${esc(p.title)}</div>
        <div class="small muted">${esc(p.client_name)} · ${esc(p.city || "")}${q ? ` · پیشنهاد <bdi dir="ltr">${esc(fa(q.document_number || ""))}</bdi>` : ""}</div></div>
        <div style="text-align:left">${prices.length ? money(Math.min(...prices)) : ""}<span class="badge ${st[1]}">${st[0]}</span>${drafts.has(p.id) ? `<span class="badge warn">پیش‌نویس باز</span>` : ""}</div></div></div>`; };
    const ceo = role() === "CEO";
    const run = ps.filter((p) => p.stage === "won" || p.install_code), pre = ps.filter((p) => !run.includes(p) && ["estimate", "quoted"].includes(p.stage)), closed = ps.filter((p) => !run.includes(p) && !pre.includes(p));
    const grp = (t, list, empty) => `<div class="ip-grp">${list.length ? list.map(card).join("") : `<div class="card empty">${empty}</div>`}</div>`;
    let lt = ""; try { lt = sessionStorage.getItem("ip-ltab") || ""; } catch (e) { /* default */ }
    if (!["run", "pre", "lost"].includes(lt)) lt = run.length ? "run" : "pre";
    return shell("پروژه‌های نصب", "more", `<a href="#/more" data-act="back" class="small">→ بازگشت</a>
      <div class="page-actions">${ceo ? `<button class="btn" data-act="ip-new">+ پروژه‌ی نصب جدید</button>` : ""}<button class="btn secondary" data-act="go" data-href="#/install-matrix">پیشرفت فیزیکی پروژه‌ها</button>${ceo ? `<button class="btn secondary" data-act="ip-defaults">متن‌های پیش‌فرض پیشنهاد</button>` : ""}</div>
      <div class="hint">${ceo ? "پیشنهاد قیمت و مبلغ‌ها فقط برای مدیرعامل است؛ مدیر فنی پروژه‌ها و مراحل نصب را می‌بیند و ثبت می‌کند." : "مراحل نصب هر دستگاه را از صفحه‌ی پروژه ثبت کنید."} هر پروژه پرونده‌ی خودش را دارد: پیشنهاد قیمت، دستگاه‌ها، ۱۵ مرحله‌ی کنترل پروژه و صورتجلسه‌های تحویل کالا.</div>
      <div class="ip-find"><input type="search" id="ip-find" inputmode="search" placeholder="کد نصب (مثلاً ۱۶۰)، نام پروژه یا کارفرما" autocomplete="off"></div>
      ${ps.length ? `<div class="ip-tabs" role="tablist" data-ltab>${[["run", "پروژه‌های جاری", run], ["pre", "پیش از قرارداد", pre], ["lost", "قرارداد نشده", closed]].map(([x, l, li]) => `<button type="button" role="tab" data-tab="${x}" class="${x === lt ? "on" : ""}">${l} <span>${fa(li.length)}</span></button>`).join("")}</div>
        <div data-lpane="run"${lt === "run" ? "" : " hidden"}>${grp("", run.sort((x, y) => (x.install_code || 1e9) - (y.install_code || 1e9)), "هنوز قرارداد نصبی ثبت نشده")}</div>
        <div data-lpane="pre"${lt === "pre" ? "" : " hidden"}>${grp("", pre, "پروژه‌ای در مرحله‌ی پیش از قرارداد نیست")}</div>
        <div data-lpane="lost"${lt === "lost" ? "" : " hidden"}>${grp("", closed, "پیشنهاد قرارداد نشده‌ای نیست")}<div class="hint">پروژه‌هایی که «از دست رفت» یا «لغو» شده‌اند، با پیشنهادهای قیمتشان اینجا می‌مانند.</div></div>`
        : `<div class="card empty">هنوز پروژه‌ای ثبت نشده</div>`}`);
  }
  function bindInstallFind() {
    const bar = document.querySelector("[data-ltab]");
    if (bar) bar.addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (!b) return;
      bar.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", x === b));
      document.querySelectorAll("[data-lpane]").forEach((pn) => { pn.hidden = pn.dataset.lpane !== b.dataset.tab; });
      try { sessionStorage.setItem("ip-ltab", b.dataset.tab); } catch (er) { /* convenience */ } });
    const i = document.getElementById("ip-find"); if (!i) return;
    const go = () => { const q = toEn(i.value.trim()).toLowerCase(); const cards = [...document.querySelectorAll("[data-s]")];
      cards.forEach((c) => { c.hidden = !!q && !toEn(c.dataset.s).toLowerCase().includes(q); });
      const on = bar && bar.querySelector(".on");
      document.querySelectorAll("[data-lpane]").forEach((pn) => { pn.hidden = q ? !pn.querySelector("[data-s]:not([hidden])") : !!on && pn.dataset.lpane !== on.dataset.tab; });
      if (bar) bar.hidden = !!q; };
    i.addEventListener("input", go);
    i.addEventListener("keydown", (e) => { if (e.key !== "Enter") return; const q = toEn(i.value.trim()); const hit = [...document.querySelectorAll("[data-s]")].filter((c) => !c.hidden);
      const exact = /^\d+$/.test(q) && hit.find((c) => c.dataset.s.split(" ")[0] === q); const t = exact || (hit.length === 1 && hit[0]); if (t) location.hash = t.dataset.href; });
  }
  // client history by mobile (D-104): earlier projects/quotations for the same numbers and how many became contracts
  function historyHtml(h) {
    if (!h) return "";
    const t = h.totals || {};
    if (!t.projects && !h.service) return `<div class="hint">این شماره‌ها سابقه‌ای در سیستم ندارند (مشتری تازه).</div>`;
    const rate = t.projects ? Math.round((t.won / t.projects) * 100) : 0;
    const verdict = !t.projects ? "" : t.won ? `<span class="badge ok">${fa(t.won)} قرارداد از ${fa(t.projects)} پروژه (${fa(rate)}٪)</span>`
      : t.projects >= 2 ? `<span class="badge danger">${fa(t.projects)} پروژه، هیچ‌کدام قرارداد نشده</span>` : `<span class="badge warn">۱ پروژه‌ی قبلی، بدون قرارداد</span>`;
    return `<div class="card" style="border-color:var(--warn)"><div class="item-title">سابقه‌ی این مشتری</div>
      <div class="row" style="margin:4px 0">${verdict}${t.quotes ? `<span class="badge info">${fa(t.quotes)} پیشنهاد قیمت</span>` : ""}${t.lost ? `<span class="badge">${fa(t.lost)} از دست رفته</span>` : ""}${h.service ? `<span class="badge ok">مشترک سرویس فعال (${fa(h.service)} قرارداد)</span>` : ""}</div>
      ${(h.projects || []).slice(0, 6).map((x) => `<div class="small"><a href="#/install/${x.id}">${esc(x.title)}</a> · ${(IP_STAGE[x.stage] || [x.stage])[0]} · ${fa(x.quotes)} پیشنهاد${x.last_no ? ` · آخرین <bdi dir="ltr">${esc(fa(x.last_no))}</bdi>` : ""}${x.created_at ? ` · ${jdate(x.created_at)}` : ""}</div>`).join("")}</div>`;
  }
  const contactRow = (c, i) => `<div class="card" data-ct="${i}" style="background:var(--surface-2)"><div class="row"><input type="text" data-c="name" value="${esc(c.name || "")}" placeholder="${i ? "نام شریک" : "نام کارفرما / شریک اول"}" style="flex:2">
      <input type="text" data-c="role" value="${esc(c.role || (i ? "شریک" : "کارفرما"))}" placeholder="سمت" style="flex:1"></div>
      <div class="row" style="margin-top:6px"><input type="text" data-c="mobile" class="ltr" inputmode="tel" value="${esc(fa(c.mobile || ""))}" placeholder="موبایل ۰۹…" style="flex:1">${i ? `<button type="button" class="btn secondary small danger-text" data-ct-del>حذف</button>` : ""}</div></div>`;
  async function sheetInstallProject(p) {
    p = p || {};
    const contacts = p.id ? await api(`install_project_contacts?project_id=eq.${p.id}&active=eq.true&select=name,mobile,role&order=sort`) : [];
    const list = contacts.length ? contacts : [{ name: p.client_name || "", mobile: p.client_mobile || "", role: "کارفرما" }];
    sheet(`<h3>${p.id ? "ویرایش پروژه‌ی نصب" : "پروژه‌ی نصب جدید"}</h3>
      <label>نام پروژه</label><input type="text" data-f="title" value="${esc(p.title || "")}" placeholder="مثلاً: پروژه‌ی خیابان الهام">
      <label>کارفرما و شرکا</label><div class="hint">نفر اول گیرنده‌ی پیش‌فرض نامه و پیامک است. شماره‌ی همه را وارد کنید تا سابقه‌شان دیده شود.</div>
      <div id="ip-contacts">${list.map(contactRow).join("")}</div>
      <div class="actions"><button type="button" class="btn secondary small" data-ct-add>+ شریک دیگر</button></div>
      <div id="ip-history"></div>
      <label>شهر</label><input type="text" data-f="city" value="${esc(p.city || "اهواز")}">
      <label>نشانی پروژه</label><input type="text" data-f="address" value="${esc(p.address || "")}">
      <label>یادداشت داخلی</label><textarea data-f="notes">${esc(p.notes || "")}</textarea>
      <div class="actions"><button class="btn" data-act="save">ذخیره</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      const box = el.querySelector("#ip-contacts");
      const read = () => [...box.querySelectorAll("[data-ct]")].map((r) => ({ name: r.querySelector('[data-c="name"]').value.trim(), role: r.querySelector('[data-c="role"]').value.trim(), mobile: toEn(r.querySelector('[data-c="mobile"]').value.trim()) }));
      let ht = null, lastKey = "";
      const hist = () => { clearTimeout(ht); ht = setTimeout(async () => {
        const ms = read().map((c) => c.mobile.replace(/\D/g, "")).filter((m) => m.length >= 10), key = ms.join(",");
        if (key === lastKey) return; lastKey = key;
        el.querySelector("#ip-history").innerHTML = ms.length ? historyHtml(await rpc("install_client_history", { p_mobiles: ms, p_exclude_project: p.id || null }).catch(() => null)) : "";
      }, 500); };
      box.addEventListener("input", hist); hist();
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-ct-add]")) { box.insertAdjacentHTML("beforeend", contactRow({}, box.querySelectorAll("[data-ct]").length)); box.lastElementChild.querySelector('[data-c="name"]').focus(); }
        const d = e.target.closest("[data-ct-del]"); if (d) { d.closest("[data-ct]").remove(); hist(); }
      });
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const v = {}; el.querySelectorAll("[data-f]").forEach((i) => { v[i.dataset.f] = i.value.trim(); });
        v.contacts = read().filter((c) => c.name || c.mobile);
        const id = await rpc("save_install_project", { p_id: p.id || null, p: v });
        close(); toast("پروژه ذخیره شد"); location.hash = `#/install/${id}`; route();
      }));
    });
  }
  async function viewInstallProject(id) {
    const [[p], qs, cts] = await Promise.all([api(`install_projects?id=eq.${id}&select=*`), api(`install_quotes?project_id=eq.${id}&select=*&order=version.desc`),
      api(`install_project_contacts?project_id=eq.${id}&active=eq.true&select=name,mobile,role&order=sort`)]);
    if (!p) return shell("پروژه‌ی نصب", "more", `<div class="card empty">پیدا نشد</div>`);
    const mobs = cts.map((c) => c.mobile).filter(Boolean);
    const hist = mobs.length && role() === "CEO" ? await rpc("install_client_history", { p_mobiles: mobs, p_exclude_project: id }).catch(() => null) : null;
    const st = IP_STAGE[p.stage] || [p.stage, ""], draft = qs.find((q) => q.status === "draft"), ceo = role() === "CEO";
    const [ctl, ks, costs, rcs] = await Promise.all([loadControl(id), ceo ? api(`install_contracts?project_id=eq.${id}&active=eq.true&select=*`) : [],
      ceo ? api(`install_costs?project_id=eq.${id}&active=eq.true&select=*&order=spent_on.desc,id.desc`) : [],
      ceo ? api(`install_receipts?project_id=eq.${id}&active=eq.true&select=*&order=received_on.desc,id.desc`) : []]);
    const k = ks[0] || null;
    const qcard = (q) => { const s = IQ_STATE(q, p.stage);
      return `<div class="card tap" data-act="go" data-href="#/iq/${q.id}"><div class="item-head"><div><div class="item-title">${q.document_number ? `پیشنهاد <bdi dir="ltr">${esc(fa(q.document_number))}</bdi>` : "پیش‌نویس پیشنهاد"} · نسخه ${fa(q.version)}</div>
        <div class="small muted">${q.issued_at ? `صدور ${jtime(q.issued_at)} · اعتبار تا ${jtime(q.valid_until)}` : `آخرین تغییر ${jtime(q.updated_at)}`}</div>
        ${(q.options || []).map((o) => `<div class="small">${esc(o.label)}: ${money(o.total_rial || o.amount_rial)}</div>`).join("")}</div>
        <div style="text-align:left"><span class="badge ${s[1]}">${s[0]}</span>${ceo && q.status === "issued" && ["estimate", "quoted"].includes(p.stage) ? `<button class="btn small" data-act="iq-extend" data-id="${q.id}" data-h="${q.valid_hours || 24}">تمدید اعتبار</button>` : ""}</div></div></div>`; };
    const won = p.stage === "won" || !!k, closed = ["lost", "cancelled"].includes(p.stage);
    const headCard = `<div class="card"><div class="item-head"><div><div class="item-title">${esc(p.title)}${p.install_code ? ` <span class="badge ok">کد نصب ${fa(p.install_code)}</span>` : ""}</div>
        ${(cts.length ? cts : [{ name: p.client_name, mobile: p.client_mobile, role: "کارفرما" }]).map((c) => `<div class="small">${esc(c.name)}${c.role ? ` <span class="muted">(${esc(c.role)})</span>` : ""}${c.mobile ? ` · <a href="tel:${esc(c.mobile)}" class="ltr">${esc(fa(c.mobile))}</a>` : ""}</div>`).join("")}
        <div class="small muted">${esc(p.city || "")}${p.address ? " · " + esc(p.address) : ""}</div>${p.notes ? `<div class="small">${txt(p.notes)}</div>` : ""}</div><span class="badge ${st[1]}">${st[0]}</span></div>
        ${ceo && !won ? `<label>مرحله‌ی پروژه</label><div class="row"><select data-f="stage" style="flex:1">${Object.entries(IP_STAGE).filter(([x]) => x !== "won").map(([x, v]) => `<option value="${x}"${x === p.stage ? " selected" : ""}>${v[0]}</option>`).join("")}</select>
        <button class="btn secondary small" data-act="ip-stage" data-id="${id}">ثبت مرحله</button></div><div class="hint">«قرارداد بسته شد» با ثبت قرارداد نصب خودکار زده می‌شود.</div>` : ""}
        ${ceo ? `<div class="actions"><button class="btn secondary small" data-act="ip-edit" data-id="${id}">ویرایش اطلاعات</button>${won ? `<button class="btn small" data-act="ip-report" data-id="${id}">گزارش پروژه (چاپ / PDF)</button>` : ""}</div>`
          : won ? `<div class="actions"><button class="btn small" data-act="ip-report" data-id="${id}">گزارش پروژه (چاپ / PDF)</button></div>` : ""}</div>`;
    const quotes = `${!won && !closed ? `<div class="page-actions">${draft ? `<button class="btn" data-act="go" data-href="#/iq/${draft.id}">ادامه‌ی پیش‌نویس</button>` : `<button class="btn" data-act="iq-new" data-id="${id}">+ پیشنهاد قیمت جدید</button>`}</div>` : ""}
      ${qs.length ? qs.map(qcard).join("") : `<div class="card empty">هنوز برآوردی ثبت نشده</div>`}`;
    // D-109: a running contract has no new quotations or lead stages; its sections sit under their own switches
    const tabs = won ? [["prog", "پیشرفت و فرم‌ها", `${controlHtml(p, ctl, "schedule")}${controlHtml(p, ctl)}`], ["dlv", "تحویل کالا", controlHtml(p, ctl, "dlv")],
        ...(ceo ? [["money", "مالی", `${receiptsHtml(p, k, rcs)}${costsHtml(p, k, costs)}`], ["info", "قرارداد و سوابق", `${contractHtml(p, k)}
          ${qs.length ? `<details class="fold"><summary class="small">پیشنهادهای قیمت پیش از قرارداد (${fa(qs.length)})</summary>${qs.map(qcard).join("")}</details>` : ""}`]] : [])]
      : [...(ceo ? [["quote", closed ? "پیشنهادهای قیمت" : "برآورد و پیشنهاد قیمت", `${hist ? historyHtml(hist) : ""}${quotes}`]] : []),
        ...(ceo && !closed ? [["contract", "ثبت قرارداد", contractHtml(p, k)]] : [])];
    let cur = ""; try { cur = sessionStorage.getItem("ip-tab-" + id) || ""; } catch (e) { /* default */ }
    if (!tabs.some((t) => t[0] === cur)) cur = tabs.length ? tabs[0][0] : "";
    const bar = tabs.length > 1 ? `<div class="ip-tabs" role="tablist" data-ptab="${id}">${tabs.map((t) => `<button type="button" role="tab" data-tab="${t[0]}" class="${t[0] === cur ? "on" : ""}" aria-selected="${t[0] === cur}">${t[1]}</button>`).join("")}</div>` : "";
    return shell(p.title, "more", `<a href="#/install" data-act="back" class="small">→ بازگشت</a>
      ${headCard}${bar}${tabs.map((t) => `<div data-pane="${t[0]}"${t[0] === cur ? "" : " hidden"}>${t[2]}</div>`).join("")}
      ${!won && !ceo ? controlHtml(p, ctl) : ""}`);
  }
  function bindProjectTabs() {
    const bar = document.querySelector("[data-ptab]"); if (!bar) return;
    bar.addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (!b) return;
      bar.querySelectorAll("[data-tab]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", String(x === b)); });
      document.querySelectorAll("[data-pane]").forEach((pn) => { pn.hidden = pn.dataset.pane !== b.dataset.tab; });
      try { sessionStorage.setItem("ip-tab-" + bar.dataset.ptab, b.dataset.tab); } catch (er) { /* per-tab convenience */ } });
  }
  /* ------------------------------------------------------------------ installation project control (D-105)
     the 15-step workflow of PY-LI-PC-00 per elevator, physical progress (equal weights), scans of the signed
     paper forms, goods delivery records (G01). CEO and technical manager (REPAIR_MANAGER); prices stay CEO-only. */
  const canInstall = () => ["CEO", "REPAIR_MANAGER"].includes(role());
  const ST_STATE = { pending: ["شروع نشده", "", "mx-no"], in_progress: ["در جریان", "info", "mx-on"], approved: ["تأیید شد", "ok", "mx-ok"], rejected: ["عدم تأیید", "danger", "mx-bad"] };
  const unitPct = (defs, byCode) => { const w = defs.reduce((a, d) => a + Number(d.weight || 1), 0);
    const done = defs.filter((d) => (byCode[d.code] || {}).status === "approved").reduce((a, d) => a + Number(d.weight || 1), 0);
    return w ? Math.round((done * 100) / w) : 0; };
  const nextStage = (defs, byCode) => defs.find((d) => (byCode[d.code] || {}).status !== "approved");
  const unitName = (u) => `دستگاه ${u.label}${u.title ? ` — ${u.title}` : ""}`;
  async function uploadInstallFile(projectId, f) {
    if (f.size > 20 * 1024 * 1024) throw new Error("حجم فایل بیشتر از ۲۰ مگابایت است");
    const ext = (f.name.match(/\.([A-Za-z0-9]{1,5})$/) || [, "bin"])[1].toLowerCase();
    const rnd = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
    const path = `${projectId}/${Date.now()}-${rnd}.${ext}`;
    const t = await token();
    const res = await fetch(`${CFG.supabaseUrl}/storage/v1/object/install-files/${path}`, {
      method: "POST", headers: { apikey: CFG.supabaseKey, Authorization: `Bearer ${t}`, "Content-Type": f.type || "application/octet-stream", "x-upsert": "false" }, body: f });
    if (!res.ok) { let m = "بارگذاری ناموفق بود"; try { const d = await res.json(); m = d.message || d.error || m; } catch (er) { /* keep */ } throw new Error(/mime|type/i.test(m) ? "فقط PDF یا عکس مجاز است" : m); }
    return path;
  }
  async function loadControl(projectId) {
    const [defs, units] = await Promise.all([api("install_stage_defs?active=eq.true&select=*&order=sort"), api(`install_units?project_id=eq.${projectId}&active=eq.true&select=*&order=label`)]);
    const ids = units.map((u) => u.id).join(",");
    const [stages, files, dlv] = await Promise.all([ids ? api(`install_unit_stages?unit_id=in.(${ids})&select=*`) : [],
      api(`install_stage_files?project_id=eq.${projectId}&active=eq.true&select=*&order=id.desc`), api(`install_deliveries?project_id=eq.${projectId}&active=eq.true&select=*&order=delivered_on.desc,id.desc`)]);
    const by = {}; units.forEach((u) => { by[u.id] = {}; }); stages.forEach((s) => { if (by[s.unit_id]) by[s.unit_id][s.stage_code] = s; });
    return { defs, units, by, files, dlv };
  }
  // goods delivered for a stage that this elevator has not passed yet (delivered, not installed)
  const pendingGoods = (dlv, u, b) => dlv.filter((x) => x.stage_code && (!x.unit_id || x.unit_id === u.id) && (b[x.stage_code] || {}).status !== "approved");
  function controlHtml(p, c, part) {
    const fileCount = (uid, code) => c.files.filter((f) => f.unit_id === uid && f.stage_code === code).length;
    const unitCard = (u) => { const b = c.by[u.id], pct = unitPct(c.defs, b), nx = nextStage(c.defs, b);
      const rej = c.defs.filter((d) => (b[d.code] || {}).status === "rejected").length, pg = pendingGoods(c.dlv, u, b);
      return `<div class="card"><div class="pr-card unit-ring">${ringSvg(c.defs, b, pct, 104)}
          <div class="pr-t"><b>${esc(unitName(u))}</b><span class="small muted">${nx ? `مرحله‌ی جاری: ${fa(nx.code)} · ${esc(nx.title)}` : "همه‌ی مراحل تأیید شد"}</span>
          ${rej ? `<span class="badge danger">${fa(rej)} عدم تأیید</span>` : ""}${pg.length ? `<span class="badge warn">${fa(pg.length)} کالای نصب‌نشده</span>` : ""}</div></div>
        ${pg.length ? `<div class="goods-wait"><div class="small"><b>کالای تحویل‌شده، هنوز نصب‌نشده</b></div>${pg.map((x) => { const d = c.defs.find((y) => y.code === x.stage_code);
          return `<div class="small">${esc(lines(x.items)[0] || "")}${lines(x.items).length > 1 ? ` و ${fa(lines(x.items).length - 1)} قلم دیگر` : ""} · تحویل ${jdate(x.delivered_on)} · مرحله‌ی ${fa(x.stage_code)} (${esc(d ? d.title : "")}) ·
            ${x.pending_reason ? `علت: ${esc(x.pending_reason)}` : `<span class="debt">علت عدم نصب ثبت نشده</span>`}</div>`; }).join("")}</div>` : ""}
        <details class="fold"${nx ? "" : ""}><summary class="small">مراحل ۱۵گانه</summary>
          <div class="hint">روی هر مرحله بزنید تا فرم آنلاین آن باز شود؛ با ثبت نهایی فرم، مرحله و درصد پیشرفت به‌روز می‌شود.</div>
          ${c.defs.map((d) => { const s = b[d.code] || {}, st = ST_STATE[s.status || "pending"], n = fileCount(u.id, d.code);
            return `<div class="stg tap" data-act="go" data-href="#/iform/${u.id}/${d.code}"><span class="stg-no">${fa(d.code)}</span>
              <div class="stg-t"><div>${esc(d.title)}</div><div class="small muted">${s.visit_date ? jdate(s.visit_date) : ""}${s.inspector ? ` · ${esc(s.inspector)}` : ""}${n ? ` · ${fa(n)} فایل` : ""}</div>
              ${s.status === "rejected" && s.notes ? `<div class="small debt">${esc(s.notes)}</div>` : ""}</div><span class="badge ${st[1]}">${st[0]}</span></div>`; }).join("")}
        </details></div>`; };
    const dlvCard = (x) => { const u = c.units.find((y) => y.id === x.unit_id), n = c.files.filter((f) => f.delivery_id === x.id).length;
      const targets = u ? [u] : c.units, waiting = x.stage_code && targets.some((t) => (c.by[t.id][x.stage_code] || {}).status !== "approved");
      const st = !x.stage_code ? ["", ""] : waiting ? ["نصب نشده", "warn"] : ["نصب و تأیید شد", "ok"];
      return `<div class="card tap" data-act="ip-dlv" data-did="${x.id}"><div class="item-head"><div><div class="item-title">${jdate(x.delivered_on)}${u ? ` · دستگاه ${esc(u.label)}` : ""}${x.stage_code ? ` · مرحله‌ی ${fa(x.stage_code)}` : ""}</div>
        <div class="small">${txt(x.items)}</div><div class="small muted">${x.receiver ? `تحویل‌گیرنده: ${esc(x.receiver)}` : ""}${n ? ` · ${fa(n)} فایل` : ""}</div>
        ${waiting && x.pending_reason ? `<div class="small">علت عدم نصب: ${esc(x.pending_reason)}</div>` : ""}</div><div style="text-align:left"><span class="badge">G01</span>${st[0] ? `<span class="badge ${st[1]}">${st[0]}</span>` : ""}</div></div></div>`; };
    if (part === "schedule") return scheduleHtml(p, c);
    if (part === "dlv") return `${c.dlv.length ? c.dlv.map(dlvCard).join("") : `<div class="card empty">صورتجلسه‌ی تحویل کالایی ثبت نشده</div>`}
      <div class="page-actions"><button class="btn" data-act="ip-dlv" data-id="${p.id}">+ صورتجلسه‌ی تحویل کالا</button></div>`;
    return `<div class="section-title"><h2>کنترل پروژه و پیشرفت فیزیکی</h2><a href="#/install-matrix" class="small">پیشرفت همه‌ی پروژه‌ها</a></div>
      ${c.units.length ? c.units.map(unitCard).join("") : `<div class="card empty">هنوز دستگاهی برای این پروژه تعریف نشده. مراحل نصب برای هر دستگاه جدا ثبت می‌شود.</div>`}
      <div class="page-actions"><button class="btn${c.units.length ? " secondary" : ""}" data-act="ip-units" data-id="${p.id}">${c.units.length ? "ویرایش دستگاه‌ها" : "+ تعریف دستگاه‌ها"}</button></div>`;
  }
  async function sheetInstallUnits(projectId) {
    const units = await api(`install_units?project_id=eq.${projectId}&active=eq.true&select=*&order=label`);
    let list = units;
    if (!list.length) {
      const q = role() === "CEO" ? (await api(`install_quotes?project_id=eq.${projectId}&status=neq.draft&select=spec&order=version.desc&limit=1`))[0] : null;
      const n = Math.min(Math.max(Number((q && q.spec && q.spec.units) || 1), 1), 8);
      list = Array.from({ length: n }, (_, i) => ({ label: String.fromCharCode(65 + i), title: "" }));
    }
    const row = (u) => `<div class="row" data-un style="margin-top:6px"><input type="text" data-k="label" class="ltr" value="${esc(u.label || "")}" placeholder="A" style="width:64px;flex:none">
      <input type="text" data-k="title" value="${esc(u.title || "")}" placeholder="توضیح (مثلاً: آسانسور شرقی)" style="flex:1"><button type="button" class="btn secondary small danger-text" data-un-del>حذف</button></div>`;
    sheet(`<h3>دستگاه‌های پروژه</h3><div class="hint">مراحل نصب برای هر دستگاه جدا ثبت می‌شود (کابین A، B …). حذف یک دستگاه سابقه‌اش را پاک نمی‌کند.</div>
      <div id="un-list">${list.map(row).join("")}</div>
      <div class="actions"><button type="button" class="btn secondary small" data-un-add>+ دستگاه دیگر</button></div>
      <div class="actions"><button class="btn" data-act="save">ذخیره</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      const box = el.querySelector("#un-list");
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-un-add]")) { const used = [...box.querySelectorAll('[data-k="label"]')].map((i) => i.value.trim().toUpperCase());
          let k = 0; while (used.includes(String.fromCharCode(65 + k))) k++; box.insertAdjacentHTML("beforeend", row({ label: String.fromCharCode(65 + k) })); }
        const d = e.target.closest("[data-un-del]"); if (d && box.querySelectorAll("[data-un]").length > 1) d.closest("[data-un]").remove();
      });
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const us = [...box.querySelectorAll("[data-un]")].map((r) => ({ label: toEn(r.querySelector('[data-k="label"]').value.trim()), title: r.querySelector('[data-k="title"]').value.trim() }));
        const labels = us.map((u) => u.label.toUpperCase());
        if (labels.some((l, i) => labels.indexOf(l) !== i)) throw new Error("نام کوتاه دستگاه‌ها تکراری است");
        await rpc("save_install_units", { p_project: projectId, p: { units: us } });
        close(); toast("دستگاه‌ها ذخیره شد"); route();
      }));
    });
  }
  async function sheetInstallStage(projectId, unitId, code) {
    const [defs, [u], [s], files, ev] = await Promise.all([api("install_stage_defs?active=eq.true&select=*&order=sort"), api(`install_units?id=eq.${unitId}&select=*`),
      api(`install_unit_stages?unit_id=eq.${unitId}&stage_code=eq.${code}&select=*`), api(`install_stage_files?unit_id=eq.${unitId}&stage_code=eq.${code}&active=eq.true&select=*&order=id.desc`),
      api(`install_stage_events?unit_id=eq.${unitId}&stage_code=eq.${code}&select=*&order=id.desc&limit=20`)]);
    const all = await api(`install_unit_stages?unit_id=eq.${unitId}&select=stage_code,status`);
    const d = defs.find((x) => x.code === code), cur = s || {};
    const openBefore = defs.filter((x) => x.sort < d.sort && !all.some((r) => r.stage_code === x.code && r.status === "approved"));
    sheet(`<h3>${fa(d.code)} · ${esc(d.title)}</h3>
      <div class="small muted">${esc(unitName(u))} · فرم <bdi dir="ltr">${esc(d.form_code)}</bdi></div>
      ${openBefore.length ? `<div class="hint" style="color:var(--warn-ink)">مراحل پیش از این هنوز تأیید نشده‌اند: ${openBefore.map((x) => fa(x.code)).join("، ")}</div>` : ""}
      <label>وضعیت</label><select data-f="status">${Object.entries(ST_STATE).map(([k, v]) => `<option value="${k}"${k === (cur.status || "pending") ? " selected" : ""}>${v[0]}</option>`).join("")}</select>
      <label>تاریخ بازدید</label>${datePickerHtml("vd", cur.visit_date || toEn(todayTehran()))}
      <label>بازدیدکننده / ناظر</label><input type="text" data-f="inspector" value="${esc(cur.inspector || "")}">
      <label>شرح / اشکالات (برای «عدم تأیید» لازم است)</label><textarea data-f="notes" rows="3">${esc(cur.notes || "")}</textarea>
      <label>عکس یا اسکن فرم امضاشده (اختیاری)</label><input type="file" data-f="file" accept="application/pdf,image/*">
      ${files.length ? `<div class="small" style="margin-top:6px">${files.map((f) => `<a href="#" data-open="${esc(f.storage_path)}">${esc(f.file_name || "فایل")}</a> <span class="muted">${jdate(f.created_at)}</span>`).join("<br>")}</div>` : ""}
      <div class="actions"><button class="btn" data-act="save">ثبت</button><button class="btn secondary" data-close>انصراف</button></div>
      ${ev.length ? `<details class="fold"><summary class="small">سابقه‌ی تغییرات (${fa(ev.length)})</summary>${ev.map((x) => `<div class="small">${jtime(x.created_at)} · ${ST_STATE[x.status] ? ST_STATE[x.status][0] : esc(x.status)}${x.visit_date ? ` · بازدید ${jdate(x.visit_date)}` : ""}${x.notes ? ` · ${esc(x.notes)}` : ""}</div>`).join("")}</details>` : ""}`,
    (el, close) => {
      el.addEventListener("click", (e) => { const a = e.target.closest("[data-open]"); if (a) { e.preventDefault(); openFile(a.dataset.open, "install-files"); } });
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const status = el.querySelector('[data-f="status"]').value, notes = el.querySelector('[data-f="notes"]').value.trim();
        if (status === "rejected" && !notes) throw new Error("شرح اشکال (علت عدم تأیید) را بنویسید");
        if (status === "approved" && openBefore.length && !confirm(`مراحل ${openBefore.map((x) => fa(x.code)).join("، ")} هنوز تأیید نشده‌اند. با این حال این مرحله تأیید شود؟`)) return;
        const vd = readDate(el, "vd");
        if (status !== "pending" && vd > toEn(todayTehran())) throw new Error("تاریخ بازدید نمی‌تواند بعد از امروز باشد");
        const f = el.querySelector('[data-f="file"]').files[0];
        const path = f ? await uploadInstallFile(projectId, f) : null;
        await rpc("set_install_stage", { p_unit: unitId, p_code: code, p: { status, visit_date: status === "pending" ? null : vd, inspector: el.querySelector('[data-f="inspector"]').value.trim(), notes } });
        if (path) await rpc("add_install_file", { p: { project_id: projectId, unit_id: unitId, stage_code: code, storage_path: path, file_name: f.name, content_type: f.type || null, size_bytes: f.size } });
        close(); toast("مرحله ثبت شد"); route();
      }));
    });
  }
  async function sheetInstallDelivery(projectId, did) {
    const [defs, units, [x], files] = await Promise.all([api("install_stage_defs?active=eq.true&select=*&order=sort"), api(`install_units?project_id=eq.${projectId}&active=eq.true&select=*&order=label`),
      did ? api(`install_deliveries?id=eq.${did}&select=*`) : [null], did ? api(`install_stage_files?delivery_id=eq.${did}&active=eq.true&select=*`) : []]);
    const cur = x || {};
    sheet(`<h3>صورتجلسه‌ی تحویل کالا <bdi dir="ltr" class="small muted">PY-FO-PC-G01</bdi></h3>
      <label>تاریخ تحویل</label>${datePickerHtml("dd", cur.delivered_on || toEn(todayTehran()))}
      <label>دستگاه</label><select data-f="unit"><option value="">کل پروژه</option>${units.map((u) => `<option value="${u.id}"${u.id === cur.unit_id ? " selected" : ""}>${esc(unitName(u))}</option>`).join("")}</select>
      <label>اقلام تحویلی (هر قلم در یک خط)</label><textarea data-f="items" rows="5">${esc(cur.items || "")}</textarea>
      <label>این کالا در کدام مرحله نصب می‌شود؟</label><select data-f="stage"><option value="">— نامشخص —</option>${defs.map((d) => `<option value="${d.code}"${d.code === cur.stage_code ? " selected" : ""}>${fa(d.code)} · ${esc(d.title)}</option>`).join("")}</select>
      <label>اگر هنوز نصب نشده، چرا؟</label><input type="text" data-f="reason" value="${esc(cur.pending_reason || "")}" placeholder="مثلاً: چاه آماده نیست، منتظر جوشکاری کارفرما">
      <label>تحویل‌گیرنده (کارفرما یا نماینده‌اش)</label><input type="text" data-f="receiver" value="${esc(cur.receiver || "")}">
      <label>توضیح</label><input type="text" data-f="notes" value="${esc(cur.notes || "")}">
      <label>عکس یا اسکن صورتجلسه‌ی امضاشده (اختیاری)</label><input type="file" data-f="file" accept="application/pdf,image/*">
      ${files.length ? `<div class="small" style="margin-top:6px">${files.map((f) => `<a href="#" data-open="${esc(f.storage_path)}">${esc(f.file_name || "فایل")}</a>`).join("<br>")}</div>` : ""}
      <div class="actions"><button class="btn" data-act="save">ثبت</button>${did ? `<button class="btn secondary danger-text" data-act="off">حذف</button>` : ""}<button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      el.addEventListener("click", (e) => { const a = e.target.closest("[data-open]"); if (a) { e.preventDefault(); openFile(a.dataset.open, "install-files"); } });
      const body = (active) => ({ project_id: projectId, unit_id: el.querySelector('[data-f="unit"]').value ? Number(el.querySelector('[data-f="unit"]').value) : null, delivered_on: readDate(el, "dd"),
        items: el.querySelector('[data-f="items"]').value.trim(), stage_code: el.querySelector('[data-f="stage"]').value || null, pending_reason: el.querySelector('[data-f="reason"]').value.trim(), receiver: el.querySelector('[data-f="receiver"]').value.trim(), notes: el.querySelector('[data-f="notes"]').value.trim(), active });
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const b = body(true); if (!b.items) throw new Error("اقلام تحویلی را بنویسید");
        const f = el.querySelector('[data-f="file"]').files[0];
        const path = f ? await uploadInstallFile(projectId, f) : null;
        const id = await rpc("save_install_delivery", { p_id: did || null, p: b });
        if (path) await rpc("add_install_file", { p: { project_id: projectId, unit_id: b.unit_id, delivery_id: id, storage_path: path, file_name: f.name, content_type: f.type || null, size_bytes: f.size } });
        close(); toast("صورتجلسه ثبت شد"); route();
      }));
      const off = el.querySelector('[data-act="off"]');
      if (off) off.addEventListener("click", (e) => guarded(e.target, async () => { if (!confirm("این صورتجلسه حذف شود؟")) return; await rpc("save_install_delivery", { p_id: did, p: body(false) }); close(); toast("حذف شد"); route(); }));
    });
  }
  // D-105: installation contract (CEO), time-vs-progress chart, delivered-not-installed goods, project costs
  const COST_CAT = { goods: "خرید کالا", installer: "دستمزد نصاب", labor: "کارگر", transport: "باربری و حمل", side: "هزینه‌های جانبی", other: "سایر" };
  const addJMonths = (iso, m) => { const [y, mo, d] = iso.split("-").map(Number), j = g2j(y, mo, d); let jm = j.jm + m, jy = j.jy;
    while (jm > 12) { jm -= 12; jy++; } const g = j2g(jy, jm, Math.min(j.jd, jMonthLen(jy, jm))); return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`; };
  const dayDiff = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 86400000);
  // project progress over time = average of its elevators; each approval date is a step
  function progressSeries(defs, units, by) {
    const w = defs.reduce((a, d) => a + Number(d.weight || 1), 0), wt = Object.fromEntries(defs.map((d) => [d.code, Number(d.weight || 1)]));
    const ev = []; units.forEach((u) => Object.values(by[u.id] || {}).forEach((s) => { if (s.status === "approved" && s.visit_date) ev.push([s.visit_date, wt[s.stage_code] || 0]); }));
    ev.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    let acc = 0; const pts = [];
    ev.forEach(([d, x]) => { acc += x; const v = Math.round((acc * 100) / (w * units.length)); if (pts.length && pts[pts.length - 1][0] === d) pts[pts.length - 1][1] = v; else pts.push([d, v]); });
    return pts;
  }
  function scheduleHtml(p, c) {
    if (!p.start_on || !p.due_on || !c.units.length) return "";
    const today = toEn(todayTehran()), total = Math.max(dayDiff(p.start_on, p.due_on), 1), el = dayDiff(p.start_on, today);
    const timePct = Math.max(0, Math.min(100, Math.round((el * 100) / total))), left = dayDiff(today, p.due_on);
    const pcts = c.units.map((u) => unitPct(c.defs, c.by[u.id])), prog = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
    const gap = prog - timePct, tone = prog >= 100 ? "ok" : gap >= 0 ? "ok" : gap >= -15 ? "warn" : "danger";
    const end = today > p.due_on ? today : p.due_on, span = Math.max(dayDiff(p.start_on, end), 1);
    const W = 340, H = 170, L = 34, R = 10, T = 12, B = 26, X = (d) => L + ((W - L - R) * Math.max(0, dayDiff(p.start_on, d))) / span, Y = (v) => T + ((H - T - B) * (100 - v)) / 100;
    const pts = progressSeries(c.defs, c.units, c.by);
    let path = `M${X(p.start_on)},${Y(0)}`, last = 0; pts.forEach(([d, v]) => { path += ` H${X(d).toFixed(1)} V${Y(v).toFixed(1)}`; last = v; }); path += ` H${X(today > p.start_on ? today : p.start_on).toFixed(1)}`;
    const grid = [0, 50, 100].map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="ch-grid"/><text x="${L - 6}" y="${Y(v) + 4}" class="ch-ax" text-anchor="end">${fa(v)}٪</text>`).join("");
    const svg = `<svg viewBox="0 0 ${W} ${H}" class="ch" role="img" aria-label="پیشرفت ${fa(prog)} درصد در برابر زمان سپری‌شده ${fa(timePct)} درصد">${grid}
      <line x1="${X(p.start_on)}" y1="${Y(0)}" x2="${X(p.due_on)}" y2="${Y(100)}" class="ch-plan"><title>برنامه: پیشرفت خطی تا تحویل</title></line>
      <path d="${path}" class="ch-act"/>${pts.map(([d, v]) => `<circle cx="${X(d)}" cy="${Y(v)}" r="4" class="ch-dot"><title>${jdate(d)}: ${fa(v)}٪</title></circle>`).join("")}
      <line x1="${X(today)}" x2="${X(today)}" y1="${T}" y2="${H - B}" class="ch-today"/><text x="${X(today) + (X(today) > W / 2 ? -4 : 4)}" y="${T + 10}" class="ch-ax" text-anchor="${X(today) > W / 2 ? "end" : "start"}">امروز</text>
      <text x="${X(p.start_on)}" y="${H - 8}" class="ch-ax" text-anchor="start">${jdate(p.start_on)}</text>${today <= p.due_on || X(p.due_on) < X(today) - 40 ? `<text x="${X(p.due_on)}" y="${H - 8}" class="ch-ax" text-anchor="end">تحویل ${jdate(p.due_on)}</text>` : ""}</svg>`;
    return `<div class="card"><div class="item-head"><div><div class="item-title">زمان در برابر پیشرفت</div>
        <div class="small muted">شروع ${jdate(p.start_on)} · تحویل طبق قرارداد ${jdate(p.due_on)}</div></div>
        <span class="badge ${tone}">${prog >= 100 ? "تکمیل شد" : gap >= 0 ? "جلوتر از برنامه" : `${fa(-gap)}٪ عقب از برنامه`}</span></div>
      <div class="sched-nums"><div><b>${fa(prog)}٪</b><span>پیشرفت فیزیکی</span></div><div><b>${fa(timePct)}٪</b><span>زمان سپری‌شده (${fa(Math.max(el, 0))} از ${fa(total)} روز)</span></div>
        <div><b class="${left < 0 ? "debt" : ""}">${left >= 0 ? fa(left) : fa(-left)}</b><span>${left >= 0 ? "روز تا تحویل" : "روز تأخیر"}</span></div></div>
      ${svg}<div class="ch-legend small"><span><i class="lg-act"></i>پیشرفت واقعی</span><span><i class="lg-plan"></i>برنامه (خطی تا تحویل)</span></div></div>`;
  }
  function contractHtml(p, k) {
    if (role() !== "CEO") return "";
    if (!k) return `<div class="card"><div class="item-title">قرارداد نصب</div><div class="hint">با ثبت قرارداد، پروژه کد نصب می‌گیرد (اولین کد ۱۶۰) و نمودار زمان در برابر پیشرفت ساخته می‌شود.</div>
      <div class="actions"><button class="btn" data-act="ip-contract" data-id="${p.id}">+ ثبت قرارداد نصب</button></div></div>`;
    return `<div class="card"><div class="item-head"><div><div class="item-title">قرارداد نصب${k.contract_no ? ` <bdi dir="ltr">${esc(fa(k.contract_no))}</bdi>` : ""}</div>
        <div class="small">امضا ${jdate(k.signed_on)} · شروع ${jdate(k.start_on)} · مدت ${k.duration_months ? `${fa(k.duration_months)} ماه` : `${fa(k.duration_days)} روز`} · تحویل ${jdate(k.due_on)}</div>
        <div class="small">مبلغ قرارداد: <b>${money(k.amount_rial)}</b></div>${k.payment_terms ? `<div class="small muted">${txt(k.payment_terms)}</div>` : ""}</div><span class="badge ok">کد نصب ${fa(p.install_code)}</span></div>
      <div class="actions"><button class="btn secondary small" data-act="ip-contract" data-id="${p.id}">ویرایش قرارداد</button></div></div>`;
  }
  function costsHtml(p, k, costs) {
    if (role() !== "CEO") return "";
    const total = costs.reduce((a, x) => a + Number(x.amount_rial), 0), byCat = {};
    costs.forEach((x) => { byCat[x.category] = (byCat[x.category] || 0) + Number(x.amount_rial); });
    const profit = k ? Number(k.amount_rial) - total : null;
    return `<div class="section-title"><h2>هزینه‌ها و قیمت تمام‌شده</h2></div>
      <div class="card"><table class="list">
        ${Object.entries(COST_CAT).filter(([c]) => byCat[c]).map(([c, l]) => `<tr><td>${l}</td><td>${money(byCat[c])}</td></tr>`).join("")}
        <tr><td><b>قیمت تمام‌شده تا امروز</b></td><td><b>${money(total)}</b></td></tr>
        ${k ? `<tr><td>مبلغ قرارداد</td><td>${money(k.amount_rial)}</td></tr><tr><td><b>سود ناخالص پروژه</b>${k.amount_rial ? `<div class="small muted">${fa(String(Math.round((profit * 1000) / k.amount_rial) / 10).replace(".", "٫"))}٪ مبلغ قرارداد</div>` : ""}</td><td><b class="${profit < 0 ? "debt" : ""}">${money(profit)}</b></td></tr>` : ""}</table>
        ${k ? "" : `<div class="hint">برای محاسبه‌ی سود، قرارداد نصب را ثبت کنید.</div>`}
        <div class="hint">این هزینه‌ها فقط در پرونده‌ی پروژه ثبت می‌شوند و در حساب مشترکین سرویس اثری ندارند.</div></div>
      ${costs.slice(0, 30).map((x) => `<div class="card tap" data-act="ip-cost" data-cid="${x.id}"><div class="item-head"><div><div class="item-title">${esc(x.description)}</div>
        <div class="small muted">${COST_CAT[x.category] || x.category} · ${jdate(x.spent_on)}${x.payee ? ` · ${esc(x.payee)}` : ""}${x.invoice_no ? ` · فاکتور ${esc(fa(x.invoice_no))}` : ""}${x.lines ? ` · ${fa(x.lines.length)} ردیف` : ""}${x.storage_path ? " · فاکتور پیوست" : ""}</div></div><div>${money(x.amount_rial)}</div></div></div>`).join("")}
      <div class="page-actions"><button class="btn" data-act="ip-cost" data-id="${p.id}">+ ثبت هزینه</button></div>`;
  }
  async function sheetInstallContract(projectId) {
    const [[p], [k]] = await Promise.all([api(`install_projects?id=eq.${projectId}&select=*`), api(`install_contracts?project_id=eq.${projectId}&active=eq.true&select=*`)]);
    const cur = k || {}, today = toEn(todayTehran());
    sheet(`<h3>قرارداد نصب — ${esc(p.title)}</h3>
      ${p.install_code ? `<div class="small">کد نصب: <b>${fa(p.install_code)}</b></div>` : `<div class="hint">با ذخیره، این پروژه کد نصب بعدی را می‌گیرد.</div>`}
      <label>شماره‌ی قرارداد (اختیاری)</label><input type="text" data-f="contract_no" class="ltr" value="${esc(cur.contract_no || "")}">
      <label>تاریخ امضا</label>${datePickerHtml("sg", cur.signed_on || today)}
      <label>تاریخ شروع کار</label>${datePickerHtml("st", cur.start_on || cur.signed_on || today)}
      <label>مدت قرارداد (ماه)</label><input type="text" inputmode="numeric" class="ltr" data-f="months" value="${esc(fa(cur.duration_months || 4))}">
      <div class="hint" id="ct-due"></div>
      ${amountFieldHtml("ct", "مبلغ کل قرارداد")}
      <label>نحوه‌ی پرداخت (متن قرارداد)</label><textarea data-f="payment_terms" rows="4">${esc(cur.payment_terms || "")}</textarea>
      <label>یادداشت</label><input type="text" data-f="notes" value="${esc(cur.notes || "")}">
      <div class="actions"><button class="btn" data-act="save">ذخیره</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      bindAmount(el, "ct");
      if (cur.amount_rial) { el.querySelector('[data-unit="ct"] [data-u="rial"]').click(); const i = el.querySelector('[data-amount="ct"]'); i.value = String(cur.amount_rial); i.dispatchEvent(new Event("input")); }
      const due = () => { const m = Number(toEn(el.querySelector('[data-f="months"]').value).replace(/\D/g, "")); const s = readDate(el, "st");
        el.querySelector("#ct-due").textContent = m > 0 ? `تاریخ تحویل طبق قرارداد: ${jdate(addJMonths(s, m))}` : "مدت را به ماه وارد کنید"; return m > 0 ? addJMonths(s, m) : null; };
      el.addEventListener("change", due); el.querySelector('[data-f="months"]').addEventListener("input", due); due();
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        const m = Number(toEn(el.querySelector('[data-f="months"]').value).replace(/\D/g, "")), a = readAmount(el, "ct");
        if (!m) throw new Error("مدت قرارداد را وارد کنید"); if (!a.rial) throw new Error("مبلغ قرارداد را وارد کنید");
        const r = await rpc("save_install_contract", { p_project: projectId, p: { contract_no: el.querySelector('[data-f="contract_no"]').value.trim(), signed_on: readDate(el, "sg"), start_on: readDate(el, "st"),
          duration_months: m, due_on: due(), amount_rial: a.rial, payment_terms: el.querySelector('[data-f="payment_terms"]').value.trim(), notes: el.querySelector('[data-f="notes"]').value.trim() } });
        close(); toast(`قرارداد ثبت شد · کد نصب ${fa(r.install_code)}`); route();
      }));
    });
  }
  async function sheetInstallCost(projectId, cid) {
    const [units, [x]] = await Promise.all([api(`install_units?project_id=eq.${projectId}&active=eq.true&select=*&order=label`), cid ? api(`install_costs?id=eq.${cid}&select=*`) : [null]]);
    const cur = x || {}, multi = !!(cur.lines && cur.lines.length);
    sheet(`<h3>${cid ? "ویرایش هزینه" : "ثبت هزینه‌ی پروژه"}</h3>
      <label>نوع هزینه</label><select data-f="category">${Object.entries(COST_CAT).map(([k, v]) => `<option value="${k}"${k === cur.category ? " selected" : ""}>${v}</option>`).join("")}</select>
      <label>شرح</label><input type="text" data-f="description" value="${esc(cur.description || "")}" placeholder="مثلاً: فاکتور خرید ریل و براکت">
      <div class="row"><div style="flex:1"><label>فروشنده / دریافت‌کننده</label><input type="text" data-f="payee" value="${esc(cur.payee || "")}"></div>
        <div style="flex:1"><label>شماره فاکتور</label><input type="text" class="ltr" data-f="invoice_no" value="${esc(cur.invoice_no || "")}"></div></div>
      <label>تاریخ</label>${datePickerHtml("cd", cur.spent_on || toEn(todayTehran()))}
      ${units.length > 1 ? `<label>دستگاه</label><select data-f="unit"><option value="">کل پروژه</option>${units.map((u) => `<option value="${u.id}"${u.id === cur.unit_id ? " selected" : ""}>${esc(unitName(u))}</option>`).join("")}</select>` : ""}
      <label>نحوه‌ی ثبت فاکتور</label><div class="seg" data-f="mode"><button type="button" data-u="one" class="${multi ? "" : "on"}">ثبت یکجا (جمع فاکتور)</button><button type="button" data-u="multi" class="${multi ? "on" : ""}">ثبت ردیفی (اقلام فاکتور)</button></div>
      <div data-mode="one">${amountFieldHtml("cs", "مبلغ")}</div>
      <div data-mode="multi"><div id="cl-list">${(multi ? cur.lines : [{}]).map(costLineRow).join("")}</div>
        <div class="actions"><button type="button" class="btn secondary small" data-cl-add>+ ردیف</button></div><div class="hint" id="cl-total"></div></div>
      <label>عکس یا PDF فاکتور (اختیاری)</label><input type="file" data-f="file" accept="application/pdf,image/*">
      ${cur.storage_path ? `<div class="small"><a href="#" data-open="${esc(cur.storage_path)}">فاکتور پیوست‌شده</a></div>` : ""}
      <div class="actions"><button class="btn" data-act="save">ثبت</button>${cid ? `<button class="btn secondary danger-text" data-act="off">حذف</button>` : ""}<button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      bindAmount(el, "cs");
      if (cur.amount_rial && !multi) { el.querySelector('[data-unit="cs"] [data-u="rial"]').click(); const i = el.querySelector('[data-amount="cs"]'); i.value = String(cur.amount_rial); i.dispatchEvent(new Event("input")); }
      const seg = el.querySelector('[data-f="mode"]'), mode = () => seg.querySelector(".on").dataset.u, list = el.querySelector("#cl-list");
      const sync = () => { el.querySelector('[data-mode="one"]').hidden = mode() !== "one"; el.querySelector('[data-mode="multi"]').hidden = mode() !== "multi"; };
      const totals = () => { list.querySelectorAll("[data-cl]").forEach((r) => { const qty = Number(toEn(r.querySelector('[data-c="qty"]').value).replace(/[^\d.]/g, "")) || 0, pr = parseAmount(r.querySelector('[data-c="price"]').value);
          r.querySelector('[data-c="sum"]').textContent = qty && pr ? `جمع ردیف: ${num(Math.round(qty * pr))} تومان` : ""; });
        const t = readCostLines(el).reduce((a, l) => a + l.total_rial, 0); el.querySelector("#cl-total").textContent = t ? `جمع فاکتور: ${num(Math.round(t / 10))} تومان (${num(t)} ریال)` : ""; };
      seg.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; seg.querySelectorAll("button").forEach((y) => y.classList.toggle("on", y === b)); sync(); }); sync();
      list.addEventListener("input", (e) => { if (e.target.dataset.c === "price") { const v = parseAmount(e.target.value); e.target.value = v ? nf.format(v) : ""; } totals(); }); totals();
      el.addEventListener("click", (e) => {
        const a = e.target.closest("[data-open]"); if (a) { e.preventDefault(); openFile(a.dataset.open, "install-files"); }
        if (e.target.closest("[data-cl-add]")) { list.insertAdjacentHTML("beforeend", costLineRow({}, list.children.length)); list.lastElementChild.querySelector('[data-c="item"]').focus(); }
        const d = e.target.closest("[data-cl-del]"); if (d && list.children.length > 1) { d.closest("[data-cl]").remove(); totals(); }
      });
      const body = async (active) => { const u = el.querySelector('[data-f="unit"]'), f = el.querySelector('[data-f="file"]').files[0], ls = mode() === "multi" ? readCostLines(el) : [];
        return { project_id: projectId, unit_id: u && u.value ? Number(u.value) : null, category: el.querySelector('[data-f="category"]').value, description: el.querySelector('[data-f="description"]').value.trim(),
          payee: el.querySelector('[data-f="payee"]').value.trim(), invoice_no: el.querySelector('[data-f="invoice_no"]').value.trim(), spent_on: readDate(el, "cd"),
          lines: ls.length ? ls : null, amount_rial: ls.length ? ls.reduce((a, l) => a + l.total_rial, 0) : readAmount(el, "cs").rial, storage_path: f ? await uploadInstallFile(projectId, f) : null, active }; };
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        if (!el.querySelector('[data-f="description"]').value.trim()) throw new Error("شرح هزینه را بنویسید");
        if (mode() === "multi") { const ls = readCostLines(el); if (!ls.length) throw new Error("دست‌کم یک ردیف وارد کنید"); if (ls.some((l) => !l.item || !l.total_rial)) throw new Error("هر ردیف باید شرح، تعداد و فی داشته باشد"); }
        else if (!readAmount(el, "cs").rial) throw new Error("مبلغ را وارد کنید");
        await rpc("save_install_cost", { p_id: cid || null, p: await body(true) }); close(); toast("هزینه ثبت شد"); route();
      }));
      const off = el.querySelector('[data-act="off"]');
      if (off) off.addEventListener("click", (e) => guarded(e.target, async () => { if (!confirm("این هزینه حذف شود؟")) return; await rpc("save_install_cost", { p_id: cid, p: { ...(await body(false)), storage_path: null } }); close(); toast("حذف شد"); route(); }));
    });
  }
  // D-106: client receipts of an installation project (CEO only); project-file records, not the service ledger
  const RC_METHOD = { cash: "نقد", transfer: "واریز / کارت", cheque: "چک" };
  const RC_STATUS = { received: ["دریافت شد", "ok"], pending: ["چک در جریان", "warn"], cleared: ["چک وصول شد", "ok"], bounced: ["چک برگشتی", "danger"] };
  const chequeDue = (r) => r.method === "cheque" && r.status === "pending" && r.cheque_due && r.cheque_due <= toEn(todayTehran());
  function receiptsHtml(p, k, rcs) {
    if (role() !== "CEO") return "";
    const due = rcs.filter(chequeDue);
    const got = rcs.filter((r) => r.status === "received" || r.status === "cleared").reduce((a, r) => a + Number(r.amount_rial), 0);
    const pend = rcs.filter((r) => r.status === "pending").reduce((a, r) => a + Number(r.amount_rial), 0);
    const bounced = rcs.filter((r) => r.status === "bounced").reduce((a, r) => a + Number(r.amount_rial), 0);
    return `<div class="section-title"><h2>دریافتی‌های کارفرما</h2></div>
      ${due.length ? `<div class="card" style="border-color:var(--warn)"><div class="small"><b>${fa(due.length)} چک سررسید شده و وصولش ثبت نشده</b> — اگر پاس شده، «پاس شد» را بزنید؛ اگر برگشت خورده، چک را باز کنید و وضعیتش را «برگشتی» بگذارید.</div></div>` : ""}
      <div class="card"><table class="list"><tr><td>وصول‌شده (نقد، واریز، چک وصول‌شده)</td><td><b>${money(got)}</b></td></tr>
        ${pend ? `<tr><td>چک‌های در جریان</td><td>${money(pend)}</td></tr>` : ""}${bounced ? `<tr><td class="debt">چک برگشتی</td><td class="debt">${money(bounced)}</td></tr>` : ""}
        ${k ? `<tr><td><b>مانده‌ی طلب از قرارداد</b><div class="small muted">مبلغ قرارداد منهای وصول‌شده</div></td><td><b class="${Number(k.amount_rial) - got > 0 ? "debt" : ""}">${money(Number(k.amount_rial) - got)}</b></td></tr>` : ""}</table></div>
      ${rcs.map((r) => { const s = RC_STATUS[r.status] || [r.status, ""], od = chequeDue(r);
        return `<div class="card tap" data-act="ip-rc" data-rid="${r.id}"${od ? ' style="border-color:var(--warn)"' : ""}><div class="item-head"><div><div class="item-title">${money(r.amount_rial)} · ${RC_METHOD[r.method]}</div>
          <div class="small muted">${jdate(r.received_on)}${r.method === "cheque" ? ` · چک <bdi dir="ltr">${esc(fa(r.cheque_no || ""))}</bdi> سررسید ${jdate(r.cheque_due)}${r.bank ? ` · ${esc(r.bank)}` : ""}` : ""}${r.cleared_on ? ` · وصول ${jdate(r.cleared_on)}` : ""}${r.notes ? ` · ${esc(r.notes)}` : ""}</div></div>
          <div style="text-align:left"><span class="badge ${od ? "warn" : s[1]}">${od ? "سررسید شده، وصول ثبت نشده" : s[0]}</span>${r.status === "pending" ? `<button class="btn small" data-act="ip-rc-clear" data-rid="${r.id}">پاس شد</button>` : ""}</div></div></div>`; }).join("")}
      <div class="page-actions"><button class="btn" data-act="ip-rc" data-id="${p.id}">+ ثبت دریافت</button></div>`;
  }
  async function sheetChequeCleared(rid) {
    const [r] = await api(`install_receipts?id=eq.${rid}&select=*`);
    if (!r) throw new Error("چک پیدا نشد");
    sheet(`<h3>ثبت وصول چک</h3><div class="small">چک <bdi dir="ltr">${esc(fa(r.cheque_no || ""))}</bdi> · ${money(r.amount_rial)} · سررسید ${jdate(r.cheque_due)}</div>
      <label>تاریخ وصول (پاس شدن)</label>${datePickerHtml("cl", toEn(todayTehran()))}
      <div class="actions"><button class="btn" data-act="save">ثبت وصول</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
      await rpc("save_install_receipt", { p_id: rid, p: { project_id: r.project_id, method: r.method, amount_rial: r.amount_rial, received_on: r.received_on, cheque_no: r.cheque_no, cheque_due: r.cheque_due,
        bank: r.bank, notes: r.notes, status: "cleared", cleared_on: readDate(el, "cl"), storage_path: null, active: true } });
      close(); toast("وصول چک ثبت شد"); route(); })));
  }
  async function sheetInstallReceipt(projectId, rid) {
    const [x] = rid ? await api(`install_receipts?id=eq.${rid}&select=*`) : [null];
    const cur = x || { method: "cheque" }, today = toEn(todayTehran());
    sheet(`<h3>${rid ? "ویرایش دریافت" : "ثبت دریافت از کارفرما"}</h3>
      <label>نحوه‌ی پرداخت</label><div class="seg" data-f="method">${Object.entries(RC_METHOD).map(([k, v]) => `<button type="button" data-u="${k}" class="${k === cur.method ? "on" : ""}">${v}</button>`).join("")}</div>
      ${amountFieldHtml("rc", "مبلغ")}
      <label>تاریخ دریافت</label>${datePickerHtml("rd", cur.received_on || today)}
      <div data-cheque><label>شماره چک</label><input type="text" class="ltr" inputmode="numeric" data-f="cheque_no" value="${esc(cur.cheque_no || "")}">
        <label>تاریخ سررسید چک</label>${datePickerHtml("cd", cur.cheque_due || today)}
        <label>بانک</label><input type="text" data-f="bank" value="${esc(cur.bank || "")}">
        <label>وضعیت چک</label><select data-f="status">${["pending", "cleared", "bounced"].map((k) => `<option value="${k}"${k === cur.status ? " selected" : ""}>${RC_STATUS[k][0]}</option>`).join("")}</select></div>
      <label>توضیح</label><input type="text" data-f="notes" value="${esc(cur.notes || "")}" placeholder="مثلاً: پیش‌پرداخت، قسط پس از تحویل کابین">
      <label>عکس چک یا رسید (اختیاری)</label><input type="file" data-f="file" accept="application/pdf,image/*">
      ${cur.storage_path ? `<div class="small"><a href="#" data-open="${esc(cur.storage_path)}">فایل پیوست‌شده</a></div>` : ""}
      <div class="actions"><button class="btn" data-act="save">ثبت</button>${rid ? `<button class="btn secondary danger-text" data-act="off">حذف</button>` : ""}<button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => {
      bindAmount(el, "rc");
      if (cur.amount_rial) { el.querySelector('[data-unit="rc"] [data-u="rial"]').click(); const i = el.querySelector('[data-amount="rc"]'); i.value = String(cur.amount_rial); i.dispatchEvent(new Event("input")); }
      const seg = el.querySelector('[data-f="method"]'), sync = () => { el.querySelector("[data-cheque]").hidden = seg.querySelector(".on").dataset.u !== "cheque"; };
      seg.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; seg.querySelectorAll("button").forEach((y) => y.classList.toggle("on", y === b)); sync(); }); sync();
      el.addEventListener("click", (e) => { const a = e.target.closest("[data-open]"); if (a) { e.preventDefault(); openFile(a.dataset.open, "install-files"); } });
      const body = async (active) => { const m = seg.querySelector(".on").dataset.u, f = el.querySelector('[data-f="file"]').files[0];
        return { project_id: projectId, method: m, amount_rial: readAmount(el, "rc").rial, received_on: readDate(el, "rd"), cheque_no: m === "cheque" ? toEn(el.querySelector('[data-f="cheque_no"]').value.trim()) : null,
          cleared_on: cur.cleared_on || null, cheque_due: m === "cheque" ? readDate(el, "cd") : null, bank: m === "cheque" ? el.querySelector('[data-f="bank"]').value.trim() : null, status: m === "cheque" ? el.querySelector('[data-f="status"]').value : null,
          notes: el.querySelector('[data-f="notes"]').value.trim(), storage_path: f ? await uploadInstallFile(projectId, f) : null, active }; };
      el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
        if (!readAmount(el, "rc").rial) throw new Error("مبلغ را وارد کنید");
        await rpc("save_install_receipt", { p_id: rid || null, p: await body(true) }); close(); toast("دریافت ثبت شد"); route(); }));
      const off = el.querySelector('[data-act="off"]');
      if (off) off.addEventListener("click", (e) => guarded(e.target, async () => { if (!confirm("این دریافت حذف شود؟")) return; await rpc("save_install_receipt", { p_id: rid, p: { ...(await body(false)), storage_path: null } }); close(); toast("حذف شد"); route(); }));
    });
  }
  // cost invoice lines: item, qty, unit, unit price (toman in the form, stored in rial)
  const costLineRow = (l, i) => `<div class="cl-row" data-cl="${i}"><input type="text" data-c="item" value="${esc(l.item || "")}" placeholder="شرح کالا / خدمت">
    <div class="row"><input type="text" inputmode="decimal" class="ltr" data-c="qty" value="${esc(fa(l.qty ?? ""))}" placeholder="تعداد"><input type="text" data-c="unit" value="${esc(l.unit || "")}" placeholder="واحد">
    <input type="text" inputmode="numeric" class="ltr" data-c="price" value="${l.unit_price_rial ? nf.format(Math.round(l.unit_price_rial / 10)) : ""}" placeholder="فی (تومان)"></div>
    <div class="row cl-foot"><span class="small muted" data-c="sum"></span><button type="button" class="btn secondary small danger-text" data-cl-del>حذف ردیف</button></div></div>`;
  function readCostLines(el) {
    return [...el.querySelectorAll("[data-cl]")].map((r) => { const qty = Number(toEn(r.querySelector('[data-c="qty"]').value).replace(/[^\d.]/g, "")) || 0, price = parseAmount(r.querySelector('[data-c="price"]').value) * 10;
      return { item: r.querySelector('[data-c="item"]').value.trim(), qty, unit: r.querySelector('[data-c="unit"]').value.trim(), unit_price_rial: price, total_rial: Math.round(qty * price) }; }).filter((l) => l.item || l.total_rial);
  }
  /* ------------------------------------------------------------------ online control forms (D-106): forms.js holds the 15 forms as data */
  const FORMS = () => window.PAYACO_FORMS || {};
  const CHIPS = { qa: ["قابل قبول", "غیرقابل قبول"], q4: ["خوب", "متوسط", "ضعیف", "غیرقابل قبول"], yn: ["بله", "خیر"], rate5: ["عالی", "خوب", "متوسط", "ضعیف", "بسیار ضعیف"] };
  const FINAL_TXT = { approve: ["با توجه به بازدید انجام‌شده، عملکرد فوق مورد تأیید است.", "عملکرد فوق مورد تأیید نمی‌باشد."], well: ["چاه مورد تأیید است.", "چاه مورد تأیید نیست."] };
  const formDefects = (def, d) => { const out = [];
    def.sections.forEach((s) => s.f.forEach((x) => { const v = d[x.k];
      if ((x.t === "qa" || x.t === "q4") && v === "غیرقابل قبول") out.push(x.l);
      if (x.t === "yn" && v === "خیر" && /؟$/.test(x.l)) out.push(x.l.replace(/؟$/, "") + ": خیر"); })); return out; };
  function formFieldHtml(x, d, ro) {
    const v = d[x.k], dis = ro ? " disabled" : "";
    if (x.t === "note") return `<div class="if-note">${esc(x.l)}</div>`;
    const lab = x.l ? `<div class="if-l">${esc(x.l)}</div>` : "";
    if (x.t === "num") return `<div class="if-row">${lab}<div class="if-in"><input type="text" inputmode="decimal" class="ltr" data-k="${x.k}" value="${esc(fa(v ?? ""))}"${dis}>${x.u ? `<span class="if-u">${esc(x.u)}</span>` : ""}</div></div>`;
    if (x.t === "txt" || x.t === "date") return `<div class="if-row">${lab}<div class="if-in"><input type="text" data-k="${x.k}" value="${esc(v ?? "")}" placeholder="${esc(x.ph || (x.t === "date" ? "۱۴۰۵/۰۸/۱۱" : ""))}"${dis}></div></div>`;
    if (x.t === "area") return `<div class="if-row col">${lab}<textarea data-k="${x.k}" rows="3"${dis}>${esc(v ?? "")}</textarea></div>`;
    if (x.t === "opt" || CHIPS[x.t]) { const o = x.o || CHIPS[x.t];
      return `<div class="if-row${x.t === "rate5" || o.length > 3 ? " col" : ""}">${lab}<div class="if-chips" data-k="${x.k}" data-chip>${o.map((c) => `<button type="button" class="${v === c ? "on" : ""}${c === "غیرقابل قبول" || c === "بسیار ضعیف" ? " bad" : ""}" data-v="${esc(c)}"${dis}>${esc(c)}</button>`).join("")}</div></div>`; }
    if (x.t === "floors") { const n = Math.min(Math.max(Number(d[x.k + "_n"]) || Number(d.__stops) || 8, 1), 40), rows = d[x.k] || [];
      const cell = (r, c) => { const cv = (rows[r] || [])[c] ?? "";
        return x.o ? `<select data-k="${x.k}" data-r="${r}" data-c="${c}"${dis}><option value=""></option>${x.o.map((o) => `<option${o === cv ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`
          : `<input type="text" inputmode="decimal" class="ltr" data-k="${x.k}" data-r="${r}" data-c="${c}" value="${esc(fa(cv))}"${dis}>`; };
      return `<div class="if-row col"><div class="if-l">تعداد طبقات <input type="text" inputmode="numeric" class="ltr if-n" data-k="${x.k}_n" value="${fa(n)}"${dis}></div>
        <div class="if-tw"><table class="if-t"><thead><tr><th>طبقه</th>${Array.from({ length: n }, (_, c) => `<th>${fa(c + 1)}</th>`).join("")}</tr></thead>
        <tbody>${x.rows.map((rl, r) => `<tr><th>${esc(rl)}</th>${Array.from({ length: n }, (_, c) => `<td>${cell(r, c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`; }
    if (x.t === "list") { const a = Array.isArray(v) ? v : [];
      return `<div class="if-row col">${lab}${Array.from({ length: x.n }, (_, i) => `<div class="if-li"><span>${fa(i + 1)}</span><input type="text" data-k="${x.k}" data-i="${i}" value="${esc(a[i] || "")}" placeholder="${esc(x.ph || "")}"${dis}></div>`).join("")}</div>`; }
    if (x.t === "serials") { const a = v || {};
      return `<div class="if-row col">${x.rows.map((rl, r) => `<div class="if-ser"><b>${esc(rl)}</b><input type="text" data-k="${x.k}" data-r="${r}" data-p="b" value="${esc((a[r] || {}).b || "")}" placeholder="برند / مدل / مشخصات"${dis}>
        <input type="text" class="ltr" data-k="${x.k}" data-r="${r}" data-p="s" value="${esc((a[r] || {}).s || "")}" placeholder="شماره سریال"${dis}></div>`).join("")}</div>`; }
    return "";
  }
  function readFormData(root, def) {
    const d = {};
    root.querySelectorAll("[data-k]").forEach((el) => {
      const k = el.dataset.k;
      if (el.dataset.chip !== undefined) { const on = el.querySelector("button.on"); if (on) d[k] = on.dataset.v; return; }
      if (el.dataset.r !== undefined && el.dataset.c !== undefined) { d[k] = d[k] || []; (d[k][+el.dataset.r] = d[k][+el.dataset.r] || [])[+el.dataset.c] = toEn(el.value.trim()); return; }
      if (el.dataset.i !== undefined) { d[k] = d[k] || []; d[k][+el.dataset.i] = el.value.trim(); return; }
      if (el.dataset.p !== undefined) { d[k] = d[k] || {}; (d[k][el.dataset.r] = d[k][el.dataset.r] || {})[el.dataset.p] = el.value.trim(); return; }
      if (el.tagName === "BUTTON") return;
      const val = el.value.trim(); if (val !== "") d[k] = el.inputMode === "decimal" || el.inputMode === "numeric" ? toEn(val) : val;
    });
    Object.keys(d).forEach((k) => { if (Array.isArray(d[k]) && d[k].every((r) => typeof r === "string")) { while (d[k].length && !d[k][d[k].length - 1]) d[k].pop(); } });
    Object.keys(d).forEach((k) => { if (Array.isArray(d[k]) && d[k].every((r) => r === "" || r === undefined || (Array.isArray(r) && r.every((c) => !c)))) delete d[k]; });
    root.querySelectorAll("[data-sign]").forEach((el) => { if (el.value.trim()) (d.__signs = d.__signs || {})[el.dataset.sign] = el.value.trim(); });
    const fn = root.querySelector("[data-final-note]"); if (fn && fn.value.trim()) d.__note = fn.value.trim();
    const fr = root.querySelector("[data-final] button.on"); if (fr) d.__result = fr.dataset.v;
    return d;
  }
  async function loadFormCtx(unitId, code) {
    const [[u], forms, [def], files] = await Promise.all([api(`install_units?id=eq.${unitId}&select=*,install_projects(*)`), api(`install_forms?unit_id=eq.${unitId}&stage_code=eq.${code}&select=*&order=version.desc`),
      api(`install_stage_defs?code=eq.${code}&select=*`), api(`install_stage_files?unit_id=eq.${unitId}&stage_code=eq.${code}&active=eq.true&select=*&order=id.desc`)]);
    if (!u) throw new Error("دستگاه پیدا نشد");
    const p = u.install_projects || {};
    const [cts, k] = await Promise.all([api(`install_project_contacts?project_id=eq.${p.id}&active=eq.true&select=name,mobile&order=sort`),
      role() === "CEO" ? api(`install_contracts?project_id=eq.${p.id}&active=eq.true&select=contract_no,signed_on`) : []]);
    return { u, p, forms, stage: def, cts, k: k[0] || null, files };
  }
  async function viewInstallForm(unitId, code) {
    const def = FORMS()[code];
    if (!def) return shell("فرم کنترل پروژه", "more", `<div class="card empty">این فرم تعریف نشده است</div>`);
    const c = await loadFormCtx(unitId, code), f = c.forms[0], ro = f && f.status === "final", d = f ? { ...f.data } : {};
    if (!d.__stops) { const f01 = await api(`install_forms?unit_id=eq.${unitId}&stage_code=eq.01&select=data&order=version.desc&limit=1`).catch(() => []); if (f01[0] && f01[0].data && f01[0].data.stops) d.__stops = f01[0].data.stops; }
    const res = f && f.result ? (f.result === "approved" ? ["تأیید شد", "ok"] : ["عدم تأیید", "danger"]) : f ? ["پیش‌نویس", "warn"] : ["جدید", ""];
    const hdr = `<div class="card"><div class="item-head"><div><div class="item-title">${esc(def.title)}</div>
        <div class="small muted"><bdi dir="ltr">PY-FO-PC-${esc(code)}</bdi> · مرحله‌ی ${fa(Number(code))} از ۱۵ · ${esc(c.p.title || "")}${c.p.install_code ? ` · کد ${fa(c.p.install_code)}` : ""} · دستگاه ${esc(c.u.label)}</div>
        ${f ? `<div class="small muted">سریال فرم <bdi dir="ltr">${esc(fa(f.serial_no || ""))}</bdi> · نسخه ${fa(f.version)}${f.finalized_at ? ` · نهایی ${jtime(f.finalized_at)}` : ""}</div>` : ""}</div><span class="badge ${res[1]}">${res[0]}</span></div>
      ${ro ? "" : `<div class="small muted" id="if-saved">${f ? "پیش‌نویس ذخیره شده است" : "با اولین تغییر، پیش‌نویس ذخیره می‌شود"}</div>`}
      <div class="if-row"><div class="if-l">تاریخ بازدید</div>${ro ? `<b>${jdate(f.visit_date)}</b>` : datePickerHtml("ivd", (f && f.visit_date) || toEn(todayTehran()))}</div>
      <div class="if-row"><div class="if-l">بازدیدکننده</div><div class="if-in"><input type="text" data-iv="inspector" value="${esc((f && f.inspector) || "")}"${ro ? " disabled" : ""}></div></div></div>`;
    const body = def.sections.map((s) => `<div class="card">${s.t ? `<div class="item-title">${esc(s.t)}</div>` : ""}${s.f.map((x) => formFieldHtml(x, d, ro)).join("")}</div>`).join("");
    const signs = `<div class="card"><div class="item-title">امضا</div><div class="hint">نام امضاکنندگان؛ امضای کاغذی را می‌توانید عکس بگیرید و در «فایل‌های این مرحله» پیوست کنید.</div>
      ${def.signs.map((s, i) => `<div class="if-row"><div class="if-l">${esc(s)}</div><div class="if-in"><input type="text" data-sign="${i}" value="${esc((d.__signs || {})[i] || "")}"${ro ? " disabled" : ""}></div></div>`).join("")}</div>`;
    const ft = FINAL_TXT[def.final];
    const final = `<div class="card"><div class="item-title">${def.final === "done" ? "ثبت نهایی" : "تأیید نهایی"}</div>
      ${ft ? `<div class="if-chips col" data-final>${["approved", "rejected"].map((r, i) => `<button type="button" class="${(d.__result || (f && f.result)) === r ? "on" : ""}${i ? " bad" : ""}" data-v="${r}"${ro ? " disabled" : ""}>${esc(ft[i])}</button>`).join("")}</div>`
        : `<div class="hint">این فرم رد ندارد؛ با «ثبت نهایی» مرحله‌ی ${fa(Number(code))} انجام‌شده (تأییدشده) ثبت می‌شود.</div>`}
      <div id="if-defects" class="small"></div>
      <label>توضیحات${ft ? " (برای عدم تأیید، شرح اشکال لازم است)" : ""}</label><textarea data-final-note rows="3"${ro ? " disabled" : ""}>${esc(d.__note || "")}</textarea>
      <div class="actions">${ro ? `<button class="btn" data-act="if-print" data-u="${unitId}" data-c="${code}">چاپ فرم</button>${f.result === "rejected" || role() === "CEO" ? `<button class="btn secondary" data-act="if-new" data-u="${unitId}" data-c="${code}">بازدید مجدد (نسخه‌ی جدید)</button>` : ""}`
        : `<button class="btn" data-act="if-final" data-u="${unitId}" data-c="${code}">ثبت نهایی فرم</button><button class="btn secondary" data-act="if-print" data-u="${unitId}" data-c="${code}">پیش‌نمایش چاپ</button>`}</div></div>`;
    const older = c.forms.slice(1).map((x) => `<div class="small">نسخه ${fa(x.version)} · ${x.result === "approved" ? "تأیید" : x.result === "rejected" ? "عدم تأیید" : "پیش‌نویس"} · ${jdate(x.visit_date)}</div>`).join("");
    return shell(`فرم ${fa(code)} · ${esc(c.stage ? c.stage.title : "")}`, "more", `<a href="#/install/${c.p.id}" data-act="back" class="small">→ بازگشت به پرونده</a>
      ${def.intro ? `<div class="hint">${esc(def.intro)}</div>` : ""}
      <div id="if-form" data-u="${unitId}" data-c="${code}" data-ro="${ro ? 1 : ""}">${hdr}${body}${signs}${final}</div>
      <div class="card"><div class="item-title">فایل‌های این مرحله</div>
        ${c.files.length ? c.files.map((x) => `<div class="small"><a href="#" data-open-file="${esc(x.storage_path)}">${esc(x.file_name || "فایل")}</a> <span class="muted">${jdate(x.created_at)}</span></div>`).join("") : `<div class="small muted">فایلی پیوست نشده</div>`}
        <div class="actions"><button class="btn secondary small" data-act="ip-st" data-p="${c.p.id}" data-u="${unitId}" data-c="${code}">پیوست عکس فرم امضاشده / ثبت دستی وضعیت</button></div></div>
      ${older ? `<details class="fold"><summary class="small">نسخه‌های قبلی</summary>${older}</details>` : ""}`);
  }
  function bindInstallForm() {
    document.querySelectorAll("[data-open-file]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openFile(a.dataset.openFile, "install-files"); }));
    const root = document.getElementById("if-form"); if (!root || root.dataset.ro) return;
    const unitId = Number(root.dataset.u), code = root.dataset.c, def = FORMS()[code];
    let t = null, dirty = false, saving = null;
    const payload = () => ({ visit_date: readDate(root, "ivd"), inspector: root.querySelector('[data-iv="inspector"]').value.trim(), data: readFormData(root, def) });
    const showDefects = () => { const dd = formDefects(def, readFormData(root, def)), box = root.querySelector("#if-defects");
      box.innerHTML = dd.length ? `<div class="goods-wait"><b>${fa(dd.length)} مورد غیرقابل قبول:</b> ${dd.map(esc).join("؛ ")}</div>` : ""; };
    const save = async () => { if (root.dataset.locked) return; clearTimeout(t); dirty = false; const el = root.querySelector("#if-saved");
      try { saving = rpc("save_install_form", { p_unit: unitId, p_code: code, p: payload() }); await saving; if (el) el.textContent = "همه‌ی تغییرها ذخیره شده است"; }
      catch (e) { dirty = true; if (el) el.textContent = "ذخیره نشد: " + e.message; } finally { saving = null; } };
    const later = () => { dirty = true; const el = root.querySelector("#if-saved"); if (el) el.textContent = "در حال ذخیره…"; clearTimeout(t); t = setTimeout(save, 2000); showDefects(); };
    root.addEventListener("click", (e) => { const b = e.target.closest("[data-chip] button, [data-final] button"); if (!b || b.disabled) return;
      const g = b.parentElement, was = b.classList.contains("on"); g.querySelectorAll("button").forEach((x) => x.classList.remove("on")); if (!was) b.classList.add("on");
      if (e.target.closest("[data-final]") && b.dataset.v === "rejected") { const n = root.querySelector("[data-final-note]"); const dd = formDefects(def, readFormData(root, def)); if (!n.value.trim() && dd.length) n.value = dd.join("\n"); }
      later(); });
    root.addEventListener("input", later); root.addEventListener("change", (e) => { if (e.target.dataset.k && e.target.dataset.k.endsWith("_n")) { save().then(route); return; } later(); });
    const flush = () => { if (dirty) save(); };
    window.addEventListener("hashchange", flush, { once: true }); window.addEventListener("pagehide", flush, { once: true });
    root.__flush = async () => { if (saving) await saving; if (dirty) await save(); };
    root.__payload = payload;
    showDefects();
  }
  async function finalizeInstallForm(unitId, code) {
    const root = document.getElementById("if-form"), def = FORMS()[code];
    if (root.__flush) await root.__flush();
    const d = readFormData(root, def), note = d.__note || "";
    const result = def.final === "done" ? "approved" : d.__result;
    if (!result) throw new Error("نتیجه را انتخاب کنید: تأیید یا عدم تأیید");
    if (result === "rejected" && !note) throw new Error("شرح اشکال را در «توضیحات» بنویسید");
    const dd = formDefects(def, d);
    if (result === "approved" && dd.length && !confirm(`${fa(dd.length)} مورد «غیرقابل قبول» در فرم هست. با این حال تأیید شود؟`)) return;
    if (!confirm("فرم نهایی شود؟ پس از ثبت نهایی ویرایش نمی‌شود و وضعیت مرحله و پیشرفت پروژه به‌روز می‌شود.")) return;
    root.dataset.locked = "1";
    const [f] = await api(`install_forms?unit_id=eq.${unitId}&stage_code=eq.${code}&status=eq.draft&select=id`);
    let id = f && f.id;
    if (!id) id = await rpc("save_install_form", { p_unit: unitId, p_code: code, p: root.__payload() });
    await rpc("finalize_install_form", { p_id: id, p_result: result, p_notes: note || null });
    toast(result === "approved" ? "فرم نهایی شد · مرحله تأیید شد" : "فرم نهایی شد · مرحله «عدم تأیید» ثبت شد"); route();
  }
  async function printInstallForm(unitId, code) {
    const def = FORMS()[code], root = document.getElementById("if-form");
    if (root && root.__flush) await root.__flush();
    const [c, company] = await Promise.all([loadFormCtx(unitId, code), rpc("get_company_profile")]);
    const f = c.forms[0] || {}, d = f.data || {}, val = (x) => d[x.k];
    const cellv = (v) => (v === undefined || v === null || v === "" ? "<span class=\"if-blank\"></span>" : esc(fa(v)));
    const fieldP = (x) => {
      if (x.t === "note") return `<p class="if-pn">${esc(x.l)}</p>`;
      if (x.t === "floors") { const rows = val(x) || [], n = Math.max(Number(d[x.k + "_n"]) || 8, 1);
        return `<table class="if-pt"><tr><th>طبقه</th>${Array.from({ length: n }, (_, i) => `<th>${fa(i + 1)}</th>`).join("")}</tr>${x.rows.map((rl, r) => `<tr><th>${esc(rl)}</th>${Array.from({ length: n }, (_, i) => `<td>${cellv((rows[r] || [])[i])}</td>`).join("")}</tr>`).join("")}</table>`; }
      if (x.t === "list") { const a = (val(x) || []).filter(Boolean); return `<table class="if-pt">${(a.length ? a : [""]).map((v, i) => `<tr><td class="n">${fa(i + 1)}</td><td>${cellv(v)}</td></tr>`).join("")}</table>`; }
      if (x.t === "serials") { const a = val(x) || {}; return `<table class="if-pt"><tr><th>ردیف</th><th>قطعه</th><th>برند / مدل / مشخصات</th><th>شماره سریال</th></tr>${x.rows.map((rl, r) => `<tr><td class="n">${fa(r + 1)}</td><td>${esc(rl)}</td><td>${cellv((a[r] || {}).b)}</td><td class="ltr">${cellv((a[r] || {}).s)}</td></tr>`).join("")}</table>`; }
      if (x.t === "qa" || x.t === "q4" || x.t === "rate5" || x.t === "yn" || x.t === "opt") { const o = x.o || CHIPS[x.t];
        return `<div class="if-pr"><span>${esc(x.l)}</span><span class="if-po">${o.map((c2) => `<i class="${val(x) === c2 ? "on" : ""}">${val(x) === c2 ? "☑" : "☐"} ${esc(c2)}</i>`).join("")}</span></div>`; }
      return `<div class="if-pr"><span>${esc(x.l)}</span><b>${cellv(val(x))}${x.u && val(x) ? ` ${esc(x.u)}` : ""}</b></div>`;
    };
    const ct = c.cts[0] || {};
    const head = `<div class="if-ph"><h1>${esc(def.title)}</h1><div class="small">سامانه کنترل پروژه · مرحله‌ی گردش کار ${fa(Number(code))} از ۱۵ · شماره سریال فرم: <bdi dir="ltr">${esc(fa(f.serial_no || "—"))}</bdi></div></div>
      <table class="if-pt if-meta"><tr><td>نام پروژه و کارفرما: <b>${esc(c.p.title || "")} — ${esc(c.p.client_name || "")}</b></td><td>آدرس پروژه: <b>${esc(fa(c.p.address || ""))}</b></td></tr>
      <tr><td>کد پروژه: <b>${c.p.install_code ? fa(c.p.install_code) : "—"}</b> · دستگاه ${esc(c.u.label)}</td><td>تلفن: <b class="ltr">${esc(fa(ct.mobile || c.p.client_mobile || ""))}</b></td></tr>
      <tr><td>شماره قرارداد: <b>${esc(fa((c.k && c.k.contract_no) || "—"))}</b></td><td>تاریخ بازدید: <b>${f.visit_date ? jdate(f.visit_date) : "—"}</b>${f.inspector ? ` · بازدیدکننده: <b>${esc(f.inspector)}</b>` : ""}</td></tr></table>
      ${def.intro ? `<p class="if-pn">${esc(def.intro)}</p>` : ""}`;
    let sn = 0;
    const blocks = def.sections.map((s) => ({ html: `<div class="if-ps">${s.t ? `<h3><span>${fa(++sn)}</span>${esc(s.t)}</h3>` : ""}${s.f.map(fieldP).join("")}</div>`, fit: true }));
    const ft = FINAL_TXT[def.final];
    blocks.push(`<div class="if-ps"><h3><span>${fa(sn + 1)}</span>${def.final === "done" ? "ثبت" : "تأیید نهایی"}</h3>
      ${ft ? `<div class="if-pr"><span class="if-po">${["approved", "rejected"].map((r, i) => `<i class="${f.result === r ? "on" : ""}">${f.result === r ? "☑" : "☐"} ${esc(ft[i])}</i>`).join("")}</span></div>` : ""}
      <div class="if-pr"><span>توضیحات:</span><b>${d.__note ? esc(d.__note).replace(/\n/g, "<br>") : ""}</b></div></div>`);
    blocks.push(`<div class="if-psig">${def.signs.map((s, i) => `<div><div>${esc(s)}</div><b>${esc((d.__signs || {})[i] || "")}</b><span>تاریخ و امضا</span></div>`).join("")}</div>`);
    openPrint(`فرم ${fa(code)} · ${def.title}`, (host) => paginate(host, { no: fa(f.serial_no || "—"), date: f.visit_date ? jdate(f.visit_date) : jdate(todayTehran()), form: `PY-FO-PC-${code}`, rev: 0, issued: "۱۴۰۵/۰۷/۲۸" },
      company || {}, head, blocks, { draft: f.status !== "final" }));
  }
  // D-108: graphic progress — a ring of the 15 stages (colour = status) with the percentage in the middle
  const RING_HEX = { pending: "#d9e1dc", in_progress: "#1d4ed8", approved: "#047857", rejected: "#b91c1c" };
  function ringSvg(defs, by, pct, size = 112, hex = false) {
    const r = 42, C = 2 * Math.PI * r, n = defs.length || 15, seg = C / n, gap = Math.min(3, seg * 0.25);
    const arcs = defs.map((d, i) => { const st = (by[d.code] || {}).status || "pending";
      return `<circle cx="50" cy="50" r="${r}" fill="none" stroke-width="11" ${hex ? `stroke="${RING_HEX[st]}"` : `class="rg-${st}"`} stroke-dasharray="${(seg - gap).toFixed(2)} ${(C - seg + gap).toFixed(2)}"
        stroke-dashoffset="${(-(i * seg)).toFixed(2)}" transform="rotate(-90 50 50)"><title>${fa(d.code)} · ${esc(d.title)}: ${ST_STATE[st][0]}</title></circle>`; }).join("");
    return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" class="ring" role="img" aria-label="پیشرفت ${fa(pct)} درصد">${arcs}
      <text x="50" y="49" text-anchor="middle" class="ring-v"${hex ? ' fill="#0f172a"' : ""}>${fa(pct)}٪</text><text x="50" y="63" text-anchor="middle" class="ring-l"${hex ? ' fill="#4b5a6b"' : ""}>پیشرفت</text></svg>`;
  }
  const timeInfo = (p, prog) => { if (!p.start_on || !p.due_on) return null; const today = toEn(todayTehran()), total = Math.max(dayDiff(p.start_on, p.due_on), 1), el = Math.max(dayDiff(p.start_on, today), 0);
    const tp = Math.min(100, Math.round((el * 100) / total)), left = dayDiff(today, p.due_on), gap = prog - tp;
    return { tp, left, total, el, gap, txt: prog >= 100 ? "تکمیل شد" : gap >= 0 ? "طبق برنامه یا جلوتر" : `${fa(-gap)}٪ عقب از برنامه`, tone: prog >= 100 || gap >= 0 ? "ok" : gap >= -15 ? "warn" : "danger" }; };
  async function sheetInstallReport(projectId) {
    if (role() !== "CEO") return printInstallReport(projectId, false);
    sheet(`<h3>گزارش وضعیت پروژه</h3><div class="hint">گزارش آماده‌ی چاپ یا PDF روی سربرگ.</div>
      <div class="actions"><button class="btn" data-r="client">برای کارفرما (با قرارداد، پرداخت‌ها و مانده؛ بدون هزینه و سود)</button></div>
      <div class="actions"><button class="btn secondary" data-r="internal">داخلی (به‌علاوه‌ی هزینه‌ها و سود)</button></div>
      <div class="actions"><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => el.addEventListener("click", (e) => { const b = e.target.closest("[data-r]"); if (!b) return; close(); printInstallReport(projectId, b.dataset.r === "internal").catch((er) => toast(er.message)); }));
  }
  async function printInstallReport(projectId, internal) {
    const ceo = role() === "CEO";
    const [[p], c, cts, ks, rcs, costs, company] = await Promise.all([api(`install_projects?id=eq.${projectId}&select=*`), loadControl(projectId),
      api(`install_project_contacts?project_id=eq.${projectId}&active=eq.true&select=name,mobile,role&order=sort`),
      ceo ? api(`install_contracts?project_id=eq.${projectId}&active=eq.true&select=*`) : [], ceo ? api(`install_receipts?project_id=eq.${projectId}&active=eq.true&select=*&order=received_on`) : [],
      internal ? api(`install_costs?project_id=eq.${projectId}&active=eq.true&select=*`) : [], rpc("get_company_profile")]);
    const k = ks[0] || null, pcts = c.units.map((u) => unitPct(c.defs, c.by[u.id])), prog = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0, ti = timeInfo(p, prog);
    const kv = (l, v) => `<div class="rp-kv"><span>${l}</span><b>${v}</b></div>`;
    const head = `<div class="rp-h"><div><h1>گزارش وضعیت پروژه${p.install_code ? ` · کد نصب ${fa(p.install_code)}` : ""}</h1>
        <div class="small">${esc(p.title)} · ${esc((cts[0] || {}).name || p.client_name || "")}${cts.length > 1 ? ` و ${fa(cts.length - 1)} شریک` : ""} · ${esc(fa(p.address || p.city || ""))}</div>
        <div class="small">تاریخ گزارش: ${jdate(todayTehran())}${internal ? " · نسخه‌ی داخلی" : ""}</div></div></div>
      <div class="rp-sum">${ringSvg(c.defs, Object.fromEntries(c.defs.map((d) => { const ss = c.units.map((u) => (c.by[u.id][d.code] || {}).status || "pending");
        return [d.code, { status: ss.length && ss.every((x) => x === "approved") ? "approved" : ss.includes("rejected") ? "rejected" : ss.some((x) => x !== "pending") ? "in_progress" : "pending" }]; })), prog, 120, true)}
        <div class="rp-grid">${kv("پیشرفت فیزیکی", `${fa(prog)}٪`)}${ti ? kv("زمان سپری‌شده", `${fa(ti.tp)}٪ (${fa(ti.el)} از ${fa(ti.total)} روز)`) + kv(ti.left >= 0 ? "روز تا تحویل" : "روز تأخیر", fa(Math.abs(ti.left))) + kv("وضعیت نسبت به برنامه", ti.txt) : ""}
          ${p.start_on ? kv("شروع", jdate(p.start_on)) : ""}${p.due_on ? kv("تحویل طبق قرارداد", jdate(p.due_on)) : ""}${kv("تعداد دستگاه", fa(c.units.length))}</div></div>`;
    const blocks = [];
    c.units.forEach((u, i) => { const b = c.by[u.id], pg = pendingGoods(c.dlv, u, b), rej = c.defs.filter((d) => (b[d.code] || {}).status === "rejected");
      blocks.push({ html: `<div class="rp-unit"><div class="rp-uh">${ringSvg(c.defs, b, pcts[i], 84, true)}<div><h3>${esc(unitName(u))}</h3><div class="small">${(() => { const nx = nextStage(c.defs, b); return nx ? `مرحله‌ی جاری: ${fa(nx.code)} · ${esc(nx.title)}` : "همه‌ی مراحل تأیید شد"; })()}</div></div></div>
        <table class="if-pt rp-st">${c.defs.map((d) => { const s = b[d.code] || {}, st = s.status || "pending";
          return `<tr><td class="n">${fa(d.code)}</td><td style="text-align:right">${esc(d.title)}</td><td><i class="rp-dot" style="background:${RING_HEX[st]}"></i>${ST_STATE[st][0]}</td><td>${s.visit_date ? jdate(s.visit_date) : ""}</td></tr>`; }).join("")}</table>
        ${rej.length ? `<div class="rp-note"><b>اشکالات باز:</b> ${rej.map((d) => `${fa(d.code)} — ${esc((b[d.code] || {}).notes || "")}`).join("؛ ")}</div>` : ""}
        ${pg.length ? `<div class="rp-note"><b>کالای تحویل‌شده، هنوز نصب‌نشده:</b> ${pg.map((x) => `${esc(lines(x.items)[0] || "")} (تحویل ${jdate(x.delivered_on)}، مرحله‌ی ${fa(x.stage_code)}${x.pending_reason ? `، علت: ${esc(x.pending_reason)}` : ""})`).join("؛ ")}</div>` : ""}</div>`, fit: true }); });
    if (c.dlv.length) blocks.push(`<div class="if-ps"><h3><span>G</span>صورتجلسه‌های تحویل کالا</h3><table class="if-pt">${c.dlv.map((x) => `<tr><td>${jdate(x.delivered_on)}</td><td style="text-align:right">${esc(lines(x.items).join("، "))}</td><td>${x.receiver ? esc(x.receiver) : ""}</td></tr>`).join("")}</table></div>`);
    if (ceo && (k || rcs.length)) {
      const got = rcs.filter((r) => r.status === "received" || r.status === "cleared").reduce((a, r) => a + Number(r.amount_rial), 0), pend = rcs.filter((r) => r.status === "pending").reduce((a, r) => a + Number(r.amount_rial), 0);
      const bounced = rcs.filter((r) => r.status === "bounced").reduce((a, r) => a + Number(r.amount_rial), 0);
      const rstat = (r) => r.method !== "cheque" ? "دریافت شد" : chequeDue(r) ? "سررسید شده، وصول ثبت نشده" : `${(RC_STATUS[r.status] || [r.status])[0]}${r.cleared_on ? ` (${jdate(r.cleared_on)})` : ""}`;
      blocks.push(`<div class="if-ps"><h3><span>₪</span>وضعیت پرداخت‌ها و حساب</h3><div class="rp-grid">${k ? kv("مبلغ قرارداد", money(k.amount_rial)) : ""}${kv("پرداخت‌شده (وصول‌شده)", money(got))}
        ${pend ? kv("چک‌های در جریان (وصول‌نشده)", money(pend)) : ""}${bounced ? kv("چک برگشتی", money(bounced)) : ""}${k ? kv("مانده‌ی حساب", money(Number(k.amount_rial) - got)) : ""}${k && pend ? kv("مانده پس از وصول چک‌های در جریان", money(Number(k.amount_rial) - got - pend)) : ""}</div>
        ${k && k.payment_terms ? `<div class="rp-note"><b>نحوه‌ی پرداخت طبق قرارداد:</b> ${esc(k.payment_terms).replace(/\n/g, "؛ ")}</div>` : ""}
        ${rcs.length ? `<table class="if-pt"><tr><th>تاریخ</th><th>نحوه</th><th>مبلغ</th><th>شماره چک / سررسید</th><th>وضعیت</th></tr>${rcs.map((r) => `<tr><td>${jdate(r.received_on)}</td><td>${RC_METHOD[r.method]}</td><td>${money(r.amount_rial)}</td>
          <td>${r.method === "cheque" ? `<bdi dir="ltr">${esc(fa(r.cheque_no || ""))}</bdi> · ${jdate(r.cheque_due)}` : ""}</td><td>${rstat(r)}</td></tr>`).join("")}</table>` : `<div class="rp-note">پرداختی ثبت نشده است.</div>`}</div>`);
      if (internal) {
        const cost = costs.reduce((a, x) => a + Number(x.amount_rial), 0), byCat = {}; costs.forEach((x) => { byCat[x.category] = (byCat[x.category] || 0) + Number(x.amount_rial); });
        blocks.push(`<div class="if-ps"><h3><span>₪</span>هزینه‌ها و سود (داخلی)</h3><div class="rp-grid">${kv("قیمت تمام‌شده تا امروز", money(cost))}${k ? kv("سود ناخالص", money(Number(k.amount_rial) - cost)) : ""}</div>
          ${cost ? `<table class="if-pt">${Object.entries(COST_CAT).filter(([x]) => byCat[x]).map(([x, l]) => `<tr><td style="text-align:right">${l}</td><td>${money(byCat[x])}</td></tr>`).join("")}</table>` : ""}</div>`);
      }
    }
    openPrint(`گزارش پروژه ${p.install_code ? fa(p.install_code) : esc(p.title)}`, (host) => paginate(host, { no: p.install_code ? `نصب ${fa(p.install_code)}` : "—", date: jdate(todayTehran()) }, company || {}, head, blocks, {}));
  }
  // physical progress matrix: elevators × 15 stages (D-105)
  async function viewInstallMatrix() {
    const [defs, units] = await Promise.all([api("install_stage_defs?active=eq.true&select=*&order=sort"), api("install_units?active=eq.true&select=*,install_projects(id,title,stage,city,install_code,start_on,due_on)&order=project_id.desc,label")]);
    const live = units.filter((u) => u.install_projects && !["lost", "cancelled"].includes(u.install_projects.stage));
    const ids = live.map((u) => u.id).join(",");
    const [stages, dlv] = ids ? await Promise.all([api(`install_unit_stages?unit_id=in.(${ids})&select=unit_id,stage_code,status,visit_date`),
      api("install_deliveries?active=eq.true&stage_code=not.is.null&select=project_id,unit_id,stage_code,items,delivered_on,pending_reason")]) : [[], []];
    const by = {}; live.forEach((u) => { by[u.id] = {}; }); stages.forEach((s) => { if (by[s.unit_id]) by[s.unit_id][s.stage_code] = s; });
    const pcts = live.map((u) => unitPct(defs, by[u.id])), avg = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0;
    const rej = stages.filter((s) => s.status === "rejected").length, done = pcts.filter((x) => x === 100).length;
    state.matrix = { defs, live, by };
    const st = (label, v, cls) => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${v}</div></div>`;
    const rows = live.map((u, i) => { const b = by[u.id], p = u.install_projects;
      return `<tr class="tap" data-act="go" data-href="#/install/${p.id}"><th scope="row"><div>${p.install_code ? `${fa(p.install_code)} · ` : ""}${esc(p.title)}</div><div class="small muted">دستگاه ${esc(u.label)} · <b class="mx-p">${fa(pcts[i])}٪</b></div></th>
        ${defs.map((d) => { const s = b[d.code] || {}, t = ST_STATE[s.status || "pending"], g = s.status !== "approved" && dlv.find((x) => x.project_id === p.id && x.stage_code === d.code && (!x.unit_id || x.unit_id === u.id));
          return `<td><i class="${t[2]}${g ? " mx-dlv" : ""}" title="${esc(d.title)}: ${t[0]}${s.visit_date ? " · " + jdate(s.visit_date) : ""}${g ? ` · کالا تحویل شده، نصب نشده${g.pending_reason ? " (" + esc(g.pending_reason) + ")" : ""}` : ""}"></i></td>`; }).join("")}</tr>`; }).join("");
    return shell("پیشرفت فیزیکی پروژه‌ها", "more", `<a href="#/install" data-act="back" class="small">→ بازگشت</a>
      <div class="stats">${st("دستگاه در دست نصب", fa(live.length - done), "tone-info")}${st("میانگین پیشرفت", `${fa(avg)}٪`, "tone-brand")}
        ${st("مرحله‌ی عدم تأیید", fa(rej), rej ? "danger" : "calm")}${st("تکمیل‌شده", fa(done), "calm")}</div>
      <div class="page-actions"><button class="btn secondary" data-act="ip-mx-csv">خروجی اکسل</button></div>
      ${live.length ? `<div class="pr-grid">${live.map((u, i) => { const pp = u.install_projects, nx = nextStage(defs, by[u.id]), ti = timeInfo(pp, pcts[i]);
        return `<div class="card tap pr-card" data-act="go" data-href="#/install/${pp.id}">${ringSvg(defs, by[u.id], pcts[i], 104)}
          <div class="pr-t"><b>${pp.install_code ? `کد ${fa(pp.install_code)} · ` : ""}${esc(pp.title)}</b><span>دستگاه ${esc(u.label)}</span>
          <span class="small muted">${nx ? `${fa(nx.code)} · ${esc(nx.title)}` : "همه‌ی مراحل تأیید شد"}</span>
          ${ti ? `<span class="badge ${ti.tone}">${ti.left >= 0 ? `${fa(ti.left)} روز تا تحویل` : `${fa(-ti.left)} روز تأخیر`} · ${ti.txt}</span>` : ""}</div></div>`; }).join("")}</div>` : ""}
      <details class="fold"><summary class="small">نمای جدولی (ماتریس)</summary>
      <div class="mx-legend small">${Object.values(ST_STATE).map((v) => `<span><i class="${v[2]}"></i>${v[0]}</span>`).join("")}<span><i class="mx-no mx-dlv"></i>کالا تحویل شده، نصب نشده</span></div>
      ${live.length ? `<div class="mx-wrap"><table class="mx"><thead><tr><th scope="col">پروژه / دستگاه</th>${defs.map((d) => `<th scope="col" title="${esc(d.title)}">${fa(Number(d.code))}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
        <details class="fold"><summary class="small">راهنمای شماره‌ی مراحل</summary>${defs.map((d) => `<div class="small">${fa(d.code)} · ${esc(d.title)}</div>`).join("")}</details>`
        : `<div class="card empty">هنوز برای هیچ پروژه‌ای دستگاه تعریف نشده. در صفحه‌ی هر پروژه «تعریف دستگاه‌ها» را بزنید.</div>`}</details>
      <div class="mx-legend small">${Object.values(ST_STATE).map((v) => `<span><i class="${v[2]}"></i>${v[0]}</span>`).join("")}</div>
      <div class="hint">هر مرحله وزن برابر دارد؛ درصد پیشرفت = سهم مراحل تأییدشده از ۱۵ مرحله. پروژه‌های لغوشده یا از دست رفته نمایش داده نمی‌شوند.</div>`);
  }
  function matrixCsv() {
    const m = state.matrix; if (!m) return;
    downloadCsv(`pishraft-nasb-${toEn(todayTehran())}.csv`, ["پروژه", "دستگاه", ...m.defs.map((d) => `${d.code} ${d.title}`), "درصد پیشرفت"],
      m.live.map((u) => { const b = m.by[u.id]; return [u.install_projects.title, u.label, ...m.defs.map((d) => { const s = b[d.code] || {}; return ST_STATE[s.status || "pending"][0] + (s.visit_date ? ` ${jdate(s.visit_date)}` : ""); }), unitPct(m.defs, b)]; }));
  }
  async function newInstallQuote(projectId) {
    const [[p], d, cts] = await Promise.all([api(`install_projects?id=eq.${projectId}&select=*`), rpc("get_install_defaults"), api(`install_project_contacts?project_id=eq.${projectId}&active=eq.true&select=name&order=sort`)]);
    const names = cts.length ? cts.map((c) => c.name) : [p.client_name];
    const spec = { drive: "کششی", room: "موتورخانه‌دار", doors: 1, usage: "مسافربر", susp: "2:1", units: 1 };
    const id = await rpc("save_install_quote", { p_id: null, p: { project_id: projectId, recipient: `حضور محترم ${names.length > 1 ? names.slice(0, -1).join("، ") + " و " + names[names.length - 1] : names[0]}`, spec, intro: null,
      tech_items: d.tech_items || [], price_intro: d.price_intro || "", options: [], notes_items: [], conditions: d.conditions || [], vat_exempt: false, valid_hours: 24 } });
    location.hash = `#/iq/${id}`;
  }
  async function viewInstallQuote(id) {
    const [q] = await api(`install_quotes?id=eq.${id}&select=*,install_projects(*)`);
    if (!q) return shell("پیشنهاد قیمت", "more", `<div class="card empty">پیدا نشد</div>`);
    const p = q.install_projects || {}, s = IQ_STATE(q, p.stage), canExt = q.status === "issued" && ["estimate", "quoted"].includes(p.stage);
    if (q.status !== "draft") {
      const acts = [`<button class="btn" data-act="iq-print" data-id="${id}">چاپ / PDF</button>`];
      if (q.status === "issued" && !(new Date(q.valid_until) < new Date())) acts.push(`<button class="btn" data-act="iq-sms" data-id="${id}">ارسال پیامک به کارفرما</button>`);
      if (canExt) acts.push(`<button class="btn secondary" data-act="iq-extend" data-id="${id}" data-h="${q.valid_hours || 24}">تمدید اعتبار (همین قیمت)</button>`);
      if (q.status === "issued") acts.push(`<button class="btn secondary" data-act="iq-share" data-code="${esc(q.short_code)}" data-no="${esc(q.document_number)}">لینک برای کارفرما</button>`);
      acts.push(`<button class="btn secondary" data-act="iq-copy" data-id="${id}">نسخه‌ی جدید از روی این</button>`);
      if (q.status === "issued") acts.push(`<button class="btn secondary danger-text" data-act="iq-cancel" data-id="${id}">لغو</button>`);
      return shell("پیشنهاد قیمت نصب", "more", `<a href="#/install/${p.id}" data-act="back" class="small">→ بازگشت</a>
        <div class="card"><div class="item-head"><div><div class="item-title">${esc(p.title)} · نسخه ${fa(q.version)}</div><div class="small muted">${esc(q.recipient || "")}</div>
          <div class="small">صدور ${jtime(q.issued_at)} · اعتبار ${fa(q.valid_hours)} ساعت تا ${jtime(q.valid_until)}</div>${q.extended_count ? `<div class="small muted">${fa(q.extended_count)} بار تمدید شد · آخرین تمدید ${jtime(q.extended_at)}</div>` : ""}${q.cancel_note ? `<div class="small debt">لغو: ${esc(q.cancel_note)}</div>` : ""}</div><span class="badge ${s[1]}">${s[0]}</span></div>
          <table class="list" style="margin-top:8px">${(q.options || []).map((o) => `<tr><td>${esc(o.label)}<div class="small muted">پیش از مالیات ${num(o.amount_rial)} ریال${q.vat_exempt ? " · معاف از ارزش افزوده" : ` · ارزش افزوده ${num(o.vat_rial)}`}</div></td><td>${money(o.total_rial)}</td></tr>`).join("")}</table>
          <div class="actions">${acts.join("")}</div></div>`);
    }
    const sp = q.spec || {};
    const sel = (f, list, v) => `<select data-s="${f}">${list.map((x) => `<option${String(x) === String(v ?? "") ? " selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
    const numIn = (f, v, ph) => `<input type="text" inputmode="decimal" class="ltr" data-s="${f}" value="${esc(fa(v ?? ""))}" placeholder="${ph || ""}">`;
    const opts = (q.options || []).length ? q.options : [{ label: "", amount_rial: null }];
    return shell(`پیشنهاد قیمت — پیش‌نویس`, "more", `<a href="#/install/${p.id}" data-act="back" class="small">→ بازگشت</a>
      <div id="iq-form" data-id="${id}">
      <div class="card"><div class="item-title">${esc(p.title)} · نسخه ${fa(q.version)}</div><div class="hint">پیش‌نویس فقط برای شماست و هر تغییر چند ثانیه بعد خودکار ذخیره می‌شود؛ با «صدور» شماره (کد ۱۰) و لینک می‌گیرد و دیگر ویرایش نمی‌شود.</div>
        <div class="small muted" id="iq-saved">همه‌ی تغییرها ذخیره شده است</div>
        <label>گیرنده</label><input type="text" data-q="recipient" value="${esc(q.recipient || "")}"></div>
      <div class="card"><div class="item-title">مشخصات دستگاه</div>
        <div class="row"><div style="flex:1"><label>نوع</label>${sel("drive", IQ_SPEC.drive, sp.drive)}</div><div style="flex:1"><label>موتورخانه</label>${sel("room", IQ_SPEC.room, sp.room)}</div></div>
        <div class="row"><div style="flex:1"><label>تعداد درب</label>${sel("doors", [1, 2, 3], sp.doors)}</div><div style="flex:1"><label>تعداد توقف</label>${numIn("stops", sp.stops, "۱۳")}</div></div>
        <div class="row"><div style="flex:1"><label>کاربری</label>${sel("usage", IQ_SPEC.usage, sp.usage)}</div><div style="flex:1"><label>تعداد دستگاه</label>${numIn("units", sp.units || 1)}</div></div>
        <div class="row"><div style="flex:1"><label>ظرفیت از (نفر)</label>${numIn("persons_from", sp.persons_from, "۸")}</div><div style="flex:1"><label>تا (نفر)</label>${numIn("persons_to", sp.persons_to, "۱۰")}</div></div>
        <div class="row"><div style="flex:1"><label>از (کیلوگرم)</label>${numIn("kg_from", sp.kg_from, "۶۰۰")}</div><div style="flex:1"><label>تا (کیلوگرم)</label>${numIn("kg_to", sp.kg_to, "۷۵۰")}</div></div>
        <div class="row"><div style="flex:1"><label>سرعت نامی (متر بر ثانیه)</label>${sel("speed", ["", ...IQ_SPEC.speed], sp.speed)}</div><div style="flex:1"><label>تعلیق</label>${sel("susp", IQ_SPEC.susp, sp.susp)}</div></div>
        <label>متن مشخصات کلی (از روی مشخصات ساخته می‌شود؛ قابل ویرایش)</label><textarea data-q="intro" rows="5" data-custom="${sp.intro_custom ? 1 : ""}">${esc(sp.intro_custom && q.intro ? q.intro : iqIntro(sp, p))}</textarea>
        <div class="hint" id="iq-intro-hint">${sp.intro_custom ? "متن را دستی تغییر داده‌اید؛ با تغییر مشخصات به‌روز نمی‌شود. برای ساخت دوباره از مشخصات، دکمه‌ی زیر را بزنید." : "این متن با هر تغییر مشخصات خودکار به‌روز می‌شود."}</div>
        <div class="actions"><button class="btn secondary small" data-act="iq-intro">ساخت دوباره از مشخصات</button></div></div>
        <input type="hidden" id="iq-proj" value="${esc(JSON.stringify({ title: p.title || "", city: p.city || "" }))}">
      <div class="card"><div class="item-title">مشخصات فنی</div><div class="hint">هر بند در یک خط.</div>
        <textarea data-q="tech_items" rows="12">${esc((q.tech_items || []).join("\n"))}</textarea>
        <div class="actions"><button class="btn secondary small" data-act="iq-def" data-k="tech_items">ذخیره به‌عنوان پیش‌فرض</button></div></div>
      <div class="card"><div class="item-title">پیشنهاد قیمت</div>
        <label>متن پیش از مبلغ‌ها</label><textarea data-q="price_intro" rows="3">${esc(q.price_intro || "")}</textarea>
        <div id="iq-opts">${opts.map((o, i) => iqOptRow(i, o)).join("")}</div>
        <div class="actions"><button class="btn secondary small" data-act="iq-opt-add">+ گزینه‌ی قیمت</button></div>
        <label class="check"><input type="checkbox" data-q="vat_exempt"${q.vat_exempt ? " checked" : ""}> معاف از ارزش افزوده (بدون تیک: ${fa(VAT_RATE)}٪ روی هر مبلغ اضافه می‌شود)</label>
        <div class="card doc-sum" id="iq-sum"></div></div>
      <div class="card"><div class="item-title">توضیحات زیر قیمت</div><div class="hint">مثلاً: قیمت دستگاه ۶ نفره‌ی همین پروژه ... ریال کمتر است. هر توضیح در یک خط؛ می‌تواند خالی بماند.</div>
        <textarea data-q="notes_items" rows="3">${esc((q.notes_items || []).join("\n"))}</textarea></div>
      <div class="card"><div class="item-title">شرایط</div><div class="hint">هر بند در یک خط.</div>
        <textarea data-q="conditions" rows="8">${esc((q.conditions || []).join("\n"))}</textarea>
        <div class="actions"><button class="btn secondary small" data-act="iq-def" data-k="conditions">ذخیره به‌عنوان پیش‌فرض</button></div>
        <label>اعتبار قیمت (ساعت پس از صدور)</label><input type="text" inputmode="numeric" class="ltr" data-q="valid_hours" value="${esc(fa(q.valid_hours || 24))}"></div>
      <div class="actions"><button class="btn" data-act="iq-save" data-id="${id}">ذخیره‌ی پیش‌نویس</button><button class="btn secondary" data-act="iq-preview" data-id="${id}">پیش‌نمایش چاپی</button>
        <button class="btn ok" data-act="iq-issue" data-id="${id}">صدور و گرفتن شماره</button><button class="btn secondary danger-text" data-act="iq-cancel" data-id="${id}">حذف پیش‌نویس</button></div>
      </div>`);
  }
  function iqOptRow(i, o) {
    return `<div class="card" data-opt="${i}" style="background:var(--surface-2)"><label>شرح گزینه ${fa(i + 1)} (ترکیب انتخاب‌ها)</label><input type="text" data-o="label" value="${esc(o.label || "")}" placeholder="مثلاً: درب سلکوم و تابلو آرکل ترکیه">
      ${amountFieldHtml(`iqo${i}`, "مبلغ پیش از ارزش افزوده")}<input type="hidden" data-o="init" value="${o.amount_rial ? Number(o.amount_rial) : ""}">
      <div class="actions"><button class="btn secondary small danger-text" data-act="iq-opt-del">حذف این گزینه</button></div></div>`;
  }
  function bindIqForm() {
    const f = document.getElementById("iq-form"); if (!f || f.dataset.bound) return; f.dataset.bound = "1";
    const bindRow = (row) => { const i = row.dataset.opt; bindAmount(row, `iqo${i}`); const init = row.querySelector('[data-o="init"]').value;
      if (init) { const inp = row.querySelector(`[data-amount="iqo${i}"]`); inp.value = String(Math.round(Number(init) / 10)); inp.dispatchEvent(new Event("input")); } };
    f.querySelectorAll("[data-opt]").forEach(bindRow);
    const introEl = f.querySelector('[data-q="intro"]'), proj = JSON.parse(document.getElementById("iq-proj").value || "{}");
    const syncIntro = () => { if (!introEl.dataset.custom) introEl.value = iqIntro(readIqForm(f).spec, proj); };
    f.querySelectorAll("[data-s]").forEach((i) => { i.addEventListener("input", syncIntro); i.addEventListener("change", syncIntro); });
    introEl.addEventListener("input", () => { if (!introEl.dataset.custom) { introEl.dataset.custom = "1"; const h = document.getElementById("iq-intro-hint"); if (h) h.textContent = "متن را دستی تغییر داده‌اید؛ با تغییر مشخصات به‌روز نمی‌شود. برای ساخت دوباره از مشخصات، دکمه‌ی زیر را بزنید."; } });
    f.__regenIntro = () => { delete introEl.dataset.custom; syncIntro(); const h = document.getElementById("iq-intro-hint"); if (h) h.textContent = "این متن با هر تغییر مشخصات خودکار به‌روز می‌شود."; f.dispatchEvent(new Event("change")); };
    const sum = () => { const d = readIqForm(f), box = document.getElementById("iq-sum");
      box.innerHTML = d.options.length ? d.options.map((o) => { const v = d.vat_exempt ? 0 : Math.round(o.amount_rial * VAT_RATE / 100);
        return `<div class="row"><span class="spacer">${esc(o.label || "بدون شرح")}</span><b>${money(o.amount_rial + v)}</b></div>`; }).join("") + `<div class="small muted">مبلغ نهایی هر گزینه ${d.vat_exempt ? "(معاف از ارزش افزوده)" : `با ${fa(VAT_RATE)}٪ ارزش افزوده`}</div>` : `<div class="small muted">مبلغی وارد نشده</div>`; };
    f.addEventListener("input", sum); f.addEventListener("change", sum); f.addEventListener("click", (e) => setTimeout(sum, 0)); sum();
    // autosave (D-103): a few seconds after the last change, and at once when leaving the page
    const ind = document.getElementById("iq-saved"), id = Number(f.dataset.id);
    let timer = null, dirty = false, saving = null, last = JSON.stringify(readIqForm(f));
    const save = async () => {
      clearTimeout(timer); timer = null;
      if (f.dataset.locked || !document.body.contains(f) && !dirty) return;
      const d = readIqForm(f), j = JSON.stringify(d);
      if (j === last) { dirty = false; if (ind) ind.textContent = "همه‌ی تغییرها ذخیره شده است"; return; }
      if (ind) ind.textContent = "در حال ذخیره…";
      try { saving = rpc("save_install_quote", { p_id: id, p: d }); await saving; last = j; dirty = false;
        if (ind) ind.textContent = `ذخیره شد ${new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tehran" }).format(new Date())}`;
      } catch (er) { if (ind) ind.textContent = "ذخیره نشد: " + er.message; } finally { saving = null; }
    };
    const touch = () => { if (f.dataset.locked) return; dirty = true; if (ind) ind.textContent = "تغییرهای ذخیره‌نشده…"; clearTimeout(timer); timer = setTimeout(save, 2500); };
    f.addEventListener("input", touch); f.addEventListener("change", touch);
    f.addEventListener("click", (e) => { if (e.target.closest('[data-act="iq-opt-add"], [data-act="iq-opt-del"], .seg button')) touch(); });
    const leave = () => { if (dirty && !f.dataset.locked) save(); window.removeEventListener("hashchange", leave); window.removeEventListener("pagehide", leave); document.removeEventListener("visibilitychange", hide); };
    const hide = () => { if (document.visibilityState === "hidden" && dirty) save(); };
    window.addEventListener("hashchange", leave); window.addEventListener("pagehide", leave); document.addEventListener("visibilitychange", hide);
    f.__flush = async () => { if (saving) await saving.catch(() => {}); };
    f.__addRow = () => { const box = document.getElementById("iq-opts"), i = Math.max(-1, ...[...box.querySelectorAll("[data-opt]")].map((r) => Number(r.dataset.opt))) + 1;
      box.insertAdjacentHTML("beforeend", iqOptRow(i, {})); bindRow(box.lastElementChild); };
  }
  function readIqForm(f) {
    const v = (k) => f.querySelector(`[data-q="${k}"]`);
    const spec = {}; if (v("intro").dataset.custom) spec.intro_custom = true; f.querySelectorAll("[data-s]").forEach((i) => { const raw = toEn(i.value.trim()); spec[i.dataset.s] = ["stops", "units", "persons_from", "persons_to", "kg_from", "kg_to", "doors"].includes(i.dataset.s) ? (raw ? Number(raw.replace(/[^\d]/g, "")) || null : null) : raw; });
    const options = [...f.querySelectorAll("[data-opt]")].map((r) => ({ label: r.querySelector('[data-o="label"]').value.trim(), amount_rial: readAmount(r, `iqo${r.dataset.opt}`).rial || 0 }))
      .filter((o) => o.label || o.amount_rial);
    return { recipient: v("recipient").value.trim(), spec, intro: v("intro").value.trim(), tech_items: lines(v("tech_items").value), price_intro: v("price_intro").value.trim(),
      options, notes_items: lines(v("notes_items").value), conditions: lines(v("conditions").value), vat_exempt: v("vat_exempt").checked,
      valid_hours: Number(toEn(v("valid_hours").value).replace(/[^\d]/g, "")) || 24 };
  }
  function renderInstallQuotePages(host, q, company, draft) {
    const p = q.project || q.install_projects || {}, s = IQ_STATE(q), sp = q.spec || {};
    const opts = (q.options || []).map((o) => { const v = o.vat_rial ?? (q.vat_exempt ? 0 : Math.round(Number(o.amount_rial) * VAT_RATE / 100)), t = o.total_rial ?? Number(o.amount_rial) + v; return { ...o, v, t }; });
    const head = `<div class="iq-hero"><div class="iq-hero-t"><span class="iq-kicker">پیشنهاد قیمت</span><h1>آسانسور ${esc(sp.usage || "مسافربر")}${p.title ? ` · ${esc(p.title)}` : ""}</h1>
        <div class="iq-hero-s">${p.address ? `<span class="iq-addr">${esc(fa(p.address))}</span>` : ""}${esc(p.city || "اهواز")} · نسخه ${fa(q.version || 1)}${q.issued_at ? ` · صدور ${jtime(q.issued_at)}` : ""}</div></div>
        <div class="iq-valid"><b>${fa(q.valid_hours || 24)}</b><span>ساعت اعتبار</span>${q.valid_until ? `<em>تا ${jtime(q.valid_until)}</em>` : ""}${draft ? "" : `<i>${esc(s[0])}</i>`}</div></div>`;
    const tile = (label, value, unit) => value ? `<div class="iq-tile"><span>${label}</span><b>${value}</b>${unit ? `<em>${unit}</em>` : ""}</div>` : "";
    const tiles = [tile("نوع آسانسور", esc([sp.drive, sp.room].filter(Boolean).join(" · "))), tile("ظرفیت", sp.persons_from ? rangeTxt(sp.persons_from, sp.persons_to) : "", sp.kg_from ? `نفر · ${rangeTxt(sp.kg_from, sp.kg_to)} کیلوگرم` : "نفر"),
      tile("تعداد توقف", sp.stops ? fa(sp.stops) : "", "توقف"), tile("سرعت نامی", sp.speed ? fa(String(sp.speed).replace(".", "٫")) : "", "متر بر ثانیه"),
      tile("درب", DOOR_TXT[Number(sp.doors)] || "", ""), tile("سیستم تعلیق", sp.susp && sp.drive !== "هیدرولیک" ? fa(sp.susp) : "", ""), tile("تعداد دستگاه", fa(sp.units || 1), "دستگاه")].join("");
    const tech = (q.tech_items || []).map((t, i) => `<div class="iq-li"><span class="iq-n">${fa(i + 1)}</span><span>${esc(fa(t))}</span></div>`);

    const best = opts.length > 1 ? opts.reduce((a, o) => (o.t < a.t ? o : a), opts[0]) : null;
    const cards = opts.map((o, k) => `<div class="iq-opt${best === o ? " best" : ""}"><div class="iq-opt-h"><span class="iq-n">${fa(k + 1)}</span><b>${esc(o.label)}</b>${best === o ? `<i>اقتصادی‌ترین</i>` : ""}</div>
        <div class="iq-amt">${num(o.t)}<small>ریال</small></div><div class="iq-words">${numWords(o.t)} ریال</div>
        <div class="iq-break">${num(o.amount_rial)} ریال ${q.vat_exempt ? "· معاف از ارزش افزوده" : `+ ${fa(Number(q.vat_rate || VAT_RATE))}٪ ارزش افزوده (${num(o.v)} ریال)`}</div></div>`);
    const optBlocks = []; for (let i = 0; i < cards.length; i += 2) optBlocks.push(`<div class="iq-opts">${cards.slice(i, i + 2).join("")}</div>`);
    const blocks = [
      `<div class="iq-to">${esc(q.recipient || "")}</div><p class="iq-lead">${esc(fa(q.intro || ""))}</p>`,
      tiles ? `<div class="iq-sec">مشخصات دستگاه</div><div class="iq-tiles">${tiles}</div>` : "",
      // Nima: all technical specs on page 1 (text shrinks to fit), the price on its own page
      { html: `<div class="iq-sec">مشخصات فنی و برند تجهیزات</div><div class="iq-grid2 iq-fit">${tech.join("")}</div>`, fit: true },
      { html: `<div class="iq-sec" style="margin-top:0">پیشنهاد قیمت</div><div class="iq-to">${esc(q.recipient || "")}</div><p class="iq-p">${esc(fa(q.price_intro || ""))}</p>${optBlocks[0] || ""}`, newPage: true }, ...optBlocks.slice(1),
      ...((q.notes_items || []).length ? [`<div class="iq-note">${q.notes_items.map((n) => `<div>${esc(fa(n))}</div>`).join("")}</div>`] : []),
      `<div class="pp-box y iq-cond"><h3>شرایط</h3>${(q.conditions || []).map((c, i) => `<div>${fa(i + 1)}. ${esc(fa(c))}</div>`).join("")}<div>${fa((q.conditions || []).length + 1)}. اعتبار قیمت اعلام‌شده تا ${fa(q.valid_hours || 24)} ساعت پس از تاریخ صدور${q.valid_until ? ` (${jtime(q.valid_until)})` : ""} می‌باشد.</div></div>`,
      `<div class="iq-sign"><span>با تقدیم احترام</span><b>آسانسور پایاکو</b><em>با شما تا اوج...</em></div>`].filter(Boolean);
    paginate(host, { no: q.document_number || q.number || "—", date: q.issued_at ? jdateTz(q.issued_at) : jdate(todayTehran()), form: "PY-FO-PC-G10", rev: 0, issued: "۱۴۰۵/۰۸/۱۱" }, company || q.company || {}, head, blocks, { draft });
  }
  async function printInstallQuote(id, draftData) {
    const [[q], company] = await Promise.all([api(`install_quotes?id=eq.${id}&select=*,install_projects(*)`), rpc("get_company_profile")]);
    const d = draftData ? { ...q, ...draftData } : q;
    openPrint(draftData ? "پیش‌نمایش پیشنهاد قیمت" : `پیشنهاد قیمت ${fa(q.document_number || "")}`, (host) => renderInstallQuotePages(host, d, company, !!draftData));
  }
  async function viewPublicInstallQuote(code) {
    $app.innerHTML = `<div class="loading">در حال بارگذاری…</div>`;
    let q;
    try { q = await publicRpc("get_install_quote_by_code", { p_code: code }); } catch (e) {
      $app.innerHTML = `<div class="login-wrap"><div class="login-card"><h1>پیشنهاد قیمت پیدا نشد</h1><p class="muted">لینک نادرست است. با دفتر پایاکو تماس بگیرید.</p></div></div>`; return;
    }
    const s = IQ_STATE(q);
    $app.innerHTML = `<main class="doc-page"><div class="pp-pages screen-doc"></div>
      <div class="actions no-print doc-actions"><span class="badge ${s[1]}">${s[0]}</span><button class="btn" data-act="doc-print">چاپ / ذخیره PDF</button></div>
      ${q.status === "superseded" ? `<div class="hint no-print">نسخه‌ی جدیدتری از این پیشنهاد برای شما صادر شده است.</div>` : ""}
      ${q.status === "cancelled" ? `<div class="hint no-print">این پیشنهاد لغو شده است.</div>` : ""}
      ${q.company && q.company.phone ? `<div class="small muted no-print" style="margin-top:8px">تماس با پایاکو: <a href="tel:${esc(toEn(q.company.phone))}" class="ltr">${esc(fa(q.company.phone))}</a></div>` : ""}</main>`;
    const host = $app.querySelector(".pp-pages"); host.style.setProperty("--z", String(Math.min(1, (window.innerWidth - 16) / 794)));
    renderInstallQuotePages(host, q, q.company, false);
    $app.onclick = (e) => { const a = e.target.closest("[data-act]"); if (a && a.dataset.act === "doc-print") window.print(); };
  }
  async function sheetInstallDefaults() {
    const d = await rpc("get_install_defaults");
    sheet(`<h3>متن‌های پیش‌فرض پیشنهاد قیمت</h3><div class="hint">هر پیشنهاد تازه با این متن‌ها شروع می‌شود؛ در هر پیشنهاد می‌توانید تغییرشان دهید. هر بند در یک خط.</div>
      <label>مشخصات فنی</label><textarea data-f="tech_items" rows="10">${esc((d.tech_items || []).join("\n"))}</textarea>
      <label>متن پیش از مبلغ‌ها</label><textarea data-f="price_intro" rows="3">${esc(d.price_intro || "")}</textarea>
      <label>شرایط</label><textarea data-f="conditions" rows="8">${esc((d.conditions || []).join("\n"))}</textarea>
      <div class="actions"><button class="btn" data-act="save">ذخیره</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
      const g = (k) => el.querySelector(`[data-f="${k}"]`).value;
      await rpc("set_install_defaults", { p: { tech_items: lines(g("tech_items")), price_intro: g("price_intro").trim(), conditions: lines(g("conditions")) } });
      close(); toast("متن‌های پیش‌فرض ذخیره شد");
    })));
  }
  async function sendInstallQuoteSms(id) {
    const [pre, [q]] = await Promise.all([callFunction("notify-customers", { kind: "install_quote", quote_id: id, dry_run: true }), api(`install_quotes?id=eq.${id}&select=project_id`)]);
    const cts = (await api(`install_project_contacts?project_id=eq.${q.project_id}&active=eq.true&select=name,mobile,role&order=sort`)).filter((c) => c.mobile);
    sheet(`<h3>ارسال پیشنهاد قیمت با پیامک</h3>
      ${pre.test ? `<div class="hint">حالت آزمایشی: همه‌ی پیامک‌ها به شماره‌ی آزمایشی <bdi dir="ltr">${esc(fa(pre.to || ""))}</bdi> می‌روند.</div>` : ""}
      ${cts.length ? `<label>گیرندگان</label>${cts.map((c, i) => `<label class="check"><input type="checkbox" data-m="${esc(c.mobile)}" checked> ${esc(c.name)}${c.role ? ` (${esc(c.role)})` : ""} · <bdi dir="ltr">${esc(fa(c.mobile))}</bdi></label>`).join("")}` : ""}
      <label>شماره‌ی دیگر (اختیاری)</label><input type="text" data-field="mobile" class="ltr" inputmode="tel" value="${cts.length ? "" : esc(fa(pre.intended || ""))}">
      <div class="card small" style="white-space:pre-line">${esc(pre.text)}</div>
      <div class="actions"><button class="btn" data-act="save">ارسال</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
      const to = [...el.querySelectorAll("[data-m]:checked")].map((x) => x.dataset.m), extra = toEn(el.querySelector('[data-field="mobile"]').value.trim());
      if (extra) to.push(extra);
      if (!to.length) throw new Error("گیرنده‌ای انتخاب نشده است");
      const ok = []; for (const m of [...new Set(to)]) { const r = await callFunction("notify-customers", { kind: "install_quote", quote_id: id, mobile: m }); ok.push(r); }
      close(); toast(`${fa(ok.length)} پیامک فرستاده شد${ok[0] && ok[0].test ? " (آزمایشی)" : ""}`);
    })));
  }
  function installClick(act, el, id) {
    if (act === "ip-new") sheetInstallProject();
    const pid = Number((location.hash.match(/^#\/install\/(\d+)/) || [])[1]);
    if (act === "ip-units") sheetInstallUnits(id).catch((er) => toast(er.message));
    if (act === "ip-st") sheetInstallStage(Number(el.dataset.p) || pid, Number(el.dataset.u), el.dataset.c).catch((er) => toast(er.message));
    if (act === "ip-rc-clear") sheetChequeCleared(Number(el.dataset.rid)).catch((er) => toast(er.message));
    if (act === "ip-rc") sheetInstallReceipt(pid, el.dataset.rid ? Number(el.dataset.rid) : null).catch((er) => toast(er.message));
    if (act === "if-final") guarded(el, () => finalizeInstallForm(Number(el.dataset.u), el.dataset.c));
    if (act === "if-print") printInstallForm(Number(el.dataset.u), el.dataset.c).catch((er) => toast(er.message));
    if (act === "if-new") { if (confirm("نسخه‌ی جدید این فرم (بازدید مجدد) ساخته شود؟")) rpc("save_install_form", { p_unit: Number(el.dataset.u), p_code: el.dataset.c, p: { visit_date: toEn(todayTehran()), data: {} } }).then(() => route()).catch((er) => toast(er.message)); }
    if (act === "ip-dlv") sheetInstallDelivery(pid, el.dataset.did ? Number(el.dataset.did) : null).catch((er) => toast(er.message));
    if (act === "ip-mx-csv") matrixCsv();
    if (act === "ip-report") sheetInstallReport(id).catch((er) => toast(er.message));
    if (act === "ip-contract") sheetInstallContract(id).catch((er) => toast(er.message));
    if (act === "ip-cost") sheetInstallCost(pid, el.dataset.cid ? Number(el.dataset.cid) : null).catch((er) => toast(er.message));
    if (act === "ip-edit") api(`install_projects?id=eq.${id}&select=*`).then(([p]) => sheetInstallProject(p)).catch((er) => toast(er.message));
    if (act === "ip-defaults") sheetInstallDefaults().catch((er) => toast(er.message));
    if (act === "ip-stage") rpc("set_install_project_stage", { p_id: id, p_stage: document.querySelector('[data-f="stage"]').value }).then(() => { toast("مرحله ثبت شد"); route(); }).catch((er) => toast(er.message));
    if (act === "iq-new") newInstallQuote(id).catch((er) => toast(er.message));
    const f = document.getElementById("iq-form");
    if (act === "iq-intro" && f) { f.__regenIntro(); toast("متن از روی مشخصات ساخته شد"); }
    if (act === "iq-opt-add" && f) f.__addRow();
    if (act === "iq-opt-del") { const r = el.closest("[data-opt]"); if (r && document.querySelectorAll("#iq-opts [data-opt]").length > 1) r.remove(); else if (r) { r.querySelector('[data-o="label"]').value = ""; const i = r.querySelector("[data-amount]"); i.value = ""; i.dispatchEvent(new Event("input")); } }
    if (act === "iq-def" && f) { const k = el.dataset.k; if (confirm("این متن پیش‌فرض پیشنهادهای بعدی شود؟")) rpc("set_install_defaults", { p: { [k]: readIqForm(f)[k] } }).then(() => toast("پیش‌فرض ذخیره شد")).catch((er) => toast(er.message)); }
    if (act === "iq-save" && f) guarded(el, async () => { await rpc("save_install_quote", { p_id: id, p: readIqForm(f) }); f.dispatchEvent(new Event("change")); toast("پیش‌نویس ذخیره شد"); });
    if (act === "iq-preview" && f) printInstallQuote(id, readIqForm(f)).catch((er) => toast(er.message));
    if (act === "iq-issue" && f) guarded(el, async () => {
      const d = readIqForm(f);
      if (!d.options.length) throw new Error("حداقل یک مبلغ پیشنهادی وارد کنید");
      if (d.options.some((o) => !o.label || !o.amount_rial)) throw new Error("هر گزینه‌ی قیمت باید شرح و مبلغ داشته باشد");
      if (!confirm(`پیشنهاد صادر شود؟ شماره (کد ۱۰) و لینک می‌گیرد، اعتبارش ${fa(d.valid_hours)} ساعت از همین حالا شروع می‌شود و دیگر ویرایش نمی‌شود.`)) return;
      f.dataset.locked = "1"; if (f.__flush) await f.__flush();
      try { await rpc("save_install_quote", { p_id: id, p: d }); } catch (er) { delete f.dataset.locked; throw er; }
      const r = await rpc("issue_install_quote", { p_id: id });
      toast("پیشنهاد قیمت صادر شد"); route();
    });
    if (act === "iq-print") printInstallQuote(id).catch((er) => toast(er.message));
    if (act === "iq-extend") { const h = prompt("قیمت‌ها تغییر نکرده است؟ این پیشنهاد با همین شماره و همین مبلغ‌ها از همین حالا چند ساعت دیگر معتبر بماند؟", fa(el.dataset.h || 24));
      if (h !== null) { const n = Number(toEn(h).replace(/\D/g, "")); if (!n) toast("مدت را به ساعت وارد کنید"); else rpc("extend_install_quote", { p_id: id, p_hours: n }).then((u) => { toast(`تمدید شد تا ${jtime(u)}`); route(); }).catch((er) => toast(er.message)); } }
    if (act === "iq-sms") sendInstallQuoteSms(id).catch((er) => toast(er.message));
    if (act === "iq-share") {
      const url = `${location.origin}${location.pathname}?q=${el.dataset.code}`, text = `پیشنهاد قیمت آسانسور پایاکو شماره ${fa(el.dataset.no)}:`;
      if (navigator.share) navigator.share({ title: text, text, url }).catch(() => {}); else copyText(url);
    }
    if (act === "iq-copy") rpc("copy_install_quote", { p_id: id }).then((nid) => { toast("نسخه‌ی جدید (پیش‌نویس) ساخته شد"); location.hash = `#/iq/${nid}`; }).catch((er) => toast(er.message));
    if (act === "iq-cancel") { const note = prompt(f ? "پیش‌نویس حذف (لغو) شود؟ دلیل (اختیاری):" : "دلیل لغو پیشنهاد:"); if (note !== null && f) f.dataset.locked = "1"; if (note !== null) rpc("cancel_install_quote", { p_id: id, p_note: note.trim() || null }).then(() => { toast("لغو شد"); route(); }).catch((er) => toast(er.message)); }
  }

  /* print renderers on the letterhead: G04 statement, G06 repair invoice, G07 proforma */
  const tbl = (head, rows) => `<table class="pp-items"><thead><tr>${head.map(([h, w]) => `<th${w ? ` style="width:${w}"` : ""}>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
  const sumTbl = (rows) => `<table class="pp-sum">${rows.map(([l, v, cls]) => `<tr class="${cls || ""}"><td>${l}</td><td class="n">${v}</td></tr>`).join("")}</table>`;
  const ppBank = (c) => (c.card_no || c.sheba) ? `<div class="pp-box"><h3>اطلاعات واریز${c.bank ? " — " + esc(c.bank) : ""}${c.account_holder ? " — به نام " + esc(c.account_holder) : ""}</h3>
    ${c.card_no ? `<div class="r"><span>شماره کارت</span><span class="pp-mono">${esc(groupCard(c.card_no))}</span></div>` : ""}${c.sheba ? `<div class="r"><span>شماره شبا</span><span class="pp-mono">${esc(toEn(c.sheba).toUpperCase())}</span></div>` : ""}</div>` : "";
  const ppInfo = (rows) => `<table class="pp-info">${rows.map((r) => `<tr>${r.map(([k, v], i) => `<td class="k">${k}</td><td${r.length === 1 ? ' colspan="3"' : ""}>${v}</td>`).join("")}</tr>`).join("")}</table>`;
  function renderProformaPages(host, p) {
    const c = p.company || {};
    const rows = (p.items || []).map((it, k) => `<tr><td class="c">${fa(k + 1)}</td><td>${esc(it.description)}</td><td class="c">${fa(it.qty)}</td><td class="c">${esc(it.unit || "")}</td><td class="n">${num(it.unit_price)}</td><td class="n">${num(it.amount)}</td></tr>`).join("");
    const head = `<div class="pp-title"><h1>پیش‌فاکتور تعمیرات<small>صدور ${jtime(p.issued_at)} · اعتبار ۷۲ ساعت تا ${jtime(p.valid_until)}</small></h1><span class="pp-chip y">${esc(pfState(p)[0])}</span></div><div class="pp-rule"></div>
      ${ppInfo([[["مشترک", esc((p.building && p.building.name) || "")], ["شماره قرارداد", esc(fa((p.contract && p.contract.code) || ""))]], ...(p.subject ? [[["موضوع", esc(p.subject)]]] : [])])}`;
    paginate(host, { no: p.number, date: jdateTz(p.issued_at), form: "PY-FO-PC-G07", rev: 0, issued: "۱۴۰۵/۰۸/۰۹" }, c, head, [
      tbl([["ردیف", "9mm"], ["شرح کالا / خدمات"], ["تعداد", "14mm"], ["واحد", "14mm"], ["فی (ریال)", "28mm"], ["مبلغ (ریال)", "30mm"]], rows) +
      sumTbl([["جمع", num(p.subtotal)], ...(p.discount ? [["تخفیف", "−" + num(p.discount)]] : []), ["مالیات بر ارزش افزوده" + (p.vat_exempt ? " (معاف)" : ` ${fa(Number(p.vat_rate))}٪`), num(p.vat)], ["جمع کل پیش‌فاکتور", num(p.total), "pay"]]),
      `<div class="pp-words">به حروف: <b>${numWords(p.total)} ریال</b> (معادل ${num(Math.round(p.total / 10))} تومان)</div>`,
      `<div class="pp-box y"><h3>شرایط</h3><div>۱. طبق قرارداد سرویس و نگهداری، هزینه‌ی تعمیرات کلی از راه پیش‌فاکتور اعلام می‌شود و پس از تأیید کارفرما، تعمیر انجام می‌گیرد.</div>
        <div>۲. این پیش‌فاکتور سند بدهی نیست؛ با تأیید، فاکتور تعمیرات صادر و در حساب ثبت می‌شود.</div><div>۳. این پیش‌فاکتور ۷۲ ساعت از زمان صدور معتبر است.</div></div>`,
      `<div class="pp-signs"><div><b>تأیید کارفرما</b>با شرح و مبلغ بالا موافقم. نام، تاریخ و امضا</div><div><b>پایاکو</b>مهر و امضا</div></div>`], {});
  }
  function renderInvoicePages(host, d) {
    const c = d.company || {}, st = d.type === "statement" || d.type === "opening_balance";
    const items = (d.items || []).filter((it) => it.type !== "tax"), tax = (d.items || []).filter((it) => it.type === "tax").reduce((a, x) => a + Number(x.amount), 0);
    const rows = items.map((it, k) => st ? `<tr><td class="c">${fa(k + 1)}</td><td>${txt(it.description)}</td><td class="n">${it.dc === "credit" ? "−" : ""}${num(it.amount)}</td></tr>`
      : `<tr><td class="c">${fa(k + 1)}</td><td>${txt(it.description)}</td><td class="c">${fa(Number(it.qty))}</td><td class="c">${esc(it.unit || "")}</td><td class="n">${num(it.unit_price)}</td><td class="n">${num(it.amount)}</td></tr>`).join("");
    const itemsSum = items.reduce((a, x) => a + (x.dc === "credit" ? -1 : 1) * Number(x.amount), 0);
    const bal = Number(d.account_balance || 0);
    const ins = d.type === "insurance_invoice";
    // D-93: an invoice asks only for its own amount; the rest of the account is shown beside it, never added to it
    const invPaid = (d.payments || []).reduce((a, p) => a + Number(p.amount), 0), invRem = d.status === "cancelled" ? 0 : Math.max(Number(d.remaining ?? (Number(d.total) - invPaid)), 0);
    const other = bal - invRem, payNow = st ? bal : invRem;
    const head = `<div class="pp-title"><h1>${d.type === "opening_balance" ? "صورت‌حساب مانده‌ی حساب" : st ? "صورتحساب سرویس و نگهداری" : ins ? "فاکتور بیمه‌ی آسانسور" : "فاکتور تعمیرات"}${d.proforma_number ? `<small>بر اساس پیش‌فاکتور ${esc(fa(d.proforma_number))}</small>` : ""}</h1><span class="pp-chip">کد اشتراک ${esc(fa((d.contract && d.contract.subscription) || ""))}</span></div><div class="pp-rule"></div>
      ${ppInfo([[["مشترک", esc((d.building && d.building.name) || (d.customer && d.customer.name) || "")], ["شماره قرارداد", esc(fa((d.contract && d.contract.code) || ""))]], ...(d.building && d.building.address ? [[["نشانی", esc(fa(d.building.address))]]] : [])])}`;
    const sums = [["جمع", num(itemsSum)], ...(Number(d.discount) ? [["تخفیف", "−" + num(d.discount)]] : []), ...(tax ? [["مالیات بر ارزش افزوده", num(tax)]] : d.vat_exempt ? [["مالیات بر ارزش افزوده", "معاف"]] : []),
      ["مبلغ این " + (st ? "صورتحساب" : "فاکتور"), num(d.total), "s"],
      ...(st ? [...(Number(d.previous_balance) ? [["مانده‌ی حساب پیش از این سند" + (Number(d.previous_balance) < 0 ? " (بستانکار)" : ""), num(Math.abs(d.previous_balance))]] : []),
        [bal < 0 ? "مانده‌ی بستانکاری شما" : "مبلغ قابل پرداخت (مانده‌ی فعلی حساب)", num(Math.abs(bal)), "pay"]]
        : [...(invPaid ? [["پرداخت‌شده بابت این فاکتور", "−" + num(invPaid)]] : []), ["مبلغ قابل پرداخت این فاکتور", num(invRem), "pay"]])];
    const otherNote = !st && other ? `<div class="pp-words">${other > 0 ? `مانده‌ی دیگر حساب شما (جدا از این فاکتور و قابل پرداخت جداگانه): <b>${num(other)} ریال</b>` : `بستانکاری دیگر حساب شما: <b>${num(-other)} ریال</b>`} · مانده‌ی کل حساب: ${num(Math.abs(bal))} ریال${bal < 0 ? " بستانکار" : ""}</div>` : "";
    const code = d.public_token ? "" : "";
    paginate(host, { no: d.number, date: jdate(d.issue_date), form: st ? "PY-FO-PC-G04" : ins ? "PY-FO-PC-G09" : "PY-FO-PC-G06", rev: 0, issued: "۱۴۰۵/۰۸/۰۹" }, c, head, [
      (st ? tbl([["ردیف", "9mm"], ["شرح"], ["مبلغ (ریال)", "34mm"]], rows) : tbl([["ردیف", "9mm"], ["شرح کالا / خدمات"], ["تعداد", "14mm"], ["واحد", "14mm"], ["فی (ریال)", "26mm"], ["مبلغ (ریال)", "28mm"]], rows)) + sumTbl(sums),
      payNow > 0 ? `<div class="pp-words">به حروف: <b>${numWords(payNow)} ریال</b> (معادل ${num(Math.round(payNow / 10))} تومان)</div>` : "", otherNote,
      `<div class="pp-cols">${ppBank(c)}<div class="pp-box"><h3>اعلام واریز آنلاین</h3><div class="small">پس از واریز، از لینکی که برایتان پیامک شده شماره پیگیری را اعلام کنید.</div></div></div>`,
      st ? `<div class="pp-stamp">این سند در سامانه‌ی پایاکو صادر شده است.</div>` : `<div class="pp-signs"><div><b>تحویل‌گیرنده (مدیر ساختمان)</b>نام، تاریخ و امضا</div><div><b>پایاکو</b>مهر و امضا</div></div>`].filter(Boolean), {});
    return code;
  }
  async function printInvoiceDoc(id) {
    const d = await rpc("get_invoice_document", { p_invoice_id: id });
    openPrint(`${DOC_TITLE[d.type] || "سند"} ${fa(d.number || "")}`, (host) => renderInvoicePages(host, d));
  }
  async function printProforma(id) {
    const p = await rpc("get_proforma", { p_id: id });
    openPrint(`پیش‌فاکتور ${fa(p.number)}`, (host) => renderProformaPages(host, p));
  }

  /* G05: period account statement from the ledger */
  function sheetPeriodStatement(contractId) {
    const t = todayTehran(), [y, m, d] = t.split("-").map(Number), j = g2j(y, m, d), g = j2g(j.jy, 1, 1);
    sheet(`<h3>صورت‌حساب بازه‌ای</h3><label>از تاریخ</label>${datePickerHtml("sf", `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`)}<label>تا تاریخ</label>${datePickerHtml("st", t)}
      <div class="actions"><button class="btn" data-act="save">نمایش و چاپ</button><button class="btn secondary" data-close>انصراف</button></div>`,
    (el, close) => el.querySelector('[data-act="save"]').addEventListener("click", (e) => guarded(e.target, async () => {
      const from = readDate(el, "sf"), to = readDate(el, "st"); if (from > to) throw new Error("بازه نامعتبر است");
      const [[c], led, company] = await Promise.all([api(`v_contract_overview?id=eq.${contractId}&select=*`),
        api(`ledger?contract_id=eq.${contractId}&transaction_date=lte.${to}&select=transaction_date,description,debit_rial,credit_rial,invoice_id,invoices(document_number)&order=transaction_date.asc,id.asc`), rpc("get_company_profile")]);
      let open = 0; const rows = [];
      led.forEach((l) => { const v = Number(l.debit_rial) - Number(l.credit_rial); if (l.transaction_date < from) open += v; else rows.push(l); });
      let run = open, dS = 0, cS = 0;
      const tr = rows.map((l) => { run += Number(l.debit_rial) - Number(l.credit_rial); dS += Number(l.debit_rial); cS += Number(l.credit_rial);
        return `<tr><td>${jdate(l.transaction_date)}</td><td>${txt(l.description)}</td><td class="n">${esc(fa((l.invoices && l.invoices.document_number) || "—"))}</td><td class="n">${Number(l.debit_rial) ? num(l.debit_rial) : ""}</td><td class="n cr">${Number(l.credit_rial) ? num(l.credit_rial) : ""}</td><td class="n"><b>${num(run)}</b></td></tr>`; }).join("");
      close();
      const head = `<div class="pp-title"><h1>صورت‌حساب مشترک<small>گردش حساب از ${jdate(from)} تا ${jdate(to)}</small></h1><span class="pp-chip">کد اشتراک ${esc(fa(c.subscription_code || ""))}</span></div><div class="pp-rule"></div>
        ${ppInfo([[["مشترک", esc(c.building_name || "")], ["شماره قرارداد", esc(fa(c.contract_code))]], [["مانده‌ی ابتدای بازه", `${num(Math.abs(open))} ریال${open < 0 ? " بستانکار" : ""}`], ["مانده‌ی پایان بازه", `<b>${num(Math.abs(run))} ریال ${run > 0 ? "بدهکار" : run < 0 ? "بستانکار" : ""}</b>`]]])}`;
      openPrint(`صورت‌حساب ${fa(c.contract_code)}`, (host) => paginate(host, { no: "—", date: jdate(todayTehran()), form: "PY-FO-PC-G05", rev: 0, issued: "۱۴۰۵/۰۸/۰۹" }, company, head, [
        tbl([["تاریخ", "18mm"], ["شرح"], ["سند مرجع", "20mm"], ["بدهکار", "22mm"], ["بستانکار", "22mm"], ["مانده", "24mm"]], (tr || `<tr><td colspan="6" class="c">در این بازه گردشی نیست</td></tr>`) +
          `<tr><td></td><td><b>جمع گردش بازه</b></td><td></td><td class="n"><b>${num(dS)}</b></td><td class="n"><b>${num(cS)}</b></td><td></td></tr>`) + `<div class="pp-sub">مبالغ به ریال</div>` +
        sumTbl([[run < 0 ? "مانده‌ی بستانکاری در پایان بازه" : "مانده‌ی بدهی در پایان بازه", num(Math.abs(run)), "pay"]]),
        run > 0 ? `<div class="pp-words">به حروف: <b>${numWords(run)} ریال</b> (معادل ${num(Math.round(run / 10))} تومان)</div>` : "",
        `<div class="pp-cols">${ppBank(company)}</div>`, `<div class="pp-stamp">این گزارش از دفتر حساب سامانه‌ی پایاکو تهیه شده است.</div>`].filter(Boolean), {}));
    })));
  }

  /* ------------------------------------------------------------------ router */
  async function ensureProfile() {
    if (state.profile) return state.profile;
    const rows = await api(`user_profiles?id=eq.${session.user_id}&select=id,full_name,username,role,is_active`);
    state.profile = rows[0] || null;
    return state.profile;
  }

  // D-80: every list page can be searched by code or building name (client-side, on what is already loaded)
  const SEARCH_PAGES = ["docs", "faults", "services", "plan", "debts", "renewals", "opening", "requests", "claims", "team", "locations"];
  const listQuery = {};
  function injectListSearch(pg) {
    const v = document.getElementById("view"); if (!v) return;
    const cards = () => [...v.querySelectorAll(".card")].filter((c) => !c.querySelector("input, select, textarea, .stats") && !c.closest(".pp-wrap") && !c.classList.contains("empty"));
    if (cards().length < 2) return;
    const box = document.createElement("div"); box.className = "row lsearch";
    box.innerHTML = `<input type="search" id="lsearch" placeholder="جست‌وجو: کد یا نام ساختمان" style="flex:1"><button class="btn secondary small" data-act="lsearch-clear">پاک کن</button>`;
    const anchor = v.querySelector(".chips") || v.querySelector(".page-actions") || v.querySelector(".row") || v.querySelector('[data-act="back"]');
    if (anchor) anchor.after(box); else v.prepend(box);
    const inp = box.querySelector("input");
    const apply = () => {
      const q = toEn(inp.value).trim(); listQuery[pg] = inp.value;
      cards().forEach((c) => { c.style.display = !q || toEn(c.textContent).includes(q) ? "" : "none"; });
    };
    inp.value = listQuery[pg] || ""; inp.addEventListener("input", apply); apply();
  }
  let payOffer = null; // invoice just issued: offer to record its payment once its page is shown
  const navStack = []; // in-app history, so «بازگشت» returns to the page the user came from
  async function route() {
    const pm = location.hash.match(/^#\/p\/([0-9a-fA-F-]{36})$/);
    if (pm) return viewPublicDoc(pm[1]);
    const pc = location.hash.match(/^#\/c\/([a-zA-Z0-9]{6,16})$/);
    if (pc) return viewPublicDoc(null, pc[1]);
    // short SMS link form that works on any static host: https://app.payaco.org/?c=<code>
    const qc = new URLSearchParams(location.search).get("c");
    if (qc && /^[a-zA-Z0-9]{6,16}$/.test(qc) && !location.hash) { history.replaceState(null, "", location.pathname + "#/c/" + qc); return viewPublicDoc(null, qc); }
    const qp = new URLSearchParams(location.search).get("p");
    if (qp && /^[a-zA-Z0-9]{6,16}$/.test(qp) && !location.hash) { history.replaceState(null, "", location.pathname + "#/pf/" + qp); return viewPublicProforma(qp); }
    const qv = new URLSearchParams(location.search).get("v");
    if (qv && /^[a-zA-Z0-9]{6,16}$/.test(qv) && !location.hash) { history.replaceState(null, "", location.pathname + "#/sv/" + qv); return viewPublicService(qv); }
    const sv = location.hash.match(/^#\/sv\/([a-zA-Z0-9]{6,16})$/);
    if (sv) return viewPublicService(sv[1]);
    const qq = new URLSearchParams(location.search).get("q");
    if (qq && /^[a-zA-Z0-9]{6,16}$/.test(qq) && !location.hash) { history.replaceState(null, "", location.pathname + "#/iqp/" + qq); return viewPublicInstallQuote(qq); }
    const iqp = location.hash.match(/^#\/iqp\/([a-zA-Z0-9]{6,16})$/);
    if (iqp) return viewPublicInstallQuote(iqp[1]);
    const pp = location.hash.match(/^#\/pf\/([a-zA-Z0-9]{6,16})$/);
    if (pp) return viewPublicProforma(pp[1]);
    if (!session) return viewLogin();
    let p;
    try { p = await ensureProfile(); } catch (e) { if (e instanceof AuthError) return viewLogin(); return viewError(e); }
    if (!p || !p.is_active) {
      $app.innerHTML = `<div class="login-wrap"><div class="login-card"><h1>حساب غیرفعال</h1><p class="muted">حساب شما هنوز فعال نشده یا نقشی ندارد. با مدیر سیستم تماس بگیرید.</p>
        <button class="btn block secondary" id="lo">خروج</button></div></div>`;
      document.getElementById("lo").onclick = logout; return;
    }
    const here = location.hash || "#/";
    if (navStack.length > 1 && navStack[navStack.length - 2] === here) navStack.pop();
    else if (navStack[navStack.length - 1] !== here) navStack.push(here);
    if (navStack.length > 50) navStack.splice(0, navStack.length - 50);
    const hash = location.hash.replace(/^#\/?/, "");
    const [page, arg] = hash.split("/");
    const def = role() === "TECHNICIAN" ? "faults" : "dashboard";
    if (role() === "TECHNICIAN") {
      try {
        const t = todayTehran(), me = await myTech();
        const [asg, fl] = me ? await Promise.all([rpc("my_assignments", { p_from: t, p_to: addDays(t, 1) }), api(`faults?technician_id=eq.${me.id}&status=in.(reported,assigned)&select=id`)]) : [[], []];
        state.badges = { services: asg.filter((a) => a.status === "planned").length, faults: fl.length };
      } catch (e) { state.badges = null; }
    }
    if (!$app.querySelector("#view")) $app.innerHTML = `<div class="loading">در حال بارگذاری…</div>`;
    document.body.classList.add("busy"); lastRoute = Date.now();
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
        case "renewals": html = can.changeContract() ? await viewRenewals() : await viewDashboard(); break;
        case "debts": html = can.recordPayment() ? await viewDebts() : await viewDashboard(); break;
        case "docs": html = isStaff() ? await viewDocs() : await viewDashboard(); break;
        case "proforma": html = await viewProforma(Number(arg)); break;
        case "install-matrix": html = canInstall() ? await viewInstallMatrix() : await viewDashboard(); break;
        case "install": html = canInstall() ? (arg ? await viewInstallProject(Number(arg)) : await viewInstall()) : await viewDashboard(); break;
        case "iq": html = role() === "CEO" ? await viewInstallQuote(Number(arg)) : await viewDashboard(); break;
        case "iform": { const parts = hash.split("/"); html = canInstall() ? await viewInstallForm(Number(parts[1]), parts[2]) : await viewDashboard(); break; }
        case "templates": html = role() === "CEO" ? await viewTemplates() : await viewDashboard(); break;
        case "reports": html = role() === "CEO" ? await viewReports() : await viewDashboard(); break;
        case "pending": html = role() === "TECHNICIAN" ? await viewFaults() : await viewPending(arg); break;
        case "dashboard": html = role() === "TECHNICIAN" ? await viewFaults() : await viewDashboard(); break;
        default: html = role() === "TECHNICIAN" ? await viewFaults() : await viewDashboard();
      }
      $app.innerHTML = html;
      if (page === "iq") bindIqForm();
      if (page === "iform") bindInstallForm();
      if (page === "install" && !arg) bindInstallFind();
      if (page === "install" && arg) bindProjectTabs();
      if (SEARCH_PAGES.includes(page || def)) injectListSearch(page || def);
      if (payOffer && page === "doc" && Number(arg) === payOffer) {
        const inv = payOffer; payOffer = null;
        if (can.recordPayment()) setTimeout(() => { if (confirm("فاکتور صادر شد. اگر مشتری پرداخت کرده، دریافت وجه همین حالا ثبت شود؟")) sheetPaymentForInvoice(inv).catch((er) => toast(er.message)); }, 300);
      }
      const s = document.getElementById("csearch");
      if (s) { s.addEventListener("input", () => { contractSearch = s.value; applyContractSearch(); }); applyContractSearch(); }
    } catch (e) {
      if (e instanceof AuthError) return viewLogin("لطفاً دوباره وارد شوید");
      viewError(e);
    } finally { document.body.classList.remove("busy"); }
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

  $app.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "dsearch") { e.preventDefault(); document.querySelector('[data-act="dash-search"]').click(); } });
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
    if (act === "refresh") { listCache = null; state.contracts = null; el.classList.add("spin"); route().finally(() => toast("به‌روز شد")); }
    if (act === "dash-search") { contractSearch = document.getElementById("dsearch").value.trim(); contractTab = "current"; location.hash = "#/contracts"; }
    if (act === "lsearch-clear") { const i = document.getElementById("lsearch"); if (i) { i.value = ""; i.dispatchEvent(new Event("input")); } }
    if (act === "go") { if (el.dataset.ff) faultFilter = el.dataset.ff; if (el.dataset.sf) serviceFilter = el.dataset.sf; const h = el.dataset.href.split("?"); if (h[1]) debtTab = h[1]; location.hash = h[0]; }
    if (act === "users-fold") usersOpen = !el.parentElement.open;
    if (act === "print-contract") printContract(id).catch((er) => toast(er.message));
    if (act === "new-proforma") sheetDoc("proforma", { contractId: id || null }).catch((er) => toast(er.message));
    if (act === "new-invoice") sheetDoc("invoice", { contractId: id || null }).catch((er) => toast(er.message));
    if (act === "docs-tab") { docsTab = el.dataset.k; route(); }
    if (act === "inv-print") printInvoiceDoc(id).catch((er) => toast(er.message));
    if (act === "doc-pay") sheetPaymentForInvoice(id).catch((er) => toast(er.message));
    if (act === "pf-print") printProforma(id).catch((er) => toast(er.message));
    if (act === "period-statement") sheetPeriodStatement(id);
    if (act === "pf-edit") rpc("get_proforma", { p_id: id }).then((p) => sheetDoc("proforma", { edit: p })).catch((er) => toast(er.message));
    if (act === "pf-approve") rpc("get_proforma", { p_id: id }).then((p) => sheetApproveProforma(p, () => { toast("پیش‌فاکتور تأیید شد"); route(); })).catch((er) => toast(er.message));
    if (act === "pf-invoice" && confirm("فاکتور ردیف‌های تأییدشده صادر و در حساب مشترک ثبت شود؟ بعد از صدور، دریافت وجه را همان‌جا ثبت می‌کنید."))
      rpc("invoice_from_proforma", { p_id: id }).then((inv) => { toast("فاکتور صادر شد"); payOffer = inv; location.hash = `#/doc/${inv}`; }).catch((er) => toast(er.message));
    if (act === "pf-reject") { const note = prompt("دلیل رد از طرف کارفرما:"); if (note !== null) rpc("decide_proforma", { p_id: id, p_approve: false, p_note: note.trim() || null }).then(() => { toast("رد شد"); route(); }).catch((er) => toast(er.message)); }
    if (act === "pf-cancel") { const note = prompt("دلیل لغو پیش‌فاکتور:"); if (note !== null) rpc("cancel_proforma", { p_id: id, p_note: note.trim() || null }).then(() => { toast("لغو شد"); route(); }).catch((er) => toast(er.message)); }
    if (act === "pf-sms") sendProformaSms(id).catch((er) => toast(er.message));
    if (act.startsWith("ip-") || act.startsWith("iq-") || act.startsWith("if-")) installClick(act, el, id);
    if (act === "dash-area") { dashArea = el.dataset.k; try { localStorage.setItem("dash-area", dashArea); } catch (er) { /* per-device convenience */ } route(); }
    if (act === "pf-share") {
      const url = `${location.origin}${location.pathname}?p=${el.dataset.code}`, text = `پیش‌فاکتور پایاکو شماره ${fa(el.dataset.no)} — برای مشاهده و تأیید:`;
      if (navigator.share) navigator.share({ title: text, text, url }).catch(() => {}); else copyText(url);
    }
    if (act === "tpl-key") {
      const ta = document.getElementById("tpl-body"), k = el.dataset.k, block = k.startsWith("[[");
      const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a, ins = block ? `\n${k}\n` : k;
      ta.value = ta.value.slice(0, a) + ins + ta.value.slice(b); ta.focus(); ta.selectionStart = ta.selectionEnd = a + ins.length;
    }
    if (act === "tpl-preview" || act === "tpl-view" || act === "tpl-save") {
      api("doc_templates?form_code=eq.PY-FO-PC-G08&select=id,rev,body,issued_on&order=rev.desc").then((revs) => {
        if (act === "tpl-view") { const r = revs.find((x) => x.id === id); return previewTemplate(r.body, r.rev, r.issued_on); }
        const body = document.getElementById("tpl-body").value;
        if (act === "tpl-preview") return previewTemplate(body, revs[0].rev + 1, todayTehran());
        if (!confirm(`متن جدید به‌عنوان بازنگری Rev.${String(revs[0].rev + 1).padStart(2, "0")} ذخیره شود؟ قراردادهایی که از این به بعد صادر شوند با این متن چاپ می‌شوند.`)) return;
        return rpc("save_doc_template", { p_form_code: "PY-FO-PC-G08", p_body: body, p_note: document.getElementById("tpl-note").value.trim() || null }).then((rv) => { toast(`بازنگری Rev.${String(rv).padStart(2, "0")} ذخیره شد`); route(); });
      }).catch((er) => toast(er.message));
    }
    if (act === "debt-tab") { debtTab = el.dataset.k; route(); }
    if (act === "terminate") sheetTerminate(id).catch((er) => toast(er.message));
    if (act === "vat-exempt") {
      const on = el.dataset.on === "1";
      if (confirm(on ? "این قرارداد معاف از مالیات بر ارزش افزوده ثبت شود؟ صورتحساب‌های بعدی بدون ارزش افزوده صادر می‌شوند." : "معافیت برداشته شود؟ صورتحساب‌های بعدی با ارزش افزوده صادر می‌شوند."))
        rpc("set_vat_exempt", { p_contract_id: id, p_exempt: on }).then(() => { toast("ذخیره شد"); route(); }).catch((er) => toast(er.message));
    }
    if (act === "opening-zero") {
      if (confirm(`حساب قرارداد ${el.dataset.code} تا پایان مهر ۱۴۰۵ تسویه بوده؟ سند افتتاحیه‌ی صفر ثبت و تأیید می‌شود و بعد قابل ویرایش نیست.`)) {
        el.disabled = true;
        rpc("set_opening_balance", { p_contract_id: id, p_amount: 0, p_unit: "rial", p_note: "تسویه تا پایان مهر ۱۴۰۵" })
          .then((docId) => rpc("post_opening_balance", { p_invoice_id: docId }))
          .then(() => { toast("تسویه ثبت شد"); route(); }).catch((er) => { el.disabled = false; toast(translateError({ message: er.message })); });
      }
    }
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
    if (act === "contract-tab") { contractTab = el.dataset.k; route(); }
    if (act === "new-contract") sheetNewContract().catch((er) => toast(er.message));
    if (act === "approve-contract" && confirm("این قرارداد تأیید و فعال شود؟")) rpc("approve_contract", { p_id: id, p_approve: true }).then(() => { toast("قرارداد فعال شد"); route(); }).catch((er) => toast(er.message));
    if (act === "reject-contract") { const note = prompt("دلیل رد:"); if (note !== null) rpc("approve_contract", { p_id: id, p_approve: false, p_note: note }).then(() => { toast("قرارداد رد شد"); route(); }).catch((er) => toast(er.message)); }
    if (act === "csearch-clear") { contractSearch = ""; const i = document.getElementById("csearch"); if (i) i.value = ""; applyContractSearch(); }
    if (act === "go-locations") location.hash = "#/locations";
    if (act === "new-assignment") sheetNewAssignment().catch((er) => toast(er.message));
    if (act === "plan-print") printPlan(planDate).catch((er) => toast(er.message));
    if (act === "plan-go") { planDate = readDate(document, "pday"); route(); }
    if (act === "plan-day") { planDate = addDays(readDate(document, "pday"), Number(el.dataset.d)); route(); }
    if (act === "assignment-note") sheetAssignmentNote(Number(el.dataset.id), el.dataset.note || "");
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
    if (act === "month-archive") sheetMonthArchive();
    if (act === "contract-menu") { const tpl = document.getElementById("contract-menu");
      sheet(`<h3>کارهای قرارداد</h3><div class="menu">${tpl ? tpl.innerHTML : ""}</div><div class="actions"><button class="btn secondary" data-close>بستن</button></div>`, (m, close) => {
        m.addEventListener("click", (ev) => { const b = ev.target.closest("[data-menu]"); if (!b) return; close(); const orig = document.querySelector(`.menu-src [data-mi="${b.dataset.menu}"]`); if (orig) orig.click(); }); }); }
    if (act === "sign-step") signStep(Number(el.dataset.id), el.dataset.step).catch((er) => toast(er.message));
    if (act === "ins-new") sheetInsurance({ elevatorId: Number(el.dataset.e), contractId: Number(el.dataset.c), fromId: el.dataset.last ? Number(el.dataset.last) : null }).catch((er) => toast(er.message));
    if (act === "ins-edit") sheetInsurance({ id: Number(el.dataset.id), contractId: Number(el.dataset.c) }).catch((er) => toast(er.message));
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
    if (act === "back") { e.preventDefault(); if (navStack.length > 1) history.back(); else location.hash = el.getAttribute("href") || "#/"; }
    if (act === "doc-share") shareDocLink(el.dataset.token, el.dataset.no);
    if (act === "copy") copyText(toEn(el.dataset.val));
    if (act === "pub-claim") sheetPublicClaim();
    if (act === "doc-sms") sheetSms(id).catch((er) => toast(er.message));
    if (act === "sms-tpl-save") guarded(el, async () => { await rpc("set_sms_template", { p_id: toEn(document.querySelector("[data-field=sms-tpl]").value.trim()) }); toast("ذخیره شد"); });
    if (act === "sms-tech-tpl-save") guarded(el, async () => { await rpc("set_sms_tech_templates", { p_plan: toEn(document.querySelector("[data-field=sms-tpl-plan]").value.trim()), p_fault: toEn(document.querySelector("[data-field=sms-tpl-fault]").value.trim()) }); toast("ذخیره شد"); });
    if (act === "sms-test-save") guarded(el, async () => { await rpc("set_sms_test_mobile", { p_mobile: toEn(document.querySelector("[data-field=sms-test]").value.trim()) }); toast("ذخیره شد"); });
    if (act === "sms-cust-tpl-save") guarded(el, async () => { const v = (k) => toEn(document.querySelector(`[data-field=${k}]`).value.trim());
      await rpc("set_sms_customer_templates", { p: { proforma: v("sms-tpl-proforma"), service: v("sms-tpl-service"), renewal: v("sms-tpl-renewal"), insurance: v("sms-tpl-insurance"), install: v("sms-tpl-install"), debt_day: Number(v("sms-debt-day")) || 5 } }); toast("ذخیره شد"); });
    if (act === "sms-sample") guarded(el, async () => { if (!confirm("از هر نوع پیامک یک نمونه با داده‌ی واقعی به شماره‌ی آزمایشی فرستاده شود؟")) return;
      const r = await callFunction("notify-customers", { kind: "sample" });
      sheet(`<h3>نتیجه‌ی ارسال نمونه به <bdi dir="ltr">${esc(fa(r.to || ""))}</bdi></h3>${(r.results || []).map((x) => `<div class="row" style="padding:6px 0;border-top:1px solid var(--line)"><span class="spacer">${esc(x.kind)}</span>${x.ok ? `<span class="badge ok">فرستاده شد</span>` : `<span class="badge danger">${esc(x.error || "ناموفق")}</span>`}</div>`).join("")}
        <div class="hint">در حالت واقعی امروز: ${fa(r.counts.debt)} بدهکار، ${fa(r.counts.renewal)} قرارداد رو به پایان (۳۰ روز)، ${fa(r.counts.insurance)} بیمه‌نامه‌ی رو به پایان.</div>
        <div class="actions"><button class="btn secondary" data-close>بستن</button></div>`, () => {}); });
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

  // returning to the app after a while shows fresh data (someone else may have recorded a fault meanwhile)
  let lastRoute = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && session && Date.now() - lastRoute > 60000 && !document.querySelector(".sheet-backdrop, .pp-wrap")) { listCache = null; route(); }
  });
  window.addEventListener("hashchange", () => { document.querySelectorAll(".sheet-backdrop").forEach((b) => b.remove()); route(); });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  route();

  // exposed for automated tests only
  window.__payaco = { g2j, j2g, jMonthLen };
})();
