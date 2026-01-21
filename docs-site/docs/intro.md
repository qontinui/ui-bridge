---
sidebar_position: 1
slug: /
---

# Introduction

UI Bridge is a unified framework for AI-driven UI observation, control, and debugging. It enables programmatic interaction with React applications through a simple HTTP API, making it perfect for:

- **AI Agents** - Allow language models to interact with your UI
- **Test Automation** - Write robust end-to-end tests
- **Debugging Tools** - Inspect and manipulate UI state
- **Workflow Automation** - Define and execute multi-step UI operations

## Architecture

UI Bridge consists of three main packages:

| Package | Registry | Purpose |
|---------|----------|---------|
| `ui-bridge` | npm | React hooks and providers |
| `ui-bridge-server` | npm | HTTP server (Express/Next.js/Standalone) |
| `ui-bridge-python` | PyPI | Python client library |

```
┌─────────────────┐     HTTP/WS      ┌──────────────────┐
│  Python Client  │ ◄──────────────► │  UI Bridge       │
│  (or any HTTP)  │                  │  Server          │
└─────────────────┘                  └────────┬─────────┘
                                              │
                                              │ IPC / State
                                              ▼
                                     ┌──────────────────┐
                                     │  React App with  │
                                     │  UIBridgeProvider│
                                     └──────────────────┘
```

## Key Features

### Element Control

Register UI elements and interact with them programmatically:

```tsx
// In your React component
const control = useUIElement({
  id: 'submit-button',
  type: 'button',
});

return <button ref={control.ref}>Submit</button>;
```

```python
# From Python
client.click('submit-button')
```

### Component Actions

Expose high-level component actions:

```tsx
useUIComponent({
  id: 'login-form',
  actions: [
    { id: 'login', handler: handleLogin },
    { id: 'logout', handler: handleLogout },
  ],
});
```

```python
client.component('login-form').action('login', {
    'email': 'user@example.com',
    'password': 'secret'
})
```

### Workflows

Define multi-step automation workflows:

```python
client.run_workflow(
    workflow_id='complete-checkout',
    params={'product_id': '123'}
)
```

### Element Discovery

Automatically discover controllable elements:

```python
elements = client.discover()
for el in elements.elements:
    print(f"{el.id}: {el.type} - {el.actions}")
```

## Next Steps

- [Getting Started](./getting-started) - Install and set up UI Bridge
- [Core Concepts](./concepts/element-identification) - Learn the fundamentals
- [API Reference](./api/overview) - Explore the HTTP API
