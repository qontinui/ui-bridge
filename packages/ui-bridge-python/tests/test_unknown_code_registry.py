"""``UnknownCode`` and the generated diagnostic registry name the same closed set.

Every ``UnknownCode`` member has one registry name, ``UB-OBS-<CODE-IN-UPPER-KEBAB>``
(``no_results`` -> ``UB-OBS-NO-RESULTS``). The registry's source of truth is
``diagnostics/codes.json`` at the repo root; its Python mirror,
``ui_bridge/diagnostics.py`` (``UiBridgeErrorCode``, whose ``OBS_*`` members are
the ``UB-OBS-*`` set), is generated from it and drift-checked by
``npm run diagnostics:check``. ``UnknownCode`` in ``ui_bridge/observation.py`` is
held by hand, and it is CLOSED at parse time: pydantic refuses an ``unknown.code``
it does not list.

So this pins the two sets against each other IN BOTH DIRECTIONS - the Python twin
of qontinui-schemas ``rust-vision-core/tests/unknown_code_registry.rs`` - and a
member added on one side only (an ``UnknownCode`` no diagnostic names, or a
``UB-OBS-*`` code this client would refuse to parse) is a red test rather than a
code an agent cannot look up or a payload the client cannot read.
"""

from __future__ import annotations

from enum import Enum

from ui_bridge.diagnostics import UiBridgeErrorCode
from ui_bridge.observation import UnknownCode

OBS_VALUE_PREFIX = "UB-OBS-"
OBS_NAME_PREFIX = "OBS_"


def registry_code_for(code: UnknownCode) -> str:
    """The one registry name an ``UnknownCode`` has: ``no_results`` -> ``UB-OBS-NO-RESULTS``."""
    return OBS_VALUE_PREFIX + code.value.upper().replace("_", "-")


def obs_registry_members() -> list[UiBridgeErrorCode]:
    """Every ``UB-OBS-*`` member of the generated registry enum."""
    by_value = [m for m in UiBridgeErrorCode if m.value.startswith(OBS_VALUE_PREFIX)]
    by_name = [m for m in UiBridgeErrorCode if m.name.startswith(OBS_NAME_PREFIX)]
    # The generator names a member after its code (UB-OBS-X -> OBS_X), so the two
    # selections agree; if they do not, this probe is reading the wrong thing.
    assert by_value == by_name, (by_value, by_name)
    # A probe that found (almost) nothing would pass both directions vacuously.
    # Same floor as the Rust twin.
    assert len(by_value) >= 9, f"found only {len(by_value)} UB-OBS registry members"
    return by_value


def test_both_enums_are_real_enums_without_aliases() -> None:
    # An Enum alias (a second name for an existing value) is skipped by iteration,
    # so it would hide a duplicate from both checks below.
    for enum_cls in (UnknownCode, UiBridgeErrorCode):
        assert issubclass(enum_cls, Enum)
        assert len(enum_cls.__members__) == len(list(enum_cls)), enum_cls.__name__


def test_every_unknown_code_maps_to_exactly_one_registry_member() -> None:
    registry = obs_registry_members()
    for code in UnknownCode:
        matches = [m for m in registry if m.value == registry_code_for(code)]
        assert len(matches) == 1, (
            f"UnknownCode.{code.name} ({code.value!r}) has {len(matches)} registry "
            f"members named {registry_code_for(code)!r}; add it to diagnostics/codes.json "
            "and run `npm run diagnostics:generate`"
        )


def test_every_obs_registry_member_maps_back_to_exactly_one_unknown_code() -> None:
    for member in obs_registry_members():
        matches = [code for code in UnknownCode if registry_code_for(code) == member.value]
        assert len(matches) == 1, (
            f"UiBridgeErrorCode.{member.name} ({member.value!r}) names {len(matches)} "
            "UnknownCode members; add the member to UnknownCode in ui_bridge/observation.py "
            "so the client can parse it"
        )
