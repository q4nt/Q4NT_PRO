"""
backtest_engine.py  --  AI-Powered Strategy Backtesting Engine
Parses natural-language strategies via OpenAI, runs walk-forward simulations
on mock OHLCV data, and returns equity curves + trade lists.
"""

import os
import json
import math
import random
import asyncio
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

# ---------------------------------------------------------------------------
# 1.  MOCK OHLCV DATA GENERATOR
# ---------------------------------------------------------------------------

def generate_mock_ohlcv(days: int = 90, start_price: float = 150.0,
                        ticker: str = "MOCK", seed: Optional[int] = None) -> List[Dict]:
    """
    Geometric Brownian Motion with intraday high/low noise.
    Returns [{date, open, high, low, close, volume}, ...]
    """
    if seed is not None:
        random.seed(seed)

    data = []
    price = start_price
    dt = 1 / 252               # ~1 trading day
    mu = 0.08                   # annualised drift  8 %
    sigma = 0.22                # annualised vol   22 %
    base_vol = 15_000_000

    today = datetime.utcnow().date()
    start_date = today - timedelta(days=int(days * 1.45))  # ~1.45x to skip weekends

    current = start_date
    bars_generated = 0
    while bars_generated < days:
        # skip weekends
        if current.weekday() >= 5:
            current += timedelta(days=1)
            continue

        o = price
        # GBM step
        z = random.gauss(0, 1)
        price = price * math.exp((mu - 0.5 * sigma ** 2) * dt + sigma * math.sqrt(dt) * z)
        c = round(price, 2)
        o = round(o, 2)

        intraday_range = abs(c - o) + random.uniform(0.3, 2.5)
        h = round(max(o, c) + random.uniform(0.05, intraday_range * 0.6), 2)
        l = round(min(o, c) - random.uniform(0.05, intraday_range * 0.6), 2)
        if l <= 0:
            l = round(min(o, c) * 0.995, 2)

        vol = int(base_vol * random.uniform(0.4, 2.2))

        data.append({
            "date": current.isoformat(),
            "open": o,
            "high": h,
            "low": l,
            "close": c,
            "volume": vol,
        })
        bars_generated += 1
        current += timedelta(days=1)

    return data


# ---------------------------------------------------------------------------
# 2.  INDICATOR LIBRARY  (pure Python, no numpy/pandas dependency)
# ---------------------------------------------------------------------------

def _ema(closes: List[float], period: int) -> List[Optional[float]]:
    result = [None] * len(closes)
    if len(closes) < period:
        return result
    k = 2.0 / (period + 1)
    # seed with SMA
    result[period - 1] = sum(closes[:period]) / period
    for i in range(period, len(closes)):
        result[i] = closes[i] * k + result[i - 1] * (1 - k)
    return result


def _sma(closes: List[float], period: int) -> List[Optional[float]]:
    result = [None] * len(closes)
    if len(closes) < period:
        return result
    running = sum(closes[:period])
    result[period - 1] = running / period
    for i in range(period, len(closes)):
        running += closes[i] - closes[i - period]
        result[i] = running / period
    return result


def _rsi(closes: List[float], period: int = 14) -> List[Optional[float]]:
    result = [None] * len(closes)
    if len(closes) < period + 1:
        return result
    gains = []
    losses = []
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0))
        losses.append(max(-d, 0))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        result[period] = 100.0
    else:
        rs = avg_gain / avg_loss
        result[period] = 100 - 100 / (1 + rs)
    for i in range(period + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        g = max(d, 0)
        l = max(-d, 0)
        avg_gain = (avg_gain * (period - 1) + g) / period
        avg_loss = (avg_loss * (period - 1) + l) / period
        if avg_loss == 0:
            result[i] = 100.0
        else:
            rs = avg_gain / avg_loss
            result[i] = 100 - 100 / (1 + rs)
    return result


def _macd(closes: List[float], fast: int = 12, slow: int = 26, signal: int = 9):
    """Returns (macd_line, signal_line, histogram)  -- all same length as closes."""
    ema_fast = _ema(closes, fast)
    ema_slow = _ema(closes, slow)
    n = len(closes)
    macd_line = [None] * n
    for i in range(n):
        if ema_fast[i] is not None and ema_slow[i] is not None:
            macd_line[i] = ema_fast[i] - ema_slow[i]

    # signal line = EMA of macd_line
    macd_vals = [v if v is not None else 0 for v in macd_line]
    sig = _ema(macd_vals, signal)
    # only valid after slow + signal - 1
    start = slow + signal - 2
    signal_line = [None] * n
    histogram = [None] * n
    for i in range(start, n):
        if macd_line[i] is not None and sig[i] is not None:
            signal_line[i] = sig[i]
            histogram[i] = macd_line[i] - sig[i]
    return macd_line, signal_line, histogram


def _bollinger(closes: List[float], period: int = 20, num_std: float = 2.0):
    """Returns (upper, middle, lower, bandwidth) lists."""
    n = len(closes)
    upper = [None] * n
    middle = [None] * n
    lower = [None] * n
    bandwidth = [None] * n
    sma = _sma(closes, period)
    for i in range(period - 1, n):
        m = sma[i]
        if m is None:
            continue
        window = closes[i - period + 1:i + 1]
        std = (sum((x - m) ** 2 for x in window) / period) ** 0.5
        upper[i] = m + num_std * std
        middle[i] = m
        lower[i] = m - num_std * std
        bandwidth[i] = (upper[i] - lower[i]) / m if m != 0 else 0
    return upper, middle, lower, bandwidth


def _atr(highs: List[float], lows: List[float], closes: List[float], period: int = 14) -> List[Optional[float]]:
    n = len(closes)
    result = [None] * n
    if n < 2:
        return result
    trs = [highs[0] - lows[0]]
    for i in range(1, n):
        tr = max(highs[i] - lows[i],
                 abs(highs[i] - closes[i - 1]),
                 abs(lows[i] - closes[i - 1]))
        trs.append(tr)
    if len(trs) < period:
        return result
    atr_val = sum(trs[:period]) / period
    result[period - 1] = atr_val
    for i in range(period, n):
        atr_val = (atr_val * (period - 1) + trs[i]) / period
        result[i] = atr_val
    return result


def _stochastic(highs: List[float], lows: List[float], closes: List[float],
                k_period: int = 14, d_period: int = 3):
    n = len(closes)
    k_vals = [None] * n
    for i in range(k_period - 1, n):
        window_h = highs[i - k_period + 1:i + 1]
        window_l = lows[i - k_period + 1:i + 1]
        hh = max(window_h)
        ll = min(window_l)
        if hh == ll:
            k_vals[i] = 50.0
        else:
            k_vals[i] = ((closes[i] - ll) / (hh - ll)) * 100
    # %D = SMA of %K
    d_vals = [None] * n
    for i in range(k_period - 1 + d_period - 1, n):
        window = [k_vals[j] for j in range(i - d_period + 1, i + 1) if k_vals[j] is not None]
        if len(window) == d_period:
            d_vals[i] = sum(window) / d_period
    return k_vals, d_vals


def compute_indicators(ohlcv: List[Dict], indicator_specs: List[Dict]) -> Dict[str, List]:
    """
    Compute all requested indicators and return a dict of named arrays.
    Each indicator_spec: {"type": "ema", "period": 21}
    """
    closes = [bar["close"] for bar in ohlcv]
    highs = [bar["high"] for bar in ohlcv]
    lows = [bar["low"] for bar in ohlcv]
    result = {"close": closes}

    for spec in indicator_specs:
        t = spec.get("type", "").lower()
        p = spec.get("period", 14)

        if t == "ema":
            result[f"ema_{p}"] = _ema(closes, p)
        elif t == "sma":
            result[f"sma_{p}"] = _sma(closes, p)
        elif t == "rsi":
            result[f"rsi_{p}"] = _rsi(closes, p)
        elif t == "macd":
            fast = spec.get("fast", 12)
            slow = spec.get("slow", 26)
            sig = spec.get("signal", 9)
            ml, sl, hist = _macd(closes, fast, slow, sig)
            result["macd_line"] = ml
            result["macd_signal"] = sl
            result["macd_histogram"] = hist
        elif t == "bollinger":
            bp = spec.get("period", 20)
            std = spec.get("std", 2.0)
            u, m, lo, bw = _bollinger(closes, bp, std)
            result["bb_upper"] = u
            result["bb_middle"] = m
            result["bb_lower"] = lo
            result["bb_bandwidth"] = bw
        elif t == "atr":
            result[f"atr_{p}"] = _atr(highs, lows, closes, p)
        elif t == "stochastic":
            kp = spec.get("k_period", 14)
            dp = spec.get("d_period", 3)
            k, d = _stochastic(highs, lows, closes, kp, dp)
            result["stoch_k"] = k
            result["stoch_d"] = d

    return result


# ---------------------------------------------------------------------------
# 3.  SIGNAL ENGINE
# ---------------------------------------------------------------------------

def _safe_eval_condition(condition: str, indicators: Dict[str, List], idx: int) -> bool:
    """
    Evaluate a simple condition string like 'ema_5 > ema_21' at bar index idx.
    Supports: >, <, >=, <=, ==, crosses_above, crosses_below, and/or.
    """
    if not condition or condition.strip().lower() in ("null", "none", ""):
        return False

    cond = condition.strip().lower()

    # Handle 'and' / 'or' compound conditions
    if " and " in cond:
        parts = cond.split(" and ")
        return all(_safe_eval_condition(p.strip(), indicators, idx) for p in parts)
    if " or " in cond:
        parts = cond.split(" or ")
        return any(_safe_eval_condition(p.strip(), indicators, idx) for p in parts)

    # Handle 'crosses_above' / 'crosses_below'
    if "crosses_above" in cond:
        parts = cond.split("crosses_above")
        a_name = parts[0].strip()
        b_name = parts[1].strip()
        a_vals = indicators.get(a_name)
        b_vals = indicators.get(b_name)
        if not a_vals or not b_vals or idx < 1:
            return False
        if a_vals[idx] is None or b_vals[idx] is None or a_vals[idx-1] is None or b_vals[idx-1] is None:
            return False
        return a_vals[idx-1] <= b_vals[idx-1] and a_vals[idx] > b_vals[idx]

    if "crosses_below" in cond:
        parts = cond.split("crosses_below")
        a_name = parts[0].strip()
        b_name = parts[1].strip()
        a_vals = indicators.get(a_name)
        b_vals = indicators.get(b_name)
        if not a_vals or not b_vals or idx < 1:
            return False
        if a_vals[idx] is None or b_vals[idx] is None or a_vals[idx-1] is None or b_vals[idx-1] is None:
            return False
        return a_vals[idx-1] >= b_vals[idx-1] and a_vals[idx] < b_vals[idx]

    # Handle comparison operators
    for op_str, op_fn in [(">=", lambda a, b: a >= b),
                          ("<=", lambda a, b: a <= b),
                          (">", lambda a, b: a > b),
                          ("<", lambda a, b: a < b),
                          ("==", lambda a, b: abs(a - b) < 0.0001)]:
        if op_str in cond:
            parts = cond.split(op_str, 1)
            a_token = parts[0].strip()
            b_token = parts[1].strip()

            def _resolve(token):
                # Try as a number first
                try:
                    return float(token)
                except ValueError:
                    pass
                # Try as indicator name
                vals = indicators.get(token)
                if vals and idx < len(vals) and vals[idx] is not None:
                    return vals[idx]
                return None

            a_val = _resolve(a_token)
            b_val = _resolve(b_token)
            if a_val is None or b_val is None:
                return False
            return op_fn(a_val, b_val)

    return False


# ---------------------------------------------------------------------------
# 4.  WALK-FORWARD BACKTESTER
# ---------------------------------------------------------------------------

def run_backtest_engine(ohlcv: List[Dict], strategy: Dict) -> Dict[str, Any]:
    """
    Walk-forward backtest.  strategy dict has:
      indicators, entry_long, exit_long, entry_short, exit_short,
      stop_loss_pct, stop_gain_pct, trailing_stop_pct, position_size_pct, max_roe_pct
    """
    n = len(ohlcv)
    if n < 5:
        return {"error": "Not enough data"}

    # Compute indicators
    ind_specs = strategy.get("indicators", [])
    indicators = compute_indicators(ohlcv, ind_specs)

    entry_long = strategy.get("entry_long", "")
    exit_long = strategy.get("exit_long", "")
    stop_loss_pct = strategy.get("stop_loss_pct")
    stop_gain_pct = strategy.get("stop_gain_pct")
    trailing_stop_pct = strategy.get("trailing_stop_pct")
    position_size_pct = strategy.get("position_size_pct", 100)

    # State
    initial_capital = 10000.0
    capital = initial_capital
    position = None   # {entry_price, entry_idx, entry_date, size, stop_loss, stop_gain, peak_price}
    trades = []
    equity_curve = []

    for i in range(n):
        bar = ohlcv[i]
        close = bar["close"]

        # Check stop loss / stop gain / trailing stop if in position
        if position is not None:
            exit_reason = None
            exit_price = close

            # Update peak for trailing stop
            if close > position["peak_price"]:
                position["peak_price"] = close

            # Stop loss
            if stop_loss_pct and position["stop_loss"] is not None:
                if bar["low"] <= position["stop_loss"]:
                    exit_price = position["stop_loss"]
                    exit_reason = "stop_loss"

            # Stop gain / take profit
            if not exit_reason and stop_gain_pct and position["stop_gain"] is not None:
                if bar["high"] >= position["stop_gain"]:
                    exit_price = position["stop_gain"]
                    exit_reason = "stop_gain"

            # Trailing stop
            if not exit_reason and trailing_stop_pct:
                trail_price = position["peak_price"] * (1 - trailing_stop_pct / 100)
                if bar["low"] <= trail_price:
                    exit_price = round(trail_price, 2)
                    exit_reason = "trailing_stop"

            # Signal-based exit
            if not exit_reason and exit_long:
                if _safe_eval_condition(exit_long, indicators, i):
                    exit_price = close
                    exit_reason = "signal"

            if exit_reason:
                pnl = (exit_price - position["entry_price"]) * position["size"]
                pnl_pct = ((exit_price / position["entry_price"]) - 1) * 100
                capital += position["entry_price"] * position["size"] + pnl
                trades.append({
                    "entry_date": position["entry_date"],
                    "exit_date": bar["date"],
                    "entry_idx": position["entry_idx"],
                    "exit_idx": i,
                    "side": "long",
                    "entry_price": round(position["entry_price"], 2),
                    "exit_price": round(exit_price, 2),
                    "stop_loss": round(position["stop_loss"], 2) if position["stop_loss"] else None,
                    "stop_gain": round(position["stop_gain"], 2) if position["stop_gain"] else None,
                    "pnl": round(pnl, 2),
                    "pnl_pct": round(pnl_pct, 2),
                    "exit_reason": exit_reason,
                    "duration_days": (i - position["entry_idx"]),
                })
                position = None

        # Check entry if not in position
        if position is None and entry_long:
            if _safe_eval_condition(entry_long, indicators, i):
                alloc = capital * (position_size_pct / 100)
                size = alloc / close
                sl_price = round(close * (1 - (stop_loss_pct or 100) / 100), 2) if stop_loss_pct else None
                sg_price = round(close * (1 + (stop_gain_pct or 1000) / 100), 2) if stop_gain_pct else None
                position = {
                    "entry_price": close,
                    "entry_idx": i,
                    "entry_date": bar["date"],
                    "size": size,
                    "stop_loss": sl_price,
                    "stop_gain": sg_price,
                    "peak_price": close,
                }
                capital -= alloc

        # Record equity
        if position is not None:
            mark = capital + position["size"] * close
        else:
            mark = capital
        equity_curve.append({
            "date": bar["date"],
            "equity": round(mark, 2),
            "benchmark": round(initial_capital * (close / ohlcv[0]["close"]), 2),
        })

    # Force-close any open position at end
    if position is not None:
        close = ohlcv[-1]["close"]
        pnl = (close - position["entry_price"]) * position["size"]
        pnl_pct = ((close / position["entry_price"]) - 1) * 100
        trades.append({
            "entry_date": position["entry_date"],
            "exit_date": ohlcv[-1]["date"],
            "entry_idx": position["entry_idx"],
            "exit_idx": n - 1,
            "side": "long",
            "entry_price": round(position["entry_price"], 2),
            "exit_price": round(close, 2),
            "stop_loss": round(position["stop_loss"], 2) if position["stop_loss"] else None,
            "stop_gain": round(position["stop_gain"], 2) if position["stop_gain"] else None,
            "pnl": round(pnl, 2),
            "pnl_pct": round(pnl_pct, 2),
            "exit_reason": "end_of_data",
            "duration_days": (n - 1 - position["entry_idx"]),
        })

    # Compute stats
    stats = _compute_stats(equity_curve, trades, initial_capital)

    # Add drawdown to equity curve
    peak = initial_capital
    for pt in equity_curve:
        if pt["equity"] > peak:
            peak = pt["equity"]
        pt["drawdown"] = round(((pt["equity"] - peak) / peak) * 100, 2)

    return {
        "stats": stats,
        "equity_curve": equity_curve,
        "trades": trades,
        "ohlcv": ohlcv,
    }


def _compute_stats(equity_curve: List[Dict], trades: List[Dict], initial_capital: float) -> Dict:
    if not equity_curve:
        return {}

    final_equity = equity_curve[-1]["equity"]
    total_return = ((final_equity / initial_capital) - 1) * 100

    # Drawdown
    peak = initial_capital
    max_dd = 0
    for pt in equity_curve:
        if pt["equity"] > peak:
            peak = pt["equity"]
        dd = (pt["equity"] - peak) / peak * 100
        if dd < max_dd:
            max_dd = dd

    # Trade stats
    total_trades = len(trades)
    if total_trades == 0:
        return {
            "total_return_pct": round(total_return, 2),
            "total_trades": 0,
            "win_rate_pct": 0,
            "max_drawdown_pct": round(max_dd, 2),
            "sharpe_ratio": 0,
            "profit_factor": 0,
            "avg_win_pct": 0,
            "avg_loss_pct": 0,
            "avg_duration_days": 0,
            "final_equity": round(final_equity, 2),
        }

    winners = [t for t in trades if t["pnl"] > 0]
    losers = [t for t in trades if t["pnl"] <= 0]
    win_rate = len(winners) / total_trades * 100

    gross_profit = sum(t["pnl"] for t in winners) if winners else 0
    gross_loss = abs(sum(t["pnl"] for t in losers)) if losers else 0.001
    profit_factor = gross_profit / gross_loss

    avg_win = sum(t["pnl_pct"] for t in winners) / len(winners) if winners else 0
    avg_loss = sum(t["pnl_pct"] for t in losers) / len(losers) if losers else 0
    avg_dur = sum(t["duration_days"] for t in trades) / total_trades

    # Simple Sharpe (daily returns)
    daily_returns = []
    for i in range(1, len(equity_curve)):
        prev = equity_curve[i - 1]["equity"]
        curr = equity_curve[i]["equity"]
        if prev > 0:
            daily_returns.append((curr - prev) / prev)
    if daily_returns and len(daily_returns) > 1:
        mean_r = sum(daily_returns) / len(daily_returns)
        std_r = (sum((r - mean_r) ** 2 for r in daily_returns) / (len(daily_returns) - 1)) ** 0.5
        sharpe = (mean_r / std_r * (252 ** 0.5)) if std_r > 0 else 0
    else:
        sharpe = 0

    return {
        "total_return_pct": round(total_return, 2),
        "total_trades": total_trades,
        "win_rate_pct": round(win_rate, 1),
        "max_drawdown_pct": round(max_dd, 2),
        "sharpe_ratio": round(sharpe, 2),
        "profit_factor": round(profit_factor, 2),
        "avg_win_pct": round(avg_win, 2),
        "avg_loss_pct": round(avg_loss, 2),
        "avg_duration_days": round(avg_dur, 1),
        "final_equity": round(final_equity, 2),
    }


# ---------------------------------------------------------------------------
# 5.  OPENAI STRATEGY PARSER
# ---------------------------------------------------------------------------

STRATEGY_PARSE_PROMPT = """You are a trading strategy parser. Convert the user's natural language strategy description into a structured JSON object.

Return ONLY valid JSON with this exact schema (no markdown, no explanation):
{
  "name": "short descriptive name",
  "indicators": [
    {"type": "ema|sma|rsi|macd|bollinger|atr|stochastic", "period": 14}
  ],
  "entry_long": "condition string using indicator names like ema_5 > ema_21 or ema_5 crosses_above ema_21",
  "exit_long": "condition string or null",
  "stop_loss_pct": number or null,
  "stop_gain_pct": number or null,
  "trailing_stop_pct": number or null,
  "position_size_pct": 100,
  "max_roe_pct": number or null
}

RULES for condition strings:
- Use indicator_period format: ema_5, sma_200, rsi_14
- Operators: >, <, >=, <=, crosses_above, crosses_below
- Combine with: and, or
- For RSI: use rsi_14 > 70 or rsi_14 < 30
- For MACD: use macd_line crosses_above macd_signal
- For Bollinger: use close > bb_upper or close < bb_lower
- For Stochastic: use stoch_k < 20 or stoch_k > 80
- Numbers are bare: rsi_14 > 70 (not rsi_14 > "70")

Examples:
"EMA 5 > EMA 21" -> entry_long: "ema_5 > ema_21", exit_long: "ema_5 < ema_21"
"RSI below 30 buy, above 70 sell" -> entry_long: "rsi_14 < 30", exit_long: "rsi_14 > 70"
"MACD cross with 2% stop loss" -> entry_long: "macd_line crosses_above macd_signal", stop_loss_pct: 2.0
"""


async def parse_strategy_with_openai(strategy_text: str) -> Dict[str, Any]:
    """Use OpenAI to parse natural language strategy into structured params."""
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        # Fallback: simple regex-based parser
        return _fallback_parse(strategy_text)

    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=api_key, timeout=30)

        resp = await client.chat.completions.create(
            model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": STRATEGY_PARSE_PROMPT},
                {"role": "user", "content": strategy_text}
            ],
            max_completion_tokens=600,
        )

        content = resp.choices[0].message.content.strip()
        # Strip markdown code fences if present
        if content.startswith("```"):
            content = content.split("\n", 1)[1] if "\n" in content else content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()

        parsed = json.loads(content)
        return parsed

    except Exception as e:
        print(f"[BacktestEngine] OpenAI parse error: {e}, using fallback")
        return _fallback_parse(strategy_text)


def _fallback_parse(text: str) -> Dict[str, Any]:
    """Simple regex-based fallback parser for common strategy patterns."""
    import re
    text_lower = text.lower()

    indicators = []
    entry_long = ""
    exit_long = ""
    stop_loss = None
    stop_gain = None
    trailing_stop = None
    name = "Custom Strategy"

    # EMA crossover pattern
    ema_match = re.findall(r'ema\s*(\d+)', text_lower)
    if len(ema_match) >= 2:
        a, b = int(ema_match[0]), int(ema_match[1])
        indicators.append({"type": "ema", "period": a})
        indicators.append({"type": "ema", "period": b})
        entry_long = f"ema_{a} crosses_above ema_{b}"
        exit_long = f"ema_{a} crosses_below ema_{b}"
        name = f"EMA {a}/{b} Crossover"

    # SMA crossover pattern
    sma_match = re.findall(r'sma\s*(\d+)', text_lower)
    if len(sma_match) >= 2 and not ema_match:
        a, b = int(sma_match[0]), int(sma_match[1])
        indicators.append({"type": "sma", "period": a})
        indicators.append({"type": "sma", "period": b})
        entry_long = f"sma_{a} crosses_above sma_{b}"
        exit_long = f"sma_{a} crosses_below sma_{b}"
        name = f"SMA {a}/{b} Crossover"

    # Combined SMA + RSI pattern (e.g. "SMA 20 > SMA 50, RSI > 50")
    if sma_match and 'rsi' in text_lower and len(sma_match) >= 2:
        a, b = int(sma_match[0]), int(sma_match[1])
        rp = 14
        rsi_per = re.search(r'rsi\s*(\d+)', text_lower)
        if rsi_per:
            rp = int(rsi_per.group(1))
        indicators = [{"type": "sma", "period": a}, {"type": "sma", "period": b}, {"type": "rsi", "period": rp}]
        rsi_thresh = 50
        rsi_th_match = re.search(r'rsi\s*(?:\d+\s*)?(?:>|above)\s*(\d+)', text_lower)
        if rsi_th_match:
            rsi_thresh = int(rsi_th_match.group(1))
        entry_long = f"sma_{a} > sma_{b} and rsi_{rp} > {rsi_thresh}"
        exit_long = f"sma_{a} < sma_{b}"
        name = f"SMA {a}/{b} + RSI {rp} Combined"

    # RSI pattern (standalone)
    if 'rsi' in text_lower and not entry_long:
        period = 14
        rsi_period = re.search(r'rsi\s*(\d+)', text_lower)
        if rsi_period:
            period = int(rsi_period.group(1))
        indicators.append({"type": "rsi", "period": period})
        entry_long = f"rsi_{period} < 30"
        exit_long = f"rsi_{period} > 70"
        name = f"RSI {period} Overbought/Oversold"

    # MACD pattern
    if 'macd' in text_lower and not entry_long:
        indicators.append({"type": "macd"})
        entry_long = "macd_line crosses_above macd_signal"
        exit_long = "macd_line crosses_below macd_signal"
        name = "MACD Signal Cross"

    # Bollinger pattern
    if 'bollinger' in text_lower and not entry_long:
        indicators.append({"type": "bollinger", "period": 20})
        entry_long = "close < bb_lower"
        exit_long = "close > bb_upper"
        name = "Bollinger Band Reversion"

    # Stochastic pattern
    if 'stochastic' in text_lower and not entry_long:
        indicators.append({"type": "stochastic", "k_period": 14, "d_period": 3})
        entry_long = "stoch_k < 20"
        exit_long = "stoch_k > 80"
        name = "Stochastic Overbought/Oversold"

    # Stop loss
    sl_match = re.search(r'(?:stop\s*loss|sl)\s*[:\s]*(\d+(?:\.\d+)?)\s*%?', text_lower)
    if sl_match:
        stop_loss = float(sl_match.group(1))

    # Stop gain / take profit
    sg_match = re.search(r'(?:stop\s*gain|take\s*profit|tp|target)\s*[:\s]*(\d+(?:\.\d+)?)\s*%?', text_lower)
    if sg_match:
        stop_gain = float(sg_match.group(1))

    # Trailing stop
    ts_match = re.search(r'trailing\s*(?:stop)?\s*[:\s]*(\d+(?:\.\d+)?)\s*%?', text_lower)
    if ts_match:
        trailing_stop = float(ts_match.group(1))

    # Default if nothing matched
    if not indicators:
        indicators = [{"type": "ema", "period": 9}, {"type": "ema", "period": 21}]
        entry_long = "ema_9 crosses_above ema_21"
        exit_long = "ema_9 crosses_below ema_21"
        name = "EMA 9/21 Crossover (default)"

    return {
        "name": name,
        "indicators": indicators,
        "entry_long": entry_long,
        "exit_long": exit_long,
        "stop_loss_pct": stop_loss,
        "stop_gain_pct": stop_gain,
        "trailing_stop_pct": trailing_stop,
        "position_size_pct": 100,
        "max_roe_pct": None,
    }


# ---------------------------------------------------------------------------
# 6.  MAIN ENTRY POINT
# ---------------------------------------------------------------------------

async def run_backtest(strategy_text: str, ticker: str = "MOCK",
                       days: int = 90) -> Dict[str, Any]:
    """
    Full pipeline: parse strategy -> generate data -> run backtest -> return results.
    """
    # Parse strategy with OpenAI (or fallback)
    strategy = await parse_strategy_with_openai(strategy_text)

    # Generate mock data
    ohlcv = generate_mock_ohlcv(days=days, ticker=ticker, seed=hash(strategy_text) % (2**31))

    # Run the backtest
    result = run_backtest_engine(ohlcv, strategy)

    # Attach metadata
    result["strategy_name"] = strategy.get("name", "Custom Strategy")
    result["strategy_text"] = strategy_text
    result["strategy_params"] = strategy
    result["ticker"] = ticker
    result["days"] = days

    return result
