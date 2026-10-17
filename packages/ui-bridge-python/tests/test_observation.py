"""Tests for the Observation envelope mirror and the media find row.

``fixtures/sdk_find_media_response.json`` is a REAL ``find`` response captured
from the TypeScript SDK (``DefaultActionExecutor.find({mediaOnly: true,
oversizeThreshold: 1.5})`` over two registered images at DPR 2), so these tests
hold the Python mirror to the wire shape the SDK actually emits rather than to
a hand-written copy of it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import TypeAdapter, ValidationError

from ui_bridge import (
    AbsentObservation,
    FindRequest,
    FindResponse,
    MeasuredObservation,
    MediaFacts,
    MediaObservation,
    UnknownCode,
    UnknownObservation,
    media_facts_of,
    unmeasured_media_dimension,
)

FIXTURE = Path(__file__).parent / "fixtures" / "sdk_find_media_response.json"

MEDIA = TypeAdapter(MediaObservation)


def provenance(**overrides: Any) -> dict[str, Any]:
    prov: dict[str, Any] = {
        "producer": {"id": "sdk/media-discovery", "version": "0.31.0"},
        "observedAt": "2026-10-13T08:00:00.000Z",
        "evaluatedAt": "2026-10-13T08:00:00.000Z",
        "coverage": {"considered": 1, "measured": 1, "unmeasured": []},
        "confidence": None,
        "cache": None,
        "source": None,
    }
    prov.update(overrides)
    return prov


FACTS = {
    "mediaType": "image",
    "isDecorative": False,
    "renderedWidth": 100,
    "renderedHeight": 100,
}


class TestEnvelope:
    def test_measured_parses_to_facts(self) -> None:
        obs = MEDIA.validate_python(
            {"status": "measured", "value": FACTS, "provenance": provenance()}
        )
        assert isinstance(obs, MeasuredObservation)
        facts = media_facts_of(obs)
        assert isinstance(facts, MediaFacts)
        assert facts.rendered_width == 100

    def test_unknown_carries_a_closed_code(self) -> None:
        obs = MEDIA.validate_python(
            {
                "status": "unknown",
                "unknown": {"code": "producer_failed", "detail": "media capture threw TypeError"},
                "provenance": provenance(),
            }
        )
        assert isinstance(obs, UnknownObservation)
        assert obs.unknown.code is UnknownCode.PRODUCER_FAILED
        assert media_facts_of(obs) is None

    def test_an_unknown_code_outside_the_closed_set_is_refused(self) -> None:
        with pytest.raises(ValidationError):
            MEDIA.validate_python(
                {
                    "status": "unknown",
                    "unknown": {"code": "it_broke", "detail": "?"},
                    "provenance": provenance(),
                }
            )

    def test_absent_over_full_coverage_is_legal(self) -> None:
        obs = MEDIA.validate_python({"status": "absent", "provenance": provenance()})
        assert isinstance(obs, AbsentObservation)

    @pytest.mark.parametrize(
        "coverage",
        [
            {"considered": 0, "measured": 0, "unmeasured": []},
            {"considered": 2, "measured": 1, "unmeasured": []},
            {
                "considered": 1,
                "measured": 0,
                "unmeasured": [{"dimension": "src", "count": 1, "code": "input_missing"}],
            },
        ],
    )
    def test_absent_without_full_coverage_is_refused(self, coverage: dict[str, Any]) -> None:
        with pytest.raises(ValidationError):
            MEDIA.validate_python({"status": "absent", "provenance": provenance(coverage=coverage)})

    @pytest.mark.parametrize("key", ["observedAt", "confidence", "cache", "source"])
    def test_a_missing_provenance_key_is_refused_not_defaulted(self, key: str) -> None:
        prov = provenance()
        del prov[key]
        with pytest.raises(ValidationError):
            MEDIA.validate_python({"status": "measured", "value": FACTS, "provenance": prov})

    def test_unmeasured_dimension_reads_the_coverage(self) -> None:
        obs = MEDIA.validate_python(
            {
                "status": "measured",
                "value": FACTS,
                "provenance": provenance(
                    coverage={
                        "considered": 1,
                        "measured": 0,
                        "unmeasured": [
                            {
                                "dimension": "effectiveResolution",
                                "count": 1,
                                "code": "input_missing",
                            }
                        ],
                    }
                ),
            }
        )
        assert unmeasured_media_dimension(obs, "effectiveResolution") is UnknownCode.INPUT_MISSING
        assert unmeasured_media_dimension(obs, "src") is None


class TestSdkFindResponse:
    """The captured SDK response parses whole, and reads as the SDK meant it."""

    @pytest.fixture
    def response(self) -> FindResponse:
        return FindResponse.model_validate(json.loads(FIXTURE.read_text()))

    def test_the_media_row_carries_its_observation(self, response: FindResponse) -> None:
        assert [e.id for e in response.elements] == ["img-hero"]
        row = response.elements[0]
        assert row.category == "media"
        facts = media_facts_of(row.media_metadata)
        assert facts is not None
        # 400 source px in a 100 CSS px box at DPR 2: twice the pixels shown.
        assert facts.device_pixel_ratio == 2
        assert facts.effective_resolution == 2
        assert facts.loading == "lazy"
        assert facts.dims_reserved is True
        assert facts.slot_id == "hero"

    def test_the_state_carries_the_same_observation(self, response: FindResponse) -> None:
        state_facts = media_facts_of(response.elements[0].state.media_metadata)
        assert state_facts is not None
        assert state_facts.effective_resolution == 2

    def test_unmeasured_facts_are_named_not_zeroed(self, response: FindResponse) -> None:
        obs = response.elements[0].media_metadata
        assert obs is not None
        facts = media_facts_of(obs)
        assert facts is not None
        assert facts.encoded_body_size is None
        assert unmeasured_media_dimension(obs, "encodedBodySize") is UnknownCode.INPUT_MISSING

    def test_the_unevaluated_row_is_reported(self, response: FindResponse) -> None:
        assert response.unevaluated is not None
        assert [(u.id, u.option, u.code) for u in response.unevaluated] == [
            ("img-pending", "oversizeThreshold", UnknownCode.INPUT_MISSING)
        ]


class TestFindRequest:
    def test_media_filters_dump_as_the_wire_spells_them(self) -> None:
        req = FindRequest(
            media_only=True,
            media_type="image",
            broken_only=True,
            missing_alt_only=True,
            src_pattern="cdn\\.example",
            oversize_threshold=2.0,
            include_media=True,
        )
        assert req.model_dump(by_alias=True, exclude_none=True) == {
            "mediaOnly": True,
            "mediaType": "image",
            "brokenOnly": True,
            "missingAltOnly": True,
            "srcPattern": "cdn\\.example",
            "oversizeThreshold": 2.0,
            "includeMedia": True,
        }

    def test_a_non_positive_threshold_is_refused(self) -> None:
        with pytest.raises(ValidationError):
            FindRequest(oversize_threshold=0)


def test_unknown_code_is_the_closed_wire_set_in_contract_order() -> None:
    # Mirrors UNKNOWN_CODES in packages/ui-bridge/src/observation/observation.ts
    # and UnknownCode::ALL in qontinui-schemas rust-vision-core.
    assert [c.value for c in UnknownCode] == [
        "app_unreachable",
        "capability_unavailable_in_build",
        "producer_failed",
        "producer_not_run",
        "input_missing",
        "below_confidence_floor",
        "model_reply_unparseable",
        "needs_multi_frame_input",
        "stale_input",
        "frontier_open",
        "ledger_schema_absent",
        "ledger_write_failing",
        "no_observations",
        "to_node_unobserved",
        "performance_observer_unsupported",
        "no_event_before_timeout",
    ]
