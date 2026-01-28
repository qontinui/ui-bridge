"""
AI Module Type Definitions

Pydantic models for AI-native UI Bridge functionality.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal

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


class StructuredFailureInfo(BaseModel):
    """Structured failure information for NL actions."""

    error_code: str = Field(alias="errorCode")
    message: str
    element_id: str | None = Field(None, alias="elementId")
    selectors_tried: list[str] | None = Field(None, alias="selectorsTried")
    partial_matches: list["PartialMatchInfo"] | None = Field(None, alias="partialMatches")
    element_state: ElementState | None = Field(None, alias="elementState")
    screenshot_context: str | None = Field(None, alias="screenshotContext")
    suggested_actions: list["RecoverySuggestionInfo"] | None = Field(
        None, alias="suggestedActions"
    )
    retry_recommended: bool = Field(False, alias="retryRecommended")
    context: dict[str, Any] | None = None
    duration_ms: float | None = Field(None, alias="durationMs")
    timeout_ms: float | None = Field(None, alias="timeoutMs")

    model_config = {"populate_by_name": True}


class PartialMatchInfo(BaseModel):
    """Information about a partial element match."""

    element_id: str = Field(alias="elementId")
    confidence: float
    reason: str
    type: str
    description: str | None = None

    model_config = {"populate_by_name": True}


class RecoverySuggestionInfo(BaseModel):
    """Recovery suggestion information."""

    suggestion: str
    command: str | None = None
    confidence: float
    retryable: bool

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
    failure_info: StructuredFailureInfo | None = Field(None, alias="failureInfo")

    model_config = {"populate_by_name": True}

    def is_element_not_found(self) -> bool:
        """Check if failure is due to element not found."""
        if self.failure_info:
            return self.failure_info.error_code == "ELEMENT_NOT_FOUND"
        return self.error_code == "ELEMENT_NOT_FOUND"

    def is_element_not_visible(self) -> bool:
        """Check if failure is due to element not visible."""
        if self.failure_info:
            return self.failure_info.error_code == "ELEMENT_NOT_VISIBLE"
        return self.error_code == "ELEMENT_NOT_VISIBLE"

    def is_element_not_enabled(self) -> bool:
        """Check if failure is due to element being disabled."""
        if self.failure_info:
            return self.failure_info.error_code == "ELEMENT_NOT_ENABLED"
        return self.error_code == "ELEMENT_DISABLED" or self.error_code == "ELEMENT_NOT_ENABLED"

    def is_low_confidence(self) -> bool:
        """Check if failure is due to low confidence match."""
        if self.failure_info:
            return self.failure_info.error_code == "LOW_CONFIDENCE"
        return self.error_code == "LOW_CONFIDENCE"

    def is_timeout(self) -> bool:
        """Check if failure is due to timeout."""
        if self.failure_info:
            return self.failure_info.error_code == "ACTION_TIMEOUT"
        return self.error_code == "ACTION_TIMEOUT"

    def is_retryable(self) -> bool:
        """Check if the action should be retried."""
        if self.failure_info:
            return self.failure_info.retry_recommended
        # Default retryable error codes
        retryable_codes = {"ACTION_TIMEOUT", "ELEMENT_NOT_VISIBLE", "LOW_CONFIDENCE"}
        return self.error_code in retryable_codes if self.error_code else False

    def get_suggestions(self) -> list[str]:
        """Get all recovery suggestions."""
        if self.failure_info and self.failure_info.suggested_actions:
            return [a.suggestion for a in self.failure_info.suggested_actions]
        return self.suggestions or []

    def get_best_suggestion(self) -> str | None:
        """Get the highest confidence recovery suggestion."""
        if self.failure_info and self.failure_info.suggested_actions:
            best = max(self.failure_info.suggested_actions, key=lambda a: a.confidence)
            return best.suggestion
        if self.suggestions:
            return self.suggestions[0]
        return None

    def get_partial_matches(self) -> list[PartialMatchInfo]:
        """Get information about partial matches that were found."""
        if self.failure_info and self.failure_info.partial_matches:
            return self.failure_info.partial_matches
        return []

    def get_alternatives_summary(self) -> list[str]:
        """Get a summary of alternative elements that could be used."""
        summaries = []
        if self.alternatives:
            for alt in self.alternatives[:5]:
                summaries.append(
                    f"{alt.element.description} (confidence: {alt.confidence:.0%})"
                )
        return summaries


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


# ============================================================================
# Semantic Search Types
# ============================================================================


class SemanticSearchCriteria(BaseModel):
    """Criteria for semantic search using embeddings."""

    query: str
    threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    limit: int | None = Field(default=None, ge=1)
    type: str | None = None
    role: str | None = None
    combine_with_text: bool | None = Field(None, alias="combineWithText")

    model_config = {"populate_by_name": True}


class SemanticSearchResult(BaseModel):
    """Result from semantic search."""

    element: AIDiscoveredElement
    similarity: float
    rank: int
    embedded_text: str = Field(alias="embeddedText")

    model_config = {"populate_by_name": True}


class EmbeddingProviderInfo(BaseModel):
    """Information about the embedding provider."""

    provider: str
    model: str
    dimension: int


class SemanticSearchResponse(BaseModel):
    """Response from semantic search operations."""

    results: list[SemanticSearchResult]
    best_match: SemanticSearchResult | None = Field(None, alias="bestMatch")
    scanned_count: int = Field(alias="scannedCount")
    duration_ms: float = Field(alias="durationMs")
    query: str
    provider_info: EmbeddingProviderInfo | None = Field(None, alias="providerInfo")
    timestamp: int

    model_config = {"populate_by_name": True}


# ============================================================================
# AI Find Response Types
# ============================================================================


class FormFieldAnalysis(BaseModel):
    """Form field analysis result."""

    id: str
    label: str
    type: str
    value: str
    valid: bool
    error: str | None = None
    required: bool
    placeholder: str | None = None


class FormAnalysis(BaseModel):
    """Form analysis result."""

    id: str
    name: str | None = None
    purpose: str | None = None
    fields: list[FormFieldAnalysis]
    is_valid: bool = Field(alias="isValid")
    submit_button: str | None = Field(None, alias="submitButton")
    cancel_button: str | None = Field(None, alias="cancelButton")

    model_config = {"populate_by_name": True}


class AIFindResponse(BaseModel):
    """Response from AI find operations."""

    elements: list[AIDiscoveredElement]
    summary: str
    forms: list[FormAnalysis] | None = None
    page_context: PageContext = Field(alias="pageContext")
    duration_ms: float = Field(alias="durationMs")
    timestamp: int

    model_config = {"populate_by_name": True}


# ============================================================================
# Parsed Action Types
# ============================================================================


class ParsedAction(BaseModel):
    """Parsed action from natural language."""

    action: Literal[
        "click",
        "type",
        "select",
        "check",
        "uncheck",
        "scroll",
        "wait",
        "assert",
        "hover",
        "focus",
        "clear",
        "doubleClick",
        "rightClick",
    ]
    target_description: str = Field(alias="targetDescription")
    value: str | None = None
    modifiers: list[Literal["shift", "ctrl", "alt", "meta"]] | None = None
    scroll_direction: Literal["up", "down", "left", "right"] | None = Field(
        None, alias="scrollDirection"
    )
    wait_condition: str | None = Field(None, alias="waitCondition")
    assertion_type: AssertionType | None = Field(None, alias="assertionType")
    raw_instruction: str = Field(alias="rawInstruction")
    parse_confidence: float = Field(alias="parseConfidence")

    model_config = {"populate_by_name": True}


# ============================================================================
# AI Element Registration Options
# ============================================================================


class AIElementRegistrationOptions(BaseModel):
    """Extended element registration options with AI metadata."""

    aliases: list[str] | None = None
    description: str | None = None
    semantic_type: str | None = Field(None, alias="semanticType")
    purpose: str | None = None
    auto_generate_aliases: bool | None = Field(None, alias="autoGenerateAliases")

    model_config = {"populate_by_name": True}


# ============================================================================
# Intent Types
# ============================================================================


class IntentParameter(BaseModel):
    """Parameter definition for an intent."""

    name: str
    description: str
    type: Literal["string", "number", "boolean"]
    required: bool
    default_value: Any | None = Field(None, alias="defaultValue")
    examples: list[str] | None = None

    model_config = {"populate_by_name": True}


class Intent(BaseModel):
    """Intent definition."""

    id: str
    description: str
    examples: list[str]
    parameters: list[IntentParameter]
    actions: list[str]
    tags: list[str] | None = None
    priority: int | None = None
    strict_parameters: bool | None = Field(None, alias="strictParameters")

    model_config = {"populate_by_name": True}


class IntentMatch(BaseModel):
    """Result from intent resolution."""

    intent: Intent
    confidence: float
    extracted_params: dict[str, Any] = Field(alias="extractedParams")
    match_reasons: list[str] = Field(alias="matchReasons")
    query: str

    model_config = {"populate_by_name": True}


class IntentSearchResponse(BaseModel):
    """Response from intent search."""

    matches: list[IntentMatch]
    best_match: IntentMatch | None = Field(None, alias="bestMatch")
    duration_ms: float = Field(alias="durationMs")
    timestamp: int

    model_config = {"populate_by_name": True}


class ActionStepResult(BaseModel):
    """Status of a single action step in intent execution."""

    action: str
    resolved_action: str = Field(alias="resolvedAction")
    success: bool
    duration_ms: float = Field(alias="durationMs")
    error: str | None = None
    element_used: AIDiscoveredElement | None = Field(None, alias="elementUsed")
    confidence: float | None = None

    model_config = {"populate_by_name": True}


class IntentExecutionResult(BaseModel):
    """Result from executing an intent."""

    success: bool
    intent: Intent
    params: dict[str, Any]
    steps: list[ActionStepResult]
    duration_ms: float = Field(alias="durationMs")
    timestamp: int
    error: str | None = None
    failure_info: StructuredFailureInfo | None = Field(None, alias="failureInfo")
    failed_step_index: int | None = Field(None, alias="failedStepIndex")

    model_config = {"populate_by_name": True}

    def is_missing_parameters(self) -> bool:
        """Check if failure is due to missing parameters."""
        return self.error is not None and "Missing required parameters" in self.error

    def get_failed_step(self) -> ActionStepResult | None:
        """Get the step that failed, if any."""
        if self.failed_step_index is not None and self.failed_step_index < len(self.steps):
            return self.steps[self.failed_step_index]
        return None

    def get_completed_steps(self) -> list[ActionStepResult]:
        """Get all steps that completed successfully."""
        return [s for s in self.steps if s.success]

    def get_progress_summary(self) -> str:
        """Get a summary of execution progress."""
        completed = len(self.get_completed_steps())
        total = len(self.intent.actions)
        if self.success:
            return f"Completed all {total} steps"
        return f"Failed at step {completed + 1} of {total}"
