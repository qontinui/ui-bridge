"""Tests for ui_bridge types."""

import pytest
from ui_bridge.types import (
    ActionRequest,
    ActionResponse,
    ComponentActionRequest,
    ComponentActionResponse,
    DiscoveryRequest,
    DiscoveryResponse,
    DiscoveredElement,
    ElementIdentifier,
    ElementState,
    ElementRect,
    WorkflowStep,
    Workflow,
    WorkflowResult,
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


class TestDiscoveryRequest:
    """Tests for DiscoveryRequest model."""

    def test_default_request(self):
        request = DiscoveryRequest()
        assert request.interactive_only is None
        assert request.include_hidden is None

    def test_interactive_only_request(self):
        request = DiscoveryRequest(interactive_only=True)
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


class TestDiscoveryResponse:
    """Tests for DiscoveryResponse model."""

    def test_create_discovery_response(self):
        response = DiscoveryResponse(
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
