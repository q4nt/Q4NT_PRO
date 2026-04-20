# =============================================================================
# DXFEED DEPTH / ORDER FLOW ROUTER (Native dxLink WebSocket Integration)
# =============================================================================
# Connects directly to the dxFeed dxLink WebSocket endpoint for real-time
# market depth (Order events) and trades (Trade events).
#
#   GET  /api/dxfeed/depth    - Accumulated order book snapshot
#   GET  /api/dxfeed/trades   - Rolling trade history
#   GET  /api/dxfeed/status   - dxFeed connection status
#   GET  /api/dxfeed/symbols  - Available symbols + active subscriptions
#   WS   /ws/dxfeed           - Live stream relay to frontend
#
# DXLINK PROTOCOL:
#   1. Connect to wss://demo.dxfeed.com/dxlink-ws (or custom endpoint)
#   2. Send SETUP message with version + keepalive config
#   3. Authenticate via AUTH message (bearer token)
#   4. Open FEED channel with AUTO contract
#   5. Subscribe to Order + Trade events via FEED_SUBSCRIPTION
#   6. Receive FEED_DATA messages with order book / trade updates
#
# CONFIG:
#   DXFEED_API_TOKEN  - Bearer token (demo endpoint works without one)
#   DXFEED_WS_URL     - WebSocket URL (default: wss://demo.dxfeed.com/dxlink-ws)
# =============================================================================

import os
import time
import json
import asyncio
import logging
from typing import Dict, Any, List, Optional
from collections import defaultdict

import httpx
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

logger = logging.getLogger("q4nt.dxfeed")

router = APIRouter(tags=["dxfeed"])

# --- dxFeed configuration ---
DXFEED_API_TOKEN = os.environ.get("DXFEED_API_TOKEN", "")
DXFEED_WS_URL = os.environ.get("DXFEED_WS_URL", "wss://demo.dxfeed.com/dxlink-ws")

# --- Internal state ---
_dxfeed_state = {
    "connected": False,
    "last_heartbeat": 0,
    "source": "dxfeed",
    "channel_id": None,
    "subscribed_symbols": [],
    "error": None,
    "reconnect_count": 0,
    "ws_connection": None,       # reference to the upstream dxLink WS
    "bg_task": None,             # background asyncio task handle
}

# Order book: symbol -> { bids: {price: size}, asks: {price: size} }
_order_book: Dict[str, Dict[str, Dict[float, float]]] = defaultdict(
    lambda: {"bids": {}, "asks": {}}
)

# Trade history: symbol -> [{price, quantity, time, is_bid}, ...]
_trade_history: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
_TRADE_HISTORY_MAX = 500

# Frontend WebSocket clients listening for live updates
_frontend_clients: List[WebSocket] = []

# dxLink protocol constants
_DXLINK_VERSION = "0.1-DXF-JS/0.3.0"
_DXLINK_KEEPALIVE_MS = 30000
_CHANNEL_COUNTER = 1


def _log_timing(label: str, start: float, extra: str = ""):
    elapsed = int((time.time() - start) * 1000)
    logger.info("[dxFeed] %s completed in %dms %s", label, elapsed, extra)


# =========================================================================== #
# dxLink WebSocket Client (background task)
# =========================================================================== #

async def _dxlink_connect_and_stream():
    """Maintain a persistent WebSocket connection to dxFeed's dxLink endpoint.
    Subscribes to Order + Trade events and accumulates data into the order book."""
    global _CHANNEL_COUNTER

    import websockets  # type: ignore

    while True:
        try:
            logger.info("[dxFeed] Connecting to %s ...", DXFEED_WS_URL)
            _dxfeed_state["error"] = None

            async with websockets.connect(
                DXFEED_WS_URL,
                additional_headers={"User-Agent": "Q4NT/1.0"},
                ping_interval=20,
                ping_timeout=10,
                close_timeout=5,
            ) as ws:
                _dxfeed_state["ws_connection"] = ws
                logger.info("[dxFeed] WebSocket connected")

                # Step 1: Send SETUP message
                setup_msg = {
                    "type": "SETUP",
                    "channel": 0,
                    "version": _DXLINK_VERSION,
                    "keepaliveTimeout": _DXLINK_KEEPALIVE_MS,
                    "acceptKeepaliveTimeout": _DXLINK_KEEPALIVE_MS,
                }
                await ws.send(json.dumps(setup_msg))
                logger.info("[dxFeed] Sent SETUP message")

                # Step 2: Authenticate (if token provided)
                if DXFEED_API_TOKEN:
                    auth_msg = {
                        "type": "AUTH",
                        "channel": 0,
                        "token": DXFEED_API_TOKEN,
                    }
                    await ws.send(json.dumps(auth_msg))
                    logger.info("[dxFeed] Sent AUTH message")

                # Wait for AUTH_STATE or SETUP response
                response = await asyncio.wait_for(ws.recv(), timeout=10.0)
                resp_data = json.loads(response)
                logger.info("[dxFeed] Setup response: %s", json.dumps(resp_data)[:200])

                # Step 3: Open FEED channel
                channel_id = _CHANNEL_COUNTER
                _CHANNEL_COUNTER += 1
                _dxfeed_state["channel_id"] = channel_id

                open_channel_msg = {
                    "type": "CHANNEL_REQUEST",
                    "channel": channel_id,
                    "service": "FEED",
                    "parameters": {
                        "contract": "AUTO",
                    },
                }
                await ws.send(json.dumps(open_channel_msg))
                logger.info("[dxFeed] Opened FEED channel %d", channel_id)

                # Wait for channel confirmation
                response = await asyncio.wait_for(ws.recv(), timeout=10.0)
                resp_data = json.loads(response)
                logger.info("[dxFeed] Channel response: %s", json.dumps(resp_data)[:200])

                _dxfeed_state["connected"] = True
                _dxfeed_state["last_heartbeat"] = time.time()

                # Step 4: Send FEED_SETUP to configure accepted event fields
                feed_setup_msg = {
                    "type": "FEED_SETUP",
                    "channel": channel_id,
                    "acceptDataFormat": "COMPACT",
                    "acceptEventFields": {
                        "Order": [
                            "eventSymbol", "eventTime", "index", "time",
                            "sequence", "price", "size", "orderSide",
                            "exchangeCode", "scope", "marketMaker"
                        ],
                        "Trade": [
                            "eventSymbol", "eventTime", "time", "price",
                            "size", "exchangeCode", "dayVolume", "tickDirection"
                        ],
                        "Quote": [
                            "eventSymbol", "eventTime",
                            "bidPrice", "bidSize", "bidTime",
                            "askPrice", "askSize", "askTime"
                        ],
                    },
                }
                await ws.send(json.dumps(feed_setup_msg))
                logger.info("[dxFeed] Sent FEED_SETUP")

                # Step 5: Subscribe to default symbols
                default_symbols = _dxfeed_state.get("subscribed_symbols", [])
                if not default_symbols:
                    default_symbols = ["AAPL"]
                    _dxfeed_state["subscribed_symbols"] = default_symbols

                subs = []
                for sym in default_symbols:
                    subs.append({"type": "Order", "symbol": sym})
                    subs.append({"type": "Trade", "symbol": sym})
                    subs.append({"type": "Quote", "symbol": sym})

                sub_msg = {
                    "type": "FEED_SUBSCRIPTION",
                    "channel": channel_id,
                    "add": subs,
                }
                await ws.send(json.dumps(sub_msg))
                logger.info("[dxFeed] Subscribed to %s", default_symbols)

                # Step 6: Main receive loop
                async for raw_message in ws:
                    try:
                        msg = json.loads(raw_message)
                        msg_type = msg.get("type", "")
                        _dxfeed_state["last_heartbeat"] = time.time()

                        if msg_type == "KEEPALIVE":
                            # Respond with keepalive
                            await ws.send(json.dumps({
                                "type": "KEEPALIVE",
                                "channel": 0
                            }))
                            continue

                        if msg_type == "FEED_DATA":
                            await _process_feed_data(msg)
                            continue

                        if msg_type == "CHANNEL_OPENED":
                            logger.info("[dxFeed] Channel confirmed: %s", msg)
                            continue

                        if msg_type == "AUTH_STATE":
                            state = msg.get("state", "UNKNOWN")
                            logger.info("[dxFeed] Auth state: %s", state)
                            if state == "UNAUTHORIZED":
                                _dxfeed_state["error"] = "Authentication failed"
                            continue

                        if msg_type == "ERROR":
                            logger.error("[dxFeed] Server error: %s", msg)
                            _dxfeed_state["error"] = msg.get("message", "Unknown error")
                            continue

                        # Log other messages
                        logger.debug("[dxFeed] Received: %s", msg_type)

                    except json.JSONDecodeError:
                        logger.warning("[dxFeed] Non-JSON message: %s", raw_message[:100])

        except asyncio.CancelledError:
            logger.info("[dxFeed] Background task cancelled")
            break
        except Exception as e:
            _dxfeed_state["connected"] = False
            _dxfeed_state["error"] = str(e)
            _dxfeed_state["reconnect_count"] += 1
            logger.error("[dxFeed] Connection error: %s (reconnect #%d)",
                         e, _dxfeed_state["reconnect_count"])
            # Exponential backoff: 2s, 4s, 8s, ... up to 30s
            delay = min(2 ** _dxfeed_state["reconnect_count"], 30)
            logger.info("[dxFeed] Reconnecting in %ds...", delay)
            await asyncio.sleep(delay)


async def _process_feed_data(msg: Dict[str, Any]):
    """Process incoming FEED_DATA messages from dxLink.
    Handles both COMPACT and FULL data formats."""
    data = msg.get("data", [])
    if not data:
        return

    # Data can be in COMPACT format: [EventType, [field1, field2, ...], [val1, val2, ...], ...]
    # Or FULL format: [{eventSymbol, price, size, ...}, ...]
    i = 0
    while i < len(data):
        item = data[i]

        # COMPACT format: string EventType followed by field arrays
        if isinstance(item, str):
            event_type = item
            i += 1
            # Next items are arrays of field values
            while i < len(data) and isinstance(data[i], list):
                values = data[i]
                i += 1
                await _dispatch_event(event_type, values)
            continue

        # FULL format: dict with eventType field
        if isinstance(item, dict):
            event_type = item.get("eventType", item.get("type", ""))
            await _dispatch_event_dict(event_type, item)
            i += 1
            continue

        i += 1


async def _dispatch_event(event_type: str, values: list):
    """Process a single event in COMPACT format (array of values)."""
    # Compact format varies by event type, but typically:
    # Order: [eventSymbol, eventTime, index, time, sequence, price, size, orderSide, ...]
    # Trade: [eventSymbol, eventTime, time, price, size, exchangeCode, dayVolume, tickDirection]
    # Quote: [eventSymbol, eventTime, bidPrice, bidSize, bidTime, askPrice, askSize, askTime]

    if not values or len(values) < 4:
        return

    symbol = str(values[0]) if values[0] else ""
    if not symbol:
        return

    if event_type == "Order":
        await _handle_order_event(symbol, values)
    elif event_type == "Trade":
        await _handle_trade_event(symbol, values)
    elif event_type == "Quote":
        await _handle_quote_event(symbol, values)


async def _dispatch_event_dict(event_type: str, event: dict):
    """Process a single event in FULL (dict) format."""
    symbol = event.get("eventSymbol", "")
    if not symbol:
        return

    if event_type == "Order":
        price = float(event.get("price", 0))
        size = float(event.get("size", 0))
        side = event.get("orderSide", "").upper()
        if price > 0:
            book = _order_book[symbol]
            if side == "BUY" or side == "BID":
                if size > 0:
                    book["bids"][price] = size
                else:
                    book["bids"].pop(price, None)
            elif side == "SELL" or side == "ASK":
                if size > 0:
                    book["asks"][price] = size
                else:
                    book["asks"].pop(price, None)
            await _broadcast_depth_update(symbol)

    elif event_type == "Trade":
        trade = {
            "price": float(event.get("price", 0)),
            "quantity": float(event.get("size", 0)),
            "time": int(event.get("time", 0)),
            "is_bid": event.get("tickDirection", "").startswith("UP") or
                      event.get("tickDirection", "") == "ZERO_UP",
        }
        _trade_history[symbol].append(trade)
        if len(_trade_history[symbol]) > _TRADE_HISTORY_MAX:
            _trade_history[symbol] = _trade_history[symbol][-_TRADE_HISTORY_MAX:]
        await _broadcast_trade_update(symbol, trade)

    elif event_type == "Quote":
        # Use Quote data to populate top-of-book
        book = _order_book[symbol]
        bid_price = float(event.get("bidPrice", 0))
        ask_price = float(event.get("askPrice", 0))
        bid_size = float(event.get("bidSize", 0))
        ask_size = float(event.get("askSize", 0))
        if bid_price > 0:
            book["bids"][bid_price] = bid_size
        if ask_price > 0:
            book["asks"][ask_price] = ask_size
        await _broadcast_depth_update(symbol)


async def _handle_order_event(symbol: str, values: list):
    """Handle Order event in COMPACT format."""
    # Expected fields: eventSymbol, eventTime, index, time, sequence, price, size, orderSide, ...
    try:
        price = float(values[5]) if len(values) > 5 and values[5] is not None else 0
        size = float(values[6]) if len(values) > 6 and values[6] is not None else 0
        side_val = values[7] if len(values) > 7 else ""
    except (ValueError, TypeError, IndexError):
        return

    if price <= 0:
        return

    side = str(side_val).upper()
    book = _order_book[symbol]

    if side in ("BUY", "BID", "B"):
        if size > 0:
            book["bids"][price] = size
        else:
            book["bids"].pop(price, None)
    elif side in ("SELL", "ASK", "S"):
        if size > 0:
            book["asks"][price] = size
        else:
            book["asks"].pop(price, None)

    await _broadcast_depth_update(symbol)


async def _handle_trade_event(symbol: str, values: list):
    """Handle Trade event in COMPACT format."""
    try:
        price = float(values[3]) if len(values) > 3 and values[3] is not None else 0
        size = float(values[4]) if len(values) > 4 and values[4] is not None else 0
        trade_time = int(values[2]) if len(values) > 2 and values[2] is not None else 0
        tick_dir = str(values[7]) if len(values) > 7 else ""
    except (ValueError, TypeError, IndexError):
        return

    if price <= 0:
        return

    trade = {
        "price": price,
        "quantity": size,
        "time": trade_time,
        "is_bid": tick_dir.startswith("UP") or tick_dir == "ZERO_UP",
    }

    _trade_history[symbol].append(trade)
    if len(_trade_history[symbol]) > _TRADE_HISTORY_MAX:
        _trade_history[symbol] = _trade_history[symbol][-_TRADE_HISTORY_MAX:]

    await _broadcast_trade_update(symbol, trade)


async def _handle_quote_event(symbol: str, values: list):
    """Handle Quote event in COMPACT format."""
    try:
        bid_price = float(values[2]) if len(values) > 2 and values[2] is not None else 0
        bid_size = float(values[3]) if len(values) > 3 and values[3] is not None else 0
        ask_price = float(values[5]) if len(values) > 5 and values[5] is not None else 0
        ask_size = float(values[6]) if len(values) > 6 and values[6] is not None else 0
    except (ValueError, TypeError, IndexError):
        return

    book = _order_book[symbol]
    if bid_price > 0:
        book["bids"][bid_price] = bid_size
    if ask_price > 0:
        book["asks"][ask_price] = ask_size

    await _broadcast_depth_update(symbol)


async def _broadcast_depth_update(symbol: str):
    """Push order book snapshot to all connected frontend clients."""
    if not _frontend_clients:
        return

    book = _order_book.get(symbol, {"bids": {}, "asks": {}})
    bids = sorted(book["bids"].items(), key=lambda x: x[0], reverse=True)
    asks = sorted(book["asks"].items(), key=lambda x: x[0])

    snapshot = {
        "type": "snapshot",
        "symbol": symbol,
        "bids": [[p, s] for p, s in bids[:200]],
        "asks": [[p, s] for p, s in asks[:200]],
        "bid_count": len(bids),
        "ask_count": len(asks),
        "timestamp": int(time.time() * 1000),
        "source": "dxfeed",
    }

    dead_clients = []
    for client in _frontend_clients:
        try:
            await client.send_json(snapshot)
        except Exception:
            dead_clients.append(client)

    for dc in dead_clients:
        if dc in _frontend_clients:
            _frontend_clients.remove(dc)


async def _broadcast_trade_update(symbol: str, trade: Dict):
    """Push a single trade to all connected frontend clients."""
    if not _frontend_clients:
        return

    msg = {
        "type": "trade",
        "symbol": symbol,
        "trade": trade,
        "timestamp": int(time.time() * 1000),
        "source": "dxfeed",
    }

    dead_clients = []
    for client in _frontend_clients:
        try:
            await client.send_json(msg)
        except Exception:
            dead_clients.append(client)

    for dc in dead_clients:
        if dc in _frontend_clients:
            _frontend_clients.remove(dc)


# =========================================================================== #
# Background task lifecycle (start on first request, auto-reconnect)
# =========================================================================== #

def _ensure_dxlink_running():
    """Start the background dxLink connection if not already running."""
    if _dxfeed_state["bg_task"] is None or _dxfeed_state["bg_task"].done():
        try:
            loop = asyncio.get_event_loop()
            _dxfeed_state["bg_task"] = loop.create_task(_dxlink_connect_and_stream())
            logger.info("[dxFeed] Started background dxLink connection task")
        except RuntimeError:
            logger.warning("[dxFeed] Cannot start background task - no event loop")


# =========================================================================== #
# REST Endpoints
# =========================================================================== #

@router.get("/dxfeed/depth")
async def api_dxfeed_depth(
    symbol: str = Query("AAPL", description="Instrument symbol (e.g. AAPL, MSFT, SPY)"),
    limit: int = Query(100, description="Max number of price levels per side"),
) -> Dict[str, Any]:
    """Return the accumulated order book depth for a symbol.
    Data comes directly from dxFeed Order events."""
    start_time = time.time()
    logger.info("[dxFeed] /api/dxfeed/depth: symbol=%s, limit=%d", symbol, limit)

    # Ensure dxLink connection is running
    _ensure_dxlink_running()

    # Subscribe to this symbol if not already subscribed
    sym = symbol.upper()
    if sym not in _dxfeed_state.get("subscribed_symbols", []):
        await _subscribe_symbol(sym)

    limit = max(5, min(limit, 5000))
    book = _order_book.get(sym, {"bids": {}, "asks": {}})
    bids = sorted(book["bids"].items(), key=lambda x: x[0], reverse=True)[:limit]
    asks = sorted(book["asks"].items(), key=lambda x: x[0])[:limit]

    result = {
        "symbol": sym,
        "bids": [[p, s] for p, s in bids],
        "asks": [[p, s] for p, s in asks],
        "bid_count": len(bids),
        "ask_count": len(asks),
        "timestamp": int(time.time() * 1000),
        "source": "dxfeed",
    }

    _log_timing("depth", start_time, f"({sym}, {len(bids)} bids, {len(asks)} asks)")
    return result


@router.get("/dxfeed/trades")
async def api_dxfeed_trades(
    symbol: str = Query("AAPL", description="Instrument symbol"),
    limit: int = Query(200, description="Max number of recent trades"),
) -> Dict[str, Any]:
    """Return accumulated trade history for a symbol.
    Data comes directly from dxFeed Trade events."""
    start_time = time.time()
    logger.info("[dxFeed] /api/dxfeed/trades: symbol=%s, limit=%d", symbol, limit)

    _ensure_dxlink_running()

    sym = symbol.upper()
    if sym not in _dxfeed_state.get("subscribed_symbols", []):
        await _subscribe_symbol(sym)

    limit = max(1, min(limit, 1000))
    trades = _trade_history.get(sym, [])[-limit:]

    result = {
        "symbol": sym,
        "trades": trades,
        "count": len(trades),
        "timestamp": int(time.time() * 1000),
        "source": "dxfeed",
    }

    _log_timing("trades", start_time, f"({sym}, {len(trades)} trades)")
    return result


@router.get("/dxfeed/status")
async def api_dxfeed_status() -> Dict[str, Any]:
    """Return current dxFeed dxLink connection status."""
    connected = _dxfeed_state["connected"]
    # Mark disconnected if no heartbeat for 60 seconds
    if connected and (time.time() - _dxfeed_state["last_heartbeat"]) > 60:
        _dxfeed_state["connected"] = False
        connected = False

    return {
        "dxfeed_connected": connected,
        "dxfeed_url": DXFEED_WS_URL,
        "dxfeed_token_configured": bool(DXFEED_API_TOKEN),
        "source": "dxfeed",
        "channel_id": _dxfeed_state.get("channel_id"),
        "subscribed_symbols": _dxfeed_state.get("subscribed_symbols", []),
        "active_frontend_clients": len(_frontend_clients),
        "reconnect_count": _dxfeed_state["reconnect_count"],
        "error": _dxfeed_state.get("error"),
        "last_heartbeat": _dxfeed_state["last_heartbeat"],
        "timestamp": int(time.time() * 1000),
    }


@router.get("/dxfeed/symbols")
async def api_dxfeed_symbols() -> Dict[str, Any]:
    """Return available symbols and current subscription state."""
    return {
        "subscribed": _dxfeed_state.get("subscribed_symbols", []),
        "available_examples": [
            {"symbol": "AAPL", "label": "Apple Inc."},
            {"symbol": "MSFT", "label": "Microsoft Corp."},
            {"symbol": "GOOGL", "label": "Alphabet Inc."},
            {"symbol": "AMZN", "label": "Amazon.com Inc."},
            {"symbol": "TSLA", "label": "Tesla Inc."},
            {"symbol": "NVDA", "label": "NVIDIA Corp."},
            {"symbol": "SPY", "label": "S&P 500 ETF"},
            {"symbol": "QQQ", "label": "Nasdaq-100 ETF"},
            {"symbol": "META", "label": "Meta Platforms"},
            {"symbol": "/ES", "label": "E-mini S&P 500 Futures"},
            {"symbol": "/NQ", "label": "E-mini Nasdaq Futures"},
        ],
        "dxfeed_connected": _dxfeed_state["connected"],
    }


# =========================================================================== #
# Dynamic subscription management
# =========================================================================== #

async def _subscribe_symbol(symbol: str):
    """Add a new symbol subscription to the active dxLink channel."""
    sym = symbol.upper()
    current = _dxfeed_state.get("subscribed_symbols", [])
    if sym in current:
        return

    current.append(sym)
    _dxfeed_state["subscribed_symbols"] = current

    # Send subscription update if connected
    ws = _dxfeed_state.get("ws_connection")
    channel_id = _dxfeed_state.get("channel_id")
    if ws and channel_id and _dxfeed_state["connected"]:
        try:
            sub_msg = {
                "type": "FEED_SUBSCRIPTION",
                "channel": channel_id,
                "add": [
                    {"type": "Order", "symbol": sym},
                    {"type": "Trade", "symbol": sym},
                    {"type": "Quote", "symbol": sym},
                ],
            }
            await ws.send(json.dumps(sub_msg))
            logger.info("[dxFeed] Dynamically subscribed to %s", sym)
        except Exception as e:
            logger.error("[dxFeed] Failed to subscribe to %s: %s", sym, e)


# =========================================================================== #
# WebSocket: Live Stream Relay to Frontend
# =========================================================================== #

@router.websocket("/ws/dxfeed")
async def ws_dxfeed(websocket: WebSocket, symbol: str = "AAPL"):
    """WebSocket endpoint for live depth/trade data from dxFeed.
    Streams real-time order book snapshots and trade events."""
    await websocket.accept()
    _frontend_clients.append(websocket)
    logger.info("[dxFeed WS] Frontend client connected, symbol=%s, total=%d",
                symbol, len(_frontend_clients))

    # Ensure dxLink connection is running
    _ensure_dxlink_running()

    # Subscribe to requested symbol
    sym = symbol.upper()
    await _subscribe_symbol(sym)

    try:
        # Send initial status
        await websocket.send_json({
            "type": "status",
            "source": "dxfeed",
            "dxfeed_connected": _dxfeed_state["connected"],
            "symbol": sym,
            "subscribed_symbols": _dxfeed_state.get("subscribed_symbols", []),
        })

        # Send current order book snapshot if available
        book = _order_book.get(sym, {"bids": {}, "asks": {}})
        if book["bids"] or book["asks"]:
            bids = sorted(book["bids"].items(), key=lambda x: x[0], reverse=True)
            asks = sorted(book["asks"].items(), key=lambda x: x[0])
            await websocket.send_json({
                "type": "snapshot",
                "symbol": sym,
                "bids": [[p, s] for p, s in bids[:200]],
                "asks": [[p, s] for p, s in asks[:200]],
                "bid_count": len(bids),
                "ask_count": len(asks),
                "timestamp": int(time.time() * 1000),
                "source": "dxfeed",
            })

        # Keep alive -- listen for messages from frontend (symbol changes, etc.)
        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                data = json.loads(msg)

                if data.get("type") == "set_symbol":
                    new_sym = data.get("symbol", sym).upper()
                    if new_sym != sym:
                        sym = new_sym
                        await _subscribe_symbol(sym)
                        # Send fresh snapshot for new symbol
                        book = _order_book.get(sym, {"bids": {}, "asks": {}})
                        bids = sorted(book["bids"].items(), key=lambda x: x[0], reverse=True)
                        asks = sorted(book["asks"].items(), key=lambda x: x[0])
                        await websocket.send_json({
                            "type": "snapshot",
                            "symbol": sym,
                            "bids": [[p, s] for p, s in bids[:200]],
                            "asks": [[p, s] for p, s in asks[:200]],
                            "timestamp": int(time.time() * 1000),
                            "source": "dxfeed",
                        })

                if data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})

            except asyncio.TimeoutError:
                # Send keepalive ping
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception:
                    break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("[dxFeed WS] Error: %s", e)
    finally:
        if websocket in _frontend_clients:
            _frontend_clients.remove(websocket)
        logger.info("[dxFeed WS] Frontend client disconnected, remaining=%d",
                    len(_frontend_clients))
