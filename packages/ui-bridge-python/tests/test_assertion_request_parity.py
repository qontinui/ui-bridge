"""The Python assertion request reaches parity with the TS SDK's.

``AssertionType`` and ``AssertionRequest`` are hand-mirrored from
``packages/ui-bridge/src/ai/types.ts``. Before this test they lagged it by five
types and five fields, so a Python caller could not send ``noOverlap`` /
``minSpacing`` at all, nor the ``relatedTarget`` the SDK refuses those two
without. The parity rows read the TS source, so the next type or field added
there fails here instead of silently being unreachable from Python.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from ui_bridge import (
    AssertionRange,
    AssertionRequest,
    AssertionResult,
    AssertionType,
    BatchAssertionResult,
    SearchCriteria,
    UiBridgeErrorCode,
)
from ui_bridge.async_client import AsyncUIBridgeClient
from ui_bridge.client import UIBridgeClient

TS_TYPES = Path(__file__).resolve().parents[2] / "ui-bridge" / "src" / "ai" / "types.ts"


def _ts_source() -> str:
    if not TS_TYPES.is_file():
        pytest.skip(f"TS SDK source not present at {TS_TYPES} (sdist install)")
    return TS_TYPES.read_text(encoding="utf-8")


def _result_data() -> dict[str, Any]:
    return {
        "passed": True,
        "target": "a",
        "targetDescription": "a",
        "expected": None,
        "actual": None,
        "durationMs": 1.0,
        "timestamp": 1,
    }


def _batch_data() -> dict[str, Any]:
    return {
        "passed": True,
        "results": [],
        "passedCount": 0,
        "failedCount": 0,
        "durationMs": 1.0,
        "timestamp": 1,
    }


class TestParityWithTsSource:
    def test_assertion_type_values_match_the_ts_union(self) -> None:
        src = _ts_source()
        union = re.search(r"export type AssertionType =([^;]+);", src)
        assert union, "AssertionType union not found in types.ts"
        ts_values = set(re.findall(r"'([^']+)'", union.group(1)))
        assert ts_values, "AssertionType union parsed empty"
        assert {t.value for t in AssertionType} == ts_values

    def test_assertion_request_carries_every_ts_field(self) -> None:
        src = _ts_source()
        body = re.search(r"export interface AssertionRequest \{(.*?)\n\}", src, re.S)
        assert body, "AssertionRequest interface not found in types.ts"
        ts_fields = set(re.findall(r"^\s+([A-Za-z]+)\??:", body.group(1), re.M))
        assert ts_fields, "AssertionRequest interface parsed empty"
        py_fields = {f.alias or name for name, f in AssertionRequest.model_fields.items()}
        # Both directions: a Python field the TS request lacks is one the server never reads.
        assert py_fields == ts_fields

    @pytest.mark.parametrize(
        ("interface", "model"),
        [("AssertionResult", AssertionResult), ("BatchAssertionResult", BatchAssertionResult)],
    )
    def test_result_models_read_every_ts_field(self, interface: str, model: Any) -> None:
        # The result side too: a field the SDK sends that Python does not model is
        # dropped on parse (``failureCode`` was, so a Python caller never saw the
        # ``UB-VALIDATION-ERROR`` a spatial check without ``relatedTarget`` returns).
        src = _ts_source()
        body = re.search(rf"export interface {interface} \{{(.*?)\n\}}", src, re.S)
        assert body, f"{interface} interface not found in types.ts"
        # Top-level members only: nested object literals are indented deeper.
        ts_fields = set(re.findall(r"^  ([A-Za-z]+)\??:", body.group(1), re.M))
        assert ts_fields, f"{interface} interface parsed empty"
        py_fields = {f.alias or name for name, f in model.model_fields.items()}
        assert py_fields == ts_fields


class TestResultDecoding:
    def test_failure_code_and_search_details_are_read(self) -> None:
        result = AssertionResult.model_validate(
            {
                **_result_data(),
                "passed": False,
                "outcome": "failed",
                "failureCode": "UB-VALIDATION-ERROR",
                "searchDetails": {
                    "confidence": 0.9,
                    "matchReasons": ["text"],
                    "candidateCount": 3,
                },
            }
        )
        assert result.failure_code == UiBridgeErrorCode.VALIDATION_ERROR
        assert result.search_details is not None
        assert result.search_details.candidate_count == 3
        assert result.search_details.match_reasons == ["text"]

    def test_unknown_failure_code_passes_through_as_str(self) -> None:
        result = AssertionResult.model_validate(
            {**_result_data(), "passed": False, "failureCode": "UB-FUTURE-CODE"}
        )
        assert result.failure_code == "UB-FUTURE-CODE"

    def test_result_without_new_fields_still_parses(self) -> None:
        result = AssertionResult.model_validate(_result_data())
        assert result.failure_code is None
        assert result.search_details is None


class TestWireShape:
    def test_spatial_request_serializes_with_camel_case_aliases(self) -> None:
        req = AssertionRequest(
            target="header",
            type=AssertionType.MIN_SPACING,
            related_target={"role": "main"},
            min_gap=8,
        )
        wire = req.model_dump(by_alias=True, exclude_none=True)
        assert wire == {
            "target": "header",
            "type": "minSpacing",
            # SearchCriteria defaults ``fuzzy`` to True, as for every target.
            "relatedTarget": {"role": "main", "fuzzy": True},
            "minGap": 8,
        }

    def test_css_request_fields_serialize(self) -> None:
        req = AssertionRequest(
            target="btn",
            type="cssPropertyRange",
            property_name="font-size",
            range=AssertionRange(min=12, max=16),
        )
        assert req.model_dump(by_alias=True, exclude_none=True) == {
            "target": "btn",
            "type": "cssPropertyRange",
            "propertyName": "font-size",
            "range": {"min": 12, "max": 16},
        }


class TestSyncClientSendsEveryField:
    def test_assert_that_forwards_spatial_and_css_fields(self) -> None:
        client = UIBridgeClient(base_url="http://localhost:9876")
        client._request = MagicMock(return_value=_result_data())  # type: ignore[method-assign]
        client.ai.assert_that(
            "header",
            "noOverlap",
            related_target="footer",
            fuzzy=True,
            timeout=500,
        )
        client.ai.assert_that(
            "btn",
            "cssPropertyInSet",
            property_name="color",
            allowed_values=["red", "blue"],
        )
        client.ai.assert_that(
            "btn", "cssPropertyRange", property_name="width", range={"min": 1, "max": 9}
        )
        client.ai.assert_that("btn", "tokenCompliance", property_name="color", token_path="c.p")
        client.ai.assert_that("img", "attribute", "x", attribute_name="alt")

        payloads = [c.kwargs["json"] for c in client._request.call_args_list]
        assert payloads[0] == {
            "target": "header",
            "type": "noOverlap",
            "relatedTarget": "footer",
            "fuzzy": True,
            "timeout": 500,
        }
        assert payloads[1]["allowedValues"] == ["red", "blue"]
        assert payloads[1]["propertyName"] == "color"
        assert payloads[2]["range"] == {"min": 1, "max": 9}
        assert payloads[3]["tokenPath"] == "c.p"
        assert payloads[4]["attributeName"] == "alt"

    def test_assert_that_accepts_search_criteria_target(self) -> None:
        client = UIBridgeClient(base_url="http://localhost:9876")
        client._request = MagicMock(return_value=_result_data())  # type: ignore[method-assign]
        client.ai.assert_no_overlap(SearchCriteria(role="banner"), "footer")
        assert client._request.call_args.kwargs["json"] == {
            "target": {"role": "banner", "fuzzy": True},
            "type": "noOverlap",
            "relatedTarget": "footer",
        }

    def test_assert_batch_accepts_request_objects_beside_tuples(self) -> None:
        client = UIBridgeClient(base_url="http://localhost:9876")
        client._request = MagicMock(return_value=_batch_data())  # type: ignore[method-assign]
        client.ai.assert_batch(
            [
                ("btn", "visible"),
                AssertionRequest(target="a", type="minSpacing", related_target="b", min_gap=4),
            ]
        )
        sent = client._request.call_args.kwargs["json"]["assertions"]
        assert sent[0] == {"target": "btn", "type": "visible"}
        assert sent[1] == {"target": "a", "type": "minSpacing", "relatedTarget": "b", "minGap": 4}


class TestAsyncClientSendsEveryField:
    @pytest.mark.asyncio
    async def test_assert_that_forwards_related_target_and_min_gap(self) -> None:
        client = AsyncUIBridgeClient(base_url="http://localhost:9876")
        client._request = AsyncMock(return_value=_result_data())  # type: ignore[method-assign]
        await client.ai.assert_that("a", "minSpacing", related_target={"text": "b"}, min_gap=2)
        assert client._request.call_args.kwargs["json"] == {
            "target": "a",
            "type": "minSpacing",
            "relatedTarget": {"text": "b", "fuzzy": True},
            "minGap": 2,
        }

    @pytest.mark.asyncio
    async def test_assert_batch_accepts_request_objects(self) -> None:
        client = AsyncUIBridgeClient(base_url="http://localhost:9876")
        client._request = AsyncMock(return_value=_batch_data())  # type: ignore[method-assign]
        await client.ai.assert_batch(
            [AssertionRequest(target="a", type="noOverlap", related_target="b")]
        )
        sent = client._request.call_args.kwargs["json"]["assertions"]
        assert sent == [{"target": "a", "type": "noOverlap", "relatedTarget": "b"}]


class TestSpatialHelpers:
    def test_sync_helpers_require_and_send_related_target(self) -> None:
        client = UIBridgeClient(base_url="http://localhost:9876")
        client._request = MagicMock(return_value=_result_data())  # type: ignore[method-assign]
        client.ai.assert_no_overlap("a", "b")
        client.ai.assert_min_spacing("a", "b", 12)
        payloads = [c.kwargs["json"] for c in client._request.call_args_list]
        assert payloads == [
            {"target": "a", "type": "noOverlap", "relatedTarget": "b"},
            {"target": "a", "type": "minSpacing", "relatedTarget": "b", "minGap": 12},
        ]

    @pytest.mark.asyncio
    async def test_async_helpers_require_and_send_related_target(self) -> None:
        client = AsyncUIBridgeClient(base_url="http://localhost:9876")
        client._request = AsyncMock(return_value=_result_data())  # type: ignore[method-assign]
        await client.ai.assert_no_overlap("a", "b")
        await client.ai.assert_min_spacing("a", "b", 12)
        payloads = [c.kwargs["json"] for c in client._request.call_args_list]
        assert payloads == [
            {"target": "a", "type": "noOverlap", "relatedTarget": "b"},
            {"target": "a", "type": "minSpacing", "relatedTarget": "b", "minGap": 12},
        ]
