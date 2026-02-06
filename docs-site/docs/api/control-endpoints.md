---
sidebar_position: 2
---

# Control Endpoints

Element and component control API endpoints.

## Elements

### List Elements

```http
GET /control/elements
```

Returns all registered elements.

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "submit-btn",
      "type": "button",
      "label": "Submit Button",
      "actions": ["click", "focus", "blur", "hover"],
      "state": {
        "visible": true,
        "enabled": true,
        "focused": false
      }
    }
  ]
}
```

### Get Element

```http
GET /control/element/:id
```

Get details for a specific element.

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "email-input",
    "type": "input",
    "label": "Email Input",
    "actions": ["click", "type", "clear", "focus", "blur"],
    "identifier": {
      "uiId": "email-input",
      "xpath": "/html/body/form/input",
      "selector": "[data-ui-id=\"email-input\"]"
    },
    "state": {
      "visible": true,
      "enabled": true,
      "focused": false,
      "value": ""
    }
  }
}
```

### Get Element State

```http
GET /control/element/:id/state
```

Get current state of an element.

**Response:**

```json
{
  "success": true,
  "data": {
    "visible": true,
    "enabled": true,
    "focused": false,
    "rect": {
      "x": 100,
      "y": 200,
      "width": 300,
      "height": 40,
      "top": 200,
      "right": 400,
      "bottom": 240,
      "left": 100
    },
    "value": "user@example.com",
    "textContent": ""
  }
}
```

### Execute Element Action

```http
POST /control/element/:id/action
```

Execute an action on an element.

**Request Body:**

```json
{
  "action": "type",
  "params": {
    "text": "Hello World",
    "clear": true
  },
  "waitOptions": {
    "visible": true,
    "enabled": true,
    "timeout": 5000
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "success": true,
    "durationMs": 150.5,
    "timestamp": 1234567890,
    "elementState": {
      "visible": true,
      "enabled": true,
      "value": "Hello World"
    }
  }
}
```

#### Action Types

**click**

```json
{ "action": "click" }
```

**type**

```json
{
  "action": "type",
  "params": {
    "text": "Hello",
    "clear": true,
    "delay": 50
  }
}
```

**select**

```json
{
  "action": "select",
  "params": {
    "value": "option-1",
    "byLabel": false
  }
}
```

**scroll**

```json
{
  "action": "scroll",
  "params": {
    "direction": "down",
    "amount": 200,
    "smooth": true
  }
}
```

## Components

### List Components

```http
GET /control/components
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "login-form",
      "name": "Login Form",
      "description": "User authentication form",
      "actions": ["login", "reset"]
    }
  ]
}
```

### Get Component

```http
GET /control/component/:id
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "login-form",
    "name": "Login Form",
    "description": "User authentication form",
    "actions": [
      {
        "id": "login",
        "label": "Login",
        "description": "Authenticate user"
      },
      {
        "id": "reset",
        "label": "Reset Form"
      }
    ],
    "elementIds": ["login-email", "login-password", "login-submit"]
  }
}
```

### Execute Component Action

```http
POST /control/component/:id/action/:actionName
```

**Request Body:**

```json
{
  "params": {
    "email": "user@example.com",
    "password": "secret123"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "success": true,
    "durationMs": 250.0,
    "timestamp": 1234567890,
    "result": {
      "userId": "123",
      "token": "abc..."
    }
  }
}
```

## Snapshot

### Get Control Snapshot

```http
GET /control/snapshot
```

Get a full snapshot of all controllable UI.

**Response:**

```json
{
  "success": true,
  "data": {
    "timestamp": 1234567890,
    "elements": [...],
    "components": [...],
    "workflows": [...],
    "activeRuns": []
  }
}
```
