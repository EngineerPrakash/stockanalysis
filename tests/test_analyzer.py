import numpy as np
import pandas as pd
import pytest

from stock_analyzer.__main__ import main
from stock_analyzer.analysis import analyze, rating_for
from stock_analyzer.data import DemoProvider, StockData
from stock_analyzer.indicators import rsi
from stock_analyzer.markets import currency_for, detect_market
from stock_analyzer.pipeline import Settings, group_symbols, run
from stock_analyzer.report import render_markdown


@pytest.mark.parametrize("sym,market", [
    ("RELIANCE.NS", "india"), ("500325.BO", "india"), ("AAPL", "us"),
    ("600519.SS", "china"), ("0700.HK", "china"), ("SAP.DE", "europe"), ("SHEL.L", "europe"),
])
def test_detect_market(sym, market):
    assert detect_market(sym) == market


def test_currency():
    assert currency_for("TCS.NS") == "INR"
    assert currency_for("0700.HK") == "HKD"
    assert currency_for("MC.PA") == "EUR"


def _series(prices):
    idx = pd.bdate_range("2025-01-01", periods=len(prices))
    p = np.asarray(prices, dtype=float)
    return pd.DataFrame({"Open": p, "High": p * 1.01, "Low": p * 0.99, "Close": p, "Volume": 1e6}, index=idx)


def test_rsi_extremes():
    assert rsi(pd.Series(np.arange(1, 60, dtype=float))).iloc[-1] > 95
    assert rsi(pd.Series(np.arange(60, 1, -1, dtype=float))).iloc[-1] < 5


def test_uptrend_scores_higher_than_downtrend():
    up = analyze(StockData("UP", _series(np.linspace(100, 150, 250) + np.sin(np.arange(250)))))
    down = analyze(StockData("DN", _series(np.linspace(150, 100, 250) + np.sin(np.arange(250)))))
    assert up.score > down.score
    assert up.trend.startswith("Bullish") and down.trend.startswith("Bearish")
    assert up.stop_loss < up.entry < up.target


def test_extended_price_flagged():
    p = np.r_[np.full(240, 100.0), np.linspace(100, 140, 6)]
    a = analyze(StockData("HOT", _series(p)))
    assert any("avoid chasing" in x for x in a.risks)


def test_rating_bounds():
    assert rating_for(90) == "Strong Buy" and rating_for(10) == "Sell"


def test_short_history_rejected():
    with pytest.raises(ValueError):
        analyze(StockData("X", _series(np.arange(10) + 1.0)))


def test_demo_pipeline_end_to_end(tmp_path):
    s = Settings(watchlist=group_symbols(["AAPL", "TCS.NS", "0700.HK", "SAP.DE"]), news=False)
    results, errors = run(s, demo=True)
    assert not errors
    assert {m["code"] for m in results} == {"india", "us", "china", "europe"}
    md = render_markdown(results, errors, "2026-01-01")
    for sym in ("AAPL", "TCS.NS", "0700.HK", "SAP.DE"):
        assert sym in md


def test_cli_demo_writes_reports(tmp_path):
    assert main(["--demo", "-s", "AAPL", "INFY.NS", "-o", str(tmp_path)]) == 0
    assert len(list(tmp_path.glob("report_*.md"))) == 1
    assert len(list(tmp_path.glob("report_*.html"))) == 1


def test_demo_is_deterministic():
    a = DemoProvider().fetch("AAPL").history["Close"].iloc[-1]
    b = DemoProvider().fetch("AAPL").history["Close"].iloc[-1]
    assert a == b


# --- News relevance (headlines taken from a real run) ---------------------------
from stock_analyzer.news import clean_name, fetch_news, is_relevant, keywords  # noqa: E402


@pytest.mark.parametrize("raw,clean", [
    ("Kweichow Moutai Co., Ltd.", "Kweichow Moutai"),
    ("SAP SE                        I", "SAP"),
    ("Shell plc", "Shell"),
    ("Apple Inc.", "Apple"),
    ("Tencent Holdings Limited", "Tencent"),
])
def test_clean_name(raw, clean):
    assert clean_name(raw) == clean


@pytest.mark.parametrize("symbol,name,alias,title,expected", [
    ("NESN.SW", "Nestlé S.A.", "NESTLE N", "How a failed Whole Foods deal built Little Spoon: Founder and CEO", False),
    ("NESN.SW", "Nestlé S.A.", "NESTLE N", "Nestle cuts sales outlook as coffee prices bite", True),
    ("AMZN", "Amazon.com, Inc.", "Amazon.com, Inc.", "Could Buying This 1 Cryptocurrency Make You Rich?", False),
    ("AMZN", "Amazon.com, Inc.", "Amazon.com, Inc.", "Texas Goes Blue: What It Means For Stocks Like MSFT, AMZN, GOOGL", True),
    ("INFY.NS", "Infosys Limited", "INFOSYS LIMITED", "Why Infosys Can Shrug Off the US Green-Card Suspension", True),
    ("INFY.NS", "Infosys Limited", "INFOSYS LIMITED", "Mastercard scales in India", False),
    ("600519.SS", "Kweichow Moutai Co., Ltd.", "KWEICHOW MOUTAI", "China's Top Liquor Brand Reports First Sales Drop", False),
    ("600519.SS", "Kweichow Moutai Co., Ltd.", "KWEICHOW MOUTAI", "Moutai sales fall for the first time in two decades", True),
    ("300750.SZ", "Contemporary Amperex Technology Co., Limited", "CATL", "CATL profit jumps on energy storage demand", True),
    ("MC.PA", "LVMH Moët Hennessy - Louis Vuitton, Société Européenne", "LVMH", "Ferrari Earnings Beat Can Help End Supercar Stock's Skid", False),
])
def test_headline_relevance(symbol, name, alias, title, expected):
    assert is_relevant(title, keywords(symbol, name, (alias,))) is expected


def test_fetch_news_filters_and_falls_back(monkeypatch):
    class P:
        def news(self, symbol, limit):
            return [{"title": "Rho Nutrition explores sale", "link": "", "source": "Reuters"},
                    {"title": "Nestle shares rise", "link": "", "source": "Reuters"}]
    import stock_analyzer.news as news_mod
    monkeypatch.setattr(news_mod, "google_news", lambda q, loc, n: [
        {"title": "Nestle names new CEO", "link": "", "source": "FT"},
        {"title": "Unrelated market wrap", "link": "", "source": "FT"}])
    out = fetch_news(P(), "NESN.SW", "Nestlé S.A.", "", 5, aliases=("NESTLE N",))
    assert [n["title"] for n in out] == ["Nestle shares rise", "Nestle names new CEO"]


# --- Static web dashboard ------------------------------------------------------------
import json  # noqa: E402

from stock_analyzer.site import update_site  # noqa: E402


def test_site_build_merges_markets_and_days(tmp_path):
    s = Settings(watchlist=group_symbols(["AAPL", "TCS.NS"]), news=False, keep_series=True)
    india, _ = run(s, ["india"], demo=True)
    us, _ = run(s, ["us"], demo=True)
    update_site(tmp_path, india, [], date="2026-01-01", demo=True)
    update_site(tmp_path, us, [], date="2026-01-01", demo=True)
    update_site(tmp_path, us, [], date="2026-01-02", demo=True)

    for f in ("index.html", "app.js", "style.css", "lightweight-charts.js", ".nojekyll"):
        assert (tmp_path / f).exists()
    latest = json.loads((tmp_path / "data/latest.json").read_text())
    assert set(latest["markets"]) == {"india", "us"}  # second run did not wipe India
    day1 = json.loads((tmp_path / "data/history/2026-01-01.json").read_text())
    assert set(day1["markets"]) == {"india", "us"}
    assert json.loads((tmp_path / "data/history/index.json").read_text()) == ["2026-01-02", "2026-01-01"]
    scores = json.loads((tmp_path / "data/scores.json").read_text())
    assert [row[0] for row in scores["AAPL"]] == ["2026-01-01", "2026-01-02"]
    assert len(scores["TCS.NS"]) == 1
    series = json.loads((tmp_path / "data/series/AAPL.json").read_text())
    assert len(series["t"]) == len(series["c"]) == 260
    assert all(v is None or 0 <= v <= 100 for v in series["rsi"])
