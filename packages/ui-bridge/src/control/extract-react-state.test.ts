import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractReactState, FIBER_STATE_WITHHELD_NOTE } from './extract-react-state';

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
    expect(
      cur === '[MaxDepth]' ||
        (typeof cur === 'object' && (cur as Record<string, unknown>).nested === '[MaxDepth]')
    ).toBe(true);
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
    expect(result?.fiberState).toEqual([{ count: 3, label: 'click me' }, 'second hook value']);
    expect(result?.props).toMatchObject({ 'data-testid': 'btn', onClick: '[Function]' });
  });
});

/**
 * Review round 1, finding 1: a NON-redacted wrapper (`<label>`, `<form>`) must
 * not leak a redacted child's value through its own `props.children` (a React
 * element carrying the child's `props.value`) or through the state of the
 * component that renders both (`useState(pw)`).
 */
describe('extractReactState — a wrapper around a redacted element', () => {
  const SECRET = 'hunter2-s3cret';
  const REACT_ELEMENT = Symbol.for('react.element');

  function reactElement(type: string, props: Record<string, unknown>) {
    return { $$typeof: REACT_ELEMENT, type, key: null, ref: null, props, _owner: null };
  }

  /** A `LoginForm` component fiber holding `SECRET` in a useState hook. */
  function loginFormFiber(): FakeFiber & { child?: unknown } {
    return {
      type: function LoginForm() {
        return null;
      },
      memoizedState: { memoizedState: SECRET, next: null },
    };
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it.each([
    [
      'a password input',
      () => {
        const input = document.createElement('input');
        input.type = 'password';
        input.value = SECRET;
        return input;
      },
    ],
    [
      'a data-bridge-redact element',
      () => {
        const span = document.createElement('span');
        span.setAttribute('data-bridge-redact', 'true');
        span.textContent = SECRET;
        return span;
      },
    ],
  ])('a <label> wrapping %s answers no secret anywhere', (_name, makeChild) => {
    const label = document.createElement('label');
    const child = makeChild();
    label.appendChild(child);
    document.body.appendChild(label);
    attachFiber(label, loginFormFiber(), {
      htmlFor: 'pw',
      children: [
        'Password',
        reactElement(child.tagName.toLowerCase(), { type: 'password', value: SECRET }),
      ],
    });

    const result = extractReactState(label);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(result).toEqual({
      props: { htmlFor: 'pw', children: ['Password', `<${child.tagName.toLowerCase()}>`] },
      fiberState: [],
      componentName: 'LoginForm',
      note: FIBER_STATE_WITHHELD_NOTE,
    });
  });

  it("withholds the component's state when its fiber subtree renders the redacted element outside the wrapper", () => {
    // <form>{LoginForm}<label/> <input type=password/></form>: the label holds
    // nothing redacted in the DOM, but its component renders the password input.
    const form = document.createElement('form');
    const label = document.createElement('label');
    label.textContent = 'Password';
    const input = document.createElement('input');
    input.type = 'password';
    form.append(label, input);
    document.body.appendChild(form);

    const component = loginFormFiber() as FakeFiber & { child?: unknown };
    const labelFiber = { type: 'label', stateNode: label, return: component, memoizedState: null };
    const inputFiber = { type: 'input', stateNode: input, return: component, memoizedState: null };
    (labelFiber as { sibling?: unknown }).sibling = inputFiber;
    component.child = labelFiber;
    attachFiber(label, labelFiber as unknown as FakeFiber, { children: 'Password' });

    const result = extractReactState(label);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(result).toEqual({
      props: { children: 'Password' },
      fiberState: [],
      componentName: 'LoginForm',
      note: FIBER_STATE_WITHHELD_NOTE,
    });
  });

  it('keeps the state of a component that renders nothing redacted', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    attachFiber(div, loginFormFiber(), { children: reactElement('span', { title: 'ok' }) });
    expect(extractReactState(div)).toEqual({
      props: { children: '<span>' },
      fiberState: [SECRET],
      componentName: 'LoginForm',
    });
  });
});

describe('extractReactState — one walk to the component fiber', () => {
  it("reads the host fiber's `return` once, for both the state and the withholding check", () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const component = {
      type: function Panel() {
        return null;
      },
      memoizedState: { memoizedState: 'open', next: null },
    };
    let returnReads = 0;
    const host = {
      type: 'div',
      memoizedState: null,
      get return() {
        returnReads++;
        return component;
      },
    };
    attachFiber(div, host as unknown as FakeFiber);
    expect(extractReactState(div)).toEqual({
      props: {},
      fiberState: ['open'],
      componentName: 'Panel',
    });
    expect(returnReads).toBe(1);
    div.remove();
  });
});
