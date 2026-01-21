# UI Bridge Tauri Example

This example demonstrates how to integrate UI Bridge with a Tauri desktop application.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (latest stable)
- [Tauri CLI](https://tauri.app/v1/guides/getting-started/prerequisites)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Run in development mode:

```bash
npm run tauri dev
```

## Architecture

This example shows a complete Tauri + UI Bridge integration:

### Frontend (React + UI Bridge)

- `src/main.tsx` - Entry point with `UIBridgeProvider`
- `src/App.tsx` - React components using `useUIElement` and `useUIComponent` hooks

### Backend (Rust + Axum)

- `src-tauri/src/main.rs` - Tauri app with embedded Axum HTTP server
- UI Bridge HTTP endpoints on port 9876

## How It Works

1. The Rust backend starts an HTTP server on port 9876
2. React components register elements via Tauri IPC
3. External clients (Python, etc.) can control the UI via HTTP

## Python Control Example

```python
from ui_bridge import UIBridgeClient

client = UIBridgeClient(base_url='http://localhost:9876')

# Control counter
client.click('counter-increment')
client.component('counter').action('setCount', {'value': 42})

# Control file manager
client.component('file-manager').action('openFile', {
    'path': '/path/to/file.txt'
})
```

## Available Endpoints

- `GET /health` - Health check
- `GET /control/elements` - List all registered elements
- `GET /control/element/:id` - Get element by ID
- `POST /control/element/:id/action` - Execute action on element

## Building for Production

```bash
npm run tauri build
```

This creates platform-specific installers in `src-tauri/target/release/bundle/`.
