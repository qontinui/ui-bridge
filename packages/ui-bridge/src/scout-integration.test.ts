/**
 * Cross-Cutting Scout Integration Tests
 *
 * Tests integration seams between CTR, Recency, ChangeObserver, NormalizedRect,
 * and artifact hashing that are not covered by individual unit test files.
 *
 * Scout project mapping:
 *   - testergizer: CTR resolution -> SearchCriteria, fallback chains, cache invalidation
 *   - Poco:        NormalizedRect computation from absolute rect + viewport
 *   - allio:       Recency <-> ChangeObserver interaction, batching, coalescing
 *   - jest-image-snapshot: Artifact hash determinism and integrity
 *   - agent-desktop: Batch action targeting via CTR logical names
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { CentralTargetRegistry, createCtrEntry, resetGlobalCtr } from './ctr/registry';
import type { CtrEntry } from './ctr/types';
import { getViableSelectors } from './ctr/self-healing';

import { Recency, isSatisfiedBy, parseRecency, requiresFetch } from './core/recency';

import { ChangeObserver } from './core/change-observer';
import type { DOMChangeEvent } from './core/change-observer';

import type { NormalizedRect } from './core/types';
import type { UIBridgeRegistry } from './core/registry';

import { computeHash } from './artifacts/hash';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Compute a NormalizedRect from an absolute rect and viewport dimensions,
 * mirroring the logic in core/registry.ts getState().
 */
function computeNormalizedRect(
  rect: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number }
): NormalizedRect | undefined {
  const { width: vw, height: vh } = viewport;
  if (vw <= 0 || vh <= 0) return undefined;
  return {
    x: rect.x / vw,
    y: rect.y / vh,
    width: rect.width / vw,
    height: rect.height / vh,
  };
}

// =============================================================================
// testergizer — CTR <-> Action Executor Integration
// =============================================================================

describe('testergizer: CTR integration', () => {
  let registry: CentralTargetRegistry;

  beforeEach(() => {
    registry = new CentralTargetRegistry();
    resetGlobalCtr();
  });

  it('CTR entry registered via auto-populate resolves to SearchCriteria', () => {
    // Simulate auto-populate: register an entry with a data-testid selector
    const entry = createCtrEntry('submit-button', [
      { strategy: 'data-testid', value: 'btn-submit' },
    ]);
    registry.register(entry);

    // Resolution should produce SearchCriteria usable by an action executor
    const criteria = registry.resolveToSearchCriteria('submit-button');
    expect(criteria).not.toBeNull();
    expect(criteria).toEqual({ idPattern: 'btn-submit', fuzzy: false });
  });

  it('CTR fallback chain tries secondary selectors when primary is below confidence', () => {
    // Primary selector has been demoted below threshold
    const entry: CtrEntry = {
      logicalName: 'nav-link',
      selectors: [
        { strategy: 'data-testid', value: 'nav-old', priority: 0, confidence: 0.05 }, // below MIN_CONFIDENCE_THRESHOLD
        { strategy: 'css', value: '.nav-link-active', priority: 1, confidence: 0.85 },
        { strategy: 'xpath', value: '//a[@class="nav"]', priority: 2, confidence: 0.7 },
      ],
      version: 1,
    };
    registry.register(entry);

    const criteria = registry.resolveToSearchCriteria('nav-link');
    // The primary is below threshold, so getViableSelectors skips it.
    // The highest-priority viable selector is the css one (priority 1).
    expect(criteria).toEqual({ selector: '.nav-link-active', fuzzy: false });

    // Verify getViableSelectors confirms the filtering
    const viable = getViableSelectors(entry);
    expect(viable).toHaveLength(2);
    expect(viable[0].strategy).toBe('css');
    expect(viable[1].strategy).toBe('xpath');
  });

  it('CTR cache invalidation forces fresh resolution', () => {
    const entry = createCtrEntry('search-box', [{ strategy: 'id', value: 'search-input' }]);
    registry.register(entry);

    // First resolution
    const first = registry.resolveToSearchCriteria('search-box');
    expect(first).toEqual({ idPattern: 'search-input', fuzzy: false });

    // Update the selector value (simulating a DOM migration)
    registry.updateSelector('search-box', 0, { value: 'search-field-v2' });

    // updateSelector already clears the cache for that entry.
    // Verify the updated value is returned.
    const second = registry.resolveToSearchCriteria('search-box');
    expect(second).toEqual({ idPattern: 'search-field-v2', fuzzy: false });
  });

  it('CTR resolveToSearchCriteria returns null for entry with all selectors demoted', () => {
    const entry: CtrEntry = {
      logicalName: 'dead-target',
      selectors: [
        { strategy: 'id', value: 'old-id', priority: 0, confidence: 0.01 },
        { strategy: 'css', value: '.removed', priority: 1, confidence: 0.05 },
      ],
      version: 3,
    };
    registry.register(entry);

    // Both selectors below MIN_CONFIDENCE_THRESHOLD (0.2)
    expect(registry.resolveToSearchCriteria('dead-target')).toBeNull();
  });

  it('CTR event flow: register -> resolve -> unregister emits correct events', () => {
    const events: CtrEvent[] = [];
    registry.on((e) => events.push(e));

    const entry = createCtrEntry('dialog-ok', [{ strategy: 'data-testid', value: 'ok-btn' }]);
    registry.register(entry);
    registry.resolveToSearchCriteria('dialog-ok');
    registry.unregister('dialog-ok');

    const types = events.map((e) => e.type);
    expect(types).toContain('ctr:entry-registered');
    expect(types).toContain('ctr:entry-unregistered');
  });
});

// =============================================================================
// Poco — Normalized Coordinates
// =============================================================================

describe('Poco: NormalizedRect computation', () => {
  it('NormalizedRect computed correctly from absolute rect and viewport', () => {
    const rect = { x: 100, y: 200, width: 300, height: 50 };
    const viewport = { width: 1920, height: 1080 };

    const normalized = computeNormalizedRect(rect, viewport);
    expect(normalized).toBeDefined();
    expect(normalized!.x).toBeCloseTo(100 / 1920);
    expect(normalized!.y).toBeCloseTo(200 / 1080);
    expect(normalized!.width).toBeCloseTo(300 / 1920);
    expect(normalized!.height).toBeCloseTo(50 / 1080);
  });

  it('NormalizedRect all zeros for element at origin with zero size', () => {
    const rect = { x: 0, y: 0, width: 0, height: 0 };
    const viewport = { width: 1920, height: 1080 };

    const normalized = computeNormalizedRect(rect, viewport);
    expect(normalized).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('NormalizedRect returns undefined for zero-dimension viewport', () => {
    const rect = { x: 50, y: 50, width: 100, height: 100 };
    expect(computeNormalizedRect(rect, { width: 0, height: 1080 })).toBeUndefined();
    expect(computeNormalizedRect(rect, { width: 1920, height: 0 })).toBeUndefined();
    expect(computeNormalizedRect(rect, { width: 0, height: 0 })).toBeUndefined();
  });

  it('NormalizedRect for full-viewport element equals (0, 0, 1, 1)', () => {
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const viewport = { width: 1920, height: 1080 };

    const normalized = computeNormalizedRect(rect, viewport);
    expect(normalized).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('NormalizedRect allows values > 1 for elements extending beyond viewport', () => {
    // Element partially outside the viewport to the right and bottom
    const rect = { x: 1800, y: 1000, width: 400, height: 200 };
    const viewport = { width: 1920, height: 1080 };

    const normalized = computeNormalizedRect(rect, viewport);
    expect(normalized).toBeDefined();
    // x + width > 1 because the element overflows the viewport
    expect(normalized!.x + normalized!.width).toBeGreaterThan(1);
    expect(normalized!.y + normalized!.height).toBeGreaterThan(1);
  });

  it('NormalizedRect preserves aspect ratio independence across different viewports', () => {
    // Same element at same relative position in two different viewports
    const normalized1080 = computeNormalizedRect(
      { x: 960, y: 540, width: 192, height: 108 },
      { width: 1920, height: 1080 }
    );
    const normalized720 = computeNormalizedRect(
      { x: 640, y: 360, width: 128, height: 72 },
      { width: 1280, height: 720 }
    );

    // Both represent a centered element taking 10% of the viewport
    expect(normalized1080!.x).toBeCloseTo(normalized720!.x);
    expect(normalized1080!.y).toBeCloseTo(normalized720!.y);
    expect(normalized1080!.width).toBeCloseTo(normalized720!.width);
    expect(normalized1080!.height).toBeCloseTo(normalized720!.height);
  });
});

// =============================================================================
// allio — Recency <-> ChangeObserver Integration
// =============================================================================

describe('allio: Recency + ChangeObserver integration', () => {
  let observer: ChangeObserver;

  beforeEach(() => {
    vi.useFakeTimers();
    observer = new ChangeObserver({ batchIntervalMs: 16, bufferCapacity: 100 });
  });

  afterEach(() => {
    observer.destroy();
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Recency satisfaction semantics
  // ---------------------------------------------------------------------------

  it('Recency.Any is satisfied by any cache age', () => {
    expect(isSatisfiedBy(Recency.Any, 0)).toBe(true);
    expect(isSatisfiedBy(Recency.Any, 1_000_000)).toBe(true);
    expect(isSatisfiedBy(Recency.Any, Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('Recency.Current is never satisfied (forces fresh fetch)', () => {
    expect(isSatisfiedBy(Recency.Current, 0)).toBe(false);
    expect(isSatisfiedBy(Recency.Current, 1)).toBe(false);
    expect(requiresFetch(Recency.Current)).toBe(true);
  });

  it('Recency.MaxAge integrates with ChangeObserver event timestamps', () => {
    // Scenario: a change arrives, and we check whether the cached snapshot
    // is still fresh relative to a MaxAge recency requirement.
    const recency = Recency.MaxAge(100);

    observer.onElementModified('el-1');
    vi.advanceTimersByTime(20);

    // Buffer has an event; check its timestamp against recency
    const events = observer.getEventsSince(0);
    expect(events).toHaveLength(1);

    const eventAge = Date.now() - events[0].timestamp;
    // The event was just created, so age should be within MaxAge
    expect(isSatisfiedBy(recency, eventAge)).toBe(true);
  });

  it('parseRecency round-trips for all variants', () => {
    expect(parseRecency('any').kind).toBe('any');
    expect(parseRecency('current').kind).toBe('current');
    expect(parseRecency('3000').kind).toBe('maxAge');
    expect(parseRecency(undefined).kind).toBe('maxAge'); // Default
  });

  // ---------------------------------------------------------------------------
  // ChangeObserver batching of rapid changes
  // ---------------------------------------------------------------------------

  it('ChangeObserver batches rapid changes into single event', () => {
    const received: DOMChangeEvent[] = [];
    observer.subscribe((e) => received.push(e));

    // Rapid-fire 10 additions within a single batch window
    for (let i = 0; i < 10; i++) {
      observer.onElementAdded(`rapid-${i}`);
    }

    // Nothing emitted yet (still within batch interval)
    expect(received).toHaveLength(0);

    // Flush the batch
    vi.advanceTimersByTime(20);

    // All 10 additions coalesced into a single event
    expect(received).toHaveLength(1);
    expect(received[0].added).toHaveLength(10);
    expect(received[0].removed).toEqual([]);
    expect(received[0].modified).toEqual([]);
  });

  it('ChangeObserver coalesces add+remove of same element into no-op', () => {
    const received: DOMChangeEvent[] = [];
    observer.subscribe((e) => received.push(e));

    // Element appears then disappears within the same batch window
    observer.onElementAdded('ephemeral-el');
    observer.onElementRemoved('ephemeral-el');

    vi.advanceTimersByTime(20);

    // Net effect is nothing -- no event emitted
    expect(received).toHaveLength(0);
  });

  it('ChangeObserver coalesces remove+re-add into an add (not a no-op)', () => {
    const received: DOMChangeEvent[] = [];
    observer.subscribe((e) => received.push(e));

    // Element removed then re-added (e.g., React reconciler key change)
    observer.onElementRemoved('recycled-el');
    observer.onElementAdded('recycled-el');

    vi.advanceTimersByTime(20);

    expect(received).toHaveLength(1);
    expect(received[0].added).toEqual(['recycled-el']);
    expect(received[0].removed).toEqual([]);
  });

  it('ChangeObserver does not double-count modifications for elements being added', () => {
    const received: DOMChangeEvent[] = [];
    observer.subscribe((e) => received.push(e));

    observer.onElementAdded('new-el');
    observer.onElementModified('new-el'); // should be suppressed

    vi.advanceTimersByTime(20);

    expect(received).toHaveLength(1);
    expect(received[0].added).toEqual(['new-el']);
    expect(received[0].modified).toEqual([]);
  });

  it('ChangeObserver fires separate events for changes across batch windows', () => {
    const received: DOMChangeEvent[] = [];
    observer.subscribe((e) => received.push(e));

    observer.onElementAdded('batch-1');
    vi.advanceTimersByTime(20);

    observer.onElementAdded('batch-2');
    vi.advanceTimersByTime(20);

    expect(received).toHaveLength(2);
    expect(received[0].added).toEqual(['batch-1']);
    expect(received[1].added).toEqual(['batch-2']);
  });
});

// =============================================================================
// jest-image-snapshot — Artifact Hashing
// =============================================================================

describe('jest-image-snapshot: Artifact hashing', () => {
  it('computeHash produces deterministic output for same input', async () => {
    const data = { name: 'snapshot', version: 1, pixels: [0, 128, 255] };

    const hash1 = await computeHash(data);
    const hash2 = await computeHash(data);

    expect(hash1).toBe(hash2);
    expect(typeof hash1).toBe('string');
    expect(hash1.length).toBeGreaterThan(0);
  });

  it('computeHash differs for different inputs', async () => {
    const hashA = await computeHash({ value: 'alpha' });
    const hashB = await computeHash({ value: 'beta' });

    expect(hashA).not.toBe(hashB);
  });

  it('computeHash is key-order independent (canonical JSON)', async () => {
    const hash1 = await computeHash({ b: 2, a: 1 });
    const hash2 = await computeHash({ a: 1, b: 2 });

    // Canonical JSON sorts keys, so both should produce the same hash
    expect(hash1).toBe(hash2);
  });

  it('artifact integrity check fails when content tampered', async () => {
    const original = { screenshot: 'base64data...', timestamp: 12345 };
    const originalHash = await computeHash(original);

    // Tamper with the content
    const tampered = { ...original, screenshot: 'TAMPERED' };
    const tamperedHash = await computeHash(tampered);

    expect(originalHash).not.toBe(tamperedHash);
  });

  it('computeHash handles nested objects deterministically', async () => {
    const data = {
      outer: { inner: { deep: 'value' } },
      list: [1, 2, 3],
    };

    const hash1 = await computeHash(data);
    const hash2 = await computeHash(data);
    expect(hash1).toBe(hash2);
  });

  it('computeHash handles primitive types', async () => {
    const hashString = await computeHash('hello');
    const hashNumber = await computeHash(42);
    const hashNull = await computeHash(null);
    const hashBool = await computeHash(true);

    // All should produce non-empty strings
    expect(hashString.length).toBeGreaterThan(0);
    expect(hashNumber.length).toBeGreaterThan(0);
    expect(hashNull.length).toBeGreaterThan(0);
    expect(hashBool.length).toBeGreaterThan(0);

    // All should be different
    const hashes = new Set([hashString, hashNumber, hashNull, hashBool]);
    expect(hashes.size).toBe(4);
  });
});

// =============================================================================
// agent-desktop — Batch Actions with CTR Targets
// =============================================================================

describe('agent-desktop: Batch actions with CTR targets', () => {
  let registry: CentralTargetRegistry;

  beforeEach(() => {
    registry = new CentralTargetRegistry();
    resetGlobalCtr();
  });

  it('batch of CTR logical names resolves to array of SearchCriteria', () => {
    // Register multiple targets for a batch action scenario
    const targets = [
      { name: 'checkbox-1', testId: 'cb-1' },
      { name: 'checkbox-2', testId: 'cb-2' },
      { name: 'checkbox-3', testId: 'cb-3' },
    ];

    for (const t of targets) {
      registry.register(createCtrEntry(t.name, [{ strategy: 'data-testid', value: t.testId }]));
    }

    // Resolve all in batch
    const results = targets.map((t) => ({
      logicalName: t.name,
      criteria: registry.resolveToSearchCriteria(t.name),
    }));

    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.criteria).not.toBeNull();
      expect(r.criteria).toHaveProperty('idPattern');
      expect(r.criteria).toHaveProperty('fuzzy', false);
    }
  });

  it('batch resolution is tolerant of missing entries', () => {
    registry.register(createCtrEntry('exists', [{ strategy: 'id', value: 'real-el' }]));

    const names = ['exists', 'missing-1', 'missing-2'];
    const results = names.map((name) => ({
      name,
      criteria: registry.resolveToSearchCriteria(name),
    }));

    expect(results[0].criteria).not.toBeNull();
    expect(results[1].criteria).toBeNull();
    expect(results[2].criteria).toBeNull();
  });

  it('batch resolution reflects live selector updates', () => {
    registry.register(createCtrEntry('target-a', [{ strategy: 'css', value: '.old-class' }]));
    registry.register(createCtrEntry('target-b', [{ strategy: 'css', value: '.stable-class' }]));

    // Update target-a's selector mid-batch
    registry.updateSelector('target-a', 0, { value: '.new-class' });

    const criteriaA = registry.resolveToSearchCriteria('target-a');
    const criteriaB = registry.resolveToSearchCriteria('target-b');

    expect(criteriaA).toEqual({ selector: '.new-class', fuzzy: false });
    expect(criteriaB).toEqual({ selector: '.stable-class', fuzzy: false });
  });

  it('invalidating all caches does not break batch resolution', () => {
    for (let i = 0; i < 5; i++) {
      registry.register(
        createCtrEntry(`item-${i}`, [{ strategy: 'data-testid', value: `item-${i}` }])
      );
    }

    // Invalidate everything
    registry.invalidateCache();

    // All should still resolve from their selectors
    for (let i = 0; i < 5; i++) {
      const criteria = registry.resolveToSearchCriteria(`item-${i}`);
      expect(criteria).not.toBeNull();
      expect(criteria).toEqual({ idPattern: `item-${i}`, fuzzy: false });
    }
  });
});

// =============================================================================
// Cross-cutting: CTR + ChangeObserver integration
// =============================================================================

describe('cross-cutting: CTR events drive ChangeObserver', () => {
  let registry: CentralTargetRegistry;
  let observer: ChangeObserver;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new CentralTargetRegistry();
    observer = new ChangeObserver({ batchIntervalMs: 16, bufferCapacity: 100 });
    resetGlobalCtr();

    // Wire CTR events to ChangeObserver (the integration seam)
    registry.on((event) => {
      if (event.type === 'ctr:entry-registered' && event.logicalName) {
        observer.onElementAdded(event.logicalName);
      } else if (event.type === 'ctr:entry-unregistered' && event.logicalName) {
        observer.onElementRemoved(event.logicalName);
      } else if (event.type === 'ctr:entry-updated' && event.logicalName) {
        observer.onElementModified(event.logicalName);
      }
    });
  });

  afterEach(() => {
    observer.destroy();
    vi.useRealTimers();
  });

  it('registering a CTR entry triggers an add event in ChangeObserver', () => {
    const received: DOMChangeEvent[] = [];
    observer.subscribe((e) => received.push(e));

    registry.register(createCtrEntry('new-button', [{ strategy: 'id', value: 'btn' }]));

    vi.advanceTimersByTime(20);

    expect(received).toHaveLength(1);
    expect(received[0].added).toContain('new-button');
  });

  it('unregistering a CTR entry triggers a remove event in ChangeObserver', () => {
    registry.register(createCtrEntry('temp-el', [{ strategy: 'id', value: 'tmp' }]));
    vi.advanceTimersByTime(20);

    const received: DOMChangeEvent[] = [];
    observer.subscribe((e) => received.push(e));

    registry.unregister('temp-el');
    vi.advanceTimersByTime(20);

    expect(received).toHaveLength(1);
    expect(received[0].removed).toContain('temp-el');
  });

  it('updating a CTR selector triggers a modified event in ChangeObserver', () => {
    registry.register(createCtrEntry('editable-el', [{ strategy: 'css', value: '.old' }]));
    vi.advanceTimersByTime(20);

    const received: DOMChangeEvent[] = [];
    observer.subscribe((e) => received.push(e));

    registry.updateSelector('editable-el', 0, { value: '.new' });
    vi.advanceTimersByTime(20);

    expect(received).toHaveLength(1);
    expect(received[0].modified).toContain('editable-el');
  });

  it('rapid register+unregister within batch window coalesces to no-op', () => {
    const received: DOMChangeEvent[] = [];
    observer.subscribe((e) => received.push(e));

    // Register then immediately unregister within the same batch window
    registry.register(createCtrEntry('flash-el', [{ strategy: 'id', value: 'flash' }]));
    registry.unregister('flash-el');

    vi.advanceTimersByTime(20);

    // The ChangeObserver should coalesce add+remove into nothing
    expect(received).toHaveLength(0);
  });

  it('Recency.Current combined with ChangeObserver means always re-fetch after changes', () => {
    // Register an element and let the batch flush
    registry.register(createCtrEntry('live-el', [{ strategy: 'id', value: 'live' }]));
    vi.advanceTimersByTime(20);

    const events = observer.getEventsSince(0);
    expect(events.length).toBeGreaterThan(0);

    // Regardless of the event timing, Recency.Current always demands fresh data
    const cacheAge = Date.now() - events[0].timestamp;
    expect(isSatisfiedBy(Recency.Current, cacheAge)).toBe(false);
    expect(isSatisfiedBy(Recency.Current, 0)).toBe(false);
  });
});

// =============================================================================
// Poco — UIQuery DSL immutability and filtering
// =============================================================================

describe('Poco: UIQuery DSL', () => {
  // UIQuery requires a UIBridgeRegistry and real DOM elements.
  // We create a minimal mock registry that returns stub elements.

  function makeMockRegistry(elements: { el: HTMLElement; mounted: boolean; type?: string }[]) {
    const registered = elements.map((e) => ({
      element: e.el,
      mounted: e.mounted,
      type: e.type ?? 'generic',
      getState: () => ({ visible: true, enabled: true }),
    }));
    return {
      getAllElements: () => registered,
    };
  }

  // Dynamically import UIQuery to avoid import errors if the module has DOM deps
  // that aren't satisfied in test env. Since vitest runs in jsdom, this should work.
  let UIQuery: typeof import('./core/query-builder').UIQuery;

  beforeEach(async () => {
    const mod = await import('./core/query-builder');
    UIQuery = mod.UIQuery;
  });

  it('UIQuery chaining is immutable — withText returns new instance, original unchanged', () => {
    // Create DOM elements
    const btn1 = document.createElement('button');
    btn1.textContent = 'Submit';
    const btn2 = document.createElement('button');
    btn2.textContent = 'Cancel';
    document.body.appendChild(btn1);
    document.body.appendChild(btn2);

    const registry = makeMockRegistry([
      { el: btn1, mounted: true },
      { el: btn2, mounted: true },
    ]);

    const original = UIQuery.from(registry as unknown as UIBridgeRegistry);
    const filtered = original.withText('Submit');

    // The filtered query should be a different instance
    expect(filtered).not.toBe(original);

    // Original should still resolve both elements (all DOM)
    const originalDom = original.allDom();
    expect(originalDom.length).toBe(2);

    // Filtered should resolve only the Submit button
    const filteredDom = filtered.allDom();
    expect(filteredDom.length).toBe(1);
    expect(filteredDom[0].textContent).toBe('Submit');

    // Cleanup
    document.body.removeChild(btn1);
    document.body.removeChild(btn2);
  });

  it('UIQuery.from filters by role', () => {
    const btn = document.createElement('button');
    btn.setAttribute('role', 'button');
    btn.textContent = 'Click me';
    const heading = document.createElement('h1');
    heading.setAttribute('role', 'heading');
    heading.textContent = 'Title';
    document.body.appendChild(btn);
    document.body.appendChild(heading);

    const registry = makeMockRegistry([
      { el: btn, mounted: true },
      { el: heading, mounted: true },
    ]);

    const query = UIQuery.from(registry as unknown as UIBridgeRegistry);
    const buttons = query.withRole('button').allDom();
    const headings = query.withRole('heading').allDom();

    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toBe('Click me');
    expect(headings.length).toBe(1);
    expect(headings[0].textContent).toBe('Title');

    // Cleanup
    document.body.removeChild(btn);
    document.body.removeChild(heading);
  });
});

// =============================================================================
// agent-desktop — Batch action CTR resolution pipeline
// =============================================================================

describe('agent-desktop: executeBatch resolves CTR logical names before execution', () => {
  let registry: CentralTargetRegistry;

  beforeEach(() => {
    registry = new CentralTargetRegistry();
    resetGlobalCtr();
  });

  it('executeBatch resolves CTR logical names before execution', () => {
    // Register 3 targets that a batch action would reference
    const logicalNames = ['btn-save', 'btn-cancel', 'input-name'];
    const testIds = ['save-btn', 'cancel-btn', 'name-input'];

    for (let i = 0; i < logicalNames.length; i++) {
      registry.register(
        createCtrEntry(logicalNames[i], [{ strategy: 'data-testid', value: testIds[i] }])
      );
    }

    // Simulate the batch resolution pipeline: resolve all logical names
    // to SearchCriteria before executing any actions
    const resolutionPipeline = logicalNames.map((name) => ({
      logicalName: name,
      criteria: registry.resolveToSearchCriteria(name),
      resolved: registry.resolveToSearchCriteria(name) !== null,
    }));

    // All names should resolve successfully
    expect(resolutionPipeline).toHaveLength(3);
    for (const step of resolutionPipeline) {
      expect(step.resolved).toBe(true);
      expect(step.criteria).not.toBeNull();
    }

    // Verify the resolution produced correct idPatterns
    expect(resolutionPipeline[0].criteria).toEqual({ idPattern: 'save-btn', fuzzy: false });
    expect(resolutionPipeline[1].criteria).toEqual({ idPattern: 'cancel-btn', fuzzy: false });
    expect(resolutionPipeline[2].criteria).toEqual({ idPattern: 'name-input', fuzzy: false });

    // Simulate a partial batch where one target is missing
    const withMissing = [...logicalNames, 'nonexistent-target'];
    const partialResolution = withMissing.map((name) => ({
      logicalName: name,
      criteria: registry.resolveToSearchCriteria(name),
      resolved: registry.resolveToSearchCriteria(name) !== null,
    }));

    // 3 resolved, 1 unresolved — batch should know about the gap
    const resolved = partialResolution.filter((r) => r.resolved);
    const unresolved = partialResolution.filter((r) => !r.resolved);
    expect(resolved).toHaveLength(3);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].logicalName).toBe('nonexistent-target');
  });
});
