"""
UI Bridge Python Client

A Python client library for controlling UI elements via UI Bridge.
"""

from .client import UIBridgeClient
from .types import (
    ActionRequest,
    ActionResponse,
    ComponentActionRequest,
    ComponentActionResponse,
    ControlSnapshot,
    DiscoveredElement,
    DiscoveryRequest,  # Deprecated, use FindRequest
    DiscoveryResponse,  # Deprecated, use FindResponse
    ElementIdentifier,
    ElementState,
    FindRequest,
    FindResponse,
    NavigationResult,
    PathResult,
    PerformanceMetrics,
    RenderLogEntry,
    StateSnapshot,
    TransitionResult,
    UIState,
    UIStateGroup,
    UITransition,
    WorkflowRunRequest,
    WorkflowRunResponse,
    WorkflowStepResult,
)

__version__ = "0.1.0"
__all__ = [
    # Client
    "UIBridgeClient",
    # Element types
    "ElementState",
    "ElementIdentifier",
    "DiscoveredElement",
    # Control types
    "ControlSnapshot",
    "FindRequest",
    "FindResponse",
    "DiscoveryRequest",  # Deprecated
    "DiscoveryResponse",  # Deprecated
    # Action types
    "ActionRequest",
    "ActionResponse",
    "ComponentActionRequest",
    "ComponentActionResponse",
    # Workflow types
    "WorkflowRunRequest",
    "WorkflowRunResponse",
    "WorkflowStepResult",
    # State management types
    "UIState",
    "UIStateGroup",
    "UITransition",
    "PathResult",
    "TransitionResult",
    "NavigationResult",
    "StateSnapshot",
    # Debug types
    "RenderLogEntry",
    "PerformanceMetrics",
]
