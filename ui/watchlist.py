"""Watchlist: add / remove tickers per market, saved to config.yaml."""
import streamlit as st
import yaml

from stock_analyzer.markets import MARKETS, detect_market
from ui.common import CONFIG, load_stock, sidebar

demo, period = sidebar()

st.title("Watchlist")
st.caption("Changes are saved to `config.yaml`, which the daily report also uses. "
           "Commit the file to update the GitHub Actions schedule.")

raw = yaml.safe_load(CONFIG.read_text()) if CONFIG.exists() else {}
raw = raw or {}
wl = {code: list((raw.get("watchlist") or {}).get(code) or []) for code in MARKETS}


def save():
    raw["watchlist"] = wl
    CONFIG.write_text(yaml.safe_dump(raw, sort_keys=False, allow_unicode=True))
    st.cache_data.clear()


with st.form("add", clear_on_submit=True):
    c1, c2 = st.columns([3, 1])
    new = c1.text_input("Add tickers (comma separated)", placeholder="TATAMOTORS.NS, TSLA, 1810.HK, AIR.PA")
    c2.write("")
    c2.write("")
    if c2.form_submit_button("Add", width="stretch", type="primary") and new:
        added, failed = [], []
        for t in {x.strip().upper() for x in new.split(",") if x.strip()}:
            if load_stock(t, "1mo", demo) is None:
                failed.append(t)
                continue
            code = detect_market(t)
            if t not in wl[code]:
                wl[code].append(t)
                added.append(t)
        if added:
            save()
            st.success(f"Added {', '.join(sorted(added))}")
        if failed:
            st.error(f"No data found for {', '.join(sorted(failed))}. Check the suffix: .NS, .BO, .SS, .SZ, .HK, .DE, .PA, .L ...")

cols = st.columns(len(MARKETS))
for col, (code, mk) in zip(cols, MARKETS.items()):
    with col.container(border=True):
        st.markdown(f"**{mk.name}** · {len(wl[code])}")
        for sym in list(wl[code]):
            a, b = st.columns([4, 1])
            a.write(sym)
            if b.button("✕", key=f"rm-{sym}", help=f"Remove {sym}"):
                wl[code].remove(sym)
                save()
                st.rerun()

with st.expander("Ticker format help"):
    st.markdown("""
| Market | Suffix | Example |
|---|---|---|
| India NSE / BSE | `.NS` / `.BO` | `RELIANCE.NS`, `500325.BO` |
| US | none | `AAPL`, `BRK-B` |
| Shanghai / Shenzhen | `.SS` / `.SZ` | `600519.SS`, `000858.SZ` |
| Hong Kong | `.HK` | `0700.HK` |
| Europe | exchange | `SAP.DE`, `MC.PA`, `ASML.AS`, `SHEL.L`, `NESN.SW`, `ENI.MI` |
""")
