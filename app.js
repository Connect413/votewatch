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
// this phone/computer's own id (kept in the browser), used for the one-device-per-person rule
const DEVICE = (() => { try { let d = localStorage.getItem("vw_device_id"); if (!d) { d = "dev-" + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(16) + Math.random().toString(16).slice(2)); localStorage.setItem("vw_device_id", d); } return d; } catch { return "dev-nostore-" + Date.now().toString(16); } })();
const deviceLabel = () => { const u = navigator.userAgent;
  const os = /iPhone/.test(u) ? "iPhone" : /iPad/.test(u) ? "iPad" : /Android/.test(u) ? (/Mobile/.test(u) ? "Android phone" : "Android tablet") : /Windows/.test(u) ? "Windows computer" : /Mac OS X/.test(u) ? "Mac" : /CrOS/.test(u) ? "Chromebook" : /Linux/.test(u) ? "Linux computer" : "Device";
  const br = /Edg\//.test(u) ? "Edge" : /SamsungBrowser/.test(u) ? "Samsung Internet" : /CriOS|Chrome\//.test(u) ? "Chrome" : /FxiOS|Firefox\//.test(u) ? "Firefox" : /Safari\//.test(u) ? "Safari" : "browser";
  return os + " · " + br; };
// faint name watermark on the national and broadcast screens, so a photo or recording can be traced back
function addWatermark(el) {
  if (!el || !ME || ME.role === "sys_admin") return;
  const t = `${ME.full_name || ""} · ${ME.email || ""} · ${new Date().toLocaleDateString()}`.replace(/[<&>"]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="260"><text x="20" y="150" transform="rotate(-18 280 130)" font-family="Arial,sans-serif" font-size="20" fill="#000" fill-opacity="0.075">${t}</text></svg>`;
  const w = document.createElement("div"); w.className = "wm"; w.setAttribute("aria-hidden", "true");
  w.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`; el.style.position = el.style.position || "relative"; el.appendChild(w);
}
// device and sign-in log cells for administrators' people lists
function devCell(id, D) { const d = D && D[id]; if (!d) return '<span class="small muted">—</span>';
  return `<span class="small">${d.devices ? d.devices + (d.devices > 1 ? " devices" : " device") : "not signed in yet"}${d.last_ip ? " · " + esc(d.last_ip) : ""}${d.last_seen ? " · " + hhmm(d.last_seen) : ""}</span>${d.refused ? ` <span class="pill p-flag" title="Someone tried to use this account on another device">${d.refused} REFUSED</span>` : ""}`; }
const devBtns = (id) => (id === ME.id ? "" : `<button class="btn sm ghost" data-dlog="${id}">Sign-in log</button> <button class="btn sm ghost" data-dreset="${id}">Reset device</button>`);
const ACT = { opened_app: "Opened the app", new_device: "New device registered", device_refused: "⚠ REFUSED: another device", devices_reset: "Devices reset by administrator",
  sent_submissions: "Sent a turnout count", sent_support_estimates: "Sent supporters figure", sent_incidents: "Reported an incident", sent_station_counts: "Sent a neutral count",
  sent_station_results: "Sent the count after close", sent_station_events: "Sent opening/closing time" };
function wireDev(root, reload) {
  $$("[data-dreset]", root).forEach((b) => (b.onclick = () => { if (!confirm("Reset this person's device?\n\nUse this when they changed or lost their phone. The next phone or computer they open the app on becomes their device, and the old one stops working.")) return;
    guard(async () => { await API.resetDevices(b.dataset.dreset); reload && reload(); }, "Device reset. They can now sign in on their new phone."); }));
  $$("[data-dlog]", root).forEach((b) => (b.onclick = () => guard(async () => {
    const rows = await API.accessLog(b.dataset.dlog, 150), name = b.closest("tr")?.querySelector("b")?.textContent || "";
    const ov = document.createElement("div"); ov.className = "ovl"; ov.innerHTML = `<div class="card ovc"><div class="row"><h3 style="margin:0">Sign-in log · ${esc(name)}</h3><button class="btn sm ghost" style="margin-left:auto" data-x>Close</button></div>
      <p class="small muted">Every time this account opens the app or sends something, the time, device and internet (IP) address are recorded. Phones change IP addresses during the day; that is normal. Look for <b>REFUSED</b> lines: someone tried to use the account on another device.</p>
      <div class="tw" style="max-height:60vh"><table><thead><tr><th>Time</th><th>What</th><th>Device</th><th>IP address</th></tr></thead><tbody>${rows.map((r) => `<tr class="${r.action === "device_refused" ? "flagrow" : ""}"><td class="small">${new Date(r.at).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</td><td class="small">${esc(ACT[r.action] || r.action.replace(/_/g, " "))}</td><td class="small">${esc(r.device || "")}</td><td class="small num">${esc(r.ip || "—")}</td></tr>`).join("") || '<tr><td colspan="4" class="muted">Nothing recorded yet.</td></tr>'}</tbody></table></div></div>`;
    document.body.appendChild(ov); ov.onclick = (e) => { if (e.target === ov || e.target.hasAttribute("data-x")) ov.remove(); };
  })));
}
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : "k" + Date.now() + Math.random().toString(16).slice(2));
// tap counters are kept on the phone so a tap is never lost; the running total is what gets sent
const tallyKey = (kind, sid) => `vw_tally_${kind}_${ME?.id}_${sid}`;
const tallyGet = (kind, sid) => { try { return JSON.parse(localStorage.getItem(tallyKey(kind, sid))) || { n: 0 }; } catch { return { n: 0 }; } };
const tallySet = (kind, sid, v) => localStorage.setItem(tallyKey(kind, sid), JSON.stringify(v));
// the same total always goes with the same key, so sending it twice is recognised as a duplicate and never counted twice
const tallySendKey = (kind, sid, T) => { if (T.keyFor !== T.n || !T.key) { T.key = newKey(); T.keyFor = T.n; tallySet(kind, sid, T); } return T.key; };
function toast(msg, err) { const t = $("#toast"); t.textContent = msg; t.classList.toggle("err", !!err); t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), err ? 5000 : 3000); }
async function guard(fn, okMsg) { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message || String(e), true); return undefined; } }

const ROLE = { rep: "Station representative", watch: "Watch room", hq: "Party leader", party_admin: "Party administrator", sys_admin: "System administrator", counter: "Neutral station counter", media: "News media" };
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
  ["Independent – (type the candidate's name)", "IND", "#8C8C8C", "independent candidate: their own private workspace"],
];
const JOBS = { inside: { short: "inside: live count", long: "INSIDE the station: tap +1 for every person who votes" },
  outside: { short: "outside: our supporters", long: "OUTSIDE the station: tap +1 for every supporter of ours you recognise going in" },
  both: { short: "inside + outside", long: "live count of all voters AND our supporters" } };
// One clear "send it" panel for every invite: WhatsApp, email, text message or copy, and what happens next
function inviteSent(el, { code, msg, who }) {
  const enc = encodeURIComponent(msg);
  el.innerHTML = `<div class="sendbox" data-code="${esc(code)}"><div><b>✅ Invite ready for ${esc(who)}.</b> Now send it to them:</div>
    <div class="sendrow"><a class="btn wa" href="https://wa.me/?text=${enc}" target="_blank" rel="noopener">📲 Send by WhatsApp</a>
      <button class="btn ghost" type="button" data-mail>✉️ Send by email</button>
      <a class="btn ghost" href="sms:?&body=${enc}">💬 Send by text</a><button class="btn ghost" type="button" data-copy>📋 Copy</button></div>
    <div class="mailrow hide"><label class="f">Their email address</label><div class="row"><input class="inp" type="email" data-to placeholder="name@example.com" autocomplete="off"><button class="btn" type="button" data-mailgo>Open email</button></div>
      <p class="small muted" style="margin:4px 0 0">This opens your email with the invite already written. Check it, then press Send. Ask them to look in their spam folder if it doesn't arrive.</p></div>
    <ol class="small steps"><li>They tap the link on their phone.</li><li>They type their name, email and a password.</li><li>That's it: they're in, already set to the right place.</li></ol>
    <p class="small muted" style="margin:0">The invite works once, for 14 days (code ${esc(code)}). Sent it to the wrong person, or made a mistake? Press <b>Cancel invite</b> in the list and make a new one.</p></div>`;
  el.querySelector("[data-copy]").onclick = () => (navigator.clipboard ? navigator.clipboard.writeText(msg) : Promise.reject()).then(() => toast("Copied. Paste it into WhatsApp or a text message."), () => toast("Could not copy here. Use the WhatsApp button instead.", true));
  const mr = el.querySelector(".mailrow"), to = el.querySelector("[data-to]");
  el.querySelector("[data-mail]").onclick = () => { mr.classList.remove("hide"); to.focus(); };
  el.querySelector("[data-mailgo]").onclick = () => {
    const addr = to.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return toast("Type their email address first, like name@gmail.com.", true);
    const subj = "Your invitation to Vote Watch Dominica", mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (mobile) location.href = `mailto:${encodeURIComponent(addr)}?subject=${encodeURIComponent(subj)}&body=${enc}`;
    else window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(addr)}&su=${encodeURIComponent(subj)}&body=${enc}`, "_blank", "noopener");
    toast("Your email is open with the invite written. Press Send there.");
  };
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
const inviteMsg = (name, what, link) => `${name ? "Hello " + name + ", y" : "Y"}ou are invited to Vote Watch Dominica as ${what}.\n\nTap this link to join:\n${link}\n\nThis link is for you only. Please don't forward it.`;
const noStations = (sys) => `<option value="">No polling stations yet${sys ? " (load practice stations on the System admin tab)" : " (the system administrator loads them)"}</option>`;
// the job travels in the invite link and is remembered on the rep's phone; it only decides which screen opens first
(() => { const j = (location.hash.match(/job=(inside|outside|both)/) || [])[1]; if (j) localStorage.setItem("vw_job", j); })();
const INCIDENT_CATS = ["Station opened late", "Long queue / delays", "Representative refused entry", "Power or lighting problem", "Access problem for elderly or disabled voters", "Crowd or security concern", "Count does not match station records", "Other"];
let SETTINGS = null, ME = null, CONSTS = [], VIEW = null, REFRESH = null, SEL = { c: null, natC: null, hqMode: "rating", natMode: "obs", repTab: "turnout", repStation: null };
const cName = (id) => (CONSTS.find((c) => c.id === id) || {}).name || "—";
const cByCode = (code) => CONSTS.find((c) => c.code === code);

// ------------------------------------------------------------------ network & outbox (offline-safe)
const online = () => navigator.onLine && !window.VW_FORCE_OFFLINE;
const OB_KEY = () => "vw_outbox_" + (ME?.id || "x");
const outbox = { get: () => { try { return JSON.parse(localStorage.getItem(OB_KEY()) || "[]"); } catch { return []; } }, set: (v) => localStorage.setItem(OB_KEY(), JSON.stringify(v)) };
const isNetErr = (e) => !online() || /failed to fetch|networkerror|load failed|network request failed|fetch/i.test(e?.message || "");
const SENDERS = { attendance: (x) => API.submitAttendance(x), correction: (x) => API.submitCorrection(x), estimate: (x) => API.submitEstimate(x), incident: (x) => API.reportIncident(x),
  count: (x) => API.submitCount(x), countCorrection: (x) => API.correctCount(x), results: (x) => API.submitResults(x), event: (x) => API.reportStationEvent(x) };
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
const SMALL = new Set(["RCE"]); // Roseau Central is the only constituency too small for a name on the map
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
  s += `<text x="${x + 12}" y="${y + 18}" font-size="10.5" fill="#5E6762">Roseau Central: hover or tap the small area by Roseau</text></svg>`;
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
  const maxY = Math.max(100, ...rows.map((r) => +r.voted)) * 1.1;
  const X = (t) => P.l + ((new Date(t).getTime() - t0) / (t1 - t0)) * (W - P.l - P.r), Y = (v) => H - P.b - (v / maxY) * (H - P.t - P.b);
  let g = `<svg viewBox="0 0 ${W} ${H}" width="100%">`;
  for (let i = 0; i <= 4; i++) { const v = (maxY * i) / 4; g += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#ECEFEA"/><text x="${P.l - 6}" y="${Y(v) + 4}" font-size="10" fill="#5E6762" text-anchor="end">${v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k" : Math.round(v)}</text>`; }
  const step = Math.max(1, Math.ceil(rows.length / 6));
  rows.forEach((r, i) => { if (i % step === 0) g += `<text x="${X(r.t)}" y="${H - 5}" font-size="10" fill="#5E6762" text-anchor="middle">${hhmm(r.t)}</text>`; });
  const line = (k) => rows.map((r, i) => (i ? "L" : "M") + X(r.t).toFixed(1) + "," + Y(+r[k]).toFixed(1)).join("");
  g += `<path d="${line("voted")}" fill="none" stroke="#5B2A86" stroke-width="2.6"/></svg>`;
  el.innerHTML = g + `<div class="legend"><span class="lg"><i style="background:#5B2A86"></i>People voted (one figure per station)</span></div>`;
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
  // The National Watch (all of Dominica) is only for party leaders, system administrators and media outlets that are switched on.
  const nat = ["national", "ALL", "National Watch"], bc = ["broadcast", "LIVE", "Broadcast screen"];
  return { rep: [["station", "L1", "My station"]], watch: [["watch", "L2", "My constituency"]],
    hq: [["hq", "L3", "Our party"], ["watch", "L2", "Constituencies"], nat, bc],
    party_admin: [["hq", "L3", "Our party"], ["watch", "L2", "Constituencies"], ["team", "ADM", "Team & sharing"]],
    counter: [["counter", "L1", "My station count"]],
    media: [bc, nat],
    sys_admin: [["admin", "SYS", "System admin"], ["count", "CNT", "Counters & results"], ["media", "TV", "Media & poll times"], nat, bc] }[role] || [];
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
  const disclaimer = "Independent monitoring platform, not the Electoral Office. Counts only: no names and no individual ballots are collected. Results shown are unofficial.";
  if (API.mode === "demo") {
    const d = API.demo;
    $("#banner").innerHTML = `<b>DEMO MODE · SYNTHETIC DATA</b><span>View as:</span><select id="persona">${d.people.filter((p) => !["sys_admin", "media"].includes(p.role)).map((p) => `<option value="${p.id}" ${p.id === d.persona ? "selected" : ""}>${esc(p.full_name)}</option>`).join("")}</select>
      <button id="play">${d.playing ? "❚❚ Pause" : "▶ Play"}</button><select id="speed">${[1, 2, 5, 15].map((s) => `<option value="${s}" ${s === d.speed ? "selected" : ""}>${s} min/sec</option>`).join("")}</select>
      <button id="jump">Jump to 12:00</button><button id="jump2">Jump to 17:00 close</button><button id="jump3">Jump to 19:30 count</button><label class="row" style="gap:4px"><input type="checkbox" id="noSignal" ${window.VW_FORCE_OFFLINE ? "checked" : ""}> Simulate no signal</label><span class="small">${disclaimer}</span>`;
    $("#persona").onchange = (e) => d.setPersona(e.target.value);
    $("#play").onclick = (e) => (e.target.textContent = d.toggle() ? "❚❚ Pause" : "▶ Play");
    $("#speed").onchange = (e) => d.setSpeed(+e.target.value);
    $("#jump").onclick = () => d.jump(12 * 60); $("#jump2").onclick = () => d.jump(17 * 60); $("#jump3").onclick = () => { d.jump(19.5 * 60); SEL.natView = "results"; if (VIEW === "national") viewNational(); };
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
    M.innerHTML = `<div class="auth"><div class="card">${inviteFromLink ? `<h2>Welcome! You've been invited</h2><p class="small">Just fill in these three boxes and you're in. Your invite <b>${esc(inviteFromLink)}</b> is already filled in.</p>` : `<h2>Create your account</h2><p class="muted small">You need an invite link or code from your party administrator.</p>`}
      <div class="${inviteFromLink ? "hide" : ""}"><label class="f">Invite code</label><input class="inp" id="code" value="${esc(inviteFromLink)}" placeholder="XXXX-XXXX-XXXX" autocapitalize="characters"></div>
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
      if (r.exists) { authScreen("login"); $("#email").value = email; $("#authNote").innerHTML = `<div class="receipt" style="margin-top:0;margin-bottom:12px"><b>This email already has a Vote Watch account,</b> so no new email was sent. Sign in with that account's password. Your invite <b>${esc(code)}</b> is remembered and is added right after you sign in. Forgot the password? Press <b>Forgot password?</b> below, or use a different email.</div>`; return; }
      if (r.needsConfirm) { M.innerHTML = `<div class="auth"><div class="card"><h2>Check your email</h2><p>We sent a confirmation link to <b>${esc(email)}</b> from <b>Vote Watch Dominica</b>. Open it, then sign in here with the password you just made. Your invite code is remembered on this device.</p><p class="small muted">Nothing after 5 minutes? Look in the spam or promotions folder.</p><button class="btn" onclick="location.reload()">Go to sign in</button></div></div>`; return; }
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
    <div id="authNote"></div><label class="f">Email</label><input class="inp" id="email" type="email" autocomplete="username">
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

// ------------------------------------------------------------------ NATIONAL WATCH (shared — the same for everyone)
const SRC = { counter: "Neutral counter", official: "Official poll book", party: "Party agents only" };
const srcPill = (s) => (s === "official" ? '<span class="pill p-rec">OFFICIAL</span>' : s === "counter" ? '<span class="pill p-ok">COUNTER</span>' : s === "party" ? '<span class="pill p-stale">PARTY AGENTS</span>' : "");
// results helpers
const leaderOf = (r) => { const cs = r.candidates || []; const tot = cs.reduce((a, c) => a + +c.votes, 0); if (!tot) return null;
  return { c: cs[0], second: cs[1], tot, margin: (cs[0].votes - (cs[1]?.votes || 0)) / tot }; };
const resultFill = (r) => { const L = leaderOf(r); if (!L) return "#E5E7E4"; if (L.second && L.c.votes === L.second.votes) return "#C9C9C9"; return hexMix(L.c.color, 0.35 + 0.65 * Math.min(1, L.margin / 0.3)); };
async function viewNational() {
  if (SETTINGS && !SETTINGS.national) { $("#main").innerHTML = `<div class="card"><h3>National Watch</h3><p>${SETTINGS.media && !SETTINGS.media.live ? `Your package opens the national picture when the polls close${SETTINGS.poll_close ? " at " + hhmm(SETTINGS.poll_close) : ""}.` : "The National Watch is for party leaders and the system administrator."}</p></div>`; return; }
  if (!SEL.natView) SEL.natView = "turnout";
  $("#main").innerHTML = `
  <div class="row" style="margin-bottom:10px"><b style="font-size:16px">National Watch</b><span class="muted small">One shared picture, identical for every party. Turnout comes from the official poll book or a neutral counter where there is one, otherwise from the party agents inside the station. Party supporter numbers are never shown here.</span></div>
  <div class="seg noprint" id="natView" style="margin-bottom:12px"><button data-v="turnout">🗳 Turnout · who is going</button><button data-v="results">📊 Results · the count after close</button></div>
  <div id="natBody"></div>`;
  $$("#natView button").forEach((b) => { b.classList.toggle("on", b.dataset.v === SEL.natView); b.onclick = () => { SEL.natView = b.dataset.v; SEL.natC = null; viewNational(); }; });
  addWatermark($("#main"));
  return SEL.natView === "results" ? natResults() : natTurnout();
}

async function natTurnout() {
  $("#natBody").innerHTML = `
  <div class="grid kpis" style="margin-bottom:14px">
    <div class="card kpi pu"><div class="l">People who have voted</div><div class="v num" id="kObs">—</div><div class="s" id="kObsS"></div></div>
    <div class="card kpi g"><div class="l">Still to vote</div><div class="v num" id="kRem">—</div><div class="s" id="kRemS"></div></div>
    <div class="card kpi k"><div class="l">Stations reporting</div><div class="v num" id="kSt">—</div><div class="s" id="kStS"></div></div>
    <div class="card kpi r"><div class="l">Needs attention</div><div class="v num" id="kAl">—</div><div class="s">over the register · figures disagree · incidents</div></div>
  </div>
  <div class="grid split">
    <div class="card"><h3>Live map · 21 constituencies</h3>
      <div class="seg noprint" id="natMode" style="margin-bottom:10px"><button data-m="obs">People voted</button><button data-m="pct">% of registered</button></div>
      <div class="map" id="natMap">${mapSVG("natMap")}</div>
      <div class="legend"><span id="lLo">0</span><span class="ramp"></span><span id="lHi"></span></div>
      <p class="small muted" style="margin-bottom:0">Boundaries traced from the Electoral Office's constituency map; for display, not a legal boundary map. Tap a constituency for its stations.</p></div>
    <div class="grid" style="align-content:start">
      <div class="card"><h3>Constituencies <span class="sp noprint row"><button class="btn sm ghost" id="natCsv">⬇ CSV</button><button class="btn sm ghost" onclick="print()">⬇ PDF</button></span></h3>
        <div class="tw" style="max-height:430px"><table><thead><tr><th>Constituency</th><th class="r">Voted</th><th class="r">Registered</th><th>Turnout</th><th class="r">Stations</th><th class="r">Alerts</th><th class="r">Updated</th></tr></thead><tbody id="natRows"></tbody></table></div></div>
      <div class="card hide" id="natDrill"></div>
      <div class="card"><h3>Turnout through the day</h3><div id="natChart"></div></div>
    </div>
  </div>`;
  if (SEL.natMode !== "pct") SEL.natMode = "obs";
  $$("#natMode button").forEach((b) => { b.classList.toggle("on", b.dataset.m === SEL.natMode); b.onclick = () => { SEL.natMode = b.dataset.m; $$("#natMode button").forEach((x) => x.classList.toggle("on", x === b)); paint(); }; });
  let rows = [];
  const alerts = (r) => r.over_list + r.disagreements + r.shared_incidents;
  bindMap("natMap", (code) => { const r = rows.find((x) => x.code === code) || {}; return `<b>${esc(r.name)}</b>Voted ${fmt(r.voted)} of ${fmt(r.electors_listed)} registered (${pct(r.voted, r.electors_listed)})<br>${r.stations_reporting ?? 0}/${r.stations_total ?? 0} stations reporting${r.over_list ? `<br>⚠ ${r.over_list} station(s) above the register` : ""}${r.disagreements ? `<br>⚠ ${r.disagreements} station(s): figures disagree` : ""}`; },
    (code) => { SEL.natC = cByCode(code)?.id; drill(); paint(); });
  $("#natCsv").onclick = () => csv("national-watch-turnout.csv", [["constituency", "voted", "registered", "turnout_pct", "stations_reporting", "stations_total", "stations_neutral_counter", "stations_party_agents_only", "over_register", "figures_disagree", "shared_incidents", "last_update", "generated"],
    ...rows.map((r) => [r.name, r.voted, r.electors_listed, r.electors_listed ? ((r.voted / r.electors_listed) * 100).toFixed(1) : "", r.stations_reporting, r.stations_total, r.from_counter, r.from_party, r.over_list, r.disagreements, r.shared_incidents, r.last_at, API.now().toISOString()])]);
  async function drill() {
    const el = $("#natDrill"); if (!SEL.natC) return el.classList.add("hide");
    const [st, tms] = await Promise.all([API.nationalStations(SEL.natC), API.stationTimes(SEL.natC).catch(() => [])]); el.classList.remove("hide");
    const tm = (id) => tms.find((t) => t.station_id === id) || {};
    el.innerHTML = `<h3>${esc(cName(SEL.natC))} · stations <span class="sp"><button class="btn sm ghost" id="dClose">Close</button></span></h3><div class="tw" style="max-height:320px"><table><thead><tr><th>Station</th><th class="r">Voted</th><th class="r">Registered</th><th class="r">%</th><th>Figure from</th><th>Party agents' own counts</th><th class="r">Opened</th><th class="r">Closed</th><th class="r">Updated</th></tr></thead><tbody>${
      st.map((s) => `<tr><td><b>${esc(s.official_code)}</b> <span class="muted small">${esc(s.station_name)}</span>${s.over_list ? ' <span class="pill p-flag">ABOVE REGISTER</span>' : ""}${s.disagreement ? ' <span class="pill p-flag">FIGURES DISAGREE</span>' : ""}</td>
        <td class="r num"><b>${fmt(s.voted)}</b></td><td class="r num">${fmt(s.electors_listed)}</td><td class="r num">${pct(s.voted, s.electors_listed)}</td><td>${s.voted === null ? stationPill(null) : srcPill(s.source)}</td>
        <td class="small">${(s.party_figures || []).map((f) => `<span class="lg"><i style="background:${esc(f.color)}"></i>${esc(f.party)} ${fmt(f.attendance)}</span>`).join(" ") || '<span class="muted">—</span>'}</td><td class="r num">${hhmm(tm(s.station_id).opened_at)}</td><td class="r num">${hhmm(tm(s.station_id).closed_at)}</td><td class="r num">${hhmm(s.last_at)}</td></tr>`).join("") || '<tr><td colspan="9" class="muted">No stations loaded for this constituency yet.</td></tr>'}</tbody></table></div>
      <p class="small muted" style="margin-bottom:0">"Voted" is one figure per station: the official poll book if entered, otherwise the neutral counter, otherwise (backup) the highest count from party agents who share. Each party's own count is listed beside it so any difference is visible.</p>`;
    $("#dClose").onclick = () => { SEL.natC = null; el.classList.add("hide"); paint(); };
  }
  function paint() {
    const val = (r) => (SEL.natMode === "pct" ? (r.electors_listed ? r.voted / r.electors_listed : 0) : +r.voted);
    const max = SEL.natMode === "pct" ? 0.8 : Math.max(100, ...rows.map(val));
    const data = {}; rows.forEach((r) => { const f = val(r) / max; data[r.code] = { fill: ramp(f), dark: f < 0.45, value: +r.voted, label: SEL.natMode === "pct" ? (r.electors_listed ? Math.round(val(r) * 100) + "%" : "—") : fmt(val(r)) }; });
    paintMap("natMap", data, SEL.natC ? CONSTS.find((c) => c.id === SEL.natC)?.code : null);
    $("#lHi").textContent = SEL.natMode === "pct" ? "80%+" : fmt(max); $("#lLo").textContent = SEL.natMode === "pct" ? "0%" : "0";
  }
  async function load() {
    const [sum, tl] = await Promise.all([API.nationalSummary(), API.nationalTimeline()]); rows = sum;
    const T = (k) => rows.reduce((a, r) => a + +r[k], 0);
    const v = T("voted"), el = T("electors_listed"), rep = T("stations_reporting"), tot = T("stations_total");
    $("#kObs").textContent = fmt(v); $("#kObsS").textContent = el ? `${pct(v, el)} of ${fmt(el)} registered` : "register not loaded yet";
    $("#kRem").textContent = el ? fmt(Math.max(0, el - v)) : "—"; $("#kRemS").textContent = el ? "registered voters not yet recorded" : "";
    $("#kSt").textContent = `${rep} / ${tot}`; $("#kStS").textContent = `${T("from_counter")} by neutral counter · ${T("from_party")} by party agents only`;
    $("#kAl").textContent = fmt(rows.reduce((a, r) => a + alerts(r), 0));
    $("#natRows").innerHTML = rows.map((r) => `<tr class="click" data-id="${r.constituency_id}"><td><b>${esc(r.name)}</b></td><td class="r num"><b>${fmt(r.voted)}</b></td><td class="r num">${fmt(r.electors_listed)}</td>
      <td><div class="row" style="gap:6px;flex-wrap:nowrap"><div class="bar"><i style="width:${r.electors_listed ? Math.min(100, (r.voted / r.electors_listed) * 100) : 0}%"></i></div><span class="small num">${pct(r.voted, r.electors_listed)}</span></div></td>
      <td class="r num">${r.stations_reporting}/${r.stations_total}</td><td class="r">${alerts(r) ? `<span class="pill p-flag">${alerts(r)}</span>` : '<span class="muted">—</span>'}</td><td class="r num">${hhmm(r.last_at)}</td></tr>`).join("");
    $$("#natRows tr").forEach((tr) => (tr.onclick = () => { SEL.natC = +tr.dataset.id; drill(); paint(); }));
    paint(); timeline($("#natChart"), tl); if (SEL.natC) drill();
  }
  REFRESH = load; await guard(load);
}

async function natResults() {
  $("#natBody").innerHTML = `
  <div class="receipt" style="margin-bottom:12px;border-color:#EFD978;background:#FFFBE6"><b>UNOFFICIAL.</b> Station-by-station count totals: the official sheet where entered, otherwise the neutral counter, otherwise the party agents who witnessed the count. Only the Electoral Office declares the result. No individual ballots are recorded, only each station's totals.</div>
  <div class="grid kpis" style="margin-bottom:14px">
    <div class="card kpi k"><div class="l">Stations counted</div><div class="v num" id="rSt">—</div><div class="s" id="rStS"></div></div>
    <div class="card kpi pu"><div class="l">Ballots counted</div><div class="v num" id="rBal">—</div><div class="s" id="rBalS"></div></div>
    <div class="card kpi r"><div class="l">Rejected / spoilt</div><div class="v num" id="rRej">—</div><div class="s" id="rRejS"></div></div>
    <div class="card kpi g" style="grid-column:span 2"><div class="l">Constituencies · who is ahead</div><div id="rTally" class="row" style="gap:6px;margin-top:6px"></div><div class="s">"Fully counted" = every station in the constituency has reported</div></div>
  </div>
  <div class="grid split">
    <div class="card"><h3>Results map · leading candidate</h3>
      <div class="map" id="resMap">${mapSVG("resMap")}</div>
      <div class="legend" id="resLeg"></div>
      <p class="small muted" style="margin-bottom:0">Each constituency takes the colour of the candidate ahead: darker = bigger lead, lighter = close. Grey = not counted yet.</p></div>
    <div class="grid" style="align-content:start">
      <div class="card"><h3>Constituencies <span class="sp noprint row"><button class="btn sm ghost" id="resCsv">⬇ CSV</button><button class="btn sm ghost" onclick="print()">⬇ PDF</button></span></h3>
        <div class="tw" style="max-height:430px"><table><thead><tr><th>Constituency</th><th>Ahead</th><th class="r">Votes</th><th class="r">Lead</th><th class="r">Counted</th><th class="r">Rejected</th><th class="r">Updated</th></tr></thead><tbody id="resRows"></tbody></table></div></div>
      <div class="card hide" id="resDrill"></div>
    </div>
  </div>`;
  let rows = [];
  bindMap("resMap", (code) => { const r = rows.find((x) => x.code === code) || {}; const tot = (r.candidates || []).reduce((a, c) => a + +c.votes, 0);
    return `<b>${esc(r.name)}</b>${r.stations_counted || 0}/${r.stations_total || 0} stations counted<br>` + ((r.candidates || []).map((c) => `<span class="lg"><i style="background:${esc(c.color)}"></i>${esc(c.name)} (${esc(c.party)}) ${fmt(c.votes)} · ${pct(c.votes, tot)}</span>`).join("<br>") || "No candidates entered yet"); },
    (code) => { SEL.natC = cByCode(code)?.id; drill(); paint(); });
  $("#resCsv").onclick = () => { const out = [["UNOFFICIAL station count totals — not the declared result"], ["constituency", "stations_counted", "stations_total", "candidate", "affiliation", "votes", "ballots_counted", "rejected", "generated"]];
    rows.forEach((r) => (r.candidates || []).forEach((c) => out.push([r.name, r.stations_counted, r.stations_total, c.name, c.party, c.votes, r.ballots, r.rejected, API.now().toISOString()]))); csv("national-watch-results-UNOFFICIAL.csv", out); };
  async function drill() {
    const el = $("#resDrill"); if (!SEL.natC) return el.classList.add("hide");
    const r = rows.find((x) => x.constituency_id === SEL.natC) || {}, st = await API.nationalStationResults(SEL.natC), cs = r.candidates || [];
    const tot = cs.reduce((a, c) => a + +c.votes, 0); el.classList.remove("hide");
    el.innerHTML = `<h3>${esc(r.name)} · ${r.stations_counted}/${r.stations_total} stations counted <span class="sp"><button class="btn sm ghost" id="dClose">Close</button></span></h3>
      ${cs.map((c) => `<div style="margin:6px 0"><div class="row" style="justify-content:space-between"><span><span class="lg"><i style="background:${esc(c.color)}"></i><b>${esc(c.name)}</b></span> <span class="muted small">${esc(c.party)}</span></span><span class="num"><b>${fmt(c.votes)}</b> · ${pct(c.votes, tot)}</span></div>
        <div class="bar" style="width:100%"><i style="width:${tot ? (c.votes / tot) * 100 : 0}%;background:${esc(c.color)}"></i></div></div>`).join("") || '<p class="muted small">No candidates entered for this constituency yet.</p>'}
      <div class="tw" style="max-height:300px;margin-top:10px"><table><thead><tr><th>Station</th><th class="r">Voted today</th>${cs.map((c) => `<th class="r">${esc(c.party)}</th>`).join("")}<th class="r">Rejected</th><th class="r">Ballots</th><th>From</th></tr></thead><tbody>${
        st.map((s) => `<tr><td><b>${esc(s.official_code)}</b> <span class="muted small">${esc(s.station_name)}</span>${(s.flags || []).length ? `<div class="small" style="color:var(--red)">⚠ ${esc(s.flags.join("; "))}</div>` : ""}</td><td class="r num">${fmt(s.voted)}</td>
          ${cs.map((c) => `<td class="r num">${s.votes ? fmt(s.votes[c.id]) : "—"}</td>`).join("")}<td class="r num">${s.votes ? fmt(s.rejected) : "—"}</td><td class="r num">${s.votes ? fmt(s.total_ballots) : '<span class="pill p-none">NOT COUNTED</span>'}</td><td>${s.votes ? srcPill(s.source) : ""}</td></tr>`).join("")}</tbody></table></div>
      <p class="small muted" style="margin-bottom:0">A warning appears if a station's ballots are more than the people recorded voting there, or more than its register.</p>`;
    $("#dClose").onclick = () => { SEL.natC = null; el.classList.add("hide"); paint(); };
  }
  function paint() {
    const data = {}; rows.forEach((r) => { const L = leaderOf(r), f = resultFill(r);
      data[r.code] = { fill: f, dark: !L || Math.min(1, L.margin / 0.3) < 0.35, value: +r.ballots, label: L ? (L.second && L.c.votes === L.second.votes ? "TIE" : L.c.party) : "" }; });
    paintMap("resMap", data, SEL.natC ? CONSTS.find((c) => c.id === SEL.natC)?.code : null);
    const seen = new Map(); rows.forEach((r) => (r.candidates || []).forEach((c) => seen.set(c.party, c.color)));
    $("#resLeg").innerHTML = [...seen].map(([p, c]) => `<span class="lg"><i style="background:${esc(c)}"></i>${esc(p)}</span>`).join("") + '<span class="lg"><i style="background:#E5E7E4"></i>Not counted</span>';
  }
  async function load() {
    rows = await API.nationalResults();
    const T = (k) => rows.reduce((a, r) => a + +r[k], 0), cnt = T("stations_counted"), tot = T("stations_total"), bal = T("ballots"), rej = T("rejected");
    $("#rSt").textContent = `${cnt} / ${tot}`; $("#rStS").textContent = tot ? pct(cnt, tot) + " of stations" : "";
    $("#rBal").textContent = fmt(bal); $("#rBalS").textContent = "including rejected"; $("#rRej").textContent = fmt(rej); $("#rRejS").textContent = bal ? pct(rej, bal) + " of ballots" : "";
    const tally = new Map(); rows.forEach((r) => { const L = leaderOf(r); if (!L || (L.second && L.c.votes === L.second.votes)) return; const k = L.c.party, t = tally.get(k) || { color: L.c.color, ahead: 0, full: 0 };
      t.ahead++; if (r.stations_counted === r.stations_total && r.stations_total) t.full++; tally.set(k, t); });
    $("#rTally").innerHTML = [...tally].sort((a, b) => b[1].ahead - a[1].ahead).map(([p, t]) => `<span class="chip" style="background:${esc(t.color)};color:#fff;padding:6px 10px"><b>${esc(p)}</b>&nbsp;ahead in ${t.ahead} · fully counted ${t.full}</span>`).join("") || '<span class="muted small">No station has reported a count yet.</span>';
    $("#resRows").innerHTML = rows.map((r) => { const L = leaderOf(r);
      return `<tr class="click" data-id="${r.constituency_id}"><td><b>${esc(r.name)}</b>${r.flagged ? ` <span class="pill p-flag">⚠ ${r.flagged}</span>` : ""}</td>
      <td>${L ? `<span class="lg"><i style="background:${esc(L.c.color)}"></i>${esc(L.c.name)} <span class="muted small">${esc(L.c.party)}</span></span>` : '<span class="muted">—</span>'}</td>
      <td class="r num">${L ? fmt(L.c.votes) : "—"}</td><td class="r num">${L && L.second ? "+" + fmt(L.c.votes - L.second.votes) : "—"}</td>
      <td class="r num">${r.stations_counted}/${r.stations_total}</td><td class="r num">${fmt(r.rejected)}</td><td class="r num">${hhmm(r.last_at)}</td></tr>`; }).join("");
    $$("#resRows tr").forEach((tr) => (tr.onclick = () => { SEL.natC = +tr.dataset.id; drill(); paint(); }));
    paint(); if (SEL.natC) drill();
  }
  REFRESH = load; await guard(load);
}

// ------------------------------------------------------------------ REP: my station (mobile first)
async function viewStation() {
  const sts = ME.stations; if (!sts.length) { $("#main").innerHTML = '<div class="card">You are not assigned to a polling station yet. Ask your party administrator.</div>'; return; }
  if (!sts.find((s) => s.id === SEL.repStation)) SEL.repStation = sts[0].id;
  const st = sts.find((s) => s.id === SEL.repStation), P = ME.party, job = localStorage.getItem("vw_job") || "both";
  if (!SEL.repTabSet) { SEL.repTab = job === "outside" ? "support" : "turnout"; SEL.repTabSet = true; }
  $("#main").innerHTML = `<div class="rep">
    ${sts.length > 1 ? `<select class="inp" id="stSel" style="margin-bottom:10px">${sts.map((s) => `<option value="${s.id}" ${s.id === st.id ? "selected" : ""}>${esc(s.official_code)} — ${esc(s.name)}</option>`).join("")}</select>` : ""}
    <div class="receipt"><div class="h"><span>${esc(st.official_code)}</span><span class="pill p-ok">ASSIGNED</span></div><div>${esc(st.name)}</div><div class="muted small">${esc(st.district || "")} · ${esc(cName(st.constituency_id))}${st.electors_listed ? ` · ${fmt(st.electors_listed)} electors on list` : ""}</div></div>
    <div id="ocBox"></div><div id="outbox"></div>
    <div class="rtabs">${job === "outside" ? "" : '<button data-t="turnout">Live count</button>'}<button data-t="support" class="priv">🔒 Our supporters</button>${job === "outside" ? '<button data-t="turnout">Live count</button>' : ""}${job === "outside" ? "" : '<button data-t="results">Count after close</button>'}<button data-t="incident">Incident</button><button data-t="history">My reports</button></div>
    <div id="repBody"></div></div>`;
  $("#stSel") && ($("#stSel").onchange = (e) => { SEL.repStation = e.target.value; viewStation(); });
  openClose($("#ocBox"), st);
  $$(".rtabs button").forEach((b) => (b.onclick = () => { SEL.repTab = b.dataset.t; tab(); }));
  let mine = { subs: [], estimates: [], incidents: [] };
  const lastGood = () => mine.subs.find((s) => s.status !== "superseded" && s.status !== "rejected");
  const lastEst = () => mine.estimates[0];
  async function loadMine() { mine = await API.myReports(st.id); const l1 = lastGood(), e1 = lastEst(), Ta = tallyGet("att", st.id), Ts = tallyGet("sup", st.id);
    if (SEL.repTab === "history" || (SEL.repTab === "turnout" && l1 && l1.attendance > Ta.n && !Ta.touched) || (SEL.repTab === "support" && e1 && e1.estimated_supporters > Ts.n)) tab(); else { const l = $("#lastTot"); if (l) l.innerHTML = lastTotHtml(); } }
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
      const T = tallyGet("att", st.id), l0 = lastGood();
      if (l0 && l0.attendance > T.n && !T.touched) { T.n = l0.attendance; tallySet("att", st.id, T); }
      B.innerHTML = `<div class="card"><div class="tally"><div class="small muted">Everyone who has voted at this station (our agent's count)</div><div class="tn num" id="aN">${fmt(T.n)}</div><div class="small muted" id="aPct"></div>
          <button class="btn big y" id="plus">+1 voter</button><button class="btn sm ghost" style="margin-top:8px" id="minus">−1 undo last tap</button></div>
        <div class="small" style="text-align:center;margin-top:8px">Last accepted: <span class="num" id="lastTot">${lastTotHtml()}</span></div>
        <button class="btn" style="margin-top:12px;width:100%" id="send">Send now</button><div id="sendMsg" style="margin-top:10px"></div>
        <details style="margin-top:10px"><summary class="small">Type the total instead</summary><div class="row" style="margin-top:6px"><input class="inp num" id="cnt" type="number" inputmode="numeric" min="0" style="flex:1"><button class="btn sm ghost" id="setN">Use this total</button></div>
          <label class="f">Note (optional — no names)</label><input class="inp" id="note" maxlength="500" placeholder="e.g. queue of about 30 people"></details>
        <p class="small muted" style="margin-bottom:0">Tap <b>+1</b> for every person who votes. The total sends by itself 20 seconds after your last tap, and taps are saved on this phone if there is no signal. It goes to your watch room${P.share_counts ? ", and to the National Watch (where there is no neutral counter, the highest party count is used)" : ""}. Not counted twice if sent twice.</p></div>`;
      let autoT = null;
      const show = () => { $("#aN").textContent = fmt(T.n); $("#aPct").textContent = st.electors_listed ? `${pct(T.n, st.electors_listed)} of the ${fmt(st.electors_listed)} registered` : ""; };
      const sendNow = async (manual) => {
        clearTimeout(autoT); const l = lastGood(); if (!manual && l && l.attendance === T.n) return;
        if (l && T.n < l.attendance && !confirm(`This is lower than your last total (${l.attendance}). Send anyway? Use "My reports → Correct" to fix a mistake instead.`)) return;
        const r = await send("attendance", { station: st.id, key: tallySendKey("att", st.id, T), attendance: T.n, note: ($("#note")?.value || "").trim() });
        if (manual || r.flags?.length || r.queued) confirmBox(r, () => tab()); if (!r.queued) loadMine();
      };
      const bump = (d) => { T.n = Math.max(0, T.n + d); T.touched = true; tallySet("att", st.id, T); show(); clearTimeout(autoT); autoT = setTimeout(() => guard(() => sendNow(false)), 20000); };
      $("#plus").onclick = () => bump(1); $("#minus").onclick = () => bump(-1);
      $("#setN").onclick = () => { const v = parseInt($("#cnt").value, 10); if (!(v >= 0)) return toast("Enter the running total as a whole number.", true); T.n = v; T.touched = true; tallySet("att", st.id, T); show(); };
      $("#send").onclick = () => guard(() => sendNow(true));
      show();
    } else if (SEL.repTab === "support") {
      const e = lastEst(), T = tallyGet("sup", st.id);
      if (e && e.estimated_supporters > T.n) { T.n = e.estimated_supporters; tallySet("sup", st.id, T); }
      let voted = null;
      B.innerHTML = `<div class="card" style="border-top:4px solid var(--party)"><div class="row"><span class="private">🔒 Private to ${esc(P.short_name)}</span></div>
        <p class="small" style="margin:8px 0 0">Goes only to <b>${esc(P.name)}</b>'s head office and your watch room. Never shared with other parties and never on the National Watch. It is <b>your count of supporters you recognise coming in</b>, not a vote count: people can change their mind in the booth. Numbers only, never names.</p>
        <div class="grid" style="grid-template-columns:1fr 1fr 1fr;margin-top:10px;gap:8px">
          <div class="receipt"><div class="small muted">Voted here so far</div><b class="num" id="sVoted">…</b></div>
          <div class="receipt"><div class="small muted">Our expected here</div><b class="num" id="sExp">…</b></div>
          <div class="receipt"><div class="small muted">Last sent</div><b class="num">${e ? fmt(e.estimated_supporters) + " · " + hhmm(e.received_at) : "—"}</b></div></div>
        <div class="tally"><div class="small muted">Our supporters present so far</div><div class="tn num" id="supN">${fmt(T.n)}</div>
          <button class="btn big" style="background:var(--party)" id="plus">+1 supporter came in</button>
          <button class="btn sm ghost" style="margin-top:8px" id="minus">−1 undo last tap</button><div id="estPct" class="small muted" style="margin-top:6px"></div></div>
        <details style="margin-top:6px"><summary class="small">Type the number instead</summary><div class="row" style="margin-top:6px"><input class="inp num" id="est" type="number" inputmode="numeric" min="0" style="flex:1"><button class="btn sm ghost" id="setN">Use this number</button></div></details>
        <label class="f">How sure are you?</label><div class="seg" id="conf"><button data-c="low">Rough guess</button><button data-c="medium" class="on">Fairly sure</button><button data-c="high">Very sure</button></div>
        <label class="f">Note (optional — no names)</label><input class="inp" id="enote" maxlength="500">
        <button class="btn big" style="margin-top:14px;background:var(--party)" id="send">Send to head office</button><div id="sendMsg" style="margin-top:10px"></div>
        <p class="small muted" style="margin-bottom:0">Your taps are saved on this phone, so nothing is lost if the screen closes. Send every 15–30 minutes, or whenever you can.</p></div>`;
      const show = () => { $("#supN").textContent = fmt(T.n); $("#estPct").textContent = voted ? `≈ ${pct(T.n, voted)} of the people who have voted here` : ""; };
      API.nationalStations(st.constituency_id).then((ns) => { const x = ns.find((n) => n.station_id === st.id); voted = x?.voted ?? lastGood()?.attendance ?? null; const el = $("#sVoted"); if (el) el.textContent = fmt(voted); show(); }).catch(() => { const el = $("#sVoted"); if (el) el.textContent = "—"; });
      API.myTarget(st.id).then((x) => { const el = $("#sExp"); if (el) el.textContent = fmt(x); }).catch(() => { const el = $("#sExp"); if (el) el.textContent = "—"; });
      $("#plus").onclick = () => { T.n++; tallySet("sup", st.id, T); show(); };
      $("#minus").onclick = () => { if (T.n > 0) T.n--; tallySet("sup", st.id, T); show(); };
      $("#setN").onclick = () => { const v = parseInt($("#est").value, 10); if (!(v >= 0)) return toast("Enter a whole number.", true); T.n = v; tallySet("sup", st.id, T); show(); };
      let conf = "medium";
      $$("#conf button").forEach((b) => (b.onclick = () => { conf = b.dataset.c; $$("#conf button").forEach((x) => x.classList.toggle("on", x === b)); }));
      $("#send").onclick = () => guard(async () => {
        const v = T.n;
        if (voted !== null && v > voted && !confirm(`${v} is more than the ${voted} people recorded voting here so far. Send anyway?`)) return;
        const r = await send("estimate", { station: st.id, key: tallySendKey("sup", st.id, T), estimate: v, confidence: conf, note: $("#enote").value.trim() });
        confirmBox(r, () => tab()); if (!r.queued) loadMine();
      });
    } else if (SEL.repTab === "results") {
      B.innerHTML = `<div class="card" id="resForm"><p class="muted small">Loading…</p></div>`;
      API.myCounts(st.id).then(async (m) => { const prev = m.results.find((r) => !r.superseded);
        const ns = await API.nationalStations(st.constituency_id).catch(() => []), voted = ns.find((n) => n.station_id === st.id)?.voted;
        await resultsForm($("#resForm"), st, { previous: prev, voted });
        $("#resForm").insertAdjacentHTML("beforeend", `<p class="small muted" style="margin-bottom:0">Used on the National Watch only where there is no neutral counter or official figure${P.share_counts ? "" : " — and only if your party shares its counts (it does not at the moment)"}. If another party's agent has entered different totals, yours is flagged so the difference is visible.</p>`);
      }).catch((e) => toast(e.message, true));
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
      const t = tallyGet("att", st.id); t.n = v; tallySet("att", st.id, t);
      toast("✓ Correction received. The original is kept on record."); SEL.repTab = "history"; await loadMine(); tab();
    });
  }
  paintNet(); tab(); REFRESH = loadMine; await guard(loadMine); flushOutbox();
}

// ------------------------------------------------------------------ NEUTRAL COUNTER (no party): turnout as voters come in, station count after close
// Shared form for entering one station's count totals (used by the counter and by the system admin for official figures)
async function resultsForm(el, st, opts = {}) {
  const cands = await API.candidates(st.constituency_id);
  if (!cands.length) { el.innerHTML = `<div class="receipt">No candidates have been entered for ${esc(cName(st.constituency_id))} yet. The system administrator adds them after Nomination Day.</div>`; return; }
  const prev = opts.previous, key = newKey();
  el.innerHTML = `${prev ? `<div class="receipt" style="border-color:#9CD3B3"><b>Already sent at ${hhmm(prev.received_at)}</b> · ${fmt(prev.total_ballots)} ballots. Sending again will <b>correct</b> it (the first version is kept on record).</div>` : ""}
    <p class="small muted" style="margin-top:0">Enter the totals announced for this station at the count. One number per candidate (0 if none) and the rejected/spoilt ballots.</p>
    ${cands.map((c) => `<label class="f"><span class="lg"><i style="background:${esc(c.color)}"></i>${esc(c.name)}</span> <span class="muted small">${esc(c.party)}</span></label><input class="inp num rv" data-c="${c.id}" type="number" inputmode="numeric" min="0" value="${prev ? prev.votes[c.id] ?? "" : ""}">`).join("")}
    <label class="f">Rejected / spoilt ballots</label><input class="inp num" id="rRejIn" type="number" inputmode="numeric" min="0" value="${prev ? prev.rejected : ""}">
    <div class="receipt" style="margin-top:10px" id="rTot"></div>
    ${prev ? '<label class="f">Reason for the correction (required)</label><input class="inp" id="rReason" placeholder="e.g. recount of box 2">' : ""}
    <button class="btn big ${opts.official ? "dark" : "y"}" style="margin-top:12px" id="rSend">${opts.official ? "Save official station result" : "Send station count"}</button><div id="rMsg" style="margin-top:10px"></div>`;
  const sum = () => { let t = 0, ok = true; $$(".rv", el).forEach((i) => { const v = parseInt(i.value, 10); if (v >= 0) t += v; else ok = false; }); const rj = parseInt($("#rRejIn", el).value, 10); return { t, rj: rj >= 0 ? rj : null, ok: ok && rj >= 0 }; };
  const paintTot = () => { const x = sum(); $("#rTot", el).innerHTML = `Total ballots: <b class="num">${fmt(x.t + (x.rj || 0))}</b>${opts.voted ? ` · people recorded voting here: <b class="num">${fmt(opts.voted)}</b>${x.t + (x.rj || 0) > opts.voted ? ' <span class="pill p-flag">MORE BALLOTS THAN VOTERS</span>' : ""}` : ""}`; };
  el.oninput = paintTot; paintTot();
  $("#rSend", el).onclick = () => guard(async () => {
    const x = sum(); if (!x.ok) throw new Error("Enter a whole number for every candidate and for rejected ballots (0 if none).");
    const votes = {}; $$(".rv", el).forEach((i) => (votes[i.dataset.c] = parseInt(i.value, 10)));
    const reason = prev ? ($("#rReason", el).value || "").trim() : null; if (prev && reason.length < 3) throw new Error("Give a reason for the correction.");
    if (!confirm(`Send these totals for ${st.official_code}? ${fmt(x.t + x.rj)} ballots in all.`)) return;
    const r = await send("results", { station: st.id, key, votes, rejected: x.rj, corrects: prev?.id || null, reason });
    $("#rMsg", el).innerHTML = r.queued ? '<div class="outbox"><b>⏳ No signal — saved on this phone.</b> It will send automatically.</div>'
      : `<div class="receipt" style="border-color:#9CD3B3"><b>✓ Received at ${hhmm(r.received_at)}</b> · ref ${esc(r.id)}${r.flags?.length ? `<div class="small" style="color:var(--red)">⚠ Shown as a warning on the National Watch: ${esc(r.flags.join("; "))}</div>` : ""}</div>`;
    opts.onSent && opts.onSent(r);
  });
}

async function viewCounter() {
  const sts = ME.stations; if (!sts.length) { $("#main").innerHTML = '<div class="card">You are not assigned to a polling station yet. Ask the system administrator.</div>'; return; }
  if (!sts.find((s) => s.id === SEL.repStation)) SEL.repStation = sts[0].id;
  const st = sts.find((s) => s.id === SEL.repStation);
  if (!["count", "results", "history"].includes(SEL.cntTab)) SEL.cntTab = "count";
  $("#main").innerHTML = `<div class="rep">
    <div class="receipt"><div class="h"><span>${esc(st.official_code)}</span><span class="pill p-ok">NEUTRAL COUNTER</span></div><div>${esc(st.name)}</div><div class="muted small">${esc(st.district || "")} · ${esc(cName(st.constituency_id))}${st.electors_listed ? ` · ${fmt(st.electors_listed)} registered` : ""}</div>
      <div class="small" style="margin-top:4px">You belong to no party. Your figure is the one every party sees on the National Watch.</div></div>
    <div id="ocBox"></div><div id="outbox"></div>
    <div class="rtabs"><button data-t="count">Voters in</button><button data-t="results">Count after close</button><button data-t="history">My entries</button></div>
    <div id="cBody"></div></div>`;
  $$(".rtabs button").forEach((b) => (b.onclick = () => { SEL.cntTab = b.dataset.t; tab(); }));
  openClose($("#ocBox"), st);
  let mine = { counts: [], results: [] }, autoT = null;
  const lastCount = () => mine.counts.find((c) => !c.superseded);
  const lastRes = () => mine.results.find((r) => !r.superseded);
  async function loadMine() { mine = await API.myCounts(st.id); if (SEL.cntTab === "history") tab(); else paintCount(); }
  const T = tallyGet("vot", st.id);
  function paintCount() {
    const n = $("#vN"); if (!n) return; const l = lastCount();
    if (l && l.voted > T.n && !T.touched) { T.n = l.voted; tallySet("vot", st.id, T); }
    n.textContent = fmt(T.n);
    const unsent = !l || l.voted !== T.n;
    $("#vSent").innerHTML = l ? `Last sent: <b class="num">${fmt(l.voted)}</b> at ${hhmm(l.received_at)}${unsent ? ` · <span style="color:var(--amber)">${fmt(T.n)} not sent yet</span>` : ' · <span style="color:var(--green)">✓ up to date</span>'}` : `<span style="color:var(--amber)">Nothing sent yet</span>`;
    $("#vPct").textContent = st.electors_listed ? `${pct(T.n, st.electors_listed)} of the ${fmt(st.electors_listed)} registered` : "";
  }
  async function sendCount(manual) {
    clearTimeout(autoT); autoT = null; const l = lastCount(); if (l && l.voted === T.n && !manual) return;
    if (l && T.n < l.voted && !confirm(`This is lower than the ${l.voted} you sent before. Send ${T.n}?`)) return;
    const r = await send("count", { station: st.id, key: tallySendKey("vot", st.id, T), voted: T.n });
    if (r.queued) toast("No signal: saved on this phone, it will send automatically."); else { if (r.flags?.length) toast("Sent, with a warning: " + r.flags.join("; "), true); else if (manual) toast("✓ Sent: " + fmt(T.n)); await loadMine(); }
  }
  const autoSend = () => { clearTimeout(autoT); autoT = setTimeout(() => guard(() => sendCount(false)), 20000); };
  function tab() {
    $$(".rtabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === SEL.cntTab));
    const B = $("#cBody");
    if (SEL.cntTab === "count") {
      B.innerHTML = `<div class="card"><div class="tally"><div class="small muted">People who have voted at this station</div><div class="tn num" id="vN">${fmt(T.n)}</div><div class="small muted" id="vPct"></div>
          <button class="btn big y" id="plus">+1 voter</button><button class="btn sm ghost" style="margin-top:8px" id="minus">−1 undo last tap</button></div>
        <div class="small" id="vSent" style="text-align:center;margin-top:8px"></div>
        <button class="btn" style="margin-top:12px;width:100%" id="sendNow">Send now</button>
        <details style="margin-top:10px"><summary class="small">Type the total instead (e.g. from the poll book)</summary><div class="row" style="margin-top:6px"><input class="inp num" id="vSet" type="number" inputmode="numeric" min="0" style="flex:1"><button class="btn sm ghost" id="vSetGo">Use this total</button></div></details>
        <p class="small muted" style="margin-bottom:0">Tap <b>+1</b> each time a voter is entered in the poll book. The total sends by itself 20 seconds after your last tap; taps are saved on this phone, so nothing is lost without signal.</p></div>`;
      $("#plus").onclick = () => { T.n++; T.touched = true; tallySet("vot", st.id, T); paintCount(); autoSend(); };
      $("#minus").onclick = () => { if (T.n > 0) T.n--; T.touched = true; tallySet("vot", st.id, T); paintCount(); autoSend(); };
      $("#sendNow").onclick = () => guard(() => sendCount(true));
      $("#vSetGo").onclick = () => { const v = parseInt($("#vSet").value, 10); if (!(v >= 0)) return toast("Enter a whole number.", true); T.n = v; T.touched = true; tallySet("vot", st.id, T); paintCount(); guard(() => sendCount(true)); };
      paintCount();
    } else if (SEL.cntTab === "results") {
      B.innerHTML = `<div class="card" id="resForm"><p class="muted small">Loading…</p></div>`;
      resultsForm($("#resForm"), st, { previous: lastRes(), voted: lastCount()?.voted, onSent: () => loadMine().then(() => (SEL.cntTab === "results" ? null : null)) });
    } else {
      B.innerHTML = `<h3 style="margin:14px 0 6px;font-size:13px">Station count after close</h3>` + (mine.results.map((r) => `<div class="receipt"><div class="h"><span class="num">${fmt(r.total_ballots)} ballots</span>${r.superseded ? '<span class="pill p-none">CORRECTED</span>' : (r.flags || []).length ? '<span class="pill p-flag">⚠ CHECK</span>' : '<span class="pill p-ok">LATEST</span>'}</div>
          <div class="small muted">ref ${r.id} · ${hhmm(r.received_at)} · ${fmt(r.rejected)} rejected${r.reason ? ` · “${esc(r.reason)}”` : ""}${(r.flags || []).length ? `<br><span style="color:var(--red)">${esc(r.flags.join("; "))}</span>` : ""}</div></div>`).join("") || '<p class="muted small">None yet.</p>') +
        `<h3 style="margin:14px 0 6px;font-size:13px">Voters in (running totals sent)</h3>` + (mine.counts.map((c) => `<div class="receipt"><div class="h"><span class="num">${fmt(c.voted)}</span>${c.superseded ? '<span class="pill p-none">CORRECTED</span>' : (c.flags || []).length ? '<span class="pill p-flag">⚠ CHECK</span>' : ""}</div>
          <div class="small muted">ref ${c.id} · server ${hhmm(c.received_at)}${c.kind === "correction" ? ` · corrects ${c.corrects_id}: “${esc(c.reason)}”` : ""}${(c.flags || []).length ? `<br><span style="color:var(--red)">${esc(c.flags.join("; "))}</span>` : ""}</div>
          ${!c.superseded ? `<button class="btn sm ghost" style="margin-top:6px" data-corr="${c.id}">Correct this figure</button>` : ""}</div>`).join("") || '<p class="muted small">None yet.</p>');
      $$("[data-corr]", B).forEach((b) => (b.onclick = () => {
        const c = mine.counts.find((x) => String(x.id) === b.dataset.corr), v = parseInt(prompt(`Correct figure instead of ${c.voted}:`, c.voted), 10); if (!(v >= 0)) return;
        const reason = (prompt("Reason (required):") || "").trim(); if (reason.length < 3) return toast("A reason is required.", true);
        guard(async () => { const r = await send("countCorrection", { original: c.id, key: newKey(), voted: v, reason }); if (!r.queued) { T.n = v; tallySet("vot", st.id, T); await loadMine(); } }, "Correction sent. The original is kept on record.");
      }));
    }
  }
  paintNet(); tab(); REFRESH = loadMine; await guard(loadMine); flushOutbox();
}

// ------------------------------------------------------------------ WATCH ROOM (party-private)
const cameBar = (present, expected, color) => !expected ? '<span class="muted small">no target</span>'
  : `<div class="row" style="gap:6px;flex-wrap:nowrap"><div class="bar"><i style="width:${Math.min(100, (present / expected) * 100)}%;background:${color}"></i></div><span class="small num">${pct(present, expected)}</span></div>`;
async function viewWatch() {
  const allowed = ME.role === "watch" ? CONSTS.filter((c) => ME.constituencies.includes(c.id)) : CONSTS;
  if (!allowed.length) { $("#main").innerHTML = '<div class="card">No constituency is assigned to you yet.</div>'; return; }
  if (!allowed.find((c) => c.id === SEL.c)) SEL.c = allowed[0].id;
  const P = ME.party;
  $("#main").innerHTML = `<div class="partyhead"><b>${esc(P.name)} · Watch room</b><span class="private" style="background:rgba(255,255,255,.2)">🔒 Private to ${esc(P.short_name)}</span>
    <select class="inp" id="cSel" style="width:auto;margin-left:auto">${allowed.map((c) => `<option value="${c.id}" ${c.id === SEL.c ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
  <div class="grid kpis" style="margin-bottom:14px">
    <div class="card kpi pu"><div class="l">People voted here (shared figure)</div><div class="v num" id="wVoted">—</div><div class="s" id="wVotedS"></div></div>
    <div class="card kpi p"><div class="l">🔒 Our supporters present</div><div class="v num" id="wEst">—</div><div class="s" id="wEstS"></div></div>
    <div class="card kpi p"><div class="l">🔒 Still to come (expected − present)</div><div class="v num" id="wLeft">—</div><div class="s" id="wLeftS"></div></div>
    <div class="card kpi y"><div class="l">Our reps' own turnout count</div><div class="v num" id="wObs">—</div><div class="s" id="wSt"></div></div>
    <div class="card kpi r"><div class="l">Needs attention</div><div class="v num" id="wAl">—</div></div>
  </div>
  <div class="grid split2">
    <div class="card"><h3>Polling stations <span class="sp small muted" style="text-transform:none;letter-spacing:0">Stale = nothing from our rep for 60+ minutes · tap ✎ to set our expected supporters</span></h3>
      <div class="tw"><table><thead><tr><th>Station</th><th class="r">Voted (shared)</th><th class="r">🔒 Expected</th><th class="r">🔒 Present</th><th>🔒 Of expected</th><th class="r">Our rep's count</th><th class="r">Time</th><th class="noprint">Action</th></tr></thead><tbody id="wRows"></tbody></table></div>
      <p class="small muted" style="margin-bottom:0">"Present" is what our reps recognise coming in. It is an indication, not a vote count: people can change their mind in the booth.</p></div>
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
    const withT = st.filter((s) => s.expected), exp = S("expected"), presT = withT.reduce((a, s) => a + (+s.est_supporters || 0), 0);
    $("#wVoted").textContent = fmt(S("voted")); $("#wVotedS").textContent = `${pct(S("voted"), S("electors_listed"))} of ${fmt(S("electors_listed"))} registered`;
    $("#wEst").textContent = fmt(S("est_supporters")); $("#wEstS").textContent = exp ? `${pct(presT, exp)} of the ${fmt(exp)} we expect` : "set expected supporters with ✎";
    $("#wLeft").textContent = exp ? fmt(Math.max(0, exp - presT)) : "—"; $("#wLeftS").textContent = exp ? `across ${withT.length} station(s) with a target` : "";
    $("#wObs").textContent = fmt(goodObs);
    const rep = st.filter((s) => s.latest_at), stale = rep.filter((s) => mins(s.latest_at) > 60);
    $("#wSt").textContent = `reporting ${rep.length - stale.length} · stale ${stale.length} · silent ${st.length - rep.length}`;
    $("#wAl").textContent = inc.filter((i) => i.status === "open").length;
    $("#wRows").innerHTML = st.map((s) => `<tr><td><b>${esc(s.official_code)}</b><div class="small muted">${esc(s.station_name)} · ${esc(s.district)}${s.reps ? "" : ' · <span style="color:var(--amber)">no rep assigned</span>'}</div></td>
      <td class="r num"><b>${fmt(s.voted)}</b> ${s.voted !== null ? srcPill(s.voted_source) : ""}</td>
      <td class="r num">${fmt(s.expected)} <button class="btn sm ghost noprint" data-exp="${s.station_id}" title="Set expected supporters">✎</button></td>
      <td class="r num">${fmt(s.est_supporters)}${s.est_confidence ? ` <span class="pill p-q">${esc(s.est_confidence)}</span>` : ""}</td>
      <td>${cameBar(+s.est_supporters || 0, +s.expected || 0, P.color)}</td>
      <td class="r num">${fmt(s.latest_attendance)} ${s.latest_status ? statusPill(s.latest_status) : stationPill(null)}${s.latest_status === "flagged" ? `<div class="small" style="color:var(--red)">${esc((s.latest_flags || []).join("; "))}</div>` : ""}</td>
      <td class="r num">${hhmm(s.latest_at)}</td>
      <td class="noprint">${s.latest_id && ["unverified", "flagged"].includes(s.latest_status) ? `<div class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn sm" data-rec="${s.latest_id}">Verify</button><button class="btn sm ghost" data-ask="${s.latest_id}" title="Ask the representative to correct it">Ask fix</button>${s.latest_status === "flagged" ? `<button class="btn sm warn" data-rej="${s.latest_id}">Reject</button>` : ""}</div>` : ""}</td></tr>`).join("") || '<tr><td colspan="8" class="muted">No polling stations loaded for this constituency yet (system admin imports the official list).</td></tr>';
    const act = (sel, dec, msg) => $$(sel).forEach((b) => (b.onclick = () => guard(async () => { const note = dec === "reconciled" ? null : prompt("Note for the record (optional):") || null; await API.reconcile(+b.dataset[sel.slice(6, 9)], dec, note); await load(); }, msg)));
    act("[data-rec]", "reconciled", "Marked reconciled. Recorded in the audit log.");
    act("[data-ask]", "correction_requested", "Correction requested from the representative.");
    act("[data-rej]", "rejected", "Report rejected. It no longer counts.");
    $$("[data-exp]").forEach((b) => (b.onclick = () => { const s = stRows.find((x) => x.station_id === b.dataset.exp);
      const v = prompt(`How many ${P.short_name} supporters do we expect to vote at ${s.official_code}? (a number only; leave empty to clear)`, s.expected ?? ""); if (v === null) return;
      const n = v.trim() === "" ? null : parseInt(v, 10); if (n !== null && !(n >= 0)) return toast("Enter a whole number.", true);
      guard(async () => { await API.setTarget(s.station_id, n); await load(); }, "Saved privately."); }));
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
  if (!["rating", "came", "obs"].includes(SEL.hqMode)) SEL.hqMode = "rating";
  $("#main").innerHTML = `<div class="partyhead"><b>${esc(P.name)} · Head office</b><span class="private" style="background:rgba(255,255,255,.2)">🔒 Private — other parties cannot see this page</span></div>
  <div class="grid kpis" style="margin-bottom:14px">
    <div class="card kpi pu"><div class="l">People voted (shared figure)</div><div class="v num" id="hVoted">—</div><div class="s" id="hVotedS"></div></div>
    <div class="card kpi p"><div class="l">🔒 Our supporters present</div><div class="v num" id="hEst">—</div><div class="s">reps' counts — an indication, not votes</div></div>
    <div class="card kpi p"><div class="l">🔒 Of our expected supporters</div><div class="v num" id="hCame">—</div><div class="s" id="hCameS"></div></div>
    <div class="card kpi p"><div class="l">🔒 Still to come</div><div class="v num" id="hLeft">—</div><div class="s">expected − present, where a target is set</div></div>
    <div class="card kpi r"><div class="l">Open alerts</div><div class="v num" id="hAl">—</div></div>
  </div>
  <div class="grid split">
    <div class="card"><h3>Our private map</h3>
      <div class="seg noprint" id="hMode" style="margin-bottom:10px"><button data-m="rating">Our strongholds</button><button data-m="came">% of expected who came</button><button data-m="obs">People voted</button></div>
      <div class="map" id="hMap">${mapSVG("hMap")}</div><div class="legend" id="hLeg"></div>
      <div id="rateBox"></div></div>
    <div class="grid" style="align-content:start">
      <div class="card" style="border-top:4px solid var(--party)"><h3>🔒 Weak areas · where to send help <span class="sp small muted" style="text-transform:none;letter-spacing:0">lowest share of expected supporters so far</span></h3><div id="weak"></div></div>
      <div class="card"><h3>By constituency <span class="sp noprint"><button class="btn sm ghost" id="hCsv">⬇ CSV (private)</button></span></h3>
        <div class="tw" style="max-height:470px"><table><thead><tr><th>Constituency</th><th>Our view</th><th class="r">Voted</th><th class="r">🔒 Expected</th><th class="r">🔒 Present</th><th>🔒 Of expected</th><th class="r">Alerts</th></tr></thead><tbody id="hRows"></tbody></table></div></div>
      <div class="card"><h3>Internal notes</h3><div class="row noprint"><input class="inp" id="noteIn" style="flex:1" maxlength="2000" placeholder="Add a note for your team"><button class="btn sm" id="noteBtn">Add</button></div><div class="feed" id="notes" style="margin-top:8px"></div></div>
    </div></div>`;
  let rows = [], ratings = {};
  $$("#hMode button").forEach((b) => { b.classList.toggle("on", b.dataset.m === SEL.hqMode); b.onclick = () => { SEL.hqMode = b.dataset.m; $$("#hMode button").forEach((x) => x.classList.toggle("on", x === b)); paint(); }; });
  const ratingFill = (r) => { const w = (RATINGS.find((x) => x[0] === r) || [])[2]; if (w === null || w === undefined) return "#E5E7E4"; return w > 0 ? hexMix(P.color, 0.35 + 0.65 * w) : w === 0 ? "#F3E7A6" : `rgb(${Math.round(200 + 35 * w)},${Math.round(200 + 35 * w)},${Math.round(200 + 35 * w)})`; };
  function paint() {
    const data = {};
    rows.forEach((r) => {
      const c = CONSTS.find((x) => x.id === r.constituency_id); if (!c) return;
      if (SEL.hqMode === "rating") { const rt = r.rating || "unrated", w = (RATINGS.find((x) => x[0] === rt) || [])[2]; data[c.code] = { fill: ratingFill(rt), dark: !(w > 0.5) && w !== -1, label: { stronghold: "★", leaning: "↗", competitive: "≈", opponent_leaning: "↘", opponent_stronghold: "✕" }[rt] || "", value: +r.voted }; }
      else if (SEL.hqMode === "came") { const f = r.expected ? r.est_supporters / r.expected : 0; data[c.code] = { fill: r.expected ? hexMix(P.color, 0.12 + 0.88 * Math.min(1, f)) : "#E5E7E4", dark: f < 0.45, label: r.expected ? Math.round(f * 100) + "%" : "—", value: +r.est_supporters }; }
      else { const max = Math.max(100, ...rows.map((x) => +x.voted)), f = r.voted / max; data[c.code] = { fill: ramp(f), dark: f < 0.45, label: fmt(r.voted), value: +r.voted }; }
    });
    paintMap("hMap", data, SEL.rateC ? CONSTS.find((c) => c.id === SEL.rateC)?.code : null);
    $("#hLeg").innerHTML = SEL.hqMode === "rating" ? RATINGS.map(([k, l]) => `<span class="lg"><i style="background:${ratingFill(k)}"></i>${l}</span>`).join("") + '<span class="small">· tap a constituency to change it</span>'
      : SEL.hqMode === "came" ? `<span>0% (weak)</span><span class="ramp" style="background:linear-gradient(90deg,${hexMix(P.color, 0.12)},${P.color})"></span><span>100% of expected came</span><span class="small">· grey = no target set</span>` : `<span>0</span><span class="ramp"></span><span>most voted</span>`;
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
  bindMap("hMap", (code) => { const c = cByCode(code), r = rows.find((x) => x.constituency_id === c.id) || {}; return `<b>${esc(c.name)}</b>Our view: ${(RATINGS.find((x) => x[0] === (r.rating || "unrated")) || [])[1]}<br>People voted: ${fmt(r.voted)} (${pct(r.voted, r.electors_listed)})<br>🔒 Supporters present: ${fmt(r.est_supporters)} of ${fmt(r.expected)} expected`; },
    (code) => { const c = cByCode(code); if (SEL.hqMode === "rating") { SEL.rateC = c.id; rateBox(); paint(); } else { SEL.c = c.id; go("watch"); } });
  $("#noteBtn").onclick = () => guard(async () => { const v = $("#noteIn").value.trim(); if (!v) return; await API.addNote(v); $("#noteIn").value = ""; loadNotes(); }, "Note saved privately.");
  $("#hCsv").onclick = () => csv(`PRIVATE-${P.short_name}-head-office.csv`, [["PRIVATE — " + P.name + " internal figures, not votes and not official results"], ["constituency", "our_view", "people_voted", "registered", "expected_supporters", "supporters_present", "share_of_expected", "our_reps_turnout", "open_alerts"],
    ...rows.map((r) => [cName(r.constituency_id), r.rating || "", r.voted, r.electors_listed, r.expected, r.est_supporters, r.expected ? (r.est_supporters / r.expected).toFixed(3) : "", r.observed, r.open_alerts])]);
  async function loadNotes() { const n = await API.notes(); $("#notes").innerHTML = n.map((x) => `<div class="it"><span class="t">${hhmm(x.created_at)}</span><div>${esc(x.body)}<div class="small muted">${esc(x.profiles?.full_name || "")}</div></div></div>`).join("") || '<p class="muted small">No notes yet.</p>'; }
  async function load() {
    const [s, rt, st] = await Promise.all([API.partySummary(), API.ratings(), API.partyStations(null)]); rows = s; ratings = Object.fromEntries(rt.map((r) => [r.constituency_id, r]));
    const T = (k) => rows.reduce((a, r) => a + +r[k], 0), withT = st.filter((x) => x.expected), presT = withT.reduce((a, x) => a + (+x.est_supporters || 0), 0), expT = withT.reduce((a, x) => a + +x.expected, 0);
    $("#hVoted").textContent = fmt(T("voted")); $("#hVotedS").textContent = `${pct(T("voted"), T("electors_listed"))} of ${fmt(T("electors_listed"))} registered`;
    $("#hEst").textContent = fmt(T("est_supporters")); $("#hCame").textContent = expT ? pct(presT, expT) : "—"; $("#hCameS").textContent = expT ? `${fmt(presT)} of ${fmt(expT)} expected` : "no targets set yet";
    $("#hLeft").textContent = expT ? fmt(Math.max(0, expT - presT)) : "—"; $("#hAl").textContent = T("open_alerts");
    $("#hRows").innerHTML = rows.slice().sort((a, b) => cName(a.constituency_id).localeCompare(cName(b.constituency_id))).map((r) => `<tr class="click" data-id="${r.constituency_id}"><td><b>${esc(cName(r.constituency_id))}</b></td>
      <td><span class="lg"><i style="background:${ratingFill(r.rating || "unrated")}"></i>${(RATINGS.find((x) => x[0] === (r.rating || "unrated")) || [])[1]}</span></td>
      <td class="r num">${fmt(r.voted)}</td><td class="r num">${fmt(r.expected || null)}</td><td class="r num">${fmt(r.est_supporters)}</td><td>${cameBar(+r.est_supporters, +r.expected, P.color)}</td><td class="r">${r.open_alerts ? `<span class="pill p-flag">${r.open_alerts}</span>` : "—"}</td></tr>`).join("");
    $$("#hRows tr").forEach((tr) => (tr.onclick = () => { SEL.c = +tr.dataset.id; go("watch"); }));
    const silent = withT.filter((x) => x.est_supporters === null), weak = withT.filter((x) => x.est_supporters !== null).map((x) => ({ ...x, f: x.est_supporters / x.expected })).sort((a, b) => a.f - b.f).slice(0, 10);
    $("#weak").innerHTML = weak.length ? `<div class="tw"><table><thead><tr><th>Station</th><th class="r">Expected</th><th class="r">Present</th><th class="r">Still to come</th><th>Of expected</th></tr></thead><tbody>${weak.map((x) => `<tr class="click" data-c="${x.constituency_id}"><td><b>${esc(x.official_code)}</b><div class="small muted">${esc(cName(x.constituency_id))} · ${esc(x.station_name)}</div></td><td class="r num">${fmt(x.expected)}</td><td class="r num">${fmt(x.est_supporters)}</td><td class="r num"><b>${fmt(Math.max(0, x.expected - (+x.est_supporters || 0)))}</b></td><td>${cameBar(+x.est_supporters || 0, +x.expected, P.color)}</td></tr>`).join("")}</tbody></table></div>
      <p class="small muted" style="margin-bottom:0">Only stations where we set an expected number and our person has sent a count. An indication, not a prediction: people can change their mind in the booth.</p>`
      : '<p class="muted small">Set expected supporters per station in the watch rooms (✎) to see where turnout of our supporters is lowest.</p>';
    if (silent.length) $("#weak").insertAdjacentHTML("beforeend", `<p class="small" style="color:var(--amber);margin-bottom:0">⚠ ${silent.length} station(s) with a target have sent no supporter count yet: ${silent.slice(0, 8).map((x) => esc(x.official_code)).join(", ")}${silent.length > 8 ? "…" : ""}</p>`);
    $$("#weak tr[data-c]").forEach((tr) => (tr.onclick = () => { SEL.c = +tr.dataset.c; go("watch"); }));
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
        <p class="small" style="margin-top:0"><b>1.</b> Choose what they do and where. <b>2.</b> Press Create invite. <b>3.</b> Send it by WhatsApp. They tap the link, make a password, and they're in. One invite per person.</p>
        <label class="f">Role</label><select class="inp" id="iRole"><option value="rep">Station representative (one polling station)</option><option value="watch">Constituency head / watch room (one constituency)</option><option value="hq">Party leader (everything for ${esc(P.short_name)} + the National Watch)</option><option value="party_admin">Party administrator (invites the team; no National Watch)</option></select>
        <div id="iWhere"><label class="f">Constituency</label><select class="inp" id="iC">${CONSTS.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
          <div id="iStWrap"><label class="f">Polling station</label><select class="inp" id="iS"></select></div></div>
        <div id="iJobWrap"><label class="f">Their job at the station</label><select class="inp" id="iJob"><option value="inside">Inside the station: live count of everyone voting (+1 each voter)</option><option value="outside">Outside the station: our supporters they recognise (+1 each supporter)</option><option value="both">Both jobs (one person)</option></select></div>
        <label class="f">Person's name (for your records)</label><input class="inp" id="iLabel" maxlength="80">
        <button class="btn" style="margin-top:12px" id="iGo">Create invite</button><div id="iOut" style="margin-top:12px"></div></div>
      <div class="card"><h3>Sharing with the National Watch</h3>
        <label class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)"><span>Our reps' <b>turnout totals</b> → National Watch <span class="small muted">(shown beside the neutral counter's figure; used only where no counter reports)</span></span><input type="checkbox" id="shC" ${P.share_counts ? "checked" : ""}></label>
        <label class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)"><span>Count of our <b>open incidents</b> → National Watch</span><input type="checkbox" id="shI" ${P.share_incidents ? "checked" : ""}></label>
        ${["Supporters present", "Expected supporters", "Stronghold map", "Internal notes", "Team list"].map((x) => `<div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)"><span>${x}</span><span class="pill p-none">NEVER SHARED</span></div>`).join("")}
        <p class="small muted" style="margin-bottom:0">Changes take effect immediately and are recorded in the audit log.</p></div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="card"><h3>Invites</h3><div class="tw" style="max-height:300px"><table><thead><tr><th>Code</th><th>For</th><th>Role · where</th><th>Status</th><th></th></tr></thead><tbody id="invRows"></tbody></table></div></div>
      <div class="card"><h3>Team members</h3><div class="tw" style="max-height:340px"><table><thead><tr><th>Name</th><th>Role</th><th>Assigned to</th><th>Device &amp; sign-ins</th><th>Access</th></tr></thead><tbody id="memRows"></tbody></table></div></div>
      <div class="card"><h3>Audit log (${esc(P.short_name)})</h3><div class="feed" id="audit"></div></div>
    </div></div>`;
  let stations = [];
  const fillSt = async () => { stations = await API.stations(+$("#iC").value); $("#iS").innerHTML = stations.map((s) => `<option value="${s.id}">${esc(s.official_code)} — ${esc(s.name)}</option>`).join("") || noStations(false); };
  const where = () => { const r = $("#iRole").value; $("#iWhere").classList.toggle("hide", !["rep", "watch"].includes(r)); $("#iStWrap").classList.toggle("hide", r !== "rep"); $("#iJobWrap").classList.toggle("hide", r !== "rep"); };
  $("#iRole").onchange = where; $("#iC").onchange = fillSt; where(); fillSt();
  $("#iGo").onclick = () => guard(async () => {
    const role = $("#iRole").value, name = $("#iLabel").value.trim(), job = role === "rep" ? $("#iJob").value : null;
    if (role === "rep" && !$("#iS").value) throw new Error("There are no polling stations to choose from yet.");
    const label = job ? `${name || "Rep"} (${JOBS[job].short})` : name;
    const code = await API.createInvite({ role, station: role === "rep" ? $("#iS").value || null : null, constituency: role === "watch" ? +$("#iC").value : null, label });
    const link = `${location.origin}${location.pathname}#invite=${code}${job ? "&job=" + job : ""}`;
    const what = `${ROLE[role]} for ${P.name}${role === "rep" ? " at " + ($("#iS").selectedOptions[0]?.textContent || "") : role === "watch" ? " (" + cName(+$("#iC").value) + ")" : ""}${job ? ` — ${JOBS[job].long}` : ""}`;
    inviteSent($("#iOut"), { code, msg: inviteMsg(name, what, link), who: name || ROLE[role] });
    $("#iLabel").value = ""; loadLists();
  });
  const saveShare = () => guard(async () => { await API.setSharing($("#shC").checked, $("#shI").checked); ME.party.share_counts = $("#shC").checked; ME.party.share_incidents = $("#shI").checked; }, "Sharing updated.");
  $("#shC").onchange = saveShare; $("#shI").onchange = saveShare;
  const allSt = await API.stations(); const stName = (id) => (allSt.find((s) => s.id === id) || {}).official_code || "";
  const asg = (a) => a.map((x) => (x.station_id ? stName(x.station_id) : cName(x.constituency_id))).join(", ") || "—";
  async function loadLists() {
    const [inv, mem, aud, DV] = await Promise.all([API.invites(), API.members(), API.audit(), API.memberDevices().catch(() => ({}))]);
    $("#invRows").innerHTML = inv.map((i) => { const st = i.used_by ? '<span class="pill p-ok">USED</span>' : i.revoked ? '<span class="pill p-none">REVOKED</span>' : new Date(i.expires_at) < new Date() ? '<span class="pill p-none">EXPIRED</span>' : '<span class="pill p-unv">OPEN</span>';
      return `<tr><td class="num"><code>${esc(i.code)}</code></td><td>${esc(i.label || "")}</td><td class="small">${ROLE[i.role]}${i.station_id ? " · " + esc(stName(i.station_id)) : i.constituency_id ? " · " + esc(cName(i.constituency_id)) : ""}</td><td>${st}</td><td>${!i.used_by && !i.revoked ? `<button class="btn sm warn" data-rev="${esc(i.code)}">Cancel invite</button>` : ""}</td></tr>`; }).join("") || '<tr><td colspan="5" class="muted">No invites yet.</td></tr>';
    $$("[data-rev]").forEach((b) => (b.onclick = () => guard(async () => { await API.revokeInvite(b.dataset.rev); loadLists(); }, "Invite cancelled. The link no longer works.")));
    $("#memRows").innerHTML = mem.map((m) => `<tr><td><b>${esc(m.full_name)}</b>${m.id === ME.id ? ' <span class="pill p-q">YOU</span>' : ""}</td><td class="small">${ROLE[m.role]}</td><td class="small">${esc(asg(m.assignments || []))}</td>
      <td>${devCell(m.id, DV)}<div>${devBtns(m.id)}</div></td><td>${m.id === ME.id ? "" : `<button class="btn sm ${m.active ? "warn" : ""}" data-act="${m.id}" data-on="${m.active ? 0 : 1}">${m.active ? "Remove access" : "Restore"}</button>`}</td></tr>`).join("");
    $$("[data-act]").forEach((b) => (b.onclick = () => { if (b.dataset.on === "0" && !confirm("Remove this person's access now?")) return; guard(async () => { await API.setMemberActive(b.dataset.act, b.dataset.on === "1"); loadLists(); }, "Access updated."); }));
    wireDev($("#memRows"), loadLists);
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
      <div class="card"><h3>Invite a party administrator</h3>
        <p class="small" style="margin-top:0">You invite <b>one administrator per party</b>. They then invite their own people (head office, watch rooms, station reps) from their own screen. You never see their team.</p>
        <label class="f">Party</label><select class="inp" id="aParty"></select><label class="f">Person's name (optional)</label><input class="inp" id="aLabel" placeholder="e.g. John" maxlength="80">
        <button class="btn" style="margin-top:10px" id="aGo">Create invite</button>
        <button class="btn sm ghost" id="sysInv">Invite a second system administrator (needed to approve station imports)</button><div id="aOut" style="margin-top:10px"></div></div>
      <div class="card"><h3>Invites &amp; administrators</h3><p class="small muted" style="margin-top:0">Made a mistake? <b>Cancel invite</b> stops a link that hasn't been used. <b>Remove access</b> locks out someone who already joined.</p><div class="tw" style="max-height:320px"><table><tbody id="admInv"></tbody></table></div></div>
      <div class="card"><h3>Practice stations</h3><p class="small" style="margin-top:0">Until the Electoral Office's official list is loaded there are no polling stations, so nobody can be invited to a station. Load <b>practice stations</b> (2 per constituency, named "Practice station … (not real)") to try everything and rehearse. It also adds a <b>practice candidate for every party</b> in each constituency (plus a practice independent in three), so you can rehearse count night and watch the map change colour. <b>Add the parties first.</b> Remove all of it before the real list and real candidates go in.</p>
        <div class="row"><button class="btn" id="prLoad">Load practice stations</button><button class="btn ghost warn" id="prClear">Remove practice stations</button></div></div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="card"><h3>Official polling station list</h3>
        <p class="small" style="margin-top:0">Upload the Electoral Office's list as a CSV with columns <code>constituency, polling_district, station_code, station_name, electors_listed</code> (optional: <code>district_code</code>). A <b>different</b> system administrator must approve it before it goes live.</p>
        <div class="row"><input type="file" id="csvFile" accept=".csv,text/csv"><button class="btn sm ghost" id="tmpl">Download template</button></div><div id="csvOut" class="small" style="margin-top:8px"></div>
        <h3 style="margin-top:14px">Uploads</h3><div class="tw" style="max-height:220px"><table><thead><tr><th>When</th><th class="r">Rows</th><th>Checks</th><th>Status</th><th></th></tr></thead><tbody id="batches"></tbody></table></div></div>
      <div class="card"><h3>Stations loaded per constituency</h3><div class="tw" style="max-height:330px"><table><thead><tr><th>Constituency</th><th class="r">Stations</th><th class="r">Electors listed</th></tr></thead><tbody id="stCounts"></tbody></table></div></div>
      <div class="card"><h3>System audit log</h3><div class="feed" id="sAudit"></div></div>
    </div></div>`;
  const invOut = (code, who, what) => { const link = `${location.origin}${location.pathname}#invite=${code}`; inviteSent($("#aOut"), { code, msg: inviteMsg(who, what, link), who: who || "them" }); };
  $("#pPreset").onchange = (e) => { const p = PARTY_PRESETS[e.target.value]; if (!p) return; $("#pName").value = p[0]; $("#pShort").value = p[1]; $("#pColor").value = p[2]; };
  $("#pGo").onclick = () => guard(async () => { const n = $("#pName").value.trim(), s = $("#pShort").value.trim(); if (!n || !s) throw new Error("Name and short name are required."); await API.createParty(n, s, $("#pColor").value); $("#pName").value = $("#pShort").value = ""; load(); }, "Party added.");
  $("#aGo").onclick = () => guard(async () => { if (!$("#aParty").value) throw new Error("Add the party first (box above)."); const who = $("#aLabel").value.trim(), pn = $("#aParty").selectedOptions[0].textContent;
    const code = await API.createInvite({ role: "party_admin", party: $("#aParty").value, label: who }); invOut(code, who ? `${who} (${pn})` : pn, `the Party administrator for ${pn}`); $("#aLabel").value = ""; load(); });
  $("#sysInv").onclick = () => guard(async () => { const code = await API.createInvite({ role: "sys_admin", label: "System administrator" }); invOut(code, "", "a System administrator"); load(); });
  $("#prLoad").onclick = () => guard(async () => { const n = await API.loadPracticeStations(); load(); toast(`${n} practice stations and practice candidates ready (all marked "not real").`); });
  $("#prClear").onclick = () => confirm("Remove all practice stations and practice candidates? Invites to them are cancelled and people assigned to them lose that station. Accounts stay.") && guard(async () => { await API.clearPracticeStations(); load(); }, "Practice stations and candidates removed.");
  $("#tmpl").onclick = () => csv("polling-stations-template.csv", [["constituency", "polling_district", "district_code", "station_code", "station_name", "electors_listed"], ["Roseau North", "Example district", "", "EXAMPLE-01", "Example station name", "500"]]);
  $("#csvFile").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return; const rows = parseCSV(await f.text());
    if (!rows.length) return ($("#csvOut").textContent = "No rows found.");
    const need = ["constituency", "polling_district", "station_code", "station_name"], miss = need.filter((n) => !(n in rows[0]));
    if (miss.length) return ($("#csvOut").innerHTML = `<span class="pill p-flag">REJECTED</span> Missing column(s): ${miss.join(", ")}`);
    guard(async () => { const r = await API.uploadImport(rows); $("#csvOut").innerHTML = `<span class="pill ${r.errors.length ? "p-flag" : "p-ok"}">${r.errors.length ? r.errors.length + " PROBLEM(S)" : "CHECKS PASSED"}</span> ${rows.length} rows uploaded. ${r.errors.length ? "Fix and upload again:" : "Ask the second administrator to approve."}<ul>${r.errors.slice(0, 15).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`; load(); });
  };
  async function load() {
    const [ps, inv, bs, st, mem, aud, DV] = await Promise.all([API.parties(), API.invites(), API.imports(), API.stations(), API.members(), API.audit(), API.memberDevices().catch(() => ({}))]);
    $("#parties").innerHTML = ps.map((p) => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><span style="width:14px;height:14px;border-radius:50%;background:${esc(p.color)}"></span><b>${esc(p.name)}</b><span class="muted">${esc(p.short_name)}</span><span class="small muted" style="margin-left:auto">${p.share_counts ? "shares turnout" : "turnout private"}</span></div>`).join("") || '<p class="muted small">No parties yet.</p>';
    const keepP = $("#aParty").value; // never reset the person's choice while the list refreshes
    $("#aParty").innerHTML = ps.map((p) => `<option value="${p.id}" ${p.id === keepP ? "selected" : ""}>${esc(p.name)}</option>`).join("") || '<option value="">Add a party first (box above)</option>';
    const pShort = (id) => (ps.find((p) => p.id === id) || {}).short_name || "";
    $("#admInv").innerHTML = mem.filter((m) => m.role !== "counter").map((m) => `<tr><td><b>${esc(m.full_name)}</b>${m.id === ME.id ? ' <span class="pill p-q">YOU</span>' : ""}</td><td class="small">${ROLE[m.role]} ${m.party_id ? "· " + esc(pShort(m.party_id)) : ""}</td><td>${m.active ? '<span class="pill p-ok">ACTIVE</span>' : '<span class="pill p-none">REMOVED</span>'}<div>${devCell(m.id, DV)}</div><div>${devBtns(m.id)}</div></td>
      <td>${m.id === ME.id || !["party_admin", "sys_admin"].includes(m.role) ? "" : `<button class="btn sm ${m.active ? "warn" : ""}" data-act="${m.id}" data-on="${m.active ? 0 : 1}">${m.active ? "Remove access" : "Restore"}</button>`}</td></tr>`).join("") +
      inv.filter((i) => !i.used_by && !i.revoked && i.role !== "counter" && new Date(i.expires_at) > new Date()).map((i) => `<tr><td>${esc(i.label || "(no name)")} <span class="small muted">${esc(i.code)}</span></td><td class="small">${ROLE[i.role]}${i.party_id ? " · " + esc(pShort(i.party_id)) : ""}</td><td><span class="pill p-unv">NOT USED YET</span></td>
      <td><button class="btn sm warn" data-rev="${esc(i.code)}">Cancel invite</button></td></tr>`).join("") || '<tr><td class="muted">No invites yet.</td></tr>';
    $$("#admInv [data-rev]").forEach((b) => (b.onclick = () => guard(async () => { await API.revokeInvite(b.dataset.rev); load(); }, "Invite cancelled. The link no longer works.")));
    $$("#admInv [data-act]").forEach((b) => (b.onclick = () => { if (b.dataset.on === "0" && !confirm("Remove this person's access now?")) return; guard(async () => { await API.setMemberActive(b.dataset.act, b.dataset.on === "1"); load(); }, "Access updated."); }));
    wireDev($("#admInv"), load);
    $("#batches").innerHTML = bs.map((b) => `<tr><td class="small">${new Date(b.uploaded_at).toLocaleString()}</td><td class="r">${b.row_count}</td><td>${b.errors.length ? `<span class="pill p-flag">${b.errors.length} problems</span>` : '<span class="pill p-ok">OK</span>'}</td><td>${b.status.toUpperCase()}</td>
      <td>${b.status === "pending" ? `${!b.errors.length && b.uploaded_by !== ME.id ? `<button class="btn sm" data-ap="${b.id}">Approve</button>` : b.uploaded_by === ME.id ? '<span class="small muted">needs 2nd admin</span>' : ""} <button class="btn sm ghost" data-rj="${b.id}">Reject</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">No uploads yet.</td></tr>';
    $$("[data-ap]").forEach((b) => (b.onclick = () => confirm("Load these stations into the live system?") && guard(async () => { await API.decideImport(b.dataset.ap, true); load(); }, "Stations loaded.")));
    $$("[data-rj]").forEach((b) => (b.onclick = () => guard(async () => { await API.decideImport(b.dataset.rj, false); load(); }, "Upload rejected.")));
    $("#stCounts").innerHTML = CONSTS.map((c) => { const xs = st.filter((s) => s.constituency_id === c.id); return `<tr><td>${esc(c.name)}</td><td class="r">${xs.length || '<span class="pill p-flag">0</span>'}</td><td class="r num">${fmt(xs.reduce((a, s) => a + (s.electors_listed || 0), 0))}</td></tr>`; }).join("");
    $("#sAudit").innerHTML = aud.map((a) => `<div class="it"><span class="t">${hhmm(a.at)}</span><div><b>${esc(a.action.replace(/_/g, " "))}</b> <span class="muted small">${esc(a.entity || "")} ${esc(a.entity_id || "")}</span></div></div>`).join("") || '<p class="muted small">Nothing yet.</p>';
  }
  REFRESH = null; await guard(load);
}
// ------------------------------------------------------------------ SYSTEM ADMIN: neutral counters, candidates, official figures
async function viewCount() {
  $("#main").innerHTML = `<div class="row" style="margin-bottom:12px"><b style="font-size:16px">Counters &amp; results</b><span class="muted small">Neutral station counters, candidates, and official figures from the Electoral Office. You cannot see any party's private data.</span></div>
  <div class="grid two">
    <div class="grid" style="align-content:start">
      <div class="card"><h3>Invite a neutral station counter</h3>
        <div class="explain"><b>What is a counter?</b> One trusted person inside each polling station who belongs to <b>no party</b>, ideally the presiding officer or poll clerk. Each time a voter is ticked off in the poll book they tap <b>+1</b> on their phone. That number is the true turnout every party sees on the National Watch.<br><span class="muted">No counters? That's fine: the National Watch then uses the parties' own agents' counts.</span></div>
        <label class="f">Constituency</label><select class="inp" id="kC">${CONSTS.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
        <label class="f">Polling station</label><select class="inp" id="kS"></select>
        <label class="f">Person's name (for your records)</label><input class="inp" id="kLabel" maxlength="80">
        <button class="btn" style="margin-top:12px" id="kGo">Create counter invite</button><div id="kOut" style="margin-top:12px"></div></div>
      <div class="card"><h3>Counters</h3><div class="tw" style="max-height:320px"><table><thead><tr><th>Name</th><th>Station</th><th>Status</th><th></th></tr></thead><tbody id="kRows"></tbody></table></div></div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="card"><h3>Candidates</h3>
        <p class="small muted" style="margin-top:0">Enter each constituency's candidates after Nomination Day, from the official list. They appear in the counters' results form and on the results map.</p>
        <label class="f">Constituency</label><select class="inp" id="dC">${CONSTS.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
        <div id="dList" style="margin-top:8px"></div>
        <div class="grid" style="grid-template-columns:2fr 1.4fr;gap:6px;margin-top:10px"><div><label class="f">Candidate's name</label><input class="inp" id="dName" maxlength="120"></div>
          <div><label class="f">Party</label><select class="inp" id="dParty"></select></div></div>
        <div class="grid" style="grid-template-columns:2fr auto auto;gap:6px;align-items:end" id="dIndWrap"><div><label class="f">Label (e.g. Independent)</label><input class="inp" id="dLabel" value="Independent" maxlength="40"></div><div><label class="f">Colour</label><input type="color" id="dColor" value="#8C8C8C" style="height:38px;width:50px;border:0"></div><div></div></div>
        <button class="btn" style="margin-top:10px" id="dGo">Add candidate</button></div>
      <div class="card"><h3>Official figures (Electoral Office)</h3>
        <p class="small muted" style="margin-top:0">When the official poll-book turnout or the official station count is announced, enter it here. It replaces the counter's figure on the National Watch and is marked OFFICIAL.</p>
        <label class="f">Constituency</label><select class="inp" id="oC">${CONSTS.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
        <label class="f">Polling station</label><select class="inp" id="oS"></select>
        <div class="seg" id="oMode" style="margin-top:10px"><button data-m="turnout" class="on">Official turnout</button><button data-m="results">Official station count</button></div>
        <div id="oBody" style="margin-top:10px"></div></div>
    </div></div>`;
  const parties = await API.parties();
  $("#dParty").innerHTML = parties.map((p) => `<option value="${p.id}">${esc(p.short_name)} — ${esc(p.name)}</option>`).join("") + '<option value="">Independent / not on the platform</option>';
  const indToggle = () => $("#dIndWrap").classList.toggle("hide", $("#dParty").value !== ""); $("#dParty").onchange = indToggle; indToggle();
  let kStations = [], oStations = [], oMode = "turnout";
  const fillSeq = {}; // only the latest request for each list may draw it (a slow early answer must not overwrite a newer choice)
  const fill = async (sel, cid) => { const my = (fillSeq[sel] = (fillSeq[sel] || 0) + 1); const xs = await API.stations(cid); if (my !== fillSeq[sel]) return sel === "#kS" ? kStations : oStations; $(sel).innerHTML = xs.map((s) => `<option value="${s.id}">${esc(s.official_code)} — ${esc(s.name)}</option>`).join("") || noStations(true); return xs; };
  $("#kC").onchange = async () => (kStations = await fill("#kS", +$("#kC").value));
  $("#oC").onchange = async () => { oStations = await fill("#oS", +$("#oC").value); oBody(); };
  $("#oS").onchange = () => oBody();
  $$("#oMode button").forEach((b) => (b.onclick = () => { oMode = b.dataset.m; $$("#oMode button").forEach((x) => x.classList.toggle("on", x === b)); oBody(); }));
  { const k = await fill("#kS", +$("#kC").value), o = await fill("#oS", +$("#oC").value); kStations = k; oStations = o; }
  $("#kGo").onclick = () => guard(async () => {
    const sid = $("#kS").value; if (!sid) throw new Error("There are no polling stations yet. Load practice stations on the System admin tab first."); const st = kStations.find((x) => x.id === sid), label = $("#kLabel").value.trim();
    const code = await API.createInvite({ role: "counter", station: sid, label: label || "Counter " + st.official_code });
    const link = `${location.origin}${location.pathname}#invite=${code}`;
    inviteSent($("#kOut"), { code, msg: inviteMsg(label, `the neutral station counter at ${st.official_code} (${st.name}). You belong to no party: you tap +1 each time a voter is ticked off`, link), who: label || "the counter" });
    $("#kLabel").value = ""; loadCounters();
  });
  async function loadCounters() {
    const [mem, inv, all, DV] = await Promise.all([API.members(), API.invites(), API.stations(), API.memberDevices().catch(() => ({}))]); const stName = (id) => (all.find((s) => s.id === id) || {}).official_code || "—";
    $("#kRows").innerHTML = mem.filter((m) => m.role === "counter").map((m) => `<tr><td><b>${esc(m.full_name)}</b></td><td class="small">${esc((m.assignments || []).map((a) => stName(a.station_id)).join(", "))}</td><td>${m.active ? '<span class="pill p-ok">ACTIVE</span>' : '<span class="pill p-none">REMOVED</span>'}<div>${devCell(m.id, DV)}</div><div>${devBtns(m.id)}</div></td>
      <td><button class="btn sm ${m.active ? "warn" : ""}" data-act="${m.id}" data-on="${m.active ? 0 : 1}">${m.active ? "Remove access" : "Restore"}</button></td></tr>`).join("") +
      inv.filter((i) => i.role === "counter" && !i.used_by && !i.revoked).map((i) => `<tr><td><code>${esc(i.code)}</code> ${esc(i.label || "")}</td><td class="small">${esc(stName(i.station_id))}</td><td><span class="pill p-unv">NOT USED YET</span></td><td><button class="btn sm warn" data-rev="${esc(i.code)}">Cancel invite</button></td></tr>`).join("") || '<tr><td colspan="4" class="muted">No counters yet.</td></tr>';
    $$("#kRows [data-act]").forEach((b) => (b.onclick = () => { if (b.dataset.on === "0" && !confirm("Remove this counter's access now?")) return; guard(async () => { await API.setMemberActive(b.dataset.act, b.dataset.on === "1"); loadCounters(); }, "Access updated."); }));
    $$("#kRows [data-rev]").forEach((b) => (b.onclick = () => guard(async () => { await API.revokeInvite(b.dataset.rev); loadCounters(); }, "Invite cancelled. The link no longer works.")));
    wireDev($("#kRows"), loadCounters);
  }
  async function loadCands() {
    const cs = await API.candidates(+$("#dC").value, true);
    $("#dList").innerHTML = cs.map((c) => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)${c.active ? "" : ";opacity:.5"}"><span style="width:14px;height:14px;border-radius:50%;background:${esc(c.color)}"></span><b>${esc(c.name)}</b><span class="muted">${esc(c.party)}</span>
      <button class="btn sm ${c.active ? "warn" : "ghost"}" style="margin-left:auto" data-cand="${c.id}" data-on="${c.active ? 0 : 1}">${c.active ? "Remove" : "Restore"}</button></div>`).join("") || '<p class="muted small">No candidates entered for this constituency yet.</p>';
    $$("[data-cand]").forEach((b) => (b.onclick = () => guard(async () => { await API.setCandidateActive(b.dataset.cand, b.dataset.on === "1"); loadCands(); }, "Candidate list updated.")));
  }
  $("#dC").onchange = loadCands;
  $("#dGo").onclick = () => guard(async () => {
    const name = $("#dName").value.trim(), party = $("#dParty").value || null; if (name.length < 2) throw new Error("Type the candidate's name.");
    await API.addCandidate({ constituency: +$("#dC").value, name, party, label: party ? null : $("#dLabel").value.trim() || "Independent", color: party ? null : $("#dColor").value });
    $("#dName").value = ""; loadCands();
  }, "Candidate added.");
  async function oBody() {
    const el = $("#oBody"), sid = $("#oS").value, st = oStations.find((x) => x.id === sid);
    if (!st) { el.innerHTML = '<p class="muted small">No polling stations yet. Load practice stations on the System admin tab to try this.</p>'; return; }
    const mine = await API.myCounts(st.id), offC = mine.counts.find((c) => c.source === "official" && !c.superseded), offR = mine.results.find((r) => r.source === "official" && !r.superseded);
    if (oMode === "turnout") {
      el.innerHTML = `${offC ? `<div class="receipt">Official turnout already entered: <b class="num">${fmt(offC.voted)}</b> at ${hhmm(offC.received_at)}. Entering a new figure replaces it (the old one stays on record).</div>` : ""}
        <label class="f">Official number who voted at ${esc(st.official_code)} (poll book)</label><input class="inp bigin num" id="oV" type="number" inputmode="numeric" min="0">
        <button class="btn big dark" style="margin-top:12px" id="oGo">Save official turnout</button>`;
      $("#oGo").onclick = () => guard(async () => { const v = parseInt($("#oV").value, 10); if (!(v >= 0)) throw new Error("Enter a whole number.");
        if (!confirm(`Save ${v} as the OFFICIAL turnout for ${st.official_code}?`)) return; await API.submitCount({ station: st.id, key: newKey(), voted: v, note: "official poll book" }); oBody(); }, "Official turnout saved.");
    } else {
      const ns = await API.nationalStations(st.constituency_id), voted = ns.find((n) => n.station_id === st.id)?.voted;
      await resultsForm(el, st, { previous: offR, voted, official: true, onSent: () => setTimeout(oBody, 1500) });
    }
  }
  oBody(); loadCands(); REFRESH = null; await guard(loadCounters);
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


// ------------------------------------------------------------------ station opening & closing (rep and neutral counter)
// One tap records the time. "Different time?" lets them enter the real time if they tap late. Saved on the phone with no signal.
function openClose(el, st) {
  const key = (k) => `vw_oc_${k}_${st.id}`;
  const get = (k) => { try { return JSON.parse(localStorage.getItem(key(k)) || "null"); } catch { return null; } };
  const draw = () => { const o = get("opened"), c = get("closed");
    el.innerHTML = `<div class="oc"><button class="ocb ${o ? "done" : ""}" data-k="opened">${o ? "✅ Opened " + hhmm(o.at) : "🟢 Station has opened"}<small>${o ? (o.queued ? "saved, sending when there is signal" : "sent · tap to correct") : "tap the moment voting starts"}</small></button>
      <button class="ocb ${c ? "done cl" : ""}" data-k="closed">${c ? "🔒 Closed " + hhmm(c.at) : "🔴 Station has closed"}<small>${c ? (c.queued ? "saved, sending when there is signal" : "sent · tap to correct") : "tap when the doors close"}</small></button></div>`;
    $$(".ocb", el).forEach((b) => (b.onclick = () => ask(b.dataset.k))); };
  const ask = (k) => {
    const now = API.now(), hh = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    el.innerHTML = `<div class="card" style="margin:10px 0"><b>${k === "opened" ? "When did the station open?" : "When did the station close?"}</b>
      <div class="row" style="margin-top:8px"><input class="inp num" id="ocT" type="time" value="${hh}" style="max-width:140px;font-size:18px"><button class="btn" id="ocGo">Send</button><button class="btn ghost" id="ocNo">Cancel</button></div>
      <p class="small muted" style="margin-bottom:0">It shows the time now. Change it only if it ${k === "opened" ? "opened" : "closed"} earlier.</p></div>`;
    $("#ocNo").onclick = draw;
    $("#ocGo").onclick = () => guard(async () => {
      const [h, m] = $("#ocT").value.split(":").map(Number); if (!(h >= 0)) throw new Error("Choose a time.");
      const at = new Date(API.now()); at.setHours(h, m, 0, 0); if (at > new Date(API.now().getTime() + 5 * 60000)) throw new Error("That time is still to come.");
      const r = await send("event", { station: st.id, kind: k, at: at.toISOString(), key: newKey() });
      localStorage.setItem(key(k), JSON.stringify({ at: at.toISOString(), queued: !!r?.queued })); draw();
    }, k === "opened" ? "Opening time sent." : "Closing time sent.");
  };
  draw();
}

// ------------------------------------------------------------------ SYSTEM ADMIN: media outlets, poll times, broadcast
async function viewMedia() {
  const local = (iso) => { if (!iso) return ""; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  $("#main").innerHTML = `<div class="row" style="margin-bottom:12px"><b style="font-size:16px">Media &amp; poll times</b><span class="muted small">Paying news outlets and the public broadcast. You collect any fee yourself; this screen only switches access on and off.</span></div>
  <div class="grid two">
    <div class="grid" style="align-content:start">
      <div class="card"><h3>Invite a news outlet</h3>
        <div class="explain">Each outlet gets <b>its own login</b>. Their name shows on their screen ("ON DBS RADIO"), so a copy shown elsewhere can be traced. Switch them off at any time.</div>
        <label class="f">Outlet's name</label><input class="inp" id="mName" maxlength="60" placeholder="e.g. DBS Radio">
        <label class="f">Package</label><select class="inp" id="mLive"><option value="1">Live all day: turnout during voting, then the results</option><option value="0">After the polls close: results night only</option></select>
        <button class="btn" style="margin-top:10px" id="mGo">Create invite</button><div id="mOut" style="margin-top:12px"></div></div>
      <div class="card"><h3>Poll times</h3>
        <p class="small" style="margin-top:0">"After close" outlets open when the polls close. Change these for a rehearsal, then set them back.</p>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px"><div><label class="f">Polls open</label><input class="inp" type="datetime-local" id="pOpen" value="${local(SETTINGS?.poll_open)}"></div>
          <div><label class="f">Polls close</label><input class="inp" type="datetime-local" id="pClose" value="${local(SETTINGS?.poll_close)}"></div></div>
        <button class="btn" style="margin-top:10px" id="pGo">Save poll times</button></div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="card"><h3>News outlets</h3><div class="tw" style="max-height:380px"><table><thead><tr><th>Outlet</th><th>Package</th><th>Access</th><th></th></tr></thead><tbody id="mRows"></tbody></table></div></div>
      <div class="card"><h3>Broadcast to the public</h3>
        <p class="small" style="margin-top:0">Open the <b>Broadcast screen</b>, press <b>Full screen</b>, and stream that window live with <b>OBS Studio</b> (free) or <b>StreamYard</b> to Facebook, YouTube or TikTok. Add your own camera and a host talking over it.</p>
        <button class="btn" id="toBc">📺 Open the broadcast screen</button></div>
    </div></div>`;
  $("#toBc").onclick = () => go("broadcast");
  $("#pGo").onclick = () => guard(async () => { const o = $("#pOpen").value, c = $("#pClose").value; if (!o || !c) throw new Error("Choose both times.");
    await API.setPollTimes(new Date(o).toISOString(), new Date(c).toISOString()); SETTINGS = await API.appSettings(); }, "Poll times saved.");
  $("#mGo").onclick = () => guard(async () => { const name = $("#mName").value.trim(), live = $("#mLive").value === "1"; if (!name) throw new Error("Type the outlet's name.");
    const code = await API.createMediaInvite(name, live), link = `${location.origin}${location.pathname}#invite=${code}`;
    inviteSent($("#mOut"), { code, msg: inviteMsg("", `the news outlet ${name} (${live ? "live all day" : "results after the polls close"}). Your screen shows your outlet's name`, link), who: name });
    $("#mName").value = ""; load(); });
  async function load() {
    const [mem, inv, out, DV] = await Promise.all([API.members(), API.invites(), API.mediaOutlets(), API.memberDevices().catch(() => ({}))]);
    const rows = mem.filter((m) => m.role === "media").map((m) => { const o = out.find((x) => x.user_id === m.id) || {};
      return `<tr><td><b>${esc(o.outlet || m.full_name)}</b><div class="small muted">${esc(m.full_name)}</div></td>
        <td><button class="btn sm ghost" data-live="${m.id}" data-to="${o.live ? 0 : 1}">${o.live ? "Live all day" : "After close only"}</button></td>
        <td>${m.active ? '<span class="pill p-ok">ON</span>' : '<span class="pill p-none">OFF</span>'}<div>${devCell(m.id, DV)}</div><div>${devBtns(m.id)}</div></td>
        <td><button class="btn sm ${m.active ? "warn" : ""}" data-act="${m.id}" data-on="${m.active ? 0 : 1}">${m.active ? "Switch off" : "Switch on"}</button></td></tr>`; }).join("") +
      inv.filter((i) => i.role === "media" && !i.used_by && !i.revoked && new Date(i.expires_at) > new Date()).map((i) => `<tr><td><b>${esc(i.media_outlet || i.label)}</b></td><td class="small">${i.media_live === false ? "After close only" : "Live all day"}</td><td><span class="pill p-unv">NOT USED YET</span></td>
        <td><button class="btn sm warn" data-rev="${esc(i.code)}">Cancel invite</button></td></tr>`).join("");
    $("#mRows").innerHTML = rows || '<tr><td colspan="4" class="muted">No news outlets yet.</td></tr>';
    $$("#mRows [data-live]").forEach((b) => (b.onclick = () => guard(async () => { await API.setMediaLive(b.dataset.live, b.dataset.to === "1"); load(); }, "Package changed.")));
    $$("#mRows [data-act]").forEach((b) => (b.onclick = () => { if (b.dataset.on === "0" && !confirm("Switch this outlet off now? Their screen stops at once.")) return; guard(async () => { await API.setMemberActive(b.dataset.act, b.dataset.on === "1"); load(); }, "Access updated."); }));
    $$("#mRows [data-rev]").forEach((b) => (b.onclick = () => guard(async () => { await API.revokeInvite(b.dataset.rev); load(); }, "Invite cancelled. The link no longer works.")));
    wireDev($("#mRows"), load);
  }
  REFRESH = null; await guard(load);
}

// ------------------------------------------------------------------ boot
const VIEWS = { national: viewNational, station: viewStation, watch: viewWatch, hq: viewHQ, team: viewTeam, admin: viewAdmin, counter: viewCounter, count: viewCount, media: viewMedia, broadcast: () => window.viewBroadcast() };
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
    // register this phone/computer first, so the rest of the start-up is read with the right permissions
    const dv = await API.registerDevice(DEVICE, deviceLabel()); if (stale()) return;
    const me = await API.me(); if (stale()) return; ME = me;
    if (!ME) { paintShell(); return authScreen(); }
    if (!ME.role) { paintShell(); return redeemScreen(); }
    if (ME.active === false) { paintShell(); $("#main").innerHTML = '<div class="card">Your access has been removed. Contact your party administrator.</div>'; return; }
    if (dv && dv.allowed === false) { paintShell(); const tb = $("#tabs"); if (tb) tb.innerHTML = ""; const who = ["counter", "media", "party_admin"].includes(ME.role) ? "the system administrator" : "your party administrator";
      $("#main").innerHTML = `<div class="card" style="max-width:560px;margin:20px auto"><h3>🔒 This account is already in use on another device</h3>
        <p>For safety, ${dv.limit === 1 ? "each polling agent and counter can use <b>one phone</b>" : `each person can use up to <b>${dv.limit} devices</b>`}. This ${esc(deviceLabel())} is not one of them, so nothing can be seen or sent from here.</p>
        <p>Changed or lost your phone? Ask <b>${who}</b> to press <b>Reset device</b> next to your name, then tap <b>Try again</b>.</p>
        <p class="small muted">This attempt has been recorded with the time and internet address.</p>
        <div class="row"><button class="btn" id="dvAgain">Try again</button><button class="btn ghost" id="dvOut">Sign out</button></div></div>`;
      $("#dvAgain").onclick = () => boot(); $("#dvOut").onclick = async () => { await API.signOut(); boot(); }; return; }
    const cs = await API.constituencies(); if (stale()) return; CONSTS = cs;
    try { SETTINGS = await API.appSettings(); } catch (e) { SETTINGS = null; } if (stale()) return;
    const tabs = tabsFor(ME.role).map((t) => t[0]);
    if (!tabs.includes(VIEW)) VIEW = API.mode === "demo" && tabs.includes("national") ? "national" : tabs[0];
    paintShell(); go(VIEW);
    flushOutbox();
  } catch (e) { $("#main").innerHTML = `<div class="card"><b>Could not load.</b><p class="small">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`; }
}
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
