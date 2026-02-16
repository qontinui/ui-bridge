"""
State Machine Integration

Types and utilities for UI state machine management in UI Bridge.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class DiscoveredState(BaseModel):
    """A discovered UI state."""

    id: str
    name: str
    description: str | None = None
    is_active: bool = Field(default=False, alias="isActive")
    metadata: dict[str, Any] | None = None

    model_config = {"populate_by_name": True}


class DiscoveredTransition(BaseModel):
    """A discovered state transition."""

    id: str
    from_state: str = Field(alias="fromState")
    to_state: str = Field(alias="toState")
    action: str
    description: str | None = None

    model_config = {"populate_by_name": True}


class NavigationHint(BaseModel):
    """A hint for navigation between states."""

    target_state: str = Field(alias="targetState")
    action: str
    description: str | None = None
    confidence: float = 1.0

    model_config = {"populate_by_name": True}


class BreadcrumbEntry(BaseModel):
    """An entry in the navigation breadcrumb trail."""

    state_id: str = Field(alias="stateId")
    timestamp: int
    action: str | None = None

    model_config = {"populate_by_name": True}


class NavigationLoop(BaseModel):
    """Detection of a navigation loop."""

    states: list[str]
    count: int
    message: str


class AvailableAction(BaseModel):
    """An action available from the current state."""

    action: str
    target_state: str = Field(alias="targetState")
    description: str | None = None

    model_config = {"populate_by_name": True}


class ReachableState(BaseModel):
    """A state reachable from the current state."""

    state_id: str = Field(alias="stateId")
    distance: int
    path: list[str]

    model_config = {"populate_by_name": True}


class CommonDestination(BaseModel):
    """A commonly navigated-to destination."""

    state_id: str = Field(alias="stateId")
    visit_count: int = Field(alias="visitCount")
    last_visited: int | None = Field(default=None, alias="lastVisited")

    model_config = {"populate_by_name": True}


class NavigationIssue(BaseModel):
    """An issue detected in navigation."""

    type: str
    message: str
    severity: str = "warning"
    context: dict[str, Any] | None = None


class NavigationContext(BaseModel):
    """Full navigation context for AI agents."""

    current_states: list[str] = Field(alias="currentStates")
    available_actions: list[AvailableAction] = Field(alias="availableActions")
    reachable_states: list[ReachableState] = Field(alias="reachableStates")
    common_destinations: list[CommonDestination] = Field(
        default_factory=list, alias="commonDestinations"
    )
    issues: list[NavigationIssue] = Field(default_factory=list)
    hints: list[NavigationHint] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class NavigationProgressEvent(BaseModel):
    """An event in navigation progress tracking."""

    state_id: str = Field(alias="stateId")
    action: str
    timestamp: int
    success: bool

    model_config = {"populate_by_name": True}


class NavigationProgress(BaseModel):
    """Navigation progress tracking."""

    target_states: list[str] = Field(alias="targetStates")
    events: list[NavigationProgressEvent] = Field(default_factory=list)
    started_at: int = Field(alias="startedAt")
    completed: bool = False
    success: bool = False

    model_config = {"populate_by_name": True}


class BreadcrumbTracker:
    """Tracks navigation breadcrumbs for loop detection and history."""

    def __init__(self, max_entries: int = 100) -> None:
        self._entries: list[BreadcrumbEntry] = []
        self._max_entries = max_entries

    @property
    def entries(self) -> list[BreadcrumbEntry]:
        """Get all breadcrumb entries."""
        return list(self._entries)

    def add(self, entry: BreadcrumbEntry) -> None:
        """Add a breadcrumb entry."""
        self._entries.append(entry)
        if len(self._entries) > self._max_entries:
            self._entries = self._entries[-self._max_entries :]

    def clear(self) -> None:
        """Clear all breadcrumb entries."""
        self._entries.clear()

    def detect_loop(self, window: int = 10) -> NavigationLoop | None:
        """Detect navigation loops in recent history."""
        if len(self._entries) < 4:
            return None

        recent = self._entries[-window:]
        state_ids = [e.state_id for e in recent]

        # Check for repeating patterns
        for pattern_len in range(2, len(state_ids) // 2 + 1):
            pattern = state_ids[-pattern_len:]
            preceding = state_ids[-(pattern_len * 2) : -pattern_len]
            if pattern == preceding:
                return NavigationLoop(
                    states=pattern,
                    count=2,
                    message=f"Navigation loop detected: {' -> '.join(pattern)}",
                )

        return None


class StateManager:
    """Manages UI state machine state and transitions."""

    def __init__(self) -> None:
        self._states: dict[str, DiscoveredState] = {}
        self._transitions: dict[str, DiscoveredTransition] = {}
        self._breadcrumbs = BreadcrumbTracker()

    @property
    def states(self) -> dict[str, DiscoveredState]:
        """Get all discovered states."""
        return dict(self._states)

    @property
    def transitions(self) -> dict[str, DiscoveredTransition]:
        """Get all discovered transitions."""
        return dict(self._transitions)

    @property
    def breadcrumbs(self) -> BreadcrumbTracker:
        """Get the breadcrumb tracker."""
        return self._breadcrumbs

    def add_state(self, state: DiscoveredState) -> None:
        """Add or update a discovered state."""
        self._states[state.id] = state

    def add_transition(self, transition: DiscoveredTransition) -> None:
        """Add or update a discovered transition."""
        self._transitions[transition.id] = transition

    def get_active_states(self) -> list[DiscoveredState]:
        """Get currently active states."""
        return [s for s in self._states.values() if s.is_active]

    def get_available_actions(self) -> list[AvailableAction]:
        """Get actions available from current active states."""
        active_ids = {s.id for s in self.get_active_states()}
        actions: list[AvailableAction] = []
        for t in self._transitions.values():
            if t.from_state in active_ids:
                actions.append(
                    AvailableAction(
                        action=t.action,
                        target_state=t.to_state,
                        description=t.description,
                    )
                )
        return actions
