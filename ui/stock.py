"""Stock: full detail for one ticker."""
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

from stock_analyzer.indicators import add_all
from ui.common import (RATING_ICON, analyze_one, ai_view, llm_status, load_stock,
                       news_for, settings, sidebar)

demo, period = sidebar()
cfg = settings()
known = [s for syms in cfg.watchlist.values() for s in syms]

c1, c2 = st.columns([2, 1])
current = st.session_state.get("symbol") or (known[0] if known else "AAPL")
options = known if current in known else [current] + known
pick = c1.selectbox("Watchlist stock", options, index=options.index(current))
typed = c2.text_input("Or any ticker", placeholder="e.g. TATAMOTORS.NS").strip().upper()
symbol = typed or pick
st.session_state["symbol"] = symbol

r = analyze_one(symbol, period, demo, cfg.max_bias_pct)
if r is None:
    st.error(f"No usable data for **{symbol}**. Check the ticker format, e.g. `TCS.NS`, `0700.HK`, `SAP.DE`.")
    st.stop()

st.title(f"{RATING_ICON[r.rating]} {r.symbol}")
st.caption(f"{r.name} · {r.market.title()} · {r.currency} · data to {r.date}")

m = st.columns(5)
m[0].metric("Close", f"{r.close:,.2f}", f"{r.change_pct:+.2f}%")
m[1].metric(f"Score · {r.rating}", f"{r.score}/100")
m[2].metric("RSI 14", f"{r.rsi:.0f}")
m[3].metric("1 month", f"{r.change_1m_pct:+.2f}%")
m[4].metric("vs MA5", f"{r.bias_ma5_pct:+.2f}%")

# --- Chart -------------------------------------------------------------------
df = add_all(load_stock(symbol, period, demo).history)
fig = make_subplots(rows=3, cols=1, shared_xaxes=True, row_heights=[0.6, 0.2, 0.2], vertical_spacing=0.03)
fig.add_trace(go.Candlestick(x=df.index, open=df.Open, high=df.High, low=df.Low, close=df.Close, name="Price"), 1, 1)
for ma, color in (("MA20", "#f59e0b"), ("MA50", "#0ea5e9"), ("MA200", "#6b7280")):
    fig.add_trace(go.Scatter(x=df.index, y=df[ma], name=ma, line=dict(width=1.4, color=color)), 1, 1)
for y, name, color in ((r.entry, "Entry", "#2457d6"), (r.stop_loss, "Stop", "#d03b3b"), (r.target, "Target", "#1f9d55")):
    fig.add_hline(y=y, line_dash="dash", line_color=color, annotation_text=name, row=1, col=1)
fig.add_trace(go.Bar(x=df.index, y=df.MACD_HIST, name="MACD hist",
                     marker_color=["#1f9d55" if v >= 0 else "#d03b3b" for v in df.MACD_HIST]), 2, 1)
fig.add_trace(go.Scatter(x=df.index, y=df.RSI14, name="RSI", line=dict(color="#8a5cd6")), 3, 1)
for y in (30, 70):
    fig.add_hline(y=y, line_dash="dot", line_color="gray", row=3, col=1)
fig.update_layout(height=640, xaxis_rangeslider_visible=False, margin=dict(l=8, r=8, t=8, b=8),
                  legend=dict(orientation="h", y=1.02))
st.plotly_chart(fig, width="stretch")

# --- Plan / signals ------------------------------------------------------------------
a, b, c = st.columns(3)
with a.container(border=True):
    st.markdown("**Trade plan**")
    risk = r.entry - r.stop_loss
    rr = (r.target - r.entry) / risk if risk > 0 else 0
    st.markdown(f"Entry ~**{r.entry:,.2f}**  \nStop **{r.stop_loss:,.2f}**  \nTarget **{r.target:,.2f}**  \n"
                f"Reward/risk **{rr:.1f}**  \nSupport {r.support:,.2f} · Resistance {r.resistance:,.2f}")
with b.container(border=True):
    st.markdown("**Checklist**")
    st.markdown("\n".join(f"- {'✅' if ok else '❌'} {k}" for k, ok in r.checklist))
with c.container(border=True):
    st.markdown(f"**Trend:** {r.trend}  \n**MACD:** {r.macd_state}")
    if r.signals:
        st.markdown("\n".join(f"- 🟢 {s}" for s in r.signals))
    if r.risks:
        st.markdown("\n".join(f"- 🔴 {s}" for s in r.risks))

if r.fundamentals:
    with st.expander("Fundamentals"):
        st.json(r.fundamentals)

# --- News & AI -----------------------------------------------------------------------
left, right = st.columns(2)
news = news_for(symbol, r.name, r.market, demo, r.fundamentals.get("shortName", ""))
with left:
    st.subheader("News")
    if not news:
        st.caption("No recent headlines" + (" (demo mode)" if demo else "."))
    for n in news:
        st.markdown(f"- [{n['title']}]({n['link']}) · _{n['source']}_")
with right:
    st.subheader("AI view")
    if not llm_status():
        st.caption("Connect an open-source model (e.g. `ollama serve` with `qwen2.5:7b`) to get a written assessment.")
    elif st.button("Ask the AI model"):
        st.write(ai_view(r, tuple(n["title"] for n in news)))

st.caption("For research and education only. Not investment advice.")
