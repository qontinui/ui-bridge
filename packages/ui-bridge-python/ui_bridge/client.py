"""
UI Bridge Client

Python client for controlling UI elements via UI Bridge HTTP API.
"""

from __future__ import annotations

from typing import Any, TYPE_CHECKING
from urllib.parse import urljoin

import httpx

import warnings
from .types import (
    ActionResponse,
    ComponentActionResponse,
    ControlSnapshot,
    FindResponse,
    ElementState,
    NavigationResult,
    PathResult,
    PerformanceMetrics,
    RenderLogEntry,
    StateSnapshot,
    TransitionResult,
    UIState,
    UIStateGroup,
    UITransition,
    WorkflowRunResponse,
)

if TYPE_CHECKING:
    from .ai import AIClient
    from .ai_types import NLActionResponse


class UIBridgeError(Exception):
    """Base exception for UI Bridge errors."""

    def __init__(self, message: str, code: str | None = None):
        super().__init__(message)
        self.code = code


class ElementNotFoundError(UIBridgeError):
    """Element not found error."""

    pass


class ActionFailedError(UIBridgeError):
    """Action execution failed error."""

    pass


class UIBridgeClient:
    """
    UI Bridge HTTP client.

    Provides methods to control UI elements via the UI Bridge HTTP API.

    Example:
        >>> client = UIBridgeClient("http://localhost:9876")
        >>> client.click("submit-btn")
        >>> client.type("email-input", "user@example.com")
        >>> client.component("login-form").action("submit")
    """

    def __init__(
        self,
        base_url: str = "http://localhost:9876",
        *,
        timeout: float = 30.0,
        api_path: str = "/ui-bridge",
    ):
        """
        Initialize the UI Bridge client.

        Args:
            base_url: Base URL of the UI Bridge server
            timeout: Request timeout in seconds
            api_path: API path prefix
        """
        self.base_url = base_url.rstrip("/")
        self.api_path = api_path.rstrip("/")
        self.timeout = timeout
        self._client = httpx.Client(timeout=timeout)

    def __enter__(self) -> UIBridgeClient:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    def close(self) -> None:
        """Close the HTTP client."""
        self._client.close()

    def _url(self, path: str) -> str:
        """Build full URL for an API path."""
        return urljoin(self.base_url, f"{self.api_path}{path}")

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Make an HTTP request and return the data."""
        response = self._client.request(
            method,
            self._url(path),
            json=json,
            params=params,
        )
        response.raise_for_status()
        result = response.json()

        if not result.get("success", False):
            error = result.get("error", "Unknown error")
            code = result.get("code")
            if code == "NOT_FOUND":
                raise ElementNotFoundError(error, code)
            raise UIBridgeError(error, code)

        return result.get("data")

    # ==========================================================================
    # Element Actions
    # ==========================================================================

    def click(
        self,
        element_id: str,
        *,
        wait_visible: bool = True,
        wait_enabled: bool = True,
        timeout: int | None = None,
    ) -> ActionResponse:
        """
        Click an element.

        Args:
            element_id: Element identifier
            wait_visible: Wait for element to be visible
            wait_enabled: Wait for element to be enabled
            timeout: Wait timeout in milliseconds

        Returns:
            ActionResponse with element state after action
        """
        return self._execute_action(
            element_id,
            "click",
            wait_visible=wait_visible,
            wait_enabled=wait_enabled,
            timeout=timeout,
        )

    def double_click(
        self,
        element_id: str,
        *,
        wait_visible: bool = True,
        wait_enabled: bool = True,
        timeout: int | None = None,
    ) -> ActionResponse:
        """Double-click an element."""
        return self._execute_action(
            element_id,
            "doubleClick",
            wait_visible=wait_visible,
            wait_enabled=wait_enabled,
            timeout=timeout,
        )

    def right_click(
        self,
        element_id: str,
        *,
        wait_visible: bool = True,
        wait_enabled: bool = True,
        timeout: int | None = None,
    ) -> ActionResponse:
        """Right-click an element."""
        return self._execute_action(
            element_id,
            "rightClick",
            wait_visible=wait_visible,
            wait_enabled=wait_enabled,
            timeout=timeout,
        )

    def type(
        self,
        element_id: str,
        text: str,
        *,
        clear: bool = False,
        delay: int | None = None,
        wait_visible: bool = True,
        wait_enabled: bool = True,
        timeout: int | None = None,
    ) -> ActionResponse:
        """
        Type text into an input element.

        Args:
            element_id: Element identifier
            text: Text to type
            clear: Clear existing value first
            delay: Delay between keystrokes in milliseconds
            wait_visible: Wait for element to be visible
            wait_enabled: Wait for element to be enabled
            timeout: Wait timeout in milliseconds

        Returns:
            ActionResponse with element state after action
        """
        params: dict[str, Any] = {"text": text}
        if clear:
            params["clear"] = True
        if delay is not None:
            params["delay"] = delay

        return self._execute_action(
            element_id,
            "type",
            params=params,
            wait_visible=wait_visible,
            wait_enabled=wait_enabled,
            timeout=timeout,
        )

    def clear(
        self,
        element_id: str,
        *,
        wait_visible: bool = True,
        wait_enabled: bool = True,
        timeout: int | None = None,
    ) -> ActionResponse:
        """Clear an input element."""
        return self._execute_action(
            element_id,
            "clear",
            wait_visible=wait_visible,
            wait_enabled=wait_enabled,
            timeout=timeout,
        )

    def select(
        self,
        element_id: str,
        value: str | list[str],
        *,
        by_label: bool = False,
        wait_visible: bool = True,
        wait_enabled: bool = True,
        timeout: int | None = None,
    ) -> ActionResponse:
        """
        Select an option in a select element.

        Args:
            element_id: Element identifier
            value: Value(s) to select
            by_label: Select by visible label instead of value
            wait_visible: Wait for element to be visible
            wait_enabled: Wait for element to be enabled
            timeout: Wait timeout in milliseconds

        Returns:
            ActionResponse with element state after action
        """
        params: dict[str, Any] = {"value": value}
        if by_label:
            params["byLabel"] = True

        return self._execute_action(
            element_id,
            "select",
            params=params,
            wait_visible=wait_visible,
            wait_enabled=wait_enabled,
            timeout=timeout,
        )

    def focus(self, element_id: str) -> ActionResponse:
        """Focus an element."""
        return self._execute_action(element_id, "focus")

    def blur(self, element_id: str) -> ActionResponse:
        """Remove focus from an element."""
        return self._execute_action(element_id, "blur")

    def hover(self, element_id: str) -> ActionResponse:
        """Hover over an element."""
        return self._execute_action(element_id, "hover")

    def scroll(
        self,
        element_id: str,
        *,
        direction: str | None = None,
        amount: int | None = None,
        to_element: str | None = None,
        position: tuple[int, int] | None = None,
        smooth: bool = False,
    ) -> ActionResponse:
        """
        Scroll within an element.

        Args:
            element_id: Element identifier
            direction: Scroll direction (up, down, left, right)
            amount: Scroll amount in pixels
            to_element: Scroll to bring an element into view
            position: Scroll to specific position (x, y)
            smooth: Use smooth scrolling

        Returns:
            ActionResponse with element state after action
        """
        params: dict[str, Any] = {}
        if direction:
            params["direction"] = direction
        if amount is not None:
            params["amount"] = amount
        if to_element:
            params["toElement"] = to_element
        if position:
            params["position"] = {"x": position[0], "y": position[1]}
        if smooth:
            params["smooth"] = True

        return self._execute_action(element_id, "scroll", params=params)

    def check(self, element_id: str) -> ActionResponse:
        """Check a checkbox."""
        return self._execute_action(element_id, "check")

    def uncheck(self, element_id: str) -> ActionResponse:
        """Uncheck a checkbox."""
        return self._execute_action(element_id, "uncheck")

    def toggle(self, element_id: str) -> ActionResponse:
        """Toggle a checkbox."""
        return self._execute_action(element_id, "toggle")

    def _execute_action(
        self,
        element_id: str,
        action: str,
        *,
        params: dict[str, Any] | None = None,
        wait_visible: bool = False,
        wait_enabled: bool = False,
        timeout: int | None = None,
    ) -> ActionResponse:
        """Execute an action on an element."""
        request: dict[str, Any] = {"action": action}
        if params:
            request["params"] = params

        wait_options: dict[str, Any] = {}
        if wait_visible:
            wait_options["visible"] = True
        if wait_enabled:
            wait_options["enabled"] = True
        if timeout is not None:
            wait_options["timeout"] = timeout

        if wait_options:
            request["waitOptions"] = wait_options

        data = self._request(
            "POST",
            f"/control/element/{element_id}/action",
            json=request,
        )
        response = ActionResponse.model_validate(data)

        if not response.success:
            raise ActionFailedError(response.error or "Action failed")

        return response

    # ==========================================================================
    # Element State
    # ==========================================================================

    def get_element(self, element_id: str) -> dict[str, Any]:
        """Get element details."""
        return self._request("GET", f"/control/element/{element_id}")

    def get_element_state(self, element_id: str) -> ElementState:
        """Get current element state."""
        data = self._request("GET", f"/control/element/{element_id}/state")
        return ElementState.model_validate(data)

    def get_elements(self) -> list[dict[str, Any]]:
        """Get all registered elements."""
        return self._request("GET", "/control/elements")

    # ==========================================================================
    # Components
    # ==========================================================================

    def component(self, component_id: str) -> ComponentControl:
        """
        Get a component control interface.

        Args:
            component_id: Component identifier

        Returns:
            ComponentControl for executing component actions
        """
        return ComponentControl(self, component_id)

    def get_component(self, component_id: str) -> dict[str, Any]:
        """Get component details."""
        return self._request("GET", f"/control/component/{component_id}")

    def get_components(self) -> list[dict[str, Any]]:
        """Get all registered components."""
        return self._request("GET", "/control/components")

    def execute_component_action(
        self,
        component_id: str,
        action: str,
        params: dict[str, Any] | None = None,
    ) -> ComponentActionResponse:
        """Execute an action on a component."""
        request: dict[str, Any] = {"action": action}
        if params:
            request["params"] = params

        data = self._request(
            "POST",
            f"/control/component/{component_id}/action/{action}",
            json=request,
        )
        response = ComponentActionResponse.model_validate(data)

        if not response.success:
            raise ActionFailedError(response.error or "Component action failed")

        return response

    # ==========================================================================
    # Find (formerly Discovery)
    # ==========================================================================

    def find(
        self,
        *,
        root: str | None = None,
        interactive_only: bool = False,
        include_hidden: bool = False,
        limit: int | None = None,
        types: list[str] | None = None,
        selector: str | None = None,
    ) -> FindResponse:
        """
        Find controllable elements in the UI.

        Args:
            root: Root element selector to start from
            interactive_only: Only find interactive elements
            include_hidden: Include hidden elements
            limit: Maximum elements to return
            types: Filter by element types
            selector: Filter by CSS selector

        Returns:
            FindResponse with found elements
        """
        request: dict[str, Any] = {}
        if root:
            request["root"] = root
        if interactive_only:
            request["interactiveOnly"] = True
        if include_hidden:
            request["includeHidden"] = True
        if limit is not None:
            request["limit"] = limit
        if types:
            request["types"] = types
        if selector:
            request["selector"] = selector

        data = self._request("POST", "/control/find", json=request)
        return FindResponse.model_validate(data)

    def discover(
        self,
        *,
        root: str | None = None,
        interactive_only: bool = False,
        include_hidden: bool = False,
        limit: int | None = None,
        types: list[str] | None = None,
        selector: str | None = None,
    ) -> FindResponse:
        """
        Discover controllable elements in the UI.

        .. deprecated::
            Use :meth:`find` instead.

        Args:
            root: Root element selector to start from
            interactive_only: Only discover interactive elements
            include_hidden: Include hidden elements
            limit: Maximum elements to return
            types: Filter by element types
            selector: Filter by CSS selector

        Returns:
            FindResponse with discovered elements
        """
        warnings.warn(
            "discover() is deprecated, use find() instead",
            DeprecationWarning,
            stacklevel=2,
        )
        return self.find(
            root=root,
            interactive_only=interactive_only,
            include_hidden=include_hidden,
            limit=limit,
            types=types,
            selector=selector,
        )

    def get_snapshot(self) -> ControlSnapshot:
        """Get a full control snapshot."""
        data = self._request("GET", "/control/snapshot")
        return ControlSnapshot.model_validate(data)

    # ==========================================================================
    # Workflows
    # ==========================================================================

    def workflow(self, workflow_id: str) -> WorkflowControl:
        """
        Get a workflow control interface.

        Args:
            workflow_id: Workflow identifier

        Returns:
            WorkflowControl for running workflows
        """
        return WorkflowControl(self, workflow_id)

    def get_workflows(self) -> list[dict[str, Any]]:
        """Get all registered workflows."""
        return self._request("GET", "/control/workflows")

    def run_workflow(
        self,
        workflow_id: str,
        params: dict[str, Any] | None = None,
        *,
        start_step: str | None = None,
        stop_step: str | None = None,
        step_timeout: int | None = None,
        workflow_timeout: int | None = None,
    ) -> WorkflowRunResponse:
        """Run a workflow."""
        request: dict[str, Any] = {}
        if params:
            request["params"] = params
        if start_step:
            request["startStep"] = start_step
        if stop_step:
            request["stopStep"] = stop_step
        if step_timeout is not None:
            request["stepTimeout"] = step_timeout
        if workflow_timeout is not None:
            request["workflowTimeout"] = workflow_timeout

        data = self._request(
            "POST",
            f"/control/workflow/{workflow_id}/run",
            json=request,
        )
        return WorkflowRunResponse.model_validate(data)

    def get_workflow_status(self, run_id: str) -> WorkflowRunResponse:
        """Get workflow run status."""
        data = self._request("GET", f"/control/workflow/{run_id}/status")
        return WorkflowRunResponse.model_validate(data)

    # ==========================================================================
    # State Management
    # ==========================================================================

    @property
    def state(self) -> StateControl:
        """Get state management control interface."""
        return StateControl(self)

    def get_states(self) -> list[UIState]:
        """Get all registered states."""
        data = self._request("GET", "/control/states")
        return [UIState.model_validate(s) for s in data]

    def get_state(self, state_id: str) -> UIState:
        """Get a specific state."""
        data = self._request("GET", f"/control/state/{state_id}")
        return UIState.model_validate(data)

    def get_active_states(self) -> list[str]:
        """Get currently active state IDs."""
        return self._request("GET", "/control/states/active")

    def is_state_active(self, state_id: str) -> bool:
        """Check if a state is currently active."""
        active = self.get_active_states()
        return state_id in active

    def activate_state(self, state_id: str) -> bool:
        """Activate a state."""
        data = self._request("POST", f"/control/state/{state_id}/activate")
        return data.get("success", False)

    def deactivate_state(self, state_id: str) -> bool:
        """Deactivate a state."""
        data = self._request("POST", f"/control/state/{state_id}/deactivate")
        return data.get("success", False)

    def get_state_groups(self) -> list[UIStateGroup]:
        """Get all registered state groups."""
        data = self._request("GET", "/control/state-groups")
        return [UIStateGroup.model_validate(g) for g in data]

    def activate_state_group(self, group_id: str) -> list[str]:
        """Activate all states in a group."""
        data = self._request("POST", f"/control/state-group/{group_id}/activate")
        return data.get("activated", [])

    def deactivate_state_group(self, group_id: str) -> list[str]:
        """Deactivate all states in a group."""
        data = self._request("POST", f"/control/state-group/{group_id}/deactivate")
        return data.get("deactivated", [])

    def get_transitions(self) -> list[UITransition]:
        """Get all registered transitions."""
        data = self._request("GET", "/control/transitions")
        return [UITransition.model_validate(t) for t in data]

    def can_execute_transition(self, transition_id: str) -> bool:
        """Check if a transition can be executed from current state."""
        data = self._request("GET", f"/control/transition/{transition_id}/can-execute")
        return data.get("canExecute", False)

    def execute_transition(self, transition_id: str) -> TransitionResult:
        """Execute a transition."""
        data = self._request("POST", f"/control/transition/{transition_id}/execute")
        return TransitionResult.model_validate(data)

    def find_path(self, target_states: list[str]) -> PathResult:
        """Find a path to target states."""
        data = self._request(
            "POST",
            "/control/states/find-path",
            json={"targetStates": target_states},
        )
        return PathResult.model_validate(data)

    def navigate_to(self, target_states: list[str]) -> NavigationResult:
        """Navigate to target states using pathfinding."""
        data = self._request(
            "POST",
            "/control/states/navigate",
            json={"targetStates": target_states},
        )
        return NavigationResult.model_validate(data)

    def get_state_snapshot(self) -> StateSnapshot:
        """Get a snapshot of all state management data."""
        data = self._request("GET", "/control/states/snapshot")
        return StateSnapshot.model_validate(data)

    # ==========================================================================
    # Render Log
    # ==========================================================================

    @property
    def render_log(self) -> RenderLogControl:
        """Get render log control interface."""
        return RenderLogControl(self)

    def get_render_log(
        self,
        *,
        entry_type: str | None = None,
        since: int | None = None,
        until: int | None = None,
        limit: int | None = None,
    ) -> list[RenderLogEntry]:
        """Get render log entries."""
        params: dict[str, Any] = {}
        if entry_type:
            params["type"] = entry_type
        if since is not None:
            params["since"] = since
        if until is not None:
            params["until"] = until
        if limit is not None:
            params["limit"] = limit

        data = self._request("GET", "/render-log", params=params)
        return [RenderLogEntry.model_validate(entry) for entry in data]

    def capture_snapshot(self) -> dict[str, Any]:
        """Capture a DOM snapshot."""
        return self._request("POST", "/render-log/snapshot")

    def clear_render_log(self) -> None:
        """Clear the render log."""
        self._request("DELETE", "/render-log")

    # ==========================================================================
    # Debug
    # ==========================================================================

    def get_action_history(self, limit: int | None = None) -> list[dict[str, Any]]:
        """Get action history."""
        params = {"limit": limit} if limit else None
        return self._request("GET", "/debug/action-history", params=params)

    def get_metrics(self) -> PerformanceMetrics:
        """Get performance metrics."""
        data = self._request("GET", "/debug/metrics")
        return PerformanceMetrics.model_validate(data)

    def highlight_element(self, element_id: str) -> None:
        """Highlight an element visually."""
        self._request("POST", f"/debug/highlight/{element_id}")

    # ==========================================================================
    # Health
    # ==========================================================================

    def health(self) -> dict[str, Any]:
        """Check server health."""
        response = self._client.get(urljoin(self.base_url, "/health"))
        response.raise_for_status()
        return response.json()

    def is_connected(self) -> bool:
        """Check if connected to the server."""
        try:
            self.health()
            return True
        except Exception:
            return False

    # ==========================================================================
    # AI-Native Interface
    # ==========================================================================

    @property
    def ai(self) -> "AIClient":
        """
        AI-native interface for natural language interaction.

        Provides semantic search, natural language actions, and assertions.

        Example:
            >>> client = UIBridgeClient()
            >>> client.ai.execute("click the Submit button")
            >>> client.ai.assert_that("error message", "hidden")
            >>> element = client.ai.find("email input field")
        """
        # Lazy import to avoid circular dependencies
        from .ai import AIClient

        if not hasattr(self, "_ai_client"):
            self._ai_client = AIClient(self)
        return self._ai_client

    # ==========================================================================
    # AI Convenience Methods
    # ==========================================================================

    def click_text(self, text: str) -> "NLActionResponse":
        """
        Click an element by its visible text.

        Convenience method for client.ai.execute(f'click "{text}"').

        Args:
            text: Visible text of the element to click

        Returns:
            NLActionResponse with execution result
        """
        return self.ai.click(text)

    def type_into(self, target: str, text: str) -> "NLActionResponse":
        """
        Type text into an element by description.

        Convenience method for client.ai.type_text(target, text).

        Args:
            target: Natural language description of the element
            text: Text to type

        Returns:
            NLActionResponse with execution result
        """
        return self.ai.type_text(target, text)


class ComponentControl:
    """Component action control interface."""

    def __init__(self, client: UIBridgeClient, component_id: str):
        self._client = client
        self._component_id = component_id

    def action(
        self,
        action: str,
        params: dict[str, Any] | None = None,
    ) -> ComponentActionResponse:
        """Execute an action on the component."""
        return self._client.execute_component_action(self._component_id, action, params)

    def __call__(
        self,
        action: str,
        params: dict[str, Any] | None = None,
    ) -> ComponentActionResponse:
        """Execute an action on the component."""
        return self.action(action, params)


class WorkflowControl:
    """Workflow control interface."""

    def __init__(self, client: UIBridgeClient, workflow_id: str):
        self._client = client
        self._workflow_id = workflow_id

    def run(
        self,
        params: dict[str, Any] | None = None,
        *,
        start_step: str | None = None,
        stop_step: str | None = None,
    ) -> WorkflowRunResponse:
        """Run the workflow."""
        return self._client.run_workflow(
            self._workflow_id,
            params,
            start_step=start_step,
            stop_step=stop_step,
        )

    def __call__(
        self,
        params: dict[str, Any] | None = None,
    ) -> WorkflowRunResponse:
        """Run the workflow."""
        return self.run(params)


class RenderLogControl:
    """Render log control interface."""

    def __init__(self, client: UIBridgeClient):
        self._client = client

    def get(
        self,
        *,
        entry_type: str | None = None,
        since: int | None = None,
        until: int | None = None,
        limit: int | None = None,
    ) -> list[RenderLogEntry]:
        """Get render log entries."""
        return self._client.get_render_log(
            entry_type=entry_type,
            since=since,
            until=until,
            limit=limit,
        )

    def snapshot(self) -> dict[str, Any]:
        """Capture a DOM snapshot."""
        return self._client.capture_snapshot()

    def clear(self) -> None:
        """Clear the render log."""
        self._client.clear_render_log()


class StateControl:
    """State management control interface.

    Provides a fluent API for UI state management.

    Example:
        >>> client = UIBridgeClient()
        >>> client.state.active  # Get active state IDs
        ['dashboard', 'sidebar']
        >>> client.state.activate('modal')
        True
        >>> client.state.navigate_to(['checkout'])
        NavigationResult(success=True, ...)
    """

    def __init__(self, client: UIBridgeClient):
        self._client = client

    @property
    def active(self) -> list[str]:
        """Get currently active state IDs."""
        return self._client.get_active_states()

    @property
    def all(self) -> list[UIState]:
        """Get all registered states."""
        return self._client.get_states()

    @property
    def groups(self) -> list[UIStateGroup]:
        """Get all registered state groups."""
        return self._client.get_state_groups()

    @property
    def transitions(self) -> list[UITransition]:
        """Get all registered transitions."""
        return self._client.get_transitions()

    @property
    def snapshot(self) -> StateSnapshot:
        """Get a snapshot of all state management data."""
        return self._client.get_state_snapshot()

    def get(self, state_id: str) -> UIState:
        """Get a specific state."""
        return self._client.get_state(state_id)

    def is_active(self, state_id: str) -> bool:
        """Check if a state is currently active."""
        return self._client.is_state_active(state_id)

    def activate(self, state_id: str) -> bool:
        """Activate a state."""
        return self._client.activate_state(state_id)

    def deactivate(self, state_id: str) -> bool:
        """Deactivate a state."""
        return self._client.deactivate_state(state_id)

    def activate_group(self, group_id: str) -> list[str]:
        """Activate all states in a group."""
        return self._client.activate_state_group(group_id)

    def deactivate_group(self, group_id: str) -> list[str]:
        """Deactivate all states in a group."""
        return self._client.deactivate_state_group(group_id)

    def can_transition(self, transition_id: str) -> bool:
        """Check if a transition can be executed."""
        return self._client.can_execute_transition(transition_id)

    def transition(self, transition_id: str) -> TransitionResult:
        """Execute a transition."""
        return self._client.execute_transition(transition_id)

    def find_path(self, target_states: list[str]) -> PathResult:
        """Find a path to target states."""
        return self._client.find_path(target_states)

    def navigate_to(self, target_states: list[str]) -> NavigationResult:
        """Navigate to target states using pathfinding."""
        return self._client.navigate_to(target_states)
