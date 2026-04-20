# =============================================================================
# DRAFTKINGS SPORTSBOOK INTEGRATION ROUTER (Unofficial Public API)
# =============================================================================
# NOTE: DraftKings does not provide an official public API. These endpoints use
# reverse-engineered, publicly accessible URLs that do not require authentication.
# They may change or break without notice.
# =============================================================================

import os
import time
import logging
from typing import Optional, Dict, Any, List

import httpx
from fastapi import APIRouter, Query

logger = logging.getLogger("q4nt.draftkings")

DRAFTKINGS_API_URL = "https://api.draftkings.com"

router = APIRouter(tags=["draftkings"])

# Shared httpx client for connection pooling
_dk_http: httpx.AsyncClient | None = None

def _client() -> httpx.AsyncClient:
    global _dk_http
    if _dk_http is None:
        _dk_http = httpx.AsyncClient(
            timeout=10.0,
            headers={"User-Agent": "Mozilla/5.0"},
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _dk_http

logger.info("[DraftKings] Integration loaded (unofficial public API, no auth required)")


def _log_timing(label: str, start: float, extra: str = ""):
    elapsed = int((time.time() - start) * 1000)
    logger.info("[DraftKings] %s completed in %dms %s", label, elapsed, extra)


# --- In-memory caches ---------------------------------------------------------

_sports_cache: Optional[List[Dict[str, Any]]] = None
_sports_cache_time: float = 0
SPORTS_CACHE_TTL = 1800.0  # 30 minutes

_events_cache: Dict[str, tuple] = {}  # {sport_key: (data, timestamp)}
EVENTS_CACHE_TTL = 300.0  # 5 minutes

# Sport name -> DraftKings sport ID mapping
SPORT_IDS = {
    "NFL": 1, "NBA": 3, "MLB": 2, "NHL": 4, "UFC": 7,
    "MMA": 7, "SOCCER": 6, "TENNIS": 8, "GOLF": 5,
    "COLLEGE FOOTBALL": 10, "CFB": 10, "COLLEGE BASKETBALL": 11,
    "CBB": 11, "BOXING": 12, "CRICKET": 14, "F1": 18,
    "NASCAR": 16,
}


# ---- Sports List -------------------------------------------------------------

@router.get("/draftkings/sports")
async def api_draftkings_sports() -> Dict[str, Any]:
    """List all available sports on DraftKings sportsbook."""
    global _sports_cache, _sports_cache_time
    start_time = time.time()

    if _sports_cache and (time.time() - _sports_cache_time < SPORTS_CACHE_TTL):
        _log_timing("sports (cached)", start_time)
        return {"sports": _sports_cache, "count": len(_sports_cache), "source": "cache"}

    try:
        resp = await _client().get(
            f"{DRAFTKINGS_API_URL}/sites/US-DK/sports/v1/sports",
            params={"format": "json"},
        )
        resp.raise_for_status()
        data = resp.json()

        sports_list = []
        for sport in data.get("sports", []):
            sports_list.append({
                "sport_id": sport.get("sportId"),
                "name": sport.get("name"),
                "has_live": sport.get("hasLive", False),
                "featured": sport.get("isFeatured", False),
                "event_groups": [
                    {
                        "id": eg.get("eventGroupId"),
                        "name": eg.get("name"),
                        "event_count": eg.get("offeringCount", 0),
                    }
                    for eg in sport.get("eventGroups", [])[:10]
                ],
            })

        _sports_cache = sports_list
        _sports_cache_time = time.time()
        _log_timing("sports", start_time, f"({len(sports_list)} sports)")
        return {"sports": sports_list, "count": len(sports_list), "source": "live"}
    except Exception as e:
        logger.error("[DraftKings] Sports error: %s", e)
        if _sports_cache:
            return {"sports": _sports_cache, "count": len(_sports_cache), "source": "stale_cache", "error": str(e)}
        return {"error": str(e), "sports": []}


# ---- Events / Odds -----------------------------------------------------------

@router.get("/draftkings/events")
async def api_draftkings_events(
    sport: str = Query("NFL", description="Sport name (NFL, NBA, MLB, NHL, UFC, Soccer, etc.)"),
    limit: int = Query(20, description="Max events to return"),
) -> Dict[str, Any]:
    """Get upcoming events and betting odds for a sport from DraftKings."""
    start_time = time.time()
    sport_upper = sport.upper().strip()

    # Check cache
    cache_key = f"events_{sport_upper}"
    if cache_key in _events_cache:
        cached_data, cached_time = _events_cache[cache_key]
        if time.time() - cached_time < EVENTS_CACHE_TTL:
            _log_timing("events (cached)", start_time)
            return {"events": cached_data[:limit], "sport": sport_upper, "source": "cache"}

    sport_id = SPORT_IDS.get(sport_upper)
    if sport_id is None:
        try:
            sport_id = int(sport)
        except (ValueError, TypeError):
            return {
                "error": f"Unknown sport: {sport}. Available: {', '.join(sorted(SPORT_IDS.keys()))}",
                "events": [],
            }

    try:
        resp = await _client().get(
            f"{DRAFTKINGS_API_URL}/sites/US-DK/sports/v1/sports/{sport_id}/events",
            params={"format": "json"},
        )
        resp.raise_for_status()
        data = resp.json()

        events = []
        for event in data.get("events", []):
            offerings = []
            for offer_cat in event.get("offerCategories", [])[:3]:
                for sub in offer_cat.get("offerSubcategoryDescriptors", [])[:1]:
                    for offer in sub.get("offerSubcategory", {}).get("offers", [])[:5]:
                        for outcome_group in offer:
                            if isinstance(outcome_group, dict):
                                for oc in outcome_group.get("outcomes", []):
                                    offerings.append({
                                        "label": oc.get("label"),
                                        "odds": oc.get("oddsAmerican"),
                                        "odds_decimal": oc.get("oddsDecimal"),
                                        "line": oc.get("line"),
                                    })

            events.append({
                "event_id": event.get("eventId"),
                "name": event.get("name"),
                "start_date": event.get("startDate"),
                "status": event.get("eventStatus", {}).get("state"),
                "is_live": event.get("eventStatus", {}).get("state") == "LIVE",
                "team_1": event.get("teamName1"),
                "team_2": event.get("teamName2"),
                "offerings": offerings[:10],
            })

        _events_cache[cache_key] = (events, time.time())
        _log_timing("events", start_time, f"({len(events)} events for {sport_upper})")
        return {"events": events[:limit], "sport": sport_upper, "count": len(events), "source": "live"}
    except Exception as e:
        logger.error("[DraftKings] Events error: %s", e)
        return {"error": str(e), "events": []}


# ---- Contests (DFS) ----------------------------------------------------------

DRAFTKINGS_LOBBY_URL = "https://www.draftkings.com"

_contests_cache: Dict[str, tuple] = {}
CONTESTS_CACHE_TTL = 300.0  # 5 minutes

@router.get("/draftkings/contests")
async def api_draftkings_contests(
    sport: str = Query("NBA", description="Sport code (NBA, CBB, NFL, etc.)"),
    limit: int = Query(20, description="Max contests to return"),
) -> Dict[str, Any]:
    """Get DFS contests for a sport from DraftKings lobby."""
    start_time = time.time()
    sport_upper = sport.upper().strip()

    cache_key = f"contests_{sport_upper}"
    if cache_key in _contests_cache:
        cached_data, cached_time = _contests_cache[cache_key]
        if time.time() - cached_time < CONTESTS_CACHE_TTL:
            _log_timing("contests (cached)", start_time)
            return cached_data

    try:
        resp = await _client().get(
            f"{DRAFTKINGS_LOBBY_URL}/lobby/getcontests",
            params={"sport": sport_upper, "format": "json"},
            timeout=15.0,
        )
        resp.raise_for_status()
        data = resp.json()

        result = {
            "Contests": (data.get("Contests") or [])[:limit],
            "DraftGroups": data.get("DraftGroups", []),
            "sport": sport_upper,
            "totalContests": len(data.get("Contests") or []),
            "source": "live",
        }
        _contests_cache[cache_key] = (result, time.time())
        _log_timing("contests", start_time, f"({result['totalContests']} contests for {sport_upper})")
        return result
    except Exception as e:
        logger.error("[DraftKings] Contests error: %s", e)
        if cache_key in _contests_cache:
            return _contests_cache[cache_key][0]
        return {"error": str(e), "Contests": []}


# ---- Search ------------------------------------------------------------------

@router.get("/draftkings/search")
async def api_draftkings_search(
    q: str = Query(..., description="Search query (team, event, etc.)"),
    limit: int = Query(10, description="Max results"),
) -> Dict[str, Any]:
    """Search DraftKings events across all sports by keyword."""
    start_time = time.time()
    q_lower = q.lower().strip()

    # Search across cached events
    matching = []
    for cache_key, (events, _) in _events_cache.items():
        for event in events:
            name = (event.get("name") or "").lower()
            t1 = (event.get("team_1") or "").lower()
            t2 = (event.get("team_2") or "").lower()
            if q_lower in name or q_lower in t1 or q_lower in t2:
                ev = dict(event)
                ev["matched_sport"] = cache_key.replace("events_", "")
                matching.append(ev)

    # If no cached results, fetch popular sports first
    if not matching:
        for sn in ["NFL", "NBA", "MLB", "NHL", "UFC"]:
            try:
                result = await api_draftkings_events(sport=sn, limit=50)
                for event in result.get("events", []):
                    name = (event.get("name") or "").lower()
                    t1 = (event.get("team_1") or "").lower()
                    t2 = (event.get("team_2") or "").lower()
                    if q_lower in name or q_lower in t1 or q_lower in t2:
                        ev = dict(event)
                        ev["matched_sport"] = sn
                        matching.append(ev)
            except Exception:
                pass

    _log_timing("search", start_time, f"(q='{q}', {len(matching)} matches)")
    return {"events": matching[:limit], "query": q, "count": len(matching)}
