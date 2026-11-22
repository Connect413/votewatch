// Demo data layer: same functions as api-live.js, but in memory with SYNTHETIC data and a simulated clock.
// Used when no Supabase keys are configured, or when the address ends with ?demo
(function () {
  if (window.VW_API) return; // live mode configured
  const MAP = window.VW_MAP;
  let seed = 1216;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "d-" + Math.random().toString(16).slice(2));
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const OPEN = 7 * 60, CLOSE = 17 * 60;
  let simMin = OPEN, speed = 5, playing = true;
  const T = (m) => new Date(day.getTime() + m * 60000).toISOString();
  const nowIso = () => T(simMin);

  const parties = [
    { id: "pA", name: "Party Alpha (demo)", short_name: "ALP", color: "#6A3D9A", share_counts: true, share_incidents: true },
    { id: "pB", name: "Party Beta (demo)", short_name: "BET", color: "#0F7C80", share_counts: true, share_incidents: false },
  ];
  const constituencies = MAP.consts.map((c, i) => ({ id: i + 1, code: c.code, name: c.name }));
  const stations = [];
  constituencies.forEach((c) => {
    const n = 3 + Math.floor(rnd() * 5), nd = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) stations.push({ id: c.code + "-" + (i + 1), official_code: "DEMO-" + c.code + "-" + String(i + 1).padStart(2, "0"),
      name: "Demo station " + (i + 1), district: "Demo district " + String.fromCharCode(65 + (i % nd)), constituency_id: c.id,
      electors_listed: 300 + Math.floor(rnd() * 600) });
  });
  const stById = Object.fromEntries(stations.map((s) => [s.id, s]));
  const cOf = (sid) => stById[sid].constituency_id;
  const lean = {}; constituencies.forEach((c) => (lean[c.id] = 0.25 + rnd() * 0.5)); // synthetic Alpha share
  const sim = {}; stations.forEach((s) => (sim[s.id] = { rate: 0.5 + rnd() * 0.28, next: { pA: OPEN + 10 + rnd() * 50, pB: OPEN + 10 + rnd() * 50 },
    every: 30 + rnd() * 35, last: 0, coveredBy: rnd() < 0.85 ? ["pA", "pB"] : [rnd() < 0.5 ? "pA" : "pB"] }));

  const people = [
    { id: "u-rep", full_name: "Demo Rep (Alpha)", role: "rep", party_id: "pA", station: "RNO-1", email: "rep@demo" },
    { id: "u-watch", full_name: "Demo Watch Room (Alpha)", role: "watch", party_id: "pA", constituency: 15, email: "watch@demo" },
    { id: "u-hq", full_name: "Demo Head Office (Alpha)", role: "hq", party_id: "pA", email: "hq@demo" },
    { id: "u-adminA", full_name: "Demo Party Admin (Alpha)", role: "party_admin", party_id: "pA", email: "admin@demo" },
    { id: "u-adminB", full_name: "Demo Party Admin (Beta)", role: "party_admin", party_id: "pB", email: "adminb@demo" },
    { id: "u-sys", full_name: "Demo System Admin", role: "sys_admin", party_id: null, email: "sys@demo" },
  ];
  sim["RNO-1"].manualFor = "pA";
  let meId = localStorage.getItem("vw_demo_persona") || "u-rep";
  const DB = { subs: [], recon: [], est: [], inc: [], notes: [], ratings: [], invites: [], audit: [], imports: [], keys: new Set() };
  ["pA", "pB"].forEach((p) => constituencies.forEach((c) => {
    const l = p === "pA" ? lean[c.id] : 1 - lean[c.id];
    const r = l > 0.62 ? "stronghold" : l > 0.52 ? "leaning" : l > 0.45 ? "competitive" : l > 0.36 ? "opponent_leaning" : "opponent_stronghold";
    DB.ratings.push({ party_id: p, constituency_id: c.id, rating: r, note: null });
  }));
  DB.notes.push({ id: 1, party_id: "pA", body: "All Roseau reps confirmed and briefed.", created_at: T(OPEN - 40), profiles: { full_name: "Demo Head Office (Alpha)" } });
  DB.notes.push({ id: 2, party_id: "pB", body: "Beta-only note: transport for the south-east is ready.", created_at: T(OPEN - 30), profiles: { full_name: "Demo Party Admin (Beta)" } });
  let nextId = 1;
  const me = () => people.find((p) => p.id === meId);
  const party = () => parties.find((p) => p.id === me().party_id);
  const audit = (action, entity, id, detail) => DB.audit.push({ id: DB.audit.length + 1, actor: meId, party_id: me()?.party_id || null, action, entity, entity_id: String(id), detail, at: nowIso() });

  // ---- derived state (mirrors the SQL) ----
  // indexes rebuilt only when data or the clock changes (keeps the demo fast)
  let IX = { key: "" };
  function idx() {
    const key = DB.subs.length + "|" + DB.recon.length + "|" + simMin;
    if (IX.key === key) return IX;
    const corrected = new Set(), rec = new Map();
    DB.subs.forEach((c) => c.corrects_id && corrected.add(c.corrects_id));
    DB.recon.forEach((r) => { if (!r._due || r._due <= simMin) rec.set(r.submission_id, r); }); // scheduled reviews count once their time comes
    return (IX = { key, corrected, rec });
  }
  function status(s) {
    const I = idx();
    if (I.corrected.has(s.id)) return "superseded";
    const r = I.rec.get(s.id);
    if (r && r.decision === "reconciled") return "reconciled";
    if (r && r.decision === "rejected") return "rejected";
    if (s.flags.length) return "flagged";
    return "unverified";
  }
  const withStatus = (s) => ({ ...s, status: status(s), superseded_by: (DB.subs.find((c) => c.corrects_id === s.id) || {}).id || null });
  function latest(party_id, sid, ok) {
    for (let i = DB.subs.length - 1; i >= 0; i--) { const s = DB.subs[i]; if (s.party_id === party_id && s.station_id === sid) { const st = status(s); if (ok(st)) return { ...s, status: st }; } }
    return null;
  }
  const latestEff = (p, sid) => latest(p, sid, (st) => st !== "superseded" && st !== "rejected");
  const latestGood = (p, sid) => latest(p, sid, (st) => st === "unverified" || st === "reconciled");
  const latestRec = (p, sid) => latest(p, sid, (st) => st === "reconciled");
  const latestEst = (p, sid) => { for (let i = DB.est.length - 1; i >= 0; i--) if (DB.est[i].party_id === p && DB.est[i].station_id === sid) return DB.est[i]; return null; };
  const canSeeStation = (sid) => { const u = me(); if (!u || !u.party_id) return false; if (u.role === "hq" || u.role === "party_admin") return true;
    if (u.role === "watch") return cOf(sid) === u.constituency; return u.station === sid; };
  const canSeeC = (cid) => { const u = me(); return u.role === "hq" || u.role === "party_admin" || (u.role === "watch" && u.constituency === cid); };
  const deny = (m) => { throw new Error(m || "Not permitted"); };

  function natStation(s) {
    const sharing = parties.filter((p) => p.share_counts);
    const goods = sharing.map((p) => ({ p, g: latestGood(p.id, s.id) })).filter((x) => x.g);
    goods.sort((a, b) => b.g.received_at.localeCompare(a.g.received_at));
    const recs = sharing.map((p) => latestRec(p.id, s.id)).filter(Boolean).sort((a, b) => b.received_at.localeCompare(a.received_at));
    const recent = goods.filter((x) => simMin - minOf(x.g.received_at) <= 45).map((x) => x.g.attendance);
    const dis = recent.length > 1 && Math.max(...recent) - Math.min(...recent) > 0.1 * Math.max(...recent, 1);
    return { station_id: s.id, official_code: s.official_code, station_name: s.name, district: s.district, constituency_id: s.constituency_id,
      electors_listed: s.electors_listed, observed: goods[0]?.g.attendance ?? null, reconciled: recs[0]?.attendance ?? null,
      last_at: goods[0]?.g.received_at ?? null, sources: goods.length ? goods.map((x) => x.p.short_name) : null, disagreement: dis };
  }
  const minOf = (iso) => (new Date(iso) - day) / 60000;

  function addSub(p, sid, user, key, att, extra = {}) {
    const k = p + "|" + key;
    if (DB.keys.has(k)) { const ex = DB.subs.find((s) => s.party_id === p && s.client_key === key); return { duplicate: true, id: ex?.id }; }
    DB.keys.add(k);
    const flags = [];
    if (!extra.corrects_id) {
      const prev = latestEff(p, sid);
      if (prev && att < prev.attendance) flags.push("Lower than previous total (" + prev.attendance + ")");
      if (att > stById[sid].electors_listed) flags.push("Higher than electors on list (" + stById[sid].electors_listed + ")");
    }
    const s = { id: nextId++, party_id: p, station_id: sid, user_id: user, client_key: key, kind: extra.corrects_id ? "correction" : "report",
      attendance: att, corrects_id: extra.corrects_id || null, reason: extra.reason || null, note: extra.note || null,
      device_time: extra.device_time || nowIso(), received_at: nowIso(), flags };
    DB.subs.push(s);
    if (flags.length) DB.inc.push({ id: nextId++, party_id: p, station_id: sid, user_id: user, category: "Discrepancy", severity: "high",
      description: flags.join("; ") + " — reported " + att, submission_id: s.id, status: "open", created_at: nowIso() });
    if (extra.corrects_id) DB.inc.filter((i) => i.submission_id === extra.corrects_id && i.status === "open").forEach((i) => { i.status = "resolved"; i.resolution_note = "Corrected by representative"; i.resolved_at = nowIso(); });
    return { duplicate: false, id: s.id, received_at: s.received_at, flags };
  }

  // ---- simulation ----
  const INC = ["Station opened late", "Long queue outside", "Representative refused entry", "Power outage", "Access problem for elderly voters", "Crowd concern near station"];
  function tick(dm) {
    simMin = Math.min(CLOSE + 40, simMin + dm);
    stations.forEach((s) => {
      const z = sim[s.id];
      z.coveredBy.forEach((p) => {
        if (z.manualFor === p) return;
        while (z.next[p] <= simMin && z.next[p] <= CLOSE + 25) {
          const t = z.next[p], x = Math.min(1, (Math.min(t, CLOSE) - OPEN) / (CLOSE - OPEN));
          let v = Math.round(s.electors_listed * z.rate * (1 - Math.pow(1 - x, 1.7)) * (0.96 + Math.random() * 0.08));
          const prev = latestEff(p, s.id); if (prev) v = Math.max(v, prev.attendance);
          if (prev && Math.random() < 0.02) v = Math.round(prev.attendance * 0.6);
          const save = simMin; simMin = t;
          const r = addSub(p, s.id, "sim", uid(), v);
          const share = p === "pA" ? lean[s.constituency_id] : 1 - lean[s.constituency_id];
          DB.est.push({ id: nextId++, party_id: p, station_id: s.id, user_id: "sim", client_key: uid(), estimated_supporters: Math.round(v * share * (0.85 + Math.random() * 0.3)),
            confidence: ["low", "medium", "high"][Math.floor(Math.random() * 3)], received_at: nowIso() });
          simMin = save;
          if (!r.flags?.length && Math.random() < 0.85) DB.recon.push({ submission_id: r.id, party_id: p, decision: "reconciled", by_user: "sim", at: T(t + 20 + Math.random() * 30), _due: t + 20 + Math.random() * 30 });
          z.next[p] += z.every + (Math.random() * 14 - 7);
        }
      });
    });
    if (simMin <= CLOSE && Math.random() < dm * 0.01) {
      const s = stations[Math.floor(Math.random() * stations.length)], p = Math.random() < 0.5 ? "pA" : "pB";
      DB.inc.push({ id: nextId++, party_id: p, station_id: s.id, category: INC[Math.floor(Math.random() * INC.length)], severity: ["low", "medium", "high"][Math.floor(Math.random() * 3)],
        description: "Simulated report", status: "open", created_at: nowIso() });
    }
  }

  let listeners = [];
  let last = performance.now(), acc = 0;
  setInterval(() => {
    const n = performance.now(), dt = (n - last) / 1000; last = n;
    if (!playing || simMin >= CLOSE + 40) return;
    acc += dt * speed; if (acc >= 1) { const m = Math.floor(acc); acc -= m; tick(m); listeners.forEach((f) => f("tick")); }
  }, 250);
  tick(0);

  const R = (v) => Promise.resolve(JSON.parse(JSON.stringify(v)));
  window.VW_API = {
    mode: "demo",
    now: () => new Date(day.getTime() + simMin * 60000),
    demo: {
      people, get persona() { return meId; },
      setPersona(id) { meId = id; localStorage.setItem("vw_demo_persona", id); listeners.forEach((f) => f("auth")); },
      get playing() { return playing; }, toggle() { playing = !playing; return playing; },
      setSpeed(s) { speed = s; }, get speed() { return speed; },
      jump(m) { while (simMin < Math.min(m, CLOSE + 40)) tick(5); listeners.forEach((f) => f("tick")); },
    },
    async init() {},
    onChange(cb) { listeners.push(cb); },
    async session() { return true; },
    async signIn() {}, async signUp() { return { needsConfirm: false }; }, async signOut() {}, async resetPassword() {}, async updatePassword() {},
    async me() {
      const u = me(); if (!u) return null;
      return R({ id: u.id, email: u.email, full_name: u.full_name, role: u.role, party: party() || null,
        stations: u.station ? [stById[u.station]] : [], constituencies: u.constituency ? [u.constituency] : [] });
    },
    async redeem() { deny("Invites are not used in demo mode"); },
    constituencies: () => R([...constituencies].sort((a, b) => a.name.localeCompare(b.name))),
    stations: (cid) => R(stations.filter((s) => !cid || s.constituency_id === cid)),
    nationalSummary() {
      const ns = stations.map(natStation);
      return R(constituencies.map((c) => {
        const xs = ns.filter((n) => n.constituency_id === c.id);
        return { constituency_id: c.id, code: c.code, name: c.name, stations_total: xs.length, stations_reporting: xs.filter((x) => x.observed !== null).length,
          observed: xs.reduce((a, x) => a + (x.observed || 0), 0), reconciled: xs.reduce((a, x) => a + (x.reconciled || 0), 0),
          electors_listed: xs.reduce((a, x) => a + x.electors_listed, 0), last_at: xs.map((x) => x.last_at).filter(Boolean).sort().slice(-1)[0] || null,
          disagreements: xs.filter((x) => x.disagreement).length,
          shared_incidents: DB.inc.filter((i) => i.status === "open" && cOf(i.station_id) === c.id && parties.find((p) => p.id === i.party_id).share_incidents).length };
      }));
    },
    nationalStations: (cid) => R(stations.filter((s) => s.constituency_id === cid).map(natStation)),
    nationalTimeline() {
      const sharing = new Set(parties.filter((p) => p.share_counts).map((p) => p.id));
      const xs = DB.subs.filter((x) => sharing.has(x.party_id)).map((x) => ({ x, st: status(x), m: minOf(x.received_at) }))
        .filter((z) => z.st === "unverified" || z.st === "reconciled").sort((a, b) => a.m - b.m);
      const obs = new Map(), rec = new Map(), out = []; let i = 0;
      for (let m = OPEN - 30; m <= simMin + 15; m += 15) {
        while (i < xs.length && xs[i].m <= m) { const z = xs[i++]; obs.set(z.x.station_id, z.x.attendance); if (z.st === "reconciled") rec.set(z.x.station_id, z.x.attendance); }
        let o = 0, r = 0; obs.forEach((v) => (o += v)); rec.forEach((v) => (r += v));
        out.push({ t: T(m), observed: o, reconciled: r });
      }
      return R(out);
    },
    partySummary() {
      const u = me(); if (!u.party_id || !["hq", "party_admin", "watch"].includes(u.role)) deny();
      const p = u.party_id;
      return R(constituencies.filter((c) => canSeeC(c.id)).map((c) => {
        const xs = stations.filter((s) => s.constituency_id === c.id);
        return { constituency_id: c.id, stations_total: xs.length, stations_reporting: xs.filter((s) => latestEff(p, s.id)).length,
          observed: xs.reduce((a, s) => a + (latestGood(p, s.id)?.attendance || 0), 0), reconciled: xs.reduce((a, s) => a + (latestRec(p, s.id)?.attendance || 0), 0),
          est_supporters: xs.reduce((a, s) => a + (latestEst(p, s.id)?.estimated_supporters || 0), 0), electors_listed: xs.reduce((a, s) => a + s.electors_listed, 0),
          open_alerts: DB.inc.filter((i) => i.party_id === p && i.status === "open" && cOf(i.station_id) === c.id).length,
          last_at: xs.map((s) => latestEff(p, s.id)?.received_at).filter(Boolean).sort().slice(-1)[0] || null,
          rating: u.role === "watch" ? null : (DB.ratings.find((r) => r.party_id === p && r.constituency_id === c.id) || {}).rating || null };
      }));
    },
    partyStations(cid) {
      if (!canSeeC(cid)) deny(); const p = me().party_id;
      return R(stations.filter((s) => s.constituency_id === cid).map((s) => {
        const l = latestEff(p, s.id), e = latestEst(p, s.id);
        return { station_id: s.id, official_code: s.official_code, station_name: s.name, district: s.district, electors_listed: s.electors_listed,
          latest_id: l?.id ?? null, latest_attendance: l?.attendance ?? null, latest_at: l?.received_at ?? null, latest_status: l?.status ?? null,
          latest_flags: l?.flags ?? null, latest_kind: l?.kind ?? null, reconciled: latestRec(p, s.id)?.attendance ?? null,
          est_supporters: e?.estimated_supporters ?? null, est_confidence: e?.confidence ?? null, est_at: e?.received_at ?? null, reps: sim[s.id].coveredBy.includes(p) ? 1 : 0 };
      }));
    },
    subLog(cid) { const p = me().party_id; return R(DB.subs.filter((s) => s.party_id === p && cOf(s.station_id) === cid && canSeeStation(s.station_id)).slice(-80).reverse().map(withStatus)); },
    incidents(cid) { const p = me().party_id; return R(DB.inc.filter((i) => i.party_id === p && canSeeStation(i.station_id) && (!cid || cOf(i.station_id) === cid)).slice(-100).reverse()); },
    myReports(sid) {
      const u = me(), p = u.party_id; if (!canSeeStation(sid)) deny();
      const mine = (x) => x.party_id === p && x.station_id === sid && (u.role !== "rep" || x.user_id === u.id);
      return R({ subs: DB.subs.filter(mine).reverse().map(withStatus), estimates: DB.est.filter(mine).reverse(), incidents: DB.inc.filter(mine).reverse() });
    },
    async submitAttendance(x) { const u = me(); if (u.role !== "rep" || !canSeeStation(x.station)) deny("You are not assigned to this station");
      const r = addSub(u.party_id, x.station, u.id, x.key, x.attendance, { note: x.note, device_time: x.device_time }); if (!r.duplicate) audit("submit_attendance", "submission", r.id); return R(r); },
    async submitCorrection(x) {
      const u = me(), o = DB.subs.find((s) => s.id === x.original);
      if (!o || o.user_id !== u.id) deny("You can only correct your own reports"); if (!x.reason || x.reason.trim().length < 3) deny("A reason is required");
      if (DB.subs.some((s) => s.corrects_id === o.id)) deny("This report was already corrected; correct the latest version");
      const r = addSub(u.party_id, o.station_id, u.id, x.key, x.attendance, { corrects_id: o.id, reason: x.reason.trim(), device_time: x.device_time }); audit("submit_correction", "submission", r.id); return R(r);
    },
    async submitEstimate(x) { const u = me(); if (u.role !== "rep" || !canSeeStation(x.station)) deny("You are not assigned to this station");
      const k = u.party_id + "|e|" + x.key; if (DB.keys.has(k)) return R({ duplicate: true }); DB.keys.add(k);
      const e = { id: nextId++, party_id: u.party_id, station_id: x.station, user_id: u.id, client_key: x.key, estimated_supporters: x.estimate, confidence: x.confidence, note: x.note, received_at: nowIso() };
      DB.est.push(e); audit("submit_estimate", "support_estimate", e.id); return R({ duplicate: false, id: e.id, received_at: e.received_at }); },
    async reportIncident(x) { const u = me(); if (!canSeeStation(x.station)) deny();
      const k = u.party_id + "|i|" + x.key; if (DB.keys.has(k)) return R({ duplicate: true }); DB.keys.add(k);
      const i = { id: nextId++, party_id: u.party_id, station_id: x.station, user_id: u.id, client_key: x.key, category: x.category, severity: x.severity, description: x.description, status: "open", created_at: nowIso() };
      DB.inc.push(i); audit("report_incident", "incident", i.id); return R({ duplicate: false, id: i.id }); },
    async reconcile(id, decision, note) { const u = me(), s = DB.subs.find((x) => x.id === id && x.party_id === u.party_id);
      if (!s || !["watch", "hq", "party_admin"].includes(u.role) || !canSeeStation(s.station_id)) deny();
      DB.recon.push({ submission_id: id, party_id: u.party_id, decision, by_user: u.id, note, at: nowIso() });
      if (decision !== "correction_requested") DB.inc.filter((i) => i.submission_id === id && i.status === "open").forEach((i) => { i.status = "resolved"; i.resolution_note = decision === "reconciled" ? "Accepted as reported" : "Rejected by watch room"; });
      audit("reconcile", "submission", id, { decision }); },
    async resolveIncident(id, note) { const u = me(), i = DB.inc.find((x) => x.id === id && x.party_id === u.party_id); if (!i) deny();
      i.status = "resolved"; i.resolution_note = note || "Resolved"; i.resolved_at = nowIso(); audit("resolve_incident", "incident", id); },
    notes() { const u = me(); if (!["hq", "party_admin", "watch"].includes(u.role)) return R([]); return R(DB.notes.filter((n) => n.party_id === u.party_id).slice().reverse()); },
    async addNote(body) { const u = me(); DB.notes.push({ id: nextId++, party_id: u.party_id, body, created_at: nowIso(), profiles: { full_name: u.full_name } }); },
    ratings() { const u = me(); if (!["hq", "party_admin"].includes(u.role)) return R([]); return R(DB.ratings.filter((r) => r.party_id === u.party_id)); },
    async setRating(cid, rating, note) { const u = me(); if (!["hq", "party_admin"].includes(u.role)) deny();
      const r = DB.ratings.find((x) => x.party_id === u.party_id && x.constituency_id === cid); if (r) { r.rating = rating; r.note = note; } else DB.ratings.push({ party_id: u.party_id, constituency_id: cid, rating, note }); },
    async setSharing(c, i) { const u = me(); if (u.role !== "party_admin") deny("Only the party administrator can change sharing"); Object.assign(party(), { share_counts: c, share_incidents: i }); audit("set_sharing", "party", u.party_id, { counts: c, incidents: i }); },
    async createInvite(x) { const u = me(); const code = Math.random().toString(16).slice(2, 6).toUpperCase() + "-" + Math.random().toString(16).slice(2, 6).toUpperCase() + "-" + Math.random().toString(16).slice(2, 6).toUpperCase();
      if (x.role === "rep" && !x.station) deny("A representative invite needs a polling station"); if (x.role === "watch" && !x.constituency) deny("A watch room invite needs a constituency");
      DB.invites.push({ code, party_id: u.role === "sys_admin" ? x.party || null : u.party_id, role: x.role, station_id: x.station || null, constituency_id: x.constituency || null, label: x.label, created_at: nowIso(), expires_at: T(simMin + 14 * 1440), used_by: null, revoked: false });
      audit("create_invite", "invite", code, { role: x.role }); return code; },
    invites() { const u = me(); return R(DB.invites.filter((i) => (u.role === "party_admin" && i.party_id === u.party_id) || (u.role === "sys_admin" && ["party_admin", "sys_admin"].includes(i.role))).slice().reverse()); },
    async revokeInvite(code) { const i = DB.invites.find((x) => x.code === code); if (i) i.revoked = true; },
    members() { const u = me(); return R(people.filter((p) => (u.role === "party_admin" && p.party_id === u.party_id) || (u.role === "sys_admin" && ["party_admin", "sys_admin"].includes(p.role)))
      .map((p) => ({ id: p.id, full_name: p.full_name, role: p.role, active: p.active !== false, party_id: p.party_id, assignments: [p.station ? { station_id: p.station } : null, p.constituency ? { constituency_id: p.constituency } : null].filter(Boolean) }))); },
    async setMemberActive(id, a) { if (id === meId) deny("You cannot deactivate yourself"); const p = people.find((x) => x.id === id); if (p) p.active = a; },
    audit() { const u = me(); return R(DB.audit.filter((a) => (u.role === "party_admin" && a.party_id === u.party_id) || (u.role === "sys_admin" && !a.party_id)).slice(-200).reverse()); },
    parties: () => R(parties),
    async createParty(name, short, color) { if (me().role !== "sys_admin") deny(); const id = "p" + nextId++; parties.push({ id, name, short_name: short, color, share_counts: true, share_incidents: false }); audit("create_party", "party", id); return id; },
    async uploadImport(rows) { const names = new Set(constituencies.map((c) => c.name.toLowerCase())), seen = new Set(), errors = [];
      rows.forEach((r, i) => { if (!names.has(String(r.constituency || "").trim().toLowerCase())) errors.push(`Row ${i + 2}: unknown constituency "${r.constituency}"`);
        else if (!r.station_code || !r.station_name || !r.polling_district) errors.push(`Row ${i + 2}: missing district, station code or station name`);
        else if (seen.has(r.station_code)) errors.push(`Row ${i + 2}: duplicate station code ${r.station_code}`); seen.add(r.station_code); });
      const b = { id: "b" + nextId++, uploaded_by: meId, uploaded_at: nowIso(), row_count: rows.length, errors, status: "pending" }; DB.imports.push(b); audit("upload_import", "import_batch", b.id); return { id: b.id, errors }; },
    imports: () => R(DB.imports.slice().reverse()),
    async decideImport(id, approve) { const b = DB.imports.find((x) => x.id === id); if (approve && b.uploaded_by === meId) deny("A second administrator must approve this import");
      if (approve && b.errors.length) deny("Fix the errors and upload again"); b.status = approve ? "approved" : "rejected"; b.decided_at = nowIso(); },
  };
})();
