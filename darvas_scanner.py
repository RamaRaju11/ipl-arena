
import io
import time
from pathlib import Path
from datetime import datetime

import numpy as np
import pandas as pd
import requests
import yfinance as yf
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
)
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.pagesizes import landscape, letter

OUT = Path("darvas_reports")
OUT.mkdir(exist_ok=True)
TODAY = datetime.now().strftime("%Y-%m-%d")

NASDAQ_URL = "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt"
OTHER_URL = "https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt"


def get_directory(url):
    response = requests.get(url, timeout=40)
    response.raise_for_status()
    return pd.read_csv(io.StringIO(response.text), sep="|")


def get_universe():
    nas = get_directory(NASDAQ_URL)
    other = get_directory(OTHER_URL)

    nas = nas[
        (nas["Test Issue"] == "N") &
        (nas["ETF"] == "N")
    ].copy()
    nas["Ticker"] = nas["Symbol"]
    nas["Company"] = nas["Security Name"]
    nas["Exchange"] = "NASDAQ"

    other = other[
        (other["Test Issue"] == "N") &
        (other["ETF"] == "N")
    ].copy()
    other["Ticker"] = other["ACT Symbol"]
    other["Company"] = other["Security Name"]
    other["Exchange"] = other["Exchange"].map({
        "N": "NYSE",
        "A": "NYSE American",
        "P": "NYSE Arca",
        "Z": "Cboe",
        "V": "IEX"
    }).fillna("Other")

    all_stocks = pd.concat([
        nas[["Ticker", "Company", "Exchange"]],
        other[["Ticker", "Company", "Exchange"]]
    ], ignore_index=True)

    bad_names = (
        r"\bWarrant(s)?\b|\bRights?\b|\bUnits?\b|"
        r"\bPreferred\b|\bDepositary Shares\b"
    )
    all_stocks = all_stocks[
        ~all_stocks["Company"].str.contains(
            bad_names, case=False, regex=True, na=False
        )
    ]

    all_stocks = all_stocks.drop_duplicates("Ticker")

    expected = {"AAPL", "MSFT", "ACN", "NKE", "JPM"}
    missing = expected - set(all_stocks["Ticker"])
    if missing:
        raise RuntimeError(f"Universe validation failed: {missing}")

    return all_stocks


def analyze_stock(row):
    ticker = row["Ticker"]
    yahoo_ticker = ticker.replace(".", "-")

    for attempt in range(3):
        try:
            hist = yf.download(
                yahoo_ticker,
                period="18mo",
                interval="1d",
                auto_adjust=True,
                progress=False,
                threads=False,
                timeout=30
            )

            if isinstance(hist.columns, pd.MultiIndex):
                hist.columns = hist.columns.get_level_values(0)

            hist = hist.dropna(subset=["Close", "High", "Low", "Volume"])

            if len(hist) < 252:
                raise ValueError("Insufficient historical data")

            close = hist["Close"]
            high = hist["High"]
            low = hist["Low"]
            volume = hist["Volume"]

            price = float(close.iloc[-1])
            avg_volume = float(volume.tail(50).mean())
            high52 = float(high.tail(252).max())
            low52 = float(low.tail(252).min())
            sma50 = float(close.tail(50).mean())
            sma200 = float(close.tail(200).mean())
            pct_below = (high52 - price) / high52 * 100

            passed = (
                price > 5 and
                avg_volume > 500000 and
                0 <= pct_below <= 10 and
                price > sma50 and
                price > sma200
            )

            # Prior 20 sessions form a preliminary resistance box.
            prior = hist.iloc[-21:-1]
            box_top = float(prior["High"].max())
            box_bottom = float(prior["Low"].min())
            box_width_pct = (
                (box_top - box_bottom) / box_top * 100
            )

            volume20 = float(volume.iloc[-21:-1].mean())
            volume_ratio = (
                float(volume.iloc[-1]) / volume20
                if volume20 > 0 else 0
            )

            distance = (box_top - price) / box_top * 100

            if price > box_top * 1.05:
                status = "EXTENDED"
            elif price > box_top and volume_ratio >= 1.5:
                status = "BREAKOUT - NEWS AUDIT REQUIRED"
            elif 0 <= distance <= 2 and box_width_pct <= 15:
                status = "NEAR READY - REVIEW BOX"
            elif box_width_pct <= 15:
                status = "BUILDING BOX"
            else:
                status = "STRUCTURE REVIEW"

            return {
                "Ticker": ticker,
                "Company": row["Company"],
                "Exchange": row["Exchange"],
                "Price": round(price, 2),
                "Volume": int(volume.iloc[-1]),
                "Avg_Volume": int(avg_volume),
                "52W_High": round(high52, 2),
                "52W_Low": round(low52, 2),
                "Pct_Below_52W_High": round(pct_below, 2),
                "SMA50": round(sma50, 2),
                "SMA200": round(sma200, 2),
                "Pass_Finviz_Filters": passed,
                "Box_Top": round(box_top, 2),
                "Box_Bottom": round(box_bottom, 2),
                "Box_Width_Pct": round(box_width_pct, 2),
                "Volume_Ratio": round(volume_ratio, 2),
                "Darvas_Status": status if passed else "FILTER FAIL",
                "Corporate_Action_Check": "REQUIRED"
            }

        except Exception as exc:
            if attempt == 2:
                return {
                    "Ticker": ticker,
                    "Company": row["Company"],
                    "Exchange": row["Exchange"],
                    "Error": str(exc)[:150]
                }
            time.sleep(2 * (attempt + 1))


def create_pdf(candidates, total, failures):
    filename = OUT / f"darvas_report_{TODAY}.pdf"
    doc = SimpleDocTemplate(
        str(filename),
        pagesize=landscape(letter),
        leftMargin=30,
        rightMargin=30
    )

    styles = getSampleStyleSheet()
    story = [
        Paragraph(f"Daily Darvas Scanner - {TODAY}", styles["Title"]),
        Spacer(1, 12),
        Paragraph(
            f"Universe: {total} | "
            f"Candidates: {len(candidates)} | "
            f"Download failures: {failures}",
            styles["Normal"]
        ),
        Spacer(1, 12),
        Paragraph(
            "Technical candidates only. M&A and corporate-action "
            "review is required before any trade is considered READY.",
            styles["Normal"]
        ),
        Spacer(1, 15)
    ]

    columns = [
        "Ticker", "Price", "52W_High",
        "Pct_Below_52W_High", "Box_Top",
        "Box_Bottom", "Darvas_Status"
    ]

    for start in range(0, len(candidates), 25):
        chunk = candidates.iloc[start:start + 25]
        table_data = [columns] + [
            [str(r.get(c, "")) for c in columns]
            for _, r in chunk.iterrows()
        ]

        table = Table(
            table_data,
            colWidths=[65, 60, 70, 105, 70, 70, 210],
            repeatRows=1
        )
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.darkblue),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.lightgrey),
            ("FONTSIZE", (0, 0), (-1, -1), 7),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(table)
        story.append(Spacer(1, 12))

    doc.build(story)
    return filename


def main():
    universe = get_universe()
    print(f"Universe: {len(universe)} stocks", flush=True)

    results = []

    for index, (_, row) in enumerate(universe.iterrows(), 1):
        results.append(analyze_stock(row))

        if index % 100 == 0:
            print(f"Processed {index}/{len(universe)}", flush=True)
            pd.DataFrame(results).to_csv(
                OUT / f"checkpoint_{TODAY}.csv",
                index=False
            )

    full = pd.DataFrame(results)
    full.to_csv(OUT / f"full_universe_{TODAY}.csv", index=False)

    valid = full[full["Price"].notna()].copy()
    failed = full[full["Price"].isna()].copy()

    candidates = valid[
        valid["Pass_Finviz_Filters"] == True
    ].copy()

    candidates = candidates.sort_values(
        "Pct_Below_52W_High"
    )

    candidates.to_csv(
        OUT / f"darvas_candidates_{TODAY}.csv",
        index=False
    )

    failed.to_csv(
        OUT / f"failed_downloads_{TODAY}.csv",
        index=False
    )

    coverage = len(valid) / len(universe)

    print(f"Coverage: {coverage:.1%}", flush=True)
    print(f"Candidates: {len(candidates)}", flush=True)

    if coverage < 0.95:
        raise RuntimeError(
            "Market data coverage below 95%. "
            "PDF withheld to prevent incomplete reporting."
        )

    pdf = create_pdf(
        candidates,
        len(universe),
        len(failed)
    )
    print(f"PDF created: {pdf}", flush=True)


if __name__ == "__main__":
    main()
