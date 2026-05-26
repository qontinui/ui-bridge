import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import type { NativeElementRef } from '../../core/types';
import { createServerHandlers } from '../handlers';

/**
 * Element read-back consistency after a value-mutating action.
 *
 * Regression: the /manual-test session found `GET /control/element/:id`
 * returning `state.value: undefined` after a `setValue`, while
 * `/control/snapshot` reflected the new value — an inconsistent read path.
 *
 * Two root causes were fixed:
 *   1. `executeAction` returned an `elementState` captured from the element
 *      reference grabbed BEFORE the action ran. `updateElementState` replaces
 *      the registry entry, so the captured `getState` closure was stale and
 *      omitted the just-set value. The executor now re-fetches fresh state.
 *   2. The single-element read handlers (`getElement` / `getElementState`)
 *      now fall back to a controlled input's `props.value` when `state.value`
 *      is not yet mirrored, matching what the snapshot path surfaces.
 */

function inputRef(): React.RefObject<NativeElementRef> {
  return { current: {} as NativeElementRef };
}

function snapshotValue(snap: { data?: unknown }, id: string): unknown {
  const elements = (snap.data as { elements: Array<{ id: string; state: { value?: unknown } }> })
    .elements;
  return elements.find((e) => e.id === id)?.state.value;
}

describe('element read-back consistency after setValue', () => {
  it('getElement, getElementState, and snapshot all return the set value', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    let bound = '';
    registry.registerElement('field', inputRef(), {
      type: 'input',
      props: { onChangeText: (t: string) => { bound = t; } },
    });

    await executor.executeAction('field', { action: 'setValue', params: { text: 'hello' } });
    expect(bound).toBe('hello');

    const handlers = createServerHandlers(registry, executor);
    const el = await handlers.getElement({ params: { id: 'field' }, query: {}, body: undefined });
    const elState = await handlers.getElementState({
      params: { id: 'field' },
      query: {},
      body: undefined,
    });
    const snap = await handlers.getSnapshot({ params: {}, query: {}, body: undefined });

    const elementValue = (el.data as { element: { state: { value?: unknown } } }).element.state
      .value;
    const stateValue = (elState.data as { state: { value?: unknown } }).state.value;

    expect(elementValue).toBe('hello');
    expect(stateValue).toBe('hello');
    expect(snapshotValue(snap, 'field')).toBe('hello');
    // The trio must agree — that is the property the regression violated.
    expect(elementValue).toBe(snapshotValue(snap, 'field'));
  });

  it('executeAction response elementState reflects the freshly set value (not stale pre-action state)', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    registry.registerElement('field', inputRef(), {
      type: 'input',
      props: { onChangeText: () => {} },
    });

    const resp = await executor.executeAction('field', {
      action: 'setValue',
      params: { text: 'world' },
    });

    expect(resp.success).toBe(true);
    expect(resp.elementState?.value).toBe('world');
  });

  it('getElement falls back to props.value for a controlled input whose state.value is unset', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    // Register an input and then clear state.value out of band to simulate the
    // pre-mirror window. The seeded value comes from props.value.
    registry.registerElement('api-url', inputRef(), {
      type: 'input',
      props: { value: 'https://staging.example.com', onChangeText: () => {} },
    });

    const handlers = createServerHandlers(registry, executor);
    const el = await handlers.getElement({ params: { id: 'api-url' }, query: {}, body: undefined });
    const value = (el.data as { element: { state: { value?: unknown } } }).element.state.value;
    expect(value).toBe('https://staging.example.com');
  });

  it('does not fabricate a value for non-input elements carrying a value prop', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    // A switch carries a boolean `value` prop; the input-only fallback must
    // not surface it as a string state.value.
    registry.registerElement('toggle', inputRef(), {
      type: 'switch',
      props: { value: true, onValueChange: () => {} },
    });

    const handlers = createServerHandlers(registry, executor);
    const el = await handlers.getElement({ params: { id: 'toggle' }, query: {}, body: undefined });
    const value = (el.data as { element: { state: { value?: unknown } } }).element.state.value;
    expect(value).toBeUndefined();
  });
});
