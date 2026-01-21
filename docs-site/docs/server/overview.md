---
sidebar_position: 1
---

# Server Overview

UI Bridge Server provides HTTP endpoints for controlling your React application. Choose the integration method that fits your stack.

## Server Options

| Option | Best For | Setup |
|--------|----------|-------|
| **Standalone** | Create React App, Vite | Separate process |
| **Express** | Express.js apps | Middleware |
| **Next.js** | Next.js apps | API routes |

## Quick Comparison

### Standalone Server

Best for simple React apps without a backend:

```tsx
import { startUIBridgeServer } from 'ui-bridge-server/standalone';

startUIBridgeServer({ port: 9876 });
```

- Runs as a separate process
- No backend required
- Simple setup

### Express Middleware

Best for apps with an existing Express server:

```typescript
import express from 'express';
import { uiBridgeMiddleware } from 'ui-bridge-server/express';

const app = express();
app.use('/ui-bridge', uiBridgeMiddleware());
```

- Integrates with existing server
- Shared port
- Access to existing middleware

### Next.js API Routes

Best for Next.js applications:

```typescript
// app/api/ui-bridge/[...path]/route.ts
export { GET, POST, DELETE } from 'ui-bridge-server/nextjs';
```

- Native Next.js integration
- Serverless compatible
- Same deployment

## Endpoints

All server options provide the same HTTP API:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/control/elements` | GET | List registered elements |
| `/control/element/:id` | GET | Get element details |
| `/control/element/:id/state` | GET | Get element state |
| `/control/element/:id/action` | POST | Execute action |
| `/control/components` | GET | List components |
| `/control/component/:id/action/:name` | POST | Execute component action |
| `/control/discover` | POST | Discover elements |
| `/control/snapshot` | GET | Get full snapshot |
| `/control/workflows` | GET | List workflows |
| `/control/workflow/:id/run` | POST | Run workflow |
| `/render-log` | GET | Get render log |
| `/render-log/snapshot` | POST | Capture snapshot |
| `/debug/metrics` | GET | Get metrics |

## Communication

The server communicates with the React app via:

1. **Direct Integration** (standalone): Server runs in the same process, direct registry access
2. **IPC/WebSocket** (Tauri): Tauri commands bridge server and React
3. **API Bridge** (Next.js): Shared state through API routes

## Security Considerations

:::warning
UI Bridge gives programmatic control over your UI. Only enable it in trusted environments.
:::

### Development Only

```tsx
<UIBridgeProvider
  features={{
    control: process.env.NODE_ENV === 'development',
  }}
>
```

### Authentication

For production use, add authentication:

```typescript
// Express
app.use('/ui-bridge', authMiddleware, uiBridgeMiddleware());

// Next.js
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.isAdmin) {
    return new Response('Unauthorized', { status: 401 });
  }
  return handleUIBridge(request);
}
```

### Network Binding

Bind to localhost only:

```typescript
startUIBridgeServer({
  port: 9876,
  host: '127.0.0.1', // Only accessible locally
});
```
