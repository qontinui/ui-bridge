/**
 * Regression: every synthetic `KeyboardEvent` this SDK dispatches must carry
 * the legacy `keyCode` / `which` / `charCode` fields.
 *
 * THE DEFECT. `keyCode` and friends are deprecated in the UI Events spec, but a
 * very large amount of shipped application code still reads them — `if
 * (e.keyCode === 13)` remains the most common way an app recognizes Enter. A
 * `KeyboardEvent` constructed without them reports `keyCode === 0`, so every
 * such handler silently no-ops while the dispatch reports success. That is the
 * exact "succeeded while reaching nothing" failure the rest of `key-events.ts`
 * exists to prevent, and it was true of all FOUR construction sites in this
 * repo, each of which had its own hand-rolled `KeyboardEventInit`:
 *
 *   - `core/key-events.ts`          — `dispatchKeySequence` (document-scoped)
 *   - `control/action-executor.ts`  — the element-scoped `sendKeys` action
 *   - `react/commandHandlers.ts`    — the relay `sendKeys` arm (which also
 *                                     omitted `code` entirely)
 *   - `undo/undo-tracker.ts`        — the Ctrl+Z / Ctrl+Shift+Z fallback
 *
 * These tests pin the shared builder AND each of the four call sites, because
 * a builder that exists while a call site still hand-rolls its init is exactly
 * the drift this consolidation was meant to end.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildKeyboardEventInit,
  keyToKeyCode,
  dispatchKeySequence,
  normalizeKeyDescriptors,
  NON_PRINTABLE_KEYS,
} from './key-events';
import { UIBridgeRegistry, getGlobalRegistry } from './registry';
import { DefaultActionExecutor } from '../control/action-executor';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import { UndoTracker } from '../undo/undo-tracker';
import type { ControlActionResponse } from '../control/types';

/** Legacy triple, read off a real event so we test what a handler would see. */
function legacyTriple(e: KeyboardEvent): { keyCode: number; which: number; charCode: number } {
  return { keyCode: e.keyCode, which: e.which, charCode: e.charCode };
}

describe('buildKeyboardEventInit — legacy keyCode/which/charCode', () => {
  it('emits non-zero keyCode and which for Enter, B and ArrowDown', () => {
    expect(buildKeyboardEventInit('Enter')).toMatchObject({ keyCode: 13, which: 13, charCode: 0 });
    expect(buildKeyboardEventInit('B')).toMatchObject({ keyCode: 66, which: 66, charCode: 0 });
    expect(buildKeyboardEventInit('ArrowDown')).toMatchObject({
      keyCode: 40,
      which: 40,
      charCode: 0,
    });
  });

  it('keeps the modern fields it always had, alongside the legacy ones', () => {
    const init = buildKeyboardEventInit('b', { ctrl: true, shift: true });
    expect(init).toMatchObject({
      key: 'b',
      code: 'KeyB',
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    });
  });

  it('reports the UPPERCASE code for a lowercase letter — the legacy model is physical-key shaped', () => {
    expect(keyToKeyCode('b')).toBe(66);
    expect(keyToKeyCode('B')).toBe(66);
    expect(keyToKeyCode('7')).toBe(55);
  });

  it('covers the named keys applications actually branch on', () => {
    const expected: Array<[string, number]> = [
      ['Backspace', 8],
      ['Tab', 9],
      ['Enter', 13],
      ['Shift', 16],
      ['Control', 17],
      ['Alt', 18],
      ['Escape', 27],
      [' ', 32],
      ['PageUp', 33],
      ['PageDown', 34],
      ['End', 35],
      ['Home', 36],
      ['ArrowLeft', 37],
      ['ArrowUp', 38],
      ['ArrowRight', 39],
      ['ArrowDown', 40],
      ['Delete', 46],
      ['Meta', 91],
      ['F1', 112],
      ['F12', 123],
    ];
    for (const [key, code] of expected) {
      expect(keyToKeyCode(key), `keyCode for "${key}"`).toBe(code);
    }
  });

  it('returns 0 rather than a fabricated code for a key it cannot place', () => {
    expect(keyToKeyCode('LaunchMediaPlayer')).toBe(0);
    expect(keyToKeyCode('')).toBe(0);
  });

  // The legacy model assigns these accepted names no virtual-key code at all,
  // so browsers report 0 for them and 0 is the honest answer — not a gap.
  const NO_LEGACY_CODE = new Set(['Undo', 'Redo', 'Copy', 'Cut', 'Paste', 'Fn', 'Symbol']);

  it('every named key the GRAMMAR accepts carries a legacy code, or is a declared exception', () => {
    // The accepted vocabulary and the legacy table must not drift apart. A key
    // `normalizeKeyDescriptors` ACCEPTS that then dispatches with `keyCode: 0`
    // for want of a table entry is the same silent no-op this module exists to
    // prevent — reached through the front door instead of a hand-rolled init.
    // `Help` and `Cancel` were exactly that: accepted by the grammar, absent
    // from the table.
    const acceptedNames = [
      ...NON_PRINTABLE_KEYS,
      'ContextMenu',
      'Clear',
      'Pause',
      'PrintScreen',
      'Help',
      'AltGraph',
      'Cancel',
      'Select',
      ...NO_LEGACY_CODE,
    ];

    for (const key of acceptedNames) {
      expect(normalizeKeyDescriptors(key).ok, `grammar must accept "${key}"`).toBe(true);
      if (NO_LEGACY_CODE.has(key)) {
        expect(keyToKeyCode(key), `"${key}" has no legacy code by design`).toBe(0);
      } else {
        expect(keyToKeyCode(key), `"${key}" is accepted, so it must carry a code`).toBeGreaterThan(
          0
        );
      }
    }
  });

  it('places the two accepted keys the table had omitted', () => {
    expect(keyToKeyCode('Help')).toBe(47);
    expect(keyToKeyCode('Cancel')).toBe(3);
  });

  it('mirrors the browsers on keypress: keyCode == which == charCode == the character', () => {
    const down = buildKeyboardEventInit('b', {}, 'keydown');
    const press = buildKeyboardEventInit('b', {}, 'keypress');
    const up = buildKeyboardEventInit('b', {}, 'keyup');

    // keydown/keyup report the PHYSICAL key (66) with no charCode.
    expect(down).toMatchObject({ keyCode: 66, which: 66, charCode: 0 });
    expect(up).toMatchObject({ keyCode: 66, which: 66, charCode: 0 });
    // keypress reports the CHARACTER, case intact — so a handler doing
    // `String.fromCharCode(e.which)` recovers "b", not "B".
    expect(press).toMatchObject({ keyCode: 98, which: 98, charCode: 98 });
    expect(String.fromCharCode(press.charCode as number)).toBe('b');
  });

  it('the constructed event actually reflects the init (not just the dictionary)', () => {
    const e = new KeyboardEvent('keydown', buildKeyboardEventInit('Enter'));
    expect(legacyTriple(e)).toEqual({ keyCode: 13, which: 13, charCode: 0 });
  });
});

describe('call site 1 — dispatchKeySequence (document-scoped)', () => {
  const offs: Array<() => void> = [];

  afterEach(() => {
    for (const off of offs.splice(0)) off();
  });

  function collect(type: string): KeyboardEvent[] {
    const seen: KeyboardEvent[] = [];
    const fn = (e: Event) => seen.push(e as KeyboardEvent);
    document.addEventListener(type, fn);
    offs.push(() => document.removeEventListener(type, fn));
    return seen;
  }

  it('carries keyCode/which on keydown, keypress and keyup', async () => {
    const downs = collect('keydown');
    const presses = collect('keypress');
    const ups = collect('keyup');

    const norm = normalizeKeyDescriptors(['Enter', 'b', 'ArrowDown']);
    expect(norm.ok).toBe(true);
    if (!norm.ok) return;
    await dispatchKeySequence(document, norm.keys);

    expect(downs.map((e) => e.keyCode)).toEqual([13, 66, 40]);
    expect(downs.map((e) => e.which)).toEqual([13, 66, 40]);
    expect(ups.map((e) => e.keyCode)).toEqual([13, 66, 40]);
    // Only the printable "b" fires keypress, and it reports the character.
    expect(presses.map((e) => e.charCode)).toEqual([98]);
    expect(presses.map((e) => e.which)).toEqual([98]);
  });
});

describe('call site 2 — element-scoped sendKeys action', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;
  let input: HTMLInputElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
    input = document.createElement('input');
    document.body.appendChild(input);
    registry.registerElement('q', input, { type: 'input' });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('carries keyCode/which — and still interleaves the value mutation', async () => {
    const downs: KeyboardEvent[] = [];
    const presses: KeyboardEvent[] = [];
    const ups: KeyboardEvent[] = [];
    input.addEventListener('keydown', (e) => downs.push(e));
    input.addEventListener('keypress', (e) => presses.push(e));
    input.addEventListener('keyup', (e) => ups.push(e));

    const result = await executor.executeAction('q', {
      action: 'sendKeys',
      params: { keys: [{ key: 'b' }, { key: 'Enter' }, { key: 'ArrowDown' }] },
    });
    expect(result.success, `sendKeys failed: ${result.error}`).toBe(true);

    expect(downs.map((e) => e.keyCode)).toEqual([66, 13, 40]);
    expect(downs.map((e) => e.which)).toEqual([66, 13, 40]);
    expect(ups.map((e) => e.keyCode)).toEqual([66, 13, 40]);
    expect(presses.map((e) => e.charCode)).toEqual([98]);
    // The keypress-interleaved value mutation this loop exists for is intact.
    expect(input.value).toBe('b');
  });
});

describe('call site 3 — the relay sendKeys arm', () => {
  const emptyBridge: BridgeAccess = {
    elements: [],
    getElement: () => undefined,
    components: [],
    workflows: [],
  };

  let host: HTMLInputElement;

  beforeEach(() => {
    host = document.createElement('input');
    // jsdom has no layout, so the relay's visibility gate would reject it.
    Object.defineProperty(host, 'offsetParent', {
      configurable: true,
      get: () => document.body,
    });
    document.body.appendChild(host);
    getGlobalRegistry().registerElement('fld', host, { type: 'input' });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    getGlobalRegistry().clear();
  });

  async function act(request: Record<string, unknown>): Promise<ControlActionResponse> {
    return (await executeCommand(
      'executeElementAction',
      { id: 'fld', request },
      emptyBridge
    )) as unknown as ControlActionResponse;
  }

  it('descriptor arm carries code AND the legacy triple', async () => {
    const downs: KeyboardEvent[] = [];
    host.addEventListener('keydown', (e) => downs.push(e));

    const res = await act({ action: 'sendKeys', params: { keys: [{ key: 'Enter' }] } });
    expect(res.success, `relay sendKeys failed: ${res.error}`).toBe(true);

    expect(downs).toHaveLength(1);
    // `code` was missing entirely from this arm before the consolidation.
    expect(downs[0].code).toBe('Enter');
    expect(legacyTriple(downs[0])).toEqual({ keyCode: 13, which: 13, charCode: 0 });
  });

  it('legacy string arm carries code AND the legacy triple', async () => {
    const downs: KeyboardEvent[] = [];
    const presses: KeyboardEvent[] = [];
    host.addEventListener('keydown', (e) => downs.push(e));
    host.addEventListener('keypress', (e) => presses.push(e));

    const res = await act({ action: 'sendKeys', params: { keys: 'hi' } });
    expect(res.success, `relay sendKeys failed: ${res.error}`).toBe(true);

    expect(downs.map((e) => e.code)).toEqual(['KeyH', 'KeyI']);
    expect(downs.map((e) => e.keyCode)).toEqual([72, 73]);
    expect(downs.map((e) => e.which)).toEqual([72, 73]);
    expect(presses.map((e) => e.charCode)).toEqual([104, 105]);
  });
});

describe('call site 4 — undo/redo keyboard fallback', () => {
  let field: HTMLInputElement;

  beforeEach(() => {
    field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('executeUndo dispatches Ctrl/Cmd+Z carrying keyCode 90', () => {
    const seen: KeyboardEvent[] = [];
    field.addEventListener('keydown', (e) => seen.push(e));

    expect(new UndoTracker().executeUndo()).toBe(true);

    expect(seen).toHaveLength(1);
    expect(seen[0].key).toBe('z');
    expect(seen[0].code).toBe('KeyZ');
    expect(seen[0].shiftKey).toBe(false);
    expect(legacyTriple(seen[0])).toEqual({ keyCode: 90, which: 90, charCode: 0 });
    expect(seen[0].ctrlKey || seen[0].metaKey).toBe(true);
  });

  it('executeRedo dispatches Ctrl/Cmd+Shift+Z carrying keyCode 90', () => {
    const seen: KeyboardEvent[] = [];
    field.addEventListener('keydown', (e) => seen.push(e));

    expect(new UndoTracker().executeRedo()).toBe(true);

    expect(seen).toHaveLength(1);
    expect(seen[0].shiftKey).toBe(true);
    expect(legacyTriple(seen[0])).toEqual({ keyCode: 90, which: 90, charCode: 0 });
    expect(seen[0].ctrlKey || seen[0].metaKey).toBe(true);
  });
});
