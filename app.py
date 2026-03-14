from flask import Flask, render_template, jsonify, request, redirect, url_for
from datetime import datetime, timedelta
from typing import List, Tuple

import pandas as pd
import yfinance as yf

app = Flask(__name__)

INDEX_TICKERS = ["QQQ", "SPY"]
UNIVERSE_FILE = "universe.txt"
TOP_N = 15


def load_universe() -> List[str]:
    try:
        with open(UNIVERSE_FILE, "r") as f:
            lines = f.read().splitlines()
    except FileNotFoundError:
        lines = ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "JPM", "JNJ"]
    tickers = {ln.strip().upper() for ln in lines if ln.strip()}
    return sorted(tickers)


def save_universe(tickers: List[str]) -> None:
    cleaned = sorted({t.strip().upper() for t in tickers if t.strip()})
    with open(UNIVERSE_FILE, "w") as f:
        f.write("\n".join(cleaned))


def get_universe() -> List[str]:
    return load_universe()


def parse_dates(start_str: str | None, end_str: str | None) -> Tuple[datetime, datetime]:
    today = datetime.utcnow().date()
    default_end = datetime.combine(today, datetime.min.time())
    default_start = default_end - timedelta(days=7)

    if not end_str:
        end_dt = default_end
    else:
        end_dt = datetime.strptime(end_str, "%Y-%m-%d")

    if not start_str:
        start_dt = default_start
    else:
        start_dt = datetime.strptime(start_str, "%Y-%m-%d")

    if start_dt > end_dt:
        start_dt, end_dt = end_dt, start_dt

    return start_dt, end_dt


def download_price_history(tickers, start_dt, end_dt):
    start = start_dt - timedelta(days=2)
    end = end_dt + timedelta(days=1)

    data = yf.download(
        tickers,
        start=start,
        end=end,
        interval="1d",
        auto_adjust=True,
        progress=False,
        group_by="ticker",
        threads=True,
    )

    prices_stocks = pd.DataFrame()
    for t in tickers:
        if t in data:
            df_t = data[t]
            if "Adj Close" in df_t.columns:
                prices_stocks[t] = df_t["Adj Close"]
            elif "Close" in df_t.columns:
                prices_stocks[t] = df_t["Close"]

    idx_dict = {}
    for idx_ticker in INDEX_TICKERS:
        idx = yf.download(
            idx_ticker,
            start=start,
            end=end,
            interval="1d",
            auto_adjust=True,
            progress=False,
        )
        if "Adj Close" in idx.columns:
            s = idx["Adj Close"]
        else:
            s = idx["Close"]
        s.name = idx_ticker
        idx_dict[idx_ticker] = s

    prices_index = pd.concat(idx_dict.values(), axis=1)

    mask = (prices_stocks.index >= start_dt) & (prices_stocks.index <= end_dt)
    prices_stocks = prices_stocks.loc[mask]
    mask_idx = (prices_index.index >= start_dt) & (prices_index.index <= end_dt)
    prices_index = prices_index.loc[mask_idx]

    # align
    common_idx = prices_stocks.index.intersection(prices_index.index)
    prices_stocks = prices_stocks.loc[common_idx]
    prices_index = prices_index.loc[common_idx]

    # include QQQ and SPY as permanent rows in the stock universe
    for idx_ticker in INDEX_TICKERS:
        if idx_ticker in prices_index.columns and idx_ticker not in prices_stocks.columns:
            prices_stocks[idx_ticker] = prices_index[idx_ticker]

    return prices_stocks, prices_index


def compute_relative_strength(prices_stocks: pd.DataFrame, prices_index: pd.DataFrame):
    if prices_stocks.empty or prices_index.empty:
        return pd.DataFrame()

    qqq_series = prices_index["QQQ"].ffill()
    qqq_start = qqq_series.iloc[0]
    qqq_end = qqq_series.iloc[-1]
    index_return = (qqq_end / qqq_start) - 1

    prices_ffill = prices_stocks.ffill()
    start_prices = prices_ffill.iloc[0]
    end_prices = prices_ffill.iloc[-1]

    stock_returns = (end_prices / start_prices) - 1
    rs_values = (1.0 + stock_returns) / (1.0 + index_return) - 1.0
    pct_change_vs_index = stock_returns - index_return

    tickers = prices_stocks.columns.astype(str)

    rs_df = pd.DataFrame(
        {
            "Ticker": tickers,
            "OpenPrice": start_prices.values,
            "ClosePrice": end_prices.values,
            "RS": rs_values.values,
            "StockReturn": stock_returns.values,
            "PctChangeVsIndex": pct_change_vs_index.values,
        }
    ).set_index("Ticker")

    rs_df = rs_df.sort_values("RS", ascending=False)
    return rs_df


@app.route("/")
def index():
    today = datetime.utcnow().date()
    end_str = today.strftime("%Y-%m-%d")
    start_str = (today - timedelta(days=7)).strftime("%Y-%m-%d")
    return render_template(
        "index.html",
        default_start_date=start_str,
        default_end_date=end_str,
    )


@app.route("/universe", methods=["GET", "POST"])
def universe():
    if request.method == "POST":
        text = request.form.get("tickers", "")
        tickers = text.replace(",", "\n").splitlines()
        save_universe(tickers)
        return redirect(url_for("universe"))

    current = "\n".join(load_universe())
    return render_template("universe.html", tickers_text=current)


@app.route("/api/data")
def api_data():
    start_str = request.args.get("start_date")
    end_str = request.args.get("end_date")

    start_dt, end_dt = parse_dates(start_str, end_str)

    try:
        tickers = get_universe()
        prices_stocks, prices_index = download_price_history(
            tickers, start_dt, end_dt
        )
        rs_df = compute_relative_strength(prices_stocks, prices_index)
    except Exception as e:
        import traceback

        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

    if rs_df is None or rs_df.empty:
        return jsonify(
            {
                "start_date": start_dt.strftime("%Y-%m-%d"),
                "end_date": end_dt.strftime("%Y-%m-%d"),
                "rs_table": [],
                "index": {"dates": [], "QQQ": [], "SPY": []},
                "price_history": {},
            }
        )

    qqq_series = prices_index["QQQ"].ffill()
    spy_series = prices_index["SPY"].ffill()
    index_data = {
        "dates": qqq_series.index.strftime("%Y-%m-%d").tolist(),
        "QQQ": qqq_series.values.tolist(),
        "SPY": spy_series.values.tolist(),
    }

    rs_reset = rs_df.reset_index()
    rs_reset = rs_reset.sort_values("RS", ascending=False)

    qqq_start = qqq_series.iloc[0]
    qqq_end = qqq_series.iloc[-1]
    spy_start = spy_series.iloc[0]
    spy_end = spy_series.iloc[-1]
    qqq_ret = (qqq_end / qqq_start) - 1
    spy_ret = (spy_end / spy_start) - 1

    stock_ret_series = rs_df["StockReturn"]
    rs_reset["PctVsQQQ"] = stock_ret_series.values - qqq_ret
    rs_reset["PctVsSPY"] = stock_ret_series.values - spy_ret

    for col in [
        "RS",
        "StockReturn",
        "PctChangeVsIndex",
        "PctVsQQQ",
        "PctVsSPY",
    ]:
        rs_reset[col] = rs_reset[col].round(4)
    rs_reset["OpenPrice"] = rs_reset["OpenPrice"].round(2)
    rs_reset["ClosePrice"] = rs_reset["ClosePrice"].round(2)

    price_history = {}
    for ticker in rs_reset["Ticker"]:
        if ticker not in prices_stocks.columns:
            continue
        series = prices_stocks[ticker].ffill()
        price_history[ticker] = {
            "dates": series.index.strftime("%Y-%m-%d").tolist(),
            "values": series.values.tolist(),
        }

    return jsonify(
        {
            "start_date": start_dt.strftime("%Y-%m-%d"),
            "end_date": end_dt.strftime("%Y-%m-%d"),
            "rs_table": rs_reset.to_dict(orient="records"),
            "index": index_data,
            "price_history": price_history,
        }
    )


if __name__ == "__main__":
    app.run(debug=True)
