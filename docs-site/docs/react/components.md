---
sidebar_position: 3
---

# React Components

UI Bridge provides React components for common use cases.

## Debug Overlay

The debug overlay shows registered elements and allows inspection:

```tsx
import { UIBridgeProvider, DebugOverlay } from 'ui-bridge';

function App() {
  return (
    <UIBridgeProvider features={{ debug: true }}>
      <YourApp />
      <DebugOverlay />
    </UIBridgeProvider>
  );
}
```

### Features

- **Element Highlighting**: Hover over elements to see their boundaries
- **Element Inspector**: Click to inspect element details
- **Action History**: View recent actions and their results
- **State Viewer**: Inspect element and component state

### Conditional Rendering

Only show in development:

```tsx
{process.env.NODE_ENV === 'development' && <DebugOverlay />}
```

## Element Wrapper

A convenience component that automatically registers its children:

```tsx
import { UIElement } from 'ui-bridge';

function MyForm() {
  return (
    <form>
      <UIElement id="email-input" type="input">
        <input type="email" placeholder="Email" />
      </UIElement>

      <UIElement id="password-input" type="input">
        <input type="password" placeholder="Password" />
      </UIElement>

      <UIElement id="submit-btn" type="button">
        <button type="submit">Login</button>
      </UIElement>
    </form>
  );
}
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `id` | `string` | Element identifier |
| `type` | `ElementType` | Element type |
| `label` | `string` | Human-readable label |
| `children` | `ReactElement` | Single child element |

## Component Wrapper

Register a component with actions:

```tsx
import { UIComponentWrapper } from 'ui-bridge';

function CheckoutForm() {
  const handleSubmit = async (params) => {
    // Process checkout
    return { orderId: '12345' };
  };

  return (
    <UIComponentWrapper
      id="checkout-form"
      name="Checkout Form"
      actions={[
        { id: 'submit', label: 'Submit Order', handler: handleSubmit },
      ]}
    >
      <form>
        {/* Form fields */}
      </form>
    </UIComponentWrapper>
  );
}
```

## Creating Custom Components

Combine hooks to create reusable controlled components:

```tsx
import { useUIElement, useUIComponent } from 'ui-bridge';

interface ControlledFormProps {
  id: string;
  onSubmit: (data: FormData) => Promise<any>;
  children: React.ReactNode;
}

function ControlledForm({ id, onSubmit, children }: ControlledFormProps) {
  const formRef = useRef<HTMLFormElement>(null);

  useUIComponent({
    id,
    name: `Form: ${id}`,
    actions: [
      {
        id: 'submit',
        handler: async (params) => {
          const formData = new FormData(formRef.current!);
          return await onSubmit(formData);
        },
      },
      {
        id: 'reset',
        handler: async () => {
          formRef.current?.reset();
        },
      },
    ],
  });

  return (
    <form ref={formRef} data-ui-id={id}>
      {children}
    </form>
  );
}
```

Usage:

```tsx
<ControlledForm id="login-form" onSubmit={handleLogin}>
  <input name="email" />
  <input name="password" type="password" />
  <button type="submit">Login</button>
</ControlledForm>
```

Then from Python:

```python
client.component('login-form').action('submit')
```
