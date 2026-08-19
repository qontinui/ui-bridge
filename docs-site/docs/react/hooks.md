---
sidebar_position: 2
---

# React Hooks

UI Bridge provides React hooks for registering and controlling UI elements.

## useUIElement

Register an element for programmatic control.

### Basic Usage

```tsx
import { useUIElement } from '@qontinui/ui-bridge';

function Button() {
  const control = useUIElement({
    id: 'submit-button',
    type: 'button',
  });

  return (
    <button ref={control.ref} data-ui-id="submit-button">
      Submit
    </button>
  );
}
```

### Options

```tsx
const control = useUIElement({
  id: 'my-element', // Required: Unique identifier
  type: 'button', // Optional: Element type (auto-detected)
  label: 'Submit Button', // Optional: Human-readable label
  actions: ['click', 'focus'], // Optional: Override available actions
  customActions: {
    // Optional: Custom action handlers
    highlight: async () => {
      // Custom logic
    },
  },
});
```

### Return Value

```typescript
interface UseUIElementReturn {
  ref: RefObject<HTMLElement>; // Ref to attach to element
  trigger: (action: string, params?: any) => Promise<any>; // Trigger action
  getState: () => ElementState; // Get current state
  getIdentifier: () => ElementIdentifier; // Get identifiers
}
```

### Examples

#### Input Element

```tsx
function EmailInput() {
  const [email, setEmail] = useState('');

  const control = useUIElement({
    id: 'email-input',
    type: 'input',
    label: 'Email Address',
  });

  return (
    <input
      ref={control.ref}
      data-ui-id="email-input"
      type="email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
    />
  );
}
```

#### Select Element

```tsx
function CountrySelect() {
  const control = useUIElement({
    id: 'country-select',
    type: 'select',
  });

  return (
    <select ref={control.ref} data-ui-id="country-select">
      <option value="US">United States</option>
      <option value="UK">United Kingdom</option>
      <option value="CA">Canada</option>
    </select>
  );
}
```

#### Custom Actions

```tsx
function ColorPicker() {
  const [color, setColor] = useState('#000000');

  const control = useUIElement({
    id: 'color-picker',
    type: 'custom',
    customActions: {
      setColor: async (params) => {
        setColor(params.color);
        return { success: true, color: params.color };
      },
      getColor: async () => {
        return { color };
      },
    },
  });

  return (
    <div ref={control.ref} data-ui-id="color-picker">
      <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
    </div>
  );
}
```

## useUIComponent

Register a component with high-level actions.

### Basic Usage

```tsx
import { useUIComponent } from '@qontinui/ui-bridge';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useUIComponent({
    id: 'login-form',
    name: 'Login Form',
    actions: [
      {
        id: 'login',
        label: 'Login',
        handler: async (params) => {
          const { email, password } = params;
          return await authenticateUser(email, password);
        },
      },
      {
        id: 'reset',
        label: 'Reset Form',
        handler: async () => {
          setEmail('');
          setPassword('');
        },
      },
    ],
  });

  return (
    <form>
      <input value={email} onChange={(e) => setEmail(e.target.value)} />
      <input value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit">Login</button>
    </form>
  );
}
```

### Options

```typescript
useUIComponent({
  id: 'my-component',        // Required: Unique identifier
  name: 'My Component',      // Required: Display name
  description: 'Description', // Optional: Description
  actions: [                 // Required: Array of actions
    {
      id: 'action-id',
      label: 'Action Label',
      description: 'What it does',
      handler: async (params) => { ... },
    },
  ],
  elementIds: ['elem1', 'elem2'], // Optional: Related element IDs
});
```

### Action Handler

Action handlers receive parameters and should return a result:

```typescript
{
  id: 'submit',
  handler: async (params) => {
    // params contains values passed from the client
    const { email, password } = params;

    // Perform the action
    const result = await doSomething(email, password);

    // Return result (will be sent back to client)
    return { success: true, userId: result.id };
  },
}
```

## useUIBridge

Access the UI Bridge context.

```tsx
import { useUIBridge } from '@qontinui/ui-bridge';

function Dashboard() {
  const bridge = useUIBridge();

  // Get all registered elements
  const elements = bridge.elements;

  // Get all registered components
  const components = bridge.components;

  // Execute an action on an element
  const handleClick = async () => {
    await bridge.executeAction('submit-button', 'click');
  };

  // Capture a snapshot
  const handleSnapshot = () => {
    const snapshot = bridge.captureSnapshot();
    console.log(snapshot);
  };

  return (
    <div>
      <p>Registered elements: {elements.length}</p>
      <button onClick={handleClick}>Trigger Submit</button>
      <button onClick={handleSnapshot}>Capture Snapshot</button>
    </div>
  );
}
```

### Return Value

```typescript
interface UseUIBridgeReturn {
  elements: RegisteredElement[]; // All registered elements
  components: RegisteredComponent[]; // All registered components
  executeAction: (elementId: string, action: string, params?: any) => Promise<any>;
  captureSnapshot: () => BridgeSnapshot;
  registry: UIBridgeRegistry; // Direct registry access
}
```

## useBuildIdWatcher

Detects when the server has shipped a new bundle while the tab is still running
the old code, so you can prompt for a refresh. Pairs with a server that injects
`<meta name="build-id" content="...">` into the served HTML and exposes the
current build-id on a live source.

```tsx
import { useState } from 'react';
import { useBuildIdWatcher } from '@qontinui/ui-bridge/react';

function BuildRefreshBanner() {
  const [stale, setStale] = useState(false);
  useBuildIdWatcher({ onBuildIdChange: () => setStale(true) });

  if (!stale) return null;
  return (
    <div role="status" aria-live="polite">
      A new build is available.
      <button onClick={() => window.location.reload()}>Refresh</button>
    </div>
  );
}
```

:::warning The watched source must be able to change while the page is open

Comparing two **compile-time constants of the same process** — for example a
meta tag baked into HTML embedded in a desktop binary against that same
binary's compiled-in build-id — is a permanent false positive, not a staleness
check. Replacing the executable on disk changes neither value, so the
comparison can only ever fire on a build-time inconsistency, and the reload it
prompts is a guaranteed no-op.

The qontinui runner shipped exactly that (a Tauri `invoke` custom getter
against its own embedded meta tag); its banner never cleared and was deleted
rather than repaired. Use this hook only where a real server — or another
source that genuinely moves at runtime — is on the other end.

:::

### Options

```typescript
interface UseBuildIdWatcherOptions {
  healthStreamUrl?: string; // SSE stream emitting `buildId`. Default '/health/stream'
  pollUrl?: string; // GET returning JSON `{ buildId }`. Overrides the SSE path
  getCurrentBuildId?: () => Promise<string> | string; // Custom live source. Overrides both
  pollIntervalMs?: number; // For pollUrl/getCurrentBuildId. Default 30_000; 0 = one-shot
  onBuildIdChange?: (oldId: string, newId: string) => void; // Fires at most once per mount
}
```

Exactly one source is used, in precedence order: `getCurrentBuildId`, then
`pollUrl`, then the default SSE stream.

### Sources

```tsx
// SSE (default) — supervisor dashboard pattern
useBuildIdWatcher({ onBuildIdChange: () => setStale(true) });

// Polling — Next.js / qontinui-web pattern
useBuildIdWatcher({
  pollUrl: '/api/health',
  pollIntervalMs: 30_000,
  onBuildIdChange: () => setStale(true),
});

// Custom getter — any source that changes at RUNTIME (see the warning above)
useBuildIdWatcher({
  getCurrentBuildId: () => fetchBuildIdFromSomewhereLive(),
  pollIntervalMs: 30_000,
  onBuildIdChange: () => setStale(true),
});
```

The hook no-ops cleanly when the `<meta name="build-id">` tag is missing or
empty, and when the chosen source is unavailable (`EventSource` undefined in
SSR, `fetch` undefined outside a browser). `onBuildIdChange` fires at most once
per mount; the source is torn down on unmount.

## Best Practices

### 1. Always Add data-ui-id

Even though UI Bridge can find elements by other attributes, explicitly adding `data-ui-id` ensures reliable automation:

```tsx
<button ref={control.ref} data-ui-id="my-button">
  Click me
</button>
```

### 2. Use Descriptive IDs

```tsx
// Good
useUIElement({ id: 'checkout-submit-button' });
useUIComponent({ id: 'user-profile-form' });

// Avoid
useUIElement({ id: 'btn1' });
useUIComponent({ id: 'form' });
```

### 3. Clean Up on Unmount

The hooks automatically unregister elements when the component unmounts. No manual cleanup needed.

### 4. Type Your Action Parameters

```tsx
interface LoginParams {
  email: string;
  password: string;
}

useUIComponent({
  id: 'login-form',
  actions: [
    {
      id: 'login',
      handler: async (params: LoginParams) => {
        // TypeScript knows params shape
        return await login(params.email, params.password);
      },
    },
  ],
});
```
