---
sidebar_position: 3
---

# Discovery Endpoints

Endpoints for discovering controllable elements in the UI.

## Discover Elements

```http
POST /control/discover
```

Scan the DOM for controllable elements.

### Request Body

```json
{
  "root": "#app",
  "interactiveOnly": true,
  "includeHidden": false,
  "limit": 100,
  "types": ["button", "input", "select"],
  "selector": ".form-control"
}
```

| Field             | Type     | Default    | Description               |
| ----------------- | -------- | ---------- | ------------------------- |
| `root`            | string   | `document` | Root element selector     |
| `interactiveOnly` | boolean  | `false`    | Only interactive elements |
| `includeHidden`   | boolean  | `false`    | Include hidden elements   |
| `limit`           | number   | none       | Max elements to return    |
| `types`           | string[] | all        | Filter by element types   |
| `selector`        | string   | none       | CSS selector filter       |

### Response

```json
{
  "success": true,
  "data": {
    "elements": [
      {
        "id": "submit-btn",
        "type": "button",
        "label": null,
        "tagName": "button",
        "role": "button",
        "accessibleName": "Submit",
        "actions": ["click", "focus", "blur", "hover"],
        "state": {
          "visible": true,
          "enabled": true,
          "focused": false,
          "rect": {
            "x": 100,
            "y": 200,
            "width": 120,
            "height": 40
          }
        },
        "registered": true
      },
      {
        "id": "email-input",
        "type": "input",
        "tagName": "input",
        "role": "textbox",
        "accessibleName": "Email address",
        "actions": ["click", "type", "clear", "focus", "blur"],
        "state": {
          "visible": true,
          "enabled": true,
          "focused": false,
          "value": "",
          "rect": {
            "x": 100,
            "y": 100,
            "width": 300,
            "height": 40
          }
        },
        "registered": true
      }
    ],
    "total": 2,
    "durationMs": 15.5,
    "timestamp": 1234567890
  }
}
```

## Discovered Element Fields

| Field            | Type     | Description                        |
| ---------------- | -------- | ---------------------------------- |
| `id`             | string   | Element identifier                 |
| `type`           | string   | Element type (button, input, etc.) |
| `label`          | string   | Registered label (if any)          |
| `tagName`        | string   | HTML tag name                      |
| `role`           | string   | ARIA role                          |
| `accessibleName` | string   | Computed accessible name           |
| `actions`        | string[] | Available actions                  |
| `state`          | object   | Current element state              |
| `registered`     | boolean  | If registered with UI Bridge       |

## Element Types

Discovery returns these element types:

| Type       | Elements                                               |
| ---------- | ------------------------------------------------------ |
| `button`   | `<button>`, `<input type="submit">`, `[role="button"]` |
| `input`    | `<input type="text">`, `<input type="email">`, etc.    |
| `textarea` | `<textarea>`                                           |
| `select`   | `<select>`, `[role="listbox"]`                         |
| `checkbox` | `<input type="checkbox">`, `[role="checkbox"]`         |
| `radio`    | `<input type="radio">`, `[role="radio"]`               |
| `link`     | `<a>`, `[role="link"]`                                 |
| `form`     | `<form>`                                               |
| `menu`     | `[role="menu"]`                                        |
| `menuitem` | `[role="menuitem"]`                                    |
| `tab`      | `[role="tab"]`                                         |
| `dialog`   | `<dialog>`, `[role="dialog"]`                          |
| `custom`   | Other interactive elements                             |

## Examples

### Find All Buttons

```bash
curl -X POST http://localhost:9876/ui-bridge/control/discover \
  -H "Content-Type: application/json" \
  -d '{"types": ["button"]}'
```

### Find Interactive Elements in Form

```bash
curl -X POST http://localhost:9876/ui-bridge/control/discover \
  -H "Content-Type: application/json" \
  -d '{
    "root": "#login-form",
    "interactiveOnly": true
  }'
```

### Find Visible Inputs

```bash
curl -X POST http://localhost:9876/ui-bridge/control/discover \
  -H "Content-Type: application/json" \
  -d '{
    "types": ["input", "textarea"],
    "includeHidden": false
  }'
```
