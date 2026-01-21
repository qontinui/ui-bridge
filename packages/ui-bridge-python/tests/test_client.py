"""Tests for ui_bridge client."""

import pytest
from unittest.mock import MagicMock, patch
import httpx

from ui_bridge.client import UIBridgeClient, UIBridgeError, ElementNotFoundError, ActionFailedError


class TestUIBridgeClient:
    """Tests for UIBridgeClient initialization."""

    def test_init_default_url(self):
        client = UIBridgeClient()
        assert client.base_url == "http://localhost:9876"

    def test_init_custom_url(self):
        client = UIBridgeClient(base_url="http://localhost:8080")
        assert client.base_url == "http://localhost:8080"

    def test_init_strips_trailing_slash(self):
        client = UIBridgeClient(base_url="http://localhost:8080/")
        assert client.base_url == "http://localhost:8080"

    def test_init_custom_api_path(self):
        client = UIBridgeClient(api_path="/api/ui")
        assert client.api_path == "/api/ui"


class TestUIBridgeClientActions:
    """Tests for UIBridgeClient action methods."""

    @pytest.fixture
    def client(self):
        return UIBridgeClient(base_url="http://localhost:9876")

    @pytest.fixture
    def mock_response(self):
        """Create a mock httpx response."""
        response = MagicMock(spec=httpx.Response)
        response.status_code = 200
        response.raise_for_status = MagicMock()
        return response

    def test_click(self, client, mock_response):
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "success": True,
                "durationMs": 50.0,
                "timestamp": 1234567890,
            },
        }

        with patch.object(client._client, "request", return_value=mock_response):
            result = client.click("btn-1")

            assert result.success is True
            assert result.duration_ms == 50.0

    def test_type(self, client, mock_response):
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "success": True,
                "durationMs": 100.0,
                "timestamp": 1234567890,
            },
        }

        with patch.object(client._client, "request", return_value=mock_response) as mock_request:
            result = client.type("input-1", "Hello World")

            assert result.success is True
            # Verify the request was made with the correct params
            call_args = mock_request.call_args
            assert call_args[1]["json"]["params"]["text"] == "Hello World"

    def test_clear(self, client, mock_response):
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "success": True,
                "durationMs": 20.0,
                "timestamp": 1234567890,
            },
        }

        with patch.object(client._client, "request", return_value=mock_response):
            result = client.clear("input-1")

            assert result.success is True

    def test_focus(self, client, mock_response):
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "success": True,
                "durationMs": 5.0,
                "timestamp": 1234567890,
            },
        }

        with patch.object(client._client, "request", return_value=mock_response):
            result = client.focus("input-1")

            assert result.success is True

    def test_select(self, client, mock_response):
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "success": True,
                "durationMs": 30.0,
                "timestamp": 1234567890,
            },
        }

        with patch.object(client._client, "request", return_value=mock_response):
            result = client.select("dropdown-1", value="option-2")

            assert result.success is True


class TestUIBridgeClientDiscovery:
    """Tests for UIBridgeClient discovery methods."""

    @pytest.fixture
    def client(self):
        return UIBridgeClient(base_url="http://localhost:9876")

    @pytest.fixture
    def mock_response(self):
        response = MagicMock(spec=httpx.Response)
        response.status_code = 200
        response.raise_for_status = MagicMock()
        return response

    def test_discover(self, client, mock_response):
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "elements": [
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
                ],
                "total": 1,
                "durationMs": 15.5,
                "timestamp": 1234567890,
            },
        }

        with patch.object(client._client, "request", return_value=mock_response):
            result = client.discover()

            assert len(result.elements) == 1
            assert result.elements[0].id == "btn-1"
            assert result.total == 1


class TestUIBridgeClientComponents:
    """Tests for UIBridgeClient component methods."""

    @pytest.fixture
    def client(self):
        return UIBridgeClient(base_url="http://localhost:9876")

    @pytest.fixture
    def mock_response(self):
        response = MagicMock(spec=httpx.Response)
        response.status_code = 200
        response.raise_for_status = MagicMock()
        return response

    def test_execute_component_action(self, client, mock_response):
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "success": True,
                "result": {"submitted": True},
                "durationMs": 200.0,
                "timestamp": 1234567890,
            },
        }

        with patch.object(client._client, "request", return_value=mock_response):
            result = client.execute_component_action(
                "form-1", "submit", params={"email": "test@example.com"}
            )

            assert result.success is True
            assert result.result["submitted"] is True


class TestUIBridgeClientWorkflows:
    """Tests for UIBridgeClient workflow methods."""

    @pytest.fixture
    def client(self):
        return UIBridgeClient(base_url="http://localhost:9876")

    @pytest.fixture
    def mock_response(self):
        response = MagicMock(spec=httpx.Response)
        response.status_code = 200
        response.raise_for_status = MagicMock()
        return response

    def test_run_workflow(self, client, mock_response):
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "workflowId": "test-workflow",
                "runId": "run-123",
                "status": "completed",
                "steps": [],
                "totalSteps": 3,
                "success": True,
                "startedAt": 1234567890,
                "completedAt": 1234567891,
                "durationMs": 1500.0,
            },
        }

        with patch.object(client._client, "request", return_value=mock_response):
            result = client.run_workflow(
                workflow_id="test-workflow",
                params={"email": "test@example.com"},
            )

            assert result.workflow_id == "test-workflow"
            assert result.success is True


class TestUIBridgeClientErrors:
    """Tests for UIBridgeClient error handling."""

    @pytest.fixture
    def client(self):
        return UIBridgeClient(base_url="http://localhost:9876")

    @pytest.fixture
    def mock_response(self):
        response = MagicMock(spec=httpx.Response)
        response.status_code = 200
        response.raise_for_status = MagicMock()
        return response

    def test_error_handling_not_found(self, client, mock_response):
        mock_response.json.return_value = {
            "success": False,
            "error": "Element not found",
            "code": "NOT_FOUND",
        }

        with patch.object(client._client, "request", return_value=mock_response):
            with pytest.raises(ElementNotFoundError) as exc_info:
                client.click("nonexistent")

            assert "Element not found" in str(exc_info.value)

    def test_error_handling_generic(self, client, mock_response):
        mock_response.json.return_value = {
            "success": False,
            "error": "Internal server error",
        }

        with patch.object(client._client, "request", return_value=mock_response):
            with pytest.raises(UIBridgeError) as exc_info:
                client.click("btn-1")

            assert "Internal server error" in str(exc_info.value)

    def test_action_failed_error(self, client, mock_response):
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "success": False,
                "error": "Element is disabled",
                "durationMs": 10.0,
                "timestamp": 1234567890,
            },
        }

        with patch.object(client._client, "request", return_value=mock_response):
            with pytest.raises(ActionFailedError) as exc_info:
                client.click("btn-1")

            assert "Element is disabled" in str(exc_info.value)
