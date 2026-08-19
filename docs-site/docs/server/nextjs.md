---
sidebar_position: 3
---

# Next.js Integration

Integrate UI Bridge with Next.js using App Router API routes.

## Installation

```bash
npm install @qontinui/ui-bridge @qontinui/ui-bridge-server
```

## API Routes Setup

### App Router (Next.js 13+)

Create the catch-all route handler. `createNextRouteHandlers` takes the handler
set you build once (see [Server Overview](./overview#handlers-first)) and
returns the three route exports the App Router expects:

```typescript title="app/api/ui-bridge/[...path]/route.ts"
import { createNextRouteHandlers } from '@qontinui/ui-bridge-server/nextjs';
import { handlers } from '@/lib/ui-bridge';

export const { GET, POST, DELETE } = createNextRouteHandlers(handlers);
```

```typescript title="lib/ui-bridge.ts"
import { getGlobalRegistry, createActionExecutor } from '@qontinui/ui-bridge';
import { createHandlers } from '@qontinui/ui-bridge-server';

const registry = getGlobalRegistry();
export const handlers = createHandlers(registry, createActionExecutor(registry));
```

### Zero-config variant

If you only need the route surface to exist — endpoint discovery, health, and
well-formed empty responses — `createUIBridgeHandler` builds the whole thing
for you and returns a single handler:

```typescript title="app/api/ui-bridge/[...path]/route.ts"
import { createUIBridgeHandler } from '@qontinui/ui-bridge-server/nextjs';

const handler = createUIBridgeHandler();

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
```

:::warning
`createUIBridgeHandler` wires **server-safe stub implementations**: read
operations return empty data and write operations return an error. Your
browser's live elements are not reachable through it. For real control, pass
your own handlers to `createNextRouteHandlers` — relay-backed ones if the UI
runs in the browser, as described in
[Standalone Server](./standalone#relay-backed-handlers).
:::

### Provider Setup

```tsx title="app/layout.tsx"
import { UIBridgeProvider } from '@qontinui/ui-bridge';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <UIBridgeProvider
          config={{
            apiPath: '/api/ui-bridge',
          }}
        >
          {children}
        </UIBridgeProvider>
      </body>
    </html>
  );
}
```

## Pages Router (Legacy)

:::warning
There is no Pages Router adapter. `@qontinui/ui-bridge-server/nextjs` exports
App Router handlers only — `createNextRouteHandlers`, `createUIBridgeHandler`,
`createRenderLogHandlers`, `createControlHandlers` and `createDebugHandlers`,
all of which speak the Web `Request`/`Response` API rather than
`NextApiRequest`/`NextApiResponse`.

On Next.js 12 or a Pages-Router-only app, mount the
[Express adapter](./express) on a custom server, or run the
[standalone server](./standalone) as a sidecar.
:::

## Per-domain handlers

Instead of one catch-all, you can mount narrower routes.

`createControlHandlers(handlers)` and `createDebugHandlers(handlers)` return an
object of route modules keyed by endpoint (`elements`, `element`,
`components`, … and `actionHistory`, `metrics`, `highlight`):

```typescript title="app/api/ui-bridge/debug/metrics/route.ts"
import { createDebugHandlers } from '@qontinui/ui-bridge-server/nextjs';
import { handlers } from '@/lib/ui-bridge';

export const { GET } = createDebugHandlers(handlers).metrics;
```

`createRenderLogHandlers(handlers)` covers a single endpoint, so it returns the
route methods directly:

```typescript title="app/api/ui-bridge/render-log/route.ts"
import { createRenderLogHandlers } from '@qontinui/ui-bridge-server/nextjs';
import { handlers } from '@/lib/ui-bridge';

export const { GET, DELETE } = createRenderLogHandlers(handlers);
```

## Configuration

`NextJSAdapterConfig` extends `UIBridgeServerConfig` with a `runtime` field:

| Option         | Type                                   | Description                                       |
| -------------- | -------------------------------------- | ------------------------------------------------- |
| `runtime`      | `'edge' \| 'nodejs'`                   | Declared runtime hint                             |
| `authenticate` | `(req) => boolean \| Promise<boolean>` | Runs before every route; falsy returns 401        |
| `basePath`     | `string`                               | Route prefix                                      |
| `cors`         | `boolean \| CORSOptions`               | Declared on the base config                       |

### With Authentication

Pass `authenticate` rather than wrapping the exported handlers — it runs inside
the adapter, ahead of route matching:

```typescript title="app/api/ui-bridge/[...path]/route.ts"
import { createNextRouteHandlers } from '@qontinui/ui-bridge-server/nextjs';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { handlers } from '@/lib/ui-bridge';

export const { GET, POST, DELETE } = createNextRouteHandlers(handlers, {
  authenticate: async () => {
    const session = await getServerSession(authOptions);
    return session?.user?.isAdmin === true;
  },
});
```

A failed check returns `401` with the standard
`{ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }` envelope.

### Development Only

```typescript title="app/api/ui-bridge/[...path]/route.ts"
import { createNextRouteHandlers } from '@qontinui/ui-bridge-server/nextjs';
import { handlers } from '@/lib/ui-bridge';

export const { GET, POST, DELETE } = createNextRouteHandlers(handlers, {
  authenticate: () => process.env.NODE_ENV === 'development',
});
```

## Using Components

Register UI elements in your pages:

```tsx title="app/page.tsx"
'use client';

import { useUIElement, useUIComponent } from '@qontinui/ui-bridge';
import { useState } from 'react';

export default function HomePage() {
  const [count, setCount] = useState(0);

  const button = useUIElement({
    id: 'counter-button',
    type: 'button',
  });

  useUIComponent({
    id: 'counter',
    name: 'Counter Component',
    actions: [
      {
        id: 'increment',
        handler: async () => {
          setCount((c) => c + 1);
          return { count: count + 1 };
        },
      },
      {
        id: 'reset',
        handler: async () => {
          setCount(0);
          return { count: 0 };
        },
      },
    ],
  });

  return (
    <div>
      <p>Count: {count}</p>
      <button ref={button.ref} data-ui-id="counter-button" onClick={() => setCount((c) => c + 1)}>
        Increment
      </button>
    </div>
  );
}
```

## Server Components

UI Bridge hooks require client components. Use the `'use client'` directive:

```tsx
// This won't work in a Server Component
// 'use client' is required

'use client';

import { useUIElement } from '@qontinui/ui-bridge';

export function InteractiveButton() {
  const control = useUIElement({ id: 'my-button', type: 'button' });
  return <button ref={control.ref}>Click me</button>;
}
```

## Edge Runtime

UI Bridge is compatible with Edge Runtime:

```typescript title="app/api/ui-bridge/[...path]/route.ts"
import { createUIBridgeHandler } from '@qontinui/ui-bridge-server/nextjs';

export const runtime = 'edge';

const handler = createUIBridgeHandler({ runtime: 'edge' });
export const GET = handler;
export const POST = handler;
```

## Middleware

Add UI Bridge to your middleware for request logging:

```typescript title="middleware.ts"
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/ui-bridge')) {
    // Log UI Bridge requests
    console.log(`UI Bridge: ${request.method} ${request.nextUrl.pathname}`);
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/ui-bridge/:path*',
};
```

## Complete Example

See the [Next.js Example App](../examples/nextjs-app) for a full working example.
