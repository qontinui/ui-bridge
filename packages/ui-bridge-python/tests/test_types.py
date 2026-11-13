"""Tests for ui_bridge types."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from ui_bridge.ai_types import AssertionResult, BatchAssertionResult
from ui_bridge.observation import UnknownCode
from ui_bridge.types import (
    ActionRequest,
    ActionResponse,
    ComponentActionRequest,
    DiscoveredElement,
    ElementIdentifier,
    ElementRect,
    ElementState,
    FindRequest,
    FindResponse,
    SnapshotViewportContext,
    Workflow,
    WorkflowResult,
    WorkflowStep,
)


class TestElementIdentifier:
    """Tests for ElementIdentifier model."""

    def test_create_with_ui_id(self):
        identifier = ElementIdentifier(
            ui_id="submit-btn",
            xpath="/html/body/button",
            selector="button",
        )
        assert identifier.ui_id == "submit-btn"
        assert identifier.xpath == "/html/body/button"

    def test_create_with_all_fields(self):
        identifier = ElementIdentifier(
            ui_id="input-1",
            test_id="email-input",
            awas_id="legacy-id",
            html_id="email",
            xpath="/html/body/form/input",
            selector="#email",
        )
        assert identifier.ui_id == "input-1"
        assert identifier.test_id == "email-input"
        assert identifier.html_id == "email"

    def test_optional_fields_default_to_none(self):
        identifier = ElementIdentifier(
            xpath="/html/body/div",
            selector="div",
        )
        assert identifier.ui_id is None
        assert identifier.test_id is None
        assert identifier.html_id is None


def create_test_rect() -> ElementRect:
    """Create a test rect for element states."""
    return ElementRect(
        x=0,
        y=0,
        width=100,
        height=50,
        top=0,
        right=100,
        bottom=50,
        left=0,
    )


class TestElementState:
    """Tests for ElementState model."""

    def test_create_basic_state(self):
        state = ElementState(
            visible=True,
            enabled=True,
            focused=False,
            rect=create_test_rect(),
        )
        assert state.visible is True
        assert state.enabled is True

    def test_create_input_state(self):
        state = ElementState(
            visible=True,
            enabled=True,
            focused=True,
            rect=create_test_rect(),
            value="test@example.com",
        )
        assert state.value == "test@example.com"
        assert state.focused is True

    def test_create_checkbox_state(self):
        state = ElementState(
            visible=True,
            enabled=True,
            focused=False,
            rect=create_test_rect(),
            checked=True,
        )
        assert state.checked is True

    def test_pre_split_payload_defaults_disabled_signals(self):
        """A payload predating the disabled/ariaDisabled split still validates."""
        state = ElementState.model_validate(
            {
                "visible": True,
                "enabled": True,
                "focused": False,
                "rect": create_test_rect().model_dump(),
            }
        )
        # Absent is NOT "observed enabled" - it only reads False here.
        assert state.disabled is False
        assert state.aria_disabled is False

    def test_disabled_and_aria_disabled_are_independent(self):
        """The two signals the derived `enabled` fold conflates stay separate."""
        state = ElementState.model_validate(
            {
                "visible": True,
                "enabled": False,
                "disabled": False,
                "ariaDisabled": True,
                "focused": False,
                "rect": create_test_rect().model_dump(),
            }
        )
        assert state.disabled is False
        assert state.aria_disabled is True
        assert state.enabled is False

    def test_full_wire_payload_retains_every_field(self):
        """Every TS ElementState field survives validation.

        Pydantic silently drops unknown extras, so a model lagging the TS type
        returns less than the wire carried with no error. This asserts the whole
        surface round-trips.
        """
        payload = {
            "visible": True,
            "enabled": False,
            "disabled": True,
            "ariaDisabled": False,
            "focused": True,
            "role": "button",
            "accessibleName": "Save",
            "rect": create_test_rect().model_dump(),
            "normalizedRect": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
            "value": "typed",
            "checked": True,
            "selectedOptions": ["a"],
            "availableOptions": [{"value": "a", "label": "A", "selected": True}],
            "textContent": "Save",
            "innerHTML": "<b>Save</b>",
            "href": "/save",
            "dataset": {"route": "/save"},
            "opacityHidden": False,
            "ariaSelected": True,
            "ariaPressed": "mixed",
            "ariaCurrent": "page",
            "ariaExpanded": True,
            "ariaChecked": "mixed",
            "computedStyles": {
                "display": "block",
                "visibility": "visible",
                "opacity": "1",
                "pointerEvents": "auto",
                "cursor": "pointer",
                "color": "rgb(0, 0, 0)",
                "backgroundColor": "#fff",
                "colorScheme": "light",
                "fontSize": "14px",
                "fontWeight": "700",
                "lineHeight": "20px",
                "overflow": "hidden",
                "textOverflow": "ellipsis",
                "whiteSpace": "nowrap",
                "position": "relative",
                "zIndex": "10",
                "padding": "4px",
                "margin": "0px",
                "borderColor": "#ccc",
                "borderWidth": "1px",
                "borderRadius": "4px",
            },
            "required": True,
            "validationState": {
                "valid": False,
                "validationMessage": "Required",
                "valueMissing": True,
            },
            "constraints": {
                "pattern": ".+",
                "minLength": 1,
                "maxLength": 9,
                "min": "0",
                "max": "9",
                "step": "1",
            },
            "mediaMetadata": {
                "status": "measured",
                "value": {
                    "mediaType": "image",
                    "src": "/i.png",
                    "isDecorative": False,
                    "renderedWidth": 10,
                    "renderedHeight": 10,
                    "loadingState": "loaded",
                    "loading": "eager",
                },
                "provenance": {
                    "producer": {"id": "sdk/media-discovery", "version": "0.31.0"},
                    "observedAt": "2026-10-13T08:00:00.000Z",
                    "evaluatedAt": "2026-10-13T08:00:00.000Z",
                    "coverage": {"considered": 1, "measured": 1, "unmeasured": []},
                    "confidence": None,
                    "cache": None,
                    "source": None,
                },
            },
            "inViewport": True,
            "scrollInfo": {
                "scrollTop": 0,
                "scrollLeft": 0,
                "scrollHeight": 100,
                "scrollWidth": 50,
                "clientHeight": 10,
                "clientWidth": 10,
                "canScrollUp": False,
                "canScrollDown": True,
                "canScrollLeft": False,
                "canScrollRight": False,
            },
            "redaction": {"content": True},
        }
        state = ElementState.model_validate(payload)
        dumped = state.model_dump(by_alias=True, exclude_none=True)
        assert [key for key in payload if key not in dumped] == []
        assert state.aria_pressed == "mixed"
        assert state.scroll_info is not None
        assert state.scroll_info.can_scroll_down is True
        assert state.redaction is not None
        assert state.redaction.content is True


class TestSnapshotViewportContext:
    """The snapshot viewport carries which container the scroll was read from."""

    base = {
        "viewportWidth": 800,
        "viewportHeight": 600,
        "scrollX": 0,
        "scrollY": 640,
        "documentWidth": 800,
        "documentHeight": 2000,
        "canScrollDown": True,
        "canScrollRight": False,
    }

    def test_container_round_trips(self):
        ctx = SnapshotViewportContext.model_validate({**self.base, "container": "body"})
        assert ctx.container == "body"
        assert ctx.model_dump(by_alias=True)["container"] == "body"

    def test_container_absent_from_an_older_sdk(self):
        assert SnapshotViewportContext.model_validate(self.base).container is None

    def test_container_rejects_unknown_value(self):
        with pytest.raises(ValidationError):
            SnapshotViewportContext.model_validate({**self.base, "container": "window"})


class TestActionRequest:
    """Tests for ActionRequest model."""

    def test_create_click_action(self):
        request = ActionRequest(
            action="click",
        )
        assert request.action == "click"
        assert request.params is None

    def test_create_type_action(self):
        request = ActionRequest(
            action="type",
            params={"text": "Hello World"},
        )
        assert request.action == "type"
        assert request.params["text"] == "Hello World"

    def test_create_select_action(self):
        request = ActionRequest(
            action="select",
            params={"value": "option-1"},
        )
        assert request.action == "select"
        assert request.params["value"] == "option-1"


class TestActionResponse:
    """Tests for ActionResponse model."""

    def test_success_response(self):
        response = ActionResponse(
            success=True,
            duration_ms=50.5,
            timestamp=1234567890,
        )
        assert response.success is True
        assert response.error is None

    def test_error_response(self):
        response = ActionResponse(
            success=False,
            duration_ms=10.0,
            timestamp=1234567890,
            error="Element not found",
        )
        assert response.success is False
        assert response.error == "Element not found"


class TestComponentActionRequest:
    """Tests for ComponentActionRequest model."""

    def test_create_component_action(self):
        request = ComponentActionRequest(
            action="submit",
            params={"email": "test@example.com", "password": "secret"},
        )
        assert request.action == "submit"
        assert request.params["email"] == "test@example.com"


class TestFindRequest:
    """Tests for FindRequest model."""

    def test_default_request(self):
        request = FindRequest()
        assert request.interactive_only is None
        assert request.include_hidden is None

    def test_interactive_only_request(self):
        request = FindRequest(interactive_only=True)
        assert request.interactive_only is True


class TestDiscoveredElement:
    """Tests for DiscoveredElement model."""

    def test_create_discovered_element(self):
        element = DiscoveredElement(
            id="btn-1",
            type="button",
            tag_name="button",
            state=ElementState(
                visible=True,
                enabled=True,
                focused=False,
                rect=create_test_rect(),
            ),
            actions=["click", "focus", "blur"],
            registered=True,
        )
        assert element.id == "btn-1"
        assert element.type == "button"
        assert "click" in element.actions


class TestFindResponse:
    """Tests for FindResponse model."""

    def test_create_find_response(self):
        response = FindResponse(
            elements=[
                DiscoveredElement(
                    id="btn-1",
                    type="button",
                    tag_name="button",
                    state=ElementState(
                        visible=True,
                        enabled=True,
                        focused=False,
                        rect=create_test_rect(),
                    ),
                    actions=["click"],
                    registered=True,
                )
            ],
            total=1,
            duration_ms=15.5,
            timestamp=1234567890,
        )
        assert len(response.elements) == 1
        assert response.elements[0].id == "btn-1"


class TestWorkflow:
    """Tests for Workflow models."""

    def test_create_workflow_step(self):
        step = WorkflowStep(
            id="step-1",
            type="action",
            target="input-1",
            action="type",
            params={"text": "Hello"},
        )
        assert step.id == "step-1"
        assert step.type == "action"
        assert step.target == "input-1"

    def test_create_workflow(self):
        workflow = Workflow(
            id="login-workflow",
            name="Login Flow",
            steps=[
                WorkflowStep(
                    id="step-1",
                    type="action",
                    target="email-input",
                    action="type",
                    params={"text": "user@example.com"},
                ),
                WorkflowStep(
                    id="step-2",
                    type="action",
                    target="submit-btn",
                    action="click",
                ),
            ],
        )
        assert workflow.id == "login-workflow"
        assert len(workflow.steps) == 2

    def test_create_workflow_with_variables(self):
        workflow = Workflow(
            id="test-workflow",
            name="Test",
            variables={"username": "testuser"},
            steps=[],
        )
        assert workflow.variables["username"] == "testuser"


class TestWorkflowResult:
    """Tests for WorkflowResult model."""

    def test_success_result(self):
        result = WorkflowResult(
            workflow_id="test-workflow",
            success=True,
            steps_completed=3,
            total_steps=3,
            duration_ms=1500,
        )
        assert result.success is True
        assert result.steps_completed == 3

    def test_failed_result(self):
        result = WorkflowResult(
            workflow_id="test-workflow",
            success=False,
            steps_completed=1,
            total_steps=3,
            duration_ms=500,
            error="Element not found",
            failed_step="step-2",
        )
        assert result.success is False
        assert result.error == "Element not found"
        assert result.failed_step == "step-2"


class TestUIState:
    """Tests for UIState model."""

    def test_create_basic_state(self):
        from ui_bridge.types import UIState

        state = UIState(
            id="login-modal",
            name="Login Modal",
            elements=["email-input", "password-input", "submit-btn"],
        )
        assert state.id == "login-modal"
        assert state.name == "Login Modal"
        assert len(state.elements) == 3

    def test_create_blocking_state(self):
        from ui_bridge.types import UIState

        state = UIState(
            id="modal-overlay",
            name="Modal Overlay",
            elements=[],
            blocking=True,
            blocks=["dashboard"],
        )
        assert state.blocking is True
        assert "dashboard" in state.blocks


class TestUIStateGroup:
    """Tests for UIStateGroup model."""

    def test_create_state_group(self):
        from ui_bridge.types import UIStateGroup

        group = UIStateGroup(
            id="nav-group",
            name="Navigation",
            states=["nav-home", "nav-about", "nav-contact"],
        )
        assert group.id == "nav-group"
        assert len(group.states) == 3


class TestUITransition:
    """Tests for UITransition model."""

    def test_create_transition(self):
        from ui_bridge.types import UITransition

        transition = UITransition(
            id="open-modal",
            name="Open Login Modal",
            from_states=["dashboard"],
            activate_states=["login-modal"],
            exit_states=[],
        )
        assert transition.id == "open-modal"
        assert transition.from_states == ["dashboard"]
        assert transition.activate_states == ["login-modal"]

    def test_create_transition_with_alias(self):
        from ui_bridge.types import UITransition

        transition = UITransition.model_validate(
            {
                "id": "close-modal",
                "name": "Close Modal",
                "fromStates": ["login-modal"],
                "activateStates": [],
                "exitStates": ["login-modal"],
            }
        )
        assert transition.from_states == ["login-modal"]
        assert transition.exit_states == ["login-modal"]


class TestPathResult:
    """Tests for PathResult model."""

    def test_path_found(self):
        from ui_bridge.types import PathResult

        result = PathResult(
            found=True,
            transitions=["open-modal", "submit-form"],
            total_cost=2.0,
            target_states=["success-page"],
            estimated_steps=2,
        )
        assert result.found is True
        assert len(result.transitions) == 2
        assert result.total_cost == 2.0

    def test_path_not_found(self):
        from ui_bridge.types import PathResult

        result = PathResult(
            found=False,
            transitions=[],
            total_cost=0,
            target_states=["unreachable"],
            estimated_steps=0,
        )
        assert result.found is False
        assert len(result.transitions) == 0


class TestTransitionResult:
    """Tests for TransitionResult model."""

    def test_successful_transition(self):
        from ui_bridge.types import TransitionResult

        result = TransitionResult(
            success=True,
            activated_states=["login-modal"],
            deactivated_states=["dashboard"],
            duration_ms=50.0,
        )
        assert result.success is True
        assert "login-modal" in result.activated_states

    def test_failed_transition(self):
        from ui_bridge.types import TransitionResult

        result = TransitionResult(
            success=False,
            activated_states=[],
            deactivated_states=[],
            error="Precondition not met",
            failed_phase="precondition",
            duration_ms=5.0,
        )
        assert result.success is False
        assert result.failed_phase == "precondition"


class TestNavigationResult:
    """Tests for NavigationResult model."""

    def test_successful_navigation(self):
        from ui_bridge.types import NavigationResult, PathResult

        path = PathResult(
            found=True,
            transitions=["t1", "t2"],
            total_cost=2.0,
            target_states=["target"],
            estimated_steps=2,
        )
        result = NavigationResult(
            success=True,
            path=path,
            executed_transitions=["t1", "t2"],
            final_active_states=["target"],
            duration_ms=100.0,
        )
        assert result.success is True
        assert len(result.executed_transitions) == 2
        assert result.final_active_states == ["target"]


class TestStateSnapshot:
    """Tests for StateSnapshot model."""

    def test_create_snapshot(self):
        from ui_bridge.types import StateSnapshot, UIState, UIStateGroup, UITransition

        state = UIState(id="s1", name="State 1", elements=[])
        group = UIStateGroup(id="g1", name="Group 1", states=["s1"])
        transition = UITransition(
            id="t1",
            name="Transition 1",
            from_states=["s1"],
            activate_states=["s2"],
            exit_states=["s1"],
        )

        snapshot = StateSnapshot(
            timestamp=1234567890,
            active_states=["s1"],
            states=[state],
            groups=[group],
            transitions=[transition],
        )
        assert snapshot.timestamp == 1234567890
        assert len(snapshot.active_states) == 1
        assert len(snapshot.states) == 1
        assert len(snapshot.groups) == 1
        assert len(snapshot.transitions) == 1


# A REAL reply captured from the TypeScript SDK: the `data` of
# `POST /ai/assert/batch` (mode "all") on its in-process transport, over one
# registered button in jsdom. A `cssProperty` check of `outline-offset` passes,
# one of the unset custom property `--not-set` is unmeasured, and an `attribute`
# check of `lang` fails. So the batch tests hold the Python mirror to the counts
# the SDK actually sends: `failedCount` counts every result that did not pass,
# `unmeasuredCount` is its unmeasured subset.
SDK_BATCH_FIXTURE = Path(__file__).parent / "fixtures" / "sdk_assert_batch_response.json"

# What `POST /ai/assert` answers for a check that could not read its value: no
# `actual` key at all (never `""`), the reason in `unmeasured`.
UNMEASURED_WIRE = {
    "passed": False,
    "outcome": "unmeasured",
    "unmeasured": {
        "code": "not_attempted_by_policy",
        "detail": "the element sits in a `data-bridge-redact` boundary",
    },
    "target": "pay",
    "targetDescription": "button pay",
    "expected": "#123456",
    "failureReason": 'Cannot check CSS property "--tone"',
    "failureCode": "UB-OBS-NOT-ATTEMPTED-BY-POLICY",
    "durationMs": 1.5,
    "timestamp": 1234567890,
}

FAILED_WIRE = {
    "passed": False,
    "outcome": "failed",
    "target": "document",
    "targetDescription": "the page (<html>)",
    "expected": "rtl",
    "actual": "ltr",
    "failureReason": 'Attribute "dir" is "ltr" but expected "rtl"',
    "failureCode": "UB-ASSERT-TEXT-MISMATCH",
    "durationMs": 0.5,
    "timestamp": 1234567890,
}


class TestAssertionResult:
    """Tests for AssertionResult / BatchAssertionResult, as `/ai/assert` answers them."""

    def test_unmeasured_result_parses_with_no_actual(self):
        result = AssertionResult.model_validate(UNMEASURED_WIRE)
        assert result.passed is False
        assert result.outcome == "unmeasured"
        assert result.actual is None
        assert result.unmeasured is not None
        assert result.unmeasured.code is UnknownCode.NOT_ATTEMPTED_BY_POLICY

    def test_result_whose_request_named_no_expectation_parses(self):
        wire = {k: v for k, v in UNMEASURED_WIRE.items() if k != "expected"}
        assert AssertionResult.model_validate(wire).expected is None

    def test_measured_failure_keeps_its_value(self):
        result = AssertionResult.model_validate(FAILED_WIRE)
        assert result.outcome == "failed"
        assert result.actual == "ltr"
        assert result.unmeasured is None

    def test_result_from_an_sdk_predating_outcome_parses(self):
        wire = {
            k: v for k, v in FAILED_WIRE.items() if k not in ("outcome", "failureCode")
        }
        assert AssertionResult.model_validate(wire).outcome is None

    def test_outcome_is_the_closed_three_valued_set(self):
        with pytest.raises(ValidationError):
            AssertionResult.model_validate({**FAILED_WIRE, "outcome": "skipped"})

    def test_unmeasured_code_is_an_unknown_code(self):
        with pytest.raises(ValidationError):
            AssertionResult.model_validate(
                {**UNMEASURED_WIRE, "unmeasured": {"code": "redacted", "detail": "x"}}
            )

    def test_batch_counts_unmeasured_inside_failed(self):
        batch = BatchAssertionResult.model_validate(
            {
                "passed": False,
                "results": [UNMEASURED_WIRE, FAILED_WIRE],
                "passedCount": 0,
                "failedCount": 2,
                "unmeasuredCount": 1,
                "durationMs": 2.0,
                "timestamp": 1234567890,
            }
        )
        assert batch.failed_count == 2
        assert batch.unmeasured_count == 1
        assert [r.outcome for r in batch.results] == ["unmeasured", "failed"]

    def test_sdk_batch_failed_count_counts_every_result_that_did_not_pass(self):
        # A REAL `/ai/assert/batch` reply from the TypeScript SDK: see SDK_BATCH_FIXTURE.
        batch = BatchAssertionResult.model_validate(json.loads(SDK_BATCH_FIXTURE.read_text()))
        assert [r.outcome for r in batch.results] == ["passed", "unmeasured", "failed"]
        assert batch.passed is False
        assert batch.passed_count == sum(1 for r in batch.results if r.passed)
        assert batch.failed_count == sum(1 for r in batch.results if not r.passed) == 2

    def test_sdk_batch_unmeasured_count_is_a_subset_of_failed_count(self):
        batch = BatchAssertionResult.model_validate(json.loads(SDK_BATCH_FIXTURE.read_text()))
        unmeasured = [r for r in batch.results if r.outcome == "unmeasured"]
        assert batch.unmeasured_count == len(unmeasured) == 1
        assert all(not r.passed for r in unmeasured)
        assert batch.unmeasured_count is not None
        assert batch.failed_count - batch.unmeasured_count == sum(
            1 for r in batch.results if r.outcome == "failed"
        )

    def test_batch_from_an_sdk_predating_unmeasured_count_is_unknown_not_zero(self):
        batch = BatchAssertionResult.model_validate(
            {
                "passed": False,
                "results": [FAILED_WIRE],
                "passedCount": 0,
                "failedCount": 1,
                "durationMs": 1.0,
                "timestamp": 1234567890,
            }
        )
        assert batch.unmeasured_count is None
