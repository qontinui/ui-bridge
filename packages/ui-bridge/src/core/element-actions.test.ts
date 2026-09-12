/**
 * Wire projection of an element's custom actions.
 *
 * Plan `2026-09-04-effect-calculus-joins-the-component-action-registry`,
 * Design decision 4 step 3.
 *
 * The property these tests exist for is the UNDEFAULTED one: an action nobody
 * classified must serialize with `effect` ABSENT, never defaulted to `'read'`.
 * A default rendered as a declaration is a fail-open lie on the one surface the
 * annotation protects, so "absent stays absent" is a safety assertion, not a
 * formatting preference.
 */

import { describe, it, expect } from 'vitest';
import { serializeElementCustomActions } from './element-actions';
import { serializeRegisteredElement } from './registry';
import type { CustomAction, RegisteredElement } from './types';

const noop = () => undefined;

function customAction(over: Partial<CustomAction>): CustomAction {
  return { id: 'x', handler: noop, ...over };
}

describe('serializeElementCustomActions', () => {
  it('returns undefined for an element that registered no custom actions', () => {
    // Not `[]`. `JSON.stringify` keeps an empty array and drops `undefined`, so
    // returning `[]` here would change the wire shape of every element in every
    // snapshot.
    expect(serializeElementCustomActions(undefined)).toBeUndefined();
  });

  it('returns [] for an empty record, matching the old Object.keys({}) result', () => {
    expect(serializeElementCustomActions({})).toEqual([]);
  });

  it('leaves `effect` ABSENT on an un-annotated action — never defaults it', () => {
    const out = serializeElementCustomActions({
      sendKeys: customAction({ id: 'sendKeys' }),
    });

    expect(out).toEqual([{ id: 'sendKeys' }]);
    // The load-bearing assertion: not `'read'`, and not present-but-undefined.
    // `toEqual` ignores undefined-valued keys, so assert on the key set too.
    expect(Object.keys(out![0])).toEqual(['id']);
    expect('effect' in out![0]).toBe(false);
    expect(JSON.parse(JSON.stringify(out))).toEqual([{ id: 'sendKeys' }]);
  });

  it('does not default `effect` even for an id that IS a standard verb', () => {
    // `focus` is in STANDARD_ACTION_EFFECTS (`core/action-effect.ts`). The verb
    // map is applied at the CONSUMER, never at the projection — if this ever
    // emits `'read'`, the projection started lying on an author's behalf.
    const out = serializeElementCustomActions({ focus: customAction({ id: 'focus' }) });
    expect('effect' in out![0]).toBe(false);
  });

  it('carries a declared `destructive` class through verbatim', () => {
    const out = serializeElementCustomActions({
      sendKeys: customAction({
        id: 'sendKeys',
        label: 'Send keys',
        description: 'Writes raw bytes into a live PTY',
        effect: 'destructive',
      }),
    });

    expect(out).toEqual([
      {
        id: 'sendKeys',
        label: 'Send keys',
        description: 'Writes raw bytes into a live PTY',
        effect: 'destructive',
      },
    ]);
  });

  it('carries `read` and `write` through verbatim too', () => {
    const out = serializeElementCustomActions({
      getScrollback: customAction({ id: 'getScrollback', effect: 'read' }),
      saveDraft: customAction({ id: 'saveDraft', effect: 'write' }),
    });
    expect(out).toEqual([
      { id: 'getScrollback', effect: 'read' },
      { id: 'saveDraft', effect: 'write' },
    ]);
  });

  it('emits the RECORD KEY as `id` — the name the executor dispatches on', () => {
    // The executor looks up `owner.customActions[action]`, so the key is the
    // invocable name. A wire `id` a caller could not invoke would be worse than
    // useless.
    const out = serializeElementCustomActions({
      'wire-name': customAction({ id: 'some-other-id', effect: 'write' }),
    });
    expect(out).toEqual([{ id: 'wire-name', effect: 'write' }]);
  });

  it('skips a nullish entry rather than advertising an undispatchable action', () => {
    const out = serializeElementCustomActions({
      real: customAction({ id: 'real' }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      broken: undefined as any,
    });
    expect(out).toEqual([{ id: 'real' }]);
  });
});

describe('serializeRegisteredElement custom-action projection', () => {
  function element(customActions?: Record<string, CustomAction>): RegisteredElement {
    const node = document.createElement('button');
    return {
      id: 'el-1',
      element: node,
      type: 'button',
      actions: ['click'],
      customActions,
      getState: () => ({ visible: true, enabled: true }),
      getIdentifier: () => ({ id: 'el-1' }),
      registeredAt: 0,
      mounted: true,
    } as unknown as RegisteredElement;
  }

  it('emits objects, not bare names', () => {
    const out = serializeRegisteredElement(
      element({ sendKeys: customAction({ id: 'sendKeys', effect: 'destructive' }) })
    );
    expect(out.customActions).toEqual([{ id: 'sendKeys', effect: 'destructive' }]);
  });

  it('keeps `effect` absent through the full projection when nothing declared it', () => {
    const out = serializeRegisteredElement(element({ sendKeys: customAction({ id: 'sendKeys' }) }));
    expect(out.customActions).toEqual([{ id: 'sendKeys' }]);
    expect('effect' in out.customActions![0]).toBe(false);
  });

  it('omits the field entirely for an element with no custom actions', () => {
    expect(serializeRegisteredElement(element()).customActions).toBeUndefined();
  });
});
