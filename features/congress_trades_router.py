"""
Congress Trades Router - Politician Stock Trading Tracker
Scrapes Capitol Trades (capitoltrades.com) for recent congressional
stock/option disclosures and serves them as clean JSON.

Endpoints:
  GET /api/congress/trades              - Latest trades (default 96)
  GET /api/congress/trades?politician=X - Filter by politician name
  GET /api/congress/status              - Data source health check
"""

import time
import logging
import re
from typing import Optional

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

logger = logging.getLogger("congress_trades")

router = APIRouter(prefix="/congress", tags=["congress"])

# Shared httpx client for connection pooling
_congress_http: httpx.AsyncClient | None = None

def _client() -> httpx.AsyncClient:
    global _congress_http
    if _congress_http is None:
        _congress_http = httpx.AsyncClient(
            timeout=20.0,
            follow_redirects=True,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _congress_http

# ---------------------------------------------------------------------------
# In-memory cache  (15-min TTL, matches project convention)
# ---------------------------------------------------------------------------
_trades_cache_data: list | None = None
_trades_cache_ts: float = 0.0
_CACHE_TTL = 900.0  # 15 minutes

_CAPITOL_TRADES_URL = "https://www.capitoltrades.com/trades"
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


def _parse_date_cell(td) -> str:
    """Extract a date string from a Capitol Trades date <td>.
    Structure: td > div.flex > div.text-center >
                 <div class="text-size-3">12 Mar</div>
                 <div class="text-size-2">2026</div>
    """
    if td is None:
        return ""
    # Target the specific leaf divs used by Capitol Trades
    primary = td.select_one("div.text-size-3, [class*='text-size-3']")
    secondary = td.select_one("div.text-size-2, [class*='text-size-2']")
    parts = []
    if primary:
        parts.append(primary.get_text(strip=True))
    if secondary:
        parts.append(secondary.get_text(strip=True))
    return " ".join(parts) if parts else td.get_text(strip=True)




def _parse_trades_html(html: str) -> list[dict]:
    """Parse Capitol Trades /trades page HTML into a list of trade dicts."""
    soup = BeautifulSoup(html, "html.parser")
    trades: list[dict] = []

    # Find trade rows - they live in <tr> elements with border-b class
    rows = soup.select("tr")
    for row in rows:
        tds = row.find_all("td")
        if len(tds) < 5:
            continue  # skip header or malformed rows

        trade: dict = {}

        # --- Column 1: Politician info ---
        pol_link = row.select_one('a[href*="/politicians/"]')
        trade["politician"] = pol_link.get_text(strip=True) if pol_link else ""
        trade["politicianUrl"] = (
            f"https://www.capitoltrades.com{pol_link['href']}"
            if pol_link and pol_link.get("href")
            else ""
        )

        # Extract politician photo from img in the politician cell
        pol_img = row.select_one('td img[src*="politicians"]')
        if pol_img and pol_img.get("src"):
            img_src = pol_img["src"]
            # Resolve relative path: /_next/image?url=%2Fassets%2Fpoliticians%2Fxxx.jpg...
            trade["photoUrl"] = f"https://www.capitoltrades.com{img_src}"
        else:
            trade["photoUrl"] = ""

        party_el = row.select_one(".q-field.party")
        trade["party"] = party_el.get_text(strip=True) if party_el else ""

        chamber_el = row.select_one(".q-field.chamber")
        trade["chamber"] = chamber_el.get_text(strip=True) if chamber_el else ""

        state_el = row.select_one(".q-field.us-state-compact")
        trade["state"] = state_el.get_text(strip=True) if state_el else ""

        # --- Column 2: Issuer / Ticker ---
        issuer_link = row.select_one("h3.q-fieldset a, h3.issuer-name a, .issuer-name a")
        trade["issuer"] = issuer_link.get_text(strip=True) if issuer_link else ""

        ticker_el = row.select_one(".q-field.issuer-ticker")
        raw_ticker = ticker_el.get_text(strip=True) if ticker_el else ""
        # Strip country suffix like ":US"
        trade["ticker"] = raw_ticker.split(":")[0] if raw_ticker else ""
        trade["tickerFull"] = raw_ticker

        # --- Columns 3 & 4: Filing date & Trade date ---
        if len(tds) >= 4:
            trade["filingDate"] = _parse_date_cell(tds[2])
            trade["txDate"] = _parse_date_cell(tds[3])
        else:
            trade["filingDate"] = ""
            trade["txDate"] = ""

        # --- Transaction type (buy/sell/exchange) ---
        tx_el = row.select_one(".q-field.tx-type")
        trade["txType"] = tx_el.get_text(strip=True).lower() if tx_el else ""

        # --- Amount range ---
        # Usually in a later <td> with text like "1K-15K" or "$1,001 - $15,000"
        amount_text = ""
        for td in tds:
            txt = td.get_text(strip=True)
            if re.search(r'\d+K', txt) or re.search(r'\$[\d,]+\s*[-\u2013]\s*\$[\d,]+', txt):
                amount_text = txt
                break
        trade["amount"] = amount_text

        # --- Trade detail URL ---
        detail_link = row.select_one('a[href*="/trades/"]')
        if detail_link and detail_link.get("href", "").startswith("/trades/"):
            trade["tradeDetailUrl"] = (
                f"https://www.capitoltrades.com{detail_link['href']}"
            )
        else:
            trade["tradeDetailUrl"] = ""

        # Only add if we got a politician name (skip garbage rows)
        if trade["politician"]:
            trades.append(trade)

    return trades


async def _fetch_trades() -> list[dict]:
    """Fetch and parse trades from Capitol Trades, using cache when valid."""
    global _trades_cache_data, _trades_cache_ts

    # Return cached if fresh
    if _trades_cache_data is not None and (time.time() - _trades_cache_ts) < _CACHE_TTL:
        return _trades_cache_data

    logger.info("[Congress] Fetching trades from Capitol Trades...")
    start = time.time()

    try:
        # Fetch multiple pages for comprehensive coverage of all active politicians
        all_trades: list[dict] = []
        client = _client()
        for page in range(1, 11):  # 10 pages x 96 trades = ~960 trades
            url = f"{_CAPITOL_TRADES_URL}?page={page}&pageSize=96"
            resp = await client.get(
                url,
                headers={
                    "User-Agent": _USER_AGENT,
                    "Accept": "text/html,application/xhtml+xml",
                    "Accept-Language": "en-US,en;q=0.9",
                },
            )
            if resp.status_code != 200:
                logger.warning(
                    f"[Congress] Capitol Trades page {page} returned {resp.status_code}"
                )
                break

            page_trades = _parse_trades_html(resp.text)
            all_trades.extend(page_trades)
            logger.info(
                f"[Congress] Page {page}: parsed {len(page_trades)} trades"
            )

            if not page_trades or len(page_trades) < 10:
                break  # no more data

        elapsed = (time.time() - start) * 1000
        logger.info(
            f"[Congress] Fetched {len(all_trades)} total trades in {elapsed:.0f}ms"
        )

        if all_trades:
            _trades_cache_data = all_trades
            _trades_cache_ts = time.time()
        elif _trades_cache_data is not None:
            # Upstream failed but we have stale data - keep it
            logger.warning("[Congress] No trades fetched, serving stale cache")

        return _trades_cache_data or []

    except Exception as e:
        logger.error(f"[Congress] Fetch error: {e}")
        # Return stale cache on error
        if _trades_cache_data is not None:
            logger.info("[Congress] Returning stale cache after error")
            return _trades_cache_data
        return []


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/trades")
async def congress_trades(
    politician: Optional[str] = Query(None, description="Filter by politician name (case-insensitive substring)"),
    tx_type: Optional[str] = Query(None, alias="txType", description="Filter by transaction type: buy, sell, exchange"),
    limit: int = Query(500, ge=1, le=1000, description="Max results to return"),
):
    """Return recent congressional stock/option trades scraped from Capitol Trades."""
    start = time.time()
    trades = await _fetch_trades()

    # Apply filters
    if politician:
        q = politician.lower()
        trades = [t for t in trades if q in t.get("politician", "").lower()]

    if tx_type:
        q = tx_type.lower()
        trades = [t for t in trades if t.get("txType", "").lower() == q]

    trades = trades[:limit]
    elapsed = (time.time() - start) * 1000

    return JSONResponse(
        content={
            "success": True,
            "trades": trades,
            "count": len(trades),
            "source": "capitoltrades.com",
            "cached": (time.time() - _trades_cache_ts) < _CACHE_TTL if _trades_cache_ts else False,
            "elapsed_ms": round(elapsed),
        },
        headers={"Cache-Control": "max-age=300"},
    )


@router.get("/status")
def congress_status():
    """Return health/status of the Congress trades data source."""
    cache_age = (
        round(time.time() - _trades_cache_ts) if _trades_cache_ts else None
    )
    return {
        "source": "capitoltrades.com",
        "cached_trades": len(_trades_cache_data) if _trades_cache_data else 0,
        "cache_age_seconds": cache_age,
        "cache_ttl_seconds": int(_CACHE_TTL),
        "cache_fresh": cache_age is not None and cache_age < _CACHE_TTL,
    }
