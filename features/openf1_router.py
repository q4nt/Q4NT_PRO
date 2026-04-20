import logging
from typing import Dict, Any, Optional
import httpx
from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger("api.openf1")
router = APIRouter()

OPENF1_BASE_URL = "https://api.openf1.org/v1"

@router.get("/location")
async def get_location(
    session_key: str = Query(..., description="Session Key (e.g. 9161 or 'latest')"),
    driver_number: Optional[int] = Query(None, description="Formula 1 driver number"),
    date_start: Optional[str] = Query(None, alias="date>"),
    date_end: Optional[str] = Query(None, alias="date<")
):
    """Get location data from OpenF1 API"""
    try:
        params = {"session_key": session_key}
        if driver_number is not None:
            params["driver_number"] = driver_number
        if date_start:
            params["date>"] = date_start
        if date_end:
            params["date<"] = date_end
            
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{OPENF1_BASE_URL}/location", params=params, timeout=20.0)
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        logger.error(f"[OpenF1] Failed to fetch location data: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/sessions")
async def get_sessions(
    meeting_key: Optional[str] = Query(None),
    year: Optional[int] = Query(None)
):
    """Get sessions from OpenF1"""
    try:
        params = {}
        if meeting_key:
            params["meeting_key"] = meeting_key
        if year:
            params["year"] = year
            
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{OPENF1_BASE_URL}/sessions", params=params, timeout=20.0)
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        logger.error(f"[OpenF1] Failed to fetch sessions data: {e}")
        raise HTTPException(status_code=500, detail=str(e))
