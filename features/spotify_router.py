# =============================================================================
# SPOTIFY INTEGRATION ROUTER
# =============================================================================
# Supports: OAuth 2.0 Authorization Code Flow, token management, search proxy.
# Auth: OAuth 2.0 Authorization Code Flow
# Docs: https://developer.spotify.com/documentation/web-api
# =============================================================================

import os
import time
import json
import logging
import base64
from typing import Optional, Dict, Any

import httpx
from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse

logger = logging.getLogger("q4nt.spotify")

# --- Configuration ---
SPOTIFY_CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID", "")
SPOTIFY_CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET", "")
SPOTIFY_REDIRECT_URI = os.getenv("SPOTIFY_REDIRECT_URI", "http://localhost:5052/api/spotify/callback")
SPOTIFY_TOKEN_FILE = os.getenv("SPOTIFY_TOKEN_FILE", "spotify_tokens.json")

SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_API_URL = "https://api.spotify.com/v1"

# Scopes for read-only music data access
SPOTIFY_SCOPES = "user-read-private user-read-email user-top-read user-library-read"

SPOTIFY_AVAILABLE = bool(SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET)

router = APIRouter(tags=["spotify"])

# Shared httpx client for connection pooling
_spotify_http: httpx.AsyncClient | None = None
_spotify_app_token: Dict[str, Any] = {}

def _client() -> httpx.AsyncClient:
    global _spotify_http
    if _spotify_http is None:
        _spotify_http = httpx.AsyncClient(
            timeout=15.0,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _spotify_http

if SPOTIFY_AVAILABLE:
    logger.info("[Spotify] Integration configured (client_id: %s...)", SPOTIFY_CLIENT_ID[:8])
else:
    logger.warning("[Spotify] NOT configured -- set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env")


def _log_timing(label: str, start: float, extra: str = ""):
    elapsed = int((time.time() - start) * 1000)
    logger.info("[Spotify] %s completed in %dms %s", label, elapsed, extra)


# ---- Token Management --------------------------------------------------------

def _token_path() -> str:
    return os.path.join(os.path.dirname(__file__), "..", SPOTIFY_TOKEN_FILE)


def _load_tokens() -> Optional[Dict[str, Any]]:
    """Load stored OAuth tokens from file."""
    path = _token_path()
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r") as f:
            tokens = json.load(f)
        # Check expiry
        if tokens.get("expires_at", 0) > time.time():
            return tokens
        # Try refresh
        if tokens.get("refresh_token"):
            return _refresh_token(tokens["refresh_token"])
    except Exception as e:
        logger.warning("[Spotify] Failed to load tokens: %s", e)
    return None


def _save_tokens(tokens: Dict[str, Any]) -> None:
    """Persist OAuth tokens to disk."""
    try:
        with open(_token_path(), "w") as f:
            json.dump(tokens, f, indent=2)
        logger.info("[Spotify] Tokens saved")
    except Exception as e:
        logger.error("[Spotify] Failed to save tokens: %s", e)


def _refresh_token(refresh_token: str) -> Optional[Dict[str, Any]]:
    """Refresh access token using refresh token (synchronous)."""
    try:
        creds = base64.b64encode(f"{SPOTIFY_CLIENT_ID}:{SPOTIFY_CLIENT_SECRET}".encode()).decode()
        import urllib.request
        import urllib.parse
        body = urllib.parse.urlencode({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }).encode()
        req = urllib.request.Request(
            SPOTIFY_TOKEN_URL,
            data=body,
            headers={
                "Authorization": f"Basic {creds}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        tokens = {
            "access_token": data["access_token"],
            # Spotify may or may not return a new refresh token
            "refresh_token": data.get("refresh_token", refresh_token),
            "expires_at": time.time() + data.get("expires_in", 3600),
            "token_type": data.get("token_type", "Bearer"),
        }
        _save_tokens(tokens)
        logger.info("[Spotify] Token refreshed successfully")
        return tokens
    except Exception as e:
        logger.error("[Spotify] Token refresh error: %s", e)
        return None


async def _get_client_credentials_token() -> Optional[str]:
    """Get an app access token for public Spotify catalog requests."""
    global _spotify_app_token
    if _spotify_app_token.get("expires_at", 0) > time.time() + 30:
        return _spotify_app_token.get("access_token")

    if not SPOTIFY_AVAILABLE:
        return None

    try:
        creds = base64.b64encode(f"{SPOTIFY_CLIENT_ID}:{SPOTIFY_CLIENT_SECRET}".encode()).decode()
        resp = await _client().post(
            SPOTIFY_TOKEN_URL,
            headers={
                "Authorization": f"Basic {creds}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={"grant_type": "client_credentials"},
        )
        resp.raise_for_status()
        data = resp.json()
        _spotify_app_token = {
            "access_token": data["access_token"],
            "expires_at": time.time() + data.get("expires_in", 3600),
            "token_type": data.get("token_type", "Bearer"),
        }
        return _spotify_app_token["access_token"]
    except Exception as e:
        logger.error("[Spotify] Client credentials token error: %s", e)
        return None


async def _get_catalog_token() -> Optional[str]:
    """Prefer a user token when present, otherwise use client credentials."""
    tokens = _load_tokens() if SPOTIFY_AVAILABLE else None
    if tokens and tokens.get("access_token"):
        return tokens["access_token"]
    return await _get_client_credentials_token()


# ---- OAuth Flow --------------------------------------------------------------

@router.get("/spotify/auth")
async def api_spotify_auth() -> Dict[str, Any]:
    """Get the OAuth authorization URL. User must visit this URL to log in."""
    if not SPOTIFY_AVAILABLE:
        return {"error": "Spotify not configured. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env"}
    auth_url = (
        f"{SPOTIFY_AUTH_URL}"
        f"?client_id={SPOTIFY_CLIENT_ID}"
        f"&response_type=code"
        f"&redirect_uri={SPOTIFY_REDIRECT_URI}"
        f"&scope={SPOTIFY_SCOPES.replace(' ', '%20')}"
        f"&show_dialog=true"
    )
    return {"auth_url": auth_url, "instruction": "Open this URL in your browser to authorize the app."}


@router.get("/spotify/callback", response_class=HTMLResponse)
async def api_spotify_callback(
    code: str = Query(..., description="Authorization code from Spotify"),
) -> HTMLResponse:
    """Handle OAuth callback; exchange authorization code for tokens.
    Returns an HTML page that posts the token to the opener window and closes."""
    if not SPOTIFY_AVAILABLE:
        return HTMLResponse("<html><body><h2>Spotify not configured</h2></body></html>", status_code=400)
    try:
        creds = base64.b64encode(f"{SPOTIFY_CLIENT_ID}:{SPOTIFY_CLIENT_SECRET}".encode()).decode()
        resp = await _client().post(
            SPOTIFY_TOKEN_URL,
            headers={
                "Authorization": f"Basic {creds}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": SPOTIFY_REDIRECT_URI,
            },
        )
        resp.raise_for_status()
        data = resp.json()

        tokens = {
            "access_token": data["access_token"],
            "refresh_token": data.get("refresh_token"),
            "expires_at": time.time() + data.get("expires_in", 3600),
            "token_type": data.get("token_type", "Bearer"),
        }
        _save_tokens(tokens)

        # Return an HTML page that signals the opener and closes
        html = f"""<!DOCTYPE html>
<html><head><title>Spotify Connected</title>
<style>
  body {{ font-family: 'DM Sans', Inter, sans-serif; background: #191414; color: #1DB954;
         display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
  .card {{ text-align: center; padding: 40px; border-radius: 16px;
           background: rgba(255,255,255,0.05); border: 1px solid rgba(29,185,84,0.3); }}
  h2 {{ margin: 0 0 8px; font-size: 24px; }}
  p {{ color: #b3b3b3; font-size: 14px; margin: 0; }}
</style></head>
<body>
<div class="card">
  <h2>Spotify Connected</h2>
  <p>You can close this window.</p>
</div>
<script>
  try {{
    if (window.opener) {{
      window.opener.postMessage({{
        type: 'spotify-auth-success',
        access_token: '{data["access_token"]}',
        expires_in: {data.get("expires_in", 3600)}
      }}, '*');
    }}
  }} catch(e) {{}}
  setTimeout(function() {{ window.close(); }}, 2000);
</script>
</body></html>"""
        return HTMLResponse(html)
    except httpx.HTTPStatusError as e:
        logger.error("[Spotify] OAuth callback HTTP error: %s -- %s", e.response.status_code, e.response.text)
        html_err = f"""<!DOCTYPE html>
<html><head><title>Spotify Auth Error</title>
<style>body{{font-family:sans-serif;background:#191414;color:#ff4444;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}}</style>
</head><body><div style="text-align:center"><h2>Authentication Failed</h2><p>{e.response.status_code}: {e.response.text[:200]}</p></div></body></html>"""
        return HTMLResponse(html_err, status_code=400)
    except Exception as e:
        logger.error("[Spotify] OAuth callback error: %s", e)
        html_err = f"""<!DOCTYPE html>
<html><head><title>Spotify Auth Error</title>
<style>body{{font-family:sans-serif;background:#191414;color:#ff4444;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}}</style>
</head><body><div style="text-align:center"><h2>Authentication Failed</h2><p>{str(e)[:200]}</p></div></body></html>"""
        return HTMLResponse(html_err, status_code=500)


@router.get("/spotify/status")
async def api_spotify_status() -> Dict[str, Any]:
    """Check if Spotify OAuth tokens are valid."""
    if not SPOTIFY_AVAILABLE:
        return {"configured": False, "authenticated": False}
    tokens = _load_tokens()
    if tokens:
        return {
            "configured": True,
            "authenticated": True,
            "expires_at": tokens.get("expires_at"),
            "seconds_remaining": max(0, int(tokens.get("expires_at", 0) - time.time())),
        }
    return {"configured": True, "authenticated": False, "message": "Visit /api/spotify/auth to authenticate"}


@router.get("/spotify/token")
async def api_spotify_token() -> Dict[str, Any]:
    """Return current access token for the frontend SpotifyAPI client."""
    if not SPOTIFY_AVAILABLE:
        return {"error": "Spotify not configured"}
    tokens = _load_tokens()
    if not tokens:
        return {"error": "Not authenticated. Visit /api/spotify/auth first."}
    return {
        "access_token": tokens["access_token"],
        "expires_in": max(0, int(tokens.get("expires_at", 0) - time.time())),
        "token_type": tokens.get("token_type", "Bearer"),
    }


@router.get("/spotify/search")
async def api_spotify_search(
    q: str = Query(..., min_length=1, description="Spotify search query"),
    search_type: str = Query("track", alias="type", description="Comma-separated item types to search"),
    limit: int = Query(20, ge=1, le=50),
    market: str = Query("US", min_length=2, max_length=2),
) -> Dict[str, Any]:
    """Proxy Spotify catalog search with server-side credentials."""
    if not SPOTIFY_AVAILABLE:
        return {"error": "Spotify not configured. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env"}

    allowed_types = {"album", "artist", "track", "playlist", "show", "episode", "audiobook"}
    requested_types = [item.strip() for item in search_type.split(",") if item.strip()]
    if not requested_types or any(item not in allowed_types for item in requested_types):
        return {"error": f"Invalid Spotify search type: {search_type}"}

    token = await _get_catalog_token()
    if not token:
        return {"error": "Spotify authentication unavailable"}

    start = time.time()
    try:
        resp = await _client().get(
            f"{SPOTIFY_API_URL}/search",
            headers={"Authorization": f"Bearer {token}"},
            params={
                "q": q,
                "type": ",".join(requested_types),
                "limit": limit,
                "market": market.upper(),
            },
        )
        resp.raise_for_status()
        data = resp.json()
        data["_q4nt"] = {
            "source": "spotify",
            "query": q,
            "type": ",".join(requested_types),
            "market": market.upper(),
        }
        _log_timing("Search", start, f"q={q!r} type={search_type!r}")
        return data
    except httpx.HTTPStatusError as e:
        logger.error("[Spotify] Search HTTP error: %s -- %s", e.response.status_code, e.response.text)
        return {
            "error": "Spotify search failed",
            "status": e.response.status_code,
            "details": e.response.text[:300],
        }
    except Exception as e:
        logger.error("[Spotify] Search error: %s", e)
        return {"error": str(e)}
