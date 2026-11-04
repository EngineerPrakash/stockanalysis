"""Build / update the static web dashboard (for GitHub Pages or any static host).

Layout of the generated site directory:

    index.html, app.js, style.css      copied from stock_analyzer/web/
    data/latest.json                   newest snapshot of every market
    data/series/<SYMBOL>.json          chart data (OHLC + indicators) per stock
    data/history/index.json            list of dates with a snapshot
    data/history/<YYYY-MM-DD>.json     snapshot for that day
    data/scores.json                   score + close per stock per day

Runs for different markets (e.g. the India run in the morning and the US run at night)
are merged, so each file always holds the most recent data for every market.
"""
from __future__ import annotations

import json
import math
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from .indicators import add_all

WEB_DIR = Path(__file__).parent / "web"
HISTORY_BARS = 260
SCORE_DAYS = 365


def _num(x, nd: int = 4):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(x) or math.isinf(x):
        return None
    return round(x, nd)


def safe_name(symbol: str) -> str:
    return "".join(c if c.isalnum() or c in ".-" else "_" for c in symbol)


def compact_series(history: pd.DataFrame, bars: int = HISTORY_BARS) -> dict:
    df = add_all(history).tail(bars)
    out = {"t": [d.strftime("%Y-%m-%d") for d in df.index]}
    cols = {"o": "Open", "h": "High", "l": "Low", "c": "Close", "v": "Volume", "ma20": "MA20",
            "ma50": "MA50", "ma200": "MA200", "rsi": "RSI14", "macd": "MACD_HIST"}
    for key, col in cols.items():
        if col in df:
            nd = 0 if key == "v" else 4
            out[key] = [_num(v, nd) for v in df[col]]
    return out


def _load(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":"), default=str), encoding="utf-8")


def _market_payload(m: dict, now: str) -> dict:
    series = m.get("series") or {}
    results = []
    for r in m["results"]:
        d = r.to_dict()
        hist = series.get(r.symbol)
        if hist is not None:
            d["spark"] = [_num(v, 4) for v in hist["Close"].tail(60)]
        results.append(d)
    return {
        "name": m["name"],
        "updated": now,
        "indices": m["indices"],
        "overview": m.get("overview", ""),
        "results": results,
    }


def update_site(site_dir: str | Path, markets: list[dict], errors: list[str],
                date: str | None = None, demo: bool = False) -> Path:
    site = Path(site_dir)
    site.mkdir(parents=True, exist_ok=True)
    for f in WEB_DIR.iterdir():
        if f.is_file():
            shutil.copy2(f, site / f.name)
    (site / ".nojekyll").touch()

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    date = date or now[:10]
    data = site / "data"

    # latest.json and today's history snapshot, merged per market
    latest = _load(data / "latest.json", {"markets": {}})
    day = _load(data / "history" / f"{date}.json", {"date": date, "markets": {}})
    for m in markets:
        payload = _market_payload(m, now)
        latest["markets"][m["code"]] = payload
        day["markets"][m["code"]] = payload
        for sym, hist in (m.get("series") or {}).items():
            _dump(data / "series" / f"{safe_name(sym)}.json", compact_series(hist))
    latest.update(generated=now, date=date, demo=demo, errors=errors,
                  repo=os.getenv("GITHUB_REPOSITORY", ""))
    day.update(generated=now, errors=errors)
    _dump(data / "latest.json", latest)
    _dump(data / "history" / f"{date}.json", day)

    dates = set(_load(data / "history" / "index.json", []))
    dates.add(date)
    _dump(data / "history" / "index.json", sorted(dates, reverse=True))

    # score history: {symbol: [[date, score, close], ...]}
    scores = _load(data / "scores.json", {})
    for m in markets:
        for r in m["results"]:
            rows = [row for row in scores.get(r.symbol, []) if row[0] != date]
            rows.append([date, r.score, r.close])
            scores[r.symbol] = sorted(rows)[-SCORE_DAYS:]
    _dump(data / "scores.json", scores)
    return site
