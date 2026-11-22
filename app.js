"use strict";
// Vote Watch Dominica — web app (works in any browser; installs on phones as an app).
const API = window.VW_API, MAP = window.VW_MAP;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n === null || n === undefined ? "—" : Math.round(n).toLocaleString("en-US"));
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(0) + "%" : "—");
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "—");
const mins = (iso) => (iso ? (API.now() - new Date(iso)) / 60000 : Infinity);
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : "k" + Date.now() + Math.random().toString(16).slice(2));
function toast(msg, err) { const t = $("#toast"); t.textContent = msg; t.classList.toggle("err", !!err); t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), err ? 5000 : 3000); }
async function guard(fn, okMsg) { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message || String(e), true); return undefined; } }

const ROLE = { rep: "Station representative", watch: "Watch room", hq: "Head office", party_admin: "Party administrator", sys_admin: "System administrator" };
const RATINGS = [
  ["stronghold", "Our stronghold", 1], ["leaning", "Leaning our way", 0.6], ["competitive", "Competitive", 0],
  ["opponent_leaning", "Leaning to opponents", -0.6], ["opponent_stronghold", "Opponents' stronghold", -1], ["unrated", "Not rated", null],
];
// Party colours from public sources (Nov 2026). Each party's colour is used throughout its own private login.
const PARTY_PRESETS = [
  ["Dominica Labour Party", "DLP", "#D71920", "red"],
  ["United Workers' Party", "UWP", "#1F4E9E", "blue"],
  ["Dominica Freedom Party", "DFP", "#1B7F3B", "green"],
  ["United Progressive Party", "UPP", "#E8740C", "orange"],
];
const INCIDENT_CATS = ["Station opened late", "Long queue / delays", "Representative refused entry", "Power or lighting problem", "Access problem for elderly or disabled voters", "Crowd or security concern", "Count does not match station records", "Other"];
let ME = null, CONSTS = [], VIEW = null, REFRESH = null, SEL = { c: null, natC: null, hqMode: "rating", natMode: "obs", repTab: "turnout", repStation: null };
const cName = (id) => (CONSTS.find((c) => c.id === id) || {}).name || "—";
const cByCode = (code) => CONSTS.find((c) => c.code === code);

// ------------------------------------------------------------------ network & outbox (offline-safe)
const online = () => navigator.onLine && !window.VW_FORCE_OFFLINE;
const OB_KEY = () => "vw_outbox_" + (ME?.id || "x");
const outbox = { get: () => { try { return JSON.parse(localStorage.getItem(OB_KEY()) || "[]"); } catch { return []; } }, set: (v) => localStorage.setItem(OB_KEY(), JSON.stringify(v)) };
const isNetErr = (e) => !online() || /failed to fetch|networkerror|load failed|network request failed|fetch/i.test(e?.message || "");
const SENDERS = { attendance: (x) => API.submitAttendance(x), correction: (x) => API.submitCorrection(x), estimate: (x) => API.submitEstimate(x), incident: (x) => API.reportIncident(x) };
async function send(kind, payload) {
  const item = { kind, payload: { ...payload, device_time: payload.device_time || API.now().toISOString() }, queued_at: new Date().toISOString() };
  if (!online()) { queue(item); return { queued: true }; }
  try { return await SENDERS[kind](item.payload); }
  catch (e) { if (isNetErr(e)) { queue(item); return { queued: true }; } throw e; }
}
function queue(item) { const ob = outbox.get(); if (!ob.some((o) => o.payload.key === item.payload.key)) ob.push(item); outbox.set(ob); paintNet(); }
let flushing = false;
async function flushOutbox() {
  if (flushing || !online() || !ME) return; const ob = outbox.get(); if (!ob.length) return;
  flushing = true; let sent = 0, dup = 0; const keep = [];
  for (const it of ob) {
    try { const r = await SENDERS[it.kind](it.payload); r?.duplicate ? dup++ : sent++; }
    catch (e) { if (isNetErr(e)) keep.push(it); else { toast("A saved report was refused: " + e.message, true); } }
  }
  outbox.set(keep); flushing = false; paintNet();
  if (sent || dup) { toast(`Back online: ${sent} saved report(s) sent${dup ? `, ${dup} already received (not counted twice)` : ""}.`); REFRESH && REFRESH(); }
}
window.addEventListener("online", () => { paintNet(); flushOutbox(); });
window.addEventListener("offline", paintNet);
setInterval(flushOutbox, 20000);
function paintNet() {
  const n = $("#net"); if (!n) return; const q = outbox.get().length;
  n.className = "net" + (online() ? "" : " off");
  n.innerHTML = `<i></i>${online() ? "Online" : "No signal"}${q ? ` · ${q} waiting` : ""}`;
  const ob = $("#outbox"); if (ob) ob.innerHTML = q ? `<div class="outbox">⏳ <b>${q} report(s) saved on this phone</b> — they will send automatically when there is signal. Do not re-enter them.</div>` : "";
}

// ------------------------------------------------------------------ map
const SMALL = new Set(["RCE", "RNO", "RSO", "RVA", "MJR"]);
const PURPLE = ["#F1ECF6", "#DDCFEA", "#C9B3DE", "#B194CE", "#9A76BE", "#845DAF", "#6E46A0", "#56317F", "#3E1C61"];
const ramp = (f) => PURPLE[Math.max(0, Math.min(PURPLE.length - 1, Math.round(f * (PURPLE.length - 1))))];
function hexMix(hex, w) { const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, m = (x) => Math.round(x * w + 255 * (1 - w)); return `rgb(${m(r)},${m(g)},${m(b)})`; }
function mapSVG(id) {
  const [x, y, w, h] = MAP.viewBox;
  let s = `<svg viewBox="${x} ${y} ${w} ${h}" role="img" aria-label="Map of Dominica's 21 constituencies (schematic)"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#EEF3F6"/>`;
  s += `<path d="${MAP.coast}" fill="#000" opacity=".08" transform="translate(3,4)"/>`;
  MAP.consts.forEach((c) => (s += `<path class="cell" data-c="${c.code}" id="${id}-c-${c.code}" d="${c.d}" fill="#eee"/>`));
  s += `<path d="${MAP.coast}" fill="none" stroke="#111412" stroke-width="2"/>`;
  MAP.consts.forEach((c) => {
    const sm = SMALL.has(c.code);
    s += `<circle class="ring" id="${id}-r-${c.code}" cx="${c.cx}" cy="${c.cy}" r="5"/><text class="ml num" id="${id}-l-${c.code}" x="${c.cx}" y="${c.cy + (sm ? 4 : 2)}" font-size="${sm ? 12 : 16}"></text>`;
    if (!sm) s += `<text class="mn" id="${id}-n-${c.code}" x="${c.cx}" y="${c.cy + 15}">${esc(c.name)}</text>`;
  });
  s += `<g transform="translate(${x + w - 40},${y + 40})"><circle r="16" fill="#fff" stroke="#FCD116" stroke-width="2"/><path d="M0 -11 L5 4 L0 0 L-5 4Z" fill="#111"/><text y="-20" text-anchor="middle" font-size="11" font-weight="800">N</text></g>`;
  s += `<text x="${x + 12}" y="${y + h - 12}" font-size="11" fill="#5E6762">Caribbean Sea</text><text x="${x + w - 12}" y="${y + h - 12}" font-size="11" fill="#5E6762" text-anchor="end">Atlantic Ocean</text>`;
  s += `<text x="${x + 12}" y="${y + 18}" font-size="10.5" fill="#5E6762">Roseau area: small labels — hover or tap</text></svg>`;
  return s;
}
const prevVals = {};
function paintMap(id, data, sel) {
  MAP.consts.forEach((c) => {
    const d = data[c.code] || { fill: "#E5E7E4", label: "", dark: true };
    const cell = document.getElementById(`${id}-c-${c.code}`); if (!cell) return;
    cell.setAttribute("fill", d.fill); cell.classList.toggle("sel", sel === c.code);
    const l = document.getElementById(`${id}-l-${c.code}`); l.textContent = d.label; l.classList.toggle("dk", !!d.dark);
    const n = document.getElementById(`${id}-n-${c.code}`); if (n) n.classList.toggle("dk", !!d.dark);
    const k = id + c.code;
    if (d.value !== undefined && prevVals[k] !== undefined && d.value > prevVals[k]) { const r = document.getElementById(`${id}-r-${c.code}`); r.classList.remove("go"); void r.getBBox(); r.classList.add("go"); }
    prevVals[k] = d.value;
  });
}
function bindMap(id, hover, click) {
  const el = document.getElementById(id), tip = $("#tip");
  el.addEventListener("mousemove", (e) => { const p = e.target.closest(".cell"); if (!p) { tip.style.display = "none"; return; }
    tip.innerHTML = hover(p.dataset.c); tip.style.display = "block"; tip.style.left = Math.min(e.clientX + 14, innerWidth - 220) + "px"; tip.style.top = e.clientY + 12 + "px"; });
  el.addEventListener("mouseleave", () => (tip.style.display = "none"));
  el.addEventListener("click", (e) => { const p = e.target.closest(".cell"); if (p) { tip.style.display = "none"; click(p.dataset.c); } });
}

// ------------------------------------------------------------------ chart
function timeline(el, rows) {
  const W = 560, H = 190, P = { l: 44, r: 10, t: 10, b: 22 };
  if (!rows.length) { el.innerHTML = '<p class="muted small">No data yet.</p>'; return; }
  const t0 = new Date(rows[0].t).getTime(), t1 = Math.max(new Date(rows[rows.length - 1].t).getTime(), t0 + 3600e3);
  const maxY = Math.max(100, ...rows.map((r) => +r.observed)) * 1.1;
  const X = (t) => P.l + ((new Date(t).getTime() - t0) / (t1 - t0)) * (W - P.l - P.r), Y = (v) => H - P.b - (v / maxY) * (H - P.t - P.b);
  let g = `<svg viewBox="0 0 ${W} ${H}" width="100%">`;
  for (let i = 0; i <= 4; i++) { const v = (maxY * i) / 4; g += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#ECEFEA"/><text x="${P.l - 6}" y="${Y(v) + 4}" font-size="10" fill="#5E6762" text-anchor="end">${v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k" : Math.round(v)}</text>`; }
  const step = Math.max(1, Math.ceil(rows.length / 6));
  rows.forEach((r, i) => { if (i % step === 0) g += `<text x="${X(r.t)}" y="${H - 5}" font-size="10" fill="#5E6762" text-anchor="middle">${hhmm(r.t)}</text>`; });
  const line = (k) => rows.map((r, i) => (i ? "L" : "M") + X(r.t).toFixed(1) + "," + Y(+r[k]).toFixed(1)).join("");
  g += `<path d="${line("observed")}" fill="none" stroke="#5B2A86" stroke-width="2.6"/><path d="${line("reconciled")}" fill="none" stroke="#006B3F" stroke-width="2.6" stroke-dasharray="5 3"/></svg>`;
  el.innerHTML = g + `<div class="legend"><span class="lg"><i style="background:#5B2A86"></i>Observed (unverified)</span><span class="lg"><i style="background:#006B3F"></i>Reconciled</span></div>`;
}
function csv(name, rows) {
  const q = (v) => (/[",\n]/.test(String(v ?? "")) ? '"' + String(v).replace(/"/g, '""') + '"' : v ?? "");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv" }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const statusPill = (s) => ({ reconciled: '<span class="pill p-rec">RECONCILED</span>', flagged: '<span class="pill p-flag">⚠ CHECK</span>', unverified: '<span class="pill p-unv">UNVERIFIED</span>',
  superseded: '<span class="pill p-none">CORRECTED</span>', rejected: '<span class="pill p-flag">REJECTED</span>' }[s] || "");
const stationPill = (at) => (!at ? '<span class="pill p-none">NOT REPORTED</span>' : mins(at) > 60 ? '<span class="pill p-stale">STALE</span>' : '<span class="pill p-ok">REPORTING</span>');

// ------------------------------------------------------------------ shell
function tabsFor(role) {
  const nat = ["national", "ALL", "National Watch"];
  return { rep: [["station", "L1", "My station"], nat], watch: [["watch", "L2", "Watch room"], nat],
    hq: [["hq", "L3", "Head office"], ["watch", "L2", "Watch rooms"], nat],
    party_admin: [["hq", "L3", "Head office"], ["watch", "L2", "Watch rooms"], nat, ["team", "ADM", "Team & sharing"]],
    sys_admin: [["admin", "SYS", "System admin"], nat] }[role] || [];
}
function paintShell() {
  const party = ME?.party;
  document.documentElement.style.setProperty("--party", party?.color || "#333");
  $("#who").innerHTML = `<span class="clock num" id="clock"></span><span class="net" id="net"></span>` +
    (ME?.role ? `${party ? `<span class="chip"><span class="sw"></span>${esc(party.short_name)}</span>` : ""}<span>${esc(ME.full_name)} · <span style="color:#FCD116">${ROLE[ME.role]}</span></span>` : "") +
    (API.mode === "live" && ME ? `<button class="btn sm ghost" id="signOut" style="color:#111">Sign out</button>` : "");
  $("#signOut") && ($("#signOut").onclick = async () => { await API.signOut(); location.reload(); });
  $("#tabs").innerHTML = ME?.role ? tabsFor(ME.role).map(([v, k, l]) => `<button data-v="${v}" class="${v === VIEW ? "on" : ""}"><span class="k">${k}</span>${l}</button>`).join("") : "";
  $("#tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) go(b.dataset.v); };
  const disclaimer = "Independent monitoring platform — not the Electoral Office and not official results. Attendance counts only; no ballot choices are collected.";
  if (API.mode === "demo") {
    const d = API.demo;
    $("#banner").innerHTML = `<b>DEMO MODE · SYNTHETIC DATA</b><span>View as:</span><select id="persona">${d.people.map((p) => `<option value="${p.id}" ${p.id === d.persona ? "selected" : ""}>${esc(p.full_name)}</option>`).join("")}</select>
      <button id="play">${d.playing ? "❚❚ Pause" : "▶ Play"}</button><select id="speed">${[2, 5, 15].map((s) => `<option value="${s}" ${s === d.speed ? "selected" : ""}>${s} min/sec</option>`).join("")}</select>
      <button id="jump">Jump to 12:00</button><label class="row" style="gap:4px"><input type="checkbox" id="noSignal" ${window.VW_FORCE_OFFLINE ? "checked" : ""}> Simulate no signal</label><span class="small">${disclaimer}</span>`;
    $("#persona").onchange = (e) => d.setPersona(e.target.value);
    $("#play").onclick = (e) => (e.target.textContent = d.toggle() ? "❚❚ Pause" : "▶ Play");
    $("#speed").onchange = (e) => d.setSpeed(+e.target.value);
    $("#jump").onclick = () => d.jump(12 * 60);
    $("#noSignal").onchange = (e) => { window.VW_FORCE_OFFLINE = e.target.checked; paintNet(); if (!e.target.checked) flushOutbox(); };
  } else $("#banner").innerHTML = `<span class="small">${disclaimer}</span>`;
  paintNet(); tickClock();
}
function tickClock() { const c = $("#clock"); if (c) c.textContent = hhmm(API.now().toISOString()); }
setInterval(tickClock, 1000);
function go(v) { VIEW = v; REFRESH = null; $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.v === v)); window.scrollTo(0, 0); (VIEWS[v] || (() => {}))(); }
let refreshTimer = null, lastRefresh = 0, refreshing = false;
function scheduleRefresh() {
  if (refreshTimer) return;
  const gap = API.mode === "demo" ? 1200 : 800, wait = Math.max(0, lastRefresh + gap - Date.now());
  refreshTimer = setTimeout(async () => { refreshTimer = null; if (refreshing || !REFRESH) return; refreshing = true; lastRefresh = Date.now();
    try { await REFRESH(); } catch (e) {} finally { refreshing = false; } }, wait);
}

// ------------------------------------------------------------------ auth screens (live mode)
// "Show" button beside every password box, so people can see what they type (and so typing works where a browser blocks hidden fields)
function addShowButtons() {
  $$("input[type=password]").forEach((i) => {
    if (i.dataset.sh) return; i.dataset.sh = "1";
    const b = document.createElement("button"); b.type = "button"; b.className = "btn sm ghost"; b.textContent = "Show password"; b.style.marginTop = "6px";
    b.onclick = () => { const hidden = i.type === "password"; i.type = hidden ? "text" : "password"; b.textContent = hidden ? "Hide password" : "Show password"; i.focus(); };
    i.insertAdjacentElement("afterend", b);
  });
}
// Sign-in problems stay on screen in plain words (a brief pop-up was too easy to miss)
const authErr = (msg) => `<div class="receipt" style="margin-top:12px;border-color:#F1B8BF;background:var(--red-l);color:#8A1020"><b>Could not sign in.</b> ${esc(msg)}</div>`;
function friendlyAuthError(e) {
  const m = String(e?.message || e || "");
  if (/invalid login credentials/i.test(m)) return "The email or password is wrong. Passwords are case-sensitive: use \"Show password\" to check what you typed.";
  if (/email not confirmed/i.test(m)) return "This email has not been confirmed yet. Open the confirmation email, or ask your administrator to confirm the account.";
  if (/rate limit|too many/i.test(m)) return "Too many attempts. Wait a minute and try again.";
  if (!navigator.onLine || /fetch|network/i.test(m)) return "No connection to the server. Check your internet signal and try again.";
  return m;
}
function authScreen(mode) {
  setTimeout(addShowButtons, 0);
  $("#tabs").innerHTML = ""; const inviteFromLink = (location.hash.match(/invite=([A-Z0-9-]+)/i) || [])[1] || localStorage.getItem("vw_invite") || "";
  if (inviteFromLink && !mode) mode = "signup";
  const M = $("#main");
  if (mode === "signup") {
    M.innerHTML = `<div class="auth"><div class="card"><h2>Create your account</h2><p class="muted small">You need an invite code from your party administrator.</p>
      <label class="f">Invite code</label><input class="inp" id="code" value="${esc(inviteFromLink)}" placeholder="XXXX-XXXX-XXXX" autocapitalize="characters">
      <label class="f">Your full name</label><input class="inp" id="name" autocomplete="name">
      <label class="f">Email</label><input class="inp" id="email" type="email" autocomplete="email">
      <label class="f">Password (at least 10 characters)</label><input class="inp" id="pw" type="password" autocomplete="new-password">
      <button class="btn big" style="margin-top:16px" id="go">Create account</button>
      <p class="small"><a href="#" id="toLogin">I already have an account</a></p></div></div>`;
    $("#toLogin").onclick = (e) => { e.preventDefault(); authScreen("login"); };
    $("#go").insertAdjacentHTML("afterend", '<div id="authErr" role="alert" aria-live="assertive"></div>');
    $("#go").onclick = () => guard(async () => { $("#authErr").innerHTML = ""; try {
      const code = $("#code").value.trim(), name = $("#name").value.trim(), email = $("#email").value.trim(), pw = $("#pw").value;
      if (!code || name.length < 2 || !email || pw.length < 10) throw new Error("Fill in every field (password at least 10 characters).");
      localStorage.setItem("vw_invite", code); localStorage.setItem("vw_name", name);
      const r = await API.signUp(email, pw);
      if (r.needsConfirm) { M.innerHTML = `<div class="auth"><div class="card"><h2>Check your email</h2><p>We sent a confirmation link to <b>${esc(email)}</b>. Open it, then sign in here. Your invite code is remembered on this device.</p><button class="btn" onclick="location.reload()">Go to sign in</button></div></div>`; return; }
      await API.redeem(code, name); localStorage.removeItem("vw_invite"); history.replaceState(null, "", location.pathname); boot();
    } catch (e) { $("#authErr").innerHTML = authErr(friendlyAuthError(e)); throw e; } });
    return;
  }
  if (mode === "reset") {
    M.innerHTML = `<div class="auth"><div class="card"><h2>Set a new password</h2><label class="f">New password (at least 10 characters)</label><input class="inp" id="pw" type="password" autocomplete="new-password"><button class="btn big" style="margin-top:16px" id="go">Save password</button></div></div>`;
    $("#go").onclick = () => guard(async () => { if ($("#pw").value.length < 10) throw new Error("At least 10 characters."); await API.updatePassword($("#pw").value); window.VW_RECOVERY = false; boot(); }, "Password updated.");
    return;
  }
  M.innerHTML = `<div class="auth"><div class="card"><h2>Sign in</h2><p class="muted small">Authorised party representatives, watch rooms and head offices only.</p>
    <label class="f">Email</label><input class="inp" id="email" type="email" autocomplete="username">
    <label class="f">Password</label><input class="inp" id="pw" type="password" autocomplete="current-password">
    <button class="btn big" style="margin-top:16px" id="go">Sign in</button>
    <div id="authErr" role="alert" aria-live="assertive"></div>
    <p class="small row" style="justify-content:space-between"><a href="#" id="toSignup">I have an invite code</a><a href="#" id="forgot">Forgot password?</a></p></div></div>`;
  $("#toSignup").onclick = (e) => { e.preventDefault(); authScreen("signup"); };
  $("#forgot").onclick = (e) => { e.preventDefault(); const em = $("#email").value.trim(); if (!em) return toast("Type your email first.", true); guard(() => API.resetPassword(em), "Password reset email sent."); };
  const submit = async () => {
    const btn = $("#go"), box = $("#authErr"), email = $("#email").value.trim(), pw = $("#pw").value;
    box.innerHTML = "";
    if (!email || !pw) { box.innerHTML = authErr("Type your email and your password first."); return; }
    btn.disabled = true; btn.textContent = "Signing in…";
    try { await API.signIn(email, pw); btn.textContent = "Opening…"; await boot(); }
    catch (e) { btn.disabled = false; btn.textContent = "Sign in"; box.innerHTML = authErr(friendlyAuthError(e)); }
  };
  $("#go").onclick = submit; $("#pw").onkeydown = (e) => e.key === "Enter" && submit();
}
function redeemScreen() {
  $("#main").innerHTML = `<div class="auth"><div class="card"><h2>Enter your invite code</h2><p class="muted small">Signed in as ${esc(ME.email)}. Your account is not linked to a party yet.</p>
    <label class="f">Invite code</label><input class="inp" id="code" value="${esc(localStorage.getItem("vw_invite") || "")}">
    <label class="f">Your full name</label><input class="inp" id="name" value="${esc(localStorage.getItem("vw_name") || "")}">
    <button class="btn big" style="margin-top:16px" id="go">Continue</button><p class="small"><a href="#" id="out">Sign out</a></p></div></div>`;
  $("#out").onclick = async (e) => { e.preventDefault(); await API.signOut(); location.reload(); };
  $("#go").onclick = () => guard(async () => { await API.redeem($("#code").value.trim(), $("#name").value.trim()); localStorage.removeItem("vw_invite"); boot(); }, "Account linked.");
}

// ------------------------------------------------------------------ NATIONAL WATCH (shared)
async function viewNational() {
  $("#main").innerHTML = `
  <div class="row" style="margin-bottom:12px"><b style="font-size:16px">National Watch</b><span class="muted small">Shared picture for all parties. Built only from attendance totals that parties chose to share, each with its source shown. Never includes any party's supporter estimates.</span></div>
  <div class="grid kpis" style="margin-bottom:14px">
    <div class="card kpi pu"><div class="l">Observed attendance · unverified</div><div class="v num" id="kObs">—</div><div class="s" id="kObsS"></div></div>
    <div class="card kpi g"><div class="l">Reconciled attendance</div><div class="v num" id="kRec">—</div><div class="s" id="kRecS"></div></div>
    <div class="card kpi k"><div class="l">Stations reporting</div><div class="v num" id="kSt">—</div><div class="s" id="kStS"></div></div>
    <div class="card kpi r"><div class="l">Needs attention</div><div class="v num" id="kAl">—</div><div class="s">sources disagree · shared incidents</div></div>
  </div>
  <div class="grid split">
    <div class="card"><h3>Live map · 21 constituencies</h3>
      <div class="seg noprint" id="natMode" style="margin-bottom:10px"><button data-m="obs">Observed</button><button data-m="rec">Reconciled</button><button data-m="pct">% of electors listed</button></div>
      <div class="map" id="natMap">${mapSVG("natMap")}</div>
      <div class="legend"><span id="lLo">0</span><span class="ramp"></span><span id="lHi"></span></div>
      <p class="small muted" style="margin-bottom:0">Schematic map: shapes show roughly where each constituency is, not legal boundaries. Tap a constituency for its stations.</p></div>
    <div class="grid" style="align-content:start">
      <div class="card"><h3>Constituencies <span class="sp noprint row"><button class="btn sm ghost" id="natCsv">⬇ CSV</button><button class="btn sm ghost" onclick="print()">⬇ PDF</button></span></h3>
        <div class="tw" style="max-height:430px"><table><thead><tr><th>Constituency</th><th class="r">Observed</th><th class="r">Reconciled</th><th>% of list</th><th class="r">Stations</th><th class="r">Alerts</th><th class="r">Updated</th></tr></thead><tbody id="natRows"></tbody></table></div></div>
      <div class="card hide" id="natDrill"></div>
      <div class="card"><h3>Attendance through the day</h3><div id="natChart"></div></div>
    </div>
  </div>`;
  $$("#natMode button").forEach((b) => { b.classList.toggle("on", b.dataset.m === SEL.natMode); b.onclick = () => { SEL.natMode = b.dataset.m; $$("#natMode button").forEach((x) => x.classList.toggle("on", x === b)); load(); }; });
  let rows = [];
  bindMap("natMap", (code) => { const r = rows.find((x) => x.code === code) || {}; return `<b>${esc(r.name)}</b>Observed ${fmt(r.observed)} · Reconciled ${fmt(r.reconciled)}<br>${r.stations_reporting ?? 0}/${r.stations_total ?? 0} stations · ${pct(r.observed, r.electors_listed)} of list${r.disagreements ? `<br>⚠ ${r.disagreements} station(s): sources disagree` : ""}`; },
    (code) => { SEL.natC = cByCode(code)?.id; drill(); });
  $("#natCsv").onclick = () => csv("national-watch.csv", [["constituency", "observed_unverified", "reconciled", "electors_listed", "stations_reporting", "stations_total", "disagreements", "shared_incidents", "last_update", "generated"],
    ...rows.map((r) => [r.name, r.observed, r.reconciled, r.electors_listed, r.stations_reporting, r.stations_total, r.disagreements, r.shared_incidents, r.last_at, API.now().toISOString()])]);
  async function drill() {
    const el = $("#natDrill"); if (!SEL.natC) return el.classList.add("hide");
    const st = await API.nationalStations(SEL.natC); el.classList.remove("hide");
    el.innerHTML = `<h3>${esc(cName(SEL.natC))} · stations (shared) <span class="sp"><button class="btn sm ghost" id="dClose">Close</button></span></h3><div class="tw" style="max-height:300px"><table><thead><tr><th>Station</th><th>Status</th><th class="r">Observed</th><th class="r">Reconciled</th><th class="r">Updated</th><th>Sources</th></tr></thead><tbody>${
      st.map((s) => `<tr><td><b>${esc(s.official_code)}</b> <span class="muted small">${esc(s.station_name)}</span></td><td>${stationPill(s.last_at)}</td><td class="r num">${fmt(s.observed)}</td><td class="r num">${fmt(s.reconciled)}</td><td class="r num">${hhmm(s.last_at)}</td><td class="small">${(s.sources || []).map(esc).join(", ") || "—"}${s.disagreement ? ' <span class="pill p-flag">DISAGREE</span>' : ""}</td></tr>`).join("") || '<tr><td colspan="6" class="muted">No stations loaded for this constituency yet.</td></tr>'}</tbody></table></div>`;
    $("#dClose").onclick = () => { SEL.natC = null; el.classList.add("hide"); paint(); };
  }
  function paint() {
    const val = (r) => (SEL.natMode === "rec" ? +r.reconciled : SEL.natMode === "pct" ? (r.electors_listed ? r.observed / r.electors_listed : 0) : +r.observed);
    const max = SEL.natMode === "pct" ? 0.8 : Math.max(100, ...rows.map(val));
    const data = {}; rows.forEach((r) => { const f = val(r) / max; data[r.code] = { fill: ramp(f), dark: f < 0.45, value: +r.observed, label: SEL.natMode === "pct" ? (r.electors_listed ? Math.round(val(r) * 100) + "%" : "—") : fmt(val(r)) }; });
    paintMap("natMap", data, SEL.natC ? CONSTS.find((c) => c.id === SEL.natC)?.code : null);
    $("#lHi").textContent = SEL.natMode === "pct" ? "80%+" : fmt(max); $("#lLo").textContent = SEL.natMode === "pct" ? "0%" : "0";
  }
  async function load() {
    const [sum, tl] = await Promise.all([API.nationalSummary(), API.nationalTimeline()]); rows = sum;
    const T = (k) => rows.reduce((a, r) => a + +r[k], 0);
    const obs = T("observed"), rec = T("reconciled"), el = T("electors_listed"), rep = T("stations_reporting"), tot = T("stations_total");
    $("#kObs").textContent = fmt(obs); $("#kObsS").textContent = el ? pct(obs, el) + " of electors listed" : "electors list not loaded yet";
    $("#kRec").textContent = fmt(rec); $("#kRecS").textContent = pct(rec, obs) + " of observed figures reconciled";
    $("#kSt").textContent = `${rep} / ${tot}`; $("#kStS").textContent = `${tot - rep} not yet reported`;
    $("#kAl").textContent = fmt(T("disagreements") + T("shared_incidents"));
    $("#natRows").innerHTML = rows.map((r) => `<tr class="click" data-id="${r.constituency_id}"><td><b>${esc(r.name)}</b></td><td class="r num">${fmt(r.observed)}</td><td class="r num">${fmt(r.reconciled)}</td>
      <td><div class="row" style="gap:6px;flex-wrap:nowrap"><div class="bar"><i style="width:${r.electors_listed ? Math.min(100, (r.observed / r.electors_listed) * 125) : 0}%"></i></div><span class="small num">${pct(r.observed, r.electors_listed)}</span></div></td>
      <td class="r num">${r.stations_reporting}/${r.stations_total}</td><td class="r">${r.disagreements + r.shared_incidents ? `<span class="pill p-flag">${r.disagreements + r.shared_incidents}</span>` : '<span class="muted">—</span>'}</td><td class="r num">${hhmm(r.last_at)}</td></tr>`).join("");
    $$("#natRows tr").forEach((tr) => (tr.onclick = () => { SEL.natC = +tr.dataset.id; drill(); paint(); }));
    paint(); timeline($("#natChart"), tl); if (SEL.natC) drill();
  }
  REFRESH = load; await guard(load);
}

// ------------------------------------------------------------------ REP: my station (mobile first)
async function viewStation() {
  const sts = ME.stations; if (!sts.length) { $("#main").innerHTML = '<div class="card">You are not assigned to a polling station yet. Ask your party administrator.</div>'; return; }
  if (!sts.find((s) => s.id === SEL.repStation)) SEL.repStation = sts[0].id;
  const st = sts.find((s) => s.id === SEL.repStation), P = ME.party;
  $("#main").innerHTML = `<div class="rep">
    ${sts.length > 1 ? `<select class="inp" id="stSel" style="margin-bottom:10px">${sts.map((s) => `<option value="${s.id}" ${s.id === st.id ? "selected" : ""}>${esc(s.official_code)} — ${esc(s.name)}</option>`).join("")}</select>` : ""}
    <div class="receipt"><div class="h"><span>${esc(st.official_code)}</span><span class="pill p-ok">ASSIGNED</span></div><div>${esc(st.name)}</div><div class="muted small">${esc(st.district || "")} · ${esc(cName(st.constituency_id))}${st.electors_listed ? ` · ${fmt(st.electors_listed)} electors on list` : ""}</div></div>
    <div id="outbox"></div>
    <div class="rtabs"><button data-t="turnout">Turnout</button><button data-t="support" class="priv">🔒 Supporters</button><button data-t="incident">Incident</button><button data-t="history">My reports</button></div>
    <div id="repBody"></div></div>`;
  $("#stSel") && ($("#stSel").onchange = (e) => { SEL.repStation = e.target.value; viewStation(); });
  $$(".rtabs button").forEach((b) => (b.onclick = () => { SEL.repTab = b.dataset.t; tab(); }));
  let mine = { subs: [], estimates: [], incidents: [] };
  const lastGood = () => mine.subs.find((s) => s.status !== "superseded" && s.status !== "rejected");
  const lastEst = () => mine.estimates[0];
  async function loadMine() { mine = await API.myReports(st.id); if (SEL.repTab === "history") tab(); else { const l = $("#lastTot"); if (l) l.innerHTML = lastTotHtml(); } }
  const lastTotHtml = () => { const l = lastGood(); return l ? `${fmt(l.attendance)} <span class="small muted">at ${hhmm(l.received_at)}</span> ${statusPill(l.status)}` : '<span class="muted">No report yet</span>'; };
  function confirmBox(r, retry) {
    const el = $("#sendMsg");
    if (r.queued) el.innerHTML = `<div class="outbox"><b>⏳ No signal — saved on this phone.</b> It will send automatically. Don't type it again.</div>`;
    else if (r.duplicate) el.innerHTML = `<div class="receipt" style="border-color:#F1B8BF"><b>Already received</b> — this exact report reached the server earlier. It was not counted twice.</div>`;
    else el.innerHTML = `<div class="receipt" style="border-color:#9CD3B3"><b>✓ Received by the server at ${hhmm(r.received_at)}</b> · ref ${esc(r.id)}${r.flags?.length ? `<div class="small" style="color:var(--red)">⚠ Sent to your watch room to check: ${esc(r.flags.join("; "))}</div>` : ""}<div class="row" style="margin-top:6px"><button class="btn sm ghost" id="again">New report</button></div></div>`;
    $("#again") && ($("#again").onclick = retry);
  }
  function tab() {
    $$(".rtabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === SEL.repTab));
    const B = $("#repBody");
    if (SEL.repTab === "turnout") {
      const key = newKey();
      B.innerHTML = `<div class="card"><div class="small muted">Your last accepted total</div><div style="font-size:22px;font-weight:800" class="num" id="lastTot">${lastTotHtml()}</div>
        <label class="f">Total people seen voting so far (running total)</label><input class="inp bigin num" id="cnt" type="number" inputmode="numeric" min="0" placeholder="0">
        <label class="f">Note (optional — no names)</label><input class="inp" id="note" maxlength="500" placeholder="e.g. queue of about 30 people">
        <button class="btn big y" style="margin-top:14px" id="send">Send turnout report</button><div id="sendMsg" style="margin-top:10px"></div>
        <p class="small muted" style="margin-bottom:0">The server records the official time. If you tap twice, it is only counted once.</p></div>`;
      $("#send").onclick = () => guard(async () => {
        const v = parseInt($("#cnt").value, 10); if (!(v >= 0)) throw new Error("Enter the running total as a whole number.");
        const l = lastGood(); if (l && v < l.attendance && !confirm(`This is lower than your last total (${l.attendance}). Send anyway? Use "My reports → Correct" to fix a mistake instead.`)) return;
        const r = await send("attendance", { station: st.id, key, attendance: v, note: $("#note").value.trim() });
        confirmBox(r, () => tab()); if (!r.queued) loadMine();
      });
    } else if (SEL.repTab === "support") {
      const key = newKey(), l = lastGood(), e = lastEst();
      B.innerHTML = `<div class="card" style="border-top:4px solid var(--party)"><div class="row"><span class="private">🔒 Private to ${esc(P.short_name)}</span></div>
        <p class="small" style="margin:8px 0 0">Goes only to <b>${esc(P.name)}</b>'s head office and your watch room. Never shared with other parties, never in the National Watch. It is <b>your estimate</b>, not a vote count. Numbers only — never write voters' names.</p>
        <div class="grid two" style="margin-top:10px;gap:8px"><div class="receipt"><div class="small muted">Turnout so far</div><b class="num">${l ? fmt(l.attendance) : "—"}</b></div><div class="receipt"><div class="small muted">Your last estimate</div><b class="num">${e ? fmt(e.estimated_supporters) + " · " + hhmm(e.received_at) : "—"}</b></div></div>
        <label class="f">Of the people who have voted so far, how many do you believe support ${esc(P.short_name)}?</label><input class="inp bigin num" id="est" type="number" inputmode="numeric" min="0" placeholder="0">
        <div id="estPct" class="small muted" style="text-align:center"></div>
        <label class="f">How sure are you?</label><div class="seg" id="conf"><button data-c="low">Rough guess</button><button data-c="medium" class="on">Fairly sure</button><button data-c="high">Very sure</button></div>
        <label class="f">Note (optional — no names)</label><input class="inp" id="enote" maxlength="500">
        <button class="btn big" style="margin-top:14px;background:var(--party)" id="send">Send private estimate</button><div id="sendMsg" style="margin-top:10px"></div></div>`;
      let conf = "medium";
      $$("#conf button").forEach((b) => (b.onclick = () => { conf = b.dataset.c; $$("#conf button").forEach((x) => x.classList.toggle("on", x === b)); }));
      $("#est").oninput = () => { const v = +$("#est").value; $("#estPct").textContent = l && v ? `≈ ${pct(v, l.attendance)} of turnout so far` : ""; };
      $("#send").onclick = () => guard(async () => {
        const v = parseInt($("#est").value, 10); if (!(v >= 0)) throw new Error("Enter a whole number.");
        if (l && v > l.attendance) throw new Error("The estimate cannot be more than the turnout so far (" + l.attendance + ").");
        const r = await send("estimate", { station: st.id, key, estimate: v, confidence: conf, note: $("#enote").value.trim() });
        confirmBox(r, () => tab()); if (!r.queued) loadMine();
      });
    } else if (SEL.repTab === "incident") {
      const key = newKey();
      B.innerHTML = `<div class="card"><label class="f">What happened?</label><select class="inp" id="cat">${INCIDENT_CATS.map((c) => `<option>${c}</option>`).join("")}</select>
        <label class="f">How urgent?</label><div class="seg" id="sev"><button data-s="low">Low</button><button data-s="medium" class="on">Medium</button><button data-s="high">High</button></div>
        <label class="f">Details (no personal names)</label><textarea class="inp" id="desc" rows="4" maxlength="1000"></textarea>
        <button class="btn big dark" style="margin-top:14px" id="send">Send to watch room</button><div id="sendMsg" style="margin-top:10px"></div></div>`;
      let sev = "medium"; $$("#sev button").forEach((b) => (b.onclick = () => { sev = b.dataset.s; $$("#sev button").forEach((x) => x.classList.toggle("on", x === b)); }));
      $("#send").onclick = () => guard(async () => { const r = await send("incident", { station: st.id, key, category: $("#cat").value, severity: sev, description: $("#desc").value.trim() }); confirmBox(r, () => tab()); if (!r.queued) loadMine(); });
    } else {
      const ob = outbox.get();
      B.innerHTML = (ob.length ? ob.map((o) => `<div class="receipt" style="border-color:#EFD978"><div class="h"><span>${o.kind === "attendance" ? fmt(o.payload.attendance) : o.kind === "estimate" ? "🔒 " + fmt(o.payload.estimate) : o.kind}</span><span class="pill p-stale">WAITING FOR SIGNAL</span></div><div class="small muted">${o.kind} · saved ${hhmm(o.queued_at)}</div></div>`).join("") : "") +
        `<h3 style="margin:14px 0 6px;font-size:13px">Turnout reports</h3>` + (mine.subs.map((s) => `<div class="receipt"><div class="h"><span class="num">${fmt(s.attendance)}</span>${statusPill(s.status)}</div>
          <div class="small muted">ref ${s.id} · server ${hhmm(s.received_at)}${s.kind === "correction" ? ` · corrects ${s.corrects_id}: “${esc(s.reason)}”` : ""}${s.flags?.length && s.status === "flagged" ? `<br><span style="color:var(--red)">${esc(s.flags.join("; "))}</span>` : ""}</div>
          ${s.status !== "superseded" && s.status !== "rejected" ? `<button class="btn sm ghost" style="margin-top:6px" data-corr="${s.id}">Correct this report</button>` : ""}</div>`).join("") || '<p class="muted small">None yet.</p>') +
        `<h3 style="margin:14px 0 6px;font-size:13px">🔒 Private supporter estimates</h3>` + (mine.estimates.map((e) => `<div class="receipt"><div class="h"><span class="num">${fmt(e.estimated_supporters)}</span><span class="pill p-q">${esc(e.confidence)}</span></div><div class="small muted">server ${hhmm(e.received_at)}</div></div>`).join("") || '<p class="muted small">None yet.</p>') +
        `<h3 style="margin:14px 0 6px;font-size:13px">Incidents</h3>` + (mine.incidents.map((i) => `<div class="receipt"><div class="h"><span style="font-size:13px">${esc(i.category)}</span><span class="pill ${i.status === "open" ? "p-stale" : "p-ok"}">${i.status.toUpperCase()}</span></div><div class="small muted">${hhmm(i.created_at)} · ${esc(i.description || "")}${i.resolution_note ? " · " + esc(i.resolution_note) : ""}</div></div>`).join("") || '<p class="muted small">None.</p>');
      $$("[data-corr]", B).forEach((b) => (b.onclick = () => correction(mine.subs.find((s) => String(s.id) === b.dataset.corr))));
    }
  }
  function correction(s) {
    const key = newKey(); SEL.repTab = "correct"; $$(".rtabs button").forEach((b) => b.classList.remove("on"));
    $("#repBody").innerHTML = `<div class="card"><h3>Correct report ${s.id}</h3><p class="small">The original (${fmt(s.attendance)} at ${hhmm(s.received_at)}) is kept permanently. Your correction is added and linked to it.</p>
      <label class="f">Correct running total</label><input class="inp bigin num" id="cv" type="number" inputmode="numeric" value="${s.attendance}">
      <label class="f">Reason (required)</label><input class="inp" id="cr" placeholder="e.g. typing error — 214 not 241">
      <div class="row" style="margin-top:14px"><button class="btn ghost" id="cancel">Cancel</button><button class="btn y" style="flex:1" id="send">Send correction</button></div><div id="sendMsg" style="margin-top:10px"></div></div>`;
    $("#cancel").onclick = () => { SEL.repTab = "history"; tab(); };
    $("#send").onclick = () => guard(async () => {
      const v = parseInt($("#cv").value, 10), reason = $("#cr").value.trim(); if (!(v >= 0) || reason.length < 3) throw new Error("Enter the correct total and a reason.");
      const r = await send("correction", { original: s.id, key, attendance: v, reason });
      if (r.queued || r.duplicate) return confirmBox(r, () => { SEL.repTab = "history"; tab(); });
      toast("✓ Correction received. The original is kept on record."); SEL.repTab = "history"; await loadMine(); tab();
    });
  }
  paintNet(); tab(); REFRESH = loadMine; await guard(loadMine); flushOutbox();
}

// ------------------------------------------------------------------ WATCH ROOM (party-private)
async function viewWatch() {
  const allowed = ME.role === "watch" ? CONSTS.filter((c) => ME.constituencies.includes(c.id)) : CONSTS;
  if (!allowed.length) { $("#main").innerHTML = '<div class="card">No constituency is assigned to you yet.</div>'; return; }
  if (!allowed.find((c) => c.id === SEL.c)) SEL.c = allowed[0].id;
  const P = ME.party;
  $("#main").innerHTML = `<div class="partyhead"><b>${esc(P.name)} · Watch room</b><span class="private" style="background:rgba(255,255,255,.2)">🔒 Private to ${esc(P.short_name)}</span>
    <select class="inp" id="cSel" style="width:auto;margin-left:auto">${allowed.map((c) => `<option value="${c.id}" ${c.id === SEL.c ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
  <div class="grid kpis" style="margin-bottom:14px">
    <div class="card kpi y"><div class="l">Our reps' turnout · unverified</div><div class="v num" id="wObs">—</div></div>
    <div class="card kpi g"><div class="l">Reconciled by us</div><div class="v num" id="wRec">—</div></div>
    <div class="card kpi p"><div class="l">🔒 Estimated ${esc(P.short_name)} supporters</div><div class="v num" id="wEst">—</div><div class="s" id="wEstS"></div></div>
    <div class="card kpi k"><div class="l">Reporting / stale / silent</div><div class="v num" id="wSt">—</div></div>
    <div class="card kpi r"><div class="l">Needs attention</div><div class="v num" id="wAl">—</div></div>
  </div>
  <div class="grid split2">
    <div class="card"><h3>Polling stations <span class="sp small muted" style="text-transform:none;letter-spacing:0">Stale = nothing for 60+ minutes</span></h3>
      <div class="tw"><table><thead><tr><th>Station</th><th>Status</th><th class="r">Latest</th><th class="r">Reconciled</th><th class="r">🔒 Est. supporters</th><th class="r">Time</th><th class="noprint">Action</th></tr></thead><tbody id="wRows"></tbody></table></div></div>
    <div class="grid" style="align-content:start">
      <div class="card"><h3>Incidents &amp; discrepancies</h3><div class="feed" id="wInc"></div></div>
      <div class="card"><h3>Audit trail (our reports)</h3><div class="feed" id="wLog" style="max-height:300px"></div></div>
    </div></div>`;
  $("#cSel").onchange = (e) => { SEL.c = +e.target.value; viewWatch(); };
  let stRows = [];
  async function load() {
    const [st, inc, log] = await Promise.all([API.partyStations(SEL.c), API.incidents(SEL.c), API.subLog(SEL.c)]); stRows = st;
    const S = (k) => st.reduce((a, s) => a + (+s[k] || 0), 0);
    const goodObs = st.reduce((a, s) => a + (s.latest_status === "flagged" ? 0 : +s.latest_attendance || 0), 0);
    $("#wObs").textContent = fmt(goodObs); $("#wRec").textContent = fmt(S("reconciled")); $("#wEst").textContent = fmt(S("est_supporters"));
    $("#wEstS").textContent = goodObs ? pct(S("est_supporters"), goodObs) + " of turnout reported" : "";
    const rep = st.filter((s) => s.latest_at), stale = rep.filter((s) => mins(s.latest_at) > 60);
    $("#wSt").textContent = `${rep.length - stale.length} / ${stale.length} / ${st.length - rep.length}`;
    $("#wAl").textContent = inc.filter((i) => i.status === "open").length;
    $("#wRows").innerHTML = st.map((s) => `<tr><td><b>${esc(s.official_code)}</b><div class="small muted">${esc(s.station_name)} · ${esc(s.district)}${s.reps ? "" : ' · <span style="color:var(--amber)">no rep assigned</span>'}</div></td><td>${stationPill(s.latest_at)}</td>
      <td class="r num">${fmt(s.latest_attendance)} ${s.latest_status ? statusPill(s.latest_status) : ""}${s.latest_status === "flagged" ? `<div class="small" style="color:var(--red)">${esc((s.latest_flags || []).join("; "))}</div>` : ""}</td>
      <td class="r num">${fmt(s.reconciled)}</td><td class="r num">${fmt(s.est_supporters)}${s.est_confidence ? ` <span class="pill p-q">${esc(s.est_confidence)}</span>` : ""}</td><td class="r num">${hhmm(s.latest_at)}</td>
      <td class="noprint">${s.latest_id && ["unverified", "flagged"].includes(s.latest_status) ? `<div class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn sm" data-rec="${s.latest_id}">Verify</button><button class="btn sm ghost" data-ask="${s.latest_id}" title="Ask the representative to correct it">Ask fix</button>${s.latest_status === "flagged" ? `<button class="btn sm warn" data-rej="${s.latest_id}">Reject</button>` : ""}</div>` : ""}</td></tr>`).join("") || '<tr><td colspan="7" class="muted">No polling stations loaded for this constituency yet (system admin imports the official list).</td></tr>';
    const act = (sel, dec, msg) => $$(sel).forEach((b) => (b.onclick = () => guard(async () => { const note = dec === "reconciled" ? null : prompt("Note for the record (optional):") || null; await API.reconcile(+b.dataset[sel.slice(6, 9)], dec, note); await load(); }, msg)));
    act("[data-rec]", "reconciled", "Marked reconciled. Recorded in the audit log.");
    act("[data-ask]", "correction_requested", "Correction requested from the representative.");
    act("[data-rej]", "rejected", "Report rejected. It no longer counts.");
    const code = (id) => (stRows.find((s) => s.station_id === id) || {}).official_code || "";
    $("#wInc").innerHTML = inc.map((i) => `<div class="it"><span class="sev ${i.severity}"></span><span class="t">${hhmm(i.created_at)}</span><div style="flex:1"><b>${esc(i.category)}</b> · <span class="muted">${esc(code(i.station_id))}</span><div>${esc(i.description || "")}</div>
      ${i.status === "open" ? `<button class="btn sm ghost" style="margin-top:4px" data-res="${i.id}">Mark resolved</button>` : `<div class="small" style="color:var(--green)">✓ ${esc(i.resolution_note || "Resolved")}</div>`}</div></div>`).join("") || '<p class="muted small">Nothing needs attention.</p>';
    $$("[data-res]").forEach((b) => (b.onclick = () => guard(async () => { await API.resolveIncident(+b.dataset.res, prompt("How was it resolved? (optional)") || null); await load(); }, "Incident resolved.")));
    $("#wLog").innerHTML = log.map((s) => `<div class="it"><span class="t">${hhmm(s.received_at)}</span><div style="flex:1"><b>${esc(code(s.station_id))}</b> · ${s.kind === "correction" ? `correction of ${s.corrects_id}` : "report"} · <b class="num">${fmt(s.attendance)}</b> ${statusPill(s.status)}<div class="small muted">ref ${s.id}${s.reason ? ` · “${esc(s.reason)}”` : ""}${s.superseded_by ? ` · replaced by ${s.superseded_by} (original kept)` : ""}</div></div></div>`).join("") || '<p class="muted small">No reports yet.</p>';
  }
  REFRESH = load; await guard(load);
}

// ------------------------------------------------------------------ PARTY HEAD OFFICE (party-private)
async function viewHQ() {
  const P = ME.party;
  $("#main").innerHTML = `<div class="partyhead"><b>${esc(P.name)} · Head office</b><span class="private" style="background:rgba(255,255,255,.2)">🔒 Private — other parties cannot see this page</span></div>
  <div class="grid kpis" style="margin-bottom:14px">
    <div class="card kpi y"><div class="l">Turnout reported by our reps</div><div class="v num" id="hObs">—</div><div class="s" id="hObsS"></div></div>
    <div class="card kpi g"><div class="l">Reconciled</div><div class="v num" id="hRec">—</div></div>
    <div class="card kpi p"><div class="l">🔒 Estimated ${esc(P.short_name)} supporters voted</div><div class="v num" id="hEst">—</div><div class="s">reps' estimates — not a vote count</div></div>
    <div class="card kpi p"><div class="l">🔒 Estimated share of turnout</div><div class="v num" id="hShare">—</div><div class="s">where both figures exist</div></div>
    <div class="card kpi r"><div class="l">Open alerts</div><div class="v num" id="hAl">—</div></div>
  </div>
  <div class="grid split">
    <div class="card"><h3>Our private map</h3>
      <div class="seg noprint" id="hMode" style="margin-bottom:10px"><button data-m="rating">Our strongholds</button><button data-m="share">Est. support %</button><button data-m="obs">Our turnout reports</button></div>
      <div class="map" id="hMap">${mapSVG("hMap")}</div><div class="legend" id="hLeg"></div>
      <div id="rateBox"></div></div>
    <div class="grid" style="align-content:start">
      <div class="card"><h3>By constituency <span class="sp noprint"><button class="btn sm ghost" id="hCsv">⬇ CSV (private)</button></span></h3>
        <div class="tw" style="max-height:470px"><table><thead><tr><th>Constituency</th><th>Our view</th><th class="r">Stations</th><th class="r">Turnout</th><th class="r">🔒 Est. supporters</th><th class="r">🔒 Est. %</th><th class="r">Alerts</th></tr></thead><tbody id="hRows"></tbody></table></div></div>
      <div class="card"><h3>Internal notes</h3><div class="row noprint"><input class="inp" id="noteIn" style="flex:1" maxlength="2000" placeholder="Add a note for your team"><button class="btn sm" id="noteBtn">Add</button></div><div class="feed" id="notes" style="margin-top:8px"></div></div>
    </div></div>`;
  let rows = [], ratings = {};
  $$("#hMode button").forEach((b) => { b.classList.toggle("on", b.dataset.m === SEL.hqMode); b.onclick = () => { SEL.hqMode = b.dataset.m; $$("#hMode button").forEach((x) => x.classList.toggle("on", x === b)); paint(); }; });
  const ratingFill = (r) => { const w = (RATINGS.find((x) => x[0] === r) || [])[2]; if (w === null || w === undefined) return "#E5E7E4"; return w > 0 ? hexMix(P.color, 0.35 + 0.65 * w) : w === 0 ? "#F3E7A6" : `rgb(${Math.round(200 + 35 * w)},${Math.round(200 + 35 * w)},${Math.round(200 + 35 * w)})`; };
  function paint() {
    const data = {};
    rows.forEach((r) => {
      const c = CONSTS.find((x) => x.id === r.constituency_id); if (!c) return;
      if (SEL.hqMode === "rating") { const rt = r.rating || "unrated", w = (RATINGS.find((x) => x[0] === rt) || [])[2]; data[c.code] = { fill: ratingFill(rt), dark: !(w > 0.5) && w !== -1, label: { stronghold: "★", leaning: "↗", competitive: "≈", opponent_leaning: "↘", opponent_stronghold: "✕" }[rt] || "", value: +r.observed }; }
      else if (SEL.hqMode === "share") { const f = r.observed ? r.est_supporters / r.observed : 0; data[c.code] = { fill: r.observed ? hexMix(P.color, 0.15 + 0.85 * Math.min(1, f / 0.7)) : "#E5E7E4", dark: f < 0.4, label: r.observed ? Math.round(f * 100) + "%" : "—", value: +r.observed }; }
      else { const max = Math.max(100, ...rows.map((x) => +x.observed)), f = r.observed / max; data[c.code] = { fill: ramp(f), dark: f < 0.45, label: fmt(r.observed), value: +r.observed }; }
    });
    paintMap("hMap", data, SEL.rateC ? CONSTS.find((c) => c.id === SEL.rateC)?.code : null);
    $("#hLeg").innerHTML = SEL.hqMode === "rating" ? RATINGS.map(([k, l]) => `<span class="lg"><i style="background:${ratingFill(k)}"></i>${l}</span>`).join("") + '<span class="small">· tap a constituency to change it</span>'
      : SEL.hqMode === "share" ? `<span>0%</span><span class="ramp" style="background:linear-gradient(90deg,${hexMix(P.color, 0.15)},${P.color})"></span><span>70%+ of turnout estimated as ours</span>` : `<span>0</span><span class="ramp"></span><span>most reported</span>`;
  }
  function rateBox() {
    const c = SEL.rateC, el = $("#rateBox"); if (!c) { el.innerHTML = ""; return; }
    const cur = ratings[c] || {};
    el.innerHTML = `<div class="receipt" style="margin-top:10px;border-left:4px solid var(--party)"><b>${esc(cName(c))}</b> — how does ${esc(P.short_name)} see this area?
      <div class="row" style="gap:6px;margin-top:8px">${RATINGS.filter((r) => r[0] !== "unrated").map(([k, l]) => `<button class="btn sm ${cur.rating === k ? "" : "ghost"}" data-rate="${k}" ${cur.rating === k ? 'style="background:var(--party)"' : ""}>${l}</button>`).join("")}</div>
      <input class="inp" id="rateNote" style="margin-top:8px" placeholder="Why? (optional, private)" value="${esc(cur.note || "")}"><div class="row" style="margin-top:8px"><button class="btn sm ghost" id="rateClose">Close</button><button class="btn sm ghost" id="openWatch">Open watch room →</button></div></div>`;
    $$("[data-rate]", el).forEach((b) => (b.onclick = () => guard(async () => { await API.setRating(c, b.dataset.rate, $("#rateNote").value.trim()); await load(); rateBox(); }, "Saved privately.")));
    $("#rateClose").onclick = () => { SEL.rateC = null; rateBox(); paint(); };
    $("#openWatch").onclick = () => { SEL.c = c; go("watch"); };
  }
  bindMap("hMap", (code) => { const c = cByCode(code), r = rows.find((x) => x.constituency_id === c.id) || {}; return `<b>${esc(c.name)}</b>Our view: ${(RATINGS.find((x) => x[0] === (r.rating || "unrated")) || [])[1]}<br>Turnout reported: ${fmt(r.observed)}<br>🔒 Est. supporters: ${fmt(r.est_supporters)} (${pct(r.est_supporters, r.observed)})`; },
    (code) => { const c = cByCode(code); if (SEL.hqMode === "rating") { SEL.rateC = c.id; rateBox(); paint(); } else { SEL.c = c.id; go("watch"); } });
  $("#noteBtn").onclick = () => guard(async () => { const v = $("#noteIn").value.trim(); if (!v) return; await API.addNote(v); $("#noteIn").value = ""; loadNotes(); }, "Note saved privately.");
  $("#hCsv").onclick = () => csv(`PRIVATE-${P.short_name}-head-office.csv`, [["PRIVATE — " + P.name + " internal estimates, not official results"], ["constituency", "our_view", "stations_reporting", "stations_total", "turnout_reported", "reconciled", "est_supporters", "est_share", "open_alerts"],
    ...rows.map((r) => [cName(r.constituency_id), r.rating || "", r.stations_reporting, r.stations_total, r.observed, r.reconciled, r.est_supporters, r.observed ? (r.est_supporters / r.observed).toFixed(3) : "", r.open_alerts])]);
  async function loadNotes() { const n = await API.notes(); $("#notes").innerHTML = n.map((x) => `<div class="it"><span class="t">${hhmm(x.created_at)}</span><div>${esc(x.body)}<div class="small muted">${esc(x.profiles?.full_name || "")}</div></div></div>`).join("") || '<p class="muted small">No notes yet.</p>'; }
  async function load() {
    const [s, rt] = await Promise.all([API.partySummary(), API.ratings()]); rows = s; ratings = Object.fromEntries(rt.map((r) => [r.constituency_id, r]));
    const T = (k) => rows.reduce((a, r) => a + +r[k], 0), both = rows.filter((r) => +r.observed && +r.est_supporters);
    $("#hObs").textContent = fmt(T("observed")); $("#hObsS").textContent = `${T("stations_reporting")} of ${T("stations_total")} stations`;
    $("#hRec").textContent = fmt(T("reconciled")); $("#hEst").textContent = fmt(T("est_supporters"));
    $("#hShare").textContent = pct(both.reduce((a, r) => a + +r.est_supporters, 0), both.reduce((a, r) => a + +r.observed, 0)); $("#hAl").textContent = T("open_alerts");
    $("#hRows").innerHTML = rows.slice().sort((a, b) => cName(a.constituency_id).localeCompare(cName(b.constituency_id))).map((r) => `<tr class="click" data-id="${r.constituency_id}"><td><b>${esc(cName(r.constituency_id))}</b></td>
      <td><span class="lg"><i style="background:${ratingFill(r.rating || "unrated")}"></i>${(RATINGS.find((x) => x[0] === (r.rating || "unrated")) || [])[1]}</span></td><td class="r num">${r.stations_reporting}/${r.stations_total}</td>
      <td class="r num">${fmt(r.observed)}</td><td class="r num">${fmt(r.est_supporters)}</td><td class="r num">${pct(r.est_supporters, r.observed)}</td><td class="r">${r.open_alerts ? `<span class="pill p-flag">${r.open_alerts}</span>` : "—"}</td></tr>`).join("");
    $$("#hRows tr").forEach((tr) => (tr.onclick = () => { SEL.c = +tr.dataset.id; go("watch"); }));
    paint();
  }
  REFRESH = load; await guard(async () => { await load(); await loadNotes(); });
}

// ------------------------------------------------------------------ TEAM & SHARING (party admin)
async function viewTeam() {
  const P = ME.party;
  $("#main").innerHTML = `<div class="partyhead"><b>${esc(P.name)} · Team &amp; sharing</b><span class="private" style="background:rgba(255,255,255,.2)">Party administrator</span></div>
  <div class="grid two">
    <div class="grid" style="align-content:start">
      <div class="card"><h3>Invite someone</h3>
        <p class="small muted" style="margin-top:0">Create one invite per person. They open the link, make a password, and are linked to ${esc(P.short_name)} with exactly this role.</p>
        <label class="f">Role</label><select class="inp" id="iRole"><option value="rep">Station representative (one polling station)</option><option value="watch">Watch room (one constituency)</option><option value="hq">Head office (sees everything for ${esc(P.short_name)})</option><option value="party_admin">Party administrator</option></select>
        <div id="iWhere"><label class="f">Constituency</label><select class="inp" id="iC">${CONSTS.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
          <div id="iStWrap"><label class="f">Polling station</label><select class="inp" id="iS"></select></div></div>
        <label class="f">Person's name (for your records)</label><input class="inp" id="iLabel" maxlength="80">
        <button class="btn" style="margin-top:12px" id="iGo">Create invite</button><div id="iOut" style="margin-top:12px"></div></div>
      <div class="card"><h3>Sharing with the National Watch</h3>
        <label class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)"><span>Our reps' <b>turnout totals</b> → National Watch</span><input type="checkbox" id="shC" ${P.share_counts ? "checked" : ""}></label>
        <label class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)"><span>Count of our <b>open incidents</b> → National Watch</span><input type="checkbox" id="shI" ${P.share_incidents ? "checked" : ""}></label>
        ${["Supporter estimates", "Stronghold map", "Internal notes", "Team list"].map((x) => `<div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)"><span>${x}</span><span class="pill p-none">NEVER SHARED</span></div>`).join("")}
        <p class="small muted" style="margin-bottom:0">Changes take effect immediately and are recorded in the audit log.</p></div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="card"><h3>Invites</h3><div class="tw" style="max-height:300px"><table><thead><tr><th>Code</th><th>For</th><th>Role · where</th><th>Status</th><th></th></tr></thead><tbody id="invRows"></tbody></table></div></div>
      <div class="card"><h3>Team members</h3><div class="tw" style="max-height:340px"><table><thead><tr><th>Name</th><th>Role</th><th>Assigned to</th><th>Access</th></tr></thead><tbody id="memRows"></tbody></table></div></div>
      <div class="card"><h3>Audit log (${esc(P.short_name)})</h3><div class="feed" id="audit"></div></div>
    </div></div>`;
  let stations = [];
  const fillSt = async () => { stations = await API.stations(+$("#iC").value); $("#iS").innerHTML = stations.map((s) => `<option value="${s.id}">${esc(s.official_code)} — ${esc(s.name)}</option>`).join("") || "<option value=''>No stations loaded yet</option>"; };
  const where = () => { const r = $("#iRole").value; $("#iWhere").classList.toggle("hide", !["rep", "watch"].includes(r)); $("#iStWrap").classList.toggle("hide", r !== "rep"); };
  $("#iRole").onchange = where; $("#iC").onchange = fillSt; where(); fillSt();
  $("#iGo").onclick = () => guard(async () => {
    const role = $("#iRole").value, label = $("#iLabel").value.trim();
    const code = await API.createInvite({ role, station: role === "rep" ? $("#iS").value || null : null, constituency: role === "watch" ? +$("#iC").value : null, label });
    const link = `${location.origin}${location.pathname}#invite=${code}`;
    const msg = `${label ? label + ", y" : "Y"}ou are invited to Vote Watch Dominica for ${P.name} as ${ROLE[role]}.\nOpen: ${link}\nInvite code: ${code}\nThis code is for you only. Do not share it.`;
    $("#iOut").innerHTML = `<div class="codebox">${esc(code)}</div><textarea class="inp" rows="5" style="margin-top:8px" readonly>${esc(msg)}</textarea><button class="btn sm ghost" id="copy" style="margin-top:6px">Copy message to send by WhatsApp/SMS</button>`;
    $("#copy").onclick = () => navigator.clipboard.writeText(msg).then(() => toast("Copied."));
    $("#iLabel").value = ""; loadLists();
  });
  const saveShare = () => guard(async () => { await API.setSharing($("#shC").checked, $("#shI").checked); ME.party.share_counts = $("#shC").checked; ME.party.share_incidents = $("#shI").checked; }, "Sharing updated.");
  $("#shC").onchange = saveShare; $("#shI").onchange = saveShare;
  const allSt = await API.stations(); const stName = (id) => (allSt.find((s) => s.id === id) || {}).official_code || "";
  const asg = (a) => a.map((x) => (x.station_id ? stName(x.station_id) : cName(x.constituency_id))).join(", ") || "—";
  async function loadLists() {
    const [inv, mem, aud] = await Promise.all([API.invites(), API.members(), API.audit()]);
    $("#invRows").innerHTML = inv.map((i) => { const st = i.used_by ? '<span class="pill p-ok">USED</span>' : i.revoked ? '<span class="pill p-none">REVOKED</span>' : new Date(i.expires_at) < new Date() ? '<span class="pill p-none">EXPIRED</span>' : '<span class="pill p-unv">OPEN</span>';
      return `<tr><td class="num"><code>${esc(i.code)}</code></td><td>${esc(i.label || "")}</td><td class="small">${ROLE[i.role]}${i.station_id ? " · " + esc(stName(i.station_id)) : i.constituency_id ? " · " + esc(cName(i.constituency_id)) : ""}</td><td>${st}</td><td>${!i.used_by && !i.revoked ? `<button class="btn sm warn" data-rev="${esc(i.code)}">Revoke</button>` : ""}</td></tr>`; }).join("") || '<tr><td colspan="5" class="muted">No invites yet.</td></tr>';
    $$("[data-rev]").forEach((b) => (b.onclick = () => guard(async () => { await API.revokeInvite(b.dataset.rev); loadLists(); }, "Invite revoked.")));
    $("#memRows").innerHTML = mem.map((m) => `<tr><td><b>${esc(m.full_name)}</b>${m.id === ME.id ? ' <span class="pill p-q">YOU</span>' : ""}</td><td class="small">${ROLE[m.role]}</td><td class="small">${esc(asg(m.assignments || []))}</td>
      <td>${m.id === ME.id ? "" : `<button class="btn sm ${m.active ? "warn" : ""}" data-act="${m.id}" data-on="${m.active ? 0 : 1}">${m.active ? "Remove access" : "Restore"}</button>`}</td></tr>`).join("");
    $$("[data-act]").forEach((b) => (b.onclick = () => { if (b.dataset.on === "0" && !confirm("Remove this person's access now?")) return; guard(async () => { await API.setMemberActive(b.dataset.act, b.dataset.on === "1"); loadLists(); }, "Access updated."); }));
    $("#audit").innerHTML = aud.map((a) => `<div class="it"><span class="t">${hhmm(a.at)}</span><div><b>${esc(a.action.replace(/_/g, " "))}</b> <span class="muted small">${esc(a.entity || "")} ${esc(a.entity_id || "")}</span></div></div>`).join("") || '<p class="muted small">Nothing yet.</p>';
  }
  REFRESH = loadLists; await guard(loadLists);
}

// ------------------------------------------------------------------ SYSTEM ADMIN
async function viewAdmin() {
  $("#main").innerHTML = `<div class="row" style="margin-bottom:12px"><b style="font-size:16px">System administration</b><span class="muted small">You manage parties and the official station list. You cannot see any party's private data.</span></div>
  <div class="grid two">
    <div class="grid" style="align-content:start">
      <div class="card"><h3>Parties &amp; organisations</h3><div id="parties"></div>
        <label class="f">Quick fill (colours researched Nov 2026 — confirm with each party)</label>
        <select class="inp" id="pPreset"><option value="">Choose a party, or type your own below…</option>${PARTY_PRESETS.map((p, i) => `<option value="${i}">${esc(p[0])} (${esc(p[1])}) — ${esc(p[3])}</option>`).join("")}</select>
        <div class="grid" style="grid-template-columns:2fr 1fr auto auto;gap:6px;margin-top:10px;align-items:end"><div><label class="f">Full name</label><input class="inp" id="pName"></div><div><label class="f">Short name</label><input class="inp" id="pShort" maxlength="10"></div><div><label class="f">Colour</label><input type="color" id="pColor" value="#1565C0" style="height:38px;width:50px;border:0"></div><button class="btn" id="pGo">Add</button></div></div>
      <div class="card"><h3>Invite a party administrator</h3><div class="row"><select class="inp" id="aParty" style="flex:1"></select><input class="inp" id="aLabel" placeholder="Person's name" style="flex:1"><button class="btn" id="aGo">Create invite</button></div>
        <p class="small muted">Each party's administrator then invites their own head office, watch rooms and representatives.</p>
        <button class="btn sm ghost" id="sysInv">Invite a second system administrator (needed to approve station imports)</button><div id="aOut" style="margin-top:10px"></div></div>
      <div class="card"><h3>Invites &amp; administrators</h3><div class="tw" style="max-height:260px"><table><tbody id="admInv"></tbody></table></div></div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="card"><h3>Official polling station list</h3>
        <p class="small" style="margin-top:0">Upload the Electoral Office's list as a CSV with columns <code>constituency, polling_district, station_code, station_name, electors_listed</code> (optional: <code>district_code</code>). A <b>different</b> system administrator must approve it before it goes live.</p>
        <div class="row"><input type="file" id="csvFile" accept=".csv,text/csv"><button class="btn sm ghost" id="tmpl">Download template</button></div><div id="csvOut" class="small" style="margin-top:8px"></div>
        <h3 style="margin-top:14px">Uploads</h3><div class="tw" style="max-height:220px"><table><thead><tr><th>When</th><th class="r">Rows</th><th>Checks</th><th>Status</th><th></th></tr></thead><tbody id="batches"></tbody></table></div></div>
      <div class="card"><h3>Stations loaded per constituency</h3><div class="tw" style="max-height:330px"><table><thead><tr><th>Constituency</th><th class="r">Stations</th><th class="r">Electors listed</th></tr></thead><tbody id="stCounts"></tbody></table></div></div>
      <div class="card"><h3>System audit log</h3><div class="feed" id="sAudit"></div></div>
    </div></div>`;
  const invOut = (code, who) => { const link = `${location.origin}${location.pathname}#invite=${code}`; $("#aOut").innerHTML = `<div class="codebox">${esc(code)}</div><p class="small">Send to ${esc(who)}: <code>${esc(link)}</code></p>`; };
  $("#pPreset").onchange = (e) => { const p = PARTY_PRESETS[e.target.value]; if (!p) return; $("#pName").value = p[0]; $("#pShort").value = p[1]; $("#pColor").value = p[2]; };
  $("#pGo").onclick = () => guard(async () => { const n = $("#pName").value.trim(), s = $("#pShort").value.trim(); if (!n || !s) throw new Error("Name and short name are required."); await API.createParty(n, s, $("#pColor").value); $("#pName").value = $("#pShort").value = ""; load(); }, "Party added.");
  $("#aGo").onclick = () => guard(async () => { const code = await API.createInvite({ role: "party_admin", party: $("#aParty").value, label: $("#aLabel").value.trim() }); invOut(code, $("#aLabel").value || "the party administrator"); load(); });
  $("#sysInv").onclick = () => guard(async () => { const code = await API.createInvite({ role: "sys_admin", label: "System administrator" }); invOut(code, "the second system administrator"); load(); });
  $("#tmpl").onclick = () => csv("polling-stations-template.csv", [["constituency", "polling_district", "district_code", "station_code", "station_name", "electors_listed"], ["Roseau North", "Example district", "", "EXAMPLE-01", "Example station name", "500"]]);
  $("#csvFile").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return; const rows = parseCSV(await f.text());
    if (!rows.length) return ($("#csvOut").textContent = "No rows found.");
    const need = ["constituency", "polling_district", "station_code", "station_name"], miss = need.filter((n) => !(n in rows[0]));
    if (miss.length) return ($("#csvOut").innerHTML = `<span class="pill p-flag">REJECTED</span> Missing column(s): ${miss.join(", ")}`);
    guard(async () => { const r = await API.uploadImport(rows); $("#csvOut").innerHTML = `<span class="pill ${r.errors.length ? "p-flag" : "p-ok"}">${r.errors.length ? r.errors.length + " PROBLEM(S)" : "CHECKS PASSED"}</span> ${rows.length} rows uploaded. ${r.errors.length ? "Fix and upload again:" : "Ask the second administrator to approve."}<ul>${r.errors.slice(0, 15).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`; load(); });
  };
  async function load() {
    const [ps, inv, bs, st, mem, aud] = await Promise.all([API.parties(), API.invites(), API.imports(), API.stations(), API.members(), API.audit()]);
    $("#parties").innerHTML = ps.map((p) => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><span style="width:14px;height:14px;border-radius:50%;background:${esc(p.color)}"></span><b>${esc(p.name)}</b><span class="muted">${esc(p.short_name)}</span><span class="small muted" style="margin-left:auto">${p.share_counts ? "shares turnout" : "turnout private"}</span></div>`).join("") || '<p class="muted small">No parties yet.</p>';
    $("#aParty").innerHTML = ps.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
    $("#admInv").innerHTML = mem.map((m) => `<tr><td><b>${esc(m.full_name)}</b></td><td class="small">${ROLE[m.role]} ${m.party_id ? "· " + esc((ps.find((p) => p.id === m.party_id) || {}).short_name || "") : ""}</td><td>${m.active ? '<span class="pill p-ok">ACTIVE</span>' : '<span class="pill p-none">REMOVED</span>'}</td></tr>`).join("") +
      inv.filter((i) => !i.used_by && !i.revoked).map((i) => `<tr><td><code>${esc(i.code)}</code> ${esc(i.label || "")}</td><td class="small">${ROLE[i.role]} invite</td><td><span class="pill p-unv">OPEN</span></td></tr>`).join("");
    $("#batches").innerHTML = bs.map((b) => `<tr><td class="small">${new Date(b.uploaded_at).toLocaleString()}</td><td class="r">${b.row_count}</td><td>${b.errors.length ? `<span class="pill p-flag">${b.errors.length} problems</span>` : '<span class="pill p-ok">OK</span>'}</td><td>${b.status.toUpperCase()}</td>
      <td>${b.status === "pending" ? `${!b.errors.length && b.uploaded_by !== ME.id ? `<button class="btn sm" data-ap="${b.id}">Approve</button>` : b.uploaded_by === ME.id ? '<span class="small muted">needs 2nd admin</span>' : ""} <button class="btn sm ghost" data-rj="${b.id}">Reject</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">No uploads yet.</td></tr>';
    $$("[data-ap]").forEach((b) => (b.onclick = () => confirm("Load these stations into the live system?") && guard(async () => { await API.decideImport(b.dataset.ap, true); load(); }, "Stations loaded.")));
    $$("[data-rj]").forEach((b) => (b.onclick = () => guard(async () => { await API.decideImport(b.dataset.rj, false); load(); }, "Upload rejected.")));
    $("#stCounts").innerHTML = CONSTS.map((c) => { const xs = st.filter((s) => s.constituency_id === c.id); return `<tr><td>${esc(c.name)}</td><td class="r">${xs.length || '<span class="pill p-flag">0</span>'}</td><td class="r num">${fmt(xs.reduce((a, s) => a + (s.electors_listed || 0), 0))}</td></tr>`; }).join("");
    $("#sAudit").innerHTML = aud.map((a) => `<div class="it"><span class="t">${hhmm(a.at)}</span><div><b>${esc(a.action.replace(/_/g, " "))}</b> <span class="muted small">${esc(a.entity || "")} ${esc(a.entity_id || "")}</span></div></div>`).join("") || '<p class="muted small">Nothing yet.</p>';
  }
  REFRESH = null; await guard(load);
}
function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.filter((r) => r.some((c) => c.trim())); if (!clean.length) return [];
  const head = clean.shift().map((h) => h.trim().toLowerCase().replace(/^﻿/, "").replace(/\s+/g, "_"));
  return clean.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
}

// ------------------------------------------------------------------ boot
const VIEWS = { national: viewNational, station: viewStation, watch: viewWatch, hq: viewHQ, team: viewTeam, admin: viewAdmin };
let booted = false, bootSeq = 0;
async function boot() {
  const my = ++bootSeq, stale = () => my !== bootSeq; // only the most recent start-up may draw the screen
  try {
    if (!booted) { booted = true; await API.init();
      API.onChange((k, uid) => { if (k !== "auth") return scheduleRefresh();
        if (window.VW_RECOVERY || uid === undefined || (uid || null) !== (ME?.id || null)) boot(); }); }
    if (stale()) return;
    if (API.mode === "live" && window.VW_RECOVERY) { ME = null; paintShell(); return authScreen("reset"); }
    const has = await API.session(); if (stale()) return;
    if (!has) { ME = null; paintShell(); return authScreen(); }
    const me = await API.me(); if (stale()) return; ME = me;
    if (!ME) { paintShell(); return authScreen(); }
    if (!ME.role) { paintShell(); return redeemScreen(); }
    if (ME.active === false) { paintShell(); $("#main").innerHTML = '<div class="card">Your access has been removed. Contact your party administrator.</div>'; return; }
    const cs = await API.constituencies(); if (stale()) return; CONSTS = cs;
    const tabs = tabsFor(ME.role).map((t) => t[0]);
    if (!tabs.includes(VIEW)) VIEW = tabs[0];
    paintShell(); go(VIEW);
    flushOutbox();
  } catch (e) { $("#main").innerHTML = `<div class="card"><b>Could not load.</b><p class="small">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`; }
}
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
