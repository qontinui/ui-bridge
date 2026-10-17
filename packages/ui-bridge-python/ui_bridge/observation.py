"""
Observation envelope - the shape every UI Bridge observation surface answers in.

Mirrors the TypeScript ``Observation<T>`` in
``packages/ui-bridge/src/observation/observation.ts`` (and its Rust canon in
qontinui-schemas ``rust-vision-core/src/observation.rs``): WHAT was seen
(``measured``), that nothing was there (``absent``), or that the producer could
not look (``unknown``) - and, in every case, where the answer came from
(``provenance``).

Every provenance key is REQUIRED and may be ``None``: ``None`` is a statement
("no sample was taken", "a deduction, not an estimate", "no cache"), never an
omission, so a payload missing a key fails validation rather than reading as a
default. The one invariant spanning state and provenance - ``absent`` only
over FULL coverage of at least one considered item - is enforced here too.

The envelope for a value type ``V`` is the discriminated union of the three
answers, composed where ``V`` is known (``types.MediaObservation`` is the
media one)::

    Annotated[
        MeasuredObservation[V] | AbsentObservation | UnknownObservation,
        Field(discriminator="status"),
    ]

It cannot be ONE generic alias: pydantic resolves ``MeasuredObservation[T]``
over a bare type variable to the unparametrized class, so such an alias would
not be subscriptable.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, Field, model_validator

T = TypeVar("T")


class UnknownCode(str, Enum):
    """Why a producer could not answer. A CLOSED set, in the wire-contract order."""

    APP_UNREACHABLE = "app_unreachable"
    CAPABILITY_UNAVAILABLE_IN_BUILD = "capability_unavailable_in_build"
    PRODUCER_FAILED = "producer_failed"
    PRODUCER_NOT_RUN = "producer_not_run"
    INPUT_MISSING = "input_missing"
    BELOW_CONFIDENCE_FLOOR = "below_confidence_floor"
    MODEL_REPLY_UNPARSEABLE = "model_reply_unparseable"
    NEEDS_MULTI_FRAME_INPUT = "needs_multi_frame_input"
    STALE_INPUT = "stale_input"
    FRONTIER_OPEN = "frontier_open"
    LEDGER_SCHEMA_ABSENT = "ledger_schema_absent"
    LEDGER_WRITE_FAILING = "ledger_write_failing"
    NO_OBSERVATIONS = "no_observations"
    TO_NODE_UNOBSERVED = "to_node_unobserved"
    PERFORMANCE_OBSERVER_UNSUPPORTED = "performance_observer_unsupported"
    NO_EVENT_BEFORE_TIMEOUT = "no_event_before_timeout"


class ObservationProducer(BaseModel):
    """Which producer answered, and at what version."""

    id: str
    version: str


class UnmeasuredDimension(BaseModel):
    """One dimension the producer could NOT measure, how many items it affected, and why."""

    dimension: str
    count: int = Field(ge=0)
    code: UnknownCode


class ObservationCoverage(BaseModel):
    """How much of what the producer looked at it could actually measure."""

    considered: int = Field(ge=0)
    measured: int = Field(ge=0)
    unmeasured: list[UnmeasuredDimension]


class ObservationCache(BaseModel):
    """Provenance of a cached answer. Every key always present."""

    hit: bool
    stored_at: datetime | None = Field(alias="storedAt")
    key_inputs: list[str] = Field(alias="keyInputs")

    model_config = {"populate_by_name": True}


class ObservationProvenance(BaseModel):
    """Where an observation came from. EVERY key is always present."""

    producer: ObservationProducer
    observed_at: datetime | None = Field(alias="observedAt")
    evaluated_at: datetime = Field(alias="evaluatedAt")
    coverage: ObservationCoverage
    confidence: float | None = Field(ge=0, le=1)
    cache: ObservationCache | None
    source: dict[str, Any] | None

    model_config = {"populate_by_name": True}


class ObservationUnknown(BaseModel):
    """Why a producer could not answer. ``code`` carries the reason; ``detail`` is prose."""

    code: UnknownCode
    detail: str


class MeasuredObservation(BaseModel, Generic[T]):
    """The producer looked and saw ``value``."""

    status: Literal["measured"]
    value: T
    provenance: ObservationProvenance


class AbsentObservation(BaseModel):
    """The producer looked with FULL coverage and found nothing."""

    status: Literal["absent"]
    provenance: ObservationProvenance

    @model_validator(mode="after")
    def _absent_needs_full_coverage(self) -> AbsentObservation:
        coverage = self.provenance.coverage
        if coverage.unmeasured:
            raise ValueError("an absent observation cannot carry unmeasured coverage")
        if coverage.considered == 0:
            raise ValueError("an absent observation must have considered at least one item")
        if coverage.measured != coverage.considered:
            raise ValueError("an absent observation must have measured every considered item")
        return self


class UnknownObservation(BaseModel):
    """The producer could not look. Carries no ``value``."""

    status: Literal["unknown"]
    unknown: ObservationUnknown
    provenance: ObservationProvenance
