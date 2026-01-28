# Component State Exposure

Component State Exposure allows you to expose internal component state to UI Bridge.

## Basic State Exposure

```typescript
import { useExposeState } from '@anthropic/ui-bridge/react';

function Counter() {
  const [count, setCount] = useState(0);

  useExposeState('counter', { count });

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>Increment</button>
    </div>
  );
}
```

## Access Exposed State

```typescript
const state = await client.getComponentState('counter');
console.log(state.count); // 5
```

## Form State

```typescript
function LoginForm() {
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});

  useExposeState('login-form', {
    values: formData,
    errors,
    isValid: Object.keys(errors).length === 0,
  });

  return <form>...</form>;
}
```

## State Watchers

```typescript
const unwatch = client.watchState('cart', (state, prevState) => {
  console.log(`Cart updated: ${prevState.total} -> ${state.total}`);
});

// Wait for state condition
await client.waitForState('cart', (state) => state.items.length > 0);
```

## Namespacing

```typescript
useExposeState('user-profile.details', { name: user.name, email: user.email });
useExposeState('user-profile.preferences', { theme: user.preferences.theme });

// Access namespaced state
const details = await client.getComponentState('user-profile.details');
```

## State Snapshots

```typescript
const snapshot = await client.getStateSnapshot();
// { 'counter': { count: 5 }, 'cart': { items: [], total: 0 } }

const before = await client.getStateSnapshot();
await client.executeAction('add-to-cart-btn', 'click');
const after = await client.getStateSnapshot();
const diff = client.diffState(before, after);
```
