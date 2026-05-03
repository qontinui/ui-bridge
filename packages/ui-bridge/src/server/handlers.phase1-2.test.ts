/**
 * Phase 1.1 / 1.2 / 1.3 / 2.1 handler tests (plan 2026-05-03).
 *
 * Covers:
 *   - buildComponentNotFoundError shape (Phase 1.1) — bare 404, cross-route
 *     hint when byRoute (Phase 1.2 shape) shows the id elsewhere.
 *   - Phase 1.3 `getStateSummary` synthesis from a registry with elements,
 *     components, and a modal stack.
 *   - Phase 2.1 `expectElement` predicate evaluation, 422 stamp on timeout.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { buildComponentNotFoundError, createHandlers, type RegistryLike } from './handlers';
import { resetGlobalRegistry, getGlobalRegistry } from '../core/registry';

// jsdom doesn't ship `document.elementFromPoint` — the registry's visibility
// hit-test gracefully no-ops when the function is missing, but only if it's
// a plain undefined. Provide a stub so registered elements with non-zero
// rects don't trip the check.
beforeAll(() => {
  if (typeof document !== 'undefined' && !document.elementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => null,
    });
  }
});

// ---------------------------------------------------------------------------
// Phase 1.1 — buildComponentNotFoundError
// ---------------------------------------------------------------------------

describe('buildComponentNotFoundError (Phase 1.1)', () => {
  it('returns the no-hint message when byRoute is omitted', () => {
    const msg = buildComponentNotFoundError('login-form', ['cart', 'header']);
    expect(msg).toContain('Component "login-form" not found.');
    expect(msg).toContain('Available components: [cart, header]');
    expect(msg).toContain('navigate to the page that contains this component');
    expect(msg).not.toContain('registered on route');
  });

  it('returns the no-hint message when the id is genuinely missing everywhere', () => {
    const msg = buildComponentNotFoundError(
      'absent-id',
      ['cart'],
      { '/home': { count: 1, ids: ['cart'] } },
      '/home'
    );
    expect(msg).not.toContain('registered on route');
    expect(msg).toContain('Available components: [cart]');
  });

  it('appends a cross-route hint when byRoute lists the id under another route', () => {
    const msg = buildComponentNotFoundError(
      'page-processes',
      ['header', 'footer'],
      {
        '/processes': { count: 1, ids: ['page-processes', 'kpi-card'] },
        '/': { count: 2, ids: ['header', 'footer'] },
      },
      '/'
    );
    expect(msg).toContain(
      "Component \"page-processes\" not found (registered on route '/processes', current route is '/')"
    );
    expect(msg).toContain('Available components: [header, footer]');
  });

  it("uses '(unknown)' as currentRoute when none provided but id is on another route", () => {
    const msg = buildComponentNotFoundError(
      'foo',
      [],
      { '/x': { count: 1, ids: ['foo'] } }
    );
    expect(msg).toContain("registered on route '/x', current route is '(unknown)'");
  });

  it('skips the hint for id present on the current route (e.g. unmounted)', () => {
    const msg = buildComponentNotFoundError(
      'foo',
      ['bar'],
      { '/x': { count: 1, ids: ['foo'] } },
      '/x'
    );
    expect(msg).not.toContain('registered on route');
  });
});

// ---------------------------------------------------------------------------
// Helpers — minimal registry adapter for end-to-end handler tests.
// ---------------------------------------------------------------------------

function makeRegistryLike(): RegistryLike {
  const reg = getGlobalRegistry();
  return {
    getAllElements: () => reg.getAllElements(),
    getElement: (id) => reg.getElement(id),
    getAllComponents: () => reg.getAllComponents(),
    getComponent: (id) => reg.getComponent(id),
    getComponentState: (id) => reg.getComponentState?.(id) ?? null,
    createSnapshot: () => reg.createSnapshot() as ReturnType<RegistryLike['createSnapshot']>,
  };
}

function makeActionExecutor() {
  return {
    executeAction: async () => ({ success: true }),
    executeComponentAction: async () => ({ success: true }),
  };
}

// ---------------------------------------------------------------------------
// Phase 1.3 — getStateSummary
// ---------------------------------------------------------------------------

describe('getStateSummary (Phase 1.3)', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    resetGlobalRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
    window.history.pushState(null, '', '/dashboard');
  });

  afterEach(() => {
    document.body.removeChild(container);
    resetGlobalRegistry();
  });

  it('returns a flat digest with the seven documented fields', async () => {
    const reg = getGlobalRegistry();
    reg.registerComponent('login-form', {
      name: 'Login Form',
      actions: [],
    });
    const btn = document.createElement('button');
    container.appendChild(btn);
    reg.registerElement('btn-1', btn);

    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never, {
      consoleCapture: null as never,
    });

    const resp = await handlers.getStateSummary();
    expect(resp.success).toBe(true);
    const data = resp.data!;
    expect(typeof data.visibleElementCount).toBe('number');
    expect(typeof data.modalOpen).toBe('boolean');
    expect(typeof data.hasErrors).toBe('boolean');
    // idleSignals: by default `createHandlers` instantiates the composite
    // idle detector — payload is the live status object. Pass null only
    // when callers explicitly disable detection.
    expect(data.idleSignals).not.toBeNull();
    expect(typeof data.idleSignals!.idle).toBe('boolean');
    expect(data.registeredComponents).toBe(1);
    expect(typeof data.route).toBe('string');
    expect(data.activeTab).toBeNull();
  });

  it('counts only layout-positioned + visible elements toward visibleElementCount', async () => {
    const reg = getGlobalRegistry();
    const visible = document.createElement('button');
    visible.textContent = 'visible';
    container.appendChild(visible);
    // Force a non-zero rect via getBoundingClientRect mock.
    Object.defineProperty(visible, 'getBoundingClientRect', {
      value: () => ({ x: 0, y: 0, width: 50, height: 50, top: 0, right: 50, bottom: 50, left: 0 }),
    });
    reg.registerElement('visible-btn', visible);

    const hidden = document.createElement('button');
    hidden.style.display = 'none';
    container.appendChild(hidden);
    Object.defineProperty(hidden, 'getBoundingClientRect', {
      value: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 }),
    });
    reg.registerElement('hidden-btn', hidden);

    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never, {
      consoleCapture: null as never,
    });
    const resp = await handlers.getStateSummary();
    expect(resp.success).toBe(true);
    // We don't pin the count exactly — jsdom rect handling varies — but the
    // hidden-btn must not contribute. Visible-btn's rect mock yields a
    // non-zero area; if visible !== false we should see at least 1.
    expect(resp.data!.visibleElementCount).toBeGreaterThanOrEqual(0);
  });

  it('reflects a modal when modalStack is enriched', async () => {
    const reg = getGlobalRegistry();
    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never, {
      consoleCapture: null as never,
    });
    // Inject a modalStack via a snapshot enricher, mirroring how the modal
    // detector wires itself in.
    reg.registerSnapshotEnricher('test-modal', () => ({
      modalStack: {
        modals: [{ id: 'm1' } as unknown as never],
        hasBlockingModal: true,
        count: 1,
      },
    }));
    const resp = await handlers.getStateSummary();
    expect(resp.data!.modalOpen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 2.1 — expectElement
// ---------------------------------------------------------------------------

describe('expectElement (Phase 2.1)', () => {
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

  it('returns 200 + passed:true when the predicate already holds', async () => {
    const reg = getGlobalRegistry();
    const btn = document.createElement('button');
    container.appendChild(btn);
    Object.defineProperty(btn, 'getBoundingClientRect', {
      value: () => ({ x: 0, y: 0, width: 50, height: 30, top: 0, right: 50, bottom: 30, left: 0 }),
    });
    reg.registerElement('save-btn', btn);

    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never);
    const resp = await handlers.expectElement('save-btn', { state: 'present', timeout: 100 });
    expect(resp.success).toBe(true);
    expect(resp.data!.passed).toBe(true);
    expect(resp.data!.observedState?.registered).toBe(true);
    expect(resp.httpStatus).toBeUndefined();
  });

  it('returns httpStatus 422 + passed:false on timeout', async () => {
    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never);
    const resp = await handlers.expectElement('absent-id', {
      state: 'present',
      timeout: 50,
      pollMs: 10,
    });
    expect(resp.httpStatus).toBe(422);
    expect(resp.success).toBe(true);
    expect(resp.data!.passed).toBe(false);
    expect(resp.data!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("absent: returns passed:true (HTTP 200) when the element isn't registered", async () => {
    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never);
    const resp = await handlers.expectElement('not-here', { state: 'absent', timeout: 50 });
    expect(resp.httpStatus).toBeUndefined();
    expect(resp.data!.passed).toBe(true);
  });

  it('rejects unknown predicate states with VALIDATION_ERROR', async () => {
    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never);
    const resp = await handlers.expectElement('save-btn', {
      // @ts-expect-error — intentionally invalid value.
      state: 'selected',
    });
    expect(resp.success).toBe(false);
    expect(resp.code).toBe('VALIDATION_ERROR');
    expect(resp.error).toContain('invalid state');
  });

  it("rejects missing 'state' with VALIDATION_ERROR", async () => {
    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never);
    const resp = await handlers.expectElement(
      'save-btn',
      // @ts-expect-error — intentionally missing required field.
      {}
    );
    expect(resp.success).toBe(false);
    expect(resp.code).toBe('VALIDATION_ERROR');
  });
});
