"""Live web app: FastAPI backend + the same dashboard UI, with live prices and news.

    python -m stock_analyzer.server                  # http://localhost:8000
    python -m stock_analyzer.server --demo           # offline synthetic data
    ADMIN_TOKEN=secret python -m stock_analyzer.server --host 0.0.0.0

Prices come from Yahoo Finance via yfinance and may be delayed (typically up to
15 minutes, depending on the exchange). Everything is cached briefly so the app
stays fast and polite to the data source.
"""
from __future__ import annotations

import argparse
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import yaml

from .analysis import analyze, index_snapshot
from .data import StockData, get_provider
from .markets import _SUFFIX_MARKET, MARKETS, detect_market
from .news import fetch_news, google_news
from .site import _num, compact_series
from .universe import MARKET_NEWS_QUERIES, NAMES, SECTORS, UNIVERSE

log = logging.getLogger(__name__)
WEB_DIR = Path(__file__).parent / "web"

QUOTE_TTL = 90        # seconds: daily bars incl. today's live bar
STOCK_TTL = 300       # full stock fetch incl. fundamentals
INTRADAY_TTL = 60
NEWS_TTL = 180


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class TTLCache:
    """Tiny thread-safe cache with per-key locks (no duplicate fetches under load)."""

    def __init__(self):
        self._data: dict[str, tuple[float, Any]] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()

    def peek(self, key: str, ttl: float):
        hit = self._data.get(key)
        return hit[1] if hit and time.time() - hit[0] < ttl else None

    def put(self, key: str, value: Any) -> None:
        self._data[key] = (time.time(), value)

    def get(self, key: str, ttl: float, fn: Callable[[], Any]):
        hit = self.peek(key, ttl)
        if hit is not None:
            return hit
        with self._guard:
            lock = self._locks.setdefault(key, threading.Lock())
        with lock:
            hit = self.peek(key, ttl)
            if hit is not None:
                return hit
            value = fn()
            self.put(key, value)
            return value


class LiveService:
    def __init__(self, demo: bool = False, config: str | Path = "config.yaml"):
        self.demo = demo
        self.provider = get_provider(demo=demo, period="1y")
        self.config = Path(config)
        self.cache = TTLCache()
        self.names: dict[str, str] = dict(NAMES)
        self._cfg_lock = threading.Lock()
        self.max_bias = 5.0

    # ---- watchlist (config.yaml) -----------------------------------------------------
    def _raw_config(self) -> dict:
        if not self.config.exists():
            return {}
        return yaml.safe_load(self.config.read_text()) or {}

    def watchlist(self) -> dict[str, list[str]]:
        raw = self._raw_config().get("watchlist") or {}
        self.max_bias = float((self._raw_config().get("options") or {}).get("max_bias_pct", 5.0))
        return {code: [str(s).upper() for s in (raw.get(code) or [])] for code in MARKETS}

    def watch_symbols(self) -> set[str]:
        return {s for syms in self.watchlist().values() for s in syms}

    def set_watched(self, symbol: str, watched: bool) -> dict[str, list[str]]:
        symbol = symbol.strip().upper()
        with self._cfg_lock:
            raw = self._raw_config()
            wl = {code: [str(s).upper() for s in ((raw.get("watchlist") or {}).get(code) or [])] for code in MARKETS}
            code = detect_market(symbol)
            if watched and symbol not in wl[code]:
                wl[code].append(symbol)
            if not watched:
                wl[code] = [s for s in wl[code] if s != symbol]
            raw["watchlist"] = wl
            self.config.write_text(yaml.safe_dump(raw, sort_keys=False, allow_unicode=True))
        self.cache.put("snapshot", None)
        return wl

    # ---- prices ------------------------------------------------------------------------
    def histories(self, symbols: list[str]) -> dict:
        """Daily history per symbol; missing ones are fetched together in one batch."""
        out, missing = {}, []
        for s in symbols:
            hit = self.cache.peek(f"h:{s}", QUOTE_TTL)
            (out.__setitem__(s, hit) if hit is not None else missing.append(s))
        if missing:
            fetched = self.provider.history_many(missing)
            for s in missing:
                df = fetched.get(s)
                self.cache.put(f"h:{s}", df if df is not None else False)
                out[s] = df if df is not None else False
        return {s: df for s, df in out.items() if df is not False and df is not None}

    def _row(self, symbol: str, hist, watched: set[str]) -> dict | None:
        try:
            a = analyze(StockData(symbol, hist, self.names.get(symbol, symbol)), self.max_bias)
        except Exception as e:
            log.debug("analysis failed for %s: %s", symbol, e)
            return None
        d = a.to_dict()
        d["spark"] = [_num(v, 4) for v in hist["Close"].tail(60)]
        d["sector"] = SECTORS.get(symbol, "")
        d["watched"] = symbol in watched
        d.pop("news", None)
        return d

    def indices(self, code: str) -> list[dict]:
        bench = MARKETS[code].benchmarks
        hist = self.histories(list(bench))
        return [index_snapshot(StockData(s, hist[s]), label) for s, label in bench.items() if s in hist]

    def market(self, code: str) -> dict:
        watched = self.watch_symbols()
        symbols = list(dict.fromkeys([s for s, _, _ in UNIVERSE.get(code, [])] + self.watchlist().get(code, [])))
        hist = self.histories(symbols)
        rows = [r for r in (self._row(s, hist[s], watched) for s in symbols if s in hist) if r]
        rows.sort(key=lambda r: r["score"], reverse=True)
        missing = [s for s in symbols if s not in hist]
        return {"code": code, "name": MARKETS[code].name, "updated": _now(), "indices": self.indices(code),
                "stocks": rows, "unavailable": missing,
                "sectors": sorted({r["sector"] for r in rows if r["sector"]})}

    def snapshot(self) -> dict:
        """Watchlist view in the same shape as the static site's data/latest.json."""
        def build():
            wl, watched = self.watchlist(), self.watch_symbols()
            markets, errors = {}, []
            for code in MARKETS:
                syms = wl.get(code, [])
                hist = self.histories(syms)
                rows = []
                for s in syms:
                    r = self._row(s, hist[s], watched) if s in hist else None
                    (rows.append(r) if r else errors.append(f"{s}: no data returned"))
                rows.sort(key=lambda r: r["score"], reverse=True)
                markets[code] = {"name": MARKETS[code].name, "updated": _now(), "indices": self.indices(code),
                                 "overview": "", "results": rows}
            return {"generated": _now(), "date": _now()[:10], "demo": self.demo, "errors": errors,
                    "repo": os.getenv("GITHUB_REPOSITORY", ""), "markets": markets, "live": True}
        return self.cache.get("snapshot", QUOTE_TTL, build)

    def stock(self, symbol: str) -> dict | None:
        symbol = symbol.upper()
        d = self.cache.get(f"s:{symbol}", STOCK_TTL, lambda: self.provider.fetch(symbol) or False)
        if not d:
            return None
        live = self.histories([symbol]).get(symbol)
        hist = live if live is not None and len(live) >= len(d.history) - 5 else d.history
        if d.name and d.name != symbol and not d.name.endswith("(demo)"):
            self.names[symbol] = d.name
        try:
            a = analyze(StockData(symbol, hist, self.names.get(symbol, d.name), d.info), self.max_bias)
        except ValueError:
            return None
        out = a.to_dict()
        out.update(sector=SECTORS.get(symbol, d.info.get("sector", "")), watched=symbol in self.watch_symbols(),
                   spark=[_num(v, 4) for v in hist["Close"].tail(60)], updated=_now())
        out["news"] = self.stock_news(symbol, out["name"], d.info.get("shortName", ""))
        return {"analysis": out, "series": compact_series(hist), "market_name": MARKETS[out["market"]].name}

    def intraday(self, symbol: str) -> dict:
        def build():
            df = self.provider.intraday(symbol.upper())
            if df is None or df.empty:
                return {"symbol": symbol, "bars": []}
            bars = [{"time": int(ts.timestamp()), "open": _num(r.Open), "high": _num(r.High),
                     "low": _num(r.Low), "close": _num(r.Close), "volume": _num(r.Volume, 0)}
                    for ts, r in df.iterrows()]
            return {"symbol": symbol, "bars": [b for b in bars if b["close"] is not None]}
        return self.cache.get(f"i:{symbol.upper()}", INTRADAY_TTL, build)

    # ---- news ----------------------------------------------------------------------------
    def stock_news(self, symbol: str, name: str, short: str = "") -> list[dict]:
        code = detect_market(symbol)
        def build():
            items = [{**n, "symbol": symbol, "market": code}
                     for n in fetch_news(self.provider, symbol, name, MARKETS[code].news_locale, 8, aliases=(short,))]
            return sorted(items, key=lambda n: n.get("published") or "", reverse=True)
        return self.cache.get(f"n:{symbol}", NEWS_TTL, build)

    def news(self, market: str | None = None, scope: str = "market") -> dict:
        def build():
            codes = [market] if market in MARKETS else list(MARKETS)
            items: list[dict] = []
            if scope == "watchlist":
                wl = self.watchlist()
                syms = [s for c in codes for s in wl.get(c, [])]
                with ThreadPoolExecutor(max_workers=6) as ex:
                    for batch in ex.map(lambda s: self.stock_news(s, self.names.get(s, s))[:4], syms):
                        items.extend(batch)
            else:
                for c in codes:
                    if self.demo:
                        for s, _, _ in UNIVERSE[c][:6]:
                            items.extend({**n, "symbol": s, "market": c} for n in self.provider.news(s, 2))
                    else:
                        items.extend({**n, "market": c, "symbol": ""} for n in
                                     google_news(MARKET_NEWS_QUERIES[c], MARKETS[c].news_locale, 20, when="1d"))
            seen, out = set(), []
            for n in sorted(items, key=lambda n: n.get("published") or "", reverse=True):
                key = n["title"].lower()[:90]
                if key not in seen:
                    seen.add(key)
                    out.append(n)
            return {"updated": _now(), "items": out[:80]}
        return self.cache.get(f"news:{market}:{scope}", NEWS_TTL, build)

    def search(self, q: str) -> list[dict]:
        q = q.strip()
        if len(q) < 2:
            return []
        ql = q.lower()
        local = [{"symbol": s, "name": n, "exchange": MARKETS[detect_market(s)].name, "type": "EQUITY"}
                 for s, n in NAMES.items() if ql in s.lower() or ql in n.lower()]
        remote = self.cache.get(f"q:{ql}", 3600, lambda: self.provider.search(q, 10))
        seen, out = set(), []
        for r in local + remote:
            sym = r["symbol"].upper()
            supported = "." not in sym or any(sym.endswith(suf) for suf in _SUFFIX_MARKET)
            if supported and r["symbol"] not in seen:
                seen.add(r["symbol"])
                out.append({**r, "market": detect_market(r["symbol"])})
        return out[:15]


def create_app(demo: bool = False, config: str | Path = "config.yaml"):
    from fastapi import Depends, FastAPI, Header, HTTPException
    from fastapi.middleware.gzip import GZipMiddleware
    from fastapi.staticfiles import StaticFiles

    svc = LiveService(demo=demo, config=config)
    token = os.getenv("ADMIN_TOKEN", "")
    app = FastAPI(title="Global Stock Analyzer", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    app.state.service = svc

    def require_admin(x_admin_token: str = Header(default="")):
        if token and x_admin_token != token:
            raise HTTPException(401, "Admin token required to change the watchlist")

    def known_market(code: str) -> str:
        if code not in MARKETS:
            raise HTTPException(404, f"Unknown market '{code}'")
        return code

    @app.get("/api/meta")
    def meta():
        return {"live": True, "demo": demo, "auth": bool(token), "now": _now(),
                "markets": {c: {"name": m.name, "currency": m.currency, "timezone": m.timezone,
                                "count": len(UNIVERSE.get(c, []))} for c, m in MARKETS.items()}}

    @app.get("/api/snapshot")
    def snapshot():
        return svc.snapshot()

    @app.get("/api/markets/{code}")
    def market(code: str):
        return svc.cache.get(f"m:{known_market(code)}", QUOTE_TTL, lambda: svc.market(code))

    @app.get("/api/stocks/{symbol}")
    def stock(symbol: str):
        data = svc.stock(symbol)
        if data is None:
            raise HTTPException(404, f"No data for {symbol}")
        return data

    @app.get("/api/stocks/{symbol}/intraday")
    def intraday(symbol: str):
        return svc.intraday(symbol)

    @app.get("/api/news")
    def news(market: str = "", scope: str = "market"):
        return svc.news(market or None, "watchlist" if scope == "watchlist" else "market")

    @app.get("/api/search")
    def search(q: str = ""):
        return {"results": svc.search(q)}

    @app.get("/api/watchlist")
    def get_watchlist():
        return svc.watchlist()

    @app.put("/api/watchlist/{symbol}", dependencies=[Depends(require_admin)])
    def watch(symbol: str):
        if not svc.histories([symbol.upper()]) and not svc.provider.fetch(symbol.upper()):
            raise HTTPException(404, f"No price data found for {symbol}")
        svc.cache.put(f"m:{detect_market(symbol)}", None)
        return svc.set_watched(symbol, True)

    @app.delete("/api/watchlist/{symbol}", dependencies=[Depends(require_admin)])
    def unwatch(symbol: str):
        svc.cache.put(f"m:{detect_market(symbol)}", None)
        return svc.set_watched(symbol, False)

    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
    return app


def main(argv: list[str] | None = None) -> None:
    import uvicorn

    p = argparse.ArgumentParser(description="Run the live stock analysis web app")
    p.add_argument("--host", default=os.getenv("HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.getenv("PORT", "8000")))
    p.add_argument("--demo", action="store_true", default=os.getenv("STOCK_DEMO") == "1")
    p.add_argument("-c", "--config", default="config.yaml")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    for noisy in ("yfinance", "peewee"):
        logging.getLogger(noisy).setLevel(logging.CRITICAL)
    print(f"Live app: http://{'localhost' if args.host in ('127.0.0.1', '0.0.0.0') else args.host}:{args.port}"
          + ("  (demo data)" if args.demo else ""))
    uvicorn.run(create_app(demo=args.demo, config=args.config), host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
