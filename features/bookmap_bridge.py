# =============================================================================
# BOOKMAP L1 ADDON BRIDGE
# =============================================================================
# Standalone Bookmap Python L1 addon that streams real-time order flow data
# (depth, trades, volume-at-price) to the Q4NT backend via a local WebSocket.
#
# REQUIREMENTS:
#   - Bookmap desktop (latest stable) running locally
#   - Python >= 3.6 (managed by Bookmap)
#   - The `bookmap` library is provided by Bookmap at runtime -- NOT pip-installable
#
# HOW TO INSTALL AS A BOOKMAP ADDON:
#   1. Open Bookmap -> Settings -> Manage plugins -> Bookmap Add-ons (L1)
#   2. Click "Add" and select this file (bookmap_bridge.py)
#   3. Enable the addon for the desired instrument
#   4. The bridge will connect to ws://localhost:9112/bookmap-feed automatically
#
# When Bookmap is NOT running, the Q4NT backend uses Binance as a fallback
# data source with the same visual style. This bridge provides the premium
# data path with richer features (iceberg detection, MBO, stop events).
# =============================================================================

import json
import time
import threading
import logging
from typing import Any, Dict, List, Optional
from collections import defaultdict

logger = logging.getLogger("bookmap_bridge")

# --------------------------------------------------------------------------- #
# Try importing bookmap -- only available inside Bookmap runtime
# --------------------------------------------------------------------------- #
try:
    import bookmap as bm
    HAS_BOOKMAP = True
except ImportError:
    HAS_BOOKMAP = False
    logger.warning(
        "[BookmapBridge] 'bookmap' module not found -- "
        "this script must run inside Bookmap desktop as an L1 addon."
    )

# --------------------------------------------------------------------------- #
# Try importing websockets for the bridge output channel
# --------------------------------------------------------------------------- #
try:
    import asyncio
    import websockets
    import websockets.sync.client as ws_sync
    HAS_WS = True
except ImportError:
    HAS_WS = False
    logger.warning(
        "[BookmapBridge] 'websockets' package not found. "
        "Install with: pip install websockets"
    )


# =========================================================================== #
# Bridge State
# =========================================================================== #
class BookmapBridgeState:
    """Shared state object accumulating Bookmap data for relay."""

    def __init__(self):
        # Instrument metadata
        self.instruments: Dict[str, dict] = {}

        # Order book state: {alias: {price_level: size_level}} separated by side
        self.bids: Dict[str, Dict[int, int]] = defaultdict(dict)
        self.asks: Dict[str, Dict[int, int]] = defaultdict(dict)

        # Trade buffer: {alias: [(timestamp, price, size, is_bid), ...]}
        self.trades: Dict[str, List] = defaultdict(list)
        self.max_trade_buffer = 500

        # Volume profile: {alias: {price_level: {"buy": total, "sell": total}}}
        self.volume_profile: Dict[str, Dict[int, dict]] = defaultdict(
            lambda: defaultdict(lambda: {"buy": 0, "sell": 0})
        )

        # WebSocket connection to Q4NT backend
        self.ws_connected = False
        self.ws_url = "ws://localhost:9112/bookmap-feed"
        self._ws = None
        self._ws_thread = None
        self._running = True

    def start_ws_relay(self):
        """Start background thread that maintains WebSocket to Q4NT backend."""
        if not HAS_WS:
            logger.error("[BookmapBridge] Cannot start WS relay -- websockets not installed")
            return

        def _relay_loop():
            while self._running:
                try:
                    logger.info("[BookmapBridge] Connecting to %s ...", self.ws_url)
                    self._ws = ws_sync.connect(self.ws_url)
                    self.ws_connected = True
                    logger.info("[BookmapBridge] Connected to Q4NT backend")

                    # Send initial handshake
                    self._ws.send(json.dumps({
                        "type": "handshake",
                        "source": "bookmap_l1",
                        "instruments": list(self.instruments.keys()),
                        "timestamp": int(time.time() * 1000),
                    }))

                    # Keep alive -- data is pushed by on_interval
                    while self._running and self.ws_connected:
                        try:
                            # Check for incoming messages (pings, config)
                            msg = self._ws.recv(timeout=1.0)
                            if msg:
                                data = json.loads(msg)
                                if data.get("type") == "ping":
                                    self._ws.send(json.dumps({"type": "pong"}))
                        except TimeoutError:
                            pass
                        except Exception:
                            break

                except Exception as e:
                    logger.warning("[BookmapBridge] WS connection error: %s", e)
                    self.ws_connected = False
                    self._ws = None
                    time.sleep(2)  # Retry after 2 seconds

        self._ws_thread = threading.Thread(target=_relay_loop, daemon=True)
        self._ws_thread.start()

    def send_snapshot(self, alias: str):
        """Send current order book + volume profile snapshot over WebSocket."""
        if not self.ws_connected or not self._ws:
            return

        inst = self.instruments.get(alias, {})
        pips = inst.get("pips", 1.0)
        size_mult = inst.get("size_multiplier", 1.0)

        # Convert bids/asks from integer price levels to float prices
        bids_list = []
        for price_level, size_level in sorted(self.bids.get(alias, {}).items(), reverse=True):
            if size_level > 0:
                bids_list.append([
                    round(price_level * pips, 8),
                    round(size_level / size_mult, 8)
                ])

        asks_list = []
        for price_level, size_level in sorted(self.asks.get(alias, {}).items()):
            if size_level > 0:
                asks_list.append([
                    round(price_level * pips, 8),
                    round(size_level / size_mult, 8)
                ])

        # Volume profile
        vp = {}
        for price_level, vol in self.volume_profile.get(alias, {}).items():
            price = round(price_level * pips, 8)
            vp[str(price)] = {
                "buy": round(vol["buy"] / size_mult, 8),
                "sell": round(vol["sell"] / size_mult, 8),
            }

        payload = {
            "type": "snapshot",
            "alias": alias,
            "symbol": inst.get("full_name", alias),
            "bids": bids_list[:200],  # Cap at 200 levels
            "asks": asks_list[:200],
            "bid_count": len(bids_list),
            "ask_count": len(asks_list),
            "volume_profile": vp,
            "timestamp": int(time.time() * 1000),
            "source": "bookmap",
        }

        try:
            self._ws.send(json.dumps(payload))
        except Exception as e:
            logger.warning("[BookmapBridge] Send error: %s", e)
            self.ws_connected = False

    def send_trade(self, alias: str, price: float, size: float, is_bid: bool):
        """Send individual trade event over WebSocket."""
        if not self.ws_connected or not self._ws:
            return

        payload = {
            "type": "trade",
            "alias": alias,
            "price": price,
            "size": size,
            "is_bid": is_bid,
            "timestamp": int(time.time() * 1000),
            "source": "bookmap",
        }

        try:
            self._ws.send(json.dumps(payload))
        except Exception:
            pass

    def shutdown(self):
        """Cleanly shut down the bridge."""
        self._running = False
        self.ws_connected = False
        if self._ws:
            try:
                self._ws.close()
            except Exception:
                pass


# =========================================================================== #
# Global state instance
# =========================================================================== #
_state = BookmapBridgeState()


# =========================================================================== #
# Bookmap L1 Event Handlers
# =========================================================================== #

def handle_subscribe_instrument(
    addon: Any,
    alias: str,
    full_name: str,
    is_crypto: bool,
    pips: float,
    size_multiplier: float,
    instrument_multiplier: float,
    supported_features: Dict[str, object],
) -> None:
    """Called when user enables addon for an instrument in Bookmap."""
    logger.info(
        "[BookmapBridge] Subscribed: %s (%s) pips=%s size_mult=%s",
        alias, full_name, pips, size_multiplier,
    )
    _state.instruments[alias] = {
        "full_name": full_name,
        "is_crypto": is_crypto,
        "pips": pips,
        "size_multiplier": size_multiplier,
        "instrument_multiplier": instrument_multiplier,
        "features": supported_features,
    }

    # Subscribe to all data streams
    bm.subscribe_to_depth(addon, alias, 1)
    bm.subscribe_to_trades(addon, alias, 2)

    # Try MBO if supported
    if supported_features.get("mbo"):
        bm.subscribe_to_mbo(addon, alias, 3)

    # Start WS relay if not already running
    if not _state._ws_thread:
        _state.start_ws_relay()


def handle_unsubscribe_instrument(addon: Any, alias: str) -> None:
    """Called when user disables addon for an instrument."""
    logger.info("[BookmapBridge] Unsubscribed: %s", alias)
    _state.instruments.pop(alias, None)
    _state.bids.pop(alias, None)
    _state.asks.pop(alias, None)
    _state.trades.pop(alias, None)
    _state.volume_profile.pop(alias, None)


def on_depth(
    addon: Any,
    alias: str,
    is_bid: bool,
    price_level: int,
    size_level: int,
) -> None:
    """Handle order book depth updates. Each call = one price level change."""
    book = _state.bids if is_bid else _state.asks
    if size_level <= 0:
        book[alias].pop(price_level, None)
    else:
        book[alias][price_level] = size_level


def on_trade(
    addon: Any,
    alias: str,
    price_level: float,
    size_level: int,
    is_otc: bool,
    is_bid: bool,
    is_execution_start: bool,
    is_execution_end: bool,
    aggressor_order_id: Optional[str],
    passive_order_id: Optional[str],
) -> None:
    """Handle individual trade events."""
    inst = _state.instruments.get(alias, {})
    pips = inst.get("pips", 1.0)
    size_mult = inst.get("size_multiplier", 1.0)

    price = round(price_level * pips, 8)
    size = round(size_level / size_mult, 8)

    # Buffer the trade
    trade_entry = (int(time.time() * 1000), price, size, is_bid)
    trades = _state.trades[alias]
    trades.append(trade_entry)
    if len(trades) > _state.max_trade_buffer:
        trades.pop(0)

    # Update volume profile
    side_key = "buy" if is_bid else "sell"
    _state.volume_profile[alias][int(price_level)][side_key] += size_level

    # Stream trade immediately
    _state.send_trade(alias, price, size, is_bid)


def on_interval(addon: Any, alias: str) -> None:
    """Called every 0.1 seconds by Bookmap. Send periodic snapshots."""
    # Send a full depth snapshot every 0.5s (every 5th interval)
    now = time.time()
    last_snap = getattr(_state, '_last_snapshot_time', 0)
    if now - last_snap >= 0.5:
        _state._last_snapshot_time = now
        _state.send_snapshot(alias)


def on_mbo(
    addon: Any,
    alias: str,
    event_type: str,
    order_id: str,
    price_level: int,
    size_level: int,
) -> None:
    """Handle market-by-order events (if supported by provider)."""
    # MBO events provide finer granularity -- we relay them as depth updates
    # event_type: ASK_NEW, BID_NEW, REPLACE, CANCEL
    is_bid = event_type in ("BID_NEW",)
    is_cancel = event_type == "CANCEL"

    if is_cancel:
        _state.bids[alias].pop(price_level, None)
        _state.asks[alias].pop(price_level, None)
    elif is_bid or event_type == "BID_NEW":
        if size_level <= 0:
            _state.bids[alias].pop(price_level, None)
        else:
            _state.bids[alias][price_level] = size_level
    else:  # ASK_NEW or REPLACE on ask side
        if size_level <= 0:
            _state.asks[alias].pop(price_level, None)
        else:
            _state.asks[alias][price_level] = size_level


# =========================================================================== #
# Main Entry Point (run inside Bookmap)
# =========================================================================== #

def main():
    if not HAS_BOOKMAP:
        print(
            "[BookmapBridge] ERROR: This script must run inside Bookmap desktop.\n"
            "  1. Open Bookmap -> Settings -> Manage plugins -> Bookmap Add-ons (L1)\n"
            "  2. Click 'Add' and select this file\n"
            "  3. Enable the addon for your desired instrument\n"
        )
        return

    addon = bm.create_addon()

    # Register all event handlers
    bm.add_depth_handler(addon, on_depth)
    bm.add_trades_handler(addon, on_trade)
    bm.add_on_interval_handler(addon, on_interval)
    bm.add_mbo_handler(addon, on_mbo)

    # Start the addon
    bm.start_addon(addon, handle_subscribe_instrument, handle_unsubscribe_instrument)

    print("[BookmapBridge] Addon started -- waiting for instrument subscription...", flush=True)

    # Block until addon is turned off
    bm.wait_until_addon_is_turned_off(addon)
    _state.shutdown()
    print("[BookmapBridge] Addon stopped.", flush=True)


if __name__ == "__main__":
    main()
