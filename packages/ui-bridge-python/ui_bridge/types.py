"""
UI Bridge Type Definitions

Pydantic models for UI Bridge API responses and requests.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import AliasChoices, BaseModel, Field, field_validator

from .diagnostics import UiBridgeErrorCode


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


class NormalizedRect(BaseModel):
    """Resolution-independent bounding rect normalized to 0-1 viewport coordinates."""

    x: float = Field(description="Normalized left edge (0-1)")
    y: float = Field(description="Normalized top edge (0-1)")
    width: float = Field(description="Normalized width (0-1)")
    height: float = Field(description="Normalized height (0-1)")


class ComputedStyles(BaseModel):
    """Relevant computed styles for automation and visual debugging.

    The first four fields predate the style-surface expansion and are emitted by
    every known build, so they stay required. Everything below them is optional:
    an older server sends the four-key object and must still validate.
    """

    # Visibility & interaction
    display: str
    visibility: str
    opacity: str
    pointer_events: str = Field(alias="pointerEvents")
    cursor: str | None = None
    # Color & theming
    color: str | None = None
    background_color: str | None = Field(None, alias="backgroundColor")
    color_scheme: str | None = Field(None, alias="colorScheme")
    # Typography
    font_size: str | None = Field(None, alias="fontSize")
    font_weight: str | None = Field(None, alias="fontWeight")
    line_height: str | None = Field(None, alias="lineHeight")
    # Overflow & clipping
    overflow: str | None = None
    text_overflow: str | None = Field(None, alias="textOverflow")
    white_space: str | None = Field(None, alias="whiteSpace")
    # Layout & layering
    position: str | None = None
    z_index: str | None = Field(None, alias="zIndex")
    # Spacing
    padding: str | None = None
    margin: str | None = None
    # Borders
    border_color: str | None = Field(None, alias="borderColor")
    border_width: str | None = Field(None, alias="borderWidth")
    border_radius: str | None = Field(None, alias="borderRadius")

    model_config = {"populate_by_name": True}


class SelectOption(BaseModel):
    """A single <option> of a select element."""

    value: str
    label: str
    selected: bool


class ValidationState(BaseModel):
    """HTML5 constraint validation state (form controls only)."""

    valid: bool
    validation_message: str | None = Field(None, alias="validationMessage")
    value_missing: bool | None = Field(None, alias="valueMissing")
    type_mismatch: bool | None = Field(None, alias="typeMismatch")
    pattern_mismatch: bool | None = Field(None, alias="patternMismatch")
    too_short: bool | None = Field(None, alias="tooShort")
    too_long: bool | None = Field(None, alias="tooLong")
    range_underflow: bool | None = Field(None, alias="rangeUnderflow")
    range_overflow: bool | None = Field(None, alias="rangeOverflow")
    step_mismatch: bool | None = Field(None, alias="stepMismatch")
    custom_error: bool | None = Field(None, alias="customError")

    model_config = {"populate_by_name": True}


class ElementConstraints(BaseModel):
    """HTML5 constraint attributes (form controls only)."""

    pattern: str | None = None
    min_length: int | None = Field(None, alias="minLength")
    max_length: int | None = Field(None, alias="maxLength")
    min: str | None = None
    max: str | None = None
    step: str | None = None

    model_config = {"populate_by_name": True}


class ScrollInfo(BaseModel):
    """Scroll container info - only present if the element has overflowing content."""

    scroll_top: float = Field(alias="scrollTop")
    scroll_left: float = Field(alias="scrollLeft")
    scroll_height: float = Field(alias="scrollHeight")
    scroll_width: float = Field(alias="scrollWidth")
    client_height: float = Field(alias="clientHeight")
    client_width: float = Field(alias="clientWidth")
    can_scroll_up: bool = Field(alias="canScrollUp")
    can_scroll_down: bool = Field(alias="canScrollDown")
    can_scroll_left: bool = Field(alias="canScrollLeft")
    can_scroll_right: bool = Field(alias="canScrollRight")

    model_config = {"populate_by_name": True}


class MediaType(str, Enum):
    """Types of media elements."""

    IMAGE = "image"
    VIDEO = "video"
    CANVAS = "canvas"
    SVG = "svg"
    PICTURE = "picture"
    BACKGROUND_IMAGE = "background-image"


class MediaSource(BaseModel):
    """A <source> element inside a <picture>."""

    srcset: str
    media: str | None = None
    type: str | None = None


class VideoState(BaseModel):
    """Video-specific playback state."""

    poster: str | None = None
    current_time: float = Field(alias="currentTime")
    duration: float
    paused: bool
    muted: bool

    model_config = {"populate_by_name": True}


class MediaMetadata(BaseModel):
    """Metadata for media elements (images, video, canvas, SVG, etc.)."""

    media_type: MediaType = Field(alias="mediaType")
    src: str | None = None
    alt_text: str | None = Field(None, alias="altText")
    is_decorative: bool = Field(alias="isDecorative")
    natural_width: float | None = Field(None, alias="naturalWidth")
    natural_height: float | None = Field(None, alias="naturalHeight")
    rendered_width: float = Field(alias="renderedWidth")
    rendered_height: float = Field(alias="renderedHeight")
    oversize_ratio: float | None = Field(None, alias="oversizeRatio")
    loading_state: str = Field(
        alias="loadingState", description="One of 'pending', 'loaded', 'error', 'lazy'"
    )
    lazy_loading: bool = Field(alias="lazyLoading")
    format: str | None = None
    transfer_size: int | None = Field(None, alias="transferSize")
    srcset: str | None = None
    sizes: str | None = None
    sources: list[MediaSource] | None = None
    svg_view_box: str | None = Field(None, alias="svgViewBox")
    video_state: VideoState | None = Field(None, alias="videoState")

    model_config = {"populate_by_name": True}


class ElementRedaction(BaseModel):
    """Section 4.6 redaction verdict, carried as DATA rather than re-derived.

    ``content`` means the element sits inside a ``data-bridge-redact="true"``
    boundary; ``value`` is the stricter gate (an ``<input type="password">`` OR a
    boundary). Only the axes that apply are present on the wire, so ``None`` on
    either axis means "that axis does not apply". Never sniff the exported
    ``[REDACTED]`` sentinel instead - a page can render that string itself.
    """

    content: bool | None = None
    value: bool | None = None


class ElementState(BaseModel):
    """Current state of a UI element.

    Mirrors the TypeScript ``ElementState`` in
    ``packages/ui-bridge/src/core/types.ts``. Every field the TS type marks
    optional is optional here, and the two natively-required disabled signals
    default to ``False`` so payloads from servers predating the
    ``disabled``/``ariaDisabled`` split still validate.

    ABSENT IS NOT "OBSERVED ENABLED". ``disabled`` and ``ariaDisabled`` reading
    ``False`` may mean the server never sent them (an older build) rather than
    that the element was observed interactive - the same caveat the Rust side
    carries. A driver that must distinguish "observed enabled" from "not
    reported" has to check the field's presence in the raw payload, not this
    model's value.
    """

    visible: bool
    enabled: bool = Field(
        description=(
            "DERIVED convenience fold: !(disabled or aria_disabled). It CONFLATES "
            "the two independent signals below - a driver that needs to tell 'the "
            "DOM refuses input' from 'the author only labelled it disabled' must "
            "read `disabled` / `aria_disabled`, not this."
        )
    )
    disabled: bool = Field(
        False,
        description=(
            "The native DOM `disabled` IDL property ONLY. False for elements that "
            "have no such property. This is the signal that actually stops the "
            "browser dispatching events. Absent on the wire also reads False - see "
            "the class docstring."
        ),
    )
    aria_disabled: bool = Field(
        False,
        alias="ariaDisabled",
        description=(
            "The `aria-disabled=\"true\"` attribute ONLY. Independent of "
            "`disabled`: an ARIA button styled and announced as disabled still "
            "receives real clicks. Absent on the wire also reads False - see the "
            "class docstring."
        ),
    )
    focused: bool
    role: str | None = None
    accessible_name: str | None = Field(None, alias="accessibleName")
    rect: ElementRect
    normalized_rect: NormalizedRect | None = Field(None, alias="normalizedRect")
    value: str | None = None
    checked: bool | None = None
    selected_options: list[str] | None = Field(None, alias="selectedOptions")
    available_options: list[SelectOption] | None = Field(None, alias="availableOptions")
    text_content: str | None = Field(None, alias="textContent")
    inner_html: str | None = Field(None, alias="innerHTML")
    href: str | None = None
    dataset: dict[str, str] | None = Field(
        None,
        description=(
            "All data-* attributes keyed camelCase per HTMLElement.dataset, "
            "excluding the bridge's own data-bridge-* control attributes. Omitted "
            "inside a section 4.6 redaction boundary."
        ),
    )
    opacity_hidden: bool | None = Field(None, alias="opacityHidden")
    aria_selected: bool | None = Field(None, alias="ariaSelected")
    aria_pressed: bool | str | None = Field(
        None, alias="ariaPressed", description="True/False or the literal 'mixed'"
    )
    aria_current: str | None = Field(None, alias="ariaCurrent")
    aria_expanded: bool | None = Field(None, alias="ariaExpanded")
    aria_checked: bool | str | None = Field(
        None, alias="ariaChecked", description="True/False or the literal 'mixed'"
    )
    computed_styles: ComputedStyles | None = Field(None, alias="computedStyles")
    required: bool | None = None
    validation_state: ValidationState | None = Field(None, alias="validationState")
    constraints: ElementConstraints | None = None
    media_metadata: MediaMetadata | None = Field(None, alias="mediaMetadata")
    in_viewport: bool | None = Field(None, alias="inViewport")
    scroll_info: ScrollInfo | None = Field(None, alias="scrollInfo")
    redaction: ElementRedaction | None = None

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


# The wire's error-code vocabulary is the GENERATED catalog in
# `ui_bridge.diagnostics` (source of truth: `ui-bridge/diagnostics/codes.json`),
# whose members are `UB-`-prefixed. This module used to declare a second,
# hand-written enum of un-prefixed names (`"ACTION_TIMEOUT"`) that no server has
# ever emitted, so `ActionResponse.model_validate` raised `ValidationError` on
# every real structured failure payload and the whole
# `failure_details` / `is_timeout()` / `get_suggestions()` surface was
# unreachable. It is deleted rather than aliased — see
# `tests/test_action_declaration_followup.py::TestCanonicalErrorCodes`.
#
# `str` keeps the annotation open on purpose: a client pinned to one release
# must not start raising when a newer server mints a code this build's catalog
# does not carry yet. Comparison still works either way, because
# `UiBridgeErrorCode` is a `str` enum.
ActionErrorCodeValue = UiBridgeErrorCode | str


def wire_error_code(code: ActionErrorCodeValue | None) -> str | None:
    """
    Render an error code as the string that was on the wire.

    ``UiBridgeErrorCode`` is a ``(str, Enum)``, so ``str(code)`` and
    ``f"{code}"`` both give ``"UiBridgeErrorCode.ELEM_NOT_FOUND"`` -- the enum
    repr, not ``"UB-ELEM-NOT-FOUND"``. Comparison and dict-keying work on the
    value, which is why the mix-in is easy to trust and easy to get wrong.
    Anything that LOGS or FORMATS a code should go through here; anything that
    compares one can use it directly.
    """
    if code is None:
        return None
    return code.value if isinstance(code, UiBridgeErrorCode) else code


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


class ParamSchemaIssue(BaseModel):
    """
    One parameter that failed an action's declared ``paramSchema``.

    Populated on ``ActionFailureDetails.invalid_params`` when the SDK's
    param-validation gate rejects a call (``UB-ACTION-REJECTED``). ``path``
    names the offending param (``"username"``, ``"filter.status"``,
    ``"ids[2]"``) and ``keyword`` names the schema keyword that rejected it.
    """

    path: str
    keyword: str
    message: str

    model_config = {"populate_by_name": True}


class ActionFailureDetails(BaseModel):
    """Structured error details for action failures."""

    error_code: ActionErrorCodeValue = Field(alias="errorCode")
    message: str
    element_id: str | None = Field(None, alias="elementId")
    selectors_tried: list[str] | None = Field(None, alias="selectorsTried")
    partial_matches: list[PartialMatch] | None = Field(None, alias="partialMatches")
    element_state: ElementState | None = Field(None, alias="elementState")
    screenshot_context: str | None = Field(None, alias="screenshotContext")
    suggested_actions: list[RecoveryAction] = Field(alias="suggestedActions")
    retry_recommended: bool = Field(alias="retryRecommended")
    context: dict[str, Any] | None = None
    duration_ms: float | None = Field(None, alias="durationMs")
    timeout_ms: float | None = Field(None, alias="timeoutMs")
    # Why an action was abandoned before producing a result. ``"timeout"`` is
    # reported with ``UB-ACTION-TIMEOUT``, ``"signal"`` with
    # ``UB-ACTION-FAILED`` -- so this field, not the code, is the reliable
    # "was this abandoned?" test. A ``UB-ACTION-FAILED`` *without* it is a
    # handler that threw.
    cancel_reason: str | None = Field(None, alias="cancelReason")
    # Which params violated the action's declared ``paramSchema``. Set only on
    # the validation-gate path (``UB-ACTION-REJECTED``).
    invalid_params: list[ParamSchemaIssue] | None = Field(None, alias="invalidParams")

    model_config = {"populate_by_name": True}

    @field_validator("error_code", mode="before")
    @classmethod
    def _coerce_error_code(cls, v: Any) -> Any:
        """Promote a known code to the enum; pass an unrecognised one through."""
        if isinstance(v, str):
            try:
                return UiBridgeErrorCode(v)
            except ValueError:
                return v
        return v

    def is_element_not_found(self) -> bool:
        """Check if the error is due to element not being found."""
        return self.error_code == UiBridgeErrorCode.ELEM_NOT_FOUND

    def is_element_not_visible(self) -> bool:
        """Check if the error is due to element not being visible."""
        return self.error_code == UiBridgeErrorCode.ELEM_NOT_VISIBLE

    def is_element_not_enabled(self) -> bool:
        """
        Check if the error is due to element being disabled.

        Two live codes mean this, and the SDK treats them as one case itself
        (``ai/error-context.ts`` cases them together): the element-action path
        reports ``UB-ELEM-DISABLED``, the form-fill path reports
        ``UB-ELEM-NOT-ENABLED``. Matching only one would answer ``False`` for
        half of the real disabled-element failures.
        """
        return self.error_code in (
            UiBridgeErrorCode.ELEM_NOT_ENABLED,
            UiBridgeErrorCode.ELEM_DISABLED,
        )

    def is_timeout(self) -> bool:
        """Check if the error is due to timeout."""
        return self.error_code == UiBridgeErrorCode.ACTION_TIMEOUT

    def is_cancelled(self) -> bool:
        """
        Check if the action was abandoned rather than failing on its own.

        True for both arms: the request's own ``timeoutMs`` elapsing and an
        in-process caller aborting its ``AbortSignal``.
        """
        return self.cancel_reason is not None

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

    def get_error_code(self) -> ActionErrorCodeValue | None:
        """Get the structured error code if available."""
        if self.failure_details:
            return self.failure_details.error_code
        return None


class ComponentActionRequest(BaseModel):
    """Component action request."""

    action: str
    params: dict[str, Any] | None = None
    request_id: str | None = Field(None, alias="requestId")
    # Abandon the action if it has not produced a result within this many
    # milliseconds. This is the *wire-reachable* half of cancellation -- an
    # ``AbortSignal`` cannot be JSON-serialized, so for an out-of-process
    # client like this one it is the only way to call off a hung handler.
    #
    # The SDK validates and clamps it at the executor: ``0`` abandons on the
    # next tick, anything above 24h is clamped, and a negative, NaN, infinite
    # or non-numeric value is REFUSED with ``UB-VALIDATION-ERROR``. On
    # abandonment the response is ``success=False`` with
    # ``failure_details.error_code == UB-ACTION-TIMEOUT`` and
    # ``failure_details.cancel_reason == "timeout"``.
    timeout_ms: int | None = Field(None, alias="timeoutMs")

    model_config = {"populate_by_name": True}


class ComponentActionResponse(BaseModel):
    """Component action response."""

    success: bool
    result: Any | None = None
    error: str | None = None
    stack: str | None = None
    # Populated on every ``success=False`` path, the same as
    # ``ActionResponse.failure_details``. It is what distinguishes a handler
    # that threw (``UB-ACTION-FAILED``, no ``cancel_reason``) from a timed-out
    # one (``UB-ACTION-TIMEOUT``) from params the SDK's validation gate
    # rejected (``UB-ACTION-REJECTED`` + ``invalid_params``).
    failure_details: ActionFailureDetails | None = Field(None, alias="failureDetails")
    duration_ms: float = Field(alias="durationMs")
    timestamp: int
    request_id: str | None = Field(None, alias="requestId")

    model_config = {"populate_by_name": True}

    def is_timeout(self) -> bool:
        """Check if the action was abandoned because ``timeout_ms`` elapsed."""
        if self.failure_details:
            return self.failure_details.is_timeout()
        return False

    def get_error_code(self) -> ActionErrorCodeValue | None:
        """Get the structured error code if available."""
        if self.failure_details:
            return self.failure_details.error_code
        return None

    def get_invalid_params(self) -> list[ParamSchemaIssue]:
        """Get the params that failed the action's declared ``paramSchema``."""
        if self.failure_details and self.failure_details.invalid_params:
            return self.failure_details.invalid_params
        return []

    def get_suggestions(self) -> list[str]:
        """Get recovery suggestions if available."""
        if self.failure_details:
            return self.failure_details.get_suggestions()
        return []


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
    accessibility: ElementAccessibility | None = Field(
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


class ElementBbox(BaseModel):
    """Live viewport-relative bounding box for a registered element.

    Maintained by the TypeScript ``useUIElement`` hook via ResizeObserver and
    scroll/resize listeners. Present on snapshot entries for SDK-registered
    elements that have attached a ref (or that matched via the
    ``data-ui-bridge-id`` fallback). Runners use this to dispatch clicks via
    DOM coordinates and skip VLM pixel grounding.
    """

    x: float
    y: float
    width: float
    height: float


class RegisteredElement(BaseModel):
    """Registered element info."""

    id: str
    type: str
    label: str | None = None
    actions: list[str]
    state: ElementState
    # Live bbox/visibility tracked by useUIElement. Absent when the hook could
    # not resolve a DOM element (e.g. unmounted) or when the entry originated
    # from the server-side DOM fallback scan rather than React registration.
    bbox: ElementBbox | None = None
    visible: bool | None = None
    # --- Structured disambiguation metadata (all optional) --------------
    # Open-ended strings set by the consumer on `useUIElement` so NL queries
    # like "the red Save button at the bottom right" or "the destructive
    # Confirm" can rank candidates without VLM pixel grounding. Absent when
    # the consumer didn't opt in.
    # Semantic role/intent — e.g. "primary", "destructive", "ghost".
    variant: str | None = None
    # Positional hint — e.g. "bottom-right", "top", "center".
    position: str | None = None
    # Dominant color as seen by the user — CSS name, hex, or design token.
    color: str | None = None
    # Hierarchical semantic path — e.g.
    # "settings-modal > theme-section > accent-color".
    context_path: str | None = Field(None, alias="contextPath")
    # Canonical lifecycle fields (emitted from ui-bridge 0.22.0; optional so
    # snapshots from older servers still validate).
    registered_at: int | None = Field(None, alias="registeredAt")
    mounted: bool | None = None

    model_config = {"populate_by_name": True}


class ComponentActionInfo(BaseModel):
    """A single action exposed by a component (canonical ComponentActionInfo)."""

    id: str
    label: str | None = None
    description: str | None = None
    # Author-declared parameter schema, surfaced verbatim on
    # ``/control/components`` and ``/control/component/:id``. Conventionally a
    # small JSON Schema subset; the SDK enforces it at invocation, so params
    # that violate it come back as ``UB-ACTION-REJECTED`` with
    # ``failure_details.invalid_params``. Absent from the ``ControlSnapshot``
    # component projection, which emits only ``id``/``label``/``description``
    # (plus ``effect``).
    param_schema: dict[str, Any] | None = Field(None, alias="paramSchema")
    # Safety class of this action: ``"read"``, ``"write"`` or
    # ``"destructive"``. **Absent means unclassified, not safe** -- an action
    # nobody has judged must be treated as unknown rather than as ``"read"``.
    # An autonomous walk MUST NOT fire an action annotated ``"destructive"``.
    effect: str | None = None
    # Fully-resolved invocation path for this one action,
    # ``/control/component/<componentId>/action/<actionId>``. Server-annotated,
    # never author-declared, and emitted only on the component listing
    # endpoints. Distinct from ``RegisteredComponent.action_invocation_path``,
    # which is a *template* carrying a literal ``{actionId}`` placeholder.
    path: str | None = None

    model_config = {"populate_by_name": True}


class RegisteredComponent(BaseModel):
    """Registered component info."""

    id: str
    name: str
    description: str | None = None
    # Canonical `ComponentActionInfo` objects from ui-bridge 0.22.0. Older
    # servers sent bare action-id strings — coerced for compatibility.
    actions: list[ComponentActionInfo]
    action_invocation_path: str | None = Field(None, alias="actionInvocationPath")
    element_ids: list[str] | None = Field(None, alias="elementIds")
    registered_at: int | None = Field(None, alias="registeredAt")
    mounted: bool | None = None
    scope: str | None = None

    model_config = {"populate_by_name": True}

    @field_validator("actions", mode="before")
    @classmethod
    def _coerce_action_ids(cls, v: Any) -> Any:
        """Accept pre-0.22.0 wire shape: a list of bare action-id strings."""
        if isinstance(v, list):
            return [{"id": a} if isinstance(a, str) else a for a in v]
        return v


class RegisteredWorkflow(BaseModel):
    """Registered workflow info."""

    id: str
    name: str
    step_count: int = Field(alias="stepCount")

    model_config = {"populate_by_name": True}


class DragSourceInfo(BaseModel):
    """A detected drag source element."""

    id: str
    label: str | None = None
    data_type: str | None = Field(None, alias="dataType")
    origin: str
    native_draggable: bool = Field(alias="nativeDraggable")
    has_grab_cursor: bool = Field(alias="hasGrabCursor")
    metadata: dict[str, Any] | None = None

    model_config = {"populate_by_name": True}


class DropZoneInfo(BaseModel):
    """A detected drop zone element."""

    id: str
    label: str | None = None
    accepts: list[str] | None = None
    effect: str | None = None
    origin: str
    aria_drop_effect: str | None = Field(None, alias="ariaDropEffect")
    is_sortable: bool = Field(alias="isSortable")
    contained_drag_sources: list[str] | None = Field(None, alias="containedDragSources")
    metadata: dict[str, Any] | None = None

    model_config = {"populate_by_name": True}


class SnapshotDragDropContext(BaseModel):
    """Drag source and drop zone discovery context."""

    drag_sources: list[DragSourceInfo] = Field(alias="dragSources")
    drop_zones: list[DropZoneInfo] = Field(alias="dropZones")
    count: dict[str, int]
    by_origin: dict[str, int] = Field(alias="byOrigin")

    model_config = {"populate_by_name": True}


# ============================================================================
# Shortcut Types
# ============================================================================


class KeyboardShortcut(BaseModel):
    """A single keyboard shortcut discovered on the page."""

    combo: str
    description: str | None = None
    element_id: str | None = Field(None, alias="elementId")
    source: str
    scope: str | None = None

    model_config = {"populate_by_name": True}


class SnapshotShortcutContext(BaseModel):
    """Keyboard shortcut context included in ControlSnapshot.shortcuts."""

    shortcuts: list[KeyboardShortcut]
    total_count: int = Field(alias="totalCount")
    last_scan_timestamp: int = Field(alias="lastScanTimestamp")

    model_config = {"populate_by_name": True}


# ============================================================================
# Modal/Dialog Stack Types
# ============================================================================


class ModalInfo(BaseModel):
    """Information about a detected modal/dialog."""

    id: str
    title: str | None = None
    type: str
    blocking: bool
    z_index: int = Field(alias="zIndex")
    has_backdrop: bool = Field(alias="hasBackdrop")
    close_button: str | None = Field(None, alias="closeButton")
    primary_action: str | None = Field(None, alias="primaryAction")
    esc_dismiss: bool = Field(alias="escDismiss")
    role: str | None = None
    aria_label: str | None = Field(None, alias="ariaLabel")
    detected_at: int = Field(alias="detectedAt")
    selector: str

    model_config = {"populate_by_name": True}


class SnapshotModalContext(BaseModel):
    """Modal/dialog stack context included in ControlSnapshot.modalStack."""

    modals: list[ModalInfo]
    top_modal: ModalInfo | None = Field(None, alias="topModal")
    has_blocking_modal: bool = Field(alias="hasBlockingModal")
    count: int

    model_config = {"populate_by_name": True}


# ============================================================================
# Toast/Notification Types
# ============================================================================


class CapturedToast(BaseModel):
    """A captured toast/notification message."""

    id: str
    message: str
    level: str
    appeared_at: int = Field(alias="appearedAt")
    dismissed_at: int | None = Field(None, alias="dismissedAt")
    visible: bool
    duration_ms: float = Field(alias="durationMs")
    source: str | None = None
    has_action: bool | None = Field(None, alias="hasAction")
    action_text: str | None = Field(None, alias="actionText")

    model_config = {"populate_by_name": True}


class SnapshotToastContext(BaseModel):
    """Toast/notification context included in ControlSnapshot.toasts."""

    active: list[CapturedToast]
    recent: list[CapturedToast]
    total_captured: int = Field(alias="totalCaptured")

    model_config = {"populate_by_name": True}


# ============================================================================
# Viewport Types
# ============================================================================


class SnapshotViewportContext(BaseModel):
    """Viewport scroll and dimension info included in ControlSnapshot.viewport."""

    viewport_width: float = Field(alias="viewportWidth")
    viewport_height: float = Field(alias="viewportHeight")
    scroll_x: float = Field(alias="scrollX")
    scroll_y: float = Field(alias="scrollY")
    document_width: float = Field(alias="documentWidth")
    document_height: float = Field(alias="documentHeight")
    can_scroll_down: bool = Field(alias="canScrollDown")
    can_scroll_right: bool = Field(alias="canScrollRight")

    model_config = {"populate_by_name": True}


# ============================================================================
# Relationship Types
# ============================================================================


class ElementRelationship(BaseModel):
    """A semantic relationship between two UI elements."""

    source: str
    target: str
    type: str
    origin: str
    bidirectional: bool | None = None
    metadata: dict[str, Any] | None = None


class SnapshotRelationshipContext(BaseModel):
    """Element relationship context included in ControlSnapshot.relationships."""

    relationships: list[ElementRelationship]
    count: int
    by_origin: dict[str, int] = Field(alias="byOrigin")

    model_config = {"populate_by_name": True}


# ============================================================================
# Undo/Redo Types
# ============================================================================


class SnapshotUndoContext(BaseModel):
    """Undo/redo availability context included in ControlSnapshot.undoRedo.

    Canonical wire names are ``canUndo``/``canRedo`` (ui-bridge 0.22.0,
    matching qontinui-types and the native SDK); the pre-0.22.0 web names
    ``undoAvailable``/``redoAvailable`` are accepted for compatibility.
    """

    can_undo: bool = Field(
        validation_alias=AliasChoices("canUndo", "undoAvailable", "can_undo"),
        serialization_alias="canUndo",
    )
    can_redo: bool = Field(
        validation_alias=AliasChoices("canRedo", "redoAvailable", "can_redo"),
        serialization_alias="canRedo",
    )
    undo_description: str | None = Field(None, alias="undoDescription")
    redo_description: str | None = Field(None, alias="redoDescription")
    undo_depth: int | None = Field(None, alias="undoDepth")
    redo_depth: int | None = Field(None, alias="redoDepth")
    summary: str

    model_config = {"populate_by_name": True}


class ControlSnapshot(BaseModel):
    """Control snapshot - full state of controllable UI."""

    timestamp: int
    elements: list[RegisteredElement]
    components: list[RegisteredComponent]
    workflows: list[RegisteredWorkflow]
    active_runs: list[dict[str, Any]] = Field(default_factory=list, alias="activeRuns")
    shortcuts: SnapshotShortcutContext | None = None
    modal_stack: SnapshotModalContext | None = Field(None, alias="modalStack")
    toasts: SnapshotToastContext | None = None
    viewport: SnapshotViewportContext | None = None
    relationships: SnapshotRelationshipContext | None = None
    drag_drop: SnapshotDragDropContext | None = Field(None, alias="dragDrop")
    undo_redo: SnapshotUndoContext | None = Field(None, alias="undoRedo")

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
    element_id: str = Field(
        alias="elementId", description="ID of the element with the issue"
    )
    element_selector: str | None = Field(
        None, alias="elementSelector", description="Selector to find the element"
    )
    suggestion: str = Field(description="Suggested fix for the issue")
    rule_id: str = Field(
        alias="ruleId", description="The rule ID that detected this issue"
    )

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
    passed_count: int = Field(
        alias="passedCount", description="Number of checks that passed"
    )
    failed_count: int = Field(
        alias="failedCount", description="Number of checks that failed"
    )
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


# ============================================================================
# Annotation Types
# ============================================================================


class ElementAnnotation(BaseModel):
    """Semantic annotation for a UI element.

    All fields are optional - annotate only what's useful. Annotations provide
    human-authored context that enriches the UI Bridge's understanding of
    elements beyond what can be inferred from the DOM.

    Attributes:
        description: Human-readable description of what this element is.
        purpose: Why this element exists and what it is for.
        notes: Behavioral notes, edge cases, or caveats.
        tags: Searchable tags for categorization (e.g., ``['auth', 'form']``).
        related_elements: IDs of related elements (e.g., a label and its input).
        metadata: Arbitrary key-value metadata.
        updated_at: Timestamp of last update (auto-set by the server).
        author: Author of this annotation.

    Example:
        >>> annotation = ElementAnnotation(
        ...     description='Primary login button',
        ...     purpose='Submits the login form and authenticates the user',
        ...     tags=['auth', 'primary-action'],
        ...     related_elements=['email-input', 'password-input'],
        ... )
    """

    description: str | None = None
    purpose: str | None = None
    notes: str | None = None
    tags: list[str] | None = None
    related_elements: list[str] | None = Field(None, alias="relatedElements")
    metadata: dict[str, Any] | None = None
    updated_at: int | None = Field(None, alias="updatedAt")
    author: str | None = None

    model_config = {"populate_by_name": True}


class AnnotationConfig(BaseModel):
    """Annotation configuration file format for import/export.

    This is the standard format for persisting annotations to JSON files.
    Use ``client.annotations.export_config()`` to generate and
    ``client.annotations.import_config()`` to load.

    Attributes:
        version: Config format version (currently ``"1.0.0"``).
        annotations: Map of element ID to its ``ElementAnnotation``.
        metadata: Optional file-level metadata (app name, export timestamp, etc.).

    Example:
        >>> config = AnnotationConfig(
        ...     version='1.0.0',
        ...     annotations={
        ...         'login-btn': ElementAnnotation(description='Login button'),
        ...         'email-input': ElementAnnotation(description='Email field'),
        ...     },
        ...     metadata={'appName': 'MyApp'},
        ... )
    """

    version: str
    annotations: dict[str, ElementAnnotation]
    metadata: dict[str, Any] | None = None


class AnnotationCoverage(BaseModel):
    """Annotation coverage statistics.

    Reports how many UI elements have been annotated out of the total
    registered elements. Useful for tracking annotation completeness.

    Attributes:
        total_elements: Total number of elements known to the UI Bridge.
        annotated_elements: Number of elements that have annotations.
        coverage_percent: Coverage as a percentage (0-100).
        annotated_ids: IDs of elements that have annotations.
        unannotated_ids: IDs of elements missing annotations.
        timestamp: When this coverage was computed (epoch ms).

    Example:
        >>> cov = client.annotations.coverage()
        >>> print(f"{cov.annotated_elements}/{cov.total_elements} "
        ...       f"({cov.coverage_percent:.1f}%)")
        5/20 (25.0%)
        >>> for element_id in cov.unannotated_ids[:3]:
        ...     print(f"  Missing: {element_id}")
    """

    total_elements: int = Field(alias="totalElements")
    annotated_elements: int = Field(alias="annotatedElements")
    coverage_percent: float = Field(alias="coveragePercent")
    annotated_ids: list[str] = Field(alias="annotatedIds")
    unannotated_ids: list[str] = Field(alias="unannotatedIds")
    timestamp: int

    model_config = {"populate_by_name": True}


# Rebuild models with forward references
DiscoveredElement.model_rebuild()
ActionFailureDetails.model_rebuild()
