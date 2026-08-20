# `@qontinui/ui-bridge-server`

HTTP adapters that expose a UI Bridge handler set over Express, Next.js, or a
bare Node server. This package holds the transport; the elements, components
and actions it serves come from [`@qontinui/ui-bridge`](../ui-bridge).

```bash
npm install @qontinui/ui-bridge-server
```

Full documentation: <https://qontinui.github.io/ui-bridge/docs/server/overview>.

## Handlers first

Every adapter mounts a **handler set**, so building one is always step one.
`createHandlers` takes anything satisfying the `RegistryLike` and
`ActionExecutorLike` contracts — it is not tied to the browser registry, which
is what lets the same adapters serve an in-process registry, a relay, or a test
double:

```typescript
import { getGlobalRegistry, createActionExecutor } from '@qontinui/ui-bridge';
import { createHandlers } from '@qontinui/ui-bridge-server';

const registry = getGlobalRegistry();
const handlers = createHandlers(registry, createActionExecutor(registry));
```

## Express

```typescript
import express from 'express';
import { uiBridgeMiddleware } from '@qontinui/ui-bridge-server/express';

const app = express();
app.use('/ui-bridge', uiBridgeMiddleware(handlers));
app.listen(3000);
```

## Next.js (App Router)

```typescript
// app/api/ui-bridge/[...path]/route.ts
import { createNextRouteHandlers } from '@qontinui/ui-bridge-server/nextjs';

export const { GET, POST, DELETE } = createNextRouteHandlers(handlers);
```

With no handler set of your own, `createUIBridgeHandler()` builds the whole
thing from server-safe stubs — reads return well-formed empty payloads, writes
return an explicit error — which is enough to wire the route and see it
respond:

```typescript
// app/api/ui-bridge/[...path]/route.ts
import { createUIBridgeHandler } from '@qontinui/ui-bridge-server/nextjs';

const handler = createUIBridgeHandler();

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
```

`examples/nextjs-app` in this repo is exactly that route, built and
type-checked by CI against the declared `next` peer range.

**Route `params` across the `next` range.** App Router `params` is a plain
object before Next 13.4 and a `Promise` from 13.4 onward. The handlers accept
either and `await` internally, so one export satisfies Next's generated route
validator across the whole `^13 || ^14 || ^15 || ^16` peer range this package
declares.

`/health` and `/_routes` are served by the catch-all itself, so they work with
no handler entry: `GET /api/ui-bridge/health` returns the same
`{ status, timestamp }` the other two adapters serve at the server root, and
`GET /api/ui-bridge/_routes` lists every route the adapter can dispatch.

## Standalone

```typescript
import { createStandaloneServer } from '@qontinui/ui-bridge-server/standalone';

const server = await createStandaloneServer(handlers, { port: 9876 });
```

`createStandaloneServer` is `async` — it constructs a `StandaloneServer` and
awaits `start()`. Import the class directly to construct without starting.

`StandaloneServer` uses Node's `http` module and cannot run in a browser.

## Entry points

| Subpath        | Exports                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `.`            | `createHandlers`, the `RegistryLike` / `ActionExecutorLike` contracts, shared types                                           |
| `./express`    | `uiBridgeMiddleware`, `createExpressRouter`                                                                                   |
| `./nextjs`     | `createNextRouteHandlers`, `createUIBridgeHandler`, `createControlHandlers`, `createRenderLogHandlers`, `createDebugHandlers` |
| `./standalone` | `createStandaloneServer`, `StandaloneServer`                                                                                  |
| `./handlers`   | The handler factory on its own                                                                                                |

`express`, `next` and `ws` are **peer** dependencies: install whichever your
host needs, and nothing more.

## License

AGPL-3.0-or-later.
