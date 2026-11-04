"""Free news headlines via public RSS (Google News search feed) using feedparser."""
from __future__ import annotations

import logging
import urllib.parse

log = logging.getLogger(__name__)


def google_news(query: str, locale: str = "hl=en-US&gl=US&ceid=US:en", limit: int = 5) -> list[dict]:
    try:
        import feedparser
    except ImportError:
        return []
    url = f"https://news.google.com/rss/search?q={urllib.parse.quote(query)}+when:3d&{locale}"
    try:
        feed = feedparser.parse(url)
    except Exception as e:
        log.debug("news failed for %s: %s", query, e)
        return []
    out = []
    for e in feed.entries[:limit]:
        src = getattr(getattr(e, "source", None), "title", None) or "Google News"
        out.append({"title": e.get("title", ""), "link": e.get("link", ""),
                    "source": src, "published": e.get("published", "")})
    return out


def fetch_news(provider, symbol: str, name: str, locale: str, limit: int = 5) -> list[dict]:
    items = provider.news(symbol, limit)
    if len(items) < limit:
        q = f'"{name}" stock' if name and name != symbol else f"{symbol} stock"
        seen = {i["title"] for i in items}
        for it in google_news(q, locale, limit):
            if it["title"] not in seen:
                items.append(it)
    return items[:limit]
