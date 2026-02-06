---
sidebar_position: 2
---

# Express Integration

Integrate UI Bridge with your existing Express.js server.

## Installation

```bash
npm install ui-bridge-server
```

## Basic Setup

```typescript
import express from 'express';
import { uiBridgeMiddleware } from 'ui-bridge-server/express';

const app = express();

// Add UI Bridge middleware
app.use('/ui-bridge', uiBridgeMiddleware());

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
  console.log('UI Bridge available at http://localhost:3000/ui-bridge');
});
```

## Configuration

```typescript
app.use(
  '/ui-bridge',
  uiBridgeMiddleware({
    // Enable/disable features
    features: {
      control: true,
      renderLog: true,
      debug: process.env.NODE_ENV === 'development',
    },

    // CORS configuration
    cors: {
      origin: ['http://localhost:3000', 'http://localhost:5173'],
      credentials: true,
    },

    // Request logging
    logging: true,
  })
);
```

## With Authentication

```typescript
import { authMiddleware } from './auth';

// Protect all UI Bridge endpoints
app.use('/ui-bridge', authMiddleware, uiBridgeMiddleware());

// Or protect specific endpoints
const bridge = uiBridgeMiddleware();
app.get('/ui-bridge/control/*', authMiddleware, bridge);
app.post('/ui-bridge/control/*', authMiddleware, bridge);
app.get('/ui-bridge/render-log', bridge); // Public
```

## With Existing API

```typescript
import express from 'express';
import { uiBridgeMiddleware } from 'ui-bridge-server/express';

const app = express();

// Your existing API routes
app.use('/api', yourApiRoutes);

// UI Bridge on a separate path
app.use('/ui-bridge', uiBridgeMiddleware());

// Or combine with your API
app.use('/api/ui-bridge', uiBridgeMiddleware());
```

## Registry Connection

The middleware needs access to the UI Bridge registry. Options:

### Option 1: Shared Process (SSR)

If your Express server renders the React app:

```typescript
import { getGlobalRegistry } from 'ui-bridge';
import { uiBridgeMiddleware } from 'ui-bridge-server/express';

app.use(
  '/ui-bridge',
  uiBridgeMiddleware({
    registry: getGlobalRegistry(),
  })
);
```

### Option 2: WebSocket Bridge

For separate frontend/backend:

```typescript
import { uiBridgeMiddleware, createWebSocketBridge } from 'ui-bridge-server/express';

const wss = createWebSocketBridge({ port: 9877 });

app.use(
  '/ui-bridge',
  uiBridgeMiddleware({
    bridge: wss,
  })
);
```

In React:

```tsx
<UIBridgeProvider
  config={{
    websocketUrl: 'ws://localhost:9877',
  }}
>
```

## Error Handling

```typescript
app.use(
  '/ui-bridge',
  uiBridgeMiddleware({
    onError: (error, req, res) => {
      console.error('UI Bridge error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    },
  })
);
```

## TypeScript

Full TypeScript support:

```typescript
import express, { Request, Response } from 'express';
import { uiBridgeMiddleware, UIBridgeMiddlewareOptions } from 'ui-bridge-server/express';

const options: UIBridgeMiddlewareOptions = {
  features: {
    control: true,
    renderLog: true,
  },
};

app.use('/ui-bridge', uiBridgeMiddleware(options));
```

## Complete Example

```typescript
import express from 'express';
import cors from 'cors';
import { uiBridgeMiddleware } from 'ui-bridge-server/express';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Your routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// UI Bridge
app.use(
  '/ui-bridge',
  uiBridgeMiddleware({
    features: {
      control: true,
      renderLog: true,
      debug: process.env.NODE_ENV === 'development',
    },
    logging: true,
  })
);

// Error handling
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`UI Bridge: http://localhost:${PORT}/ui-bridge`);
});
```
