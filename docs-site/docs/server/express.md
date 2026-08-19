---
sidebar_position: 2
---

# Express Integration

Integrate UI Bridge with your existing Express.js server.

## Installation

```bash
npm install @qontinui/ui-bridge-server
```

## Basic Setup

The Express adapter mounts a handler set you build first — see
[Server Overview](./overview#handlers-first) for where `handlers` comes from.

```typescript
import express from 'express';
import { getGlobalRegistry, createActionExecutor } from '@qontinui/ui-bridge';
import { createHandlers } from '@qontinui/ui-bridge-server';
import { uiBridgeMiddleware } from '@qontinui/ui-bridge-server/express';

const app = express();

const registry = getGlobalRegistry();
const handlers = createHandlers(registry, createActionExecutor(registry));

// Add UI Bridge middleware
app.use('/ui-bridge', uiBridgeMiddleware(handlers));

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
  console.log('UI Bridge available at http://localhost:3000/ui-bridge');
});
```

## Three entry points

| Export                | Returns          | Use when                                                 |
| --------------------- | ---------------- | -------------------------------------------------------- |
| `createExpressRouter` | an Express `Router` | You want to mount the routes yourself                    |
| `uiBridgeMiddleware`  | an Express `Router` | Same thing, named for the `app.use(...)` call site       |
| `createExpressApp`    | a complete `app`   | You have no Express app yet and want one made for you    |

`uiBridgeMiddleware(handlers, config)` is a direct alias for
`createExpressRouter(handlers, config)` — pick whichever reads better at the
call site.

```typescript
import { createExpressApp } from '@qontinui/ui-bridge-server/express';

// Mounts the router at config.basePath (default '/ui-bridge')
// and adds a GET /health route.
const app = createExpressApp(handlers, { basePath: '/ui-bridge' });
```

## Configuration

All three take an `ExpressAdapterConfig`:

| Option          | Type                       | Default          | Description                                                        |
| --------------- | -------------------------- | ---------------- | ------------------------------------------------------------------ |
| `basePath`      | `string`                   | `'/ui-bridge'`   | Only read by `createExpressApp` — the router itself is path-agnostic |
| `cors`          | `boolean \| CORSOptions`   | _(off)_          | Adds a CORS middleware ahead of the routes                          |
| `authenticate`  | `(req) => boolean \| Promise<boolean>` | _(off)_ | Runs before every route; a falsy result returns 401                 |
| `useBodyParser` | `boolean`                  | `false`          | Install `express.json()` on the router, tolerating empty POST bodies |
| `rateLimit`     | `RateLimitOptions`         | _(unimplemented)_| Declared on the config type but not honoured by any adapter         |

```typescript
app.use(
  '/ui-bridge',
  uiBridgeMiddleware(handlers, {
    useBodyParser: true,

    cors: {
      origin: ['http://localhost:3000', 'http://localhost:5173'],
      credentials: true,
    },
  })
);
```

:::note
Unlike the standalone server, the Express adapter honours the full `CORSOptions`
object — specific origins, methods, headers, credentials and `maxAge` — and
answers `OPTIONS` preflights with `204`.
:::

:::warning
Set `useBodyParser: true` only when the router is mounted on an app that has no
JSON body parser of its own. `createExpressApp` already calls `express.json()`,
so it mounts its router with `useBodyParser: false`.
:::

## With Authentication

The adapter has a built-in hook — no wrapper middleware needed:

```typescript
import type { Request } from 'express';

app.use(
  '/ui-bridge',
  uiBridgeMiddleware(handlers, {
    authenticate: async (req) => {
      const token = (req as Request).headers.authorization;
      return token === `Bearer ${process.env.UI_BRIDGE_TOKEN}`;
    },
  })
);
```

:::note
`authenticate` receives the request as `unknown` — the config type is shared
across adapters — so cast it to your framework's request type at the call site.
:::

Ordinary Express middleware still works if you want to protect only part of the
surface:

```typescript
import { authMiddleware } from './auth';

const bridge = uiBridgeMiddleware(handlers);

app.use('/ui-bridge/control', authMiddleware, bridge);
app.use('/ui-bridge/render-log', bridge); // Public
```

## With Existing API

```typescript
import express from 'express';
import { uiBridgeMiddleware } from '@qontinui/ui-bridge-server/express';

const app = express();

// Your existing API routes
app.use('/api', yourApiRoutes);

// UI Bridge on a separate path
app.use('/ui-bridge', uiBridgeMiddleware(handlers));

// Or nested under your API
app.use('/api/ui-bridge', uiBridgeMiddleware(handlers));
```

## Registry Connection

The router does not talk to a registry — it calls the handlers you passed in.
Choosing a handler source is how you connect it to your UI.

### Option 1: Shared Process (SSR)

If your Express server and the UI Bridge registry live in the same process:

```typescript
import { getGlobalRegistry, createActionExecutor } from '@qontinui/ui-bridge';
import { createHandlers } from '@qontinui/ui-bridge-server';
import { uiBridgeMiddleware } from '@qontinui/ui-bridge-server/express';

const registry = getGlobalRegistry();
const handlers = createHandlers(registry, createActionExecutor(registry));

app.use('/ui-bridge', uiBridgeMiddleware(handlers));
```

### Option 2: Command Relay

For a separate frontend and backend, back the handlers with a `CommandRelay`.
Each call is queued to whichever browser tab has connected back to the relay:

```typescript
import { CommandRelay, createRelayHandlers } from '@qontinui/ui-bridge/server';
import { uiBridgeMiddleware } from '@qontinui/ui-bridge-server/express';

const relay = new CommandRelay();
const handlers = createRelayHandlers(relay);

app.use('/ui-bridge', uiBridgeMiddleware(handlers));
```

In React, mount the listener inside your provider and point it at the same path:

```tsx
import { UIBridgeProvider, CommandRelayListener } from '@qontinui/ui-bridge';

<UIBridgeProvider features={{ control: true, renderLog: true }}>
  <CommandRelayListener basePath="/ui-bridge" />
  <YourApp />
</UIBridgeProvider>;
```

## Error Handling

The adapter already converts a thrown handler error into a `500` carrying the
standard `{ success: false, error, code }` envelope, so an error middleware is
only needed for the rest of your app:

```typescript
app.use('/ui-bridge', uiBridgeMiddleware(handlers));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});
```

## TypeScript

The config type is exported as `ExpressAdapterConfig`:

```typescript
import express from 'express';
import {
  uiBridgeMiddleware,
  type ExpressAdapterConfig,
} from '@qontinui/ui-bridge-server/express';

const options: ExpressAdapterConfig = {
  useBodyParser: true,
  cors: { origin: ['http://localhost:5173'] },
};

app.use('/ui-bridge', uiBridgeMiddleware(handlers, options));
```

## Complete Example

```typescript
import express from 'express';
import { getGlobalRegistry, createActionExecutor } from '@qontinui/ui-bridge';
import { createHandlers } from '@qontinui/ui-bridge-server';
import { uiBridgeMiddleware } from '@qontinui/ui-bridge-server/express';

const app = express();
app.use(express.json());

// Your routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// UI Bridge
const registry = getGlobalRegistry();
const handlers = createHandlers(registry, createActionExecutor(registry), {
  verbose: process.env.NODE_ENV === 'development',
});

app.use(
  '/ui-bridge',
  uiBridgeMiddleware(handlers, {
    cors: { origin: ['http://localhost:5173'] },
  })
);

// Error handling
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`UI Bridge: http://localhost:${PORT}/ui-bridge`);
});
```
