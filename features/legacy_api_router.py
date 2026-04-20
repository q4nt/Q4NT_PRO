
import os
import sys

# Ensure backend directory is in sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import time
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from functools import lru_cache
import hashlib
import json
import re
import httpx
import asyncio
import logging
from datetime import timezone
from contextlib import asynccontextmanager
from urllib.request import Request, urlopen  # Moved from line 1715

from psycopg2.extras import RealDictCursor
from fastapi import FastAPI, Query, HTTPException, Response
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Use centralized configuration and database
from core.config import Config
from core.db_connection import get_connection, release_connection, init_pool, close_pool

from features.insights.insight_backend import get_insight_sentences_with_image, get_insight_sentences_with_dual_images, generate_document_agent
from features.news.fetch_fed_rss import get_latest_fed_news
import workflow_router
from features.market_data import chart_update_service
from features.command_intelligence import command_intelligence
from features.ml_pipeline import ml_router

# =====================================================
# LOGGING CONFIGURATION (uses centralized config with rotation)
# =====================================================
# NOTE: Logging is already configured by core.logging_config which is auto-loaded
# on import. Do NOT add duplicate handlers here - that causes every log to be
# written twice (the original bug).
from core.logging_config import log_timing, setup_cmd_field_logging, LOG_FILE, CmdFieldLogger

# Setup dedicated cmdField logging (this is safe - it creates a separate logger)
setup_cmd_field_logging()

# Store log file path for later use (e.g., in clear_logs endpoint)
log_file_path = str(LOG_FILE)

# Derive command-field log file path from main log file
CMD_LOG_FILE = log_file_path.replace('.log', '_cmd.log')

logger = logging.getLogger("api")
logger.info(f"[API] Using centralized logging: {log_file_path}")

# ---------------------------------------------------------------------------
# Shared httpx.AsyncClient for api.py endpoints (YouTube, Polymarket, etc.)
# Matches the pooled-client pattern used in all feature routers.
# ---------------------------------------------------------------------------
_api_http: httpx.AsyncClient | None = None

def _api_http_client() -> httpx.AsyncClient:
    """Return a shared, connection-pooled httpx.AsyncClient for api.py."""
    global _api_http
    if _api_http is None:
        _api_http = httpx.AsyncClient(
            timeout=20.0,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            headers={"User-Agent": "Q4NT/1.0"},
        )
    return _api_http

# ---------------------------------------------------------------------------
# Shared OpenAI async client helper (avoids repeated in-function imports)
# ---------------------------------------------------------------------------
def _get_openai_async_client(timeout: int = 30):
    """Create an AsyncOpenAI client. Lightweight — shares the event-loop httpx pool."""
    from openai import AsyncOpenAI
    return AsyncOpenAI(api_key=Config.OPENAI_API_KEY, timeout=timeout)

# Discord News Intelligence Router
import importlib.util
discord_router_path = os.path.join(os.path.dirname(__file__), '..', 'news_history_discord', 'api', 'discord_router.py')
try:
    spec = importlib.util.spec_from_file_location("discord_router", discord_router_path)
    discord_router_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(discord_router_module)
    discord_news_router = discord_router_module.router
    DISCORD_NEWS_AVAILABLE = True
    logger.info("[API] Discord News Intelligence router loaded successfully")
except Exception as e:
    DISCORD_NEWS_AVAILABLE = False
    discord_news_router = None
    logger.warning(f"[API] Discord News router not available: {e}")

# --- Database config (uses centralized db_connection module) ---
TABLE_NAME = "market_data.ohlcv_60m"  # Switched to 60m for reduced data volume (~60x fewer bars)

# Use centralized connection functions directly
get_conn = get_connection
release_conn = release_connection


# --- Rate Limiting ---
from collections import defaultdict
import threading

class RateLimiter:
    """Simple in-memory rate limiter for API endpoints."""
    
    def __init__(self, requests_per_minute: int = 60):
        self.requests_per_minute = requests_per_minute
        self.requests: Dict[str, list] = defaultdict(list)
        self._lock = threading.Lock()
    
    def is_allowed(self, client_ip: str) -> bool:
        """Check if request is allowed for this client."""
        current_time = time.time()
        window_start = current_time - 60  # 1 minute window
        
        with self._lock:
            # Clean old requests
            self.requests[client_ip] = [
                t for t in self.requests[client_ip] if t > window_start
            ]
            
            # Remove empty IP entries to prevent unbounded memory growth
            if not self.requests[client_ip]:
                del self.requests[client_ip]
                # First request in new window -- always allowed
                self.requests[client_ip].append(current_time)
                return True
            
            # Check limit
            if len(self.requests[client_ip]) >= self.requests_per_minute:
                return False
            
            # Record request
            self.requests[client_ip].append(current_time)
            return True
    
    def get_remaining(self, client_ip: str) -> int:
        """Get remaining requests for this client."""
        current_time = time.time()
        window_start = current_time - 60
        
        with self._lock:
            active_requests = [
                t for t in self.requests[client_ip] if t > window_start
            ]
            return max(0, self.requests_per_minute - len(active_requests))


# Global rate limiter (60 requests/minute per IP)
_rate_limiter = RateLimiter(requests_per_minute=60)


# --- Lifespan Context Manager (replaces deprecated on_event) ---
# Flag to track if startup cache warming has been completed
_startup_cache_warm_complete = False

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Modern lifespan context manager for FastAPI.
    Replaces deprecated @app.on_event("startup") and @app.on_event("shutdown").
    """
    # Startup
    logger.info("[Server] Starting Q4NT OHLCV + Insight API...")
    init_pool()
    
    # PERFORMANCE: Warm up quick caches on startup
    try:
        logger.info("[Server] Phase 1: Warming ticker cache...")
        # Warm ticker cache (fast - loads from disk cache if available)
        api_tickers()
        logger.info("[Server] Phase 1 complete: Ticker cache loaded")
        
        logger.info("[Server] Phase 2: Warming Fed news cache...")
        # Warm Fed news cache
        api_fed_news(limit=3)
        logger.info("[Server] Phase 2 complete: Fed news cache loaded")
        
        # NOTE: OHLC and Discord news caches are warmed via /api/cache/warm endpoint
        # or automatically on first chart/news request
        logger.info("[Server] Quick cache warming complete. Call POST /api/cache/warm for full OHLC + News pre-load.")
    except Exception as e:
        logger.warning(f"[Server] Cache warming failed (non-critical): {e}")
    
    logger.info("[Server] Q4NT OHLCV + Insight API started successfully")
    
    yield  # App runs here
    
    # Shutdown
    logger.info("[Server] Shutting down Q4NT OHLCV + Insight API...")
    close_pool()
    logger.info("[Server] Shutdown complete")


# --- FastAPI app with lifespan ---
from fastapi import APIRouter
router = APIRouter(
    # FastAPI(
    title="Q4NT OHLCV + Insight API",
    lifespan=lifespan
)

# CORS so browser on same machine can call us




# GZip compression for faster API responses (compress responses > 500 bytes - lowered threshold)
# app.add_middleware(GZipMiddleware, minimum_size=500)





# Include the workflow router
# app.include_router(workflow_router.router, prefix="/api")
# app.include_router(ml_router, prefix="/api")

# Include the ML Train router
from features.ml_train_router import router as ml_train_router
# app.include_router(ml_train_router, prefix="/api")

# Include the SAM3 router
from features.sam3_router import router as sam3_router
# app.include_router(sam3_router, prefix="/api")

# Include the Discord News Intelligence router
if DISCORD_NEWS_AVAILABLE:
    app.include_router(discord_news_router, prefix="/api")
    logger.info("[API] Discord News endpoints available at /api/discord/*")

# Include the Alpaca Trading router
from features.alpaca_router import router as alpaca_router
# app.include_router(alpaca_router, prefix="/api")
logger.info("[API] Alpaca Trading endpoints available at /api/alpaca/*")

# Include the Charles Schwab router
from features.schwab_router import router as schwab_router
# app.include_router(schwab_router, prefix="/api")
logger.info("[API] Charles Schwab endpoints available at /api/schwab/*")

# Include the DraftKings router
from features.draftkings_router import router as draftkings_router
# app.include_router(draftkings_router, prefix="/api")
logger.info("[API] DraftKings endpoints available at /api/draftkings/*")

# Include the NCAA router
from features.ncaa_router import router as ncaa_router
# app.include_router(ncaa_router, prefix="/api")
logger.info("[API] NCAA endpoints available at /api/ncaa/*")

# Include the Chase Banking router (via Plaid)
from features.chase_router import router as chase_router
# app.include_router(chase_router, prefix="/api")
logger.info("[API] Chase Banking endpoints available at /api/chase/*")

# Include the OpenWeatherMap Weather router
from features.weather_router import router as weather_router
# app.include_router(weather_router, prefix="/api")
logger.info("[API] Weather endpoints available at /api/weather/*")

# Include the Spotify router
from features.spotify_router import router as spotify_router
# app.include_router(spotify_router, prefix="/api")
logger.info("[API] Spotify endpoints available at /api/spotify/*")

# Include the Whisper transcription router
from features.whisper_router import router as whisper_router
# app.include_router(whisper_router, prefix="/api")
logger.info("[API] Whisper transcription WebSocket available at /api/ws/whisper-transcribe")

# Include the Unusual Whales router
from features.unusual_whales_router import router as unusual_whales_router
# app.include_router(unusual_whales_router, prefix="/api")
logger.info("[API] Unusual Whales endpoints available at /api/unusual-whales/*")

# Include SerpApi router
from features.serpapi_router import router as serpapi_router
# app.include_router(serpapi_router, prefix="/api")
logger.info("[API] SerpApi endpoints available at /api/serpapi/*")

# Include OpenF1 router
from features.openf1_router import router as openf1_router
# app.include_router(openf1_router, prefix="/api/openf1")
logger.info("[API] OpenF1 endpoints available at /api/openf1/*")

# Include Wildlife / Education Earth Explorer router
from features.wildlife_router import router as wildlife_router
# app.include_router(wildlife_router, prefix="/api")
logger.info("[API] Wildlife Education endpoints available at /api/wildlife/*")


# =====================================================
# AI CAPABILITIES & CONFIGURATION ENDPOINTS
# =====================================================
from core.ai_config import get_ai_config, QueryContext, QueryIntent
from core.agent_protocol import (
    AgentRequest, AgentResponse, AgentPreferences,
    CapabilityRegistry, DataSource
)


@router.get("/api/ai/capabilities")
def api_ai_capabilities() -> Dict[str, Any]:
    """
    Report available AI capabilities and configuration.
    AI agents can use this to understand what the backend supports.
    """
    ai_config = get_ai_config()
    
    return {
        "capabilities": CapabilityRegistry.to_dict(),
        "configuration": ai_config.get_capabilities(),
        "feature_flags": {
            "orchestrator": Config.AI_ENABLE_ORCHESTRATOR,
            "prediction_markets": Config.AI_ENABLE_PREDICTION_MARKETS,
            "news_enrichment": Config.AI_ENABLE_NEWS_ENRICHMENT,
            "technical_analysis": Config.AI_ENABLE_TECHNICAL_ANALYSIS,
        },
        "models": {
            "fast": Config.AI_FAST_MODEL,
            "smart": Config.AI_SMART_MODEL,
            "complexity_threshold": Config.AI_COMPLEXITY_THRESHOLD,
        },
        "limits": {
            "max_response_tokens": Config.AI_MAX_RESPONSE_TOKENS,
            "max_data_rows": Config.AI_MAX_DATA_ROWS,
            "max_history_items": Config.AI_MAX_HISTORY_ITEMS,
        },
        "defaults": {
            "verbosity": Config.AI_DEFAULT_VERBOSITY,
            "format": Config.AI_DEFAULT_FORMAT,
            "include_sources": Config.AI_INCLUDE_SOURCES,
        },
        "active_overrides": ai_config.get_overrides(),
    }


@router.post("/api/ai/configure")
def api_ai_configure(
    key: str = Query(..., description="Parameter to configure"),
    value: Any = Query(..., description="New value"),
    reason: str = Query("", description="Reason for change")
) -> Dict[str, Any]:
    """
    Set a runtime configuration override.
    AI agents can use this to adjust backend behavior dynamically.
    """
    ai_config = get_ai_config()
    
    # Validate key is allowed
    allowed_keys = ["max_rows", "timeout_ms", "cache_ttl"]
    if key not in allowed_keys:
        raise HTTPException(400, f"Key '{key}' not in allowed list: {allowed_keys}")
    
    ai_config.set_override(key, value, reason)
    
    return {
        "status": "ok",
        "key": key,
        "value": value,
        "active_overrides": ai_config.get_overrides(),
    }


@router.delete("/api/ai/configure")
def api_ai_clear_overrides() -> Dict[str, Any]:
    """Clear all runtime configuration overrides."""
    ai_config = get_ai_config()
    ai_config.clear_all_overrides()
    return {"status": "ok", "message": "All overrides cleared"}


@router.get("/DELETED_DUP/api/config/public")
def api_config_public() -> Dict[str, Any]:
    """
    Return public configuration keys needed by the frontend.
    Only non-secret or intentionally-shared keys are exposed here.
    """
    return {
        "polygon_api_key": os.environ.get("POLYGON_API_KEY", ""),
        "mapbox_token": os.environ.get("MAPBOX_TOKEN", ""),
    }


# =====================================================
# TELEMETRY ENDPOINTS
# =====================================================

class InteractionLogRequest(BaseModel):
    prompt: str
    lane: str
    reasoning: Dict[str, Any]
    result: Dict[str, Any]
    duration_ms: float
    client_timestamp: Optional[str] = None
    timing: Optional[Dict[str, float]] = None
    detected_entities: Optional[Dict[str, Any]] = None
    session_id: Optional[str] = None

@router.post("/api/log_interaction")
async def api_log_interaction(request: InteractionLogRequest):
    """
    Log a complete interaction journey from the frontend.
    This creates a high-fidelity training data point in cmd_field.log
    """
    try:
        cmd_logger = CmdFieldLogger()
        
        # tag client telemetry
        if "debug" not in request.result:
            request.result["debug"] = {}
        request.result["debug"]["source"] = "client_telemetry"
        
        cmd_logger.log_interaction(
            prompt=request.prompt,
            lane=request.lane,
            reasoning=request.reasoning,
            result=request.result,
            duration_ms=request.duration_ms,
            timing=request.timing,
            detected_entities=request.detected_entities,
            session_id=request.session_id
        )
        return {"status": "logged"}
    except Exception as e:
        logger.error(f"[API] Failed to log interaction: {e}")
        # Don't fail the request, just log error
        return {"status": "error", "message": str(e)}


# Server start time for uptime tracking
_server_start_time = time.time()

@router.get("/api/health")
def api_health() -> Dict[str, Any]:
    """
    Consolidated health/status endpoint for all Q4NT services.
    Returns status of: API Server, Database, Discord News, OHLCV Sync,
    plus external API connectivity (OpenAI, Polygon).
    """
    def sanitize(s: str) -> str:
        """Sanitize string to prevent Unicode surrogate errors."""
        try:
            return s.encode('utf-8', 'replace').decode('utf-8')
        except Exception:
            return "Encoding Error"

    try:
        start_time = time.time()
        logger.debug("[API] /api/health called")
        
        services = []
        
        # 1. API Server (always online if this endpoint responds)
        uptime_seconds = time.time() - _server_start_time
        uptime_str = f"{int(uptime_seconds // 3600)}h {int((uptime_seconds % 3600) // 60)}m"
        services.append({
            "name": "Q4NT API Server",
            "status": "online",
            "icon": "⚡",
            "details": f"Uptime: {uptime_str}",
            "port": Config.API_PORT
        })
        
        # 2. Database Connection + 3. Discord News + 4. OHLCV Data
        # Use a single shared DB connection for all three checks
        db_status = "offline"
        db_details = "Unable to connect"
        discord_status = "online" if DISCORD_NEWS_AVAILABLE else "offline"
        discord_details = "Router loaded" if DISCORD_NEWS_AVAILABLE else "Not available"
        ohlcv_status = "unknown"
        ohlcv_details = "Checking..."
        
        health_conn = None
        try:
            health_conn = get_conn()
            
            # 2a. Basic DB connectivity
            with health_conn.cursor() as cur:
                cur.execute("SELECT 1")
            db_status = "online"
            db_details = "Connected to PostgreSQL"
            
            # 3a. Discord News check (reuses same connection)
            if DISCORD_NEWS_AVAILABLE:
                try:
                    with health_conn.cursor() as cur:
                        cur.execute("SELECT COUNT(*) FROM discord_news.event WHERE event_time >= NOW() - INTERVAL '24 hours'")
                        count = cur.fetchone()[0]
                    discord_details = f"{count} events (24h)"
                except Exception as e:
                    discord_details = "Schema may not exist"
            
            # 4a. OHLCV data check (reuses same connection)
            try:
                with health_conn.cursor() as cur:
                    cur.execute("""
                        SELECT MAX(bar_time) as latest, COUNT(*) as total 
                        FROM market_data.ohlcv_1m 
                        WHERE bar_time >= NOW() - INTERVAL '1 day'
                    """)
                    row = cur.fetchone()
                    latest_time = row[0]
                    count = row[1]
                
                if latest_time:
                    ohlcv_status = "online"
                    ohlcv_details = f"{count:,} bars (24h)"
                else:
                    ohlcv_status = "stale"
                    ohlcv_details = "No recent data"
            except Exception as e:
                ohlcv_status = "error"
                ohlcv_details = sanitize(str(e)[:50])
        
        except Exception as e:
            db_details = sanitize(str(e)[:50])
        finally:
            if health_conn:
                release_conn(health_conn)
        
        services.append({
            "name": "PostgreSQL Database",
            "status": db_status,
            "icon": "\U0001f5c4\ufe0f",
            "details": db_details
        })
        
        services.append({
            "name": "Discord News Sync",
            "status": discord_status,
            "icon": "\U0001f4f0",
            "details": sanitize(discord_details)
        })
        
        services.append({
            "name": "OHLCV Market Data",
            "status": ohlcv_status,
            "icon": "\U0001f4ca",
            "details": ohlcv_details
        })
        
        # 5. OpenAI API Status
        openai_status = "unknown"
        openai_details = "Not configured"
        if Config.OPENAI_API_KEY:
            openai_status = "configured"
            openai_details = f"Model: {Config.OPENAI_MODEL}"
        
        services.append({
            "name": "OpenAI API",
            "status": openai_status,
            "icon": "🤖",
            "details": openai_details
        })
        
        # 6. Polygon API Status
        polygon_status = "offline"
        polygon_details = "API key not set"
        if Config.POLYGON_API_KEY:
            polygon_status = "configured"
            polygon_details = "API key present"
        
        services.append({
            "name": "Polygon Market Data",
            "status": polygon_status,
            "icon": "📈",
            "details": polygon_details
        })
        
        # 7. Disk Space (logs directory)
        disk_status = "unknown"
        disk_details = "Unable to check"
        try:
            import shutil
            total, used, free = shutil.disk_usage(Config.LOGS_DIR)
            free_gb = free / (1024 ** 3)
            total_gb = total / (1024 ** 3)
            used_pct = (used / total) * 100
            
            if free_gb > 5:
                disk_status = "healthy"
                disk_details = f"{free_gb:.1f} GB free ({100-used_pct:.0f}%)"
            elif free_gb > 1:
                disk_status = "warning"
                disk_details = f"{free_gb:.1f} GB free - low!"
            else:
                disk_status = "critical"
                disk_details = f"{free_gb:.2f} GB free - CRITICAL"
        except Exception as e:
            disk_details = sanitize(str(e)[:50])
        
        services.append({
            "name": "Disk Space",
            "status": disk_status,
            "icon": "💾",
            "details": disk_details
        })
        
        # 8. Rate Limiter Status
        services.append({
            "name": "Rate Limiter",
            "status": "active",
            "icon": "🚦",
            "details": f"{_rate_limiter.requests_per_minute} req/min per IP"
        })
        
        # Overall status (core services only)
        core_services = [s for s in services if s["name"] in [
            "Q4NT API Server", "PostgreSQL Database", "OHLCV Market Data"
        ]]
        all_online = all(s["status"] in ["online", "healthy", "active"] for s in core_services)
        
        result = {
            "overall": "healthy" if all_online else "degraded",
            "timestamp": datetime.now().isoformat(),
            "services": services,
            "config": {
                "rate_limit": f"{_rate_limiter.requests_per_minute}/min",
                "cache_sizes": {
                    "ohlcv": len(_ohlcv_cache),
                    "ohlcv_max": Config.MAX_OHLCV_CACHE_SIZE
                }
            }
        }
        
        log_timing("api_health", start_time)
        return result

    except Exception as critical_e:
        logger.error(f"[API] Critical failure in /health: {critical_e}", exc_info=True)
        return {
            "overall": "critical",
            "timestamp": datetime.now().isoformat(),
            "services": [],
            "error": "Critical Health Check Failure",
            "details": sanitize(str(critical_e))
        }


@router.get("/api/rate-limit-status")
def api_rate_limit_status(request_ip: str = Query("127.0.0.1", description="IP to check")) -> Dict[str, Any]:
    """
    Check rate limit status for an IP address.
    Useful for debugging and monitoring rate limiting.
    """
    return {
        "ip": request_ip,
        "remaining": _rate_limiter.get_remaining(request_ip),
        "limit": _rate_limiter.requests_per_minute,
        "window": "1 minute"
    }

@router.get("/api/chart-updates")
async def api_chart_updates():
    """
    SSE endpoint for real-time chart updates.
    Charts listen here to know when to refresh their data.
    """
    logger.info("[SSE] New client connecting to chart updates stream")
    
    queue = chart_update_service.register_sse_client()
    
    async def event_generator():
        try:
            # Send initial connection message
            yield f"data: {json.dumps({'type': 'connected', 'clients': chart_update_service.get_client_count()})}\n\n"
            
            # Send recent updates
            for update in chart_update_service.get_recent_updates(10):
                yield f"data: {json.dumps(update)}\n\n"
            
            # Stream updates
            async for event in chart_update_service.sse_generator(queue):
                yield event
        finally:
            chart_update_service.unregister_sse_client(queue)
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"  # Disable nginx buffering
        }
    )


class TickerUpdateNotification(BaseModel):
    ticker: str
    bars_added: int
    latest_bar_time: Optional[str] = None
    price_data: Optional[Dict[str, Any]] = None  # For SSE watchlist push


class SyncCompleteNotification(BaseModel):
    tickers_updated: int
    total_bars: int
    duration_seconds: float


@router.post("/api/notify-ticker-update")
async def notify_ticker_update(notification: TickerUpdateNotification):
    """
    Called by OHLCV sync when a ticker is updated.
    Pushes update to all connected SSE clients.
    Includes price_data for watchlist SSE push (eliminates polling).
    """
    chart_update_service.notify_ticker_updated(
        notification.ticker,
        notification.bars_added,
        notification.latest_bar_time,
        notification.price_data  # Pass price data for SSE push
    )
    return {"status": "ok", "clients_notified": chart_update_service.get_client_count()}


@router.post("/api/notify-sync-complete")
async def notify_sync_complete(notification: SyncCompleteNotification):
    """
    Called by OHLCV sync when a full sync cycle completes.
    """
    chart_update_service.notify_sync_complete(
        notification.tickers_updated,
        notification.total_bars,
        notification.duration_seconds
    )
    return {"status": "ok", "clients_notified": chart_update_service.get_client_count()}


class ClientLogEntry(BaseModel):
    level: str = "INFO"
    message: str
    details: Optional[Dict[str, Any]] = None
    timestamp: Optional[str] = None


@router.post("/api/submit_log")
async def submit_log(entry: ClientLogEntry):
    """
    Ingest logs from the client to be stored in the server-side log file.
    """
    # Normalize level
    level = entry.level.upper()
    
    # Construct log payload
    extra = {
        "source": "client",
        "client_timestamp": entry.timestamp, 
        "extra_fields": entry.details or {}
    }
    
    # Log to backend logger
    msg = f"[CLIENT] {entry.message}"
    
    if level == "ERROR":
        logger.error(msg, extra=extra)
    elif level == "WARNING" or level == "WARN":
        logger.warning(msg, extra=extra)
    elif level == "DEBUG":
        logger.debug(msg, extra=extra)
    else:
        logger.info(msg, extra=extra)
        
    return {"status": "logged"}


@router.post("/api/logs/clear")
async def clear_logs():
    """
    Clear the server-side log file (q4nt.log).
    """
    logger.info("[API] Clearing log file requested")
    
    # Use the same log file path as configured at startup
    log_file_absolute = log_file_path  # Use the global variable set during logging config
    
    logger.info(f"[API] Attempting to clear log file: {log_file_absolute}")
    logger.info(f"[API] File exists before clear: {os.path.exists(log_file_absolute)}")
    
    try:
        # Close all file handlers to release the file
        for handler in logging.root.handlers[:]:
            if isinstance(handler, logging.FileHandler):
                handler.close()
                logging.root.removeHandler(handler)
        
        # Truncate the file
        with open(log_file_absolute, 'w') as f:
            f.write("")
        
        # Re-add the file handler
        file_handler = logging.FileHandler(log_file_absolute, mode='a', encoding='utf-8')
        file_handler.setFormatter(logging.Formatter(
            '[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        ))
        logging.root.addHandler(file_handler)
        
        # Verify it was cleared
        file_size = os.path.getsize(log_file_absolute)
        logger.info(f"[API] Log file cleared successfully. New size: {file_size} bytes")
        
        return {
            "status": "cleared", 
            "file": log_file_absolute,
            "size_after": file_size
        }
    except Exception as e:
        logger.error(f"[API] Failed to clear log file: {e}")
        return {"status": "error", "message": str(e), "file": log_file_absolute}


# --- Command Intelligence Enhancement Endpoint ---

class CommandEnhanceRequest(BaseModel):
    command: str
    history: Optional[List[str]] = []
    current_view: Optional[str] = "global"  # chart, terrain, or global
    current_ticker: Optional[str] = None    # Current ticker if in chart view
    visible_panels: Optional[List[str]] = []  # List of visible panel IDs
    use_reasoning: Optional[bool] = False   # If True, use reasoning model for complex commands


@router.post("/api/enhance-command")
async def api_enhance_command(req: CommandEnhanceRequest):
    """
    AI-powered command enhancement using OpenAI GPT-4o-mini (fast) or GPT-5o-mini (reasoning).
    
    Features:
    - Spelling correction (e.g., "ichimokku" -> "ichimoku", "shoow" -> "show")
    - Intent classification with indicator-aware routing
    - Entity extraction (tickers, indicators, locations, indicator_type, indicator_period)
    - Duplicate detection against recent history
    - Auto-escalation to reasoning model if confidence < 60%
    
    Returns:
        Enhanced command with corrections, intent, entities, and suggestions.
    """
    start_time = time.time()
    logger.info(f"[API] /api/enhance-command called with command: {req.command}, view: {req.current_view}, use_reasoning: {req.use_reasoning}")
    
    try:
        # Call command intelligence service with view context and model preference
        enhancement = await command_intelligence.enhance_command(
            raw_input=req.command,
            recent_history=req.history or [],
            current_view=req.current_view or "global",
            current_ticker=req.current_ticker,
            visible_panels=req.visible_panels or [],
            use_reasoning_model=req.use_reasoning or False
        )
        
        result = {
            "corrected_command": enhancement.corrected_command,
            "intent": enhancement.intent,
            "target_view": enhancement.target_view,
            "view_modifier": enhancement.view_modifier,
            "view_reasoning": enhancement.view_reasoning,
            "display_mode": enhancement.display_mode,
            "entities": enhancement.entities.dict(),
            "is_duplicate": enhancement.is_duplicate,
            "duplicate_of": enhancement.duplicate_of,
            "confidence": enhancement.confidence,
            "suggestions": enhancement.suggestions
        }
        
        log_timing("api_enhance_command", start_time, f"(confidence: {enhancement.confidence})")
        logger.info(f"[API] /api/enhance-command completed - Intent: {enhancement.intent}")
        
        return result
        
    except Exception as e:
        logger.error(f"[API] Command enhancement failed: {e}")
        # Return fallback result
        return {
            "corrected_command": req.command,
            "intent": "unknown",
            "entities": {},
            "is_duplicate": False,
            "duplicate_of": None,
            "confidence": 0,
            "suggestions": [f"Enhancement failed: {str(e)}"]
        }


@router.get("/api/cmd_history")
async def api_cmd_history(limit: int = 50):
    """
    Retrieve recent command history from `cmd_field.log` file.
    Parses the JSON lines (reverse order) and returns structured list.
    """
    history = []
    
    # Check if log file exists
    if not os.path.exists(CMD_LOG_FILE):
        return []

    try:
        # Read file efficiently from end
        # Since lines can be long, we'll read a chunk from the end
        file_size = os.path.getsize(CMD_LOG_FILE)
        read_size = min(file_size, 1024 * 1024)  # Read last 1MB max

        with open(CMD_LOG_FILE, 'rb') as f:
            if file_size > read_size:
                f.seek(file_size - read_size)
            
            # Read and decode
            lines = f.read().decode('utf-8', errors='ignore').splitlines()
            
            # Filter and parse
            for line in reversed(lines):
                if not line.strip():
                    continue
                try:
                    data = json.loads(line)
                    # Helper to simplify
                    item = {
                        "prompt": data.get("prompt"),
                        "timestamp": data.get("timestamp"),
                        "status": data.get("status"),
                        "lane": data.get("lane"),
                        "full_answer": data.get("full_answer"),
                        "answer_truncated": data.get("answer_truncated"),
                    }
                    if item["prompt"]: # Only include if prompt exists
                        history.append(item)
                        if len(history) >= limit:
                            break
                except json.JSONDecodeError:
                    continue
                    
        return history
    except Exception as e:
        logger.error(f"[API] Failed to read history: {e}")
        return []


# --- AI Intent Classification Endpoint ---
# Fast AI-powered intent classification for frontend routing decisions

class IntentRequest(BaseModel):
    prompt: str
    current_view: Optional[str] = "global"  # chart, terrain, or global
    current_ticker: Optional[str] = None

class IntentResponse(BaseModel):
    intent: str           # navigate, analyze, load_chart, add_indicator, etc.
    lane: str             # place_analysis, ticker_to_chart, chart, etc.
    entity_type: str      # ticker, country, city, indicator, etc.
    primary_entity: Optional[str] = None  # AAPL, Iran, Qatar, etc.
    proposed_view: Optional[str] = None   # chart, terrain, global
    confidence: str       # high, medium, low
    reasoning: Optional[str] = None


@router.post("/api/intent", response_model=IntentResponse)
async def api_intent(req: IntentRequest) -> Dict[str, Any]:
    """
    Fast AI intent classification for frontend routing decisions.
    
    This endpoint exposes the backend's AI classification logic to the frontend,
    allowing it to make intelligent routing decisions without regex patterns.
    
    Use this BEFORE making local routing decisions for ambiguous commands.
    
    Example requests:
        {"prompt": "qatar"}      -> entity_type: "country", lane: "place_analysis"
        {"prompt": "AAPL"}       -> entity_type: "ticker", lane: "ticker_to_chart"
        {"prompt": "go to iran"} -> entity_type: "country", lane: "place_analysis"
    """
    start_time = time.time()
    logger.info(f"[API] /api/intent called with prompt: '{req.prompt}', view: {req.current_view}")
    
    try:
        # Call the existing AI intent classifier from workflow_router
        ai_result = workflow_router._classify_intent_with_ai(req.prompt)
        
        if ai_result:
            result = {
                "intent": ai_result.get("intent", "unknown"),
                "lane": ai_result.get("lane", "clarification"),
                "entity_type": ai_result.get("entity_type", "unknown"),
                "primary_entity": ai_result.get("primary_entity"),
                "proposed_view": ai_result.get("proposed_view"),
                "confidence": ai_result.get("confidence", "low"),
                "reasoning": ai_result.get("reasoning")
            }
            log_timing("api_intent", start_time, f"(AI: {result['entity_type']})")
            logger.info(f"[API] /api/intent -> {result['entity_type']}: {result['primary_entity']} ({result['confidence']})")
            return result
        
        # Fallback: Use heuristic routing if AI fails
        from features.command_intelligence.routing import route_to_lane, detect_ticker
        heuristic_result = route_to_lane(req.prompt)
        ticker = detect_ticker(req.prompt)
        
        result = {
            "intent": "unknown",
            "lane": heuristic_result.get("lane", "clarification"),
            "entity_type": "ticker" if ticker else "unknown",
            "primary_entity": ticker,
            "proposed_view": "chart" if ticker else None,
            "confidence": heuristic_result.get("confidence", "low"),
            "reasoning": "Fallback to heuristic routing"
        }
        log_timing("api_intent", start_time, "(fallback)")
        return result
        
    except Exception as e:
        logger.error(f"[API] Intent classification failed: {e}")
        return {
            "intent": "error",
            "lane": "clarification",
            "entity_type": "unknown",
            "primary_entity": None,
            "proposed_view": None,
            "confidence": "low",
            "reasoning": f"Classification error: {str(e)}"
        }


# --- Location Intelligence Endpoint ---
from features.location_intelligence.location_service import get_location_intelligence

class LocationVerificationRequest(BaseModel):
    pill_text: str


@router.post("/api/location/verify")
async def api_verify_location(req: LocationVerificationRequest):
    """
    AI-powered location verification for notification pills.
    
    Uses OpenAI to:
    - Verify if pill text represents a geographic location
    - Extract coordinates and geographic metadata
    - Save to database for future reference
    - Return terrain view data
    
    Example request:
        POST /api/location/verify
        {"pill_text": "SINGAPORE"}
        
    Example response:
        {
            "is_location": true,
            "location_name": "Singapore",
            "coordinates": {"lat": 1.3521, "lon": 103.8198},
            "zoom_level": 11,
            "saved_to_db": true,
            "db_location_id": 42
        }
    """
    start_time = time.time()
    logger.info(f"[API] /api/location/verify called for pill: '{req.pill_text}'")
    
    try:
        service = get_location_intelligence()
        result = await service.verify_and_extract(req.pill_text)
        
        log_timing("api_verify_location", start_time, f"(is_location: {result['is_location']})")
        return result
        
    except Exception as e:
        logger.error(f"[API] Location verification failed: {e}", exc_info=True)
        raise HTTPException(500, f"Location verification failed: {str(e)}")


@router.get("/api/location/get")
async def api_get_location(name: str = Query(..., description="Location name to retrieve")):
    """
    Retrieve location data from database by name.
    First checks database, then can fallback to OpenAI if not found.
    """
    try:
        service = get_location_intelligence()
        result = service.get_location_by_name(name)
        
        if result:
            return {"found": True, **result}
        else:
            return {"found": False, "message": f"Location '{name}' not in database"}
            
    except Exception as e:
        logger.error(f"[API] Location lookup failed: {e}")
        raise HTTPException(500, f"Location lookup failed: {str(e)}")


# --- Watchlist Price Endpoint for Live Ticker Data ---

# =============================================================================
# SHARED HELPER: Ticker Snapshot Query
# =============================================================================
# Consolidates the duplicate CTE-based SQL query used by both:
# - /api/watchlist-prices (filtered by specific tickers)
# - /api/market-snapshot (all tickers)
# =============================================================================

def _fetch_ticker_snapshots(ticker_filter: Optional[List[str]] = None) -> Dict[str, Dict[str, Any]]:
    """
    Fetch latest close price and daily PnL for tickers.
    
    Args:
        ticker_filter: List of specific tickers to fetch. If None, fetches ALL tickers.
        
    Returns:
        Dictionary keyed by ticker with price data:
        - close_price: Latest close price
        - day_open: Opening price of the current trading day
        - day_high: Day's high
        - day_low: Day's low
        - pnl_pct: Percentage change from day open
        - pnl_amount: Dollar change from day open
        - last_updated: Timestamp of the latest bar
    """
    conn = get_conn()
    results = {}
    
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Build WHERE clause based on filter
            if ticker_filter:
                where_clause = "WHERE s.ticker = ANY(%(tickers)s)"
                params = {"tickers": ticker_filter}
            else:
                where_clause = ""
                params = {}
            
            # Set a longer timeout (10s) for this complex query
            # Previous 5s timeout was consistently exceeded, causing failures
            cur.execute("SET statement_timeout = 10000")
            
            query = f"""
                WITH latest_bars AS (
                    SELECT DISTINCT ON (s.ticker)
                        s.ticker,
                        o.symbol_id,
                        o.close as close_price,
                        o.bar_time as last_updated,
                        DATE_TRUNC('day', o.bar_time) as bar_date
                    FROM market_data.ohlcv_1m o
                    JOIN market_data.symbols s ON s.id = o.symbol_id
                    {where_clause}
                    ORDER BY s.ticker, o.bar_time DESC
                ),
                day_stats AS (
                    SELECT 
                        s.ticker,
                        MIN(o.open) FILTER (WHERE o.bar_time = first_bar.first_time) as day_open,
                        MAX(o.high) as day_high,
                        MIN(o.low) as day_low
                    FROM market_data.ohlcv_1m o
                    JOIN market_data.symbols s ON s.id = o.symbol_id
                    JOIN latest_bars lb ON lb.ticker = s.ticker AND DATE_TRUNC('day', o.bar_time) = lb.bar_date
                    LEFT JOIN LATERAL (
                        SELECT MIN(o2.bar_time) as first_time
                        FROM market_data.ohlcv_1m o2
                        JOIN market_data.symbols s2 ON s2.id = o2.symbol_id
                        WHERE s2.ticker = s.ticker AND DATE_TRUNC('day', o2.bar_time) = lb.bar_date
                    ) first_bar ON true
                    GROUP BY s.ticker
                )
                SELECT 
                    lb.ticker,
                    lb.close_price,
                    lb.last_updated,
                    COALESCE(ds.day_open, lb.close_price) as day_open,
                    COALESCE(ds.day_high, lb.close_price) as day_high,
                    COALESCE(ds.day_low, lb.close_price) as day_low,
                    ROUND((lb.close_price - COALESCE(prev.close, ds.day_open, lb.close_price))::numeric, 2) as pnl_amount,
                    CASE 
                        WHEN COALESCE(prev.close, ds.day_open, 0) > 0 THEN 
                            ROUND(((lb.close_price - COALESCE(prev.close, ds.day_open)) / COALESCE(prev.close, ds.day_open) * 100)::numeric, 2)
                        ELSE 0
                    END as pnl_pct
                FROM latest_bars lb
                LEFT JOIN day_stats ds ON ds.ticker = lb.ticker
                LEFT JOIN LATERAL (
                    SELECT o_prev.close
                    FROM market_data.ohlcv_1m o_prev
                    WHERE o_prev.symbol_id = lb.symbol_id
                      AND o_prev.bar_time < lb.bar_date
                    ORDER BY o_prev.bar_time DESC
                    LIMIT 1
                ) prev ON true;
            """
            
            cur.execute(query, params)
            rows = cur.fetchall()
            
            # Build results dict from fetched rows
            for row in rows:
                ticker = row["ticker"]
                results[ticker] = {
                    "close_price": float(row["close_price"]),
                    "day_open": float(row["day_open"]),
                    "day_high": float(row["day_high"]),
                    "day_low": float(row["day_low"]),
                    "pnl_amount": float(row["pnl_amount"]),
                    "pnl_pct": float(row["pnl_pct"]),
                    "last_updated": row["last_updated"].isoformat() if row["last_updated"] else None
                }
                    
    finally:
        release_conn(conn)
    
    return results


class WatchlistPriceRequest(BaseModel):
    tickers: List[str]


@router.post("/api/watchlist-prices")
def api_watchlist_prices(req: WatchlistPriceRequest) -> Dict[str, Any]:
    """
    Get latest close price and daily PnL for multiple tickers.
    Used by frontend watchlist panels for live price updates.
    
    REFACTORED: Uses shared _fetch_ticker_snapshots helper for consistency.
    
    Returns for each ticker:
    - close_price: Latest close price
    - day_open: Opening price of the current trading day
    - pnl_pct: Percentage change from day open
    - pnl_amount: Dollar change from day open
    - last_updated: Timestamp of the latest bar
    """
    start_time = time.time()
    logger.info(f"[API] /api/watchlist-prices called with {len(req.tickers)} tickers")
    
    if not req.tickers:
        return {"results": {}}
    
    # Clean and uppercase tickers
    clean_tickers = [t.strip().upper() for t in req.tickers if t.strip()]
    
    if not clean_tickers:
        return {"results": {}}
    
    try:
        # Use shared helper for consistent query logic
        results = _fetch_ticker_snapshots(ticker_filter=clean_tickers)
        
        # Add placeholder for any tickers not found in results
        for ticker in clean_tickers:
            if ticker not in results:
                results[ticker] = {
                    "close_price": 0,
                    "day_open": 0,
                    "day_high": 0,
                    "day_low": 0,
                    "pnl_amount": 0,
                    "pnl_pct": 0,
                    "last_updated": None,
                    "error": "No data available"
                }
                    
    except Exception as e:
        logger.error(f"[API] Error in batched watchlist prices: {e}")
        # Fallback: return error for all requested tickers
        results = {}
        for ticker in clean_tickers:
            results[ticker] = {
                "close_price": 0,
                "day_open": 0,
                "day_high": 0,
                "day_low": 0,
                "pnl_amount": 0,
                "pnl_pct": 0,
                "last_updated": None,
                "error": str(e)
            }
    
    log_timing("api_watchlist_prices", start_time, f"({len(results)} tickers)")
    logger.info(f"[API] /api/watchlist-prices completed: {len(results)} ticker prices returned")
    
    return {"results": results}


@router.get("/api/watchlist-prices")
def api_watchlist_prices_get(
    tickers: str = Query(..., description="Comma-separated list of tickers")
) -> Dict[str, Any]:
    """
    GET version of watchlist-prices for convenience.
    Usage: /api/watchlist-prices?tickers=SPY,QQQ,TSLA,NVDA
    """
    ticker_list = [t.strip() for t in tickers.split(',') if t.strip()]
    req = WatchlistPriceRequest(tickers=ticker_list)
    return api_watchlist_prices(req)


@router.get("/api/market-snapshot")
def api_market_snapshot() -> Dict[str, Any]:
    """
    Get latest close price and daily PnL for ALL tickers.
    Authorized for use on application load to warm up the ticker store.
    
    REFACTORED: Uses shared _fetch_ticker_snapshots helper for consistency.
    
    Returns a dictionary keyed by ticker.
    """
    start_time = time.time()
    logger.info("[API] /api/market-snapshot called")
    
    try:
        # Use shared helper with no filter (fetches ALL tickers)
        results = _fetch_ticker_snapshots(ticker_filter=None)
                
    except Exception as e:
        logger.error(f"[API] Error in market snapshot: {e}")
        return {"error": str(e), "results": {}}
    
    log_timing("api_market_snapshot", start_time, f"({len(results)} tickers)")
    logger.info(f"[API] /api/market-snapshot completed: {len(results)} ticker profiles loaded")
    
    return {"results": results}


class CacheWarmRequest(BaseModel):
    priority_tickers: List[str] = []


@router.post("/api/cache/warm-visible")
def api_cache_warm_visible(req: CacheWarmRequest) -> Dict[str, Any]:
    """
    Warm the cache for specific tickers (prioritized preloading).
    Used by the frontend to ensure chart panel tickers are loaded first.
    
    Args:
        priority_tickers: List of ticker symbols to prioritize
        
    Returns:
        Priority ticker price data
    """
    start_time = time.time()
    logger.info(f"[API] /api/cache/warm-visible called with {len(req.priority_tickers)} priority tickers")
    
    results = {"priority": {}, "priority_count": 0}
    
    if req.priority_tickers:
        clean_tickers = [t.strip().upper() for t in req.priority_tickers if t.strip()]
        if clean_tickers:
            results["priority"] = _fetch_ticker_snapshots(ticker_filter=clean_tickers)
            results["priority_count"] = len(results["priority"])
            logger.info(f"[API] Warmed {results['priority_count']} priority tickers: {clean_tickers[:10]}...")
    
    log_timing("api_cache_warm_visible", start_time)
    return results


class InsightRequest(BaseModel):
    ticker: str
    chart_image_base64: Optional[str] = None  # Legacy field for backward compatibility
    chart_image_90d_base64: Optional[str] = None
    chart_image_30d_base64: Optional[str] = None
    chart_image_7d_base64: Optional[str] = None
    openai_enabled: bool = False  # Controls whether to make OpenAI API calls


# --- In-memory cache for OHLCV data with TTL ---
# Using unified TTLCache class from core.ttl_cache
from core.ttl_cache import TTLCache, SingleValueCache

_ohlcv_cache: TTLCache[tuple] = TTLCache(
    ttl_seconds=Config.OHLCV_CACHE_TTL,
    max_size=Config.MAX_OHLCV_CACHE_SIZE,
    name="ohlcv"
)

@lru_cache(maxsize=256)
def _get_cache_key(ticker: str, start: str, end: str, limit: int) -> str:
    """Generate cache key for OHLCV data. Cached via lru_cache for fast repeated lookups."""
    return f"{ticker.upper()}_{start}_{end}_{limit}"

def _fetch_ohlcv_from_db(ticker: str, start: str, end: str, limit: int) -> tuple:
    """Database query for OHLCV data with improved performance."""
    start_time = time.time()
    logger.info(f"[OHLCV] Fetching data for {ticker} from {start} to {end} (limit: {limit})")
    
    sym = ticker.strip().upper()
    if not sym:
        logger.warning("[OHLCV] Empty ticker provided")
        return ()
    
    try:
        start_date = datetime.fromisoformat(start).date()
        end_date = datetime.fromisoformat(end).date()
        logger.debug(f"[OHLCV] Parsed dates: start={start_date}, end={end_date}")
    except ValueError as e:
        logger.error(f"[OHLCV] Invalid date format: {e}")
        return ()
    
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            query_start = time.time()
            cur.execute(
                f"""
                SELECT
                    EXTRACT(EPOCH FROM o.bar_time) * 1000.0 AS time,
                    o.open,
                    o.high,
                    o.low,
                    o.close,
                    o.volume,
                    o.vw
                FROM {TABLE_NAME} o
                JOIN market_data.symbols s ON s.id = o.symbol_id
                WHERE s.ticker = %s
                  AND o.bar_time >= %s
                  AND o.bar_time < (%s::date + INTERVAL '1 day')
                ORDER BY o.bar_time ASC
                LIMIT %s;
                """,
                (sym, start_date, end_date, limit),
            )
            rows = cur.fetchall()
            log_timing("db_query", query_start, f"({len(rows)} rows)")
            logger.info(f"[OHLCV] Query returned {len(rows)} rows for {sym}")
            return tuple(rows)  # Convert to tuple for caching
    except Exception as e:
        logger.error(f"[OHLCV] Database error: {e}")
        return ()
    finally:
        release_conn(conn)
        log_timing("_fetch_ohlcv_from_db", start_time)

def _fetch_ohlcv_cached(ticker: str, start: str, end: str, limit: int) -> tuple:
    """Cached OHLCV fetch using TTLCache for automatic expiration and eviction."""
    cache_key = _get_cache_key(ticker, start, end, limit)
    
    # Check cache (TTLCache handles expiration automatically)
    cached = _ohlcv_cache.get(cache_key)
    if cached is not None:
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug(f"[CACHE] OHLCV HIT for {cache_key}")
        return cached
    
    if logger.isEnabledFor(logging.DEBUG):
        logger.debug(f"[CACHE] OHLCV MISS for {cache_key}")
    
    # Fetch from database
    rows = _fetch_ohlcv_from_db(ticker, start, end, limit)
    
    # Store in cache (TTLCache handles eviction automatically)
    _ohlcv_cache.set(cache_key, rows)
    
    if logger.isEnabledFor(logging.DEBUG):
        logger.debug(f"[CACHE] Stored {len(rows)} rows for {cache_key}")
    
    return rows

@router.get("/api/ohlcv")
def api_ohlcv(
    ticker: str = Query(..., description="Ticker symbol, e.g. AAPL"),
    start: str = Query(..., description="Start date YYYY-MM-DD"),
    end: str = Query(..., description="End date YYYY-MM-DD"),
    tf: str = Query("5m", description="Timeframe string (ignored for now, must be 5m)"),
    limit: int = Query(500000, description="Max number of bars to return"),
) -> Dict[str, List[Dict[str, Any]]]:
    """Return OHLCV data from market_data.ohlcv_5m for one symbol."""
    start_time = time.time()
    logger.info(f"[API] /api/ohlcv called: ticker={ticker}, start={start}, end={end}, limit={limit}")
    
    rows = _fetch_ohlcv_cached(ticker, start, end, limit)
    
    # Optimized list comprehension for faster processing
    out: List[Dict[str, Any]] = [
        {
            "time": int(row["time"]),
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
            "volume": float(row["volume"]),
            "vw": float(row["vw"]) if row["vw"] is not None else None,
        }
        for row in rows
    ]
    
    log_timing("api_ohlcv", start_time, f"(returned {len(out)} bars)")
    logger.info(f"[API] /api/ohlcv completed: {len(out)} bars returned")
    
    return {"results": out}


# =============================================================================
# CACHE WARMING SYSTEM
# =============================================================================
# Pre-loads critical data into cache on startup for instant UI responsiveness

# Default chart tickers to pre-warm (from frontend config.js)
DEFAULT_CHART_TICKERS = [
    'AAPL', 'SPY', 'TSLA', 'NVDA', 'JPM', 'GME', 'BABA',  # Primary charts
    'KTOS', 'NFLX', 'QUBT', 'UNH', 'HOOD'  # Additional charts
]

# Cache warming configuration
CACHE_WARM_OHLC_DAYS = 90  # Pre-load 90 days of OHLC data
CACHE_WARM_NEWS_LIMIT = 100  # Pre-load 100 Discord news entries


def warm_ohlc_cache(tickers: List[str] = None, days: int = CACHE_WARM_OHLC_DAYS) -> Dict[str, int]:
    """
    Pre-warm the OHLC cache for specified tickers.
    
    Args:
        tickers: List of ticker symbols. Defaults to DEFAULT_CHART_TICKERS.
        days: Number of days of data to pre-load. Defaults to 15.
    
    Returns:
        Dict mapping ticker to number of bars cached.
    """
    if tickers is None:
        tickers = DEFAULT_CHART_TICKERS
    
    logger.info(f"[CacheWarm] Starting OHLC cache warm-up for {len(tickers)} tickers ({days} days)...")
    
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)
    start_str = start_date.strftime('%Y-%m-%d')
    end_str = end_date.strftime('%Y-%m-%d')
    
    results = {}
    total_bars = 0
    
    for ticker in tickers:
        try:
            rows = _fetch_ohlcv_cached(ticker, start_str, end_str, 50000)
            bar_count = len(rows)
            results[ticker] = bar_count
            total_bars += bar_count
            logger.debug(f"[CacheWarm] {ticker}: {bar_count} bars cached")
        except Exception as e:
            logger.warning(f"[CacheWarm] Failed to warm cache for {ticker}: {e}")
            results[ticker] = 0
    
    logger.info(f"[CacheWarm] OHLC cache warm-up complete: {total_bars:,} total bars for {len(tickers)} tickers")
    return results


def warm_discord_news_cache(limit: int = CACHE_WARM_NEWS_LIMIT, hours: int = 24) -> int:
    """
    Pre-warm the Discord news cache by fetching recent events.
    
    This populates the in-memory cache in discord_router so subsequent
    requests get instant responses.
    
    Args:
        limit: Number of news entries to pre-load.
        hours: How many hours back to look.
    
    Returns:
        Number of events cached.
    """
    if not DISCORD_NEWS_AVAILABLE:
        logger.warning("[CacheWarm] Discord news router not available, skipping news cache warm-up")
        return 0
    
    logger.info(f"[CacheWarm] Starting Discord news cache warm-up ({limit} entries, {hours}h lookback)...")
    
    try:
        # Trigger the internal cache by making a request
        # The discord_router caches results automatically
        import asyncio
        
        # We need to call the async endpoint; use a simple approach
        conn = get_conn()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT 
                        e.event_id, 
                        e.event_time::text,
                        e.headline,
                        e.body,
                        e.event_type::text,
                        e.source_name,
                        e.source_url,
                        e.ai_categories,
                        e.ai_summary
                    FROM discord_news.event e
                    WHERE e.event_time >= NOW() - INTERVAL '%s hours'
                      AND e.headline NOT LIKE 'Video:%%'
                      AND e.headline NOT LIKE '%%: Breaking Update%%'
                      AND e.headline != 'News Update'
                    ORDER BY e.event_time DESC
                    LIMIT %s
                """, (hours, limit))
                rows = cur.fetchall()
                
                event_count = len(rows)
                logger.info(f"[CacheWarm] Discord news cache warm-up complete: {event_count} events")
                return event_count
        finally:
            release_conn(conn)
    except Exception as e:
        logger.warning(f"[CacheWarm] Discord news cache warm-up failed: {e}")
        return 0


def get_cache_status() -> Dict[str, Any]:
    """
    Get current status of all caches.
    
    Returns:
        Dict with cache statistics.
    """
    return {
        "ohlcv_cache": _ohlcv_cache.get_stats(),
        "tickers_cache": {
            "loaded": _tickers_cache.has_value,
            "count": len(_tickers_cache.get() or []),
            "ttl_seconds": _tickers_cache.ttl
        },
        "chart_tickers": DEFAULT_CHART_TICKERS,
        "warm_config": {
            "ohlc_days": CACHE_WARM_OHLC_DAYS,
            "news_limit": CACHE_WARM_NEWS_LIMIT
        }
    }


@router.get("/api/cache/status")
def api_cache_status():
    """Get current cache status and statistics with HTTP cache headers."""
    if logger.isEnabledFor(logging.DEBUG):
        logger.debug("[API] /api/cache/status called")
    return JSONResponse(
        content=get_cache_status(),
        headers={"Cache-Control": "max-age=60"}
    )


@router.post("/api/cache/warm")
def api_cache_warm(
    ohlc: bool = Query(True, description="Warm OHLC cache for chart tickers"),
    news: bool = Query(True, description="Warm Discord news cache"),
    tickers: Optional[str] = Query(None, description="Comma-separated list of tickers (overrides defaults)")
) -> Dict[str, Any]:
    """
    Manually trigger cache warming.
    
    Use this to pre-load data before heavy usage or after a cache clear.
    """
    start_time = time.time()
    logger.info(f"[API] /api/cache/warm called: ohlc={ohlc}, news={news}, tickers={tickers}")
    
    results = {}
    
    if ohlc:
        ticker_list = None
        if tickers:
            ticker_list = [t.strip().upper() for t in tickers.split(',') if t.strip()]
        
        results["ohlc"] = warm_ohlc_cache(ticker_list)
    
    if news:
        results["news_count"] = warm_discord_news_cache()
    
    log_timing("api_cache_warm", start_time)
    
    return {
        "status": "complete",
        "results": results,
        "cache_status": get_cache_status()
    }


# --- Tickers Cache using SingleValueCache ---
_tickers_cache: SingleValueCache[List[Dict[str, str]]] = SingleValueCache(
    ttl_seconds=3600.0,  # 1 hour TTL
    name="tickers"
)

# --- Disk Cache Initialization ---
from core.disk_cache import DiskCache
disk_cache = DiskCache(cache_dir="cache/backend/api_responses")

# --- Optimized Tickers Endpoint with Disk Persistence ---
@router.get("/api/tickers")
def api_tickers():
    """Return list of all available ticker symbols with HTTP cache headers."""
    start_time = time.time()
    logger.info("[API] /api/tickers called")
    
    # 1. Check Memory Cache (Fastest) - SingleValueCache handles TTL
    cached = _tickers_cache.get()
    if cached is not None:
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug("[CACHE] Tickers Memory Hit")
        log_timing("api_tickers (mem)", start_time)
        return JSONResponse(
            content={"results": cached},
            headers={"Cache-Control": "max-age=3600"}  # 1 hour client cache
        )

    # 2. Check Disk Cache (Persistence)
    cached_data = disk_cache.get("all_tickers", 3600.0)
    if cached_data:
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug("[CACHE] Tickers Disk Hit")
        _tickers_cache.set(cached_data)
        log_timing("api_tickers (disk)", start_time)
        return JSONResponse(
            content={"results": cached_data},
            headers={"Cache-Control": "max-age=3600"}
        )
    
    if logger.isEnabledFor(logging.DEBUG):
        logger.debug("[CACHE] Tickers MISS - Querying DB")
    
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT s.ticker, p.company_name
                FROM market_data.symbols s
                LEFT JOIN market_data.company_profiles p ON s.id = p.symbol_id
                ORDER BY s.ticker ASC
            """)
            rows = cur.fetchall()
            
            # Return list of objects with ticker and name
            results = [
                {
                    "ticker": str(row["ticker"]), 
                    "name": str(row["company_name"]) if row["company_name"] else ""
                } 
                for row in rows
            ]
            
            # Update both caches
            _tickers_cache.set(results)
            disk_cache.set("all_tickers", results)
            
            logger.info(f"[API] Retrieved {len(results)} tickers from database")
            log_timing("api_tickers", start_time)
            return JSONResponse(
                content={"results": results},
                headers={"Cache-Control": "max-age=3600"}
            )
    except Exception as e:
        logger.error(f"[API] Error fetching tickers: {e}")
        # Fallback to whatever is in memory even if stale
        stale = _tickers_cache.get()
        if stale:
            return {"results": stale}
        return {"results": []}
    finally:
        release_conn(conn)


# --- Insight endpoints (consolidated) ---

def _handle_insight(ticker: str, openai_enabled: bool, use_dual_images: bool = False) -> Dict[str, Any]:
    """
    Shared handler for insight endpoints. Reduces code duplication.
    
    Args:
        ticker: Stock ticker symbol
        openai_enabled: Whether OpenAI API calls are enabled
        use_dual_images: If True, use dual-image analysis (90d + 7d)
    
    Returns:
        Insight response dict
    """
    if not openai_enabled:
        return {
            "ticker": ticker,
            "bullets": ["OpenAI is disabled. Enable it to generate insights."],
            "detailed": {"structured": {}, "full_narrative_markdown": "OpenAI connections are currently disabled."}
        }
    
    if use_dual_images:
        return get_insight_sentences_with_dual_images(ticker, None, None)
    return get_insight_sentences_with_image(ticker, None)


@router.get("/api/insight")
def api_insight_get(
    ticker: str = Query(..., description="Ticker symbol"),
    openai_enabled: bool = Query(False, description="Enable OpenAI API calls")
) -> Dict[str, Any]:
    """DB-only insight (legacy/debug)."""
    start_time = time.time()
    logger.info(f"[API] /api/insight GET called: ticker={ticker}")
    result = _handle_insight(ticker, openai_enabled)
    log_timing("api_insight_get", start_time)
    return result


@router.post("/api/insight")
@router.post("/api/insight_with_image")
def api_insight_post(req: InsightRequest) -> Dict[str, Any]:
    """DB + dual-image insight for macro (90d) + micro (7d) analysis."""
    start_time = time.time()
    logger.info(f"[API] /api/insight POST called: ticker={req.ticker}")
    result = _handle_insight(req.ticker, req.openai_enabled, use_dual_images=True)
    log_timing("api_insight_post", start_time)
    return result


@router.get("/api/stock-insight")
def api_stock_insight(
    ticker: str = Query(..., description="Ticker symbol for chart insights"),
    openai_enabled: bool = Query(False, description="Enable OpenAI API calls")
) -> Dict[str, Any]:
    """Alias endpoint used by chart + AI report panels."""
    start_time = time.time()
    logger.info(f"[API] /api/stock-insight called: ticker={ticker}")
    result = _handle_insight(ticker, openai_enabled)
    log_timing("api_stock_insight", start_time)
    return result


# --- Document Analysis Endpoint (New) ---

class DocumentAnalysisRequest(BaseModel):
    text: str
    filename: Optional[str] = ""

@router.post("/api/analyze_document")
async def api_analyze_document(req: DocumentAnalysisRequest):
    """
    Analyze document text using gpt-4o-mini to:
    1. Determine document type (Resume, CSV, etc.)
    2. Build specialized agent instructions.
    """
    start_time = time.time()
    logger.info(f"[API] /api/analyze_document called for '{req.filename}'")

    if not req.text:
         return {"error": "No text provided"}

    # Call the backend logic
    result = generate_document_agent(req.text, req.filename)
    
    log_timing("api_analyze_document", start_time)
    return result


# --- OpenAI Usage Stats Endpoint ---

@router.get("/api/openai/usage")
def api_openai_usage() -> Dict[str, Any]:
    """
    Get OpenAI usage statistics for the SideAccountPanel.
    Returns:
    - requests_24h
    - requests_30d
    - requests_all
    - cost_30d
    - tokens_30d (for progress bar)
    """
    start_time = time.time()
    logger.info("[API] /api/openai/usage called")
    
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Check if table exists first
            cur.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'openai_usage'
                );
            """)
            if not cur.fetchone()['exists']:
                logger.warning("[API] public.openai_usage table does not exist")
                return {
                    "requests_24h": 0,
                    "requests_30d": 0,
                    "requests_all": 0,
                    "cost_30d": "$0.00",
                    "tokens_30d": 0,
                    "tokenLimit": 100000 
                }

            # Single consolidated query (was 4 separate round-trips)
            cur.execute("""
                SELECT
                    COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS requests_24h,
                    COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '30 days')  AS requests_30d,
                    COUNT(*)                                                         AS requests_all,
                    COALESCE(SUM(cost_usd)     FILTER (WHERE timestamp >= NOW() - INTERVAL '30 days'), 0) AS cost_30d,
                    COALESCE(SUM(total_tokens) FILTER (WHERE timestamp >= NOW() - INTERVAL '30 days'), 0) AS tokens_30d
                FROM public.openai_usage
            """)
            row = cur.fetchone()

            results = {
                "requests24h": row['requests_24h'],
                "requests30d": row['requests_30d'],
                "requestsAll": row['requests_all'],
                "last30DayCost": f"${float(row['cost_30d']):.2f}",
                "tokensUsed": int(row['tokens_30d']),
                "tokenLimit": 100000  # Hardcoded limit for now
            }

            log_timing("api_openai_usage", start_time)
            return results

    except Exception as e:
        logger.error(f"[API] Error fetching openai usage: {e}")
        return {
            "requests24h": 0,
            "requests30d": 0,
            "requestsAll": 0,
            "last30DayCost": "$0.00",
            "tokensUsed": 0,
            "tokenLimit": 100000
        }
    finally:
        release_conn(conn)



# Pre-compiled regex patterns for Polymarket filtering (moved outside function for performance)
SPORTS_PATTERN = re.compile(
    r"\b(vs\.?|nba|nfl|nhl|mlb|cfb|ufc|mma|fight|boxing|wrestler|wrestling|"
    r"match|game[s]?|playoffs|playoff|super bowl|superbowl|champions league|"
    r"cup\b|premier league|la liga|serie a|bundesliga|ligue 1|"
    r"soccer|football|basketball|baseball|hockey|tennis|golf|f1|formula|"
    r"nascar|racing|cricket|rugby|olympic|medal|batting|quarterback|"
    r"touchdown|goal scorer|assist|rebound|strikeout|home run|"
    r"espn|draft|mvp|rookie|coach|seed|bracket|round of|"
    r"slam|grand prix|pga|wta|atp|fifa|uefa|"
    r"win (the|their|a) (game|match|series|title|championship|tournament)|"
    r"world series|stanley cup|world cup|super bowl|"
    r"points|yards|passing|rushing|receiving|tackles|sacks|interceptions|"
    r"three-?pointer|field goal|penalty kick|corner kick)\b",
    re.I
)

CULTURE_PATTERN = re.compile(
    r"\b(movie|film|tv show|tv series|album|music|song|actor|actress|"
    r"oscar|grammy|emmy|golden globe|celebrity|reality tv|"
    r"netflix|disney|box office|streaming|kardashian|"
    r"tiktok|influencer|youtube|bachelor|bachelorette)\b",
    re.I
)

# Cache for Fed news using SingleValueCache (refreshes every 5 minutes)
_fed_news_cache: SingleValueCache[List[Dict[str, str]]] = SingleValueCache(
    ttl_seconds=300.0,
    name="fed_news"
)

@router.get("/DELETED_DUP/api/fed-news")
def api_fed_news(limit: int = 3):
    """Get latest Federal Reserve news items with HTTP cache headers."""
    start_time = time.time()
    logger.info(f"[API] /api/fed-news called: limit={limit}")
    
    # Check cache (SingleValueCache handles TTL)
    cached = _fed_news_cache.get()
    if cached is not None:
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug("[CACHE] Fed news cache HIT")
        log_timing("api_fed_news", start_time)
        return JSONResponse(
            content={"results": cached[:limit]},
            headers={"Cache-Control": "max-age=300"}  # 5 min client cache
        )
    
    if logger.isEnabledFor(logging.DEBUG):
        logger.debug("[CACHE] Fed news cache MISS")
    
    items = get_latest_fed_news(limit)
    _fed_news_cache.set(items)
    logger.info(f"[API] Fetched {len(items)} fed news items from RSS")
    
    log_timing("api_fed_news", start_time)
    return JSONResponse(
        content={"results": items},
        headers={"Cache-Control": "max-age=300"}
    )


# Cache for ALL Polymarket data (no filtering, refreshes every 2 minutes)
_polymarket_all_cache: SingleValueCache[List[Dict[str, Any]]] = SingleValueCache(
    ttl_seconds=120.0,
    name="polymarket_all"
)

# Cache for space-classified Polymarket data: {1: [...], 2: [...], 3: [...]}
_polymarket_space_cache: SingleValueCache[Dict[int, List[Dict[str, Any]]]] = SingleValueCache(
    ttl_seconds=300.0,
    name="polymarket_space_classified"
)

# Legacy cache key for backward compat (points to space-1 data)
_polymarket_cache: SingleValueCache[List[Dict[str, Any]]] = SingleValueCache(
    ttl_seconds=120.0,
    name="polymarket"
)

def _as_list(x):
    """Helper to safely convert to list."""
    if x is None:
        return []
    if isinstance(x, list):
        return x
    if isinstance(x, str) and x.strip().startswith("["):
        try:
            return json.loads(x)
        except json.JSONDecodeError:
            return []
    return []


POLYMARKET_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "polymarket_classifications.json")

def load_classification_cache() -> Dict[str, str]:
    if os.path.exists(POLYMARKET_CACHE_FILE):
        try:
            with open(POLYMARKET_CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load polymarket classification cache: {e}")
    return {}

def save_classification_cache(cache: Dict[str, str]):
    try:
        tmp_file = POLYMARKET_CACHE_FILE + ".tmp"
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=2, ensure_ascii=False)
        os.replace(tmp_file, POLYMARKET_CACHE_FILE)
    except Exception as e:
        logger.warning(f"Failed to save polymarket classification cache: {e}")




def _classify_market_regex(question: str, slug: str, tags: str) -> str:
    """Fast regex-based classification: returns 'sports', 'popculture', or 'market'."""
    combined = question + " " + slug + " " + tags
    if SPORTS_PATTERN.search(combined):
        return "sports"
    if CULTURE_PATTERN.search(combined):
        return "popculture"
    return "market"


async def _classify_markets_openai(questions: List[str]) -> Dict[int, str]:
    """Use OpenAI to bulk-classify market questions into spaces.
    Returns {index: 'market'|'sports'|'popculture'}.
    Falls back to regex if OpenAI is unavailable."""
    if not Config.OPENAI_API_KEY or len(questions) == 0:
        return {}

    # Build numbered question list (send in batches of 200)
    batch_size = 200
    all_classifications: Dict[int, str] = {}

    import asyncio
    client = _get_openai_async_client(timeout=45)
    sem = asyncio.Semaphore(5)

    async def _process_batch(batch_start, batch):
        q_list = "\n".join([
            f"  {batch_start + i}: {q[:120]}" for i, q in enumerate(batch)
        ])

        prompt = f"""Classify each prediction market question into exactly one category.

CATEGORIES:
- "market": economy, crypto, tech, finance, earnings, politics, elections, weather, science, geopolitics, regulation, monetary policy, trade, warfare, diplomacy
- "sports": NBA, NFL, MLB, NHL, soccer, tennis, golf, UFC/MMA, F1, cricket, Olympics, esports, any athletic competition, player stats, game outcomes, championships, draft picks, betting lines
- "popculture": music, movies, TV shows, celebrities, entertainment awards (Oscar, Grammy, Emmy), streaming platforms, social media, influencers, reality TV, box office, albums, concerts, TikTok, YouTube creators

QUESTIONS:
{q_list}

Return ONLY a JSON object mapping question index to category.
Example: {{"0": "market", "1": "sports", "2": "popculture"}}
Classify ALL questions. If uncertain, default to "market"."""

        try:
            async with sem:
                t0 = time.time()
                resp = await client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"},
                    temperature=0.1,
                    max_tokens=8000
                )
                elapsed_ms = int((time.time() - t0) * 1000)
                logger.info(f"[API] OpenAI classification batch {batch_start}-{batch_start + len(batch)} in {elapsed_ms}ms")

                content = resp.choices[0].message.content.strip()
                parsed = json.loads(content)
                return parsed
        except Exception as e:
            logger.warning(f"[API] OpenAI classification batch failed: {e}")
            return {}

    tasks = []
    for batch_start in range(0, len(questions), batch_size):
        batch = questions[batch_start:batch_start + batch_size]
        tasks.append(_process_batch(batch_start, batch))

    results = await asyncio.gather(*tasks)

    valid_cats = {"market", "sports", "popculture"}
    for parsed in results:
        for k, v in parsed.items():
            try:
                idx = int(k)
                cat = v.lower().strip()
                if cat in valid_cats:
                    all_classifications[idx] = cat
            except (ValueError, AttributeError):
                continue

    return all_classifications


async def _fetch_all_polymarket_rows() -> List[Dict[str, Any]]:
    """Fetch all Polymarket rows (no filtering). Uses cache."""
    cached = _polymarket_all_cache.get()
    if cached is not None:
        return cached

    BASE = "https://gamma-api.polymarket.com/markets"
    PAGE_SIZE = 100
    MAX_MARKETS = 5000

    all_markets = []
    client = _api_http_client()
    fetch_start = time.time()
    offset = 0
    while offset < MAX_MARKETS:
        params = {
            "limit": PAGE_SIZE,
            "offset": offset,
            "closed": "false",
            "order": "volume24hr",
            "ascending": "false",
        }
        resp = await client.get(BASE, params=params, timeout=20.0)
        resp.raise_for_status()
        page = resp.json()
        if not page or len(page) == 0:
            break
        all_markets.extend(page)
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    log_timing("polymarket_fetch", fetch_start, f"({len(all_markets)} markets in {offset // PAGE_SIZE + 1} pages)")

    logger.info(f"[API] Fetched {len(all_markets)} total markets from Polymarket")

    now_utc = datetime.now(timezone.utc)
    rows = []
    for m in all_markets:
        if not m.get("active", True):
            continue
            
        end_date_str = m.get("endDateIso")
        if end_date_str:
            try:
                # Handle Z or offset
                clean_date = end_date_str.replace("Z", "+00:00")
                end_date = datetime.fromisoformat(clean_date)
                if end_date.tzinfo is None:
                    end_date = end_date.replace(tzinfo=timezone.utc)
                if end_date < now_utc:
                    continue  # expired
            except ValueError:
                pass
                
        question = (m.get("question") or "").strip()
        slug = (m.get("slug") or "").lower()
        tags = " ".join(str(t) for t in (m.get("tags") or []))

        outs = _as_list(m.get("outcomes"))
        prices = _as_list(m.get("outcomePrices"))
        n = min(len(outs), len(prices))

        # Pre-classify via regex (fast path)
        space_label = _classify_market_regex(question, slug, tags)

        for i in range(n):
            try:
                p = float(prices[i])
            except (TypeError, ValueError):
                continue

            rows.append({
                "market_id": m.get("id"),
                "question": question,
                "volume24hr": m.get("volume24hr"),
                "outcome": outs[i],
                "implied_pct": round(p * 100, 2),
                "endDate": m.get("endDateIso"),
                "url": m.get("url") or f"https://polymarket.com/market/{m.get('slug')}",
                "_space_regex": space_label,
                "_slug": slug,
                "_tags": tags,
            })

    # Sort by volume desc
    def sort_key(item):
        v = float(item.get("volume24hr") or 0)
        q = item.get("question") or ""
        p = float(item.get("implied_pct") or 0)
        return (-v, q, -p)

    rows.sort(key=sort_key)
    _polymarket_all_cache.set(rows)
    return rows


async def _get_classified_markets() -> Dict[int, List[Dict[str, Any]]]:
    """Get markets classified by space (1=market, 2=sports, 3=popculture).
    Uses OpenAI for ambiguous markets, regex for clear-cut ones."""
    cached = _polymarket_space_cache.get()
    if cached is not None:
        return cached

    all_rows = await _fetch_all_polymarket_rows()
    if not all_rows:
        return {1: [], 2: [], 3: []}

    # Deduplicate questions for classification
    seen_questions = {}
    unique_questions = []
    for r in all_rows:
        q = r.get("question", "")
        if q not in seen_questions:
            seen_questions[q] = len(unique_questions)
            unique_questions.append(q)

    # Start with regex classifications and check persistent cache
    classifications = {}
    ambiguous_indices = []
    
    persistent_cache = load_classification_cache()
    
    for idx, q in enumerate(unique_questions):
        # Find a row with this question to get slug/tags
        row = next((r for r in all_rows if r.get("question") == q), None)
        if row:
            # Check persistent cache first
            if q in persistent_cache:
                classifications[idx] = persistent_cache[q]
                continue
                
            regex_label = row.get("_space_regex", "market")
            classifications[idx] = regex_label
            # If regex says 'market', it might be ambiguous -- flag for OpenAI review
            # Only send to OpenAI if we have the key and question count is manageable
            if regex_label == "market":
                ambiguous_indices.append(idx)

    # Use OpenAI to re-classify ambiguous (regex='market') questions
    # This catches sports/culture bets that regex missed
    if ambiguous_indices and Config.OPENAI_API_KEY:
        ambiguous_qs = [unique_questions[i] for i in ambiguous_indices]
        logger.info(f"[API] Sending {len(ambiguous_qs)} ambiguous markets to OpenAI for classification")
        ai_results = await _classify_markets_openai(ambiguous_qs)
        
        has_new_cached_items = False
        for local_idx, ai_label in ai_results.items():
            if 0 <= local_idx < len(ambiguous_indices):
                global_idx = ambiguous_indices[local_idx]
                q_text = unique_questions[global_idx]
                classifications[global_idx] = ai_label
                persistent_cache[q_text] = ai_label
                has_new_cached_items = True
                
        if has_new_cached_items:
            save_classification_cache(persistent_cache)

    # Build space buckets
    space_map = {"market": 1, "sports": 2, "popculture": 3}
    result: Dict[int, List[Dict[str, Any]]] = {1: [], 2: [], 3: []}

    for r in all_rows:
        q = r.get("question", "")
        q_idx = seen_questions.get(q, -1)
        label = classifications.get(q_idx, "market")
        space_num = space_map.get(label, 1)
        # Clean internal fields before returning
        clean_row = {k: v for k, v in r.items() if not k.startswith("_")}
        result[space_num].append(clean_row)

    counts = {s: len(rows) for s, rows in result.items()}
    logger.info(f"[API] Polymarket classified: space1={counts[1]}, space2={counts[2]}, space3={counts[3]}")

    _polymarket_space_cache.set(result)
    return result


@router.get("/DELETED_DUP/api/polymarket")
async def api_polymarket(
    space: int = Query(0, description="Space filter: 1=market, 2=sports, 3=popculture, 0=market(legacy)")
) -> Dict[str, Any]:
    """Fetch Polymarket data with space-aware classification. Paginates to get all available markets."""
    start_time = time.time()
    effective_space = space if space in (1, 2, 3) else 1
    logger.info(f"[API] /api/polymarket called: space={space} (effective={effective_space})")

    try:
        classified = await _get_classified_markets()
        rows = classified.get(effective_space, [])

        log_timing("api_polymarket", start_time, f"(space={effective_space}, {len(rows)} rows)")
        logger.info(f"[API] /api/polymarket completed: space={effective_space}, {len(rows)} results")

        return {"results": rows}

    except Exception as e:
        logger.error(f"[API] Polymarket API Error: {e}")
        # Fallback: try legacy cache
        stale = _polymarket_cache.get()
        if stale is not None:
            logger.warning("[API] Returning stale Polymarket cache due to error")
            return {"results": stale}
        return {"error": str(e), "results": []}


@router.get("/DELETED_DUP/api/polymarket/search")
async def api_polymarket_search(
    q: str = Query("", description="Search query for filtering markets"),
    limit: int = Query(15, description="Maximum number of results"),
    space: int = Query(0, description="Space filter: 1=market, 2=sports, 3=popculture, 0=market(legacy)")
) -> Dict[str, Any]:
    """Search Polymarket data with query filter for prediction panels. Space-aware."""
    start_time = time.time()
    logger.info(f"[API] /api/polymarket/search called: q='{q}', limit={limit}, space={space}")
    
    # First, get the space-filtered Polymarket data (uses cache if available)
    base_response = await api_polymarket(space=space)
    all_markets = base_response.get("results", [])
    
    if not q or not q.strip():
        # No query, return all markets up to limit
        results = all_markets[:limit]
        log_timing("api_polymarket_search", start_time, f"(no query, space={space}, {len(results)} results)")
        return {"markets": results}
    
    query_lower = q.lower().strip()

    # --- Meta-query handling: "biggest", "top", "trending", "popular" ---
    meta_keywords = {"biggest", "top", "trending", "popular", "hottest", "largest", "most popular", "highest volume"}
    if query_lower in meta_keywords:
        # Sort by volume descending and return top results
        sorted_markets = sorted(
            all_markets,
            key=lambda m: float(m.get("volume", 0) or 0),
            reverse=True
        )
        results = sorted_markets[:limit]
        log_timing("api_polymarket_search", start_time, f"(meta-query='{q}', space={space}, {len(results)} results by volume)")
        logger.info(f"[API] /api/polymarket/search meta-query '{q}': {len(results)} results sorted by volume")
        return {"markets": results}

    # --- Query alias expansion ---
    QUERY_ALIASES = {
        "btc": ["bitcoin", "btc"],
        "eth": ["ethereum", "eth"],
        "xrp": ["ripple", "xrp"],
        "sol": ["solana", "sol"],
        "doge": ["dogecoin", "doge"],
        "crypto": ["bitcoin", "ethereum", "crypto", "defi"],
        "ai": ["artificial intelligence", "ai", "gpt", "openai"],
        "fed": ["federal reserve", "fed", "fomc", "interest rate"],
        "rate cut": ["rate cut", "interest rate", "federal reserve", "fomc"],
        "gop": ["republican", "gop", "trump"],
        "dem": ["democrat", "democratic", "biden"],
        "potus": ["president", "presidential", "white house"],
        "war": ["war", "conflict", "invasion", "military"],
        "recession": ["recession", "gdp", "economic downturn"],
        # Sports aliases
        "nba": ["nba", "basketball"],
        "nfl": ["nfl", "football", "quarterback", "touchdown"],
        "mlb": ["mlb", "baseball", "home run"],
        "nhl": ["nhl", "hockey", "stanley cup"],
        "soccer": ["soccer", "premier league", "champions league", "fifa"],
        "golf": ["golf", "pga", "masters"],
        "tennis": ["tennis", "atp", "wta", "grand slam"],
        "ufc": ["ufc", "mma", "fight", "boxing"],
        # Pop culture aliases
        "oscar": ["oscar", "academy award", "best picture"],
        "grammy": ["grammy", "music award", "album"],
        "emmy": ["emmy", "tv show", "series"],
        "netflix": ["netflix", "streaming", "disney+"],
        "movies": ["movie", "film", "box office"],
        "music": ["music", "album", "song", "artist", "concert"],
        "celebrity": ["celebrity", "famous", "kardashian", "influencer"],
    }
    search_terms = QUERY_ALIASES.get(query_lower, [query_lower])

    # Filter markets by expanded query terms
    filtered = []
    
    for market in all_markets:
        question = (market.get("question") or "").lower()
        if any(term in question for term in search_terms):
            filtered.append(market)
            if len(filtered) >= limit:
                break
    
    # If not enough results, also search by partial word match on original query
    if len(filtered) < limit:
        query_words = query_lower.split()
        for market in all_markets:
            if market in filtered:
                continue
            question = (market.get("question") or "").lower()
            if any(word in question for word in query_words):
                filtered.append(market)
                if len(filtered) >= limit:
                    break
    
    log_timing("api_polymarket_search", start_time, f"(query='{q}', space={space}, terms={search_terms}, {len(filtered)} results)")
    logger.info(f"[API] /api/polymarket/search completed: {len(filtered)} results for '{q}' (space={space}, expanded: {search_terms})")
    
    return {"markets": filtered}


# Cache for AI-computed correlations using SingleValueCache (refreshes every 5 minutes)
_polymarket_corr_cache: SingleValueCache[Dict[str, Any]] = SingleValueCache(
    ttl_seconds=300.0,
    name="polymarket_correlations"
)

class CorrelationRequest(BaseModel):
    markets: List[Dict[str, Any]]
    context_markets: List[Dict[str, Any]] = []

@router.post("/DELETED_DUP/api/polymarket/correlations")
async def api_polymarket_correlations(req: CorrelationRequest) -> Dict[str, Any]:
    """Use OpenAI to determine thematic correlations between prediction markets."""
    start_time = time.time()
    logger.info(f"[API] /api/polymarket/correlations called with {len(req.markets)} primary, {len(req.context_markets)} context")

    if not req.markets or len(req.markets) < 2:
        return {"correlations": [], "source": "none"}

    # Build cache key from sorted market titles (stable across refreshes)
    cache_key = "|".join(sorted(m.get("title", "")[:30] for m in req.markets))

    # Check cache
    cached = _polymarket_corr_cache.get()
    if cached is not None and cached.get("cache_key") == cache_key:
        logger.info("[API] Polymarket correlations cache HIT")
        log_timing("api_polymarket_correlations (cached)", start_time)
        return {"correlations": cached["correlations"], "source": "cached"}

    if not Config.OPENAI_API_KEY:
        logger.warning("[API] OpenAI API key not available for correlations")
        return {"correlations": [], "source": "no_api_key"}

    # Build prompt with primary nodes
    market_list = "\n".join([
        f"  ID {m['id']}: \"{m.get('fullTitle', m['title'])}\" (prob: {m.get('prob', 0.5) * 100:.0f}%, category: {m.get('category', '?')})"
        for m in req.markets
    ])

    # Build context summary from broader pool to inform thematic grouping
    context_summary = ""
    if req.context_markets:
        # Group context markets by common themes for the AI
        context_questions = [m.get("question", m.get("title", "")) for m in req.context_markets[:100]]
        context_summary = f"""

BROADER MARKET CONTEXT (for thematic awareness - these are NOT nodes, just context):
The full market pool contains {len(req.context_markets)} additional bets. Here are representative samples:
{chr(10).join('  - ' + q[:90] for q in context_questions[:50])}

Use this context to understand thematic clusters. For example, if the primary nodes include an Iran bet, 
and the broader pool has many Middle East/war/diplomacy bets, that Iran node should connect to other 
geopolitical nodes. Similarly, if there are many crypto bets in context, connect crypto-related primary nodes together."""

    prompt = f"""You are a quantitative analyst building a prediction market correlation network. 
Given these PRIMARY NODES (the top prediction markets by volume), determine thematic connections between them.

PRIMARY NODES (these are the nodes in the network - connect ONLY these IDs):
{market_list}
{context_summary}

RULES FOR CONNECTIONS:
1. **Thematic clustering**: Group by real-world topic. An Iran bet connects to Middle East/war/diplomacy bets. 
   A Fed rate bet connects to inflation/recession/economy bets. A crypto bet connects to other crypto/finance bets.
2. **Causal chains**: If outcome A would directly affect outcome B's probability, connect them strongly.
3. **Inverse relationships**: Use negative r for bets that move opposite directions.
4. **Every node MUST have 2-5 connections**. No isolated nodes.
5. **Prefer strong thematic connections** (r > 0.5) over weak generic ones.

CORRELATION SCALE:
- r = 0.7 to 0.95: Strong thematic link (same topic/event, direct causal)
- r = 0.4 to 0.7: Moderate link (same domain, indirect effect)  
- r = 0.15 to 0.4: Weak but notable (shared broader theme)
- r = -0.15 to -0.95: Inverse relationship

Return ONLY a JSON object with a "correlations" array of [id_a, id_b, r_value] triples.
Use ONLY the numeric IDs from the PRIMARY NODES above.
Example: {{"correlations": [[0, 3, 0.82], [1, 5, -0.45], [2, 7, 0.33]]}}"""

    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=Config.OPENAI_API_KEY, timeout=45)

        t0 = time.time()
        resp = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=8000
        )
        elapsed_ms = int((time.time() - t0) * 1000)
        logger.info(f"[API] OpenAI correlations response in {elapsed_ms}ms")

        content = resp.choices[0].message.content.strip()
        parsed = json.loads(content)
        correlations = parsed.get("correlations", [])

        # Validate: ensure all IDs exist and r values are in range
        valid_ids = {m["id"] for m in req.markets}
        validated = []
        for corr in correlations:
            if (isinstance(corr, list) and len(corr) == 3
                    and corr[0] in valid_ids and corr[1] in valid_ids
                    and corr[0] != corr[1]):
                r = max(-0.95, min(0.95, float(corr[2])))
                if abs(r) >= 0.10:  # Skip very weak correlations
                    validated.append([corr[0], corr[1], round(r, 2)])

        # Cache the result
        _polymarket_corr_cache.set({
            "cache_key": cache_key,
            "correlations": validated
        })

        log_timing("api_polymarket_correlations", start_time, f"({len(validated)} pairs)")
        logger.info(f"[API] Polymarket correlations: {len(validated)} pairs computed")
        return {"correlations": validated, "source": "openai"}

    except Exception as e:
        logger.error(f"[API] Polymarket correlations error: {e}")
        return {"correlations": [], "source": "error", "error": str(e)}


# =============================================================================
# POLYMARKET AGENT QUERY - NL-powered network rearrangement
# =============================================================================

class AgentQueryRequest(BaseModel):
    query: str
    markets: List[Dict[str, Any]] = []

@router.post("/DELETED_DUP/api/polymarket/agent-query")
async def api_polymarket_agent_query(req: AgentQueryRequest) -> Dict[str, Any]:
    """Parse a natural language query into structured filter/layout instructions
    for the prediction network visualization."""
    start_time = time.time()
    logger.info(f"[API] /api/polymarket/agent-query called: query='{req.query}', markets={len(req.markets)}")

    query = req.query.strip()
    if not query:
        return {"action": "none", "narrative": "No query provided.", "filter": {}, "layout": "default", "highlightIds": []}

    # --- RESET shortcut (no LLM needed) ---
    reset_words = ["reset", "show all", "clear", "default", "restore"]
    if query.lower() in reset_words:
        log_timing("api_polymarket_agent_query", start_time, "(reset)")
        return {
            "action": "reset",
            "filter": {},
            "layout": "default",
            "narrative": "View reset to default layout.",
            "highlightIds": [],
            "focusMarketId": None
        }

    # --- Build market summary for LLM ---
    market_summary = ""
    if req.markets:
        lines = []
        for m in req.markets[:100]:
            lines.append(
                f"  ID {m.get('id', '?')}: \"{m.get('fullTitle', m.get('title', '?'))}\" "
                f"(prob: {round((m.get('prob', 0.5)) * 100)}%, "
                f"cat: {m.get('category', '?')}, vol: {m.get('volume', '?')})"
            )
        market_summary = "\n".join(lines)

    # Debug: log first few markets to diagnose field issues
    if req.markets:
        sample = req.markets[:3]
        for i, sm in enumerate(sample):
            logger.info(f"[API] agent-query market[{i}] keys={list(sm.keys())} cat='{sm.get('category', 'MISSING')}' prob={sm.get('prob', 'MISSING')} id={sm.get('id', 'MISSING')} title='{(sm.get('fullTitle') or sm.get('title', ''))[:50]}'")

    # --- LLM-powered intent parsing ---
    if Config.OPENAI_API_KEY and req.markets:
        prompt = f"""You are an analyst controlling a prediction market visualization. 
The user typed a natural language command to filter/rearrange the network of prediction market nodes.

AVAILABLE MARKETS (nodes in the network):
{market_summary}

AVAILABLE CATEGORIES: ECON, TECH, CRYPTO, SCI, POL

USER COMMAND: "{query}"

Parse their intent into a JSON object with these fields:
{{
  "action": "filter" | "compare" | "focus" | "sort",
  "filter": {{
    "categories": [],      // e.g. ["CRYPTO", "TECH"] - empty means all
    "minProb": null,       // e.g. 0.6 for "above 60%"
    "maxProb": null,       // e.g. 0.4 for "below 40%"
    "keywords": [],        // search terms to match against titles
    "marketIds": [],       // specific market IDs if the user references specific markets
    "sortBy": null         // "volume" | "prob" | "change" | null
  }},
  "layout": "cluster" | "radial" | "split" | "default",
  "focusMarketId": null,   // ID of a specific market to center on (for "focus" action)
  "narrative": "...",      // 1-2 sentence explanation of what you're showing
  "highlightIds": []       // specific IDs to highlight/glow (subset of matching)
}}

LAYOUT RULES:
- "cluster": group matching nodes together at center (default for filter)
- "radial": arrange matching nodes in circle around focusMarketId
- "split": side-by-side comparison (action="compare", e.g. "crypto vs politics")
- "default": return all nodes to original positions

IMPORTANT:
- For "compare" action, split keywords into two groups in the filter
- highlightIds should be the top 3-5 most relevant matches
- narrative should be concise and informative
- If keywords match market titles, include those market IDs in marketIds
- Return ONLY the JSON object, no extra text"""

        try:
            client = _get_openai_async_client(timeout=30)

            t0 = time.time()
            resp = await client.chat.completions.create(
                model="gpt-5-mini",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                max_completion_tokens=2000
            )
            elapsed_ms = int((time.time() - t0) * 1000)
            logger.info(f"[API] Agent query LLM response in {elapsed_ms}ms")

            content = resp.choices[0].message.content.strip()
            parsed = json.loads(content)

            # Validate and normalize the response
            result = {
                "action": parsed.get("action", "filter"),
                "filter": parsed.get("filter", {}),
                "layout": parsed.get("layout", "cluster"),
                "focusMarketId": parsed.get("focusMarketId"),
                "narrative": parsed.get("narrative", ""),
                "highlightIds": parsed.get("highlightIds", []),
                "source": "openai"
            }

            # Validate category names
            valid_cats = {"ECON", "TECH", "CRYPTO", "SCI", "POL"}
            if result["filter"].get("categories"):
                result["filter"]["categories"] = [
                    c for c in result["filter"]["categories"] if c in valid_cats
                ]

            # Validate market IDs
            valid_ids = {m.get("id") for m in req.markets}
            if result.get("highlightIds"):
                result["highlightIds"] = [i for i in result["highlightIds"] if i in valid_ids]
            if result["filter"].get("marketIds"):
                result["filter"]["marketIds"] = [i for i in result["filter"]["marketIds"] if i in valid_ids]

            log_timing("api_polymarket_agent_query", start_time, f"(action={result['action']})")
            return result

        except Exception as e:
            logger.error(f"[API] Agent query LLM error: {e}")
            # Fall through to keyword fallback

    # --- FALLBACK: keyword-based filtering (no LLM) ---
    logger.info("[API] Agent query using keyword fallback")
    query_lower = query.lower()

    # Simple category detection
    cat_map = {
        "crypto": "CRYPTO", "bitcoin": "CRYPTO", "ethereum": "CRYPTO", "btc": "CRYPTO",
        "tech": "TECH", "ai": "TECH", "technology": "TECH",
        "economy": "ECON", "economic": "ECON", "fed": "ECON", "inflation": "ECON", "rate": "ECON",
        "science": "SCI", "climate": "SCI", "health": "SCI",
        "politic": "POL", "politics": "POL", "political": "POL",
        "election": "POL", "president": "POL", "trump": "POL", "congress": "POL"
    }
    detected_cats = []
    cat_trigger_words = set()  # words that triggered category detection
    for word, cat in cat_map.items():
        if word in query_lower:
            if cat not in detected_cats:
                detected_cats.append(cat)
            cat_trigger_words.add(word)

    # Extract non-category keywords for title matching
    # (words from the query that are NOT just category triggers)
    query_words = re.findall(r'[a-z]+', query_lower)
    stop_words = {"show", "me", "the", "all", "vs", "versus", "compare", "and", "or",
                  "with", "about", "above", "below", "markets", "market", "in", "for"}
    title_keywords = [w for w in query_words if w not in stop_words and w not in cat_trigger_words and len(w) > 2]

    # Probability extraction
    min_prob = None
    max_prob = None
    prob_above = re.search(r'above\s+(\d+)%', query_lower)
    prob_below = re.search(r'below\s+(\d+)%', query_lower)
    if prob_above:
        min_prob = int(prob_above.group(1)) / 100
    if prob_below:
        max_prob = int(prob_below.group(1)) / 100

    # Detect compare intent
    is_compare = " vs " in query_lower or " versus " in query_lower or "compare" in query_lower
    layout = "split" if is_compare and len(detected_cats) >= 2 else "cluster"
    action = "compare" if is_compare else "filter"

    # Find matching market IDs
    # Category matching and title-keyword matching are INDEPENDENT:
    #   - If categories detected, include markets in those categories
    #   - If title keywords exist, also require title keyword match
    #   - If neither, include all (just apply prob filter)
    matching_ids = []
    if req.markets:
        for m in req.markets:
            title = (m.get("fullTitle") or m.get("title") or "").lower()
            cat = m.get("category", "")
            prob = m.get("prob", 0.5)

            # Category filter: if categories detected, market must be in one of them
            cat_match = not detected_cats or cat in detected_cats

            # Title keyword filter: if non-category keywords exist, title must contain at least one
            kw_match = not title_keywords or any(k in title for k in title_keywords)

            # Probability filter
            prob_match = True
            if min_prob is not None and prob < min_prob:
                prob_match = False
            if max_prob is not None and prob > max_prob:
                prob_match = False

            if cat_match and kw_match and prob_match:
                matching_ids.append(m.get("id"))

    narrative = f"Showing {len(matching_ids)} markets"
    if detected_cats:
        narrative += f" in {', '.join(detected_cats)}"
    if min_prob:
        narrative += f" above {int(min_prob * 100)}%"
    if max_prob:
        narrative += f" below {int(max_prob * 100)}%"
    narrative += "."

    result = {
        "action": action,
        "filter": {
            "categories": detected_cats,
            "minProb": min_prob,
            "maxProb": max_prob,
            "keywords": title_keywords,
            "marketIds": matching_ids,
            "sortBy": None
        },
        "layout": layout,
        "focusMarketId": None,
        "narrative": narrative,
        "highlightIds": matching_ids[:5],
        "source": "fallback"
    }

    log_timing("api_polymarket_agent_query", start_time, f"(fallback, {len(matching_ids)} matches)")
    return result


# =============================================================================
# TICKER CONTEXT ENDPOINT - Related news and bets for chart view
# =============================================================================

# Ticker to related topics mapping (sector, competitors, commodities)
TICKER_CONTEXT_MAP = {
    # Semiconductors
    "NVDA": ["nvidia", "semiconductors", "AI chips", "AMD", "INTC", "gpu", "data center", "CUDA", "rare earth", "TSM", "jensen huang"],
    "AMD": ["amd", "semiconductors", "cpu", "gpu", "intel", "NVDA", "data center", "ryzen", "epyc", "lisa su"],
    "INTC": ["intel", "semiconductors", "cpu", "chips", "foundry", "AMD", "NVDA", "manufacturing", "pat gelsinger"],
    "TSM": ["tsmc", "taiwan semiconductor", "foundry", "chips", "NVDA", "AMD", "AAPL"],
    "AVGO": ["broadcom", "semiconductors", "networking", "infrastructure", "chips"],
    "QCOM": ["qualcomm", "mobile chips", "snapdragon", "5g", "ARM"],
    "MU": ["micron", "memory", "dram", "nand", "semiconductors"],
    
    # Big Tech
    "AAPL": ["apple", "iphone", "mac", "ios", "app store", "services", "china sales", "vision pro", "tim cook"],
    "MSFT": ["microsoft", "azure", "windows", "office", "AI", "copilot", "cloud", "openai", "GOOGL", "satya nadella"],
    "GOOGL": ["google", "alphabet", "search", "youtube", "cloud", "AI", "android", "gemini", "advertising", "sundar pichai"],
    "GOOG": ["google", "alphabet", "search", "youtube", "cloud", "AI", "gemini"],
    "AMZN": ["amazon", "aws", "e-commerce", "cloud", "retail", "prime", "alexa", "andy jassy"],
    "META": ["meta", "facebook", "instagram", "whatsapp", "metaverse", "advertising", "VR", "reels", "mark zuckerberg"],
    
    # EVs and Auto
    "TSLA": ["tesla", "EV", "electric vehicles", "elon musk", "autonomous", "cybertruck", "energy storage", "RIVN", "GM", "F"],
    "RIVN": ["rivian", "EV", "electric vehicles", "trucks", "amazon", "TSLA"],
    "LCID": ["lucid", "EV", "electric vehicles", "luxury", "TSLA"],
    "GM": ["general motors", "auto", "EV", "electric vehicles", "cruise"],
    "F": ["ford", "auto", "EV", "f-150", "trucks"],
    
    # Energy/Oil - EXPANDED for geopolitical context
    "XOM": ["exxon", "oil", "energy", "crude", "refining", "CVX", "OXY", "opec", "middle east", "petroleum", "gasoline", "EPA"],
    "CVX": ["chevron", "oil", "energy", "crude", "natural gas", "opec", "refining"],
    "OXY": ["occidental", "oil", "energy", "permian", "carbon capture", "warren buffett"],
    
    # Finance
    "JPM": ["jpmorgan", "banking", "finance", "interest rates", "fed", "credit", "jamie dimon"],
    "GS": ["goldman sachs", "banking", "investment banking", "trading", "david solomon"],
    "BAC": ["bank of america", "banking", "consumer banking", "rates"],
    
    # Crypto-adjacent
    "COIN": ["coinbase", "crypto", "bitcoin", "ethereum", "exchange", "MSTR", "SEC crypto"],
    "MSTR": ["microstrategy", "bitcoin", "crypto", "btc", "michael saylor"],
    
    # Retail
    "WMT": ["walmart", "retail", "consumer", "e-commerce"],
    "TGT": ["target", "retail", "consumer", "discretionary"],
    "COST": ["costco", "retail", "wholesale", "membership"],
    
    # Pharma/Biotech
    "LLY": ["eli lilly", "pharma", "ozempic", "weight loss", "diabetes", "NVO"],
    "NVO": ["novo nordisk", "ozempic", "wegovy", "weight loss", "pharma", "LLY"],
    "PFE": ["pfizer", "pharma", "vaccines", "biotech"],
    "MRNA": ["moderna", "vaccines", "mrna", "biotech"],
    
    # Defense
    "LMT": ["lockheed martin", "defense", "military", "nato", "missiles", "f-35"],
    "RTX": ["raytheon", "defense", "military", "missiles", "aerospace"],
    "NOC": ["northrop grumman", "defense", "b-21", "military"],
    "GD": ["general dynamics", "defense", "submarines", "military"],
    "KTOS": ["kratos", "defense", "drones", "unmanned", "military", "hypersonic"],
    
    # AI/Software
    "CRM": ["salesforce", "crm", "cloud", "AI", "enterprise", "marc benioff"],
    "NOW": ["servicenow", "enterprise", "cloud", "workflows"],
    "PLTR": ["palantir", "AI", "government", "data analytics", "defense", "peter thiel"],
    "SNOW": ["snowflake", "data", "cloud", "analytics"],
    
    # Meme Stocks / Retail Favorites
    "GME": ["gamestop", "gme", "meme stocks", "retail investors", "short squeeze", "reddit", "roaring kitty", "wallstreetbets", "ryan cohen", "video games"],
    "AMC": ["amc", "meme stocks", "retail investors", "movie theaters", "ape", "adam aron", "cinema"],
    "HOOD": ["robinhood", "retail trading", "payment for order flow", "commission-free", "trading app", "vlad tenev", "meme stocks"],
    "BBBY": ["bed bath beyond", "meme stocks", "retail", "bankruptcy"],
    
    # Major ETFs - Broad market context
    "SPY": ["s&p 500", "spy", "stock market", "index", "fed", "interest rates", "inflation", "economy", "recession", "gdp", "employment", "fomc", "powell"],
    "QQQ": ["nasdaq", "qqq", "tech stocks", "technology index", "growth stocks", "mega cap tech"],
    "IWM": ["russell 2000", "small cap", "iwm", "small stocks"],
    "DIA": ["dow jones", "dow", "blue chip", "industrial"],
    
    # Chinese Tech
    "BABA": ["alibaba", "china", "e-commerce", "jack ma", "ant group", "chinese stocks"],
    "JD": ["jd.com", "china", "e-commerce", "retail", "chinese stocks"],
    "PDD": ["pinduoduo", "temu", "china", "e-commerce", "chinese stocks"],
    "NIO": ["nio", "china", "EV", "electric vehicles", "chinese stocks", "TSLA"],
    
    # Streaming/Entertainment
    "NFLX": ["netflix", "streaming", "content", "subscribers", "disney+", "entertainment"],
    "DIS": ["disney", "streaming", "disney+", "parks", "entertainment", "bob iger"],
}

# Default sector mapping for unknown tickers
DEFAULT_SECTOR_TERMS = ["stock", "market", "earnings"]

# =============================================================================
# SECTOR-BASED TOPIC MAPPING (GICS Sectors)
# =============================================================================
# These topics are applied to ALL tickers in the sector, providing relevant
# context even for tickers not in TICKER_CONTEXT_MAP

SECTOR_TOPICS = {
    # Technology
    "Technology": ["technology", "tech stocks", "software", "hardware", "cloud", "AI", "cybersecurity", "saas", "digital"],
    "Information Technology": ["technology", "tech stocks", "software", "hardware", "cloud", "AI", "cybersecurity", "saas", "digital"],
    
    # Healthcare / Pharma
    "Healthcare": ["healthcare", "pharma", "biotech", "FDA", "drug approval", "clinical trial", "medical devices", "hospitals"],
    "Health Care": ["healthcare", "pharma", "biotech", "FDA", "drug approval", "clinical trial", "medical devices", "hospitals"],
    
    # Financials
    "Financials": ["banking", "finance", "interest rates", "fed", "credit", "loans", "insurance", "fintech", "wall street"],
    "Financial Services": ["banking", "finance", "interest rates", "fed", "credit", "loans", "insurance", "fintech"],
    
    # Energy
    "Energy": ["oil", "energy", "crude", "natural gas", "opec", "refining", "petroleum", "drilling", "renewable", "solar", "wind"],
    
    # Consumer Discretionary
    "Consumer Discretionary": ["retail", "consumer", "spending", "e-commerce", "luxury", "restaurants", "travel", "leisure"],
    "Consumer Cyclical": ["retail", "consumer", "spending", "e-commerce", "luxury", "restaurants", "travel", "leisure"],
    
    # Consumer Staples
    "Consumer Staples": ["consumer staples", "food", "beverage", "household", "grocery", "packaged goods", "tobacco"],
    "Consumer Defensive": ["consumer staples", "food", "beverage", "household", "grocery", "packaged goods"],
    
    # Industrials
    "Industrials": ["industrial", "manufacturing", "aerospace", "defense", "logistics", "machinery", "construction", "infrastructure"],
    
    # Materials
    "Materials": ["materials", "mining", "chemicals", "metals", "steel", "commodities", "gold", "copper", "lithium"],
    "Basic Materials": ["materials", "mining", "chemicals", "metals", "steel", "commodities", "gold", "copper"],
    
    # Real Estate
    "Real Estate": ["real estate", "reit", "property", "housing", "commercial real estate", "mortgage", "rent"],
    
    # Utilities
    "Utilities": ["utilities", "electricity", "power", "water", "natural gas", "renewable energy", "grid", "nuclear"],
    
    # Communication Services
    "Communication Services": ["telecom", "media", "streaming", "advertising", "social media", "entertainment", "broadcasting"],
    "Telecommunication Services": ["telecom", "5g", "wireless", "broadband", "mobile", "carriers"],
    
    # Crypto / Digital Assets
    "Cryptocurrency": ["crypto", "bitcoin", "ethereum", "blockchain", "defi", "SEC crypto", "stablecoin", "altcoin"],
}

# Sector aliases (normalize various sector name formats)
SECTOR_ALIASES = {
    "tech": "Technology",
    "healthcare": "Healthcare", 
    "health care": "Health Care",
    "financial": "Financials",
    "consumer cyclical": "Consumer Discretionary",
    "consumer defensive": "Consumer Staples",
    "basic materials": "Materials",
    "communication": "Communication Services",
}


# Ticker-to-sector cache (populated from database queries)
_ticker_sector_cache: Dict[str, tuple] = {}  # {ticker: (sector, timestamp)}
TICKER_SECTOR_CACHE_TTL = 3600  # 1 hour

async def get_ticker_sector(ticker: str) -> Optional[str]:
    """
    Look up a ticker's sector from the company_profiles database.
    Returns: Sector name or None if not found.
    """
    ticker = ticker.upper().strip()
    
    # Check cache
    if ticker in _ticker_sector_cache:
        sector, cached_at = _ticker_sector_cache[ticker]
        if time.time() - cached_at < TICKER_SECTOR_CACHE_TTL:
            return sector
    
    # Query database
    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT p.sector 
                FROM market_data.company_profiles p
                JOIN market_data.symbols s ON s.id = p.symbol_id
                WHERE s.symbol = %s
                LIMIT 1
            """, (ticker,))
            row = cur.fetchone()
            sector = row[0] if row else None
            
            # Cache result
            _ticker_sector_cache[ticker] = (sector, time.time())
            return sector
            
    except Exception as e:
        logger.warning(f"[TickerTopics] Failed to lookup sector for {ticker}: {e}")
        return None
    finally:
        if conn:
            release_connection(conn)


def get_sector_topics(sector: Optional[str]) -> List[str]:
    """Get topic terms for a given sector name."""
    if not sector:
        return []
    
    # Normalize sector name
    sector_normalized = sector.strip()
    
    # Check direct match
    if sector_normalized in SECTOR_TOPICS:
        return SECTOR_TOPICS[sector_normalized]
    
    # Check aliases
    sector_lower = sector_normalized.lower()
    if sector_lower in SECTOR_ALIASES:
        mapped = SECTOR_ALIASES[sector_lower]
        if mapped in SECTOR_TOPICS:
            return SECTOR_TOPICS[mapped]
    
    # Partial match (e.g. "Technology Services" matches "Technology")
    for key in SECTOR_TOPICS:
        if key.lower() in sector_lower or sector_lower in key.lower():
            return SECTOR_TOPICS[key]
    
    return []

# =============================================================================
# COMBINED TOPIC GENERATION (Hardcoded + Sector + AI Fallback)
# =============================================================================

# Cache for AI-generated ticker topics (24-hour TTL)
_ticker_topic_cache: Dict[str, tuple] = {}  # {ticker: (topics_list, timestamp)}
TICKER_TOPIC_CACHE_TTL = 86400  # 24 hours in seconds

async def get_ticker_topics_combined(ticker: str) -> List[str]:
    """
    Get relevant search topics for any ticker using a layered approach:
    
    1. Check hardcoded TICKER_CONTEXT_MAP (fast, covers major tickers)
    2. Look up sector from database and add sector topics
    3. Use AI generation as fallback for truly unknown tickers
    
    Topics are combined and deduplicated for comprehensive matching.
    
    Returns: List of search topics related to the ticker.
    """
    ticker = ticker.upper().strip()
    combined_topics = []
    
    # Layer 1: Hardcoded company-specific topics (highest priority)
    if ticker in TICKER_CONTEXT_MAP:
        combined_topics.extend(TICKER_CONTEXT_MAP[ticker])
        logger.debug(f"[TickerTopics] Added {len(TICKER_CONTEXT_MAP[ticker])} hardcoded topics for {ticker}")
    
    # Layer 2: Sector-based topics from database
    sector = await get_ticker_sector(ticker)
    if sector:
        sector_topics = get_sector_topics(sector)
        if sector_topics:
            combined_topics.extend(sector_topics)
            logger.info(f"[TickerTopics] Added {len(sector_topics)} sector topics for {ticker} (sector: {sector})")
    
    # If we have topics from hardcoded + sector, we're done
    if combined_topics:
        # Always include the ticker itself
        if ticker.lower() not in [t.lower() for t in combined_topics]:
            combined_topics.insert(0, ticker.lower())
        # Deduplicate while preserving order
        seen = set()
        deduped = []
        for t in combined_topics:
            t_lower = t.lower()
            if t_lower not in seen:
                seen.add(t_lower)
                deduped.append(t)
        logger.info(f"[TickerTopics] Final {len(deduped)} topics for {ticker}: {deduped[:5]}...")
        return deduped
    
    # Layer 3: Check AI cache
    if ticker in _ticker_topic_cache:
        topics, cached_at = _ticker_topic_cache[ticker]
        age_seconds = time.time() - cached_at
        if age_seconds < TICKER_TOPIC_CACHE_TTL:
            logger.info(f"[TickerTopics] AI Cache HIT for {ticker} (age: {age_seconds/3600:.1f}h)")
            return topics
        else:
            logger.info(f"[TickerTopics] AI Cache EXPIRED for {ticker} (age: {age_seconds/3600:.1f}h)")
    
    # Layer 4: AI generation as last resort (for unknown tickers with no sector data)
    logger.info(f"[TickerTopics] Generating AI topics for {ticker} (no hardcoded or sector data)...")

    
    prompt = f"""For stock ticker {ticker}, list 8-10 related search topics that would help find relevant news and prediction market bets.

Include:
- Company name and common abbreviations
- Industry/sector keywords
- Main products or services
- Key competitors (as tickers)
- Related commodities or themes
- Key executives if notable

Return ONLY a JSON object with a "topics" array of lowercase strings.
Example for NVDA: {{"topics": ["nvidia", "semiconductors", "ai chips", "gpu", "data center", "AMD", "INTC", "jensen huang", "cuda"]}}"""

    try:
        client = _get_openai_async_client(timeout=30)
        
        t0 = time.time()
        resp = await client.chat.completions.create(
            model="gpt-5-mini",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=200
        )
        elapsed_ms = int((time.time() - t0) * 1000)
        
        # Parse response
        text = (resp.choices[0].message.content or "").strip()
        data = json.loads(text)
        
        # Handle various response formats
        if isinstance(data, dict) and "topics" in data:
            topics = data["topics"]
        elif isinstance(data, list):
            topics = data
        else:
            logger.warning(f"[TickerTopics] Unexpected response format: {text[:100]}")
            topics = [ticker.lower()]
        
        # Ensure we have a list of strings
        topics = [str(t).lower().strip() for t in topics if t]
        
        # Add ticker itself if not present
        if ticker.lower() not in topics:
            topics.insert(0, ticker.lower())
        
        logger.info(f"[TickerTopics] AI generated {len(topics)} topics for {ticker} in {elapsed_ms}ms: {topics[:5]}...")
        
        # Track usage
        if hasattr(resp, 'usage') and resp.usage:
            from core.usage_tracker import track_usage
            track_usage(
                model="gpt-4o-mini",
                input_tokens=resp.usage.prompt_tokens,
                output_tokens=resp.usage.completion_tokens,
                context=f"ticker_context_topics_{ticker}"
            )
        
        # Cache result
        _ticker_topic_cache[ticker] = (topics, time.time())
        
        return topics
        
    except json.JSONDecodeError as e:
        logger.error(f"[TickerTopics] JSON parse error for {ticker}: {e}")
        fallback = [ticker.lower()] + DEFAULT_SECTOR_TERMS
        _ticker_topic_cache[ticker] = (fallback, time.time())
        return fallback
        
    except Exception as e:
        logger.error(f"[TickerTopics] AI topic generation failed for {ticker}: {e}")
        fallback = [ticker.lower()] + DEFAULT_SECTOR_TERMS
        _ticker_topic_cache[ticker] = (fallback, time.time())
        return fallback

@router.get("/api/ticker/context")
async def api_ticker_context(
    ticker: str = Query(..., description="Ticker symbol to get context for"),
    news_limit: int = Query(10, description="Max news items to return"),
    bets_limit: int = Query(10, description="Max Polymarket bets to return")
) -> Dict[str, Any]:
    """
    Get contextual data for a ticker - related news and Polymarket bets.
    Used to enrich chart view with sidebar panels.
    """
    start_time = time.time()
    ticker = ticker.upper().strip()
    logger.info(f"[API] /api/ticker/context called: ticker={ticker}")
    
    # 1. Get related topics for this ticker (hardcoded + sector + AI fallback)
    related_topics = await get_ticker_topics_combined(ticker)
    
    # 2. Query Discord news for related headlines
    related_news = []
    conn = None
    try:
        conn = get_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Build ILIKE patterns from related topics
            patterns = [f"%%{topic}%%" for topic in related_topics[:8]]  # Limit patterns
            
            # Query the main event table (v_recent_events view may have different schema)
            cur.execute("""
                SELECT 
                    e.event_id,
                    e.event_time::text,
                    e.headline,
                    SUBSTRING(e.body, 1, 200) as body_preview,
                    e.source_name
                FROM discord_news.event e
                WHERE e.event_time > NOW() - INTERVAL '7 days'
                  AND (
                    e.headline ILIKE ANY(%s)
                    OR e.body ILIKE ANY(%s)
                  )
                ORDER BY e.event_time DESC
                LIMIT %s
            """, (patterns, patterns, news_limit))
            
            rows = cur.fetchall()
            related_news = [dict(r) for r in rows]
            logger.info(f"[API] Ticker context: found {len(related_news)} related news for {ticker}")
            
    except Exception as e:
        logger.error(f"[API] Ticker context news error: {e}")
    finally:
        if conn:
            release_connection(conn)
    
    # 3. Query Polymarket for related bets with AI relevance validation
    related_bets = []
    try:
        # Get all polymarket data
        polymarket_response = await api_polymarket()
        all_markets = polymarket_response.get("results", [])
        
        # Step 1: Pre-filter candidates using topic matching (keeps query fast)
        topics_lower = [t.lower() for t in related_topics]
        
        # Always include the ticker itself as a search term (case insensitive)
        if ticker.lower() not in topics_lower:
            topics_lower.insert(0, ticker.lower())
        
        # Exclude only the most generic terms that match everything
        GENERIC_TERMS = {"stock", "market", "earnings", "trading", "shares", "price"}
        specific_topics = [t for t in topics_lower if t not in GENERIC_TERMS and len(t) > 2]
        
        logger.info(f"[API] Ticker context: searching bets with topics: {specific_topics[:5]}...")
        
        candidate_bets = []
        for market in all_markets:
            question = (market.get("question") or "").lower()
            if any(topic in question for topic in specific_topics):
                candidate_bets.append(market)
                if len(candidate_bets) >= bets_limit * 3:  # Get more candidates for AI to filter
                    break
        
        logger.info(f"[API] Ticker context: {len(candidate_bets)} candidate bets pre-filtered for {ticker}")
        
        # Step 2: Use GPT-5o-mini to validate relevance (only if we have candidates)
        if candidate_bets:
            try:
                client = _get_openai_async_client(timeout=15)
                
                # Build question list for batch validation
                questions = [m.get("question", "") for m in candidate_bets[:15]]  # Limit to 15 for cost
                
                validation_prompt = f"""For stock ticker {ticker}, rate how relevant each prediction market question is.
Return ONLY a JSON object with an "indices" array containing the indices (0-14) of questions that are DIRECTLY related to {ticker} company/stock.

Rules for relevance:
- INCLUDE: Questions about {ticker}'s stock price, earnings, products, leadership, or direct competitors
- EXCLUDE: General market/economic questions (Fed rates, recessions) unless they specifically mention {ticker}
- EXCLUDE: Political questions unrelated to the company
- EXCLUDE: Questions about other unrelated companies

Questions:
{chr(10).join(f'{i}. {q}' for i, q in enumerate(questions))}

Return format: {{"indices": [0, 2, 5]}} (example - only return actually relevant indices)"""

                t0 = time.time()
                resp = await client.chat.completions.create(
                    model="gpt-5-mini",
                    messages=[{"role": "user", "content": validation_prompt}],
                    response_format={"type": "json_object"},
                    temperature=0.1,
                    max_tokens=100
                )
                elapsed_ms = int((time.time() - t0) * 1000)
                
                # Parse response
                text = (resp.choices[0].message.content or "").strip()
                data = json.loads(text)
                relevant_indices = data.get("indices", [])
                
                # Filter to only relevant bets
                for idx in relevant_indices:
                    if 0 <= idx < len(candidate_bets) and len(related_bets) < bets_limit:
                        related_bets.append(candidate_bets[idx])
                
                logger.info(f"[API] Ticker context: AI validated {len(related_bets)}/{len(candidate_bets)} bets for {ticker} in {elapsed_ms}ms")
                
                # Track usage
                if hasattr(resp, 'usage') and resp.usage:
                    from core.usage_tracker import track_usage
                    track_usage(
                        model="gpt-4o-mini",
                        input_tokens=resp.usage.prompt_tokens,
                        output_tokens=resp.usage.completion_tokens,
                        context=f"ticker_context_bets_{ticker}"
                    )
                    
            except Exception as validation_error:
                logger.warning(f"[API] Ticker context: AI validation failed ({validation_error}), using pre-filtered results")
                # Fallback: use first few pre-filtered results
                related_bets = candidate_bets[:bets_limit]
        
        logger.info(f"[API] Ticker context: final {len(related_bets)} related bets for {ticker}")
        
    except Exception as e:
        logger.error(f"[API] Ticker context bets error: {e}")
    
    elapsed = (time.time() - start_time) * 1000
    log_timing("api_ticker_context", start_time, f"(news={len(related_news)}, bets={len(related_bets)})")
    
    return {
        "ticker": ticker,
        "related_topics": related_topics,
        "related_news": related_news,
        "related_bets": related_bets,
        "query_time_ms": round(elapsed, 1)
    }



# Pre-compiled regex for script stripping
SCRIPT_TAG_PATTERN = re.compile(rb'(?i)<script[^>]*>.*?</script>', re.DOTALL)
SCRIPT_OPEN_PATTERN = re.compile(rb'(?i)<script[^>]*>')

@router.get("/api/proxy")
def api_proxy(
    url: str = Query(..., description="Target URL to proxy"),
    strip_scripts: bool = Query(False, description="Strip <script> tags and src attributes to prevent CORS/execution")
) -> Response:
    """Simple proxy to bypass X-Frame-Options."""
    start_time = time.time()
    logger.info(f"[API] /api/proxy called: url={url[:100]}..., strip_scripts={strip_scripts}")
    
    try:
        req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urlopen(req, timeout=10) as resp:
            content = resp.read()
            logger.debug(f"[API] Proxy fetched {len(content)} bytes from {url[:50]}...")
            
            # Script Stripping (Security/CORS fix)
            if strip_scripts:
                original_size = len(content)
                # Remove <script>...</script> blocks using pre-compiled pattern
                content = SCRIPT_TAG_PATTERN.sub(b'', content)
                # Remove any remaining <script> tags
                content = SCRIPT_OPEN_PATTERN.sub(b'', content)
                logger.debug(f"[API] Script stripping: {original_size} -> {len(content)} bytes")
                
            # Inject base tag to fix relative links
            try:
                decoded = content.decode('utf-8')
                base_tag = f'<base href="{url}">'
                if "<head>" in decoded:
                    decoded = decoded.replace("<head>", f"<head>{base_tag}")
                else:
                    decoded = f"{base_tag}{decoded}"
                content = decoded.encode('utf-8')
            except:
                logger.warning("[API] Could not inject base tag, serving content as-is")

            # Inject CSS to crop header/footer
            style_injection = b"""
            <style>
                header, footer, nav, #header, #footer, .header, .footer, #topControl, .social-share, .site-footer, #topnav, .navbar {
                    display: none !important;
                }
                body {
                    background: white !important;
                    padding: 40px !important; 
                    margin: 0 !important;
                    overflow-x: hidden !important;
                    width: 100% !important;
                    box-sizing: border-box !important;
                }
                #article, #content, .content, main, [role="main"], .col-md-9, .col-xs-12 {
                    margin: 0 !important;
                    padding: 0 !important;
                    max-width: none !important;
                    width: 100% !important;
                    float: none !important;
                    box-sizing: border-box !important;
                }
                /* Ensure text doesn't touch edges */
                p, h1, h2, h3, h4, h5, h6, li, div {
                    max-width: 100% !important;
                    box-sizing: border-box !important;
                }

                /* Hide sidebar if present */
                .col-md-3, .col-sm-3, #leftText {
                    display: none !important;
                }
            </style>
            """
            # Insert style at end of head or start of body
            if b"</head>" in content:
                content = content.replace(b"</head>", style_injection + b"</head>")
            else:
                content = style_injection + content
            
            log_timing("api_proxy", start_time, f"({len(content)} bytes)")
            logger.info(f"[API] /api/proxy completed: {len(content)} bytes returned")
            return Response(content=content, media_type="text/html")
            
    except Exception as e:
        logger.error(f"[API] Proxy error: {e}")
        return Response(content=f"Error proxying URL: {e}", status_code=500)


# --- YouTube Data API Integration ---

# YouTube API key from centralized config (no hardcoded fallback)
YOUTUBE_API_KEY = Config.YOUTUBE_API_KEY
if not YOUTUBE_API_KEY:
    logger.warning("[API] YOUTUBE_API_KEY not set - YouTube endpoints will return errors")

# --- Quota Tracking ---
# YouTube Data API v3 Quota: 10,000 units/day
# - search.list (live status): 100 units per call
# - playlistItems.list (latest video): 1 unit per call
_youtube_quota_used: int = 0
_youtube_quota_reset_time: float = 0
YOUTUBE_DAILY_QUOTA = Config.YOUTUBE_DAILY_QUOTA

def _track_youtube_quota(units: int, operation: str):
    """Track YouTube API quota usage."""
    global _youtube_quota_used, _youtube_quota_reset_time
    
    current_time = time.time()
    
    # Reset quota counter daily (at midnight PT, roughly)
    # For simplicity, reset if more than 24 hours since last reset
    if current_time - _youtube_quota_reset_time > 86400:  # 24 hours in seconds
        _youtube_quota_used = 0
        _youtube_quota_reset_time = current_time
        logger.info("[QUOTA] YouTube API quota counter reset for new day")
    
    _youtube_quota_used += units
    remaining = YOUTUBE_DAILY_QUOTA - _youtube_quota_used
    
    logger.info(f"[QUOTA] YouTube API: +{units} units ({operation}) | Used: {_youtube_quota_used}/{YOUTUBE_DAILY_QUOTA} | Remaining: {remaining}")
    
    if _youtube_quota_used > YOUTUBE_DAILY_QUOTA * 0.8:
        logger.warning(f"[QUOTA] ⚠️ YouTube API quota at {(_youtube_quota_used/YOUTUBE_DAILY_QUOTA)*100:.1f}% - consider reducing refresh frequency!")
    
    return remaining

def get_youtube_quota_status() -> Dict[str, Any]:
    """Get current quota usage status."""
    return {
        "used": _youtube_quota_used,
        "limit": YOUTUBE_DAILY_QUOTA,
        "remaining": YOUTUBE_DAILY_QUOTA - _youtube_quota_used,
        "percent_used": round((_youtube_quota_used / YOUTUBE_DAILY_QUOTA) * 100, 2)
    }

# Cache for YouTube live status (increased TTL to conserve quota)
# With 30 minute cache: 10 panels × 48 checks/day × 100 units = 48,000 units - still too high!
# With 60 minute cache: 10 panels × 24 checks/day × 100 units = 24,000 units - still too high!
# SOLUTION: Cache for 2 hours = 10 panels × 12 checks/day × 100 units = 12,000 units
# Plus we share cache across panels for same channel, so actual usage is much lower
_youtube_live_cache: Dict[str, Dict[str, Any]] = {}
_youtube_live_cache_time: Dict[str, float] = {}
YOUTUBE_LIVE_CACHE_TTL = Config.YOUTUBE_LIVE_CACHE_TTL  # From centralized config
MAX_YOUTUBE_CACHE_SIZE = Config.MAX_YOUTUBE_CACHE_SIZE  # Max entries in cache

@router.get("/api/youtube/live-status")
async def api_youtube_live_status(
    channelId: str = Query(..., description="YouTube channel ID")
) -> Dict[str, Any]:
    """
    Check for live/latest video using the cheaper playlistItems method (1 quota unit).
    We treat the latest video from the 'Uploads' playlist as the target.
    If it's a live stream, it will be the latest item.
    """
    start_time = time.time()
    logger.info(f"[API] /api/youtube/live-status called: channelId={channelId}")
    
    current_time = time.time()
    cache_key = f"live_{channelId}"
    cache_age = current_time - _youtube_live_cache_time.get(cache_key, 0)
    
    # Check cache first
    if cache_key in _youtube_live_cache and cache_age < YOUTUBE_LIVE_CACHE_TTL:
        logger.debug(f"[CACHE] YouTube live status cache HIT for {channelId} (age: {cache_age:.1f}s)")
        log_timing("api_youtube_live_status (cached)", start_time)
        return _youtube_live_cache[cache_key]
    
    logger.debug(f"[CACHE] YouTube live status cache MISS/EXPIRED for {channelId}")
    
    try:
        # Optimization: Use playlistItems (1 unit) instead of search.list (100 units)
        # Convert channel ID to uploads playlist ID (UC -> UU)
        uploads_playlist_id = channelId.replace('UC', 'UU')
        
        url = "https://www.googleapis.com/youtube/v3/playlistItems"
        params = {
            "part": "snippet",
            "playlistId": uploads_playlist_id,
            "maxResults": 1,
            "key": YOUTUBE_API_KEY
        }
        
        client = _api_http_client()
        api_start = time.time()
        resp = await client.get(url, params=params, timeout=10.0)
        resp.raise_for_status()
        data = resp.json()
        log_timing("youtube_api_playlist", api_start)
        
        # Track quota usage (playlistItems.list = 1 unit)
        _track_youtube_quota(1, "playlistItems.list (live/latest optimization)")
        
        is_live = False
        live_video_id = None
        live_title = None

        if data.get("items"):
            item = data["items"][0]["snippet"]
            live_video_id = item["resourceId"]["videoId"]
            live_title = item["title"]
            channel_title = item.get("channelTitle", "")
            published_at = item.get("publishedAt", "")
            # We assume the latest video is what we want to play, whether truly 'live' or just uploaded.
            # The frontend expects 'isLive' to trigger the "LIVE" badge, but we can perhaps 
            # infer it or just always play it. For now, let's treat it as "content found".
            # If we really want to know if it's live, we'd need 'videos.list' (another 1 unit), 
            # but for playback, checking if it's the latest is usually enough.
            is_live = True 
            logger.info(f"[API] Channel {channelId} latest content: {live_title} (videoId: {live_video_id})")
        else:
            channel_title = ""
            published_at = ""
            logger.info(f"[API] Channel {channelId} has no content")
        
        result = {
            "isLive": is_live,
            "liveVideoId": live_video_id,
            "liveTitle": live_title,
            "channelTitle": channel_title,
            "publishedAt": published_at,
            "channelId": channelId
        }
        
        # Update cache
        _youtube_live_cache[cache_key] = result
        _youtube_live_cache_time[cache_key] = current_time
        
        # Enforce cache size limit
        if len(_youtube_live_cache) > MAX_YOUTUBE_CACHE_SIZE:
            oldest_key = min(_youtube_live_cache_time, key=_youtube_live_cache_time.get)
            del _youtube_live_cache[oldest_key]
            del _youtube_live_cache_time[oldest_key]
            logger.debug(f"[CACHE] Evicted oldest YouTube cache entry: {oldest_key}")
        
        log_timing("api_youtube_live_status", start_time)
        return result
        
    except httpx.HTTPStatusError as e:
        logger.error(f"[API] YouTube API HTTP error: {e.response.status_code} - {e.response.text}")
        return {
            "error": f"YouTube API error: {e.response.status_code}",
            "isLive": False,
            "channelId": channelId
        }
    except Exception as e:
        logger.error(f"[API] YouTube API error: {e}")
        return {
            "error": str(e),
            "isLive": False,
            "channelId": channelId
        }


@router.get("/api/youtube/quota")
def api_youtube_quota() -> Dict[str, Any]:
    """Get current YouTube API quota usage status."""
    status = get_youtube_quota_status()
    logger.info(f"[API] /api/youtube/quota called: {status['used']}/{status['limit']} units used ({status['percent_used']}%)")
    return status


# Cache for YouTube latest video (increased TTL to conserve quota)
_youtube_latest_cache: Dict[str, Dict[str, Any]] = {}
_youtube_latest_cache_time: Dict[str, float] = {}
YOUTUBE_LATEST_CACHE_TTL = 300.0  # 5 minutes - fast updates

@router.get("/api/youtube/latest-video")
async def api_youtube_latest_video(
    channelId: str = Query(..., description="YouTube channel ID")
) -> Dict[str, Any]:
    """Get the latest uploaded video from a YouTube channel using YouTube Data API v3."""
    start_time = time.time()
    logger.info(f"[API] /api/youtube/latest-video called: channelId={channelId}")
    
    current_time = time.time()
    cache_key = f"latest_{channelId}"
    cache_age = current_time - _youtube_latest_cache_time.get(cache_key, 0)
    
    # Check cache first
    if cache_key in _youtube_latest_cache and cache_age < YOUTUBE_LATEST_CACHE_TTL:
        logger.debug(f"[CACHE] YouTube latest video cache HIT for {channelId} (age: {cache_age:.1f}s)")
        log_timing("api_youtube_latest_video (cached)", start_time)
        return _youtube_latest_cache[cache_key]
    
    logger.debug(f"[CACHE] YouTube latest video cache MISS/EXPIRED for {channelId}")
    
    try:
        # Convert channel ID to uploads playlist ID (UC -> UU)
        uploads_playlist_id = channelId.replace('UC', 'UU')
        
        # YouTube Data API v3: Get latest video from uploads playlist
        url = "https://www.googleapis.com/youtube/v3/playlistItems"
        params = {
            "part": "snippet",
            "playlistId": uploads_playlist_id,
            "maxResults": 1,
            "key": YOUTUBE_API_KEY
        }
        
        client = _api_http_client()
        api_start = time.time()
        resp = await client.get(url, params=params, timeout=10.0)
        resp.raise_for_status()
        data = resp.json()
        log_timing("youtube_api_playlist", api_start)
        
        # Track quota usage (playlistItems.list = 1 unit)
        _track_youtube_quota(1, "playlistItems.list (latest-video)")
        
        # Extract latest video
        if not data.get("items"):
            logger.warning(f"[API] No videos found for channel {channelId}")
            return {
                "error": "No videos found",
                "videoId": None,
                "channelId": channelId
            }
        
        latest_video_id = data["items"][0]["snippet"]["resourceId"]["videoId"]
        latest_title = data["items"][0]["snippet"]["title"]
        latest_published = data["items"][0]["snippet"]["publishedAt"]
        
        logger.info(f"[API] Latest video for {channelId}: {latest_title} (videoId: {latest_video_id})")
        
        result = {
            "videoId": latest_video_id,
            "title": latest_title,
            "publishedAt": latest_published,
            "channelId": channelId
        }
        
        # Update cache
        _youtube_latest_cache[cache_key] = result
        _youtube_latest_cache_time[cache_key] = current_time
        
        log_timing("api_youtube_latest_video", start_time)
        return result
        
    except httpx.HTTPStatusError as e:
        logger.error(f"[API] YouTube API HTTP error: {e.response.status_code} - {e.response.text}")
        return {
            "error": f"YouTube API error: {e.response.status_code}",
            "videoId": None,
            "channelId": channelId
        }
    except Exception as e:
        logger.error(f"[API] YouTube API error: {e}")
        return {
            "error": str(e),
            "videoId": None,
            "channelId": channelId
        }



# --- Static frontend (index.html, JS, etc.) ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Frontend is sibling to backend
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))

logger.info(f"[Server] Serving static files from: {FRONTEND_DIR}")

# --- ADSB.lol Plane Tracker API ---
# Add plane tracking for Focus View triangular prisms
try:
    from features.flight.plane_tracker import fetch_aircraft
    PLANE_TRACKER_AVAILABLE = True
    logger.info("[Server] Plane tracker module loaded from backend")
except ImportError as e:
    PLANE_TRACKER_AVAILABLE = False
    logger.warning(f"[Server] Plane tracker module not available: {e}")


@router.get("/DELETED_DUP/api/planes")
async def api_planes(
    lat: float = Query(..., description="Center latitude"),
    lon: float = Query(..., description="Center longitude"),
    radius_km: float = Query(25.0, description="Radius in kilometers")
) -> Dict[str, Any]:
    """Fetch live aircraft data from ADSB.lol for Focus View plane markers."""
    start_time = time.time()
    logger.info(f"[API] /api/planes called: lat={lat}, lon={lon}, radius_km={radius_km}")
    
    if not PLANE_TRACKER_AVAILABLE:
        logger.error("[API] Plane tracker module not available")
        return {"success": False, "error": "Plane tracker module not available", "planes": []}
    
    try:
        # Convert km to nautical miles (approx 0.54 nm per km)
        radius_nm = radius_km * 0.539957
        
        # Fetch aircraft data (runs in thread pool to avoid blocking)
        import asyncio
        loop = asyncio.get_event_loop()
        df = await loop.run_in_executor(
            None, 
            lambda: fetch_aircraft(
                centers=[(lat, lon)],
                radius_nm=radius_nm,
                endpoint="point",
                sleep_between_calls=0.0
            )
        )
        
        planes = []
        if not df.empty:
            # Drop NaN values for crucial fields
            df = df.dropna(subset=['lat', 'lon', 'elevation_ft'])
            planes = df.to_dict('records')
        
        log_timing("api_planes", start_time, f"({len(planes)} planes)")
        logger.info(f"[API] /api/planes completed: {len(planes)} planes found")
        
        return {
            'success': True,
            'planes': planes,
            'count': len(planes)
        }
        
    except Exception as e:
        logger.error(f"[API] Plane API Error: {e}")
        return {'success': False, 'error': str(e), 'planes': []}


# --- News Heatmap API ---
# Generates GeoJSON data for news density heat map visualization

# --- NASA Satellite Tracker API ---
try:
    from features.satellite.satellite_tracker import fetch_satellites
    SATELLITE_TRACKER_AVAILABLE = True
    logger.info("[Server] Satellite tracker module loaded")
except ImportError as e:
    SATELLITE_TRACKER_AVAILABLE = False
    logger.warning(f"[Server] Satellite tracker module not available: {e}")


@router.get("/DELETED_DUP/api/satellites")
async def api_satellites() -> Dict[str, Any]:
    """Fetch live satellite positions using TLE data propagated via SGP4."""
    start_time = time.time()
    logger.info("[API] /api/satellites called")

    if not SATELLITE_TRACKER_AVAILABLE:
        logger.error("[API] Satellite tracker module not available")
        return {"success": False, "error": "Satellite tracker module not available", "satellites": []}

    try:
        import asyncio
        loop = asyncio.get_event_loop()
        satellites = await loop.run_in_executor(None, fetch_satellites)

        log_timing("api_satellites", start_time, f"({len(satellites)} satellites)")
        logger.info(f"[API] /api/satellites completed: {len(satellites)} satellites found")

        return {
            'success': True,
            'satellites': satellites,
            'count': len(satellites)
        }

    except Exception as e:
        logger.error(f"[API] Satellite API Error: {e}")
        return {'success': False, 'error': str(e), 'satellites': []}



try:
    from features.heatmap.heatmap_service import aggregate_news_by_location
    HEATMAP_SERVICE_AVAILABLE = True
    logger.info("[Server] Heatmap service module loaded")
except ImportError as e:
    HEATMAP_SERVICE_AVAILABLE = False
    logger.warning(f"[Server] Heatmap service not available: {e}")


@router.get("/api/heatmap/news")
def api_heatmap_news(
    days: int = Query(7, description="Number of days to look back", ge=1, le=30)
) -> Dict[str, Any]:
    """
    Returns GeoJSON FeatureCollection of news density by city.
    Used to render a Snapchat-style heat map on the MapBox globe.
    
    Response format:
    {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {"city": "Tehran", "count": 45, "intensity": 0.85}
            }
        ],
        "metadata": {...}
    }
    """
    start_time = time.time()
    logger.info(f"[API] /api/heatmap/news called: days={days}")
    
    if not HEATMAP_SERVICE_AVAILABLE:
        logger.error("[API] Heatmap service not available")
        return {"type": "FeatureCollection", "features": [], "error": "Service unavailable"}
    
    try:
        geojson = aggregate_news_by_location(days=days)
        
        log_timing("api_heatmap_news", start_time, f"({len(geojson.get('features', []))} points)")
        logger.info(f"[API] /api/heatmap/news completed: {len(geojson.get('features', []))} heatmap points")
        
        return geojson
        
    except Exception as e:
        logger.error(f"[API] Heatmap API Error: {e}")
        return {"type": "FeatureCollection", "features": [], "error": str(e)}


# --- Workspace Persistence (Save/Load Layouts) ---
WORKSPACES_FILE = os.path.join(os.path.dirname(__file__), "workspaces.json")


class WorkspacePanelConfig(BaseModel):
    id: str
    type: str
    position: Dict[str, float]
    rotation: Dict[str, float]
    scale: Dict[str, float]
    userData: Dict[str, Any]

class WorkspaceSaveRequest(BaseModel):
    name: str
    panels: List[WorkspacePanelConfig]

@router.post("/api/workspace/save")
def api_save_workspace(req: WorkspaceSaveRequest) -> Dict[str, Any]:
    """Save a workspace layout to disk."""
    start_time = time.time()
    logger.info(f"[API] /api/workspace/save called for '{req.name}' with {len(req.panels)} panels")
    
    try:
        # Load existing
        data = {}
        if os.path.exists(WORKSPACES_FILE):
            try:
                with open(WORKSPACES_FILE, 'r') as f:
                    data = json.load(f)
            except Exception:
                data = {}
                
        # Update
        data[req.name] = [p.dict() for p in req.panels]
        
        # Save
        with open(WORKSPACES_FILE, 'w') as f:
            json.dump(data, f, indent=2)
            
        logger.info(f"[API] Saved workspace '{req.name}' successfully")
        return {"status": "ok", "message": f"Workspace '{req.name}' saved"}
    except Exception as e:
        logger.error(f"[API] Failed to save workspace: {e}")
        return {"status": "error", "message": str(e)}

@router.get("/api/workspace/{name}")
def api_get_workspace(name: str) -> Dict[str, Any]:
    """Load a workspace layout from disk."""
    logger.info(f"[API] /api/workspace/{name} called")
    
    try:
        if not os.path.exists(WORKSPACES_FILE):
            return {"status": "error", "message": "No workspaces found"}
            
        with open(WORKSPACES_FILE, 'r') as f:
            data = json.load(f)
            
        if name in data:
            return {"status": "ok", "panels": data[name]}
        else:
            return {"status": "error", "message": f"Workspace '{name}' not found"}
            
    except Exception as e:
        logger.error(f"[API] Failed to load workspace: {e}")
        return {"status": "error", "message": str(e)}

@router.get("/api/workspaces")
def api_list_workspaces() -> Dict[str, Any]:
    """List all saved workspaces."""
    try:
        if not os.path.exists(WORKSPACES_FILE):
            return {"workspaces": []}
            
        with open(WORKSPACES_FILE, 'r') as f:
            data = json.load(f)
            
        return {"workspaces": list(data.keys())}
    except Exception as e:
        logger.error(f"[API] Failed to list workspaces: {e}")
        return {"workspaces": []}

# =============================================================================
# SUPPORT/RESISTANCE INDICATOR ENDPOINT
# =============================================================================

from features.indicators.support_resistance import compute_support_resistance


class SupportResistanceRequest(BaseModel):
    """Request model for S/R indicator computation."""
    ticker: str
    days: int = 730
    pivot_left_bars: int = 9
    pivot_right_bars: int = 12
    minor_extension: int = 21
    major_extension: int = 500
    trend_extension: int = 50
    include_margins: bool = True
    include_support: bool = True
    include_resistance: bool = True
    include_minor_levels: bool = True
    include_major_levels: bool = True
    include_minor_trends: bool = True
    include_major_trends: bool = True
    include_pivots: bool = True


@router.post("/api/indicators/support-resistance")
def api_support_resistance(req: SupportResistanceRequest) -> Dict[str, Any]:
    """
    Compute support/resistance levels, trend lines, and pivot points for a ticker.
    
    Returns:
        lines: Array of line objects (horizontal S/R and diagonal trends)
        labels: Array of angle labels
        pivots: Array of pivot point markers
        zones: Array of zone rectangles
        stats: Summary statistics
    """
    start_time = time.time()
    logger.info(f"[API] /api/indicators/support-resistance called: ticker={req.ticker}")
    
    try:
        # Fetch OHLCV data using existing cache
        end_date = datetime.now()
        start_date = end_date - timedelta(days=req.days)
        start_str = start_date.strftime('%Y-%m-%d')
        end_str = end_date.strftime('%Y-%m-%d')
        
        rows = _fetch_ohlcv_cached(req.ticker.upper(), start_str, end_str, 500000)
        
        if not rows:
            return {"error": f"No OHLCV data found for {req.ticker}", "lines": [], "pivots": []}
        
        # Convert to format expected by compute function
        ohlcv_data = [
            {
                "time": int(row["time"]),
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": float(row["volume"]),
            }
            for row in rows
        ]
        
        # Compute S/R levels
        result = compute_support_resistance(
            ohlcv_data,
            pivot_left_bars=req.pivot_left_bars,
            pivot_right_bars=req.pivot_right_bars,
            minor_extension_bars=req.minor_extension,
            major_extension_bars=req.major_extension,
            trend_extension_bars=req.trend_extension,
            include_margins=req.include_margins,
            include_support=req.include_support,
            include_resistance=req.include_resistance,
            include_minor_levels=req.include_minor_levels,
            include_major_levels=req.include_major_levels,
            include_minor_trends=req.include_minor_trends,
            include_major_trends=req.include_major_trends,
            include_pivots=req.include_pivots,
        )
        
        log_timing("api_support_resistance", start_time, f"({len(result['lines'])} lines, {len(result['pivots'])} pivots)")
        logger.info(f"[API] /api/indicators/support-resistance completed: {result['stats']}")
        
        return result
        
    except Exception as e:
        logger.error(f"[API] Error computing S/R: {e}")
        return {"error": str(e), "lines": [], "pivots": [], "labels": [], "zones": []}


@router.get("/api/indicators/support-resistance")
def api_support_resistance_get(
    ticker: str = Query(..., description="Ticker symbol"),
    days: int = Query(730, description="Number of days of data"),
    include_margins: bool = Query(True, description="Include dashed margin bands"),
    include_pivots: bool = Query(True, description="Include pivot markers"),
    include_trends: bool = Query(True, description="Include trend lines"),
) -> Dict[str, Any]:
    """GET version for quick queries."""
    req = SupportResistanceRequest(
        ticker=ticker,
        days=days,
        include_margins=include_margins,
        include_pivots=include_pivots,
        include_minor_trends=include_trends,
        include_major_trends=include_trends,
    )
    return api_support_resistance(req)

# --- Static Files (Must be last) ---
# Mount 3d files directory for OBJ models
MODELS_3D_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "3d files"))
if os.path.exists(MODELS_3D_DIR):
    app.mount(
        "/3d files",
        StaticFiles(directory=MODELS_3D_DIR),
        name="3d_files",
    )
    logger.info(f"[Server] 3D files mounted from: {MODELS_3D_DIR}")
else:
    logger.warning(f"[Server] 3D files directory not found at: {MODELS_3D_DIR}")

if os.path.exists(FRONTEND_DIR):
    app.mount(
        "/",
        StaticFiles(directory=FRONTEND_DIR, html=True),
        name="frontend",
    )
    logger.info(f"[Server] Frontend mounted successfully")
else:
    logger.error(f"[Server] Frontend directory not found at: {FRONTEND_DIR}")

