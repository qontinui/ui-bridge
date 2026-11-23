/**
 * `GET /ai/analyze/data` through the direct handler.
 *
 * Plan 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change,
 * Phase 0. `createHandlers(…).analyzePageData()` snapshots the registry and
 * runs `extractPageData`, which classifies and normalises each value. A page
 * that shows `16.10.2026` and `1.234,56` used to answer `phone` and `text`.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createHandlers, type RegistryLike } from '../../server/handlers';
import { resetGlobalRegistry, getGlobalRegistry } from '../../core/registry';

// jsdom ships no `document.elementFromPoint`; the registry's visibility
// hit-test no-ops when it is a plain function returning null.
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

describe('createHandlers(…).analyzePageData()', () => {
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

  it('answers a dotted date as a date and a decimal-comma number as a number', async () => {
    const reg = getGlobalRegistry();
    for (const [id, text] of [
      ['order-date', '16.10.2026'],
      ['order-total', '1.234,56'],
    ] as const) {
      const el = document.createElement('span');
      el.textContent = text;
      container.appendChild(el);
      reg.registerElement(id, el);
    }

    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never, {
      consoleCapture: null as never,
    });
    const resp = await handlers.analyzePageData();

    expect(resp.success).toBe(true);
    const byId = new Map(Object.values(resp.data!.values).map((v) => [v.elementId, v]));
    expect(byId.get('order-date')).toMatchObject({
      dataType: 'date',
      normalizedValue: '2026-10-16',
    });
    expect(byId.get('order-total')).toMatchObject({
      dataType: 'number',
      normalizedValue: '1234.56',
    });
  });
});
