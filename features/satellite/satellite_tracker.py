#!/usr/bin/env python3
"""
satellite_tracker.py

Fetch satellite TLE data from the NASA/CelesTrak TLE API and propagate
positions to current lat/lon/altitude using SGP4.

Returns a list of satellite dicts:
  - name, lat, lon, altitude_km, norad_id, category

Architecture mirrors plane_tracker.py for consistency.
No print statements. Safe to import or run.
"""

import time
import math
import requests
from datetime import datetime, timezone
from sgp4.api import Satrec, WGS72
from sgp4.api import jday

# ---- Configuration ----
TLE_API_BASE = "https://tle.ivanstanojevic.me/api/tle"

# Satellite groups to fetch (search queries for the TLE API)
# These cover the most visually interesting / well-known constellations
SATELLITE_GROUPS = [
    {"query": "ISS", "category": "ISS", "limit": 1},
    {"query": "STARLINK", "category": "STARLINK", "limit": 40},
    {"query": "GPS", "category": "GPS", "limit": 10},
    {"query": "NOAA", "category": "WEATHER", "limit": 5},
    {"query": "GOES", "category": "WEATHER", "limit": 4},
    {"query": "LANDSAT", "category": "SCIENCE", "limit": 3},
    {"query": "HUBBLE", "category": "SCIENCE", "limit": 1},
    {"query": "TERRA", "category": "SCIENCE", "limit": 1},
    {"query": "AQUA", "category": "SCIENCE", "limit": 1},
    {"query": "COSMOS", "category": "MILITARY", "limit": 5},
    {"query": "IRIDIUM", "category": "COMMS", "limit": 10},
    {"query": "GLOBALSTAR", "category": "COMMS", "limit": 5},
    {"query": "INTELSAT", "category": "COMMS", "limit": 5},
    {"query": "ONEWEB", "category": "COMMS", "limit": 10},
]

DEFAULT_TIMEOUT = 15
DEFAULT_RETRIES = 2

# Cache: TLEs change ~daily, so cache for 5 minutes
_tle_cache = {}
_tle_cache_time = {}
TLE_CACHE_TTL = 300  # 5 minutes


# -----------------------------
# Internal helpers
# -----------------------------
def _get_json(url, params=None, timeout=DEFAULT_TIMEOUT, retries=DEFAULT_RETRIES):
    """Fetch JSON with retries."""
    last = None
    for i in range(retries):
        try:
            r = requests.get(
                url,
                params=params,
                timeout=timeout,
                headers={"User-Agent": "Q4NT-SatTracker/1.0"},
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last = e
            time.sleep(0.3 * (i + 1))
    raise RuntimeError(f"TLE API request failed: {url}") from last


def _propagate_tle(tle_line1, tle_line2):
    """
    Propagate a TLE to the current time and return (lat, lon, alt_km).
    Returns None if propagation fails.
    """
    try:
        satellite = Satrec.twoline2rv(tle_line1, tle_line2, WGS72)

        now = datetime.now(timezone.utc)
        jd, fr = jday(
            now.year, now.month, now.day,
            now.hour, now.minute, now.second + now.microsecond / 1e6
        )

        e, r, v = satellite.sgp4(jd, fr)
        if e != 0:
            return None

        # Convert ECI (Earth-Centered Inertial) to geodetic (lat, lon, alt)
        x, y, z = r  # km
        # Earth radius (WGS72)
        a = 6378.135  # km

        lon = math.atan2(y, x)

        # Account for Earth rotation (Greenwich sidereal time)
        # gmst = Greenwich Mean Sidereal Time
        d = jd - 2451545.0 + fr
        gmst = math.fmod(280.46061837 + 360.98564736629 * d, 360.0)
        gmst_rad = math.radians(gmst)
        lon = lon - gmst_rad

        # Normalize longitude to [-pi, pi]
        while lon > math.pi:
            lon -= 2 * math.pi
        while lon < -math.pi:
            lon += 2 * math.pi

        # Latitude
        r_xy = math.sqrt(x * x + y * y)
        lat = math.atan2(z, r_xy)

        # Altitude
        r_total = math.sqrt(x * x + y * y + z * z)
        alt_km = r_total - a

        return (
            math.degrees(lat),
            math.degrees(lon),
            max(alt_km, 0)
        )
    except Exception:
        return None


def _fetch_tle_group(query, limit=20):
    """
    Fetch TLE records for a search query from the TLE API.
    Returns list of dicts with name, line1, line2, satelliteId.
    Uses a simple cache to avoid hammering the API.
    """
    cache_key = f"{query}_{limit}"
    now = time.time()

    if cache_key in _tle_cache and (now - _tle_cache_time.get(cache_key, 0)) < TLE_CACHE_TTL:
        return _tle_cache[cache_key]

    try:
        params = {
            "search": query,
            "page_size": limit,
        }
        data = _get_json(TLE_API_BASE, params=params)
        members = data.get("member", [])

        results = []
        for m in members:
            name = m.get("name", "UNKNOWN").strip()
            line1 = m.get("line1", "")
            line2 = m.get("line2", "")
            sat_id = m.get("satelliteId", 0)

            if line1 and line2:
                results.append({
                    "name": name,
                    "line1": line1,
                    "line2": line2,
                    "satelliteId": sat_id,
                })

        _tle_cache[cache_key] = results
        _tle_cache_time[cache_key] = now
        return results
    except Exception:
        # Return cached data if available, even if expired
        return _tle_cache.get(cache_key, [])


# -----------------------------
# Public API
# -----------------------------
def fetch_satellites():
    """
    Fetch and propagate satellite positions for all configured groups.

    Returns: list of dicts with keys:
        name, lat, lon, altitude_km, norad_id, category
    """
    satellites = []
    seen_ids = set()

    for group in SATELLITE_GROUPS:
        query = group["query"]
        category = group["category"]
        limit = group.get("limit", 10)

        try:
            tle_records = _fetch_tle_group(query, limit)
        except Exception:
            continue

        for rec in tle_records:
            sat_id = rec["satelliteId"]
            if sat_id in seen_ids:
                continue
            seen_ids.add(sat_id)

            pos = _propagate_tle(rec["line1"], rec["line2"])
            if pos is None:
                continue

            lat, lon, alt_km = pos

            # Sanity: skip if position is clearly wrong
            if abs(lat) > 90 or abs(lon) > 180 or alt_km < 0 or alt_km > 50000:
                continue

            satellites.append({
                "name": rec["name"],
                "lat": round(lat, 4),
                "lon": round(lon, 4),
                "altitude_km": round(alt_km, 1),
                "norad_id": sat_id,
                "category": category,
            })

    return satellites


# -----------------------------
# Optional CLI-safe entry
# -----------------------------
if __name__ == "__main__":
    sats = fetch_satellites()
    for s in sats[:5]:
        print(f"{s['name']:30s} lat={s['lat']:8.4f} lon={s['lon']:9.4f} alt={s['altitude_km']:8.1f}km  [{s['category']}]")
    print(f"\nTotal: {len(sats)} satellites")
