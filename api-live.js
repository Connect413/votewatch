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
      ["submissions", "incidents", "support_estimates", "station_counts", "station_results", "station_events"].forEach((t) =>
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
    loadPracticeStations: () => rpc("load_practice_stations"),
    appSettings: () => rpc("app_settings"),
    setPollTimes: (open, close) => rpc("set_poll_times", { p_open: open, p_close: close }),
    createMediaInvite: (outlet, live) => rpc("create_media_invite", { p_outlet: outlet, p_live: live }),
    setMediaLive: (user, live) => rpc("set_media_live", { p_user: user, p_live: live }),
    async mediaOutlets() { return ok(await sb.from("media_access").select("*")); },
    reportStationEvent: (x) => rpc("report_station_event", { p_station: x.station, p_kind: x.kind, p_at: x.at, p_client_key: x.key }),
    stationTimes: (cid) => rpc("station_times", { p_constituency: cid ?? null }),
    clearPracticeStations: () => rpc("clear_practice_stations"),
    nationalSummary: () => rpc("national_summary"),
    nationalStations: (cid) => rpc("national_stations", { p_constituency: cid }),
    nationalTimeline() { const d = new Date(); d.setHours(6, 0, 0, 0); return rpc("national_timeline", { p_from: d.toISOString() }); },
    partySummary: () => rpc("party_summary"),
    partyStations: (cid) => rpc("party_stations", { p_constituency: cid ?? null }),
    nationalResults: () => rpc("national_results"),
    nationalStationResults: (cid) => rpc("national_station_results", { p_constituency: cid }),
    async candidates(cid, all) {
      let q = sb.from("candidates").select("*, parties(short_name)").order("ballot_order").order("name");
      if (cid) q = q.eq("constituency_id", cid);
      if (!all) q = q.eq("active", true);
      return ok(await q).map((c) => ({ ...c, party: c.parties?.short_name || c.label || "Independent" }));
    },
    addCandidate: (x) => rpc("add_candidate", { p_constituency: x.constituency, p_name: x.name, p_party: x.party || null, p_label: x.label || null, p_color: x.color || null, p_order: x.order || 0 }),
    setCandidateActive: (id, active) => rpc("set_candidate_active", { p_id: id, p_active: active }),
    submitCount: (x) => rpc("submit_count", { p_station: x.station, p_client_key: x.key, p_voted: x.voted, p_note: x.note || null, p_device_time: x.device_time }),
    correctCount: (x) => rpc("correct_count", { p_original: x.original, p_client_key: x.key, p_voted: x.voted, p_reason: x.reason }),
    submitResults: (x) => rpc("submit_results", { p_station: x.station, p_client_key: x.key, p_votes: x.votes, p_rejected: x.rejected, p_corrects: x.corrects || null, p_reason: x.reason || null }),
    async myCounts(stationId) {
      const [c, r] = await Promise.all([
        sb.from("station_counts").select("*").eq("station_id", stationId).order("received_at", { ascending: false }).limit(100),
        sb.from("station_results").select("*").eq("station_id", stationId).order("received_at", { ascending: false }).limit(20),
      ]);
      const counts = ok(c), results = ok(r), cor = new Set(counts.map((x) => x.corrects_id).filter(Boolean)), rcor = new Set(results.map((x) => x.corrects_id).filter(Boolean));
      return { counts: counts.map((x) => ({ ...x, superseded: cor.has(x.id) })), results: results.map((x) => ({ ...x, superseded: rcor.has(x.id) })) };
    },
    setTarget: (station, expected) => rpc("set_station_target", { p_station: station, p_expected: expected }),
    async myTarget(stationId) { const r = ok(await sb.from("party_station_targets").select("expected").eq("station_id", stationId).maybeSingle()); return r ? r.expected : null; },
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
