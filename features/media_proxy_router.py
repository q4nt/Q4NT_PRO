import os
import httpx
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response

router = APIRouter(tags=["media_proxy"])

# Whitelist allowed domains to prevent open proxy abuse
ALLOWED_DOMAINS = ["media.giphy.com", "media.tenor.com", "picsum.photos"]

@router.get("/api/media/proxy")
async def proxy_media(url: str):
    """Proxy image requests to bypass frontend CSP and corporate firewalls."""
    if not any(domain in url for domain in ALLOWED_DOMAINS):
        raise HTTPException(status_code=403, detail="Domain not allowed for proxy")
    
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, timeout=10.0)
            if resp.status_code == 200:
                content_type = resp.headers.get("content-type", "image/gif")
                return Response(content=resp.content, media_type=content_type)
            else:
                raise HTTPException(status_code=resp.status_code, detail="Failed to fetch image")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Proxy error: {str(e)}")
