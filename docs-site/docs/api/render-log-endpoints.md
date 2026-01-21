---
sidebar_position: 5
---

# Render Log Endpoints

Endpoints for DOM observation and render logging.

## Get Render Log

```http
GET /render-log
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | string | Filter by entry type |
| `since` | number | Entries after timestamp |
| `until` | number | Entries before timestamp |
| `limit` | number | Max entries to return |

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "entry-123",
      "type": "snapshot",
      "timestamp": 1234567890,
      "data": {
        "url": "http://localhost:3000/dashboard",
        "title": "Dashboard",
        "html": "<!DOCTYPE html>..."
      },
      "metadata": {
        "trigger": "manual",
        "viewportWidth": 1920,
        "viewportHeight": 1080
      }
    },
    {
      "id": "entry-124",
      "type": "change",
      "timestamp": 1234567891,
      "data": {
        "selector": "#user-name",
        "attribute": "textContent",
        "oldValue": "",
        "newValue": "John Doe"
      }
    }
  ]
}
```

## Entry Types

| Type | Description |
|------|-------------|
| `snapshot` | Full DOM snapshot |
| `change` | DOM mutation |
| `navigation` | Page navigation |
| `interaction` | User interaction |
| `error` | JavaScript error |
| `custom` | Custom event |

## Capture Snapshot

```http
POST /render-log/snapshot
```

Capture a DOM snapshot manually.

**Request Body (optional):**

```json
{
  "selector": "#main-content",
  "includeStyles": true,
  "metadata": {
    "reason": "after-login"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "snapshot-abc123",
    "timestamp": 1234567890,
    "url": "http://localhost:3000/dashboard",
    "title": "Dashboard",
    "viewport": {
      "width": 1920,
      "height": 1080
    }
  }
}
```

## Clear Render Log

```http
DELETE /render-log
```

Clear all render log entries.

**Response:**

```json
{
  "success": true,
  "data": {
    "cleared": 42
  }
}
```

## Debug Endpoints

### Get Action History

```http
GET /debug/action-history?limit=10
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "action-123",
      "timestamp": 1234567890,
      "elementId": "submit-btn",
      "action": "click",
      "success": true,
      "durationMs": 50
    },
    {
      "id": "action-122",
      "timestamp": 1234567889,
      "elementId": "email-input",
      "action": "type",
      "params": { "text": "user@example.com" },
      "success": true,
      "durationMs": 150
    }
  ]
}
```

### Get Metrics

```http
GET /debug/metrics
```

**Response:**

```json
{
  "success": true,
  "data": {
    "totalActions": 156,
    "successfulActions": 150,
    "failedActions": 6,
    "successRate": 0.9615,
    "avgDurationMs": 75.5,
    "minDurationMs": 10,
    "maxDurationMs": 500,
    "p95DurationMs": 200,
    "actionsPerSecond": 2.5,
    "errorsByType": {
      "NOT_FOUND": 3,
      "TIMEOUT": 2,
      "ACTION_FAILED": 1
    },
    "actionsByType": {
      "click": 80,
      "type": 50,
      "select": 20,
      "focus": 6
    }
  }
}
```

### Highlight Element

```http
POST /debug/highlight/:elementId
```

Visually highlight an element in the UI.

**Request Body (optional):**

```json
{
  "color": "#ff0000",
  "duration": 2000
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "highlighted": true,
    "elementId": "submit-btn"
  }
}
```

## Examples

### Get Recent Snapshots

```bash
curl "http://localhost:9876/ui-bridge/render-log?type=snapshot&limit=5"
```

### Get Changes After Timestamp

```bash
curl "http://localhost:9876/ui-bridge/render-log?type=change&since=1234567800"
```

### Capture Snapshot

```bash
curl -X POST http://localhost:9876/ui-bridge/render-log/snapshot \
  -H "Content-Type: application/json" \
  -d '{"metadata": {"step": "after-checkout"}}'
```

### Get Action Metrics

```bash
curl http://localhost:9876/ui-bridge/debug/metrics
```
