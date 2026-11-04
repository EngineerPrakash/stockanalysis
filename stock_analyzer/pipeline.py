"""Orchestrates fetch -> analyze -> (news, LLM) -> report for all markets."""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from .analysis import Analysis, analyze, index_snapshot
from .data import get_provider
from .llm import LLMClient
from .markets import MARKETS, detect_market
from .news import fetch_news

log = logging.getLogger(__name__)


@dataclass
class Settings:
    watchlist: dict[str, list[str]] = field(default_factory=dict)
    period: str = "1y"
    max_bias_pct: float = 5.0
    news: bool = True
    news_per_stock: int = 3
    llm: bool = False
    workers: int = 4

    @classmethod
    def load(cls, path: str | Path) -> "Settings":
        raw = yaml.safe_load(Path(path).read_text()) or {}
        wl = {k.lower(): [str(s).strip() for s in (v or [])] for k, v in (raw.get("watchlist") or {}).items()}
        unknown = set(wl) - set(MARKETS)
        if unknown:
            raise ValueError(f"Unknown market(s) in watchlist: {sorted(unknown)}. Use {sorted(MARKETS)}")
        opts = raw.get("options") or {}
        return cls(watchlist=wl, **{k: v for k, v in opts.items() if k in cls.__dataclass_fields__})


def group_symbols(symbols: list[str]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for s in symbols:
        out.setdefault(detect_market(s), []).append(s.upper())
    return out


def run(settings: Settings, markets: list[str] | None = None, demo: bool = False):
    provider = get_provider(demo=demo, period=settings.period)
    llm = None
    if settings.llm and not demo:
        llm = LLMClient()
        if not llm.available():
            log.warning("LLM enabled but %s is not reachable; continuing without AI commentary", llm.base_url)
            llm = None

    selected = [m for m in (markets or list(MARKETS)) if m in MARKETS]
    out, errors = [], []

    for code in selected:
        market = MARKETS[code]
        symbols = settings.watchlist.get(code, [])
        log.info("== %s: %d stocks ==", market.name, len(symbols))

        indices = []
        for sym, label in market.benchmarks.items():
            d = provider.fetch(sym)
            if d is not None and len(d.history) > 1:
                indices.append(index_snapshot(d, label))

        def work(sym: str) -> Analysis | str:
            d = provider.fetch(sym)
            if d is None:
                return f"{sym}: no data returned"
            try:
                a = analyze(d, settings.max_bias_pct)
            except Exception as e:
                return f"{sym}: analysis failed ({e})"
            if settings.news and not demo:
                a.news = fetch_news(provider, sym, d.name, market.news_locale, settings.news_per_stock)
            if llm:
                a.ai_summary = llm.summarize(a)
            return a

        with ThreadPoolExecutor(max_workers=max(1, settings.workers)) as ex:
            results = []
            for res in ex.map(work, symbols):
                (results if isinstance(res, Analysis) else errors).append(res)
        results.sort(key=lambda r: r.score, reverse=True)

        overview = llm.market_overview(market.name, indices, results) if (llm and results) else ""
        out.append({"code": code, "name": market.name, "indices": indices,
                    "results": results, "overview": overview})
    return out, errors
