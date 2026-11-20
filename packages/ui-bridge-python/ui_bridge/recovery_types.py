"""
Recovery Types

Type definitions for recovery-enabled execution in UI Bridge.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from .ai_types import AIDiscoveredElement, NLActionResponse
from .types import ElementState


class StrategyStatus(str, Enum):
    """Status of a recovery strategy execution."""

    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"
    PARTIAL = "partial"


class RecoveryStrategyResult(BaseModel):
    """Result from executing a single recovery strategy."""

    strategy_name: str = Field(alias="strategyName")
    status: StrategyStatus
    message: str
    duration_ms: float = Field(alias="durationMs")

    model_config = {"populate_by_name": True}


class RecoveryContext(BaseModel):
    """Context for recovery execution."""

    error_code: str = Field(alias="errorCode")
    instruction: str
    element_id: str | None = Field(default=None, alias="elementId")
    max_retries: int = Field(alias="maxRetries")

    model_config = {"populate_by_name": True}


class RecoveryExecutorConfig(BaseModel):
    """Configuration for the recovery executor."""

    max_retries: int = Field(default=3, alias="maxRetries")
    retry_delay_ms: int = Field(default=500, alias="retryDelayMs")
    exponential_backoff: bool = Field(default=True, alias="exponentialBackoff")
    strategies: list[str] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class RecoveryExecutorResult(BaseModel):
    """The answer to one ``POST /ai/recovery/attempt``.

    ``attempt_succeeded`` (wire name ``attemptSucceeded``) is THE verdict, the
    field both servers state: the runner's ``/ai/recovery/attempt`` and the TS
    SDK server's ``attemptRecovery``. It has three values, not two:

    - ``True``: a recovery strategy's action reported success. Whether the
      ORIGINAL action now succeeds depends on ``original_action_performed``:
      when ``True``, the acting strategy executed the original instruction
      itself and it reported success (``final_result``), so it must not be
      performed again. Otherwise, only an explicit
      ``original_action_attempted is False`` permits a retry (see below).
    - ``False``: no strategy reported success, or the attempt was refused (an
      HTTP 4xx or ``success: false`` envelope, e.g. the runner's 400
      ``RECOVERY_FAILED``). It does not promise the UI is unchanged: an action
      that reported failure may have partly applied.
    - ``None``: the answer stated no verdict (a verdict-less body, the runner's
      500 ``RECOVERY_VERDICT_MISSING``, a transport failure). Whether the
      attempt acted is UNKNOWN, and it is never read as a success.

    ``original_action_performed`` and ``original_action_attempted`` (wire
    names ``originalActionPerformed`` / ``originalActionAttempted``) are stated
    by the TS SDK server and are ``None`` when an answer does not state them,
    which is the case for the runner's route today. On
    ``attempt_succeeded is True`` the clients decide as follows:

    - ``original_action_performed is True``: the original ran inside the
      recovery and succeeded. Return success; do not execute again.
    - ``original_action_attempted is False`` (explicit): the original did not
      run in the recovery; a different command acted. Retry the original.
    - ``original_action_attempted is True``: the original ran inside the
      recovery and reported failure, then a different strategy succeeded. Stop
      without re-executing (``ORIGINAL_ALREADY_ATTEMPTED_ERROR``): a failed
      action may have partly applied.
    - ``original_action_attempted is None`` (UNSTATED, e.g. the runner): UNKNOWN
      whether the original ran. Stop without re-executing
      (``ORIGINAL_OUTCOME_UNKNOWN_ERROR``). The runner's scoped recovery DOES
      execute the original instruction on the addressed element
      (qontinui-runner ``useAISearchEvents.ts``, ``ai_recovery_attempt``), so
      a retry could perform the action twice.

    Build one from an HTTP answer with :func:`read_recovery_attempt`.
    """

    attempt_succeeded: bool | None = Field(default=None, alias="attemptSucceeded")
    original_action_performed: bool | None = Field(default=None, alias="originalActionPerformed")
    original_action_attempted: bool | None = Field(default=None, alias="originalActionAttempted")
    final_result: NLActionResponse | None = Field(default=None, alias="finalResult")
    strategies_attempted: list[str] = Field(default_factory=list, alias="strategiesAttempted")
    strategy_results: list[RecoveryStrategyResult] = Field(
        default_factory=list, alias="strategyResults"
    )
    error: str | None = None
    code: str | None = None
    http_status: int | None = Field(default=None, alias="httpStatus")

    model_config = {"populate_by_name": True}

    @property
    def verdict_stated(self) -> bool:
        """Whether the answer stated a verdict at all (``False`` means UNKNOWN)."""
        return self.attempt_succeeded is not None


def _error_text(value: Any) -> str | None:
    """The message of a string ``error``, or of the object shape ``{message}``."""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        message = value.get("message")
        if isinstance(message, str):
            return message
    return None


def _answer_code(body: dict[str, Any], data: dict[str, Any]) -> str | None:
    """The answer's machine-readable code.

    The runner's typed token in ``error_detail.context.code`` wins: its envelope
    middleware rewrites the top-level ``code`` of a ``RECOVERY_VERDICT_MISSING``
    500 to ``INTERNAL_ERROR``, and the token survives in ``error_detail.context.code``
    (and ``context.displaced_top_level_code``).
    """
    detail = body.get("error_detail")
    if isinstance(detail, dict):
        context = detail.get("context")
        if isinstance(context, dict) and isinstance(context.get("code"), str):
            return str(context["code"])
    for source in (body, data):
        code = source.get("code")
        if isinstance(code, str):
            return code
    return None


def read_recovery_attempt(status_code: int, body: Any) -> RecoveryExecutorResult:
    """Read one ``POST /ai/recovery/attempt`` answer, whatever its HTTP status.

    The verdict, in order: the runner's ``attempt_verdict`` rule (steps 1 and 3),
    plus a 5xx-is-UNKNOWN arm for a verdict-less ``success: false`` (step 2), which
    the runner does not need because it reads the frontend's reply, not an HTTP
    answer:

    1. ``data.attemptSucceeded`` is a boolean: that is the verdict, except that
       an explicit ``success: false`` (on the envelope or on ``data``) is
       ``False`` whatever ``attemptSucceeded`` says, and a stated ``true``
       inside a failed 5xx envelope is ``None``. That 5xx is the TS server
       failing to answer after a strategy reported success: neither reading
       is safe, so the client neither retries nor reports success.
    2. No stated verdict but an explicit ``success: false``: ``False`` (did not
       act) on any status below 500, e.g. the runner's 400 ``RECOVERY_FAILED``,
       which carries no ``data``. On a 5xx it is ``None``: the runner's 500
       ``RECOVERY_VERDICT_MISSING`` and a frontend that never answered are not
       attempt verdicts.
    3. Anything else (a 2xx with no ``attemptSucceeded``, a body that is not a
       JSON object): ``None``, UNKNOWN, never success.

    ``originalActionPerformed`` and ``originalActionAttempted`` are read only as
    booleans (else ``None``), and
    ``finalResult`` only when it parses as an ``NLActionResponse`` (else
    ``None``). Neither can change the verdict.

    Known limitation, through the runner's SDK twin
    (``/ui-bridge/sdk/ai/recovery/attempt``): every dispatch error, including a
    timeout after the request was already sent to the app, arrives as HTTP 200
    ``{success: false, error}`` with no typed code, so step 2 reads it as
    ``False`` even when the app may have acted. That stays so until the twin
    carries a typed code (a later runner phase); this reader does not guess
    from the error text.
    """
    if not isinstance(body, dict):
        return RecoveryExecutorResult(
            attempt_succeeded=None,
            error=(
                f"recovery attempt answered HTTP {status_code} with no JSON object; "
                "whether it acted is unknown"
            ),
            http_status=status_code,
        )

    raw_data = body.get("data")
    data: dict[str, Any] = raw_data if isinstance(raw_data, dict) else {}
    explicit_failure = body.get("success") is False or data.get("success") is False
    stated = data.get("attemptSucceeded")

    verdict: bool | None
    if isinstance(stated, bool):
        if stated and explicit_failure and status_code >= 500:
            # A stated success inside a failed 5xx: the server says a strategy
            # acted, then failed to answer (the TS server's fault arm after a
            # reported success). Neither "acted" nor "did not act" is safe.
            verdict = None
        else:
            verdict = stated and not explicit_failure
    elif explicit_failure:
        verdict = None if status_code >= 500 else False
    else:
        verdict = None

    error = _error_text(body.get("error")) or _error_text(data.get("error"))
    if verdict is None and error is None:
        error = (
            f"recovery attempt answered HTTP {status_code} without an attemptSucceeded "
            "verdict; whether it acted is unknown"
        )

    # An absent originalActionPerformed / originalActionAttempted stays None
    # (UNKNOWN), never "not run": the runner's scoped recovery executes the
    # original instruction itself, and states neither field.
    performed = data.get("originalActionPerformed")
    attempted = data.get("originalActionAttempted")
    final_result: NLActionResponse | None = None
    if isinstance(data.get("finalResult"), dict):
        try:
            final_result = NLActionResponse.model_validate(data["finalResult"])
        except ValidationError:
            final_result = None

    fields: dict[str, Any] = {
        "attemptSucceeded": verdict,
        "originalActionPerformed": performed if isinstance(performed, bool) else None,
        "originalActionAttempted": attempted if isinstance(attempted, bool) else None,
        "finalResult": final_result,
        "error": error,
        "code": _answer_code(body, data),
        "httpStatus": status_code,
    }
    extras = {key: data[key] for key in ("strategiesAttempted", "strategyResults") if key in data}
    try:
        return RecoveryExecutorResult.model_validate({**extras, **fields})
    except ValidationError:
        # A malformed optional field never costs the verdict.
        return RecoveryExecutorResult.model_validate(fields)


class ExecuteWithRecoveryResult(BaseModel):
    """Result from executing an action with automatic recovery.

    ``executed_action``, ``confidence`` and ``duration_ms`` are ``None`` only
    when they are UNKNOWN: a recovery that performed the original action
    without sending a parseable ``finalResult`` (see
    :func:`performed_recovery_result`).
    """

    success: bool
    executed_action: str | None = Field(alias="executedAction")
    element_used: AIDiscoveredElement | None = Field(default=None, alias="elementUsed")
    confidence: float | None
    element_state: ElementState | None = Field(default=None, alias="elementState")
    duration_ms: float | None = Field(alias="durationMs")
    timestamp: int
    error: str | None = None
    error_code: str | None = Field(default=None, alias="errorCode")
    recovery_attempted: bool = Field(default=False, alias="recoveryAttempted")
    recovery_result: RecoveryExecutorResult | None = Field(default=None, alias="recoveryResult")
    total_attempts: int = Field(default=1, alias="totalAttempts")
    total_duration_ms: float = Field(default=0.0, alias="totalDurationMs")

    model_config = {"populate_by_name": True}


# Default recovery configuration
DEFAULT_RECOVERY_CONFIG = RecoveryExecutorConfig(
    max_retries=3,
    retry_delay_ms=500,
    exponential_backoff=True,
    strategies=[
        "retry",
        "wait_visible",
        "wait_enabled",
        "scroll_into_view",
        "dismiss_overlay",
        "alternative_element",
        "refresh",
    ],
)

# Mapping of error codes to recommended recovery strategies
ERROR_CODE_STRATEGIES: dict[str, list[str]] = {
    "ELEMENT_NOT_FOUND": ["wait_visible", "scroll_into_view", "alternative_element", "refresh"],
    "ELEMENT_NOT_VISIBLE": ["wait_visible", "scroll_into_view", "dismiss_overlay"],
    "ELEMENT_NOT_ENABLED": ["wait_enabled", "dismiss_overlay"],
    "ELEMENT_DISABLED": ["wait_enabled"],
    "ACTION_TIMEOUT": ["retry", "wait_visible", "wait_enabled"],
    "LOW_CONFIDENCE": ["alternative_element"],
    "OVERLAY_BLOCKING": ["dismiss_overlay"],
}


def performed_recovery_result(
    recovery: RecoveryExecutorResult,
    *,
    total_attempts: int,
    total_duration_ms: float,
    timestamp: int,
) -> ExecuteWithRecoveryResult:
    """The success result for a recovery that already performed the original action.

    Used when the attempt states ``attemptSucceeded: true`` AND
    ``originalActionPerformed: true``: the original instruction ran inside the
    recovery and reported success, so it must not run again.

    The action fields (``executed_action``, ``element_used``, ``confidence``,
    ``element_state``, ``duration_ms``, ``timestamp``) come from the recovery's
    ``final_result``, the record of the execution that succeeded, and only when
    that result itself says ``success is True``. When the server sent none that
    parses, or one that does not report success, they are left ``None``
    (UNKNOWN), and
    ``timestamp`` is the client's own record time. They are never borrowed from
    the client's earlier FAILED execution: that is a different execution, and
    its state is the state the action failed in. The verdict is still success,
    because the server stated it; ``recovery_result`` carries it.
    """
    # Only a final result that itself reports success is the record of the
    # execution that succeeded.
    acted = (
        recovery.final_result if (recovery.final_result and recovery.final_result.success) else None
    )
    return ExecuteWithRecoveryResult(
        success=True,
        executed_action=acted.executed_action if acted else None,
        element_used=acted.element_used if acted else None,
        confidence=acted.confidence if acted else None,
        element_state=acted.element_state if acted else None,
        duration_ms=acted.duration_ms if acted else None,
        timestamp=acted.timestamp if acted else timestamp,
        recovery_attempted=True,
        recovery_result=recovery,
        total_attempts=total_attempts,
        total_duration_ms=total_duration_ms,
    )


#: The error an ``ExecuteWithRecoveryResult`` carries when the recovery already
#: ran the original instruction (it reported failure) and a different strategy
#: then succeeded: the client does not re-execute it.
ORIGINAL_ALREADY_ATTEMPTED_ERROR = (
    "the recovery already executed the original instruction once and it reported "
    "failure; it is not executed again (a failed action may have partly applied)"
)


#: The error an ``ExecuteWithRecoveryResult`` carries when the recovery acted
#: (``attemptSucceeded: true``) but did not state whether it executed the
#: original instruction (``originalActionAttempted`` absent, e.g. the runner).
#: ``success`` is ``False`` because the original action is not KNOWN to have
#: succeeded; it is not known to have failed either. The client does not retry,
#: because the recovery may already have performed it.
ORIGINAL_OUTCOME_UNKNOWN_ERROR = (
    "the recovery acted but did not state whether it executed the original "
    "instruction; the original action's outcome is UNKNOWN and it is not "
    "executed again (it may already have been performed)"
)


#: The error an ``ExecuteWithRecoveryResult`` carries when the recovery did not
#: act (``attemptSucceeded: false``) but DID re-run the original instruction
#: in it (``originalActionAttempted: true``), and that run failed again.
ORIGINAL_RETRIED_AND_FAILED_ERROR = (
    "the recovery re-ran the original instruction and it failed again; no "
    "recovery strategy succeeded"
)


#: The ``error_code`` beside each stop error, so ``error`` and ``error_code``
#: describe the same thing.
ORIGINAL_ALREADY_ATTEMPTED_CODE = "RECOVERY_ORIGINAL_ALREADY_ATTEMPTED"
ORIGINAL_OUTCOME_UNKNOWN_CODE = "RECOVERY_ORIGINAL_OUTCOME_UNKNOWN"
ORIGINAL_RETRIED_AND_FAILED_CODE = "RECOVERY_ORIGINAL_RETRIED_AND_FAILED"

#: The error an ``ExecuteWithRecoveryResult`` carries when the recovery's own
#: verdict is UNKNOWN (``attempt_succeeded is None``: a transport error, a 2xx
#: with no verdict, the runner's 500 ``RECOVERY_VERDICT_MISSING``, the TS
#: server's fault arm after a reported success). The client's own first error
#: would read as a definite failure, which nothing established.
VERDICT_UNKNOWN_ERROR = (
    "the recovery attempt's outcome is UNKNOWN: whether it acted, and whether it "
    "ran the original instruction, was not stated; the original is not executed again"
)
VERDICT_UNKNOWN_CODE = "RECOVERY_VERDICT_UNKNOWN"


def recovery_stop(recovery: RecoveryExecutorResult | None) -> tuple[str, str] | None:
    """``(error, error_code)`` saying what the recovery ran, for a loop that
    stopped after it, or ``None`` when the client's own last error says it
    better."""
    if recovery is None:
        return None
    if recovery.attempt_succeeded is False:
        if recovery.original_action_attempted is True:
            return ORIGINAL_RETRIED_AND_FAILED_ERROR, ORIGINAL_RETRIED_AND_FAILED_CODE
        return None
    if recovery.attempt_succeeded is None:
        return VERDICT_UNKNOWN_ERROR, VERDICT_UNKNOWN_CODE
    if recovery.original_action_attempted is True:
        return ORIGINAL_ALREADY_ATTEMPTED_ERROR, ORIGINAL_ALREADY_ATTEMPTED_CODE
    if recovery.original_action_attempted is None:
        return ORIGINAL_OUTCOME_UNKNOWN_ERROR, ORIGINAL_OUTCOME_UNKNOWN_CODE
    return None
