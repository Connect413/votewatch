// Live data layer: talks to Supabase. Every call is checked by the database's security rules.
(function () {
  const cfg = window.VW_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  const rpc = async (fn, args) => ok(await sb.rpc(fn, args || {}));
  const stationShape = (s) => ({ id: s.id, official_code: s.official_code, name: s.name, electors_listed: s.electors_listed,
    district: s.polling_districts?.name, constituency_id: s.polling_districts?.constituency_id });
  const STATION_SEL = "id, official_code, name, electors_listed, polling_districts!inner(name, constituency_id)";
  let listeners = [];

  window.VW_API = {
    mode: "live",
    now: () => new Date(),
    async init() {
      let lastUser = undefined;
      sb.auth.onAuthStateChange((ev, session) => {
        if (ev === "PASSWORD_RECOVERY") window.VW_RECOVERY = true;
        const u = session?.user?.id || null;
        if (ev === "PASSWORD_RECOVERY" || u !== lastUser) { const first = lastUser === undefined; lastUser = u; if (!first) listeners.forEach((f) => f("auth", u)); }
      });
    },
    onChange(cb) {
      listeners.push(cb);
      const ch = sb.channel("vw-live");
      ["submissions", "incidents", "support_estimates"].forEach((t) =>
        ch.on("postgres_changes", { event: "*", schema: "public", table: t }, () => cb(t)));
      ch.subscribe();
      setInterval(() => cb("poll"), 15000); // national figures include other parties' shared data → poll
    },
    async session() { return !!(await sb.auth.getSession()).data.session; },
    async signIn(email, password) { ok(await sb.auth.signInWithPassword({ email, password })); },
    async signUp(email, password) {
      const d = ok(await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } }));
      return { needsConfirm: !d.session };
    },
    async resetPassword(email) { ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })); },
    async updatePassword(pw) { ok(await sb.auth.updateUser({ password: pw })); },
    async signOut() { await sb.auth.signOut(); },
    async me() {
      const u = (await sb.auth.getUser()).data.user;
      if (!u) return null;
      const p = ok(await sb.from("profiles").select("*, parties(*)").eq("id", u.id).maybeSingle());
      if (!p) return { id: u.id, email: u.email, role: null };
      const as = ok(await sb.from("assignments").select("station_id, constituency_id").eq("user_id", u.id));
      const sids = as.filter((a) => a.station_id).map((a) => a.station_id);
      const stations = sids.length ? ok(await sb.from("polling_stations").select(STATION_SEL).in("id", sids)).map(stationShape) : [];
      return { id: u.id, email: u.email, full_name: p.full_name, role: p.role, active: p.active, party: p.parties,
        stations, constituencies: as.filter((a) => a.constituency_id).map((a) => a.constituency_id) };
    },
    redeem: (code, name) => rpc("redeem_invite", { p_code: code, p_full_name: name }),
    async constituencies() { return ok(await sb.from("constituencies").select("*").order("name")); },
    async stations(cid) {
      let q = sb.from("polling_stations").select(STATION_SEL).eq("active", true).order("official_code");
      if (cid) q = q.eq("polling_districts.constituency_id", cid);
      return ok(await q).map(stationShape);
    },
    nationalSummary: () => rpc("national_summary"),
    nationalStations: (cid) => rpc("national_stations", { p_constituency: cid }),
    nationalTimeline() { const d = new Date(); d.setHours(6, 0, 0, 0); return rpc("national_timeline", { p_from: d.toISOString() }); },
    partySummary: () => rpc("party_summary"),
    partyStations: (cid) => rpc("party_stations", { p_constituency: cid }),
    async subLog(cid) {
      const ids = (await this.stations(cid)).map((s) => s.id);
      if (!ids.length) return [];
      return ok(await sb.from("v_submission_status").select("*").in("station_id", ids).order("received_at", { ascending: false }).limit(80));
    },
    async incidents(cid) {
      let q = sb.from("incidents").select("*").order("created_at", { ascending: false }).limit(100);
      if (cid) { const ids = (await this.stations(cid)).map((s) => s.id); if (!ids.length) return []; q = q.in("station_id", ids); }
      return ok(await q);
    },
    async myReports(stationId) {
      const [subs, est, inc] = await Promise.all([
        sb.from("v_submission_status").select("*").eq("station_id", stationId).order("received_at", { ascending: false }).limit(50),
        sb.from("support_estimates").select("*").eq("station_id", stationId).order("received_at", { ascending: false }).limit(50),
        sb.from("incidents").select("*").eq("station_id", stationId).order("created_at", { ascending: false }).limit(50),
      ]);
      return { subs: ok(subs), estimates: ok(est), incidents: ok(inc) };
    },
    submitAttendance: (x) => rpc("submit_attendance", { p_station: x.station, p_client_key: x.key, p_attendance: x.attendance, p_note: x.note || null, p_device_time: x.device_time }),
    submitCorrection: (x) => rpc("submit_correction", { p_original: x.original, p_client_key: x.key, p_attendance: x.attendance, p_reason: x.reason, p_device_time: x.device_time }),
    submitEstimate: (x) => rpc("submit_support_estimate", { p_station: x.station, p_client_key: x.key, p_estimate: x.estimate, p_confidence: x.confidence, p_note: x.note || null, p_device_time: x.device_time }),
    reportIncident: (x) => rpc("report_incident", { p_station: x.station, p_client_key: x.key, p_category: x.category, p_severity: x.severity, p_description: x.description || null }),
    reconcile: (id, decision, note) => rpc("reconcile_submission", { p_submission: id, p_decision: decision, p_note: note || null }),
    resolveIncident: (id, note) => rpc("resolve_incident", { p_incident: id, p_note: note || null }),
    async notes() { return ok(await sb.from("party_notes").select("*, profiles(full_name)").order("created_at", { ascending: false }).limit(100)); },
    addNote: (body, cid) => rpc("add_party_note", { p_body: body, p_constituency: cid || null }),
    async ratings() { return ok(await sb.from("party_area_ratings").select("*")); },
    setRating: (cid, rating, note) => rpc("set_area_rating", { p_constituency: cid, p_rating: rating, p_note: note || null }),
    setSharing: (counts, incidents) => rpc("set_party_sharing", { p_counts: counts, p_incidents: incidents }),
    createInvite: (x) => rpc("create_invite", { p_role: x.role, p_station: x.station || null, p_constituency: x.constituency || null, p_label: x.label || null, p_party: x.party || null }),
    async invites() { return ok(await sb.from("invites").select("*").order("created_at", { ascending: false })); },
    revokeInvite: (code) => rpc("revoke_invite", { p_code: code }),
    async members() {
      const ps = ok(await sb.from("profiles").select("*").order("created_at"));
      const as = ok(await sb.from("assignments").select("user_id, station_id, constituency_id"));
      return ps.map((p) => ({ ...p, assignments: as.filter((a) => a.user_id === p.id) }));
    },
    setMemberActive: (id, active) => rpc("set_member_active", { p_user: id, p_active: active }),
    async audit() { return ok(await sb.from("audit_log").select("id, action, entity, entity_id, detail, at, actor").order("id", { ascending: false }).limit(200)); },
    async parties() { return ok(await sb.from("parties").select("*").order("name")); },
    createParty: (name, short, color) => rpc("create_party", { p_name: name, p_short: short, p_color: color }),
    uploadImport: (rows) => rpc("upload_station_import", { p_rows: rows }),
    async imports() { return ok(await sb.from("import_batches").select("id, uploaded_by, uploaded_at, row_count, errors, status, decided_at").order("uploaded_at", { ascending: false })); },
    decideImport: (id, approve) => rpc("decide_station_import", { p_batch: id, p_approve: approve }),
  };
})();
