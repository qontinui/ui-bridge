---
sidebar_position: 1
---

# Web / Next.js Guide

Complete guide for integrating UI Bridge with Next.js and other web applications, including auto-registration and render logging.

## Installation

```bash
npm install @qontinui/ui-bridge
```

> **Note:** The server adapter is bundled in `@qontinui/ui-bridge` — no separate server package needed.

## Basic Setup

### 1. Add the Provider

```tsx
// app/layout.tsx (App Router)
import { UIBridgeProvider, AutoRegisterProvider } from '@qontinui/ui-bridge/react';

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
import { createUIBridgeHandler } from '@qontinui/ui-bridge/server';

const handler = createUIBridgeHandler();

export const GET = handler;
export const POST = handler;
export const DELETE = handler;

export const dynamic = 'force-dynamic';
```

### 3. Add Render Logging (Optional but Recommended)

Create a wrapper component that captures DOM snapshots on navigation:

```tsx
// lib/ui-bridge/RenderLogWrapper.tsx
'use client';

import { useEffect, useRef, useCallback, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useUIBridgeOptional } from '@qontinui/ui-bridge/react';

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
import { UIBridgeProvider, AutoRegisterProvider } from '@qontinui/ui-bridge/react';
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
import { UIBridgeProvider, AutoRegisterProvider } from '@qontinui/ui-bridge/react';
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

## Enabled Features

When `UIBridgeProvider` is configured with all features, the following capabilities are active:

| Feature                   | Description                                                                       |
| ------------------------- | --------------------------------------------------------------------------------- |
| **Auto-Registration**     | Discovers and registers interactive elements automatically                        |
| **Render Logging**        | Captures DOM snapshots on navigation and mutations                                |
| **Control API**           | HTTP endpoints for element interaction and snapshots                              |
| **Debug Tools**           | Inspector overlay, performance metrics, browser event capture                     |
| **Idle Detection**        | Detects when the app has settled after actions (network, DOM, loading indicators) |
| **Browser Event Capture** | Captures console errors, network failures, long tasks, HMR errors                 |
| **Modal Detection**       | Tracks modal/dialog stack with z-index ordering                                   |
| **Toast Capture**         | Captures toast/notification messages (aria-live, role=status)                     |
| **Navigation Tracking**   | Tracks page/route changes via History API                                         |
| **Keyboard Shortcuts**    | Discovers keyboard shortcuts from ARIA, accesskey, data attributes                |
| **Drag-Drop Detection**   | Discovers drag sources and drop zones                                             |
| **Undo/Redo Awareness**   | Detects undo/redo availability                                                    |
| **Relationship Tracking** | Tracks element relationships (parent/child, controls, label-for)                  |

## Using with Server Components

UI Bridge hooks require client components. For server components, use the "use client" directive:

```tsx
// components/InteractiveButton.tsx
'use client';

import { useUIElement } from '@qontinui/ui-bridge/react';

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

## Optional Enhancements

### Form Library Adapters

Register adapters for accurate form state extraction:

```tsx
import {
  createAdapterRegistry,
  ReactHookFormAdapter,
  FormikAdapter,
} from '@qontinui/ui-bridge';

const registry = createAdapterRegistry();
registry.register(new ReactHookFormAdapter());
registry.register(new FormikAdapter());
```

### Element Relationships

Declare semantic relationships for richer AI context:

```tsx
import { useUIRelationship } from '@qontinui/ui-bridge/react';

// Declare that a filter controls a data table
useUIRelationship('filter-panel', [{ relatedElementId: 'data-table', type: 'controls' }]);
```

### Component Registration

Register higher-level components with custom actions:

```tsx
import { useUIComponent } from '@qontinui/ui-bridge/react';

const { context, performAction } = useUIComponent({
  id: 'user-table',
  name: 'User Table',
  actions: [
    { id: 'sort', label: 'Sort', handler: (params) => handleSort(params.column) },
    { id: 'filter', label: 'Filter', handler: (params) => handleFilter(params.query) },
  ],
});
```

### Page Context

Provide route metadata for navigation-aware AI:

```tsx
import { usePageContext } from '@qontinui/ui-bridge/react';

usePageContext({
  route: '/users/:id',
  name: 'User Detail',
  section: 'admin',
});
```

## Environment Variables

```bash
# .env.local
NEXT_PUBLIC_UI_BRIDGE_ENABLED=true  # Enable in production if needed
```

## API Endpoints

Once configured, these endpoints are available:

| Endpoint                                    | Method | Description                                       |
| ------------------------------------------- | ------ | ------------------------------------------------- |
| `/api/ui-bridge/control/snapshot`           | GET    | Full page snapshot (elements, components, states) |
| `/api/ui-bridge/control/elements`           | GET    | List registered elements                          |
| `/api/ui-bridge/control/element/:id`        | GET    | Get element details                               |
| `/api/ui-bridge/control/element/:id/action` | POST   | Execute element action                            |
| `/api/ui-bridge/control/components`         | GET    | List registered components                        |
| `/api/ui-bridge/control/find`               | POST   | Find elements by criteria                         |
| `/api/ui-bridge/control/idle-status`        | GET    | Get composite idle status                         |
| `/api/ui-bridge/control/wait-for-idle`      | POST   | Wait for app to settle                            |
| `/api/ui-bridge/ai/search`                  | POST   | Natural language element search                   |
| `/api/ui-bridge/ai/execute`                 | POST   | Execute natural language instruction              |
| `/api/ui-bridge/ai/assert`                  | POST   | Run assertion on UI state                         |
| `/api/ui-bridge/ai/snapshot`                | GET    | Get semantic page snapshot                        |
| `/api/ui-bridge/ai/forms`                   | GET    | Get form state                                    |
| `/api/ui-bridge/render-log`                 | GET    | Get render log entries                            |
| `/api/ui-bridge/debug/metrics`              | GET    | Get performance metrics                           |
| `/api/ui-bridge/debug/action-history`       | GET    | Get action execution history                      |

## Troubleshooting

### Elements Not Being Registered

1. Verify `AutoRegisterProvider` is enabled
2. Check element matches interactive selectors
3. Add `data-testid` attribute for explicit identification
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
