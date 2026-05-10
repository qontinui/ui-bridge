/**
 * Manual-test remediation 2026-05-10 (Item 2): `?withDisabledOnly=true`
 * filter on `getControlSnapshot`.
 *
 * Source: `plans/manual-test-remediation-2026-05-10.md`. The 2026-05-10
 * `/manual-test` session couldn't validate the 0.3.7 disabled-state click
 * pre-check because there was no efficient way to find a disabled element
 * via UI Bridge. This filter solves that — agents can now snapshot the
 * page filtered to disabled targets only, then click one to confirm the
 * pre-check refuses the action.
 *
 * Predicate: an element passes the filter if its `state` shows ANY of:
 *   - `disabled === true`            (legacy / plan-specified shape)
 *   - `ariaDisabled === "true"`      (aria-disabled passthrough)
 *   - `enabled === false`            (current SDK shape — `registry.ts`
 *                                     emits `enabled` not `disabled`).
 *
 * GET query params arrive as strings, so `'true'` and `'1'` both coerce
 * to truthy alongside the boolean. snake_case alias `with_disabled_only`
 * works the same way.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { resetGlobalRegistry, getGlobalRegistry } from '../core/registry';

// jsdom doesn't ship `document.elementFromPoint`; the registry's
// visibility hit-test gracefully no-ops when missing, but only if it's a
// plain undefined. Stub so non-zero-rect registered elements don't trip
// the check.
beforeAll(() => {
  if (typeof document !== 'undefined' && !document.elementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => null,
    });
  }
});

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

describe('getControlSnapshot · ?withDisabledOnly=true (Item 2)', () => {
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

  /**
   * Build a registry with three elements:
   *   - `disabled-btn`     — native HTMLButtonElement.disabled = true
   *   - `aria-disabled-btn` — aria-disabled="true" via attribute
   *   - `enabled-btn`      — neither; should be filtered OUT.
   * Returns the handlers harness so each test can call into the SDK
   * snapshot path with whatever query-param shape it cares about.
   */
  function setupMixedRegistry() {
    const reg = getGlobalRegistry();

    const disabled = document.createElement('button');
    disabled.disabled = true;
    container.appendChild(disabled);
    reg.registerElement('disabled-btn', disabled);

    const ariaDisabled = document.createElement('button');
    ariaDisabled.setAttribute('aria-disabled', 'true');
    container.appendChild(ariaDisabled);
    reg.registerElement('aria-disabled-btn', ariaDisabled);

    const enabled = document.createElement('button');
    container.appendChild(enabled);
    reg.registerElement('enabled-btn', enabled);

    return createHandlers(makeRegistryLike(), makeActionExecutor() as never, {
      consoleCapture: null as never,
    });
  }

  it('default (no flag) returns all three elements unchanged', async () => {
    const handlers = setupMixedRegistry();

    const resp = await handlers.getControlSnapshot();

    expect(resp.success).toBe(true);
    const ids = (resp.data!.elements as Array<{ id: string }>).map((e) => e.id).sort();
    expect(ids).toEqual(['aria-disabled-btn', 'disabled-btn', 'enabled-btn']);
  });

  it('withDisabledOnly:true keeps only the disabled + aria-disabled targets', async () => {
    const handlers = setupMixedRegistry();

    const resp = await handlers.getControlSnapshot({ withDisabledOnly: true });

    expect(resp.success).toBe(true);
    const ids = (resp.data!.elements as Array<{ id: string }>).map((e) => e.id).sort();
    expect(ids).toEqual(['aria-disabled-btn', 'disabled-btn']);
    expect(ids).not.toContain('enabled-btn');
  });

  it("?withDisabledOnly='true' (string) coerces the same as the boolean — GET path", async () => {
    const handlers = setupMixedRegistry();

    // Standalone server hands query params through as strings; the handler
    // must accept the string form, not just the boolean.
    const resp = await handlers.getControlSnapshot({ withDisabledOnly: 'true' });

    expect(resp.success).toBe(true);
    const ids = (resp.data!.elements as Array<{ id: string }>).map((e) => e.id).sort();
    expect(ids).toEqual(['aria-disabled-btn', 'disabled-btn']);
  });

  it("?withDisabledOnly='1' coerces as truthy", async () => {
    const handlers = setupMixedRegistry();

    const resp = await handlers.getControlSnapshot({ withDisabledOnly: '1' });

    expect(resp.success).toBe(true);
    const ids = (resp.data!.elements as Array<{ id: string }>).map((e) => e.id).sort();
    expect(ids).toEqual(['aria-disabled-btn', 'disabled-btn']);
  });

  it('snake_case `with_disabled_only` is honoured as an alias', async () => {
    const handlers = setupMixedRegistry();

    const resp = await handlers.getControlSnapshot({ with_disabled_only: 'true' });

    expect(resp.success).toBe(true);
    const ids = (resp.data!.elements as Array<{ id: string }>).map((e) => e.id).sort();
    expect(ids).toEqual(['aria-disabled-btn', 'disabled-btn']);
  });

  it('falsy/absent value preserves all elements (no accidental filter)', async () => {
    const handlers = setupMixedRegistry();

    const respFalse = await handlers.getControlSnapshot({ withDisabledOnly: false });
    expect(respFalse.success).toBe(true);
    expect(respFalse.data!.elements).toHaveLength(3);

    // 'false' string is rejected by the truthy parser — only 'true'/'1' pass.
    const respFalseStr = await handlers.getControlSnapshot({ withDisabledOnly: 'false' });
    expect(respFalseStr.success).toBe(true);
    expect(respFalseStr.data!.elements).toHaveLength(3);
  });

  it('preserves snapshot top-level metadata when filter applies', async () => {
    const handlers = setupMixedRegistry();

    const resp = await handlers.getControlSnapshot({ withDisabledOnly: true });

    // The filter is on `elements` only; everything else the snapshot emits
    // (registration counts, components array, workflows, route/page when
    // populated) must come through unchanged. Assert the structural keys
    // are still there so callers walking the snapshot post-filter don't
    // get a stripped-down shape.
    expect(resp.data).toHaveProperty('registration');
    expect(resp.data).toHaveProperty('components');
    expect(resp.data).toHaveProperty('workflows');
    // Elements got filtered, but the array itself is still present.
    expect(Array.isArray(resp.data!.elements)).toBe(true);
  });
});
