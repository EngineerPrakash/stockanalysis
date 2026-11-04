"""Market definitions for India, US, China and Europe.

All tickers use Yahoo Finance symbol conventions, which the open-source
`yfinance` library understands:

    India   : RELIANCE.NS (NSE), 500325.BO (BSE)
    US      : AAPL, MSFT
    China   : 600519.SS (Shanghai), 000858.SZ (Shenzhen), 0700.HK (Hong Kong)
    Europe  : SAP.DE (Xetra), MC.PA (Paris), SHEL.L (London), ASML.AS (Amsterdam)
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Market:
    code: str
    name: str
    timezone: str
    currency: str
    benchmarks: dict[str, str] = field(default_factory=dict)  # symbol -> label
    news_locale: str = "hl=en-US&gl=US&ceid=US:en"


MARKETS: dict[str, Market] = {
    "india": Market(
        code="india",
        name="India",
        timezone="Asia/Kolkata",
        currency="INR",
        benchmarks={"^NSEI": "NIFTY 50", "^BSESN": "SENSEX", "^NSEBANK": "NIFTY Bank"},
        news_locale="hl=en-IN&gl=IN&ceid=IN:en",
    ),
    "us": Market(
        code="us",
        name="United States",
        timezone="America/New_York",
        currency="USD",
        benchmarks={"^GSPC": "S&P 500", "^IXIC": "NASDAQ Composite", "^DJI": "Dow Jones"},
    ),
    "china": Market(
        code="china",
        name="China / Hong Kong",
        timezone="Asia/Shanghai",
        currency="CNY",
        benchmarks={"000001.SS": "SSE Composite", "399001.SZ": "SZSE Component", "^HSI": "Hang Seng"},
        news_locale="hl=en-HK&gl=HK&ceid=HK:en",
    ),
    "europe": Market(
        code="europe",
        name="Europe",
        timezone="Europe/Berlin",
        currency="EUR",
        benchmarks={"^STOXX50E": "Euro Stoxx 50", "^GDAXI": "DAX", "^FTSE": "FTSE 100", "^FCHI": "CAC 40"},
        news_locale="hl=en-GB&gl=GB&ceid=GB:en",
    ),
}

# Suffix -> market, used to auto-detect where a ticker trades.
_SUFFIX_MARKET = {
    ".NS": "india", ".BO": "india",
    ".SS": "china", ".SZ": "china", ".HK": "china",
    ".DE": "europe", ".F": "europe", ".PA": "europe", ".L": "europe", ".AS": "europe",
    ".MI": "europe", ".MC": "europe", ".SW": "europe", ".BR": "europe", ".ST": "europe",
    ".CO": "europe", ".HE": "europe", ".OL": "europe", ".LS": "europe", ".VI": "europe",
    ".IR": "europe",
}

_SUFFIX_CURRENCY = {
    ".NS": "INR", ".BO": "INR", ".SS": "CNY", ".SZ": "CNY", ".HK": "HKD",
    ".L": "GBp", ".SW": "CHF", ".ST": "SEK", ".CO": "DKK", ".OL": "NOK",
}


def detect_market(symbol: str) -> str:
    s = symbol.upper()
    for suffix, market in _SUFFIX_MARKET.items():
        if s.endswith(suffix):
            return market
    return "us"


def currency_for(symbol: str) -> str:
    s = symbol.upper()
    for suffix, cur in _SUFFIX_CURRENCY.items():
        if s.endswith(suffix):
            return cur
    return MARKETS[detect_market(symbol)].currency
