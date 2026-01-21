---
sidebar_position: 3
---

# Next.js Integration

Integrate UI Bridge with Next.js using App Router API routes.

## Installation

```bash
npm install ui-bridge ui-bridge-server
```

## API Routes Setup

### App Router (Next.js 13+)

Create the catch-all route handler:

```typescript title="app/api/ui-bridge/[...path]/route.ts"
import { createNextHandler } from 'ui-bridge-server/nextjs';

const handler = createNextHandler({
  features: {
    control: true,
    renderLog: true,
    debug: process.env.NODE_ENV === 'development',
  },
});

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
```

### Provider Setup

```tsx title="app/layout.tsx"
import { UIBridgeProvider } from 'ui-bridge';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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

For Next.js 12 or Pages Router:

```typescript title="pages/api/ui-bridge/[...path].ts"
import { createPagesHandler } from 'ui-bridge-server/nextjs';

export default createPagesHandler({
  features: {
    control: true,
    renderLog: true,
  },
});
```

## Configuration

### With Authentication

```typescript title="app/api/ui-bridge/[...path]/route.ts"
import { createNextHandler } from 'ui-bridge-server/nextjs';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const handler = createNextHandler({
  features: {
    control: true,
    renderLog: true,
  },
});

async function withAuth(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Optional: Check for admin role
  if (!session.user?.isAdmin) {
    return new Response('Forbidden', { status: 403 });
  }

  return handler(request);
}

export const GET = withAuth;
export const POST = withAuth;
export const DELETE = withAuth;
```

### Development Only

```typescript title="app/api/ui-bridge/[...path]/route.ts"
import { createNextHandler } from 'ui-bridge-server/nextjs';

const handler = createNextHandler();

// Only enable in development
const devOnlyHandler = (request: Request) => {
  if (process.env.NODE_ENV !== 'development') {
    return new Response('Not Found', { status: 404 });
  }
  return handler(request);
};

export const GET = devOnlyHandler;
export const POST = devOnlyHandler;
export const DELETE = devOnlyHandler;
```

## Using Components

Register UI elements in your pages:

```tsx title="app/page.tsx"
'use client';

import { useUIElement, useUIComponent } from 'ui-bridge';
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
          setCount(c => c + 1);
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
      <button
        ref={button.ref}
        data-ui-id="counter-button"
        onClick={() => setCount(c => c + 1)}
      >
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

import { useUIElement } from 'ui-bridge';

export function InteractiveButton() {
  const control = useUIElement({ id: 'my-button', type: 'button' });
  return <button ref={control.ref}>Click me</button>;
}
```

## Edge Runtime

UI Bridge is compatible with Edge Runtime:

```typescript title="app/api/ui-bridge/[...path]/route.ts"
import { createNextHandler } from 'ui-bridge-server/nextjs';

export const runtime = 'edge';

const handler = createNextHandler();
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
