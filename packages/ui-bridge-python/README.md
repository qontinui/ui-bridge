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

- **AI-Native Interface**: Natural language actions, semantic search, assertions
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

## AI-Native Interface

The `client.ai` interface provides natural language interaction for AI agents.

### Natural Language Actions

```python
# Execute using natural language instructions
result = client.ai.execute("click the Submit button")
result = client.ai.execute("type 'hello@example.com' in the email field")
result = client.ai.execute("select 'United States' from the country dropdown")

# Convenience methods
client.ai.click("Submit button")
client.ai.type_text("email field", "hello@example.com")
client.ai.select_option("country dropdown", "United States")

# With context for disambiguation
client.ai.execute(
    "click the Submit button",
    context="in the login form, not the registration form"
)
```

### Element Search

Find elements without knowing exact IDs:

```python
# Find best match by description
element = client.ai.find("Submit button")
if element:
    print(f"Found: {element.id}, type: {element.type}")

# Search with multiple criteria
results = client.ai.search(text="Submit")
results = client.ai.search(role="button", text_contains="Login")
results = client.ai.search(
    element_type="input",
    placeholder="Enter email"
)

# Find by ARIA role
buttons = client.ai.find_by_role("button", name="Submit")
for result in buttons:
    print(f"{result.element.id}: confidence={result.confidence}")
```

### Assertions

Make assertions about UI state:

```python
# Basic assertions
result = client.ai.assert_that("Submit button", "visible")
result = client.ai.assert_that("error message", "hidden")
result = client.ai.assert_that("email input", "hasValue", "test@example.com")

# Convenience methods
client.ai.assert_visible("Submit button")
client.ai.assert_hidden("loading spinner")
client.ai.assert_enabled("email input")
client.ai.assert_has_text("welcome message", "Hello!")
client.ai.assert_contains_text("status", "Success")

# Batch assertions
result = client.ai.assert_batch([
    ("Submit button", "visible"),
    ("error message", "hidden"),
    ("email input", "enabled"),
])
print(f"All passed: {result.passed}")
print(f"Passed: {result.passed_count}, Failed: {result.failed_count}")

# Wait for conditions
client.ai.wait_for_visible("confirmation dialog", timeout=5000)
client.ai.wait_for_hidden("loading indicator", timeout=10000)
```

### Semantic Snapshots

Get AI-friendly page state:

```python
# Full semantic snapshot
snapshot = client.ai.snapshot()
print(snapshot.summary)  # "Login page with email/password form"

# Page context
print(snapshot.page.url)
print(snapshot.page.title)

# Form states
for form in snapshot.forms:
    print(f"Form: {form.name}, valid: {form.is_valid}")
    for field in form.fields:
        print(f"  {field.label}: {field.value}")

# All elements with AI metadata
for elem in snapshot.elements:
    print(f"{elem.id}: {elem.description}")
    print(f"  Aliases: {elem.aliases}")
    print(f"  Suggested actions: {elem.suggested_actions}")

# Track changes over time
diff = client.ai.diff()
if diff:
    print(diff.summary)
    for change in diff.changes.appeared:
        print(f"New: {change.description}")
    for change in diff.changes.disappeared:
        print(f"Gone: {change.description}")

# Plain text summary for LLM context
summary = client.ai.summary()
```

### Verify Page State

Verify multiple conditions at once:

```python
# Returns True if all checks pass
is_ready = client.ai.verify_page_state([
    ("login form", "visible"),
    ("email input", "enabled"),
    ("password input", "enabled"),
    ("submit button", "enabled"),
])

if is_ready:
    client.ai.type_text("email input", "user@example.com")
    client.ai.type_text("password input", "secret")
    client.ai.click("submit button")
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

## Async Client

For async applications, use `AsyncUIBridgeClient`:

```python
import asyncio
from ui_bridge import AsyncUIBridgeClient

async def main():
    async with AsyncUIBridgeClient("http://localhost:9876") as client:
        # Element actions
        await client.click("submit-btn")
        await client.type("email-input", "user@example.com")

        # Get snapshot
        snapshot = await client.get_snapshot()

        # AI-native interface
        await client.ai.execute("click the Submit button")
        result = await client.ai.assert_that("error message", "hidden")

        # State management (async methods instead of properties)
        active = await client.state.get_active()
        await client.state.activate("modal")

asyncio.run(main())
```

## JSONL Logging

Enable structured JSONL logging for debugging and observability:

```python
from ui_bridge import UIBridgeClient

client = UIBridgeClient()
client.enable_logging(level="debug", file_path="ui-bridge.jsonl", console=True)

# All operations are now logged
client.click("submit-btn")  # Logs ACTION_START, REQUEST_START, REQUEST_COMPLETE, ACTION_COMPLETE
```

## License

MIT
