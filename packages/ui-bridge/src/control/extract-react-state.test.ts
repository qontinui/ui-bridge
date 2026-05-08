import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractReactState } from './action-executor';

/**
 * Regression tests for the `extractReactState` IPC-timeout bug surfaced by
 * the runner's `/ui-bridge/control/element/{id}/react-state` smoke test on
 * 2026-05-07 (qontinui-runner branch built from main commit `9f941d2c0`).
 *
 * Symptom: every call timed out at 10s with "UI Bridge request timed out
 * after 10000ms. Is the frontend running?" — even though the sibling
 * `get_element_state` handler responded fine within milliseconds.
 *
 * Root cause: `safeSerialize` walked recursively without a depth cap and
 * without a DOM-node short-circuit. A React `useContext` hook whose
 * memoizedState pointed at a Bridge-style value (registry of registered
 * elements, each carrying a real `HTMLElement`) caused the walk to descend
 * through every element's `__reactFiber$` back-references into the entire
 * parent fiber tree. The WeakSet eventually broke the cycle but the fanout
 * blew the IPC timeout before `extractReactState` ever returned.
 */

interface FakeFiber {
  type: unknown;
  memoizedState: { memoizedState: unknown; next: FakeFiber['memoizedState'] | null } | null;
  return?: FakeFiber;
}

function attachFiber(el: HTMLElement, fiber: FakeFiber, props: Record<string, unknown> = {}): void {
  Object.defineProperty(el, '__reactFiber$test', { value: fiber, enumerable: true });
  Object.defineProperty(el, '__reactProps$test', { value: props, enumerable: true });
}

describe('extractReactState — termination guards', () => {
  let element: HTMLDivElement;

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  it('returns null when no React internals are present', () => {
    expect(extractReactState(element)).toBeNull();
  });

  it('terminates within 100ms on deeply-nested fiber memoizedState', () => {
    let deep: Record<string, unknown> = { value: 'leaf' };
    for (let i = 0; i < 50; i++) {
      deep = { nested: deep };
    }
    const fiber: FakeFiber = {
      type: function MyComponent() {
        return null;
      },
      memoizedState: { memoizedState: deep, next: null },
    };
    attachFiber(element, fiber);

    const start = Date.now();
    const result = extractReactState(element);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100);
    expect(result).not.toBeNull();
    expect(result?.componentName).toBe('MyComponent');
    expect(result?.fiberState).toHaveLength(1);

    let cur: unknown = result?.fiberState[0];
    let depthSeen = 0;
    while (
      cur !== null &&
      typeof cur === 'object' &&
      'nested' in (cur as Record<string, unknown>) &&
      typeof (cur as Record<string, unknown>).nested === 'object'
    ) {
      cur = (cur as Record<string, unknown>).nested;
      depthSeen++;
      if (depthSeen > 10) break;
    }
    expect(depthSeen).toBeLessThanOrEqual(7);
    expect(cur === '[MaxDepth]' || (typeof cur === 'object' && (cur as Record<string, unknown>).nested === '[MaxDepth]')).toBe(true);
  });

  it('short-circuits DOM Element references in fiber state', () => {
    const otherElement = document.createElement('span');
    otherElement.id = 'other';
    Object.defineProperty(otherElement, '__reactFiber$test', {
      value: { huge: 'pretend this references a parent fiber tree' },
      enumerable: true,
    });

    const fiber: FakeFiber = {
      type: function Comp() {
        return null;
      },
      memoizedState: {
        memoizedState: { someRef: { current: otherElement } },
        next: null,
      },
    };
    attachFiber(element, fiber);

    const result = extractReactState(element);
    expect(result).not.toBeNull();
    const state = result?.fiberState[0] as { someRef: { current: unknown } };
    expect(state.someRef.current).toBe('[HTMLSpanElement]');
  });

  it('still returns props and componentName for normal hook state', () => {
    const fiber: FakeFiber = {
      type: function MyButton() {
        return null;
      },
      memoizedState: {
        memoizedState: { count: 3, label: 'click me' },
        next: { memoizedState: 'second hook value', next: null },
      },
    };
    attachFiber(element, fiber, { 'data-testid': 'btn', onClick: () => undefined });

    const result = extractReactState(element);
    expect(result?.componentName).toBe('MyButton');
    expect(result?.fiberState).toEqual([
      { count: 3, label: 'click me' },
      'second hook value',
    ]);
    expect(result?.props).toMatchObject({ 'data-testid': 'btn', onClick: '[Function]' });
  });
});
