/**
 * Regression contract for the canonical find/discover filter
 * (`src/core/find-filter.ts`).
 *
 * THE SUPERSET INVARIANT (third occurrence of this drift class — this test
 * is what makes the fix stick): `find/discover {interactive_only: false}`
 * must return a SUPERSET of the registry elements `/control/snapshot`
 * returns. Historically four divergent filter copies (React commandHandlers,
 * server handlers' applyFindFilters, the discover re-implementation, relay
 * filterCachedElements) broke this — a default-on visibility filter plus
 * interactive type-set drift made `discover {interactive_only: false}`
 * return 194 elements while snapshot returned 211, silently omitting all 9
 * `terminal-zone-header-*` elements.
 *
 * Breaking change locked in here (0.22.0): `include_hidden` defaults to
 * TRUE — no visibility filtering unless the caller explicitly passes
 * `include_hidden: false`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import { getGlobalRegistry, resetGlobalRegistry } from './registry';
import { applyCanonicalFindFilter, INTERACTIVE_ELEMENT_TYPES } from './find-filter';
import type { ElementType } from './types';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

/** Register a diverse element set that exercises every historical drift axis. */
function registerDiverseElements(container: HTMLElement): string[] {
  const registry = getGlobalRegistry();
  const ids: string[] = [];

  const add = (
    id: string,
    tag: string,
    options: Parameters<typeof registry.registerElement>[2],
    mutate?: (el: HTMLElement) => void
  ) => {
    const el = document.createElement(tag);
    mutate?.(el);
    container.appendChild(el);
    registry.registerElement(id, el, options);
    ids.push(id);
  };

  // Normal interactive button.
  add('btn-normal', 'button', { type: 'button', label: 'Save' });
  // Hidden element (display:none — offsetParent is null, state.visible false).
  add('btn-hidden', 'button', { type: 'button', label: 'Hidden Save' }, (el) => {
    el.style.display = 'none';
  });
  // Semantic content element (kind: 'content' on the serialized shape).
  add('content-card', 'div', { type: 'generic', category: 'content', actions: [] });
  // Type outside the historical 7-type set (the drift that dropped switches).
  add('switch-1', 'div', { type: 'switch', label: 'Dark mode' });
  // Type outside the interactive set entirely, with no actions.
  add('generic-1', 'div', { type: 'generic', actions: [] });

  return ids;
}

describe('canonical find filter · superset invariant (find ⊇ snapshot)', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    resetGlobalRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    resetGlobalRegistry();
  });

  it('find {interactive_only:false} returns a superset of snapshot registered ids', async () => {
    registerDiverseElements(container);

    const snapshot = (await executeCommand('getControlSnapshot', {}, emptyBridge)) as {
      elements: Array<{ id: string }>;
    };
    const snapshotIds = new Set(snapshot.elements.map((e) => e.id));
    expect(snapshotIds.size).toBeGreaterThanOrEqual(5);

    const findResult = (await executeCommand('find', { interactive_only: false }, emptyBridge)) as {
      elements: Array<{ id: string }>;
      total: number;
    };
    const findIds = new Set(findResult.elements.map((e) => e.id));

    // THE invariant: every element snapshot returns is also returned by an
    // unfiltered find/discover — including hidden, content, and
    // outside-the-7-type-set elements.
    for (const id of snapshotIds) {
      expect(findIds.has(id), `find must include snapshot element "${id}"`).toBe(true);
    }
  });

  it('discover behaves identically to find (shared command path)', async () => {
    registerDiverseElements(container);

    const findResult = (await executeCommand('find', { interactive_only: false }, emptyBridge)) as {
      elements: Array<{ id: string }>;
    };
    const discoverResult = (await executeCommand(
      'discover',
      { interactive_only: false },
      emptyBridge
    )) as { elements: Array<{ id: string }> };

    expect(discoverResult.elements.map((e) => e.id).sort()).toEqual(
      findResult.elements.map((e) => e.id).sort()
    );
  });

  it('an empty find request (no filters at all) also returns every registered element', async () => {
    const ids = registerDiverseElements(container);

    const findResult = (await executeCommand('find', {}, emptyBridge)) as {
      elements: Array<{ id: string }>;
    };
    const findIds = new Set(findResult.elements.map((e) => e.id));
    for (const id of ids) {
      expect(findIds.has(id), `find must include "${id}"`).toBe(true);
    }
  });
});

describe('applyCanonicalFindFilter · unit semantics', () => {
  it('no criteria → identity (returns all elements)', () => {
    const elements = [{ id: 'a' }, { id: 'b', type: 'button' }];
    expect(applyCanonicalFindFilter(elements)).toEqual(elements);
    expect(applyCanonicalFindFilter(elements, {})).toEqual(elements);
  });

  it('include_hidden defaults to TRUE — hidden elements are kept', () => {
    const elements = [
      { id: 'visible', state: { visible: true } },
      { id: 'hidden', state: { visible: false } },
    ];
    const ids = applyCanonicalFindFilter(elements, {}).map((e) => e.id);
    expect(ids).toEqual(['visible', 'hidden']);
  });

  it('include_hidden:false drops serialized elements with state.visible === false', () => {
    const elements = [
      { id: 'visible', state: { visible: true } },
      { id: 'hidden', state: { visible: false } },
      { id: 'unknown-visibility' }, // no signal → kept (unknown ≠ hidden)
    ];
    const ids = applyCanonicalFindFilter(elements, { include_hidden: false }).map((e) => e.id);
    expect(ids).toEqual(['visible', 'unknown-visibility']);
  });

  it('include_hidden:false uses the live DOM check when a node is attached', () => {
    // jsdom: offsetParent is null for all elements (no layout), so only the
    // position:fixed escape hatch keeps a DOM-attached element.
    const fixedEl = document.createElement('button');
    fixedEl.style.position = 'fixed';
    document.body.appendChild(fixedEl);
    const staticEl = document.createElement('button');
    document.body.appendChild(staticEl);
    try {
      const elements = [
        { id: 'fixed', element: fixedEl },
        { id: 'static', element: staticEl },
      ];
      const ids = applyCanonicalFindFilter(elements, { include_hidden: false }).map((e) => e.id);
      expect(ids).toEqual(['fixed']);
    } finally {
      document.body.removeChild(fixedEl);
      document.body.removeChild(staticEl);
    }
  });

  it('interactive_only uses the unified 11-type superset (switch/tab/slider/menuitem included)', () => {
    for (const type of ['switch', 'tab', 'slider', 'menuitem']) {
      expect(INTERACTIVE_ELEMENT_TYPES.has(type), `${type} must be interactive`).toBe(true);
    }
    const elements = [
      { id: 'sw', type: 'switch', actions: [] as string[] },
      { id: 'btn', type: 'button', actions: [] as string[] },
      { id: 'plain', type: 'generic', actions: [] as string[] },
      { id: 'actionable', type: 'generic', actions: ['click'] },
      { id: 'content', type: 'generic', kind: 'content', actions: ['click'] },
      { id: 'content-cat', type: 'generic', category: 'content', actions: ['click'] },
    ];
    const ids = applyCanonicalFindFilter(elements, { interactive_only: true }).map((e) => e.id);
    expect(ids).toEqual(['sw', 'btn', 'actionable']);
  });

  it('accepts camelCase aliases (interactiveOnly / includeHidden)', () => {
    const elements = [
      { id: 'btn', type: 'button', state: { visible: false } },
      { id: 'plain', type: 'generic', actions: [] as string[], state: { visible: true } },
    ];
    expect(applyCanonicalFindFilter(elements, { interactiveOnly: true }).map((e) => e.id)).toEqual([
      'btn',
    ]);
    expect(applyCanonicalFindFilter(elements, { includeHidden: false }).map((e) => e.id)).toEqual([
      'plain',
    ]);
  });

  it('filters by element_type (with legacy `type` alias), types, role, label, text, exact_text, testId', () => {
    const elements = [
      {
        id: 'save-btn',
        type: 'button' as ElementType,
        label: 'Save settings',
        role: 'button',
        state: { textContent: 'Save settings' },
      },
      {
        id: 'cancel-link',
        type: 'link' as ElementType,
        label: 'Cancel',
        identifiers: { testId: 'cancel-x' },
        state: { textContent: 'Cancel' },
      },
    ];
    expect(applyCanonicalFindFilter(elements, { element_type: 'link' }).map((e) => e.id)).toEqual([
      'cancel-link',
    ]);
    expect(applyCanonicalFindFilter(elements, { type: 'button' }).map((e) => e.id)).toEqual([
      'save-btn',
    ]);
    expect(applyCanonicalFindFilter(elements, { types: ['link'] }).map((e) => e.id)).toEqual([
      'cancel-link',
    ]);
    expect(applyCanonicalFindFilter(elements, { role: 'BUTTON' }).map((e) => e.id)).toEqual([
      'save-btn',
    ]);
    expect(applyCanonicalFindFilter(elements, { label: 'save' }).map((e) => e.id)).toEqual([
      'save-btn',
    ]);
    expect(applyCanonicalFindFilter(elements, { text: 'cancel' }).map((e) => e.id)).toEqual([
      'cancel-link',
    ]);
    expect(
      applyCanonicalFindFilter(elements, { exact_text: 'save settings' }).map((e) => e.id)
    ).toEqual(['save-btn']);
    expect(applyCanonicalFindFilter(elements, { testId: 'cancel-x' }).map((e) => e.id)).toEqual([
      'cancel-link',
    ]);
  });
});
