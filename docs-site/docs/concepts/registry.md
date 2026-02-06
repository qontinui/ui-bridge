---
sidebar_position: 2
---

# Registry

The UI Bridge Registry is a central store for all registered elements, components, and workflows. It manages the lifecycle of controllable UI items and provides methods for lookup and state inspection.

## Overview

```typescript
import { UIBridgeRegistry, getGlobalRegistry } from 'ui-bridge';

// Get the global registry
const registry = getGlobalRegistry();

// Or create a new instance
const customRegistry = new UIBridgeRegistry({
  verbose: true,
  onEvent: (event) => console.log(event),
});
```

## Element Registration

### Registering Elements

Elements are typically registered via the `useUIElement` hook, but can also be registered directly:

```typescript
const registry = getGlobalRegistry();

// Register an element
const registered = registry.registerElement('my-button', buttonElement, {
  type: 'button',
  label: 'My Button',
  actions: ['click', 'focus', 'blur'],
});

// Get element info
console.log(registered.id); // 'my-button'
console.log(registered.type); // 'button'
console.log(registered.actions); // ['click', 'focus', 'blur']
```

### Getting Element State

```typescript
const element = registry.getElement('my-button');
if (element) {
  const state = element.getState();
  console.log(state.visible); // true
  console.log(state.enabled); // true
  console.log(state.focused); // false
  console.log(state.rect); // { x, y, width, height, ... }
}
```

### Listing All Elements

```typescript
const elements = registry.getAllElements();
elements.forEach((el) => {
  console.log(`${el.id}: ${el.type}`);
});
```

### Unregistering Elements

```typescript
registry.unregisterElement('my-button');
```

## Component Registration

Components represent higher-level UI constructs with custom actions:

```typescript
const component = registry.registerComponent('login-form', {
  name: 'Login Form',
  description: 'User authentication form',
  actions: [
    {
      id: 'login',
      label: 'Login',
      description: 'Authenticate user',
      handler: async (params) => {
        const { email, password } = params;
        return await authenticate(email, password);
      },
    },
    {
      id: 'reset',
      label: 'Reset Form',
      handler: () => {
        // Reset form state
      },
    },
  ],
  elementIds: ['login-email', 'login-password', 'login-submit'],
});
```

### Executing Component Actions

```typescript
const component = registry.getComponent('login-form');
const action = component.actions.find((a) => a.id === 'login');
const result = await action.handler({ email: 'user@example.com', password: 'secret' });
```

## Workflow Registration

Workflows define multi-step automation sequences:

```typescript
const workflow = registry.registerWorkflow({
  id: 'checkout-flow',
  name: 'Checkout Flow',
  description: 'Complete a purchase',
  steps: [
    {
      id: 'add-to-cart',
      type: 'action',
      target: 'add-to-cart-btn',
      action: 'click',
    },
    {
      id: 'go-to-cart',
      type: 'action',
      target: 'cart-link',
      action: 'click',
    },
    {
      id: 'enter-email',
      type: 'action',
      target: 'checkout-email',
      action: 'type',
      params: { text: '{{email}}' },
    },
    {
      id: 'submit',
      type: 'action',
      target: 'checkout-submit',
      action: 'click',
    },
  ],
});
```

## Event System

The registry emits events for state changes:

```typescript
// Listen for element registration
const unsubscribe = registry.on('element:registered', (event) => {
  console.log(`Element registered: ${event.data.id}`);
});

// Listen for element unregistration
registry.on('element:unregistered', (event) => {
  console.log(`Element removed: ${event.data.id}`);
});

// Remove listener
unsubscribe();
// or
registry.off('element:registered', listener);
```

### Event Types

| Event                    | Data                  | Description                |
| ------------------------ | --------------------- | -------------------------- |
| `element:registered`     | `{ id, type, label }` | Element was registered     |
| `element:unregistered`   | `{ id }`              | Element was unregistered   |
| `component:registered`   | `{ id, name }`        | Component was registered   |
| `component:unregistered` | `{ id }`              | Component was unregistered |

## Snapshots

Create a complete snapshot of the registry state:

```typescript
const snapshot = registry.createSnapshot();

console.log(snapshot.timestamp); // Unix timestamp
console.log(snapshot.elements); // Array of element info
console.log(snapshot.components); // Array of component info
console.log(snapshot.workflows); // Array of workflow info
```

## Global Registry

UI Bridge maintains a global registry instance:

```typescript
import { getGlobalRegistry, setGlobalRegistry, resetGlobalRegistry } from 'ui-bridge';

// Get the global registry (creates one if none exists)
const registry = getGlobalRegistry();

// Set a custom registry as global
const customRegistry = new UIBridgeRegistry();
setGlobalRegistry(customRegistry);

// Reset (clears and removes the global registry)
resetGlobalRegistry();
```

## Statistics

Get registry statistics:

```typescript
const stats = registry.getStats();
console.log(stats.elementCount); // Total elements
console.log(stats.componentCount); // Total components
console.log(stats.workflowCount); // Total workflows
console.log(stats.mountedElementCount); // Currently mounted elements
console.log(stats.mountedComponentCount); // Currently mounted components
```
