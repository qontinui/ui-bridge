---
sidebar_position: 4
---

# Standalone Server

Run UI Bridge as a standalone Node HTTP server, with no Express or Next.js
in the picture.

## Installation

```bash
npm install @qontinui/ui-bridge-server
```

## Basic Usage

Starting a server is two steps: **build handlers**, then **start a server with
them**. There is no config-only entry point — the server has no opinion about
where your elements live, so you hand it a handler set that knows.

```typescript
import { getGlobalRegistry, createActionExecutor } from '@qontinui/ui-bridge';
import { createHandlers } from '@qontinui/ui-bridge-server';
import { createStandaloneServer } from '@qontinui/ui-bridge-server/standalone';

const registry = getGlobalRegistry();
const handlers = createHandlers(registry, createActionExecutor(registry));

const server = await createStandaloneServer(handlers, { port: 9876 });

console.log('UI Bridge server running on http://localhost:9876');
```

`createStandaloneServer` is `async` — it constructs a `StandaloneServer` and
awaits `start()` before resolving. To construct without starting, use the class
directly:

```typescript
import { StandaloneServer } from '@qontinui/ui-bridge-server/standalone';

const server = new StandaloneServer(handlers, { port: 9876 });
await server.start();
```

## Where the handlers come from

`createHandlers(registry, actionExecutor, config?)` accepts anything matching
the `RegistryLike` and `ActionExecutorLike` contracts — it is not tied to the
browser registry. That is what makes the same server usable from three very
different hosts:

| Host                                             | Handler source                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Same Node process as the registry                | `createHandlers(getGlobalRegistry(), createActionExecutor(registry))`                    |
| Browser app, server out of process               | `createRelayHandlers(relay)` from `@qontinui/ui-bridge/server` — see [Relay-backed handlers](#relay-backed-handlers) |
| Custom store (headless, test double, native host)| Your own object satisfying `RegistryLike` / `ActionExecutorLike`                          |

:::warning
`StandaloneServer` uses Node's `http` module. It cannot run inside a browser
bundle — do not call it from `src/main.tsx` or `src/index.tsx`. Start it from a
Node entry point: a sidecar script, an Electron main process, or a Tauri
sidecar.
:::

### Relay-backed handlers

When your UI runs in a browser and the server runs in a separate process, the
registry is not reachable directly. Back the handlers with a `CommandRelay`
instead — every query and action is queued to the browser and answered there:

```typescript
import { CommandRelay, createRelayHandlers } from '@qontinui/ui-bridge/server';
import { createStandaloneServer } from '@qontinui/ui-bridge-server/standalone';

const relay = new CommandRelay();
const handlers = createRelayHandlers(relay);

const server = await createStandaloneServer(handlers, { port: 9876 });
```

On the browser side, mount `CommandRelayListener` inside your provider so the
app connects back to the relay:

```tsx
import { UIBridgeProvider, CommandRelayListener } from '@qontinui/ui-bridge';

<UIBridgeProvider features={{ control: true, renderLog: true }}>
  <CommandRelayListener basePath="/ui-bridge" />
  <YourApp />
</UIBridgeProvider>;
```

## Configuration

`StandaloneServerConfig` extends `UIBridgeServerConfig`. The fields the
standalone server actually reads:

| Option           | Type                      | Default       | Description                                        |
| ---------------- | ------------------------- | ------------- | -------------------------------------------------- |
| `host`           | `string`                  | `'localhost'` | Address to bind to                                 |
| `port`           | `number`                  | `9876`        | Port to listen on                                  |
| `websocket`      | `boolean`                 | `false`       | Enable the WebSocket handler                       |
| `websocketPort`  | `number`                  | `port`        | WebSocket port                                     |
| `log`            | `(message: string) => void` | `console.log` | Logging function                                   |
| `basePath`       | `string`                  | `'/ui-bridge'`| Route prefix for all API endpoints                 |
| `cors`           | `boolean \| CORSOptions`  | _(off)_       | Any truthy value sends permissive CORS headers     |

```typescript
const server = await createStandaloneServer(handlers, {
  host: '127.0.0.1',
  port: 9876,
  basePath: '/ui-bridge',
  cors: true,
  websocket: true,
  log: (message) => console.log(`[ui-bridge] ${message}`),
});
```

:::note
The standalone server treats `cors` as a boolean switch: when it is truthy it
always sends `Access-Control-Allow-Origin: *`. The richer `CORSOptions` object
(specific origins, credentials, max-age) is only honoured by the
[Express adapter](./express).
:::

`UIBridgeServerConfig` also declares `authenticate` and `rateLimit`. Neither is
implemented by `StandaloneServer` — `authenticate` is honoured by the Express
and Next.js adapters only, and `rateLimit` is not implemented by any adapter.
Put a proxy in front of the server if you need either.

## Server Methods

```typescript
const server = await createStandaloneServer(handlers, { port: 9876 });

// Get the bound address — null before start() or after stop()
console.log(server.getAddress()); // { host: 'localhost', port: 9876 }

// WebSocket helpers (only meaningful with websocket: true)
console.log(server.wsClientCount);
server.broadcastEvent(event);
const wsHandler = server.getWSHandler();

// Stop the server
await server.stop();
```

## API Prefix

All endpoints are served under `basePath` (default `/ui-bridge`):

```typescript
await createStandaloneServer(handlers, {
  port: 9876,
  basePath: '/api/ui-bridge',
});

// Endpoints now at:
// http://localhost:9876/api/ui-bridge/control/elements
// http://localhost:9876/api/ui-bridge/control/discover
// etc.
```

## Health Check

`/health` is served at the server root, outside `basePath`:

```bash
curl http://localhost:9876/health
# {"status":"ok","timestamp":1234567890}
```

## CLI Entry Point

`startCLI` parses `--port` / `-p`, `--host` / `-h` and `--cors` from `argv` and
starts a server with the result:

```typescript title="scripts/ui-bridge-server.mjs"
import { getGlobalRegistry, createActionExecutor } from '@qontinui/ui-bridge';
import { createHandlers } from '@qontinui/ui-bridge-server';
import { startCLI } from '@qontinui/ui-bridge-server/standalone';

const registry = getGlobalRegistry();
await startCLI(createHandlers(registry, createActionExecutor(registry)));
```

```bash
node scripts/ui-bridge-server.mjs --port 9876 --host 127.0.0.1 --cors
```

## Security

### Localhost Only

Bind to loopback so the server is not reachable from the network:

```typescript
await createStandaloneServer(handlers, {
  port: 9876,
  host: '127.0.0.1',
});
```

### Development Mode Only

```typescript
if (process.env.NODE_ENV === 'development') {
  await createStandaloneServer(handlers, { port: 9876 });
}
```

## Electron / Tauri

For desktop apps, start the server in the main process:

```typescript title="electron/main.ts"
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { CommandRelay, createRelayHandlers } from '@qontinui/ui-bridge/server';
import { createStandaloneServer, type StandaloneServer } from '@qontinui/ui-bridge-server/standalone';

let server: StandaloneServer | undefined;

app.whenReady().then(async () => {
  // The UI runs in the renderer, so back the handlers with the relay.
  const relay = new CommandRelay();
  server = await createStandaloneServer(createRelayHandlers(relay), {
    port: 9876,
    host: '127.0.0.1',
  });

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadURL('http://localhost:5173');
});

app.on('window-all-closed', async () => {
  await server?.stop();
  app.quit();
});
```

## Debugging

Pass a `log` function to see request-level output, and enable `websocket` to
trace live connections:

```typescript
await createStandaloneServer(handlers, {
  port: 9876,
  websocket: true,
  log: (message) => console.log(`[ui-bridge] ${new Date().toISOString()} ${message}`),
});
```

`createHandlers` also takes a config of its own:

```typescript
const handlers = createHandlers(registry, createActionExecutor(registry), {
  verbose: true,
  renderLogPath: './ui-bridge-render.log',
});
```

## Complete Example

```typescript title="scripts/ui-bridge-server.mjs"
import { getGlobalRegistry, createActionExecutor } from '@qontinui/ui-bridge';
import { createHandlers } from '@qontinui/ui-bridge-server';
import { createStandaloneServer } from '@qontinui/ui-bridge-server/standalone';

const registry = getGlobalRegistry();
const handlers = createHandlers(registry, createActionExecutor(registry), {
  verbose: process.env.NODE_ENV === 'development',
});

const server = await createStandaloneServer(handlers, {
  host: '127.0.0.1',
  port: 9876,
  cors: true,
});

console.log(`UI Bridge server: http://127.0.0.1:${server.getAddress()?.port}`);

// Graceful shutdown
process.on('SIGTERM', async () => {
  await server.stop();
  console.log('UI Bridge server stopped');
  process.exit(0);
});
```
