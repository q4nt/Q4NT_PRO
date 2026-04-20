# =============================================================================
# BOOKMAP DEPTH / ORDER FLOW ROUTER
# =============================================================================
# Provides REST + WebSocket endpoints for the Bookmap overlay:
#   GET  /api/bookmap/depth    - Order book depth snapshot (Binance)
#   GET  /api/bookmap/trades   - Recent trades with buy/sell side (Binance)
#   GET  /api/bookmap/status   - Connection status (Bookmap bridge vs fallback)
#   GET  /api/bookmap/symbols  - Available symbol list
#   WS   /ws/bookmap           - Live stream relay (bridge or Binance fallback)
#
# When the Bookmap L1 bridge is connected (via bookmap_bridge.py), data flows
# through it for richer order flow features. Otherwise, Binance public APIs
# serve as the fallback with the same visual style.
# =============================================================================

import time
import json
import asyncio
import logging
from typing import Dict, Any, List, Optional

import httpx
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

logger = logging.getLogger("q4nt.bookmap")

router = APIRouter(tags=["bookmap"])

# Shared httpx client for connection pooling
_bookmap_http: httpx.AsyncClient | None = None

def _client() -> httpx.AsyncClient:
    global _bookmap_http
    if _bookmap_http is None:
        _bookmap_http = httpx.AsyncClient(
            timeout=10.0,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _bookmap_http

# --- Simple TTL cache for depth snapshots ---
_depth_cache: Dict[str, Any] = {}  # key: "SYMBOL:LIMIT" -> {ts, data}
_DEPTH_CACHE_TTL = 2.0  # seconds

# --- Trade cache ---
_trade_cache: Dict[str, Any] = {}  # key: "SYMBOL" -> {ts, data}
_TRADE_CACHE_TTL = 1.0

# --- Bookmap bridge state ---
_bookmap_state = {
    "bridge_connected": False,
    "bridge_last_seen": 0,
    "source": "binance_fallback",
    "active_clients": [],  # WebSocket connections from frontend
}

# Common stock-to-crypto mapping for depth visualization
_STOCK_CRYPTO_MAP = {
    "AAPL": "BTCUSD",
    "MSFT": "ETHUSD",
    "GOOGL": "BTCUSD",
    "AMZN": "ETHUSD",
    "TSLA": "SOLUSD",
    "NVDA": "BTCUSD",
    "META": "ETHUSD",
    "SPY": "BTCUSD",
    "QQQ": "ETHUSD",
}

# Use Binance US (api.binance.com returns 451 from US IPs)
BINANCE_BASE_URL = "https://api.binance.us/api/v3"
BINANCE_DEPTH_URL = f"{BINANCE_BASE_URL}/depth"
BINANCE_TRADES_URL = f"{BINANCE_BASE_URL}/trades"
BINANCE_AGG_TRADES_URL = f"{BINANCE_BASE_URL}/aggTrades"


def _log_timing(label: str, start: float, extra: str = ""):
    elapsed = int((time.time() - start) * 1000)
    logger.info("[Bookmap] %s completed in %dms %s", label, elapsed, extra)


def _normalize_symbol(symbol: str) -> tuple:
    """Normalize symbol and return (normalized, is_mapped, original)."""
    sym = symbol.upper().replace("/", "").replace("-", "")
    original = sym
    is_mapped = False
    if sym in _STOCK_CRYPTO_MAP:
        sym = _STOCK_CRYPTO_MAP[sym]
        is_mapped = True
        logger.info("[Bookmap] Mapped stock %s -> crypto %s", original, sym)
    return sym, is_mapped, original


# =========================================================================== #
# REST Endpoints
# =========================================================================== #

@router.get("/bookmap/depth")
async def api_bookmap_depth(
    symbol: str = Query("BTCUSDT", description="Trading pair (e.g. BTCUSDT, ETHUSDT)"),
    limit: int = Query(100, description="Number of price levels (max 5000)"),
) -> Dict[str, Any]:
    """Fetch order book depth from Binance (free, no auth required).
    Returns bids and asks arrays of [price, quantity] pairs."""
    start_time = time.time()
    logger.info("[Bookmap] /api/bookmap/depth called: symbol=%s, limit=%d", symbol, limit)

    sym, is_mapped, original_symbol = _normalize_symbol(symbol)
    limit = max(5, min(limit, 5000))

    # Check cache
    cache_key = f"{sym}:{limit}"
    cached = _depth_cache.get(cache_key)
    if cached and (time.time() - cached["ts"]) < _DEPTH_CACHE_TTL:
        _log_timing("depth (cached)", start_time, f"({sym})")
        result = cached["data"].copy()
        if is_mapped:
            result["mapped_from"] = original_symbol
            result["source_note"] = f"Depth data from {sym} (crypto proxy for {original_symbol})"
        return result

    # Fetch from Binance
    try:
        resp = await _client().get(
            BINANCE_DEPTH_URL,
            params={"symbol": sym, "limit": limit},
        )
        resp.raise_for_status()
        data = resp.json()

        bids = [[float(b[0]), float(b[1])] for b in data.get("bids", [])]
        asks = [[float(a[0]), float(a[1])] for a in data.get("asks", [])]

        result = {
            "symbol": sym,
            "bids": bids,
            "asks": asks,
            "bid_count": len(bids),
            "ask_count": len(asks),
            "timestamp": int(time.time() * 1000),
            "source": "binance",
        }

        _depth_cache[cache_key] = {"ts": time.time(), "data": result}

        if is_mapped:
            result["mapped_from"] = original_symbol
            result["source_note"] = f"Depth data from {sym} (crypto proxy for {original_symbol})"

        _log_timing("depth", start_time, f"({sym}, {len(bids)} bids, {len(asks)} asks)")
        return result

    except httpx.HTTPStatusError as e:
        code = e.response.status_code
        body = e.response.text[:300]
        logger.error("[Bookmap] Binance HTTP %s: %s", code, body)
        if cached:
            logger.warning("[Bookmap] Returning stale cache for %s due to error", sym)
            return cached["data"]
        return JSONResponse(
            status_code=502,
            content={"error": f"Binance API error: HTTP {code}", "detail": body}
        )
    except Exception as e:
        logger.error("[Bookmap] Depth fetch error: %s", e)
        if cached:
            return cached["data"]
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )


@router.get("/bookmap/trades")
async def api_bookmap_trades(
    symbol: str = Query("BTCUSDT", description="Trading pair"),
    limit: int = Query(200, description="Number of recent trades (max 1000)"),
) -> Dict[str, Any]:
    """Fetch recent trades from Binance with buy/sell side indication.
    Each trade includes price, quantity, time, and whether it was a buyer-maker trade."""
    start_time = time.time()
    logger.info("[Bookmap] /api/bookmap/trades called: symbol=%s, limit=%d", symbol, limit)

    sym, is_mapped, original_symbol = _normalize_symbol(symbol)
    limit = max(1, min(limit, 1000))

    # Check cache
    cached = _trade_cache.get(sym)
    if cached and (time.time() - cached["ts"]) < _TRADE_CACHE_TTL:
        _log_timing("trades (cached)", start_time, f"({sym})")
        result = cached["data"].copy()
        if is_mapped:
            result["mapped_from"] = original_symbol
        return result

    try:
        resp = await _client().get(
            BINANCE_AGG_TRADES_URL,
            params={"symbol": sym, "limit": limit},
        )
        resp.raise_for_status()
        raw_trades = resp.json()

        # Transform: isBuyerMaker=true means the buyer placed a limit order,
        # so the trade was initiated by a seller (sell aggressor)
        trades = []
        for t in raw_trades:
            trades.append({
                "price": float(t.get("p", 0)),
                "quantity": float(t.get("q", 0)),
                "time": t.get("T", 0),
                "is_bid": not t.get("m", False),  # m=isBuyerMaker, inverted for aggressor side
                "id": t.get("a", 0),
            })

        result = {
            "symbol": sym,
            "trades": trades,
            "count": len(trades),
            "timestamp": int(time.time() * 1000),
            "source": "binance",
        }

        _trade_cache[sym] = {"ts": time.time(), "data": result}

        if is_mapped:
            result["mapped_from"] = original_symbol

        _log_timing("trades", start_time, f"({sym}, {len(trades)} trades)")
        return result

    except httpx.HTTPStatusError as e:
        code = e.response.status_code
        body = e.response.text[:300]
        logger.error("[Bookmap] Binance trades HTTP %s: %s", code, body)
        if cached:
            return cached["data"]
        return JSONResponse(
            status_code=502,
            content={"error": f"Binance API error: HTTP {code}", "detail": body}
        )
    except Exception as e:
        logger.error("[Bookmap] Trades fetch error: %s", e)
        if cached:
            return cached["data"]
        return JSONResponse(status_code=500, content={"error": str(e)})


@router.get("/bookmap/status")
async def api_bookmap_status() -> Dict[str, Any]:
    """Return current Bookmap connection status and data source."""
    bridge_connected = _bookmap_state["bridge_connected"]
    # Mark bridge as disconnected if no heartbeat for 10 seconds
    if bridge_connected and (time.time() - _bookmap_state["bridge_last_seen"]) > 10:
        _bookmap_state["bridge_connected"] = False
        _bookmap_state["source"] = "binance_fallback"
        bridge_connected = False

    return {
        "bookmap_connected": bridge_connected,
        "source": _bookmap_state["source"],
        "active_clients": len(_bookmap_state["active_clients"]),
        "bridge_last_seen": _bookmap_state["bridge_last_seen"],
        "timestamp": int(time.time() * 1000),
    }


@router.get("/bookmap/symbols")
async def api_bookmap_symbols() -> Dict[str, Any]:
    """Return commonly used symbols for depth visualization."""
    return {
        "crypto": [
            {"symbol": "BTCUSD", "label": "BTC/USD"},
            {"symbol": "ETHUSD", "label": "ETH/USD"},
            {"symbol": "SOLUSD", "label": "SOL/USD"},
            {"symbol": "XRPUSD", "label": "XRP/USD"},
            {"symbol": "DOGEUSD", "label": "DOGE/USD"},
            {"symbol": "AVAXUSD", "label": "AVAX/USD"},
        ],
        "stock_mappings": _STOCK_CRYPTO_MAP,
    }


# =========================================================================== #
# WebSocket: Live Stream Relay
# =========================================================================== #

@router.websocket("/ws/bookmap")
async def ws_bookmap(websocket: WebSocket, symbol: str = "BTCUSD"):
    """WebSocket endpoint for live Bookmap overlay data.
    - When Bookmap bridge is connected: relays L1 data (depth, trades, volume profile)
    - When bridge is disconnected: polls Binance depth + trades as fallback
    """
    await websocket.accept()
    _bookmap_state["active_clients"].append(websocket)
    logger.info("[Bookmap WS] Client connected, symbol=%s, total=%d",
                symbol, len(_bookmap_state["active_clients"]))

    sym, is_mapped, original = _normalize_symbol(symbol)

    try:
        # Send initial status
        await websocket.send_json({
            "type": "status",
            "source": _bookmap_state["source"],
            "bookmap_connected": _bookmap_state["bridge_connected"],
            "symbol": sym,
            "mapped_from": original if is_mapped else None,
        })

        # Fallback polling loop (Binance depth + trades)
        while True:
            try:
                # Check for incoming messages (non-blocking)
                try:
                    msg = await asyncio.wait_for(websocket.receive_text(), timeout=0.1)
                    data = json.loads(msg)

                    # Handle bridge handshake (from bookmap_bridge.py)
                    if data.get("type") == "handshake" and data.get("source") == "bookmap_l1":
                        _bookmap_state["bridge_connected"] = True
                        _bookmap_state["bridge_last_seen"] = time.time()
                        _bookmap_state["source"] = "bookmap"
                        logger.info("[Bookmap WS] Bridge connected!")
                        await websocket.send_json({"type": "pong"})
                        continue

                    # Handle bridge data relay
                    if data.get("source") == "bookmap":
                        _bookmap_state["bridge_last_seen"] = time.time()
                        # Broadcast to all connected frontend clients
                        for client in _bookmap_state["active_clients"]:
                            if client != websocket:
                                try:
                                    await client.send_json(data)
                                except Exception:
                                    pass
                        continue

                    # Handle symbol change from frontend
                    if data.get("type") == "set_symbol":
                        new_sym = data.get("symbol", "BTCUSD")
                        sym, is_mapped, original = _normalize_symbol(new_sym)
                        logger.info("[Bookmap WS] Symbol changed to %s", sym)
                        continue

                except asyncio.TimeoutError:
                    pass

                # Fallback: fetch from Binance and send to client
                if not _bookmap_state["bridge_connected"]:
                    client = _client()
                    # Fetch depth
                    try:
                        depth_resp = await client.get(
                            BINANCE_DEPTH_URL,
                            params={"symbol": sym, "limit": 100},
                            timeout=5.0,
                        )
                        if depth_resp.status_code == 200:
                            depth_data = depth_resp.json()
                            bids = [[float(b[0]), float(b[1])] for b in depth_data.get("bids", [])]
                            asks = [[float(a[0]), float(a[1])] for a in depth_data.get("asks", [])]

                            await websocket.send_json({
                                "type": "snapshot",
                                "symbol": sym,
                                "bids": bids,
                                "asks": asks,
                                "bid_count": len(bids),
                                "ask_count": len(asks),
                                "timestamp": int(time.time() * 1000),
                                "source": "binance_fallback",
                                "mapped_from": original if is_mapped else None,
                            })
                    except Exception as e:
                        logger.warning("[Bookmap WS] Depth fetch error: %s", e)

                    # Fetch recent trades
                    try:
                        trades_resp = await client.get(
                            BINANCE_AGG_TRADES_URL,
                            params={"symbol": sym, "limit": 50},
                            timeout=5.0,
                        )
                        if trades_resp.status_code == 200:
                            raw_trades = trades_resp.json()
                            trades = []
                            for t in raw_trades:
                                trades.append({
                                    "price": float(t.get("p", 0)),
                                    "quantity": float(t.get("q", 0)),
                                    "time": t.get("T", 0),
                                    "is_bid": not t.get("m", False),
                                })
                            await websocket.send_json({
                                "type": "trades",
                                "symbol": sym,
                                "trades": trades,
                                "timestamp": int(time.time() * 1000),
                                "source": "binance_fallback",
                            })
                    except Exception as e:
                        logger.warning("[Bookmap WS] Trades fetch error: %s", e)

                # Wait before next poll cycle
                await asyncio.sleep(2.0)

            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.error("[Bookmap WS] Loop error: %s", e)
                await asyncio.sleep(1.0)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("[Bookmap WS] Connection error: %s", e)
    finally:
        if websocket in _bookmap_state["active_clients"]:
            _bookmap_state["active_clients"].remove(websocket)
        logger.info("[Bookmap WS] Client disconnected, remaining=%d",
                    len(_bookmap_state["active_clients"]))
