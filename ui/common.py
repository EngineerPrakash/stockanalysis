"""Shared state, cached loaders and helpers for the Streamlit UI."""
from __future__ import annotations

import os
from dataclasses import replace
from pathlib import Path

import streamlit as st

from stock_analyzer.analysis import Analysis, analyze
from stock_analyzer.data import get_provider
from stock_analyzer.llm import LLMClient
from stock_analyzer.markets import MARKETS
from stock_analyzer.news import fetch_news
from stock_analyzer.pipeline import Settings, run

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config.yaml"
REPORTS = ROOT / "reports"

RATING_ICON = {"Strong Buy": "🟢", "Buy": "🟢", "Hold": "🟡", "Reduce": "🟠", "Sell": "🔴"}


def settings() -> Settings:
    try:
        return Settings.load(CONFIG)
    except FileNotFoundError:
        return Settings()


def sidebar() -> tuple[bool, str]:
    """Global controls shown on every page. Returns (demo, period)."""
    with st.sidebar:
        st.toggle("Demo data (offline)", key="demo", value=os.getenv("STOCK_DEMO") == "1",
                  help="Synthetic prices, useful when Yahoo Finance is unreachable.")
        st.selectbox("Price history", ["6mo", "1y", "2y", "5y"], index=1, key="period")
        if st.button("🔄 Refresh data", width="stretch"):
            st.cache_data.clear()
            st.rerun()
        llm = llm_status()
        st.caption(f"AI model: {'🟢 ' + llm if llm else '⚪ not connected'}")
    return st.session_state["demo"], st.session_state["period"]


@st.cache_data(ttl=60, show_spinner=False)
def llm_status() -> str:
    c = LLMClient()
    return c.model if c.available() else ""


@st.cache_data(ttl=900, show_spinner="Fetching prices and scoring your watchlist...")
def analyze_all(watchlist: dict[str, list[str]], period: str, demo: bool, max_bias: float):
    s = Settings(watchlist=watchlist, period=period, max_bias_pct=max_bias, news=False, llm=False, workers=6)
    return run(s, list(MARKETS), demo=demo)


@st.cache_data(ttl=900, show_spinner=False)
def load_stock(symbol: str, period: str, demo: bool):
    return get_provider(demo=demo, period=period).fetch(symbol)


@st.cache_data(ttl=900, show_spinner=False)
def analyze_one(symbol: str, period: str, demo: bool, max_bias: float) -> Analysis | None:
    d = load_stock(symbol, period, demo)
    if d is None:
        return None
    try:
        return analyze(d, max_bias)
    except ValueError:
        return None


@st.cache_data(ttl=1800, show_spinner=False)
def news_for(symbol: str, name: str, market: str, demo: bool, short_name: str = "") -> list[dict]:
    if demo:
        return []
    return fetch_news(get_provider(), symbol, name, MARKETS[market].news_locale, 6, aliases=(short_name,))


@st.cache_data(ttl=3600, show_spinner="Asking the AI model...")
def ai_view(a: Analysis, news: tuple[str, ...]) -> str:
    a = replace(a, news=[{"title": t} for t in news])
    return LLMClient().summarize(a) or "The model did not return an answer."


def open_stock(symbol: str):
    st.session_state["symbol"] = symbol
    st.switch_page("ui/stock.py")


def alerts(r: Analysis, max_bias: float) -> list[str]:
    out = []
    if "crossover" in r.macd_state:
        out.append(f"MACD {r.macd_state.lower()}")
    for text in r.signals + r.risks:
        if "cross (" in text:
            out.append(text.split(" (")[0])
    if r.rsi > 70:
        out.append(f"Overbought (RSI {r.rsi:.0f})")
    elif r.rsi < 30:
        out.append(f"Oversold (RSI {r.rsi:.0f})")
    if r.bias_ma5_pct > max_bias:
        out.append(f"Extended {r.bias_ma5_pct:+.1f}% vs MA5")
    if r.volume_ratio and r.volume_ratio > 1.8:
        out.append(f"Heavy volume {r.volume_ratio:.1f}x")
    return out


def results_table(results: list[Analysis]) -> list[dict]:
    return [{
        "Symbol": r.symbol,
        "Name": r.name,
        "Close": r.close,
        "Day %": r.change_pct,
        "1M %": r.change_1m_pct,
        "Score": r.score,
        "Rating": f"{RATING_ICON.get(r.rating, '')} {r.rating}",
        "RSI": r.rsi,
        "Checklist": f"{sum(ok for _, ok in r.checklist)}/{len(r.checklist)}",
        "Trend": r.trend.split(" (")[0],
    } for r in results]


TABLE_CONFIG = {
    "Score": st.column_config.ProgressColumn("Score", min_value=0, max_value=100, format="%d"),
    "Close": st.column_config.NumberColumn(format="%.2f"),
    "Day %": st.column_config.NumberColumn(format="%+.2f%%"),
    "1M %": st.column_config.NumberColumn(format="%+.2f%%"),
    "RSI": st.column_config.NumberColumn(format="%.0f"),
}
