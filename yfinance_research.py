import json
import math
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

import yfinance as yf


INDEX_TICKERS = {
    "NIFTY": ("^NSEI", "NIFTY 50"),
    "BANKNIFTY": ("^NSEBANK", "NIFTY BANK"),
    "NIFTYIT": ("^CNXIT", "NIFTY IT"),
    "NIFTYMIDCAP": ("NIFTYMIDCAP150.NS", "NIFTY MIDCAP 150"),
    "SENSEX": ("^BSESN", "BSE SENSEX"),
}

GLOBAL_TICKERS = {
    "USDINR": "INR=X",
    "BZUSD": "BZ=F",
    "GOLD": "GC=F",
    "SILVER": "SI=F",
}


def number(value):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def resolve_symbol(request):
    raw_symbol = str(request.get("symbol", "")).strip().upper()
    if not raw_symbol:
        return None

    exchange = request.get("exchange", "NSE")
    if raw_symbol in INDEX_TICKERS:
        yahoo_symbol, label = INDEX_TICKERS[raw_symbol]
        return raw_symbol, yahoo_symbol, "benchmark", label

    if raw_symbol in GLOBAL_TICKERS:
        return raw_symbol, GLOBAL_TICKERS[raw_symbol], "global", raw_symbol

    if raw_symbol.startswith("GLOBAL:"):
        ticker = raw_symbol.split(":", 1)[1]
        if ticker in GLOBAL_TICKERS:
            return ticker, GLOBAL_TICKERS[ticker], "global", ticker
        return None

    if "." in raw_symbol or raw_symbol.startswith("^") or "=" in raw_symbol:
        return raw_symbol, raw_symbol, "equity", raw_symbol

    return raw_symbol, f"{raw_symbol}.{'BO' if exchange == 'BSE' else 'NS'}", "equity", raw_symbol


def fetch_quote(request):
    resolved = resolve_symbol(request)
    if not resolved:
        return None

    app_symbol, yahoo_symbol, market_type, label = resolved
    ticker = yf.Ticker(yahoo_symbol)
    history = ticker.history(period="5d", interval="1m", auto_adjust=False, actions=False, timeout=15)
    if history.empty:
        history = ticker.history(period="5d", interval="1d", auto_adjust=False, actions=False, timeout=15)
    if history.empty or "Close" not in history:
        return None

    history = history.dropna(subset=["Close"])
    if history.empty:
        return None

    last_index = history.index[-1]
    latest = history.iloc[-1]
    same_session = history[history.index.date == last_index.date()]
    previous_sessions = history[history.index.date < last_index.date()]
    previous_close = number(previous_sessions["Close"].iloc[-1]) if not previous_sessions.empty else None
    price = number(latest.get("Close"))
    if not price or price <= 0:
        return None

    change = price - previous_close if previous_close else None
    change_percent = (change / previous_close * 100) if previous_close and change is not None else None
    timestamp = int(last_index.timestamp())
    return {
        "symbol": app_symbol,
        "yahooSymbol": yahoo_symbol,
        "marketType": market_type,
        "label": label,
        "c": price,
        "d": change,
        "dp": change_percent,
        "pc": previous_close,
        "o": number(same_session["Open"].iloc[0]) if "Open" in same_session and not same_session.empty else None,
        "h": number(same_session["High"].max()) if "High" in same_session and not same_session.empty else None,
        "l": number(same_session["Low"].min()) if "Low" in same_session and not same_session.empty else None,
        "v": number(same_session["Volume"].sum()) if "Volume" in same_session else None,
        "timestamp": timestamp,
    }


def fetch_history(request):
    resolved = resolve_symbol(request)
    if not resolved:
        return None

    app_symbol, yahoo_symbol, _, _ = resolved
    interval = {
        "1m": "1m",
        "5m": "5m",
        "15m": "15m",
        "30m": "30m",
        "1h": "60m",
        "1d": "1d",
        "D": "1d",
        "1w": "1wk",
        "W": "1wk",
        "1M": "1mo",
        "M": "1mo",
    }.get(str(request.get("interval", "1d")))
    if not interval:
        return None

    ticker = yf.Ticker(yahoo_symbol)
    history_args = {
        "interval": interval,
        "auto_adjust": False,
        "actions": False,
        "timeout": 25,
    }
    if request.get("all"):
        history_args["period"] = "max"
    else:
        history_args["start"] = request.get("start")
        history_args["end"] = request.get("end")

    history = ticker.history(**history_args)
    if history.empty or not {"Open", "High", "Low", "Close"}.issubset(history.columns):
        return {"symbol": app_symbol, "candles": []}

    history = history.dropna(subset=["Open", "High", "Low", "Close"])
    candles = []
    for candle_time, row in history.iterrows():
        timestamp = candle_time
        if getattr(timestamp, "tzinfo", None) is None:
            timestamp = timestamp.tz_localize("Asia/Kolkata")
        values = {
            "time": int(timestamp.timestamp()),
            "open": number(row.get("Open")),
            "high": number(row.get("High")),
            "low": number(row.get("Low")),
            "close": number(row.get("Close")),
            "value": number(row.get("Volume")),
        }
        if all(values[key] is not None and values[key] > 0 for key in ("open", "high", "low", "close")):
            candles.append(values)

    return {"symbol": app_symbol, "candles": candles}


def main():
    requests = json.loads(sys.argv[1]) if len(sys.argv) > 1 else []
    if not isinstance(requests, list) or len(requests) > 100:
        raise ValueError("Provide at most 100 quote requests as a JSON array.")

    quotes = {}
    histories = {}
    # yfinance's local cookie database can lock when independent ticker requests
    # run concurrently in one process, so keep this worker sequential.
    with ThreadPoolExecutor(max_workers=1) as executor:
        futures = {
            executor.submit(fetch_history if request.get("kind") == "history" else fetch_quote, request): request
            for request in requests
        }
        for future in as_completed(futures):
            request = futures[future]
            try:
                result = future.result()
                if request.get("kind") == "history":
                    if result:
                        histories[result["symbol"]] = result["candles"]
                elif result:
                    quotes[result["symbol"]] = result
            except Exception as error:
                kind = "history" if request.get("kind") == "history" else "quote"
                print(f"yfinance {kind} failed for {request.get('symbol', 'unknown')}: {error}", file=sys.stderr)

    print(json.dumps({"quotes": quotes, "histories": histories}, allow_nan=False))


if __name__ == "__main__":
    main()
