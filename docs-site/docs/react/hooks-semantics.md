---
sidebar_position: 2.5
---

# Semantic Hooks

Five hooks from `@qontinui/ui-bridge/react` declare knowledge the DOM cannot
express: what an element is *for*, how elements relate to one another, and what
can be dragged where. All of it surfaces in snapshots, so an agent can reason
about the page instead of guessing from tag names.

The drag-and-drop model these hooks feed is described in
[Drag & Drop](../concepts/drag-drop.md).

## useUIAnnotation

```typescript
function useUIAnnotation(elementId: string, annotation: ElementAnnotation): void
```

Attaches human-authored context to an element id.

```tsx
import { useUIAnnotation } from '@qontinui/ui-bridge/react';

function SearchBar() {
  useUIAnnotation('search-input', {
    description: 'Global search input',
    purpose: 'Searches across all projects and workflows',
    notes: 'Debounces input by 300ms. Supports advanced query syntax.',
    tags: ['search', 'global'],
    relatedElements: ['search-results-panel', 'search-clear-btn'],
  });

  return <input placeholder="Search…" />;
}
```

:::warning Annotations are never cleaned up on unmount

Every other hook on these pages undeclares itself when its component unmounts.
This one does not, deliberately: an annotation is persistent developer knowledge
about an element id, not a property of one mounted instance. It stays in the
global annotation store for the lifetime of the page. To change it, write a new
annotation for the same id.

:::

### Parameters

| Parameter | Type | Meaning |
|-----------|------|---------|
| `elementId` | `string` | The UI Bridge element id to annotate |
| `annotation` | `ElementAnnotation` | The annotation payload |

```typescript
interface ElementAnnotation {
  description?: string;       // what this element is
  purpose?: string;           // why it exists / what it is for
  notes?: string;             // behavioural notes, edge cases, caveats
  tags?: string[];            // searchable categorisation
  relatedElements?: string[]; // ids of related elements
  metadata?: Record<string, unknown>;
  updatedAt?: number;         // set by the store
  author?: string;
}
```

Every field is optional. The hook serialises the annotation and writes to the
store only when the serialisation changed, so passing an inline object literal
on every render is safe.

The written data is readable at `GET /annotations/:elementId`, in the export at
`GET /annotations/export`, and directly via the store's `get(elementId)`.

Note that [`useUIState`](./hooks-state.md#useuistate) can write the same
annotations for a whole state's elements at once, when its `metadata` matches
the IR-metadata shape.

## useUIRelationship

```typescript
function useUIRelationship(
  sourceId: string,
  targetId: string,
  type: RelationshipType,
  options?: UseUIRelationshipOptions
): void
```

Declares one typed relationship between two elements. Declared on mount,
undeclared on unmount; changing any parameter undeclares the old relationship
and declares the new one.

```tsx
import { useUIRelationship } from '@qontinui/ui-bridge/react';

// The search input filters the results list
useUIRelationship('search-input', 'results-list', 'filters');

// A tab activates a panel, in both directions
useUIRelationship('tab-settings', 'settings-panel', 'activates', { bidirectional: true });

// With metadata
useUIRelationship('sort-dropdown', 'data-table', 'controls', {
  metadata: { field: 'sortOrder' },
});
```

### Parameters

| Parameter | Type | Meaning |
|-----------|------|---------|
| `sourceId` | `string` | Element that *has* the relationship |
| `targetId` | `string` | Element being related to |
| `type` | `RelationshipType` | See the vocabulary below |
| `options.bidirectional` | `boolean` (default `false`) | Declare the reverse edge too |
| `options.metadata` | `Record<string, unknown>` | Arbitrary extra data |

### Relationship vocabulary

`RelationshipType` is a union of named types **plus `string`**, so the list is a
vocabulary, not a closed set — an unrecognised string is accepted.

| Type | Meaning |
|------|---------|
| `controls` | A changes B's state (toggle → panel) |
| `filters` | A narrows B's content (search → list) |
| `validates` | A shows validation state for B (error → input) |
| `labels` | A names/titles B (heading → section) |
| `describes` | A provides detail for B (help text → input) |
| `submits` | A triggers submission of B (button → form) |
| `activates` | A makes B the active item (tab → panel) |
| `toggles` | A shows/hides B (button → dropdown) |
| `populates` | A provides data for B (source → display) |
| `navigatesTo` | A navigates to B (link → section) |
| `dependsOn` | A requires B's value (city → country) |
| `owns` | A logically contains B (combobox → listbox popup) |

Relationships declared this way are recorded with origin `declared`, which is
how snapshots distinguish them from edges auto-detected from ARIA or HTML
structure.

The same edges can be declared inline on
[`useUIElement`](./hooks-registration.md#useuielement) via its `relationships`
option, which is more convenient when the source element is one you already
register.

## useUIRelationships

```typescript
function useUIRelationships(sourceId: string, relationships: InlineRelationship[]): void
```

Declares many relationships from one source element.

```tsx
import { useUIRelationships } from '@qontinui/ui-bridge/react';

useUIRelationships('save-button', [
  { target: 'name-input', type: 'submits' },
  { target: 'email-input', type: 'submits' },
  { target: 'form-status', type: 'populates' },
]);
```

```typescript
interface InlineRelationship {
  target: string;
  type: RelationshipType;
  bidirectional?: boolean;
  metadata?: Record<string, unknown>;
}
```

The array is compared by serialised value, not identity, so an inline literal is
fine. On any change the hook undeclares everything it previously declared before
declaring the new set, and it undeclares the whole set on unmount.

## useDragSource

```typescript
function useDragSource(elementId: string, options?: UseDragSourceOptions): void
```

Marks an element as draggable so an agent can discover it without inferring drag
behaviour from event listeners.

```tsx
import { useDragSource } from '@qontinui/ui-bridge/react';

useDragSource('step-3', { dataType: 'workflow-step' });
```

| Option | Type | Meaning |
|--------|------|---------|
| `dataType` | `string` | The kind of data this source represents |
| `label` | `string` | Human-readable label |
| `metadata` | `Record<string, unknown>` | Arbitrary extra data |

All options are optional, and the second argument itself may be omitted.
Declared on mount, undeclared on unmount; a changed `dataType`, `label` or
metadata value replaces the declaration.

The declaration is a **statement about the element**, not an implementation: it
does not add drag handlers or make anything draggable. Your app still implements
the drag; this tells the bridge that it exists.

## useDropZone

```typescript
function useDropZone(elementId: string, options?: UseDropZoneOptions): void
```

Marks an element as a drop target and says what it accepts.

```tsx
import { useDropZone } from '@qontinui/ui-bridge/react';

useDropZone('step-list', {
  accepts: ['workflow-step'],
  effect: 'reorder',
});
```

| Option | Type | Meaning |
|--------|------|---------|
| `accepts` | `string[]` | The `dataType` values this zone accepts |
| `effect` | `DragEffect` | What dropping here does |
| `label` | `string` | Human-readable label |
| `metadata` | `Record<string, unknown>` | Arbitrary extra data |

Same lifecycle as `useDragSource`: declared on mount, undeclared on unmount,
replaced when any option changes. The `accepts` values are matched against the
`dataType` a drag source declares — keep the two vocabularies in sync, since
nothing validates them for you.
