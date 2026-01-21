---
sidebar_position: 3
---

# Tauri Example App

A Tauri desktop application demonstrating UI Bridge integration.

## Overview

This example shows how to:
- Integrate UI Bridge with a Tauri app
- Bridge the UI Bridge server to Rust backend
- Control the desktop app from Python

## Source Code

The full example is available at: [examples/tauri-app](https://github.com/qontinui/ui-bridge/tree/main/examples/tauri-app)

## Quick Start

```bash
# Clone the repository
git clone https://github.com/qontinui/ui-bridge.git
cd ui-bridge/examples/tauri-app

# Install dependencies
npm install

# Start in development mode
npm run tauri dev
```

## Project Structure

```
examples/tauri-app/
├── src/                    # React frontend
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/              # Rust backend
│   ├── src/
│   │   └── main.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
└── vite.config.ts
```

## Key Code

### Frontend Setup

```tsx title="src/main.tsx"
import React from 'react';
import ReactDOM from 'react-dom/client';
import { UIBridgeProvider } from 'ui-bridge';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UIBridgeProvider
      features={{
        control: true,
        renderLog: true,
        debug: true,
      }}
      config={{
        serverPort: 9876,
      }}
    >
      <App />
    </UIBridgeProvider>
  </React.StrictMode>
);
```

### Rust Server Integration

```rust title="src-tauri/src/main.rs"
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Start UI Bridge server
            let handle = app.handle();
            std::thread::spawn(move || {
                start_ui_bridge_server(handle);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn start_ui_bridge_server(_handle: tauri::AppHandle) {
    // UI Bridge server runs on the frontend via JavaScript
    // This function can be used to add Rust-side integrations
}
```

### Frontend Component

```tsx title="src/App.tsx"
import { useState } from 'react';
import { useUIElement, useUIComponent } from 'ui-bridge';
import { invoke } from '@tauri-apps/api/tauri';

function App() {
  const [filePath, setFilePath] = useState('');
  const [content, setContent] = useState('');

  const fileInput = useUIElement({ id: 'file-path', type: 'input' });
  const loadButton = useUIElement({ id: 'load-file', type: 'button' });
  const saveButton = useUIElement({ id: 'save-file', type: 'button' });

  useUIComponent({
    id: 'file-editor',
    name: 'File Editor',
    actions: [
      {
        id: 'load',
        handler: async (params) => {
          const { path } = params as { path: string };
          const result = await invoke('read_file', { path });
          setContent(result as string);
          return { success: true, content: result };
        },
      },
      {
        id: 'save',
        handler: async (params) => {
          const { path, content } = params as { path: string; content: string };
          await invoke('write_file', { path, content });
          return { success: true };
        },
      },
    ],
  });

  const handleLoad = async () => {
    const result = await invoke('read_file', { path: filePath });
    setContent(result as string);
  };

  const handleSave = async () => {
    await invoke('write_file', { path: filePath, content });
  };

  return (
    <div>
      <div>
        <input
          ref={fileInput.ref}
          data-ui-id="file-path"
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          placeholder="File path"
        />
        <button ref={loadButton.ref} data-ui-id="load-file" onClick={handleLoad}>
          Load
        </button>
        <button ref={saveButton.ref} data-ui-id="save-file" onClick={handleSave}>
          Save
        </button>
      </div>
      <textarea
        data-ui-id="file-content"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
    </div>
  );
}
```

## Controlling from Python

```python
from ui_bridge import UIBridgeClient

# Connect to the Tauri app's UI Bridge server
client = UIBridgeClient('http://localhost:9876')

# Open a file
client.type('file-path', '/path/to/file.txt')
client.click('load-file')

# Or use component actions
result = client.component('file-editor').action('load', {
    'path': '/path/to/file.txt'
})
print(f"File content: {result.result['content']}")

# Modify and save
client.type('file-content', 'New content here')
client.component('file-editor').action('save', {
    'path': '/path/to/file.txt',
    'content': 'New content here'
})
```

## Building for Production

```bash
# Build the Tauri app
npm run tauri build
```

The built application includes the UI Bridge server embedded.

## Security Considerations

For desktop apps:

1. **Localhost Binding**: UI Bridge binds to localhost only
2. **No External Access**: Server is not exposed to the network
3. **Tauri Security**: Leverage Tauri's security features

```typescript
startUIBridgeServer({
  port: 9876,
  host: '127.0.0.1', // Only local access
});
```
