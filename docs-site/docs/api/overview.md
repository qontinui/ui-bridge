---
sidebar_position: 1
---

# API Overview

UI Bridge exposes a REST API for programmatic UI control.

## Base URL

The API is available at:

```
http://localhost:9876/ui-bridge
```

Or your configured `apiPath` (e.g., `/api/ui-bridge` for Next.js).

## Response Format

All responses follow this format:

```json
{
  "success": true,
  "data": { ... },
  "timestamp": 1234567890
}
```

Error responses:

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "timestamp": 1234567890
}
```

## Error Codes

| Code              | Description                   |
| ----------------- | ----------------------------- |
| `NOT_FOUND`       | Element or resource not found |
| `INVALID_REQUEST` | Invalid request parameters    |
| `ACTION_FAILED`   | Action execution failed       |
| `TIMEOUT`         | Operation timed out           |
| `INTERNAL_ERROR`  | Server error                  |

## Endpoints Summary

### Control API

| Method | Endpoint                              | Description              |
| ------ | ------------------------------------- | ------------------------ |
| GET    | `/control/elements`                   | List registered elements |
| GET    | `/control/element/:id`                | Get element details      |
| GET    | `/control/element/:id/state`          | Get element state        |
| POST   | `/control/element/:id/action`         | Execute action           |
| GET    | `/control/components`                 | List components          |
| GET    | `/control/component/:id`              | Get component details    |
| POST   | `/control/component/:id/action/:name` | Execute component action |
| POST   | `/control/discover`                   | Discover elements        |
| GET    | `/control/snapshot`                   | Get full snapshot        |

### Workflow API

| Method | Endpoint                       | Description          |
| ------ | ------------------------------ | -------------------- |
| GET    | `/control/workflows`           | List workflows       |
| GET    | `/control/workflow/:id`        | Get workflow details |
| POST   | `/control/workflow/:id/run`    | Run workflow         |
| GET    | `/control/workflow/:id/status` | Get run status       |

### Render Log API

| Method | Endpoint               | Description      |
| ------ | ---------------------- | ---------------- |
| GET    | `/render-log`          | Get log entries  |
| POST   | `/render-log/snapshot` | Capture snapshot |
| DELETE | `/render-log`          | Clear log        |

### Debug API

| Method | Endpoint                | Description        |
| ------ | ----------------------- | ------------------ |
| GET    | `/debug/action-history` | Get action history |
| GET    | `/debug/metrics`        | Get metrics        |
| POST   | `/debug/highlight/:id`  | Highlight element  |

### AI API

| Method | Endpoint              | Description                     |
| ------ | --------------------- | ------------------------------- |
| POST   | `/ai/execute`         | Execute natural language action |
| POST   | `/ai/search`          | Search elements by criteria     |
| POST   | `/ai/assert`          | Assert element state            |
| POST   | `/ai/assert-batch`    | Batch assertions                |
| GET    | `/ai/snapshot`        | Get semantic snapshot           |
| GET    | `/ai/summary`         | Get page summary                |
| POST   | `/ai/diff`            | Get semantic diff               |
| POST   | `/ai/intent/execute`  | Execute an intent               |
| POST   | `/ai/intent/find`     | Find matching intents           |
| GET    | `/ai/intents`         | List available intents          |
| POST   | `/ai/intent/register` | Register custom intent          |

### State API

| Method | Endpoint                          | Description                  |
| ------ | --------------------------------- | ---------------------------- |
| GET    | `/state/active`                   | Get active states            |
| GET    | `/state/all`                      | Get all states               |
| POST   | `/state/find-path`                | Find path to target states   |
| POST   | `/state/execute-transition`       | Execute a transition         |
| GET    | `/state/navigation-context`       | Get navigation context       |
| POST   | `/state/navigation-hints`         | Get navigation hints         |
| GET    | `/state/graph`                    | Get state graph              |
| POST   | `/state/discovery/enable`         | Enable auto-discovery        |
| POST   | `/state/discovery/disable`        | Disable auto-discovery       |
| POST   | `/state/discovery/process-render` | Process render for discovery |
| GET    | `/state/export`                   | Export state machine         |

### Health

| Method | Endpoint  | Description         |
| ------ | --------- | ------------------- |
| GET    | `/health` | Server health check |

## Authentication

UI Bridge doesn't include built-in authentication. Implement it at the server level:

```python
# Example with Bearer token
import requests

headers = {
    'Authorization': 'Bearer your-token',
    'Content-Type': 'application/json'
}

response = requests.post(
    'http://localhost:9876/ui-bridge/control/element/btn/action',
    headers=headers,
    json={'action': 'click'}
)
```

## Rate Limiting

No built-in rate limiting. Implement at the server/proxy level if needed.

## CORS

The standalone server enables CORS by default. Configure origins:

```typescript
startUIBridgeServer({
  cors: {
    origin: ['http://localhost:3000'],
  },
});
```
