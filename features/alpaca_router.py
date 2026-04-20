# =============================================================================
# ALPACA TRADING INTEGRATION ROUTER
# =============================================================================
# Supports: account info, positions, orders (place/cancel), portfolio history,
# market clock/calendar, and asset tradability checks.
# Auth: APCA-API-KEY-ID + APCA-API-SECRET-KEY headers
# Docs: https://docs.alpaca.markets/reference
# =============================================================================

import os
import time
import logging
from typing import Optional, Dict, Any, List

import httpx
from fastapi import APIRouter, Query, HTTPException, Depends
from pydantic import BaseModel
from backend.core.auth import require_auth

logger = logging.getLogger("q4nt.alpaca")

# --- Configuration ---
ALPACA_API_KEY = os.getenv("ALPACA_API_KEY", "")
ALPACA_API_SECRET = os.getenv("ALPACA_API_SECRET", "")
ALPACA_BASE_URL = os.getenv("ALPACA_BASE_URL", "https://paper-api.alpaca.markets")
ALPACA_DATA_URL = "https://data.alpaca.markets"
ALPACA_AVAILABLE = bool(ALPACA_API_KEY and ALPACA_API_SECRET)

router = APIRouter(tags=["alpaca"])

# Shared httpx client for connection pooling across all Alpaca requests
_alpaca_http: httpx.AsyncClient | None = None

def _client() -> httpx.AsyncClient:
    global _alpaca_http
    if _alpaca_http is None:
        _alpaca_http = httpx.AsyncClient(
            timeout=10.0,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _alpaca_http

if ALPACA_AVAILABLE:
    logger.info("[Alpaca] Integration configured (base: %s)", ALPACA_BASE_URL)
else:
    logger.warning("[Alpaca] NOT configured -- set ALPACA_API_KEY and ALPACA_API_SECRET in .env")


def _headers() -> Dict[str, str]:
    return {
        "APCA-API-KEY-ID": ALPACA_API_KEY,
        "APCA-API-SECRET-KEY": ALPACA_API_SECRET,
        "Accept": "application/json",
    }


def _log_timing(label: str, start: float, extra: str = ""):
    elapsed = int((time.time() - start) * 1000)
    logger.info("[Alpaca] %s completed in %dms %s", label, elapsed, extra)


# ---- Connection Test (browser-safe, no CORS issues) -------------------------

class AlpacaConnectRequest(BaseModel):
    api_key: str
    api_secret: str
    base_url: str = "https://paper-api.alpaca.markets"


@router.post("/alpaca/test-connection")
async def api_alpaca_test_connection(req: AlpacaConnectRequest) -> Dict[str, Any]:
    """Test Alpaca credentials from the UI.  Proxies the request server-side
    so the browser does not need to send custom Alpaca auth headers directly
    (which would be blocked by CORS)."""
    global ALPACA_API_KEY, ALPACA_API_SECRET, ALPACA_BASE_URL, ALPACA_AVAILABLE

    # Normalise: strip trailing /v2 or /v2/ so we build clean URLs
    base = req.base_url.rstrip("/")
    if base.endswith("/v2"):
        base = base[:-3]

    headers = {
        "APCA-API-KEY-ID": req.api_key,
        "APCA-API-SECRET-KEY": req.api_secret,
        "Accept": "application/json",
    }

    try:
        client = _client()
        # 1. Fetch account
        acct_resp = await client.get(f"{base}/v2/account", headers=headers, timeout=10.0)
        acct_resp.raise_for_status()
        acct = acct_resp.json()

        # 2. Fetch positions
        pos_resp = await client.get(f"{base}/v2/positions", headers=headers, timeout=10.0)
        positions = pos_resp.json() if pos_resp.status_code == 200 else []

        # Persist credentials so the rest of the router can use them
        ALPACA_API_KEY = req.api_key
        ALPACA_API_SECRET = req.api_secret
        ALPACA_BASE_URL = base
        ALPACA_AVAILABLE = True
        logger.info("[Alpaca] Connection test succeeded -- credentials stored (base: %s)", base)

        return {
            "connected": True,
            "account": {
                "account_number": acct.get("account_number"),
                "status": acct.get("status"),
                "equity": acct.get("equity"),
                "cash": acct.get("cash"),
                "buying_power": acct.get("buying_power"),
                "portfolio_value": acct.get("portfolio_value"),
                "last_equity": acct.get("last_equity"),
                "long_market_value": acct.get("long_market_value"),
                "short_market_value": acct.get("short_market_value"),
                "daytrade_count": acct.get("daytrade_count"),
                "pattern_day_trader": acct.get("pattern_day_trader"),
                "trading_blocked": acct.get("trading_blocked"),
                "account_blocked": acct.get("account_blocked"),
                "currency": acct.get("currency", "USD"),
            },
            "positions": positions if isinstance(positions, list) else [],
        }
    except httpx.HTTPStatusError as e:
        code = e.response.status_code
        body = e.response.text[:300]
        logger.error("[Alpaca] Test-connection HTTP %s: %s", code, body)
        return {"connected": False, "error": f"Alpaca returned HTTP {code}", "detail": body}
    except Exception as e:
        logger.error("[Alpaca] Test-connection error: %s", e)
        return {"connected": False, "error": str(e)}


# ---- Account ----------------------------------------------------------------

@router.get("/alpaca/account")
async def api_alpaca_account() -> Dict[str, Any]:
    """Get Alpaca trading account info: equity, cash, buying power, status."""
    start_time = time.time()
    if not ALPACA_AVAILABLE:
        return {"error": "Alpaca not configured. Add ALPACA_API_KEY and ALPACA_API_SECRET to .env"}
    try:
        resp = await _client().get(
            f"{ALPACA_BASE_URL}/v2/account",
            headers=_headers(),
        )
        resp.raise_for_status()
        data = resp.json()
        result = {
            "account_number": data.get("account_number"),
            "status": data.get("status"),
            "equity": data.get("equity"),
            "cash": data.get("cash"),
            "buying_power": data.get("buying_power"),
            "portfolio_value": data.get("portfolio_value"),
            "last_equity": data.get("last_equity"),
            "long_market_value": data.get("long_market_value"),
            "short_market_value": data.get("short_market_value"),
            "daytrade_count": data.get("daytrade_count"),
            "pattern_day_trader": data.get("pattern_day_trader"),
            "trading_blocked": data.get("trading_blocked"),
            "account_blocked": data.get("account_blocked"),
            "currency": data.get("currency", "USD"),
        }
        _log_timing("account", start_time)
        return result
    except httpx.HTTPStatusError as e:
        logger.error("[Alpaca] Account HTTP %s: %s", e.response.status_code, e.response.text[:200])
        return {"error": f"Alpaca API error: {e.response.status_code}"}
    except Exception as e:
        logger.error("[Alpaca] Account error: %s", e)
        return {"error": str(e)}


# ---- Positions ---------------------------------------------------------------

@router.get("/alpaca/positions")
async def api_alpaca_positions(
    symbol: Optional[str] = Query(None, description="Optional: filter to specific ticker"),
) -> Dict[str, Any]:
    """Get open positions from Alpaca with current P&L."""
    start_time = time.time()
    if not ALPACA_AVAILABLE:
        return {"error": "Alpaca not configured"}
    try:
        url = f"{ALPACA_BASE_URL}/v2/positions"
        if symbol:
            url = f"{url}/{symbol.upper()}"
        resp = await _client().get(url, headers=_headers())
        resp.raise_for_status()
        data = resp.json()

        positions = [data] if isinstance(data, dict) else data
        results = []
        for p in positions:
            results.append({
                "symbol": p.get("symbol"),
                "qty": p.get("qty"),
                "side": p.get("side"),
                "market_value": p.get("market_value"),
                "cost_basis": p.get("cost_basis"),
                "avg_entry_price": p.get("avg_entry_price"),
                "current_price": p.get("current_price"),
                "unrealized_pl": p.get("unrealized_pl"),
                "unrealized_plpc": p.get("unrealized_plpc"),
                "change_today": p.get("change_today"),
                "asset_class": p.get("asset_class"),
            })
        _log_timing("positions", start_time, f"({len(results)} positions)")
        return {"positions": results, "count": len(results)}
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404 and symbol:
            return {"positions": [], "count": 0, "message": f"No position for {symbol}"}
        return {"error": f"Alpaca API error: {e.response.status_code}"}
    except Exception as e:
        logger.error("[Alpaca] Positions error: %s", e)
        return {"error": str(e)}


# ---- Orders ------------------------------------------------------------------

class AlpacaOrderRequest(BaseModel):
    symbol: str
    qty: float
    side: str  # buy | sell
    type: str  # market | limit | stop | stop_limit
    time_in_force: str  # day | gtc | ioc | fok
    limit_price: Optional[float] = None
    stop_price: Optional[float] = None


@router.post("/alpaca/orders", dependencies=[Depends(require_auth)])
async def api_alpaca_place_order(req: AlpacaOrderRequest) -> Dict[str, Any]:
    """Place a new order through Alpaca."""
    from backend.core.validators import validate_ticker
    symbol = validate_ticker(req.symbol)
    
    start_time = time.time()
    logger.info("[Alpaca] Order: %s %s %s (%s)", req.side, req.qty, symbol, req.type)
    if not ALPACA_AVAILABLE:
        return {"error": "Alpaca not configured"}
    try:
        order_data: Dict[str, Any] = {
            "symbol": symbol,
            "qty": str(req.qty),
            "side": req.side,
            "type": req.type,
            "time_in_force": req.time_in_force,
        }
        if req.limit_price is not None:
            order_data["limit_price"] = str(req.limit_price)
        if req.stop_price is not None:
            order_data["stop_price"] = str(req.stop_price)

        resp = await _client().post(
            f"{ALPACA_BASE_URL}/v2/orders",
            headers=_headers(),
            json=order_data,
        )
        resp.raise_for_status()
        data = resp.json()

        _log_timing("place_order", start_time)
        return {
            "order_id": data.get("id"),
            "client_order_id": data.get("client_order_id"),
            "symbol": data.get("symbol"),
            "qty": data.get("qty"),
            "side": data.get("side"),
            "type": data.get("type"),
            "time_in_force": data.get("time_in_force"),
            "status": data.get("status"),
            "created_at": data.get("created_at"),
            "limit_price": data.get("limit_price"),
            "stop_price": data.get("stop_price"),
        }
    except httpx.HTTPStatusError as e:
        logger.error("[Alpaca] Order HTTP %s: %s", e.response.status_code, e.response.text[:300])
        return {"error": f"Order rejected: {e.response.text[:200]}"}
    except Exception as e:
        logger.error("[Alpaca] Order error: %s", e)
        return {"error": str(e)}


@router.get("/alpaca/orders")
async def api_alpaca_list_orders(
    status: str = Query("open", description="Filter: open, closed, all"),
    limit: int = Query(20, description="Max orders to return"),
) -> Dict[str, Any]:
    """List recent orders from Alpaca."""
    start_time = time.time()
    if not ALPACA_AVAILABLE:
        return {"error": "Alpaca not configured"}
    try:
        resp = await _client().get(
            f"{ALPACA_BASE_URL}/v2/orders",
            headers=_headers(),
            params={"status": status, "limit": limit, "direction": "desc"},
        )
        resp.raise_for_status()
        data = resp.json()

        orders = []
        for o in data:
            orders.append({
                "order_id": o.get("id"),
                "symbol": o.get("symbol"),
                "qty": o.get("qty"),
                "filled_qty": o.get("filled_qty"),
                "side": o.get("side"),
                "type": o.get("type"),
                "status": o.get("status"),
                "created_at": o.get("created_at"),
                "filled_at": o.get("filled_at"),
                "filled_avg_price": o.get("filled_avg_price"),
                "limit_price": o.get("limit_price"),
                "stop_price": o.get("stop_price"),
            })
        _log_timing("list_orders", start_time, f"({len(orders)} orders)")
        return {"orders": orders, "count": len(orders)}
    except Exception as e:
        logger.error("[Alpaca] Orders error: %s", e)
        return {"error": str(e)}


@router.delete("/alpaca/orders/{order_id}", dependencies=[Depends(require_auth)])
async def api_alpaca_cancel_order(order_id: str) -> Dict[str, Any]:
    """Cancel a specific order by ID."""
    if not ALPACA_AVAILABLE:
        return {"error": "Alpaca not configured"}
    try:
        resp = await _client().delete(
            f"{ALPACA_BASE_URL}/v2/orders/{order_id}",
            headers=_headers(),
        )
        if resp.status_code == 204:
            return {"status": "cancelled", "order_id": order_id}
        resp.raise_for_status()
        return {"status": "cancel_requested", "order_id": order_id}
    except httpx.HTTPStatusError as e:
        return {"error": f"Cancel failed: {e.response.status_code}"}
    except Exception as e:
        return {"error": str(e)}


# ---- Portfolio History -------------------------------------------------------

@router.get("/alpaca/portfolio/history")
async def api_alpaca_portfolio_history(
    period: str = Query("1M", description="Period: 1D, 1W, 1M, 3M, 1A"),
    timeframe: str = Query("1D", description="Bar size: 1Min, 5Min, 15Min, 1H, 1D"),
) -> Dict[str, Any]:
    """Get portfolio equity history over time."""
    start_time = time.time()
    if not ALPACA_AVAILABLE:
        return {"error": "Alpaca not configured"}
    try:
        resp = await _client().get(
            f"{ALPACA_BASE_URL}/v2/account/portfolio/history",
            headers=_headers(),
            params={"period": period, "timeframe": timeframe},
        )
        resp.raise_for_status()
        data = resp.json()
        _log_timing("portfolio_history", start_time)
        return data
    except Exception as e:
        logger.error("[Alpaca] Portfolio history error: %s", e)
        return {"error": str(e)}


# ---- Market Clock & Assets ---------------------------------------------------

@router.get("/alpaca/market/clock")
async def api_alpaca_market_clock() -> Dict[str, Any]:
    """Get current market open/close status and next open/close times."""
    if not ALPACA_AVAILABLE:
        return {"error": "Alpaca not configured"}
    try:
        resp = await _client().get(
            f"{ALPACA_BASE_URL}/v2/clock",
            headers=_headers(),
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        return {"error": str(e)}


@router.get("/alpaca/assets/{symbol}")
async def api_alpaca_asset_info(symbol: str) -> Dict[str, Any]:
    """Check if an asset is tradable and get its details."""
    from backend.core.validators import validate_ticker
    symbol = validate_ticker(symbol)
    
    if not ALPACA_AVAILABLE:
        return {"error": "Alpaca not configured"}
    try:
        resp = await _client().get(
            f"{ALPACA_BASE_URL}/v2/assets/{symbol}",
            headers=_headers(),
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "symbol": data.get("symbol"),
            "name": data.get("name"),
            "exchange": data.get("exchange"),
            "asset_class": data.get("class"),
            "tradable": data.get("tradable"),
            "fractionable": data.get("fractionable"),
            "shortable": data.get("shortable"),
            "status": data.get("status"),
        }
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return {"error": f"Asset {symbol} not found", "tradable": False}
        return {"error": str(e)}
    except Exception as e:
        return {"error": str(e)}
