---
sidebar_position: 3
---

# Actions

Actions are operations that can be performed on UI elements. UI Bridge provides standard actions for common interactions and supports custom actions for specific use cases.

## Standard Actions

An element's `actions` list names exactly what both action paths — the SDK/HTTP
executor and the relay — perform on it. A built-in verb the element does not
list is refused, with `failureDetails.context.refusal: "element-kind"` on the
failure, never reported as a success that did nothing. The list is the same
whichever way the element was found: `registerElement` without an `actions`
option, auto-registration, `find()` / `discover()`, or the server's DOM
fallback.

### Every element

| Action                                              | Description                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| `click`, `doubleClick`, `rightClick`, `middleClick` | Pointer clicks (refused while the element is hidden or disabled) |
| `hoverClick`                                        | Force the CSS `:hover` state, then click                         |
| `hover`, `unhover`                                  | Force / release the CSS `:hover` state                           |
| `focus`, `blur`                                     | Focus / remove focus                                             |
| `scroll`, `scrollIntoView`                          | Scroll the element's container / bring the element on screen     |
| `sendKeys`                                          | Key events to the element: a canvas, a terminal pane, an editor  |
| `drag`                                              | Drag to a position or onto another element                       |

### By what the element is

| Element                                                                        | Adds                                        |
| ------------------------------------------------------------------------------ | ------------------------------------------- |
| Text `<input>` (text, search, email, url, tel, password, number), `<textarea>` | `type`, `clear`, `setValue`, `autocomplete` |
| Range, colour, date/time or hidden `<input>`                                   | `setValue`                                  |
| `<select>`                                                                     | `select`, `setValue`                        |
| `role="combobox"`, or a control carrying `aria-expanded`                       | `select`                                    |
| Checkbox `<input>`, `role="checkbox"`, `role="switch"`                         | `check`, `uncheck`, `toggle`                |
| Radio `<input>`                                                                | `check`, `uncheck`                          |
| `role="radio"`                                                                 | `check`                                     |
| `<details>`, its `<summary>`, `<dialog>`, a control carrying `aria-expanded`   | `toggle`                                    |
| A `<form>`, or any element inside one or owned by one through `form="…"`       | `submit`, `reset`                           |

An ARIA textbox (`role="textbox"`, or a contenteditable element) takes none of
the value verbs: `sendKeys` is how it is typed into. A file `<input>` takes none
of them either.

## Using Actions

### From Python

```python
from ui_bridge import UIBridgeClient

client = UIBridgeClient()

# Click
client.click('submit-btn')

# Type with options
client.type('email-input', 'user@example.com', clear=True)

# Select by value
client.select('country-select', value='US')

# Select by label
client.select('country-select', value='United States', by_label=True)

# Checkbox
client.check('terms-checkbox')
client.uncheck('newsletter-checkbox')
client.toggle('remember-me')

# Focus/Blur
client.focus('search-input')
client.blur('search-input')
```

### From HTTP API

```bash
# Click
curl -X POST http://localhost:9876/ui-bridge/control/element/submit-btn/action \
  -H "Content-Type: application/json" \
  -d '{"action": "click"}'

# Type
curl -X POST http://localhost:9876/ui-bridge/control/element/email-input/action \
  -H "Content-Type: application/json" \
  -d '{"action": "type", "params": {"text": "user@example.com"}}'

# Select
curl -X POST http://localhost:9876/ui-bridge/control/element/country-select/action \
  -H "Content-Type: application/json" \
  -d '{"action": "select", "params": {"value": "US"}}'
```

## Action Parameters

### Type Action

```python
client.type('input-id', 'Hello World',
    clear=True,      # Clear existing value first
    delay=50         # Delay between keystrokes (ms)
)
```

### Select Action

```python
# By value
client.select('dropdown', value='option-1')

# By visible label
client.select('dropdown', value='First Option', by_label=True)

# Multiple selection
client.select('multi-select', value=['opt-1', 'opt-2'])
```

### Scroll Action

```python
# Scroll by direction
client.scroll('container', direction='down', amount=100)

# Scroll to position
client.scroll('container', position=(0, 500))

# Scroll to element
client.scroll('container', to_element='target-element')

# Smooth scrolling
client.scroll('container', direction='down', amount=200, smooth=True)
```

## Wait Options

Actions can wait for element conditions:

```python
# Wait for visibility and enabled state
client.click('submit-btn',
    wait_visible=True,
    wait_enabled=True,
    timeout=5000  # milliseconds
)
```

### Wait Conditions

| Option         | Description                       |
| -------------- | --------------------------------- |
| `wait_visible` | Wait for element to be visible    |
| `wait_enabled` | Wait for element to be enabled    |
| `timeout`      | Maximum wait time in milliseconds |

## Action Response

All actions return an `ActionResponse`:

```python
response = client.click('submit-btn')

print(response.success)       # True/False
print(response.duration_ms)   # Execution time
print(response.timestamp)     # Unix timestamp
print(response.element_state) # Element state after action
print(response.error)         # Error message if failed
```

## Custom Actions

Register custom actions on elements:

```tsx
const control = useUIElement({
  id: 'color-picker',
  type: 'custom',
  customActions: {
    setColor: async (params) => {
      const { color } = params;
      // Custom logic to set color
      return { newColor: color };
    },
    getColor: async () => {
      return { color: currentColor };
    },
  },
});
```

Execute custom actions:

```python
# Custom action
result = client.execute_action('color-picker', 'setColor', {'color': '#ff0000'})
```

## Error Handling

Actions can fail for various reasons:

```python
from ui_bridge import UIBridgeClient, ElementNotFoundError, ActionFailedError

client = UIBridgeClient()

try:
    client.click('nonexistent-btn')
except ElementNotFoundError as e:
    print(f"Element not found: {e}")
except ActionFailedError as e:
    print(f"Action failed: {e}")
```

### Common Errors

| Error                  | Cause                            |
| ---------------------- | -------------------------------- |
| `ElementNotFoundError` | Element doesn't exist            |
| `ActionFailedError`    | Element exists but action failed |
| `TimeoutError`         | Wait condition not met           |
