"""Test configuration.

Stub out missing modules that are imported by ui_bridge.__init__
but may not exist yet during development.
"""

import sys
from unittest.mock import MagicMock


def _ensure_module(name: str) -> None:
    """Register a stub module if it doesn't exist."""
    if name not in sys.modules:
        sys.modules[name] = MagicMock()


# Stub out modules that __init__.py imports but may not exist yet.
# This lets tests import from ui_bridge.types and ui_bridge.client
# without needing every submodule to be fully implemented.
_ensure_module("ui_bridge.states")
_ensure_module("ui_bridge.ai_types")
_ensure_module("ui_bridge.recovery_types")
