---
sidebar_position: 5
---

# Drag & Drop Discovery

UI Bridge automatically detects drag sources and drop zones so AI agents know what's draggable and where it can be dropped — without requiring screenshots or coordinate guessing.

## How Detection Works

The `DragDropDetector` uses three detection sources, with higher-priority sources taking precedence during deduplication:

| Priority | Source | How |
|----------|--------|-----|
| 1 (highest) | **Declared** | Developer hooks: `useDragSource()`, `useDropZone()` |
| 2 | **ARIA** | `aria-grabbed` (drag source), `aria-dropeffect` (drop zone) |
| 3 | **DOM/CSS** | `draggable="true"`, `cursor-grab`/`cursor-move` classes, computed cursor styles |

A **structural heuristic** also detects sortable containers: any element with 2+ draggable children is automatically identified as a sortable drop zone.

## Developer Hooks

For the most reliable detection, declare drag sources and drop zones explicitly:

### useDragSource

```tsx
import { useDragSource } from '@qontinui/ui-bridge';

function SortableItem({ id, label }: Props) {
  useDragSource(`step-${id}`, {
    dataType: 'workflow-step',
    label,
    metadata: { index: 3 },
  });

  return <div>...</div>;
}
```

### useDropZone

```tsx
import { useDropZone } from '@qontinui/ui-bridge';

function StepList() {
  useDropZone('step-list', {
    accepts: ['workflow-step'],
    effect: 'reorder',
    label: 'Workflow Steps',
  });

  return <ul>...</ul>;
}
```

Both hooks register on mount, clean up on unmount, and re-register when parameters change.

### Hook Options

**`UseDragSourceOptions`:**

| Option | Type | Description |
|--------|------|-------------|
| `dataType` | `string` | Kind of data (e.g., `'workflow-step'`, `'file'`, `'list-item'`) |
| `label` | `string` | Human-readable label |
| `metadata` | `Record<string, unknown>` | Arbitrary metadata |

**`UseDropZoneOptions`:**

| Option | Type | Description |
|--------|------|-------------|
| `accepts` | `string[]` | Data types this zone accepts (omit for wildcard) |
| `effect` | `DragEffect` | Drop effect: `'move'`, `'copy'`, `'link'`, `'reorder'` |
| `label` | `string` | Human-readable label |
| `metadata` | `Record<string, unknown>` | Arbitrary metadata |

## Auto-Detection

Even without developer hooks, the detector finds drag-drop patterns automatically:

### ARIA Detection

- `aria-grabbed="true"` or `aria-grabbed="false"` → drag source
- `aria-dropeffect="move|copy|link|execute|popup"` → drop zone
- `aria-dropeffect="none"` is ignored

### DOM/CSS Heuristics

- `draggable="true"` attribute → drag source (`nativeDraggable: true`)
- CSS classes `cursor-grab`, `cursor-move`, `cursor-grabbing` → drag source (`hasGrabCursor: true`)
- Computed `cursor: grab` or `cursor: move` styles → drag source
- Container with 2+ draggable children → sortable drop zone (with `containedDragSources` list)

### Label Extraction

Auto-detected elements get labels from (in priority order):
1. `aria-label` attribute
2. `data-testid` attribute
3. Short text content (≤60 characters)

## Snapshot Output

Every `ControlSnapshot` includes a `dragDrop` section:

```json
{
  "dragDrop": {
    "dragSources": [
      {
        "id": "step-3",
        "label": "Send Email",
        "dataType": "workflow-step",
        "origin": "declared",
        "nativeDraggable": false,
        "hasGrabCursor": false,
        "metadata": { "index": 2 }
      }
    ],
    "dropZones": [
      {
        "id": "step-list",
        "label": "Workflow Steps",
        "accepts": ["workflow-step"],
        "effect": "reorder",
        "origin": "declared",
        "isSortable": false
      }
    ],
    "count": { "dragSources": 3, "dropZones": 1 },
    "byOrigin": { "declared": 2, "aria": 0, "dom": 2 }
  }
}
```

## MCP Tool Output

The MCP server formats drag-drop data in the snapshot header:

```
═══ DRAG & DROP ═══
Drag Sources (3): 2 declared, 1 dom
  • step-1 [workflow-step] "Step 1" (declared)
  • step-2 [workflow-step] "Step 2" (declared)
  • step-3 [workflow-step] draggable (dom)

Drop Zones (1): 1 declared
  • step-list [reorder] accepts: workflow-step (declared)
    sortable, contains: step-1, step-2, step-3
```

## Query Helpers

The detector provides query methods for targeted lookups:

```typescript
// Get all drop zones that accept a specific data type
const zones = detector.getDropZonesForType('workflow-step');
// Returns zones where accepts includes 'workflow-step' OR accepts is undefined (wildcard)

// Get all drag sources contained in a sortable zone
const sources = detector.getDragSourcesInZone('step-list');
// Returns sources whose IDs are in the zone's containedDragSources list
```

## Python Client

```python
from ui_bridge.types import ControlSnapshot

snapshot: ControlSnapshot = client.get_snapshot()

if snapshot.drag_drop:
    for source in snapshot.drag_drop.drag_sources:
        print(f"Draggable: {source.id} [{source.data_type}] ({source.origin})")

    for zone in snapshot.drag_drop.drop_zones:
        print(f"Drop zone: {zone.id} accepts={zone.accepts} ({zone.origin})")
        if zone.is_sortable:
            print(f"  Sortable, contains: {zone.contained_drag_sources}")
```

## Deduplication

When an element is detected by multiple sources, the highest-priority source wins:

1. **Declared** (from hooks) beats ARIA and DOM
2. **ARIA** beats DOM
3. Boolean flags (`nativeDraggable`, `hasGrabCursor`) merge from all sources

This means a declared drag source that also has `draggable="true"` in the DOM will have `origin: "declared"` but `nativeDraggable: true`.

## Best Practices

1. **Use hooks for dnd-kit components** — dnd-kit doesn't leave data attributes in the DOM, so auto-detection relies on CSS class heuristics. Explicit declarations are more reliable.

2. **Set `dataType` on drag sources** — enables `getDropZonesForType()` queries and helps AI understand what data is being dragged.

3. **Set `accepts` on drop zones** — lets AI know which drag sources are compatible with which zones.

4. **Use `effect` to describe the operation** — `'reorder'` vs `'copy'` vs `'move'` tells AI what will happen when an item is dropped.

5. **Provide labels** — helps AI describe drag-drop operations in human-readable terms.
