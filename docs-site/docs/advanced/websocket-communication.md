# WebSocket Communication

UI Bridge supports WebSocket communication for real-time, bidirectional interaction with the UI.

## Enabling WebSocket

### Server-Side

```typescript
import { createUIBridgeServer } from '@anthropic/ui-bridge-server';

const server = createUIBridgeServer({
  transport: 'websocket',
  port: 9876,
  path: '/ws',
});

server.start();
```

### Client-Side

```typescript
import { UIBridgeClient } from '@anthropic/ui-bridge';

const client = new UIBridgeClient({
  transport: 'websocket',
  url: 'ws://localhost:9876/ws',
});

await client.connect();
```

## Usage

### Execute Actions

```typescript
const result = await client.execute('submit-btn', 'click');
```

### Subscribe to Events

```typescript
client.on('stateChange', (event) => {
  console.log(`State: ${event.from} -> ${event.to}`);
});

client.on('elementAdded', (event) => {
  console.log(`New element: ${event.elementId}`);
});
```

## Connection Management

### Auto-Reconnection

```typescript
const client = new UIBridgeClient({
  transport: 'websocket',
  url: 'ws://localhost:9876/ws',
  reconnect: {
    enabled: true,
    maxAttempts: 10,
    delay: 1000,
    backoff: 'exponential',
  },
});
```

### HTTP Fallback

```typescript
const client = new UIBridgeClient({
  transport: 'websocket',
  url: 'ws://localhost:9876/ws',
  fallback: {
    enabled: true,
    transport: 'http',
    url: 'http://localhost:9876/api',
    pollInterval: 500,
  },
});
```

## Authentication

```typescript
const client = new UIBridgeClient({
  transport: 'websocket',
  url: 'ws://localhost:9876/ws',
  auth: { type: 'token', token: 'your-auth-token' },
});
```
