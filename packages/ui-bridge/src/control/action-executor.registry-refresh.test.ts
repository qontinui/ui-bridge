/**
 * Action Executor Tests — Registry Refresh (B1+M2)
 *
 * Verifies that mutation actions (`type`, `clear`, `setValue`, `check`,
 * `uncheck`, `toggle`, `sendKeys`, `select`) push the post-action
 * `ElementState` into the registry so subsequent `getElement(id).getState()`
 * reads reflect the mutation. Also verifies that pure state actions
 * (`focus`, `blur`) refresh `focused` without clobbering a prior `value`
 * overlay.
 *
 * Manual-test 2026-04-25 captured the original failure: an action returned
 * `value: "hello"` in its response but `getElement(id)` immediately after
 * still reported `value: ""`. Root cause: the live-DOM `getState()` was
 * working, but in production the registered `RegisteredElement.element`
 * reference can drift from the live DOM node across React re-renders, so
 * an action-driven overlay is required to keep registry reads honest.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { ELEMENT_RESOLUTION_RANK } from '../core/resolution-score';
import { DefaultActionExecutor } from './action-executor';

describe('DefaultActionExecutor — registry refresh after mutation actions', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function makeInput(id: string, initial = ''): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = initial;
    input.setAttribute('data-testid', id);
    container.appendChild(input);
    return input;
  }

  function makeTextarea(id: string, initial = ''): HTMLTextAreaElement {
    const ta = document.createElement('textarea');
    ta.value = initial;
    ta.setAttribute('data-testid', id);
    container.appendChild(ta);
    return ta;
  }

  function makeCheckbox(id: string, initial = false): HTMLInputElement {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = initial;
    cb.setAttribute('data-testid', id);
    container.appendChild(cb);
    return cb;
  }

  it('type action pushes value into the registry', async () => {
    const input = makeInput('email');
    registry.registerElement('email', input, { type: 'input', label: 'Email' });

    const result = await executor.executeAction('email', {
      action: 'type',
      params: { text: 'hello' },
    });

    expect(result.success).toBe(true);
    expect(result.elementState?.value).toBe('hello');
    // Registry MUST reflect the same post-action value on the very next read.
    expect(registry.getElement('email')?.getState().value).toBe('hello');
  });

  it('type with clear:true pushes the cleared+typed value', async () => {
    const input = makeInput('q', 'old');
    registry.registerElement('q', input, { type: 'input' });

    const result = await executor.executeAction('q', {
      action: 'type',
      params: { text: 'fresh', clear: true },
    });

    expect(result.success).toBe(true);
    expect(registry.getElement('q')?.getState().value).toBe('fresh');
  });

  it('clear action pushes empty value', async () => {
    const input = makeInput('q', 'will-be-cleared');
    registry.registerElement('q', input, { type: 'input' });

    const result = await executor.executeAction('q', { action: 'clear' });
    expect(result.success).toBe(true);
    expect(registry.getElement('q')?.getState().value).toBe('');
  });

  it('setValue pushes the explicit value', async () => {
    const input = makeInput('q', '');
    registry.registerElement('q', input, { type: 'input' });

    const result = await executor.executeAction('q', {
      action: 'setValue',
      params: { value: 'preset' },
    });
    expect(result.success).toBe(true);
    expect(registry.getElement('q')?.getState().value).toBe('preset');
  });

  it('setValue on a textarea pushes the value', async () => {
    const ta = makeTextarea('notes', '');
    registry.registerElement('notes', ta, { type: 'textarea' });

    const result = await executor.executeAction('notes', {
      action: 'setValue',
      params: { value: 'multi\nline' },
    });
    expect(result.success).toBe(true);
    expect(registry.getElement('notes')?.getState().value).toBe('multi\nline');
  });

  it('check action pushes checked: true', async () => {
    const cb = makeCheckbox('agree', false);
    registry.registerElement('agree', cb, { type: 'checkbox' });

    const result = await executor.executeAction('agree', { action: 'check' });
    expect(result.success).toBe(true);
    expect(registry.getElement('agree')?.getState().checked).toBe(true);
  });

  it('uncheck action pushes checked: false', async () => {
    const cb = makeCheckbox('agree', true);
    registry.registerElement('agree', cb, { type: 'checkbox' });

    const result = await executor.executeAction('agree', { action: 'uncheck' });
    expect(result.success).toBe(true);
    expect(registry.getElement('agree')?.getState().checked).toBe(false);
  });

  it('toggle on a checkbox flips the cached checked state', async () => {
    const cb = makeCheckbox('agree', false);
    registry.registerElement('agree', cb, { type: 'checkbox' });

    const r1 = await executor.executeAction('agree', { action: 'toggle' });
    expect(r1.success).toBe(true);
    expect(registry.getElement('agree')?.getState().checked).toBe(true);

    const r2 = await executor.executeAction('agree', { action: 'toggle' });
    expect(r2.success).toBe(true);
    expect(registry.getElement('agree')?.getState().checked).toBe(false);
  });

  it('sendKeys updates the cached value when printable keys are sent', async () => {
    const input = makeInput('q', '');
    registry.registerElement('q', input, { type: 'input' });

    const result = await executor.executeAction('q', {
      action: 'sendKeys',
      params: {
        keys: [{ key: 'a' }, { key: 'b' }, { key: 'c' }],
      },
    });
    expect(result.success).toBe(true);
    expect(registry.getElement('q')?.getState().value).toBe('abc');
  });

  it('focus does NOT clobber a prior `type` overlay', async () => {
    const input1 = makeInput('a');
    const input2 = makeInput('b');
    registry.registerElement('a', input1, { type: 'input' });
    registry.registerElement('b', input2, { type: 'input' });

    // 1) Type "hello" into input1 — registry caches value: "hello".
    const typeResult = await executor.executeAction('a', {
      action: 'type',
      params: { text: 'hello' },
    });
    expect(typeResult.success).toBe(true);
    expect(registry.getElement('a')?.getState().value).toBe('hello');

    // 2) Focus input2 — this used to refresh state on the focused entry only,
    //    but if a future change accidentally cleared 'a's overlay during 'b's
    //    refresh, the next assertion would fail. Guards against regression.
    const focusResult = await executor.executeAction('b', { action: 'focus' });
    expect(focusResult.success).toBe(true);
    expect(registry.getElement('a')?.getState().value).toBe('hello');
  });

  it('focus on the same element does not clear a prior `value` overlay', async () => {
    const input = makeInput('q');
    registry.registerElement('q', input, { type: 'input' });

    await executor.executeAction('q', { action: 'type', params: { text: 'kept' } });
    expect(registry.getElement('q')?.getState().value).toBe('kept');

    const focusResult = await executor.executeAction('q', { action: 'focus' });
    expect(focusResult.success).toBe(true);
    // STATE_ACTIONS only refresh `focused` — value overlay must persist.
    expect(registry.getElement('q')?.getState().value).toBe('kept');
    expect(registry.getElement('q')?.getState().focused).toBe(true);
  });

  it('blur on the same element does not clear a prior `value` overlay', async () => {
    const input = makeInput('q');
    registry.registerElement('q', input, { type: 'input' });

    await executor.executeAction('q', { action: 'type', params: { text: 'kept' } });
    expect(registry.getElement('q')?.getState().value).toBe('kept');

    const blurResult = await executor.executeAction('q', { action: 'blur' });
    expect(blurResult.success).toBe(true);
    expect(registry.getElement('q')?.getState().value).toBe('kept');
  });

  it('reads after the registered DOM node is mutated externally still see the cached value', async () => {
    // Simulates the React-detach scenario from the bug report: the
    // registered element ref is still intact but a separate "live" copy of
    // the input replaces the visible value. The registry overlay keeps
    // /control/element/:id consistent with what the action just wrote.
    const input = makeInput('q', 'initial');
    registry.registerElement('q', input, { type: 'input' });

    await executor.executeAction('q', { action: 'type', params: { text: 'hello', clear: true } });
    expect(registry.getElement('q')?.getState().value).toBe('hello');

    // External code (React re-render) writes a different value into the DOM
    // node behind the bridge's back. Live `getElementState(element)` would
    // pick this up, but the action-driven overlay should stick.
    input.value = 'externally-overwritten';
    expect(registry.getElement('q')?.getState().value).toBe('hello');
  });

  it('refreshElement(id, undefined) clears the cached overlay', async () => {
    const input = makeInput('q', 'initial');
    registry.registerElement('q', input, { type: 'input' });

    await executor.executeAction('q', { action: 'type', params: { text: 'hello', clear: true } });
    expect(registry.getElement('q')?.getState().value).toBe('hello');

    // Manually clear the overlay — getState should fall back to live DOM.
    registry.refreshElement('q', undefined);
    expect(registry.getElement('q')?.getState().value).toBe('hello'); // DOM still says hello
    input.value = 'now-live';
    expect(registry.getElement('q')?.getState().value).toBe('now-live');
  });

  it('refreshElement returns false for unknown id', () => {
    expect(registry.refreshElement('does-not-exist', { value: 'x' })).toBe(false);
  });

  it('re-registering an id resets the overlay', async () => {
    const input = makeInput('q');
    registry.registerElement('q', input, { type: 'input' });
    await executor.executeAction('q', { action: 'type', params: { text: 'first' } });
    expect(registry.getElement('q')?.getState().value).toBe('first');

    // Replace the registration with a fresh DOM element — overlay must NOT
    // bleed over.
    const input2 = makeInput('q2');
    input2.value = 'fresh-dom';
    registry.registerElement('q', input2, { type: 'input' });
    expect(registry.getElement('q')?.getState().value).toBe('fresh-dom');
  });

  it('click does not refresh the registry overlay (no-op on the cache)', async () => {
    const input = makeInput('q', 'initial');
    registry.registerElement('q', input, { type: 'input' });

    // Establish an overlay via type.
    await executor.executeAction('q', { action: 'type', params: { text: 'typed', clear: true } });
    expect(registry.getElement('q')?.getState().value).toBe('typed');

    // Click should NOT touch the value overlay.
    await executor.executeAction('q', { action: 'click' });
    expect(registry.getElement('q')?.getState().value).toBe('typed');
  });

  // ==========================================================================
  // Resolution reporting
  // ==========================================================================
  //
  // The re-resolution this file is about — the registered `element` reference
  // drifting from the live DOM node across a React re-render — is exactly when
  // the executor stops using the registry entry and starts *inferring* the
  // target. Before this plan, the response looked identical either way: the
  // caller could not tell an exact registry hit from a `[data-testid]` query
  // that happened to match. `elementResolution` closes that.
  //
  // The scores are ordinal class labels, not calibrated probabilities — see
  // `core/resolution-score.ts`.

  it('reports an exact registry hit as such', async () => {
    const input = makeInput('email');
    registry.registerElement('email', input, { type: 'input' });

    const result = await executor.executeAction('email', { action: 'focus' });
    expect(result.success).toBe(true);
    expect(result.elementResolution?.strategy).toBe('registry-id');
    expect(result.elementResolution?.stabilityClass).toBe('exact');
    expect(result.elementResolution?.stabilityRank).toBe(ELEMENT_RESOLUTION_RANK['registry-id']);
  });

  it('reports the weaker strategy when the registered node was detached', async () => {
    // Simulate the React-detach the whole file is about: the registration still
    // exists, but its `element` is no longer in the document, so the executor
    // re-resolves off the identifier instead.
    const detached = makeInput('email');
    registry.registerElement('email', detached, { type: 'input' });
    detached.remove();
    const live = makeInput('email');

    const result = await executor.executeAction('email', { action: 'focus' });
    expect(result.success).toBe(true);
    expect(document.activeElement).toBe(live);
    expect(result.elementResolution?.strategy).toBe('element-identifier');
    expect(result.elementResolution?.stabilityClass).toBe('strong');
    // Strictly weaker than the registry hit it fell back from — the ordering is
    // the point.
    expect(result.elementResolution!.stabilityRank).toBeLessThan(
      ELEMENT_RESOLUTION_RANK['registry-id']
    );
  });

  it('omits alternates unless the request asks for them', async () => {
    const input = makeInput('email');
    registry.registerElement('email', input, { type: 'input' });

    const plain = await executor.executeAction('email', { action: 'focus' });
    expect(plain.elementResolution).toBeDefined();
    expect(plain.elementResolution?.alternates).toBeUndefined();
  });

  it('returns ranked alternates when the request asks for them', async () => {
    // Registered AND reachable by `[data-testid]`, so more than one strategy
    // would resolve. By default the chain still stops at the first.
    const input = makeInput('email');
    registry.registerElement('email', input, { type: 'input' });

    const result = await executor.executeAction('email', {
      action: 'focus',
      includeResolutionAlternates: true,
    });
    expect(result.elementResolution?.strategy).toBe('registry-id');
    const alternates = result.elementResolution!.alternates!;
    expect(alternates.length).toBeGreaterThan(0);
    expect(alternates.some((c) => c.strategy === 'element-identifier')).toBe(true);
    // The winner is never repeated inside its own fallback list.
    expect(alternates.some((c) => c.strategy === 'registry-id')).toBe(false);
    // Strongest-first.
    const ranks = alternates.map((c) => c.stabilityRank);
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
  });

  it('returns an empty alternates list rather than omitting it when there are none', async () => {
    // "Asked, and there were none" must stay distinguishable from "did not ask".
    const bare = document.createElement('button');
    container.appendChild(bare);
    registry.registerElement('lonely-button', bare, { type: 'button' });

    const result = await executor.executeAction('lonely-button', {
      action: 'focus',
      includeResolutionAlternates: true,
    });
    expect(result.elementResolution?.alternates).toEqual([]);
  });

  it('reports the resolution on the failure arm too', async () => {
    // A click that threw on a weak match is precisely when the caller wants to
    // know the match was weak.
    const input = makeInput('locked');
    input.disabled = true;
    registry.registerElement('locked', input, { type: 'input' });

    const result = await executor.executeAction('locked', { action: 'click' });
    expect(result.success).toBe(false);
    expect(result.failureDetails?.errorCode).toBe('UB-ELEM-DISABLED');
    expect(result.elementResolution?.strategy).toBe('registry-id');
  });

  it('omits the resolution entirely when nothing resolved', async () => {
    const result = await executor.executeAction('never-existed', { action: 'click' });
    expect(result.success).toBe(false);
    // Same discipline as `effectVerification`: present only when applicable.
    expect(result.elementResolution).toBeUndefined();
  });
});
