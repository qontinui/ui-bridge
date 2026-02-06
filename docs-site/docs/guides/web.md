---
sidebar_position: 1
---

# Web / Next.js Guide

Complete guide for integrating UI Bridge with Next.js and other web applications, including auto-registration and render logging.

## Installation

```bash
npm install ui-bridge ui-bridge-server
```

## Basic Setup

### 1. Add the Provider

```tsx
// app/layout.tsx (App Router)
import { UIBridgeProvider, AutoRegisterProvider } from 'ui-bridge/react';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <UIBridgeProvider
          features={{
            renderLog: true,
            control: true,
            debug: process.env.NODE_ENV === 'development',
          }}
        >
          <AutoRegisterProvider enabled={process.env.NODE_ENV === 'development'}>
            {children}
          </AutoRegisterProvider>
        </UIBridgeProvider>
      </body>
    </html>
  );
}
```

### 2. Add the API Route

```tsx
// app/api/ui-bridge/[...path]/route.ts
import { createUIBridgeHandler } from 'ui-bridge-server/nextjs';

const handler = createUIBridgeHandler();

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
```

### 3. Add Render Logging (Optional but Recommended)

Create a wrapper component that captures DOM snapshots on navigation:

```tsx
// lib/ui-bridge/RenderLogWrapper.tsx
'use client';

import { useEffect, useRef, useCallback, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useUIBridgeOptional } from 'ui-bridge/react';

export function RenderLogWrapper({
  children,
  enableOnMount = true,
  enableMutationObserver = true,
  mutationDebounceMs = 500,
}: {
  children: ReactNode;
  enableOnMount?: boolean;
  enableMutationObserver?: boolean;
  mutationDebounceMs?: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const bridge = useUIBridgeOptional();
  const isDev = process.env.NODE_ENV === 'development';

  const lastPathRef = useRef<string | null>(null);
  const mutationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);

  const fullPath = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : '');

  // Capture snapshot helper
  const captureSnapshot = useCallback(
    async (trigger: string, metadata?: Record<string, unknown>) => {
      if (!isDev || !bridge?.renderLog) return;

      await new Promise((resolve) => requestAnimationFrame(resolve));
      await bridge.renderLog.captureSnapshot({ trigger, pathname, ...metadata });
    },
    [isDev, bridge, pathname]
  );

  // Capture on route change
  useEffect(() => {
    if (!isDev || !bridge?.renderLog) return;
    if (lastPathRef.current === fullPath) return;

    const previousPath = lastPathRef.current;
    lastPathRef.current = fullPath;

    if (previousPath === null && enableOnMount) return;

    const timeoutId = setTimeout(() => {
      captureSnapshot('route_change', { previousPath, newPath: fullPath });
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [fullPath, isDev, bridge, captureSnapshot, enableOnMount]);

  // Capture on mount
  useEffect(() => {
    if (!isDev || !bridge?.renderLog || !enableOnMount) return;

    const timeoutId = setTimeout(() => {
      captureSnapshot('mount');
      lastPathRef.current = fullPath;
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [isDev, bridge]);

  // Mutation observer
  useEffect(() => {
    if (!isDev || !bridge?.renderLog || !enableMutationObserver) return;

    const observer = new MutationObserver((mutations) => {
      const significant = mutations.some((m) => {
        if (m.addedNodes.length || m.removedNodes.length) {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node as Element;
              if (!['SCRIPT', 'STYLE', 'SVG'].includes(el.tagName)) return true;
            }
          }
        }
        return false;
      });

      if (significant) {
        if (mutationTimeoutRef.current) clearTimeout(mutationTimeoutRef.current);
        mutationTimeoutRef.current = setTimeout(() => {
          captureSnapshot('mutation');
        }, mutationDebounceMs);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    observerRef.current = observer;

    return () => {
      observer.disconnect();
      if (mutationTimeoutRef.current) clearTimeout(mutationTimeoutRef.current);
    };
  }, [isDev, bridge, enableMutationObserver, mutationDebounceMs, captureSnapshot]);

  return <>{children}</>;
}
```

Update your layout to include it:

```tsx
// app/layout.tsx
import { UIBridgeProvider, AutoRegisterProvider } from 'ui-bridge/react';
import { RenderLogWrapper } from '@/lib/ui-bridge/RenderLogWrapper';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <UIBridgeProvider features={{ renderLog: true, control: true }}>
          <AutoRegisterProvider enabled={process.env.NODE_ENV === 'development'}>
            <RenderLogWrapper>{children}</RenderLogWrapper>
          </AutoRegisterProvider>
        </UIBridgeProvider>
      </body>
    </html>
  );
}
```

## Complete Example

Here's a full example showing all features:

```tsx
// app/layout.tsx
import { UIBridgeProvider, AutoRegisterProvider } from 'ui-bridge/react';
import { RenderLogWrapper } from '@/lib/ui-bridge/RenderLogWrapper';

const UI_BRIDGE_ENABLED =
  process.env.NEXT_PUBLIC_UI_BRIDGE_ENABLED === 'true' || process.env.NODE_ENV === 'development';

export default function RootLayout({ children }) {
  if (!UI_BRIDGE_ENABLED) {
    return (
      <html>
        <body>{children}</body>
      </html>
    );
  }

  return (
    <html>
      <body>
        <UIBridgeProvider
          features={{
            renderLog: true,
            control: true,
            debug: process.env.NODE_ENV === 'development',
          }}
          config={{
            verbose: process.env.NODE_ENV === 'development',
            maxLogEntries: 1000,
          }}
        >
          {/* Auto-register all interactive elements */}
          <AutoRegisterProvider
            enabled={process.env.NODE_ENV === 'development'}
            idStrategy="prefer-existing"
            debounceMs={100}
            excludeSelectors={['[data-no-register]']}
          >
            {/* Capture DOM snapshots on navigation */}
            <RenderLogWrapper
              enableOnMount={true}
              enableMutationObserver={true}
              mutationDebounceMs={500}
            >
              {children}
            </RenderLogWrapper>
          </AutoRegisterProvider>
        </UIBridgeProvider>
      </body>
    </html>
  );
}
```

## Using with Server Components

UI Bridge hooks require client components. For server components, use the "use client" directive:

```tsx
// components/InteractiveButton.tsx
'use client';

import { useUIElement } from 'ui-bridge/react';

export function InteractiveButton({ id, children, onClick }) {
  const { ref } = useUIElement({
    id,
    type: 'button',
    customActions: {
      'custom-click': { handler: onClick },
    },
  });

  return (
    <button ref={ref} onClick={onClick}>
      {children}
    </button>
  );
}
```

## Environment Variables

```bash
# .env.local
NEXT_PUBLIC_UI_BRIDGE_ENABLED=true  # Enable in production if needed
```

## API Endpoints

Once configured, these endpoints are available:

| Endpoint                             | Method | Description                |
| ------------------------------------ | ------ | -------------------------- |
| `/api/ui-bridge/elements`            | GET    | List registered elements   |
| `/api/ui-bridge/elements/:id`        | GET    | Get element details        |
| `/api/ui-bridge/elements/:id/action` | POST   | Execute element action     |
| `/api/ui-bridge/components`          | GET    | List registered components |
| `/api/ui-bridge/discover`            | GET    | Auto-discover elements     |
| `/api/ui-bridge/render-log`          | GET    | Get render log entries     |
| `/api/ui-bridge/snapshot`            | GET    | Get current DOM snapshot   |

## Python Client Usage

```python
from ui_bridge import UIBridgeClient

client = UIBridgeClient("http://localhost:3000")

# List all registered elements
elements = client.get_elements()
for el in elements:
    print(f"{el.id}: {el.type}")

# Click a button
client.click("submit-btn")

# Type in an input
client.type("email-input", "user@example.com")

# Get render log
snapshot = client.get_latest_snapshot()
print(f"Page title: {snapshot.data.page.title}")
```

## Troubleshooting

### Elements Not Being Registered

1. Verify `AutoRegisterProvider` is enabled
2. Check element matches interactive selectors
3. Add `data-testid` or `data-ui-id` attribute
4. Check browser console for registration logs

### Render Log Empty

1. Verify `renderLog: true` in features
2. Check `RenderLogWrapper` is included
3. Verify development mode is active
4. Check API endpoint is accessible

### API 404 Errors

1. Verify API route is created at correct path
2. Check route exports all HTTP methods
3. Verify Next.js is handling the catch-all route

## Next Steps

- [Auto-Registration](../react/auto-registration) - Configuration options
- [Render Logging](../react/render-logging) - Capture configuration
- [API Reference](../api/overview) - Full API documentation
