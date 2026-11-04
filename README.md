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

## Live app: browse markets, live prices and news

For day-to-day decisions, run the live app. It's the same dashboard, backed by a small FastAPI server that fetches prices and news when you open a page.

```bash
python -m stock_analyzer.server
```

Then open http://localhost:8000. Use `--demo` to try it offline.

| Page | What it does |
|---|---|
| **Overview** | Your watchlist: market cards, top setups, signals and a sortable table. Refreshes every minute. |
| **Markets** | Pick **India, US, China/HK or Europe** to see that market's largest stocks (NIFTY 50, US mega-caps, Shanghai/Shenzhen/HK leaders, Europe's largest) with live price, day change, 60-day trend, RSI and score. You can filter by sector, filter or search any ticker, and tap ☆ to add a stock to your watchlist. |
| **News** | A live feed of headlines grouped by time, refreshed every 2 minutes. Choose a market, and switch between **Market news** and **My watchlist** (headlines for each stock you follow). New headlines are marked. |
| **Stock** | Any ticker, not only your watchlist. A **1D** intraday chart (5-minute bars) as well as 1M to 1Y daily charts, a live price, the trade plan and checklist, and live news. Includes a ☆ watchlist button. |

Notes:

- **Delays:** Yahoo Finance prices can be delayed by up to 15 minutes depending on the exchange. The server caches prices for about 90 seconds and news for 3 minutes.
- **Watchlist edits** are saved to `config.yaml`, which the scheduled GitHub report also reads. Commit the file to keep both in sync.
- **Protect it before sharing:** if anyone else can reach the app, set `ADMIN_TOKEN` and the app will ask for it before changing the watchlist.
- **API:** docs are at http://localhost:8000/api/docs.

**Hosting options:**

| Where | How | Notes |
|---|---|---|
| Your computer | `python -m stock_analyzer.server` | Simplest; open it on your phone over Wi-Fi with `--host 0.0.0.0`. |
| Docker / a home server or VPS | `docker compose up -d live` | Watchlist edits persist in the mounted `config.yaml`. |
| Free cloud: [Hugging Face Spaces](https://huggingface.co/docs/hub/spaces-sdks-docker) (Docker) or [Render](https://render.com/) | Point it at this repo; it builds the `Dockerfile`. Set `PORT` to the platform's port and set `ADMIN_TOKEN`. | Free tiers sleep when idle, and watchlist edits reset when the container restarts. |

GitHub Pages can't run this server, because it only hosts static files. The published Pages dashboard stays the daily snapshot and detects that it isn't live.

## Quickest way online: Render (about 5 minutes, free)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/EngineerPrakash/stockanalysis)

Render works like Netlify, but it can run this app's server. (Netlify and Vercel only host static sites and short-lived functions, so they can serve the daily snapshot but not the live app.)

1. **Deploy.** Click the button above and sign in to Render with GitHub. Render reads `render.yaml`, builds the `Dockerfile` and gives you an address like `https://stock-analyzer-xxxx.onrender.com`.
2. **Keep your watchlist (recommended).** Free servers lose their files when they restart, so let the app save the watchlist to this repo:
   - On GitHub, go to **Settings → Developer settings → Fine-grained tokens → Generate new token**. Choose **Only select repositories → stockanalysis**, then set **Repository permissions → Contents** to **Read and write**.
   - Paste the token as `GITHUB_TOKEN` when Render asks, or later under the service's **Environment**.
   - Each star you tap then becomes a commit to `config.yaml`. The scheduled daily report uses the same list, and these commits don't trigger a rebuild.
3. **Find your admin token** under the service's **Environment → ADMIN_TOKEN**. The app asks for it the first time you edit the watchlist.

Free-plan limits: the server sleeps after 15 minutes without visitors, and the first visit afterwards takes about a minute while it wakes up. Upgrading to Render's Starter plan keeps it always on. If Yahoo ever blocks Render's servers, prices won't load; the Oracle Cloud option below runs on your own server instead.

**Similar quick options:**

| Platform | Free plan | How |
|---|---|---|
| [Render](https://render.com) | Yes, sleeps when idle | Button above |
| [Koyeb](https://www.koyeb.com) | 1 small instance, sleeps when idle | Create Web Service → GitHub → this repo, *Dockerfile* builder, port `8000`; add the same environment variables |
| [Hugging Face Spaces](https://huggingface.co/spaces) | Yes, sleeps after 48 h idle | New Space → *Docker*, push this repo, set `PORT=7860` and the variables as Secrets |
| [Railway](https://railway.app) / [Fly.io](https://fly.io) | Trial credit, then about $5/month | Deploy from GitHub; always on |

All of them run the same `Dockerfile`, and `GITHUB_TOKEN` keeps the watchlist safe on any of them.

## Go live for free, always on (Oracle Cloud + open-source stack)

This puts the live app on the internet at an HTTPS address you can open from your phone anywhere. It costs nothing on Oracle Cloud's **Always Free** tier, and everything running on the server is open source: Ubuntu, Docker, Caddy (automatic HTTPS from Let's Encrypt) and this app. Expect about 20 minutes, most of it Oracle sign-up.

**1. Create a free account.** Sign up at https://www.oracle.com/cloud/free/. Oracle asks for a card to verify identity; Always Free resources aren't charged.

**2. Create the server.** Go to Menu → Compute → Instances → **Create instance**.
- **Image:** Ubuntu 24.04.
- **Shape:** *Ampere A1* (ARM) with 1–4 OCPUs and 6–24 GB memory, all marked "Always Free eligible". If A1 says "out of capacity", pick another availability domain or try again later.
- **SSH key:** click **Save private key** and keep the file.
- Click **Create**, then copy the server's **Public IP address**.

**3. Open the web ports.** On the instance page, click the subnet, then the **Default Security List**, then **Add Ingress Rules**:
- Source CIDR `0.0.0.0/0`, IP protocol TCP, destination port `80`.
- Add a second rule the same way with destination port `443`.

**4. Connect and run the setup.** From your computer's terminal, using the key file from step 2:

```bash
ssh -i path/to/your-key.key ubuntu@YOUR_PUBLIC_IP
```

Then, on the server:

```bash
curl -fsSL https://raw.githubusercontent.com/EngineerPrakash/stockanalysis/main/deploy/setup.sh | bash
```

The script installs Docker, opens the server's firewall, starts the app with HTTPS and prints two things:

- **Your address**, like `https://203-0-113-10.sslip.io`. [sslip.io](https://sslip.io) is a free hostname that points at your IP, so you don't need to buy a domain.
- **Your admin token**, which the app asks for the first time you add or remove a watchlist stock. Keep it private.

Open the address on your phone and bookmark it, or use the browser's "Add to Home Screen".

**Later:**

| To | Do this on the server |
|---|---|
| Update to the latest code | `bash ~/stockanalysis/deploy/update.sh` |
| See logs | `cd ~/stockanalysis/deploy && sudo docker compose logs -f app` |
| Use your own domain | Point its DNS A record at the IP, set `DOMAIN=yourdomain.com` in `~/stockanalysis/deploy/.env`, then run `update.sh` |
| Find the admin token again | `cat ~/stockanalysis/deploy/.env` |

Your watchlist is saved in `~/stockanalysis/deploy/data/config.yaml` and survives updates and restarts. The same script works on any Ubuntu server, such as Hetzner or DigitalOcean, or a home machine with ports 80 and 443 forwarded.

## Daily snapshot on GitHub Pages

Every scheduled run also publishes a static dashboard to the `gh-pages` branch:

**https://engineerprakash.github.io/stockanalysis/**

It has the same daily view as the app (market cards, best setups, alerts, sortable watchlist) and a page per stock with interactive charts, the trade plan, checklist, news and score history. A **History** tab keeps a snapshot of every run. No server is needed: the page reads JSON files that the workflow commits.

**One-time setup:** Settings → Pages → *Build and deployment* → Source: **GitHub Actions**. The workflow deploys the site itself. The `gh-pages` branch is only where past data is stored.

To change the watchlist, edit `config.yaml` on GitHub. The next run picks it up, or you can start one from Actions → Daily Stock Analysis → Run workflow.

To build the site locally:

```bash
python -m stock_analyzer --site _site
```

```bash
python -m http.server -d _site 8000
```

## Streamlit app (optional, local)

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
deploy/                  one-command production setup (Docker + Caddy HTTPS)
stock_analyzer/server.py live web app (FastAPI)
stock_analyzer/universe.py  browsable stocks per country
stock_analyzer/site.py   static dashboard builder (GitHub Pages)
stock_analyzer/web/      dashboard HTML/JS/CSS
config.yaml      watchlists and options
```

## Run the tests

```bash
python -m pytest -q
```

## Disclaimer

This tool is for research and education only. It is not investment advice. Free data sources can be delayed, incomplete or rate-limited.
