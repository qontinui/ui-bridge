---
sidebar_position: 4
---

# Standalone Server

Run UI Bridge as a standalone HTTP server for simple React applications.

## Installation

```bash
npm install ui-bridge-server
```

## Basic Usage

```typescript
import { startUIBridgeServer } from 'ui-bridge-server/standalone';

// Start the server
const server = startUIBridgeServer({
  port: 9876,
});

console.log('UI Bridge server running on http://localhost:9876');
```

## Configuration

```typescript
const server = startUIBridgeServer({
  // Server settings
  port: 9876,              // Default: 9876
  host: '127.0.0.1',       // Default: '0.0.0.0'

  // Feature flags
  features: {
    control: true,         // Element control API
    renderLog: true,       // Render logging
    debug: true,           // Debug endpoints
  },

  // CORS settings
  cors: {
    origin: '*',           // Or specific origins
    credentials: true,
  },

  // Logging
  logging: {
    requests: true,        // Log incoming requests
    actions: true,         // Log action executions
    errors: true,          // Log errors
  },
});
```

## With React App

### Vite

```typescript title="src/main.tsx"
import React from 'react';
import ReactDOM from 'react-dom/client';
import { UIBridgeProvider } from 'ui-bridge';
import { startUIBridgeServer } from 'ui-bridge-server/standalone';
import App from './App';

// Start the server
if (import.meta.env.DEV) {
  startUIBridgeServer({ port: 9876 });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UIBridgeProvider config={{ serverPort: 9876 }}>
      <App />
    </UIBridgeProvider>
  </React.StrictMode>
);
```

### Create React App

```typescript title="src/index.tsx"
import React from 'react';
import ReactDOM from 'react-dom/client';
import { UIBridgeProvider } from 'ui-bridge';
import { startUIBridgeServer } from 'ui-bridge-server/standalone';
import App from './App';

// Start the server in development
if (process.env.NODE_ENV === 'development') {
  startUIBridgeServer({ port: 9876 });
}

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <UIBridgeProvider config={{ serverPort: 9876 }}>
      <App />
    </UIBridgeProvider>
  </React.StrictMode>
);
```

## Server Methods

```typescript
const server = startUIBridgeServer({ port: 9876 });

// Get server address
console.log(server.address()); // { port: 9876, host: '127.0.0.1' }

// Stop the server
server.close(() => {
  console.log('Server stopped');
});
```

## API Prefix

All endpoints are available under the configured path:

```typescript
startUIBridgeServer({
  port: 9876,
  apiPath: '/api/ui-bridge', // Custom path prefix
});

// Endpoints now at:
// http://localhost:9876/api/ui-bridge/control/elements
// http://localhost:9876/api/ui-bridge/control/discover
// etc.
```

## Health Check

```bash
curl http://localhost:9876/health
# {"status":"ok","timestamp":1234567890}
```

## Security

### Localhost Only

Bind to localhost for security:

```typescript
startUIBridgeServer({
  port: 9876,
  host: '127.0.0.1', // Only accessible locally
});
```

### Development Mode Only

```typescript
if (process.env.NODE_ENV === 'development') {
  startUIBridgeServer({ port: 9876 });
}
```

## Electron / Tauri

For desktop apps, start the server in the main process:

```typescript title="electron/main.ts"
import { app, BrowserWindow } from 'electron';
import { startUIBridgeServer } from 'ui-bridge-server/standalone';

let server;

app.whenReady().then(() => {
  // Start UI Bridge server
  server = startUIBridgeServer({ port: 9876 });

  // Create window
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadURL('http://localhost:5173');
});

app.on('window-all-closed', () => {
  server?.close();
  app.quit();
});
```

## Debugging

Enable verbose logging:

```typescript
startUIBridgeServer({
  port: 9876,
  logging: {
    requests: true,
    actions: true,
    errors: true,
    verbose: true, // Extra debug info
  },
});
```

## Complete Example

```typescript
import { startUIBridgeServer } from 'ui-bridge-server/standalone';

const server = startUIBridgeServer({
  port: 9876,
  host: '127.0.0.1',
  features: {
    control: true,
    renderLog: true,
    debug: process.env.NODE_ENV === 'development',
  },
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:5173'],
  },
  logging: {
    requests: true,
    actions: true,
  },
});

console.log(`UI Bridge server: http://localhost:9876`);

// Graceful shutdown
process.on('SIGTERM', () => {
  server.close(() => {
    console.log('UI Bridge server stopped');
    process.exit(0);
  });
});
```
