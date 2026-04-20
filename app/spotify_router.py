from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import JSONResponse, RedirectResponse
import os
import requests
import base64
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(prefix="/api/spotify", tags=["spotify"])

# Spotify Credentials (to be added to .env)
SPOTIFY_CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID", "")
SPOTIFY_CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET", "")
SPOTIFY_REDIRECT_URI = os.getenv("SPOTIFY_REDIRECT_URI", "http://localhost:8000/api/spotify/callback")

# In-memory storage for tokens (in a real app, use a database or session)
spotify_tokens = {
    "access_token": None,
    "refresh_token": None
}

@router.get("/login")
def login():
    """Redirect to Spotify login page"""
    scope = "user-read-playback-state user-modify-playback-state user-read-currently-playing"
    auth_url = (
        f"https://accounts.spotify.com/authorize?response_type=code"
        f"&client_id={SPOTIFY_CLIENT_ID}&scope={scope}&redirect_uri={SPOTIFY_REDIRECT_URI}"
    )
    return RedirectResponse(auth_url)

@router.get("/callback")
def callback(code: str):
    """Handle callback from Spotify and exchange code for tokens"""
    auth_header = base64.b64encode(f"{SPOTIFY_CLIENT_ID}:{SPOTIFY_CLIENT_SECRET}".encode()).decode()
    
    response = requests.post(
        "https://accounts.spotify.com/api/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": SPOTIFY_REDIRECT_URI,
        },
        headers={
            "Authorization": f"Basic {auth_header}",
            "Content-Type": "application/x-www-form-urlencoded"
        }
    )
    
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to get tokens from Spotify")
    
    tokens = response.json()
    spotify_tokens["access_token"] = tokens.get("access_token")
    spotify_tokens["refresh_token"] = tokens.get("refresh_token")
    
    return RedirectResponse("/")

@router.get("/search")
def search(q: str = "Free Bird"):
    """Proxy search to Spotify or return default data if no credentials"""
    # TODO: Implement real Spotify search when credentials are configured.
    # Currently returns a mock "Free Bird" response as the default.
    return {
        "tracks": {
            "items": [
                {
                    "name": "Free Bird",
                    "artists": [{"name": "Lynyrd Skynyrd"}],
                    "album": {
                        "name": "Pronounced 'Leh-'nerd 'Skin-'nerd",
                        "images": [{"url": "https://i.scdn.co/image/ab67616d0000b273760459955364e0dfb9c6a125"}]
                    },
                    "preview_url": "https://p.scdn.co/mp3-preview/79cc9d535e656e165780d38510a72e737c3527b1",
                    "duration_ms": 548000
                }
            ]
        }
    }
