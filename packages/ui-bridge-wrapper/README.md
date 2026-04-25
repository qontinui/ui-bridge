# `@qontinui/ui-bridge-wrapper`

Runtime library for building UI Bridge **wrapper apps** — tiny apps that
expose a set of semantic actions against a target system (a SaaS API, a
web UI, a running qontinui app) and let the same action code run against
any of four interchangeable transports:

| Kind       | What it does                                         | Typical use           |
| ---------- | ---------------------------------------------------- | --------------------- |
| `api`      | Delegates to user-defined handlers. No browser.      | Direct SDK/REST calls |
| `headless` | Launches Playwright Chromium with no visible window. | CI, background tests  |
| `headed`   | Launches Playwright Chromium with a visible window.  | Local debugging       |
| `live`     | Connects to a qontinui runner over WebSocket.        | Live orchestration    |

See `src/index.ts` for the full exported surface. React helpers ship
under the `./react` subpath so Node-only wrappers don't pay the React
import cost.

## Quick start

```ts
import { createTransport } from '@qontinui/ui-bridge-wrapper';

const transport = createTransport({
  kind: 'headless',
  options: { targetUrl: 'http://localhost:3001/vga/builder' },
});

transport.handlerRegistry.register('login', async (params, ctx) => {
  const { email, password } = params as { email: string; password: string };
  const { page } = ctx as { page: import('playwright').Page };
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
});

await transport.ready();
await transport.dispatch('login', { email: 'a@b.c', password: '...' });
await transport.close();
```

## Package layout

- `src/index.ts` — public surface (transports, helpers, types).
- `src/base-transport.ts` — `BaseTransport` with status/listeners/ready gating.
- `src/handler-registry.ts` — shared action registry used by every transport.
- `src/transports/{api,headless,headed,live}.ts` — the four concrete transports.
- `src/helpers/{retry,auth,schema}.ts` — `withRetry`, `withAuthRefresh`, `paramSchemaOf`.
- `src/react/*` — React hooks (`useWrapperStatus`, `useTransportSelector`) and the default `WrapperAppShell` layout.

Phase 3 of the wrapper plan adds a scaffold CLI on top of this package;
Phase 4 ships reference wrappers that exercise all four transports.
