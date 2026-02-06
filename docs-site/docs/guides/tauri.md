---
sidebar_position: 2
---

# Tauri Desktop Guide

Complete guide for integrating UI Bridge with Tauri desktop applications, including auto-registration and render logging with file-based storage.

## Overview

Tauri apps have unique requirements:

- **IPC Bridge**: Communication between React frontend and Rust backend
- **File Storage**: Render logs can be persisted to the filesystem
- **Desktop Context**: Access to system features and local files

## Installation

```bash
npm install ui-bridge
```

Note: `ui-bridge-server` is typically not needed for Tauri apps since communication happens via Tauri's IPC system rather than HTTP.

## Basic Setup

### 1. Add the Provider

```tsx
// App.tsx
import { UIBridgeProvider, AutoRegisterProvider } from 'ui-bridge';

export default function App() {
  return (
    <UIBridgeProvider
      features={{
        renderLog: true,
        control: true,
        debug: import.meta.env.DEV,
      }}
    >
      <AutoRegisterProvider enabled={import.meta.env.DEV}>
        <YourApp />
      </AutoRegisterProvider>
    </UIBridgeProvider>
  );
}
```

### 2. Add Render Logging with Tauri Storage

Create a custom storage backend that persists to files via Tauri:

```tsx
// lib/ui-bridge/TauriRenderLogStorage.ts
import { invoke } from '@tauri-apps/api/core';
import type { RenderLogStorage, RenderLogEntry } from 'ui-bridge';

export class TauriRenderLogStorage implements RenderLogStorage {
  private maxEntries: number;
  private taskRunId?: number;

  constructor(options: { maxEntries?: number; taskRunId?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
    this.taskRunId = options.taskRunId;
  }

  setTaskRunId(id: number) {
    this.taskRunId = id;
  }

  async append(entry: RenderLogEntry): Promise<void> {
    try {
      await invoke('append_render_log', {
        entry: {
          ...entry,
          task_run_id: this.taskRunId,
        },
      });
    } catch (error) {
      console.debug('[TauriRenderLogStorage] Failed to append:', error);
    }
  }

  async getEntries(options?: {
    type?: string;
    since?: number;
    until?: number;
    limit?: number;
  }): Promise<RenderLogEntry[]> {
    try {
      return await invoke('load_render_log', options);
    } catch (error) {
      console.debug('[TauriRenderLogStorage] Failed to load:', error);
      return [];
    }
  }

  async clear(): Promise<void> {
    try {
      await invoke('clear_render_log');
    } catch (error) {
      console.debug('[TauriRenderLogStorage] Failed to clear:', error);
    }
  }

  async count(): Promise<number> {
    const entries = await this.getEntries();
    return entries.length;
  }
}
```

### 3. Create the Render Log Manager Hook

```tsx
// lib/ui-bridge/useRenderLogManager.ts
import { useEffect, useRef, useCallback } from 'react';
import { RenderLogManager } from 'ui-bridge';
import { TauriRenderLogStorage } from './TauriRenderLogStorage';

export interface UseRenderLogManagerOptions {
  enabled?: boolean;
  activeTab?: string;
  taskRunId?: number;
  captureOnNavigation?: boolean;
  captureChanges?: boolean;
  maxEntries?: number;
}

export function useRenderLogManager(options: UseRenderLogManagerOptions = {}) {
  const {
    enabled = true,
    activeTab,
    taskRunId,
    captureOnNavigation = true,
    captureChanges = true,
    maxEntries = 1000,
  } = options;

  const isDev = import.meta.env.DEV;
  const isEnabled = enabled && isDev;

  const storageRef = useRef<TauriRenderLogStorage | null>(null);
  const managerRef = useRef<RenderLogManager | null>(null);
  const lastTabRef = useRef<string | undefined>(undefined);

  // Initialize
  useEffect(() => {
    if (!isEnabled) return;

    storageRef.current = new TauriRenderLogStorage({ maxEntries, taskRunId });
    managerRef.current = new RenderLogManager({
      storage: storageRef.current,
      captureOnNavigation,
      captureChanges,
      maxEntries,
    });

    managerRef.current.start();

    return () => {
      managerRef.current?.stop();
      managerRef.current = null;
      storageRef.current = null;
    };
  }, [isEnabled, captureOnNavigation, captureChanges, maxEntries]);

  // Update task run ID
  useEffect(() => {
    if (storageRef.current && taskRunId !== undefined) {
      storageRef.current.setTaskRunId(taskRunId);
    }
  }, [taskRunId]);

  // Capture on tab change
  useEffect(() => {
    if (!isEnabled || !managerRef.current) return;
    if (lastTabRef.current === activeTab) return;

    const previousTab = lastTabRef.current;
    lastTabRef.current = activeTab;

    if (previousTab === undefined) return;

    setTimeout(() => {
      managerRef.current?.captureSnapshot({
        trigger: 'tab_change',
        previousTab,
        newTab: activeTab,
      });
    }, 100);
  }, [isEnabled, activeTab]);

  const captureSnapshot = useCallback(
    async (trigger = 'manual') => {
      if (!managerRef.current) return;
      await managerRef.current.captureSnapshot({ trigger, activeTab, taskRunId });
    },
    [activeTab, taskRunId]
  );

  return { captureSnapshot, isRunning: !!managerRef.current };
}
```

### 4. Create the Render Log Wrapper

```tsx
// lib/ui-bridge/RenderLogWrapper.tsx
import type { ReactNode } from 'react';
import { useRenderLogManager } from './useRenderLogManager';

export interface RenderLogWrapperProps {
  children: ReactNode;
  activeTab: string;
  taskRunId?: number;
  enableOnMount?: boolean;
  enableMutationObserver?: boolean;
}

export function RenderLogWrapper({
  children,
  activeTab,
  taskRunId,
  enableOnMount = true,
  enableMutationObserver = true,
}: RenderLogWrapperProps) {
  useRenderLogManager({
    enabled: enableOnMount,
    activeTab,
    taskRunId,
    captureOnNavigation: true,
    captureChanges: enableMutationObserver,
  });

  return <>{children}</>;
}
```

### 5. Add Rust Commands (Backend)

Add these commands to your Tauri backend:

```rust
// src-tauri/src/commands/logging.rs

use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct RenderLogEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub timestamp: i64,
    pub data: serde_json::Value,
    pub metadata: Option<serde_json::Value>,
    pub task_run_id: Option<i64>,
}

fn get_render_log_path() -> PathBuf {
    // Store in .dev-logs directory
    let path = PathBuf::from(".dev-logs/render.log");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    path
}

#[tauri::command]
pub async fn append_render_log(entry: RenderLogEntry) -> Result<(), String> {
    let path = get_render_log_path();
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;

    let json = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
    writeln!(file, "{}", json).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn load_render_log(
    limit: Option<usize>,
) -> Result<Vec<RenderLogEntry>, String> {
    let path = get_render_log_path();

    if !path.exists() {
        return Ok(vec![]);
    }

    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);

    let entries: Vec<RenderLogEntry> = reader
        .lines()
        .filter_map(|line| line.ok())
        .filter_map(|line| serde_json::from_str(&line).ok())
        .collect();

    match limit {
        Some(n) => Ok(entries.into_iter().rev().take(n).rev().collect()),
        None => Ok(entries),
    }
}

#[tauri::command]
pub async fn clear_render_log() -> Result<(), String> {
    let path = get_render_log_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

Register the commands in your Tauri app:

```rust
// src-tauri/src/main.rs
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::logging::append_render_log,
            commands::logging::load_render_log,
            commands::logging::clear_render_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## Complete Example

```tsx
// App.tsx
import { useState } from 'react';
import { UIBridgeProvider, AutoRegisterProvider } from 'ui-bridge';
import { RenderLogWrapper } from './lib/ui-bridge';

export default function App() {
  const [activeTab, setActiveTab] = useState('home');
  const [taskRunId, setTaskRunId] = useState<number | undefined>();

  return (
    <UIBridgeProvider
      features={{
        renderLog: true,
        control: true,
        debug: import.meta.env.DEV,
      }}
    >
      {/* Auto-register all interactive elements */}
      <AutoRegisterProvider
        enabled={import.meta.env.DEV}
        idStrategy="prefer-existing"
        debounceMs={100}
        excludeSelectors={['[data-no-register]']}
      >
        {/* Capture DOM snapshots on tab changes */}
        <RenderLogWrapper
          activeTab={activeTab}
          taskRunId={taskRunId}
          enableOnMount={true}
          enableMutationObserver={true}
        >
          <div className="app">
            <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
            <MainContent tab={activeTab} />
          </div>
        </RenderLogWrapper>
      </AutoRegisterProvider>
    </UIBridgeProvider>
  );
}
```

## IPC-Based UI Bridge (Alternative)

For Tauri apps, you can expose UI Bridge via IPC instead of HTTP:

```tsx
// hooks/useUIBridgeEventHandler.ts
import { useEffect } from 'react';
import { listen, emit } from '@tauri-apps/api/event';
import { useUIBridge } from 'ui-bridge/react';

export function UIBridgeEventHandler() {
  const bridge = useUIBridge();

  useEffect(() => {
    const unlisten = listen('ui-bridge-request', async (event) => {
      const { requestId, method, params } = event.payload as any;

      let result;
      try {
        switch (method) {
          case 'get_elements':
            result = bridge.getElements();
            break;
          case 'click':
            await bridge.executor.click(params.id);
            result = { success: true };
            break;
          case 'get_snapshot':
            result = await bridge.renderLog?.getLatestSnapshot();
            break;
          // ... other methods
        }
        emit('ui-bridge-response', { requestId, result });
      } catch (error) {
        emit('ui-bridge-response', { requestId, error: String(error) });
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [bridge]);

  return null;
}
```

## Log File Location

Render logs are stored in `.dev-logs/render.log` (JSONL format):

```json
{"id":"1705123456-abc123","type":"snapshot","timestamp":1705123456789,"data":{...}}
{"id":"1705123457-def456","type":"snapshot","timestamp":1705123457123,"data":{...}}
```

## Reading Logs from Rust

```rust
// Read logs programmatically
let entries = load_render_log(Some(10)).await?;
for entry in entries {
    println!("Entry: {} at {}", entry.id, entry.timestamp);
}
```

## Integration with External Tools

You can read the render log from external tools:

```python
# Python script to read Tauri render logs
import json

with open('.dev-logs/render.log', 'r') as f:
    for line in f:
        entry = json.loads(line)
        print(f"{entry['timestamp']}: {entry['type']}")
```

```bash
# Tail the log file
tail -f .dev-logs/render.log | jq '.'
```

## Troubleshooting

### Logs Not Being Written

1. Verify `.dev-logs/` directory exists
2. Check Rust command is registered
3. Verify IPC invoke is working
4. Check browser console for errors

### Tab Changes Not Captured

1. Verify `activeTab` prop is changing
2. Check `RenderLogWrapper` receives the prop
3. Verify tab change triggers component update

### Auto-Registration Not Working

1. Verify `AutoRegisterProvider` is enabled
2. Check `import.meta.env.DEV` is true
3. Add `data-testid` to elements for explicit registration

## Next Steps

- [Auto-Registration](../react/auto-registration) - Configuration options
- [Render Logging](../react/render-logging) - Capture configuration
- [IPC Integration](../server/standalone) - Custom server setup
