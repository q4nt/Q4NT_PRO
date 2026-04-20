# =============================================================================
# CHARLES SCHWAB INTEGRATION ROUTER
# =============================================================================
# Supports: OAuth 2.0 auth flow, account info, positions, orders, quotes,
# market movers, options chains, price history.
# Auth: OAuth 2.0 Authorization Code Flow (access token in Bearer header)
# Docs: https://developer.schwab.com/
# =============================================================================

import os
import time
import json
import logging
import base64
from typing import Optional, Dict, Any, List

import httpx
from fastapi import APIRouter, Query

logger = logging.getLogger("q4nt.schwab")

# --- Configuration ---
SCHWAB_APP_KEY = os.getenv("SCHWAB_APP_KEY", "")
SCHWAB_APP_SECRET = os.getenv("SCHWAB_APP_SECRET", "")
SCHWAB_CALLBACK_URL = os.getenv("SCHWAB_CALLBACK_URL", "https://127.0.0.1:5052/api/schwab/callback")
SCHWAB_TOKEN_FILE = os.getenv("SCHWAB_TOKEN_FILE", "schwab_tokens.json")

SCHWAB_AUTH_URL = "https://api.schwabapi.com/v1/oauth/authorize"
SCHWAB_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token"
SCHWAB_TRADER_URL = "https://api.schwabapi.com/trader/v1"
SCHWAB_MARKETDATA_URL = "https://api.schwabapi.com/marketdata/v1"

SCHWAB_AVAILABLE = bool(SCHWAB_APP_KEY and SCHWAB_APP_SECRET)

router = APIRouter(tags=["schwab"])

# Shared httpx client for connection pooling
_schwab_http: httpx.AsyncClient | None = None

def _client() -> httpx.AsyncClient:
    global _schwab_http
    if _schwab_http is None:
        _schwab_http = httpx.AsyncClient(
            timeout=10.0,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _schwab_http

if SCHWAB_AVAILABLE:
    logger.info("[Schwab] Integration configured")
else:
    logger.warning("[Schwab] NOT configured -- set SCHWAB_APP_KEY and SCHWAB_APP_SECRET in .env")


def _log_timing(label: str, start: float, extra: str = ""):
    elapsed = int((time.time() - start) * 1000)
    logger.info("[Schwab] %s completed in %dms %s", label, elapsed, extra)


# ---- Token Management --------------------------------------------------------

def _token_path() -> str:
    return os.path.join(os.path.dirname(__file__), "..", SCHWAB_TOKEN_FILE)


def _load_tokens() -> Optional[Dict[str, Any]]:
    """Load stored OAuth tokens from file."""
    path = _token_path()
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r") as f:
            tokens = json.load(f)
        # Check expiry
        if tokens.get("expires_at", 0) > time.time():
            return tokens
        # Try refresh
        if tokens.get("refresh_token"):
            return _refresh_token(tokens["refresh_token"])
    except Exception as e:
        logger.warning("[Schwab] Failed to load tokens: %s", e)
    return None


def _save_tokens(tokens: Dict[str, Any]) -> None:
    """Persist OAuth tokens to disk."""
    try:
        with open(_token_path(), "w") as f:
            json.dump(tokens, f, indent=2)
        logger.info("[Schwab] Tokens saved")
    except Exception as e:
        logger.error("[Schwab] Failed to save tokens: %s", e)


def _refresh_token(refresh_token: str) -> Optional[Dict[str, Any]]:
    """Refresh access token using refresh token (synchronous)."""
    try:
        creds = base64.b64encode(f"{SCHWAB_APP_KEY}:{SCHWAB_APP_SECRET}".encode()).decode()
        import urllib.request
        import urllib.parse
        body = urllib.parse.urlencode({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }).encode()
        req = urllib.request.Request(
            SCHWAB_TOKEN_URL,
            data=body,
            headers={
                "Authorization": f"Basic {creds}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        tokens = {
            "access_token": data["access_token"],
            "refresh_token": data.get("refresh_token", refresh_token),
            "expires_at": time.time() + data.get("expires_in", 1800),
            "token_type": data.get("token_type", "Bearer"),
        }
        _save_tokens(tokens)
        logger.info("[Schwab] Token refreshed successfully")
        return tokens
    except Exception as e:
        logger.error("[Schwab] Token refresh error: %s", e)
        return None


def _auth_headers() -> Optional[Dict[str, str]]:
    """Get authorization headers with valid access token, or None."""
    tokens = _load_tokens()
    if not tokens:
        return None
    return {
        "Authorization": f"Bearer {tokens['access_token']}",
        "Accept": "application/json",
    }


# ---- OAuth Flow --------------------------------------------------------------

@router.get("/schwab/auth")
async def api_schwab_auth() -> Dict[str, Any]:
    """Get the OAuth authorization URL. User must visit this URL to log in."""
    if not SCHWAB_AVAILABLE:
        return {"error": "Schwab not configured. Add SCHWAB_APP_KEY and SCHWAB_APP_SECRET to .env"}
    auth_url = (
        f"{SCHWAB_AUTH_URL}"
        f"?client_id={SCHWAB_APP_KEY}"
        f"&redirect_uri={SCHWAB_CALLBACK_URL}"
        f"&response_type=code"
    )
    return {"auth_url": auth_url, "instruction": "Open this URL in your browser to authorize the app."}


@router.get("/schwab/callback")
async def api_schwab_callback(
    code: str = Query(..., description="Authorization code from Schwab"),
) -> Dict[str, Any]:
    """Handle OAuth callback; exchange authorization code for tokens."""
    if not SCHWAB_AVAILABLE:
        return {"error": "Schwab not configured"}
    try:
        creds = base64.b64encode(f"{SCHWAB_APP_KEY}:{SCHWAB_APP_SECRET}".encode()).decode()
        resp = await _client().post(
            SCHWAB_TOKEN_URL,
            headers={
                "Authorization": f"Basic {creds}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": SCHWAB_CALLBACK_URL,
            },
            timeout=15.0,
        )
        resp.raise_for_status()
        data = resp.json()

        tokens = {
            "access_token": data["access_token"],
            "refresh_token": data.get("refresh_token"),
            "expires_at": time.time() + data.get("expires_in", 1800),
            "token_type": data.get("token_type", "Bearer"),
        }
        _save_tokens(tokens)
        return {"status": "authenticated", "expires_in": data.get("expires_in", 1800)}
    except Exception as e:
        logger.error("[Schwab] OAuth callback error: %s", e)
        return {"error": str(e)}


@router.get("/schwab/status")
async def api_schwab_status() -> Dict[str, Any]:
    """Check if Schwab OAuth tokens are valid."""
    if not SCHWAB_AVAILABLE:
        return {"configured": False, "authenticated": False}
    tokens = _load_tokens()
    if tokens:
        return {
            "configured": True,
            "authenticated": True,
            "expires_at": tokens.get("expires_at"),
            "seconds_remaining": max(0, int(tokens.get("expires_at", 0) - time.time())),
        }
    return {"configured": True, "authenticated": False, "message": "Visit /api/schwab/auth to authenticate"}


# ---- Account -----------------------------------------------------------------

@router.get("/schwab/account")
async def api_schwab_account() -> Dict[str, Any]:
    """Get Schwab account info: balances, positions."""
    start_time = time.time()
    headers = _auth_headers()
    if not headers:
        return {"error": "Not authenticated. Visit /api/schwab/auth first."}
    try:
        resp = await _client().get(
            f"{SCHWAB_TRADER_URL}/accounts",
            headers=headers,
            params={"fields": "positions"},
        )
        resp.raise_for_status()
        data = resp.json()

        accounts = []
        for acct in data:
            sec = acct.get("securitiesAccount", {})
            balances = sec.get("currentBalances", {})
            positions_raw = sec.get("positions", [])
            positions = []
            for pos in positions_raw:
                inst = pos.get("instrument", {})
                positions.append({
                    "symbol": inst.get("symbol"),
                    "asset_type": inst.get("assetType"),
                    "quantity": pos.get("longQuantity", 0) - pos.get("shortQuantity", 0),
                    "market_value": pos.get("marketValue"),
                    "average_price": pos.get("averagePrice"),
                    "current_day_pl": pos.get("currentDayProfitLoss"),
                    "current_day_pl_pct": pos.get("currentDayProfitLossPercentage"),
                })
            accounts.append({
                "account_hash": acct.get("hashValue"),
                "account_type": sec.get("type"),
                "cash_balance": balances.get("cashBalance"),
                "equity": balances.get("equity"),
                "buying_power": balances.get("buyingPower"),
                "positions": positions,
                "position_count": len(positions),
            })
        _log_timing("account", start_time, f"({len(accounts)} accounts)")
        return {"accounts": accounts}
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            return {"error": "Token expired. Visit /api/schwab/auth to re-authenticate."}
        return {"error": f"Schwab API error: {e.response.status_code}"}
    except Exception as e:
        logger.error("[Schwab] Account error: %s", e)
        return {"error": str(e)}


# ---- Quotes ------------------------------------------------------------------

@router.get("/schwab/quotes")
async def api_schwab_quotes(
    symbols: str = Query(..., description="Comma-separated ticker symbols"),
    fields: str = Query("quote,fundamental", description="Fields: quote,fundamental,extended,reference,regular"),
) -> Dict[str, Any]:
    """Get real-time quotes from Schwab Market Data API."""
    start_time = time.time()
    headers = _auth_headers()
    if not headers:
        return {"error": "Not authenticated"}
    try:
        resp = await _client().get(
            f"{SCHWAB_MARKETDATA_URL}/quotes",
            headers=headers,
            params={"symbols": symbols, "fields": fields, "indicative": "false"},
        )
        resp.raise_for_status()
        data = resp.json()

        quotes = {}
        for sym, info in data.items():
            q = info.get("quote", {})
            f_data = info.get("fundamental", {})
            quotes[sym] = {
                "symbol": sym,
                "last_price": q.get("lastPrice"),
                "bid_price": q.get("bidPrice"),
                "ask_price": q.get("askPrice"),
                "open_price": q.get("openPrice"),
                "high_price": q.get("highPrice"),
                "low_price": q.get("lowPrice"),
                "close_price": q.get("closePrice"),
                "volume": q.get("totalVolume"),
                "net_change": q.get("netChange"),
                "net_pct_change": q.get("netPercentChange"),
                "52wk_high": q.get("52WkHigh"),
                "52wk_low": q.get("52WkLow"),
                "pe_ratio": f_data.get("peRatio"),
                "dividend_yield": f_data.get("divYield"),
                "market_cap": f_data.get("marketCap"),
            }
        _log_timing("quotes", start_time, f"({len(quotes)} symbols)")
        return {"quotes": quotes}
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            return {"error": "Token expired. Re-authenticate."}
        return {"error": f"Schwab API error: {e.response.status_code}"}
    except Exception as e:
        return {"error": str(e)}


# ---- Movers ------------------------------------------------------------------

@router.get("/schwab/movers")
async def api_schwab_movers(
    index: str = Query("$SPX.X", description="Index: $DJI, $COMPX, $SPX.X"),
    direction: str = Query("up", description="Direction: up, down"),
    change_type: str = Query("percent", description="Change type: percent, value"),
) -> Dict[str, Any]:
    """Get top market movers from Schwab."""
    start_time = time.time()
    headers = _auth_headers()
    if not headers:
        return {"error": "Not authenticated"}
    try:
        encoded_index = index.replace("$", "%24")
        resp = await _client().get(
            f"{SCHWAB_MARKETDATA_URL}/movers/{encoded_index}",
            headers=headers,
            params={"direction": direction, "change_type": change_type},
        )
        resp.raise_for_status()
        data = resp.json()

        movers = []
        for m in data.get("screeners", []):
            movers.append({
                "symbol": m.get("symbol"),
                "description": m.get("description"),
                "last_price": m.get("lastPrice"),
                "change": m.get("netChange"),
                "change_pct": m.get("netPercentChange"),
                "volume": m.get("totalVolume"),
                "direction": direction,
            })
        _log_timing("movers", start_time, f"({len(movers)} movers)")
        return {"movers": movers, "index": index, "direction": direction}
    except Exception as e:
        logger.error("[Schwab] Movers error: %s", e)
        return {"error": str(e)}


# ---- Options Chains ----------------------------------------------------------

@router.get("/schwab/chains")
async def api_schwab_options_chain(
    symbol: str = Query(..., description="Ticker symbol"),
    strike_count: int = Query(10, description="Strikes above/below ATM"),
    strategy: str = Query("SINGLE", description="SINGLE, VERTICAL, CALENDAR, STRANGLE, STRADDLE"),
) -> Dict[str, Any]:
    """Get options chain data from Schwab."""
    start_time = time.time()
    headers = _auth_headers()
    if not headers:
        return {"error": "Not authenticated"}
    try:
        resp = await _client().get(
            f"{SCHWAB_MARKETDATA_URL}/chains",
            headers=headers,
            params={
                "symbol": symbol.upper(),
                "strikeCount": strike_count,
                "strategy": strategy,
                "includeUnderlyingQuote": "true",
            },
            timeout=15.0,
        )
        resp.raise_for_status()
        data = resp.json()

        result = {
            "symbol": data.get("symbol"),
            "status": data.get("status"),
            "underlying_price": data.get("underlyingPrice"),
            "volatility": data.get("volatility"),
            "number_of_contracts": data.get("numberOfContracts"),
            "call_exp_dates": len(data.get("callExpDateMap", {})),
            "put_exp_dates": len(data.get("putExpDateMap", {})),
            "calls": data.get("callExpDateMap", {}),
            "puts": data.get("putExpDateMap", {}),
        }
        _log_timing("options_chain", start_time)
        return result
    except Exception as e:
        logger.error("[Schwab] Chains error: %s", e)
        return {"error": str(e)}


# ---- Price History -----------------------------------------------------------

@router.get("/schwab/pricehistory")
async def api_schwab_price_history(
    symbol: str = Query(..., description="Ticker symbol"),
    period_type: str = Query("month", description="day, month, year, ytd"),
    period: int = Query(1, description="Number of periods"),
    frequency_type: str = Query("daily", description="minute, daily, weekly, monthly"),
    frequency: int = Query(1, description="Frequency interval"),
) -> Dict[str, Any]:
    """Get historical price data from Schwab."""
    start_time = time.time()
    headers = _auth_headers()
    if not headers:
        return {"error": "Not authenticated"}
    try:
        resp = await _client().get(
            f"{SCHWAB_MARKETDATA_URL}/pricehistory",
            headers=headers,
            params={
                "symbol": symbol.upper(),
                "periodType": period_type,
                "period": period,
                "frequencyType": frequency_type,
                "frequency": frequency,
            },
        )
        resp.raise_for_status()
        data = resp.json()

        candles = data.get("candles", [])
        _log_timing("pricehistory", start_time, f"({len(candles)} candles)")
        return {"symbol": symbol, "candles": candles, "count": len(candles)}
    except Exception as e:
        logger.error("[Schwab] Price history error: %s", e)
        return {"error": str(e)}
