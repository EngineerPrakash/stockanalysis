"""Daily workspace:  streamlit run app.py"""
import streamlit as st

st.set_page_config(page_title="Global Stock Analyzer", page_icon="📈", layout="wide")

nav = st.navigation([
    st.Page("ui/today.py", title="Today", icon="🌅", default=True),
    st.Page("ui/stock.py", title="Stock", icon="📈"),
    st.Page("ui/watchlist.py", title="Watchlist", icon="⭐"),
    st.Page("ui/reports.py", title="Reports", icon="📄"),
])
nav.run()
