# 📈 Global Stock Analyzer

Daily stock analysis for **India, US, China/Hong Kong and Europe**, built only with open-source tools.

Each run produces a decision dashboard for your watchlist:

- **Index snapshot** per market (NIFTY 50, SENSEX, S&P 500, NASDAQ, SSE, Hang Seng, DAX, FTSE, Euro Stoxx 50...)
- **Score from 0 to 100 and a rating** (Strong Buy / Buy / Hold / Reduce / Sell) built from explainable rules
- **Technicals:** MA5/10/20/50/200 alignment, golden/death cross, RSI, MACD, Bollinger, ATR, volume ratio
- **"Don't chase" guard:** flags stocks more than 5% above MA5
- **Trade plan:** entry, ATR-based stop-loss, target, and support/resistance
- **Checklist**, fundamentals (P/E, P/B, ROE...), and news headlines
- **Optional AI commentary** from a local open-source LLM (Ollama, LM Studio, vLLM, llama.cpp)
- Reports in **Markdown, HTML and JSON**, sent to **Telegram, Discord, Slack, ntfy or email**
- **Daily web app** (Streamlit): market overview, best setups, alerts, charts, watchlist editor, report history

## Open-source stack

| Layer | Tool |
|---|---|
| Market data | [yfinance](https://github.com/ranaroussi/yfinance) (Yahoo Finance: NSE/BSE, NYSE/NASDAQ, SSE/SZSE/HKEX, all major EU exchanges) |
| Analysis | pandas, numpy (indicators written by hand, no TA-Lib) |
| News | Yahoo news via yfinance and Google News RSS via feedparser |
| LLM (optional) | Ollama + Qwen 2.5 / Llama 3.1 / Mistral, or any OpenAI-compatible server |
| Dashboard | Streamlit + Plotly |
| Scheduling | GitHub Actions, cron, or Docker |
| Notifications | Telegram, Discord, Slack, [ntfy](https://ntfy.sh) (self-hostable), SMTP |

## Quick start

```bash
pip install -r requirements.txt
```

```bash
python -m stock_analyzer --demo
```

```bash
python -m stock_analyzer
```

The `--demo` run uses offline synthetic data, so you can check the setup before using real data. The second command analyzes every market in `config.yaml`.

More examples:

```bash
python -m stock_analyzer --markets india us
```

```bash
python -m stock_analyzer --stocks RELIANCE.NS AAPL 0700.HK SAP.DE
```

```bash
python -m stock_analyzer --llm --notify
```

```bash
streamlit run app.py
```

Reports are written to `reports/report_YYYY-MM-DD.{md,html,json}`.

## Daily use: the web app

```bash
streamlit run app.py
```

This opens http://localhost:8501 with four pages:

| Page | What you do there |
|---|---|
| 🌅 **Today** | Morning check: index cards for all four markets, the top-scoring setups with entry/stop/target, alerts (MACD and MA crossovers, overbought/oversold, extended, heavy volume), and a ranked table per market. Click any row or **Open** to see the stock. |
| 📈 **Stock** | Candlestick chart with MA20/50/200 and entry/stop/target lines, MACD and RSI panels, trade plan, checklist, signals and risks, news, and an optional AI view. Type any ticker to look it up, even if it's not on your watchlist. |
| ⭐ **Watchlist** | Add tickers (validated against live data) or remove them. Saved to `config.yaml`, which the scheduled report also reads. |
| 📄 **Reports** | Create a full report for any markets, with news and AI, then download it as Markdown, HTML or JSON or send it to your channels. Past reports are listed here too. |

In the sidebar you can switch to offline demo data, change the price history window, and refresh data. Prices are cached for 15 minutes.

**A typical day:** open **Today** after the market closes, scan the best setups and alerts, open anything interesting on **Stock**, and adjust the **Watchlist**. Scheduled GitHub Actions reports arrive on your phone in between.

**Use it from your phone:** deploy free on [Streamlit Community Cloud](https://streamlit.io/cloud). Choose *New app*, then this repo, then `app.py`. The cloud copy resets its files on restart, so make lasting watchlist changes by editing `config.yaml` on GitHub. Alternatively, run it on a home machine and open it on your LAN with `streamlit run app.py --server.address 0.0.0.0`.

## Ticker formats

| Market | Format | Examples |
|---|---|---|
| India (NSE / BSE) | `.NS` / `.BO` | `RELIANCE.NS`, `TCS.NS`, `500325.BO` |
| US | plain | `AAPL`, `MSFT`, `BRK-B` |
| China, Shanghai / Shenzhen | `.SS` / `.SZ` | `600519.SS`, `000858.SZ` |
| Hong Kong | `.HK` | `0700.HK`, `9988.HK` |
| Europe | exchange suffix | `SAP.DE`, `MC.PA`, `ASML.AS`, `SHEL.L`, `NESN.SW`, `ENI.MI` |

The market is detected from the suffix, so you can mix tickers freely with `--stocks`.

## AI commentary with a free local LLM

```bash
ollama pull qwen2.5:7b
```

```bash
cp .env.example .env
```

```bash
set -a; source .env; set +a; python -m stock_analyzer --llm
```

If the LLM can't be reached, the tool logs a warning and still produces the full rule-based report. The LLM only adds a narrative. Scores and levels always come from the rules.

## Automate it

**GitHub Actions (free).** Push this repo to GitHub, add the notification secrets you want (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DISCORD_WEBHOOK_URL`, `NTFY_TOPIC`, `SMTP_*`, `EMAIL_TO`), and `.github/workflows/daily-analysis.yml` runs on weekdays after each market closes:

| UTC | Markets |
|---|---|
| 08:30 | India, China/HK |
| 17:00 | Europe |
| 21:30 | US |

You can also start it manually from the Actions tab. Reports are kept as workflow artifacts for 30 days.

**Docker:**

```bash
docker compose up dashboard
```

```bash
docker compose --profile report run --rm report
```

The second command runs the report with a bundled Ollama container. Pull a model into it first:

```bash
docker compose --profile report run --rm ollama ollama pull qwen2.5:7b
```

**Cron:**

```bash
30 21 * * 1-5 cd /path/to/global-stock-analyzer && python -m stock_analyzer --notify
```

## How the score works

Every stock starts at 50 points, which are then adjusted:

| Rule | Points |
|---|---|
| MA5 > MA10 > MA20 (bullish alignment) / reverse | +15 / −15 |
| Price above / below MA50 | +5 / −5 |
| Price above / below MA200 | +5 / −5 |
| Golden / death cross in last 5 days | +5 / −5 |
| RSI 50–70 / RSI < 30 / RSI > 70 | +5 / +5 / −8 |
| MACD bullish / bearish crossover today | +8 / −8 |
| MACD above / below signal line | +3 / −3 |
| Price > 5% above MA5 (extended) | −10 |
| Within ±2% of MA5 in an uptrend | +5 |
| Heavy volume (> 1.8× average) on an up / down day | +5 / −5 |

Ratings: ≥75 Strong Buy · ≥60 Buy · ≥45 Hold · ≥30 Reduce · <30 Sell. You can tune the rules in `stock_analyzer/analysis.py`.

## Project layout

```
stock_analyzer/
  markets.py     market definitions, benchmarks, ticker → market/currency
  data.py        yfinance provider and offline demo provider
  indicators.py  MA, EMA, RSI, MACD, Bollinger, ATR
  analysis.py    scoring, levels, checklist
  news.py        Google News RSS
  llm.py         OpenAI-compatible client for open-source LLMs
  report.py      Markdown / HTML / JSON output
  notify.py      Telegram, Discord, Slack, ntfy, email
  pipeline.py    orchestration
app.py           Streamlit web app (navigation)
ui/              Today, Stock, Watchlist, Reports pages
config.yaml      watchlists and options
```

## Run the tests

```bash
python -m pytest -q
```

## Disclaimer

This tool is for research and education only. It is not investment advice. Free data sources can be delayed, incomplete or rate-limited.
