"""Market data loading.

Primary source: yfinance (Apache-2.0) -> Yahoo Finance, covers all four markets.
Demo source   : deterministic synthetic OHLCV, for offline testing / CI.
"""
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)


@dataclass
class StockData:
    symbol: str
    history: pd.DataFrame  # columns: Open High Low Close Volume, DatetimeIndex
    name: str = ""
    info: dict = field(default_factory=dict)


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    keep = [c for c in ["Open", "High", "Low", "Close", "Volume"] if c in df.columns]
    df = df[keep].dropna(subset=["Close"])
    df.index = pd.to_datetime(df.index).tz_localize(None)
    return df


class YahooProvider:
    """Fetch history + basic fundamentals with yfinance."""

    def __init__(self, period: str = "1y"):
        import yfinance  # imported lazily so demo mode works without network

        self.yf = yfinance
        self.period = period

    def fetch(self, symbol: str) -> StockData | None:
        try:
            t = self.yf.Ticker(symbol)
            hist = _clean(t.history(period=self.period, auto_adjust=True))
            if hist.empty:
                log.warning("No price history for %s", symbol)
                return None
            info: dict = {}
            try:
                raw = t.get_info() or {}
                for k in ("shortName", "longName", "sector", "industry", "marketCap",
                          "trailingPE", "forwardPE", "priceToBook", "dividendYield",
                          "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "beta", "returnOnEquity",
                          "debtToEquity", "revenueGrowth", "earningsGrowth"):
                    if raw.get(k) is not None:
                        info[k] = raw[k]
            except Exception as e:  # fundamentals are optional
                log.debug("info failed for %s: %s", symbol, e)
            name = " ".join(str(info.get("longName") or info.get("shortName") or symbol).split())
            return StockData(symbol, hist, name, info)
        except Exception as e:
            log.error("Failed to fetch %s: %s", symbol, e)
            return None

    def news(self, symbol: str, limit: int = 5) -> list[dict]:
        try:
            items = self.yf.Ticker(symbol).news or []
        except Exception:
            return []
        out = []
        for it in items[:limit]:
            c = it.get("content", it)
            title = c.get("title")
            link = (c.get("canonicalUrl") or {}).get("url") if isinstance(c.get("canonicalUrl"), dict) else c.get("link")
            prov = c.get("provider")
            source = (prov.get("displayName") if isinstance(prov, dict) else None) or c.get("publisher") or "Yahoo Finance"
            if title:
                out.append({"title": title, "link": link or "", "source": source})
        return out


class DemoProvider:
    """Deterministic random-walk prices so the pipeline runs fully offline."""

    def __init__(self, days: int = 260):
        self.days = days

    def fetch(self, symbol: str) -> StockData:
        seed = int(hashlib.md5(symbol.encode()).hexdigest()[:8], 16)
        rng = np.random.default_rng(seed)
        drift = rng.uniform(-0.0008, 0.0015)
        vol = rng.uniform(0.010, 0.025)
        rets = rng.normal(drift, vol, self.days)
        start = rng.uniform(20, 3000)
        close = start * np.exp(np.cumsum(rets))
        high = close * (1 + np.abs(rng.normal(0, vol / 2, self.days)))
        low = close * (1 - np.abs(rng.normal(0, vol / 2, self.days)))
        open_ = np.r_[close[0], close[:-1]] * (1 + rng.normal(0, vol / 4, self.days))
        volume = rng.lognormal(14, 0.4, self.days).astype(int)
        idx = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=self.days)
        df = pd.DataFrame({"Open": open_, "High": np.maximum(high, np.maximum(open_, close)),
                           "Low": np.minimum(low, np.minimum(open_, close)),
                           "Close": close, "Volume": volume}, index=idx)
        return StockData(symbol, df, f"{symbol} (demo)", {"trailingPE": round(rng.uniform(8, 45), 1)})

    def news(self, symbol: str, limit: int = 5) -> list[dict]:
        return []


def get_provider(demo: bool = False, period: str = "1y"):
    return DemoProvider() if demo else YahooProvider(period=period)
