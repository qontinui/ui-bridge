---
sidebar_position: 3
---

# Python Types

Reference for all Python types and models in the UI Bridge client.

## Response Types

### ActionResponse

Returned from element actions.

```python
from ui_bridge.types import ActionResponse

response: ActionResponse = client.click('button')

response.success        # bool - Whether action succeeded
response.duration_ms    # float - Execution time in milliseconds
response.timestamp      # int - Unix timestamp
response.element_state  # ElementState | None - State after action
response.result         # Any | None - Action result data
response.error          # str | None - Error message if failed
```

### ComponentActionResponse

Returned from component actions.

```python
from ui_bridge.types import ComponentActionResponse

response: ComponentActionResponse = client.component('form').action('submit')

response.success        # bool
response.duration_ms    # float
response.timestamp      # int
response.result         # Any | None - Handler return value
response.error          # str | None
```

### DiscoveryResponse

Returned from element discovery.

```python
from ui_bridge.types import DiscoveryResponse

discovery: DiscoveryResponse = client.discover()

discovery.elements      # list[DiscoveredElement]
discovery.total         # int - Total elements found
discovery.duration_ms   # float
discovery.timestamp     # int
```

### WorkflowResult

Returned from workflow execution.

```python
from ui_bridge.types import WorkflowResult

result: WorkflowResult = client.run_workflow('checkout')

result.workflow_id      # str
result.success          # bool
result.steps_completed  # int
result.total_steps      # int
result.duration_ms      # float | None
result.error            # str | None
result.failed_step      # str | None - Step ID that failed
```

## Element Types

### ElementState

Current state of an element.

```python
from ui_bridge.types import ElementState

state: ElementState = client.get_element_state('input')

state.visible           # bool
state.enabled           # bool
state.focused           # bool
state.rect              # ElementRect
state.value             # str | None - For inputs
state.checked           # bool | None - For checkboxes
state.selected_options  # list[str] | None - For selects
state.text_content      # str | None
```

### ElementRect

Element bounding rectangle.

```python
from ui_bridge.types import ElementRect

rect: ElementRect = state.rect

rect.x         # float
rect.y         # float
rect.width     # float
rect.height    # float
rect.top       # float
rect.right     # float
rect.bottom    # float
rect.left      # float
```

### ElementIdentifier

Element identification data.

```python
from ui_bridge.types import ElementIdentifier

identifier: ElementIdentifier

identifier.ui_id       # str | None - data-ui-id value
identifier.test_id     # str | None - data-testid value
identifier.html_id     # str | None - id attribute
identifier.xpath       # str
identifier.selector    # str - CSS selector
```

### DiscoveredElement

Element info from discovery.

```python
from ui_bridge.types import DiscoveredElement

element: DiscoveredElement

element.id             # str - Element ID
element.type           # str - Element type
element.label          # str | None
element.tag_name       # str - HTML tag name
element.role           # str | None - ARIA role
element.actions        # list[str] - Available actions
element.state          # ElementState
element.registered     # bool - If registered with UI Bridge
```

## Request Types

### ActionRequest

Action request payload (internal use).

```python
from ui_bridge.types import ActionRequest

request = ActionRequest(
    action='type',
    params={'text': 'Hello'},
    wait_options={'visible': True, 'timeout': 5000}
)
```

### DiscoveryRequest

Discovery request options.

```python
from ui_bridge.types import DiscoveryRequest

request = DiscoveryRequest(
    root='#app',
    interactive_only=True,
    include_hidden=False,
    limit=100,
    types=['button', 'input'],
    selector='.form-control'
)
```

## Workflow Types

### WorkflowStep

Single workflow step.

```python
from ui_bridge.types import WorkflowStep

step = WorkflowStep(
    id='enter-email',
    type='action',
    target='email-input',
    action='type',
    params={'text': '{{email}}'},
    timeout=5000
)
```

### Workflow

Complete workflow definition.

```python
from ui_bridge.types import Workflow

workflow = Workflow(
    id='login-flow',
    name='Login Flow',
    description='User login process',
    steps=[...],
    variables={'email': '', 'password': ''}
)
```

## Snapshot Types

### ControlSnapshot

Full control state snapshot.

```python
from ui_bridge.types import ControlSnapshot

snapshot: ControlSnapshot = client.get_snapshot()

snapshot.timestamp      # int
snapshot.elements       # list[RegisteredElement]
snapshot.components     # list[RegisteredComponent]
snapshot.workflows      # list[RegisteredWorkflow]
```

### RenderLogEntry

Render log entry.

```python
from ui_bridge.types import RenderLogEntry

entry: RenderLogEntry

entry.id        # str
entry.type      # RenderLogEntryType
entry.timestamp # int
entry.data      # Any
entry.metadata  # dict | None
```

## Enum Types

### ElementType

```python
from ui_bridge.types import ElementType

ElementType.BUTTON      # 'button'
ElementType.INPUT       # 'input'
ElementType.SELECT      # 'select'
ElementType.CHECKBOX    # 'checkbox'
ElementType.RADIO       # 'radio'
ElementType.LINK        # 'link'
ElementType.FORM        # 'form'
ElementType.TEXTAREA    # 'textarea'
ElementType.CUSTOM      # 'custom'
```

### StandardAction

```python
from ui_bridge.types import StandardAction

StandardAction.CLICK        # 'click'
StandardAction.DOUBLE_CLICK # 'doubleClick'
StandardAction.TYPE         # 'type'
StandardAction.CLEAR        # 'clear'
StandardAction.SELECT       # 'select'
StandardAction.FOCUS        # 'focus'
StandardAction.BLUR         # 'blur'
StandardAction.HOVER        # 'hover'
StandardAction.SCROLL       # 'scroll'
StandardAction.CHECK        # 'check'
StandardAction.UNCHECK      # 'uncheck'
StandardAction.TOGGLE       # 'toggle'
```

## Type Hints

The client is fully typed:

```python
from ui_bridge import UIBridgeClient
from ui_bridge.types import ActionResponse, DiscoveryResponse

def automate_form(client: UIBridgeClient) -> ActionResponse:
    client.type('email', 'user@example.com')
    return client.click('submit')

def find_buttons(client: UIBridgeClient) -> list[str]:
    discovery: DiscoveryResponse = client.discover(types=['button'])
    return [el.id for el in discovery.elements]
```
