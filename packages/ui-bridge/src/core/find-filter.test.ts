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
import { createHandlers, type RegistryLike } from '../server/handlers';
import { createActionExecutor } from '../control/action-executor';
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

  // The live-node arm (the old `offsetParent` / `position: fixed` check and its
  // rewrite as the canonical verdict) is pinned in the
  // `include_hidden:false reads the canonical visibility verdict` block below.

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

/**
 * `include_hidden: false` reads the ONE canonical visibility verdict — plan
 * `2026-11-24-ui-bridge-find-visibility-and-fallback-label-read-the-canonical-verdicts`,
 * D1/D2 (plan-library edge ed3caaac).
 *
 * The filter used to judge a live node by `offsetParent !== null ||
 * position === 'fixed'`, a fifth `visible` algorithm: an occluded or
 * off-screen element survived a visible-only find while the row it returned
 * said `visible: false`, and a `display:none` element inside a fixed container
 * passed. jsdom has no layout, `offsetParent` or `elementFromPoint`; all three
 * are stubbed as in `server/dom-fallback.visible.test.ts`. `offsetParent` is
 * set on every placed node, so the OLD check would have kept each of them.
 */
describe('include_hidden:false reads the canonical visibility verdict', () => {
  interface Box {
    el: HTMLElement;
    rect: { x: number; y: number; w: number; h: number };
  }
  /** Later in this array = painted on top. */
  let boxes: Box[] = [];
  const realElementFromPoint = document.elementFromPoint;

  function place(
    el: HTMLElement,
    x: number,
    y: number,
    w: number,
    h: number,
    parent: HTMLElement = document.body
  ): HTMLElement {
    el.getBoundingClientRect = () =>
      ({
        x,
        y,
        width: w,
        height: h,
        top: y,
        left: x,
        right: x + w,
        bottom: y + h,
        toJSON: () => ({}),
      }) as DOMRect;
    Object.defineProperty(el, 'offsetParent', { configurable: true, get: () => document.body });
    if (!el.isConnected) parent.appendChild(el);
    boxes.push({ el, rect: { x, y, w, h } });
    return el;
  }

  function button(id: string, text = id): HTMLButtonElement {
    const el = document.createElement('button');
    el.id = id;
    el.textContent = text;
    return el;
  }

  /** An unregistered, non-interactive overlay painted over (0,0)-(200,60). */
  function cover(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'toast';
    return place(el, 0, 0, 200, 60);
  }

  const keptIds = (rows: Array<{ id: string }>) =>
    applyCanonicalFindFilter(rows, { include_hidden: false }).map((r) => r.id);

  beforeEach(() => {
    resetGlobalRegistry();
    document.body.innerHTML = '';
    boxes = [];
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true });
    document.elementFromPoint = ((px: number, py: number) => {
      for (let i = boxes.length - 1; i >= 0; i--) {
        const { el, rect } = boxes[i];
        if (!el.isConnected) continue;
        if (px >= rect.x && px < rect.x + rect.w && py >= rect.y && py < rect.y + rect.h) {
          return el;
        }
      }
      return null;
    }) as typeof document.elementFromPoint;
  });

  afterEach(() => {
    document.elementFromPoint = realElementFromPoint;
    document.body.innerHTML = '';
    resetGlobalRegistry();
  });

  describe('applyCanonicalFindFilter over live-node rows (no state)', () => {
    it('drops a node that has an offsetParent but is fully covered', () => {
      const covered = place(button('covered'), 0, 0, 80, 24);
      cover();
      expect(keptIds([{ id: 'covered', element: covered }])).toEqual([]);
    });

    it('drops a node whose real rect is below the viewport (off-screen)', () => {
      const below = place(button('below'), 0, 900, 80, 24);
      expect(keptIds([{ id: 'below', element: below }])).toEqual([]);
    });

    it('keeps a position:fixed node with an in-viewport rect, and keeps a clear static one', () => {
      // Rewritten from the old `position: fixed` escape-hatch test: a fixed
      // node is kept because its canonical verdict is visible, not because of
      // its `position`.
      const fixed = button('fixed');
      fixed.style.position = 'fixed';
      place(fixed, 10, 10, 80, 24);
      const clear = place(button('clear'), 100, 10, 80, 24);
      expect(
        keptIds([
          { id: 'fixed', element: fixed },
          { id: 'clear', element: clear },
        ])
      ).toEqual(['fixed', 'clear']);
    });

    it('drops a display:none node inside a position:fixed parent (the old check kept it)', () => {
      const parent = document.createElement('div');
      parent.style.position = 'fixed';
      place(parent, 0, 0, 300, 100);
      const child = button('hidden-child');
      child.style.position = 'fixed';
      child.style.display = 'none';
      place(child, 10, 10, 80, 24, parent);
      expect(keptIds([{ id: 'hidden-child', element: child }])).toEqual([]);
    });

    it('keeps a partially covered node (its canonical visible is true)', () => {
      // 100x50: wide enough for the nine-point probe; the overlay covers the
      // top-left corner only.
      const wide = place(button('wide'), 300, 300, 100, 50);
      const corner = document.createElement('div');
      place(corner, 300, 300, 20, 20);
      expect(keptIds([{ id: 'wide', element: wide }])).toEqual(['wide']);
    });
  });

  describe('precedence', () => {
    it('the row-owned state.visible wins over the live node, both ways', () => {
      const clear = place(button('clear'), 0, 100, 80, 24);
      const covered = place(button('covered'), 0, 0, 80, 24);
      cover();
      expect(
        keptIds([
          // Live node reads visible; the row says false: dropped.
          { id: 'row-says-hidden', element: clear, state: { visible: false } },
          // Live node reads occluded; the row says true: kept.
          { id: 'row-says-visible', element: covered, state: { visible: true } },
        ])
      ).toEqual(['row-says-visible']);
    });

    it('a row with no visibility signal at all is kept (unknown is not hidden)', () => {
      expect(keptIds([{ id: 'no-signal' }, { id: 'state-no-visible', state: {} }])).toEqual([
        'no-signal',
        'state-no-visible',
      ]);
    });

    it('a row with only a top-level visible uses it', () => {
      expect(
        keptIds([
          { id: 'top-false', visible: false },
          { id: 'top-true', visible: true },
        ])
      ).toEqual(['top-true']);
    });
  });

  describe('end to end', () => {
    function registryLike(): RegistryLike {
      const reg = getGlobalRegistry();
      return {
        getAllElements: () => reg.getAllElements(),
        getElement: (id) => reg.getElement(id),
        getAllComponents: () => reg.getAllComponents(),
        getComponent: (id) => reg.getComponent(id),
        createSnapshot: () => reg.createSnapshot() as ReturnType<RegistryLike['createSnapshot']>,
      };
    }

    interface FoundRow {
      id: string;
      visible?: boolean;
      state?: { visible?: boolean; visibilityReason?: string };
    }

    it('createHandlers find, empty registry: an occluded fallback button is dropped by include_hidden:false and reported occluded by {}', async () => {
      place(button('covered', 'Covered'), 0, 0, 80, 24);
      place(button('clear', 'Clear'), 0, 100, 80, 24);
      cover();
      const handlers = createHandlers(registryLike(), createActionExecutor(getGlobalRegistry()));
      expect(getGlobalRegistry().getAllElements()).toHaveLength(0);

      const hiddenOff = await handlers.find({ skipSettle: true, include_hidden: false } as never);
      expect(hiddenOff.success).toBe(true);
      const offRows = (hiddenOff.data as unknown as { elements: FoundRow[] }).elements;
      expect(offRows.map((r) => r.id)).toEqual(['dom-clear']);

      const all = await handlers.find({ skipSettle: true } as never);
      const rows = (all.data as unknown as { elements: FoundRow[] }).elements;
      const coveredRow = rows.find((r) => r.id === 'dom-covered')!;
      expect(coveredRow.visible).toBe(false);
      expect(coveredRow.state?.visibilityReason).toBe('occluded');
      expect(rows.map((r) => r.id)).toEqual(['dom-covered', 'dom-clear']);
    });

    it('React find command: a registered element whose live node is occluded or off-screen is dropped by includeHidden:false', async () => {
      const registry = getGlobalRegistry();
      const covered = place(button('covered'), 0, 0, 80, 24);
      const below = place(button('below'), 0, 900, 80, 24);
      const clear = place(button('clear'), 0, 100, 80, 24);
      cover();
      registry.registerElement('covered', covered, { type: 'button', label: 'Covered' });
      registry.registerElement('below', below, { type: 'button', label: 'Below' });
      registry.registerElement('clear', clear, { type: 'button', label: 'Clear' });

      const visibleOnly = (await executeCommand('find', { includeHidden: false }, emptyBridge)) as {
        elements: FoundRow[];
      };
      expect(visibleOnly.elements.map((e) => e.id)).toEqual(['clear']);

      const all = (await executeCommand('find', {}, emptyBridge)) as { elements: FoundRow[] };
      expect(all.elements.map((e) => e.id).sort()).toEqual(['below', 'clear', 'covered']);
    });
  });
});
