const $ = id => document.getElementById(id), N = "http://www.w3.org/2000/svg";
const WINDOWS = [["7d", "7 days"], ["4w", "4 weeks"], ["6m", "6 months"], ["1y", "12 months"], ["all", "All time"]];
let win = "4w", socket = null, myId = null;
const fmt = m => { m = Math.round(m); return m >= 60 ? Math.floor(m / 60) + "h " + m % 60 + "m" : m + "m" };
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hue = s => [...String(s)].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 360;
const cover = (t, sz = 44) => `<div class="cover" style="width:${sz}px;height:${sz}px;font-size:${sz / 2.4}px;background:linear-gradient(135deg,hsl(${hue(t)} 60% 52%),hsl(${(hue(t) + 70) % 360} 55% 28%))">${esc((t || "?")[0].toUpperCase())}</div>`;
const el = (t, a, x) => { const e = document.createElementNS(N, t); for (const k in a) e.setAttribute(k, a[k]); if (x != null) e.textContent = x; return e };
const api = async (path, opts) => { const r = await fetch(path, { credentials: "include", headers: opts?.body ? { "Content-Type": "application/json" } : {}, ...opts }); let j = null; try { j = await r.json() } catch { } return { ok: r.ok, status: r.status, j } };

// ---- bootstrap ----
async function start() {
  const r = await api("/me");
  if (!r.ok) { $("auth").classList.remove("hide"); $("app").classList.add("hide"); return }
  const me = r.j.user; myId = me.id;
  if (me.connected?.includes('spotify')) {
  document.querySelector('a[href="/auth/spotify"]').outerHTML = '<span class="pill live">Connected</span>';
}
  $("auth").classList.add("hide"); $("app").classList.remove("hide");
  $("nm").textContent = me.display_name; $("av").textContent = (me.display_name || "?")[0].toUpperCase(); $("av").style.background = `hsl(${hue(me.display_name)} 70% 65%)`;
  $("myhandle").textContent = "@" + me.handle;
  connectSocket();
  load(); friends();
}
$("out").onclick = async () => { await api("/auth/logout", { method: "POST" }); if (socket) socket.disconnect(); location.reload() };

function tab(t) {
  [...$("tabs").children].forEach(x => x.setAttribute("aria-pressed", x.dataset.t === t));
  ["overview", "friends", "connect"].forEach(k => $("t-" + k).classList.toggle("hide", k !== t));
  if (t === "friends") friends();
}
$("tabs").onclick = e => { const b = e.target.closest("button"); if (b) tab(b.dataset.t) };
$("go-connect").onclick = () => tab("connect");

// ---- overview ----
$("range").innerHTML = WINDOWS.map(([k, l]) => `<button aria-pressed="${k === win}" data-w="${k}">${l}</button>`).join("");
$("range").onclick = e => { const b = e.target.closest("button"); if (!b) return; win = b.dataset.w; [...$("range").children].forEach(x => x.setAttribute("aria-pressed", x === b)); load() };

async function load() {
  const r = await api(`/me/stats?window=${win}`);
  if (!r.ok) return;
  const d = r.j;
  $("empty").classList.toggle("hide", d.summary.plays > 0);
  $("data").classList.toggle("hide", !d.summary.plays && win === "all");
  $("mins").textContent = fmt(d.summary.minutes);
  $("plays").textContent = d.summary.plays.toLocaleString();
  $("songs").textContent = d.summary.songs.toLocaleString();
  $("artistsN").textContent = d.summary.artists.toLocaleString();
  const split = {}; for (const s of d.split) split[s.platform] = s.share;
  const sp = split.spotify || 0, yt = split.ytmusic || 0;
  $("plat").innerHTML = `<div class="split"><i style="width:${sp}%;background:var(--sp)"></i><i style="width:${yt}%;background:var(--yt)"></i></div>
    <div class="lab"><span class="dot" style="background:var(--sp)"></span>Spotify ${sp}%</div>
    <div class="lab"><span class="dot" style="background:var(--yt)"></span>YouTube Music ${yt}%</div>`;
  $("vel").textContent = d.velocity.ratio > 1.15 ? `Heavy phase — ${d.velocity.recent.toFixed(1)} plays/day, above your usual ${d.velocity.base.toFixed(1)}`
    : d.velocity.ratio < 0.85 ? `Quieter than usual — ${d.velocity.recent.toFixed(1)} plays/day vs your ${d.velocity.base.toFixed(1)} baseline`
    : `Steady — ${d.velocity.recent.toFixed(1)} plays/day, close to your usual ${d.velocity.base.toFixed(1)}`;
  radar(d.radar);
  clock(d.clock);
  const mxA = Math.max(1, ...d.artists.map(a => a.minutes));
  $("artists").innerHTML = d.artists.slice(0, 8).map((a, i) => `<li><span class="rank">${i + 1}</span>${cover(a.name, 40)}<span class="grow"><b>${esc(a.name)}</b><div class="bar2"><i style="width:${a.minutes / mxA * 100}%"></i></div></span><span class="pill">${fmt(a.minutes)}</span></li>`).join("") || '<li class="lab">Nothing yet</li>';
  $("tracks").innerHTML = d.tracks.slice(0, 10).map((t, i) => `<li><span class="rank">${i + 1}</span>${cover(t.title, 44)}<span class="grow"><b>${esc(t.title)}</b><span class="lab">${esc(t.artist)}</span></span><span class="pill">${t.plays} plays · ${fmt(t.minutes)}</span></li>`).join("") || '<li class="lab">Nothing yet</li>';
}
function radar(v) {
  const AX = ["Energy", "Dance", "Valence", "Acoustic", "Instrum."], vals = [v.energy, v.danceability, v.valence, v.acousticness, v.instrumentalness];
  const s = $("radar"); s.innerHTML = "";
  if (!vals.some(x => x > 0)) { $("radarnote").textContent = "No audio-feature data yet — this needs an older Spotify developer app (the endpoint is restricted for new ones)."; return }
  $("radarnote").textContent = "Average audio traits, time-weighted";
  const cx = 150, cy = 130, R = 95, pt = (i, r) => { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; return (cx + r * Math.cos(a)).toFixed(1) + "," + (cy + r * Math.sin(a)).toFixed(1) };
  [.25, .5, .75, 1].forEach(k => s.append(el("polygon", { points: AX.map((_, i) => pt(i, R * k)).join(" "), fill: "none", stroke: "var(--line)" })));
  AX.forEach((l, i) => { const [x, y] = pt(i, R + 18).split(","); s.append(el("text", { x, y, "text-anchor": "middle", "dominant-baseline": "middle" }, l)) });
  s.append(el("polygon", { points: vals.map((v, i) => pt(i, R * v)).join(" "), fill: "var(--amb)", "fill-opacity": .3, stroke: "var(--amb)", "stroke-width": 2 }));
}
function clock(rows) {
  const h = Array(24).fill(0); for (const r of rows) h[r.hour] = r.minutes;
  const s = $("clock"); s.innerHTML = ""; const cx = 120, cy = 120, r1 = 44, r2 = 100, mx = Math.max(1, ...h);
  h.forEach((v, i) => {
    const a0 = i * Math.PI / 12 - Math.PI / 2, a1 = a0 + Math.PI / 12 - .03, p = (r, a) => (cx + r * Math.cos(a)).toFixed(1) + " " + (cy + r * Math.sin(a)).toFixed(1), r = r1 + (r2 - r1) * (.35 + .65 * v / mx);
    const w = el("path", { d: `M${p(r1, a0)}L${p(r, a0)}A${r} ${r} 0 0 1 ${p(r, a1)}L${p(r1, a1)}A${r1} ${r1} 0 0 0 ${p(r1, a0)}Z`, fill: "#ffb454", "fill-opacity": (.15 + .85 * v / mx).toFixed(2) });
    w.append(el("title", {}, i + ":00 · " + fmt(v))); s.append(w);
  });
  [[0, "12am"], [6, "6am"], [12, "12pm"], [18, "6pm"]].forEach(([x, t]) => { const a = x * Math.PI / 12 - Math.PI / 2 + Math.PI / 24; s.append(el("text", { x: cx + (r2 + 16) * Math.cos(a), y: cy + (r2 + 16) * Math.sin(a), "text-anchor": "middle", "dominant-baseline": "middle" }, t)) });
  const pk = h.indexOf(mx); if (h[pk] > 0) { s.append(el("text", { x: cx, y: cy + 2, "text-anchor": "middle", style: "font-size:20px;font-weight:800;fill:#f1ecff" }, (pk % 12 || 12) + (pk < 12 ? "am" : "pm"))); s.append(el("text", { x: cx, y: cy + 16, "text-anchor": "middle" }, "peak hour")) }
}

// ---- friends ----
async function friends() {
  const [fr, ct] = await Promise.all([api("/friends"), api("/contests/current")]);
  const top = Math.max(1, ...ct.j.board.map(x => x.minutes));
  $("board").innerHTML = ct.j.board.map((x, i) => `<li><span class="rank">${i === 0 && x.minutes ? "👑" : i + 1}</span><span class="av" style="background:hsl(${hue(x.display_name)} 70% 65%)">${esc((x.display_name || "?")[0].toUpperCase())}</span><span class="grow"><b>${esc(x.display_name)}${x.id === myId ? " (you)" : ""}</b><div class="bar2"><i style="width:${x.minutes / top * 100}%"></i></div></span><span class="pill">${fmt(x.minutes)}</span></li>`).join("") || '<li class="lab">Add a friend to start a contest</li>';
  $("cmpick").innerHTML = fr.j.filter(x => x.id !== myId).map(x => `<button class="sm" data-i="${x.id}">${esc(x.display_name)}</button>`).join("") || '<span class="lab">Add a friend by handle first</span>';
  $("live").innerHTML = '<li class="lab">Live updates appear here the moment a friend starts a song</li>';
}
$("fadd").onclick = async () => {
  const h = $("fh").value.trim().replace(/^@/, ""); if (!h) return;
  const r = await api("/friends/" + encodeURIComponent(h), { method: "POST" });
  $("fmsg").textContent = r.ok ? "Added. They won't see you until they add you back." : (r.j?.error === "no such user" ? "No one has that handle" : "Something went wrong");
  if (r.ok) { $("fh").value = ""; friends(); if (socket) { socket.disconnect(); connectSocket() } } // rejoin friend rooms
};
$("cmpick").onclick = async e => {
  const b = e.target.closest("button"); if (!b) return;
  const r = await api("/friends/" + b.dataset.i + "/compat");
  if (!r.ok) return;
  const d = r.j;
  $("cmp").innerHTML = `<div class="row" style="gap:28px"><div><div class="big" style="font-size:48px">${d.score}%</div><div class="lab">taste match</div></div><div><div class="big" style="font-size:48px">${d.shared.length}</div><div class="lab">shared artists</div></div><div><div class="big" style="font-size:48px">${d.drift}</div><div class="lab">aesthetic drift</div></div></div><p class="lab">${d.shared.length ? "You both play " + d.shared.map(esc).join(", ") : "No shared artists in the last 4 weeks"}</p>`;
};

// ---- live sockets ----
function connectSocket() {
  socket = io({ withCredentials: true });
  socket.on("now", p => {
    if (!p.track) return; // idle event
    const li = document.querySelector(`#live li[data-u="${p.userId}"]`) || liveRow(p.userId);
    li.innerHTML = `${cover(p.track.title, 44)}<span class="grow"><b>${esc(p.track.title)}</b><span class="lab">${esc(p.track.artist)}${p.userId === myId ? " · you" : ""}</span></span><span class="pill live">${p.state === "playing" ? "Live" : "Paused"}</span>`;
    if (p.userId === myId) $("live1").innerHTML = `${cover(p.track.title, 72)}<div class="grow"><div class="lab">Playing now</div><h2 style="font-size:20px">${esc(p.track.title)}</h2><div class="lab">${esc(p.track.artist)}</div></div>`;
  });
  socket.on("scrobble", () => load());
}
function liveRow(uid) {
  const placeholder = $("live").querySelector("li.lab"); if (placeholder) placeholder.remove();
  const li = document.createElement("li"); li.dataset.u = uid; $("live").append(li); return li;
}

start();
