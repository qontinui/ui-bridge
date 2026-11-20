"""The recovery-attempt verdict (``attemptSucceeded``) reaches both clients.

Plan 2026-11-18-the-journey-ledger-never-records-an-unknown-action-verdict-
as-a-success-or-a-failure, D4. ``RecoveryExecutorResult`` used to require a
``success`` field the runner's 200 data does not carry, so a SUCCESSFUL attempt
raised a validation error that the loop swallowed as a failure. It also read a
``shouldRetry`` that no server sends.

Every answer shape here is fed through real HTTP plumbing (``httpx.MockTransport``)
to the sync AND the async client, which must behave identically:

(a) the runner's real 200: ``{"success": true, "data": {"attemptSucceeded": true, ...}}``;
(b) the runner's 400 ``RECOVERY_FAILED``: ``success: false``, no ``data``;
(c) the TS SDK server's new shapes: 200 ``attemptSucceeded: true``, and 400
    ``success: false`` with ``data.attemptSucceeded: false``;
(d) a verdict-less body, and the runner's 500 ``RECOVERY_VERDICT_MISSING``.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from ui_bridge.async_client import AsyncUIBridgeClient
from ui_bridge.client import UIBridgeClient
from ui_bridge.recovery_types import (
    ORIGINAL_ALREADY_ATTEMPTED_ERROR,
    ORIGINAL_OUTCOME_UNKNOWN_ERROR,
    ORIGINAL_RETRIED_AND_FAILED_ERROR,
    VERDICT_UNKNOWN_CODE,
    VERDICT_UNKNOWN_ERROR,
    ExecuteWithRecoveryResult,
    read_recovery_attempt,
)

# =============================================================================
# Answer shapes
# =============================================================================

RUNNER_200 = (200, {"success": True, "data": {"attemptSucceeded": True, "elementId": "btn-1"}})

# The runner's real 400 on the wire: `recovery_error_detail` puts the token in
# `error_detail.context.code`, and the envelope middleware's rule 2a rewrites
# the disagreeing top-level `code` to the typed one (`ACTION_FAILED`).
RUNNER_400_RECOVERY_FAILED = (
    400,
    {
        "success": False,
        "error": "RECOVERY_FAILED: recovery did not recover the addressed element",
        "code": "ACTION_FAILED",
        "error_detail": {
            "code": "ACTION_FAILED",
            "message": "RECOVERY_FAILED: recovery did not recover the addressed element",
            "recovery": "RETRY",
            "context": {"code": "RECOVERY_FAILED", "displaced_top_level_code": "RECOVERY_FAILED"},
        },
    },
)

RUNNER_500_VERDICT_MISSING = (
    500,
    {
        "success": False,
        "error": (
            "RECOVERY_VERDICT_MISSING: the frontend's ai_recovery_attempt reply carried no "
            "boolean `attemptSucceeded`; whether the scoped attempt acted is unknown"
        ),
        "code": "INTERNAL_ERROR",
        "error_detail": {
            "code": "INTERNAL_ERROR",
            "message": "RECOVERY_VERDICT_MISSING: ...",
            "context": {
                "code": "RECOVERY_VERDICT_MISSING",
                "displaced_top_level_code": "RECOVERY_VERDICT_MISSING",
                "payload_type": "object",
                "payload_keys": ["elementId"],
                "payload_key_count": 1,
            },
        },
    },
)

# The element an NLActionResponse names, as the TS server serializes it.
_WIRE_ELEMENT: dict[str, Any] = {
    "id": "btn-1",
    "type": "button",
    "tagName": "button",
    "role": "button",
    "accessibleName": "Submit",
    "actions": ["click"],
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
    "registered": True,
    "description": "Submit button",
    "aliases": [],
    "suggestedActions": ["click"],
}

# The acting strategy's result (`finalResult`) for a successful scroll.
_WIRE_SCROLL_RESULT: dict[str, Any] = {
    "success": True,
    "executedAction": "scroll to btn-1",
    "elementUsed": _WIRE_ELEMENT,
    "confidence": 0.9,
    "elementState": _WIRE_ELEMENT["state"],
    "durationMs": 5,
    "timestamp": 1,
}

# The last strategy's result for a failed attempt (the fallback, `click btn-1`).
_WIRE_FAILED_RESULT: dict[str, Any] = {
    "success": False,
    "executedAction": "click btn-1",
    "elementUsed": _WIRE_ELEMENT,
    "confidence": 0.9,
    "elementState": _WIRE_ELEMENT["state"],
    "durationMs": 5,
    "timestamp": 1,
    "error": "still hidden",
    "errorCode": "UB-ACTION-FAILED",
}

# A command-bearing strategy ("scroll to btn-1") acted: not the original
# action, and the original was not run in this attempt.
TS_200 = (
    200,
    {
        "success": True,
        "data": {
            "attemptSucceeded": True,
            "originalActionPerformed": False,
            "originalActionAttempted": False,
            "strategiesAttempted": ["Scroll to the element"],
            "finalResult": _WIRE_SCROLL_RESULT,
            "durationMs": 12,
        },
        "timestamp": 1,
    },
)

# A commandless suggestion ran the original and it failed; a different command
# then succeeded. The original must not run again.
TS_200_ORIGINAL_ATTEMPTED = (
    200,
    {
        "success": True,
        "data": {
            "attemptSucceeded": True,
            "originalActionPerformed": False,
            "originalActionAttempted": True,
            "strategiesAttempted": ["Wait for the element", "Dismiss"],
            "finalResult": _WIRE_SCROLL_RESULT,
            "durationMs": 12,
        },
        "timestamp": 1,
    },
)

TS_400_EXHAUSTED = (
    400,
    {
        "success": False,
        "error": "RECOVERY_FAILED: All recovery strategies exhausted",
        "code": "UB-ACTION-FAILED",
        "data": {
            "attemptSucceeded": False,
            "originalActionPerformed": False,
            "originalActionAttempted": True,
            "strategiesAttempted": ["Scroll to the element", "direct-instruction"],
            "finalResult": _WIRE_FAILED_RESULT,
            "error": "RECOVERY_FAILED: All recovery strategies exhausted",
            "durationMs": 30,
        },
        "timestamp": 1,
    },
)

VERDICTLESS_200 = (200, {"success": True, "data": {"elementId": "btn-1"}})

# The generic relay's in-page stub, as the relay server returns it: the inner
# failure envelope nested whole under the outer `data` (`relayInnerFailureResponse`).
RELAY_STUB_NESTED = (
    200,
    {
        "success": False,
        "error": "Recovery not implemented for generic relay",
        "code": "UB-UNKNOWN-ERROR",
        "data": {
            "success": False,
            "error": "Recovery not implemented for generic relay",
            "data": {
                "attemptSucceeded": False,
                "originalActionPerformed": False,
                "originalActionAttempted": False,
                "strategiesAttempted": [],
            },
            "timestamp": 1,
        },
        "timestamp": 1,
    },
)

# The pre-D4 TS server answer: envelope success, verdict under `recovered`.
LEGACY_TS_RECOVERED_FALSE = (
    200,
    {"success": True, "data": {"recovered": False, "strategiesAttempted": []}},
)


# =============================================================================
# The pure reader
# =============================================================================


@pytest.mark.parametrize(
    ("answer", "verdict", "code"),
    [
        (RUNNER_200, True, None),
        (RUNNER_400_RECOVERY_FAILED, False, "RECOVERY_FAILED"),
        (RELAY_STUB_NESTED, False, "UB-UNKNOWN-ERROR"),
        (RUNNER_500_VERDICT_MISSING, None, "RECOVERY_VERDICT_MISSING"),
        (TS_200, True, None),
        (TS_400_EXHAUSTED, False, "UB-ACTION-FAILED"),
        (VERDICTLESS_200, None, None),
        (LEGACY_TS_RECOVERED_FALSE, None, None),
    ],
)
def test_read_recovery_attempt_verdicts(
    answer: tuple[int, dict[str, Any]], verdict: bool | None, code: str | None
) -> None:
    status, body = answer
    result = read_recovery_attempt(status, body)
    assert result.attempt_succeeded is verdict
    assert result.verdict_stated is (verdict is not None)
    assert result.code == code
    assert result.http_status == status
    if verdict is not True:
        assert result.error


def test_explicit_failure_overrides_a_stated_true() -> None:
    body = {"success": False, "error": "x", "data": {"attemptSucceeded": True}}
    assert read_recovery_attempt(400, body).attempt_succeeded is False


def test_data_level_failure_is_did_not_act() -> None:
    body = {"success": True, "data": {"success": False, "error": "RECOVERY_UNSCOPED: no id"}}
    result = read_recovery_attempt(200, body)
    assert result.attempt_succeeded is False
    assert result.error == "RECOVERY_UNSCOPED: no id"


def test_non_object_body_is_unknown() -> None:
    result = read_recovery_attempt(502, None)
    assert result.attempt_succeeded is None
    assert result.error is not None and "502" in result.error


def test_non_boolean_verdict_is_unknown() -> None:
    body = {"success": True, "data": {"attemptSucceeded": "yes"}}
    assert read_recovery_attempt(200, body).attempt_succeeded is None


def test_strategies_attempted_survive() -> None:
    result = read_recovery_attempt(*TS_400_EXHAUSTED)
    assert result.strategies_attempted == ["Scroll to the element", "direct-instruction"]


# =============================================================================
# Both clients, over real HTTP plumbing
# =============================================================================


def _element() -> dict[str, Any]:
    return {
        "id": "btn-1",
        "type": "button",
        "tagName": "button",
        "role": "button",
        "accessibleName": "Submit",
        "actions": ["click"],
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
        "registered": True,
        "description": "Submit button",
        "aliases": [],
        "suggestedActions": ["click"],
    }


# A failure with one commandless suggestion and every other optional unset,
# exactly as `StructuredFailureInfo.model_dump(by_alias=True)` serializes it
# (every unset optional is `null`). The TS validator accepts this same payload
# (recovery-attempt.verdict.test.ts, "accepts the exact payload the Python
# clients send").
PYTHON_FAILURE_DUMP: dict[str, Any] = {
    "errorCode": "ELEMENT_NOT_VISIBLE",
    "message": "Not visible",
    "elementId": None,
    "selectorsTried": None,
    "partialMatches": None,
    "elementState": None,
    "screenshotContext": None,
    "suggestedActions": [
        {
            "suggestion": "Wait for the element",
            "command": None,
            "confidence": 0.6,
            "retryable": True,
        },
        {
            "suggestion": "Scroll to the element",
            "command": "scroll to btn-1",
            "confidence": 0.9,
            "retryable": True,
        },
    ],
    "retryRecommended": True,
    "context": None,
    "durationMs": None,
    "timeoutMs": None,
}


def _execute_answer(success: bool) -> dict[str, Any]:
    data: dict[str, Any] = {
        "success": success,
        "executedAction": "click",
        "elementUsed": _element(),
        "confidence": 0.95,
        "elementState": _element()["state"],
        "durationMs": 10.0,
        "timestamp": 1,
    }
    if not success:
        data["error"] = "Not visible"
        data["failureInfo"] = {
            "errorCode": "ELEMENT_NOT_VISIBLE",
            "message": "Not visible",
            "retryRecommended": True,
            "suggestedActions": [
                {"suggestion": "Wait for the element", "confidence": 0.6, "retryable": True},
                {
                    "suggestion": "Scroll to the element",
                    "command": "scroll to btn-1",
                    "confidence": 0.9,
                    "retryable": True,
                },
            ],
        }
    return {"success": True, "data": data}


class _Server:
    """Answers `/ai/execute` (fail, then succeed) and `/ai/recovery/attempt`."""

    def __init__(self, recovery: tuple[int, Any] | Exception) -> None:
        self.recovery = recovery
        self.recovery_bodies: list[dict[str, Any]] = []
        self.executes = 0
        self.recovery_calls = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/ai/execute"):
            self.executes += 1
            return httpx.Response(200, json=_execute_answer(self.executes > 1))
        if request.url.path.endswith("/ai/recovery/attempt"):
            self.recovery_calls += 1
            payload = json.loads(request.content)
            self.recovery_bodies.append(payload)
            assert payload["elementId"] == "btn-1"
            if isinstance(self.recovery, Exception):
                raise self.recovery
            status, body = self.recovery
            if body is None:
                return httpx.Response(status, text="<html>bad gateway</html>")
            return httpx.Response(status, json=body)
        return httpx.Response(404, json={"success": False, "error": "no route"})


def _run_sync(server: _Server, max_retries: int) -> ExecuteWithRecoveryResult:
    client = UIBridgeClient(base_url="http://bridge.test")
    client._client.close()
    with httpx.Client(transport=httpx.MockTransport(server)) as transport_client:
        client._client = transport_client
        return client.ai.execute_with_recovery("click Submit", max_retries=max_retries)


async def _run_async(server: _Server, max_retries: int) -> ExecuteWithRecoveryResult:
    client = AsyncUIBridgeClient(base_url="http://bridge.test")
    await client._client.aclose()
    client._client = httpx.AsyncClient(transport=httpx.MockTransport(server))
    try:
        return await client.ai.execute_with_recovery("click Submit", max_retries=max_retries)
    finally:
        await client._client.aclose()


async def _run(kind: str, server: _Server, max_retries: int = 3) -> ExecuteWithRecoveryResult:
    if kind == "sync":
        return _run_sync(server, max_retries)
    return await _run_async(server, max_retries)


CLIENTS = ["sync", "async"]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", CLIENTS)
async def test_a_success_by_another_command_retries_the_action_exactly_once(
    kind: str,
) -> None:
    # The TS server says explicitly that a different command acted and the
    # original did not run (originalActionAttempted: false): the only answer
    # that permits a retry. The original is retried exactly once.
    server = _Server(TS_200)
    result = await _run(kind, server)

    assert result.success is True
    assert server.executes == 2, "exactly one retry of the original action"
    assert result.total_attempts == 2
    assert server.recovery_calls == 1
    assert result.recovery_attempted is True
    assert result.recovery_result is not None
    assert result.recovery_result.attempt_succeeded is True
    assert result.recovery_result.original_action_performed is not True
    assert result.recovery_result.original_action_attempted is False


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", CLIENTS)
async def test_a_runner_success_with_unstated_original_fields_is_not_re_executed(
    kind: str,
) -> None:
    # The runner's scoped recovery executes the original instruction on the
    # addressed element and states no originalAction* field. Whether the
    # original ran is UNKNOWN, so the client must not run it again.
    server = _Server(RUNNER_200)
    result = await _run(kind, server)

    assert server.executes == 1, "the original must not be executed a second time"
    assert server.recovery_calls == 1
    assert result.success is False
    assert result.error == ORIGINAL_OUTCOME_UNKNOWN_ERROR
    assert result.error_code == "RECOVERY_ORIGINAL_OUTCOME_UNKNOWN"
    # The action fields describe the client's own pre-recovery execution.
    assert result.executed_action == "click"
    assert result.recovery_attempted is True
    assert result.recovery_result is not None
    assert result.recovery_result.attempt_succeeded is True
    assert result.recovery_result.original_action_attempted is None
    assert result.recovery_result.original_action_performed is None


def _performed_answer(strategy: str) -> tuple[int, dict[str, Any]]:
    final = _execute_answer(True)["data"]
    final["executedAction"] = "click (performed by recovery)"
    return (
        200,
        {
            "success": True,
            "data": {
                "attemptSucceeded": True,
                "originalActionPerformed": True,
                "originalActionAttempted": True,
                "strategiesAttempted": [strategy],
                "finalResult": final,
                "durationMs": 9,
            },
            "timestamp": 1,
        },
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", CLIENTS)
@pytest.mark.parametrize("strategy", ["Wait for the element", "direct-instruction"])
async def test_a_recovery_that_performed_the_original_action_is_not_repeated(
    kind: str, strategy: str
) -> None:
    # A commandless suggestion or the direct-instruction fallback executed the
    # ORIGINAL instruction and it reported success. Executing it again would
    # click Submit twice.
    server = _Server(_performed_answer(strategy))
    result = await _run(kind, server)

    assert server.executes == 1, "the original action must not be executed a second time"
    assert result.success is True
    assert result.executed_action == "click (performed by recovery)"
    assert result.total_attempts == 1
    assert result.recovery_attempted is True
    assert result.recovery_result is not None
    assert result.recovery_result.original_action_performed is True
    assert result.recovery_result.final_result is not None


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", CLIENTS)
async def test_no_recovery_is_posted_without_a_retry_budget(kind: str) -> None:
    # max_retries=1: the one execution failed and no retry remains, so no
    # recovery is posted (the server's fallback would run the original action,
    # which would then be reported as success: false beside a stated success).
    server = _Server(_performed_answer("direct-instruction"))
    result = await _run(kind, server, max_retries=1)

    assert server.recovery_calls == 0
    assert server.executes == 1
    assert result.success is False
    assert result.recovery_attempted is False
    assert result.recovery_result is None


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", CLIENTS)
@pytest.mark.parametrize(
    "answer",
    [RUNNER_400_RECOVERY_FAILED, TS_400_EXHAUSTED],
    ids=["runner-400-recovery-failed", "ts-400-exhausted"],
)
async def test_a_failed_attempt_reads_as_not_recovered(
    kind: str, answer: tuple[int, dict[str, Any]]
) -> None:
    server = _Server(answer)
    result = await _run(kind, server)

    assert result.success is False
    assert result.total_attempts == 1
    assert server.recovery_calls == 1
    # Recorded, not raised away: the attempt ran and the answer is kept.
    assert result.recovery_attempted is True
    assert result.recovery_result is not None
    assert result.recovery_result.attempt_succeeded is False
    assert result.recovery_result.http_status == 400
    assert result.recovery_result.error


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", CLIENTS)
@pytest.mark.parametrize(
    "answer",
    [VERDICTLESS_200, RUNNER_500_VERDICT_MISSING, LEGACY_TS_RECOVERED_FALSE, (502, None)],
    ids=["verdictless-200", "runner-500-verdict-missing", "legacy-recovered-false", "non-json"],
)
async def test_a_verdictless_answer_is_unknown_never_success(
    kind: str, answer: tuple[int, Any]
) -> None:
    server = _Server(answer)
    result = await _run(kind, server)

    assert result.success is False
    assert result.total_attempts == 1
    assert result.recovery_result is not None
    assert result.recovery_result.attempt_succeeded is None
    assert result.recovery_result.verdict_stated is False
    assert result.recovery_result.error
    # Reported as UNKNOWN, not as the client's own first failure.
    assert result.error == VERDICT_UNKNOWN_ERROR
    assert result.error_code == VERDICT_UNKNOWN_CODE


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", CLIENTS)
async def test_a_transport_failure_is_unknown(kind: str) -> None:
    server = _Server(httpx.ConnectError("refused"))
    result = await _run(kind, server)

    assert result.success is False
    assert result.recovery_result is not None
    assert result.recovery_result.attempt_succeeded is None
    assert result.recovery_result.error is not None
    assert "refused" in result.recovery_result.error
    assert result.error == VERDICT_UNKNOWN_ERROR
    assert result.error_code == VERDICT_UNKNOWN_CODE


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", CLIENTS)
async def test_a_non_transport_exception_propagates(kind: str) -> None:
    # Only `httpx.HTTPError` is read as "no answer, verdict UNKNOWN". Anything
    # else is a bug in the client or the caller's environment, and it is no
    # longer swallowed as "recovery failed".
    server = _Server(RuntimeError("client bug"))
    with pytest.raises(RuntimeError, match="client bug"):
        await _run(kind, server)
    assert server.recovery_calls == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", CLIENTS)
async def test_the_request_body_carries_the_real_serialized_failure(kind: str) -> None:
    # End to end: the failure the server answered is re-serialized by the
    # client, so the recovery route receives `command: null` for the
    # commandless suggestion and `null` for every unset optional — the shape
    # the TS validator must accept.
    server = _Server(TS_200)
    await _run(kind, server)

    assert server.recovery_bodies == [
        {
            "failure": PYTHON_FAILURE_DUMP,
            "instruction": "click Submit",
            "elementId": "btn-1",
            "maxRetries": 2,
        }
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", CLIENTS)
async def test_the_nested_relay_stub_reads_as_not_recovered(kind: str) -> None:
    server = _Server(RELAY_STUB_NESTED)
    result = await _run(kind, server)

    assert result.success is False
    assert result.recovery_result is not None
    assert result.recovery_result.attempt_succeeded is False


def test_the_reader_reads_original_action_performed_and_final_result() -> None:
    performed = read_recovery_attempt(*_performed_answer("direct-instruction"))
    assert performed.attempt_succeeded is True
    assert performed.original_action_performed is True
    assert performed.final_result is not None
    assert performed.final_result.executed_action == "click (performed by recovery)"

    assert read_recovery_attempt(*TS_200).original_action_performed is False
    # The runner does not state it: unstated, never assumed.
    assert read_recovery_attempt(*RUNNER_200).original_action_performed is None
    # A non-boolean value and an unparseable finalResult are dropped, and
    # neither costs the verdict.
    odd = {
        "success": True,
        "data": {"attemptSucceeded": True, "originalActionPerformed": "yes", "finalResult": {}},
    }
    result = read_recovery_attempt(200, odd)
    assert result.attempt_succeeded is True
    assert result.original_action_performed is None
    assert result.final_result is None


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", CLIENTS)
async def test_an_original_already_attempted_in_the_recovery_is_not_re_executed(
    kind: str,
) -> None:
    # The recovery ran the original (it reported failure), then a different
    # command succeeded. Re-running the original could repeat a partly applied
    # action, so the client stops and reports the original as not succeeded.
    server = _Server(TS_200_ORIGINAL_ATTEMPTED)
    result = await _run(kind, server)

    assert server.executes == 1, "the original must not be executed again"
    assert server.recovery_calls == 1
    assert result.success is False
    assert result.error == ORIGINAL_ALREADY_ATTEMPTED_ERROR
    assert result.error_code == "RECOVERY_ORIGINAL_ALREADY_ATTEMPTED"
    assert result.recovery_result is not None
    assert result.recovery_result.attempt_succeeded is True
    assert result.recovery_result.original_action_performed is False
    assert result.recovery_result.original_action_attempted is True


def test_the_reader_reads_original_action_attempted() -> None:
    assert read_recovery_attempt(*TS_200).original_action_attempted is False
    assert read_recovery_attempt(*TS_200_ORIGINAL_ATTEMPTED).original_action_attempted is True
    exhausted = read_recovery_attempt(*TS_400_EXHAUSTED)
    assert exhausted.original_action_attempted is True
    assert exhausted.final_result is not None
    assert exhausted.final_result.success is False
    assert read_recovery_attempt(*RUNNER_200).original_action_attempted is None
    assert read_recovery_attempt(*TS_200).final_result is not None


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", CLIENTS)
@pytest.mark.parametrize(
    "final",
    [None, {"success": True}, "failed"],
    ids=["absent", "unparseable", "parseable-but-failed"],
)
async def test_a_performed_recovery_without_a_final_result_borrows_nothing(
    kind: str, final: dict[str, Any] | str | None
) -> None:
    # The success record must not be the client's earlier FAILED execution:
    # without a parseable finalResult the action fields are UNKNOWN (None).
    status, body = _performed_answer("direct-instruction")
    if final is None:
        del body["data"]["finalResult"]
    elif final == "failed":
        # Parses as an NLActionResponse, but reports failure: not the record
        # of an execution that succeeded.
        body["data"]["finalResult"] = _WIRE_FAILED_RESULT
    else:
        body["data"]["finalResult"] = final
    server = _Server((status, body))
    result = await _run(kind, server)

    assert server.executes == 1
    assert result.success is True
    assert result.recovery_result is not None
    if final != "failed":
        assert result.recovery_result.final_result is None
    assert result.executed_action is None
    assert result.element_used is None
    assert result.element_state is None
    assert result.confidence is None
    assert result.duration_ms is None


def test_a_stated_success_inside_a_failed_5xx_is_unknown() -> None:
    # The TS server's fault arm after a strategy reported success.
    body = {
        "success": False,
        "error": "clock failed",
        "code": "UB-UNKNOWN-ERROR",
        "data": {
            "attemptSucceeded": True,
            "originalActionPerformed": False,
            "originalActionAttempted": False,
            "strategiesAttempted": ["First"],
            "finalResult": _WIRE_SCROLL_RESULT,
            "error": "clock failed",
            "durationMs": 3,
        },
    }
    result = read_recovery_attempt(500, body)
    assert result.attempt_succeeded is None
    # The same stated success inside a 4xx failure is still did-not-act.
    assert read_recovery_attempt(400, body).attempt_succeeded is False


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", CLIENTS)
async def test_a_failed_recovery_that_re_ran_the_original_says_so(kind: str) -> None:
    # attemptSucceeded false, originalActionAttempted true: the recovery's
    # fallback re-ran the original and it failed again. The error says that,
    # not the client's own first failure.
    server = _Server(TS_400_EXHAUSTED)
    result = await _run(kind, server)

    assert server.executes == 1
    assert result.success is False
    assert result.error == ORIGINAL_RETRIED_AND_FAILED_ERROR
    assert result.error_code == "RECOVERY_ORIGINAL_RETRIED_AND_FAILED"
    assert result.recovery_result is not None
    assert result.recovery_result.attempt_succeeded is False
    assert result.recovery_result.original_action_attempted is True


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", CLIENTS)
async def test_a_failed_recovery_that_did_not_run_the_original_keeps_the_clients_error(
    kind: str,
) -> None:
    # The runner's 400 states no originalActionAttempted: the client's own
    # last error stands.
    server = _Server(RUNNER_400_RECOVERY_FAILED)
    result = await _run(kind, server)

    assert result.success is False
    assert result.error == "Not visible"
    # The client's own error code stands beside its own error.
    assert result.error_code is None


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", CLIENTS)
async def test_a_stated_success_inside_a_failed_5xx_reports_unknown(kind: str) -> None:
    # The TS server's fault arm after a reported success.
    body = {
        "success": False,
        "error": "clock failed",
        "code": "UB-UNKNOWN-ERROR",
        "data": {
            "attemptSucceeded": True,
            "originalActionPerformed": False,
            "originalActionAttempted": False,
            "strategiesAttempted": ["First"],
            "finalResult": _WIRE_SCROLL_RESULT,
            "durationMs": 3,
        },
    }
    server = _Server((500, body))
    result = await _run(kind, server)

    assert server.executes == 1
    assert result.success is False
    assert result.recovery_result is not None
    assert result.recovery_result.attempt_succeeded is None
    assert result.error_code == VERDICT_UNKNOWN_CODE
