# UI Bridge Python Client

Python client library for controlling UI elements via the UI Bridge HTTP API.

## Installation

```bash
pip install ui-bridge-python
```

## Quick Start

```python
from ui_bridge import UIBridgeClient

# Connect to the UI Bridge server
client = UIBridgeClient("http://localhost:9876")

# Click a button
client.click("submit-btn")

# Type into an input
client.type("email-input", "user@example.com")

# Select from a dropdown
client.select("country-select", "US")

# Execute a component action
client.component("login-form").action("submit", {
    "email": "user@example.com",
    "password": "secret"
})

# Run a workflow
result = client.workflow("login-flow").run({
    "email": "user@example.com",
    "password": "secret"
})
```

## Features

- **Element Control**: Click, type, select, scroll, and more
- **Component Actions**: Execute high-level component actions
- **Workflows**: Run multi-step automation workflows
- **Discovery**: Find controllable elements in the UI
- **Render Logging**: Capture and analyze DOM snapshots
- **Debug Tools**: Access action history and performance metrics

## Element Actions

```python
# Click actions
client.click("btn")
client.double_click("btn")
client.right_click("btn")

# Input actions
client.type("input", "text")
client.type("input", "text", clear=True)  # Clear first
client.clear("input")

# Selection
client.select("dropdown", "value")
client.select("dropdown", ["val1", "val2"])  # Multi-select
client.select("dropdown", "Option Text", by_label=True)

# Checkbox/radio
client.check("checkbox")
client.uncheck("checkbox")
client.toggle("checkbox")

# Focus
client.focus("input")
client.blur("input")

# Scroll
client.scroll("container", direction="down", amount=100)
client.scroll("container", to_element="#target")
```

## Component Actions

Components expose high-level actions that can orchestrate multiple element interactions:

```python
# Get component control
login_form = client.component("login-form")

# Execute action
result = login_form.action("submit", {
    "email": "user@example.com",
    "password": "secret"
})

# Alternative syntax
result = login_form("submit", params)
```

## Workflows

Workflows are pre-defined multi-step automations:

```python
# Run a workflow
result = client.workflow("checkout").run({
    "product_id": "123",
    "quantity": 2
})

# Check status
print(result.status)  # completed, failed, etc.
print(result.steps)   # Individual step results
```

## Discovery

Find controllable elements in the UI:

```python
# Discover all interactive elements
response = client.discover(interactive_only=True)
for element in response.elements:
    print(f"{element.id}: {element.type} - {element.actions}")

# Filter by type
response = client.discover(types=["button", "input"])

# Get full snapshot
snapshot = client.get_snapshot()
```

## Render Logging

Capture and analyze DOM state:

```python
# Capture snapshot
client.render_log.snapshot()

# Get entries
entries = client.render_log.get(limit=10)

# Filter by type
entries = client.render_log.get(entry_type="snapshot")

# Clear log
client.render_log.clear()
```

## Debug Tools

```python
# Get action history
history = client.get_action_history(limit=50)

# Get performance metrics
metrics = client.get_metrics()
print(f"Success rate: {metrics.success_rate * 100}%")
print(f"Average duration: {metrics.avg_duration_ms}ms")

# Highlight an element (visual debugging)
client.highlight_element("submit-btn")
```

## Wait Options

Most actions support wait options:

```python
client.click("btn",
    wait_visible=True,   # Wait for element to be visible
    wait_enabled=True,   # Wait for element to be enabled
    timeout=10000        # Timeout in milliseconds
)
```

## Error Handling

```python
from ui_bridge import UIBridgeClient, ElementNotFoundError, ActionFailedError

client = UIBridgeClient()

try:
    client.click("non-existent-btn")
except ElementNotFoundError:
    print("Element not found")
except ActionFailedError as e:
    print(f"Action failed: {e}")
```

## Context Manager

```python
with UIBridgeClient("http://localhost:9876") as client:
    client.click("btn")
    # Client is automatically closed
```

## Async Support

For async applications, use httpx's async client:

```python
import httpx
from ui_bridge.types import ActionResponse

async def main():
    async with httpx.AsyncClient() as http_client:
        response = await http_client.post(
            "http://localhost:9876/ui-bridge/control/element/btn/action",
            json={"action": "click"}
        )
        result = ActionResponse.model_validate(response.json()["data"])
```

## License

MIT
