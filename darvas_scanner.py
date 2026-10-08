
import io
import re
import time
import warnings
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd
import requests
import yfinance as yf

from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer,
    Table, TableStyle, PageBreak
)
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.pagesizes import landscape, letter

# ============================================================
# DAILY DARVAS SCANNER - VERSION 2
# GitHub repository: RamaRaju11/ipl-arena
#
# Improvements:
# - Fix missing/NaN ticker crash
# - Validate Nasdaq/NYSE symbol directories
# - Handle failed Yahoo Finance downloads
# - Save progress checkpoints
# - Create separate Nasdaq and Other CSV files
# - Apply permanent Finviz filters
# - Calculate preliminary Darvas box indicators
# - Generate dated PDF
# - Prevent misleading PDF when data coverage is low
# ============================================================

OUT = Path("darvas_reports")
OUT.mkdir(parents=True, exist_ok=True)

TODAY = datetime.now(
    ZoneInfo("America/Chicago")
).strftime("%Y-%m-%d")

NASDAQ_URL = (
    "https://www.nasdaqtrader.com/dynamic/"
    "symdir/nasdaqlisted.txt"
)

OTHER_URL = (
    "https://www.nasdaqtrader.com/dynamic/"
    "symdir/otherlisted.txt"
)

PRICE_MIN = 5
AVG_VOLUME_MIN = 500000
MAX_BELOW_HIGH = 10

HISTORY_PERIOD = "18mo"
MIN_HISTORY = 252

CHECKPOINT_EVERY = 50
MAX_RETRIES = 3
MIN_COVERAGE = 0.95

# This list is NOT a substitute for a live merger/news audit.
# Keep corporate-action verification mandatory.
CORPORATE_ACTION_CHECK = "REQUIRED"

warnings.filterwarnings(
    "ignore",
    message="This pattern is interpreted as a regular expression"
)


# ============================================================
# STEP 1 - DOWNLOAD OFFICIAL STOCK UNIVERSE
# ============================================================

def get_directory(url):
    for attempt in range(3):
        try:
            response = requests.get(
                url,
                timeout=40,
                headers={
                    "User-Agent": "Mozilla/5.0"
                }
            )

            response.raise_for_status()

            df = pd.read_csv(
                io.StringIO(response.text),
                sep="|",
                dtype=str
            )

            return df

        except Exception as exc:
            print(
                f"Directory attempt {attempt + 1} failed: {exc}",
                flush=True
            )
            time.sleep(3 * (attempt + 1))

    raise RuntimeError(
        f"Could not download symbol directory: {url}"
    )


def clean_symbols(df):
    df = df.copy()

    # Remove missing ticker values before using string methods.
    df = df.dropna(subset=["Ticker"])

    df["Ticker"] = (
        df["Ticker"]
        .astype(str)
        .str.strip()
    )

    invalid = {
        "",
        "nan",
        "none",
        "null",
        "File Creation Time"
    }

    df = df[
        ~df["Ticker"].str.lower().isin(
            {v.lower() for v in invalid}
        )
    ]

    # Remove obviously invalid ticker symbols.
    df = df[
        df["Ticker"].str.fullmatch(
            r"[A-Za-z0-9.^/-]+",
            na=False
        )
    ]

    # Exclude common non-common-stock instruments.
    bad_names = (
        r"\b(?:Warrants?|Rights?|Units?|"
        r"Preferred|Depositary Shares)\b"
    )

    df = df[
        ~df["Company"].fillna("").str.contains(
            bad_names,
            case=False,
            regex=True,
            na=False
        )
    ]

    return df.drop_duplicates(
        subset=["Ticker"]
    ).reset_index(drop=True)


def get_universe():
    print("Downloading Nasdaq symbol directory...", flush=True)

    nas = get_directory(NASDAQ_URL)

    print("Downloading other exchange directory...", flush=True)

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

    nas = clean_symbols(
        nas[["Ticker", "Company", "Exchange"]]
    )

    other = clean_symbols(
        other[["Ticker", "Company", "Exchange"]]
    )

    all_stocks = pd.concat(
        [nas, other],
        ignore_index=True
    )

    all_stocks = all_stocks.drop_duplicates(
        "Ticker"
    ).reset_index(drop=True)

    expected = {
        "AAPL", "MSFT", "ACN", "NKE", "JPM"
    }

    missing = expected - set(all_stocks["Ticker"])

    if missing:
        raise RuntimeError(
            f"Universe validation failed. Missing: {missing}"
        )

    print(f"NASDAQ symbols: {len(nas)}", flush=True)
    print(f"Other exchange symbols: {len(other)}", flush=True)
    print(f"Total universe: {len(all_stocks)}", flush=True)

    return all_stocks


# ============================================================
# STEP 2 - HISTORICAL MARKET DATA
# ============================================================

def analyze_stock(row):
    ticker = str(row["Ticker"]).strip()

    basic = {
        "Ticker": ticker,
        "Company": row["Company"],
        "Exchange": row["Exchange"]
    }

    if not ticker or ticker.lower() in {
        "nan", "none", "null"
    }:
        return {
            **basic,
            "Error": "Invalid ticker"
        }

    yahoo_ticker = ticker.replace(".", "-")

    for attempt in range(MAX_RETRIES):
        try:
            hist = yf.download(
                yahoo_ticker,
                period=HISTORY_PERIOD,
                interval="1d",
                auto_adjust=True,
                progress=False,
                threads=False,
                timeout=30
            )

            if hist is None or hist.empty:
                raise ValueError("Empty Yahoo Finance response")

            if isinstance(hist.columns, pd.MultiIndex):
                hist.columns = (
                    hist.columns.get_level_values(0)
                )

            hist = hist.dropna(
                subset=["Close", "High", "Low", "Volume"]
            )

            if len(hist) < MIN_HISTORY:
                raise ValueError(
                    f"Insufficient history: {len(hist)} days"
                )

            close = hist["Close"]
            high = hist["High"]
            low = hist["Low"]
            volume = hist["Volume"]

            price = float(close.iloc[-1])
            current_volume = float(volume.iloc[-1])

            avg_volume = float(
                volume.tail(50).mean()
            )

            high52 = float(
                high.tail(252).max()
            )

            low52 = float(
                low.tail(252).min()
            )

            sma50 = float(
                close.tail(50).mean()
            )

            sma200 = float(
                close.tail(200).mean()
            )

            if high52 <= 0:
                raise ValueError("Invalid 52-week high")

            pct_below = (
                (high52 - price) / high52
            ) * 100

            # Permanent Finviz-equivalent filters.
            price_pass = price > PRICE_MIN
            volume_pass = avg_volume > AVG_VOLUME_MIN

            high_pass = (
                0 <= pct_below <= MAX_BELOW_HIGH
            )

            sma50_pass = price > sma50
            sma200_pass = price > sma200

            passed = all([
                price_pass,
                volume_pass,
                high_pass,
                sma50_pass,
                sma200_pass
            ])

            # Preliminary Darvas structure.
            # Use the 20 completed sessions before latest bar.
            prior = hist.iloc[-21:-1]

            box_top = float(
                prior["High"].max()
            )

            box_bottom = float(
                prior["Low"].min()
            )

            box_width = (
                (box_top - box_bottom) / box_top
            ) * 100 if box_top > 0 else 0

            volume20 = float(
                volume.iloc[-21:-1].mean()
            )

            volume_ratio = (
                current_volume / volume20
                if volume20 > 0 else 0
            )

            distance_to_box = (
                (box_top - price) / box_top
            ) * 100 if box_top > 0 else 0

            if not passed:
                status = "FILTER FAIL"

            elif price > box_top * 1.05:
                status = "EXTENDED"

            elif (
                price > box_top
                and volume_ratio >= 1.5
            ):
                status = "BREAKOUT - NEWS AUDIT REQUIRED"

            elif (
                0 <= distance_to_box <= 2
                and box_width <= 15
            ):
                status = "NEAR READY - REVIEW BOX"

            elif box_width <= 15:
                status = "BUILDING BOX"

            else:
                status = "STRUCTURE REVIEW"

            return {
                **basic,
                "Price": round(price, 2),
                "Volume": int(current_volume),
                "Avg_Volume": int(avg_volume),
                "52W_High": round(high52, 2),
                "52W_Low": round(low52, 2),
                "Pct_Below_52W_High": round(pct_below, 2),
                "Within_0_10Pct_52W_High": (
                    "YES" if high_pass else "NO"
                ),
                "SMA50": round(sma50, 2),
                "SMA200": round(sma200, 2),
                "Price_Pass": price_pass,
                "Volume_Pass": volume_pass,
                "High_Pass": high_pass,
                "SMA50_Pass": sma50_pass,
                "SMA200_Pass": sma200_pass,
                "Pass_Finviz_Filters": passed,
                "Box_Top": round(box_top, 2),
                "Box_Bottom": round(box_bottom, 2),
                "Box_Width_Pct": round(box_width, 2),
                "Distance_To_Box_Pct": round(
                    distance_to_box, 2
                ),
                "Volume_Ratio": round(volume_ratio, 2),
                "Darvas_Status": status,
                "Corporate_Action_Check": (
                    CORPORATE_ACTION_CHECK
                ),
                "Error": ""
            }

        except Exception as exc:
            if attempt == MAX_RETRIES - 1:
                return {
                    **basic,
                    "Error": str(exc)[:200]
                }

            time.sleep(2 * (attempt + 1))


# ============================================================
# STEP 3 - PDF GENERATION
# ============================================================

def create_pdf(candidates, total, failures, coverage):
    filename = OUT / f"darvas_report_{TODAY}.pdf"

    doc = SimpleDocTemplate(
        str(filename),
        pagesize=landscape(letter),
        leftMargin=35,
        rightMargin=35,
        topMargin=35,
        bottomMargin=35
    )

    styles = getSampleStyleSheet()

    styles.add(
        ParagraphStyle(
            name="DarvasCell",
            parent=styles["Normal"],
            fontSize=7,
            leading=9
        )
    )

    story = [
        Paragraph(
            f"Daily Darvas Scanner - {TODAY}",
            styles["Title"]
        ),
        Spacer(1, 12),
        Paragraph(
            f"Universe: {total} | "
            f"Candidates: {len(candidates)} | "
            f"Failures: {failures} | "
            f"Coverage: {coverage:.1%}",
            styles["Normal"]
        ),
        Spacer(1, 12),
        Paragraph(
            "Filters: Price > $5 | "
            "Average Volume > 500K | "
            "0-10% below 52-week high | "
            "Above SMA50 and SMA200",
            styles["Normal"]
        ),
        Spacer(1, 12),
        Paragraph(
            "IMPORTANT: Preliminary technical screening only. "
            "Corporate actions, mergers, SPAC status and "
            "recent news must be checked before assigning "
            "a final READY classification.",
            styles["Normal"]
        ),
        Spacer(1, 16)
    ]

    columns = [
        "Ticker",
        "Price",
        "52W_High",
        "Pct_Below_52W_High",
        "Box_Top",
        "Box_Bottom",
        "Darvas_Status"
    ]

    widths = [
        55, 55, 65, 105, 65, 65, 245
    ]

    if candidates.empty:
        story.append(
            Paragraph(
                "No candidates passed the current filters.",
                styles["Normal"]
            )
        )

    for start in range(0, len(candidates), 25):
        chunk = candidates.iloc[start:start + 25]

        table_data = [
            [
                Paragraph(c, styles["DarvasCell"])
                for c in columns
            ]
        ]

        for _, r in chunk.iterrows():
            table_data.append([
                Paragraph(
                    str(r.get(c, "")),
                    styles["DarvasCell"]
                )
                for c in columns
            ])

        table = Table(
            table_data,
            colWidths=widths,
            repeatRows=1
        )

        table.setStyle(
            TableStyle([
                (
                    "BACKGROUND",
                    (0, 0), (-1, 0),
                    colors.HexColor("#183153")
                ),
                (
                    "TEXTCOLOR",
                    (0, 0), (-1, 0),
                    colors.white
                ),
                (
                    "GRID",
                    (0, 0), (-1, -1),
                    0.4,
                    colors.lightgrey
                ),
                (
                    "VALIGN",
                    (0, 0), (-1, -1),
                    "TOP"
                ),
                (
                    "ROWBACKGROUNDS",
                    (0, 1), (-1, -1),
                    [colors.white, colors.whitesmoke]
                )
            ])
        )

        story.append(table)
        story.append(Spacer(1, 15))

    story.append(
        Paragraph(
            "AGEN / IOVA reference: Historical breakout "
            "patterns require additional multi-session "
            "comparison. Similarity does not predict "
            "future returns.",
            styles["Normal"]
        )
    )

    doc.build(story)

    return filename


# ============================================================
# STEP 4 - MAIN PROCESS
# ============================================================

def main():
    print(
        f"Starting Daily Darvas Scanner: {TODAY}",
        flush=True
    )

    universe = get_universe()

    results = []
    total = len(universe)

    print(
        f"Beginning downloads for {total} stocks...",
        flush=True
    )

    for index, (_, row) in enumerate(
        universe.iterrows(), 1
    ):
        result = analyze_stock(row)
        results.append(result)

        if index % CHECKPOINT_EVERY == 0:
            checkpoint = pd.DataFrame(results)

            checkpoint.to_csv(
                OUT / f"checkpoint_{TODAY}.csv",
                index=False
            )

            success = sum(
                pd.notna(r.get("Price"))
                for r in results
            )

            print(
                f"Processed {index}/{total} | "
                f"Successful: {success} | "
                f"Failed: {index - success}",
                flush=True
            )

    full = pd.DataFrame(results)

    full.to_csv(
        OUT / f"full_universe_{TODAY}.csv",
        index=False
    )

    # Split full universe by exchange.
    nasdaq = full[
        full["Exchange"] == "NASDAQ"
    ].copy()

    other = full[
        full["Exchange"] != "NASDAQ"
    ].copy()

    nasdaq.to_csv(
        OUT / f"nasdaq_current_values_{TODAY}.csv",
        index=False
    )

    other.to_csv(
        OUT / f"other_current_values_{TODAY}.csv",
        index=False
    )

    if "Price" not in full.columns:
        raise RuntimeError(
            "No market prices downloaded. "
            "Check Yahoo Finance access."
        )

    valid = full[
        full["Price"].notna()
    ].copy()

    failed = full[
        full["Price"].isna()
    ].copy()

    failed.to_csv(
        OUT / f"failed_downloads_{TODAY}.csv",
        index=False
    )

    coverage = len(valid) / total

    print(
        f"Market data coverage: {coverage:.2%}",
        flush=True
    )

    if "Pass_Finviz_Filters" not in valid.columns:
        raise RuntimeError(
            "Filter results unavailable."
        )

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

    print(
        f"Finviz-equivalent candidates: {len(candidates)}",
        flush=True
    )

    if coverage < MIN_COVERAGE:
        raise RuntimeError(
            f"Coverage {coverage:.2%} is below "
            f"the required {MIN_COVERAGE:.0%}. "
            "CSV diagnostics saved. "
            "PDF withheld."
        )

    pdf = create_pdf(
        candidates,
        total,
        len(failed),
        coverage
    )

    print(
        f"PDF created successfully: {pdf}",
        flush=True
    )

    print(
        "Daily Darvas Scanner completed.",
        flush=True
    )


if __name__ == "__main__":
    main()
