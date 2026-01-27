"""
AI Module Type Definitions

Pydantic models for AI-native UI Bridge functionality.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from .types import ElementState


# ============================================================================
# Search Types
# ============================================================================


class SearchCriteria(BaseModel):
    """Criteria for searching elements using multiple strategies."""

    text: str | None = None
    text_contains: str | None = Field(None, alias="textContains")
    accessible_name: str | None = Field(None, alias="accessibleName")
    role: str | None = None
    type: str | None = None
    near: str | None = None
    within: str | None = None
    fuzzy: bool | None = True
    fuzzy_threshold: float | None = Field(None, alias="fuzzyThreshold")
    id_pattern: str | None = Field(None, alias="idPattern")
    selector: str | None = None
    placeholder: str | None = None
    title: str | None = None
    data_attributes: dict[str, str] | None = Field(None, alias="dataAttributes")

    model_config = {"populate_by_name": True}


class SearchScores(BaseModel):
    """Match scores by strategy."""

    text: float | None = None
    accessibility: float | None = None
    role: float | None = None
    spatial: float | None = None
    fuzzy: float | None = None


class AIDiscoveredElement(BaseModel):
    """Element with AI-generated metadata and descriptions."""

    id: str
    type: str
    label: str | None = None
    tag_name: str = Field(alias="tagName")
    role: str | None = None
    accessible_name: str | None = Field(None, alias="accessibleName")
    actions: list[str]
    state: ElementState
    registered: bool
    description: str
    aliases: list[str]
    purpose: str | None = None
    parent_context: str | None = Field(None, alias="parentContext")
    suggested_actions: list[str] = Field(alias="suggestedActions")
    semantic_type: str | None = Field(None, alias="semanticType")
    label_text: str | None = Field(None, alias="labelText")
    placeholder: str | None = None
    title: str | None = None
    aria_description: str | None = Field(None, alias="ariaDescription")

    model_config = {"populate_by_name": True}


class SearchResult(BaseModel):
    """Result from a search operation."""

    element: AIDiscoveredElement
    confidence: float
    match_reasons: list[str] = Field(alias="matchReasons")
    scores: SearchScores

    model_config = {"populate_by_name": True}


class SearchResponse(BaseModel):
    """Response from search operations."""

    results: list[SearchResult]
    best_match: SearchResult | None = Field(None, alias="bestMatch")
    scanned_count: int = Field(alias="scannedCount")
    duration_ms: float = Field(alias="durationMs")
    criteria: SearchCriteria
    timestamp: int

    model_config = {"populate_by_name": True}


# ============================================================================
# NL Action Types
# ============================================================================


class NLActionRequest(BaseModel):
    """Natural language action request."""

    instruction: str
    context: str | None = None
    timeout: int | None = None
    confidence_threshold: float | None = Field(None, alias="confidenceThreshold")

    model_config = {"populate_by_name": True}


class NLActionResponse(BaseModel):
    """Response from executing a natural language action."""

    success: bool
    executed_action: str = Field(alias="executedAction")
    element_used: AIDiscoveredElement = Field(alias="elementUsed")
    confidence: float
    element_state: ElementState = Field(alias="elementState")
    duration_ms: float = Field(alias="durationMs")
    timestamp: int
    error: str | None = None
    error_code: str | None = Field(None, alias="errorCode")
    suggestions: list[str] | None = None
    alternatives: list[SearchResult] | None = None

    model_config = {"populate_by_name": True}


# ============================================================================
# Assertion Types
# ============================================================================


class AssertionType(str, Enum):
    """Types of assertions that can be made about elements."""

    VISIBLE = "visible"
    HIDDEN = "hidden"
    ENABLED = "enabled"
    DISABLED = "disabled"
    FOCUSED = "focused"
    CHECKED = "checked"
    UNCHECKED = "unchecked"
    HAS_TEXT = "hasText"
    CONTAINS_TEXT = "containsText"
    HAS_VALUE = "hasValue"
    HAS_CLASS = "hasClass"
    EXISTS = "exists"
    NOT_EXISTS = "notExists"
    COUNT = "count"
    ATTRIBUTE = "attribute"
    CSS_PROPERTY = "cssProperty"


class AssertionRequest(BaseModel):
    """Assertion request."""

    target: str | SearchCriteria
    type: AssertionType
    expected: Any | None = None
    attribute_name: str | None = Field(None, alias="attributeName")
    property_name: str | None = Field(None, alias="propertyName")
    timeout: int | None = None
    message: str | None = None
    fuzzy: bool | None = None

    model_config = {"populate_by_name": True}


class AssertionResult(BaseModel):
    """Assertion result."""

    passed: bool
    target: str
    target_description: str = Field(alias="targetDescription")
    expected: Any
    actual: Any
    failure_reason: str | None = Field(None, alias="failureReason")
    suggestion: str | None = None
    element_state: ElementState | None = Field(None, alias="elementState")
    duration_ms: float = Field(alias="durationMs")
    timestamp: int

    model_config = {"populate_by_name": True}


class BatchAssertionRequest(BaseModel):
    """Batch assertion request."""

    assertions: list[AssertionRequest]
    mode: str  # 'all' | 'any'
    stop_on_failure: bool | None = Field(None, alias="stopOnFailure")

    model_config = {"populate_by_name": True}


class BatchAssertionResult(BaseModel):
    """Batch assertion result."""

    passed: bool
    results: list[AssertionResult]
    passed_count: int = Field(alias="passedCount")
    failed_count: int = Field(alias="failedCount")
    duration_ms: float = Field(alias="durationMs")
    timestamp: int

    model_config = {"populate_by_name": True}


# ============================================================================
# Semantic Snapshot Types
# ============================================================================


class PageContext(BaseModel):
    """Page context information."""

    url: str
    title: str
    page_type: str | None = Field(None, alias="pageType")
    active_modals: list[str] = Field(alias="activeModals")
    focused_element: str | None = Field(None, alias="focusedElement")
    navigation: list[str] | None = None

    model_config = {"populate_by_name": True}


class FormFieldState(BaseModel):
    """Form field state."""

    id: str
    label: str
    type: str
    value: str
    valid: bool
    error: str | None = None
    required: bool
    touched: bool


class FormState(BaseModel):
    """Form state in semantic snapshot."""

    id: str
    name: str | None = None
    purpose: str | None = None
    fields: list[FormFieldState]
    is_valid: bool = Field(alias="isValid")
    submit_button: str | None = Field(None, alias="submitButton")
    is_dirty: bool = Field(alias="isDirty")

    model_config = {"populate_by_name": True}


class ModalState(BaseModel):
    """Modal/dialog state."""

    id: str
    title: str | None = None
    type: str  # 'dialog' | 'alert' | 'confirm' | 'prompt' | 'drawer' | 'popup'
    blocking: bool
    close_button: str | None = Field(None, alias="closeButton")
    primary_action: str | None = Field(None, alias="primaryAction")
    secondary_action: str | None = Field(None, alias="secondaryAction")

    model_config = {"populate_by_name": True}


class SemanticSnapshot(BaseModel):
    """Semantic snapshot of the current page state."""

    timestamp: int
    snapshot_id: str = Field(alias="snapshotId")
    page: PageContext
    elements: list[AIDiscoveredElement]
    forms: list[FormState]
    active_modals: list[ModalState] = Field(alias="activeModals")
    focused_element: str | None = Field(None, alias="focusedElement")
    summary: str
    element_counts: dict[str, int] = Field(alias="elementCounts")

    model_config = {"populate_by_name": True}


# ============================================================================
# Semantic Diff Types
# ============================================================================


class ElementChange(BaseModel):
    """Element change (appeared/disappeared)."""

    element_id: str = Field(alias="elementId")
    description: str
    type: str
    semantic_type: str | None = Field(None, alias="semanticType")

    model_config = {"populate_by_name": True}


class ElementModification(BaseModel):
    """Element modification."""

    element_id: str = Field(alias="elementId")
    description: str
    property: str
    from_value: str = Field(alias="from")
    to_value: str = Field(alias="to")
    significant: bool

    model_config = {"populate_by_name": True}


class DiffChanges(BaseModel):
    """Changes in a semantic diff."""

    appeared: list[ElementChange]
    disappeared: list[ElementChange]
    modified: list[ElementModification]


class PageChanges(BaseModel):
    """Page-level changes."""

    url_changed: bool = Field(alias="urlChanged")
    title_changed: bool = Field(alias="titleChanged")
    new_url: str | None = Field(None, alias="newUrl")
    new_title: str | None = Field(None, alias="newTitle")

    model_config = {"populate_by_name": True}


class SemanticDiff(BaseModel):
    """Semantic diff between two snapshots."""

    summary: str
    from_snapshot_id: str = Field(alias="fromSnapshotId")
    to_snapshot_id: str = Field(alias="toSnapshotId")
    changes: DiffChanges
    probable_trigger: str | None = Field(None, alias="probableTrigger")
    suggested_actions: list[str] | None = Field(None, alias="suggestedActions")
    page_changes: PageChanges | None = Field(None, alias="pageChanges")
    duration_ms: float = Field(alias="durationMs")
    timestamp: int

    model_config = {"populate_by_name": True}


# ============================================================================
# Error Context Types
# ============================================================================


class RecoverySuggestion(BaseModel):
    """Recovery suggestion for errors."""

    action: str
    command: str | None = None
    confidence: float
    priority: int


class NearestMatchInfo(BaseModel):
    """Information about the nearest match."""

    element: AIDiscoveredElement
    confidence: float
    why_not_selected: str = Field(alias="whyNotSelected")

    model_config = {"populate_by_name": True}


class SearchResultsInfo(BaseModel):
    """Search results information."""

    candidates_found: int = Field(alias="candidatesFound")
    nearest_match: NearestMatchInfo | None = Field(None, alias="nearestMatch")

    model_config = {"populate_by_name": True}


class ErrorPageContext(BaseModel):
    """Page context in error."""

    url: str
    title: str
    visible_elements: int = Field(alias="visibleElements")
    possible_blockers: list[str] = Field(alias="possibleBlockers")

    model_config = {"populate_by_name": True}


class AIErrorContext(BaseModel):
    """Rich error context for AI agents."""

    code: str
    message: str
    attempted_action: str = Field(alias="attemptedAction")
    search_criteria: SearchCriteria | None = Field(None, alias="searchCriteria")
    search_results: SearchResultsInfo = Field(alias="searchResults")
    page_context: ErrorPageContext = Field(alias="pageContext")
    suggestions: list[RecoverySuggestion]
    stack: str | None = None
    timestamp: int

    model_config = {"populate_by_name": True}
