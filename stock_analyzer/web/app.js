/* Global Stock Analyzer: static dashboard. Reads the JSON written by stock_analyzer/site.py. */
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
const RATINGS = ["Strong Buy", "Buy", "Hold", "Reduce", "Sell"];
const CURRENCY = { INR: "₹", USD: "$", CNY: "¥", HKD: "HK$", EUR: "€", GBP: "£", JPY: "¥" };
const MAX_BIAS = 5;
const RANGES = [["1M", 22], ["3M", 66], ["6M", 130], ["1Y", 0]];

const state = { latest: null, scores: null, series: {}, charts: [], cleanup: [] };
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
};
const icon = (name, size = 14, cls = "") =>
  `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

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
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

function allResults(snap) {
  return ORDER.flatMap((c) => (snap.markets[c]?.results || []).map((r) => ({ ...r, _market: c })));
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

function clearCharts() {
  state.cleanup.forEach((fn) => fn());
  state.cleanup = [];
  state.charts.forEach((c) => c.remove());
  state.charts = [];
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
      <span class="mkt-name">${esc(m.name)}</span>
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

function renderOverview(snap, opts = {}) {
  const results = allResults(snap);
  const markets = ORDER.filter((c) => snap.markets[c]);
  const avg = results.length ? Math.round(results.reduce((a, r) => a + r.score, 0) / results.length) : 0;
  const advancers = results.filter((r) => r.change_pct > 0).length;
  const signals = results.flatMap((r) => signalsFor(r).map(([kind, text]) => ({ r, kind, text })));
  const counts = RATINGS.map((rt) => [rt, results.filter((r) => r.rating === rt).length]).filter(([, n]) => n);
  const top = results.filter((r) => r.score >= 60).sort((a, b) => b.score - a.score).slice(0, 6);
  const updated = new Date(snap.generated);

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
    </a>`).join("")}</div>` : `<div class="card empty">No stock scores Buy or better today.</div>`;

  const groups = [["good", "Bullish", "up"], ["bad", "Bearish", "down"], ["warn", "Caution", "alert"]]
    .map(([kind, label, ic]) => [kind, label, ic, signals.filter((s) => s.kind === kind)]).filter((g) => g[3].length);
  const signalPanel = groups.length ? groups.map(([kind, label, ic, items]) => `
    <div class="signal-group">
      <h3><span class="ic-${kind}">${icon(ic, 13)}</span>${label} · ${items.length}</h3>
      <ul class="signal-list">${items.slice(0, 6).map((s) => `<li><a href="${route(s.r.symbol)}">${esc(s.r.symbol)}</a><span class="what">${esc(s.text)}</span></li>`).join("")}</ul>
    </div>`).join("") : `<div class="empty">No notable signals today.</div>`;

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1>${opts.date ? `Snapshot · ${esc(opts.date)}` : "Market overview"}</h1>
        <p>${esc(updated.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }))} · updated ${esc(ago(snap.generated))}</p>
      </div>
    </div>
    ${snap.demo ? `<div class="banner">${icon("alert", 16)} Demo data: prices are synthetic.</div>` : ""}

    <section class="markets" aria-label="Markets">${markets.map((c) => marketTile(c, snap.markets[c])).join("")}</section>

    <section class="summary" aria-label="Watchlist summary">
      <div class="card kpi dist-card">
        <div class="label">Ratings across ${results.length} stocks</div>
        <div class="dist" role="img" aria-label="${esc(counts.map(([r, n]) => `${r} ${n}`).join(", "))}">${counts.map(([rt, n]) => `<span style="flex:${n};${distSwatch(rt)}" title="${esc(rt)}: ${n}"></span>`).join("")}</div>
        <div class="dist-legend">${counts.map(([rt, n]) => `<span><i style="${distSwatch(rt)}"></i>${esc(rt)} <b>${n}</b></span>`).join("")}</div>
      </div>
      <div class="card kpi"><div class="label">Average score</div><div class="value">${avg}</div><div class="sub">out of 100</div></div>
      <div class="card kpi"><div class="label">Up today</div><div class="value">${advancers}<span class="muted" style="font-size:16px;font-weight:600"> / ${results.length}</span></div><div class="sub">${results.length ? Math.round((advancers / results.length) * 100) : 0}% of watchlist</div></div>
      <div class="card kpi"><div class="label">Signals</div><div class="value">${signals.length}</div><div class="sub">${groups.map(([, l, , i]) => `${i.length} ${l.toLowerCase()}`).join(" · ") || "none"}</div></div>
    </section>

    <div class="grid split section">
      <section><div class="section-head"><h2>Top setups</h2><span class="muted small">Score 60 or more, best first</span></div>${setups}</section>
      <section><div class="section-head"><h2>Today's signals</h2></div><div class="card pad">${signalPanel}</div></section>
    </div>

    <section class="section">
      <div class="section-head">
        <h2>Watchlist</h2>
        <div class="toolbar">
          <div class="seg" id="mkt-seg" role="group" aria-label="Market">${["all", ...markets].map((c) => {
            const n = c === "all" ? results.length : results.filter((r) => r._market === c).length;
            return `<button type="button" data-m="${c}" aria-pressed="${c === "all"}">${c === "all" ? "All" : esc(SHORT[c] || snap.markets[c].name)}<span class="count">${n}</span></button>`;
          }).join("")}</div>
          <input id="filter" class="filter" type="search" placeholder="Filter by name or ticker" aria-label="Filter watchlist">
        </div>
      </div>
      <div class="card table-card"><div class="table-scroll" id="table"></div></div>
    </section>

    ${(snap.errors || []).length ? `<details class="card pad section small"><summary>${icon("alert", 13)} ${snap.errors.length} ticker(s) could not be analysed</summary><ul>${snap.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></details>` : ""}`;

  // watchlist table
  let market = "all", query = "", sortKey = "score", sortDir = -1;
  const cols = [
    ["symbol", "Stock", ""], ["spark", "60 days", "hide-sm", true], ["close", "Price", "r"], ["change_pct", "Day", "r hide-sm"],
    ["change_1m_pct", "1 month", "r hide-sm"], ["rsi", "RSI", "r hide-sm"], ["score", "Score", ""], ["rating", "Rating", "hide-sm"],
  ];
  const ratingRank = (r) => RATINGS.indexOf(r.rating);
  const draw = () => {
    const q = query.toLowerCase();
    const rows = results
      .filter((r) => (market === "all" || r._market === market) && (!q || r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)))
      .sort((a, b) => {
        const av = sortKey === "rating" ? -ratingRank(a) : a[sortKey], bv = sortKey === "rating" ? -ratingRank(b) : b[sortKey];
        return (av > bv ? 1 : av < bv ? -1 : 0) * sortDir;
      });
    document.getElementById("table").innerHTML = rows.length ? `<table>
      <thead><tr>${cols.map(([k, label, cls, nosort]) => nosort ? `<th class="${cls}">${label}</th>` :
        `<th class="${cls}" aria-sort="${k === sortKey ? (sortDir > 0 ? "ascending" : "descending") : "none"}"><button type="button" data-k="${k}">${label}${k === sortKey ? icon(sortDir > 0 ? "up" : "down", 11) : ""}</button></th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr data-s="${esc(r.symbol)}" tabindex="0">
        <td><span class="sym">${esc(r.symbol)}</span><span class="name">${esc(r.name)}</span></td>
        <td class="spark-cell hide-sm">${spark(r.spark)}</td>
        <td class="r tnum">${price(r.close, r.currency)}<div class="show-sm">${chg(r.change_pct)}</div></td>
        <td class="r hide-sm">${chg(r.change_pct)}</td>
        <td class="r tnum hide-sm ${dir(r.change_1m_pct)}">${pct(r.change_1m_pct)}</td>
        <td class="r tnum hide-sm">${Math.round(r.rsi)}</td>
        <td>${scorebar(r)}</td>
        <td class="hide-sm">${ratingTag(r.rating)}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">No stocks match.</div>`;
  };
  draw();
  document.getElementById("mkt-seg").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    market = b.dataset.m;
    document.querySelectorAll("#mkt-seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    draw();
  };
  document.getElementById("filter").oninput = (e) => { query = e.target.value.trim(); draw(); };
  const table = document.getElementById("table");
  table.onclick = (e) => {
    const b = e.target.closest("th button");
    if (b) { const k = b.dataset.k; sortDir = k === sortKey ? -sortDir : k === "symbol" ? 1 : -1; sortKey = k; return draw(); }
    const tr = e.target.closest("tr[data-s]");
    if (tr) location.hash = route(tr.dataset.s);
  };
  table.onkeydown = (e) => {
    const tr = e.target.closest("tr[data-s]");
    if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); location.hash = route(tr.dataset.s); }
  };
}

// ---------- stock page -------------------------------------------------------------------
async function renderStock(symbol) {
  const r = allResults(state.latest).find((x) => x.symbol === symbol);
  if (!r) {
    app.innerHTML = `<div class="crumb"><a href="#/">${icon("back", 14)} Overview</a></div>
      <div class="card pad prose"><h1>${esc(symbol)}</h1><p>This stock isn't on the watchlist yet. Add it to <code>config.yaml</code> and it will appear after the next run.</p>${editLink()}</div>`;
    return;
  }
  const m = state.latest.markets[r._market];
  const risk = r.entry - r.stop_loss, rr = risk > 0 ? (r.target - r.entry) / risk : 0;
  const f = r.fundamentals || {};
  const fund = [
    ["Sector", f.sector], ["Industry", f.industry],
    ["Market cap", f.marketCap ? `${num(f.marketCap / 1e9, 1)} B` : null],
    ["P/E", f.trailingPE != null ? num(f.trailingPE, 1) : null], ["Forward P/E", f.forwardPE != null ? num(f.forwardPE, 1) : null],
    ["P/B", f.priceToBook != null ? num(f.priceToBook, 2) : null], ["Beta", f.beta != null ? num(f.beta, 2) : null],
    ["ROE", f.returnOnEquity != null ? pct(f.returnOnEquity * 100, 1) : null],
    ["Revenue growth", f.revenueGrowth != null ? pct(f.revenueGrowth * 100, 1) : null],
    ["52-week high", f.fiftyTwoWeekHigh != null ? num(f.fiftyTwoWeekHigh) : null], ["52-week low", f.fiftyTwoWeekLow != null ? num(f.fiftyTwoWeekLow) : null],
  ].filter(([, v]) => v != null && v !== "");

  // trade-plan ladder geometry
  const lo = Math.min(r.stop_loss, r.entry, r.close, r.target), hi = Math.max(r.stop_loss, r.entry, r.close, r.target);
  const pos = (v) => ((v - lo) / (hi - lo || 1)) * 100;

  app.innerHTML = `
    <div class="crumb"><a href="#/">${icon("back", 14)} Overview</a><span>/</span><span>${esc(m.name)}</span></div>
    <div class="stock-head">
      <div>
        <div class="stock-title"><h1>${esc(r.symbol)}</h1>${ratingTag(r.rating)}</div>
        <div class="stock-sub">${esc(r.name)}</div>
      </div>
      <div class="stock-price">
        <div class="big">${price(r.close, r.currency)}</div>
        <div class="meta">${chg(r.change_pct)}<span>5D ${pct(r.change_5d_pct)}</span><span>1M ${pct(r.change_1m_pct)}</span><span>· close ${esc(r.date)}</span></div>
      </div>
    </div>

    <div class="stock-grid">
      <div class="stack">
        <section class="card" aria-label="Price chart">
          <div class="chart-toolbar">
            <div class="seg" id="range" role="group" aria-label="Time range">${RANGES.map(([l], i) => `<button type="button" data-i="${i}" aria-pressed="${i === 2}">${l}</button>`).join("")}</div>
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
          <div><h3>Supporting</h3>${r.signals.length ? `<ul class="bullets good">${r.signals.map((s) => `<li><span class="dot"></span>${esc(s)}</li>`).join("")}</ul>` : `<p class="muted">None</p>`}</div>
          <div><h3>Risks</h3>${r.risks.length ? `<ul class="bullets bad">${r.risks.map((s) => `<li><span class="dot"></span>${esc(s)}</li>`).join("")}</ul>` : `<p class="muted">None flagged</p>`}</div>
        </div>
        ${r.ai_summary ? `<h3 style="margin-top:18px">AI view</h3><p>${esc(r.ai_summary)}</p>` : ""}
      </section>
      <section class="card pad" aria-label="News">
        <h2>News</h2>
        ${r.news?.length ? `<ul class="news">${r.news.map((n) => `<li><a href="${esc(safeUrl(n.link))}" target="_blank" rel="noopener">${esc(n.title)}</a><div class="meta">${esc(n.source)}${ago(n.published) ? ` · ${esc(ago(n.published))}` : ""}</div></li>`).join("")}</ul>` : `<p class="muted">No recent headlines.</p>`}
      </section>
    </div>

    <div class="grid cols-2 section">
      <section class="card pad" aria-label="Fundamentals"><h2>Fundamentals</h2>
        ${fund.length ? `<div class="tiles">${fund.map(([k, v]) => `<div class="tile"><div class="label">${esc(k)}</div><div class="value">${esc(v)}</div></div>`).join("")}</div>` : `<p class="muted">Not available for this stock.</p>`}
      </section>
      <section class="card pad" aria-label="Score history"><h2>Score history</h2><div id="c-score" class="chart" style="height:170px;margin-top:10px"></div></section>
    </div>`;

  if (!window.LightweightCharts) {
    document.getElementById("c-price").innerHTML = `<div class="empty">Chart library could not load.</div>`;
    return;
  }
  let s;
  try {
    s = state.series[symbol] || (state.series[symbol] = await getJSON(`data/series/${safeName(symbol)}.json`));
  } catch {
    document.getElementById("c-price").innerHTML = `<div class="empty">No chart data yet.</div>`;
  }
  if (s) drawStockCharts(s, r);
  try {
    state.scores = state.scores || (await getJSON("data/scores.json"));
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

function makeChart(id, height, logo) {
  const el = document.getElementById(id);
  const chart = LightweightCharts.createChart(el, baseOptions(el, height, logo));
  state.charts.push(chart);
  const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
  ro.observe(el);
  state.cleanup.push(() => ro.disconnect());
  return chart;
}

const line = (s, key) => s.t.map((t, i) => ({ time: t, value: s[key]?.[i] })).filter((p) => p.value != null);

function drawStockCharts(s, r) {
  const up = cssVar("--up-mark"), down = cssVar("--down-mark");
  const chart = makeChart("c-price", 400, true);
  const candles = chart.addCandlestickSeries({ upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down, priceLineVisible: false });
  const bars = s.t.map((t, i) => ({ time: t, open: s.o[i], high: s.h[i], low: s.l[i], close: s.c[i] })).filter((b) => b.close != null);
  candles.setData(bars);
  candles.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.2 } });

  const vol = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
  chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
  vol.setData(s.t.map((t, i) => ({ time: t, value: s.v?.[i] ?? 0, color: `${s.c[i] >= s.o[i] ? up : down}55` })));

  const layers = { vol };
  [["ma20", cssVar("--ma20"), 0], ["ma50", cssVar("--ma50"), 0], ["ma200", cssVar("--ma200"), 2]].forEach(([k, color, style]) => {
    layers[k] = chart.addLineSeries({ color, lineWidth: 2, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    layers[k].setData(line(s, k));
  });
  let levelLines = [];
  const addLevels = () => {
    levelLines = [[r.target, up], [r.entry, cssVar("--accent")], [r.stop_loss, down]]
      .map(([p, color]) => candles.createPriceLine({ price: p, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "" }));
  };
  addLevels();

  // readout: OHLC at the crosshair, the last bar otherwise
  const ro = document.getElementById("readout");
  const show = (b) => {
    if (!b) return;
    const t = typeof b.time === "string" ? b.time : "";
    const i = s.t.indexOf(t);
    const prev = i > 0 ? s.c[i - 1] : null;
    const d = prev ? (b.close / prev - 1) * 100 : null;
    ro.innerHTML = `<span>${esc(t)}</span><span>O<b>${num(b.open)}</b></span><span>H<b>${num(b.high)}</b></span><span>L<b>${num(b.low)}</b></span><span>C<b>${num(b.close)}</b></span>${d != null ? `<span class="${dir(d)}">${pct(d)}</span>` : ""}`;
  };
  show(bars[bars.length - 1]);
  chart.subscribeCrosshairMove((p) => show((p && p.time && p.seriesData.get(candles)) || bars[bars.length - 1]));

  const setRange = (i) => {
    const n = RANGES[i][1];
    if (!n || n >= bars.length) chart.timeScale().fitContent();
    else chart.timeScale().setVisibleLogicalRange({ from: bars.length - n, to: bars.length + 2 });
    document.querySelectorAll("#range button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.i) === i)));
  };
  document.getElementById("range").onclick = (e) => { const b = e.target.closest("button"); if (b) setRange(Number(b.dataset.i)); };

  document.getElementById("layers").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(on));
    if (b.dataset.l === "levels") {
      if (on) addLevels(); else { levelLines.forEach((l) => candles.removePriceLine(l)); levelLines = []; }
    } else layers[b.dataset.l].applyOptions({ visible: on });
  };

  // momentum panel, scrolled together with the price chart
  let mom = null;
  chart.timeScale().subscribeVisibleLogicalRangeChange((rg) => { if (rg && mom) mom.timeScale().setVisibleLogicalRange(rg); });
  const drawMom = (kind) => {
    if (mom) { state.charts = state.charts.filter((c) => c !== mom); mom.remove(); mom = null; }
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
    const rg = chart.timeScale().getVisibleLogicalRange();
    if (rg) m.timeScale().setVisibleLogicalRange(rg);
    mom = m;
    document.querySelectorAll("#mom button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === kind)));
  };
  setRange(2);
  drawMom("rsi");
  document.getElementById("mom").onclick = (e) => { const b = e.target.closest("button"); if (b) drawMom(b.dataset.k); };
}

function drawScores(rows) {
  const el = document.getElementById("c-score");
  if (rows.length < 2) {
    el.style.height = "auto";
    el.innerHTML = `<div class="empty">The score trend appears after a few daily runs (${rows.length} so far).</div>`;
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
      <h2>Updates</h2>
      <p>GitHub Actions rebuilds this page on weekdays after each market closes: India and China/HK at 08:30 UTC, Europe at 17:00 UTC, and the US at 21:30 UTC.</p>
      <h2>Scoring</h2>
      <p>Every stock starts at 50 and moves with transparent technical rules: moving-average alignment, position against the 50- and 200-day averages and their crosses, RSI, MACD, distance from the 5-day average (a "don't chase" guard) and volume. Ratings: 75+ Strong Buy, 60+ Buy, 45+ Hold, 30+ Reduce, below 30 Sell.</p>
      <h2>Trade plan</h2>
      <p>Entry is the 5-day average, or the close if the price is below it. The stop is 20-day support or two ATRs below entry, whichever is higher. The target is 20-day resistance or three ATRs above entry, whichever is higher.</p>
      <h2>Your watchlist</h2>
      <p>Edit <code>config.yaml</code> in the repository. The next run picks it up.</p>
      ${editLink()}
      ${repo ? `<p><a href="https://github.com/${esc(repo)}/actions/workflows/daily-analysis.yml" target="_blank" rel="noopener">Run the analysis now →</a></p>` : ""}
      <p class="muted small">Built with open-source tools: yfinance, pandas, feedparser and TradingView Lightweight Charts. For research and education only, not investment advice.</p>
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

// ---------- router -------------------------------------------------------------------------------
async function router() {
  clearCharts();
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  const view = h.split("/")[0], arg = h.split("/").slice(1).join("/");
  document.querySelectorAll(".mainnav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === (view === "s" || !view ? "today" : view)));
  try {
    if (view === "s" && arg) await renderStock(arg);
    else if (view === "history") await renderHistory(arg);
    else if (view === "about") renderAbout();
    else renderOverview(state.latest);
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
    state.latest = await getJSON("data/latest.json");
  } catch {
    app.innerHTML = `<div class="page-head"><h1>No data yet</h1></div><div class="card pad">The first scheduled run hasn't published results yet. Start the "Daily Stock Analysis" workflow from the repository's Actions tab.</div>`;
    return;
  }
  const syms = allResults(state.latest);
  document.getElementById("symbols").innerHTML = syms.map((r) => `<option value="${esc(r.symbol)}">${esc(r.name)}</option>`).join("");
  const input = document.getElementById("search-input");
  const go = (q) => {
    q = q.trim().toUpperCase();
    if (!q) return;
    const hit = syms.find((r) => r.symbol === q) || syms.find((r) => r.name.toUpperCase().includes(q) || r.symbol.startsWith(q));
    if (hit) { location.hash = route(hit.symbol); input.value = ""; input.blur(); }
  };
  document.getElementById("search").onsubmit = (e) => { e.preventDefault(); go(input.value); };
  input.addEventListener("change", () => { if (syms.some((r) => r.symbol === input.value.trim().toUpperCase())) go(input.value); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); input.focus(); }
  });
  window.addEventListener("hashchange", () => { router(); window.scrollTo(0, 0); });
  router();
}

init();
