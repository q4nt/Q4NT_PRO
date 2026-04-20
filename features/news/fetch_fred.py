"""
Fetch key economic indicators from the FRED (Federal Reserve Economic Data) API.
Returns structured data with latest values, previous values, and changes.
"""
import os
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta

import httpx

logger = logging.getLogger(__name__)

FRED_API_KEY = os.environ.get("FRED_API_KEY", "")
FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations"
FRED_TIMEOUT = 15.0

# Key economic indicator series
FRED_INDICATORS = {
    "CPI": {
        "series_id": "CPIAUCSL",
        "label": "CPI (All Urban Consumers)",
        "category": "inflation",
        "unit": "index",
        "frequency": "monthly",
    },
    "CORE_PCE": {
        "series_id": "PCEPILFE",
        "label": "Core PCE Price Index",
        "category": "inflation",
        "unit": "index",
        "frequency": "monthly",
    },
    "PCE": {
        "series_id": "PCEPI",
        "label": "PCE Price Index",
        "category": "inflation",
        "unit": "index",
        "frequency": "monthly",
    },
    "GDP": {
        "series_id": "GDP",
        "label": "Gross Domestic Product",
        "category": "growth",
        "unit": "billions_$",
        "frequency": "quarterly",
    },
    "FEDFUNDS": {
        "series_id": "FEDFUNDS",
        "label": "Federal Funds Rate",
        "category": "rates",
        "unit": "percent",
        "frequency": "monthly",
    },
    "UNRATE": {
        "series_id": "UNRATE",
        "label": "Unemployment Rate",
        "category": "labor",
        "unit": "percent",
        "frequency": "monthly",
    },
    "DGS10": {
        "series_id": "DGS10",
        "label": "10-Year Treasury Yield",
        "category": "rates",
        "unit": "percent",
        "frequency": "daily",
    },
    "DGS2": {
        "series_id": "DGS2",
        "label": "2-Year Treasury Yield",
        "category": "rates",
        "unit": "percent",
        "frequency": "daily",
    },
    "PPI": {
        "series_id": "PPIACO",
        "label": "Producer Price Index",
        "category": "inflation",
        "unit": "index",
        "frequency": "monthly",
    },
    "RETAIL": {
        "series_id": "RSXFS",
        "label": "Retail Sales (ex Food Services)",
        "category": "consumer",
        "unit": "millions_$",
        "frequency": "monthly",
    },
    "PAYROLL": {
        "series_id": "PAYEMS",
        "label": "Nonfarm Payrolls",
        "category": "labor",
        "unit": "thousands",
        "frequency": "monthly",
    },
    "HOUSING": {
        "series_id": "HOUST",
        "label": "Housing Starts",
        "category": "housing",
        "unit": "thousands",
        "frequency": "monthly",
    },
    "NAPM": {
        "series_id": "NAPM",
        "label": "ISM Manufacturing PMI",
        "category": "manufacturing",
        "unit": "index",
        "frequency": "monthly",
    },
    "UMCSENT": {
        "series_id": "UMCSENT",
        "label": "Consumer Sentiment",
        "category": "consumer",
        "unit": "index",
        "frequency": "monthly",
    },
    "JTSJOL": {
        "series_id": "JTSJOL",
        "label": "Job Openings (JOLTS)",
        "category": "labor",
        "unit": "thousands",
        "frequency": "monthly",
    },
    "IPMAN": {
        "series_id": "IPMAN",
        "label": "Industrial Production: Manufacturing",
        "category": "manufacturing",
        "unit": "index",
        "frequency": "monthly",
    },
}


def _fetch_series(series_id: str, limit: int = 5) -> List[Dict[str, str]]:
    """Fetch the most recent observations for a single FRED series."""
    if not FRED_API_KEY:
        logger.warning("[FRED] No API key configured (set FRED_API_KEY in .env)")
        return []

    params = {
        "series_id": series_id,
        "api_key": FRED_API_KEY,
        "file_type": "json",
        "sort_order": "desc",
        "limit": limit,
    }

    try:
        resp = httpx.get(FRED_BASE_URL, params=params, timeout=FRED_TIMEOUT, follow_redirects=True)
        resp.raise_for_status()
        data = resp.json()
        return data.get("observations", [])
    except httpx.TimeoutException:
        logger.warning("[FRED] Timeout fetching %s", series_id)
    except httpx.HTTPStatusError as exc:
        logger.warning("[FRED] HTTP %s for %s", exc.response.status_code, series_id)
    except Exception as exc:
        logger.warning("[FRED] Error fetching %s: %s", series_id, exc)
    return []


def _fetch_series_meta(series_id: str) -> Optional[str]:
    """Fetch series metadata from fred/series to get last_updated timestamp."""
    if not FRED_API_KEY:
        return None
    try:
        resp = httpx.get(
            "https://api.stlouisfed.org/fred/series",
            params={
                "series_id": series_id,
                "api_key": FRED_API_KEY,
                "file_type": "json",
            },
            timeout=FRED_TIMEOUT,
            follow_redirects=True,
        )
        resp.raise_for_status()
        data = resp.json()
        seriess = data.get("seriess", [])
        if seriess:
            return seriess[0].get("last_updated", "")
    except Exception as exc:
        logger.debug("[FRED] Meta fetch error for %s: %s", series_id, exc)
    return None


def _parse_value(val_str: str) -> Optional[float]:
    """Parse a FRED observation value, handling '.' for missing data."""
    if not val_str or val_str.strip() == ".":
        return None
    try:
        return float(val_str)
    except (ValueError, TypeError):
        return None


def get_indicator(key: str) -> Optional[Dict[str, Any]]:
    """Fetch a single indicator and compute change from previous value."""
    info = FRED_INDICATORS.get(key)
    if not info:
        return None

    obs = _fetch_series(info["series_id"], limit=5)
    if not obs:
        return None

    # Get last_updated from series metadata (authoritative release timestamp)
    last_updated = _fetch_series_meta(info["series_id"]) or ""

    latest_val = None
    latest_date = None
    latest_realtime = None
    prev_val = None
    prev_date = None

    for o in obs:
        v = _parse_value(o.get("value", ""))
        if v is None:
            continue
        if latest_val is None:
            latest_val = v
            latest_date = o.get("date", "")
            latest_realtime = o.get("realtime_start", "")
        elif prev_val is None:
            prev_val = v
            prev_date = o.get("date", "")
            break

    if latest_val is None:
        return None

    # Compute change
    change = None
    change_pct = None
    if prev_val is not None and prev_val != 0:
        change = round(latest_val - prev_val, 4)
        change_pct = round((change / prev_val) * 100, 2)

    return {
        "key": key,
        "series_id": info["series_id"],
        "label": info["label"],
        "category": info["category"],
        "unit": info["unit"],
        "frequency": info["frequency"],
        "value": latest_val,
        "date": latest_date,
        "realtime_start": latest_realtime,
        "last_updated": last_updated,
        "prev_value": prev_val,
        "prev_date": prev_date,
        "change": change,
        "change_pct": change_pct,
    }


def get_all_indicators() -> List[Dict[str, Any]]:
    """Fetch all key economic indicators and return as a list."""
    results = []
    for key in FRED_INDICATORS:
        try:
            indicator = get_indicator(key)
            if indicator:
                results.append(indicator)
        except Exception as exc:
            logger.warning("[FRED] Failed to fetch %s: %s", key, exc)
    logger.info("[FRED] Fetched %d/%d indicators", len(results), len(FRED_INDICATORS))
    
    # Sort by realtime_start desc then date desc
    results.sort(key=lambda x: (x.get("realtime_start", ""), x.get("date", "")), reverse=True)
    
    return results


def get_series_observations(
    series_id: str,
    limit: int = 60,
    start_date: Optional[str] = None,
) -> Dict[str, Any]:
    """Fetch historical observations for a series (for charting)."""
    if not FRED_API_KEY:
        return {"error": "FRED_API_KEY not configured", "observations": []}

    params = {
        "series_id": series_id,
        "api_key": FRED_API_KEY,
        "file_type": "json",
        "sort_order": "desc",
        "limit": limit,
    }
    if start_date:
        params["observation_start"] = start_date

    try:
        resp = httpx.get(FRED_BASE_URL, params=params, timeout=FRED_TIMEOUT, follow_redirects=True)
        resp.raise_for_status()
        data = resp.json()
        obs = data.get("observations", [])

        # Parse into clean format
        parsed = []
        for o in obs:
            v = _parse_value(o.get("value", ""))
            if v is not None:
                parsed.append({
                    "date": o.get("date", ""),
                    "value": v,
                })

        return {
            "series_id": series_id,
            "count": len(parsed),
            "observations": list(reversed(parsed)),  # chronological order
        }
    except Exception as exc:
        logger.error("[FRED] Error fetching series %s: %s", series_id, exc)
        return {"error": str(exc), "observations": []}


# =============================================================================
# Release Calendar - upcoming dates for key economic releases
# =============================================================================

# Category -> list of (release_id, label, color, release_time, series_id)
FRED_RELEASE_CATEGORIES = {
    "fed": [
        (101, "FOMC Press Release", "#3b82f6", "2:00 PM ET", "FEDFUNDS"),
        (18, "Interest Rates (H.15)", "#60a5fa", "3:15 PM ET", "DGS10"),
        (20, "Fed Balance Sheet (H.4.1)", "#93c5fd", "4:30 PM ET", "WALCL"),
        (378, "Federal Funds Rate", "#2563eb", "9:00 AM ET", "DFF"),
    ],
    "cpi": [
        (10, "Consumer Price Index", "#ef4444", "8:30 AM ET", "CPIAUCSL"),
        (54, "Personal Income & Outlays (PCE)", "#f87171", "8:30 AM ET", "PCEPI"),
        (238, "Producer Price Index", "#fca5a5", "8:30 AM ET", "PPIACO"),
    ],
    "jobs": [
        (50, "Employment Situation", "#f59e0b", "8:30 AM ET", "PAYEMS"),
        (150, "JOLTS", "#fbbf24", "10:00 AM ET", "JTSJOL"),
        (28, "Unemployment Insurance Claims", "#fcd34d", "8:30 AM ET", "ICSA"),
    ],
    "gdp": [
        (53, "GDP & GDI", "#22c55e", "8:30 AM ET", "GDP"),
        (46, "Retail Sales", "#4ade80", "8:30 AM ET", "RSAFS"),
        (13, "G.17 Industrial Production", "#86efac", "9:15 AM ET", "INDPRO"),
    ],
    "global": [
        (305, "US Int'l Trade", "#8b5cf6", "8:30 AM ET", "BOPGSTB"),
        (95, "Treasury Int'l Capital", "#a78bfa", "4:00 PM ET", "TIC"),
    ],
}


def _fetch_release_dates(release_id: int, limit: int = 12) -> list:
    """Fetch upcoming release dates for a specific FRED release."""
    if not FRED_API_KEY:
        return []
    try:
        today = datetime.now().strftime("%Y-%m-%d")
        resp = httpx.get(
            "https://api.stlouisfed.org/fred/release/dates",
            params={
                "release_id": release_id,
                "api_key": FRED_API_KEY,
                "file_type": "json",
                "include_release_dates_with_no_data": "true",
                "sort_order": "desc",
                "limit": 50,
            },
            timeout=FRED_TIMEOUT,
            follow_redirects=True,
        )
        resp.raise_for_status()
        data = resp.json()
        dates = data.get("release_dates", [])
        # Filter to dates >= today, then sort chronological and limit
        future = [d["date"] for d in dates if d.get("date", "") >= today]
        future.sort()
        return future[:limit]
    except Exception as exc:
        logger.debug("[FRED] Release dates error for %s: %s", release_id, exc)
        return []


def get_release_calendar(category: str) -> Dict[str, Any]:
    """Get upcoming release dates for a category (fed, cpi, jobs, gdp, global, all)."""
    cat_lower = category.lower()

    # Handle 'all' by merging all categories
    if cat_lower == "all":
        all_events = []
        for cat_key in FRED_RELEASE_CATEGORIES:
            result = get_release_calendar(cat_key)
            for ev in result.get("events", []):
                ev["category"] = cat_key
                all_events.append(ev)
        all_events.sort(key=lambda e: e["date"])
        logger.info("[FRED] Calendar for 'all': %d events", len(all_events))
        return {"category": "all", "events": all_events}

    releases = FRED_RELEASE_CATEGORIES.get(cat_lower, [])
    if not releases:
        return {"category": category, "events": []}

    events = []
    for release_id, label, color, release_time, series_id in releases:
        dates = _fetch_release_dates(release_id, limit=6)
        for d in dates:
            events.append({
                "release_id": release_id,
                "label": label,
                "date": d,
                "time": release_time,
                "color": color,
                "category": cat_lower,
                "series_id": series_id,
            })

    # Sort by date ascending
    events.sort(key=lambda e: e["date"])
    logger.info("[FRED] Calendar for '%s': %d events", category, len(events))
    return {"category": category, "events": events}


