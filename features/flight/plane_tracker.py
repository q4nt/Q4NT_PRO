#!/usr/bin/env python3
"""
adsb_lol_aircraft.py

Fetch aircraft data from adsb.lol and return a pandas DataFrame with:
- kind (PLANE | HELICOPTER)
- name
- speed_kt
- lat
- lon
- elevation_ft
- hex

No print statements. Safe to import or run.
"""

import time
import requests
import pandas as pd

BASE_URL = "https://api.adsb.lol"

HELI_HINTS = (
    "HELI", "HELICOP", "ROTOR",
    "H60","UH60","MH60","HH60",
    "H47","CH47","MH47",
    "EC","AS","AW","BK","R22","R44","R66",
    "B407","B412","B429","S76","S92","MD","A139","A109","A119",
)

DEFAULT_TIMEOUT = 20
DEFAULT_RETRIES = 3


# -----------------------------
# Internal helpers
# -----------------------------
def _get_json(url: str, timeout=DEFAULT_TIMEOUT, retries=DEFAULT_RETRIES) -> dict:
    last = None
    for i in range(retries):
        try:
            r = requests.get(
                url,
                timeout=timeout,
                headers={"User-Agent": "adsb-lol-python/1.0"},
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last = e
            time.sleep(0.5 * (i + 1))
    raise RuntimeError(f"Request failed: {url}") from last


def _pick(d: dict, keys):
    for k in keys:
        v = d.get(k)
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        return v
    return None


def _aircraft_list(payload: dict):
    for k in ("ac", "aircraft", "Aircraft", "planes"):
        v = payload.get(k)
        if isinstance(v, list):
            return [x for x in v if isinstance(x, dict)]
    return []


def _best_name(a: dict) -> str:
    v = _pick(
        a,
        (
            "flight", "callsign", "call", "ident",
            "r", "reg", "registration",
            "t", "type", "icao_type",
            "hex", "icao",
        ),
    )
    return str(v).strip() if v is not None else "UNKNOWN"


def _best_speed_kt(a: dict):
    v = _pick(a, ("gs", "spd", "speed", "groundspeed"))
    try:
        return float(v) if v is not None else None
    except Exception:
        return None


def _best_lat_lon(a: dict):
    lat = _pick(a, ("lat", "Lat", "latitude"))
    lon = _pick(a, ("lon", "Lon", "lng", "longitude"))
    try:
        lat = float(lat) if lat is not None else None
    except Exception:
        lat = None
    try:
        lon = float(lon) if lon is not None else None
    except Exception:
        lon = None
    return lat, lon


def _best_alt_ft(a: dict):
    v = _pick(
        a,
        (
            "alt_baro", "alt", "Alt", "altitude",
            "alt_geom", "geo_altitude", "geom_altitude",
        ),
    )
    if isinstance(v, str) and v.lower().strip() in ("ground", "gnd"):
        return 0.0
    try:
        return float(v) if v is not None else None
    except Exception:
        return None


def _best_track(a: dict):
    v = _pick(a, ("track", "trk", "heading", "true_heading"))
    try:
        return float(v) if v is not None else 0.0
    except Exception:
        return 0.0


def _is_helicopter(a: dict) -> bool:
    t = _pick(a, ("t", "type", "icao_type"))
    desc = _pick(a, ("desc", "description", "type_desc"))
    s = " ".join([str(x).upper() for x in (t, desc) if x is not None])
    if not s:
        return False
    return any(h in s for h in HELI_HINTS)


def _endpoint_url(lat, lon, radius_nm, endpoint):
    if endpoint == "latlon":
        return f"{BASE_URL}/v2/lat/{lat}/lon/{lon}/dist/{radius_nm}"
    return f"{BASE_URL}/v2/point/{lat}/{lon}/{radius_nm}"


# -----------------------------
# Public API
# -----------------------------
def fetch_aircraft(
    centers,
    radius_nm=250,
    endpoint="point",
    sleep_between_calls=0.2,
):
    """
    centers: list of (lat, lon)
    radius_nm: nautical miles
    endpoint: "point" or "latlon"

    Returns: pandas.DataFrame
    """
    rows = []

    for lat, lon in centers:
        url = _endpoint_url(lat, lon, radius_nm, endpoint)
        payload = _get_json(url)
        aircraft = _aircraft_list(payload)

        for a in aircraft:
            alat, alon = _best_lat_lon(a)
            if alat is None or alon is None:
                continue

            rows.append({
                "kind": "HELICOPTER" if _is_helicopter(a) else "PLANE",
                "name": _best_name(a),
                "speed_kt": _best_speed_kt(a),
                "lat": alat,
                "lon": alon,
                "elevation_ft": _best_alt_ft(a),
                "track": _best_track(a),
                "hex": str(_pick(a, ("hex", "icao")) or "").strip() or None,
                "type": str(_pick(a, ("t", "type", "icao_type")) or "Unknown"),
                "registration": str(_pick(a, ("r", "reg", "registration")) or "Unknown"),
                "desc": str(_pick(a, ("desc", "description", "type_desc")) or ""),
                "squawk": str(_pick(a, ("squawk", "sqk")) or ""),
            })

        time.sleep(sleep_between_calls)

    df = pd.DataFrame(rows)

    if not df.empty:
        if "hex" in df.columns and df["hex"].notna().any():
            df = (
                df.sort_values(
                    ["hex", "elevation_ft", "speed_kt"],
                    ascending=[True, False, False],
                    na_position="last",
                )
                .drop_duplicates(subset=["hex"], keep="first")
            )
        else:
            df = df.drop_duplicates()

    return df.reset_index(drop=True)


# -----------------------------
# Optional CLI-safe entry
# -----------------------------
if __name__ == "__main__":
    # Example default execution (no output)
    _ = fetch_aircraft(
        centers=[(41.8781, -87.6298)],
        radius_nm=250,
        endpoint="point",
    )
