"""
UI Bridge Client

Python client for controlling UI elements via UI Bridge HTTP API.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urljoin

import httpx

from .types import (
    ActionResponse,
    ComponentActionResponse,
    ControlSnapshot,
    DiscoveryResponse,
    ElementState,
    PerformanceMetrics,
    RenderLogEntry,
    WorkflowRunResponse,
)


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
    # Discovery
    # ==========================================================================

    def discover(
        self,
        *,
        root: str | None = None,
        interactive_only: bool = False,
        include_hidden: bool = False,
        limit: int | None = None,
        types: list[str] | None = None,
        selector: str | None = None,
    ) -> DiscoveryResponse:
        """
        Discover controllable elements in the UI.

        Args:
            root: Root element selector to start from
            interactive_only: Only discover interactive elements
            include_hidden: Include hidden elements
            limit: Maximum elements to return
            types: Filter by element types
            selector: Filter by CSS selector

        Returns:
            DiscoveryResponse with discovered elements
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

        data = self._request("POST", "/control/discover", json=request)
        return DiscoveryResponse.model_validate(data)

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
