---
sidebar_position: 2
---

# React Hooks

UI Bridge provides React hooks for registering and controlling UI elements.

## useUIElement

Register an element for programmatic control.

### Basic Usage

```tsx
import { useUIElement } from 'ui-bridge';

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
import { useUIComponent } from 'ui-bridge';

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
import { useUIBridge } from 'ui-bridge';

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
