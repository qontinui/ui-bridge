---
sidebar_position: 5
---

# Render Logging

Render logging captures DOM snapshots and UI state changes automatically. This enables AI agents and test frameworks to verify what's displayed without parsing HTML or using visual screenshots.

## Overview

Render logging provides:

- **DOM Snapshots**: Structured capture of page content (headings, buttons, forms, etc.)
- **Route Change Detection**: Automatic capture on navigation
- **Mutation Tracking**: Capture when significant UI changes occur
- **Structured Data**: JSON output for easy parsing and verification

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                   RenderLogManager                      │
├─────────────────────────────────────────────────────────┤
│  Capture Triggers:                                      │
│  • On mount (initial render)                           │
│  • On route/navigation change                          │
│  • On significant DOM mutations (debounced)            │
│  • Manual trigger via API                              │
│                                                         │
│  Captured Data:                                         │
│  • Page info (title, URL, viewport)                    │
│  • Text content (headings, buttons, labels)            │
│  • Form state (inputs, values, validation)             │
│  • Interactive elements (with visibility/bounds)       │
│  • Error messages and loading indicators               │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

### Web / Next.js

```tsx
// lib/ui-bridge/RenderLogWrapper.tsx
"use client";

import { useEffect, useRef, useCallback, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useUIBridgeOptional } from "ui-bridge/react";

export function RenderLogWrapper({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const bridge = useUIBridgeOptional();
  const lastPathRef = useRef<string | null>(null);

  // Capture on route change
  useEffect(() => {
    if (!bridge?.renderLog || lastPathRef.current === pathname) return;
    lastPathRef.current = pathname;

    setTimeout(() => {
      bridge.renderLog.captureSnapshot({ trigger: 'route_change', pathname });
    }, 100);
  }, [pathname, bridge]);

  return <>{children}</>;
}
```

```tsx
// app/layout.tsx
import { UIBridgeProvider } from 'ui-bridge/react';
import { RenderLogWrapper } from '@/lib/ui-bridge/RenderLogWrapper';

export default function RootLayout({ children }) {
  return (
    <UIBridgeProvider features={{ renderLog: true }}>
      <RenderLogWrapper>
        {children}
      </RenderLogWrapper>
    </UIBridgeProvider>
  );
}
```

### Tauri Desktop

The Tauri implementation uses a custom storage backend that persists logs to the filesystem.

```tsx
// lib/ui-bridge/RenderLogWrapper.tsx
import { useRenderLogManager } from './useRenderLogManager';

export function RenderLogWrapper({
  children,
  activeTab,
  taskRunId,
}: {
  children: ReactNode;
  activeTab: string;
  taskRunId?: number;
}) {
  useRenderLogManager({
    enabled: import.meta.env.DEV,
    activeTab,
    taskRunId,
    captureOnNavigation: true,
    captureChanges: true,
  });

  return <>{children}</>;
}
```

```tsx
// App.tsx
import { UIBridgeProvider } from 'ui-bridge';
import { RenderLogWrapper } from './lib/ui-bridge';

function App() {
  const [activeTab, setActiveTab] = useState('home');

  return (
    <UIBridgeProvider features={{ renderLog: true }}>
      <RenderLogWrapper activeTab={activeTab}>
        <YourApp />
      </RenderLogWrapper>
    </UIBridgeProvider>
  );
}
```

### React Native / Expo

React Native doesn't have a DOM, so render logging captures screen changes and component state instead.

```tsx
// lib/render-log/RenderLogProvider.tsx
import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'expo-router';

const RenderLogContext = createContext(null);

export function RenderLogProvider({ children }) {
  const pathname = usePathname();
  const [logs, setLogs] = useState([]);

  // Capture screen changes
  useEffect(() => {
    setLogs(prev => [...prev, {
      type: 'screen_change',
      timestamp: Date.now(),
      screen: pathname,
    }]);
  }, [pathname]);

  return (
    <RenderLogContext.Provider value={{ logs, logRender }}>
      {children}
    </RenderLogContext.Provider>
  );
}
```

```tsx
// app/_layout.tsx
import { RenderLogProvider } from '@/lib/render-log';

export default function RootLayout() {
  return (
    <RenderLogProvider>
      <AppContent />
    </RenderLogProvider>
  );
}
```

## Captured Data

### DOM Snapshot Structure

```typescript
interface DOMSnapshot {
  id: string;
  timestamp: number;
  captureType: 'mount' | 'route_change' | 'mutation' | 'manual';

  page: {
    title: string;
    url: string;
    viewport: { width: number; height: number };
    scroll: { x: number; y: number };
  };

  textContent: {
    headings: Array<{ level: number; text: string }>;
    buttons: string[];
    links: Array<{ text: string; href: string }>;
    labels: string[];
    paragraphs: string[];
    listItems: string[];
  };

  forms: Array<{
    id?: string;
    action?: string;
    inputs: Array<{
      name?: string;
      type: string;
      value?: string;
      placeholder?: string;
      required: boolean;
      disabled: boolean;
    }>;
  }>;

  images: Array<{
    src: string;
    alt?: string;
    width: number;
    height: number;
  }>;

  elements: Array<{
    id?: string;
    tag: string;
    testId?: string;
    selector: string;
    text?: string;
    visible: boolean;
    rect: { x: number; y: number; width: number; height: number };
  }>;

  stats: {
    elementCount: number;
    interactiveCount: number;
    captureTimeMs: number;
  };
}
```

### React Native Render Log Entry

```typescript
interface RenderLogEntry {
  id: string;
  type: 'screen_change' | 'component_render' | 'interaction' | 'state_change';
  timestamp: number;
  source: string;
  trigger: string;
  data: Record<string, unknown>;
}
```

## Configuration

### RenderLogManager Options

```typescript
interface RenderLogOptions {
  // Storage backend (in-memory, file, or custom)
  storage?: RenderLogStorage;

  // Capture on navigation changes
  captureOnNavigation?: boolean;

  // Capture DOM mutations
  captureChanges?: boolean;

  // Periodic snapshot interval (ms)
  snapshotInterval?: number;

  // Capture options
  captureOptions?: {
    interactiveOnly?: boolean;
    includeHidden?: boolean;
    maxTextLength?: number;
    maxElements?: number;
  };

  // Maximum log entries to keep
  maxEntries?: number;

  // Callback on new entry
  onEntry?: (entry: RenderLogEntry) => void;
}
```

### Tauri-Specific Options

```typescript
interface UseRenderLogManagerOptions {
  enabled?: boolean;
  activeTab?: string;
  taskRunId?: number;
  captureOnNavigation?: boolean;
  captureChanges?: boolean;
  changeDebounceMs?: number;
  interactiveOnly?: boolean;
  includeHidden?: boolean;
  maxEntries?: number;
}
```

## Capture Triggers

### Automatic Triggers

| Trigger | When | Default |
|---------|------|---------|
| `mount` | Initial render | ✅ Enabled |
| `route_change` | URL/route changes | ✅ Enabled |
| `mutation` | Significant DOM changes | ✅ Enabled |
| `interval` | Periodic snapshots | ❌ Disabled |

### Manual Capture

```tsx
const { renderLog } = useUIBridge();

// Full DOM snapshot
await renderLog.captureSnapshot({ trigger: 'manual' });

// Quick summary (lighter weight)
await renderLog.captureQuick('user_action');
```

## Mutation Detection

Not all DOM changes trigger a capture. The system filters for "significant" mutations:

**Captured:**
- Element nodes added/removed
- Data attributes changed (`data-*`)
- State attributes changed (`aria-expanded`, `data-state`)

**Ignored:**
- Text node changes only
- Animation classes (`animate-*`, `transition-*`)
- Script/style elements
- Elements marked with `data-no-capture`

### Excluding Elements from Mutation Tracking

```html
<div data-no-capture>
  <!-- Changes here won't trigger captures -->
  <span class="constantly-updating">...</span>
</div>
```

## Storage Backends

### In-Memory (Default)

```typescript
const storage = new InMemoryRenderLogStorage(1000); // max 1000 entries
```

### File-Based (Tauri)

```typescript
// TauriRenderLogStorage writes to .dev-logs/render.log
const storage = new TauriRenderLogStorage({
  maxEntries: 1000,
  taskRunId: 123,
});
```

### Custom Storage

```typescript
class CustomStorage implements RenderLogStorage {
  async append(entry: RenderLogEntry): Promise<void> {
    // Send to analytics, database, etc.
  }

  async getEntries(options?: GetEntriesOptions): Promise<RenderLogEntry[]> {
    // Retrieve entries
  }

  async clear(): Promise<void> {
    // Clear storage
  }

  async count(): Promise<number> {
    // Return entry count
  }
}
```

## Accessing Logs

### Via HTTP API

```bash
# Get all entries
GET /ui-bridge/render-log

# Get recent entries
GET /ui-bridge/render-log?limit=10

# Get entries by type
GET /ui-bridge/render-log?type=snapshot

# Clear logs
DELETE /ui-bridge/render-log
```

### Via Python Client

```python
from ui_bridge import UIBridgeClient

client = UIBridgeClient("http://localhost:3000")

# Get all entries
entries = client.get_render_log()

# Get latest snapshot
snapshot = client.get_latest_snapshot()

# Clear logs
client.clear_render_log()
```

### Via React Hook

```tsx
const { renderLog } = useUIBridge();

// Get entries
const entries = await renderLog.getEntries({ limit: 10 });

// Get latest snapshot
const snapshot = await renderLog.getLatestSnapshot();

// Clear
await renderLog.clear();
```

## Use Cases

### AI Agent Verification

```python
# AI agent verifies form was filled correctly
snapshot = client.get_latest_snapshot()

for form in snapshot.data.forms:
    email_input = next(i for i in form.inputs if i.name == 'email')
    assert email_input.value == 'user@example.com'
```

### Test Automation

```python
# Verify page content after navigation
client.click('nav-about')
time.sleep(0.5)

snapshot = client.get_latest_snapshot()
headings = [h.text for h in snapshot.data.textContent.headings]
assert 'About Us' in headings
```

### Debugging

```python
# Get all captures during a session
entries = client.get_render_log()

for entry in entries:
    print(f"{entry.timestamp}: {entry.type} - {entry.trigger}")
    if entry.type == 'error':
        print(f"  Error: {entry.data.message}")
```

## Performance Tips

1. **Enable only in development**: Render logging adds overhead
   ```tsx
   <UIBridgeProvider features={{ renderLog: process.env.NODE_ENV === 'development' }}>
   ```

2. **Use debouncing**: Mutation captures are debounced by default (500ms)

3. **Limit element count**: Configure `maxElements` to cap captured elements
   ```typescript
   captureOptions: { maxElements: 500 }
   ```

4. **Use quick captures**: For frequent updates, use `captureQuick()` instead of full snapshots

5. **Exclude noisy elements**: Mark constantly-updating elements with `data-no-capture`

## Platform Comparison

| Feature | Web/Next.js | Tauri | React Native |
|---------|-------------|-------|--------------|
| DOM Snapshots | ✅ Full | ✅ Full | ❌ N/A |
| Route Detection | ✅ usePathname | ✅ activeTab prop | ✅ usePathname |
| Mutation Observer | ✅ Yes | ✅ Yes | ❌ N/A |
| File Storage | ❌ API only | ✅ .dev-logs/ | ❌ In-memory |
| Component Logging | ✅ Optional | ✅ Optional | ✅ Primary |

## Next Steps

- [Auto-Registration](./auto-registration) - Automatic element registration
- [API Reference](../api/render-log-endpoints) - HTTP API details
- [Platform Guides](../guides/web) - Platform-specific setup
