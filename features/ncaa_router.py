# =============================================================================
# NCAA SPORTS DATA ROUTER (via henrygd/ncaa-api proxy)
# =============================================================================
# Proxies requests to the public ncaa-api.henrygd.me service.
# Provides live scores, standings, rankings, and schedules for
# NCAA Division I Men's and Women's Basketball, Football, and more.
# Rate limit: 5 req/sec/IP on upstream; we cache aggressively to minimize hits.
# =============================================================================

import time
import logging
from typing import Optional, Dict, Any

import httpx
from fastapi import APIRouter, Query

logger = logging.getLogger("q4nt.ncaa")

NCAA_API_URL = "https://ncaa-api.henrygd.me"

router = APIRouter(tags=["ncaa"])

# Shared httpx client for connection pooling
_ncaa_http: httpx.AsyncClient | None = None

def _client() -> httpx.AsyncClient:
    global _ncaa_http
    if _ncaa_http is None:
        _ncaa_http = httpx.AsyncClient(
            timeout=10.0,
            headers={"User-Agent": "Mozilla/5.0"},
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _ncaa_http

logger.info("[NCAA] Integration loaded (henrygd NCAA API proxy, no auth required)")


def _log_timing(label: str, start: float, extra: str = ""):
    elapsed = int((time.time() - start) * 1000)
    logger.info("[NCAA] %s completed in %dms %s", label, elapsed, extra)


# --- In-memory caches ---------------------------------------------------------

_scoreboard_cache: Dict[str, tuple] = {}  # {cache_key: (data, timestamp)}
SCOREBOARD_CACHE_TTL = 60.0  # 1 minute (live scores need freshness)

_standings_cache: Dict[str, tuple] = {}
STANDINGS_CACHE_TTL = 900.0  # 15 minutes

_rankings_cache: Dict[str, tuple] = {}
RANKINGS_CACHE_TTL = 1800.0  # 30 minutes


# ---- Scoreboard / Live Scores ------------------------------------------------

@router.get("/ncaa/scoreboard")
async def api_ncaa_scoreboard(
    sport: str = Query("basketball-men", description="Sport (basketball-men, basketball-women, football, etc.)"),
    division: str = Query("d1", description="Division (d1, d2, d3)"),
    date: Optional[str] = Query(None, description="Date in YYYY/MM/DD format (defaults to today)"),
) -> Dict[str, Any]:
    """Get live scoreboard for NCAA sports."""
    start_time = time.time()

    cache_key = f"scoreboard_{sport}_{division}_{date or 'today'}"
    if cache_key in _scoreboard_cache:
        cached_data, cached_time = _scoreboard_cache[cache_key]
        if time.time() - cached_time < SCOREBOARD_CACHE_TTL:
            _log_timing("scoreboard (cached)", start_time)
            return cached_data

    path = f"/scoreboard/{sport}/{division}"
    if date:
        path += f"/{date}"

    try:
        resp = await _client().get(f"{NCAA_API_URL}{path}")
        resp.raise_for_status()
        data = resp.json()

        # Extract games from response
        games_raw = data.get("games", [])
        games = []
        for g in games_raw:
            game = g.get("game", g)
            home = game.get("home", {})
            away = game.get("away", {})
            games.append({
                "home_team": (home.get("names", {}).get("short") or home.get("name") or
                              home.get("school") or "Home"),
                "away_team": (away.get("names", {}).get("short") or away.get("name") or
                              away.get("school") or "Away"),
                "home_score": home.get("score", home.get("totalScore")),
                "away_score": away.get("score", away.get("totalScore")),
                "status": game.get("gameState", game.get("status", "")),
                "period": game.get("currentPeriod", game.get("period", "")),
                "clock": game.get("contestClock", game.get("clock", "")),
                "game_id": game.get("gameID", game.get("url", "")),
                "start_time": game.get("startTime", game.get("startTimeEpoch", "")),
            })

        result = {
            "games": games,
            "count": len(games),
            "sport": sport,
            "division": division,
            "source": "live",
        }
        _scoreboard_cache[cache_key] = (result, time.time())
        _log_timing("scoreboard", start_time, f"({len(games)} games for {sport}/{division})")
        return result
    except Exception as e:
        logger.error("[NCAA] Scoreboard error: %s", e)
        if cache_key in _scoreboard_cache:
            cached_data, _ = _scoreboard_cache[cache_key]
            cached_data["source"] = "stale_cache"
            return cached_data
        return {"error": str(e), "games": [], "count": 0}


# ---- Standings ---------------------------------------------------------------

@router.get("/ncaa/standings")
async def api_ncaa_standings(
    sport: str = Query("basketball-men", description="Sport"),
    division: str = Query("d1", description="Division"),
) -> Dict[str, Any]:
    """Get NCAA standings."""
    start_time = time.time()

    cache_key = f"standings_{sport}_{division}"
    if cache_key in _standings_cache:
        cached_data, cached_time = _standings_cache[cache_key]
        if time.time() - cached_time < STANDINGS_CACHE_TTL:
            _log_timing("standings (cached)", start_time)
            return cached_data

    try:
        resp = await _client().get(f"{NCAA_API_URL}/standings/{sport}/{division}")
        resp.raise_for_status()
        data = resp.json()

        result = {"standings": data, "sport": sport, "division": division, "source": "live"}
        _standings_cache[cache_key] = (result, time.time())
        _log_timing("standings", start_time)
        return result
    except Exception as e:
        logger.error("[NCAA] Standings error: %s", e)
        if cache_key in _standings_cache:
            cached_data, _ = _standings_cache[cache_key]
            cached_data["source"] = "stale_cache"
            return cached_data
        return {"error": str(e), "standings": {}}


# ---- Rankings ----------------------------------------------------------------

@router.get("/ncaa/rankings")
async def api_ncaa_rankings(
    sport: str = Query("basketball-men", description="Sport"),
    division: str = Query("d1", description="Division"),
) -> Dict[str, Any]:
    """Get NCAA rankings (AP Poll, etc.)."""
    start_time = time.time()

    cache_key = f"rankings_{sport}_{division}"
    if cache_key in _rankings_cache:
        cached_data, cached_time = _rankings_cache[cache_key]
        if time.time() - cached_time < RANKINGS_CACHE_TTL:
            _log_timing("rankings (cached)", start_time)
            return cached_data

    try:
        resp = await _client().get(f"{NCAA_API_URL}/rankings/{sport}/{division}")
        resp.raise_for_status()
        data = resp.json()

        result = {"rankings": data, "sport": sport, "division": division, "source": "live"}
        _rankings_cache[cache_key] = (result, time.time())
        _log_timing("rankings", start_time)
        return result
    except Exception as e:
        logger.error("[NCAA] Rankings error: %s", e)
        if cache_key in _rankings_cache:
            cached_data, _ = _rankings_cache[cache_key]
            cached_data["source"] = "stale_cache"
            return cached_data
        return {"error": str(e), "rankings": {}}


# ---- Game Details ------------------------------------------------------------

@router.get("/ncaa/game/{game_id}/boxscore")
async def api_ncaa_boxscore(game_id: str) -> Dict[str, Any]:
    """Get box score for a specific game."""
    start_time = time.time()
    try:
        resp = await _client().get(f"{NCAA_API_URL}/game/{game_id}/boxscore")
        resp.raise_for_status()
        data = resp.json()

        _log_timing("boxscore", start_time, f"(game={game_id})")
        return {"boxscore": data, "game_id": game_id, "source": "live"}
    except Exception as e:
        logger.error("[NCAA] Boxscore error for %s: %s", game_id, e)
        return {"error": str(e), "boxscore": {}, "game_id": game_id}
