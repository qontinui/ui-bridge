"""
Post-merge follow-up to qontinui/ui-bridge#164 — the Python SDK's half of the
action declaration.

Plan: ``2026-08-20-ui-bridge-action-declaration-shape``.

That plan gave component actions a validated ``paramSchema``, a wire-reachable
``timeoutMs`` and an ``effect`` annotation, and made ``UB-ACTION-TIMEOUT`` and
``UB-ACTION-REJECTED`` reachable for the first time. None of it was reachable
from this client:

* ``ActionErrorCode`` was a hand-written, un-prefixed vocabulary
  (``"ACTION_TIMEOUT"``) that no server has ever emitted, so
  ``model_validate`` RAISED on every real structured-failure payload;
* ``ComponentActionResponse`` carried no ``failure_details`` at all;
* ``ComponentActionRequest`` had no ``timeoutMs`` and the client method could
  not send one;
* ``ComponentActionInfo`` — the model whose own docstring calls itself the
  canonical shape — omitted ``paramSchema``, ``effect`` and ``path``, the three
  fields Phases 1 and 4 put on the wire and into
  ``qontinui-types::ui_bridge::ComponentActionInfo``.

Every expectation below is a hand-written literal.
"""

from unittest.mock import MagicMock, patch

import httpx
import pytest

from ui_bridge.client import ActionFailedError, UIBridgeClient
from ui_bridge.diagnostics import UiBridgeErrorCode
from ui_bridge.types import (
    ActionResponse,
    ComponentActionInfo,
    ComponentActionRequest,
    ComponentActionResponse,
    RegisteredComponent,
    wire_error_code,
)


class TestCanonicalErrorCodes:
    """The wire's ``UB-`` vocabulary must parse."""

    def test_parses_the_code_the_server_actually_sends(self):
        response = ActionResponse.model_validate(
            {
                "success": False,
                "error": "not found",
                "durationMs": 12.0,
                "timestamp": 1234567890,
                "failureDetails": {
                    "errorCode": "UB-ELEM-NOT-FOUND",
                    "message": "not found",
                    "suggestedActions": [],
                    "retryRecommended": False,
                },
            }
        )

        assert response.failure_details is not None
        assert response.failure_details.error_code == UiBridgeErrorCode.ELEM_NOT_FOUND
        # The predicate that was unreachable before: it could never run, because
        # constructing the model raised first.
        assert response.is_element_not_found() is True

    def test_rendering_a_code_gives_the_wire_string_not_the_enum_repr(self):
        # `UiBridgeErrorCode` is a `(str, Enum)`, so `str(code)` and
        # `f"{code}"` both yield `"UiBridgeErrorCode.ELEM_NOT_FOUND"`. Anything
        # that LOGS a code has to go through the helper.
        assert wire_error_code(UiBridgeErrorCode.ELEM_NOT_FOUND) == "UB-ELEM-NOT-FOUND"
        assert str(UiBridgeErrorCode.ELEM_NOT_FOUND) != "UB-ELEM-NOT-FOUND"
        # An unrecognised code is already the wire string.
        assert wire_error_code("UB-SOMETHING-NEW") == "UB-SOMETHING-NEW"
        assert wire_error_code(None) is None

    def test_an_unrecognised_code_passes_through_instead_of_raising(self):
        # A client pinned to one release must not start raising when a newer
        # server mints a code this build's generated catalog does not carry.
        response = ActionResponse.model_validate(
            {
                "success": False,
                "durationMs": 1.0,
                "timestamp": 1,
                "failureDetails": {
                    "errorCode": "UB-SOMETHING-NEW",
                    "message": "m",
                    "suggestedActions": [],
                    "retryRecommended": False,
                },
            }
        )

        assert response.failure_details is not None
        assert response.failure_details.error_code == "UB-SOMETHING-NEW"
        assert response.get_error_code() == "UB-SOMETHING-NEW"

    def test_both_live_disabled_codes_answer_the_same_predicate(self):
        # The element-action path reports UB-ELEM-DISABLED; the form-fill path
        # reports UB-ELEM-NOT-ENABLED. The SDK cases them together, so a
        # predicate matching only one is wrong half the time.
        for code in ("UB-ELEM-DISABLED", "UB-ELEM-NOT-ENABLED"):
            response = ActionResponse.model_validate(
                {
                    "success": False,
                    "durationMs": 1.0,
                    "timestamp": 1,
                    "failureDetails": {
                        "errorCode": code,
                        "message": "disabled",
                        "suggestedActions": [],
                        "retryRecommended": False,
                    },
                }
            )
            assert response.failure_details is not None
            assert response.failure_details.is_element_not_enabled() is True


class TestComponentActionFailureDetails:
    """A component action's structured failure must be readable."""

    def test_a_timeout_is_distinguishable_from_a_handler_that_threw(self):
        response = ComponentActionResponse.model_validate(
            {
                "success": False,
                "error": "Action timed out",
                "durationMs": 5000.0,
                "timestamp": 1234567890,
                "failureDetails": {
                    "errorCode": "UB-ACTION-TIMEOUT",
                    "message": "Action timed out",
                    "suggestedActions": [],
                    "retryRecommended": True,
                    "timeoutMs": 5000,
                    "cancelReason": "timeout",
                },
            }
        )

        assert response.is_timeout() is True
        assert response.get_error_code() == UiBridgeErrorCode.ACTION_TIMEOUT
        assert response.failure_details is not None
        assert response.failure_details.is_cancelled() is True
        assert response.failure_details.timeout_ms == 5000

    def test_caller_cancellation_reports_the_other_arm(self):
        # The caller-signal arm keeps ``UB-ACTION-FAILED``; ``cancel_reason``,
        # not the code, is the reliable "was this abandoned" test.
        response = ComponentActionResponse.model_validate(
            {
                "success": False,
                "durationMs": 3.0,
                "timestamp": 1,
                "failureDetails": {
                    "errorCode": "UB-ACTION-FAILED",
                    "message": "aborted",
                    "suggestedActions": [],
                    "retryRecommended": False,
                    "cancelReason": "signal",
                },
            }
        )

        assert response.is_timeout() is False
        assert response.failure_details is not None
        assert response.failure_details.is_cancelled() is True

    def test_a_handler_that_threw_is_not_reported_as_cancelled(self):
        response = ComponentActionResponse.model_validate(
            {
                "success": False,
                "durationMs": 3.0,
                "timestamp": 1,
                "failureDetails": {
                    "errorCode": "UB-ACTION-FAILED",
                    "message": "boom",
                    "suggestedActions": [],
                    "retryRecommended": False,
                },
            }
        )

        assert response.failure_details is not None
        assert response.failure_details.is_cancelled() is False

    def test_rejected_params_name_each_offender(self):
        response = ComponentActionResponse.model_validate(
            {
                "success": False,
                "error": "params invalid",
                "durationMs": 1.0,
                "timestamp": 1,
                "failureDetails": {
                    "errorCode": "UB-ACTION-REJECTED",
                    "message": "params invalid",
                    "suggestedActions": [],
                    "retryRecommended": False,
                    "invalidParams": [
                        {
                            "path": "email",
                            "keyword": "type",
                            "message": "must be string",
                        },
                        {
                            "path": "filter.status",
                            "keyword": "enum",
                            "message": "must equal one of",
                        },
                    ],
                },
            }
        )

        issues = response.get_invalid_params()
        assert [i.path for i in issues] == ["email", "filter.status"]
        assert [i.keyword for i in issues] == ["type", "enum"]
        assert issues[0].message == "must be string"

    def test_no_failure_details_yields_empty_rather_than_raising(self):
        response = ComponentActionResponse.model_validate(
            {
                "success": True,
                "result": {"ok": True},
                "durationMs": 1.0,
                "timestamp": 1,
            }
        )

        assert response.is_timeout() is False
        assert response.get_error_code() is None
        assert response.get_invalid_params() == []
        assert response.get_suggestions() == []


class TestComponentActionRequestTimeout:
    """``timeout_ms`` has to reach the wire, not just the model."""

    def test_the_request_model_serializes_the_wire_name(self):
        body = ComponentActionRequest(
            action="submit", timeoutMs=5000, requestId="req-1"
        ).model_dump(by_alias=True, exclude_none=True)

        assert body == {"action": "submit", "timeoutMs": 5000, "requestId": "req-1"}

    def test_omitted_fields_are_not_sent_at_all(self):
        body = ComponentActionRequest(action="submit").model_dump(
            by_alias=True, exclude_none=True
        )

        assert body == {"action": "submit"}


class TestClientSendsTimeout:
    @pytest.fixture
    def client(self):
        return UIBridgeClient(base_url="http://localhost:9876")

    @pytest.fixture
    def mock_response(self):
        response = MagicMock(spec=httpx.Response)
        response.status_code = 200
        response.raise_for_status = MagicMock()
        return response

    def test_execute_component_action_puts_timeout_ms_on_the_body(
        self, client, mock_response
    ):
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "success": True,
                "result": {"submitted": True},
                "durationMs": 200.0,
                "timestamp": 1234567890,
            },
        }

        with patch.object(
            client._client, "request", return_value=mock_response
        ) as request:
            client.execute_component_action(
                "form-1", "submit", params={"email": "a@b.c"}, timeout_ms=5000
            )

        assert request.call_args.kwargs["json"] == {
            "action": "submit",
            "params": {"email": "a@b.c"},
            "timeoutMs": 5000,
        }

    def test_a_failure_carries_its_structured_reason_onto_the_exception(
        self, client, mock_response
    ):
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "success": False,
                "error": "Action timed out",
                "durationMs": 5000.0,
                "timestamp": 1234567890,
                "failureDetails": {
                    "errorCode": "UB-ACTION-TIMEOUT",
                    "message": "Action timed out",
                    "suggestedActions": [],
                    "retryRecommended": True,
                    "cancelReason": "timeout",
                },
            },
        }

        with patch.object(client._client, "request", return_value=mock_response):
            with pytest.raises(ActionFailedError) as excinfo:
                client.execute_component_action("form-1", "submit", timeout_ms=5000)

        # Without this a caller can only string-match ``error``, which is
        # exactly what the structured-failure surface exists to replace.
        details = excinfo.value.failure_details
        assert details is not None
        assert details.error_code == UiBridgeErrorCode.ACTION_TIMEOUT
        assert details.cancel_reason == "timeout"


class TestComponentActionInfoWireFields:
    """The canonical mirror must carry what the SDK actually publishes."""

    def test_reads_param_schema_effect_and_path(self):
        info = ComponentActionInfo.model_validate(
            {
                "id": "delete",
                "label": "Delete invoice",
                "paramSchema": {
                    "type": "object",
                    "properties": {"id": {"type": "string"}},
                },
                "effect": "destructive",
                "path": "/control/component/invoice/action/delete",
            }
        )

        assert info.param_schema == {
            "type": "object",
            "properties": {"id": {"type": "string"}},
        }
        assert info.effect == "destructive"
        assert info.path == "/control/component/invoice/action/delete"

    def test_the_snapshot_projection_omits_them_without_error(self):
        # ``serializeRegisteredComponent`` emits only id/label/description
        # (plus ``effect``), so absence is the normal case, not a parse failure.
        info = ComponentActionInfo.model_validate({"id": "submit", "label": "Submit"})

        assert info.param_schema is None
        assert info.path is None
        # Absent means UNCLASSIFIED, not safe -- an autonomous walk must treat
        # ``None`` as unknown rather than as ``"read"``.
        assert info.effect is None

    def test_survives_the_full_component_listing_shape(self):
        component = RegisteredComponent.model_validate(
            {
                "id": "invoice",
                "name": "Invoice",
                "actions": [
                    {
                        "id": "delete",
                        "paramSchema": {"id": "string"},
                        "effect": "destructive",
                        "path": "/control/component/invoice/action/delete",
                    }
                ],
                "actionInvocationPath": "/control/component/invoice/action/{actionId}",
            }
        )

        assert component.action_invocation_path == (
            "/control/component/invoice/action/{actionId}"
        )
        assert component.actions[0].effect == "destructive"
        assert component.actions[0].param_schema == {"id": "string"}


class TestComponentListingIsTyped:
    """
    The two endpoints that carry ``paramSchema`` and ``path`` must parse
    through ``ComponentActionInfo``.

    ``ControlSnapshot.components`` was the model's only reader, and the
    snapshot projection emits neither field -- so widening
    ``ComponentActionInfo`` alone would have left two of its three new fields
    with no route to a caller at all.
    """

    @pytest.fixture
    def client(self):
        return UIBridgeClient(base_url="http://localhost:9876")

    @pytest.fixture
    def mock_response(self):
        response = MagicMock(spec=httpx.Response)
        response.status_code = 200
        response.raise_for_status = MagicMock()
        return response

    def test_get_component_parses_the_action_declaration(
        self, client, mock_response
    ):
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "id": "invoice",
                "name": "Invoice",
                "actions": [
                    {
                        "id": "delete",
                        "label": "Delete",
                        "paramSchema": {"id": "string"},
                        "effect": "destructive",
                        "path": "/control/component/invoice/action/delete",
                    }
                ],
                "actionInvocationPath": (
                    "/control/component/invoice/action/{actionId}"
                ),
            },
        }

        with patch.object(client._client, "request", return_value=mock_response):
            component = client.get_component("invoice")

        assert component.id == "invoice"
        action = component.actions[0]
        assert action.effect == "destructive"
        assert action.param_schema == {"id": "string"}
        assert action.path == "/control/component/invoice/action/delete"

    def test_get_components_unwraps_the_components_envelope(
        self, client, mock_response
    ):
        # The envelope is `{"components": [...]}`, matching the runner's own
        # direct route. The previous annotation claimed a bare list.
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "components": [
                    {
                        "id": "invoice",
                        "name": "Invoice",
                        "actions": [{"id": "delete", "effect": "destructive"}],
                    },
                    {"id": "search", "name": "Search", "actions": ["submit"]},
                ]
            },
        }

        with patch.object(client._client, "request", return_value=mock_response):
            components = client.get_components()

        assert [c.id for c in components] == ["invoice", "search"]
        assert components[0].actions[0].effect == "destructive"
        # Pre-0.22.0 servers sent bare action-id strings; still coerced.
        assert components[1].actions[0].id == "submit"
        assert components[1].actions[0].effect is None
