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

# AI-native client and types
from .ai import AIClient
from .ai_types import (
    AIDiscoveredElement,
    AIErrorContext,
    AssertionRequest,
    AssertionResult,
    AssertionType,
    BatchAssertionRequest,
    BatchAssertionResult,
    DiffChanges,
    ElementChange,
    ElementModification,
    ErrorPageContext,
    FormFieldState,
    FormState,
    ModalState,
    NearestMatchInfo,
    NLActionRequest,
    NLActionResponse,
    PageChanges,
    PageContext,
    RecoverySuggestion,
    SearchCriteria,
    SearchResponse,
    SearchResult,
    SearchResultsInfo,
    SearchScores,
    SemanticDiff,
    SemanticSnapshot,
)

__version__ = "0.1.0"
__all__ = [
    # Client
    "UIBridgeClient",
    # AI-native client
    "AIClient",
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
    # AI-native types
    "AIDiscoveredElement",
    "AIErrorContext",
    "AssertionRequest",
    "AssertionResult",
    "AssertionType",
    "BatchAssertionRequest",
    "BatchAssertionResult",
    "DiffChanges",
    "ElementChange",
    "ElementModification",
    "ErrorPageContext",
    "FormFieldState",
    "FormState",
    "ModalState",
    "NearestMatchInfo",
    "NLActionRequest",
    "NLActionResponse",
    "PageChanges",
    "PageContext",
    "RecoverySuggestion",
    "SearchCriteria",
    "SearchResponse",
    "SearchResult",
    "SearchResultsInfo",
    "SearchScores",
    "SemanticDiff",
    "SemanticSnapshot",
]
