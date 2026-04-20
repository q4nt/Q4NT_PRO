import time
import logging
import asyncio
from typing import Dict, Any, List
from pydantic import BaseModel
from fastapi import APIRouter, Query
import httpx
from backend.features.flight.plane_tracker import fetch_aircraft

logger = logging.getLogger("main_server")
router = APIRouter(tags=["flight", "space"])

# =============================================================================
# PLANE TRACKER ENDPOINTS
# =============================================================================

@router.get("/planes")
async def api_planes(
    lat: float = Query(..., description="Center latitude"),
    lon: float = Query(..., description="Center longitude"),
    radius_km: float = Query(25.0, description="Radius in kilometers"),
) -> Dict[str, Any]:
    """Fetch live aircraft data from ADSB.lol."""
    start = time.time()
    logger.info(f"/api/planes lat={lat}, lon={lon}, radius_km={radius_km}")

    try:
        radius_nm = radius_km * 0.539957

        loop = asyncio.get_running_loop()
        df = await loop.run_in_executor(
            None,
            lambda: fetch_aircraft(
                centers=[(lat, lon)],
                radius_nm=radius_nm,
                endpoint="point",
                sleep_between_calls=0.0,
            ),
        )

        planes = []
        if not df.empty:
            df = df.dropna(subset=["lat", "lon", "elevation_ft"])
            planes = df.to_dict("records")

        elapsed = (time.time() - start) * 1000
        logger.info(f"/api/planes -> {len(planes)} planes in {elapsed:.0f}ms")

        return {"success": True, "planes": planes, "count": len(planes)}

    except Exception as e:
        logger.error(f"Plane API error: {e}")
        return {"success": False, "error": str(e), "planes": []}


# =============================================================================
# PLANE ROUTE & AIRPORT LOOKUP (adsb.lol routeset + airport endpoints)
# =============================================================================
_airport_cache: Dict[str, Any] = {}  # icao -> {name, lat, lon, iata, icao, _ts}
_AIRPORT_CACHE_TTL = 3600  # 1 hour


class PlaneRouteRequest(BaseModel):
    planes: List[Dict[str, Any]]  # [{callsign, lat, lng}]


@router.post("/plane-routes")
async def api_plane_routes(req: PlaneRouteRequest) -> Dict[str, Any]:
    """Batch-lookup flight routes via adsb.lol routeset API."""
    start = time.time()
    logger.info(f"[API] /api/plane-routes called: {len(req.planes)} planes")

    if not req.planes:
        return {"success": True, "routes": {}}

    try:
        payload = {"planes": [{"callsign": p["callsign"], "lat": p["lat"], "lng": p["lng"]} for p in req.planes if p.get("callsign")]}
        if not payload["planes"]:
            return {"success": True, "routes": {}}

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.adsb.lol/api/0/routeset",
                json=payload,
                headers={"User-Agent": "q4nt-flight-tracker/1.0"},
                timeout=15.0,
            )

        if resp.status_code != 200:
            logger.warning(f"[API] adsb.lol routeset returned {resp.status_code}")
            return {"success": False, "error": f"routeset HTTP {resp.status_code}", "routes": {}}

        data = resp.json()
        elapsed = (time.time() - start) * 1000
        logger.info(f"[API] /api/plane-routes completed in {elapsed:.0f}ms")
        return {"success": True, "routes": data}

    except Exception as e:
        logger.error(f"[API] Plane routes error: {e}")
        return {"success": False, "error": str(e), "routes": {}}


@router.get("/airport/{icao}")
async def api_airport(icao: str) -> Dict[str, Any]:
    """Lookup airport info by ICAO code via adsb.lol."""
    icao = icao.strip().upper()
    logger.info(f"[API] /api/airport/{icao} called")

    # Check in-memory cache
    cached = _airport_cache.get(icao)
    if cached and (time.time() - cached.get("_ts", 0)) < _AIRPORT_CACHE_TTL:
        return {"success": True, "airport": {k: v for k, v in cached.items() if k != "_ts"}}

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://api.adsb.lol/api/0/airport/{icao}",
                headers={"User-Agent": "q4nt-flight-tracker/1.0"},
                timeout=10.0,
            )

        if resp.status_code != 200:
            return {"success": False, "error": f"Airport lookup HTTP {resp.status_code}"}

        data = resp.json()
        data["_ts"] = time.time()
        _airport_cache[icao] = data
        return {"success": True, "airport": {k: v for k, v in data.items() if k != "_ts"}}

    except Exception as e:
        logger.error(f"[API] Airport lookup error ({icao}): {e}")
        return {"success": False, "error": str(e)}


# =============================================================================
# SATELLITE TRACKER ENDPOINTS
# =============================================================================

try:
    from backend.features.satellite.satellite_tracker import fetch_satellites
    _SATELLITE_TRACKER_OK = True
    logger.info("[Server] Satellite tracker module loaded")
except ImportError as e:
    _SATELLITE_TRACKER_OK = False
    logger.warning(f"[Server] Satellite tracker NOT available: {e}")


@router.get("/satellites")
async def api_satellites() -> Dict[str, Any]:
    """Fetch live satellite positions using TLE data propagated via SGP4."""
    start = time.time()
    logger.info("[API] /api/satellites called")

    if not _SATELLITE_TRACKER_OK:
        return {"success": False, "error": "Satellite tracker module not available", "satellites": []}

    try:
        loop = asyncio.get_running_loop()
        satellites = await loop.run_in_executor(None, fetch_satellites)

        elapsed = (time.time() - start) * 1000
        logger.info(f"/api/satellites -> {len(satellites)} satellites in {elapsed:.0f}ms")

        return {"success": True, "satellites": satellites, "count": len(satellites)}

    except Exception as e:
        logger.error(f"Satellite API error: {e}")
        return {"success": False, "error": str(e), "satellites": []}





