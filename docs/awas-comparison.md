# UI Bridge and AWAS: Comparison and Integration

This document explains how UI Bridge relates to AWAS (AI Web Action Standard) and how they can work together for AI-driven web automation.

## What is AWAS?

AWAS (AI Web Action Standard) is a proposed standard for declaring web application capabilities to AI agents. It provides a machine-readable format for describing:

- **Available UI elements** and their semantic purpose
- **Possible actions** that can be performed
- **State descriptions** and expected outcomes
- **Application workflows** and navigation paths

AWAS is primarily a **discovery mechanism** - it tells AI agents what exists in an application and what can be done, without providing the execution layer.

### Example AWAS Manifest

```json
{
  "version": "1.0",
  "application": {
    "name": "Example App",
    "description": "An example web application"
  },
  "elements": [
    {
      "id": "login-form",
      "type": "form",
      "description": "User authentication form",
      "children": [
        {
          "id": "email-input",
          "type": "input",
          "label": "Email Address"
        },
        {
          "id": "submit-btn",
          "type": "button",
          "label": "Sign In"
        }
      ]
    }
  ]
}
```

## What is UI Bridge?

UI Bridge is a **runtime execution framework** for AI-driven UI automation. It provides:

- **Element registration** via React hooks
- **State observation** through DOM monitoring
- **Action execution** via HTTP/WebSocket APIs
- **Workflow orchestration** for complex multi-step operations

UI Bridge is primarily an **execution mechanism** - it enables AI agents to interact with web applications by clicking, typing, and reading state.

### Example UI Bridge Usage

```tsx
// Register elements with UI Bridge
const submitButton = useUIElement({
  id: 'submit-btn',
  type: 'button',
  label: 'Sign In',
});

return (
  <button ref={submitButton.ref} data-ui-id="submit-btn">
    Sign In
  </button>
);
```

```python
# Execute actions via UI Bridge
client.click('submit-btn')
client.type('email-input', 'user@example.com')
```

## Comparison Table

| Aspect              | AWAS                      | UI Bridge                   |
| ------------------- | ------------------------- | --------------------------- |
| **Primary Purpose** | Capability declaration    | Action execution            |
| **Type**            | Standard/Specification    | Framework/Library           |
| **Focus**           | Discovery ("what exists") | Control ("how to interact") |
| **State Tracking**  | Declares possible states  | Tracks real-time state      |
| **Workflows**       | Describes available flows | Executes flow steps         |
| **Runtime**         | Static manifest           | Dynamic runtime             |
| **Integration**     | Embedded in HTML/JSON     | React hooks + HTTP API      |
| **AI Interaction**  | AI reads manifest         | AI calls API endpoints      |

### Declaration vs Execution

**AWAS (Declaration):**

```json
{
  "element": "login-button",
  "actions": ["click"],
  "preconditions": ["form-valid"],
  "postconditions": ["authenticated"]
}
```

**UI Bridge (Execution):**

```python
result = client.click('login-button', wait_visible=True)
print(result.success)  # True
print(result.element_state.visible)  # True
```

### State Handling

**AWAS:** Describes possible states declaratively

```json
{
  "states": {
    "logged-out": { "elements": ["login-form"] },
    "logged-in": { "elements": ["dashboard"] }
  }
}
```

**UI Bridge:** Observes and reports actual state

```python
snapshot = client.get_snapshot()
for element in snapshot.elements:
    print(f"{element.id}: visible={element.state.visible}")
```

## How They Complement Each Other

AWAS and UI Bridge serve different but complementary roles in AI automation:

```
Discovery Phase:     AI Agent reads AWAS manifest
                           |
                           v
                     Understands capabilities
                           |
                           v
Planning Phase:      AI Agent plans actions
                           |
                           v
Execution Phase:     UI Bridge executes actions
                           |
                           v
                     Returns results to AI
```

### AWAS for Discovery

1. AI agent fetches AWAS manifest from application
2. Learns what elements exist and what actions are available
3. Understands semantic meaning of UI components
4. Plans automation strategy based on declared capabilities

### UI Bridge for Execution

1. AI agent sends action requests to UI Bridge API
2. UI Bridge locates elements and executes actions
3. Returns real-time state and action results
4. Handles waiting, retries, and error recovery

## Architecture Diagram

```
+------------------+     +------------------+     +------------------+
|                  |     |                  |     |                  |
|  External AI     |---->|  AWAS Manifest   |---->|    UI Bridge     |
|     Agent        |     |                  |     |                  |
|                  |     | - Element defs   |     | - Element reg.   |
|  (Claude, GPT,   |     | - Action specs   |     | - State tracking |
|   Custom AI)     |     | - State descs    |     | - HTTP/WS API    |
|                  |     | - Workflows      |     | - Action exec.   |
+------------------+     +------------------+     +------------------+
         |                                               |
         |              "What can I do?"                 |
         +---------------------------------------------->|
         |                                               |
         |<----------------------------------------------+
         |              Element list + capabilities      |
         |                                               |
         |              "Click submit-btn"               |
         +---------------------------------------------->|
         |                                               |
         |<----------------------------------------------+
         |              {success: true, state: {...}}    |
         |                                               |
         v                                               v
+------------------+                             +------------------+
|                  |                             |                  |
|   AI Decision    |                             | React Components |
|     Making       |                             |                  |
|                  |                             | <button          |
| Based on state   |                             |   data-ui-id=    |
| and results      |                             |   "submit-btn">  |
|                  |                             |                  |
+------------------+                             +------------------+
```

## Element Identification Hierarchy

UI Bridge supports multiple identification strategies to maximize compatibility:

| Priority | Attribute           | Source       | Description                               |
| -------- | ------------------- | ------------ | ----------------------------------------- |
| 1        | `data-ui-id`        | UI Bridge    | Explicit UI Bridge identifier (preferred) |
| 2        | `data-testid`       | Testing libs | Testing library convention                |
| 3        | `data-awas-element` | AWAS         | Legacy AWAS element identifier            |
| 4        | `id`                | HTML         | Standard HTML id attribute                |
| 5        | CSS/XPath           | Generated    | Automatically generated selectors         |

### Identification Logic

```typescript
// Element identification priority (from element-identifier.ts)
const ID_ATTRIBUTES = [
  'data-ui-id', // UI Bridge native
  'data-testid', // Testing library
  'data-awas-element', // AWAS compatibility
  'id', // HTML standard
] as const;
```

When UI Bridge searches for an element:

1. First checks `data-ui-id` attribute
2. Then checks `data-testid` attribute
3. Then checks `data-awas-element` attribute
4. Then checks `id` attribute
5. Falls back to CSS selector or XPath matching

### Example: Multi-Attribute Element

```html
<button
  data-ui-id="checkout-btn"
  data-testid="checkout-button"
  data-awas-element="checkout"
  id="btn-checkout"
>
  Checkout
</button>
```

All of these would find the same element:

```python
client.click('checkout-btn')      # via data-ui-id
client.click('checkout-button')   # via data-testid
client.click('checkout')          # via data-awas-element
client.click('btn-checkout')      # via id
```

## Migration Guide: AWAS to UI Bridge

If you have an existing application using `data-awas-element` attributes, you can migrate to `data-ui-id` while maintaining backward compatibility.

### Step 1: Add UI Bridge Attributes

Add `data-ui-id` alongside existing AWAS attributes:

```html
<!-- Before -->
<button data-awas-element="submit">Submit</button>

<!-- After (both work) -->
<button data-ui-id="submit-btn" data-awas-element="submit">Submit</button>
```

### Step 2: Update Automation Code

Gradually update your automation code to use UI Bridge identifiers:

```python
# Old (still works)
client.click('submit')

# New (preferred)
client.click('submit-btn')
```

### Step 3: Remove Legacy Attributes (Optional)

Once all automation code is updated, you can remove `data-awas-element`:

```html
<!-- Final -->
<button data-ui-id="submit-btn">Submit</button>
```

### Migration Checklist

- [ ] Install UI Bridge packages
- [ ] Add `UIBridgeProvider` to your React app
- [ ] Add `data-ui-id` attributes to elements (keep `data-awas-element` temporarily)
- [ ] Update automation scripts to use UI Bridge client
- [ ] Test all automation flows
- [ ] Remove `data-awas-element` attributes (optional)

### Naming Convention Changes

| AWAS Style | UI Bridge Style     |
| ---------- | ------------------- |
| `login`    | `login-form`        |
| `email`    | `login-email-input` |
| `submit`   | `login-submit-btn`  |
| `cart`     | `shopping-cart`     |

UI Bridge recommends more descriptive, hierarchical naming to avoid collisions in larger applications.

## Best Practices

### For New Applications

1. Use UI Bridge from the start with `data-ui-id` attributes
2. Consider generating AWAS manifests from UI Bridge registry for AI discovery
3. Use component-level actions for complex operations

### For Existing AWAS Applications

1. UI Bridge will find elements by `data-awas-element` automatically
2. Gradually add `data-ui-id` for new elements
3. Use UI Bridge's workflow system to replace AWAS workflow declarations

### For Hybrid Approaches

1. Serve AWAS manifest for capability discovery
2. Use UI Bridge for action execution
3. Keep element IDs consistent between AWAS manifest and `data-ui-id` values

## Related Documentation

- [Element Identification](../docs-site/docs/concepts/element-identification.md) - Detailed identification strategies
- [Getting Started](../docs-site/docs/getting-started.md) - Quick start guide
- [HTTP API Reference](../docs-site/docs/api/overview.md) - API endpoint documentation
