"""
youtube_router.py - YouTube latest-video resolver via RSS feeds + live detection.
No YouTube Data API key required.  Uses the free Atom feed at
    https://www.youtube.com/feeds/videos.xml?channel_id=<ID>
and a lightweight scrape of /live for live-stream detection.
"""

import time
import asyncio
import logging
import re
from xml.etree import ElementTree

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
import httpx

logger = logging.getLogger("youtube_router")

router = APIRouter(tags=["youtube"])

# ---------------------------------------------------------------------------
# In-memory cache: channel_id -> { videoId, title, isLive, _ts }
# ---------------------------------------------------------------------------
_yt_cache: dict = {}
_YT_CACHE_TTL = 300  # 5 minutes


def _cache_get(channel_id: str) -> dict | None:
    entry = _yt_cache.get(channel_id)
    if entry and (time.time() - entry.get("_ts", 0)) < _YT_CACHE_TTL:
        return entry
    return None


def _cache_set(channel_id: str, data: dict):
    data["_ts"] = time.time()
    _yt_cache[channel_id] = data


# ---------------------------------------------------------------------------
# RSS Feed parser  (returns latest video id + title)
# ---------------------------------------------------------------------------
_ATOM_NS = "{http://www.w3.org/2005/Atom}"
_YT_NS = "{http://www.youtube.com/xml/schemas/2015}"


async def _fetch_rss(client: httpx.AsyncClient, channel_id: str) -> dict | None:
    """Fetch the YouTube RSS/Atom feed and return the newest entry."""
    url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    try:
        resp = await client.get(url, timeout=10.0)
        if resp.status_code != 200:
            logger.warning(f"[YT RSS] {channel_id}: HTTP {resp.status_code}")
            return None
        root = ElementTree.fromstring(resp.text)
        entry = root.find(f"{_ATOM_NS}entry")
        if entry is None:
            return None
        video_id_el = entry.find(f"{_YT_NS}videoId")
        title_el = entry.find(f"{_ATOM_NS}title")
        published_el = entry.find(f"{_ATOM_NS}published")
        return {
            "videoId": video_id_el.text if video_id_el is not None else None,
            "title": title_el.text if title_el is not None else None,
            "published": published_el.text if published_el is not None else None,
        }
    except Exception as e:
        logger.error(f"[YT RSS] {channel_id}: {e}")
        return None


# ---------------------------------------------------------------------------
# Live-stream detection  (lightweight page scrape of /live)
# ---------------------------------------------------------------------------
async def _check_live(client: httpx.AsyncClient, channel_id: str) -> dict | None:
    """Check if a channel is currently live by fetching its /live page."""
    url = f"https://www.youtube.com/channel/{channel_id}/live"
    try:
        resp = await client.get(
            url,
            timeout=10.0,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) "
                              "Chrome/120.0.0.0 Safari/537.36",
                "Accept-Language": "en-US,en;q=0.9",
            },
            follow_redirects=True,
        )
        if resp.status_code != 200:
            return None
        text = resp.text
        # Check for live indicator in the page source
        if '"isLive":true' not in text and '"isLiveBroadcast":true' not in text:
            return None
        # Extract the video ID from the canonical URL or og:url
        m = re.search(r'(?:"videoId"|"video_id")\s*:\s*"([a-zA-Z0-9_-]{11})"', text)
        if not m:
            # Try og:url meta tag
            m = re.search(r'<link\s+rel="canonical"\s+href="https://www\.youtube\.com/watch\?v=([a-zA-Z0-9_-]{11})"', text)
        if not m:
            m = re.search(r'content="https://www\.youtube\.com/watch\?v=([a-zA-Z0-9_-]{11})"', text)
        if m:
            video_id = m.group(1)
            # Try to extract the title
            title_match = re.search(r'"title"\s*:\s*"([^"]{1,200})"', text)
            title = title_match.group(1) if title_match else "Live Stream"
            return {"videoId": video_id, "title": title, "isLive": True}
        return None
    except Exception as e:
        logger.debug(f"[YT Live] {channel_id}: {e}")
        return None


# ---------------------------------------------------------------------------
# Combined resolver: live (prioritized) -> RSS latest
# ---------------------------------------------------------------------------
async def _resolve_channel(client: httpx.AsyncClient, channel_id: str) -> dict:
    """Resolve a single channel: check live first, fall back to RSS."""
    # Check cache
    cached = _cache_get(channel_id)
    if cached:
        return {k: v for k, v in cached.items() if k != "_ts"}

    # Run live check and RSS fetch in parallel
    live_result, rss_result = await asyncio.gather(
        _check_live(client, channel_id),
        _fetch_rss(client, channel_id),
        return_exceptions=True,
    )

    # Handle exceptions gracefully
    if isinstance(live_result, Exception):
        live_result = None
    if isinstance(rss_result, Exception):
        rss_result = None

    # Prioritize live
    if live_result and live_result.get("videoId"):
        result = {
            "videoId": live_result["videoId"],
            "title": live_result.get("title", "Live Stream"),
            "isLive": True,
        }
        _cache_set(channel_id, result)
        logger.info(f"[YT] {channel_id}: LIVE -> {result['videoId']}")
        return result

    # Fall back to RSS
    if rss_result and rss_result.get("videoId"):
        result = {
            "videoId": rss_result["videoId"],
            "title": rss_result.get("title", ""),
            "isLive": False,
        }
        _cache_set(channel_id, result)
        logger.info(f"[YT] {channel_id}: RSS -> {result['videoId']} ({result['title'][:50]})")
        return result

    # No result
    logger.warning(f"[YT] {channel_id}: no video found")
    return {"videoId": None, "title": None, "isLive": False}


# ---------------------------------------------------------------------------
# API endpoint
# ---------------------------------------------------------------------------
@router.get("/yt-latest")
async def api_yt_latest(channels: str = Query(..., description="Comma-separated YouTube channel IDs")):
    """Batch-resolve latest/live video IDs for YouTube channels via RSS feeds."""
    start = time.time()
    channel_ids = [c.strip() for c in channels.split(",") if c.strip()]
    if not channel_ids:
        return JSONResponse(content={"results": {}})

    # Cap at 30 channels per request to avoid abuse
    channel_ids = channel_ids[:30]
    logger.info(f"[API] /api/yt-latest called: {len(channel_ids)} channels")

    async with httpx.AsyncClient(
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        follow_redirects=True,
    ) as client:
        tasks = [_resolve_channel(client, cid) for cid in channel_ids]
        results_list = await asyncio.gather(*tasks, return_exceptions=True)

    results = {}
    for cid, res in zip(channel_ids, results_list):
        if isinstance(res, Exception):
            results[cid] = {"videoId": None, "title": None, "isLive": False}
        else:
            results[cid] = res

    elapsed = int((time.time() - start) * 1000)
    logger.info(f"[API] /api/yt-latest completed: {len(results)} channels in {elapsed}ms")

    return JSONResponse(
        content={"results": results},
        headers={"Cache-Control": "max-age=120"},
    )
