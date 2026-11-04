"""Reports: create today's full report and browse past ones."""
from datetime import datetime

import streamlit as st

from stock_analyzer.markets import MARKETS
from stock_analyzer.notify import send_all
from stock_analyzer.pipeline import run
from stock_analyzer.report import render_markdown, write_reports
from ui.common import REPORTS, llm_status, settings, sidebar

demo, period = sidebar()
cfg = settings()

st.title("Reports")

with st.container(border=True):
    st.markdown("**Create a report**")
    c1, c2, c3 = st.columns([3, 1, 1])
    chosen = c1.multiselect("Markets", list(MARKETS), default=list(MARKETS),
                            format_func=lambda m: MARKETS[m].name)
    use_news = c2.toggle("News", value=not demo)
    use_ai = c3.toggle("AI view", value=False, disabled=not llm_status())
    if st.button("Create report", type="primary", disabled=not chosen):
        cfg.period, cfg.news, cfg.llm = period, use_news, use_ai
        with st.spinner("Analyzing... this takes longer with news and AI turned on."):
            results, errors = run(cfg, chosen, demo=demo)
        date = datetime.now().strftime("%Y-%m-%d")
        text = render_markdown(results, errors, date)
        paths = write_reports(text, results, REPORTS, date)
        st.session_state["report"] = paths["md"].name
        st.success(f"Saved {paths['md'].name}")

files = sorted(REPORTS.glob("report_*.md"), reverse=True)
if not files:
    st.info("No reports yet. Create one above, or download one from the GitHub Actions run artifacts.")
    st.stop()

names = [f.name for f in files]
current = st.session_state.get("report", names[0])
pick = st.selectbox("Saved reports", names, index=names.index(current) if current in names else 0)
md_path = REPORTS / pick
text = md_path.read_text(encoding="utf-8")

d1, d2, d3, d4 = st.columns(4)
d1.download_button("⬇ Markdown", text, file_name=pick, width="stretch")
for col, ext, mime in ((d2, "html", "text/html"), (d3, "json", "application/json")):
    p = md_path.with_suffix(f".{ext}")
    if p.exists():
        col.download_button(f"⬇ {ext.upper()}", p.read_bytes(), file_name=p.name, mime=mime, width="stretch")
if d4.button("📤 Send to my channels", width="stretch"):
    html = md_path.with_suffix(".html")
    sent = send_all(f"Daily Stock Analysis {pick[7:17]}", text, html.read_text(encoding="utf-8") if html.exists() else text)
    if sent:
        st.success(f"Sent via {', '.join(sent)}")
    else:
        st.warning("No channels configured. Set TELEGRAM_*, DISCORD_WEBHOOK_URL, NTFY_TOPIC or SMTP_* in your environment.")

with st.container(border=True):
    st.markdown(text)
