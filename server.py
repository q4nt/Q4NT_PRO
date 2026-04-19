import os
import re
import json
import time
from datetime import datetime
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from spotify_router import router as spotify_router

# Load environment variables early
load_dotenv()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
class Config:
    """Enterprise configuration management"""
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
    OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5-mini")
    OPENAI_TIMEOUT = int(os.getenv("OPENAI_TIMEOUT", 60))
    AI_FAST_MODEL = os.getenv("AI_FAST_MODEL", "gpt-4o-mini")
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
    PORT = int(os.getenv("PORT", 8000))
    ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

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

# ---------------------------------------------------------------------------
# Command Logger
# ---------------------------------------------------------------------------
class CommandLogger:
    """Utility for persisting UI command history to disk"""
    LOG_FILE = "command_log.json"
    MAX_HISTORY_SIZE = 500

    @staticmethod
    def log_interaction(command: str, response: dict, process: dict = None, metrics: dict = None):
        """Appends a new command interaction to the log file"""
        entry = {
            "timestamp": datetime.now().isoformat(),
            "command": command,
            "response": response,
            "process": process or {},
            "metrics": metrics or {}
        }

        history = []
        if os.path.exists(CommandLogger.LOG_FILE):
            try:
                with open(CommandLogger.LOG_FILE, "r") as f:
                    history = json.load(f)
                    if not isinstance(history, list):
                        history = []
            except (json.JSONDecodeError, FileNotFoundError):
                history = []

        history.append(entry)

        # Rotate: keep only the most recent entries
        if len(history) > CommandLogger.MAX_HISTORY_SIZE:
            history = history[-CommandLogger.MAX_HISTORY_SIZE:]

        # Write back with nice formatting
        with open(CommandLogger.LOG_FILE, "w") as f:
            json.dump(history, f, indent=4)

# ---------------------------------------------------------------------------
# Tier 2: AI Triage Agent  (gpt-4o-mini -- fast/cheap classification)
# ---------------------------------------------------------------------------
class AITriageAgent:
    """Uses OpenAI to classify natural language commands into structured intents."""

    SYSTEM_PROMPT = """You are an advanced UI command classifier for the Q4NT workspace application.
Given a user command and their current UI context, extract the intent and parameters as JSON.

Current User Context:
{context}

Available intents and their parameters:
- change_theme: value=(dark|light|blue|green)
- change_theme_color: value=(css color name or hex code)
- change_font_size: value=(size with unit, e.g. "16px")
- change_font_color: value=(css color name or hex code)
- remove_panel: value=(left|right|top|bottom|command|all)
- restore_panel: value=(left|right|top|bottom|command|all)
- toggle_panel: value=(left|right|top|bottom|all)
- arrange_panels: value=(left-sidebar|right-sidebar|horizontal|vertical|quad|single)
- create_panel: value=floating
- change_opacity: value=(number 0-100)
- change_background: value=(css color or gradient string)
- navigate_view: value=(chart|map|globe|terrain|report|canvas|workspace|dashboard|3d|v1..v20|f1..f15)
- toggle_3d_objects: value=(hide|show)
- modify_bg_objects: target_ids=[list of string ids], action=(hide|show|move), target_position={"x": number, "y": number, "z": number} (only if action is move, provide an absolute position. e.g. for "left" use x=-300, for "right" use x=300)
- set_zindex: value=(number)
- question: raw=(the question asked by the user)
- unknown: raw=(original command text)

Rules:
1. Map the user's natural language to the CLOSEST matching intent above.
2. For theme requests like "dark mode", "go dark", "make it light" -> change_theme.
3. For panel requests like "hide sidebar", "close the right side" -> remove_panel. "show panels", "restore panels" -> restore_panel: all. "hide panels" -> remove_panel: all.
4. For view requests like "show chart", "open map view", "f1 view" -> navigate_view.
5. If they want to hide/show ALL 3D objects generally -> toggle_3d_objects. 
6. If they want to modify SPECIFIC background objects (e.g., "hide the purple sphere", "move white panels to the right") -> modify_bg_objects. Find the matching objects in `backgroundPanels` or `background3DPrimitives` by their `color` or `type`, extract their `id`s into `target_ids`, and determine the action/position.
7. Extract color values as CSS-safe strings (hex or named colors).
8. EXTREME FOCUS RULE: Never assume the user wants to affect UI panels if they ask to affect background/3D objects, and vice versa. Only perform the exact requested action. Do not over-generalize "hide" commands.
7. If the user asks about depth, "layer", or "same layer", map to `set_zindex`.
8. If the user is asking a general question, asking for help, or asking for information, map it to `question` intent.
9. If the command truly does not map to any intent, return unknown.

Respond ONLY with valid JSON: {"intent": "...", "value": "..."}
If the command doesn't map to any intent, return: {"intent": "unknown", "raw": "original text here"}"""

    _client = None

    @classmethod
    def get_client(cls):
        if cls._client is None:
            try:
                from openai import AsyncOpenAI
                cls._client = AsyncOpenAI(
                    api_key=Config.OPENAI_API_KEY,
                    timeout=Config.OPENAI_TIMEOUT
                )
            except ImportError:
                print("[AITriageAgent] openai package not installed. Run: pip install openai")
                return None
        return cls._client

    @classmethod
    async def classify(cls, command: str, context: dict) -> dict:
        """Classify a natural language command using gpt-4o-mini (fast/cheap tier)."""
        client = cls.get_client()
        if client is None:
            return {"intent": "unknown", "raw": command, "_source": "ai_unavailable"}

        try:
            prompt_context = json.dumps(context, indent=2) if context else "No context available"
            filled_prompt = cls.SYSTEM_PROMPT.replace("{context}", prompt_context)
            
            response = await client.chat.completions.create(
                model=Config.AI_FAST_MODEL,
                messages=[
                    {"role": "system", "content": filled_prompt},
                    {"role": "user", "content": command}
                ],
                response_format={"type": "json_object"},
                temperature=0,
                max_tokens=150
            )
            result = json.loads(response.choices[0].message.content)
            result["_source"] = "ai_triage"
            return result
        except Exception as e:
            print(f"[AITriageAgent] Classification error: {e}")
            return {"intent": "unknown", "raw": command, "_source": "ai_error"}

# ---------------------------------------------------------------------------
# Agent Orchestrator  (Tier 1 regex + Tier 2 AI + Tier 3 fallback)
# ---------------------------------------------------------------------------
class AgentOrchestrator:

    # -- Tier 1: Expanded Regex Agent -----------------------------------------
    @staticmethod
    def run_regex_agent(command: str):
        """
        Fast deterministic pattern matching.  Covers common synonyms
        so that obvious commands resolve with zero latency / zero cost.
        """
        cmd = command.lower().strip()

        # ---- Theme switching (expanded synonyms) ----------------------------
        theme_patterns = [
            r'(?:change|switch|set|go|enable|activate|turn\s+on)\s+(?:the\s+)?(?:theme\s+)?(?:to\s+)?(dark|light|blue|green)(?:\s+(?:mode|theme))?',
            r'(dark|light|blue|green)\s+(?:mode|theme)',
            r'(?:make\s+it|go)\s+(dark|light|blue|green)',
        ]
        for pat in theme_patterns:
            m = re.search(pat, cmd)
            if m:
                return {"intent": "change_theme", "value": m.group(1)}

        # ---- Theme / accent color -------------------------------------------
        color_match = re.search(
            r'(?:change|set|make|turn)\s+(?:the\s+)?(?:theme|accent|primary)\s*(?:color)?\s+(?:to\s+|into\s+)?(\w+|#[0-9a-fA-F]{3,8})',
            cmd
        )
        if color_match:
            return {"intent": "change_theme_color", "value": color_match.group(1)}

        # ---- Background color -----------------------------------------------
        bg_match = re.search(
            r'(?:change|set|make|turn)\s+(?:the\s+)?(?:background|bg|panel)\s*(?:color)?\s+(?:to\s+|into\s+)?(\w+|#[0-9a-fA-F]{3,8})',
            cmd
        )
        if bg_match:
            return {"intent": "change_theme_color", "value": bg_match.group(1)}

        # ---- Font size ------------------------------------------------------
        font_size_match = re.search(
            r'(?:change|set|make)\s+(?:the\s+)?(?:font|text)\s*(?:size)?\s+(?:to\s+)?(\d+)\s*(px|rem|em|%)?',
            cmd
        )
        if font_size_match:
            unit = font_size_match.group(2) or "px"
            return {"intent": "change_font_size", "value": f"{font_size_match.group(1)}{unit}"}

        # ---- Font color -----------------------------------------------------
        font_color_match = re.search(
            r'(?:change|set|make)\s+(?:the\s+)?(?:font|text)\s*(?:color)?\s+(?:to\s+)?(\w+|#[0-9a-fA-F]{3,8})',
            cmd
        )
        if font_color_match:
            return {"intent": "change_font_color", "value": font_color_match.group(1)}

        # ---- Hide / remove panel (expanded synonyms) ------------------------
        panel_hide = re.search(
            r'(?:remove|hide|close|collapse|dismiss|get\s+rid\s+of)\s+(?:the\s+)?'
            r'(left|right|top|bottom|command|side)\s*(?:bar|panel|sidebar|edge)?',
            cmd
        )
        if panel_hide:
            val = panel_hide.group(1)
            if val == "side":
                val = "left"
            return {"intent": "remove_panel", "value": val}

        # ---- Restore / show panel -------------------------------------------
        panel_show = re.search(
            r'(?:restore|show|open|bring\s+back|expand)\s+(?:the\s+)?'
            r'(left|right|top|bottom|command|side)\s*(?:bar|panel|sidebar|edge)?',
            cmd
        )
        if panel_show:
            val = panel_show.group(1)
            if val == "side":
                val = "left"
            return {"intent": "restore_panel", "value": val}

        # ---- Toggle panel ---------------------------------------------------
        toggle_match = re.search(
            r'(?:toggle|flip)\s+(?:the\s+)?(left|right|top|bottom)\s*(?:panel|bar|sidebar)?',
            cmd
        )
        if toggle_match:
            return {"intent": "toggle_panel", "value": toggle_match.group(1)}

        # ---- Arrange / layout -----------------------------------------------
        arrange_match = re.search(
            r'(?:arrange|split|layout|set).*?(left-sidebar|right-sidebar|horizontal|vertical|quad|single)',
            cmd
        )
        if arrange_match:
            return {"intent": "arrange_panels", "value": arrange_match.group(1)}

        # ---- Create floating panel ------------------------------------------
        create_panel_match = re.search(
            r'(?:create|add|new|open|spawn)\s+(?:a\s+)?(?:new\s+)?(?:float|floating|ui\s+)?panel',
            cmd
        )
        if create_panel_match:
            return {"intent": "create_panel", "value": "floating"}

        # ---- Navigate to a view ---------------------------------------------
        view_match = re.search(
            r'(?:open|show|go\s+to|switch\s+to|navigate\s+to|view)\s+(?:the\s+)?'
            r'(chart|map|globe|terrain|report|canvas|workspace|dashboard|3d)\s*(?:view)?',
            cmd
        )
        if view_match:
            return {"intent": "navigate_view", "value": view_match.group(1)}

        # ---- Opacity --------------------------------------------------------
        opacity_match = re.search(
            r'(?:set|change|make)\s+(?:the\s+)?opacity\s+(?:to\s+)?(\d+)\s*%?',
            cmd
        )
        if opacity_match:
            return {"intent": "change_opacity", "value": int(opacity_match.group(1))}

        # ---- Toggle 3D Objects ----------------------------------------------
        obj_match = re.search(
            r'(?:hide|show)\s+(?:the\s+)?(?:3d\s+)?(?:objects|mesh|scene)',
            cmd
        )
        if obj_match:
            val = "hide" if "hide" in cmd else "show"
            return {"intent": "toggle_3d_objects", "value": val}

        # ---- Set Z-Index ----------------------------------------------------
        z_match = re.search(
            r'(?:set|move|change)\s+(?:the\s+)?(?:panel|panels)?\s*(?:z-index|layer|level)\s+(?:to\s+)?(\d+)',
            cmd
        )
        if z_match:
            return {"intent": "set_zindex", "value": int(z_match.group(1))}

        # No match
        return {"intent": "unknown", "raw": command}

    # -- Tier 1.5: Validator Agent --------------------------------------------
    @staticmethod
    def run_validator_agent(parsed_data: dict):
        """
        Validates extracted intent parameters for safety and bounds.
        Prevents CSS injection, extreme values, and malformed inputs.
        """
        intent = parsed_data.get("intent", "unknown")
        value = str(parsed_data.get("value", ""))

        # Skip validation for unknown intents (nothing to validate)
        if intent == "unknown":
            return True, "Valid"

        # --- CSS color safety check ---
        if intent in ("change_theme_color", "change_font_color", "change_background"):
            safe_color = re.match(
                r'^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{2,30}|rgba?\([\d,.\s]+\)|hsla?\([\d,.\s%]+\))$',
                value
            )
            if not safe_color:
                return False, f"Invalid color value: '{value}'. Use a named color (e.g. 'red') or hex code (e.g. '#ff0000')."

        # --- Font size bounds ---
        if intent == "change_font_size":
            size_match = re.match(r'^(\d+)(px|rem|em|%)?$', value)
            if not size_match:
                return False, f"Invalid font size format: '{value}'. Example: '16px'."
            size_num = int(size_match.group(1))
            if size_num < 8 or size_num > 72:
                return False, f"Font size {size_num} is outside the safe range (8-72)."

        # --- Opacity bounds ---
        if intent == "change_opacity":
            try:
                opacity = int(value)
                if opacity < 0 or opacity > 100:
                    return False, f"Opacity must be 0-100, received {opacity}."
            except (ValueError, TypeError):
                return False, f"Invalid opacity value: '{value}'. Must be a number 0-100."

        # --- Theme value whitelist ---
        if intent == "change_theme":
            if value not in ("dark", "light", "blue", "green"):
                return False, f"Unknown theme '{value}'. Available: dark, light, blue, green."

        # --- Panel value whitelist ---
        if intent in ("remove_panel", "restore_panel", "toggle_panel"):
            if value not in ("left", "right", "top", "bottom", "command"):
                return False, f"Unknown panel '{value}'. Available: left, right, top, bottom, command."

        return True, "Valid"

    # -- Orchestrator Execute -------------------------------------------------
    @staticmethod
    async def execute(command: str, context: dict = None):
        """
        Orchestrates the 3-tier lifecycle of a UI command:
        Tier 1: Regex Agent  (deterministic, ~0ms)
        Tier 2: AI Triage    (gpt-4o-mini,  ~300ms)
        Tier 3: Fallback     (suggestion chips)
        """
        start_time = time.time()

        # ---- Tier 1: Regex Agent (fast path) ----
        regex_start = time.time()
        parsed = AgentOrchestrator.run_regex_agent(command)
        regex_duration = time.time() - regex_start
        resolved_by = "regex"

        # ---- Tier 2: AI Triage (if regex returned unknown) ----
        ai_duration = 0.0
        if parsed.get("intent") == "unknown" and Config.OPENAI_API_KEY:
            ai_start = time.time()
            parsed = await AITriageAgent.classify(command, context)
            ai_duration = time.time() - ai_start
            resolved_by = parsed.get("_source", "ai_triage")

        # Build process log
        process_log = {
            "regex_agent": {
                "execution_time_sec": round(regex_duration, 4),
                "parsed_intent": parsed.get("intent", "unknown") if resolved_by == "regex" else "unknown",
            },
            "ai_triage_agent": {
                "execution_time_sec": round(ai_duration, 4),
                "invoked": ai_duration > 0,
                "source": resolved_by,
            },
            "resolved_by": resolved_by,
            "final_parsed": parsed,
        }

        # ---- Tier 2.5: Question Answering (QA Agent) ----
        if parsed.get("intent") == "question" and Config.OPENAI_API_KEY:
            qa_start = time.time()
            client = AITriageAgent.get_client()
            try:
                prompt_context = json.dumps(context, indent=2) if context else "No context available"
                qa_response = await client.chat.completions.create(
                    model=Config.AI_FAST_MODEL,
                    messages=[
                        {"role": "system", "content": f"You are Q4NT, an advanced AI assistant for a quantitative trading platform. Here is the deep state of the user's workspace right now:\n{prompt_context}\nIMPORTANT: You have full access to the exact sizes, colors, positions, CSS classes, and inner text content of every functional UI Panel (sidebars, dialogs) as well as the geometries and colors of every WebGL 3D Background Panel/Primitive. You must distinguish between functional 'uiPanels' and decorative 'backgroundPanels'/'background3DPrimitives'. Use this deep metadata to answer ANY question about style, size, color, or content. Answer the user's question with an extremely short and concise response based on this live data. Avoid long paragraphs. No more than 3 sentences."},
                        {"role": "user", "content": command}
                    ],
                    temperature=0.7,
                    max_tokens=250
                )
                answer = qa_response.choices[0].message.content
                qa_duration = time.time() - qa_start
                
                metrics = {
                    "total_execution_time_sec": round(time.time() - start_time, 4),
                    "success": True,
                    "complexity_score": len(command.split()),
                    "resolved_by": "qa_agent",
                }
                result = {
                    "status": "answered",
                    "actions": [{
                        "type": "chat_message",
                        "sender": "Q4NT",
                        "message": answer
                    }]
                }
                process_log["qa_agent"] = {
                    "execution_time_sec": round(qa_duration, 4)
                }
                CommandLogger.log_interaction(command, result, process_log, metrics)
                return result, process_log, metrics
            except Exception as e:
                print(f"[AgentOrchestrator] QA Agent error: {e}")
                parsed["intent"] = "unknown" # Fallback to tier 3

        # ---- Tier 3: Conversational Fallback ----
        if parsed.get("intent") == "unknown":
            metrics = {
                "total_execution_time_sec": round(time.time() - start_time, 4),
                "success": False,
                "complexity_score": len(command.split()),
                "resolved_by": resolved_by,
            }
            
            # Generate contextual suggestions
            cmd_lower = command.lower()
            suggestions = []
            if "color" in cmd_lower or "theme" in cmd_lower:
                suggestions = ["switch to dark mode", "make the ui blue", "change primary color to #ff0000"]
            elif "panel" in cmd_lower or "sidebar" in cmd_lower:
                suggestions = ["hide the left panel", "toggle bottom bar", "create a floating panel"]
            elif "view" in cmd_lower or "show" in cmd_lower:
                suggestions = ["open the chart view", "navigate to v3", "show the 3d objects"]
            else:
                suggestions = [
                    "switch to dark mode",
                    "hide the left panel",
                    "open the chart view",
                    "create a floating panel",
                ]

            fallback_response = {
                "status": "unrecognized",
                "message": f"I didn't understand how to '{command}'.",
                "suggestions": suggestions,
                "actions": [{
                    "type": "feedback",
                    "message": "Command not recognized. Try phrasing it differently or pick a suggestion:",
                }],
            }
            CommandLogger.log_interaction(command, fallback_response, process_log, metrics)
            return fallback_response, process_log, metrics

        # ---- Validate ----
        validator_start = time.time()
        is_valid, msg = AgentOrchestrator.run_validator_agent(parsed)
        validator_duration = time.time() - validator_start

        process_log["validator_agent"] = {
            "execution_time_sec": round(validator_duration, 4),
            "is_valid": is_valid,
            "validation_message": msg,
        }

        if not is_valid:
            metrics = {
                "total_execution_time_sec": round(time.time() - start_time, 4),
                "success": False,
                "resolved_by": resolved_by,
            }
            error_response = {
                "status": "validation_error",
                "message": msg,
                "actions": [{
                    "type": "feedback",
                    "message": msg,
                }],
            }
            CommandLogger.log_interaction(command, error_response, process_log, metrics)
            return error_response, process_log, metrics

        # ---- Build UI actions ----
        actions = []
        actions.append({
            "type": "log",
            "message": f"[{resolved_by.upper()}] Parsed and validated: '{command}'"
        })

        # Strip internal metadata before sending to frontend
        frontend_details = {k: v for k, v in parsed.items() if not k.startswith("_")}
        actions.append({
            "type": "ui_update",
            "details": frontend_details
        })

        metrics = {
            "total_execution_time_sec": round(time.time() - start_time, 4),
            "success": True,
            "complexity_score": len(command.split()),
            "actions_generated": len(actions),
            "resolved_by": resolved_by,
        }

        result = {
            "status": "success",
            "actions": actions
        }

        CommandLogger.log_interaction(command, result, process_log, metrics)
        return result, process_log, metrics

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

@app.get("/api/command/history")
async def get_command_history():
    """
    Returns the complete history of processed commands.
    """
    if not os.path.exists(CommandLogger.LOG_FILE):
        return []
    try:
        with open(CommandLogger.LOG_FILE, "r") as f:
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
