"""Daily Darvas Scanner v5. GitHub Actions: python darvas_scanner.py

Universe: official Nasdaq Trader directories. Quotes: unofficial Yahoo Finance via
 yfinance, subject to delays, availability and rate limits. Technical screening is
 NOT a real-time Finviz export or a verified corporate-action clearance.
"""
import io
import json
import math
import os
import re
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import requests
import yfinance as yf
from reportlab.lib import colors
from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.utils import simpleSplit
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from xml.sax.saxutils import escape

OUT = Path('darvas_reports')
OUT.mkdir(parents=True, exist_ok=True)
DATE = datetime.now(ZoneInfo('America/Chicago')).strftime('%Y-%m-%d')
NASDAQ_URL = 'https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt'
OTHER_URL = 'https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt'
BATCH_SIZE = 40
RETRIES = 2
PAUSE_SECONDS = 1.5
MIN_FULL_HISTORY = 252
MIN_PARTIAL_HISTORY = 30
# Historical acquisition/special-situation flags. Not a current verified list.
# ALWAYS review news and definitive merger status before trading.
KNOWN_CORPORATE_ACTION_FLAGS = {
    'TECH': 'Historical acquisition flag - verify current status',
    'ACA': 'Historical acquisition flag - verify current status',
    'ATKR': 'Historical acquisition flag - verify current status',
    'ITGR': 'Historical acquisition flag - verify current status',
    'OGN': 'Historical acquisition flag - verify current status',
    'PAYO': 'Historical acquisition flag - verify current status',
    'ARX': 'Historical acquisition flag - verify current status',
    'WBD': 'Historical acquisition flag - verify current status',
    'SLAB': 'Historical acquisition flag - verify current status',
}
FIELDS = [
    'Ticker','Company_Name','Exchange','Price','Volume','Avg_Volume',
    '52W_High','52W_Low','Pct_Below_52W_High','Within_0_10Pct_52W_High',
    'SMA50','SMA200','Price_Pass','Volume_Pass','High_Pass',
    'SMA50_Pass','SMA200_Pass','Pass_Finviz_Filters',
    'History_Days','Data_Status','Last_Price_Date','Box_Top','Box_Bottom',
    'Box_Width_Pct','Volume_Ratio','ATR14','Entry_Trigger','Stop_Loss',
    'Risk_Pct','Target_2R','Darvas_Status','Corporate_Action_Check','Error',
    'Return_5D_Pct','Return_20D_Pct','ATR_Pct','Dollar_Volume',
    'Momentum_Score','Darvas_Score','Opportunity_Score','Score_Track',
    'Scenario_Target','Scenario_Upside_Pct','Reward_Risk_Ratio','Stale_Data'
]


def directory(url):
    last_error = None
    for attempt in range(3):
        try:
            r = requests.get(url, timeout=35, headers={'User-Agent': 'Mozilla/5.0'})
            r.raise_for_status()
            df = pd.read_csv(io.StringIO(r.text), sep='|', dtype=str)
            return df
        except Exception as exc:
            last_error = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f'Unable to download official directory {url}: {last_error}')


def get_universe():
    nas = directory(NASDAQ_URL)
    other = directory(OTHER_URL)
    nas = nas.loc[(nas['Test Issue'] == 'N') & (nas['ETF'] == 'N')].copy()
    nas = nas.rename(columns={'Symbol':'Ticker','Security Name':'Company_Name'})
    nas['Exchange'] = 'NASDAQ'
    other = other.loc[(other['Test Issue'] == 'N') & (other['ETF'] == 'N')].copy()
    other = other.rename(columns={'ACT Symbol':'Ticker','Security Name':'Company_Name'})
    other['Exchange'] = other['Exchange'].map({
        'N':'NYSE','A':'NYSE American','P':'NYSE Arca','Z':'Cboe','V':'IEX'
    }).fillna('Other')
    df = pd.concat([nas[FIELDS[:2]+['Exchange']], other[FIELDS[:2]+['Exchange']]], ignore_index=True)
    df = df.dropna(subset=['Ticker']).copy()
    df['Ticker'] = df['Ticker'].astype(str).str.strip()
    df = df[df['Ticker'].str.fullmatch(r'[A-Za-z0-9.^/-]+', na=False)]
    bad = r'\b(?:Warrants?|Rights?|Units?|Preferred|Depositary Shares)\b'
    df = df[~df['Company_Name'].fillna('').str.contains(bad, case=False, regex=True)]
    df = df.drop_duplicates('Ticker').reset_index(drop=True)
    required = {'AAPL','MSFT','ACN','NKE','JPM'}
    if not required.issubset(set(df['Ticker'])):
        raise RuntimeError(f'Symbol universe validation failed: {required-set(df["Ticker"])}')
    print('Universe:', len(df), '| NASDAQ:', sum(df.Exchange == 'NASDAQ'),
          '| Other:', sum(df.Exchange != 'NASDAQ'), flush=True)
    return df


def yahoo_symbol(symbol):
    return symbol.replace('.', '-').replace('/', '-')


def download_batch(symbols):
    """Return {original ticker: OHLCV DataFrame}; no assumption of success."""
    mapping = {s: yahoo_symbol(s) for s in symbols}
    result = {}
    try:
        raw = yf.download(
            tickers=list(mapping.values()), period='18mo', interval='1d',
            auto_adjust=True, group_by='ticker', progress=False,
            threads=False, timeout=25
        )
        if raw is None or raw.empty:
            return result
        multi = isinstance(raw.columns, pd.MultiIndex)
        for original, ys in mapping.items():
            try:
                if multi:
                    if ys in raw.columns.get_level_values(0):
                        h = raw[ys].copy()
                    elif len(symbols) == 1:
                        h = raw.droplevel(0, axis=1).copy()
                    else:
                        continue
                else:
                    if len(symbols) != 1:
                        continue
                    h = raw.copy()
                if all(c in h.columns for c in ('Close','High','Low','Volume')):
                    h = h.dropna(subset=['Close','High','Low','Volume'])
                    # Avoid ranking on an unfinished daily bar during market hours.
                    now = datetime.now(ZoneInfo('America/Chicago'))
                    if now.weekday() < 5 and (now.hour,now.minute) < (15,30):
                        h = h.loc[pd.to_datetime(h.index).date < now.date()]
                    if len(h):
                        result[original] = h
            except (KeyError, ValueError):
                continue
    except Exception as exc:
        print(f'Batch warning ({len(symbols)}): {str(exc)[:180]}', flush=True)
    return result


def safe_float(value):
    try:
        f = float(value)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def evaluate(info, h=None, error=''):
    ticker = info['Ticker']
    base = {key: None for key in FIELDS}
    base.update({'Ticker':ticker,'Company_Name':info['Company_Name'],
                 'Exchange':info['Exchange'],'Corporate_Action_Check':'NEWS AUDIT REQUIRED',
                 'Data_Status':'DOWNLOAD_FAILED','Error':error})
    if ticker in KNOWN_CORPORATE_ACTION_FLAGS:
        base['Corporate_Action_Check'] = KNOWN_CORPORATE_ACTION_FLAGS[ticker]
    if h is None or h.empty:
        return base
    try:
        h = h.sort_index().copy()
        n = len(h)
        base['History_Days'] = n
        base['Last_Price_Date'] = str(h.index[-1].date())
        c, high, low, v = h['Close'], h['High'], h['Low'], h['Volume']
        price = safe_float(c.iloc[-1])
        if price is None or price <= 0:
            raise ValueError('Invalid closing price')
        base.update({
            'Price':round(price, 3), 'Volume':int(v.iloc[-1]),
            'Avg_Volume':int(v.tail(50).mean()),
            '52W_High':round(float(high.tail(252).max()),3),
            '52W_Low':round(float(low.tail(252).min()),3),
            'SMA50':round(float(c.tail(50).mean()),3) if n >= 50 else None,
            'SMA200':round(float(c.tail(200).mean()),3) if n >= 200 else None,
            'Error':''
        })
        pct = (base['52W_High'] - price)/base['52W_High']*100
        base['Pct_Below_52W_High'] = round(pct, 2)
        base['Within_0_10Pct_52W_High'] = 'YES' if 0 <= pct <= 10 else 'NO'
        base['Price_Pass'] = price > 5
        base['Volume_Pass'] = base['Avg_Volume'] > 500000
        base['High_Pass'] = 0 <= pct <= 10
        base['SMA50_Pass'] = price > base['SMA50'] if base['SMA50'] is not None else False
        base['SMA200_Pass'] = price > base['SMA200'] if base['SMA200'] is not None else False
        if n < MIN_FULL_HISTORY:
            base['Data_Status'] = 'INSUFFICIENT_HISTORY'
            base['Darvas_Status'] = 'NOT ELIGIBLE - HISTORY'
            base['Pass_Finviz_Filters'] = False
            return base
        base['Data_Status'] = 'OK'
        base['Pass_Finviz_Filters'] = all([
            base['Price_Pass'],base['Volume_Pass'],base['High_Pass'],
            base['SMA50_Pass'],base['SMA200_Pass']
        ])
        prior = h.iloc[-21:-1]
        top = float(prior['High'].max())
        bottom = float(prior['Low'].min())
        width = (top-bottom)/top*100 if top else 0
        vol20 = float(v.iloc[-21:-1].mean())
        ratio = float(v.iloc[-1])/vol20 if vol20 else 0
        tr = pd.concat([high-low,(high-c.shift()).abs(),(low-c.shift()).abs()],axis=1).max(axis=1)
        atr = float(tr.tail(14).mean())
        entry = top * 1.002
        stop = min(bottom, entry-1.5*atr)
        risk = (entry-stop)/entry*100 if entry else 0
        base.update({
            'Box_Top':round(top,3),'Box_Bottom':round(bottom,3),
            'Box_Width_Pct':round(width,2),'Volume_Ratio':round(ratio,2),
            'ATR14':round(atr,3),'Entry_Trigger':round(entry,3),
            'Stop_Loss':round(stop,3),'Risk_Pct':round(risk,2),
            'Target_2R':round(entry+2*(entry-stop),3)
        })
        if not base['Pass_Finviz_Filters']:
            stage = 'FILTER FAIL'
        elif ticker in KNOWN_CORPORATE_ACTION_FLAGS:
            stage = 'EXCLUDE - CORPORATE ACTION REVIEW'
        elif price > top*1.05:
            stage = 'EXTENDED'
        elif price > top and ratio >= 1.5:
            stage = 'BREAKOUT - NEWS AUDIT REQUIRED'
        elif 0 <= (top-price)/top*100 <= 2 and width <= 15:
            stage = 'NEAR READY - NEWS AUDIT REQUIRED'
        elif width <= 15:
            stage = 'BUILDING BOX'
        else:
            stage = 'STRUCTURE REVIEW'
        base['Darvas_Status'] = stage
        # Only current and historical observations are used. No future-price leakage.
        ret5 = (price/float(c.iloc[-6])-1)*100 if n>=6 and c.iloc[-6]>0 else 0
        ret20 = (price/float(c.iloc[-21])-1)*100 if n>=21 and c.iloc[-21]>0 else 0
        atr_pct = atr/price*100
        dollars = price*float(v.tail(20).mean())
        # Scores are heuristic 0-100 opportunity rankings, NOT probabilities.
        def points(x, low, high, maxpoints):
            return max(0.0,min(1.0,(x-low)/(high-low)))*maxpoints
        # Momentum track: 30 volume, 25 momentum, 20 volatility,
        # 15 breakout location, 10 liquidity.
        volume_pts = points(ratio,0.8,3.0,30)
        momentum_pts = points(ret5,-3,15,17)+points(ret20,-5,25,8)
        volatility_pts = points(atr_pct,1,8,20)
        dist_top = (top-price)/top*100 if top else 99
        location_pts = points(5-abs(dist_top),0,5,15)
        liquidity_pts = points(dollars,2_000_000,30_000_000,10)
        momentum_score = volume_pts+momentum_pts+volatility_pts+location_pts+liquidity_pts
        # Darvas track: 30 box tightness, 25 proximity, 20 volume,
        # 15 reward/risk, 10 liquidity.
        box_pts = points(18-width,0,16,30)
        proximity_pts = points(4-abs(dist_top),0,4,25)
        darvas_volume_pts = points(ratio,0.7,2.0,20)
        measured_target = entry + max(0,top-bottom)
        atr_target = entry + 2*atr
        # Conservative scenario uses the smaller of measured-move and ATR targets.
        scenario_target = min(measured_target,atr_target)
        rr = (scenario_target-entry)/(entry-stop) if entry>stop else 0
        rr_pts = points(rr,0,3,15)
        darvas_score = box_pts+proximity_pts+darvas_volume_pts+rr_pts+liquidity_pts
        base.update({
            'Return_5D_Pct':round(ret5,2),'Return_20D_Pct':round(ret20,2),
            'ATR_Pct':round(atr_pct,2),'Dollar_Volume':round(dollars,0),
            'Momentum_Score':round(momentum_score,1),'Darvas_Score':round(darvas_score,1),
            'Scenario_Target':round(scenario_target,3),
            'Scenario_Upside_Pct':round((scenario_target/entry-1)*100,2),
            'Reward_Risk_Ratio':round(rr,2),
            'Stale_Data':(pd.Timestamp.now(tz='America/Chicago').date()-h.index[-1].date()).days>4
        })
        base['Score_Track'] = 'MOMENTUM' if momentum_score>=darvas_score else 'DARVAS'
        base['Opportunity_Score'] = round(max(momentum_score,darvas_score),1)
    except Exception as exc:
        base['Data_Status'] = 'DATA_ERROR'
        base['Pass_Finviz_Filters'] = False
        base['Error'] = str(exc)[:200]
    return base


def write_checkpoint(rows):
    pd.DataFrame(rows, columns=FIELDS).to_csv(OUT/f'checkpoint_{DATE}.csv',index=False)


def pdf_report(candidates, full, stats):
    path = OUT/f'darvas_report_{DATE}.pdf'
    doc = SimpleDocTemplate(str(path),pagesize=landscape(letter),
                            leftMargin=27,rightMargin=27,topMargin=28,bottomMargin=28)
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name='SmallDarvas',parent=styles['Normal'],fontSize=7,leading=9))
    styles.add(ParagraphStyle(name='HeaderDarvas',parent=styles['SmallDarvas'],textColor=colors.white))
    story = [Paragraph(f'Daily Darvas Screening | {DATE}',styles['Title']),Spacer(1,12)]
    lines = [
        f"Universe: {stats['universe']} | Complete history: {stats['ok']} ({stats['coverage']:.1%}) | Short history: {stats['short']} | Download/data failures: {stats['failed']}",
        f"Finviz-equivalent candidates: {stats['candidates']} | Historical corporate-action flags among candidates: {stats['flagged']}",
        'Rules: Price > $5; 50-day average volume > 500,000; 0-10% below 52-week high; price > SMA50 and SMA200.',
        'WARNING: Data is Yahoo Finance-derived, NOT a live Finviz export. Missing securities can affect completeness.',
        'NO candidate is cleared for trading. Mergers, SPACs, pending deals, corporate actions and news require independent current verification.',
        'Box/entry/stop/target values are mechanical estimates, not confirmed support or personalized trade recommendations.'
    ]
    for line in lines:
        story.extend([Paragraph(escape(line),styles['Normal']),Spacer(1,7)])
    story.append(Spacer(1,10))
    display_cols = ['Ticker','Price','Pct_Below_52W_High','Box_Top','Box_Bottom','Volume_Ratio','Risk_Pct','Darvas_Status']
    widths = [58,55,83,64,64,67,56,260]
    for start in range(0,len(candidates),27):
        chunk = candidates.iloc[start:start+27]
        table_rows = [[Paragraph(escape(s.replace('_',' ')),styles['HeaderDarvas']) for s in display_cols]]
        for _, row in chunk.iterrows():
            table_rows.append([Paragraph(escape(str(row.get(c,''))),styles['SmallDarvas']) for c in display_cols])
        t = Table(table_rows,colWidths=widths,repeatRows=1,hAlign='LEFT')
        t.setStyle(TableStyle([
            ('BACKGROUND',(0,0),(-1,0),colors.HexColor('#203451')),
            ('TEXTCOLOR',(0,0),(-1,0),colors.white),
            ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.whitesmoke]),
            ('GRID',(0,0),(-1,-1),0.25,colors.lightgrey),
            ('VALIGN',(0,0),(-1,-1),'TOP'),
            ('LEFTPADDING',(0,0),(-1,-1),4),('RIGHTPADDING',(0,0),(-1,-1),4)
        ]))
        story.append(t)
        story.append(Spacer(1,12))
    if candidates.empty:
        story.append(Paragraph('No eligible candidates in successfully evaluated securities.',styles['Normal']))
    story.extend([Spacer(1,12),Paragraph(
        'AGEN / IOVA are historical pattern references only; this automated scan does not establish similarity or forecast returns.',
        styles['Normal'])])
    doc.build(story)
    return path


def select_v5(candidates):
    """Predeclared 6 momentum + 4 Darvas slots; no knowledge of future returns."""
    eligible = candidates.copy()
    eligible = eligible.loc[
        (~eligible.Ticker.isin(KNOWN_CORPORATE_ACTION_FLAGS)) &
        (eligible.Data_Status=='OK') &
        (eligible.Stale_Data==False) &
        (~eligible.Darvas_Status.fillna('').str.contains('EXTENDED|EXCLUDE',regex=True)) &
        (pd.to_numeric(eligible.Risk_Pct,errors='coerce').between(1,35)) &
        (pd.to_numeric(eligible.Dollar_Volume,errors='coerce')>=3_000_000)
    ].copy()
    eligible['Selection_Track']=''
    # Use independent ranked pools; no sector caps because sector metadata is unavailable.
    momentum = eligible.sort_values(['Momentum_Score','Ticker'],ascending=[False,True]).head(6).copy()
    momentum['Selection_Track']='MOMENTUM'
    remaining = eligible.loc[~eligible.Ticker.isin(momentum.Ticker)]
    darvas = remaining.sort_values(['Darvas_Score','Ticker'],ascending=[False,True]).head(4).copy()
    darvas['Selection_Track']='DARVAS'
    top = pd.concat([momentum,darvas],ignore_index=True)
    # Within each track preserve descending track-specific score; output track order.
    top['Selection_Score']=top.apply(lambda r: r.Momentum_Score if r.Selection_Track=='MOMENTUM' else r.Darvas_Score,axis=1)
    top=top.sort_values(['Selection_Score','Ticker'],ascending=[False,True]).reset_index(drop=True)
    top.insert(0,'Rank',range(1,len(top)+1))
    return top,eligible


def v5_pdf(top,eligible,stats):
    path=OUT/f'darvas_v5_top10_{DATE}.pdf'
    doc=SimpleDocTemplate(str(path),pagesize=landscape(letter),leftMargin=30,rightMargin=30,topMargin=30,bottomMargin=30)
    styles=getSampleStyleSheet()
    styles.add(ParagraphStyle(name='V5Small',parent=styles['Normal'],fontSize=8,leading=11))
    styles.add(ParagraphStyle(name='V5Head',parent=styles['V5Small'],textColor=colors.white,fontSize=8))
    story=[Paragraph(f'Darvas Version 5 | Top 10 | {DATE}',styles['Title']),Spacer(1,10)]
    notes=[
        f"Universe {stats['universe']} | Full histories {stats['ok']} ({stats['coverage']:.1%}) | Scanner candidates {stats['candidates']} | V5 eligible {len(eligible)}",
        '6 momentum slots + 4 Darvas slots; scores are heuristic rankings, NOT probabilities or projected returns.',
        'Data: Yahoo Finance daily auto-adjusted OHLCV. Current-day bars can be incomplete if run before market close.',
        'All entries are WATCHLIST ONLY. No independent live news, merger, catalyst, or corporate-action clearance.',
        'Targets are technical scenarios (minimum of 20-day box measured move and 2 ATR); not expected 1-5 day returns.',
        'Price stop distance does not bound actual losses; gap/slippage risk remains. Confirm prices and news before trading.'
    ]
    for note in notes:story.extend([Paragraph(escape(note),styles['V5Small']),Spacer(1,5)])
    story.append(Spacer(1,10))
    cols=['Rank','Ticker','Selection_Track','Price','Selection_Score','Volume_Ratio','Return_5D_Pct','ATR_Pct','Risk_Pct','Scenario_Upside_Pct','Darvas_Status']
    widths=[31,45,76,54,62,55,59,49,48,71,165]
    rows=[[Paragraph(escape(x.replace('_',' ')),styles['V5Head']) for x in cols]]
    for _,r in top.iterrows():
        rows.append([Paragraph(escape(str(r.get(x,''))),styles['V5Small']) for x in cols])
    if len(rows)>1:
        t=Table(rows,colWidths=widths,repeatRows=1)
        t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#203451')),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.whitesmoke]),('GRID',(0,0),(-1,-1),.25,colors.lightgrey),('VALIGN',(0,0),(-1,-1),'TOP')]))
        story.append(t)
    else:story.append(Paragraph('No eligible candidates. Check data quality and exclusions.',styles['Normal']))
    story.append(PageBreak())
    story.append(Paragraph('Top 3 | Mechanical Trade-Planning Reference',styles['Heading1']))
    for _,r in top.head(3).iterrows():
        story.append(Spacer(1,8))
        story.append(Paragraph(f"#{int(r.Rank)} {escape(str(r.Ticker))} | {escape(str(r.Selection_Track))} | Score {r.Selection_Score:.1f}/100",styles['Heading2']))
        lines=[f"Reference close: ${r.Price:.2f} | 20-day resistance: ${r.Box_Top:.2f} | 20-day support: ${r.Box_Bottom:.2f}",
               f"Mechanical trigger: ${r.Entry_Trigger:.2f} | Mechanical stop: ${r.Stop_Loss:.2f} | Stop distance: {r.Risk_Pct:.2f}%",
               f"Technical scenario target: ${r.Scenario_Target:.2f} | Scenario upside from trigger: {r.Scenario_Upside_Pct:.2f}% | Reward/risk: {r.Reward_Risk_Ratio:.2f}x",
               f"Volume ratio: {r.Volume_Ratio:.2f}x | Last daily bar: {r.Last_Price_Date} | Status: {r.Darvas_Status}",
               'Trigger and stop are illustrative, not orders. Verify news, intraday price, gaps, and liquidity.']
        for line in lines:story.append(Paragraph(escape(line),styles['V5Small']))
    story.append(Spacer(1,16))
    story.append(Paragraph('Scoring details',styles['Heading2']))
    story.append(Paragraph('Momentum: volume 30, returns 25, ATR volatility 20, proximity 15, liquidity 10. Darvas: box tightness 30, proximity 25, volume 20, scenario reward/risk 15, liquidity 10. Scores are not backtest-calibrated.',styles['V5Small']))
    doc.build(story)
    return path


def save_watchlist(top):
    cols=['Rank','Ticker','Selection_Track','Selection_Score','Price','Last_Price_Date','Entry_Trigger','Stop_Loss','Scenario_Target','Scenario_Upside_Pct','Risk_Pct','Volume_Ratio','Return_5D_Pct','Return_20D_Pct','ATR_Pct','Darvas_Status','Corporate_Action_Check']
    top[cols].to_csv(OUT/f'v5_top10_{DATE}.csv',index=False)
    top.head(3)[cols].to_csv(OUT/f'v5_top3_{DATE}.csv',index=False)
    # Local snapshot; GitHub Actions does not persist this file between fresh runs.
    history_path=OUT/'v5_selection_history.csv'
    snapshot=top[cols].copy()
    snapshot.insert(0,'Scan_Date',DATE)
    if history_path.exists():
        old=pd.read_csv(history_path,dtype={'Ticker':str,'Scan_Date':str})
        old=old.loc[old.Scan_Date!=DATE]
        snapshot=pd.concat([old,snapshot],ignore_index=True)
    snapshot.to_csv(history_path,index=False)


def main():
    print(f'Darvas v5 starting: {DATE}',flush=True)
    universe = get_universe()
    records = universe.to_dict('records')
    results = []
    for start in range(0,len(records),BATCH_SIZE):
        chunk = records[start:start+BATCH_SIZE]
        symbols = [r['Ticker'] for r in chunk]
        downloaded = download_batch(symbols)
        missing = [s for s in symbols if s not in downloaded]
        # Retry only missing symbols in smaller groups; avoid thousands of one-by-one calls.
        for attempt in range(RETRIES):
            if not missing:
                break
            time.sleep(2*(attempt+1))
            recovered = {}
            for j in range(0,len(missing),10):
                recovered.update(download_batch(missing[j:j+10]))
            downloaded.update(recovered)
            missing = [s for s in missing if s not in downloaded]
        for info in chunk:
            ticker = info['Ticker']
            results.append(evaluate(info,downloaded.get(ticker),
                                    'No Yahoo OHLCV returned' if ticker not in downloaded else ''))
        write_checkpoint(results)
        success = sum(r['Data_Status']=='OK' for r in results)
        short = sum(r['Data_Status']=='INSUFFICIENT_HISTORY' for r in results)
        failed = len(results)-success-short
        print(f'Processed {len(results)}/{len(records)} | Full history {success} | Short history {short} | Errors {failed}',flush=True)
        time.sleep(PAUSE_SECONDS)
    full = pd.DataFrame(results,columns=FIELDS)
    full.to_csv(OUT/f'full_universe_{DATE}.csv',index=False)
    full.loc[full.Exchange=='NASDAQ'].to_csv(OUT/f'nasdaq_current_values_{DATE}.csv',index=False)
    full.loc[full.Exchange!='NASDAQ'].to_csv(OUT/f'other_current_values_{DATE}.csv',index=False)
    problems = full.loc[full.Data_Status!='OK']
    problems.to_csv(OUT/f'failed_or_short_history_{DATE}.csv',index=False)
    candidates = full.loc[full.Pass_Finviz_Filters==True].copy()
    candidates = candidates.sort_values(['Pct_Below_52W_High','Ticker'])
    candidates.to_csv(OUT/f'darvas_candidates_{DATE}.csv',index=False)
    ok = int((full.Data_Status=='OK').sum())
    short = int((full.Data_Status=='INSUFFICIENT_HISTORY').sum())
    failed = len(full)-ok-short
    flagged = int(candidates.Ticker.isin(KNOWN_CORPORATE_ACTION_FLAGS).sum())
    stats = {'date':DATE,'universe':len(full),'ok':ok,'short':short,
             'failed':failed,'coverage':ok/len(full) if len(full) else 0,
             'candidates':len(candidates),'flagged':flagged}
    (OUT/f'run_summary_{DATE}.json').write_text(json.dumps(stats,indent=2))
    print('SUMMARY:',json.dumps(stats),flush=True)
    top,eligible=select_v5(candidates)
    save_watchlist(top)
    eligible.to_csv(OUT/f'v5_eligible_{DATE}.csv',index=False)
    v5=v5_pdf(top,eligible,stats)
    print('VERSION 5 TOP 10:',top[['Ticker','Selection_Track','Selection_Score']].to_string(index=False),flush=True)
    print('V5 PDF CREATED:',v5,flush=True)
    # Always create an explicitly qualified report; never disguise missing coverage.
    pdf = pdf_report(candidates,full,stats)
    print('PDF CREATED:',pdf,flush=True)
    if stats['coverage']<0.95:
        print('WARNING: Full-history coverage below 95%. PDF is marked incomplete.',flush=True)
    if failed:
        print(f'WARNING: {failed} genuine data/download failures. Review failure CSV.',flush=True)


if __name__=='__main__':
    main()
