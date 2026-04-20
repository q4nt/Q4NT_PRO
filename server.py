"""
Q4NT PRO - Main Server
======================
FastAPI application entry point. All business logic has been decomposed into
the `app/` package:
  - app/config.py       : SecretsManager, Config
  - app/logger.py       : CommandLogger
  - app/triage.py       : AITriageAgent
  - app/orchestrator.py : AgentOrchestrator (Regex + AI + Validator + QA)

This file handles only:
  1. FastAPI app creation and middleware
  2. Router mounting (spotify, proxy routers)
  3. API route definitions
  4. uvicorn startup
"""

import os
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from app.config import Config
from app.logger import CommandLogger
from app.orchestrator import AgentOrchestrator
from app.spotify_router import router as spotify_router
from app.api_proxy_routes import all_proxy_routers

# ---------------------------------------------------------------------------
# FastAPI App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Q4NT API Server",
    description="Main server for Q4NT API calls, orchestrator, and agents.",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(spotify_router)

# Mount all API proxy routers (Polygon, Alpaca, NBA, NCAA, Polymarket)
for proxy_router in all_proxy_routers:
    app.include_router(proxy_router)

# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------
@app.post("/api/command")
async def handle_ui_command(request: Request):
    """
    Endpoint for the UI Command Panel.
    3-tier triage: Regex -> AI -> Fallback
    """
    try:
        data = await request.json()
        command = data.get("command", "")
        context = data.get("context", {})
        if not command:
            raise HTTPException(status_code=400, detail="Command is required")

        result, process, metrics = await AgentOrchestrator.execute(command, context)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/command/after-context")
async def update_after_context(request: Request):
    """
    Receives the post-action UI snapshot from the frontend and patches
    the most recent command log entry with it.
    """
    try:
        data = await request.json()
        context = data.get("context", {})
        success = CommandLogger.update_after_context(context)
        return {"status": "ok" if success else "no_entry", "patched": success}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/command/history")
async def get_command_history():
    """
    Returns the complete history of processed commands.
    """
    if not os.path.exists(CommandLogger.LOG_FILE):
        return []
    try:
        with open(CommandLogger.LOG_FILE, "r") as f:
            import json
            return json.load(f)
    except Exception:
        return []

@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "service": "Q4NT Main Server",
        "ai_triage_available": bool(Config.OPENAI_API_KEY),
        "model": Config.AI_FAST_MODEL,
    }

if __name__ == "__main__":
    # Run the main server that API calls will run from
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
