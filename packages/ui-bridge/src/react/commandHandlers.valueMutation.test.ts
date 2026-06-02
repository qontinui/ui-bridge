/**
 * Relay value-mutation → focus lifecycle (focus-gated inputs).
 *
 * Background: the relay/injected transport (`executeCommand`, the runner
 * CommandBar relay path) drives `type`/`setValue`/`clear` against registered
 * inputs. Previously those handlers set the value without ever focusing the
 * element, so a focus-gated input — one that only reveals UI when its `focus`
 * event fires (e.g. the runner CommandBar dropdown) — did NOT react when a
 * driver set its value. PR #320 worked around this by manually dispatching a
 * synthetic `FocusEvent('focus')` from the caller.
 *
 * Fix: all value-mutation actions now route through the shared
 * `applyValueMutation` helper, which focuses (native + synthetic FocusEvent)
 * BEFORE mutating the value. These tests assert the relay `executeElementAction`
 * `type`/`setValue`/`clear` cases dispatch focus-before-input and fire React's
 * onChange — and the headline regression proves the SDK fix alone now opens a
 * focus-gated input WITHOUT any manual focus dispatch from the caller.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { getGlobalRegistry } from '../core/registry';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

describe('relay value mutation → focus lifecycle', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    getGlobalRegistry().clear();
  });

  function registerInput(
    id: string,
    initial = '',
    el: HTMLInputElement | HTMLTextAreaElement = document.createElement('input')
  ): { el: HTMLInputElement | HTMLTextAreaElement; events: string[] } {
    el.value = initial;
    // jsdom reports offsetParent === null for every element (no layout); the
    // relay's visibility gate checks `offsetParent !== null`, so stub it to a
    // truthy node. Display/visibility default to visible in jsdom.
    Object.defineProperty(el, 'offsetParent', {
      configurable: true,
      get: () => document.body,
    });
    container.appendChild(el);
    getGlobalRegistry().registerElement(id, el, { type: 'input', label: id });
    const events: string[] = [];
    for (const t of ['focus', 'input', 'change', 'blur']) {
      el.addEventListener(t, () => events.push(t));
    }
    return { el, events };
  }

  it("`type` focuses before input and fires onChange (no trailing blur)", async () => {
    const { el, events } = registerInput('vm-type');

    let onChangeFired = false;
    (el as unknown as Record<string, unknown>)['__reactProps$test'] = {
      onChange: () => {
        onChangeFired = true;
      },
    };

    const result = (await executeCommand(
      'executeElementAction',
      { id: 'vm-type', request: { action: 'type', params: { text: 'hello' } } },
      emptyBridge,
    )) as { success?: boolean };

    expect(result.success).toBe(true);
    expect(el.value).toBe('hello');
    expect(events.indexOf('focus')).toBeLessThan(events.indexOf('input'));
    expect(events).not.toContain('blur');
    expect(onChangeFired).toBe(true);
  });

  it("`setValue` focuses before input and fires onChange (no trailing blur)", async () => {
    const { el, events } = registerInput('vm-setvalue', 'old');

    let onChangeFired = false;
    (el as unknown as Record<string, unknown>)['__reactProps$test'] = {
      onChange: () => {
        onChangeFired = true;
      },
    };

    const result = (await executeCommand(
      'executeElementAction',
      { id: 'vm-setvalue', request: { action: 'setValue', value: 'fresh' } },
      emptyBridge,
    )) as { success?: boolean };

    expect(result.success).toBe(true);
    expect(el.value).toBe('fresh');
    expect(events.indexOf('focus')).toBeLessThan(events.indexOf('input'));
    expect(events).not.toContain('blur');
    expect(onChangeFired).toBe(true);
  });

  it("`clear` focuses before input and fires onChange (no trailing blur)", async () => {
    const { el, events } = registerInput('vm-clear', 'remove me');

    let onChangeFired = false;
    (el as unknown as Record<string, unknown>)['__reactProps$test'] = {
      onChange: () => {
        onChangeFired = true;
      },
    };

    const result = (await executeCommand(
      'executeElementAction',
      { id: 'vm-clear', request: { action: 'clear' } },
      emptyBridge,
    )) as { success?: boolean };

    expect(result.success).toBe(true);
    expect(el.value).toBe('');
    expect(events.indexOf('focus')).toBeLessThan(events.indexOf('input'));
    expect(events).not.toContain('blur');
    expect(onChangeFired).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Headline regression — the original bug.
  //
  // A focus-gated input reveals UI only on its `focus` event. Drive it with
  // `setValue` (the previously-broken action) through the relay and assert the
  // gate opened — WITHOUT the test ever dispatching a focus event itself. This
  // proves the SDK fix alone suffices, replacing the old PR-#320
  // `dispatchEvent(FocusEvent('focus'))` caller-side workaround.
  // -------------------------------------------------------------------------
  it('setValue alone opens a focus-gated input (no manual focus dispatch)', async () => {
    // Plain-DOM focus-gated component pattern: `open` flips to true only when
    // the input's `focus` event fires. Framework-free on purpose.
    let open = false;
    const input = document.createElement('input');
    input.type = 'text';
    Object.defineProperty(input, 'offsetParent', {
      configurable: true,
      get: () => document.body,
    });
    container.appendChild(input);
    input.addEventListener('focus', () => {
      open = true;
    });
    getGlobalRegistry().registerElement('focus-gated', input, {
      type: 'input',
      label: 'Focus-gated search',
    });

    expect(open).toBe(false);

    // Note: the test dispatches NO focus event — only `setValue` runs.
    const result = (await executeCommand(
      'executeElementAction',
      { id: 'focus-gated', request: { action: 'setValue', value: 'query' } },
      emptyBridge,
    )) as { success?: boolean };

    expect(result.success).toBe(true);
    expect(input.value).toBe('query');
    // The gate opened purely from the value mutation's focus lifecycle.
    expect(open).toBe(true);
  });
});
