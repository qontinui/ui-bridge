---
sidebar_position: 4
---

# Workflow Endpoints

Endpoints for managing and executing workflows.

## List Workflows

```http
GET /control/workflows
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "login-flow",
      "name": "Login Flow",
      "description": "User authentication workflow",
      "stepCount": 4
    },
    {
      "id": "checkout-flow",
      "name": "Checkout Flow",
      "stepCount": 6
    }
  ]
}
```

## Get Workflow

```http
GET /control/workflow/:id
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "login-flow",
    "name": "Login Flow",
    "description": "User authentication workflow",
    "steps": [
      {
        "id": "enter-email",
        "type": "action",
        "target": "login-email",
        "action": "type",
        "params": { "text": "{{email}}" }
      },
      {
        "id": "enter-password",
        "type": "action",
        "target": "login-password",
        "action": "type",
        "params": { "text": "{{password}}" }
      },
      {
        "id": "submit",
        "type": "action",
        "target": "login-submit",
        "action": "click"
      },
      {
        "id": "wait-dashboard",
        "type": "wait",
        "target": "dashboard-header",
        "waitFor": "visible",
        "timeout": 5000
      }
    ],
    "variables": {
      "email": "",
      "password": ""
    }
  }
}
```

## Run Workflow

```http
POST /control/workflow/:id/run
```

**Request Body:**

```json
{
  "params": {
    "email": "user@example.com",
    "password": "secret123"
  },
  "startStep": null,
  "stopStep": null,
  "stepTimeout": 5000,
  "workflowTimeout": 30000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `params` | object | Variable values |
| `startStep` | string | Step ID to start from |
| `stopStep` | string | Step ID to stop at |
| `stepTimeout` | number | Per-step timeout (ms) |
| `workflowTimeout` | number | Total timeout (ms) |

**Response:**

```json
{
  "success": true,
  "data": {
    "workflowId": "login-flow",
    "runId": "run-abc123",
    "status": "completed",
    "steps": [
      {
        "stepId": "enter-email",
        "stepType": "action",
        "success": true,
        "durationMs": 150,
        "timestamp": 1234567890
      },
      {
        "stepId": "enter-password",
        "stepType": "action",
        "success": true,
        "durationMs": 120,
        "timestamp": 1234567891
      },
      {
        "stepId": "submit",
        "stepType": "action",
        "success": true,
        "durationMs": 50,
        "timestamp": 1234567892
      },
      {
        "stepId": "wait-dashboard",
        "stepType": "wait",
        "success": true,
        "durationMs": 800,
        "timestamp": 1234567893
      }
    ],
    "totalSteps": 4,
    "success": true,
    "startedAt": 1234567890,
    "completedAt": 1234567894,
    "durationMs": 1120
  }
}
```

### Failed Workflow Response

```json
{
  "success": true,
  "data": {
    "workflowId": "login-flow",
    "runId": "run-abc124",
    "status": "failed",
    "steps": [
      {
        "stepId": "enter-email",
        "stepType": "action",
        "success": true,
        "durationMs": 150,
        "timestamp": 1234567890
      },
      {
        "stepId": "enter-password",
        "stepType": "action",
        "success": false,
        "error": "Element not found",
        "durationMs": 50,
        "timestamp": 1234567891
      }
    ],
    "totalSteps": 4,
    "success": false,
    "error": "Element not found",
    "startedAt": 1234567890,
    "completedAt": 1234567891,
    "durationMs": 200
  }
}
```

## Get Workflow Status

```http
GET /control/workflow/:runId/status
```

Get status of a running or completed workflow.

**Response:**

```json
{
  "success": true,
  "data": {
    "workflowId": "checkout-flow",
    "runId": "run-xyz789",
    "status": "running",
    "steps": [...],
    "currentStep": 3,
    "totalSteps": 6,
    "startedAt": 1234567890,
    "durationMs": 2500
  }
}
```

### Status Values

| Status | Description |
|--------|-------------|
| `pending` | Not yet started |
| `running` | Currently executing |
| `completed` | Successfully finished |
| `failed` | Failed with error |
| `cancelled` | Manually cancelled |

## Examples

### Run Login Workflow

```bash
curl -X POST http://localhost:9876/ui-bridge/control/workflow/login-flow/run \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "email": "user@example.com",
      "password": "secret123"
    }
  }'
```

### Run Partial Workflow

```bash
curl -X POST http://localhost:9876/ui-bridge/control/workflow/checkout-flow/run \
  -H "Content-Type: application/json" \
  -d '{
    "params": { "productId": "123" },
    "startStep": "add-to-cart",
    "stopStep": "review-order"
  }'
```

### Check Run Status

```bash
curl http://localhost:9876/ui-bridge/control/workflow/run-abc123/status
```
