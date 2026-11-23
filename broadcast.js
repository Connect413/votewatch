// Broadcast screen: the whole of Dominica on one 16:9 screen, for TV and live streams.
// Voting day: who has turned out, per constituency, against the register, and when stations opened/closed.
// Count night: the map colours in as station counts arrive; projected when every station is counted, declared when official.
// Uses the same data calls as the National Watch, so the database decides who may see it.
(function () {
  const W = window, Q = (s) => document.querySelector(s);
  const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const f = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US"));
  const TZ = () => (API.mode === "live" ? { timeZone: "America/Dominica" } : {}); // live: always Dominica time, wherever the viewer is
  const hm = (iso) => { if (!iso) return "—"; return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", ...TZ() }); };
  const hm12 = (iso) => { if (!iso) return ""; return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...TZ() }).toLowerCase(); };
  function mix(hex, w, bg) { const n = parseInt(String(hex || "#777777").slice(1), 16), b0 = parseInt((bg || "#0E4A2F").slice(1), 16);
    const c = (sh) => Math.round(((n >> sh) & 255) * w + ((b0 >> sh) & 255) * (1 - w)); return `rgb(${c(16)},${c(8)},${c(0)})`; }
  let S = { mode: null, manual: false, prev: {}, queue: [], showing: false, majFor: null, ticks: [], miles: new Set(), timer: null };

  function stageHTML(label) {
    return `<div id="bcStage">
      <header class="bch"><div class="bcbrand"><div class="bclogo"><svg width="34" height="34" viewBox="0 0 40 40"><path d="M6 8 L20 34 L34 8" fill="none" stroke="#FCD116" stroke-width="6" stroke-linejoin="round"/><circle cx="20" cy="13" r="5" fill="#D41C30"/></svg></div>
        <div><b>VOTE WATCH DOMINICA</b><small id="bcSub">GENERAL ELECTION · 16 DECEMBER 2026</small></div></div>
        <div class="bclive">${label ? `<div class="bcpill bcmut">${e(label)}</div>` : ""}<div class="bcpill bcred"><i></i>LIVE</div><div class="bcclock"><span id="bcClk">--:--</span><small>DOMINICA TIME</small></div></div></header>
      <div class="bcflag"><i style="background:#FCD116"></i><i style="background:#111"></i><i style="background:#fff"></i><i style="background:#D41C30"></i></div>
      <section id="bcTop"></section>
      <div id="bcMap" class="bcpanel"><h3 id="bcMapH">MAP</h3><div id="bcMapIn"></div><div id="bcKey" class="bckey"></div></div>
      <div id="bcFeat" class="bcpanel"><h3 id="bcFeatH"></h3><div id="bcFeatIn" class="bcfeat"></div></div>
      <div id="bcGrid" class="bcpanel"><h3>EVERY CONSTITUENCY</h3><div id="bcTiles" class="bctiles"></div></div>
      <div class="bcdisc">INDEPENDENT AND UNOFFICIAL · COUNTS ONLY, NO NAMES OR BALLOTS · ONLY THE ELECTORAL OFFICE DECLARES RESULTS</div>
      <footer class="bcf"><div class="bctag">LATEST</div><div id="bcTick"></div></footer>
      <div id="bcBanner"><div class="k" id="bcBK"></div><div class="t"><b id="bcBT"></b><span id="bcBS"></span></div><div class="g" id="bcBG"></div></div>
      <div id="bcMaj"><div class="bg" id="bcMajBg"></div><div class="box" id="bcMajBox"><div class="a">MAJORITY REACHED</div><div class="b" id="bcMajT"></div><div class="c" id="bcMajS"></div></div></div>
      <div id="bcWait" class="hide"><div><b>Live coverage begins when the polls close</b><span id="bcWaitS"></span></div></div>
    </div>`;
  }
  function drawMapSVG() {
    const M = W.VW_MAP, [x, y, w, h] = M.viewBox;
    let s = `<svg viewBox="${x} ${y} ${w} ${h}"><path d="${M.coast}" fill="#000" opacity=".35" transform="translate(4,6)"/>`;
    M.consts.forEach((c) => (s += `<path class="bccell" id="bcc-${c.code}" d="${c.d}" fill="#2F6B4E"/>`));
    s += `<path d="${M.coast}" fill="none" stroke="#FCD116" stroke-width="2.6"/>`;
    M.consts.forEach((c) => (s += `<text class="bcml" id="bcl-${c.code}" x="${c.cx}" y="${c.cy + 5}" font-size="${c.code === "RCE" ? 11 : 15}">${c.code}</text>`));
    Q("#bcMapIn").innerHTML = s + "</svg>";
  }
  function fit() { const wrap = Q("#bcWrap"), st = Q("#bcStage"); if (!wrap || !st) return;
    const fs = document.fullscreenElement === wrap, W0 = fs ? innerWidth : wrap.clientWidth, H0 = fs ? innerHeight : W0 * 9 / 16;
    const sc = Math.min(W0 / 1920, H0 / 1080); st.style.transform = `scale(${sc})`; wrap.style.height = fs ? "100vh" : 1080 * sc + "px";
    st.style.left = fs ? (innerWidth - 1920 * sc) / 2 + "px" : "0"; st.style.top = fs ? (innerHeight - 1080 * sc) / 2 + "px" : "0"; }
  function tick(html) { const t = API.now(); S.ticks.unshift(`${hm(t.toISOString())} · ${html}`); S.ticks = S.ticks.slice(0, 8);
    const h = S.ticks.map((x) => `<span>${x}</span>`).join(""); Q("#bcTick").innerHTML = h + h; }
  function runQueue() {
    if (S.showing || !S.queue.length || !Q("#bcBanner")) return; S.showing = true; const q = S.queue.shift();
    if (q.maj) { Q("#bcMajT").textContent = q.maj.name.toUpperCase(); Q("#bcMajS").textContent = `reaches ${q.maj.n} of 21 seats on station counts · projected to form the government`;
      Q("#bcMajBox").style.background = `linear-gradient(160deg, ${q.maj.color}, #000 140%)`;
      const bg = Q("#bcMajBg"); bg.innerHTML = "";
      for (let i = 0; i < 120; i++) { const d = document.createElement("i"); d.className = "bcconf"; d.style.left = Math.random() * 1920 + "px";
        d.style.background = [q.maj.color, "#FCD116", "#fff", "#006B3F"][i % 4]; d.style.animationDuration = 2.5 + Math.random() * 3 + "s"; d.style.animationDelay = Math.random() * 1.5 + "s"; bg.appendChild(d); }
      Q("#bcMaj").classList.add("on");
      setTimeout(() => { Q("#bcMaj")?.classList.remove("on"); setTimeout(() => { S.showing = false; runQueue(); }, 900); }, 7000); return; }
    Q("#bcBanner").style.background = q.color; Q("#bcBK").textContent = q.k; Q("#bcBT").textContent = q.title; Q("#bcBS").textContent = q.sub; Q("#bcBG").textContent = q.tag || "";
    Q("#bcBG").style.display = q.tag ? "" : "none"; Q("#bcBanner").classList.add("on");
    setTimeout(() => { Q("#bcBanner")?.classList.remove("on"); setTimeout(() => { S.showing = false; runQueue(); }, 800); }, 3400);
  }
  function pop(code) { const c = Q("#bcc-" + code); if (!c) return; c.classList.remove("pop"); void c.getBBox(); c.classList.add("pop"); }

  // ---------------------------------------------------------------- voting day
  async function paintTurnout(sum, times) {
    const cs = sum.map((r) => ({ ...r, p: r.electors_listed ? r.voted / r.electors_listed : 0 }));
    const V = cs.reduce((a, r) => a + +r.voted, 0), E = cs.reduce((a, r) => a + +r.electors_listed, 0), P = E ? V / E : 0;
    const byC = {}; times.forEach((t) => { const o = (byC[t.constituency_id] = byC[t.constituency_id] || { n: 0, open: 0, closed: 0, first: null }); o.n++;
      if (t.opened_at) { o.open++; if (!o.first || t.opened_at < o.first) o.first = t.opened_at; } if (t.closed_at) o.closed++; });
    const nOpen = times.filter((t) => t.opened_at && !t.closed_at).length, nClosed = times.filter((t) => t.closed_at).length, nAll = times.length;
    const first = times.map((t) => t.opened_at).filter(Boolean).sort()[0];
    const close = SETTINGS?.poll_close ? new Date(SETTINGS.poll_close) : null, mins = close ? Math.round((close - API.now()) / 60000) : null;
    Q("#bcTop").innerHTML = `<div class="bcturn"><div class="big num">${f(V)}</div><div class="lbl">HAVE VOTED<span>${E ? (P * 100).toFixed(1) + "% of " + f(E) + " registered voters" : "register not loaded yet"}</span></div>
      <div class="st">${nAll ? `<b class="num">${nOpen}</b> stations open · <b class="num">${nClosed}</b> closed · ${nAll} in all` : ""}${first ? `<br>First station opened ${hm12(first)}` : ""}${mins !== null ? `<br>${mins > 0 ? `Polls close in <b>${Math.floor(mins / 60)}h ${mins % 60}m</b>` : "<b>Polls have closed</b>"}` : ""}</div></div>
      <div class="bcbar"><div class="seg" style="width:${Math.min(100, P * 100)}%;background:#FCD116"></div>${[25, 50, 75].map((m) => `<div class="tickm" style="left:${m}%"><span>${m}%</span></div>`).join("")}</div>`;
    [25, 50, 60, 70].forEach((m) => { if (P * 100 >= m && !S.miles.has(m)) { S.miles.add(m); if (S.ready) tick(`Turnout passes <b>${m}%</b> across Dominica`); } });
    Q("#bcMapH").textContent = "TURNOUT · % OF REGISTERED VOTERS WHO HAVE VOTED";
    const ps = cs.filter((r) => r.voted && r.electors_listed).map((r) => r.p), lo = ps.length ? Math.min(...ps) : 0, hi = ps.length ? Math.max(...ps) : 1;
    const wOf = (p) => 0.15 + 0.85 * (hi - lo > 0.005 ? (p - lo) / (hi - lo) : 1);
    Q("#bcKey").innerHTML = ps.length ? `<span>${(lo * 100).toFixed(0)}%</span><span class="ramp"></span><span>${(hi * 100).toFixed(0)}% · brightest = highest turnout</span>` : "";
    cs.forEach((r) => { const cell = Q("#bcc-" + r.code), lab = Q("#bcl-" + r.code); if (!cell) return;
      cell.setAttribute("fill", r.voted ? mix("#FCD116", wOf(r.p)) : "#2F6B4E"); cell.classList.remove("decl");
      lab.textContent = r.voted && r.code !== "RCE" ? Math.round(r.p * 100) + "%" : r.code; lab.setAttribute("fill", r.voted && wOf(r.p) > 0.55 ? "#022E1B" : "#fff"); lab.style.stroke = r.voted && wOf(r.p) > 0.55 ? "none" : "";
      const o = byC[r.constituency_id]; const prev = S.prev["o" + r.code] || 0;
      if (S.ready && o && o.open === o.n && prev < o.n) tick(`All polling stations open in <b>${e(r.name)}</b>`);
      if (o) S.prev["o" + r.code] = o.open; });
    const top = cs.filter((r) => r.electors_listed).sort((a, b) => b.p - a.p).slice(0, 7);
    Q("#bcFeatH").textContent = "WHICH CONSTITUENCY IS VOTING THE MOST?";
    Q("#bcFeatIn").innerHTML = top.map((r, i) => `<div class="bcrank"><div class="pos">${i + 1}</div><div class="nm">${e(r.name)}<div class="track"><i style="width:${Math.min(100, r.p * 100 / 0.8)}%"></i></div></div><div class="v num">${(r.p * 100).toFixed(1)}%<small>${f(r.voted)}</small></div></div>`).join("")
      || `<div class="bcempty">Turnout figures appear here as soon as stations report.</div>`;
    Q("#bcTiles").innerHTML = cs.map((r) => { const o = byC[r.constituency_id];
      const st = !o ? "" : o.closed === o.n && o.n ? "ALL CLOSED" : o.open === o.n && o.n ? "ALL OPEN" : o.open ? `${o.open}/${o.n} OPEN` : "NOT OPEN YET";
      return `<div class="bctile" style="--c:${r.voted ? mix("#FCD116", wOf(r.p)) : "#2F6B4E"}"><div class="tn">${e(r.name)}</div>
        <div class="ts"><span>${st}${o?.first ? " · " + hm12(o.first) : ""}</span><b>${r.electors_listed ? (r.p * 100).toFixed(1) + "%" : ""}</b></div><div class="ts"><span class="num">${f(r.voted)} / ${f(r.electors_listed)}</span></div></div>`; }).join("");
  }

  // ---------------------------------------------------------------- count night
  function paintResults(rows, plist) {
    const pname = (c) => (plist || []).find((p) => p.id === c.party_id)?.name;
    const keyOf = (c) => c.party_id || "ind:" + c.name;
    const parties = {}, ord = [];
    const S2 = rows.map((r) => { const cs = r.candidates || [], sum = cs.reduce((a, c) => a + +c.votes, 0), L = sum ? cs[0] : null;
      const st = !r.stations_counted ? "none" : r.stations_counted < r.stations_total ? "counting" : r.stations_total && r.stations_official >= r.stations_total ? "decl" : "proj";
      const tie = L && cs[1] && +cs[1].votes === +L.votes;
      if (L && !tie) { const k = keyOf(L); if (!parties[k]) { parties[k] = { name: L.party_id ? pname(L) || L.party : L.name + " (Independent)", short: L.party, color: L.color, d: 0, pr: 0, lead: 0 }; ord.push(k); } }
      return { r, cs, sum, L: tie ? null : L, st, margin: sum && L ? (L.votes - (cs[1]?.votes || 0)) / sum : 0 }; });
    S2.forEach((x) => { if (!x.L) return; const p = parties[keyOf(x.L)]; if (x.st === "decl") p.d++; else if (x.st === "proj") p.pr++; else p.lead++; });
    ord.sort((a, b) => parties[b].d + parties[b].pr - (parties[a].d + parties[a].pr) || parties[b].lead - parties[a].lead);
    const called = S2.filter((x) => x.st === "proj" || x.st === "decl").length, stDone = rows.reduce((a, r) => a + r.stations_counted, 0), stAll = rows.reduce((a, r) => a + r.stations_total, 0);
    Q("#bcTop").innerHTML = `<div class="bcrace">${ord.slice(0, 4).map((k) => { const p = parties[k]; return `<div class="pc"><div class="sw" style="background:${p.color}"></div><div class="n num">${p.d + p.pr}</div><div class="l">${e(p.name).toUpperCase()}<span>seats won · leading in ${p.lead}</span></div></div>`; }).join("") || '<div class="pc"><div class="l">WAITING FOR THE FIRST STATION COUNTS</div></div>'}
      <div class="tot">STATIONS COUNTED <b class="num">${stDone} / ${stAll}</b><br>CONSTITUENCIES CALLED <b class="num">${called} / 21</b></div></div>
      <div class="bcbar">${ord.map((k) => { const p = parties[k]; return `<div class="seg" style="width:${p.d / 21 * 100}%;background:${p.color}"></div><div class="seg proj" style="width:${p.pr / 21 * 100}%;background-color:${p.color}"></div>`; }).join("")}<div class="magic"><span>11 SEATS TO FORM THE GOVERNMENT</span></div></div>`;
    Q("#bcMapH").textContent = "RESULTS MAP · 21 CONSTITUENCIES";
    Q("#bcKey").innerHTML = `<span>▢ light = leading</span><span>■ solid = all stations counted</span><span>■ white edge = declared</span>`;
    let feat = S.feat;
    S2.forEach((x) => { const code = x.r.code, cell = Q("#bcc-" + code), lab = Q("#bcl-" + code); if (!cell) return;
      const col = x.L?.color; cell.setAttribute("fill", !col ? "#2F6B4E" : x.st === "counting" ? mix(col, 0.32 + 0.4 * Math.min(1, x.margin / 0.25)) : col);
      cell.classList.toggle("decl", x.st === "decl"); lab.textContent = code; lab.setAttribute("fill", "#fff");
      const was = S.prev[code];
      if (S.ready && was !== x.st) {
        if (x.st === "counting" && (!was || was === "none")) { tick(`First station count in from <b>${e(x.r.name)}</b>${x.L ? `: ${e(x.L.party)} ahead` : ""}`); feat = feat || code; }
        if (x.st === "proj" && x.L) { feat = code; pop(code); tick(`<b>${e(x.r.name)}</b>: ${e(x.L.party_id ? x.L.party : x.L.name)} wins on station counts · all ${x.r.stations_total} counted`);
          S.queue.push({ k: "PROJECTED", color: x.L.color, title: x.r.name.toUpperCase(), sub: `${x.L.name} (${x.L.party}) wins · ${(x.margin * 100).toFixed(1)}% ahead with all ${x.r.stations_total} stations counted`, tag: x.L.party }); }
        if (x.st === "decl" && x.L) { pop(code); tick(`Official count entered for every station in <b>${e(x.r.name)}</b>: ${e(x.L.party)} ✓`); }
      }
      S.prev[code] = x.st; });
    if (S.ready) ord.forEach((k) => { const p = parties[k]; if (p.d + p.pr >= 11 && S.majFor !== k) { S.majFor = k; S.queue.push({ maj: { name: p.name, n: p.d + p.pr, color: p.color } }); tick(`<b>${e(p.name)}</b> passes 11 seats: projected to form the government`); } });
    runQueue();
    if (!feat) { const c = S2.filter((x) => x.st !== "none").sort((a, b) => b.r.stations_counted / b.r.stations_total - a.r.stations_counted / a.r.stations_total)[0]; feat = c?.r.code; }
    S.feat = feat; const F = S2.find((x) => x.r.code === feat);
    if (!F) { Q("#bcFeatH").textContent = "POLLS HAVE CLOSED"; Q("#bcFeatIn").innerHTML = `<div class="bcempty">Every polling station counts its ballots. The totals appear here, live, as each one comes in.</div>`; }
    else { const col = F.L?.color || "#2F6B4E", win = F.st === "proj" || F.st === "decl";
      Q("#bcFeatH").textContent = win ? "JUST CALLED" : "LATEST COUNT";
      Q("#bcFeatIn").innerHTML = `<div class="fhead" style="background:${win ? col : mix(col, 0.5)}"><div class="st">${F.st === "decl" ? "OFFICIAL COUNT ENTERED FOR EVERY STATION" : win ? "PROJECTED WINNER · ALL STATIONS COUNTED" : "COUNTING"}</div><div class="nm">${e(F.r.name)}</div>
        <div class="sub">${F.L ? (win ? `${e(F.L.name)} (${e(F.L.party)}) wins` : `${e(F.L.party)} leads by ${f(F.L.votes - (F.cs[1]?.votes || 0))} votes`) : "Level"}</div></div>` +
        F.cs.map((c, i) => `<div class="cand ${win && i === 0 ? "win" : ""}"><div class="who">${e(c.name)}<span>${e(c.party)}</span></div><div class="v num">${f(c.votes)}<small>${F.sum ? (c.votes / F.sum * 100).toFixed(1) : 0}%</small></div><div class="track"><i style="width:${F.sum ? c.votes / F.sum * 100 : 0}%;background:${c.color}"></i></div></div>`).join("") +
        `<div class="fmeta"><div>STATIONS COUNTED<b class="num">${F.r.stations_counted} / ${F.r.stations_total}</b></div><div>BALLOTS COUNTED<b class="num">${f(F.r.ballots)}</b></div><div>REJECTED<b class="num">${f(F.r.rejected)}</b></div></div>`; }
    Q("#bcTiles").innerHTML = S2.map((x) => { const col = x.L?.color || "#2F6B4E";
      const lab = x.st === "none" ? "NOT COUNTED" : x.st === "counting" ? `${e(x.L?.party || "LEVEL")} LEADS · ${x.r.stations_counted}/${x.r.stations_total}` : x.st === "proj" ? `<b>${e(x.L?.party)}</b> · PROJECTED` : `<b>${e(x.L?.party)}</b> · OFFICIAL ✓`;
      return `<div class="bctile ${x.st}" style="--c:${col};${x.st === "proj" || x.st === "decl" ? `background:${mix(col, 0.55)}` : ""}"><div class="tn">${e(x.r.name)}</div><div class="ts"><span>${lab}</span><b>${x.sum ? (x.margin * 100).toFixed(1) + "%" : ""}</b></div></div>`; }).join("");
  }

  async function load() {
    if (!Q("#bcStage")) return;
    Q("#bcClk").textContent = hm(API.now().toISOString());
    try { SETTINGS = await API.appSettings(); } catch (x) {}
    const closed = SETTINGS?.polls_closed, media = SETTINGS?.media;
    if (!SETTINGS?.national) { Q("#bcWait").classList.remove("hide");
      Q("#bcWaitS").textContent = media && !media.live ? `Your package shows the results from ${hm12(SETTINGS.poll_close)}, when the polls close.` : "This screen is not available on your login.";
      return; }
    Q("#bcWait").classList.add("hide");
    if (!S.manual) S.mode = closed ? "results" : "turnout";
    $$("#bcCtl [data-m]").forEach((b) => b.classList.toggle("on", b.dataset.m === S.mode));
    if (S.mode !== S.drawn) { S.drawn = S.mode; S.prev = {}; S.ready = false; S.feat = null; S.queue = []; }
    if (S.mode === "results") { const [res, pl] = await Promise.all([API.nationalResults(), API.parties().catch(() => [])]); paintResults(res, pl); }
    else { const [sum, times] = await Promise.all([API.nationalSummary(), API.stationTimes(null)]); await paintTurnout(sum, times); }
    if (!S.ready) { S.ready = true; tick(S.mode === "results" ? "Polls closed. Station counts appear here as they come in" : "Polling stations are open across Dominica"); }
  }

  W.viewBroadcast = async function () {
    const label = [SETTINGS?.media ? "ON " + String(SETTINGS.media.outlet).toUpperCase() : "", API.mode === "demo" ? "DEMO · MADE-UP DATA" : ""].filter(Boolean).join(" · ");
    const canSwitch = ME.role !== "media";
    $("#main").innerHTML = `<div class="row noprint" id="bcCtl" style="margin-bottom:10px">
        ${canSwitch ? `<div class="seg"><button data-m="turnout">🗳 Voting day</button><button data-m="results">📊 Count night</button></div><button class="btn sm ghost" data-m="auto">Automatic</button>` : ""}
        <button class="btn sm" id="bcFs">⛶ Full screen</button>
        <span class="small muted">${API.mode === "demo" ? "Press Esc to leave full screen." : "Full screen, then stream this window with OBS Studio or StreamYard to Facebook, YouTube or TikTok. Press Esc to leave full screen."}</span></div>
      <div id="bcWrap">${stageHTML(label)}</div>`;
    addWatermark(Q("#bcWrap"));
    drawMapSVG(); S = { ...S, prev: {}, queue: [], showing: false, ticks: [], ready: false, drawn: null, feat: null };
    $$("#bcCtl [data-m]").forEach((b) => (b.onclick = () => { if (b.dataset.m === "auto") S.manual = false; else { S.manual = true; S.mode = b.dataset.m; } load(); }));
    Q("#bcFs").onclick = () => { const w = Q("#bcWrap"); (w.requestFullscreen ? w.requestFullscreen() : Promise.reject()).catch(() => toast("Full screen is not available here.", true)); };
    document.onfullscreenchange = fit; W.onresize = fit; fit();
    clearInterval(S.timer); S.timer = setInterval(() => { if (!Q("#bcStage")) return clearInterval(S.timer); Q("#bcClk").textContent = hm(API.now().toISOString()); }, 1000);
    REFRESH = load; await load();
  };
})();
