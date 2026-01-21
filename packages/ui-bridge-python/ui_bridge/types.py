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


class ActionResponse(BaseModel):
    """Response from an action execution."""

    success: bool
    element_state: ElementState | None = Field(None, alias="elementState")
    result: Any | None = None
    error: str | None = None
    stack: str | None = None
    duration_ms: float = Field(alias="durationMs")
    timestamp: int
    request_id: str | None = Field(None, alias="requestId")
    wait_duration_ms: float | None = Field(None, alias="waitDurationMs")

    model_config = {"populate_by_name": True}


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
    """Element info for discovery."""

    id: str
    type: str
    label: str | None = None
    tag_name: str = Field(alias="tagName")
    role: str | None = None
    accessible_name: str | None = Field(None, alias="accessibleName")
    actions: list[str]
    state: ElementState
    registered: bool

    model_config = {"populate_by_name": True}


class DiscoveryRequest(BaseModel):
    """Discovery request options."""

    root: str | None = None
    interactive_only: bool | None = Field(None, alias="interactiveOnly")
    include_hidden: bool | None = Field(None, alias="includeHidden")
    limit: int | None = None
    types: list[str] | None = None
    selector: str | None = None

    model_config = {"populate_by_name": True}


class DiscoveryResponse(BaseModel):
    """Discovery response."""

    elements: list[DiscoveredElement]
    total: int
    duration_ms: float = Field(alias="durationMs")
    timestamp: int

    model_config = {"populate_by_name": True}


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
