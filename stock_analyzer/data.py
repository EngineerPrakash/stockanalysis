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
            published = c.get("pubDate") or c.get("displayTime") or ""
            if not published and c.get("providerPublishTime"):
                published = pd.Timestamp(c["providerPublishTime"], unit="s", tz="UTC").isoformat()
            if title:
                out.append({"title": title, "link": link or "", "source": source, "published": published})
        return out

    def history_many(self, symbols: list[str], period: str | None = None) -> dict[str, pd.DataFrame]:
        """Daily OHLCV for many tickers in one request (the last bar is today's live bar)."""
        if not symbols:
            return {}
        try:
            raw = self.yf.download(symbols, period=period or self.period, group_by="ticker",
                                   auto_adjust=True, threads=True, progress=False)
        except Exception as e:
            log.error("Batch download failed: %s", e)
            return {}
        out: dict[str, pd.DataFrame] = {}
        for sym in symbols:
            try:
                if isinstance(raw.columns, pd.MultiIndex):
                    if sym not in raw.columns.get_level_values(0):
                        continue
                    df = raw[sym].copy()
                else:
                    df = raw.copy()
                df = _clean(df)
                if len(df) > 1:
                    out[sym] = df
            except Exception as e:
                log.debug("batch parse failed for %s: %s", sym, e)
        return out

    def intraday(self, symbol: str) -> pd.DataFrame:
        """5-minute bars for the latest session (UTC index)."""
        try:
            t = self.yf.Ticker(symbol)
            df = t.history(period="5d", interval="5m", auto_adjust=True)
        except Exception as e:
            log.debug("intraday failed for %s: %s", symbol, e)
            return pd.DataFrame()
        if df is None or df.empty:
            return pd.DataFrame()
        local_day = df.index[-1].date()
        df = df[[d.date() == local_day for d in df.index]]
        df = df[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
        df.index = df.index.tz_convert("UTC")
        return df

    def search(self, query: str, limit: int = 10) -> list[dict]:
        try:
            quotes = self.yf.Search(query, max_results=limit, news_count=0).quotes or []
        except Exception as e:
            log.debug("search failed for %s: %s", query, e)
            return []
        out = []
        for q in quotes:
            if q.get("quoteType") not in ("EQUITY", "ETF") or not q.get("symbol"):
                continue
            out.append({"symbol": q["symbol"], "name": q.get("longname") or q.get("shortname") or q["symbol"],
                        "exchange": q.get("exchDisp") or q.get("exchange") or "", "type": q.get("quoteType")})
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
        rng = np.random.default_rng(int(hashlib.md5(("n" + symbol).encode()).hexdigest()[:8], 16))
        now = pd.Timestamp.now(tz="UTC")
        topics = ["shares rise after analyst upgrade", "reports quarterly results", "announces new partnership",
                  "faces pressure as sector cools", "hits 52-week high", "sees heavy options activity"]
        return [{"title": f"{symbol.split('.')[0]} {topics[int(rng.integers(len(topics)))]} (demo)",
                 "link": "https://example.com/", "source": "Demo Wire",
                 "published": (now - pd.Timedelta(minutes=int(rng.integers(5, 600)))).isoformat()}
                for _ in range(limit)]

    def history_many(self, symbols: list[str], period: str | None = None) -> dict[str, pd.DataFrame]:
        return {s: self.fetch(s).history for s in symbols}

    def intraday(self, symbol: str) -> pd.DataFrame:
        base = float(self.fetch(symbol).history["Close"].iloc[-1])
        rng = np.random.default_rng(int(hashlib.md5(("i" + symbol).encode()).hexdigest()[:8], 16))
        n = 78
        close = base * np.exp(np.cumsum(rng.normal(0, 0.0015, n)))
        close *= base / close[-1]
        open_ = np.r_[close[0], close[:-1]]
        idx = pd.date_range(end=pd.Timestamp.now(tz="UTC").floor("5min"), periods=n, freq="5min")
        return pd.DataFrame({"Open": open_, "High": np.maximum(open_, close) * 1.0006,
                             "Low": np.minimum(open_, close) * 0.9994, "Close": close,
                             "Volume": rng.lognormal(10, 0.5, n).astype(int)}, index=idx)

    def search(self, query: str, limit: int = 10) -> list[dict]:
        from .universe import NAMES

        q = query.lower()
        hits = [{"symbol": s, "name": n, "exchange": "Demo", "type": "EQUITY"}
                for s, n in NAMES.items() if q in s.lower() or q in n.lower()]
        return hits[:limit]


def get_provider(demo: bool = False, period: str = "1y"):
    return DemoProvider() if demo else YahooProvider(period=period)
