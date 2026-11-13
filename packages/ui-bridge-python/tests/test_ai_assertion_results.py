"""An ``ai/assert`` result parses in every outcome the SDK answers with.

An ``unmeasured`` result carries no ``actual`` at all - a check that could not
read its value has none, and JSON drops the undefined key - so the model must
read a result without it. ``failedCount`` counts every assertion that did not
pass; ``unmeasuredCount`` is the subset of those that could not read their
value, and an SDK build that predates it sends none.
"""

from __future__ import annotations

import copy

import pytest
from pydantic import BaseModel, ValidationError

from ui_bridge.ai_types import (
    AssertionOutcome,
    AssertionResult,
    BatchAssertionResult,
)
from ui_bridge.observation import UnknownCode

# What `POST /ai/assert` answers for a custom property the element does not set.
UNMEASURED: dict[str, object] = {
    "passed": False,
    "outcome": "unmeasured",
    "unmeasured": {
        "code": "input_missing",
        "detail": "custom property `--not-set` is not set on this element",
    },
    "target": "save",
    "targetDescription": "save button",
    "expected": "x",
    "failureReason": (
        'Cannot check CSS property "--not-set": '
        "custom property `--not-set` is not set on this element"
    ),
    "failureCode": "UB-OBS-INPUT-MISSING",
    "durationMs": 0.4,
    "timestamp": 1_700_000_000_000,
}

FAILED: dict[str, object] = {
    "passed": False,
    "outcome": "failed",
    "target": "save",
    "targetDescription": "save button",
    "expected": "fr",
    "actual": "de",
    "failureReason": 'Attribute "lang" is "de" but expected "fr"',
    "durationMs": 0.2,
    "timestamp": 1_700_000_000_000,
}


def test_the_models_are_the_real_ones() -> None:
    # tests/conftest.py stubs ui_bridge.ai_types with a MagicMock when it fails
    # to import; every check below would then be against the stub.
    assert issubclass(AssertionResult, BaseModel)
    assert issubclass(BatchAssertionResult, BaseModel)


def test_an_unmeasured_result_parses_without_actual() -> None:
    assert "actual" not in UNMEASURED
    result = AssertionResult.model_validate(UNMEASURED)
    assert result.passed is False
    assert result.outcome is AssertionOutcome.UNMEASURED
    assert result.unmeasured is not None
    assert result.unmeasured.code is UnknownCode.INPUT_MISSING
    assert result.unmeasured.detail == "custom property `--not-set` is not set on this element"
    assert result.actual is None


def test_a_failed_result_keeps_its_value() -> None:
    result = AssertionResult.model_validate(FAILED)
    assert result.outcome is AssertionOutcome.FAILED
    assert result.unmeasured is None
    assert result.actual == "de"


def test_a_result_with_no_expected_value_parses() -> None:
    bare = copy.deepcopy(FAILED)
    del bare["expected"]
    del bare["actual"]
    result = AssertionResult.model_validate(bare)
    assert result.expected is None
    assert result.actual is None


def test_a_result_from_a_build_before_outcome_still_parses() -> None:
    legacy = copy.deepcopy(FAILED)
    del legacy["outcome"]
    assert AssertionResult.model_validate(legacy).outcome is None


def test_an_unmeasured_code_outside_the_closed_set_is_refused() -> None:
    forged = copy.deepcopy(UNMEASURED)
    forged["unmeasured"] = {"code": "looked_but_shrugged", "detail": "?"}
    with pytest.raises(ValidationError):
        AssertionResult.model_validate(forged)


def test_the_batch_counts_the_unmeasured_inside_failed_count() -> None:
    batch = BatchAssertionResult.model_validate(
        {
            "passed": False,
            "results": [UNMEASURED, FAILED],
            "passedCount": 0,
            "failedCount": 2,
            "unmeasuredCount": 1,
            "durationMs": 1.0,
            "timestamp": 1_700_000_000_000,
        }
    )
    assert batch.failed_count == 2
    assert batch.unmeasured_count == 1
    assert [r.outcome for r in batch.results] == [
        AssertionOutcome.UNMEASURED,
        AssertionOutcome.FAILED,
    ]


def test_a_batch_from_a_build_before_unmeasured_count_reads_zero() -> None:
    batch = BatchAssertionResult.model_validate(
        {
            "passed": False,
            "results": [FAILED],
            "passedCount": 0,
            "failedCount": 1,
            "durationMs": 1.0,
            "timestamp": 1_700_000_000_000,
        }
    )
    assert batch.unmeasured_count == 0
