---
sidebar_position: 1
---

# UIBridgeProvider

The `UIBridgeProvider` is the root component that enables UI Bridge functionality in your React application.

## Basic Setup

```tsx
import { UIBridgeProvider } from 'ui-bridge';

function App() {
  return (
    <UIBridgeProvider>
      <YourApp />
    </UIBridgeProvider>
  );
}
```

## Configuration

### Features

Enable or disable specific features:

```tsx
<UIBridgeProvider
  features={{
    control: true, // HTTP control API (default: true)
    renderLog: true, // Render logging (default: true)
    debug: false, // Debug tools (default: false)
  }}
>
  <App />
</UIBridgeProvider>
```

### Server Configuration

Configure the server settings:

```tsx
<UIBridgeProvider
  config={{
    serverPort: 9876, // Server port (default: 9876)
    apiPath: '/ui-bridge', // API path prefix (default: '/ui-bridge')
  }}
>
  <App />
</UIBridgeProvider>
```

### Development Mode

Enable debug features in development:

```tsx
<UIBridgeProvider
  features={{
    control: true,
    renderLog: true,
    debug: process.env.NODE_ENV === 'development',
  }}
>
  <App />
</UIBridgeProvider>
```

## Props Reference

| Prop                 | Type        | Default        | Description                    |
| -------------------- | ----------- | -------------- | ------------------------------ |
| `features.control`   | `boolean`   | `true`         | Enable HTTP control endpoints  |
| `features.renderLog` | `boolean`   | `true`         | Enable render logging          |
| `features.debug`     | `boolean`   | `false`        | Enable debug overlay and tools |
| `config.serverPort`  | `number`    | `9876`         | Port for standalone server     |
| `config.apiPath`     | `string`    | `'/ui-bridge'` | API path prefix                |
| `children`           | `ReactNode` | -              | Child components               |

## Context

The provider creates a React context that can be accessed via hooks:

```tsx
import { useUIBridge } from 'ui-bridge';

function MyComponent() {
  const bridge = useUIBridge();

  // Access registry
  const elements = bridge.elements;
  const components = bridge.components;

  // Execute actions
  bridge.executeAction('button-id', 'click');

  // Capture snapshot
  const snapshot = bridge.captureSnapshot();

  return <div>...</div>;
}
```

## Multiple Providers

You can use multiple providers for different parts of your app, but typically one root provider is sufficient:

```tsx
// Not recommended - use one provider at root
<UIBridgeProvider>
  <Header />
  <UIBridgeProvider> {/* Avoid nested providers */}
    <MainContent />
  </UIBridgeProvider>
</UIBridgeProvider>

// Recommended - single provider at root
<UIBridgeProvider>
  <Header />
  <MainContent />
  <Footer />
</UIBridgeProvider>
```

## Server Integration

### Standalone Mode

For standalone React apps (Create React App, Vite, etc.):

```tsx
import { UIBridgeProvider } from 'ui-bridge';
import { startUIBridgeServer } from 'ui-bridge-server/standalone';

// Start server
startUIBridgeServer({ port: 9876 });

function App() {
  return (
    <UIBridgeProvider config={{ serverPort: 9876 }}>
      <YourApp />
    </UIBridgeProvider>
  );
}
```

### Next.js Mode

For Next.js apps, use API routes:

```tsx
// app/layout.tsx
import { UIBridgeProvider } from 'ui-bridge';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <UIBridgeProvider config={{ apiPath: '/api/ui-bridge' }}>{children}</UIBridgeProvider>
      </body>
    </html>
  );
}
```

See [Next.js Integration](../server/nextjs) for API route setup.
