---
sidebar_position: 2
---

# Getting Started

This guide will help you set up UI Bridge in your React application and start controlling it programmatically.

## Installation

### React Application

Install the main UI Bridge package in your React app:

```bash
npm install ui-bridge
# or
yarn add ui-bridge
# or
pnpm add ui-bridge
```

### Server (Optional)

If you need a standalone server:

```bash
npm install ui-bridge-server
```

### Python Client

Install the Python client for controlling the UI:

```bash
pip install ui-bridge-python
```

## Quick Setup

### 1. Add the Provider

Wrap your application with `UIBridgeProvider`:

```tsx title="src/App.tsx"
import { UIBridgeProvider } from 'ui-bridge';

function App() {
  return (
    <UIBridgeProvider
      features={{
        control: true,
        renderLog: true,
        debug: process.env.NODE_ENV === 'development',
      }}
      config={{
        serverPort: 9876,
      }}
    >
      <YourApp />
    </UIBridgeProvider>
  );
}
```

### 2. Register Elements

Use the `useUIElement` hook to register interactive elements:

```tsx title="src/components/LoginForm.tsx"
import { useUIElement, useUIComponent } from 'ui-bridge';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Register individual elements
  const emailInput = useUIElement({
    id: 'login-email',
    type: 'input',
    label: 'Email Input',
  });

  const passwordInput = useUIElement({
    id: 'login-password',
    type: 'input',
    label: 'Password Input',
  });

  const submitButton = useUIElement({
    id: 'login-submit',
    type: 'button',
    label: 'Login Button',
  });

  // Register component-level actions
  useUIComponent({
    id: 'login-form',
    name: 'Login Form',
    description: 'User authentication form',
    actions: [
      {
        id: 'login',
        label: 'Login',
        handler: async (params) => {
          const { email, password } = params as { email: string; password: string };
          // Handle login...
          return { success: true };
        },
      },
    ],
  });

  return (
    <form>
      <input
        ref={emailInput.ref}
        data-ui-id="login-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
      />
      <input
        ref={passwordInput.ref}
        data-ui-id="login-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
      />
      <button ref={submitButton.ref} data-ui-id="login-submit" type="submit">
        Login
      </button>
    </form>
  );
}
```

### 3. Start the Server

For standalone applications, start the UI Bridge server:

```tsx title="src/main.tsx"
import { startUIBridgeServer } from 'ui-bridge-server/standalone';

// Start the server on port 9876
startUIBridgeServer({ port: 9876 });
```

Or for Next.js, use the API route handler (see [Next.js Integration](./server/nextjs)).

### 4. Control from Python

Now you can control your UI from Python:

```python title="control.py"
from ui_bridge import UIBridgeClient

# Connect to the UI Bridge server
client = UIBridgeClient('http://localhost:9876')

# Discover available elements
discovery = client.discover()
for element in discovery.elements:
    print(f"Found: {element.id} ({element.type})")

# Interact with elements
client.type('login-email', 'user@example.com')
client.type('login-password', 'secret123')
client.click('login-submit')

# Or use component actions
client.component('login-form').action('login', {
    'email': 'user@example.com',
    'password': 'secret123'
})
```

## Element Identification

UI Bridge uses multiple strategies to identify elements, in priority order:

1. **`data-ui-id`** - Explicit UI Bridge identifier (recommended)
2. **`data-testid`** - Testing library convention
3. **`id`** - HTML id attribute
4. **CSS Selector** - Generated fallback

For best results, add `data-ui-id` attributes to your interactive elements:

```html
<button data-ui-id="submit-btn">Submit</button>
<input data-ui-id="email-input" type="email" />
<select data-ui-id="country-select">
  ...
</select>
```

## Configuration Options

### UIBridgeProvider Props

| Prop                 | Type    | Default      | Description                   |
| -------------------- | ------- | ------------ | ----------------------------- |
| `features.control`   | boolean | `true`       | Enable HTTP control endpoints |
| `features.renderLog` | boolean | `true`       | Enable render logging         |
| `features.debug`     | boolean | `false`      | Enable debug tools            |
| `config.serverPort`  | number  | `9876`       | Server port (standalone mode) |
| `config.apiPath`     | string  | `/ui-bridge` | API path prefix               |

### Python Client Options

```python
client = UIBridgeClient(
    base_url='http://localhost:9876',
    timeout=30.0,
    api_path='/ui-bridge'
)
```

## Next Steps

- Learn about [Element Identification](./concepts/element-identification)
- Explore [React Hooks](./react/hooks)
- Set up the [Server](./server/overview)
- Check the [API Reference](./api/overview)
