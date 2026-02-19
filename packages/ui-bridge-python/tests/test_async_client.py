"""Tests for async UI Bridge client."""

from __future__ import annotations

import warnings
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from ui_bridge.async_client import (
    AsyncUIBridgeClient,
)
from ui_bridge.client import ActionFailedError, ElementNotFoundError, UIBridgeError

# =============================================================================
# Helpers
# =============================================================================


def _action_data(
    success: bool = True,
    duration: float = 50.0,
    error: str | None = None,
) -> dict[str, Any]:
    """Build a standard action response dict."""
    data: dict[str, Any] = {
        "success": success,
        "durationMs": duration,
        "timestamp": 1234567890,
    }
    if error:
        data["error"] = error
    return data


def _find_data(
    elements: list[dict[str, Any]] | None = None,
    total: int | None = None,
) -> dict[str, Any]:
    """Build a standard find response dict."""
    if elements is None:
        elements = [
            {
                "id": "btn-1",
                "type": "button",
                "tagName": "button",
                "state": {
                    "visible": True,
                    "enabled": True,
                    "focused": False,
                    "rect": {
                        "x": 0,
                        "y": 0,
                        "width": 100,
                        "height": 50,
                        "top": 0,
                        "right": 100,
                        "bottom": 50,
                        "left": 0,
                    },
                },
                "actions": ["click"],
                "registered": True,
            }
        ]
    if total is None:
        total = len(elements)
    return {
        "elements": elements,
        "total": total,
        "durationMs": 15.5,
        "timestamp": 1234567890,
    }


def _component_action_data(
    success: bool = True,
    result: Any = None,
    error: str | None = None,
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "success": success,
        "durationMs": 200.0,
        "timestamp": 1234567890,
    }
    if result is not None:
        data["result"] = result
    if error:
        data["error"] = error
    return data


def _workflow_run_data(
    workflow_id: str = "test-workflow",
    success: bool = True,
) -> dict[str, Any]:
    return {
        "workflowId": workflow_id,
        "runId": "run-123",
        "status": "completed",
        "steps": [],
        "totalSteps": 3,
        "success": success,
        "startedAt": 1234567890,
        "completedAt": 1234567891,
        "durationMs": 1500.0,
    }


def _element_state_dict() -> dict[str, Any]:
    return {
        "visible": True,
        "enabled": True,
        "focused": False,
        "rect": {
            "x": 0,
            "y": 0,
            "width": 100,
            "height": 50,
            "top": 0,
            "right": 100,
            "bottom": 50,
            "left": 0,
        },
    }


def _ai_element_dict(element_id: str = "btn-1") -> dict[str, Any]:
    return {
        "id": element_id,
        "type": "button",
        "tagName": "button",
        "role": "button",
        "accessibleName": "Submit",
        "actions": ["click"],
        "state": _element_state_dict(),
        "registered": True,
        "description": "Submit button",
        "aliases": ["submit", "go"],
        "suggestedActions": ["click"],
    }


def _search_response_data() -> dict[str, Any]:
    return {
        "results": [
            {
                "element": _ai_element_dict(),
                "confidence": 0.95,
                "matchReasons": ["text"],
                "scores": {"text": 0.95},
            }
        ],
        "bestMatch": {
            "element": _ai_element_dict(),
            "confidence": 0.95,
            "matchReasons": ["text"],
            "scores": {"text": 0.95},
        },
        "scannedCount": 10,
        "durationMs": 25.0,
        "criteria": {"text": "Submit"},
        "timestamp": 1234567890,
    }


def _nl_action_response_data(
    success: bool = True,
    error: str | None = None,
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "success": success,
        "executedAction": "click",
        "elementUsed": _ai_element_dict(),
        "confidence": 0.95,
        "elementState": _element_state_dict(),
        "durationMs": 100.0,
        "timestamp": 1234567890,
    }
    if error:
        data["error"] = error
    return data


def _assertion_result_data(passed: bool = True) -> dict[str, Any]:
    return {
        "passed": passed,
        "target": "btn-1",
        "targetDescription": "Submit button",
        "expected": True,
        "actual": True,
        "durationMs": 10.0,
        "timestamp": 1234567890,
    }


# =============================================================================
# AsyncUIBridgeClient Initialization
# =============================================================================


class TestAsyncUIBridgeClientInit:
    """Tests for AsyncUIBridgeClient initialization."""

    def test_init_default_url(self) -> None:
        client = AsyncUIBridgeClient()
        assert client.base_url == "http://localhost:9876"

    def test_init_custom_url(self) -> None:
        client = AsyncUIBridgeClient(base_url="http://localhost:8080")
        assert client.base_url == "http://localhost:8080"

    def test_init_strips_trailing_slash(self) -> None:
        client = AsyncUIBridgeClient(base_url="http://localhost:8080/")
        assert client.base_url == "http://localhost:8080"

    def test_init_custom_api_path(self) -> None:
        client = AsyncUIBridgeClient(api_path="/api/ui")
        assert client.api_path == "/api/ui"

    def test_init_strips_api_path_trailing_slash(self) -> None:
        client = AsyncUIBridgeClient(api_path="/api/ui/")
        assert client.api_path == "/api/ui"

    def test_init_default_api_path(self) -> None:
        client = AsyncUIBridgeClient()
        assert client.api_path == "/ui-bridge"

    def test_init_custom_timeout(self) -> None:
        client = AsyncUIBridgeClient(timeout=60.0)
        assert client.timeout == 60.0


# =============================================================================
# Context Manager
# =============================================================================


class TestAsyncUIBridgeClientContextManager:
    """Tests for async context manager."""

    @pytest.mark.asyncio
    async def test_async_with_creates_and_closes_client(self) -> None:
        async with AsyncUIBridgeClient() as client:
            assert client._client is not None
            assert not client._client.is_closed
        # After exiting context, the httpx client should be closed
        assert client._client.is_closed

    @pytest.mark.asyncio
    async def test_close_method(self) -> None:
        client = AsyncUIBridgeClient()
        assert not client._client.is_closed
        await client.close()
        assert client._client.is_closed


# =============================================================================
# Element Actions
# =============================================================================


class TestAsyncUIBridgeClientActions:
    """Tests for AsyncUIBridgeClient action methods."""

    @pytest.fixture
    def client(self) -> AsyncUIBridgeClient:
        return AsyncUIBridgeClient(base_url="http://localhost:9876")

    @pytest.mark.asyncio
    async def test_click(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_action_data())  # type: ignore[method-assign]
        result = await client.click("btn-1")

        assert result.success is True
        assert result.duration_ms == 50.0
        client._request.assert_called_once_with(
            "POST",
            "/control/element/btn-1/action",
            json={
                "action": "click",
                "waitOptions": {"visible": True, "enabled": True},
            },
        )

    @pytest.mark.asyncio
    async def test_type(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_action_data(duration=100.0))  # type: ignore[method-assign]
        result = await client.type("input-1", "Hello World")

        assert result.success is True
        client._request.assert_called_once()
        call_kwargs = client._request.call_args
        assert call_kwargs[1]["json"]["params"]["text"] == "Hello World"
        assert call_kwargs[1]["json"]["action"] == "type"

    @pytest.mark.asyncio
    async def test_type_with_clear(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_action_data())  # type: ignore[method-assign]
        await client.type("input-1", "text", clear=True)

        call_kwargs = client._request.call_args
        assert call_kwargs[1]["json"]["params"]["clear"] is True

    @pytest.mark.asyncio
    async def test_type_with_delay(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_action_data())  # type: ignore[method-assign]
        await client.type("input-1", "text", delay=50)

        call_kwargs = client._request.call_args
        assert call_kwargs[1]["json"]["params"]["delay"] == 50

    @pytest.mark.asyncio
    async def test_clear(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_action_data(duration=20.0))  # type: ignore[method-assign]
        result = await client.clear("input-1")

        assert result.success is True
        client._request.assert_called_once_with(
            "POST",
            "/control/element/input-1/action",
            json={
                "action": "clear",
                "waitOptions": {"visible": True, "enabled": True},
            },
        )

    @pytest.mark.asyncio
    async def test_focus(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_action_data(duration=5.0))  # type: ignore[method-assign]
        result = await client.focus("input-1")

        assert result.success is True
        client._request.assert_called_once_with(
            "POST",
            "/control/element/input-1/action",
            json={"action": "focus"},
        )

    @pytest.mark.asyncio
    async def test_blur(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_action_data())  # type: ignore[method-assign]
        result = await client.blur("input-1")

        assert result.success is True
        call_kwargs = client._request.call_args
        assert call_kwargs[1]["json"]["action"] == "blur"

    @pytest.mark.asyncio
    async def test_hover(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_action_data())  # type: ignore[method-assign]
        result = await client.hover("btn-1")

        assert result.success is True
        call_kwargs = client._request.call_args
        assert call_kwargs[1]["json"]["action"] == "hover"

    @pytest.mark.asyncio
    async def test_select(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_action_data(duration=30.0))  # type: ignore[method-assign]
        result = await client.select("dropdown-1", value="option-2")

        assert result.success is True
        call_kwargs = client._request.call_args
        assert call_kwargs[1]["json"]["params"]["value"] == "option-2"
        assert call_kwargs[1]["json"]["action"] == "select"

    @pytest.mark.asyncio
    async def test_select_by_label(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_action_data())  # type: ignore[method-assign]
        await client.select("dropdown-1", value="Option 2", by_label=True)

        call_kwargs = client._request.call_args
        assert call_kwargs[1]["json"]["params"]["byLabel"] is True

    @pytest.mark.asyncio
    async def test_double_click(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_action_data())  # type: ignore[method-assign]
        result = await client.double_click("btn-1")

        assert result.success is True
        call_kwargs = client._request.call_args
        assert call_kwargs[1]["json"]["action"] == "doubleClick"

    @pytest.mark.asyncio
    async def test_right_click(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_action_data())  # type: ignore[method-assign]
        result = await client.right_click("btn-1")

        assert result.success is True
        call_kwargs = client._request.call_args
        assert call_kwargs[1]["json"]["action"] == "rightClick"

    @pytest.mark.asyncio
    async def test_check(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_action_data())  # type: ignore[method-assign]
        result = await client.check("checkbox-1")

        assert result.success is True
        call_kwargs = client._request.call_args
        assert call_kwargs[1]["json"]["action"] == "check"

    @pytest.mark.asyncio
    async def test_uncheck(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_action_data())  # type: ignore[method-assign]
        result = await client.uncheck("checkbox-1")

        assert result.success is True
        call_kwargs = client._request.call_args
        assert call_kwargs[1]["json"]["action"] == "uncheck"

    @pytest.mark.asyncio
    async def test_toggle(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_action_data())  # type: ignore[method-assign]
        result = await client.toggle("checkbox-1")

        assert result.success is True
        call_kwargs = client._request.call_args
        assert call_kwargs[1]["json"]["action"] == "toggle"

    @pytest.mark.asyncio
    async def test_set_value(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_action_data())  # type: ignore[method-assign]
        result = await client.set_value("input-1", "new-value")

        assert result.success is True
        call_kwargs = client._request.call_args
        assert call_kwargs[1]["json"]["action"] == "setValue"
        assert call_kwargs[1]["json"]["params"]["value"] == "new-value"

    @pytest.mark.asyncio
    async def test_submit(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_action_data())  # type: ignore[method-assign]
        result = await client.submit("form-1")

        assert result.success is True
        call_kwargs = client._request.call_args
        assert call_kwargs[1]["json"]["action"] == "submit"

    @pytest.mark.asyncio
    async def test_scroll(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_action_data())  # type: ignore[method-assign]
        result = await client.scroll("container-1", direction="down", amount=200)

        assert result.success is True
        call_kwargs = client._request.call_args
        assert call_kwargs[1]["json"]["params"]["direction"] == "down"
        assert call_kwargs[1]["json"]["params"]["amount"] == 200

    @pytest.mark.asyncio
    async def test_action_failure_raises(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(  # type: ignore[method-assign]
            return_value=_action_data(success=False, error="Element is disabled")
        )

        with pytest.raises(ActionFailedError) as exc_info:
            await client.click("btn-1")

        assert "Element is disabled" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_click_with_timeout(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_action_data())  # type: ignore[method-assign]
        await client.click("btn-1", timeout=5000)

        call_kwargs = client._request.call_args
        assert call_kwargs[1]["json"]["waitOptions"]["timeout"] == 5000

    @pytest.mark.asyncio
    async def test_click_no_wait_options(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_action_data())  # type: ignore[method-assign]
        await client.click("btn-1", wait_visible=False, wait_enabled=False)

        call_kwargs = client._request.call_args
        assert "waitOptions" not in call_kwargs[1]["json"]


# =============================================================================
# Find / Discovery
# =============================================================================


class TestAsyncUIBridgeClientFind:
    """Tests for AsyncUIBridgeClient find methods."""

    @pytest.fixture
    def client(self) -> AsyncUIBridgeClient:
        return AsyncUIBridgeClient(base_url="http://localhost:9876")

    @pytest.mark.asyncio
    async def test_find(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_find_data())  # type: ignore[method-assign]
        result = await client.find()

        assert len(result.elements) == 1
        assert result.elements[0].id == "btn-1"
        assert result.total == 1
        client._request.assert_called_once_with("POST", "/control/find", json={})

    @pytest.mark.asyncio
    async def test_find_with_filters(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_find_data())  # type: ignore[method-assign]
        await client.find(
            root="form-1",
            interactive_only=True,
            include_hidden=True,
            limit=10,
            types=["button"],
            selector=".btn",
        )

        call_kwargs = client._request.call_args
        payload = call_kwargs[1]["json"]
        assert payload["root"] == "form-1"
        assert payload["interactiveOnly"] is True
        assert payload["includeHidden"] is True
        assert payload["limit"] == 10
        assert payload["types"] == ["button"]
        assert payload["selector"] == ".btn"

    @pytest.mark.asyncio
    async def test_discover_deprecated(self, client: AsyncUIBridgeClient) -> None:
        """Test that deprecated discover() still works and emits a warning."""
        client._request = AsyncMock(return_value=_find_data(elements=[], total=0))  # type: ignore[method-assign]

        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            await client.discover()
            assert len(w) == 1
            assert issubclass(w[0].category, DeprecationWarning)
            assert "discover()" in str(w[0].message)


# =============================================================================
# Components
# =============================================================================


class TestAsyncUIBridgeClientComponents:
    """Tests for AsyncUIBridgeClient component methods."""

    @pytest.fixture
    def client(self) -> AsyncUIBridgeClient:
        return AsyncUIBridgeClient(base_url="http://localhost:9876")

    @pytest.mark.asyncio
    async def test_execute_component_action(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(  # type: ignore[method-assign]
            return_value=_component_action_data(result={"submitted": True})
        )
        result = await client.execute_component_action(
            "form-1", "submit", params={"email": "test@example.com"}
        )

        assert result.success is True
        assert result.result["submitted"] is True
        client._request.assert_called_once_with(
            "POST",
            "/control/component/form-1/action/submit",
            json={"action": "submit", "params": {"email": "test@example.com"}},
        )

    @pytest.mark.asyncio
    async def test_execute_component_action_no_params(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(  # type: ignore[method-assign]
            return_value=_component_action_data()
        )
        result = await client.execute_component_action("form-1", "submit")

        assert result.success is True
        call_kwargs = client._request.call_args
        assert "params" not in call_kwargs[1]["json"]

    @pytest.mark.asyncio
    async def test_execute_component_action_failure(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(  # type: ignore[method-assign]
            return_value=_component_action_data(success=False, error="Validation failed")
        )

        with pytest.raises(ActionFailedError) as exc_info:
            await client.execute_component_action("form-1", "submit")

        assert "Validation failed" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_get_component_state(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(  # type: ignore[method-assign]
            return_value={
                "state": {"count": 5},
                "computed": {"isLoading": False},
                "timestamp": 1234567890,
            }
        )
        result = await client.get_component_state("counter-1")

        assert result.state["count"] == 5
        assert result.computed["isLoading"] is False
        client._request.assert_called_once_with("GET", "/control/component/counter-1/state")


# =============================================================================
# Workflows
# =============================================================================


class TestAsyncUIBridgeClientWorkflows:
    """Tests for AsyncUIBridgeClient workflow methods."""

    @pytest.fixture
    def client(self) -> AsyncUIBridgeClient:
        return AsyncUIBridgeClient(base_url="http://localhost:9876")

    @pytest.mark.asyncio
    async def test_run_workflow(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_workflow_run_data())  # type: ignore[method-assign]
        result = await client.run_workflow(
            workflow_id="test-workflow",
            params={"email": "test@example.com"},
        )

        assert result.workflow_id == "test-workflow"
        assert result.success is True
        assert result.run_id == "run-123"

    @pytest.mark.asyncio
    async def test_run_workflow_with_options(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_workflow_run_data())  # type: ignore[method-assign]
        await client.run_workflow(
            workflow_id="test-workflow",
            params={"key": "val"},
            start_step="step-2",
            stop_step="step-5",
            step_timeout=3000,
            workflow_timeout=30000,
        )

        call_kwargs = client._request.call_args
        payload = call_kwargs[1]["json"]
        assert payload["params"] == {"key": "val"}
        assert payload["startStep"] == "step-2"
        assert payload["stopStep"] == "step-5"
        assert payload["stepTimeout"] == 3000
        assert payload["workflowTimeout"] == 30000

    @pytest.mark.asyncio
    async def test_get_workflow_status(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_workflow_run_data())  # type: ignore[method-assign]
        result = await client.get_workflow_status("run-123")

        assert result.run_id == "run-123"
        client._request.assert_called_once_with("GET", "/control/workflow/run-123/status")


# =============================================================================
# Error Handling
# =============================================================================


class TestAsyncUIBridgeClientErrors:
    """Tests for AsyncUIBridgeClient error handling."""

    @pytest.fixture
    def client(self) -> AsyncUIBridgeClient:
        return AsyncUIBridgeClient(base_url="http://localhost:9876")

    @pytest.mark.asyncio
    async def test_not_found_raises_element_not_found_error(
        self, client: AsyncUIBridgeClient
    ) -> None:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "success": False,
            "error": "Element not found",
            "code": "NOT_FOUND",
        }
        client._client.request = AsyncMock(return_value=mock_response)  # type: ignore[method-assign]

        with pytest.raises(ElementNotFoundError) as exc_info:
            await client.click("nonexistent")

        assert "Element not found" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_generic_error_raises_ui_bridge_error(self, client: AsyncUIBridgeClient) -> None:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "success": False,
            "error": "Internal server error",
        }
        client._client.request = AsyncMock(return_value=mock_response)  # type: ignore[method-assign]

        with pytest.raises(UIBridgeError) as exc_info:
            await client.click("btn-1")

        assert "Internal server error" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_action_failed_raises_action_failed_error(
        self, client: AsyncUIBridgeClient
    ) -> None:
        client._request = AsyncMock(  # type: ignore[method-assign]
            return_value=_action_data(success=False, error="Element is disabled")
        )

        with pytest.raises(ActionFailedError) as exc_info:
            await client.click("btn-1")

        assert "Element is disabled" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_error_code_preserved(self, client: AsyncUIBridgeClient) -> None:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "success": False,
            "error": "Not found",
            "code": "NOT_FOUND",
        }
        client._client.request = AsyncMock(return_value=mock_response)  # type: ignore[method-assign]

        with pytest.raises(ElementNotFoundError) as exc_info:
            await client.find()

        assert exc_info.value.code == "NOT_FOUND"

    @pytest.mark.asyncio
    async def test_generic_error_code_preserved(self, client: AsyncUIBridgeClient) -> None:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "success": False,
            "error": "Server overloaded",
            "code": "SERVER_ERROR",
        }
        client._client.request = AsyncMock(return_value=mock_response)  # type: ignore[method-assign]

        with pytest.raises(UIBridgeError) as exc_info:
            await client.click("btn-1")

        assert exc_info.value.code == "SERVER_ERROR"


# =============================================================================
# AsyncAIClient
# =============================================================================


class TestAsyncAIClient:
    """Tests for AsyncAIClient."""

    @pytest.fixture
    def client(self) -> AsyncUIBridgeClient:
        return AsyncUIBridgeClient(base_url="http://localhost:9876")

    @pytest.mark.asyncio
    async def test_ai_search(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_search_response_data())  # type: ignore[method-assign]
        results = await client.ai.search("Submit")

        assert len(results) == 1
        assert results[0].element.id == "btn-1"
        assert results[0].confidence == 0.95
        client._request.assert_called_once()
        call_args = client._request.call_args
        assert call_args[0] == ("POST", "/ai/search")

    @pytest.mark.asyncio
    async def test_ai_search_with_criteria(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_search_response_data())  # type: ignore[method-assign]
        await client.ai.search(
            "Submit",
            role="button",
            element_type="button",
            near="form-1",
            within="main-content",
        )

        call_kwargs = client._request.call_args
        payload = call_kwargs[1]["json"]
        assert payload["text"] == "Submit"
        assert payload["role"] == "button"
        assert payload["type"] == "button"
        assert payload["near"] == "form-1"
        assert payload["within"] == "main-content"

    @pytest.mark.asyncio
    async def test_ai_find(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_search_response_data())  # type: ignore[method-assign]
        result = await client.ai.find("Submit button")

        assert result is not None
        assert result.id == "btn-1"

    @pytest.mark.asyncio
    async def test_ai_find_no_match(self, client: AsyncUIBridgeClient) -> None:
        no_match_data = {
            "results": [],
            "bestMatch": None,
            "scannedCount": 10,
            "durationMs": 25.0,
            "criteria": {"text": "nonexistent"},
            "timestamp": 1234567890,
        }
        client._request = AsyncMock(return_value=no_match_data)  # type: ignore[method-assign]
        result = await client.ai.find("nonexistent")

        assert result is None

    @pytest.mark.asyncio
    async def test_ai_execute(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_nl_action_response_data())  # type: ignore[method-assign]
        result = await client.ai.execute("click the Submit button")

        assert result.success is True
        assert result.executed_action == "click"
        client._request.assert_called_once()
        call_args = client._request.call_args
        assert call_args[0] == ("POST", "/ai/execute")
        payload = call_args[1]["json"]
        assert payload["instruction"] == "click the Submit button"

    @pytest.mark.asyncio
    async def test_ai_execute_with_options(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_nl_action_response_data())  # type: ignore[method-assign]
        await client.ai.execute(
            "click the Submit button",
            context="login form",
            timeout=5000,
            confidence_threshold=0.8,
        )

        payload = client._request.call_args[1]["json"]
        assert payload["context"] == "login form"
        assert payload["timeout"] == 5000
        assert payload["confidenceThreshold"] == 0.8

    @pytest.mark.asyncio
    async def test_ai_assert_that(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_assertion_result_data())  # type: ignore[method-assign]
        result = await client.ai.assert_that("btn-1", "visible")

        assert result.passed is True
        client._request.assert_called_once()
        call_args = client._request.call_args
        assert call_args[0] == ("POST", "/ai/assert")

    @pytest.mark.asyncio
    async def test_ai_assert_that_with_expected(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_assertion_result_data())  # type: ignore[method-assign]
        await client.ai.assert_that("input-1", "hasText", "hello")

        payload = client._request.call_args[1]["json"]
        assert payload["type"] == "hasText"
        assert payload["expected"] == "hello"

    @pytest.mark.asyncio
    async def test_ai_snapshot(self, client: AsyncUIBridgeClient) -> None:
        snapshot_data = {
            "timestamp": 1234567890,
            "snapshotId": "snap-1",
            "page": {
                "url": "http://localhost:3000",
                "title": "Home",
                "activeModals": [],
            },
            "elements": [],
            "forms": [],
            "activeModals": [],
            "summary": "Home page",
            "elementCounts": {"button": 5},
        }
        client._request = AsyncMock(return_value=snapshot_data)  # type: ignore[method-assign]
        result = await client.ai.snapshot()

        assert result.snapshot_id == "snap-1"
        assert result.summary == "Home page"
        client._request.assert_called_once_with("GET", "/ai/snapshot")

    @pytest.mark.asyncio
    async def test_ai_execute_with_recovery_success_first_try(
        self, client: AsyncUIBridgeClient
    ) -> None:
        client._request = AsyncMock(return_value=_nl_action_response_data())  # type: ignore[method-assign]
        result = await client.ai.execute_with_recovery("click Submit")

        assert result.success is True
        assert result.total_attempts == 1
        assert result.recovery_attempted is False

    @pytest.mark.asyncio
    async def test_ai_execute_with_recovery_success_after_retry(
        self, client: AsyncUIBridgeClient
    ) -> None:
        # First call fails with retryable error, second succeeds
        failure_response = _nl_action_response_data(success=False, error="Not visible")
        failure_response["failureInfo"] = {
            "errorCode": "ELEMENT_NOT_VISIBLE",
            "message": "Not visible",
            "retryRecommended": True,
            "suggestedActions": [],
        }

        recovery_data = {
            "success": True,
            "strategyResults": [],
            "shouldRetry": True,
            "alternativeElement": None,
        }

        success_response = _nl_action_response_data(success=True)

        # First: execute fails. Second: recovery attempt. Third: execute succeeds.
        client._request = AsyncMock(  # type: ignore[method-assign]
            side_effect=[failure_response, recovery_data, success_response]
        )

        result = await client.ai.execute_with_recovery("click Submit", max_retries=3)

        assert result.success is True
        assert result.total_attempts == 2
        assert result.recovery_attempted is True

    @pytest.mark.asyncio
    async def test_ai_execute_with_recovery_disabled(self, client: AsyncUIBridgeClient) -> None:
        failure_response = _nl_action_response_data(success=False, error="Failed")
        failure_response["failureInfo"] = {
            "errorCode": "ELEMENT_NOT_FOUND",
            "message": "Failed",
            "retryRecommended": True,
            "suggestedActions": [],
        }
        client._request = AsyncMock(return_value=failure_response)  # type: ignore[method-assign]

        result = await client.ai.execute_with_recovery("click Submit", recovery_enabled=False)

        assert result.success is False
        assert result.total_attempts == 1

    @pytest.mark.asyncio
    async def test_ai_click_convenience(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_nl_action_response_data())  # type: ignore[method-assign]
        result = await client.ai.click("Submit")

        assert result.success is True
        payload = client._request.call_args[1]["json"]
        assert 'click "Submit"' == payload["instruction"]

    @pytest.mark.asyncio
    async def test_ai_type_text_convenience(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_nl_action_response_data())  # type: ignore[method-assign]
        result = await client.ai.type_text("email field", "user@test.com")

        assert result.success is True
        payload = client._request.call_args[1]["json"]
        assert "type 'user@test.com' into email field" == payload["instruction"]


# =============================================================================
# AsyncStateControl
# =============================================================================


class TestAsyncStateControl:
    """Tests for AsyncStateControl."""

    @pytest.fixture
    def client(self) -> AsyncUIBridgeClient:
        return AsyncUIBridgeClient(base_url="http://localhost:9876")

    @pytest.mark.asyncio
    async def test_get_active(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=["dashboard", "sidebar"])  # type: ignore[method-assign]
        result = await client.state.get_active()

        assert result == ["dashboard", "sidebar"]
        client._request.assert_called_once_with("GET", "/control/states/active")

    @pytest.mark.asyncio
    async def test_activate(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value={"success": True})  # type: ignore[method-assign]
        result = await client.state.activate("modal")

        assert result is True
        client._request.assert_called_once_with("POST", "/control/state/modal/activate")

    @pytest.mark.asyncio
    async def test_deactivate(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value={"success": True})  # type: ignore[method-assign]
        result = await client.state.deactivate("modal")

        assert result is True
        client._request.assert_called_once_with("POST", "/control/state/modal/deactivate")

    @pytest.mark.asyncio
    async def test_is_active(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=["dashboard", "sidebar"])  # type: ignore[method-assign]
        assert await client.state.is_active("dashboard") is True
        assert await client.state.is_active("modal") is False

    @pytest.mark.asyncio
    async def test_navigate_to(self, client: AsyncUIBridgeClient) -> None:
        nav_data = {
            "success": True,
            "path": {
                "found": True,
                "transitions": ["t1", "t2"],
                "totalCost": 2.0,
                "targetStates": ["checkout"],
                "estimatedSteps": 2,
            },
            "executedTransitions": ["t1", "t2"],
            "finalActiveStates": ["checkout"],
            "durationMs": 500.0,
        }
        client._request = AsyncMock(return_value=nav_data)  # type: ignore[method-assign]
        result = await client.state.navigate_to(["checkout"])

        assert result.success is True
        assert result.final_active_states == ["checkout"]
        client._request.assert_called_once_with(
            "POST",
            "/control/states/navigate",
            json={"targetStates": ["checkout"]},
        )

    @pytest.mark.asyncio
    async def test_find_path(self, client: AsyncUIBridgeClient) -> None:
        path_data = {
            "found": True,
            "transitions": ["t1"],
            "totalCost": 1.0,
            "targetStates": ["settings"],
            "estimatedSteps": 1,
        }
        client._request = AsyncMock(return_value=path_data)  # type: ignore[method-assign]
        result = await client.state.find_path(["settings"])

        assert result.found is True
        assert result.transitions == ["t1"]

    @pytest.mark.asyncio
    async def test_get_all(self, client: AsyncUIBridgeClient) -> None:
        states_data = [
            {"id": "s1", "name": "State 1", "elements": ["e1"]},
            {"id": "s2", "name": "State 2", "elements": ["e2"]},
        ]
        client._request = AsyncMock(return_value=states_data)  # type: ignore[method-assign]
        result = await client.state.get_all()

        assert len(result) == 2
        assert result[0].id == "s1"

    @pytest.mark.asyncio
    async def test_transition(self, client: AsyncUIBridgeClient) -> None:
        transition_data = {
            "success": True,
            "activatedStates": ["new-state"],
            "deactivatedStates": ["old-state"],
            "durationMs": 150.0,
        }
        client._request = AsyncMock(return_value=transition_data)  # type: ignore[method-assign]
        result = await client.state.transition("t1")

        assert result.success is True
        assert result.activated_states == ["new-state"]

    @pytest.mark.asyncio
    async def test_can_transition(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value={"canExecute": True})  # type: ignore[method-assign]
        result = await client.state.can_transition("t1")

        assert result is True

    @pytest.mark.asyncio
    async def test_get_snapshot(self, client: AsyncUIBridgeClient) -> None:
        snapshot_data = {
            "timestamp": 1234567890,
            "activeStates": ["dashboard"],
            "states": [{"id": "dashboard", "name": "Dashboard", "elements": []}],
            "groups": [],
            "transitions": [],
        }
        client._request = AsyncMock(return_value=snapshot_data)  # type: ignore[method-assign]
        result = await client.state.get_snapshot()

        assert result.active_states == ["dashboard"]

    @pytest.mark.asyncio
    async def test_activate_group(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(  # type: ignore[method-assign]
            return_value={"activated": ["s1", "s2"]}
        )
        result = await client.state.activate_group("g1")

        assert result == ["s1", "s2"]

    @pytest.mark.asyncio
    async def test_deactivate_group(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(  # type: ignore[method-assign]
            return_value={"deactivated": ["s1", "s2"]}
        )
        result = await client.state.deactivate_group("g1")

        assert result == ["s1", "s2"]


# =============================================================================
# AsyncRenderLogControl
# =============================================================================


class TestAsyncRenderLogControl:
    """Tests for AsyncRenderLogControl."""

    @pytest.fixture
    def client(self) -> AsyncUIBridgeClient:
        return AsyncUIBridgeClient(base_url="http://localhost:9876")

    @pytest.mark.asyncio
    async def test_get(self, client: AsyncUIBridgeClient) -> None:
        log_data = [
            {
                "id": "entry-1",
                "type": "snapshot",
                "timestamp": 1234567890,
                "data": {},
            }
        ]
        client._request = AsyncMock(return_value=log_data)  # type: ignore[method-assign]
        result = await client.render_log.get()

        assert len(result) == 1
        assert result[0].id == "entry-1"

    @pytest.mark.asyncio
    async def test_get_with_filters(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=[])  # type: ignore[method-assign]
        await client.render_log.get(entry_type="change", since=1000, until=2000, limit=50)

        client._request.assert_called_once_with(
            "GET",
            "/render-log",
            params={"type": "change", "since": 1000, "until": 2000, "limit": 50},
        )

    @pytest.mark.asyncio
    async def test_snapshot(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(  # type: ignore[method-assign]
            return_value={"snapshotId": "snap-1", "timestamp": 1234567890}
        )
        result = await client.render_log.snapshot()

        assert result["snapshotId"] == "snap-1"
        client._request.assert_called_once_with("POST", "/render-log/snapshot")

    @pytest.mark.asyncio
    async def test_clear(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=None)  # type: ignore[method-assign]
        await client.render_log.clear()

        client._request.assert_called_once_with("DELETE", "/render-log")


# =============================================================================
# AsyncAnnotationControl
# =============================================================================


class TestAsyncAnnotationControl:
    """Tests for AsyncAnnotationControl."""

    @pytest.fixture
    def client(self) -> AsyncUIBridgeClient:
        return AsyncUIBridgeClient(base_url="http://localhost:9876")

    @pytest.mark.asyncio
    async def test_get(self, client: AsyncUIBridgeClient) -> None:
        annotation_data = {
            "description": "Submit button",
            "purpose": "Submits the form",
        }
        client._request = AsyncMock(return_value=annotation_data)  # type: ignore[method-assign]
        result = await client.annotations.get("btn-1")

        assert result.description == "Submit button"
        assert result.purpose == "Submits the form"
        client._request.assert_called_once_with("GET", "/annotations/btn-1")

    @pytest.mark.asyncio
    async def test_set(self, client: AsyncUIBridgeClient) -> None:
        from ui_bridge.types import ElementAnnotation

        annotation = ElementAnnotation(
            description="Submit button",
            tags=["auth", "primary"],
        )
        response_data = {
            "description": "Submit button",
            "tags": ["auth", "primary"],
        }
        client._request = AsyncMock(return_value=response_data)  # type: ignore[method-assign]
        result = await client.annotations.set("btn-1", annotation)

        assert result.description == "Submit button"
        client._request.assert_called_once()
        call_args = client._request.call_args
        assert call_args[0] == ("PUT", "/annotations/btn-1")

    @pytest.mark.asyncio
    async def test_delete(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=None)  # type: ignore[method-assign]
        await client.annotations.delete("btn-1")

        client._request.assert_called_once_with("DELETE", "/annotations/btn-1")

    @pytest.mark.asyncio
    async def test_list(self, client: AsyncUIBridgeClient) -> None:
        list_data = {
            "btn-1": {"description": "Submit button"},
            "input-1": {"description": "Email field"},
        }
        client._request = AsyncMock(return_value=list_data)  # type: ignore[method-assign]
        result = await client.annotations.list()

        assert len(result) == 2
        assert "btn-1" in result
        assert result["btn-1"].description == "Submit button"
        client._request.assert_called_once_with("GET", "/annotations")

    @pytest.mark.asyncio
    async def test_coverage(self, client: AsyncUIBridgeClient) -> None:
        coverage_data = {
            "totalElements": 20,
            "annotatedElements": 5,
            "coveragePercent": 25.0,
            "annotatedIds": ["btn-1", "input-1", "input-2", "form-1", "link-1"],
            "unannotatedIds": ["btn-2", "btn-3"],
            "timestamp": 1234567890,
        }
        client._request = AsyncMock(return_value=coverage_data)  # type: ignore[method-assign]
        result = await client.annotations.coverage()

        assert result.total_elements == 20
        assert result.annotated_elements == 5
        assert result.coverage_percent == 25.0
        client._request.assert_called_once_with("GET", "/annotations/coverage")


# =============================================================================
# AsyncComponentControl
# =============================================================================


class TestAsyncComponentControl:
    """Tests for AsyncComponentControl."""

    @pytest.fixture
    def client(self) -> AsyncUIBridgeClient:
        return AsyncUIBridgeClient(base_url="http://localhost:9876")

    @pytest.mark.asyncio
    async def test_get_state(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(  # type: ignore[method-assign]
            return_value={
                "state": {"count": 0},
                "computed": {"isEmpty": True},
                "timestamp": 1234567890,
            }
        )
        ctrl = client.component("counter-1")
        result = await ctrl.get_state()

        assert result.state["count"] == 0
        assert result.computed["isEmpty"] is True

    @pytest.mark.asyncio
    async def test_action(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(  # type: ignore[method-assign]
            return_value=_component_action_data(result={"incremented": True})
        )
        ctrl = client.component("counter-1")
        result = await ctrl.action("increment", params={"by": 5})

        assert result.success is True
        assert result.result["incremented"] is True

    @pytest.mark.asyncio
    async def test_callable(self, client: AsyncUIBridgeClient) -> None:
        """Test that AsyncComponentControl can be called directly."""
        client._request = AsyncMock(  # type: ignore[method-assign]
            return_value=_component_action_data()
        )
        ctrl = client.component("counter-1")
        result = await ctrl("increment")

        assert result.success is True


# =============================================================================
# AsyncWorkflowControl
# =============================================================================


class TestAsyncWorkflowControl:
    """Tests for AsyncWorkflowControl."""

    @pytest.fixture
    def client(self) -> AsyncUIBridgeClient:
        return AsyncUIBridgeClient(base_url="http://localhost:9876")

    @pytest.mark.asyncio
    async def test_run(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(  # type: ignore[method-assign]
            return_value=_workflow_run_data(workflow_id="login-flow")
        )
        ctrl = client.workflow("login-flow")
        result = await ctrl.run(params={"user": "admin"})

        assert result.success is True
        assert result.workflow_id == "login-flow"

    @pytest.mark.asyncio
    async def test_run_with_step_range(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(  # type: ignore[method-assign]
            return_value=_workflow_run_data()
        )
        ctrl = client.workflow("test-workflow")
        await ctrl.run(start_step="step-2", stop_step="step-4")

        call_kwargs = client._request.call_args
        payload = call_kwargs[1]["json"]
        assert payload["startStep"] == "step-2"
        assert payload["stopStep"] == "step-4"

    @pytest.mark.asyncio
    async def test_callable(self, client: AsyncUIBridgeClient) -> None:
        """Test that AsyncWorkflowControl can be called directly."""
        client._request = AsyncMock(  # type: ignore[method-assign]
            return_value=_workflow_run_data()
        )
        ctrl = client.workflow("test-workflow")
        result = await ctrl(params={"key": "val"})

        assert result.success is True


# =============================================================================
# Snapshot & Health
# =============================================================================


class TestAsyncUIBridgeClientSnapshot:
    """Tests for snapshot and health methods."""

    @pytest.fixture
    def client(self) -> AsyncUIBridgeClient:
        return AsyncUIBridgeClient(base_url="http://localhost:9876")

    @pytest.mark.asyncio
    async def test_get_snapshot(self, client: AsyncUIBridgeClient) -> None:
        snapshot_data = {
            "timestamp": 1234567890,
            "elements": [],
            "components": [],
            "workflows": [],
        }
        client._request = AsyncMock(return_value=snapshot_data)  # type: ignore[method-assign]
        result = await client.get_snapshot()

        assert result.timestamp == 1234567890
        client._request.assert_called_once_with("GET", "/control/snapshot")

    @pytest.mark.asyncio
    async def test_get_element_state(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_element_state_dict())  # type: ignore[method-assign]
        result = await client.get_element_state("btn-1")

        assert result.visible is True
        assert result.enabled is True

    @pytest.mark.asyncio
    async def test_get_elements(self, client: AsyncUIBridgeClient) -> None:
        elements_data = [{"id": "btn-1", "type": "button"}]
        client._request = AsyncMock(return_value=elements_data)  # type: ignore[method-assign]
        result = await client.get_elements()

        assert len(result) == 1
        assert result[0]["id"] == "btn-1"
        client._request.assert_called_once_with("GET", "/control/elements")


# =============================================================================
# URL Building
# =============================================================================


class TestAsyncUIBridgeClientURLBuilding:
    """Tests for URL construction."""

    def test_url_building_default(self) -> None:
        client = AsyncUIBridgeClient()
        url = client._url("/control/find")
        assert "/ui-bridge/control/find" in url

    def test_url_building_custom_api_path(self) -> None:
        client = AsyncUIBridgeClient(api_path="/api/v2")
        url = client._url("/control/find")
        assert "/api/v2/control/find" in url


# =============================================================================
# Logging
# =============================================================================


class TestAsyncUIBridgeClientLogging:
    """Tests for logging functionality."""

    def test_enable_logging_returns_self(self) -> None:
        client = AsyncUIBridgeClient()
        result = client.enable_logging(console=True)
        assert result is client
        assert client._logger is not None

    def test_disable_logging_returns_self(self) -> None:
        client = AsyncUIBridgeClient()
        client.enable_logging()
        result = client.disable_logging()
        assert result is client
        assert client._logger is None

    def test_get_logger_none_by_default(self) -> None:
        client = AsyncUIBridgeClient()
        assert client.get_logger() is None

    def test_get_logger_after_enable(self) -> None:
        client = AsyncUIBridgeClient()
        client.enable_logging()
        assert client.get_logger() is not None

    def test_start_trace_without_logger(self) -> None:
        client = AsyncUIBridgeClient()
        trace = client.start_trace()
        assert trace.trace_id == "00000000000000000000000000000000"

    def test_start_trace_with_logger(self) -> None:
        client = AsyncUIBridgeClient()
        client.enable_logging()
        trace = client.start_trace()
        assert trace.trace_id != "00000000000000000000000000000000"

    def test_end_trace(self) -> None:
        client = AsyncUIBridgeClient()
        client.enable_logging()
        client.start_trace()
        assert client._active_trace is not None
        client.end_trace()
        assert client._active_trace is None


# =============================================================================
# Debug Methods
# =============================================================================


class TestAsyncUIBridgeClientDebug:
    """Tests for debug methods."""

    @pytest.fixture
    def client(self) -> AsyncUIBridgeClient:
        return AsyncUIBridgeClient(base_url="http://localhost:9876")

    @pytest.mark.asyncio
    async def test_get_action_history(self, client: AsyncUIBridgeClient) -> None:
        history_data = [{"action": "click", "elementId": "btn-1"}]
        client._request = AsyncMock(return_value=history_data)  # type: ignore[method-assign]
        result = await client.get_action_history(limit=10)

        assert len(result) == 1
        client._request.assert_called_once_with(
            "GET", "/debug/action-history", params={"limit": 10}
        )

    @pytest.mark.asyncio
    async def test_get_metrics(self, client: AsyncUIBridgeClient) -> None:
        metrics_data = {
            "totalActions": 100,
            "successfulActions": 95,
            "failedActions": 5,
            "successRate": 0.95,
            "avgDurationMs": 50.0,
            "minDurationMs": 5.0,
            "maxDurationMs": 500.0,
            "p95DurationMs": 200.0,
            "actionsPerSecond": 2.0,
            "errorsByType": {"NOT_FOUND": 3},
            "actionsByType": {"click": 80},
        }
        client._request = AsyncMock(return_value=metrics_data)  # type: ignore[method-assign]
        result = await client.get_metrics()

        assert result.total_actions == 100
        assert result.success_rate == 0.95

    @pytest.mark.asyncio
    async def test_highlight_element(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=None)  # type: ignore[method-assign]
        await client.highlight_element("btn-1")

        client._request.assert_called_once_with("POST", "/debug/highlight/btn-1")


# =============================================================================
# AI Convenience Methods on Client
# =============================================================================


class TestAsyncUIBridgeClientAIConvenience:
    """Tests for AI convenience methods on the main client."""

    @pytest.fixture
    def client(self) -> AsyncUIBridgeClient:
        return AsyncUIBridgeClient(base_url="http://localhost:9876")

    @pytest.mark.asyncio
    async def test_click_text(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_nl_action_response_data())  # type: ignore[method-assign]
        result = await client.click_text("Submit")

        assert result.success is True

    @pytest.mark.asyncio
    async def test_type_into(self, client: AsyncUIBridgeClient) -> None:
        client._request = AsyncMock(return_value=_nl_action_response_data())  # type: ignore[method-assign]
        result = await client.type_into("email field", "user@test.com")

        assert result.success is True

    @pytest.mark.asyncio
    async def test_ai_property_returns_same_instance(self, client: AsyncUIBridgeClient) -> None:
        ai1 = client.ai
        ai2 = client.ai
        assert ai1 is ai2
