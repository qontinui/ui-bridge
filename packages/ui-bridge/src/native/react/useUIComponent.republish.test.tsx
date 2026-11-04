/**
 * The parent package's native `useUIComponent` republishes its declaration.
 *
 * Plan `2026-11-02-parent-native-useuicomponent-still-publishes-its`, Phase 2.
 * The hook is exported as `@qontinui/ui-bridge/native` and documented as a
 * supported entry point, and it had every hole the sibling
 * `@qontinui/ui-bridge-native` hook had closed:
 *
 *   - the declaration (labels, `effect`, `paramSchema`, a conditional action)
 *     was a fossil of the first render;
 *   - the registered handler was the mount-time closure;
 *   - `addElement` / `removeElement` wrote a private ref and nothing else;
 *   - the refs-sync effect wiped `updateActions` writes on an inline array;
 *   - `name` / `description` changes and every `updateActions` call republished
 *     by teardown — a spurious `component:unregistered` with the component
 *     ABSENT in between;
 *   - `registered` was a ref read during render and `registeredComponent` a memo
 *     that ran before registration.
 *
 * ⚠ STABLE bridge mock, on purpose. `bridge` was a dependency of the old
 * `register`, so under the churning `() => ({ registry })` mock the existing
 * phase2/phase4 tests use, the unfixed hook re-registered on EVERY render and
 * every freshness assertion here would have passed against the defect. That
 * churning mock is kept only for the termination guard those two files provide
 * (the sibling's first fix OOM'd a 4 GB worker under it).
 *
 * Every test drives at least three renders: the second render always runs an
 * update effect, so a fix that only works on render two would pass a two-render
 * test for the wrong reason.
 *
 * Every test below except the id-change one was observed to FAIL against the
 * unfixed hook; the id-change test is a port guard (see its comment).
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { NativeUIBridgeRegistry } from '../core/registry';
import type { UIBridgeNativeContextValue } from './UIBridgeNativeProvider';

const registry = new NativeUIBridgeRegistry();

// One bridge object for the life of the file — a realistic, stable provider.
// The REAL provider is kept for the provider-stability test at the bottom.
vi.mock('./UIBridgeNativeProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./UIBridgeNativeProvider')>();
  let cached: { registry: NativeUIBridgeRegistry } | undefined;
  return {
    ...actual,
    useUIBridgeNativeOptional: () => (cached ??= { registry }),
  };
});

// Imported AFTER the mock declaration so the hook picks it up.
const { useUIComponent } = await import('./useUIComponent');
const { UIBridgeNativeProvider, useUIBridgeNative } = await import('./UIBridgeNativeProvider');

type Return = ReturnType<typeof useUIComponent>;

/** Count `component:unregistered` events for one id while `fn` runs. */
function countUnregisters(id: string): { stop: () => number } {
  let n = 0;
  const off = registry.on<{ id: string }>('component:unregistered', (event) => {
    if (event.data?.id === id) n += 1;
  });
  return {
    stop: () => {
      off();
      return n;
    },
  };
}

describe('native useUIComponent — the declaration follows the options', () => {
  it('publishes a state-derived action label on every change', () => {
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

    act(() => applyCount(1));
    expect(registry.getComponent('cart')?.actions[0].label).toBe('Checkout (1)');

    act(() => applyCount(3));
    expect(registry.getComponent('cart')?.actions[0].label).toBe('Checkout (3)');
    unmount();
  });

  it('publishes an effect change, including a conditional destructive action', () => {
    let applyStage!: (n: number) => void;

    function Harness(): React.ReactElement {
      const [stage, setStage] = React.useState(0);
      applyStage = setStage;
      useUIComponent({
        id: 'row',
        name: 'Row',
        actions: [
          { id: 'open', effect: stage >= 1 ? 'write' : 'read', handler: () => 'opened' },
          ...(stage >= 2
            ? [{ id: 'delete', effect: 'destructive' as const, handler: () => 'deleted' }]
            : []),
        ],
      });
      return React.createElement('div');
    }

    const { unmount } = render(React.createElement(Harness));
    expect(registry.getComponent('row')?.actions.map((a) => [a.id, a.effect])).toEqual([
      ['open', 'read'],
    ]);

    act(() => applyStage(1));
    expect(registry.getComponent('row')?.actions.map((a) => [a.id, a.effect])).toEqual([
      ['open', 'write'],
    ]);

    act(() => applyStage(2));
    // The annotation that keeps an autonomous walk from pressing it — an
    // unpublished one protects nothing.
    expect(registry.getComponent('row')?.actions.map((a) => [a.id, a.effect])).toEqual([
      ['open', 'write'],
      ['delete', 'destructive'],
    ]);
    unmount();
  });

  it('publishes a paramSchema that widens after mount', () => {
    let applyOptions!: (o: string[]) => void;

    function Harness(): React.ReactElement {
      const [choices, setChoices] = React.useState<string[]>([]);
      applyOptions = setChoices;
      useUIComponent({
        id: 'picker',
        name: 'Picker',
        actions: [
          {
            id: 'pick',
            paramSchema: { type: 'object', properties: { value: { enum: choices } } },
            handler: () => 'picked',
          },
        ],
      });
      return React.createElement('div');
    }

    const enumOf = () =>
      (
        registry.getComponent('picker')?.actions[0].paramSchema as {
          properties: { value: { enum: string[] } };
        }
      ).properties.value.enum;

    const { unmount } = render(React.createElement(Harness));
    expect(enumOf()).toEqual([]);

    act(() => applyOptions(['a']));
    expect(enumOf()).toEqual(['a']);

    act(() => applyOptions(['a', 'b']));
    expect(enumOf()).toEqual(['a', 'b']);
    unmount();
  });

  it('runs the CURRENT render closure, not the mount-time one', async () => {
    let applyAmount!: (n: number) => void;

    function Harness(): React.ReactElement {
      const [amount, setAmount] = React.useState(1);
      applyAmount = setAmount;
      // Nothing PUBLISHED moves — only the closure does, which a signature-keyed
      // republish cannot see and the trampoline has to carry.
      useUIComponent({
        id: 'stepper',
        name: 'Stepper',
        actions: [{ id: 'read', label: 'Read', handler: () => amount }],
      });
      return React.createElement('div');
    }

    const { unmount } = render(React.createElement(Harness));
    expect(await registry.getComponent('stepper')?.actions[0].handler()).toBe(1);

    act(() => applyAmount(7));
    expect(await registry.getComponent('stepper')?.actions[0].handler()).toBe(7);

    act(() => applyAmount(42));
    expect(await registry.getComponent('stepper')?.actions[0].handler()).toBe(42);
    unmount();
  });
});

describe('native useUIComponent — imperative APIs reach the registry', () => {
  it('addElement / removeElement publish, and survive inline elementIds re-renders', () => {
    let api!: Return;
    let bump!: () => void;

    function Harness(): React.ReactElement {
      const [, tick] = React.useReducer((n: number) => n + 1, 0);
      bump = tick;
      // A fresh inline array every render — the call-site shape that used to
      // reset the imperative writes.
      api = useUIComponent({ id: 'panel', name: 'Panel', elementIds: ['a'] });
      return React.createElement('div');
    }

    const { unmount } = render(React.createElement(Harness));
    expect(registry.getComponent('panel')?.elementIds).toEqual(['a']);

    act(() => api.addElement('b'));
    expect(registry.getComponent('panel')?.elementIds).toEqual(['a', 'b']);

    act(() => bump());
    act(() => bump());
    expect(registry.getComponent('panel')?.elementIds).toEqual(['a', 'b']);

    act(() => api.removeElement('a'));
    act(() => bump());
    expect(registry.getComponent('panel')?.elementIds).toEqual(['b']);
    unmount();
  });

  it('updateActions publishes in place and survives inline-array re-renders', async () => {
    let api!: Return;
    let bump!: () => void;
    let applyTitle!: (s: string) => void;

    function Harness(): React.ReactElement {
      const [, tick] = React.useReducer((n: number) => n + 1, 0);
      const [title, setTitle] = React.useState('Toolbar');
      bump = tick;
      applyTitle = setTitle;
      api = useUIComponent({
        id: 'toolbar',
        name: title,
        // Inline: a NEW array identity on every render, same value.
        actions: [{ id: 'undo', label: 'Undo', handler: () => 'undone' }],
      });
      return React.createElement('div');
    }

    const unregisters = countUnregisters('toolbar');
    const { unmount } = render(React.createElement(Harness));

    act(() =>
      api.updateActions([
        { id: 'undo', label: 'Undo', handler: () => 'undone' },
        { id: 'redo', label: 'Redo', handler: () => 'redone' },
      ])
    );
    expect(registry.getComponent('toolbar')?.actions.map((a) => a.id)).toEqual(['undo', 'redo']);

    act(() => bump());
    act(() => bump());
    // A republish (the name change) must re-assert the imperative list, not the
    // declared one the inline array would have reset it to.
    act(() => applyTitle('Editor toolbar'));

    const component = registry.getComponent('toolbar');
    expect(component?.name).toBe('Editor toolbar');
    expect(component?.actions.map((a) => a.id)).toEqual(['undo', 'redo']);
    expect(await component?.actions[1].handler()).toBe('redone');
    // No unregister/register gap at any point.
    expect(unregisters.stop()).toBe(0);
    unmount();
  });
});

describe('native useUIComponent — registration lifecycle', () => {
  it('publishes name / description changes in place, with no unregister', () => {
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

    const unregisters = countUnregisters('invoice');
    const { unmount } = render(React.createElement(Harness));

    act(() => applyPhase('review'));
    expect(registry.getComponent('invoice')?.name).toBe('Invoice (review)');

    act(() => applyPhase('final'));
    expect(registry.getComponent('invoice')?.name).toBe('Invoice (final)');
    expect(registry.getComponent('invoice')?.description).toBe('An invoice in the final phase');

    expect(unregisters.stop()).toBe(0);
    unmount();
  });

  it('reports `registered` and `registeredComponent` as rendered, fresh values', () => {
    const seen: boolean[] = [];
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
      seen.push(api.registered);
      return React.createElement('div');
    }

    const { unmount } = render(React.createElement(Harness));
    expect(seen[0]).toBe(false);
    expect(api.registered).toBe(true);
    expect(api.registeredComponent?.actions[0].label).toBe('Save');

    act(() => applyLabel('Save draft'));
    expect(api.registeredComponent?.actions[0].label).toBe('Save draft');

    act(() => applyLabel('Save final'));
    expect(api.registeredComponent?.actions[0].label).toBe('Save final');
    expect(api.registeredComponent).toBe(registry.getComponent('form'));
    unmount();
  });

  // PORT GUARD: this behaviour was correct before the fix (the old effect
  // re-ran on `id` through its `register`/`unregister` deps), so it passes
  // against the unfixed hook. It exists because the ported shape keys the
  // auto-register effect on `[autoRegister, bridge, id]` through refs — drop
  // `id` from those deps, or the `registeredIdRef` teardown, and this fails.
  it('moves the registration on an id change and leaves no entry for the old id', () => {
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
    expect(registry.getComponent('cell-1')).toBeUndefined();
    expect(registry.getComponent('cell-2')).toBeDefined();

    act(() => applyId('cell-3'));
    expect(registry.getComponent('cell-2')).toBeUndefined();
    expect(registry.getComponent('cell-3')).toBeDefined();

    unmount();
    expect(registry.getComponent('cell-3')).toBeUndefined();
  });
});

describe('UIBridgeNativeProvider (parent /native) — context identity', () => {
  it('keeps one context value across re-renders with inline features/config', () => {
    const seen: UIBridgeNativeContextValue[] = [];
    let forceRender!: () => void;

    function Probe(): null {
      seen.push(useUIBridgeNative());
      return null;
    }

    function Host(): React.ReactElement {
      const [, bump] = React.useReducer((n: number) => n + 1, 0);
      forceRender = bump;
      // Fresh literals every render — the provider's own documented usage.
      // `<Probe />` is built inside this render, so it genuinely re-renders
      // whether or not the context value changed.
      return React.createElement(
        UIBridgeNativeProvider,
        { features: { server: false }, config: { serverPort: 8087 } },
        React.createElement(Probe)
      );
    }

    const { unmount } = render(React.createElement(Host));
    act(() => forceRender());
    act(() => forceRender());

    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(new Set(seen).size).toBe(1);
    unmount();
  });
});
