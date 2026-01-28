"""
UI Bridge Python Client

A Python client library for controlling UI elements via UI Bridge.
"""

from .client import UIBridgeClient
from .types import (
    AccessibilityIssue,
    AccessibilityReport,
    AccessibilitySeverity,
    ActionErrorCode,
    ActionFailureDetails,
    ActionRequest,
    ActionResponse,
    ComponentActionRequest,
    ComponentActionResponse,
    ControlSnapshot,
    DiscoveredElement,
    DiscoveryRequest,  # Deprecated, use FindRequest
    DiscoveryResponse,  # Deprecated, use FindResponse
    ElementAccessibility,
    ElementIdentifier,
    ElementState,
    FindRequest,
    FindResponse,
    NavigationResult,
    PartialMatch,
    PathResult,
    PerformanceMetrics,
    RecoveryAction,
    RenderLogEntry,
    StateSnapshot,
    TransitionResult,
    UIState,
    UIStateGroup,
    UITransition,
    WCAGLevel,
    WorkflowRunRequest,
    WorkflowRunResponse,
    WorkflowStepResult,
)

# AI-native client and types
from .ai import AIClient

# State machine integration
from .states import (
    StateManager,
    DiscoveredState,
    DiscoveredTransition,
    # Navigation assistance types
    NavigationHint,
    BreadcrumbEntry,
    NavigationLoop,
    AvailableAction,
    ReachableState,
    CommonDestination,
    NavigationIssue,
    NavigationContext,
    NavigationProgressEvent,
    NavigationProgress,
    BreadcrumbTracker,
)
from .ai_types import (
    ActionStepResult,
    AIDiscoveredElement,
    AIElementRegistrationOptions,
    AIErrorContext,
    AIFindResponse,
    AssertionRequest,
    AssertionResult,
    AssertionType,
    BatchAssertionRequest,
    BatchAssertionResult,
    DiffChanges,
    ElementChange,
    ElementModification,
    EmbeddingProviderInfo,
    ErrorPageContext,
    FormAnalysis,
    FormFieldAnalysis,
    FormFieldState,
    FormState,
    Intent,
    IntentExecutionResult,
    IntentMatch,
    IntentParameter,
    IntentSearchResponse,
    ModalState,
    NearestMatchInfo,
    NLActionRequest,
    NLActionResponse,
    PageChanges,
    PageContext,
    ParsedAction,
    PartialMatchInfo,
    RecoverySuggestion,
    RecoverySuggestionInfo,
    SearchCriteria,
    SearchResponse,
    SearchResult,
    SearchResultsInfo,
    SearchScores,
    SemanticDiff,
    SemanticSearchCriteria,
    SemanticSearchResponse,
    SemanticSearchResult,
    SemanticSnapshot,
    StructuredFailureInfo,
)

# Recovery types
from .recovery_types import (
    DEFAULT_RECOVERY_CONFIG,
    ERROR_CODE_STRATEGIES,
    ExecuteWithRecoveryResult,
    RecoveryContext,
    RecoveryExecutorConfig,
    RecoveryExecutorResult,
    RecoveryStrategyResult,
    StrategyStatus,
)

# Logging
from .logging import (
    UIBridgeLogger,
    LogEntry,
    LogLevel,
    EventType,
    TraceContext,
    get_default_logger,
    set_default_logger,
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
    # Structured failure types
    "ActionErrorCode",
    "ActionFailureDetails",
    "PartialMatch",
    "RecoveryAction",
    "StructuredFailureInfo",
    "PartialMatchInfo",
    "RecoverySuggestionInfo",
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
    # Accessibility types
    "AccessibilityIssue",
    "AccessibilityReport",
    "AccessibilitySeverity",
    "ElementAccessibility",
    "WCAGLevel",
    # AI-native types
    "AIDiscoveredElement",
    "AIElementRegistrationOptions",
    "AIErrorContext",
    "AIFindResponse",
    "AssertionRequest",
    "AssertionResult",
    "AssertionType",
    "BatchAssertionRequest",
    "BatchAssertionResult",
    "DiffChanges",
    "ElementChange",
    "ElementModification",
    "ErrorPageContext",
    "FormAnalysis",
    "FormFieldAnalysis",
    "FormFieldState",
    "FormState",
    "ModalState",
    "NearestMatchInfo",
    "NLActionRequest",
    "NLActionResponse",
    "PageChanges",
    "PageContext",
    "ParsedAction",
    "RecoverySuggestion",
    "SearchCriteria",
    "SearchResponse",
    "SearchResult",
    "SearchResultsInfo",
    "SearchScores",
    "SemanticDiff",
    "SemanticSearchCriteria",
    "SemanticSearchResponse",
    "SemanticSearchResult",
    "SemanticSnapshot",
    # Embedding types
    "EmbeddingProviderInfo",
    # Intent types
    "ActionStepResult",
    "Intent",
    "IntentExecutionResult",
    "IntentMatch",
    "IntentParameter",
    "IntentSearchResponse",
    # State machine integration
    "StateManager",
    "DiscoveredState",
    "DiscoveredTransition",
    # Navigation assistance types
    "NavigationHint",
    "BreadcrumbEntry",
    "NavigationLoop",
    "AvailableAction",
    "ReachableState",
    "CommonDestination",
    "NavigationIssue",
    "NavigationContext",
    "NavigationProgressEvent",
    "NavigationProgress",
    "BreadcrumbTracker",
    # Recovery types
    "DEFAULT_RECOVERY_CONFIG",
    "ERROR_CODE_STRATEGIES",
    "ExecuteWithRecoveryResult",
    "RecoveryContext",
    "RecoveryExecutorConfig",
    "RecoveryExecutorResult",
    "RecoveryStrategyResult",
    "StrategyStatus",
    # Logging
    "UIBridgeLogger",
    "LogEntry",
    "LogLevel",
    "EventType",
    "TraceContext",
    "get_default_logger",
    "set_default_logger",
]
