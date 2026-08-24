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

response.success          # bool
response.duration_ms      # float
response.timestamp        # int
response.result           # Any | None - Handler return value
response.error            # str | None
response.failure_details  # ActionFailureDetails | None - set on every failure
```

`client.component(...).action(...)` raises `ActionFailedError` when the action
fails, and the exception carries the same `failure_details`, so the structured
reason survives the raise:

```python
from ui_bridge.client import ActionFailedError

try:
    client.component('invoice').action('delete', timeout_ms=5_000)
except ActionFailedError as err:
    if err.failure_details and err.failure_details.is_timeout():
        ...  # the handler never returned within 5s
```

#### Cancelling a slow action

`timeout_ms` is the **only** cancellation an out-of-process client has — an
`AbortSignal` cannot be JSON-serialized. The SDK races the handler promise, so
abandonment does not depend on the handler observing anything:

```python
client.component('report').action('generate', timeout_ms=30_000)
```

The SDK validates and clamps the value at the executor: `0` abandons on the next
tick, anything above 24h is clamped, and a negative, NaN, infinite or
non-numeric value is refused with `UB-VALIDATION-ERROR`.

### ActionFailureDetails

The structured reason behind any `success=False`.

```python
details = response.failure_details

details.error_code        # UiBridgeErrorCode | str - canonical "UB-" code
details.message           # str
details.retry_recommended # bool
details.suggested_actions # list[RecoveryAction]
details.timeout_ms        # float | None - the timeout that was configured
details.cancel_reason     # str | None - "timeout" | "signal"
details.invalid_params    # list[ParamSchemaIssue] | None
```

`error_code` is the generated catalog in `ui_bridge.diagnostics`
(`UiBridgeErrorCode.ACTION_TIMEOUT == "UB-ACTION-TIMEOUT"`). A code a newer
server mints that this build's catalog does not carry stays a plain `str`
rather than raising, so a pinned client keeps parsing.

`cancel_reason` — not the code — is the reliable "was this abandoned?" test:
a request timeout reports `UB-ACTION-TIMEOUT` while a caller's in-process signal
reports `UB-ACTION-FAILED`, and both set `cancel_reason`. A `UB-ACTION-FAILED`
*without* one is a handler that threw.

`invalid_params` is set only when the SDK's param-validation gate rejects a call
(`UB-ACTION-REJECTED`); each `ParamSchemaIssue` names the offending param by
`path` (`"email"`, `"filter.status"`, `"ids[2]"`), the schema `keyword` that
rejected it, and a human-readable `message`.

### ComponentActionInfo

One action as published on `/control/components` and
`/control/component/{id}`.

```python
action = client.get_component('invoice').actions[0]

action.id            # str
action.label         # str | None
action.description   # str | None
action.param_schema  # dict | None - declared params, ENFORCED at invocation
action.effect        # str | None - "read" | "write" | "destructive"
action.path          # str | None - resolved invocation URL for this action
```

`effect` being `None` means **unclassified, not safe**: an autonomous walk must
treat it as unknown rather than as `"read"`. `param_schema` and `path` are
absent from the `ControlSnapshot` component projection, which emits only
`id`/`label`/`description` plus `effect`.

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
