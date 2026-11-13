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
| `properties`        | string[] | none       | Not a filter: CSS property names whose computed values each row carries (see below)      |
| `attributes`        | string[] | none       | Not a filter: allow-listed attributes each row carries (see below)                       |

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

### Style and attribute projection

`properties` and `attributes` are not filters. They name values to READ off
every returned row, answered in the row's `projection`:

```json
{
  "text": "save",
  "properties": ["border-top-color", "outline-offset", "hyphens", "--color-accent"],
  "attributes": ["lang", "aria-label"]
}
```

```json
"projection": {
  "properties": {
    "border-top-color": "rgb(0, 170, 255)",
    "outline-offset": "3px",
    "hyphens": "auto",
    "--color-accent": "#00aaff"
  },
  "attributes": { "lang": "de", "aria-label": null },
  "unmeasured": []
}
```

- **`properties`**: CSS property names, each a CSS ident: a standard name
  (`border-inline-start-color`, `-webkit-line-clamp`, in any case), its CSSOM
  camel-cased attribute (`borderTopColor`, also capitalised: `BorderTopColor`;
  a leading `Webkit`, `Moz` or `Ms` is the vendor prefix, as in
  `WebkitLineClamp`), or a custom property (`--color-accent`, case-sensitive).
  The value is the COMPUTED one, so a `var()` reference arrives resolved.
- **`attributes`**: `lang`, `dir`, `id`, `role`, `title`, `alt`, `href`, or any
  `aria-*` name. An attribute the element does not carry answers `null`. Any
  other name is refused.
- At most 32 names per list, each at most 128 characters. The bound is
  checked on the list as sent: an array of more than 32 entries, duplicates
  included, or a query list (`?properties=a,b`, a repeated key's values
  together) longer than 4160 characters is refused before it is split. A
  malformed list is refused with `UB-VALIDATION-ERROR` before anything is
  read, on every transport; the relay refuses it before it reaches a tab.
- A name that could not be read is never answered with `""`. It is left out of
  the value map and listed in `unmeasured` as `{ kind, name, code, detail }`:
  `input_missing` for a custom property the element does not set, or for any
  name read off an element no longer in the document (it has no computed
  style, and the redaction boundary it sat in can no longer be seen from it);
  `capability_unavailable_in_build` for a name the engine computes no value for
  (an unsupported or misspelled property, or a shorthand it does not
  serialize).
- Inside a `data-bridge-redact` boundary, values that can carry page content
  read `[REDACTED]`: free-text and URL attributes (`title`, `alt`, `href`,
  `aria-label`, …), custom properties, property values holding a string or
  a `url()`, and the properties whose value names something the author chose,
  whatever the value holds: a font (`font-family`, `font-palette`,
  `font-variant-alternates`), a counter or counter style (`counter-reset` /
  `-set` / `-increment`, `list-style-type`), an animation or transition
  (`animation-name`, `transition-property`, `will-change`), the timeline and
  anchor names, a position-try rule (`position-try-fallbacks`), a container
  (`container-name`), a view transition (`view-transition-name` / `-class`),
  a named page (`page`), a grid area or line (`grid-template-areas`,
  `grid-template-columns` / `-rows`, `grid-area`, `grid-row` /
  `grid-column` and their `-start` / `-end`), `quotes`, and the shorthands
  that serialize them (`font`, `list-style`, `animation`, `transition`,
  `position-try`, `container`, `grid`, `grid-template`).
  Structure passes when its VALUE is structure: `id`, `role`, a
  language tag in `lang`, `ltr` / `rtl` / `auto` in `dir`, an ARIA state
  holding one of its own tokens (`aria-invalid="spelling"`) or, for a numeric
  one, a number. Any other value is scrubbed:
  `aria-invalid="Card 4111 declined"` reads `[REDACTED]`. The range values
  `aria-valuenow`, `aria-valuemin` and `aria-valuemax` are scrubbed whatever
  they hold: a range bound can be page data (an available balance). The style
  vocabulary (colours, lengths, keywords) passes.
- Every name whose value was scrubbed is listed in `redacted` as
  `{ kind, name }`, so `[REDACTED]` is never mistaken for what the page holds.
  The list is present only when something was scrubbed. The `ai/assert` style
  and attribute checks answer such a value `outcome: "unmeasured"`
  (`not_attempted_by_policy`), never a failure.
- The projection needs a live DOM. The relay's cached snapshot has none, so
  when the relay falls back to it a projection is refused with
  `UB-OBS-CAPABILITY-UNAVAILABLE-IN-BUILD`, naming why the live read failed
  (`no live answer: …`). A tab whose UI Bridge SDK predates the projection
  answers without one; the relay refuses that live answer the same way rather
  than pass on rows that lack the values asked for.
- `state.computedStyles` stays the fixed, light set every snapshot carries; a
  projection does not change it.

`GET /control/element/:id/state` takes the same two lists as query
parameters: comma-separated, a repeated key, or both
(`?properties=hyphens&properties=outline-offset,--color-accent`).

The projection is served by the `@qontinui/ui-bridge/server` adapters. The
separate `@qontinui/ui-bridge-server` package forwards `find` / `discover` to
the `@qontinui/ui-bridge` action executor it is given, so those rows carry
`projection` when that executor's build serves one; but it routes
`GET /control/element/:id/state` with no query, so on that route it ignores
`properties` / `attributes` and answers the state with no `projection` and no
refusal.

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
        "actions": [
          "click",
          "hoverClick",
          "doubleClick",
          "rightClick",
          "middleClick",
          "sendKeys",
          "focus",
          "blur",
          "hover",
          "unhover",
          "scroll",
          "scrollIntoView",
          "drag"
        ],
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
        "actions": [
          "click",
          "hoverClick",
          "doubleClick",
          "rightClick",
          "middleClick",
          "type",
          "sendKeys",
          "clear",
          "focus",
          "blur",
          "hover",
          "unhover",
          "scroll",
          "scrollIntoView",
          "setValue",
          "drag",
          "autocomplete"
        ],
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

| Field            | Type     | Description                                                 |
| ---------------- | -------- | ----------------------------------------------------------- |
| `id`             | string   | Element identifier                                          |
| `type`           | string   | Element type (button, input, etc.)                          |
| `label`          | string   | Registered label (if any)                                   |
| `tagName`        | string   | HTML tag name                                               |
| `role`           | string   | ARIA role                                                   |
| `accessibleName` | string   | Computed accessible name                                    |
| `actions`        | string[] | Available actions                                           |
| `state`          | object   | Current element state                                       |
| `registered`     | boolean  | If registered with UI Bridge                                |
| `projection`     | object   | The requested `properties` / `attributes` (only when asked) |

## Element Types

Every path that finds an element — discovery, registration without an explicit
`type`, auto-registration and the DOM fallback — reports one of these types,
and the same `actions` for it (see [Actions](../concepts/actions.md)):

| Type                                         | Elements                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| `button`                                     | `<button>`, `<input type="submit">`, `<input type="button">`, `[role="button"]` |
| `input`                                      | Any other `<input>`: text, email, number, date, colour, file, reset, …          |
| `textarea`                                   | `<textarea>`                                                                    |
| `textbox`                                    | `[role="textbox"]`, a contenteditable element                                   |
| `select`                                     | `<select>`                                                                      |
| `combobox`                                   | `[role="combobox"]`                                                             |
| `listbox`                                    | `[role="listbox"]`                                                              |
| `option`                                     | `<option>`, `[role="option"]`                                                   |
| `checkbox`                                   | `<input type="checkbox">`, `[role="checkbox"]`                                  |
| `radio`                                      | `<input type="radio">`, `[role="radio"]`                                        |
| `switch`                                     | `[role="switch"]`                                                               |
| `slider`                                     | `<input type="range">`, `[role="slider"]`                                       |
| `link`                                       | `<a>`, `[role="link"]`                                                          |
| `form`                                       | `<form>`                                                                        |
| `menu`                                       | `[role="menu"]`                                                                 |
| `menuitem`                                   | `[role="menuitem"]`                                                             |
| `tab`                                        | `[role="tab"]`                                                                  |
| `dialog`                                     | `<dialog>`, `[role="dialog"]`                                                   |
| `disclosure`                                 | `<details>`, the `<summary>` that opens one                                     |
| `image`, `svg`, `video`, `canvas`, `picture` | `<img>`, `[role="img"]`, `<svg>`, `<video>`, `<canvas>`, `<picture>`            |
| `generic`                                    | Any other element                                                               |

`custom` is reported only for a registration that declares it. A query or
filter that names `input` also finds `textbox` elements, and one that names
`select` also finds `combobox` and `listbox` elements.

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
