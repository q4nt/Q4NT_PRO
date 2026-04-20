"""
SerpApi Router
Proxies requests to the SerpApi to get Google Trends data.
"""

import logging
import os
import httpx
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

logger = logging.getLogger("serpapi")

router = APIRouter(prefix="/serpapi", tags=["serpapi"])

_BASE_URL = "https://serpapi.com/search"

_serpapi_http: httpx.AsyncClient | None = None

def _client() -> httpx.AsyncClient:
    global _serpapi_http
    if _serpapi_http is None:
        _serpapi_http = httpx.AsyncClient(
            timeout=20.0,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _serpapi_http

def _get_api_key() -> str:
    key = os.environ.get("SERPAPI_API_KEY", "")
    if not key:
        logger.warning("[SerpApi] Warning: SERPAPI_API_KEY is not set.")
    return key


@router.get("/status")
def serpapi_status():
    """Health check endpoint to see if API key is configured."""
    key = _get_api_key()
    return {
        "status": "configured" if key else "unconfigured",
        "message": "SerpApi is ready" if key else "Missing SERPAPI_API_KEY in environment"
    }


@router.get("/google-trends")
async def get_google_trends(
    q: str = Query(..., description="Query term for Google Trends"),
    data_type: str = Query("TIMESERIES", description="Type of data (TIMESERIES, GEO_MAP, etc.)"),
    geo: Optional[str] = Query("US", description="Geography (e.g. US)"),
    date: str = Query("today 12-m", description="Date range, e.g., 'now 7-d', 'today 12-m'")
):
    """
    Fetch Google Trends data via SerpApi.
    """
    api_key = _get_api_key()
    if not api_key:
        raise HTTPException(status_code=501, detail="SerpApi API Key not configured")

    client = _client()
    
    params = {
        "engine": "google_trends",
        "q": q,
        "data_type": data_type,
        "api_key": api_key
    }
    
    if geo:
        params["geo"] = geo
    if date:
        params["date"] = date

    try:
        resp = await client.get(_BASE_URL, params=params)
        if resp.status_code != 200:
            logger.error(f"[SerpApi] API error: {resp.status_code} {resp.text}")
            raise HTTPException(status_code=resp.status_code, detail=f"Error fetching data from SerpApi: {resp.text}")
            
        data = resp.json()
        return JSONResponse(content={
            "success": True,
            "data": data,
        })

    except Exception as e:
        logger.error(f"[SerpApi] Request failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
