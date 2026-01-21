"""
UI Bridge Python Client

A Python client library for controlling UI elements via UI Bridge.
"""

from .client import UIBridgeClient
from .types import (
    ElementState,
    ElementIdentifier,
    ControlSnapshot,
    DiscoveryResponse,
    DiscoveredElement,
    ActionRequest,
    ActionResponse,
    ComponentActionRequest,
    ComponentActionResponse,
    WorkflowRunRequest,
    WorkflowRunResponse,
    WorkflowStepResult,
    RenderLogEntry,
    PerformanceMetrics,
)

__version__ = "0.1.0"
__all__ = [
    "UIBridgeClient",
    "ElementState",
    "ElementIdentifier",
    "ControlSnapshot",
    "DiscoveryResponse",
    "DiscoveredElement",
    "ActionRequest",
    "ActionResponse",
    "ComponentActionRequest",
    "ComponentActionResponse",
    "WorkflowRunRequest",
    "WorkflowRunResponse",
    "WorkflowStepResult",
    "RenderLogEntry",
    "PerformanceMetrics",
]
