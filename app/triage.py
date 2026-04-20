import json
from .config import Config


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
