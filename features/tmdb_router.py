import os
import time
import logging
from typing import Dict, Any
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from backend.core.cache import SimpleCache, log_timing
import httpx
import os
_http_client = httpx.AsyncClient()

logger = logging.getLogger("main_server")
router = APIRouter(tags=["tmdb"])

# =============================================================================
# TMDb (The Movie Database) ENDPOINTS  -- Pop Culture Space
# =============================================================================
TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "")
TMDB_READ_TOKEN = os.environ.get("TMDB_READ_TOKEN", "")
_tmdb_cache = {}  # endpoint_key -> SimpleCache

def _get_tmdb_cache(key: str) -> SimpleCache:
    if key not in _tmdb_cache:
        _tmdb_cache[key] = SimpleCache(ttl_seconds=900.0, name=f"tmdb_{key}")
    return _tmdb_cache[key]

async def _tmdb_fetch(path: str, params: dict = None) -> dict:
    """Fetch from TMDb API v3, using either API key or read token."""
    base = "https://api.themoviedb.org/3"
    url = f"{base}{path}"
    headers = {}
    if params is None:
        params = {}

    if TMDB_READ_TOKEN:
        headers["Authorization"] = f"Bearer {TMDB_READ_TOKEN}"
    elif TMDB_API_KEY:
        params["api_key"] = TMDB_API_KEY
    else:
        raise ValueError("No TMDB_API_KEY or TMDB_READ_TOKEN configured in .env")

    resp = await _http_client.get(url, params=params, headers=headers, timeout=15.0)
    resp.raise_for_status()
    return resp.json()


@router.get("/tmdb/trending/{media_type}")
async def api_tmdb_trending(media_type: str = "movie", time_window: str = "week"):
    """Get trending movies or TV shows from TMDb."""
    start_time = time.time()
    cache_key = f"trending_{media_type}_{time_window}"
    cache = _get_tmdb_cache(cache_key)
    logger.info(f"[API] /api/tmdb/trending/{media_type} called: window={time_window}")

    cached = cache.get()
    if cached is not None:
        log_timing(f"tmdb_trending_{media_type} (cached)", start_time)
        return JSONResponse(content=cached, headers={"Cache-Control": "max-age=900"})

    try:
        data = await _tmdb_fetch(f"/trending/{media_type}/{time_window}")
        results = []
        for item in data.get("results", [])[:20]:
            results.append({
                "id": item.get("id"),
                "title": item.get("title") or item.get("name"),
                "rating": item.get("vote_average", 0),
                "year": (item.get("release_date") or item.get("first_air_date") or "")[:4],
                "overview": (item.get("overview") or "")[:200],
                "poster": f"https://image.tmdb.org/t/p/w185{item['poster_path']}" if item.get("poster_path") else None,
                "backdrop": f"https://image.tmdb.org/t/p/w780{item['backdrop_path']}" if item.get("backdrop_path") else None,
                "popularity": item.get("popularity", 0),
                "media_type": media_type,
            })
        result = {"results": results, "count": len(results), "media_type": media_type, "time_window": time_window}
        cache.set(result)
        log_timing(f"tmdb_trending_{media_type}", start_time, f"({len(results)} items)")
        return JSONResponse(content=result, headers={"Cache-Control": "max-age=900"})
    except Exception as e:
        logger.error(f"[API] TMDb trending error: {e}")
        return JSONResponse(content={"error": str(e), "results": []}, status_code=500)


@router.get("/tmdb/top-rated/{media_type}")
async def api_tmdb_top_rated(media_type: str = "movie"):
    """Get top-rated movies or TV shows from TMDb."""
    start_time = time.time()
    cache_key = f"top_rated_{media_type}"
    cache = _get_tmdb_cache(cache_key)
    logger.info(f"[API] /api/tmdb/top-rated/{media_type} called")

    cached = cache.get()
    if cached is not None:
        log_timing(f"tmdb_top_rated_{media_type} (cached)", start_time)
        return JSONResponse(content=cached, headers={"Cache-Control": "max-age=900"})

    try:
        data = await _tmdb_fetch(f"/{media_type}/top_rated")
        results = []
        for item in data.get("results", [])[:20]:
            results.append({
                "id": item.get("id"),
                "title": item.get("title") or item.get("name"),
                "rating": item.get("vote_average", 0),
                "vote_count": item.get("vote_count", 0),
                "year": (item.get("release_date") or item.get("first_air_date") or "")[:4],
                "overview": (item.get("overview") or "")[:200],
                "poster": f"https://image.tmdb.org/t/p/w185{item['poster_path']}" if item.get("poster_path") else None,
                "media_type": media_type,
            })
        result = {"results": results, "count": len(results), "media_type": media_type}
        cache.set(result)
        log_timing(f"tmdb_top_rated_{media_type}", start_time, f"({len(results)} items)")
        return JSONResponse(content=result, headers={"Cache-Control": "max-age=900"})
    except Exception as e:
        logger.error(f"[API] TMDb top-rated error: {e}")
        return JSONResponse(content={"error": str(e), "results": []}, status_code=500)


@router.get("/tmdb/now-playing")
async def api_tmdb_now_playing():
    """Get movies currently in theaters from TMDb."""
    start_time = time.time()
    cache = _get_tmdb_cache("now_playing")
    logger.info("[API] /api/tmdb/now-playing called")

    cached = cache.get()
    if cached is not None:
        log_timing("tmdb_now_playing (cached)", start_time)
        return JSONResponse(content=cached, headers={"Cache-Control": "max-age=900"})

    try:
        data = await _tmdb_fetch("/movie/now_playing")
        results = []
        for item in data.get("results", [])[:20]:
            results.append({
                "id": item.get("id"),
                "title": item.get("title"),
                "rating": item.get("vote_average", 0),
                "vote_count": item.get("vote_count", 0),
                "release_date": item.get("release_date", ""),
                "overview": (item.get("overview") or "")[:200],
                "poster": f"https://image.tmdb.org/t/p/w185{item['poster_path']}" if item.get("poster_path") else None,
                "popularity": item.get("popularity", 0),
            })
        result = {"results": results, "count": len(results)}
        cache.set(result)
        log_timing("tmdb_now_playing", start_time, f"({len(results)} items)")
        return JSONResponse(content=result, headers={"Cache-Control": "max-age=900"})
    except Exception as e:
        logger.error(f"[API] TMDb now-playing error: {e}")
        return JSONResponse(content={"error": str(e), "results": []}, status_code=500)


@router.get("/tmdb/popular/{media_type}")
async def api_tmdb_popular(media_type: str = "movie"):
    """Get popular movies or TV shows from TMDb."""
    start_time = time.time()
    cache_key = f"popular_{media_type}"
    cache = _get_tmdb_cache(cache_key)
    logger.info(f"[API] /api/tmdb/popular/{media_type} called")

    cached = cache.get()
    if cached is not None:
        log_timing(f"tmdb_popular_{media_type} (cached)", start_time)
        return JSONResponse(content=cached, headers={"Cache-Control": "max-age=900"})

    try:
        data = await _tmdb_fetch(f"/{media_type}/popular")
        results = []
        for item in data.get("results", [])[:20]:
            results.append({
                "id": item.get("id"),
                "title": item.get("title") or item.get("name"),
                "rating": item.get("vote_average", 0),
                "vote_count": item.get("vote_count", 0),
                "year": (item.get("release_date") or item.get("first_air_date") or "")[:4],
                "overview": (item.get("overview") or "")[:200],
                "poster": f"https://image.tmdb.org/t/p/w185{item['poster_path']}" if item.get("poster_path") else None,
                "popularity": item.get("popularity", 0),
                "media_type": media_type,
            })
        result = {"results": results, "count": len(results), "media_type": media_type}
        cache.set(result)
        log_timing(f"tmdb_popular_{media_type}", start_time, f"({len(results)} items)")
        return JSONResponse(content=result, headers={"Cache-Control": "max-age=900"})
    except Exception as e:
        logger.error(f"[API] TMDb popular error: {e}")
        return JSONResponse(content={"error": str(e), "results": []}, status_code=500)





