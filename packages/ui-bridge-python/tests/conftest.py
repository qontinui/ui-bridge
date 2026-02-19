"""Test configuration.

Stub out missing modules that are imported by ui_bridge.__init__
but may not exist yet during development.
"""

import importlib
import sys
from unittest.mock import MagicMock


def _ensure_module(name: str) -> None:
    """Try to import the real module; register a stub only if it truly does not exist."""
    if name not in sys.modules:
        try:
            importlib.import_module(name)
        except (ImportError, ModuleNotFoundError):
            sys.modules[name] = MagicMock()


# Stub out modules that __init__.py imports but may not exist yet.
# This lets tests import from ui_bridge.types and ui_bridge.client
# without needing every submodule to be fully implemented.
_ensure_module("ui_bridge.states")
_ensure_module("ui_bridge.ai_types")
_ensure_module("ui_bridge.recovery_types")
