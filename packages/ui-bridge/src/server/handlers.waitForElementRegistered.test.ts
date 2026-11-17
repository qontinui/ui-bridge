/**
 * Server-side `waitForElementRegistered` — the `selector` arm of the registry
 * match.
 *
 * Regression for a selector-only predicate matching the FIRST registered
 * element whatever it was, because `predicateMatches` ignored `selector`
 * (measured 2026-11-17 against qontinui.io; coord finding 9610b171). The
 * browser-side twin is covered in `../react/commandHandlers.waitForElement.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { getGlobalRegistry, resetGlobalRegistry } from '../core/registry';

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

function makeHandlers() {
  return createHandlers(
    makeRegistryLike(),
    {
      executeAction: async () => ({ success: true }),
      executeComponentAction: async () => ({ success: true }),
    } as never,
    { consoleCapture: null as never }
  );
}

type WaitData = { element?: { id?: string }; reason?: string };

describe('waitForElementRegistered (server-side) · selector arm', () => {
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

  function register(id: string, el: HTMLElement, label: string) {
    container.appendChild(el);
    getGlobalRegistry().registerElement(id, el, { label });
  }

  it('does not satisfy a selector-only predicate with an unrelated registered element', async () => {
    register('button-give-feedback-0', document.createElement('button'), 'Give Feedback');

    const resp = await makeHandlers().waitForElementRegistered({
      predicate: { selector: '[data-testid="doc-row-x"]' },
      timeoutMs: 150,
    });

    const data = resp.data as WaitData;
    expect(data.element).toBeUndefined();
    expect(data.reason).toBe('timeout');
  });

  it('returns the registered element a selector-only predicate matches, by its registry id', async () => {
    register('unrelated-btn', document.createElement('button'), 'Other');
    const row = document.createElement('div');
    row.setAttribute('data-testid', 'doc-row-x');
    register('doc-row-x', row, 'Doc row');

    const resp = await makeHandlers().waitForElementRegistered({
      predicate: { selector: '[data-testid="doc-row-x"]' },
      timeoutMs: 500,
    });

    const data = resp.data as WaitData;
    expect(data.reason).toBeUndefined();
    expect(data.element?.id).toBe('doc-row-x');
  });

  it('keeps selector as a fallback beside id: a descendant selector still resolves the registered element', async () => {
    const row = document.createElement('div');
    row.setAttribute('data-testid', 'row-1');
    const title = document.createElement('span');
    title.className = 'title';
    row.appendChild(title);
    register('row-1', row, 'Row one');

    const resp = await makeHandlers().waitForElementRegistered({
      predicate: { id: 'row-1', selector: '[data-testid="row-1"] .title' },
      timeoutMs: 500,
    });

    const data = resp.data as WaitData;
    expect(data.reason).toBeUndefined();
    expect(data.element?.id).toBe('row-1');
  });

  it('treats an invalid selector as matching no registered element', async () => {
    register('any-btn', document.createElement('button'), 'Any');

    const resp = await makeHandlers().waitForElementRegistered({
      predicate: { selector: '[[[not-a-selector' },
      timeoutMs: 150,
    });

    const data = resp.data as WaitData;
    expect(data.element).toBeUndefined();
    expect(data.reason).toBe('timeout');
  });
});
