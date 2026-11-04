"""Render Markdown, HTML and JSON reports."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import markdown as md_lib

from .analysis import Analysis

DISCLAIMER = ("_For research and education only. Not investment advice. "
              "Automated signals can be wrong; do your own due diligence._")

HTML_WRAPPER = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Daily Stock Analysis {date}</title>
<style>
:root{{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#e5e5e5;--accent:#2457d6}}
@media (prefers-color-scheme:dark){{:root{{--bg:#111;--fg:#eee;--muted:#999;--line:#333;--accent:#7aa2ff}}}}
body{{background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,sans-serif;max-width:980px;margin:auto;padding:16px}}
table{{border-collapse:collapse;width:100%;margin:8px 0 16px;font-variant-numeric:tabular-nums}}
th,td{{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left}}
h1{{font-size:1.6em}} h2{{border-bottom:2px solid var(--accent);padding-bottom:4px;margin-top:2em}}
h3{{margin-top:1.6em}} a{{color:var(--accent)}} blockquote{{color:var(--muted);border-left:3px solid var(--accent);margin:0;padding-left:12px}}
</style></head><body>{body}</body></html>"""


def _arrow(v: float) -> str:
    return f"{'🟢' if v > 0 else '🔴' if v < 0 else '⚪'} {v:+.2f}%"


def _badge(rating: str) -> str:
    return {"Strong Buy": "🟢", "Buy": "🟢", "Hold": "🟡", "Reduce": "🟠", "Sell": "🔴"}.get(rating, "⚪")


_FUND_LABELS = {"trailingPE": "P/E", "forwardPE": "Fwd P/E", "priceToBook": "P/B",
                "dividendYield": "Div yield", "marketCap": "Mkt cap", "beta": "Beta",
                "returnOnEquity": "ROE", "revenueGrowth": "Rev growth", "sector": "Sector"}


def _fundamentals(r: Analysis):
    out = []
    for k, label in _FUND_LABELS.items():
        v = r.fundamentals.get(k)
        if v is None:
            continue
        if k == "marketCap":
            v = f"{v / 1e9:,.1f}B"
        elif k in ("returnOnEquity", "revenueGrowth"):
            v = f"{v * 100:.1f}%"
        elif k == "dividendYield":
            v = f"{v:.2f}%" if v > 1 else f"{v * 100:.2f}%"
        elif isinstance(v, float):
            v = f"{v:.2f}"
        out.append((label, v))
    return out


def _num(v: float) -> str:
    return f"{v:,.2f}"


def _stock_section(r: Analysis) -> list[str]:
    L = [f"### {_badge(r.rating)} {r.symbol} - {r.name} | Score {r.score}/100 ({r.rating})", ""]
    L.append(f"- **Close:** {_num(r.close)} {r.currency} ({r.change_pct:+.2f}% day, "
             f"{r.change_5d_pct:+.2f}% 5D, {r.change_1m_pct:+.2f}% 1M)")
    vol = f" | **Vol ratio:** {r.volume_ratio}x" if r.volume_ratio else ""
    L.append(f"- **Trend:** {r.trend} | **RSI:** {r.rsi} | **MACD:** {r.macd_state}{vol} | "
             f"**Bias vs MA5:** {r.bias_ma5_pct:+.2f}%")
    L.append(f"- **Levels:** support {_num(r.support)} / resistance {_num(r.resistance)}")
    L.append(f"- **Plan:** entry ~{_num(r.entry)}, stop {_num(r.stop_loss)}, target {_num(r.target)}")
    fund = _fundamentals(r)
    if fund:
        L.append("- **Fundamentals:** " + " · ".join(f"{k} {v}" for k, v in fund))
    L.append("")
    for title, items in (("Positive signals", r.signals), ("Risks", r.risks)):
        if items:
            L += [f"**{title}**", ""] + [f"- {x}" for x in items] + [""]
    L += ["**Checklist:** " + " · ".join(f"{'✅' if ok else '❌'} {item}" for item, ok in r.checklist), ""]
    if r.ai_summary:
        L += [f"**AI view:** {r.ai_summary}", ""]
    if r.news:
        L += ["**Headlines**", ""] + [f"- [{n['title']}]({n['link']}) _{n['source']}_" for n in r.news] + [""]
    return L


def render_markdown(markets: list[dict], errors: list[str], date: str | None = None) -> str:
    date = date or datetime.now().strftime("%Y-%m-%d")
    L = [f"# Daily Stock Analysis - {date}", ""]
    for m in markets:
        L += [f"## {m['name']}", ""]
        if m["indices"]:
            L += ["| Index | Close | Day | 1M | Trend |", "|---|---:|---:|---:|---|"]
            L += [f"| {i['label']} | {_num(i['close'])} | {_arrow(i['change_pct'])} | "
                  f"{i['change_1m_pct']:+.2f}% | {'Above' if i['above_ma50'] else 'Below'} MA50 |"
                  for i in m["indices"]]
            L.append("")
        if m.get("overview"):
            L += [f"> {m['overview']}", ""]
        if not m["results"]:
            L += ["_No stocks analyzed for this market._", ""]
            continue
        L += ["| Stock | Close | Day | Score | Rating |", "|---|---:|---:|---:|---|"]
        L += [f"| **{r.symbol}** {r.name if r.name != r.symbol else ''} | {_num(r.close)} {r.currency} | "
              f"{_arrow(r.change_pct)} | {r.score} | {_badge(r.rating)} {r.rating} |" for r in m["results"]]
        L.append("")
        for r in m["results"]:
            L += _stock_section(r)
    if errors:
        L += ["## Errors", ""] + [f"- {e}" for e in errors] + [""]
    L += ["---", "", DISCLAIMER, ""]
    return "\n".join(L)


def write_reports(markdown_text: str, markets: list[dict], out_dir: str | Path, date: str) -> dict[str, Path]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    paths = {"md": out / f"report_{date}.md", "html": out / f"report_{date}.html",
             "json": out / f"report_{date}.json"}
    paths["md"].write_text(markdown_text, encoding="utf-8")
    body = md_lib.markdown(markdown_text, extensions=["tables"])
    paths["html"].write_text(HTML_WRAPPER.format(date=date, body=body), encoding="utf-8")
    serial = [{"name": m["name"], "indices": m["indices"], "overview": m.get("overview", ""),
               "results": [r.to_dict() for r in m["results"]]} for m in markets]
    paths["json"].write_text(json.dumps(serial, indent=2, default=str), encoding="utf-8")
    return paths
