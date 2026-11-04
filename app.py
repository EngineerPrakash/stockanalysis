"""Interactive dashboard:  streamlit run app.py"""
from __future__ import annotations

import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

from stock_analyzer.analysis import analyze, to_frame
from stock_analyzer.data import get_provider
from stock_analyzer.indicators import add_all
from stock_analyzer.markets import MARKETS, detect_market
from stock_analyzer.pipeline import Settings

st.set_page_config(page_title="Global Stock Analyzer", page_icon="📈", layout="wide")

try:
    settings = Settings.load("config.yaml")
except FileNotFoundError:
    settings = Settings()

with st.sidebar:
    st.header("Settings")
    demo = st.toggle("Demo data (offline)", value=False)
    market = st.selectbox("Market", list(MARKETS), format_func=lambda m: MARKETS[m].name)
    default = ", ".join(settings.watchlist.get(market, []))
    tickers = [t.strip().upper() for t in st.text_area("Tickers (Yahoo symbols)", default).split(",") if t.strip()]
    period = st.selectbox("History", ["6mo", "1y", "2y", "5y"], index=1)


@st.cache_data(ttl=900, show_spinner=False)
def load(symbol: str, period: str, demo: bool):
    return get_provider(demo=demo, period=period).fetch(symbol)


st.title(f"📈 {MARKETS[market].name} - Daily Analysis")

cols = st.columns(len(MARKETS[market].benchmarks))
for col, (sym, label) in zip(cols, MARKETS[market].benchmarks.items()):
    d = load(sym, period, demo)
    if d is not None and len(d.history) > 1:
        c = d.history["Close"]
        col.metric(label, f"{c.iloc[-1]:,.2f}", f"{(c.iloc[-1] / c.iloc[-2] - 1) * 100:+.2f}%")

results, data = [], {}
with st.spinner("Analyzing..."):
    for t in tickers:
        d = load(t, period, demo)
        if d is None:
            st.warning(f"No data for {t}")
            continue
        try:
            results.append(analyze(d, settings.max_bias_pct))
            data[t] = d
        except ValueError as e:
            st.warning(str(e))

if not results:
    st.info("Add tickers in the sidebar to begin.")
    st.stop()

results.sort(key=lambda r: r.score, reverse=True)
st.subheader("Watchlist ranking")
st.dataframe(to_frame(results), hide_index=True, use_container_width=True,
             column_config={"Score": st.column_config.ProgressColumn("Score", min_value=0, max_value=100)})

pick = st.selectbox("Detail", [r.symbol for r in results])
r = next(x for x in results if x.symbol == pick)
df = add_all(data[pick].history)

a, b, c, d_ = st.columns(4)
a.metric("Close", f"{r.close:,.2f} {r.currency}", f"{r.change_pct:+.2f}%")
b.metric("Score", f"{r.score}/100", r.rating)
c.metric("RSI 14", r.rsi)
d_.metric("Bias vs MA5", f"{r.bias_ma5_pct:+.2f}%")

fig = make_subplots(rows=3, cols=1, shared_xaxes=True, row_heights=[0.6, 0.2, 0.2], vertical_spacing=0.03)
fig.add_trace(go.Candlestick(x=df.index, open=df.Open, high=df.High, low=df.Low, close=df.Close, name="Price"), 1, 1)
for ma in ("MA20", "MA50", "MA200"):
    fig.add_trace(go.Scatter(x=df.index, y=df[ma], name=ma, line=dict(width=1)), 1, 1)
for y, name, dash in ((r.entry, "Entry", "dot"), (r.stop_loss, "Stop", "dash"), (r.target, "Target", "dash")):
    fig.add_hline(y=y, line_dash=dash, annotation_text=name, row=1, col=1)
fig.add_trace(go.Bar(x=df.index, y=df.MACD_HIST, name="MACD hist"), 2, 1)
fig.add_trace(go.Scatter(x=df.index, y=df.RSI14, name="RSI"), 3, 1)
fig.add_hline(y=70, line_dash="dot", row=3, col=1)
fig.add_hline(y=30, line_dash="dot", row=3, col=1)
fig.update_layout(height=720, xaxis_rangeslider_visible=False, margin=dict(l=10, r=10, t=10, b=10))
st.plotly_chart(fig, use_container_width=True)

left, right = st.columns(2)
with left:
    st.markdown("**Positive signals**\n" + "\n".join(f"- {s}" for s in r.signals) if r.signals else "_No positive signals_")
    st.markdown(f"**Plan:** entry ~{r.entry:,.2f} · stop {r.stop_loss:,.2f} · target {r.target:,.2f}")
with right:
    st.markdown("**Risks**\n" + "\n".join(f"- {s}" for s in r.risks) if r.risks else "_No major risks flagged_")
    st.markdown("**Checklist**\n" + "\n".join(f"- {'✅' if ok else '❌'} {k}" for k, ok in r.checklist))

st.caption("For research and education only. Not investment advice.")
