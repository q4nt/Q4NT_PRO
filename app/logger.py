import os
import json
from datetime import datetime


class CommandLogger:
    """Utility for persisting UI command history to disk"""
    LOG_FILE = "command_log.json"
    MAX_HISTORY_SIZE = 500

    @staticmethod
    def _build_ui_snapshot(context: dict) -> dict:
        """
        Distills the raw deep-context payload into a structured UI snapshot
        suitable for before/after diffing in the command log.
        """
        if not context or not isinstance(context, dict):
            return {"snapshot_available": False}

        panels = context.get("uiPanels", [])
        panel_summaries = []
        for p in panels:
            panel_summaries.append({
                "id": p.get("id", "N/A"),
                "label": p.get("label", "Unknown Panel"),
                "type": p.get("type", "unknown"),
                "classes": p.get("classes", ""),
                "state_flags": p.get("stateFlags", []),
                "visible": p.get("visible", False),
                "size": p.get("size", {}),
                "position": p.get("position", {}),
                "style": p.get("style", {}),
                "interactive_elements": p.get("interactiveElements", {}),
                "content_preview": (p.get("textContent", "") or "")[:300],
            })

        return {
            "snapshot_available": True,
            "captured_at": context.get("capturedAt", datetime.now().isoformat()),
            "viewport": context.get("viewport", {}),
            "theme": context.get("theme", "unknown"),
            "current_layout": context.get("currentLayout", "unknown"),
            "active_view_index": context.get("activeViewIndex"),
            "active_tabs": context.get("activeTabs", []),
            "all_tabs": context.get("allTabs", []),
            "channel_tabs": context.get("channelTabs", []),
            "css_variables": context.get("cssVariables", {}),
            "feature_states": context.get("featureStates", {}),
            "panel_count": {
                "total_ui": context.get("summary", {}).get("totalUIPanels", 0),
                "visible_ui": context.get("summary", {}).get("visibleUIPanels", 0),
                "background_panels": context.get("summary", {}).get("totalBgPanels", 0),
                "background_3d_primitives": context.get("summary", {}).get("totalBgPrimitives", 0),
            },
            "panels": panel_summaries,
            "background_objects_visible": any(
                obj.get("visible", False)
                for obj in context.get("background3DPrimitives", [])
            ),
        }

    @staticmethod
    def log_interaction(command: str, response: dict, process: dict = None,
                        metrics: dict = None, ui_context_before: dict = None):
        """Appends a new command interaction to the log file with full UI context"""
        before_snapshot = CommandLogger._build_ui_snapshot(ui_context_before)

        entry = {
            "timestamp": datetime.now().isoformat(),
            "command": command,
            "ui_context_before": before_snapshot,
            "ui_context_after": None,
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

    @staticmethod
    def update_after_context(after_context: dict):
        """
        Updates the most recent log entry with the post-action UI snapshot.
        Called by the frontend after the UI update has been applied.
        """
        if not os.path.exists(CommandLogger.LOG_FILE):
            return False
        try:
            with open(CommandLogger.LOG_FILE, "r") as f:
                history = json.load(f)
            if not history or not isinstance(history, list):
                return False

            after_snapshot = CommandLogger._build_ui_snapshot(after_context)
            history[-1]["ui_context_after"] = after_snapshot

            with open(CommandLogger.LOG_FILE, "w") as f:
                json.dump(history, f, indent=4)
            return True
        except Exception as e:
            print(f"[CommandLogger] Error updating after-context: {e}")
            return False
