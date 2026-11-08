"""Tests for ui_bridge client."""

from unittest.mock import MagicMock, patch

import httpx
import pytest

from ui_bridge.client import ActionFailedError, ElementNotFoundError, UIBridgeClient, UIBridgeError


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

    def test_execute_action_verify_effect(self, client, mock_response):
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "success": True,
                "durationMs": 50.0,
                "timestamp": 1234567890,
                "effectVerification": {"outcome": "Failure", "durationMs": 4},
            },
        }

        with patch.object(client._client, "request", return_value=mock_response) as req:
            result = client.execute_action(
                "btn-1", "toggle", params={"x": 1}, verify_effect=False
            )

            assert req.call_args[1]["json"] == {
                "action": "toggle",
                "params": {"x": 1},
                "verifyEffect": False,
            }
            assert result.effect_outcome == "Failure"

    def test_execute_action_and_verbs_omit_verify_effect_by_default(
        self, client, mock_response
    ):
        mock_response.json.return_value = {
            "success": True,
            "data": {"success": True, "durationMs": 1.0, "timestamp": 1},
        }

        with patch.object(client._client, "request", return_value=mock_response) as req:
            result = client.execute_action("btn-1", "focus")
            assert req.call_args[1]["json"] == {"action": "focus"}
            assert result.effect_outcome is None

            client.click("btn-1")
            assert "verifyEffect" not in req.call_args[1]["json"]

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

    def test_unhover(self, client, mock_response):
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "success": True,
                "durationMs": 5.0,
                "timestamp": 1234567890,
                "forcedHover": {"released": {"released": True, "restore": "verified"}},
            },
        }

        with patch.object(client._client, "request", return_value=mock_response) as req:
            result = client.unhover("header-1")

            assert result.success is True
            assert result.forced_hover == {"released": {"released": True, "restore": "verified"}}
            assert req.call_args[1]["json"] == {"action": "unhover"}

    def test_hover_click(self, client, mock_response):
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "success": True,
                "durationMs": 5.0,
                "timestamp": 1234567890,
                "forcedHover": {
                    "applied": {"rulesRewritten": 1, "revealed": []},
                    "released": {"released": True, "restore": "verified"},
                },
            },
        }

        with patch.object(client._client, "request", return_value=mock_response) as req:
            result = client.hover_click("close-1")

            assert result.forced_hover["released"] == {"released": True, "restore": "verified"}
            assert req.call_args[1]["json"] == {"action": "hoverClick"}

    def test_hover_reports_forced_hover(self, client, mock_response):
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "success": True,
                "durationMs": 5.0,
                "timestamp": 1234567890,
                "forcedHover": {"applied": {"rulesRewritten": 2, "revealed": []}},
            },
        }

        with patch.object(client._client, "request", return_value=mock_response) as req:
            result = client.hover("header-1", hold_ms=1000)

            assert result.forced_hover == {"applied": {"rulesRewritten": 2, "revealed": []}}
            assert req.call_args[1]["json"] == {"action": "hover", "params": {"holdMs": 1000}}

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


class TestUIBridgeClientFind:
    """Tests for UIBridgeClient find methods."""

    @pytest.fixture
    def client(self):
        return UIBridgeClient(base_url="http://localhost:9876")

    @pytest.fixture
    def mock_response(self):
        response = MagicMock(spec=httpx.Response)
        response.status_code = 200
        response.raise_for_status = MagicMock()
        return response

    def test_find(self, client, mock_response):
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
            result = client.find()

            assert len(result.elements) == 1
            assert result.elements[0].id == "btn-1"
            assert result.total == 1

    def test_find_sends_media_filters_and_reads_the_report(self, client, mock_response):
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "elements": [],
                "total": 0,
                "durationMs": 1.0,
                "timestamp": 1234567890,
                "unevaluated": [
                    {"id": "img-late", "option": "oversizeThreshold", "code": "input_missing"}
                ],
            },
        }

        with patch.object(client._client, "request", return_value=mock_response) as request:
            result = client.find(media_only=True, oversize_threshold=2.0)

        assert request.call_args.kwargs["json"] == {"mediaOnly": True, "oversizeThreshold": 2.0}
        assert result.unevaluated is not None
        assert [(u.id, u.option) for u in result.unevaluated] == [
            ("img-late", "oversizeThreshold")
        ]

    def test_discover_deprecated(self, client, mock_response):
        """Test that deprecated discover() still works."""
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "elements": [],
                "total": 0,
                "durationMs": 5.0,
                "timestamp": 1234567890,
            },
        }

        with patch.object(client._client, "request", return_value=mock_response):
            import warnings

            with warnings.catch_warnings(record=True) as w:
                warnings.simplefilter("always")
                client.discover()
                assert len(w) == 1
                assert issubclass(w[0].category, DeprecationWarning)
                assert "discover()" in str(w[0].message)


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

    def test_execute_component_action_verify_effect(self, client, mock_response):
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "success": True,
                "durationMs": 200.0,
                "timestamp": 1234567890,
                "effectVerification": {"outcome": "Contradiction", "durationMs": 3},
            },
        }

        with patch.object(client._client, "request", return_value=mock_response) as req:
            result = client.execute_component_action("form-1", "submit", verify_effect=True)

            assert req.call_args[1]["json"] == {"action": "submit", "verifyEffect": True}
            assert result.effect_verification == {"outcome": "Contradiction", "durationMs": 3}
            assert result.effect_outcome == "Contradiction"

    def test_execute_component_action_omits_verify_effect_by_default(
        self, client, mock_response
    ):
        mock_response.json.return_value = {
            "success": True,
            "data": {"success": True, "durationMs": 1.0, "timestamp": 1},
        }

        with patch.object(client._client, "request", return_value=mock_response) as req:
            result = client.execute_component_action("form-1", "submit")

            assert "verifyEffect" not in req.call_args[1]["json"]
            assert result.effect_outcome is None


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
