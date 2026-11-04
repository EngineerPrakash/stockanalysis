"""Smoke-test the live app against real data (run in CI, where Yahoo/Google are reachable).

    python scripts/live_smoke.py OUT_DIR

Writes OUT_DIR/summary.md and screenshots; exits non-zero if a core check fails.
"""
from __future__ import annotations

import json
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from stock_analyzer.server import create_app  # noqa: E402

out = Path(sys.argv[1] if len(sys.argv) > 1 else "smoke")
out.mkdir(parents=True, exist_ok=True)
lines: list[str] = []
failures: list[str] = []


def log(s: str = "") -> None:
    print(s, flush=True)
    lines.append(s)


def check(ok: bool, msg: str) -> None:
    log(f"- {'✅' if ok else '❌'} {msg}")
    if not ok:
        failures.append(msg)


tmp = Path(tempfile.mkdtemp())
shutil.copy(ROOT / "config.yaml", tmp / "config.yaml")
c = TestClient(create_app(demo=False, config=tmp / "config.yaml"))

import atexit  # noqa: E402

atexit.register(lambda: (out / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8"))
log("# Live app smoke test (real data)")
log(f"Run at {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}")

log("\n## Markets")
for code in ("india", "us", "china", "europe"):
    t = time.time()
    r = c.get(f"/api/markets/{code}")
    m = r.json() if r.is_success else {}
    stocks, missing = m.get("stocks", []), m.get("unavailable", [])
    check(r.is_success and len(stocks) >= 20, f"{code}: {len(stocks)} stocks with data, {len(m.get('indices', []))} indices, {time.time()-t:.1f}s")
    if missing:
        log(f"  - no data: {', '.join(missing)}")
    for s in stocks[:3]:
        log(f"  - top: {s['symbol']} {s['name']} {s['close']} {s['currency']} ({s['change_pct']:+.2f}%) score {s['score']} {s['rating']}")
    for i in m.get("indices", []):
        log(f"  - index {i['label']}: {i['close']:,.2f} ({i['change_pct']:+.2f}%)")

log("\n## Watchlist snapshot")
snap = c.get("/api/snapshot").json()
n = sum(len(v["results"]) for v in snap["markets"].values())
check(n >= 15, f"{n} watchlist stocks analysed; errors: {snap['errors'] or 'none'}")

log("\n## Stock pages")
for sym in ("RELIANCE.NS", "AAPL", "0700.HK", "SAP.DE"):
    r = c.get(f"/api/stocks/{sym}")
    if not r.is_success:
        check(False, f"{sym}: HTTP {r.status_code}")
        continue
    a = r.json()["analysis"]
    bars = c.get(f"/api/stocks/{sym}/intraday").json()["bars"]
    check(True, f"{sym} {a['name']}: {a['close']} {a['currency']}, score {a['score']}, {len(a['news'])} headlines, {len(bars)} intraday bars")
    for h in a["news"][:2]:
        log(f"  - news: {h['title'][:100]} ({h['source']}, {h.get('published', '')[:16]})")

log("\n## News feed")
for code in ("india", "us", "china", "europe"):
    items = c.get(f"/api/news?market={code}").json()["items"]
    check(len(items) >= 3, f"{code} market news: {len(items)} headlines")
    for h in items[:2]:
        log(f"  - {h['title'][:100]} ({h['source']}, {h.get('published', '')[:16]})")
w = c.get("/api/news?scope=watchlist").json()["items"]
check(len(w) >= 5, f"watchlist news: {len(w)} headlines")

log("\n## Search")
for q in ("tata", "toyota", "nestle"):
    res = c.get(f"/api/search?q={q}").json()["results"]
    check(len(res) > 0, f"'{q}': {', '.join(r['symbol'] for r in res[:6])}")

log("\n## Watchlist edit")
check(c.put("/api/watchlist/BMW.DE").status_code == 200, "added BMW.DE")
check(c.delete("/api/watchlist/BMW.DE").status_code == 200, "removed BMW.DE")

# ---- screenshots of the real UI ---------------------------------------------------
log("\n## Screenshots")
try:
    from playwright.sync_api import sync_playwright

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    srv = subprocess.Popen([sys.executable, "-m", "stock_analyzer.server", "--port", str(port), "-c", str(tmp / "config.yaml")], cwd=ROOT)
    base = f"http://127.0.0.1:{port}/"
    for _ in range(60):
        try:
            import urllib.request
            urllib.request.urlopen(base + "api/meta", timeout=2)
            break
        except Exception:
            time.sleep(1)
    errors: list[str] = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, url, vp, wait in [
            ("overview", "", (1360, 900), ".mkt"),
            ("markets-india", "#/markets/india", (1360, 900), "#mk-table tbody tr"),
            ("markets-us", "#/markets/us", (1360, 900), "#mk-table tbody tr"),
            ("stock-reliance", "#/s/RELIANCE.NS", (1360, 900), "#px"),
            ("news", "#/news", (1360, 900), ".feed li.item"),
            ("phone-markets", "#/markets/europe", (390, 844), "#mk-table tbody tr"),
        ]:
            pg = b.new_page(viewport={"width": vp[0], "height": vp[1]})
            pg.on("pageerror", lambda e, n=name: errors.append(f"{n}: {e}"))
            pg.goto(base + url)
            try:
                pg.wait_for_selector(wait, timeout=90_000)
                pg.wait_for_timeout(1500)
            except Exception as e:
                errors.append(f"{name}: {e}")
            pg.screenshot(path=str(out / f"{name}.png"), full_page=True)
            pg.close()
        pg = b.new_page(viewport={"width": 1360, "height": 900})
        pg.goto(base + "#/s/AAPL")
        pg.wait_for_selector("#px", timeout=90_000)
        pg.click('#range button[data-r="1D"]')
        pg.wait_for_timeout(3000)
        pg.screenshot(path=str(out / "stock-aapl-1d.png"), full_page=True)
        log(f"  - 1D readout: {pg.text_content('#readout')}")
        b.close()
    srv.terminate()
    check(not errors, f"screenshots taken; page errors: {errors or 'none'}")
except Exception as e:
    check(False, f"screenshots failed: {e}")

(out / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
log(f"\n{len(failures)} failure(s)")
sys.exit(1 if failures else 0)
