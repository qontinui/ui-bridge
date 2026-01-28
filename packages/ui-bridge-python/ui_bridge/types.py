"""
UI Bridge Type Definitions

Pydantic models for UI Bridge API responses and requests.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class ElementRect(BaseModel):
    """Element bounding rectangle."""

    x: float
    y: float
    width: float
    height: float
    top: float
    right: float
    bottom: float
    left: float


class ComputedStyles(BaseModel):
    """Relevant computed styles for automation."""

    display: str
    visibility: str
    opacity: str
    pointer_events: str = Field(alias="pointerEvents")

    model_config = {"populate_by_name": True}


class ElementState(BaseModel):
    """Current state of a UI element."""

    visible: bool
    enabled: bool
    focused: bool
    rect: ElementRect
    value: str | None = None
    checked: bool | None = None
    selected_options: list[str] | None = Field(None, alias="selectedOptions")
    text_content: str | None = Field(None, alias="textContent")
    inner_html: str | None = Field(None, alias="innerHTML")
    computed_styles: ComputedStyles | None = Field(None, alias="computedStyles")

    model_config = {"populate_by_name": True}


class ElementIdentifier(BaseModel):
    """Element identification using multiple strategies."""

    ui_id: str | None = Field(None, alias="uiId")
    test_id: str | None = Field(None, alias="testId")
    awas_id: str | None = Field(None, alias="awasId")
    html_id: str | None = Field(None, alias="htmlId")
    xpath: str
    selector: str

    model_config = {"populate_by_name": True}


class ElementType(str, Enum):
    """Types of UI elements."""

    BUTTON = "button"
    INPUT = "input"
    SELECT = "select"
    CHECKBOX = "checkbox"
    RADIO = "radio"
    LINK = "link"
    FORM = "form"
    TEXTAREA = "textarea"
    MENU = "menu"
    MENUITEM = "menuitem"
    TAB = "tab"
    DIALOG = "dialog"
    CUSTOM = "custom"


class StandardAction(str, Enum):
    """Standard actions available on elements."""

    CLICK = "click"
    DOUBLE_CLICK = "doubleClick"
    RIGHT_CLICK = "rightClick"
    TYPE = "type"
    CLEAR = "clear"
    SELECT = "select"
    FOCUS = "focus"
    BLUR = "blur"
    HOVER = "hover"
    SCROLL = "scroll"
    CHECK = "check"
    UNCHECK = "uncheck"
    TOGGLE = "toggle"


class WaitOptions(BaseModel):
    """Wait options for actions."""

    visible: bool | None = None
    enabled: bool | None = None
    focused: bool | None = None
    state: dict[str, Any] | None = None
    timeout: int | None = None
    interval: int | None = None


class ActionRequest(BaseModel):
    """Action request sent to the control API."""

    action: str
    params: dict[str, Any] | None = None
    wait_options: WaitOptions | None = Field(None, alias="waitOptions")
    request_id: str | None = Field(None, alias="requestId")
    capture_after: bool | None = Field(None, alias="captureAfter")

    model_config = {"populate_by_name": True}


class ActionErrorCode(str, Enum):
    """Machine-readable error codes for action failures."""

    ELEMENT_NOT_FOUND = "ELEMENT_NOT_FOUND"
    ELEMENT_NOT_VISIBLE = "ELEMENT_NOT_VISIBLE"
    ELEMENT_NOT_ENABLED = "ELEMENT_NOT_ENABLED"
    ELEMENT_NOT_INTERACTABLE = "ELEMENT_NOT_INTERACTABLE"
    ACTION_TIMEOUT = "ACTION_TIMEOUT"
    ACTION_REJECTED = "ACTION_REJECTED"
    STATE_NOT_REACHED = "STATE_NOT_REACHED"
    NETWORK_ERROR = "NETWORK_ERROR"
    PARSE_ERROR = "PARSE_ERROR"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    AMBIGUOUS_MATCH = "AMBIGUOUS_MATCH"
    LOW_CONFIDENCE = "LOW_CONFIDENCE"
    UNSUPPORTED_ACTION = "UNSUPPORTED_ACTION"
    UNKNOWN_ERROR = "UNKNOWN_ERROR"


class PartialMatch(BaseModel):
    """Partial element match found during search."""

    element_id: str = Field(alias="elementId")
    confidence: float
    reason: str
    type: str
    description: str | None = None

    model_config = {"populate_by_name": True}


class RecoveryAction(BaseModel):
    """Suggested recovery action."""

    suggestion: str
    command: str | None = None
    confidence: float
    retryable: bool

    model_config = {"populate_by_name": True}


class ActionFailureDetails(BaseModel):
    """Structured error details for action failures."""

    error_code: ActionErrorCode = Field(alias="errorCode")
    message: str
    element_id: str | None = Field(None, alias="elementId")
    selectors_tried: list[str] | None = Field(None, alias="selectorsTried")
    partial_matches: list[PartialMatch] | None = Field(None, alias="partialMatches")
    element_state: "ElementState | None" = Field(None, alias="elementState")
    screenshot_context: str | None = Field(None, alias="screenshotContext")
    suggested_actions: list[RecoveryAction] = Field(alias="suggestedActions")
    retry_recommended: bool = Field(alias="retryRecommended")
    context: dict[str, Any] | None = None
    duration_ms: float | None = Field(None, alias="durationMs")
    timeout_ms: float | None = Field(None, alias="timeoutMs")

    model_config = {"populate_by_name": True}

    def is_element_not_found(self) -> bool:
        """Check if the error is due to element not being found."""
        return self.error_code == ActionErrorCode.ELEMENT_NOT_FOUND

    def is_element_not_visible(self) -> bool:
        """Check if the error is due to element not being visible."""
        return self.error_code == ActionErrorCode.ELEMENT_NOT_VISIBLE

    def is_element_not_enabled(self) -> bool:
        """Check if the error is due to element being disabled."""
        return self.error_code == ActionErrorCode.ELEMENT_NOT_ENABLED

    def is_timeout(self) -> bool:
        """Check if the error is due to timeout."""
        return self.error_code == ActionErrorCode.ACTION_TIMEOUT

    def is_retryable(self) -> bool:
        """Check if the action should be retried."""
        return self.retry_recommended

    def get_best_suggestion(self) -> RecoveryAction | None:
        """Get the highest confidence recovery suggestion."""
        if not self.suggested_actions:
            return None
        return max(self.suggested_actions, key=lambda a: a.confidence)

    def get_suggestions(self) -> list[str]:
        """Get all recovery suggestions as strings."""
        return [a.suggestion for a in self.suggested_actions]


class ActionResponse(BaseModel):
    """Response from an action execution."""

    success: bool
    element_state: ElementState | None = Field(None, alias="elementState")
    result: Any | None = None
    error: str | None = None
    stack: str | None = None
    failure_details: ActionFailureDetails | None = Field(None, alias="failureDetails")
    duration_ms: float = Field(alias="durationMs")
    timestamp: int
    request_id: str | None = Field(None, alias="requestId")
    wait_duration_ms: float | None = Field(None, alias="waitDurationMs")

    model_config = {"populate_by_name": True}

    def is_element_not_found(self) -> bool:
        """Check if the failure is due to element not being found."""
        if self.failure_details:
            return self.failure_details.is_element_not_found()
        return self.error is not None and "not found" in self.error.lower()

    def is_timeout(self) -> bool:
        """Check if the failure is due to timeout."""
        if self.failure_details:
            return self.failure_details.is_timeout()
        return self.error is not None and "timeout" in self.error.lower()

    def get_suggestions(self) -> list[str]:
        """Get recovery suggestions if available."""
        if self.failure_details:
            return self.failure_details.get_suggestions()
        return []

    def get_error_code(self) -> ActionErrorCode | None:
        """Get the structured error code if available."""
        if self.failure_details:
            return self.failure_details.error_code
        return None


class ComponentActionRequest(BaseModel):
    """Component action request."""

    action: str
    params: dict[str, Any] | None = None
    request_id: str | None = Field(None, alias="requestId")

    model_config = {"populate_by_name": True}


class ComponentActionResponse(BaseModel):
    """Component action response."""

    success: bool
    result: Any | None = None
    error: str | None = None
    stack: str | None = None
    duration_ms: float = Field(alias="durationMs")
    timestamp: int
    request_id: str | None = Field(None, alias="requestId")

    model_config = {"populate_by_name": True}


class WorkflowRunStatus(str, Enum):
    """Workflow run status."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class WorkflowStepResult(BaseModel):
    """Workflow step result."""

    step_id: str = Field(alias="stepId")
    step_type: str = Field(alias="stepType")
    success: bool
    result: Any | None = None
    error: str | None = None
    duration_ms: float = Field(alias="durationMs")
    timestamp: int

    model_config = {"populate_by_name": True}


class WorkflowRunRequest(BaseModel):
    """Workflow run request."""

    params: dict[str, Any] | None = None
    request_id: str | None = Field(None, alias="requestId")
    start_step: str | None = Field(None, alias="startStep")
    stop_step: str | None = Field(None, alias="stopStep")
    step_timeout: int | None = Field(None, alias="stepTimeout")
    workflow_timeout: int | None = Field(None, alias="workflowTimeout")

    model_config = {"populate_by_name": True}


class WorkflowRunResponse(BaseModel):
    """Workflow run response."""

    workflow_id: str = Field(alias="workflowId")
    run_id: str = Field(alias="runId")
    status: WorkflowRunStatus
    steps: list[WorkflowStepResult]
    current_step: int | None = Field(None, alias="currentStep")
    total_steps: int = Field(alias="totalSteps")
    success: bool | None = None
    error: str | None = None
    started_at: int = Field(alias="startedAt")
    completed_at: int | None = Field(None, alias="completedAt")
    duration_ms: float | None = Field(None, alias="durationMs")

    model_config = {"populate_by_name": True}


class DiscoveredElement(BaseModel):
    """Element info for find/discovery."""

    id: str
    type: str
    label: str | None = None
    tag_name: str = Field(alias="tagName")
    role: str | None = None
    accessible_name: str | None = Field(None, alias="accessibleName")
    actions: list[str]
    state: ElementState
    registered: bool
    accessibility: "ElementAccessibility | None" = Field(
        None, description="Full accessibility information for the element"
    )

    model_config = {"populate_by_name": True}


class FindRequest(BaseModel):
    """Find request options.

    Used to find/discover controllable elements in the UI.
    """

    root: str | None = None
    interactive_only: bool | None = Field(None, alias="interactiveOnly")
    include_hidden: bool | None = Field(None, alias="includeHidden")
    limit: int | None = None
    types: list[str] | None = None
    selector: str | None = None

    model_config = {"populate_by_name": True}


class FindResponse(BaseModel):
    """Find response.

    Response from finding/discovering controllable elements.
    """

    elements: list[DiscoveredElement]
    total: int
    duration_ms: float = Field(alias="durationMs")
    timestamp: int

    model_config = {"populate_by_name": True}


# Deprecated aliases for backwards compatibility
DiscoveryRequest = FindRequest
"""Deprecated: Use FindRequest instead."""

DiscoveryResponse = FindResponse
"""Deprecated: Use FindResponse instead."""


class RegisteredElement(BaseModel):
    """Registered element info."""

    id: str
    type: str
    label: str | None = None
    actions: list[str]
    state: ElementState


class RegisteredComponent(BaseModel):
    """Registered component info."""

    id: str
    name: str
    actions: list[str]


class RegisteredWorkflow(BaseModel):
    """Registered workflow info."""

    id: str
    name: str
    step_count: int = Field(alias="stepCount")

    model_config = {"populate_by_name": True}


class ControlSnapshot(BaseModel):
    """Control snapshot - full state of controllable UI."""

    timestamp: int
    elements: list[RegisteredElement]
    components: list[RegisteredComponent]
    workflows: list[RegisteredWorkflow]
    active_runs: list[dict[str, Any]] = Field(default_factory=list, alias="activeRuns")

    model_config = {"populate_by_name": True}


# Simplified workflow types for client API
class WorkflowStep(BaseModel):
    """Workflow step definition."""

    id: str
    type: str
    target: str | None = None
    action: str | None = None
    params: dict[str, Any] | None = None
    wait_for: str | None = Field(None, alias="waitFor")
    condition: str | None = None
    timeout: int | None = None

    model_config = {"populate_by_name": True}


class Workflow(BaseModel):
    """Workflow definition."""

    id: str
    name: str
    description: str | None = None
    steps: list[WorkflowStep]
    variables: dict[str, Any] | None = None


class WorkflowResult(BaseModel):
    """Simplified workflow execution result."""

    workflow_id: str
    success: bool
    steps_completed: int
    total_steps: int
    duration_ms: float | None = None
    error: str | None = None
    failed_step: str | None = None


class RenderLogEntryType(str, Enum):
    """Render log entry types."""

    SNAPSHOT = "snapshot"
    CHANGE = "change"
    NAVIGATION = "navigation"
    INTERACTION = "interaction"
    ERROR = "error"
    CUSTOM = "custom"


class RenderLogEntry(BaseModel):
    """Render log entry."""

    id: str
    type: RenderLogEntryType
    timestamp: int
    data: Any
    metadata: dict[str, Any] | None = None


class PerformanceMetrics(BaseModel):
    """Performance metrics."""

    total_actions: int = Field(alias="totalActions")
    successful_actions: int = Field(alias="successfulActions")
    failed_actions: int = Field(alias="failedActions")
    success_rate: float = Field(alias="successRate")
    avg_duration_ms: float = Field(alias="avgDurationMs")
    min_duration_ms: float = Field(alias="minDurationMs")
    max_duration_ms: float = Field(alias="maxDurationMs")
    p95_duration_ms: float = Field(alias="p95DurationMs")
    actions_per_second: float = Field(alias="actionsPerSecond")
    errors_by_type: dict[str, int] = Field(alias="errorsByType")
    actions_by_type: dict[str, int] = Field(alias="actionsByType")

    model_config = {"populate_by_name": True}


class APIResponse(BaseModel):
    """API response wrapper."""

    success: bool
    data: Any | None = None
    error: str | None = None
    code: str | None = None
    timestamp: int


# ============================================================================
# State Management Types
# ============================================================================


class UIState(BaseModel):
    """UI State definition.

    Represents a distinct state in the UI (e.g., "LoginForm", "Dashboard", "Modal").
    States can be active or inactive, and can block other states from activating.
    """

    id: str
    name: str
    elements: list[str]
    blocking: bool | None = None
    blocks: list[str] | None = None
    group: str | None = None
    path_cost: float | None = Field(None, alias="pathCost")
    metadata: dict[str, Any] | None = None

    model_config = {"populate_by_name": True}


class UIStateGroup(BaseModel):
    """State group - states that activate/deactivate atomically.

    When a group is activated, all its states are activated together.
    When deactivated, all states are deactivated together.
    """

    id: str
    name: str
    states: list[str]


class UITransition(BaseModel):
    """State transition definition.

    Defines how to move from one set of states to another,
    including any actions to execute during the transition.
    """

    id: str
    name: str
    from_states: list[str] = Field(alias="fromStates")
    activate_states: list[str] = Field(alias="activateStates")
    exit_states: list[str] = Field(alias="exitStates")
    activate_groups: list[str] | None = Field(None, alias="activateGroups")
    exit_groups: list[str] | None = Field(None, alias="exitGroups")
    path_cost: float | None = Field(None, alias="pathCost")
    stays_visible: bool | None = Field(None, alias="staysVisible")

    model_config = {"populate_by_name": True}


class PathResult(BaseModel):
    """Path result from pathfinding.

    Returned when searching for a path to target states.
    """

    found: bool
    transitions: list[str]
    total_cost: float = Field(alias="totalCost")
    target_states: list[str] = Field(alias="targetStates")
    estimated_steps: int = Field(alias="estimatedSteps")

    model_config = {"populate_by_name": True}


class TransitionResult(BaseModel):
    """Transition execution result."""

    success: bool
    activated_states: list[str] = Field(alias="activatedStates")
    deactivated_states: list[str] = Field(alias="deactivatedStates")
    error: str | None = None
    failed_phase: str | None = Field(None, alias="failedPhase")
    duration_ms: float = Field(alias="durationMs")

    model_config = {"populate_by_name": True}


class NavigationResult(BaseModel):
    """Navigation result.

    Returned after navigating to target states via pathfinding.
    """

    success: bool
    path: PathResult
    executed_transitions: list[str] = Field(alias="executedTransitions")
    final_active_states: list[str] = Field(alias="finalActiveStates")
    error: str | None = None
    duration_ms: float = Field(alias="durationMs")

    model_config = {"populate_by_name": True}


class StateSnapshot(BaseModel):
    """State manager snapshot."""

    timestamp: int
    active_states: list[str] = Field(alias="activeStates")
    states: list[UIState]
    groups: list[UIStateGroup]
    transitions: list[UITransition]

    model_config = {"populate_by_name": True}


class ComponentState(BaseModel):
    """Component state response.

    Contains the current state and computed property values of a component.
    """

    state: dict[str, Any]
    computed: dict[str, Any]
    timestamp: int


# ============================================================================
# Accessibility Types
# ============================================================================


class WCAGLevel(str, Enum):
    """WCAG conformance level."""

    A = "A"
    AA = "AA"
    AAA = "AAA"


class AccessibilitySeverity(str, Enum):
    """Severity of accessibility issues."""

    CRITICAL = "critical"
    SERIOUS = "serious"
    MODERATE = "moderate"
    MINOR = "minor"


class ElementAccessibility(BaseModel):
    """Accessibility information for a UI element.

    Captures ARIA attributes and accessibility-relevant properties
    following the WAI-ARIA specification.
    """

    role: str = Field(description="The element's computed role (explicit or implicit)")
    accessible_name: str | None = Field(
        None,
        alias="accessibleName",
        description="Computed accessible name following ARIA name computation",
    )
    accessible_description: str | None = Field(
        None,
        alias="accessibleDescription",
        description="Computed accessible description",
    )
    aria_label: str | None = Field(
        None, alias="ariaLabel", description="Value of aria-label attribute"
    )
    aria_labelled_by: str | None = Field(
        None, alias="ariaLabelledBy", description="Value of aria-labelledby attribute"
    )
    aria_described_by: str | None = Field(
        None, alias="ariaDescribedBy", description="Value of aria-describedby attribute"
    )
    aria_expanded: bool | None = Field(
        None,
        alias="ariaExpanded",
        description="Whether element is expanded (for expandable elements)",
    )
    aria_selected: bool | None = Field(
        None,
        alias="ariaSelected",
        description="Whether element is selected (for selectable elements)",
    )
    aria_checked: bool | str | None = Field(
        None,
        alias="ariaChecked",
        description="Checked state (for checkboxes, can be true/false/'mixed')",
    )
    aria_hidden: bool | None = Field(
        None,
        alias="ariaHidden",
        description="Whether element is hidden from accessibility tree",
    )
    aria_disabled: bool | None = Field(
        None,
        alias="ariaDisabled",
        description="Whether element is disabled via aria-disabled",
    )
    aria_required: bool | None = Field(
        None,
        alias="ariaRequired",
        description="Whether element is required (for form inputs)",
    )
    aria_live: str | None = Field(
        None, alias="ariaLive", description="Current aria-live value for live regions"
    )
    tab_index: int = Field(alias="tabIndex", description="Tab index value")
    is_in_tab_order: bool = Field(
        alias="isInTabOrder",
        description="Whether element is in the tab order",
    )
    is_keyboard_accessible: bool = Field(
        alias="isKeyboardAccessible",
        description="Whether element can receive keyboard focus",
    )
    implicit_role: str | None = Field(
        None,
        alias="implicitRole",
        description="The implicit role based on element type",
    )
    has_explicit_role: bool = Field(
        alias="hasExplicitRole",
        description="Whether element has an explicit role attribute",
    )

    model_config = {"populate_by_name": True}


class AccessibilityIssue(BaseModel):
    """An accessibility issue found during validation."""

    id: str = Field(description="Unique identifier for this issue instance")
    wcag_criterion: str = Field(
        alias="wcagCriterion",
        description="The WCAG success criterion this issue relates to",
    )
    severity: AccessibilitySeverity = Field(description="How severe this issue is")
    level: WCAGLevel = Field(
        description="WCAG conformance level this criterion belongs to"
    )
    message: str = Field(description="Human-readable description of the issue")
    element_id: str = Field(alias="elementId", description="ID of the element with the issue")
    element_selector: str | None = Field(
        None, alias="elementSelector", description="Selector to find the element"
    )
    suggestion: str = Field(description="Suggested fix for the issue")
    rule_id: str = Field(alias="ruleId", description="The rule ID that detected this issue")

    model_config = {"populate_by_name": True}


class AccessibilityReport(BaseModel):
    """Accessibility validation report."""

    timestamp: int = Field(description="When the validation was performed")
    url: str = Field(description="URL of the page that was validated")
    elements_scanned: int = Field(
        alias="elementsScanned", description="Number of elements that were scanned"
    )
    issues: list[AccessibilityIssue] = Field(
        default_factory=list, description="All issues found during validation"
    )
    passed_count: int = Field(alias="passedCount", description="Number of checks that passed")
    failed_count: int = Field(alias="failedCount", description="Number of checks that failed")
    meets_wcag_a: bool = Field(
        alias="meetsWCAG_A", description="Whether the page meets WCAG 2.1 Level A"
    )
    meets_wcag_aa: bool = Field(
        alias="meetsWCAG_AA", description="Whether the page meets WCAG 2.1 Level AA"
    )
    summary: str = Field(description="Human-readable summary of the validation")
    duration_ms: float = Field(
        alias="durationMs", description="Duration of the validation in milliseconds"
    )

    model_config = {"populate_by_name": True}


# Rebuild models with forward references
DiscoveredElement.model_rebuild()
ActionFailureDetails.model_rebuild()
