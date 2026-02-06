---
sidebar_position: 1
---

# React Example App

A basic React application demonstrating UI Bridge integration.

## Overview

This example shows how to:

- Set up UIBridgeProvider
- Register elements with useUIElement
- Register components with useUIComponent
- Control the app from Python

## Source Code

The full example is available at: [examples/react-app](https://github.com/qontinui/ui-bridge/tree/main/examples/react-app)

## Quick Start

```bash
# Clone the repository
git clone https://github.com/qontinui/ui-bridge.git
cd ui-bridge/examples/react-app

# Install dependencies
npm install

# Start the app
npm run dev
```

The app runs at `http://localhost:3334` with UI Bridge at `http://localhost:9876`.

## Project Structure

```
examples/react-app/
├── src/
│   ├── App.tsx           # Main app with UIBridgeProvider
│   ├── LoginForm.tsx     # Example form component
│   └── main.tsx          # Entry point
├── package.json
└── vite.config.ts
```

## Key Code

### Provider Setup

```tsx title="src/main.tsx"
import { UIBridgeProvider } from 'ui-bridge';
import { startUIBridgeServer } from 'ui-bridge-server/standalone';

// Start the server in development
startUIBridgeServer({ port: 9876 });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <UIBridgeProvider
    features={{ control: true, renderLog: true, debug: true }}
    config={{ serverPort: 9876 }}
  >
    <App />
  </UIBridgeProvider>
);
```

### Element Registration

```tsx title="src/LoginForm.tsx"
import { useUIElement, useUIComponent } from 'ui-bridge';

function LoginForm() {
  const emailInput = useUIElement({ id: 'login-email', type: 'input' });
  const passwordInput = useUIElement({ id: 'login-password', type: 'input' });
  const submitButton = useUIElement({ id: 'login-submit', type: 'button' });

  useUIComponent({
    id: 'login-form',
    name: 'Login Form',
    actions: [
      {
        id: 'login',
        handler: async (params) => {
          // Handle login
          return { success: true };
        },
      },
    ],
  });

  return (
    <form>
      <input ref={emailInput.ref} data-ui-id="login-email" type="email" />
      <input ref={passwordInput.ref} data-ui-id="login-password" type="password" />
      <button ref={submitButton.ref} data-ui-id="login-submit">
        Login
      </button>
    </form>
  );
}
```

## Controlling from Python

```python
from ui_bridge import UIBridgeClient

client = UIBridgeClient('http://localhost:9876')

# Discover elements
discovery = client.discover()
print(f"Found {discovery.total} elements")

# Fill the form
client.type('login-email', 'user@example.com')
client.type('login-password', 'secret123')

# Submit
client.click('login-submit')

# Or use component action
client.component('login-form').action('login', {
    'email': 'user@example.com',
    'password': 'secret123'
})
```

## Running Tests

```bash
# From Python
python control.py
```
