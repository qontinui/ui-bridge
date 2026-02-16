"""Tests for ui_bridge types."""

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
