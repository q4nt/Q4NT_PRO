"""
OpenWeatherMap Weather Tile Proxy
Proxies OWM raster tile requests through the Q4NT backend so the API key
stays server-side and is never exposed to the browser.

Endpoints:
  GET /api/weather/tile/{layer}/{z}/{x}/{y}  - Proxied tile PNG
  GET /api/weather/status                    - Key configuration status
"""

import os
import logging

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

logger = logging.getLogger("weather")

router = APIRouter(prefix="/weather", tags=["weather"])

# Allowed OWM tile layers (prevents arbitrary URL construction)
_ALLOWED_LAYERS = {
    "precipitation_new",
    "clouds_new",
    "temp_new",
    "wind_new",
    "pressure_new",
}

# Shared async client (connection pooling)
_http_client = httpx.AsyncClient(timeout=10.0)


@router.get("/status")
def weather_status():
    """Return whether the OWM API key is configured."""
    key = os.environ.get("OWM_API_KEY", "")
    return {
        "configured": bool(key),
        "layers": sorted(_ALLOWED_LAYERS),
    }


@router.get("/tile/{layer}/{z}/{x}/{y}")
async def weather_tile(layer: str, z: int, x: int, y: int):
    """
    Proxy a single OWM raster tile.
    URL pattern mirrors: https://tile.openweathermap.org/map/{layer}/{z}/{x}/{y}.png?appid=KEY
    """
    api_key = os.environ.get("OWM_API_KEY", "")
    if not api_key:
        raise HTTPException(503, "OWM_API_KEY not configured in .env")

    if layer not in _ALLOWED_LAYERS:
        raise HTTPException(400, f"Unknown layer '{layer}'. Allowed: {sorted(_ALLOWED_LAYERS)}")

    url = f"https://tile.openweathermap.org/map/{layer}/{z}/{x}/{y}.png?appid={api_key}"

    try:
        resp = await _http_client.get(url)
        if resp.status_code != 200:
            logger.warning(f"[Weather] OWM tile error: {resp.status_code} for {layer}/{z}/{x}/{y}")
            raise HTTPException(resp.status_code, "OWM upstream error")

        return Response(
            content=resp.content,
            media_type="image/png",
            headers={
                "Cache-Control": "public, max-age=600",  # Cache tiles 10 min
                "Access-Control-Allow-Origin": "*",
            },
        )
    except httpx.TimeoutException:
        raise HTTPException(504, "OWM tile request timed out")
    except httpx.RequestError as e:
        logger.error(f"[Weather] OWM request failed: {e}")
        raise HTTPException(502, "Failed to fetch OWM tile")
