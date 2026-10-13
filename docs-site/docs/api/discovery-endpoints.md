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

| Field               | Type     | Default    | Description                                                                              |
| ------------------- | -------- | ---------- | ---------------------------------------------------------------------------------------- |
| `root`              | string   | `document` | Keep only elements inside this element (a root that matches nothing is refused)          |
| `interactiveOnly`   | boolean  | `false`    | Only interactive elements                                                                |
| `includeHidden`     | boolean  | `true`     | Hidden elements are included unless this is `false`                                      |
| `limit`             | number   | none       | Max elements to return, applied after filtering                                          |
| `types`             | string[] | all        | Filter by element types                                                                  |
| `selector`          | string   | none       | Keep only elements matching this CSS selector                                            |
| `includeContent`    | boolean  | `true`     | Content rows are included unless this is `false`                                         |
| `contentOnly`       | boolean  | `false`    | Only content rows                                                                        |
| `contentRole`       | string   | none       | Only content rows with this content role                                                 |
| `includeMedia`      | boolean  | `true`     | Media rows are included unless this is `false`                                           |
| `mediaOnly`         | boolean  | `false`    | Only media rows (images, picture, video, SVG, canvas, background images)                 |
| `mediaType`         | string   | none       | Only media of this type (`image`, `picture`, `video`, `svg`, …)                          |
| `brokenOnly`        | boolean  | `false`    | Only media that failed to load                                                           |
| `missingAltOnly`    | boolean  | `false`    | Only images with no alt text that are not decorative                                     |
| `srcPattern`        | string   | none       | Regex matched against the media `src` (ReDoS-guarded; a redacted src reads `[REDACTED]`) |
| `oversizeThreshold` | number   | none       | Only media whose `effectiveResolution` is at least this                                  |

Every option is honoured the same way on every transport — the in-page
executor, the server handler, the live relay and the relay's cached
snapshot — because they share one filter. Two rules govern it:

- **A filter never passes a row it cannot evaluate.** A media-fact filter
  (`mediaType`, `brokenOnly`, `missingAltOnly`, `srcPattern`,
  `oversizeThreshold`) leaves out an image whose fact is unmeasured — say, one
  that has not loaded yet, so its effective resolution is unknown — and lists
  it in the response's `unevaluated` array (`{ id, option, code }`). An empty
  `unevaluated` says every row was evaluated.
- **An option a transport cannot honour is refused, typed — never answered
  with an empty list.** `root` / `selector` over the relay's cached snapshot
  (it carries no DOM) and media-fact filters over a snapshot from an SDK build
  without media observations answer `UB-OBS-CAPABILITY-UNAVAILABLE-IN-BUILD`; a
  media question over an empty registry answers `UB-OBS-PRODUCER-NOT-RUN`; a
  request that contradicts itself (`mediaOnly` with `interactiveOnly`) answers
  `UB-VALIDATION-ERROR`.

Each media row carries `mediaMetadata`: one observation envelope
(`{ status, value, provenance }`) whose `value` holds the measured facts —
natural and rendered size, `devicePixelRatio`, `effectiveResolution` (source
pixels per device pixel actually displayed), `objectFit`, `dimsReserved`,
`loading` / `decoding` / `fetchPriority`, `encodedBodySize`, `isLcpCandidate`,
`clsSources`, `slotId` — and whose `provenance.coverage.unmeasured` names every
fact that could not be measured, with the reason.

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
