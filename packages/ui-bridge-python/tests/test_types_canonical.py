"""Canonical wire-shape contract for the snapshot models.

ui-bridge 0.22.0 unified the control-mode wire with the canonical
``qontinui-types::ui_bridge`` shape (plan
2026-05-17-sdk-canonical-shape-unification): elements/components carry
``registeredAt``/``mounted``, component ``actions`` are ComponentActionInfo
objects, and the undo context uses ``canUndo``/``canRedo``. The models must
validate the new wire AND stay tolerant of the pre-0.22.0 shapes.
"""

from ui_bridge.types import (
    ComponentActionInfo,
    ControlSnapshot,
    RegisteredComponent,
    SnapshotUndoContext,
)

CANONICAL_ELEMENT = {
    "id": "save-btn",
    "type": "button",
    "label": "Save",
    "actions": ["click"],
    "state": {
        "visible": True,
        "enabled": True,
        "focused": False,
        "rect": {
            "x": 0,
            "y": 0,
            "width": 10,
            "height": 10,
            "top": 0,
            "right": 10,
            "bottom": 10,
            "left": 0,
        },
    },
    "identifier": {"xpath": "/html/body/button", "selector": "button"},
    "registeredAt": 1750000000000,
    "mounted": True,
}


class TestCanonicalWire:
    """The 0.22.0 canonical-superset wire validates."""

    def test_component_actions_as_objects(self) -> None:
        comp = RegisteredComponent.model_validate(
            {
                "id": "editor",
                "name": "Editor",
                "actions": [
                    {"id": "save", "label": "Save", "description": "Persist"},
                    {"id": "reset"},
                ],
                "registeredAt": 1750000000000,
                "mounted": True,
                "actionInvocationPath": "/control/component/editor/action/{actionId}",
            }
        )
        assert comp.actions == [
            ComponentActionInfo(id="save", label="Save", description="Persist"),
            ComponentActionInfo(id="reset"),
        ]
        assert comp.registered_at == 1750000000000
        assert comp.mounted is True

    def test_undo_context_canonical_names(self) -> None:
        ctx = SnapshotUndoContext.model_validate(
            {"canUndo": True, "canRedo": False, "summary": "Can undo (Typing)."}
        )
        assert ctx.can_undo is True
        assert ctx.can_redo is False
        assert ctx.model_dump(by_alias=True)["canUndo"] is True

    def test_full_snapshot_round_trip(self) -> None:
        snap = ControlSnapshot.model_validate(
            {
                "timestamp": 1750000000000,
                "elements": [CANONICAL_ELEMENT],
                "components": [
                    {
                        "id": "editor",
                        "name": "Editor",
                        "actions": [{"id": "save"}],
                        "registeredAt": 1750000000000,
                        "mounted": True,
                    }
                ],
                "workflows": [{"id": "wf", "name": "Flow", "stepCount": 1}],
                "undoRedo": {"canUndo": False, "canRedo": False, "summary": "n/a"},
            }
        )
        el = snap.elements[0]
        assert el.registered_at == 1750000000000
        assert el.mounted is True
        assert snap.undo_redo is not None
        assert snap.undo_redo.can_undo is False


class TestPre0220WireCompat:
    """Snapshots from pre-0.22.0 servers still validate."""

    def test_component_actions_as_bare_strings(self) -> None:
        comp = RegisteredComponent.model_validate(
            {"id": "editor", "name": "Editor", "actions": ["save", "reset"]}
        )
        assert [a.id for a in comp.actions] == ["save", "reset"]
        assert comp.registered_at is None
        assert comp.mounted is None

    def test_undo_context_legacy_names(self) -> None:
        ctx = SnapshotUndoContext.model_validate(
            {"undoAvailable": True, "redoAvailable": True, "summary": "legacy"}
        )
        assert ctx.can_undo is True
        assert ctx.can_redo is True

    def test_element_without_lifecycle_fields(self) -> None:
        legacy = {
            k: v
            for k, v in CANONICAL_ELEMENT.items()
            if k not in ("registeredAt", "mounted")
        }
        snap = ControlSnapshot.model_validate(
            {"timestamp": 1, "elements": [legacy], "components": [], "workflows": []}
        )
        assert snap.elements[0].registered_at is None
