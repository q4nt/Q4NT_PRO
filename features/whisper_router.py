"""
whisper_router.py - WebSocket endpoint for live video transcription.

Supports two engines (selectable via ?engine= query param):
  1. "local" (default) - faster-whisper local inference via CTranslate2 (free)
  2. "fireworks" - Fireworks AI cloud API (whisper-v3-turbo, ~$0.20/hr)

Protocol:
  1. Client sends JSON: { "action": "start", "videoId": "YOUTUBE_ID" }
  2. Backend uses yt-dlp to extract audio stream, downloads 10s chunks
  3. Backend transcribes each chunk and sends back: { "text": "...", "chunk": N }
  4. Client sends { "action": "stop" } to end
"""

import os
import io
import time
import logging
import tempfile
import asyncio
import json
import subprocess

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

logger = logging.getLogger("whisper_router")

router = APIRouter(tags=["whisper"])

# ---------------------------------------------------------------------------
# Engine: Fireworks AI (cloud)
# ---------------------------------------------------------------------------
FIREWORKS_API_BASE = "https://audio-turbo.us-virginia-1.direct.fireworks.ai/v1"
FIREWORKS_MODEL = "whisper-v3-turbo"


def _get_fireworks_api_key():
    """Get Fireworks API key from env."""
    key = os.environ.get("FIREWORKS_API_KEY", "")
    if not key:
        try:
            from core.config import Config
            key = getattr(Config, "FIREWORKS_API_KEY", "") or ""
        except Exception:
            pass
    return key


async def _transcribe_fireworks(audio_path: str) -> str:
    """Transcribe audio file using Fireworks AI Whisper API."""
    from openai import AsyncOpenAI
    api_key = _get_fireworks_api_key()
    if not api_key:
        raise ValueError("FIREWORKS_API_KEY not set")
    client = AsyncOpenAI(api_key=api_key, base_url=FIREWORKS_API_BASE, timeout=30)
    with open(audio_path, "rb") as f:
        transcript = await client.audio.transcriptions.create(
            model=FIREWORKS_MODEL, file=f, language="en", response_format="text",
        )
    return transcript.strip() if isinstance(transcript, str) else str(transcript).strip()


# ---------------------------------------------------------------------------
# Engine: faster-whisper (local)
# ---------------------------------------------------------------------------
_fw_model = None
_fw_model_lock = asyncio.Lock()


def _load_faster_whisper():
    """Lazy-load the faster-whisper model (downloads on first use)."""
    global _fw_model
    if _fw_model is not None:
        return _fw_model
    try:
        from faster_whisper import WhisperModel
        model_size = os.environ.get("WHISPER_MODEL_SIZE", "large-v3-turbo")
        device = os.environ.get("WHISPER_DEVICE", "auto")
        compute_type = os.environ.get("WHISPER_COMPUTE_TYPE", "auto")
        logger.info(f"[Whisper Local] Loading faster-whisper model={model_size} device={device} compute={compute_type}")
        _fw_model = WhisperModel(model_size, device=device, compute_type=compute_type)
        logger.info("[Whisper Local] Model loaded successfully")
        return _fw_model
    except ImportError:
        raise ImportError(
            "faster-whisper not installed. Run: pip install faster-whisper"
        )
    except Exception as e:
        logger.error(f"[Whisper Local] Failed to load model: {e}")
        raise


async def _transcribe_local(audio_path: str) -> str:
    """Transcribe audio file using faster-whisper local engine."""
    async with _fw_model_lock:
        model = _load_faster_whisper()

    loop = asyncio.get_event_loop()

    def _do_transcribe():
        segments, info = model.transcribe(audio_path, language="en", beam_size=1, vad_filter=True)
        texts = []
        for segment in segments:
            texts.append(segment.text.strip())
        return " ".join(texts)

    text = await loop.run_in_executor(None, _do_transcribe)
    return text.strip()


# ---------------------------------------------------------------------------
# Engine dispatcher
# ---------------------------------------------------------------------------
ENGINES = {
    "fireworks": _transcribe_fireworks,
    "local": _transcribe_local,
}


async def _transcribe(audio_path: str, engine: str) -> str:
    fn = ENGINES.get(engine)
    if not fn:
        raise ValueError(f"Unknown engine '{engine}'. Available: {list(ENGINES.keys())}")
    return await fn(audio_path)


# ---------------------------------------------------------------------------
# yt-dlp audio extraction
# ---------------------------------------------------------------------------
async def _get_audio_stream_url(video_id: str) -> str:
    """Use yt-dlp to get the best audio stream URL for a YouTube video.
    
    Strategy: try web_creator client first (bypasses many 403s), then
    Chrome cookies, Edge cookies, and finally cookies.txt file.
    """
    import yt_dlp

    loop = asyncio.get_event_loop()
    url = f"https://www.youtube.com/watch?v={video_id}"

    # Locate optional cookies file next to main_server.py
    _server_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    _cookies_file = os.path.join(_server_dir, "cookies.txt")

    def _extract():
        base_opts = {
            "format": "bestaudio/best",
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
        }

        # Attempt 1: Multiple robust clients (bypasses many 403/DRM restrictions)
        try:
            wc_opts = {
                **base_opts,
                "extractor_args": {"youtube": {"player_client": ["ios", "android", "mweb", "web_creator"]}},
            }
            with yt_dlp.YoutubeDL(wc_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                stream = info.get("url") or info.get("webpage_url")
                if stream:
                    logger.info("[Whisper yt-dlp] Success via multi-client strategy")
                    return stream
        except Exception as e1:
            logger.warning(f"[Whisper yt-dlp] Multi-client attempt failed: {e1}")

        # Attempt 2: no authentication (default client)
        try:
            with yt_dlp.YoutubeDL(base_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                stream = info.get("url") or info.get("webpage_url")
                if stream:
                    return stream
        except Exception as e2:
            logger.warning(f"[Whisper yt-dlp] No-auth attempt failed: {e2}")

        # Attempt 3: Chrome browser cookies (works when Chrome is closed)
        try:
            chrome_opts = {**base_opts, "cookiesfrombrowser": ("chrome",)}
            with yt_dlp.YoutubeDL(chrome_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                stream = info.get("url") or info.get("webpage_url")
                if stream:
                    return stream
        except Exception as e3:
            logger.warning(f"[Whisper yt-dlp] Chrome cookies attempt failed: {e3}")

        # Attempt 4: Edge browser cookies
        try:
            edge_opts = {**base_opts, "cookiesfrombrowser": ("edge",)}
            with yt_dlp.YoutubeDL(edge_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                stream = info.get("url") or info.get("webpage_url")
                if stream:
                    return stream
        except Exception as e4:
            logger.warning(f"[Whisper yt-dlp] Edge cookies attempt failed: {e4}")

        # Attempt 5: cookies.txt file (if present)
        if os.path.isfile(_cookies_file):
            logger.info(f"[Whisper yt-dlp] Retrying with cookies.txt")
            cookie_opts = {**base_opts, "cookiefile": _cookies_file}
            try:
                with yt_dlp.YoutubeDL(cookie_opts) as ydl:
                    info = ydl.extract_info(url, download=False)
                    stream = info.get("url") or info.get("webpage_url")
                    if stream:
                        return stream
            except Exception as e5:
                logger.error(f"[Whisper yt-dlp] cookies.txt attempt failed: {e5}")

        raise RuntimeError(
            f"Cannot access video {video_id}. "
            "If this is a private/age-restricted stream, export your YouTube cookies "
            "to cookies.txt in the project root."
        )

    return await loop.run_in_executor(None, _extract)


async def _download_audio_chunk(stream_url: str, duration: int = 10) -> str:
    """Download a short audio chunk from a stream URL using ffmpeg."""
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False, dir=tempfile.gettempdir())
    tmp_path = tmp.name
    tmp.close()

    # Use ffmpeg to grab `duration` seconds of audio from the stream
    cmd = [
        "ffmpeg", "-y",
        "-i", stream_url,
        "-t", str(duration),
        "-vn",                    # no video
        "-acodec", "pcm_s16le",   # WAV format for whisper
        "-ar", "16000",           # 16kHz sample rate
        "-ac", "1",               # mono
        "-loglevel", "error",
        tmp_path
    ]

    loop = asyncio.get_event_loop()

    def _run_ffmpeg():
        proc = subprocess.run(cmd, capture_output=True, timeout=duration + 15)
        if proc.returncode != 0:
            stderr = proc.stderr.decode("utf-8", errors="replace")[:200]
            raise RuntimeError(f"ffmpeg error: {stderr}")

    await loop.run_in_executor(None, _run_ffmpeg)

    # Verify file has content
    if not os.path.exists(tmp_path) or os.path.getsize(tmp_path) < 1000:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise RuntimeError("Audio chunk too small or empty")

    return tmp_path


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------
@router.websocket("/ws/whisper-transcribe")
async def ws_whisper_transcribe(websocket: WebSocket, engine: str = "local"):
    """
    WebSocket endpoint for real-time video transcription.

    Query params:
      ?engine=local      (default) - faster-whisper local inference
      ?engine=fireworks   - Fireworks AI cloud

    Protocol:
    - Client sends JSON: { "action": "start", "videoId": "YOUTUBE_ID" }
    - Server extracts audio from YouTube, transcribes in 10s chunks
    - Server sends back: { "text": "...", "chunk": N, "engine": "..." }
    - Client sends JSON: { "action": "stop" } to end
    """
    await websocket.accept()
    engine = engine.lower().strip()
    logger.info(f"[Whisper WS] Client connected (engine={engine})")

    # Validate engine
    if engine == "fireworks" and not _get_fireworks_api_key():
        await websocket.send_json({"error": "FIREWORKS_API_KEY not set. Switch to ?engine=local"})
        await websocket.close()
        return

    if engine == "local":
        try:
            async with _fw_model_lock:
                _load_faster_whisper()
        except (ImportError, Exception) as e:
            await websocket.send_json({"error": str(e)})
            await websocket.close()
            return

    if engine not in ENGINES:
        await websocket.send_json({"error": f"Unknown engine '{engine}'."})
        await websocket.close()
        return

    engine_label = "faster-whisper (local)" if engine == "local" else "Fireworks AI"
    await websocket.send_json({
        "status": "ready",
        "message": f"Whisper v3-turbo ready via {engine_label}",
        "engine": engine,
    })

    # Wait for start command with videoId
    stop_flag = False
    chunk_number = 0

    try:
        while not stop_flag:
            message = await websocket.receive()

            if "text" in message and message["text"]:
                try:
                    cmd = json.loads(message["text"])
                except (json.JSONDecodeError, AttributeError):
                    continue

                if cmd.get("action") == "stop":
                    logger.info("[Whisper WS] Client requested stop")
                    break

                if cmd.get("action") == "start" and cmd.get("videoId"):
                    video_id = cmd["videoId"]
                    logger.info(f"[Whisper WS] Starting transcription for videoId={video_id}")

                    await websocket.send_json({
                        "status": "extracting",
                        "message": f"Extracting audio from video {video_id}...",
                    })

                    # Get audio stream URL
                    try:
                        stream_url = await _get_audio_stream_url(video_id)
                        logger.info(f"[Whisper WS] Got audio stream URL for {video_id}")
                    except Exception as e:
                        logger.error(f"[Whisper WS] yt-dlp error: {e}")
                        await websocket.send_json({"error": f"Could not extract audio: {e}"})
                        continue

                    await websocket.send_json({
                        "status": "transcribing",
                        "message": "Live transcription active",
                    })

                    # Continuous transcription loop
                    while not stop_flag:
                        # Check for stop messages (non-blocking)
                        try:
                            check = await asyncio.wait_for(
                                websocket.receive(), timeout=0.05
                            )
                            if "text" in check and check["text"]:
                                try:
                                    inner = json.loads(check["text"])
                                    if inner.get("action") == "stop":
                                        stop_flag = True
                                        break
                                except Exception:
                                    pass
                        except asyncio.TimeoutError:
                            pass

                        # Download 10s audio chunk
                        tmp_path = None
                        try:
                            tmp_path = await _download_audio_chunk(stream_url, duration=10)
                            chunk_number += 1

                            text = await _transcribe(tmp_path, engine)

                            if text:
                                await websocket.send_json({
                                    "text": text,
                                    "chunk": chunk_number,
                                    "engine": engine,
                                })
                                logger.debug(f"[Whisper WS] Chunk {chunk_number}: {text[:80]}")

                        except Exception as e:
                            error_msg = str(e)
                            logger.warning(f"[Whisper WS] Chunk error: {error_msg}")
                            # Notify client of chunk-level errors
                            try:
                                await websocket.send_json({
                                    "status": "chunk_error",
                                    "message": f"Chunk {chunk_number + 1} error: {error_msg[:100]}",
                                })
                            except Exception:
                                pass
                            # Re-fetch stream URL on error (might have expired)
                            try:
                                stream_url = await _get_audio_stream_url(video_id)
                                logger.info(f"[Whisper WS] Refreshed stream URL for {video_id}")
                            except Exception:
                                await websocket.send_json({"error": f"Stream expired: {error_msg}"})
                                break
                        finally:
                            if tmp_path and os.path.exists(tmp_path):
                                try:
                                    os.unlink(tmp_path)
                                except OSError:
                                    pass

    except WebSocketDisconnect:
        logger.info("[Whisper WS] Client disconnected")
    except Exception as e:
        logger.error(f"[Whisper WS] Unexpected error: {e}")
        try:
            await websocket.send_json({"error": str(e)})
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
        logger.info(f"[Whisper WS] Session ended after {chunk_number} chunks ({engine})")
