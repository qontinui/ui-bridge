# UI Bridge

A unified, modular framework for AI-driven UI observation, control, and debugging.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Overview

UI Bridge enables programmatic observation and control of React UI elements via HTTP/WebSocket APIs. Every actionable UI element becomes observable and controllable, making it perfect for:

- **AI Automation**: Let AI agents interact with web applications
- **Testing**: Programmatic UI testing without brittle selectors
- **Debugging**: Real-time DOM inspection and action tracking
- **Accessibility**: Expose semantic UI structure for assistive technologies

## Packages

| Package | Description | Registry |
|---------|-------------|----------|
| `ui-bridge` | React hooks and providers | npm |
| `ui-bridge-server` | HTTP server adapters (Express, Next.js) | npm |
| `ui-bridge-python` | Python client library | PyPI |

## Quick Start

### 1. Install the Package

```bash
npm install ui-bridge
```

### 2. Add the Provider

```tsx
import { UIBridgeProvider } from 'ui-bridge';

function App() {
  return (
    <UIBridgeProvider
      features={{
        renderLog: true,  // DOM observation
        control: true,    // HTTP control endpoints
        debug: true,      // DevTools integration
      }}
    >
      <YourApp />
    </UIBridgeProvider>
  );
}
```

### 3. Register Elements

```tsx
import { useUIElement, useUIComponent } from 'ui-bridge';

function LoginForm() {
  const emailInput = useUIElement({
    id: 'login-email',
    type: 'input',
    label: 'Email Input',
  });

  const submitButton = useUIElement({
    id: 'login-submit',
    type: 'button',
    label: 'Submit Button',
  });

  // Register component with actions
  useUIComponent({
    id: 'login-form',
    name: 'Login Form',
    actions: [
      {
        id: 'login',
        handler: async ({ email, password }) => {
          // Handle login
        },
      },
    ],
  });

  return (
    <form>
      <input ref={emailInput.ref} data-ui-id="login-email" />
      <button ref={submitButton.ref} data-ui-id="login-submit">
        Login
      </button>
    </form>
  );
}
```

### 4. Control from Python

```python
from ui_bridge import UIBridgeClient

client = UIBridgeClient("http://localhost:9876")

# Element-level control
client.type("login-email", "user@example.com")
client.type("login-password", "secret")
client.click("login-submit")

# Component-level control (preferred)
client.component("login-form").action("login", {
    "email": "user@example.com",
    "password": "secret"
})
```

## Features

### Element Identification

UI Bridge supports multiple identification strategies:

1. `data-ui-id` - Explicit UI Bridge identifier (preferred)
2. `data-testid` - Testing library convention
3. `id` - HTML id attribute
4. Generated XPath/CSS selector - Automatic fallback

### React Hooks

```tsx
// Register an element
const { ref, trigger, getState } = useUIElement({
  id: 'my-button',
  type: 'button',
  label: 'My Button',
});

// Register a component with actions
useUIComponent({
  id: 'my-form',
  name: 'My Form',
  actions: [
    { id: 'submit', handler: handleSubmit },
    { id: 'clear', handler: handleClear },
  ],
});

// Access bridge functionality
const bridge = useUIBridge();
await bridge.executeAction('my-button', { action: 'click' });
```

### HTTP API

```
# Elements
GET  /ui-bridge/control/elements
GET  /ui-bridge/control/element/:id
POST /ui-bridge/control/element/:id/action

# Components
GET  /ui-bridge/control/components
POST /ui-bridge/control/component/:id/action/:name

# Workflows
GET  /ui-bridge/control/workflows
POST /ui-bridge/control/workflow/:id/run

# Discovery
POST /ui-bridge/control/discover
GET  /ui-bridge/control/snapshot

# Render Log
GET  /ui-bridge/render-log
POST /ui-bridge/render-log/snapshot

# Debug
GET  /ui-bridge/debug/action-history
GET  /ui-bridge/debug/metrics
```

### Server Integration

**Express:**
```ts
import { createExpressRouter } from 'ui-bridge-server/express';

app.use('/ui-bridge', createExpressRouter(handlers));
```

**Next.js (App Router):**
```ts
// app/api/ui-bridge/[...path]/route.ts
import { createNextRouteHandlers } from 'ui-bridge-server/nextjs';

export const { GET, POST, DELETE } = createNextRouteHandlers(handlers);
```

**Standalone:**
```ts
import { createStandaloneServer } from 'ui-bridge-server/standalone';

const server = await createStandaloneServer(handlers, { port: 9876 });
```

### Debug Tools

Press `Ctrl+Shift+I` to open the inspector overlay:
- Hover over elements to see their identifiers
- Click to inspect element details
- View available actions and current state

## Architecture

```
ui-bridge/
├── core/           # Element identification, registry, types
├── render-log/     # DOM observation and logging
├── control/        # Action execution, workflows
├── debug/          # Inspector, metrics
└── react/          # Hooks and providers

ui-bridge-server/
├── express.ts      # Express.js adapter
├── nextjs.ts       # Next.js adapter
└── standalone.ts   # Standalone HTTP server

ui-bridge-python/
├── client.py       # HTTP client
└── types.py        # Pydantic models
```

## Examples

See the [examples](./examples) directory for complete working examples:

- `react-app/` - Basic React application with UI Bridge
- `nextjs-app/` - Next.js integration example
- `tauri-app/` - Tauri desktop application

## API Reference

### Core Types

```typescript
interface ElementState {
  visible: boolean;
  enabled: boolean;
  focused: boolean;
  rect: DOMRect;
  value?: string;
  checked?: boolean;
}

interface RegisteredElement {
  id: string;
  type: ElementType;
  label?: string;
  actions: StandardAction[];
  getState: () => ElementState;
}

interface RegisteredComponent {
  id: string;
  name: string;
  actions: ComponentAction[];
}
```

### Hooks

```typescript
// Element registration
useUIElement(options: UseUIElementOptions): UseUIElementReturn

// Component registration
useUIComponent(options: UseUIComponentOptions): UseUIComponentReturn

// Bridge access
useUIBridge(): UseUIBridgeReturn
```

### Python Client

```python
client = UIBridgeClient(base_url, timeout=30.0, api_path="/ui-bridge")

# Element actions
client.click(element_id, wait_visible=True, timeout=10000)
client.type(element_id, text, clear=False)
client.select(element_id, value, by_label=False)

# Component actions
client.component(component_id).action(action_id, params)

# Workflows
client.workflow(workflow_id).run(params)

# Discovery
client.discover(interactive_only=True, limit=100)
```

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting a pull request.

## License

MIT License - see [LICENSE](./LICENSE) for details.
