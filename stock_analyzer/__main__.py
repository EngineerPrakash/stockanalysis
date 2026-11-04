"""Command line entry point.

    python -m stock_analyzer                         # all markets from config.yaml
    python -m stock_analyzer --markets india us      # selected markets
    python -m stock_analyzer --stocks AAPL TCS.NS    # ad-hoc tickers
    python -m stock_analyzer --demo                  # offline synthetic data
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime

from .notify import send_all
from .pipeline import Settings, group_symbols, run
from .report import render_markdown, write_reports


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="stock_analyzer", description="Daily stock analysis: India, US, China, Europe")
    p.add_argument("-c", "--config", default="config.yaml")
    p.add_argument("-m", "--markets", nargs="+", choices=["india", "us", "china", "europe"])
    p.add_argument("-s", "--stocks", nargs="+", help="Analyze these tickers instead of the config watchlist")
    p.add_argument("-o", "--out", default="reports")
    p.add_argument("--demo", action="store_true", help="Use synthetic offline data")
    p.add_argument("--llm", action="store_true", help="Add commentary from an open-source LLM (Ollama etc.)")
    p.add_argument("--no-news", action="store_true")
    p.add_argument("--notify", action="store_true", help="Push report via configured channels")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    for noisy in ("yfinance", "urllib3", "peewee"):
        logging.getLogger(noisy).setLevel(logging.CRITICAL)

    try:
        settings = Settings.load(args.config)
    except FileNotFoundError:
        settings = Settings()
    if args.stocks:
        settings.watchlist = group_symbols(args.stocks)
    if args.llm:
        settings.llm = True
    if args.no_news:
        settings.news = False

    markets = args.markets or (list(settings.watchlist) if args.stocks else None)
    results, errors = run(settings, markets, demo=args.demo)

    date = datetime.now().strftime("%Y-%m-%d")
    text = render_markdown(results, errors, date)
    paths = write_reports(text, results, args.out, date)
    print(text)
    print(f"\nSaved: {', '.join(str(p) for p in paths.values())}", file=sys.stderr)

    if args.notify:
        sent = send_all(f"Daily Stock Analysis {date}", text, paths["html"].read_text(encoding="utf-8"))
        print(f"Notified: {', '.join(sent) or 'no channels configured'}", file=sys.stderr)
    return 0 if any(m["results"] for m in results) else 1


if __name__ == "__main__":
    sys.exit(main())
