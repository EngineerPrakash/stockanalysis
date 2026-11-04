"""Today: all markets at a glance, best setups, and alerts."""
from datetime import datetime

import streamlit as st

from stock_analyzer.markets import MARKETS
from ui.common import (RATING_ICON, TABLE_CONFIG, alerts, analyze_all, open_stock,
                       results_table, settings, sidebar)

demo, period = sidebar()
cfg = settings()
markets, errors = analyze_all(cfg.watchlist, period, demo, cfg.max_bias_pct)
by_code = {m["code"]: m for m in markets}
everything = [r for m in markets for r in m["results"]]

st.title("Today")
st.caption(f"{datetime.now():%A, %d %B %Y} · {len(everything)} stocks across {len(MARKETS)} markets"
           + (" · demo data" if demo else ""))

# --- Market cards -------------------------------------------------------------
cols = st.columns(len(MARKETS))
for col, (code, mk) in zip(cols, MARKETS.items()):
    m = by_code.get(code, {"indices": [], "results": []})
    with col.container(border=True):
        st.markdown(f"**{mk.name}**")
        for i in m["indices"][:2]:
            st.metric(i["label"], f"{i['close']:,.0f}", f"{i['change_pct']:+.2f}%")
        res = m["results"]
        if res:
            up = sum(r.change_pct > 0 for r in res)
            avg = sum(r.score for r in res) / len(res)
            st.caption(f"{up}/{len(res)} up today · avg score {avg:.0f}")
        else:
            st.caption("No stocks in watchlist")

# --- Best setups & alerts -------------------------------------------------------
left, right = st.columns([3, 2])
with left:
    st.subheader("Best setups")
    top = sorted([r for r in everything if r.score >= 60], key=lambda r: r.score, reverse=True)[:6]
    if not top:
        st.info("Nothing scores Buy or better today.")
    for r in top:
        passed = sum(ok for _, ok in r.checklist)
        with st.container(border=True):
            a, b = st.columns([4, 1])
            a.markdown(f"{RATING_ICON[r.rating]} **{r.symbol}** · {r.name}  \n"
                       f"Score **{r.score}** · {r.rating} · checklist {passed}/{len(r.checklist)}  \n"
                       f"Entry ~{r.entry:,.2f} · stop {r.stop_loss:,.2f} · target {r.target:,.2f} {r.currency}")
            if b.button("Open", key=f"top-{r.symbol}", width="stretch"):
                open_stock(r.symbol)
with right:
    st.subheader("Alerts")
    rows = [(r, a) for r in everything for a in alerts(r, cfg.max_bias_pct)]
    if not rows:
        st.caption("No alerts today.")
    for r, text in rows[:15]:
        st.markdown(f"- **{r.symbol}**: {text}")

# --- Per-market tables -------------------------------------------------------------
st.subheader("Watchlist")
st.caption("Click a row to open the stock.")
tabs = st.tabs([MARKETS[c].name for c in MARKETS])
for tab, code in zip(tabs, MARKETS):
    with tab:
        res = by_code.get(code, {}).get("results", [])
        if not res:
            st.info("No stocks yet. Add some on the Watchlist page.")
            continue
        ev = st.dataframe(results_table(res), hide_index=True, width="stretch",
                          column_config=TABLE_CONFIG, on_select="rerun",
                          selection_mode="single-row", key=f"tbl-{code}")
        if ev.selection.rows:
            open_stock(res[ev.selection.rows[0]].symbol)

if errors:
    with st.expander(f"⚠️ {len(errors)} ticker(s) could not be analyzed"):
        for e in errors:
            st.write(e)

st.caption("For research and education only. Not investment advice.")
