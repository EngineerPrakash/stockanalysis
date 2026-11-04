"""Rule-based technical scoring -> a "decision dashboard" for each stock.

The score is 0-100, built from transparent, explainable rules. An optional
open-source LLM (see llm.py) can add a narrative on top, but the numbers here
never depend on the LLM.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field

import pandas as pd

from .data import StockData
from .indicators import add_all
from .markets import currency_for, detect_market


@dataclass
class Analysis:
    symbol: str
    name: str
    market: str
    currency: str
    date: str
    close: float
    change_pct: float
    change_5d_pct: float
    change_1m_pct: float
    score: int
    rating: str
    trend: str
    rsi: float
    macd_state: str
    volume_ratio: float | None
    bias_ma5_pct: float
    support: float
    resistance: float
    entry: float
    stop_loss: float
    target: float
    signals: list[str] = field(default_factory=list)
    risks: list[str] = field(default_factory=list)
    checklist: list[tuple[str, bool]] = field(default_factory=list)
    fundamentals: dict = field(default_factory=dict)
    news: list[dict] = field(default_factory=list)
    ai_summary: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def _pct(a: float, b: float) -> float:
    return (a / b - 1) * 100 if b else 0.0


def _f(x) -> float | None:
    try:
        x = float(x)
        return None if math.isnan(x) else x
    except (TypeError, ValueError):
        return None


def rating_for(score: int) -> str:
    if score >= 75:
        return "Strong Buy"
    if score >= 60:
        return "Buy"
    if score >= 45:
        return "Hold"
    if score >= 30:
        return "Reduce"
    return "Sell"


def analyze(data: StockData, max_bias_pct: float = 5.0) -> Analysis:
    df = add_all(data.history)
    if len(df) < 30:
        raise ValueError(f"{data.symbol}: need at least 30 bars, got {len(df)}")
    last, prev = df.iloc[-1], df.iloc[-2]
    close = float(last["Close"])
    ma5, ma10, ma20 = _f(last["MA5"]), _f(last["MA10"]), _f(last["MA20"])
    ma50, ma200 = _f(last["MA50"]), _f(last["MA200"])
    rsi_v = float(last["RSI14"])
    atr_v = float(last["ATR14"])
    vol_ratio = _f(last.get("VOL_RATIO"))

    score = 50
    signals: list[str] = []
    risks: list[str] = []

    # --- Trend: moving-average alignment -------------------------------
    if ma5 and ma10 and ma20 and ma5 > ma10 > ma20:
        score += 15
        trend = "Bullish (MA5 > MA10 > MA20)"
        signals.append("Short-term moving averages in bullish alignment")
    elif ma5 and ma10 and ma20 and ma5 < ma10 < ma20:
        score -= 15
        trend = "Bearish (MA5 < MA10 < MA20)"
        risks.append("Short-term moving averages in bearish alignment")
    else:
        trend = "Sideways / mixed"

    if ma50:
        if close > ma50:
            score += 5
            signals.append("Price above 50-day MA")
        else:
            score -= 5
            risks.append("Price below 50-day MA")
    if ma200:
        if close > ma200:
            score += 5
            signals.append("Price above 200-day MA (long-term uptrend)")
        else:
            score -= 5
            risks.append("Price below 200-day MA (long-term downtrend)")
    if ma50 and ma200:
        prev_50, prev_200 = _f(df["MA50"].iloc[-6]), _f(df["MA200"].iloc[-6])
        if prev_50 and prev_200:
            if prev_50 <= prev_200 and ma50 > ma200:
                score += 5
                signals.append("Golden cross (MA50 crossed above MA200) in last 5 days")
            elif prev_50 >= prev_200 and ma50 < ma200:
                score -= 5
                risks.append("Death cross (MA50 crossed below MA200) in last 5 days")

    # --- Momentum ------------------------------------------------------
    if rsi_v > 70:
        score -= 8
        risks.append(f"RSI {rsi_v:.0f}: overbought")
    elif rsi_v < 30:
        score += 5
        signals.append(f"RSI {rsi_v:.0f}: oversold, rebound possible")
    elif 50 <= rsi_v <= 70:
        score += 5
        signals.append(f"RSI {rsi_v:.0f}: healthy bullish momentum")

    hist_now, hist_prev = float(last["MACD_HIST"]), float(prev["MACD_HIST"])
    if hist_prev <= 0 < hist_now:
        macd_state = "Bullish crossover"
        score += 8
        signals.append("MACD bullish crossover today")
    elif hist_prev >= 0 > hist_now:
        macd_state = "Bearish crossover"
        score -= 8
        risks.append("MACD bearish crossover today")
    elif hist_now > 0:
        macd_state = "Above signal"
        score += 3
    else:
        macd_state = "Below signal"
        score -= 3

    # --- Don't chase: distance from MA5 --------------------------------
    bias = _pct(close, ma5) if ma5 else 0.0
    if bias > max_bias_pct:
        score -= 10
        risks.append(f"Price {bias:.1f}% above MA5: extended, avoid chasing")
    elif -2 <= bias <= 2 and trend.startswith("Bullish"):
        score += 5
        signals.append("Price near MA5 in an uptrend: low-risk entry zone")

    # --- Volume --------------------------------------------------------
    day_chg = _pct(close, float(prev["Close"]))
    if vol_ratio:
        if vol_ratio > 1.8 and day_chg > 0:
            score += 5
            signals.append(f"Up day on heavy volume ({vol_ratio:.1f}x 5-day avg)")
        elif vol_ratio > 1.8 and day_chg < 0:
            score -= 5
            risks.append(f"Down day on heavy volume ({vol_ratio:.1f}x 5-day avg)")

    # --- Bollinger -----------------------------------------------------
    bb_up, bb_low = _f(last["BB_UP"]), _f(last["BB_LOW"])
    if bb_up and close > bb_up:
        risks.append("Closed above upper Bollinger band")
    elif bb_low and close < bb_low:
        signals.append("Closed below lower Bollinger band (stretched to downside)")

    score = int(max(0, min(100, score)))

    # --- Levels --------------------------------------------------------
    window = df.tail(20)
    support = float(window["Low"].min())
    resistance = float(window["High"].max())
    entry = round(ma5 if (ma5 and close > ma5) else close, 4)
    stop = round(max(support, entry - 2 * atr_v) if support < entry else entry - 2 * atr_v, 4)
    target = round(max(resistance, entry + 3 * atr_v), 4)

    checklist = [
        ("Trend is up (MA alignment)", trend.startswith("Bullish")),
        (f"Not extended (< {max_bias_pct:.0f}% above MA5)", bias <= max_bias_pct),
        ("RSI not overbought", rsi_v <= 70),
        ("MACD above signal", hist_now > 0),
        ("Above 200-day MA", bool(ma200 and close > ma200)),
        ("Reward/risk >= 1.5", (target - entry) >= 1.5 * max(entry - stop, 1e-9)),
    ]

    c = df["Close"]
    return Analysis(
        symbol=data.symbol,
        name=data.name,
        market=detect_market(data.symbol),
        currency=currency_for(data.symbol),
        date=df.index[-1].strftime("%Y-%m-%d"),
        close=round(close, 4),
        change_pct=round(day_chg, 2),
        change_5d_pct=round(_pct(close, float(c.iloc[-6])), 2) if len(c) > 6 else 0.0,
        change_1m_pct=round(_pct(close, float(c.iloc[-22])), 2) if len(c) > 22 else 0.0,
        score=score,
        rating=rating_for(score),
        trend=trend,
        rsi=round(rsi_v, 1),
        macd_state=macd_state,
        volume_ratio=round(vol_ratio, 2) if vol_ratio else None,
        bias_ma5_pct=round(bias, 2),
        support=round(support, 4),
        resistance=round(resistance, 4),
        entry=entry,
        stop_loss=stop,
        target=target,
        signals=signals,
        risks=risks,
        checklist=checklist,
        fundamentals=data.info,
    )


def index_snapshot(data: StockData, label: str) -> dict:
    c = data.history["Close"]
    return {
        "symbol": data.symbol,
        "label": label,
        "close": round(float(c.iloc[-1]), 2),
        "change_pct": round(_pct(float(c.iloc[-1]), float(c.iloc[-2])), 2),
        "change_1m_pct": round(_pct(float(c.iloc[-1]), float(c.iloc[-22])), 2) if len(c) > 22 else 0.0,
        "above_ma50": bool(len(c) >= 50 and c.iloc[-1] > c.tail(50).mean()),
    }


def to_frame(results: list[Analysis]) -> pd.DataFrame:
    return pd.DataFrame([{
        "Symbol": r.symbol, "Name": r.name, "Market": r.market, "Close": r.close,
        "Chg %": r.change_pct, "1M %": r.change_1m_pct, "Score": r.score,
        "Rating": r.rating, "RSI": r.rsi, "Trend": r.trend,
    } for r in results])
