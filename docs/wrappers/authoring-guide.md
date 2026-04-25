# Wrapper Authoring Guide

A **wrapper** is a small UI Bridge app that exposes semantic actions (`list-unread`,
`create-component`, `archive`) against some other application — typically one whose
source you cannot or do not want to modify. Wrappers let you plug third-party apps,
legacy systems, and anything-with-an-API into the same agent-facing action surface
the first-party SDK provides.

Reference wrappers ship in this repo:

- `@qontinui/wrapper-gmail` — api-only, Gmail REST. Five actions, ~250 LOC.
- `@qontinui/wrapper-v0` — api-primary with a Playwright fallback for v0 features
  the public API does not cover.

This guide takes you from `npx create-ui-bridge-wrapper my-thing` to a passing test in
under 15 minutes.

## Contents

1. [Quick start](#quick-start)
2. [Transport selection](#transport-selection)
3. [Execution context per transport](#execution-context-per-transport)
4. [Handler registration](#handler-registration)
5. [`paramSchema` design](#paramschema-design)
6. [Authentication](#authentication)
7. [Retry and auth-refresh helpers](#retry-and-auth-refresh-helpers)
8. [Testing](#testing)
9. [Publishing](#publishing)
10. [The live transport (runner integration)](#the-live-transport-runner-integration)

## Quick start

### 1. Scaffold

```bash
npx create-ui-bridge-wrapper my-thing --transports api --yes
```

This creates `./my-thing/` with a `package.json`, a `tsup.config.ts`, a Node entry
at `src/index.ts`, a `src/handlers.ts`, one example action at `src/actions/hello.ts`,
and a passing smoke test at `tests/handlers.test.ts`.

Drop `--yes` for an interactive prompt that lets you pick multiple transports, opt
into a React UI (`WrapperAppShell`), or target the `qontinui-wrappers` monorepo.
The full CLI reference lives in
[`packages/create-ui-bridge-wrapper/README.md`](../../packages/create-ui-bridge-wrapper/README.md).

### 2. Edit one action

Open `src/actions/hello.ts`. The generated handler has the shape every wrapper
action uses:

```ts
export async function hello(params: HelloParams | undefined, ctx: unknown): Promise<HelloResult> {
  const target = params?.name ?? 'world';
  const kind = (ctx as { kind?: string } | undefined)?.kind ?? 'unknown';
  return { message: `hello, ${target}`, transport: kind };
}
```

Two things are worth noting:

- `params` is whatever the caller passed to `transport.dispatch('hello', params)`.
- `ctx` is transport-provided. An `api` transport sets `{ kind: 'api' }`; `headless`
  and `headed` add a Playwright `page`; `live` includes the `commandId` the runner
  attached to this dispatch. Narrow on `ctx.kind` before reading anything else.

Add a second action — say, `list-greetings` that returns a list:

```ts
// src/actions/list-greetings.ts
import { paramSchemaOf } from '@qontinui/ui-bridge-wrapper';

export interface ListGreetingsParams {
  limit?: number;
}
export interface ListGreetingsResult {
  greetings: string[];
}

export const listGreetingsParamSchema = paramSchemaOf({
  limit: { type: 'number', optional: true },
});

export async function listGreetings(
  params: ListGreetingsParams | undefined
): Promise<ListGreetingsResult> {
  const limit = Math.min(Math.max(params?.limit ?? 3, 1), 20);
  const greetings = ['hello', 'hi', 'howdy', 'hey', 'greetings'].slice(0, limit);
  return { greetings };
}
```

Wire it up in `src/handlers.ts`:

```ts
import {
  listGreetings,
  type ListGreetingsParams,
  type ListGreetingsResult,
} from './actions/list-greetings.js';

export function registerHandlers(transport: WrapperTransport): void {
  transport.register<HelloParams, HelloResult, unknown>('hello', (params, ctx) =>
    hello(params, ctx)
  );
  transport.register<ListGreetingsParams, ListGreetingsResult>('list-greetings', (params) =>
    listGreetings(params)
  );
}
```

### 3. Run tests

```bash
cd my-thing
npm install
npm test
```

The generated `tests/handlers.test.ts` registers your handlers against a
`MockTransport` and asserts the action ids show up in the registry. Add a test
that dispatches `list-greetings`:

```ts
import { describe, expect, it } from 'vitest';
import { MockTransport } from '@qontinui/_testing-harness';
import { registerHandlers } from '../src/handlers.js';

describe('list-greetings', () => {
  it('returns a capped list', async () => {
    const transport = new MockTransport({ kind: 'api' });
    registerHandlers(transport);
    const result = await transport.dispatch<{ greetings: string[] }>('list-greetings', {
      limit: 2,
    });
    expect(result.greetings).toEqual(['hello', 'hi']);
  });
});
```

### 4. Mount in a host

Build the wrapper, then import it from a host app that already provides the UI
Bridge React context. For the React entry (`--ui` on scaffolding, or keep the
`index.tsx` that ships with wrapper-gmail / wrapper-v0):

```tsx
import { MyThingWrapper } from '@qontinui/wrapper-my-thing';

export function Host() {
  return <MyThingWrapper />;
}
```

The wrapper registers itself with UI Bridge via `useUIComponent({ id: 'wrapper-my-thing', ... })`
so agents can list its actions through the standard `/ui-bridge/control/components` route.

For a headless daemon (CI / runner sidecar), use the Node entry:

```bash
node dist/index.js
```

## Transport selection

```
createTransport({ kind: 'api'      | 'headless' | 'headed' | 'live', ... })
```

Pick one — or several — based on how your target exposes itself.

| Transport  | Use when                                                                                         | Runtime cost             |
| ---------- | ------------------------------------------------------------------------------------------------ | ------------------------ |
| `api`      | The target has a stable REST/GraphQL/SDK and auth story you can automate.                        | Zero. No browser.        |
| `headless` | No stable API, but the app is a web UI. CI-friendly, no visible window.                          | Playwright Chromium.     |
| `headed`   | Same as headless, but you want to watch the browser while developing.                            | Playwright Chromium.     |
| `live`     | The target is an open browser tab or extension that can't host an HTTP server but can open a WS. | WebSocket to the runner. |

Decision rubric:

- Start with `api`. It's the cheapest, most reliable, and the easiest to unit-test.
- Fall back to `headless` for actions the API does not cover. `wrapper-v0` uses this
  pattern: `create-component` has an `api` path **and** a Playwright path; actions
  like `step-through-iterations` only exist in `headless` / `headed`.
- Use `headed` only during development — it's the same code path as `headless`,
  just with `headless: false` on the Playwright launch.
- Use `live` for tabs / extensions / anywhere the runner can't reach the app via HTTP.
  The runner dispatches commands to the tab over a WebSocket at `/ui-bridge/ws`.

A single wrapper can support multiple transports. Declare `supports` on each action
descriptor and filter during registration, as `wrapper-v0` does — actions attempted
against an unsupported transport throw `NO_HANDLER` at dispatch time, which is
easier to diagnose than a runtime crash deep inside a handler.

## Execution context per transport

Each transport passes its own `ctx` object to every handler. Narrow with
`ctx.kind`.

### `api`

```ts
interface ApiContext {
  readonly kind: 'api';
}
```

Empty by design. Handlers hold their own SDK / fetch clients at module scope.
See `wrapper-gmail/src/client.ts` for the cached-client pattern.

### `headless` and `headed`

```ts
import type { Browser, BrowserContext, Page } from 'playwright';

interface HeadlessContext {
  readonly kind: 'headless' | 'headed';
  readonly page: Page;
  readonly browserContext: BrowserContext;
  readonly browser: Browser;
  /** True once the UI Bridge relay confirmed the tab is registered. */
  readonly uiBridgeRegistered: boolean;
  /** Relay-assigned tab id, when known. */
  readonly tabId: string | null;
}
```

The browser is launched on `transport.ready()` and torn down on `transport.close()`.
Handlers get a long-lived `page` — navigate, interact, then return a result.

### `live`

```ts
interface LiveContext {
  readonly kind: 'live';
  /** commandId the runner attached to this dispatch, if any. */
  readonly commandId: string | null;
}
```

When the runner sends a `{ type: "command", commandId, action, payload }` frame,
the transport routes it through the registered handler and writes the result back
as a `{ type: "response", commandId, success, result?, error? }` frame. Self-
dispatched calls (e.g. from tests or from a UI button in the same wrapper) get
`commandId: null`.

## Handler registration

Every transport exposes the same registration API:

```ts
transport.register<TParams, TResult, TCtx>(
  actionId,
  (params: TParams | undefined, ctx: TCtx) => TResult | Promise<TResult>
);
```

Equivalent (and what `register` delegates to internally):

```ts
transport.handlerRegistry.register(actionId, (params, ctx) => /* ... */);
```

Both work on the same underlying `HandlerRegistry`. Use the `register` shortcut
in wrapper code; reach for `handlerRegistry` when you need registry metadata
(`.list()`, `.has(id)`, `.unregister(id)`) — for example, a UI that toggles actions
on and off.

Handlers are async by convention (`async (params, ctx) => { ... }`) but a
synchronous return value is also accepted; the registry awaits it either way.

Errors thrown by a handler surface to the caller as a `WrapperTransportError`
with code `HANDLER_ERROR`:

```ts
try {
  await transport.dispatch('send-reply', { threadId, body });
} catch (err) {
  if (err instanceof WrapperTransportError) {
    console.error(err.code, err.retryable, err.message);
  }
}
```

A handler may throw `WrapperTransportError` directly — the registry preserves the
`code` / `retryable` fields rather than wrapping them. This is the pattern
`withAuthRefresh` relies on (see [Retry and auth-refresh helpers](#retry-and-auth-refresh-helpers)).

## `paramSchema` design

The `paramSchemaOf` helper produces a JSON-Schema-subset object from a terse
descriptor. It does **not** validate at runtime — its only job is to surface
parameter names and types on the runner's `/control/component/:id` endpoint so
callers (agents, devtools, other wrappers) can discover the action signature.

```ts
import { paramSchemaOf } from '@qontinui/ui-bridge-wrapper';

export const listUnreadParamSchema = paramSchemaOf({
  limit: { type: 'number', optional: true },
  query: { type: 'string', optional: true },
});
// => {
//   type: 'object',
//   properties: {
//     limit: { type: 'number' },
//     query: { type: 'string' },
//   },
//   additionalProperties: false,
// }
```

Shorthand: pass `'string'` / `'number'` / `'boolean'` for required primitives.
Use `{ type: 'string', optional: true }` to mark a field optional. Pass a full
JSON-Schema object (`{ type: 'string', enum: [...] }`) when you need more
expressive types.

Design rules:

- **Keep it flat.** Nested schemas work but agents reason better about flat
  inputs. If you find yourself shipping nested objects, consider splitting the
  action.
- **Stick to JSON primitives.** `string`, `number`, `boolean`, `array`. Avoid
  `object` — if the action needs a structured value, prefer a JSON string and
  document the shape.
- **Tight `required` sets.** Every required field is a chance for the caller to
  pass something missing; fewer means the action is more robust.
- **No IDs in params.** If the caller needs a thread id, make them fetch one via
  `list-unread` first. This keeps actions composable.

## Authentication

Auth is the wrapper's responsibility — the runtime does nothing here.

### `api` transport — BYO credentials

Read from the environment at module scope, construct your SDK client lazily.
See `wrapper-gmail/src/auth.ts`:

```ts
export function readGmailAuthConfig(env = process.env): GmailAuthConfig {
  const clientId = env['GMAIL_OAUTH_CLIENT_ID'];
  const clientSecret = env['GMAIL_OAUTH_CLIENT_SECRET'];
  const refreshToken = env['GMAIL_REFRESH_TOKEN'];
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail wrapper: missing env vars...');
  }
  return { clientId, clientSecret, refreshToken };
}
```

Pair the read with a one-time provisioning step documented in the wrapper's
README. For Gmail: mint a refresh token via the Google Cloud console or a
loopback-OAuth helper; paste into `.env`; re-use forever.

### Loopback OAuth for interactive provisioning

Desktop-style OAuth2 clients accept a `redirect_uri` of the form
`http://127.0.0.1:<port>/oauth/callback`. Spin up a one-shot HTTP server, open
the consent URL in the user's default browser, wait for the callback, exchange
the code, and persist the resulting refresh token.

The Gmail wrapper ships a stub (`runInteractiveOAuthFlow` in `src/auth.ts`)
that documents the shape; implementation is deferred to a downstream CLI script.
When you add one, keep it out of the hot path — interactive auth is slow and
flaky, and your action handlers should never call it.

### `headless` / `headed` — storage state

Playwright contexts can be pre-warmed with a saved cookies/localStorage blob:

```bash
npx playwright open --save-storage=./v0-storage.json https://v0.app
# log in manually, close the window
```

Then pass `storageStatePath: './v0-storage.json'` when launching your
headless transport (the wrapper's own code should handle this — the runtime
does not accept it directly; you'll need to extend `HeadlessTransport` or
call `launchHeadlessTab` from `@qontinui/ui-bridge-headless` with the option).

### `live` — bearer token on the upgrade

```ts
createTransport({
  kind: 'live',
  runnerUrl: 'ws://localhost:1420/ui-bridge/ws',
  appId: 'wrapper-my-thing',
  appName: 'My Thing',
  options: {
    authToken: process.env.RUNNER_TOKEN,
    handshakeTimeoutMs: 10_000,
  },
});
```

## Retry and auth-refresh helpers

The runtime ships two small helpers to handle the two most common transient-
failure modes.

### `withRetry`

```ts
import { withRetry } from '@qontinui/ui-bridge-wrapper';

const result = await withRetry(() => fetchSomething(), {
  attempts: 3,
  baseMs: 250,
  maxDelayMs: 5_000,
});
```

Defaults: 3 attempts, 200 ms base, doubling delay (200 / 400 / 800), capped at
5 s. Retries on any error by default; narrow via `shouldRetry`:

```ts
withRetry(() => fetchSomething(), {
  shouldRetry: (err) => err instanceof NetworkError,
});
```

Transports mark errors as `retryable` via `WrapperTransportError({ retryable: true })`.
The default predicate respects that flag when it's set.

### `withAuthRefresh`

```ts
import { withAuthRefresh, withRetry } from '@qontinui/ui-bridge-wrapper';

return withAuthRefresh(
  () => withRetry(run, { attempts: 3, baseMs: 250 }),
  async () => {
    const oauth = getCachedOAuth();
    if (oauth) await refreshAccessToken(oauth);
  }
);
```

Runs the inner function once; if it throws an auth-expired error, calls the
refresh function and retries exactly once. The default detector trips on any
`WrapperTransportError` whose `code` matches `/^(AUTH|UNAUTH|401)/i` or any
error with `status === 401`. Override with `isAuthError` when the detection
rule doesn't fit your SDK's error shape.

The canonical composition (retry inside auth-refresh) matches how
`wrapper-gmail` stacks them: retry the transient-network failures, _then_
refresh-and-retry the auth failures. Reversing the order causes a refresh on
every transient hiccup, which is wasteful.

## Testing

Wrappers are ordinary TypeScript packages. Unit-test your handlers the way you
test any async function.

### Unit tests — direct handler calls

```ts
import { describe, expect, it, vi } from 'vitest';
import { listUnread } from '../src/actions/list-unread.js';

vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: vi.fn() },
    gmail: vi.fn(() => ({
      users: {
        messages: {
          list: vi.fn().mockResolvedValue({ data: { messages: [{ id: 'm1' }] } }),
          get: vi.fn().mockResolvedValue({
            data: {
              /* ... */
            },
          }),
        },
      },
    })),
  },
}));

describe('list-unread', () => {
  it('returns a MessageSummary[]', async () => {
    const result = await listUnread({ limit: 5 });
    expect(result.messages).toHaveLength(1);
  });
});
```

This skips the transport entirely. Use it for action logic — parameter
normalization, error mapping, the happy path.

### Integration tests — `MockTransport`

```ts
import { describe, expect, it } from 'vitest';
import { MockTransport } from '@qontinui/_testing-harness';
import { registerHandlers, GMAIL_ACTION_IDS } from '../src/handlers.js';

describe('gmail handlers smoke', () => {
  it('registers every expected action id', () => {
    const transport = new MockTransport({ kind: 'api' });
    registerHandlers(transport);
    for (const id of GMAIL_ACTION_IDS) {
      expect(transport.handlerRegistry.has(id)).toBe(true);
    }
  });

  it('dispatch records the call', async () => {
    const transport = new MockTransport({ kind: 'api' });
    transport.register('ping', async () => 'pong');
    const result = await transport.dispatch<string>('ping');
    expect(result).toBe('pong');
    expect(transport.calls).toEqual([
      { actionId: 'ping', params: undefined, at: expect.any(Number) },
    ]);
  });
});
```

`MockTransport` implements the full `WrapperTransport` contract. Notable features:

- `kind` defaults to `'api'`; pass any of `'api' | 'headless' | 'headed' | 'live'`
  to exercise context-specific branches.
- `cannedResponses: { 'list-unread': { messages: [] } }` short-circuits dispatch
  without needing an explicit handler registration.
- `transport.calls` is a log of every dispatch, in order.
- `createMockContext(kind)` returns the stub ctx the mock would hand to a
  handler — useful when you want to unit-test a handler against a fake ctx
  without the transport wrapper.

### What not to test

- Playwright selectors against a real browser — your wrapper's CI will suffer.
  Either mock the page or split out end-to-end tests behind a separate script
  that runs on demand.
- The runtime itself — `@qontinui/ui-bridge-wrapper` has its own test suite.

## Publishing

Scope community wrappers under `@qontinui/wrapper-*` to keep the ecosystem
searchable:

```
@qontinui/wrapper-gmail
@qontinui/wrapper-v0
@qontinui/wrapper-my-thing
```

Reference wrappers live in the [`qontinui-wrappers`](https://github.com/qontinui/qontinui-wrappers)
monorepo; community wrappers live in their own repos. Wrapper package.json must
declare:

```json
{
  "peerDependencies": {
    "@qontinui/ui-bridge": "*",
    "@qontinui/ui-bridge-wrapper": "*",
    "react": "^18.0.0 || ^19.0.0"
  },
  "peerDependenciesMeta": {
    "react": { "optional": true }
  }
}
```

React is optional so pure-Node daemons (headless / live) skip it. Add
`playwright` as an optional peer if you support `headless` / `headed`:

```json
"peerDependencies": {
  "playwright": "^1.49.0"
},
"peerDependenciesMeta": {
  "playwright": { "optional": true }
}
```

Build with tsup (both CJS and ESM), emit types with tsc:

```json
"scripts": {
  "build": "tsup && tsc -p tsconfig.build.json",
  "typecheck": "tsc --noEmit",
  "test": "vitest run"
}
```

## The live transport (runner integration)

The `live` transport is how a wrapper tells the qontinui runner "dispatch my
actions through me over this WebSocket." The runner's `/ui-bridge/ws` route
accepts upgrades, reads a `register` frame, and then sends `command` frames
for any action dispatch the runner routes to this app.

Minimal wrapper wiring:

```ts
import { createTransport } from '@qontinui/ui-bridge-wrapper';
import { registerHandlers } from './handlers.js';

const transport = createTransport({
  kind: 'live',
  runnerUrl: 'ws://localhost:1420/ui-bridge/ws',
  appId: 'wrapper-my-thing',
  appName: 'My Thing',
});

registerHandlers(transport);
await transport.ready(); // opens the WS, sends `register`, awaits `ack`.
// The transport now handles inbound `command` frames until `close()`.
```

The frame protocol (lifted from `ws_relay.rs`):

- Client → Server: `{ type: "register", transport: "websocket", appId, appName }`
- Server → Client: `{ type: "ack", ok: true }` — or `{ ok: false, error: {...} }`
- Server → Client: `{ type: "command", commandId, action, payload? }`
- Client → Server: `{ type: "response", commandId, success, result?, error? }`

The runner tracks connections in a `WsConnectionManager` and keeps a reverse
`app_id → conn_id` map with last-tab-wins semantics (Phase 1). If the same
`appId` reconnects, the previous connection stops receiving commands but
remains open until it closes its own socket.

Node wrappers need to pass a `ws` constructor:

```ts
import WebSocket from 'ws';
import { LiveSessionTransport } from '@qontinui/ui-bridge-wrapper';

const transport = new LiveSessionTransport(
  { kind: 'live', runnerUrl: '...', appId: '...', appName: '...' },
  undefined,
  { webSocketCtor: WebSocket as never }
);
```

Browser wrappers use the global `WebSocket` automatically; no injection needed.

## Troubleshooting

- **`NO_HANDLER`** on dispatch: no registration for that `actionId` on the
  transport. Check `transport.handlerRegistry.list()`. If you're using a
  `supports`-gated pattern (see `wrapper-v0/src/handlers.ts`), confirm the
  current transport kind is in the action's `supports` list.
- **`HANDSHAKE_TIMEOUT`** on a live transport: the runner accepted the socket
  but never sent `{ type: "ack" }`. Check the runner logs for a malformed
  `register` frame (usually an `appId` containing characters that collide with
  another registration).
- **`NOT_READY`** on dispatch: you called `transport.dispatch` before
  `transport.ready()` resolved. The base class awaits `ready()` automatically,
  so this only fires if the `ready` promise rejected and you ignored it.
- **Playwright can't launch**: install browser binaries with
  `npx playwright install chromium` in the wrapper's directory. For Linux CI,
  also run `npx playwright install-deps chromium`.
- **Tests pass locally, fail in CI**: the Playwright-backed transports launch a
  real browser. Guard headless-requiring tests behind an env flag or move them
  to a separate `npm run test:integration` script.

## Further reading

- [`ui-bridge/packages/ui-bridge-wrapper/src/`](../../packages/ui-bridge-wrapper/src/) — the
  runtime's 5 transports, 3 helpers, 3 React hooks. ~1000 LOC, all readable
  in one sitting.
- [`qontinui-wrappers/packages/wrapper-gmail/`](https://github.com/qontinui/qontinui-wrappers/tree/main/packages/wrapper-gmail) —
  api-only reference wrapper.
- [`qontinui-wrappers/packages/wrapper-v0/`](https://github.com/qontinui/qontinui-wrappers/tree/main/packages/wrapper-v0) —
  api + browser fallback reference wrapper.
- [`packages/create-ui-bridge-wrapper/README.md`](../../packages/create-ui-bridge-wrapper/README.md) —
  scaffold CLI reference.
