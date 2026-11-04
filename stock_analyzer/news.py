"""Free news headlines: Yahoo (via yfinance) plus Google News RSS (via feedparser).

Yahoo's per-ticker feed often includes loosely related stories, so every headline
is kept only if it mentions the company (by name word, short name or ticker root).
"""
from __future__ import annotations

import logging
import re
import urllib.parse

log = logging.getLogger(__name__)

_SUFFIXES = re.compile(
    r"[,.]?\s+(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|ag|se|sa|s\.a|nv|n\.v|"
    r"spa|s\.p\.a|ab|asa|oyj|holdings?|group|class [a-z]|ord.*|adr)\b\.?.*$",
    re.IGNORECASE,
)
_GENERIC = {
    "the", "and", "inc", "corp", "corporation", "company", "limited", "ltd", "plc", "holding",
    "holdings", "group", "international", "technology", "technologies", "industries", "industry",
    "financial", "services", "global", "systems", "bank", "motors", "energy", "communications",
    "co", "sa", "se", "ag", "nv", "ord", "class", "shares", "common", "stock", "new", "american",
    "china", "india", "europe", "national", "first", "general", "united",
}


def clean_name(name: str) -> str:
    """'Kweichow Moutai Co., Ltd.' -> 'Kweichow Moutai'; collapses stray whitespace."""
    name = re.sub(r"\s+", " ", name or "").strip()
    stripped = _SUFFIXES.sub("", name).strip(" ,.-")
    return stripped or name


def keywords(symbol: str, name: str, aliases: tuple[str, ...] = ()) -> set[str]:
    words: set[str] = set()
    for text in (name, *aliases):
        for w in re.findall(r"[^\W\d_][\w&'-]*", clean_name(text or "").lower()):
            w = w.strip("'-")
            if len(w) >= 3 and w not in _GENERIC:
                words.add(w)
    root = symbol.split(".")[0].lower()
    if root.isalpha() and len(root) >= 2:
        words.add(root)
    return words


def is_relevant(title: str, kws: set[str]) -> bool:
    t = title.lower()
    return any(re.search(rf"(?<![\w]){re.escape(k)}(?![\w])", t) for k in kws)


def google_news(query: str, locale: str = "hl=en-US&gl=US&ceid=US:en", limit: int = 10) -> list[dict]:
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
        title = e.get("title", "")
        if src and title.endswith(f" - {src}"):
            title = title[: -len(src) - 3]
        out.append({"title": title, "link": e.get("link", ""), "source": src,
                    "published": e.get("published", "")})
    return out


def fetch_news(provider, symbol: str, name: str, locale: str, limit: int = 5,
               aliases: tuple[str, ...] = ()) -> list[dict]:
    kws = keywords(symbol, name, aliases)
    seen: set[str] = set()
    out: list[dict] = []

    def take(items):
        for it in items:
            title = it.get("title", "")
            if title and title not in seen and is_relevant(title, kws):
                seen.add(title)
                out.append(it)
                if len(out) >= limit:
                    return

    take(provider.news(symbol, limit * 4))
    if len(out) < limit:
        base = clean_name(name) if name and name != symbol else symbol.split(".")[0]
        take(google_news(f'"{base}" stock', locale, limit * 3))
    return out[:limit]
