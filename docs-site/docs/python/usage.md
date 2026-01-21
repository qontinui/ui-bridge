---
sidebar_position: 2
---

# Python Usage

Learn how to use the UI Bridge Python client to control your React applications.

## Basic Setup

```python
from ui_bridge import UIBridgeClient

# Connect to UI Bridge server
client = UIBridgeClient('http://localhost:9876')

# Check connection
if client.is_connected():
    print("Connected to UI Bridge")
```

## Element Actions

### Click

```python
# Simple click
client.click('submit-button')

# With wait options
client.click('dynamic-button',
    wait_visible=True,
    wait_enabled=True,
    timeout=5000  # 5 seconds
)
```

### Type

```python
# Type text
client.type('email-input', 'user@example.com')

# Clear and type
client.type('search-input', 'new query', clear=True)

# With typing delay (simulates human typing)
client.type('password-input', 'secret', delay=50)
```

### Select

```python
# Select by value
client.select('country-select', value='US')

# Select by visible label
client.select('country-select', value='United States', by_label=True)

# Multiple selection
client.select('tags-select', value=['tag1', 'tag2'])
```

### Checkbox

```python
client.check('terms-checkbox')      # Check
client.uncheck('newsletter')        # Uncheck
client.toggle('remember-me')        # Toggle
```

### Focus

```python
client.focus('search-input')
client.blur('search-input')
```

### Scroll

```python
# Scroll in a direction
client.scroll('content-area', direction='down', amount=200)

# Scroll to position
client.scroll('content-area', position=(0, 500))

# Scroll to bring element into view
client.scroll('container', to_element='target-item')
```

## Component Actions

```python
# Get component interface
form = client.component('login-form')

# Execute action
result = form.action('login', {
    'email': 'user@example.com',
    'password': 'secret123'
})

print(f"Login result: {result.result}")
```

## Discovery

```python
# Discover all elements
discovery = client.discover()

for element in discovery.elements:
    print(f"{element.id}: {element.type}")
    print(f"  Actions: {element.actions}")
    print(f"  Visible: {element.state.visible}")
```

### Filter Discovery

```python
# Only interactive elements
discovery = client.discover(interactive_only=True)

# Include hidden elements
discovery = client.discover(include_hidden=True)

# Filter by type
discovery = client.discover(types=['button', 'input'])

# Filter by selector
discovery = client.discover(selector='.form-control')

# Limit results
discovery = client.discover(limit=10)
```

## Workflows

```python
# Run a registered workflow
result = client.run_workflow(
    workflow_id='checkout-flow',
    params={
        'email': 'user@example.com',
        'address': '123 Main St',
    }
)

if result.success:
    print(f"Workflow completed in {result.duration_ms}ms")
else:
    print(f"Failed at step {result.failed_step}: {result.error}")
```

### Workflow Control

```python
# Run from specific step
result = client.run_workflow(
    'checkout-flow',
    start_step='enter-payment'
)

# Stop at specific step
result = client.run_workflow(
    'checkout-flow',
    stop_step='review-order'
)
```

## Element State

```python
# Get element details
element = client.get_element('submit-button')
print(element)

# Get current state
state = client.get_element_state('email-input')
print(f"Value: {state.value}")
print(f"Visible: {state.visible}")
print(f"Enabled: {state.enabled}")
print(f"Focused: {state.focused}")
```

## Snapshots

```python
# Get full control snapshot
snapshot = client.get_snapshot()

print(f"Elements: {len(snapshot.elements)}")
print(f"Components: {len(snapshot.components)}")
print(f"Workflows: {len(snapshot.workflows)}")
```

## Render Log

```python
# Get render log entries
entries = client.get_render_log(limit=10)

for entry in entries:
    print(f"{entry.type}: {entry.timestamp}")

# Capture a snapshot
client.capture_snapshot()

# Clear the log
client.clear_render_log()
```

## Error Handling

```python
from ui_bridge import (
    UIBridgeClient,
    UIBridgeError,
    ElementNotFoundError,
    ActionFailedError,
)

client = UIBridgeClient()

try:
    client.click('nonexistent-button')
except ElementNotFoundError as e:
    print(f"Element not found: {e}")
except ActionFailedError as e:
    print(f"Action failed: {e}")
except UIBridgeError as e:
    print(f"UI Bridge error: {e}")
```

## Context Manager

```python
# Auto-close the client
with UIBridgeClient('http://localhost:9876') as client:
    client.click('button')
    client.type('input', 'text')
# Client is automatically closed
```

## Debugging

```python
# Get action history
history = client.get_action_history(limit=10)

for action in history:
    print(f"{action['action']} on {action['target']}: {action['success']}")

# Get performance metrics
metrics = client.get_metrics()
print(f"Total actions: {metrics.total_actions}")
print(f"Success rate: {metrics.success_rate:.1%}")
print(f"Avg duration: {metrics.avg_duration_ms:.1f}ms")
```

## Complete Example

```python
from ui_bridge import UIBridgeClient

def login_and_checkout():
    client = UIBridgeClient('http://localhost:9876')

    # Login
    client.type('login-email', 'user@example.com')
    client.type('login-password', 'secret123')
    client.click('login-submit')

    # Wait for dashboard
    client.click('products-link', wait_visible=True, timeout=5000)

    # Add item to cart
    client.click('add-to-cart-btn')

    # Checkout
    result = client.component('checkout-form').action('submit', {
        'address': '123 Main St',
        'payment': 'credit-card'
    })

    print(f"Order placed: {result.result}")

if __name__ == '__main__':
    login_and_checkout()
```
