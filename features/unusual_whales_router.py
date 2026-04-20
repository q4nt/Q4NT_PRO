"""
Unusual Whales Router - Options Flow & Options Data
Proxies requests to the Unusual Whales API (https://api.unusualwhales.com).
"""

import logging
import os
import httpx
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

logger = logging.getLogger("unusual_whales")

router = APIRouter(prefix="/unusual-whales", tags=["unusual_whales"])

_BASE_URL = "https://api.unusualwhales.com"

_unusual_whales_http: httpx.AsyncClient | None = None

def _client() -> httpx.AsyncClient:
    global _unusual_whales_http
    if _unusual_whales_http is None:
        _unusual_whales_http = httpx.AsyncClient(
            timeout=20.0,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _unusual_whales_http

def _get_api_key() -> str:
    key = os.environ.get("UNUSUAL_WHALES_API_KEY", "")
    if not key:
        logger.warning("[UnusualWhales] Warning: UNUSUAL_WHALES_API_KEY is not set.")
    return key


@router.get("/status")
def unusual_whales_status():
    """Health check endpoint to see if API key is configured."""
    key = os.environ.get("UNUSUAL_WHALES_API_KEY", "")
    return {
        "status": "configured" if key else "unconfigured",
        "message": "Unusual Whales API is ready" if key else "Missing UNUSUAL_WHALES_API_KEY in environment"
    }


@router.get("/proxy/{path:path}")
async def proxy_unusual_whales(
    path: str,
    ticker: Optional[str] = Query(None, description="Stock ticker symbol"),
    limit: Optional[int] = Query(50, description="Max number of results to return")
):
    """
    Generic proxy to Unusual Whales API endpoints.
    Example: /api/unusual-whales/proxy/option-trades
    """
    api_key = _get_api_key()
    if not api_key:
        raise HTTPException(status_code=501, detail="Unusual Whales API Key not configured")

    client = _client()
    
    # Path shouldn't have a leading slash from the route parameter but just in case
    clean_path = path.lstrip('/')
    url = f"{_BASE_URL}/{clean_path}"
    
    params = {}
    if limit is not None:
        params["limit"] = limit
    if ticker:
        params["ticker"] = ticker.upper()

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json"
    }

    try:
        resp = await client.get(url, params=params, headers=headers)
        if resp.status_code != 200:
            logger.error(f"[UnusualWhales] API error on {clean_path}: {resp.status_code} {resp.text}")
            raise HTTPException(status_code=resp.status_code, detail=f"Error fetching data from Unusual Whales: {resp.text}")
            
        data = resp.json()
        return JSONResponse(content={
            "success": True,
            "data": data.get("data", data),
        })

    except Exception as e:
        logger.error(f"[UnusualWhales] Request failed for {clean_path}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
