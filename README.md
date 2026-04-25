# UI Bridge

A unified, modular framework for AI-driven UI observation, control, and debugging.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## What is UI Bridge

UI Bridge is how you give agents a semantic interface to any app you have.

- **Your own apps** integrate the SDK directly — add `<UIBridgeProvider>`, register
  elements and components with `useUIElement` / `useUIComponent`, and agents can
  drive the app by component name and action id rather than by CSS selector.

- **Third-party apps, legacy apps, and apps where source changes are prohibitive**
  get **wrapped** — a small integrated app sits next to the target and translates
  semantic actions into API calls, Playwright automation, or live-browser
  driving. The wrapped app looks identical to an SDK-integrated app from an
  agent's point of view: same discovery, same action surface, same
  `/ui-bridge/control/*` routes.

Common uses:

- **AI Automation**: Let AI agents interact with any application
- **Testing**: Programmatic UI testing without brittle selectors
- **Debugging**: Real-time DOM inspection and action tracking
- **Accessibility**: Expose semantic UI structure for assistive technologies

## Packages

| Package                       | Description                                                      | Registry |
| ----------------------------- | ---------------------------------------------------------------- | -------- |
| `ui-bridge`                   | React hooks and providers (SDK)                                  | npm      |
| `ui-bridge-server`            | HTTP server adapters (Express, Next.js)                          | npm      |
| `ui-bridge-python`            | Python client library with AI interface                          | PyPI     |
| `@qontinui/ui-bridge-wrapper` | Runtime for wrappers (api / headless / headed / live transports) | npm      |
| `create-ui-bridge-wrapper`    | `npx` scaffold CLI for new wrappers                              | npm      |

## Wrappers

A **wrapper** is a small UI Bridge app that exposes semantic actions against
another application — typically one whose source you cannot or do not want to
modify. Wrappers pick one or more of four transports:

- `api` — direct SDK / REST calls, no browser.
- `headless` — Playwright Chromium, no visible window.
- `headed` — Playwright Chromium, visible (for debugging).
- `live` — connects to a qontinui runner over WebSocket at `/ui-bridge/ws`.

Get started:

```bash
npx create-ui-bridge-wrapper my-thing
```

See:

- [Wrapper authoring guide](./docs/wrappers/authoring-guide.md)
- [`@qontinui/wrapper-gmail`](https://github.com/qontinui/qontinui-wrappers/tree/main/packages/wrapper-gmail) — api-only reference wrapper
- [`@qontinui/wrapper-v0`](https://github.com/qontinui/qontinui-wrappers/tree/main/packages/wrapper-v0) — api + Playwright fallback reference wrapper
- [`packages/ui-bridge-wrapper/`](./packages/ui-bridge-wrapper/) — the runtime
- [`packages/create-ui-bridge-wrapper/`](./packages/create-ui-bridge-wrapper/) — the scaffold CLI

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
        renderLog: true, // DOM observation
        control: true, // HTTP control endpoints
        debug: true, // DevTools integration
      }}
    >
      <YourApp />
    </UIBridgeProvider>
  );
}
```

### 3. Register Elements

The SDK automatically sets `data-ui-id` attributes on DOM elements at runtime — no manual attributes needed in JSX.

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
      <input ref={emailInput.ref} />
      <button ref={submitButton.ref}>Login</button>
    </form>
  );
  // The SDK sets data-ui-id="login-email" and data-ui-id="login-submit" on the DOM elements at runtime
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

## AI-Native Features

UI Bridge is designed for AI agents. The `client.ai.*` interface lets agents interact with UIs using natural language, without knowing exact element IDs.

### Natural Language Actions

```python
from ui_bridge import UIBridgeClient

client = UIBridgeClient("http://localhost:9876")

# Execute actions using natural language
client.ai.execute("click the Submit button")
client.ai.execute("type 'hello@example.com' in the email input")
client.ai.execute("select 'United States' from the country dropdown")

# Convenience methods
client.ai.click("Submit button")
client.ai.type_text("email input", "hello@example.com")
client.ai.select_option("country dropdown", "United States")
```

### Element Search

Find elements without knowing exact IDs:

```python
# Find by natural language description
element = client.ai.find("Submit button")
element = client.ai.find("email input field")

# Search with multiple criteria
results = client.ai.search(text="Submit")
results = client.ai.search(role="button", text_contains="Login")
results = client.ai.search(text_contains="email", element_type="input")

# Find by ARIA role
buttons = client.ai.find_by_role("button", name="Submit")
```

### Assertions

Make assertions about UI state using natural language:

```python
# Simple assertions
client.ai.assert_that("Submit button", "visible")
client.ai.assert_that("error message", "hidden")
client.ai.assert_that("email input", "hasValue", "test@example.com")

# Convenience methods
client.ai.assert_visible("Submit button")
client.ai.assert_hidden("loading spinner")
client.ai.assert_has_text("welcome message", "Hello, User!")

# Batch assertions
client.ai.assert_batch([
    ("Submit button", "visible"),
    ("error message", "hidden"),
    ("email input", "enabled"),
])
```

### Semantic Snapshots

Get AI-friendly page state representations:

```python
# Get semantic snapshot
snapshot = client.ai.snapshot()
print(snapshot.summary)  # "Login page with email/password form"
print(snapshot.forms)    # Form states with validation info
print(snapshot.elements) # AI-enhanced element descriptions

# Track changes
diff = client.ai.diff()
print(diff.summary)  # "Submit button clicked, loading spinner appeared"
print(diff.changes.appeared)  # New elements
print(diff.changes.disappeared)  # Removed elements

# Get plain text summary for LLM context
summary = client.ai.summary()
```

## Features

### Element Identification

The SDK sets `data-ui-id` attributes on DOM elements at runtime when they are registered via `useUIElement()`. No manual `data-ui-id` props are needed in JSX. If an explicit `data-ui-id` attribute already exists on the element, it is respected.

1. **AutoRegisterProvider** - Automatic semantic IDs from element content (preferred)
2. `data-testid` - Testing library convention
3. `id` - HTML id attribute
4. Generated XPath/CSS selector - Automatic fallback

The AutoRegisterProvider automatically discovers interactive elements and generates stable semantic IDs at runtime (e.g., `button-save`, `input-email`). No manual attributes needed.

### React Hooks

```tsx
// Register an element
const { ref, trigger, getState } = useUIElement({
  id: 'my-button',
  type: 'button',
  label: 'My Button',
});
```

#### Disambiguation metadata

`useUIElement` accepts four optional structured hints — `variant`, `position`, `color`, `contextPath` — that help natural-language queries like _"the red Save button at the bottom right"_ or _"the destructive Confirm"_ rank candidates when multiple elements share the same label. They are open-ended strings (use your own design-system tokens) and flow through the control snapshot verbatim; absent fields keep prior behavior.

```tsx
useUIElement({
  id: 'confirm-delete',
  type: 'button',
  label: 'Confirm',
  variant: 'destructive', // "primary" | "destructive" | "ghost" | ...
  position: 'bottom-right', // "top" | "bottom-right" | "center" | ...
  color: '#ef4444', // CSS name, hex, or token ("danger")
  contextPath: 'delete-modal > footer > actions',
});
```

```tsx
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
├── ai.py           # AI-native client
├── ai_types.py     # AI type definitions
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
