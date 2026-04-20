"""
Polygon Proxy Router
====================
Thin backend proxy to api.polygon.io so the API key stays server-side.
The frontend switches PolygonAPI.baseUrl to /api/polygon and all Polygon
REST calls flow through here.
"""

import logging
import os
import time
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import JSONResponse

from backend.core.auth import rate_limit

logger = logging.getLogger("polygon_proxy")

router = APIRouter(prefix="/polygon", tags=["polygon_proxy"])

_POLYGON_BASE = "https://api.polygon.io"

_polygon_http: httpx.AsyncClient | None = None


def _client() -> httpx.AsyncClient:
    global _polygon_http
    if _polygon_http is None:
        _polygon_http = httpx.AsyncClient(
            timeout=20.0,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _polygon_http


def _get_api_key() -> str:
    key = os.environ.get("POLYGON_API_KEY", "")
    if not key:
        logger.warning("[PolygonProxy] POLYGON_API_KEY not set")
    return key


# Simple in-memory TTL cache (keyed by full URL+params string)
_cache: dict = {}
_CACHE_TTL = 300  # 5 minutes


def _cache_get(key: str):
    entry = _cache.get(key)
    if entry and (time.time() - entry["ts"] < _CACHE_TTL):
        return entry["data"]
    return None


def _cache_set(key: str, data):
    # Evict if cache grows too large
    if len(_cache) > 500:
        cutoff = time.time() - _CACHE_TTL
        stale = [k for k, v in _cache.items() if v["ts"] < cutoff]
        for k in stale:
            del _cache[k]
    _cache[key] = {"data": data, "ts": time.time()}


@router.get("/{path:path}", dependencies=[Depends(rate_limit("polygon", 30))])
async def polygon_proxy(path: str, request: Request):
    """
    Generic proxy to Polygon.io REST API.
    Forwards the request path and query params, injecting the server-side API key.
    """
    api_key = _get_api_key()
    if not api_key:
        raise HTTPException(
            status_code=501,
            detail="Polygon API key not configured on the server",
        )

    # Build upstream URL
    clean_path = path.lstrip("/")
    upstream_url = f"{_POLYGON_BASE}/{clean_path}"

    # Forward all query params from the original request, replacing/adding apiKey
    params = dict(request.query_params)
    params["apiKey"] = api_key

    # Check cache
    cache_key = f"{upstream_url}?{'&'.join(f'{k}={v}' for k, v in sorted(params.items()) if k != 'apiKey')}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return JSONResponse(content=cached)

    client = _client()
    try:
        resp = await client.get(upstream_url, params=params)
        if resp.status_code != 200:
            logger.warning(
                f"[PolygonProxy] Upstream error {resp.status_code} for /{clean_path}"
            )
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"Polygon API error: {resp.status_code}",
            )

        data = resp.json()
        _cache_set(cache_key, data)
        return JSONResponse(content=data)

    except httpx.HTTPError as e:
        logger.error(f"[PolygonProxy] HTTP error for /{clean_path}: {e}")
        raise HTTPException(status_code=502, detail="Polygon API unavailable")
