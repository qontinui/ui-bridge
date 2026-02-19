"""
Async UI Bridge Client

Async Python client for controlling UI elements via UI Bridge HTTP API.
Mirrors UIBridgeClient with async/await for non-blocking operation.
"""

from __future__ import annotations

import time
import warnings
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import urljoin

import httpx

from .client import ActionFailedError, ElementNotFoundError, UIBridgeError
from .logging import (
    TraceContext,
    UIBridgeLogger,
)
from .types import (
    ActionResponse,
    AnnotationConfig,
    AnnotationCoverage,
    ComponentActionResponse,
    ComponentState,
    ControlSnapshot,
    ElementAnnotation,
    ElementState,
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
    WorkflowRunResponse,
)

if TYPE_CHECKING:
    from .ai_types import NLActionResponse
    from .async_ai import AsyncAIClient


class AsyncUIBridgeClient:
    """
    Async UI Bridge HTTP client.

    Provides async methods to control UI elements via the UI Bridge HTTP API.

    Example:
        >>> async with AsyncUIBridgeClient("http://localhost:9876") as client:
        ...     await client.click("submit-btn")
        ...     await client.type("email-input", "user@example.com")
        ...     await client.component("login-form").action("submit")
    """

    def __init__(
        self,
        base_url: str = "http://localhost:9876",
        *,
        timeout: float = 30.0,
        api_path: str = "/ui-bridge",
    ):
        """
        Initialize the async UI Bridge client.

        Args:
            base_url: Base URL of the UI Bridge server
            timeout: Request timeout in seconds
            api_path: API path prefix
        """
        self.base_url = base_url.rstrip("/")
        self.api_path = api_path.rstrip("/")
        self.timeout = timeout
        self._client = httpx.AsyncClient(timeout=timeout)
        self._logger: UIBridgeLogger | None = None
        self._active_trace: TraceContext | None = None

    async def __aenter__(self) -> AsyncUIBridgeClient:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    async def close(self) -> None:
        """Close the HTTP client."""
        await self._client.aclose()

    def _url(self, path: str) -> str:
        """Build full URL for an API path."""
        return urljoin(self.base_url, f"{self.api_path}{path}")

    # ==========================================================================
    # Logging
    # ==========================================================================

    def enable_logging(
        self,
        *,
        level: str = "info",
        file_path: str | Path | None = None,
        console: bool = False,
    ) -> AsyncUIBridgeClient:
        """
        Enable request/response logging.

        Args:
            level: Log level ("debug", "info", "warn", "error")
            file_path: Path to write JSONL logs
            console: Enable console output

        Returns:
            Self for chaining
        """
        self._logger = UIBridgeLogger()
        self._logger.enable(
            level=level,
            file_path=file_path,
            console=console,
        )
        return self

    def disable_logging(self) -> AsyncUIBridgeClient:
        """
        Disable logging.

        Returns:
            Self for chaining
        """
        if self._logger:
            self._logger.disable()
            self._logger = None
        return self

    def get_logger(self) -> UIBridgeLogger | None:
        """Get the logger instance."""
        return self._logger

    def start_trace(self) -> TraceContext:
        """
        Start a new trace for correlating related operations.

        Returns:
            TraceContext for passing to operations
        """
        if self._logger:
            self._active_trace = self._logger.start_trace()
            return self._active_trace
        return TraceContext(
            trace_id="00000000000000000000000000000000",
            span_id="0000000000000000",
        )

    def end_trace(self) -> None:
        """End the current trace."""
        if self._logger and self._active_trace:
            self._logger.end_trace(self._active_trace.trace_id)
        self._active_trace = None

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Make an async HTTP request and return the data."""
        start_time = time.time()

        if self._logger:
            self._logger.request_started(method, path, trace=self._active_trace)

        try:
            response = await self._client.request(
                method,
                self._url(path),
                json=json,
                params=params,
            )
            duration_ms = (time.time() - start_time) * 1000
            response.raise_for_status()
            result = response.json()

            if not result.get("success", False):
                error = result.get("error", "Unknown error")
                code = result.get("code")

                if self._logger:
                    self._logger.request_failed(
                        method,
                        path,
                        error_message=error,
                        duration_ms=duration_ms,
                        trace=self._active_trace,
                        status=response.status_code,
                    )

                if code == "NOT_FOUND":
                    raise ElementNotFoundError(error, code)
                raise UIBridgeError(error, code)

            if self._logger:
                self._logger.request_completed(
                    method,
                    path,
                    status=response.status_code,
                    duration_ms=duration_ms,
                    trace=self._active_trace,
                )

            return result.get("data")

        except httpx.HTTPStatusError as e:
            duration_ms = (time.time() - start_time) * 1000
            if self._logger:
                self._logger.request_failed(
                    method,
                    path,
                    error_message=str(e),
                    duration_ms=duration_ms,
                    trace=self._active_trace,
                    status=e.response.status_code if e.response else None,
                )
            raise

        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000
            if self._logger:
                self._logger.request_failed(
                    method,
                    path,
                    error_message=str(e),
                    duration_ms=duration_ms,
                    trace=self._active_trace,
                )
            raise

    # ==========================================================================
    # Element Actions
    # ==========================================================================

    async def click(
        self,
        element_id: str,
        *,
        wait_visible: bool = True,
        wait_enabled: bool = True,
        timeout: int | None = None,
    ) -> ActionResponse:
        """Click an element."""
        return await self._execute_action(
            element_id,
            "click",
            wait_visible=wait_visible,
            wait_enabled=wait_enabled,
            timeout=timeout,
        )

    async def double_click(
        self,
        element_id: str,
        *,
        wait_visible: bool = True,
        wait_enabled: bool = True,
        timeout: int | None = None,
    ) -> ActionResponse:
        """Double-click an element."""
        return await self._execute_action(
            element_id,
            "doubleClick",
            wait_visible=wait_visible,
            wait_enabled=wait_enabled,
            timeout=timeout,
        )

    async def right_click(
        self,
        element_id: str,
        *,
        wait_visible: bool = True,
        wait_enabled: bool = True,
        timeout: int | None = None,
    ) -> ActionResponse:
        """Right-click an element."""
        return await self._execute_action(
            element_id,
            "rightClick",
            wait_visible=wait_visible,
            wait_enabled=wait_enabled,
            timeout=timeout,
        )

    async def type(
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
        """Type text into an input element."""
        params: dict[str, Any] = {"text": text}
        if clear:
            params["clear"] = True
        if delay is not None:
            params["delay"] = delay

        return await self._execute_action(
            element_id,
            "type",
            params=params,
            wait_visible=wait_visible,
            wait_enabled=wait_enabled,
            timeout=timeout,
        )

    async def clear(
        self,
        element_id: str,
        *,
        wait_visible: bool = True,
        wait_enabled: bool = True,
        timeout: int | None = None,
    ) -> ActionResponse:
        """Clear an input element."""
        return await self._execute_action(
            element_id,
            "clear",
            wait_visible=wait_visible,
            wait_enabled=wait_enabled,
            timeout=timeout,
        )

    async def select(
        self,
        element_id: str,
        value: str | list[str],
        *,
        by_label: bool = False,
        wait_visible: bool = True,
        wait_enabled: bool = True,
        timeout: int | None = None,
    ) -> ActionResponse:
        """Select an option in a select element."""
        params: dict[str, Any] = {"value": value}
        if by_label:
            params["byLabel"] = True

        return await self._execute_action(
            element_id,
            "select",
            params=params,
            wait_visible=wait_visible,
            wait_enabled=wait_enabled,
            timeout=timeout,
        )

    async def focus(self, element_id: str) -> ActionResponse:
        """Focus an element."""
        return await self._execute_action(element_id, "focus")

    async def blur(self, element_id: str) -> ActionResponse:
        """Remove focus from an element."""
        return await self._execute_action(element_id, "blur")

    async def hover(self, element_id: str) -> ActionResponse:
        """Hover over an element."""
        return await self._execute_action(element_id, "hover")

    async def scroll(
        self,
        element_id: str,
        *,
        direction: str | None = None,
        amount: int | None = None,
        to_element: str | None = None,
        position: tuple[int, int] | None = None,
        smooth: bool = False,
    ) -> ActionResponse:
        """Scroll within an element."""
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

        return await self._execute_action(element_id, "scroll", params=params)

    async def check(self, element_id: str) -> ActionResponse:
        """Check a checkbox."""
        return await self._execute_action(element_id, "check")

    async def uncheck(self, element_id: str) -> ActionResponse:
        """Uncheck a checkbox."""
        return await self._execute_action(element_id, "uncheck")

    async def toggle(self, element_id: str) -> ActionResponse:
        """Toggle a checkbox."""
        return await self._execute_action(element_id, "toggle")

    async def set_value(self, element_id: str, value: str) -> ActionResponse:
        """Set the value of an input element directly."""
        return await self._execute_action(element_id, "setValue", params={"value": value})

    async def submit(self, element_id: str) -> ActionResponse:
        """Submit the form containing the element."""
        return await self._execute_action(element_id, "submit")

    async def reset(self, element_id: str) -> ActionResponse:
        """Reset the form containing the element."""
        return await self._execute_action(element_id, "reset")

    async def drag(
        self,
        element_id: str,
        *,
        target_element_id: str | None = None,
        target_selector: str | None = None,
        target_position: tuple[int, int] | None = None,
        source_offset: tuple[int, int] | None = None,
        target_offset: tuple[int, int] | None = None,
        steps: int | None = None,
        hold_delay: int | None = None,
        release_delay: int | None = None,
        html5: bool = False,
    ) -> ActionResponse:
        """Drag an element to a target."""
        params: dict[str, Any] = {}
        if target_element_id or target_selector:
            target: dict[str, str] = {}
            if target_element_id:
                target["elementId"] = target_element_id
            if target_selector:
                target["selector"] = target_selector
            params["target"] = target
        if target_position:
            params["targetPosition"] = {"x": target_position[0], "y": target_position[1]}
        if source_offset:
            params["sourceOffset"] = {"x": source_offset[0], "y": source_offset[1]}
        if target_offset:
            params["targetOffset"] = {"x": target_offset[0], "y": target_offset[1]}
        if steps is not None:
            params["steps"] = steps
        if hold_delay is not None:
            params["holdDelay"] = hold_delay
        if release_delay is not None:
            params["releaseDelay"] = release_delay
        if html5:
            params["html5"] = True

        return await self._execute_action(element_id, "drag", params=params)

    async def _execute_action(
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
        start_time = time.time()

        if self._logger:
            self._logger.action_started(element_id, action, trace=self._active_trace, params=params)

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

        try:
            data = await self._request(
                "POST",
                f"/control/element/{element_id}/action",
                json=request,
            )
            response = ActionResponse.model_validate(data)
            duration_ms = (time.time() - start_time) * 1000

            if not response.success:
                if self._logger:
                    error_code = (
                        response.failure_details.error_code.value
                        if response.failure_details
                        else "UNKNOWN"
                    )
                    self._logger.action_failed(
                        element_id,
                        action,
                        error_code=error_code,
                        error_message=response.error or "Action failed",
                        duration_ms=duration_ms,
                        trace=self._active_trace,
                    )
                raise ActionFailedError(response.error or "Action failed")

            if self._logger:
                self._logger.action_completed(
                    element_id,
                    action,
                    duration_ms=duration_ms,
                    trace=self._active_trace,
                    result=response.result,
                )

            return response

        except ActionFailedError:
            raise
        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000
            if self._logger:
                self._logger.action_failed(
                    element_id,
                    action,
                    error_code="NETWORK_ERROR",
                    error_message=str(e),
                    duration_ms=duration_ms,
                    trace=self._active_trace,
                )
            raise

    # ==========================================================================
    # Element State
    # ==========================================================================

    async def get_element(self, element_id: str) -> dict[str, Any]:
        """Get element details."""
        result: dict[str, Any] = await self._request("GET", f"/control/element/{element_id}")
        return result

    async def get_element_state(self, element_id: str) -> ElementState:
        """Get current element state."""
        data = await self._request("GET", f"/control/element/{element_id}/state")
        return ElementState.model_validate(data)

    async def get_elements(self) -> list[dict[str, Any]]:
        """Get all registered elements."""
        result: list[dict[str, Any]] = await self._request("GET", "/control/elements")
        return result

    # ==========================================================================
    # Components
    # ==========================================================================

    def component(self, component_id: str) -> AsyncComponentControl:
        """Get a component control interface."""
        return AsyncComponentControl(self, component_id)

    async def get_component(self, component_id: str) -> dict[str, Any]:
        """Get component details."""
        result: dict[str, Any] = await self._request("GET", f"/control/component/{component_id}")
        return result

    async def get_components(self) -> list[dict[str, Any]]:
        """Get all registered components."""
        result: list[dict[str, Any]] = await self._request("GET", "/control/components")
        return result

    async def get_component_state(self, component_id: str) -> ComponentState:
        """Get the current state and computed properties of a component."""
        data = await self._request("GET", f"/control/component/{component_id}/state")
        return ComponentState.model_validate(data)

    async def execute_component_action(
        self,
        component_id: str,
        action: str,
        params: dict[str, Any] | None = None,
    ) -> ComponentActionResponse:
        """Execute an action on a component."""
        request: dict[str, Any] = {"action": action}
        if params:
            request["params"] = params

        data = await self._request(
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

    async def find(
        self,
        *,
        root: str | None = None,
        interactive_only: bool = False,
        include_hidden: bool = False,
        limit: int | None = None,
        types: list[str] | None = None,
        selector: str | None = None,
    ) -> FindResponse:
        """Find controllable elements in the UI."""
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

        data = await self._request("POST", "/control/find", json=request)
        return FindResponse.model_validate(data)

    async def discover(
        self,
        *,
        root: str | None = None,
        interactive_only: bool = False,
        include_hidden: bool = False,
        limit: int | None = None,
        types: list[str] | None = None,
        selector: str | None = None,
    ) -> FindResponse:
        """Discover controllable elements (deprecated, use find())."""
        warnings.warn(
            "discover() is deprecated, use find() instead",
            DeprecationWarning,
            stacklevel=2,
        )
        return await self.find(
            root=root,
            interactive_only=interactive_only,
            include_hidden=include_hidden,
            limit=limit,
            types=types,
            selector=selector,
        )

    async def get_snapshot(self) -> ControlSnapshot:
        """Get a full control snapshot."""
        data = await self._request("GET", "/control/snapshot")
        return ControlSnapshot.model_validate(data)

    # ==========================================================================
    # Workflows
    # ==========================================================================

    def workflow(self, workflow_id: str) -> AsyncWorkflowControl:
        """Get a workflow control interface."""
        return AsyncWorkflowControl(self, workflow_id)

    async def get_workflows(self) -> list[dict[str, Any]]:
        """Get all registered workflows."""
        result: list[dict[str, Any]] = await self._request("GET", "/control/workflows")
        return result

    async def run_workflow(
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

        data = await self._request(
            "POST",
            f"/control/workflow/{workflow_id}/run",
            json=request,
        )
        return WorkflowRunResponse.model_validate(data)

    async def get_workflow_status(self, run_id: str) -> WorkflowRunResponse:
        """Get workflow run status."""
        data = await self._request("GET", f"/control/workflow/{run_id}/status")
        return WorkflowRunResponse.model_validate(data)

    # ==========================================================================
    # State Management
    # ==========================================================================

    @property
    def state(self) -> AsyncStateControl:
        """Get state management control interface."""
        return AsyncStateControl(self)

    async def get_states(self) -> list[UIState]:
        """Get all registered states."""
        data = await self._request("GET", "/control/states")
        return [UIState.model_validate(s) for s in data]

    async def get_state(self, state_id: str) -> UIState:
        """Get a specific state."""
        data = await self._request("GET", f"/control/state/{state_id}")
        return UIState.model_validate(data)

    async def get_active_states(self) -> list[str]:
        """Get currently active state IDs."""
        result: list[str] = await self._request("GET", "/control/states/active")
        return result

    async def is_state_active(self, state_id: str) -> bool:
        """Check if a state is currently active."""
        active = await self.get_active_states()
        return state_id in active

    async def activate_state(self, state_id: str) -> bool:
        """Activate a state."""
        data: dict[str, Any] = await self._request("POST", f"/control/state/{state_id}/activate")
        return bool(data.get("success", False))

    async def deactivate_state(self, state_id: str) -> bool:
        """Deactivate a state."""
        data: dict[str, Any] = await self._request("POST", f"/control/state/{state_id}/deactivate")
        return bool(data.get("success", False))

    async def get_state_groups(self) -> list[UIStateGroup]:
        """Get all registered state groups."""
        data: list[Any] = await self._request("GET", "/control/state-groups")
        return [UIStateGroup.model_validate(g) for g in data]

    async def activate_state_group(self, group_id: str) -> list[str]:
        """Activate all states in a group."""
        data: dict[str, Any] = await self._request(
            "POST", f"/control/state-group/{group_id}/activate"
        )
        result: list[str] = data.get("activated", [])
        return result

    async def deactivate_state_group(self, group_id: str) -> list[str]:
        """Deactivate all states in a group."""
        data: dict[str, Any] = await self._request(
            "POST", f"/control/state-group/{group_id}/deactivate"
        )
        result: list[str] = data.get("deactivated", [])
        return result

    async def get_transitions(self) -> list[UITransition]:
        """Get all registered transitions."""
        data: list[Any] = await self._request("GET", "/control/transitions")
        return [UITransition.model_validate(t) for t in data]

    async def can_execute_transition(self, transition_id: str) -> bool:
        """Check if a transition can be executed from current state."""
        data: dict[str, Any] = await self._request(
            "GET", f"/control/transition/{transition_id}/can-execute"
        )
        return bool(data.get("canExecute", False))

    async def execute_transition(self, transition_id: str) -> TransitionResult:
        """Execute a transition."""
        data = await self._request("POST", f"/control/transition/{transition_id}/execute")
        return TransitionResult.model_validate(data)

    async def find_path(self, target_states: list[str]) -> PathResult:
        """Find a path to target states."""
        data = await self._request(
            "POST",
            "/control/states/find-path",
            json={"targetStates": target_states},
        )
        return PathResult.model_validate(data)

    async def navigate_to(self, target_states: list[str]) -> NavigationResult:
        """Navigate to target states using pathfinding."""
        data = await self._request(
            "POST",
            "/control/states/navigate",
            json={"targetStates": target_states},
        )
        return NavigationResult.model_validate(data)

    async def get_state_snapshot(self) -> StateSnapshot:
        """Get a snapshot of all state management data."""
        data = await self._request("GET", "/control/states/snapshot")
        return StateSnapshot.model_validate(data)

    # ==========================================================================
    # Render Log
    # ==========================================================================

    @property
    def render_log(self) -> AsyncRenderLogControl:
        """Get render log control interface."""
        return AsyncRenderLogControl(self)

    async def get_render_log(
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

        data = await self._request("GET", "/render-log", params=params)
        return [RenderLogEntry.model_validate(entry) for entry in data]

    async def capture_snapshot(self) -> dict[str, Any]:
        """Capture a DOM snapshot."""
        result: dict[str, Any] = await self._request("POST", "/render-log/snapshot")
        return result

    async def clear_render_log(self) -> None:
        """Clear the render log."""
        await self._request("DELETE", "/render-log")

    # ==========================================================================
    # Debug
    # ==========================================================================

    async def get_action_history(self, limit: int | None = None) -> list[dict[str, Any]]:
        """Get action history."""
        params = {"limit": limit} if limit else None
        result: list[dict[str, Any]] = await self._request(
            "GET", "/debug/action-history", params=params
        )
        return result

    async def get_metrics(self) -> PerformanceMetrics:
        """Get performance metrics."""
        data = await self._request("GET", "/debug/metrics")
        return PerformanceMetrics.model_validate(data)

    async def highlight_element(self, element_id: str) -> None:
        """Highlight an element visually."""
        await self._request("POST", f"/debug/highlight/{element_id}")

    # ==========================================================================
    # Health
    # ==========================================================================

    async def health(self) -> dict[str, Any]:
        """Check server health."""
        response = await self._client.get(urljoin(self.base_url, "/health"))
        response.raise_for_status()
        result: dict[str, Any] = response.json()
        return result

    async def is_connected(self) -> bool:
        """Check if connected to the server."""
        try:
            await self.health()
            return True
        except Exception:
            return False

    # ==========================================================================
    # AI-Native Interface
    # ==========================================================================

    @property
    def ai(self) -> AsyncAIClient:
        """
        AI-native interface for natural language interaction.

        Provides semantic search, natural language actions, and assertions.

        Example:
            >>> async with AsyncUIBridgeClient() as client:
            ...     await client.ai.execute("click the Submit button")
            ...     await client.ai.assert_that("error message", "hidden")
        """
        from .async_ai import AsyncAIClient

        if not hasattr(self, "_ai_client"):
            self._ai_client = AsyncAIClient(self)
        return self._ai_client

    # ==========================================================================
    # Annotations
    # ==========================================================================

    @property
    def annotations(self) -> AsyncAnnotationControl:
        """Get annotation control interface."""
        return AsyncAnnotationControl(self)

    # ==========================================================================
    # AI Convenience Methods
    # ==========================================================================

    async def click_text(self, text: str) -> NLActionResponse:
        """Click an element by its visible text."""
        return await self.ai.click(text)

    async def type_into(self, target: str, text: str) -> NLActionResponse:
        """Type text into an element by description."""
        return await self.ai.type_text(target, text)


class AsyncComponentControl:
    """Async component action control interface."""

    def __init__(self, client: AsyncUIBridgeClient, component_id: str):
        self._client = client
        self._component_id = component_id

    async def get_state(self) -> ComponentState:
        """Get the current state of the component."""
        return await self._client.get_component_state(self._component_id)

    async def action(
        self,
        action: str,
        params: dict[str, Any] | None = None,
    ) -> ComponentActionResponse:
        """Execute an action on the component."""
        return await self._client.execute_component_action(self._component_id, action, params)

    async def __call__(
        self,
        action: str,
        params: dict[str, Any] | None = None,
    ) -> ComponentActionResponse:
        """Execute an action on the component."""
        return await self.action(action, params)


class AsyncWorkflowControl:
    """Async workflow control interface."""

    def __init__(self, client: AsyncUIBridgeClient, workflow_id: str):
        self._client = client
        self._workflow_id = workflow_id

    async def run(
        self,
        params: dict[str, Any] | None = None,
        *,
        start_step: str | None = None,
        stop_step: str | None = None,
    ) -> WorkflowRunResponse:
        """Run the workflow."""
        return await self._client.run_workflow(
            self._workflow_id,
            params,
            start_step=start_step,
            stop_step=stop_step,
        )

    async def __call__(
        self,
        params: dict[str, Any] | None = None,
    ) -> WorkflowRunResponse:
        """Run the workflow."""
        return await self.run(params)


class AsyncRenderLogControl:
    """Async render log control interface."""

    def __init__(self, client: AsyncUIBridgeClient):
        self._client = client

    async def get(
        self,
        *,
        entry_type: str | None = None,
        since: int | None = None,
        until: int | None = None,
        limit: int | None = None,
    ) -> list[RenderLogEntry]:
        """Get render log entries."""
        return await self._client.get_render_log(
            entry_type=entry_type,
            since=since,
            until=until,
            limit=limit,
        )

    async def snapshot(self) -> dict[str, Any]:
        """Capture a DOM snapshot."""
        return await self._client.capture_snapshot()

    async def clear(self) -> None:
        """Clear the render log."""
        await self._client.clear_render_log()


class AsyncStateControl:
    """Async state management control interface.

    Note: Properties that make HTTP calls in the sync version
    are async methods here (get_active, get_all, etc.).

    Example:
        >>> async with AsyncUIBridgeClient() as client:
        ...     active = await client.state.get_active()
        ...     await client.state.activate('modal')
        ...     await client.state.navigate_to(['checkout'])
    """

    def __init__(self, client: AsyncUIBridgeClient):
        self._client = client

    async def get_active(self) -> list[str]:
        """Get currently active state IDs."""
        return await self._client.get_active_states()

    async def get_all(self) -> list[UIState]:
        """Get all registered states."""
        return await self._client.get_states()

    async def get_groups(self) -> list[UIStateGroup]:
        """Get all registered state groups."""
        return await self._client.get_state_groups()

    async def get_transitions(self) -> list[UITransition]:
        """Get all registered transitions."""
        return await self._client.get_transitions()

    async def get_snapshot(self) -> StateSnapshot:
        """Get a snapshot of all state management data."""
        return await self._client.get_state_snapshot()

    async def get(self, state_id: str) -> UIState:
        """Get a specific state."""
        return await self._client.get_state(state_id)

    async def is_active(self, state_id: str) -> bool:
        """Check if a state is currently active."""
        return await self._client.is_state_active(state_id)

    async def activate(self, state_id: str) -> bool:
        """Activate a state."""
        return await self._client.activate_state(state_id)

    async def deactivate(self, state_id: str) -> bool:
        """Deactivate a state."""
        return await self._client.deactivate_state(state_id)

    async def activate_group(self, group_id: str) -> list[str]:
        """Activate all states in a group."""
        return await self._client.activate_state_group(group_id)

    async def deactivate_group(self, group_id: str) -> list[str]:
        """Deactivate all states in a group."""
        return await self._client.deactivate_state_group(group_id)

    async def can_transition(self, transition_id: str) -> bool:
        """Check if a transition can be executed."""
        return await self._client.can_execute_transition(transition_id)

    async def transition(self, transition_id: str) -> TransitionResult:
        """Execute a transition."""
        return await self._client.execute_transition(transition_id)

    async def find_path(self, target_states: list[str]) -> PathResult:
        """Find a path to target states."""
        return await self._client.find_path(target_states)

    async def navigate_to(self, target_states: list[str]) -> NavigationResult:
        """Navigate to target states using pathfinding."""
        return await self._client.navigate_to(target_states)


class AsyncAnnotationControl:
    """Async annotation control interface.

    Example:
        >>> async with AsyncUIBridgeClient() as client:
        ...     await client.annotations.set('btn-1', ElementAnnotation(description='Submit'))
        ...     ann = await client.annotations.get('btn-1')
        ...     cov = await client.annotations.coverage()
    """

    def __init__(self, client: AsyncUIBridgeClient):
        self._client = client

    async def get(self, element_id: str) -> ElementAnnotation:
        """Get an annotation by element ID."""
        data = await self._client._request("GET", f"/annotations/{element_id}")
        return ElementAnnotation.model_validate(data)

    async def set(self, element_id: str, annotation: ElementAnnotation) -> ElementAnnotation:
        """Set an annotation for an element."""
        data = await self._client._request(
            "PUT",
            f"/annotations/{element_id}",
            json=annotation.model_dump(by_alias=True, exclude_none=True),
        )
        return ElementAnnotation.model_validate(data)

    async def delete(self, element_id: str) -> None:
        """Delete an annotation."""
        await self._client._request("DELETE", f"/annotations/{element_id}")

    async def list(self) -> dict[str, ElementAnnotation]:
        """Get all annotations."""
        data = await self._client._request("GET", "/annotations")
        return {k: ElementAnnotation.model_validate(v) for k, v in data.items()}

    async def export_config(self) -> AnnotationConfig:
        """Export all annotations as a config object."""
        data = await self._client._request("GET", "/annotations/export")
        return AnnotationConfig.model_validate(data)

    async def import_config(self, config: AnnotationConfig) -> int:
        """Import annotations from a config object."""
        data: dict[str, Any] = await self._client._request(
            "POST",
            "/annotations/import",
            json=config.model_dump(by_alias=True, exclude_none=True),
        )
        result: int = data.get("count", 0)
        return result

    async def import_file(self, path: str | Path) -> int:
        """Import annotations from a JSON file."""
        import json

        file_path = Path(path)
        with file_path.open() as f:
            raw = json.load(f)

        config = AnnotationConfig.model_validate(raw)
        return await self.import_config(config)

    async def coverage(self) -> AnnotationCoverage:
        """Get annotation coverage statistics."""
        data = await self._client._request("GET", "/annotations/coverage")
        return AnnotationCoverage.model_validate(data)
