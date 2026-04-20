"""
Q4NT PRO - API Proxy Routes
============================
Lightweight proxy routers for frontend API clients.
Routes sensitive API calls through the backend to keep credentials server-side.
Self-contained: no dependency on backend.core.* modules.

Frontend clients that need these routes:
  - PolygonAPI  -> /api/polygon/{path}
  - AlpacaAPI   -> /api/alpaca/{path}
  - NbaAPI      -> /api/proxy/nba/{path}
  - NcaaAPI     -> /api/ncaa/{path}
  - PolymarketAPI -> /api/proxy/polymarket/{path}
"""

import os
import time
import logging
from typing import Optional, Dict, Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("api_proxy")

# ---------------------------------------------------------------------------
# Shared HTTP Client Pool
# ---------------------------------------------------------------------------
_http: httpx.AsyncClient | None = None


def _client() -> httpx.AsyncClient:
    global _http
    if _http is None:
        _http = httpx.AsyncClient(
            timeout=20.0,
            limits=httpx.Limits(max_connections=40, max_keepalive_connections=20),
            headers={"User-Agent": "Q4NT/2.0"},
        )
    return _http


# ---------------------------------------------------------------------------
# Simple In-Memory TTL Cache
# ---------------------------------------------------------------------------
_cache: Dict[str, dict] = {}
_CACHE_TTL = 300  # 5 minutes default


def _cache_get(key: str, ttl: int = _CACHE_TTL):
    entry = _cache.get(key)
    if entry and (time.time() - entry["ts"] < ttl):
        return entry["data"]
    return None


def _cache_set(key: str, data):
    if len(_cache) > 500:
        cutoff = time.time() - _CACHE_TTL
        stale = [k for k, v in _cache.items() if v["ts"] < cutoff]
        for k in stale:
            del _cache[k]
    _cache[key] = {"data": data, "ts": time.time()}


# ===================================================================
# Polygon.io Proxy
# ===================================================================
polygon_router = APIRouter(prefix="/api/polygon", tags=["polygon_proxy"])


@polygon_router.get("/{path:path}")
async def polygon_proxy(path: str, request: Request):
    """
    Proxy to Polygon.io REST API.
    Injects the server-side POLYGON_API_KEY.
    """
    api_key = os.environ.get("POLYGON_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=501, detail="POLYGON_API_KEY not configured")

    clean_path = path.lstrip("/")
    upstream_url = f"https://api.polygon.io/{clean_path}"
    params = dict(request.query_params)
    params["apiKey"] = api_key

    # Cache check (exclude apiKey from cache key)
    cache_params = {k: v for k, v in sorted(params.items()) if k != "apiKey"}
    cache_key = f"polygon:{clean_path}?{'&'.join(f'{k}={v}' for k, v in cache_params.items())}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return JSONResponse(content=cached)

    try:
        resp = await _client().get(upstream_url, params=params)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=f"Polygon API error: {resp.status_code}")
        data = resp.json()
        _cache_set(cache_key, data)
        return JSONResponse(content=data)
    except httpx.HTTPError as e:
        logger.error(f"[PolygonProxy] HTTP error for /{clean_path}: {e}")
        raise HTTPException(status_code=502, detail="Polygon API unavailable")


# ===================================================================
# Alpaca Trading Proxy
# ===================================================================
alpaca_router = APIRouter(prefix="/api/alpaca", tags=["alpaca_proxy"])

# Server-side credential store (set via /test-connection or .env)
_alpaca_creds = {
    "api_key": os.environ.get("ALPACA_API_KEY", ""),
    "api_secret": os.environ.get("ALPACA_API_SECRET", ""),
    "base_url": os.environ.get("ALPACA_BASE_URL", "https://paper-api.alpaca.markets"),
}


def _alpaca_headers():
    return {
        "APCA-API-KEY-ID": _alpaca_creds["api_key"],
        "APCA-API-SECRET-KEY": _alpaca_creds["api_secret"],
        "Content-Type": "application/json",
    }


@alpaca_router.post("/test-connection")
async def alpaca_test_connection(request: Request):
    """Store Alpaca credentials and test the connection."""
    data = await request.json()
    _alpaca_creds["api_key"] = data.get("api_key", "")
    _alpaca_creds["api_secret"] = data.get("api_secret", "")
    _alpaca_creds["base_url"] = data.get("base_url", "https://paper-api.alpaca.markets")

    try:
        resp = await _client().get(
            f"{_alpaca_creds['base_url']}/v2/account",
            headers=_alpaca_headers()
        )
        if resp.status_code == 200:
            acct = resp.json()
            return {"status": "connected", "account_id": acct.get("id", ""), "equity": acct.get("equity", "")}
        return {"status": "error", "detail": f"HTTP {resp.status_code}"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


@alpaca_router.get("/account")
async def alpaca_account():
    if not _alpaca_creds["api_key"]:
        raise HTTPException(status_code=401, detail="Alpaca credentials not configured")
    resp = await _client().get(f"{_alpaca_creds['base_url']}/v2/account", headers=_alpaca_headers())
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="Alpaca API error")
    return resp.json()


@alpaca_router.get("/positions")
async def alpaca_positions():
    if not _alpaca_creds["api_key"]:
        return {"positions": []}
    resp = await _client().get(f"{_alpaca_creds['base_url']}/v2/positions", headers=_alpaca_headers())
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="Alpaca API error")
    return {"positions": resp.json()}


@alpaca_router.get("/orders")
async def alpaca_orders(status: str = "open", limit: int = 20):
    if not _alpaca_creds["api_key"]:
        return {"orders": []}
    resp = await _client().get(
        f"{_alpaca_creds['base_url']}/v2/orders",
        headers=_alpaca_headers(),
        params={"status": status, "limit": limit}
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="Alpaca API error")
    return {"orders": resp.json()}


@alpaca_router.post("/orders")
async def alpaca_create_order(request: Request):
    if not _alpaca_creds["api_key"]:
        raise HTTPException(status_code=401, detail="Alpaca credentials not configured")
    body = await request.json()
    resp = await _client().post(
        f"{_alpaca_creds['base_url']}/v2/orders",
        headers=_alpaca_headers(),
        json=body
    )
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=resp.status_code, detail="Alpaca order error")
    return resp.json()


@alpaca_router.get("/portfolio/history")
async def alpaca_portfolio_history(period: str = "1M", timeframe: str = "1D"):
    if not _alpaca_creds["api_key"]:
        return {"timestamp": [], "equity": [], "profit_loss": []}
    resp = await _client().get(
        f"{_alpaca_creds['base_url']}/v2/account/portfolio/history",
        headers=_alpaca_headers(),
        params={"period": period, "timeframe": timeframe}
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="Alpaca API error")
    return resp.json()


@alpaca_router.get("/market/clock")
async def alpaca_clock():
    if not _alpaca_creds["api_key"]:
        return {"is_open": False}
    resp = await _client().get(f"{_alpaca_creds['base_url']}/v2/clock", headers=_alpaca_headers())
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="Alpaca API error")
    return resp.json()


# ===================================================================
# NBA CDN Proxy (avoids CORS on cdn.nba.com)
# ===================================================================
nba_router = APIRouter(prefix="/api/proxy/nba", tags=["nba_proxy"])

_NBA_CDN = "https://cdn.nba.com/static/json/liveData"


@nba_router.get("/{path:path}")
async def nba_proxy(path: str):
    """Proxy to NBA CDN for live scores and box scores."""
    clean_path = path.lstrip("/")
    upstream_url = f"{_NBA_CDN}/{clean_path}"

    cache_key = f"nba:{clean_path}"
    cached = _cache_get(cache_key, ttl=30)  # 30s TTL for live data
    if cached is not None:
        return JSONResponse(content=cached)

    try:
        resp = await _client().get(upstream_url)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail="NBA CDN error")
        data = resp.json()
        _cache_set(cache_key, data)
        return JSONResponse(content=data)
    except httpx.HTTPError as e:
        logger.error(f"[NbaProxy] HTTP error: {e}")
        raise HTTPException(status_code=502, detail="NBA CDN unavailable")


# ===================================================================
# NCAA Proxy (henrygd NCAA API)
# ===================================================================
ncaa_router = APIRouter(prefix="/api/ncaa", tags=["ncaa_proxy"])

_NCAA_BASE = "https://ncaa-api.henrygd.me"


@ncaa_router.get("/scoreboard")
async def ncaa_scoreboard(sport: str = "basketball-men", division: str = "d1", date: Optional[str] = None):
    """Fetch live scoreboard from NCAA API."""
    url = f"{_NCAA_BASE}/scoreboard/{sport}/{division}"
    if date:
        url += f"/{date}"

    cache_key = f"ncaa:scoreboard:{sport}:{division}:{date}"
    cached = _cache_get(cache_key, ttl=60)
    if cached is not None:
        return JSONResponse(content=cached)

    try:
        resp = await _client().get(url)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail="NCAA API error")
        data = resp.json()
        _cache_set(cache_key, data)
        return JSONResponse(content=data)
    except httpx.HTTPError as e:
        logger.error(f"[NcaaProxy] HTTP error: {e}")
        raise HTTPException(status_code=502, detail="NCAA API unavailable")


@ncaa_router.get("/standings")
async def ncaa_standings(sport: str = "basketball-men", division: str = "d1"):
    url = f"{_NCAA_BASE}/standings/{sport}/{division}"
    cache_key = f"ncaa:standings:{sport}:{division}"
    cached = _cache_get(cache_key, ttl=300)
    if cached is not None:
        return JSONResponse(content=cached)

    try:
        resp = await _client().get(url)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail="NCAA API error")
        data = resp.json()
        _cache_set(cache_key, data)
        return JSONResponse(content=data)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail="NCAA API unavailable")


@ncaa_router.get("/rankings")
async def ncaa_rankings(sport: str = "basketball-men", division: str = "d1"):
    url = f"{_NCAA_BASE}/rankings/{sport}/{division}"
    cache_key = f"ncaa:rankings:{sport}:{division}"
    cached = _cache_get(cache_key, ttl=300)
    if cached is not None:
        return JSONResponse(content=cached)

    try:
        resp = await _client().get(url)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail="NCAA API error")
        data = resp.json()
        _cache_set(cache_key, data)
        return JSONResponse(content=data)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail="NCAA API unavailable")


@ncaa_router.get("/game/{game_id}/boxscore")
async def ncaa_boxscore(game_id: str):
    url = f"{_NCAA_BASE}/game/{game_id}/boxscore"
    cache_key = f"ncaa:boxscore:{game_id}"
    cached = _cache_get(cache_key, ttl=30)
    if cached is not None:
        return JSONResponse(content=cached)

    try:
        resp = await _client().get(url)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail="NCAA API error")
        data = resp.json()
        _cache_set(cache_key, data)
        return JSONResponse(content=data)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail="NCAA API unavailable")


# ===================================================================
# Polymarket Gamma API Proxy (avoids CORS on gamma-api.polymarket.com)
# ===================================================================
polymarket_router = APIRouter(prefix="/api/proxy/polymarket", tags=["polymarket_proxy"])

_GAMMA_BASE = "https://gamma-api.polymarket.com"


@polymarket_router.get("/{path:path}")
async def polymarket_proxy(path: str, request: Request):
    """Proxy to Polymarket Gamma API for events and markets."""
    clean_path = path.lstrip("/")
    upstream_url = f"{_GAMMA_BASE}/{clean_path}"
    params = dict(request.query_params)

    cache_key = f"polymarket:{clean_path}?{'&'.join(f'{k}={v}' for k, v in sorted(params.items()))}"
    cached = _cache_get(cache_key, ttl=60)
    if cached is not None:
        return JSONResponse(content=cached)

    try:
        resp = await _client().get(upstream_url, params=params)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail="Polymarket Gamma API error")
        data = resp.json()
        _cache_set(cache_key, data)
        return JSONResponse(content=data)
    except httpx.HTTPError as e:
        logger.error(f"[PolymarketProxy] HTTP error: {e}")
        raise HTTPException(status_code=502, detail="Polymarket API unavailable")


# ===================================================================
# Convenience: Return all routers for easy mounting
# ===================================================================
all_proxy_routers = [
    polygon_router,
    alpaca_router,
    nba_router,
    ncaa_router,
    polymarket_router,
]
