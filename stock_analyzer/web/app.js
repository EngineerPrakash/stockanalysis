/* Global Stock Analyzer: static dashboard. Reads JSON written by stock_analyzer/site.py. */
"use strict";

const MARKET_ORDER = ["india", "us", "china", "europe"];
const MAX_BIAS = 5;
const state = { latest: null, scores: null, series: {}, charts: [] };
const app = document.getElementById("app");

// ---------- helpers -------------------------------------------------------------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");
const fmt = (v, d = 2) => (v == null || isNaN(v) ? "–" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (v) => (v == null ? "–" : `${v > 0 ? "+" : ""}${Number(v).toFixed(2)}%`);
const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
const ratingClass = (r) => "r-" + String(r).toLowerCase().replace(/\s+/g, "-");
const pill = (r) => `<span class="pill ${ratingClass(r)}">${esc(r)}</span>`;
const passed = (r) => r.checklist.filter((c) => c[1]).length;
const route = (sym) => `#/s/${encodeURIComponent(sym)}`;
const safeName = (s) => s.replace(/[^A-Za-z0-9.-]/g, "_");
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

async function getJSON(path) {
  const r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

function ago(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

function allResults(snapshot) {
  return MARKET_ORDER.flatMap((c) => (snapshot.markets[c]?.results || []).map((r) => ({ ...r, _market: c })));
}

function alertsFor(r) {
  const out = [];
  if (/crossover/i.test(r.macd_state)) out.push(`MACD ${r.macd_state.toLowerCase()}`);
  [...r.signals, ...r.risks].forEach((t) => { if (t.includes("cross (")) out.push(t.split(" (")[0]); });
  if (r.rsi > 70) out.push(`Overbought (RSI ${Math.round(r.rsi)})`);
  else if (r.rsi < 30) out.push(`Oversold (RSI ${Math.round(r.rsi)})`);
  if (r.bias_ma5_pct > MAX_BIAS) out.push(`Extended ${pct(r.bias_ma5_pct)} vs MA5`);
  if (r.volume_ratio > 1.8) out.push(`Heavy volume ${r.volume_ratio.toFixed(1)}×`);
  return out;
}

function clearCharts() {
  state.charts.forEach((c) => c.remove());
  state.charts = [];
}

// ---------- views ------------------------------------------------------------------
function renderToday(snapshot, opts = {}) {
  const results = allResults(snapshot);
  const markets = MARKET_ORDER.filter((c) => snapshot.markets[c]);
  const title = opts.date ? `Snapshot · ${opts.date}` : "Today";

  const cards = markets.map((c) => {
    const m = snapshot.markets[c];
    const res = m.results || [];
    const up = res.filter((r) => r.change_pct > 0).length;
    const avg = res.length ? Math.round(res.reduce((a, r) => a + r.score, 0) / res.length) : 0;
    return `<div class="card market">
      <h3><span>${esc(m.name)}</span><span class="muted small" title="${esc(m.updated)}">${esc(ago(m.updated))}</span></h3>
      ${m.indices.map((i) => `<div class="idx"><span>${esc(i.label)}</span><span class="num"><b>${fmt(i.close, 0)}</b> <span class="chg ${cls(i.change_pct)}">${pct(i.change_pct)}</span></span></div>`).join("")}
      <div class="muted small" style="margin-top:8px">${up}/${res.length} up today · avg score ${avg}</div>
      ${m.overview ? `<p class="small">${esc(m.overview)}</p>` : ""}
    </div>`;
  }).join("");

  const top = results.filter((r) => r.score >= 60).sort((a, b) => b.score - a.score).slice(0, 6);
  const setups = top.length ? top.map((r) => `
    <a class="card setup" href="${route(r.symbol)}" style="text-decoration:none;color:inherit">
      <div>
        <div><b>${esc(r.symbol)}</b> <span class="muted">${esc(r.name)}</span></div>
        <div class="small muted num">Entry ~${fmt(r.entry)} · stop ${fmt(r.stop_loss)} · target ${fmt(r.target)} ${esc(r.currency)} · checklist ${passed(r)}/${r.checklist.length}</div>
      </div>
      <div style="text-align:right"><div class="score">${r.score}</div>${pill(r.rating)}</div>
    </a>`).join("") : `<div class="card muted">Nothing scores Buy or better.</div>`;

  const alerts = results.flatMap((r) => alertsFor(r).map((a) => ({ r, a })));
  const alertList = alerts.length
    ? `<ul class="alerts">${alerts.slice(0, 16).map(({ r, a }) => `<li><a href="${route(r.symbol)}"><b>${esc(r.symbol)}</b></a> ${esc(a)}</li>`).join("")}</ul>`
    : `<p class="muted">No alerts.</p>`;

  const errors = (snapshot.errors || []).length
    ? `<details class="card small" style="margin-top:16px"><summary>⚠️ ${snapshot.errors.length} ticker(s) could not be analyzed</summary><ul>${snapshot.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></details>` : "";

  app.innerHTML = `
    <h1>${esc(title)}</h1>
    <div class="muted small">${results.length} stocks across ${markets.length} markets · updated ${esc(new Date(snapshot.generated).toLocaleString())}</div>
    ${snapshot.demo ? `<div class="banner">Showing demo data (synthetic prices).</div>` : ""}
    <div class="grid g4" style="margin-top:16px">${cards}</div>
    <div class="grid g2" style="margin-top:8px">
      <section><h2>Best setups</h2><div class="grid">${setups}</div></section>
      <section><h2>Alerts</h2><div class="card">${alertList}</div></section>
    </div>
    <h2>Watchlist</h2>
    <div class="tabs" id="tabs">${["all", ...markets].map((c, i) => `<button data-m="${c}" class="${i === 0 ? "active" : ""}">${c === "all" ? "All" : esc(snapshot.markets[c].name)}</button>`).join("")}</div>
    <div class="card table-wrap" id="table"></div>
    ${errors}`;

  let market = "all", sortKey = "score", dir = -1;
  const cols = [
    ["symbol", "Stock"], ["close", "Close", "r"], ["change_pct", "Day", "r"], ["change_1m_pct", "1M", "r hide-sm"],
    ["score", "Score"], ["rating", "Rating"], ["rsi", "RSI", "r hide-sm"], ["trend", "Trend", "hide-sm"],
  ];
  const drawTable = () => {
    const rows = results.filter((r) => market === "all" || r._market === market)
      .sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * dir);
    document.getElementById("table").innerHTML = `<table>
      <thead><tr>${cols.map(([k, l, c = ""]) => `<th class="${c}" data-k="${k}">${l}${k === sortKey ? (dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr data-s="${esc(r.symbol)}">
        <td><b>${esc(r.symbol)}</b><div class="muted small">${esc(r.name)}</div></td>
        <td class="r">${fmt(r.close)} <span class="muted small">${esc(r.currency)}</span></td>
        <td class="r chg ${cls(r.change_pct)}">${pct(r.change_pct)}</td>
        <td class="r hide-sm ${cls(r.change_1m_pct)}">${pct(r.change_1m_pct)}</td>
        <td><span class="bar"><i style="width:${r.score}%"></i></span>${r.score}</td>
        <td>${pill(r.rating)}</td>
        <td class="r hide-sm">${Math.round(r.rsi)}</td>
        <td class="hide-sm muted">${esc(r.trend.split(" (")[0])}</td></tr>`).join("")}</tbody></table>`;
  };
  drawTable();
  document.getElementById("tabs").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    market = b.dataset.m;
    document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
    drawTable();
  };
  document.getElementById("table").onclick = (e) => {
    const th = e.target.closest("th");
    if (th) { const k = th.dataset.k; dir = k === sortKey ? -dir : (k === "symbol" ? 1 : -1); sortKey = k; return drawTable(); }
    const tr = e.target.closest("tr[data-s]");
    if (tr) location.hash = route(tr.dataset.s);
  };
}

async function renderStock(symbol) {
  const r = allResults(state.latest).find((x) => x.symbol === symbol);
  if (!r) {
    app.innerHTML = `<h1>${esc(symbol)}</h1><p>This stock isn't in the watchlist. Add it to <code>config.yaml</code> and it will appear after the next run.</p>${editLink()}`;
    return;
  }
  const risk = r.entry - r.stop_loss;
  const rr = risk > 0 ? (r.target - r.entry) / risk : 0;
  const f = r.fundamentals || {};
  const fund = [
    ["Sector", f.sector], ["Industry", f.industry],
    ["Market cap", f.marketCap ? `${fmt(f.marketCap / 1e9, 1)} B` : null],
    ["P/E (trailing)", f.trailingPE && fmt(f.trailingPE, 1)], ["P/E (forward)", f.forwardPE && fmt(f.forwardPE, 1)],
    ["P/B", f.priceToBook && fmt(f.priceToBook, 2)], ["Beta", f.beta && fmt(f.beta, 2)],
    ["ROE", f.returnOnEquity != null ? pct(f.returnOnEquity * 100) : null],
    ["Revenue growth", f.revenueGrowth != null ? pct(f.revenueGrowth * 100) : null],
    ["52w high", f.fiftyTwoWeekHigh && fmt(f.fiftyTwoWeekHigh)], ["52w low", f.fiftyTwoWeekLow && fmt(f.fiftyTwoWeekLow)],
  ].filter(([, v]) => v != null && v !== "");

  app.innerHTML = `
    <div class="muted small"><a href="#/">← Today</a></div>
    <h1>${esc(r.symbol)} ${pill(r.rating)}</h1>
    <div class="muted">${esc(r.name)} · ${esc(state.latest.markets[r._market].name)} · ${esc(r.currency)} · data to ${esc(r.date)}</div>
    <div class="metrics">
      <div class="card metric"><div class="label">Close</div><div class="value">${fmt(r.close)}</div><div class="chg ${cls(r.change_pct)}">${pct(r.change_pct)}</div></div>
      <div class="card metric"><div class="label">Score</div><div class="value">${r.score}<span class="muted small">/100</span></div><div class="small muted">${esc(r.rating)}</div></div>
      <div class="card metric"><div class="label">RSI 14</div><div class="value">${Math.round(r.rsi)}</div><div class="small muted">${r.rsi > 70 ? "Overbought" : r.rsi < 30 ? "Oversold" : "Neutral"}</div></div>
      <div class="card metric"><div class="label">1 month</div><div class="value ${cls(r.change_1m_pct)}">${pct(r.change_1m_pct)}</div><div class="small muted">5D ${pct(r.change_5d_pct)}</div></div>
      <div class="card metric"><div class="label">vs MA5</div><div class="value">${pct(r.bias_ma5_pct)}</div><div class="small muted">${r.bias_ma5_pct > MAX_BIAS ? "Extended" : "OK"}</div></div>
    </div>
    <div class="card">
      <div id="c-price" class="chart" style="height:380px"></div>
      <div class="legend"><span><i style="background:#f59e0b"></i>MA20</span><span><i style="background:#0ea5e9"></i>MA50</span><span><i style="background:#8b93a1"></i>MA200</span>
        <span><i style="background:${css("--accent")}"></i>Entry</span><span><i style="background:${css("--down")}"></i>Stop</span><span><i style="background:${css("--up")}"></i>Target</span></div>
      <div class="muted small" style="margin-top:10px">MACD histogram</div><div id="c-macd" class="chart" style="height:90px"></div>
      <div class="muted small" style="margin-top:6px">RSI 14</div><div id="c-rsi" class="chart" style="height:90px"></div>
    </div>
    <div class="grid g3" style="margin-top:12px">
      <div class="card"><h3>Trade plan</h3><dl class="kv">
        <dt>Entry</dt><dd>~${fmt(r.entry)}</dd><dt>Stop-loss</dt><dd>${fmt(r.stop_loss)}</dd><dt>Target</dt><dd>${fmt(r.target)}</dd>
        <dt>Reward / risk</dt><dd>${rr.toFixed(2)}</dd><dt>Support</dt><dd>${fmt(r.support)}</dd><dt>Resistance</dt><dd>${fmt(r.resistance)}</dd></dl></div>
      <div class="card"><h3>Checklist · ${passed(r)}/${r.checklist.length}</h3><ul class="plain check">${r.checklist.map(([k, ok]) => `<li>${ok ? "✅" : "❌"} ${esc(k)}</li>`).join("")}</ul></div>
      <div class="card"><h3>Signals</h3><div class="small muted">Trend: ${esc(r.trend)} · MACD: ${esc(r.macd_state)}</div>
        <ul class="plain" style="margin-top:6px">${r.signals.map((s) => `<li class="up">${esc(s)}</li>`).join("")}${r.risks.map((s) => `<li class="down">${esc(s)}</li>`).join("")}</ul></div>
    </div>
    <div class="grid g2" style="margin-top:12px">
      <div class="card"><h3>News</h3>${r.news?.length ? `<ul class="plain news">${r.news.map((n) => `<li><a href="${esc(safeUrl(n.link))}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="muted small">${esc(n.source)}</span></li>`).join("")}</ul>` : `<p class="muted">No recent headlines.</p>`}
        ${r.ai_summary ? `<h3 style="margin-top:14px">AI view</h3><p>${esc(r.ai_summary)}</p>` : ""}</div>
      <div class="card"><h3>Score history</h3><div id="c-score" class="chart" style="height:140px"></div>
        ${fund.length ? `<h3 style="margin-top:14px">Fundamentals</h3><dl class="kv">${fund.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}</div>
    </div>`;

  if (!window.LightweightCharts) {
    document.getElementById("c-price").innerHTML = `<p class="muted">Chart library could not load.</p>`;
    return;
  }
  try {
    const s = state.series[symbol] || (state.series[symbol] = await getJSON(`data/series/${safeName(symbol)}.json`));
    drawCharts(s, r);
  } catch (e) {
    document.getElementById("c-price").innerHTML = `<p class="muted">No chart data yet.</p>`;
  }
  try {
    state.scores = state.scores || await getJSON("data/scores.json");
    drawScores(state.scores[symbol] || []);
  } catch { /* optional */ }
}

function chartOptions(el, height) {
  return {
    width: el.clientWidth, height,
    layout: { background: { color: "transparent" }, textColor: css("--muted"), fontFamily: "system-ui, sans-serif",
              attributionLogo: height >= 300 },
    grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } },
    rightPriceScale: { borderColor: css("--line") }, timeScale: { borderColor: css("--line") },
    crosshair: { mode: 0 }, handleScroll: { vertTouchDrag: false },
  };
}

function makeChart(id, height) {
  const el = document.getElementById(id);
  const chart = LightweightCharts.createChart(el, chartOptions(el, height));
  state.charts.push(chart);
  new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth })).observe(el);
  return chart;
}

function line(s, key) {
  return s.t.map((t, i) => ({ time: t, value: s[key]?.[i] })).filter((p) => p.value != null);
}

function drawCharts(s, r) {
  const up = css("--up"), down = css("--down");
  const price = makeChart("c-price", 380);
  const candles = price.addCandlestickSeries({ upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down });
  candles.setData(s.t.map((t, i) => ({ time: t, open: s.o[i], high: s.h[i], low: s.l[i], close: s.c[i] })).filter((b) => b.close != null));
  [["ma20", "#f59e0b"], ["ma50", "#0ea5e9"], ["ma200", "#8b93a1"]].forEach(([k, color]) =>
    price.addLineSeries({ color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(line(s, k)));
  [[r.entry, css("--accent"), "Entry"], [r.stop_loss, down, "Stop"], [r.target, up, "Target"]].forEach(([price_, color, title]) =>
    candles.createPriceLine({ price: price_, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title }));
  price.timeScale().fitContent();

  const macd = makeChart("c-macd", 90);
  macd.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false })
    .setData(line(s, "macd").map((p) => ({ ...p, color: p.value >= 0 ? up : down })));
  const rsi = makeChart("c-rsi", 90);
  const rs = rsi.addLineSeries({ color: "#8a5cd6", lineWidth: 1.5, priceLineVisible: false });
  rs.setData(line(s, "rsi"));
  [70, 30].forEach((v) => rs.createPriceLine({ price: v, color: css("--muted"), lineWidth: 1, lineStyle: 1, axisLabelVisible: false }));

  // keep the three charts scrolled together
  const charts = [price, macd, rsi];
  charts.forEach((c) => c.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (!range) return;
    charts.forEach((o) => o !== c && o.timeScale().setVisibleLogicalRange(range));
  }));
}

function drawScores(rows) {
  const el = document.getElementById("c-score");
  if (rows.length < 2) { el.innerHTML = `<p class="muted small">Score history builds up as daily runs accumulate (${rows.length} day so far).</p>`; return; }
  const c = makeChart("c-score", 140);
  c.addLineSeries({ color: css("--accent"), lineWidth: 2 }).setData(rows.map(([t, v]) => ({ time: t, value: v })));
  c.priceScale("right").applyOptions({ autoScale: false });
  c.timeScale().fitContent();
}

async function renderHistory(date) {
  let dates = [];
  try { dates = await getJSON("data/history/index.json"); } catch { /* none yet */ }
  if (!dates.length) { app.innerHTML = `<h1>History</h1><p class="muted">No saved days yet.</p>`; return; }
  if (!date) {
    app.innerHTML = `<h1>History</h1><p class="muted">Each scheduled run saves a snapshot. Pick a day:</p>
      <div class="dates">${dates.map((d) => `<a href="#/history/${d}">${d}</a>`).join("")}</div>`;
    return;
  }
  const snap = await getJSON(`data/history/${date}.json`);
  renderToday(snap, { date });
  app.insertAdjacentHTML("afterbegin", `<div class="dates" style="margin-bottom:14px">${dates.slice(0, 14).map((d) => `<a class="${d === date ? "active" : ""}" href="#/history/${d}">${d}</a>`).join("")}</div>`);
}

function editLink() {
  const repo = state.latest?.repo;
  return repo ? `<p><a href="https://github.com/${esc(repo)}/edit/main/config.yaml" target="_blank" rel="noopener">Edit the watchlist on GitHub →</a></p>` : "";
}

function renderAbout() {
  const repo = state.latest?.repo;
  app.innerHTML = `<h1>About</h1>
    <div class="card" style="max-width:760px">
      <p>This page is rebuilt automatically by GitHub Actions on weekdays after each market closes:
      India &amp; China/HK (08:30 UTC), Europe (17:00 UTC) and US (21:30 UTC).</p>
      <p>Each stock gets a 0–100 score from transparent technical rules: moving-average alignment, MA50/MA200 position and crosses,
      RSI, MACD, distance from MA5 ("don't chase"), and volume. Entry, stop and target come from the 5-day average,
      20-day support/resistance and ATR.</p>
      <p><b>Add or remove stocks:</b> edit <code>config.yaml</code> in the repository; the next run picks it up.</p>
      ${editLink()}
      ${repo ? `<p><a href="https://github.com/${esc(repo)}/actions/workflows/daily-analysis.yml" target="_blank" rel="noopener">Run the analysis now (Actions → Run workflow) →</a></p>` : ""}
      <p class="muted small">Built with open-source tools: yfinance, pandas, feedparser, TradingView Lightweight Charts. For research and education only, not investment advice.</p>
    </div>`;
}

// ---------- router -------------------------------------------------------------------
async function router() {
  clearCharts();
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  const [view, arg] = [h.split("/")[0], h.split("/").slice(1).join("/")];
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === (view === "s" || !view ? "today" : view)));
  try {
    if (view === "s" && arg) await renderStock(arg);
    else if (view === "history") await renderHistory(arg);
    else if (view === "about") renderAbout();
    else renderToday(state.latest);
    window.scrollTo(0, 0);
  } catch (e) {
    app.innerHTML = `<p class="down">Something went wrong: ${esc(e.message)}</p>`;
  }
}

async function init() {
  try {
    state.latest = await getJSON("data/latest.json");
  } catch {
    app.innerHTML = `<h1>No data yet</h1><p class="muted">The first scheduled run hasn't published results. Run the "Daily Stock Analysis" workflow from the Actions tab.</p>`;
    return;
  }
  const syms = allResults(state.latest);
  document.getElementById("symbols").innerHTML = syms.map((r) => `<option value="${esc(r.symbol)}">${esc(r.name)}</option>`).join("");
  document.getElementById("search").onsubmit = (e) => {
    e.preventDefault();
    const q = document.getElementById("search-input").value.trim().toUpperCase();
    const hit = syms.find((r) => r.symbol === q) || syms.find((r) => r.name.toUpperCase().includes(q));
    if (hit) { location.hash = route(hit.symbol); e.target.reset(); }
  };
  document.getElementById("search-input").addEventListener("change", (e) => {
    const hit = syms.find((r) => r.symbol === e.target.value.trim().toUpperCase());
    if (hit) { location.hash = route(hit.symbol); e.target.value = ""; }
  });
  window.addEventListener("hashchange", router);
  router();
}

init();
