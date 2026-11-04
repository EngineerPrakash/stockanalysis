/* Global Stock Analyzer dashboard.
 *
 * Two modes, detected at start-up:
 *   live    - served by stock_analyzer/server.py: live prices, market browser, live news, watchlist editing
 *   static  - GitHub Pages: reads the daily snapshot written by stock_analyzer/site.py
 */
"use strict";

// ---------- constants ------------------------------------------------------------------
const ORDER = ["india", "us", "china", "europe"];
const SESSIONS = {          // regular hours in exchange-local time (holidays not accounted for)
  india: { tz: "Asia/Kolkata", open: 555, close: 930 },       // 09:15–15:30
  us: { tz: "America/New_York", open: 570, close: 960 },      // 09:30–16:00
  china: { tz: "Asia/Shanghai", open: 570, close: 900 },      // 09:30–15:00
  europe: { tz: "Europe/Berlin", open: 540, close: 1050 },    // 09:00–17:30
};
const SHORT = { india: "India", us: "US", china: "China / HK", europe: "Europe" };
const NAMES = { india: "India", us: "United States", china: "China / Hong Kong", europe: "Europe" };
const RATINGS = ["Strong Buy", "Buy", "Hold", "Reduce", "Sell"];
const CURRENCY = { INR: "₹", USD: "$", CNY: "¥", HKD: "HK$", EUR: "€", GBP: "£", JPY: "¥" };
const MAX_BIAS = 5;
const RANGES = [["1D", -1], ["1M", 22], ["3M", 66], ["6M", 130], ["1Y", 0]];
const POLL_QUOTES = 60_000;
const POLL_NEWS = 120_000;

const state = { live: false, auth: false, latest: null, scores: null, series: {}, charts: [], cleanup: [], newsSeen: new Set() };
const ui = {
  ov: { market: "all", query: "", sortKey: "score", sortDir: -1 },
  mk: { query: "", sector: "", sortKey: "score", sortDir: -1, watchedOnly: false },
  news: { market: "", scope: "market" },
};
const app = document.getElementById("app");

// ---------- helpers ----------------------------------------------------------------------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");
const num = (v, d = 2) => (v == null || isNaN(v) ? "–" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (v, d = 2) => (v == null || isNaN(v) ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`);
const dir = (v) => (v > 0 ? "up" : v < 0 ? "down" : "flat");
const route = (sym) => `#/s/${encodeURIComponent(sym)}`;
const safeName = (s) => s.replace(/[^A-Za-z0-9.-]/g, "_");
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const passed = (r) => r.checklist.filter((c) => c[1]).length;
const marketOf = (sym) => {
  const s = sym.toUpperCase();
  if (/\.(NS|BO)$/.test(s)) return "india";
  if (/\.(SS|SZ|HK)$/.test(s)) return "china";
  if (/\.[A-Z]{1,2}$/.test(s)) return "europe";
  return "us";
};

function price(v, cur) {
  if (cur === "GBp") return `${num(v)}p`;
  const sym = CURRENCY[cur];
  return sym ? `${sym}${num(v)}` : `${num(v)} ${esc(cur)}`;
}

function tone(rating) {
  return { "Strong Buy": "tone-good strong", Buy: "tone-good", Hold: "tone-neutral", Reduce: "tone-warn", Sell: "tone-bad" }[rating] || "tone-neutral";
}
const toneBase = (rating) => tone(rating).split(" ")[0];

const ICONS = {
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  refresh: '<path d="M21 12a9 9 0 11-2.6-6.4M21 4v5h-5"/>',
};
const icon = (name, size = 14, cls = "", fill = false) =>
  `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

function chg(v) {
  const d = dir(v);
  return `<span class="chip ${d}">${d === "flat" ? "" : icon(d, 11)}${pct(v)}</span>`;
}
const ratingTag = (r) => `<span class="rating ${tone(r)}">${esc(r)}</span>`;

function spark(values, forceDir) {
  const v = (values || []).filter((x) => x != null);
  if (v.length < 2) return "";
  const w = 120, h = 36, min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * w, h - 3 - ((y - min) / span) * (h - 6)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");
  const k = forceDir || (v[v.length - 1] >= v[0] ? "up" : "down");
  return `<svg class="spark ${k}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path class="spark-area" d="${d}L${w} ${h}L0 ${h}Z"/><path class="spark-line" d="${d}" vector-effect="non-scaling-stroke"/></svg>`;
}

function ring(score, rating, size = 46) {
  const r = 19, c = 2 * Math.PI * r;
  return `<svg class="ring ${toneBase(rating)}" width="${size}" height="${size}" viewBox="0 0 46 46" role="img" aria-label="Score ${score} of 100">
    <circle class="ring-track" cx="23" cy="23" r="${r}" stroke-width="4.5"/>
    <circle class="ring-val" cx="23" cy="23" r="${r}" stroke-width="4.5" stroke-dasharray="${((c * score) / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 23 23)"/>
    <text x="23" y="27.5" text-anchor="middle">${score}</text></svg>`;
}

function scorebar(r) {
  return `<span class="scorebar"><span class="track"><span class="fill ${toneBase(r.rating)}" style="width:${r.score}%"></span></span>${r.score}</span>`;
}

function starBtn(sym, watched) {
  const dis = state.live ? "" : ` disabled title="Run the live app to edit the watchlist"`;
  return `<button type="button" class="star" data-star="${esc(sym)}" aria-pressed="${!!watched}" aria-label="${watched ? "Remove" : "Add"} ${esc(sym)} ${watched ? "from" : "to"} watchlist"${dis}>${icon("star", 17, "", watched)}</button>`;
}

function ago(iso) {
  if (!iso) return "";
  const t = new Date(iso);
  if (isNaN(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

function session(code) {
  const s = SESSIONS[code];
  if (!s) return { open: false, local: "" };
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: s.tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  const h = Number(parts.hour) % 24, m = Number(parts.minute);
  const weekday = !["Sat", "Sun"].includes(parts.weekday);
  const t = h * 60 + m;
  return { open: weekday && t >= s.open && t < s.close, local: `${String(h).padStart(2, "0")}:${parts.minute}` };
}

async function getJSON(path) {
  const r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { msg = (await r.json()).detail || msg; } catch { /* not JSON */ }
    const err = new Error(msg); err.status = r.status; throw err;
  }
  return r.json();
}

function allResults(snap) {
  return ORDER.flatMap((c) => (snap.markets[c]?.results || []).map((r) => ({ ...r, _market: c })));
}

function watchedSet() {
  return new Set(state.latest ? allResults(state.latest).map((r) => r.symbol) : []);
}

function signalsFor(r) {
  const out = [];
  if (r.macd_state === "Bullish crossover") out.push(["good", "MACD bullish crossover"]);
  if (r.macd_state === "Bearish crossover") out.push(["bad", "MACD bearish crossover"]);
  [...r.signals, ...r.risks].forEach((t) => {
    if (t.startsWith("Golden cross")) out.push(["good", "Golden cross (MA50 > MA200)"]);
    if (t.startsWith("Death cross")) out.push(["bad", "Death cross (MA50 < MA200)"]);
  });
  if (r.rsi < 30) out.push(["good", `Oversold · RSI ${Math.round(r.rsi)}`]);
  if (r.rsi > 70) out.push(["warn", `Overbought · RSI ${Math.round(r.rsi)}`]);
  if (r.bias_ma5_pct > MAX_BIAS) out.push(["warn", `Extended ${pct(r.bias_ma5_pct, 1)} vs MA5`]);
  if (r.volume_ratio > 1.8) out.push([r.change_pct >= 0 ? "good" : "bad", `Volume ${r.volume_ratio.toFixed(1)}× on ${r.change_pct >= 0 ? "up" : "down"} day`]);
  return out;
}

function clearPage() {
  state.cleanup.forEach((fn) => { try { fn(); } catch { /* already gone */ } });
  state.cleanup = [];
  state.charts.forEach((c) => { try { c.remove(); } catch { /* disposed */ } });
  state.charts = [];
}

/** Run fn every ms while this page is shown and the tab is visible. */
function every(ms, fn) {
  const id = setInterval(() => { if (!document.hidden) fn(); }, ms);
  state.cleanup.push(() => clearInterval(id));
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}

function sortRows(rows, key, sdir) {
  const rank = (r) => -RATINGS.indexOf(r.rating);
  return rows.sort((a, b) => {
    const av = key === "rating" ? rank(a) : a[key], bv = key === "rating" ? rank(b) : b[key];
    return (av > bv ? 1 : av < bv ? -1 : 0) * sdir;
  });
}

function sortHead(cols, key, sdir) {
  return `<thead><tr>${cols.map(([k, label, cls, nosort]) => nosort ? `<th class="${cls}">${label}</th>` :
    `<th class="${cls}" aria-sort="${k === key ? (sdir > 0 ? "ascending" : "descending") : "none"}"><button type="button" data-k="${k}">${label}${k === key ? icon(sdir > 0 ? "up" : "down", 11) : ""}</button></th>`).join("")}</tr></thead>`;
}

function stockRow(r, { star = false, sector = false } = {}) {
  return `<tr data-s="${esc(r.symbol)}" tabindex="0">
    ${star ? `<td class="star-cell">${starBtn(r.symbol, r.watched)}</td>` : ""}
    <td><span class="sym">${esc(r.symbol)}</span><span class="name">${esc(r.name)}${sector && r.sector ? ` <span class="sector">· ${esc(r.sector)}</span>` : ""}</span></td>
    <td class="spark-cell hide-sm">${spark(r.spark)}</td>
    <td class="r tnum">${price(r.close, r.currency)}<div class="show-sm">${chg(r.change_pct)}</div></td>
    <td class="r hide-sm">${chg(r.change_pct)}</td>
    <td class="r tnum hide-sm ${dir(r.change_1m_pct)}">${pct(r.change_1m_pct)}</td>
    <td class="r tnum hide-sm">${Math.round(r.rsi)}</td>
    <td>${scorebar(r)}</td>
    <td class="hide-sm">${ratingTag(r.rating)}</td></tr>`;
}

function stockCols(star) {
  return [
    ...(star ? [["", "", "star-cell", true]] : []),
    ["symbol", "Stock", ""], ["spark", "60 days", "hide-sm", true], ["close", "Price", "r"], ["change_pct", "Day", "r hide-sm"],
    ["change_1m_pct", "1 month", "r hide-sm"], ["rsi", "RSI", "r hide-sm"], ["score", "Score", ""], ["rating", "Rating", "hide-sm"],
  ];
}

/** Click/keyboard handling shared by stock tables: sorting, stars, open row. */
function wireTable(el, sortState, redraw) {
  el.onclick = async (e) => {
    const star = e.target.closest("[data-star]");
    if (star) { e.stopPropagation(); await toggleWatch(star.dataset.star, star.getAttribute("aria-pressed") !== "true", star); return; }
    const b = e.target.closest("th button");
    if (b) { const k = b.dataset.k; sortState.sortDir = k === sortState.sortKey ? -sortState.sortDir : k === "symbol" ? 1 : -1; sortState.sortKey = k; return redraw(); }
    const tr = e.target.closest("tr[data-s]");
    if (tr) location.hash = route(tr.dataset.s);
  };
  el.onkeydown = (e) => {
    const tr = e.target.closest("tr[data-s]");
    if (tr && e.target === tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); location.hash = route(tr.dataset.s); }
  };
}

// ---------- watchlist editing (live) ---------------------------------------------------------
async function toggleWatch(sym, on, btn) {
  if (!state.live) return;
  const send = async () => {
    let token = "";
    try { token = localStorage.getItem("adminToken") || ""; } catch { /* storage blocked */ }
    return fetch(`api/watchlist/${encodeURIComponent(sym)}`, { method: on ? "PUT" : "DELETE", headers: token ? { "X-Admin-Token": token } : {} });
  };
  if (btn) btn.disabled = true;
  try {
    let r = await send();
    if (r.status === 401) {
      const t = prompt("This app is protected. Enter the admin token to change the watchlist:");
      if (!t) return;
      try { localStorage.setItem("adminToken", t); } catch { /* storage blocked */ }
      r = await send();
    }
    if (!r.ok) { let m = `HTTP ${r.status}`; try { m = (await r.json()).detail || m; } catch { /* */ } toast(`Couldn't update watchlist: ${m}`); return; }
    document.querySelectorAll(`[data-star="${CSS.escape(sym)}"]`).forEach((b) => {
      b.setAttribute("aria-pressed", String(on)); b.innerHTML = icon("star", 17, "", on);
    });
    const wb = document.getElementById("watch-btn");
    if (wb && wb.dataset.sym === sym) paintWatchBtn(wb, on);
    state.latest = await getJSON("api/snapshot");
    fillSearchList();
    toast(on ? `Added ${sym} to your watchlist` : `Removed ${sym} from your watchlist`);
  } catch (e) {
    toast(`Couldn't update watchlist: ${e.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function paintWatchBtn(b, on) {
  b.setAttribute("aria-pressed", String(on));
  b.innerHTML = `${icon("star", 15, "", on)}${on ? "Watching" : "Add to watchlist"}`;
}

// ---------- overview ---------------------------------------------------------------------
function marketTile(code, m) {
  const s = session(code);
  const [main, ...rest] = m.indices;
  const res = m.results || [];
  const up = res.filter((r) => r.change_pct > 0).length, down = res.filter((r) => r.change_pct < 0).length;
  const flat = res.length - up - down;
  return `<article class="card mkt">
    <div class="mkt-top">
      <a class="mkt-name" href="#/markets/${code}" style="color:inherit">${esc(m.name)}</a>
      <span class="status ${s.open ? "open" : ""}" title="Regular trading hours; exchange holidays are not accounted for"><span class="dot"></span>${s.open ? "Open" : "Closed"} · ${esc(s.local)}</span>
    </div>
    ${main ? `<div class="mkt-main">
      <div class="label">${esc(main.label)}</div>
      <div class="row"><span class="value">${num(main.close, 2)}</span>${chg(main.change_pct)}</div>
    </div>
    ${spark(main.spark)}` : `<div class="muted small">No index data</div>`}
    ${rest.length ? `<div class="mkt-sub">${rest.map((i) => `<div><span>${esc(i.label)}</span><span class="tnum">${num(i.close, 0)} <span class="${dir(i.change_pct)}">${pct(i.change_pct)}</span></span></div>`).join("")}</div>` : ""}
    ${res.length ? `<div class="breadth" title="Watchlist stocks up / flat / down today">
      <span class="up">${up}↑</span>
      <span class="breadth-bar">${up ? `<i class="b-up" style="flex:${up}"></i>` : ""}${flat ? `<i class="b-flat" style="flex:${flat}"></i>` : ""}${down ? `<i class="b-down" style="flex:${down}"></i>` : ""}</span>
      <span class="down">${down}↓</span></div>` : ""}
  </article>`;
}

function distSwatch(rt) {
  const v = { "Strong Buy": "var(--up-mark)", Buy: "color-mix(in srgb, var(--up-mark) 55%, var(--surface))", Hold: "var(--ma200)", Reduce: "var(--warn-mark)", Sell: "var(--down-mark)" }[rt];
  return `background:${v}`;
}

function liveNote(iso) {
  return state.live ? `<span class="refresh-note">${icon("refresh", 12)} Live · updated ${esc(ago(iso))}</span>` : "";
}

function renderOverview(snap, opts = {}) {
  const results = allResults(snap);
  const markets = ORDER.filter((c) => snap.markets[c]);
  const avg = results.length ? Math.round(results.reduce((a, r) => a + r.score, 0) / results.length) : 0;
  const advancers = results.filter((r) => r.change_pct > 0).length;
  const signals = results.flatMap((r) => signalsFor(r).map(([kind, text]) => ({ r, kind, text })));
  const counts = RATINGS.map((rt) => [rt, results.filter((r) => r.rating === rt).length]).filter(([, n]) => n);
  const top = results.filter((r) => r.score >= 60).sort((a, b) => b.score - a.score).slice(0, 6);
  const updated = new Date(snap.generated);
  const o = ui.ov;
  if (o.market !== "all" && !markets.includes(o.market)) o.market = "all";

  const setups = top.length ? `<div class="setups">${top.map((r) => `
    <a class="card setup" href="${route(r.symbol)}">
      <div class="setup-top">
        ${ring(r.score, r.rating)}
        <div class="setup-id"><div class="sym">${esc(r.symbol)}</div><div class="name">${esc(r.name)}</div></div>
        <div class="setup-px"><div class="price">${price(r.close, r.currency)}</div>${chg(r.change_pct)}</div>
      </div>
      ${spark(r.spark)}
      <div class="plan-mini">
        <div><span>Entry</span><b>${num(r.entry)}</b></div>
        <div><span>Stop</span><b>${num(r.stop_loss)}</b></div>
        <div><span>Target</span><b>${num(r.target)}</b></div>
      </div>
    </a>`).join("")}</div>` : `<div class="card empty">No stock scores Buy or better right now.</div>`;

  const groups = [["good", "Bullish", "up"], ["bad", "Bearish", "down"], ["warn", "Caution", "alert"]]
    .map(([kind, label, ic]) => [kind, label, ic, signals.filter((s) => s.kind === kind)]).filter((g) => g[3].length);
  const signalPanel = groups.length ? groups.map(([kind, label, ic, items]) => `
    <div class="signal-group">
      <h3><span class="ic-${kind}">${icon(ic, 13)}</span>${label} · ${items.length}</h3>
      <ul class="signal-list">${items.slice(0, 6).map((s) => `<li><a href="${route(s.r.symbol)}">${esc(s.r.symbol)}</a><span class="what">${esc(s.text)}</span></li>`).join("")}</ul>
    </div>`).join("") : `<div class="empty">No notable signals right now.</div>`;

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1>${opts.date ? `Snapshot · ${esc(opts.date)}` : "Market overview"}</h1>
        <p>${esc(updated.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}${state.live && !opts.date ? "" : ` · updated ${esc(ago(snap.generated))}`}</p>
      </div>
      ${opts.date ? "" : liveNote(snap.generated)}
    </div>
    ${snap.demo ? `<div class="banner">${icon("alert", 16)} Demo data: prices are synthetic.</div>` : ""}

    <section class="markets" aria-label="Markets">${markets.map((c) => marketTile(c, snap.markets[c])).join("")}</section>

    <section class="summary" aria-label="Watchlist summary">
      <div class="card kpi dist-card">
        <div class="label">Ratings across your ${results.length} watchlist stocks</div>
        <div class="dist" role="img" aria-label="${esc(counts.map(([r, n]) => `${r} ${n}`).join(", "))}">${counts.map(([rt, n]) => `<span style="flex:${n};${distSwatch(rt)}" title="${esc(rt)}: ${n}"></span>`).join("")}</div>
        <div class="dist-legend">${counts.map(([rt, n]) => `<span><i style="${distSwatch(rt)}"></i>${esc(rt)} <b>${n}</b></span>`).join("")}</div>
      </div>
      <div class="card kpi"><div class="label">Average score</div><div class="value">${avg}</div><div class="sub">out of 100</div></div>
      <div class="card kpi"><div class="label">Up today</div><div class="value">${advancers}<span class="muted" style="font-size:16px;font-weight:600"> / ${results.length}</span></div><div class="sub">${results.length ? Math.round((advancers / results.length) * 100) : 0}% of watchlist</div></div>
      <div class="card kpi"><div class="label">Signals</div><div class="value">${signals.length}</div><div class="sub">${groups.map(([, l, , i]) => `${i.length} ${l.toLowerCase()}`).join(" · ") || "none"}</div></div>
    </section>

    <div class="grid split section">
      <section><div class="section-head"><h2>Top setups</h2><span class="muted small">Score 60 or more, best first</span></div>${setups}</section>
      <section><div class="section-head"><h2>Signals</h2></div><div class="card pad">${signalPanel}</div></section>
    </div>

    <section class="section">
      <div class="section-head">
        <h2>Your watchlist</h2>
        <div class="toolbar">
          <div class="seg" id="mkt-seg" role="group" aria-label="Market">${["all", ...markets].map((c) => {
            const n = c === "all" ? results.length : results.filter((r) => r._market === c).length;
            return `<button type="button" data-m="${c}" aria-pressed="${c === o.market}">${c === "all" ? "All" : esc(SHORT[c] || snap.markets[c].name)}<span class="count">${n}</span></button>`;
          }).join("")}</div>
          <input id="filter" class="filter" type="search" placeholder="Filter by name or ticker" aria-label="Filter watchlist" value="${esc(o.query)}">
        </div>
      </div>
      <div class="card table-card"><div class="table-scroll" id="table"></div></div>
      ${state.live ? `<p class="muted small">Add or remove stocks with the ${icon("star", 12)} on the <a href="#/markets">Markets</a> page or any stock page.</p>` : ""}
    </section>

    ${(snap.errors || []).length ? `<details class="card pad section small"><summary>${icon("alert", 13)} ${snap.errors.length} ticker(s) could not be analysed</summary><ul>${snap.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></details>` : ""}`;

  const star = state.live && !opts.date;
  const draw = () => {
    const q = o.query.toLowerCase();
    const rows = sortRows(results.filter((r) => (o.market === "all" || r._market === o.market) &&
      (!q || r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))).map((r) => ({ ...r, watched: true })), o.sortKey, o.sortDir);
    document.getElementById("table").innerHTML = rows.length
      ? `<table>${sortHead(stockCols(star), o.sortKey, o.sortDir)}<tbody>${rows.map((r) => stockRow(r, { star })).join("")}</tbody></table>`
      : `<div class="empty">${results.length ? "No stocks match." : `Your watchlist is empty. ${state.live ? `Browse <a href="#/markets">Markets</a> and tap ${icon("star", 12)} to add stocks.` : ""}`}</div>`;
  };
  draw();
  document.getElementById("mkt-seg").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    o.market = b.dataset.m;
    document.querySelectorAll("#mkt-seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    draw();
  };
  document.getElementById("filter").oninput = (e) => { o.query = e.target.value.trim(); draw(); };
  wireTable(document.getElementById("table"), o, draw);

  if (state.live && !opts.date) {
    every(POLL_QUOTES, async () => {
      if (document.activeElement?.id === "filter") return;
      try { state.latest = await getJSON("api/snapshot"); const y = scrollY; renderOverview(state.latest); scrollTo(0, y); } catch { /* keep last */ }
    });
  }
}

// ---------- markets browser ----------------------------------------------------------------
async function renderMarkets(code) {
  code = ORDER.includes(code) ? code : (() => { try { return localStorage.getItem("market") || "india"; } catch { return "india"; } })();
  try { localStorage.setItem("market", code); } catch { /* storage blocked */ }
  const snapIdx = (c) => state.latest?.markets[c]?.indices?.[0];
  const k = ui.mk;

  app.innerHTML = `
    <div class="page-head">
      <div><h1>Markets</h1><p>Pick a country to see its largest stocks${state.live ? " with live prices and scores" : ""}.</p></div>
      <span id="mk-note">${liveNote(new Date().toISOString())}</span>
    </div>
    <div class="countries" role="group" aria-label="Country">${ORDER.map((c) => {
      const i = snapIdx(c);
      return `<button type="button" class="country" data-c="${c}" aria-pressed="${c === code}">
        <span class="c-name">${esc(NAMES[c])}<span class="status ${session(c).open ? "open" : ""}"><span class="dot"></span>${session(c).open ? "Open" : "Closed"}</span></span>
        <span class="c-idx">${i ? `${esc(i.label)} <b>${num(i.close, 0)}</b> <span class="${dir(i.change_pct)}">${pct(i.change_pct)}</span>` : "&nbsp;"}</span>
      </button>`;
    }).join("")}</div>
    <div id="mk-body"><div class="loading"><span class="spinner" aria-hidden="true"></span> Loading ${esc(NAMES[code])}…</div></div>`;

  app.querySelector(".countries").onclick = (e) => {
    const b = e.target.closest("[data-c]");
    if (b) { k.sector = ""; location.hash = `#/markets/${b.dataset.c}`; }
  };

  let data;
  const load = async () => {
    if (state.live) return getJSON(`api/markets/${code}`);
    const m = state.latest.markets[code] || { name: NAMES[code], indices: [], results: [] };
    return { ...m, code, stocks: m.results.map((r) => ({ ...r, watched: true })), sectors: [], unavailable: [], updated: state.latest.generated };
  };
  try { data = await load(); } catch (e) {
    document.getElementById("mk-body").innerHTML = `<div class="card empty down">Couldn't load ${esc(NAMES[code])}: ${esc(e.message)}</div>`;
    return;
  }

  const body = document.getElementById("mk-body");
  body.innerHTML = `
    ${state.live ? "" : `<div class="banner">${icon("alert", 16)} This is the daily snapshot, so only your watchlist is shown. Run the live app to browse every stock with live prices.</div>`}
    <div class="idx-strip" id="mk-idx"></div>
    <div class="section-head">
      <h2>${esc(data.name)} stocks <span class="muted" id="mk-count" style="font-weight:500"></span></h2>
      <div class="toolbar">
        <input id="mk-q" class="filter" type="search" placeholder="Filter or search any ticker" aria-label="Filter stocks" value="${esc(k.query)}">
        ${data.sectors?.length ? `<select id="mk-sector" class="filter" aria-label="Sector"><option value="">All sectors</option>${data.sectors.map((s) => `<option ${s === k.sector ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>` : ""}
        ${state.live ? `<button type="button" class="toggle" id="mk-watched" aria-pressed="${k.watchedOnly}" style="height:34px">${icon("star", 13, "", true)} Watchlist only</button>` : ""}
      </div>
    </div>
    <div id="mk-search"></div>
    <div class="card table-card"><div class="table-scroll" id="mk-table"></div></div>
    <p class="muted small" id="mk-foot"></p>`;

  const paint = () => {
    document.getElementById("mk-idx").innerHTML = data.indices.map((i) => `
      <div class="card idx-card"><div class="row"><span class="ink2 small">${esc(i.label)}</span>${chg(i.change_pct)}</div>
      <div class="row"><b style="font-size:18px" class="tnum">${num(i.close, 2)}</b><span class="small ${dir(i.change_1m_pct)}">1M ${pct(i.change_1m_pct)}</span></div>${spark(i.spark)}</div>`).join("");
    const q = k.query.toLowerCase();
    const rows = sortRows(data.stocks.filter((r) => (!k.sector || r.sector === k.sector) && (!k.watchedOnly || r.watched) &&
      (!q || r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))), k.sortKey, k.sortDir);
    document.getElementById("mk-count").textContent = `· ${rows.length}`;
    document.getElementById("mk-table").innerHTML = rows.length
      ? `<table>${sortHead(stockCols(true), k.sortKey, k.sortDir)}<tbody>${rows.map((r) => stockRow(r, { star: true, sector: true })).join("")}</tbody></table>`
      : `<div class="empty">No stocks match${q && state.live ? ". Results from a wider search appear above." : "."}</div>`;
    document.getElementById("mk-foot").innerHTML = (data.unavailable?.length ? `No data right now for ${data.unavailable.map(esc).join(", ")}. ` : "") +
      (state.live ? "Prices refresh every minute and may be delayed up to 15 minutes depending on the exchange. Scores use daily bars including today's." : "");
    const note = document.getElementById("mk-note");
    if (note) note.innerHTML = liveNote(data.updated);
  };
  paint();
  wireTable(document.getElementById("mk-table"), k, paint);

  let searchTimer;
  const remoteSearch = (q) => {
    clearTimeout(searchTimer);
    const box = document.getElementById("mk-search");
    if (!state.live || q.length < 2) { box.innerHTML = ""; return; }
    searchTimer = setTimeout(async () => {
      try {
        const { results } = await getJSON(`api/search?q=${encodeURIComponent(q)}`);
        const known = new Set(data.stocks.map((r) => r.symbol));
        const extra = results.filter((r) => !known.has(r.symbol));
        box.innerHTML = extra.length ? `<div class="card pad search-panel"><h3>Other matches</h3><ul>${extra.slice(0, 8).map((r) =>
          `<li><a href="${route(r.symbol)}"><span><b>${esc(r.symbol)}</b> <span class="muted">${esc(r.name)}</span></span><span class="tag">${esc(SHORT[r.market] || r.exchange)}</span></a></li>`).join("")}</ul></div>` : "";
      } catch { box.innerHTML = ""; }
    }, 350);
  };
  document.getElementById("mk-q").oninput = (e) => { k.query = e.target.value.trim(); paint(); remoteSearch(k.query); };
  if (k.query) remoteSearch(k.query);
  const sec = document.getElementById("mk-sector");
  if (sec) sec.onchange = (e) => { k.sector = e.target.value; paint(); };
  const wo = document.getElementById("mk-watched");
  if (wo) wo.onclick = () => { k.watchedOnly = !k.watchedOnly; wo.setAttribute("aria-pressed", String(k.watchedOnly)); paint(); };

  if (state.live) {
    every(POLL_QUOTES, async () => {
      try { data = await load(); if (document.activeElement?.id !== "mk-q") paint(); } catch { /* keep last */ }
    });
    const ticker = setInterval(() => { const n = document.getElementById("mk-note"); if (n) n.innerHTML = liveNote(data.updated); }, 15_000);
    state.cleanup.push(() => clearInterval(ticker));
  }
}

// ---------- news ----------------------------------------------------------------------------
async function renderNews() {
  const n = ui.news;
  app.innerHTML = `
    <div class="page-head">
      <div><h1>News</h1><p>${state.live ? "Latest headlines, refreshed every 2 minutes." : "Headlines collected by the last daily run."}</p></div>
      <span id="news-note"></span>
    </div>
    <div class="toolbar" style="margin-bottom:14px">
      <div class="seg" id="news-mkt" role="group" aria-label="Market">${["", ...ORDER].map((c) => `<button type="button" data-m="${c}" aria-pressed="${c === n.market}">${c ? esc(SHORT[c]) : "All markets"}</button>`).join("")}</div>
      ${state.live ? `<div class="seg" id="news-scope" role="group" aria-label="Scope"><button type="button" data-s="market" aria-pressed="${n.scope === "market"}">Market news</button><button type="button" data-s="watchlist" aria-pressed="${n.scope === "watchlist"}">My watchlist</button></div>` : ""}
    </div>
    <div class="card" id="feed"><div class="loading"><span class="spinner" aria-hidden="true"></span> Loading headlines…</div></div>`;

  let first = true;
  const load = async () => {
    if (state.live) return getJSON(`api/news?market=${n.market}&scope=${n.scope}`);
    const items = allResults(state.latest).filter((r) => !n.market || r._market === n.market)
      .flatMap((r) => (r.news || []).map((x) => ({ ...x, symbol: r.symbol, market: r._market })))
      .sort((a, b) => (b.published || "").localeCompare(a.published || ""));
    return { updated: state.latest.generated, items };
  };
  const draw = async () => {
    let data;
    try { data = await load(); } catch (e) {
      document.getElementById("feed").innerHTML = `<div class="empty down">Couldn't load news: ${esc(e.message)}</div>`; return;
    }
    const now = Date.now();
    const bucket = (iso) => {
      const t = new Date(iso);
      if (isNaN(t)) return "Earlier";
      const h = (now - t) / 3.6e6;
      return h < 1 ? "Last hour" : h < 6 ? "Last 6 hours" : h < 24 ? "Today" : "Earlier";
    };
    let last = "";
    const html = data.items.map((it) => {
      const b = bucket(it.published);
      const key = it.title;
      const fresh = !first && !state.newsSeen.has(key);
      state.newsSeen.add(key);
      const head = b !== last ? `<li class="feed-group">${b}</li>` : "";
      last = b;
      const t = new Date(it.published);
      const time = isNaN(t) ? "" : (now - t < 864e5 ? t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : t.toLocaleDateString([], { day: "numeric", month: "short" }));
      return `${head}<li class="item"><span class="time">${esc(time)}</span><div class="body">
        ${fresh ? `<span class="new-dot" title="New since last refresh"></span>` : ""}<a class="title" href="${esc(safeUrl(it.link))}" target="_blank" rel="noopener">${esc(it.title)}</a>
        <div class="meta"><span>${esc(it.source || "")}</span>${it.published ? `<span>· ${esc(ago(it.published))}</span>` : ""}
          ${it.market ? `<span class="tag">${esc(SHORT[it.market] || it.market)}</span>` : ""}${it.symbol ? `<a class="tag" href="${route(it.symbol)}">${esc(it.symbol)}</a>` : ""}</div>
      </div></li>`;
    }).join("");
    document.getElementById("feed").innerHTML = data.items.length ? `<ul class="feed">${html}</ul>` : `<div class="empty">No headlines right now.</div>`;
    const note = document.getElementById("news-note");
    if (note) note.innerHTML = liveNote(data.updated);
    first = false;
  };
  await draw();
  document.getElementById("news-mkt").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    n.market = b.dataset.m; first = true;
    document.querySelectorAll("#news-mkt button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    document.getElementById("feed").innerHTML = `<div class="loading"><span class="spinner" aria-hidden="true"></span> Loading headlines…</div>`;
    draw();
  };
  const sc = document.getElementById("news-scope");
  if (sc) sc.onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    n.scope = b.dataset.s; first = true;
    document.querySelectorAll("#news-scope button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    document.getElementById("feed").innerHTML = `<div class="loading"><span class="spinner" aria-hidden="true"></span> Loading headlines${n.scope === "watchlist" ? " for each watchlist stock" : ""}…</div>`;
    draw();
  };
  if (state.live) every(POLL_NEWS, draw);
}

// ---------- stock page -------------------------------------------------------------------
async function loadStock(symbol) {
  if (state.live) {
    const d = await getJSON(`api/stocks/${encodeURIComponent(symbol)}`);
    return { r: { ...d.analysis, _market: d.analysis.market }, s: d.series, marketName: d.market_name };
  }
  const r = allResults(state.latest).find((x) => x.symbol === symbol);
  if (!r) return null;
  let s = state.series[symbol];
  if (!s) { try { s = state.series[symbol] = await getJSON(`data/series/${safeName(symbol)}.json`); } catch { s = null; } }
  return { r: { ...r, watched: true }, s, marketName: state.latest.markets[r._market].name };
}

function newsList(items) {
  return items?.length ? `<ul class="news">${items.map((n) => `<li><a href="${esc(safeUrl(n.link))}" target="_blank" rel="noopener">${esc(n.title)}</a><div class="meta">${esc(n.source)}${ago(n.published) ? ` · ${esc(ago(n.published))}` : ""}</div></li>`).join("")}</ul>` : `<p class="muted">No recent headlines.</p>`;
}

async function renderStock(symbol) {
  app.innerHTML = `<div class="loading"><span class="spinner" aria-hidden="true"></span> Loading ${esc(symbol)}…</div>`;
  let got;
  try { got = await loadStock(symbol); } catch (e) {
    app.innerHTML = `<div class="crumb"><a href="#/">${icon("back", 14)} Overview</a></div><div class="card pad prose"><h1>${esc(symbol)}</h1><p>${e.status === 404 ? "No price data found for this ticker. Check the exchange suffix, for example <code>TCS.NS</code>, <code>0700.HK</code> or <code>SAP.DE</code>." : esc(e.message)}</p></div>`;
    return;
  }
  if (!got) {
    app.innerHTML = `<div class="crumb"><a href="#/">${icon("back", 14)} Overview</a></div>
      <div class="card pad prose"><h1>${esc(symbol)}</h1><p>This stock isn't on the watchlist in the daily snapshot. Add it to <code>config.yaml</code>, or run the live app to look up any stock.</p>${editLink()}</div>`;
    return;
  }
  const { r, s, marketName } = got;
  const risk = r.entry - r.stop_loss, rr = risk > 0 ? (r.target - r.entry) / risk : 0;
  const f = r.fundamentals || {};
  const fund = [
    ["Sector", f.sector || r.sector], ["Industry", f.industry],
    ["Market cap", f.marketCap ? `${num(f.marketCap / 1e9, 1)} B` : null],
    ["P/E", f.trailingPE != null ? num(f.trailingPE, 1) : null], ["Forward P/E", f.forwardPE != null ? num(f.forwardPE, 1) : null],
    ["P/B", f.priceToBook != null ? num(f.priceToBook, 2) : null], ["Beta", f.beta != null ? num(f.beta, 2) : null],
    ["ROE", f.returnOnEquity != null ? pct(f.returnOnEquity * 100, 1) : null],
    ["Revenue growth", f.revenueGrowth != null ? pct(f.revenueGrowth * 100, 1) : null],
    ["52-week high", f.fiftyTwoWeekHigh != null ? num(f.fiftyTwoWeekHigh) : null], ["52-week low", f.fiftyTwoWeekLow != null ? num(f.fiftyTwoWeekLow) : null],
  ].filter(([, v]) => v != null && v !== "");

  const lo = Math.min(r.stop_loss, r.entry, r.close, r.target), hi = Math.max(r.stop_loss, r.entry, r.close, r.target);
  const pos = (v) => ((v - lo) / (hi - lo || 1)) * 100;
  const ranges = RANGES.filter(([l]) => state.live || l !== "1D");
  const defaultRange = "6M";

  app.innerHTML = `
    <div class="crumb"><a href="#/">${icon("back", 14)} Overview</a><span>/</span><a href="#/markets/${r._market}">${esc(marketName)}</a></div>
    <div class="stock-head">
      <div>
        <div class="stock-title"><h1>${esc(r.symbol)}</h1>${ratingTag(r.rating)}
          ${state.live ? `<button type="button" class="watch-btn" id="watch-btn" data-sym="${esc(r.symbol)}"></button>` : ""}</div>
        <div class="stock-sub">${esc(r.name)}${r.sector ? ` · ${esc(r.sector)}` : ""}</div>
      </div>
      <div class="stock-price">
        <div class="big" id="px">${price(r.close, r.currency)}</div>
        <div class="meta" id="px-meta"></div>
      </div>
    </div>

    <div class="stock-grid">
      <div class="stack">
        <section class="card" aria-label="Price chart">
          <div class="chart-toolbar">
            <div class="seg" id="range" role="group" aria-label="Time range">${ranges.map(([l]) => `<button type="button" data-r="${l}" aria-pressed="${l === defaultRange}">${l}</button>`).join("")}</div>
            <div class="toggles" id="layers" role="group" aria-label="Chart layers">
              <button type="button" class="toggle" data-l="ma20" aria-pressed="true"><span class="sw" style="background:var(--ma20)"></span>MA20</button>
              <button type="button" class="toggle" data-l="ma50" aria-pressed="true"><span class="sw" style="background:var(--ma50)"></span>MA50</button>
              <button type="button" class="toggle" data-l="ma200" aria-pressed="true"><span class="sw dashed"></span>MA200</button>
              <button type="button" class="toggle" data-l="levels" aria-pressed="true"><span class="sw" style="background:var(--accent)"></span>Levels</button>
              <button type="button" class="toggle" data-l="vol" aria-pressed="true"><span class="sw" style="background:var(--ma200)"></span>Volume</button>
            </div>
          </div>
          <div class="readout" id="readout"></div>
          <div class="chart-pad"><div id="c-price" class="chart" style="height:400px"></div></div>
        </section>
        <section class="card" aria-label="Momentum">
          <div class="chart-toolbar">
            <h2>Momentum</h2>
            <div class="seg" id="mom" role="group" aria-label="Indicator"><button type="button" data-k="rsi" aria-pressed="true">RSI 14</button><button type="button" data-k="macd" aria-pressed="false">MACD histogram</button></div>
          </div>
          <div class="chart-pad"><div id="c-mom" class="chart" style="height:150px"></div></div>
        </section>
      </div>

      <aside class="stack stock-side">
        <section class="card pad" aria-label="Score">
          <div class="score-card">${ring(r.score, r.rating, 76)}
            <div><h3>Score</h3><div style="font-size:18px;font-weight:650;margin-top:2px">${esc(r.rating)}</div><div class="muted small">${passed(r)} of ${r.checklist.length} checks passed</div></div>
          </div>
          <ul class="checklist">${r.checklist.map(([k, ok]) => `<li class="${ok ? "ok" : ""}">${ok ? `<span class="ic-good">${icon("check", 15)}</span>` : `<span class="muted">${icon("x", 15)}</span>`}${esc(k)}</li>`).join("")}</ul>
        </section>
        <section class="card pad" aria-label="Trade plan">
          <h3>Trade plan</h3>
          <div class="ladder" role="img" aria-label="Stop ${num(r.stop_loss)}, entry ${num(r.entry)}, now ${num(r.close)}, target ${num(r.target)}">
            <div class="ladder-track" style="margin-top:22px">
              <span class="zone risk" style="left:${pos(r.stop_loss).toFixed(2)}%;width:${(pos(r.entry) - pos(r.stop_loss)).toFixed(2)}%"></span>
              <span class="zone reward" style="left:${pos(r.entry).toFixed(2)}%;width:${(pos(r.target) - pos(r.entry)).toFixed(2)}%"></span>
              <span class="ladder-mark entry" style="left:${pos(r.entry).toFixed(2)}%"></span>
              <span class="ladder-mark" style="left:${pos(r.close).toFixed(2)}%"><em style="${pos(r.close) > 80 ? "left:auto;right:0;transform:none" : pos(r.close) < 20 ? "left:0;transform:none" : ""}">Now ${num(r.close)}</em></span>
            </div>
          </div>
          <div class="levels">
            <div>Stop<b class="down">${num(r.stop_loss)}</b></div>
            <div>Entry<b>${num(r.entry)}</b></div>
            <div>Target<b class="up">${num(r.target)}</b></div>
          </div>
          <dl class="kv">
            <dt>Reward / risk</dt><dd>${rr.toFixed(2)}</dd>
            <dt>Support (20d)</dt><dd>${num(r.support)}</dd>
            <dt>Resistance (20d)</dt><dd>${num(r.resistance)}</dd>
            <dt>Trend</dt><dd>${esc(r.trend.split(" (")[0])}</dd>
            <dt>MACD</dt><dd>${esc(r.macd_state)}</dd>
            ${r.volume_ratio ? `<dt>Volume vs 5d avg</dt><dd>${r.volume_ratio.toFixed(2)}×</dd>` : ""}
          </dl>
        </section>
      </aside>
    </div>

    <div class="grid cols-2 section">
      <section class="card pad" aria-label="Signals">
        <h2>Signals</h2>
        <div class="signals2" style="margin-top:10px">
          <div><h3>Supporting</h3>${r.signals.length ? `<ul class="bullets good">${r.signals.map((x) => `<li><span class="dot"></span>${esc(x)}</li>`).join("")}</ul>` : `<p class="muted">None</p>`}</div>
          <div><h3>Risks</h3>${r.risks.length ? `<ul class="bullets bad">${r.risks.map((x) => `<li><span class="dot"></span>${esc(x)}</li>`).join("")}</ul>` : `<p class="muted">None flagged</p>`}</div>
        </div>
        ${r.ai_summary ? `<h3 style="margin-top:18px">AI view</h3><p>${esc(r.ai_summary)}</p>` : ""}
      </section>
      <section class="card pad" aria-label="News">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2>${state.live ? "Live news" : "News"}</h2><span id="news-note"></span></div>
        <div id="stock-news">${newsList(r.news)}</div>
      </section>
    </div>

    <div class="grid cols-2 section">
      <section class="card pad" aria-label="Fundamentals"><h2>Fundamentals</h2>
        ${fund.length ? `<div class="tiles">${fund.map(([k, v]) => `<div class="tile"><div class="label">${esc(k)}</div><div class="value">${esc(v)}</div></div>`).join("")}</div>` : `<p class="muted">Not available for this stock.</p>`}
      </section>
      <section class="card pad" aria-label="Score history"><h2>Score history</h2><div id="c-score" class="chart" style="height:170px;margin-top:10px"></div></section>
    </div>`;

  const paintPrice = (a) => {
    document.getElementById("px").textContent = price(a.close, a.currency).replace(/&amp;/g, "&");
    document.getElementById("px-meta").innerHTML = `${chg(a.change_pct)}<span>5D ${pct(a.change_5d_pct)}</span><span>1M ${pct(a.change_1m_pct)}</span>` +
      (state.live ? `<span>· ${icon("refresh", 11)} ${esc(ago(a.updated))}</span>` : `<span>· close ${esc(a.date)}</span>`);
  };
  paintPrice(r);
  const wb = document.getElementById("watch-btn");
  if (wb) { paintWatchBtn(wb, r.watched); wb.onclick = () => toggleWatch(r.symbol, wb.getAttribute("aria-pressed") !== "true", wb); }

  if (!window.LightweightCharts) {
    document.getElementById("c-price").innerHTML = `<div class="empty">Chart library could not load.</div>`;
  } else if (!s) {
    document.getElementById("c-price").innerHTML = `<div class="empty">No chart data yet.</div>`;
  } else {
    const charts = drawStockCharts(s, r, defaultRange);
    if (state.live) {
      every(POLL_QUOTES, async () => {
        try {
          const d = await loadStock(symbol);
          Object.assign(r, d.r);
          paintPrice(d.r);
          charts.updateLast(d.s);
        } catch { /* keep last */ }
      });
      every(POLL_NEWS, async () => {
        try { const d = await getJSON(`api/stocks/${encodeURIComponent(symbol)}`); document.getElementById("stock-news").innerHTML = newsList(d.analysis.news); } catch { /* keep last */ }
      });
      const t = setInterval(() => paintPrice(r), 15_000);
      state.cleanup.push(() => clearInterval(t));
    }
  }
  try {
    state.scores = state.scores || (state.live ? {} : await getJSON("data/scores.json"));
    drawScores(state.scores[symbol] || []);
  } catch { document.getElementById("c-score").innerHTML = `<div class="empty">No history yet.</div>`; }
}

function baseOptions(el, height, logo = false) {
  return {
    width: el.clientWidth, height,
    layout: { background: { color: "transparent" }, textColor: cssVar("--muted"), fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", fontSize: 11, attributionLogo: logo },
    grid: { vertLines: { visible: false }, horzLines: { color: cssVar("--grid") } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false, rightOffset: 3 },
    crosshair: { mode: 1, vertLine: { color: cssVar("--muted"), labelBackgroundColor: cssVar("--ink-2") }, horzLine: { color: cssVar("--muted"), labelBackgroundColor: cssVar("--ink-2") } },
    handleScroll: { vertTouchDrag: false },
  };
}

function makeChart(id, height, logo, extra = {}) {
  const el = document.getElementById(id);
  const chart = LightweightCharts.createChart(el, { ...baseOptions(el, height, logo), ...extra });
  state.charts.push(chart);
  const ro = new ResizeObserver(() => { try { chart.applyOptions({ width: el.clientWidth }); } catch { /* removed */ } });
  ro.observe(el);
  state.cleanup.push(() => ro.disconnect());
  return chart;
}

function dropChart(chart) {
  if (!chart) return;
  state.charts = state.charts.filter((c) => c !== chart);
  try { chart.remove(); } catch { /* disposed */ }
}

const line = (s, key) => s.t.map((t, i) => ({ time: t, value: s[key]?.[i] })).filter((p) => p.value != null);

function drawStockCharts(s, r, initialRange) {
  const up = cssVar("--up-mark"), down = cssVar("--down-mark");
  const tz = SESSIONS[r._market]?.tz;
  const hhmm = (ts) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(ts * 1000);
  const ctx = { chart: null, candles: null, layers: {}, levelLines: [], mode: "", bars: [] };
  const on = (l) => document.querySelector(`#layers [data-l="${l}"]`)?.getAttribute("aria-pressed") !== "false";
  const ro = document.getElementById("readout");

  const show = (b) => {
    if (!b) return;
    const label = typeof b.time === "number" ? `${hhmm(b.time)} local` : String(b.time);
    const i = ctx.bars.findIndex((x) => x.time === b.time);
    const prev = i > 0 ? ctx.bars[i - 1].close : null;
    const d = prev ? (b.close / prev - 1) * 100 : null;
    ro.innerHTML = `<span>${esc(label)}</span><span>O<b>${num(b.open)}</b></span><span>H<b>${num(b.high)}</b></span><span>L<b>${num(b.low)}</b></span><span>C<b>${num(b.close)}</b></span>${d != null ? `<span class="${dir(d)}">${pct(d)}</span>` : ""}`;
  };

  const addLevels = () => {
    ctx.levelLines = [[r.target, up], [r.entry, cssVar("--accent")], [r.stop_loss, down]]
      .map(([p, color]) => ctx.candles.createPriceLine({ price: p, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "" }));
  };

  const mount = (bars, vols, withMAs, extra) => {
    dropChart(ctx.chart);
    document.getElementById("c-price").innerHTML = "";
    const chart = makeChart("c-price", 400, true, extra);
    const candles = chart.addCandlestickSeries({ upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down, priceLineVisible: false });
    candles.setData(bars);
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.2 } });
    const vol = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false, visible: on("vol") });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    vol.setData(vols);
    Object.assign(ctx, { chart, candles, bars, layers: { vol }, levelLines: [] });
    if (withMAs) {
      [["ma20", cssVar("--ma20"), 0], ["ma50", cssVar("--ma50"), 0], ["ma200", cssVar("--ma200"), 2]].forEach(([k, color, style]) => {
        ctx.layers[k] = chart.addLineSeries({ color, lineWidth: 2, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: on(k) });
        ctx.layers[k].setData(line(s, k));
      });
    }
    if (on("levels")) addLevels();
    show(bars[bars.length - 1]);
    chart.subscribeCrosshairMove((p) => show((p && p.time && p.seriesData.get(candles)) || bars[bars.length - 1]));
    chart.timeScale().subscribeVisibleLogicalRangeChange((rg) => { if (rg && mom && ctx.mode === "daily") mom.timeScale().setVisibleLogicalRange(rg); });
  };

  const dailyBars = () => s.t.map((t, i) => ({ time: t, open: s.o[i], high: s.h[i], low: s.l[i], close: s.c[i] })).filter((b) => b.close != null);
  const dailyVols = () => s.t.map((t, i) => ({ time: t, value: s.v?.[i] ?? 0, color: `${s.c[i] >= s.o[i] ? up : down}55` }));

  const mountDaily = () => { ctx.mode = "daily"; mount(dailyBars(), dailyVols(), true, {}); };
  const mountIntraday = async () => {
    ctx.mode = "intraday";
    document.getElementById("c-price").innerHTML = `<div class="loading" style="height:400px"><span class="spinner"></span> Loading today's session…</div>`;
    let data;
    try { data = await getJSON(`api/stocks/${encodeURIComponent(r.symbol)}/intraday`); } catch { data = { bars: [] }; }
    if (ctx.mode !== "intraday") return;
    if (!data.bars.length) { dropChart(ctx.chart); ctx.chart = null; document.getElementById("c-price").innerHTML = `<div class="empty" style="height:400px">No intraday data for this session.</div>`; return; }
    const bars = data.bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }));
    const vols = data.bars.map((b) => ({ time: b.time, value: b.volume ?? 0, color: `${b.close >= b.open ? up : down}55` }));
    mount(bars, vols, false, { timeScale: { borderVisible: false, rightOffset: 3, timeVisible: true, secondsVisible: false, tickMarkFormatter: (t) => hhmm(t) }, localization: { timeFormatter: (t) => hhmm(t) } });
    ctx.chart.timeScale().fitContent();
  };

  const setRange = async (label) => {
    document.querySelectorAll("#range button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.r === label)));
    ["ma20", "ma50", "ma200"].forEach((k) => document.querySelector(`#layers [data-l="${k}"]`)?.setAttribute("aria-disabled", String(label === "1D")));
    const n = RANGES.find(([l]) => l === label)[1];
    if (n === -1) return mountIntraday();
    if (ctx.mode !== "daily") mountDaily();
    if (!n || n >= ctx.bars.length) ctx.chart.timeScale().fitContent();
    else ctx.chart.timeScale().setVisibleLogicalRange({ from: ctx.bars.length - n, to: ctx.bars.length + 2 });
  };
  document.getElementById("range").onclick = (e) => { const b = e.target.closest("button"); if (b) setRange(b.dataset.r); };

  document.getElementById("layers").onclick = (e) => {
    const b = e.target.closest("button"); if (!b || b.getAttribute("aria-disabled") === "true") return;
    const v = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(v));
    if (!ctx.chart) return;
    if (b.dataset.l === "levels") {
      if (v) addLevels(); else { ctx.levelLines.forEach((l) => ctx.candles.removePriceLine(l)); ctx.levelLines = []; }
    } else ctx.layers[b.dataset.l]?.applyOptions({ visible: v });
  };

  // momentum (daily)
  let mom = null;
  const drawMom = (kind) => {
    dropChart(mom); mom = null;
    document.getElementById("c-mom").innerHTML = "";
    const m = makeChart("c-mom", 150, false);
    if (kind === "rsi") {
      const rs = m.addLineSeries({ color: cssVar("--rsi"), lineWidth: 2, priceLineVisible: false, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
      rs.setData(line(s, "rsi"));
      rs.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.08 } });
      rs.createPriceLine({ price: 70, color: cssVar("--down-mark"), lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "" });
      rs.createPriceLine({ price: 30, color: cssVar("--up-mark"), lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "" });
    } else {
      m.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false })
        .setData(line(s, "macd").map((p) => ({ ...p, color: p.value >= 0 ? up : down })));
    }
    const rg = ctx.mode === "daily" && ctx.chart ? ctx.chart.timeScale().getVisibleLogicalRange() : null;
    if (rg) m.timeScale().setVisibleLogicalRange(rg); else m.timeScale().fitContent();
    mom = m;
    document.querySelectorAll("#mom button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === kind)));
  };

  mountDaily();
  drawMom("rsi");
  setRange(initialRange);
  document.getElementById("mom").onclick = (e) => { const b = e.target.closest("button"); if (b) drawMom(b.dataset.k); };

  return {
    updateLast(ns) {
      if (!ns || ctx.mode !== "daily" || !ctx.candles) { if (ctx.mode === "intraday") mountIntraday(); return; }
      const i = ns.t.length - 1;
      const bar = { time: ns.t[i], open: ns.o[i], high: ns.h[i], low: ns.l[i], close: ns.c[i] };
      if (bar.close == null) return;
      try {
        ctx.candles.update(bar);
        const last = ctx.bars[ctx.bars.length - 1];
        if (last && last.time === bar.time) ctx.bars[ctx.bars.length - 1] = bar; else ctx.bars.push(bar);
        show(bar);
      } catch { /* older bar */ }
    },
  };
}

function drawScores(rows) {
  const el = document.getElementById("c-score");
  if (rows.length < 2) {
    el.style.height = "auto";
    el.innerHTML = `<div class="empty">${state.live ? "Score history is recorded by the daily runs and shown on the published dashboard." : `The score trend appears after a few daily runs (${rows.length} so far).`}</div>`;
    return;
  }
  const c = makeChart("c-score", 170, false);
  const sr = c.addLineSeries({ color: cssVar("--accent"), lineWidth: 2, priceLineVisible: false, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
  sr.setData(rows.map(([t, v]) => ({ time: t, value: v })));
  sr.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.08 } });
  sr.createPriceLine({ price: 60, color: cssVar("--up-mark"), lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "Buy" });
  c.timeScale().fitContent();
}

// ---------- history & about ----------------------------------------------------------------
async function renderHistory(date) {
  let dates = [];
  try { dates = await getJSON("data/history/index.json"); } catch { /* none yet */ }
  if (!dates.length) { app.innerHTML = `<div class="page-head"><h1>History</h1></div><div class="card empty">No saved days yet.</div>`; return; }
  const pick = date || dates[0];
  const snap = await getJSON(`data/history/${pick}.json`);
  renderOverview(snap, { date: pick });
  app.insertAdjacentHTML("afterbegin", `<div class="date-strip" aria-label="Saved days">${dates.map((d) => `<a class="${d === pick ? "active" : ""}" href="#/history/${d}">${new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</a>`).join("")}</div>`);
}

function editLink() {
  const repo = state.latest?.repo;
  return repo ? `<p><a href="https://github.com/${esc(repo)}/edit/main/config.yaml" target="_blank" rel="noopener">Edit the watchlist on GitHub →</a></p>` : "";
}

function renderAbout() {
  const repo = state.latest?.repo;
  app.innerHTML = `<div class="page-head"><div><h1>About</h1><p>How this dashboard works</p></div></div>
    <div class="card pad prose">
      <h2>${state.live ? "Live mode" : "Daily snapshot"}</h2>
      ${state.live
        ? `<p>You're using the live app. Prices refresh every minute and news every two minutes while a page is open. Yahoo Finance prices can be delayed by up to 15 minutes depending on the exchange. Your watchlist changes are saved on the server in <code>config.yaml</code>.</p>`
        : `<p>This page is rebuilt by GitHub Actions on weekdays after each market closes: India and China/HK at 08:30 UTC, Europe at 17:00 UTC and the US at 21:30 UTC. For live prices, the full market browser and live news, run the live app (<code>python -m stock_analyzer.server</code>).</p>`}
      <h2>Scoring</h2>
      <p>Every stock starts at 50 and moves with transparent technical rules: moving-average alignment, position against the 50- and 200-day averages and their crosses, RSI, MACD, distance from the 5-day average (a "don't chase" guard) and volume. Ratings: 75+ Strong Buy, 60+ Buy, 45+ Hold, 30+ Reduce, below 30 Sell.</p>
      <h2>Trade plan</h2>
      <p>Entry is the 5-day average, or the close if the price is below it. The stop is 20-day support or two ATRs below entry, whichever is higher. The target is 20-day resistance or three ATRs above entry, whichever is higher.</p>
      ${!state.live && repo ? `<h2>Your watchlist</h2><p>Edit <code>config.yaml</code> in the repository. The next run picks it up.</p>${editLink()}<p><a href="https://github.com/${esc(repo)}/actions/workflows/daily-analysis.yml" target="_blank" rel="noopener">Run the analysis now →</a></p>` : ""}
      <p class="muted small">Built with open-source tools: yfinance, pandas, FastAPI, feedparser and TradingView Lightweight Charts. For research and education only, not investment advice.</p>
    </div>`;
}

// ---------- theme ----------------------------------------------------------------------------
function currentTheme() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function paintThemeButton() {
  const dark = currentTheme() === "dark";
  const b = document.getElementById("theme");
  b.innerHTML = icon(dark ? "sun" : "moon", 17);
  b.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
}
function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch { /* private mode */ }
  paintThemeButton();
  router(); // charts read colours at draw time
}

// ---------- search -----------------------------------------------------------------------------
function fillSearchList(extra = []) {
  const seen = new Set();
  const rows = [...allResults(state.latest).map((r) => ({ symbol: r.symbol, name: r.name })), ...extra].filter((r) => !seen.has(r.symbol) && seen.add(r.symbol));
  document.getElementById("symbols").innerHTML = rows.map((r) => `<option value="${esc(r.symbol)}">${esc(r.name)}</option>`).join("");
  return rows;
}

function wireSearch() {
  const input = document.getElementById("search-input");
  let known = fillSearchList(), timer;
  const go = (q) => {
    q = q.trim();
    if (!q) return;
    const Q = q.toUpperCase();
    const hit = known.find((r) => r.symbol === Q) || known.find((r) => r.name.toUpperCase().includes(Q) || r.symbol.startsWith(Q));
    if (hit) location.hash = route(hit.symbol);
    else if (state.live) location.hash = route(Q);
    else { toast(`${Q} isn't in the daily snapshot`); return; }
    input.value = ""; input.blur();
  };
  document.getElementById("search").onsubmit = (e) => { e.preventDefault(); go(input.value); };
  input.addEventListener("input", () => {
    const v = input.value.trim();
    if (known.some((r) => r.symbol === v.toUpperCase()) && document.activeElement === input && v.length > 1 && v === v.toUpperCase()) { /* picked from list */ }
    if (!state.live || v.length < 2) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try { const { results } = await getJSON(`api/search?q=${encodeURIComponent(v)}`); known = fillSearchList(results); } catch { /* offline */ }
    }, 300);
  });
  input.addEventListener("change", () => { if (known.some((r) => r.symbol === input.value.trim().toUpperCase())) go(input.value); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); input.focus(); }
  });
}

// ---------- router -------------------------------------------------------------------------------
async function router() {
  clearPage();
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  const view = h.split("/")[0], arg = h.split("/").slice(1).join("/");
  const navKey = view === "s" || !view ? "today" : view;
  document.querySelectorAll(".mainnav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === navKey));
  try {
    if (view === "s" && arg) await renderStock(arg);
    else if (view === "markets") await renderMarkets(arg);
    else if (view === "news") await renderNews();
    else if (view === "history" && !state.live) await renderHistory(arg);
    else if (view === "about") renderAbout();
    else {
      if (state.live) { try { state.latest = await getJSON("api/snapshot"); } catch { /* show last */ } }
      renderOverview(state.latest);
    }
  } catch (e) {
    app.innerHTML = `<div class="card empty down">Something went wrong: ${esc(e.message)}</div>`;
  }
}

async function init() {
  paintThemeButton();
  document.getElementById("theme").onclick = toggleTheme;
  const mq = matchMedia("(prefers-color-scheme: dark)");
  if (mq.addEventListener) mq.addEventListener("change", () => { if (!document.documentElement.dataset.theme) { paintThemeButton(); router(); } });

  try {
    const meta = await getJSON("api/meta");
    state.live = !!meta.live; state.auth = !!meta.auth;
  } catch { state.live = false; }

  const mode = document.getElementById("mode");
  mode.hidden = false;
  mode.className = `mode ${state.live ? "live" : ""}`;
  mode.innerHTML = state.live ? `<span class="pulse"></span><span class="mode-text">Live</span>` : `<span class="mode-text">Daily snapshot</span>`;
  mode.title = state.live ? "Live prices from Yahoo Finance; may be delayed up to 15 minutes" : "Updated by scheduled runs after each market closes";
  document.getElementById("nav-history").hidden = state.live;

  try {
    state.latest = await getJSON(state.live ? "api/snapshot" : "data/latest.json");
  } catch {
    app.innerHTML = `<div class="page-head"><h1>No data yet</h1></div><div class="card pad">The first scheduled run hasn't published results yet. Start the "Daily Stock Analysis" workflow from the repository's Actions tab.</div>`;
    return;
  }
  wireSearch();
  window.addEventListener("hashchange", () => { router(); window.scrollTo(0, 0); });
  router();
}

init();
