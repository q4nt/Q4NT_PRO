"""
Q4NT PRO - Test Suite: AgentOrchestrator
Tests the 3-tier command processing pipeline:
  Tier 1:  Regex Agent (deterministic intent parsing)
  Tier 1.5: Validator Agent (input sanitization)
  Tier 2:  AI Triage (mocked - requires OpenAI key)

Run:  pytest tests/ -v
"""

import pytest
import asyncio
import sys
import os

# Ensure the project root is on the path so `app` imports work
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.orchestrator import AgentOrchestrator


# ===========================================================================
# Tier 1: Regex Agent Tests
# ===========================================================================

class TestRegexAgent:
    """Tests for the deterministic regex-based command parser."""

    # ---- Theme Commands ----
    @pytest.mark.parametrize("command, expected_value", [
        ("switch to dark mode", "dark"),
        ("go light", "light"),
        ("enable blue theme", "blue"),
        ("change theme to green", "green"),
        ("dark mode", "dark"),
        ("make it dark", "dark"),
        ("set theme to light", "light"),
        ("activate dark mode", "dark"),
    ])
    def test_theme_switching(self, command, expected_value):
        result = AgentOrchestrator.run_regex_agent(command)
        assert result["intent"] == "change_theme"
        assert result["value"] == expected_value

    # ---- Theme Color Commands ----
    @pytest.mark.parametrize("command, expected_value", [
        ("change theme color to red", "red"),
        ("set accent color to #ff0000", "#ff0000"),
        ("make primary color blue", "blue"),
    ])
    def test_theme_color(self, command, expected_value):
        result = AgentOrchestrator.run_regex_agent(command)
        assert result["intent"] == "change_theme_color"
        assert result["value"] == expected_value

    # ---- Font Size Commands ----
    @pytest.mark.parametrize("command, expected_value", [
        ("change font size to 16px", "16px"),
        ("set text size to 20", "20px"),
        ("make font size to 14 rem", "14rem"),
    ])
    def test_font_size(self, command, expected_value):
        result = AgentOrchestrator.run_regex_agent(command)
        assert result["intent"] == "change_font_size"
        assert result["value"] == expected_value

    # ---- Panel Hide/Show Commands ----
    @pytest.mark.parametrize("command, expected_intent, expected_value", [
        ("hide the left panel", "remove_panel", "left"),
        ("remove right sidebar", "remove_panel", "right"),
        ("close the bottom panel", "remove_panel", "bottom"),
        ("show the left panel", "restore_panel", "left"),
        ("restore right sidebar", "restore_panel", "right"),
        ("bring back top panel", "restore_panel", "top"),
        ("toggle left panel", "toggle_panel", "left"),
        ("collapse the right bar", "remove_panel", "right"),
        ("dismiss bottom panel", "remove_panel", "bottom"),
    ])
    def test_panel_commands(self, command, expected_intent, expected_value):
        result = AgentOrchestrator.run_regex_agent(command)
        assert result["intent"] == expected_intent
        assert result["value"] == expected_value

    # ---- View Navigation Commands ----
    @pytest.mark.parametrize("command, expected_value", [
        ("open the chart view", "chart"),
        ("show map view", "map"),
        ("go to globe", "globe"),
        ("navigate to dashboard", "dashboard"),
        ("switch to 3d view", "3d"),
    ])
    def test_view_navigation(self, command, expected_value):
        result = AgentOrchestrator.run_regex_agent(command)
        assert result["intent"] == "navigate_view"
        assert result["value"] == expected_value

    # ---- Create Panel ----
    def test_create_floating_panel(self):
        result = AgentOrchestrator.run_regex_agent("open a new panel")
        assert result["intent"] == "create_panel"
        assert result["value"] == "floating"

    # ---- Opacity ----
    def test_opacity(self):
        result = AgentOrchestrator.run_regex_agent("set opacity to 75%")
        assert result["intent"] == "change_opacity"
        assert result["value"] == 75

    # ---- 3D Objects ----
    @pytest.mark.parametrize("command, expected_value", [
        ("hide the 3d objects", "hide"),
        ("show the objects", "show"),
    ])
    def test_3d_objects(self, command, expected_value):
        result = AgentOrchestrator.run_regex_agent(command)
        assert result["intent"] == "toggle_3d_objects"
        assert result["value"] == expected_value

    # ---- Z-Index ----
    def test_zindex(self):
        result = AgentOrchestrator.run_regex_agent("set panels z-index to 100")
        assert result["intent"] == "set_zindex"
        assert result["value"] == 100

    # ---- Unknown Commands ----
    @pytest.mark.parametrize("command", [
        "hello how are you",
        "play some music",
        "what is the weather",
        "asdfghjkl",
    ])
    def test_unknown_commands(self, command):
        result = AgentOrchestrator.run_regex_agent(command)
        assert result["intent"] == "unknown"


# ===========================================================================
# Tier 1.5: Validator Agent Tests
# ===========================================================================

class TestValidatorAgent:
    """Tests for input validation and sanitization."""

    # ---- Valid Inputs ----
    def test_valid_theme(self):
        is_valid, msg = AgentOrchestrator.run_validator_agent({"intent": "change_theme", "value": "dark"})
        assert is_valid is True

    def test_valid_color_hex(self):
        is_valid, msg = AgentOrchestrator.run_validator_agent({"intent": "change_theme_color", "value": "#ff0000"})
        assert is_valid is True

    def test_valid_color_name(self):
        is_valid, msg = AgentOrchestrator.run_validator_agent({"intent": "change_theme_color", "value": "red"})
        assert is_valid is True

    def test_valid_font_size(self):
        is_valid, msg = AgentOrchestrator.run_validator_agent({"intent": "change_font_size", "value": "16px"})
        assert is_valid is True

    def test_valid_opacity(self):
        is_valid, msg = AgentOrchestrator.run_validator_agent({"intent": "change_opacity", "value": "50"})
        assert is_valid is True

    # ---- Invalid Inputs ----
    def test_invalid_theme(self):
        is_valid, msg = AgentOrchestrator.run_validator_agent({"intent": "change_theme", "value": "purple"})
        assert is_valid is False
        assert "Unknown theme" in msg

    def test_invalid_color_css_injection(self):
        is_valid, msg = AgentOrchestrator.run_validator_agent({"intent": "change_theme_color", "value": "red;background:url(evil)"})
        assert is_valid is False

    def test_invalid_font_size_too_small(self):
        is_valid, msg = AgentOrchestrator.run_validator_agent({"intent": "change_font_size", "value": "2px"})
        assert is_valid is False
        assert "outside the safe range" in msg

    def test_invalid_font_size_too_large(self):
        is_valid, msg = AgentOrchestrator.run_validator_agent({"intent": "change_font_size", "value": "200px"})
        assert is_valid is False

    def test_invalid_opacity_too_high(self):
        is_valid, msg = AgentOrchestrator.run_validator_agent({"intent": "change_opacity", "value": "150"})
        assert is_valid is False

    def test_invalid_opacity_negative(self):
        is_valid, msg = AgentOrchestrator.run_validator_agent({"intent": "change_opacity", "value": "-10"})
        assert is_valid is False

    def test_invalid_panel(self):
        is_valid, msg = AgentOrchestrator.run_validator_agent({"intent": "remove_panel", "value": "center"})
        assert is_valid is False

    def test_unknown_always_valid(self):
        is_valid, msg = AgentOrchestrator.run_validator_agent({"intent": "unknown", "raw": "nonsense"})
        assert is_valid is True


# ===========================================================================
# Tier 2: Full Pipeline Tests (async)
# ===========================================================================

class TestOrchestorPipeline:
    """Integration tests for the full execute() pipeline (without AI)."""

    def test_regex_resolved_command(self):
        """Commands resolved by regex should not invoke AI and should succeed."""
        result, process, metrics = asyncio.run(AgentOrchestrator.execute("switch to dark mode"))
        assert result["status"] == "success"
        assert metrics["resolved_by"] == "regex"
        assert metrics["success"] is True
        assert any(a["type"] == "ui_update" for a in result["actions"])

    def test_regex_resolved_details(self):
        """Verify the ui_update action contains the correct parsed intent."""
        result, process, metrics = asyncio.run(AgentOrchestrator.execute("hide the left panel"))
        ui_action = next(a for a in result["actions"] if a["type"] == "ui_update")
        assert ui_action["details"]["intent"] == "remove_panel"
        assert ui_action["details"]["value"] == "left"

    def test_unknown_command_fallback(self):
        """Unknown commands should trigger fallback with suggestions."""
        result, process, metrics = asyncio.run(AgentOrchestrator.execute("asdfghjkl nonsense"))
        assert result["status"] == "unrecognized"
        assert "suggestions" in result
        assert len(result["suggestions"]) > 0
        assert metrics["success"] is False

    def test_validation_failure(self):
        """Commands with invalid parameters should be caught by the validator."""
        result, process, metrics = asyncio.run(AgentOrchestrator.execute("set opacity to 999"))
        assert result["status"] == "validation_error"
        assert metrics["success"] is False

    def test_metrics_timing(self):
        """Verify that timing metrics are populated."""
        result, process, metrics = asyncio.run(AgentOrchestrator.execute("switch to dark mode"))
        assert "total_execution_time_sec" in metrics
        assert metrics["total_execution_time_sec"] >= 0
        assert "complexity_score" in metrics

    def test_process_log_structure(self):
        """Verify the process log contains expected agent entries."""
        result, process, metrics = asyncio.run(AgentOrchestrator.execute("toggle left panel"))
        assert "regex_agent" in process
        assert "execution_time_sec" in process["regex_agent"]
        assert "resolved_by" in process
