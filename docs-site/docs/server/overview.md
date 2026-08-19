---
sidebar_position: 1
---

# Server Overview

UI Bridge Server provides HTTP endpoints for controlling your React application. Choose the integration method that fits your stack.

## Server Options

| Option         | Best For               | Setup            |
| -------------- | ---------------------- | ---------------- |
| **Standalone** | Create React App, Vite | Separate process |
| **Express**    | Express.js apps        | Middleware       |
| **Next.js**    | Next.js apps           | API routes       |

## Handlers first

Every adapter takes the same first argument: a `UIBridgeServerHandlers` object.
Build it once with `createHandlers(registry, actionExecutor, config?)`, then
hand it to whichever adapter fits your stack.

```typescript
import { getGlobalRegistry, createActionExecutor } from '@qontinui/ui-bridge';
import { createHandlers } from '@qontinui/ui-bridge-server';

const registry = getGlobalRegistry();
export const handlers = createHandlers(registry, createActionExecutor(registry));
```

`registry` and `actionExecutor` only have to satisfy the `RegistryLike` and
`ActionExecutorLike` contracts, so a browser app whose server runs out of
process can substitute relay-backed handlers instead — see
[Standalone Server](./standalone#relay-backed-handlers).

## Quick Comparison

### Standalone Server

A self-contained Node HTTP server, no framework required:

```typescript
import { createStandaloneServer } from '@qontinui/ui-bridge-server/standalone';

const server = await createStandaloneServer(handlers, { port: 9876 });
```

- Runs as a separate Node process
- No backend framework required
- `async` — resolves once the socket is listening

### Express Middleware

Best for apps with an existing Express server:

```typescript
import express from 'express';
import { uiBridgeMiddleware } from '@qontinui/ui-bridge-server/express';

const app = express();
app.use('/ui-bridge', uiBridgeMiddleware(handlers));
```

- Integrates with existing server
- Shared port
- Access to existing middleware

### Next.js API Routes

Best for Next.js applications:

```typescript
// app/api/ui-bridge/[...path]/route.ts
import { createNextRouteHandlers } from '@qontinui/ui-bridge-server/nextjs';
import { handlers } from '@/lib/ui-bridge';

export const { GET, POST, DELETE } = createNextRouteHandlers(handlers);
```

- Native Next.js integration
- Serverless compatible
- Same deployment

## Endpoints

All server options provide the same HTTP API:

| Endpoint                              | Method | Description              |
| ------------------------------------- | ------ | ------------------------ |
| `/control/elements`                   | GET    | List registered elements |
| `/control/element/:id`                | GET    | Get element details      |
| `/control/element/:id/state`          | GET    | Get element state        |
| `/control/element/:id/action`         | POST   | Execute action           |
| `/control/components`                 | GET    | List components          |
| `/control/component/:id/action/:name` | POST   | Execute component action |
| `/control/discover`                   | POST   | Discover elements        |
| `/control/snapshot`                   | GET    | Get full snapshot        |
| `/control/workflows`                  | GET    | List workflows           |
| `/control/workflow/:id/run`           | POST   | Run workflow             |
| `/render-log`                         | GET    | Get render log           |
| `/render-log/snapshot`                | POST   | Capture snapshot         |
| `/debug/metrics`                      | GET    | Get metrics              |

## Communication

The server never reaches into the UI itself — it only calls the handler set you
gave it. How that handler set reaches your elements is the thing that varies:

1. **Direct registry access**: handlers built from `getGlobalRegistry()` — the
   registry lives in the same process as the server
2. **Command relay**: `createRelayHandlers(relay)` queues each call to a browser
   that has mounted `CommandRelayListener`, for apps whose UI is out of process
3. **Custom contract**: any object satisfying `RegistryLike` /
   `ActionExecutorLike` — used by headless hosts and test doubles

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

Both the Express and Next.js adapters accept an `authenticate` callback, which
runs before every UI Bridge route:

```typescript
// Express
app.use('/ui-bridge', uiBridgeMiddleware(handlers, {
  authenticate: (req) => isAdmin(req),
}));

// Next.js
export const { GET, POST, DELETE } = createNextRouteHandlers(handlers, {
  authenticate: async (req) => (await getSession(req))?.isAdmin === true,
});
```

`authenticate` is not implemented by the standalone server; wrap it in a proxy
instead, or bind it to loopback only.

### Network Binding

Bind to localhost only:

```typescript
await createStandaloneServer(handlers, {
  port: 9876,
  host: '127.0.0.1', // Only accessible locally
});
```
