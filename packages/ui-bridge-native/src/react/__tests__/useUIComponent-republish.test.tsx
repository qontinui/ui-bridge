/**
 * @vitest-environment jsdom
 */
/**
 * `useUIComponent` republishes its declaration — PR #176's defect one level up.
 *
 * #176 fixed a frozen ELEMENT label: `useUIElement` published `label` only
 * inside `register()`, so a state-derived label reported its mount-time value
 * forever and `updateLabel` was a manual API nothing told a call site it needed.
 * The measured symptom was five `operations-card-*` elements stuck on `loading`
 * while the screen rendered real data.
 *
 * `useUIComponent` has the identical shape and did not get the fix: `register()`
 * is guarded by `registeredRef`, the auto-register effect re-ran only on
 * `[autoRegister, bridge]`, and every field of the declaration — `name`,
 * `description`, and the whole `actions` list with its labels, descriptions,
 * `paramSchema` and `effect` — was published exactly once. So the component
 * shape an agent reads from `/control/components` was a fossil of the first
 * render, and `updateActions` was the same manual escape hatch `updateLabel`
 * was.
 *
 * Four separate holes are pinned here, each of which fails against the un-fixed
 * hook:
 *
 *   1. a state-derived action label never reaching the registry;
 *   2. an action handler frozen as the mount-time closure, so it reads state
 *      from the render that registered the component;
 *   3. `addElement` / `removeElement` mutating a ref and nothing else — two
 *      returned functions with no observable effect at all;
 *   4. an `id` change leaving the OLD id registered and never registering the
 *      new one, because `id` was missing from the auto-register effect's deps.
 *
 * Plus the idempotence properties that make (1) safe to run from a render path,
 * and the honesty of the returned `registered` / `registeredComponent` values.
 *
 * 12 of the 13 assertions below were confirmed to FAIL against the un-fixed
 * source before being kept; the one that did not is marked where it appears.
 *
 * The setters are aliased to `apply*` outer variables purely so a test body can
 * drive them: the `@eslint-react/use-state` rule requires the destructured
 * setter itself to be named `set<State>`.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { NativeUIBridgeRegistry } from '../../core/registry';
import type { BridgeEventType } from '../../core/types';

const registry = new NativeUIBridgeRegistry();

// One object for the life of the file — a realistic provider, post-#179.
//
// `bridge` is a dependency of the auto-register effect, so a context value with
// churning identity tears the component down and re-registers it on every
// render. That is the defect PR #179 fixed on the provider
// (`provider-context-stability.test.tsx`).
//
// The hook must NOT hang when a provider does churn, though, and that property
// has a guard already: `useUIComponent-effect.phase4.test.tsx` mocks the context
// as a fresh `{ registry }` literal per call. It is what caught the first
// version of this fix, which re-rendered on every registration and turned that
// churn into an unbounded loop — a 4 GB worker OOM, not a clean failure. The
// `publishedIdRef` guard in `register()` is what makes it terminate; do not
// "simplify" it away.
vi.mock('../UIBridgeNativeProvider', () => {
  let cached: { registry: NativeUIBridgeRegistry } | undefined;
  return {
    useUIBridgeNativeOptional: () => (cached ??= { registry }),
  };
});

// Imported AFTER the mock declaration so the hook picks it up.
const { useUIComponent } = await import('../useUIComponent');

type Return = ReturnType<typeof useUIComponent>;

describe('useUIComponent — the declaration republishes on change', () => {
  it('publishes a state-derived action label instead of freezing it at mount', () => {
    let applyCount!: (n: number) => void;

    function Harness(): React.ReactElement {
      const [count, setCount] = React.useState(0);
      applyCount = setCount;
      useUIComponent({
        id: 'cart',
        name: 'Cart',
        actions: [{ id: 'checkout', label: `Checkout (${count})`, handler: () => 'ok' }],
      });
      return React.createElement('div');
    }

    const { unmount } = render(React.createElement(Harness));
    expect(registry.getComponent('cart')?.actions[0].label).toBe('Checkout (0)');

    act(() => applyCount(3));

    // Pre-fix this stayed at 'Checkout (0)' for the life of the mount.
    expect(registry.getComponent('cart')?.actions[0].label).toBe('Checkout (3)');
    unmount();
  });

  it('publishes name and description changes', () => {
    let applyPhase!: (s: string) => void;

    function Harness(): React.ReactElement {
      const [phase, setPhase] = React.useState('draft');
      applyPhase = setPhase;
      useUIComponent({
        id: 'invoice',
        name: `Invoice (${phase})`,
        description: `An invoice in the ${phase} phase`,
        actions: [{ id: 'send', handler: () => 'sent' }],
      });
      return React.createElement('div');
    }

    const { unmount } = render(React.createElement(Harness));
    expect(registry.getComponent('invoice')?.name).toBe('Invoice (draft)');

    act(() => applyPhase('final'));

    expect(registry.getComponent('invoice')?.name).toBe('Invoice (final)');
    expect(registry.getComponent('invoice')?.description).toBe('An invoice in the final phase');
    unmount();
  });

  it('publishes an action that only appears once state allows it', () => {
    let applySelected!: (b: boolean) => void;

    function Harness(): React.ReactElement {
      const [selected, setSelected] = React.useState(false);
      applySelected = setSelected;
      useUIComponent({
        id: 'row',
        name: 'Row',
        actions: selected
          ? [
              { id: 'open', handler: () => 'opened' },
              { id: 'delete', effect: 'destructive' as const, handler: () => 'deleted' },
            ]
          : [{ id: 'open', handler: () => 'opened' }],
      });
      return React.createElement('div');
    }

    const { unmount } = render(React.createElement(Harness));
    expect(registry.getComponent('row')?.actions.map((a) => a.id)).toEqual(['open']);

    act(() => applySelected(true));

    // An action an agent could not have seen at all before the fix — and with
    // it, the `effect: 'destructive'` annotation that keeps an autonomous walk
    // from pressing it.
    expect(registry.getComponent('row')?.actions.map((a) => a.id)).toEqual(['open', 'delete']);
    expect(registry.getComponent('row')?.actions[1].effect).toBe('destructive');
    unmount();
  });

  it('keeps the registered handler on the CURRENT render closure', async () => {
    let applyAmount!: (n: number) => void;

    function Harness(): React.ReactElement {
      const [amount, setAmount] = React.useState(1);
      applyAmount = setAmount;
      useUIComponent({
        id: 'stepper',
        name: 'Stepper',
        // The label never changes, so nothing about the PUBLISHED shape moves.
        // Only the closure does — which is precisely the case a signature-keyed
        // republish cannot notice and the trampoline has to carry.
        actions: [{ id: 'read', label: 'Read', handler: () => amount }],
      });
      return React.createElement('div');
    }

    const { unmount } = render(React.createElement(Harness));
    expect(await registry.getComponent('stepper')?.actions[0].handler()).toBe(1);

    act(() => applyAmount(42));

    // Pre-fix the registry still held the mount-time closure and returned 1.
    expect(await registry.getComponent('stepper')?.actions[0].handler()).toBe(42);
    unmount();
  });
});

describe('useUIComponent — imperative APIs reach the registry', () => {
  it('addElement and removeElement publish, rather than mutating a private ref', () => {
    let api!: Return;

    function Harness(): React.ReactElement {
      api = useUIComponent({ id: 'panel', name: 'Panel', elementIds: ['a'] });
      return React.createElement('div');
    }

    const { unmount } = render(React.createElement(Harness));
    expect(registry.getComponent('panel')?.elementIds).toEqual(['a']);

    act(() => api.addElement('b'));
    // Pre-fix: still ['a'] — `addElement` wrote to a ref the registry never read.
    expect(registry.getComponent('panel')?.elementIds).toEqual(['a', 'b']);

    // And the addition survives the re-render the publish itself causes: the
    // declared `elementIds` option is re-asserted only when its VALUE changes,
    // so the two lanes do not fight.
    act(() => api.removeElement('a'));
    expect(registry.getComponent('panel')?.elementIds).toEqual(['b']);
    unmount();
  });

  it('updateActions publishes in place, without an unregister gap', () => {
    let api!: Return;
    const events: BridgeEventType[] = [];
    const off = registry.on('component:unregistered', () => {
      events.push('component:unregistered');
    });

    function Harness(): React.ReactElement {
      // No `actions` OPTION: this hook is driven purely imperatively, which is
      // the lane a declarative republish must not overwrite.
      api = useUIComponent({ id: 'toolbar', name: 'Toolbar' });
      return React.createElement('div');
    }

    const { unmount } = render(React.createElement(Harness));

    act(() => api.updateActions([{ id: 'undo', label: 'Undo', handler: () => 'undone' }]));

    expect(registry.getComponent('toolbar')?.actions.map((a) => a.id)).toEqual(['undo']);
    // Pre-fix this emitted an unregister/register pair and left the component
    // ABSENT from the registry for the width of the call.
    expect(events).toEqual([]);

    off();
    unmount();
  });

  // The one assertion in this file that ALSO passed before the fix. It is not a
  // regression test for the frozen declaration; it guards the fix itself, which
  // introduces a republish effect that could easily have overwritten the
  // imperative lane with an empty declarative one on the next render.
  it('does not let the declarative lane wipe imperatively-set actions', () => {
    let api!: Return;
    let bump!: () => void;

    function Harness(): React.ReactElement {
      // useReducer rather than useState: the tick VALUE is never read — the
      // render itself is the point — and a discarded useState value trips
      // `@eslint-react/use-state`.
      const [, tick] = React.useReducer((n: number) => n + 1, 0);
      bump = tick;
      api = useUIComponent({ id: 'imperative', name: 'Imperative' });
      return React.createElement('div');
    }

    const { unmount } = render(React.createElement(Harness));
    act(() => api.updateActions([{ id: 'go', handler: () => 'went' }]));
    expect(registry.getComponent('imperative')?.actions.map((a) => a.id)).toEqual(['go']);

    // A re-render with no `actions` option must leave the imperative list alone.
    act(() => bump());
    expect(registry.getComponent('imperative')?.actions.map((a) => a.id)).toEqual(['go']);
    unmount();
  });
});

describe('useUIComponent — registration lifecycle', () => {
  it('re-registers under a new id and leaves no entry for the old one', () => {
    let applyId!: (s: string) => void;

    function Harness(): React.ReactElement {
      const [id, setId] = React.useState('cell-1');
      applyId = setId;
      useUIComponent({ id, name: 'Cell', actions: [{ id: 'press', handler: () => 'ok' }] });
      return React.createElement('div');
    }

    const { unmount } = render(React.createElement(Harness));
    expect(registry.getComponent('cell-1')).toBeDefined();

    act(() => applyId('cell-2'));

    // Pre-fix: `cell-1` stayed registered forever and `cell-2` never appeared,
    // because `id` was not a dep of the auto-register effect. This is the
    // recycled-virtualized-cell case `useUIElement`'s own comment names.
    expect(registry.getComponent('cell-1')).toBeUndefined();
    expect(registry.getComponent('cell-2')).toBeDefined();
    unmount();
  });

  it('reports `registered` as a rendered value, not a ref read during render', () => {
    const seen: boolean[] = [];

    function Harness(): React.ReactElement {
      const { registered } = useUIComponent({ id: 'flagged', name: 'Flagged' });
      seen.push(registered);
      return React.createElement('div');
    }

    const { unmount } = render(React.createElement(Harness));

    // Pre-fix the hook returned `registeredRef.current`, read during render
    // before any effect had set it: `false` on the first render, and never
    // updated afterwards unless something unrelated re-rendered the consumer.
    expect(seen[0]).toBe(false);
    expect(seen[seen.length - 1]).toBe(true);
    unmount();
  });

  it('exposes the registered component and refreshes it on republish', () => {
    let applyLabel!: (s: string) => void;
    let api!: Return;

    function Harness(): React.ReactElement {
      const [label, setLabel] = React.useState('Save');
      applyLabel = setLabel;
      api = useUIComponent({
        id: 'form',
        name: 'Form',
        actions: [{ id: 'submit', label, handler: () => 'ok' }],
      });
      return React.createElement('div');
    }

    const { unmount } = render(React.createElement(Harness));
    // Pre-fix this was a `useMemo` on `[bridge, id]` that ran BEFORE the
    // register effect and never recomputed — permanently `null`.
    expect(api.registeredComponent?.actions[0].label).toBe('Save');

    act(() => applyLabel('Save draft'));
    expect(api.registeredComponent?.actions[0].label).toBe('Save draft');
    unmount();
  });
});

describe('NativeUIBridgeRegistry.updateComponentMeta', () => {
  it('is idempotent over the published shape and reports whether it changed', () => {
    const r = new NativeUIBridgeRegistry();
    r.registerComponent('c', {
      name: 'C',
      actions: [{ id: 'a', label: 'A', handler: () => 1 }],
    });

    // Same published shape, a brand-new handler closure — the render-path case.
    expect(
      r.updateComponentMeta('c', {
        name: 'C',
        actions: [{ id: 'a', label: 'A', handler: () => 2 }],
      })
    ).toBe(false);
    // …and the fresh handler was stored anyway.
    expect(r.getComponent('c')?.actions[0].handler()).toBe(2);

    expect(
      r.updateComponentMeta('c', { actions: [{ id: 'a', label: 'B', handler: () => 2 }] })
    ).toBe(true);
    expect(r.getComponent('c')?.actions[0].label).toBe('B');
  });

  it('leaves omitted fields alone and returns false for an unknown component', () => {
    const r = new NativeUIBridgeRegistry();
    r.registerComponent('c', {
      name: 'C',
      description: 'desc',
      actions: [{ id: 'a', handler: () => 1 }],
      elementIds: ['x'],
    });

    expect(r.updateComponentMeta('c', { name: 'C2' })).toBe(true);
    const after = r.getComponent('c');
    expect(after?.name).toBe('C2');
    expect(after?.description).toBe('desc');
    expect(after?.actions.map((a) => a.id)).toEqual(['a']);
    expect(after?.elementIds).toEqual(['x']);

    expect(r.updateComponentMeta('missing', { name: 'nope' })).toBe(false);
  });

  it('emits component:registered rather than a new event type', () => {
    const r = new NativeUIBridgeRegistry();
    r.registerComponent('c', { name: 'C' });

    const seen: Array<{ id: string; name: string }> = [];
    const off = r.on('component:registered', (event) => {
      seen.push(event.data as { id: string; name: string });
    });

    r.updateComponentMeta('c', { name: 'Renamed' });
    // No-op publishes must stay silent, or a render-path republish becomes an
    // event storm for every subscriber.
    r.updateComponentMeta('c', { name: 'Renamed' });

    expect(seen).toEqual([{ id: 'c', name: 'Renamed' }]);
    off();
  });
});
