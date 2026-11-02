/**
 * What the registry holds for a `useUIComponent` stays current across renders
 * of the SAME mount: the published action declaration, the owned element list,
 * and an imperatively installed action list.
 *
 * `/control/components` reads the registry, so a declaration that never reaches
 * it is invisible to an agent. The sharp edge is `effect: 'destructive'` on an
 * action that only exists while a row is selected: an autonomous walk excludes
 * destructive actions, and an unpublished annotation protects nothing.
 *
 * `ui-bridge-native` closed the declaration half of this in efc4513.
 *
 * A test of a change on a later render needs at least THREE renders. The second
 * render always runs the hook's update effect, because the component key moves
 * from `null` (not yet registered when the first render computed it) to a real
 * value, so a change made on render two passes against the defect.
 *
 * Every expectation is a hand-written literal.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { UIBridgeRegistry } from '../core/registry';
import type { EffectSignature } from '../control/effect-types';
import type { ComponentActionDef, UseUIComponentReturn } from './useUIComponent';

const registry = new UIBridgeRegistry();
// ONE bridge object for every render, like the real provider's context value.
// A fresh `{ registry }` per call re-runs the update effect every render and
// masks the staleness this file pins.
let bridge = { registry };

vi.mock('./UIBridgeProvider', () => ({
  useUIBridgeOptional: () => bridge,
}));

// Imported AFTER the mock declaration so the hook picks it up.
const { useUIComponent } = await import('./useUIComponent');

function Harness({
  id,
  actions,
  elementIds,
  tick = 0,
  onHook,
}: {
  id: string;
  actions?: ComponentActionDef[];
  elementIds?: string[];
  tick?: number;
  onHook?: (hook: UseUIComponentReturn) => void;
}) {
  const hook = useUIComponent({
    id,
    name: 'Panel',
    actions,
    elementIds,
    // A fresh inline getter each render, the shape #273 fixed and the common
    // call site: it re-runs anything keyed on `options.state`.
    state: () => ({ tick }),
  });
  onHook?.(hook);
  return <div />;
}

function action(id: string, extra: Partial<ComponentActionDef> = {}): ComponentActionDef {
  return { id, handler: () => id, ...extra };
}

function published(id: string) {
  return registry.getComponent(id)?.actions.map((a) => ({
    id: a.id,
    label: a.label,
    description: a.description,
    effect: a.effect,
    paramSchema: a.paramSchema,
  }));
}

describe('useUIComponent declaration freshness', () => {
  it('publishes a label that changes on a later render', () => {
    const { rerender } = render(
      <Harness id="label" actions={[action('open', { label: 'Open (0)' })]} />
    );
    rerender(<Harness id="label" actions={[action('open', { label: 'Open (1)' })]} />);
    rerender(<Harness id="label" actions={[action('open', { label: 'Open (2)' })]} />);

    expect(published('label')?.[0]?.label).toBe('Open (2)');
  });

  it('publishes an action that only exists from a later render, with its effect', () => {
    const base = [action('open')];
    const { rerender } = render(<Harness id="late-action" actions={base} />);
    rerender(<Harness id="late-action" actions={base} />);
    rerender(
      <Harness id="late-action" actions={[...base, action('delete', { effect: 'destructive' })]} />
    );

    expect(published('late-action')?.map((a) => [a.id, a.effect])).toEqual([
      ['open', undefined],
      ['delete', 'destructive'],
    ]);
  });

  it('withdraws an action dropped on a later render', () => {
    const { rerender } = render(
      <Harness id="dropped" actions={[action('open'), action('delete')]} />
    );
    rerender(<Harness id="dropped" actions={[action('open'), action('delete')]} />);
    rerender(<Harness id="dropped" actions={[action('open')]} />);

    expect(published('dropped')?.map((a) => a.id)).toEqual(['open']);
  });

  it('publishes a paramSchema that widens on a later render', () => {
    const narrow = { type: 'object', properties: { row: { type: 'string' } } };
    const wide = {
      type: 'object',
      properties: { row: { type: 'string' }, force: { type: 'boolean' } },
    };
    const { rerender } = render(
      <Harness id="schema" actions={[action('open', { paramSchema: narrow })]} />
    );
    rerender(<Harness id="schema" actions={[action('open', { paramSchema: narrow })]} />);
    rerender(<Harness id="schema" actions={[action('open', { paramSchema: wide })]} />);

    expect(published('schema')?.[0]?.paramSchema).toEqual(wide);
  });

  it('publishes an effect flip on an action whose id and list did not change', () => {
    const write = [action('purge', { effect: 'write' })];
    const { rerender } = render(<Harness id="effect-flip" actions={write} />);
    rerender(<Harness id="effect-flip" actions={write} />);
    rerender(<Harness id="effect-flip" actions={[action('purge', { effect: 'destructive' })]} />);

    expect(published('effect-flip')?.[0]?.effect).toBe('destructive');
  });

  it('publishes a description change on its own', () => {
    const before = [action('open', { description: 'before' })];
    const { rerender } = render(<Harness id="desc" actions={before} />);
    rerender(<Harness id="desc" actions={before} />);
    rerender(<Harness id="desc" actions={[action('open', { description: 'after' })]} />);

    expect(published('desc')?.[0]?.description).toBe('after');
  });

  it('publishes an action gaining a signature', () => {
    const signature = { predicts: () => [] } as unknown as EffectSignature;
    const { rerender } = render(<Harness id="sig" actions={[action('open')]} />);
    rerender(<Harness id="sig" actions={[action('open')]} />);
    rerender(<Harness id="sig" actions={[action('open', { signature })]} />);

    expect(registry.getComponent('sig')?.actions[0]?.signature).toBe(signature);
  });

  it('survives a paramSchema that cannot be serialized', () => {
    const cyclic: Record<string, unknown> = { type: 'object' };
    cyclic.self = cyclic;
    const { rerender } = render(
      <Harness id="cyclic" actions={[action('open', { paramSchema: cyclic })]} />
    );
    rerender(<Harness id="cyclic" actions={[action('open', { paramSchema: cyclic })]} />);
    rerender(
      <Harness id="cyclic" actions={[action('open', { paramSchema: cyclic, label: 'New' })]} />
    );

    expect(published('cyclic')?.[0]?.label).toBe('New');
  });

  it('does not rewrite the registry when only a handler closure changed', () => {
    const { rerender } = render(<Harness id="quiet" actions={[action('open')]} />);
    // Settle: the second render's null-to-key transition is the one expected write.
    rerender(<Harness id="quiet" actions={[action('open')]} />);

    const update = vi.spyOn(registry, 'updateComponent');
    rerender(<Harness id="quiet" actions={[action('open')]} />);
    rerender(<Harness id="quiet" actions={[action('open')]} />);

    expect(update).not.toHaveBeenCalled();
    update.mockRestore();
  });

  it('keeps calling the latest handler after a republish', () => {
    const first = vi.fn(() => 'first');
    const second = vi.fn(() => 'second');
    const { rerender } = render(
      <Harness id="handler" actions={[action('open', { label: 'a', handler: first })]} />
    );
    rerender(<Harness id="handler" actions={[action('open', { label: 'a', handler: first })]} />);
    rerender(<Harness id="handler" actions={[action('open', { label: 'b', handler: second })]} />);

    registry.getComponent('handler')?.actions[0]?.handler();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

describe('useUIComponent lists the hook does not own', () => {
  it('keeps an updateActions list working across later renders that declare no actions', () => {
    let hook!: UseUIComponentReturn;
    const handler = vi.fn(() => 'done');
    const { rerender } = render(
      <Harness
        id="imperative"
        onHook={(h) => {
          hook = h;
        }}
      />
    );
    rerender(<Harness id="imperative" tick={1} />);

    act(() => hook.updateActions([action('open', { handler })]));
    rerender(<Harness id="imperative" tick={2} />);
    rerender(<Harness id="imperative" tick={3} />);

    expect(published('imperative')?.map((a) => a.id)).toEqual(['open']);
    registry.getComponent('imperative')?.actions[0]?.handler();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('keeps an updateActions list reachable when inline actions churn, until they change value', () => {
    let hook!: UseUIComponentReturn;
    const onHook = (h: UseUIComponentReturn) => {
      hook = h;
    };
    const extra = vi.fn(() => 'extra');
    const { rerender } = render(<Harness id="both" actions={[action('open')]} onHook={onHook} />);
    rerender(<Harness id="both" actions={[action('open')]} onHook={onHook} />);

    act(() => hook.updateActions([action('open'), action('extra', { handler: extra })]));
    rerender(<Harness id="both" actions={[action('open')]} onHook={onHook} />);
    rerender(<Harness id="both" actions={[action('open')]} onHook={onHook} />);

    expect(published('both')?.map((a) => a.id)).toEqual(['open', 'extra']);
    registry.getComponent('both')?.actions[1]?.handler();
    expect(extra).toHaveBeenCalledTimes(1);

    // The declared list changed value: the call site said something newer.
    rerender(<Harness id="both" actions={[action('open', { label: 'New' })]} onHook={onHook} />);
    expect(published('both')?.map((a) => [a.id, a.label])).toEqual([['open', 'New']]);
  });

  it('runs the latest declared handler for an id also in an updateActions list', () => {
    let hook!: UseUIComponentReturn;
    const onHook = (h: UseUIComponentReturn) => {
      hook = h;
    };
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(
      <Harness id="overlap" actions={[action('inc', { handler: first })]} onHook={onHook} />
    );
    rerender(
      <Harness id="overlap" actions={[action('inc', { handler: first })]} onHook={onHook} />
    );

    act(() => hook.updateActions([action('inc', { handler: first }), action('reset')]));
    rerender(
      <Harness id="overlap" actions={[action('inc', { handler: latest })]} onHook={onHook} />
    );

    registry.getComponent('overlap')?.actions[0]?.handler();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('runs the updateActions handler for an id in a stable declared list', () => {
    let hook!: UseUIComponentReturn;
    const onHook = (h: UseUIComponentReturn) => {
      hook = h;
    };
    const declaredHandler = vi.fn();
    const installed = vi.fn();
    const declared = [action('save', { handler: declaredHandler })];
    const { rerender } = render(<Harness id="stable" actions={declared} onHook={onHook} />);
    rerender(<Harness id="stable" actions={declared} onHook={onHook} />);

    act(() => hook.updateActions([action('save', { handler: installed })]));
    rerender(<Harness id="stable" actions={declared} onHook={onHook} />);

    registry.getComponent('stable')?.actions[0]?.handler();
    expect(installed).toHaveBeenCalledTimes(1);
    expect(declaredHandler).not.toHaveBeenCalled();
  });

  it('does not publish an updateActions list under a new id', () => {
    let hook!: UseUIComponentReturn;
    const onHook = (h: UseUIComponentReturn) => {
      hook = h;
    };
    const declared = [action('open')];
    const { rerender } = render(<Harness id="row-1" actions={declared} onHook={onHook} />);
    rerender(<Harness id="row-1" actions={declared} onHook={onHook} />);

    act(() => hook.updateActions([action('delete', { effect: 'destructive' })]));
    expect(published('row-1')?.map((a) => a.id)).toEqual(['delete']);

    rerender(<Harness id="row-2" actions={declared} onHook={onHook} />);
    expect(published('row-2')?.map((a) => a.id)).toEqual(['open']);
  });

  it('keeps an updateActions list installed before the hook first ran its effects', () => {
    const list = [action('from-child')];
    function Child({ install }: { install: (actions: ComponentActionDef[]) => void }) {
      React.useEffect(() => {
        install(list);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return null;
    }
    function Parent() {
      const hook = useUIComponent({ id: 'child-install', name: 'Panel' });
      return <Child install={hook.updateActions} />;
    }
    const { rerender } = render(<Parent />);
    rerender(<Parent />);
    rerender(<Parent />);

    expect(published('child-install')?.map((a) => a.id)).toEqual(['from-child']);
  });

  it('publishes an owned element whose id addElement already wrote', () => {
    let hook!: UseUIComponentReturn;
    const { rerender } = render(
      <Harness
        id="pre-added"
        onHook={(h) => {
          hook = h;
        }}
      />
    );
    rerender(<Harness id="pre-added" tick={1} />);

    act(() => hook.addElement('owned-f'));
    act(() => {
      registry.registerElement('owned-f', document.createElement('button'), {
        ownedByComponent: 'pre-added',
      });
    });

    expect(registry.getComponent('pre-added')?.elementIds).toEqual(['owned-f']);
  });

  it('restores a declared id when its unowned element remounts', () => {
    const { rerender } = render(<Harness id="remount" elementIds={['save-btn']} />);
    rerender(<Harness id="remount" elementIds={['save-btn']} />);

    act(() => {
      registry.registerElement('save-btn', document.createElement('button'));
    });
    act(() => registry.unregisterElement('save-btn'));
    expect(registry.getComponent('remount')?.elementIds).toEqual([]);

    act(() => {
      registry.registerElement('save-btn', document.createElement('button'));
    });
    expect(registry.getComponent('remount')?.elementIds).toEqual(['save-btn']);
  });

  it('keeps an addElement id across its unowned element remounting', () => {
    let hook!: UseUIComponentReturn;
    const onHook = (h: UseUIComponentReturn) => {
      hook = h;
    };
    const { rerender } = render(<Harness id="added-remount" onHook={onHook} />);
    rerender(<Harness id="added-remount" onHook={onHook} />);

    act(() => hook.addElement('kept'));
    act(() => {
      registry.registerElement('kept', document.createElement('button'));
    });
    act(() => registry.unregisterElement('kept'));
    act(() => {
      registry.registerElement('kept', document.createElement('button'));
    });
    // A published-option change is what writes the hook's list to the registry.
    rerender(<Harness id="added-remount" actions={[action('x')]} onHook={onHook} />);

    expect(registry.getComponent('added-remount')?.elementIds).toEqual(['kept']);
  });

  it('does not carry owned ids to a new bridge', () => {
    const { rerender } = render(<Harness id="swap" />);
    act(() => {
      registry.registerElement('owned-g', document.createElement('button'), {
        ownedByComponent: 'swap',
      });
    });
    expect(registry.getComponent('swap')?.elementIds).toEqual(['owned-g']);

    const original = bridge;
    const second = new UIBridgeRegistry();
    bridge = { registry: second };
    try {
      rerender(<Harness id="swap" tick={1} />);
      expect(second.getComponent('swap')?.elementIds).toEqual([]);
    } finally {
      bridge = original;
    }
  });

  it('does not bring back an owned element removeElement took out', () => {
    let hook!: UseUIComponentReturn;
    const onHook = (h: UseUIComponentReturn) => {
      hook = h;
    };
    const { rerender } = render(<Harness id="removed" elementIds={['a']} onHook={onHook} />);
    rerender(<Harness id="removed" elementIds={['a']} onHook={onHook} />);
    act(() => {
      registry.registerElement('owned-h', document.createElement('button'), {
        ownedByComponent: 'removed',
      });
    });

    act(() => hook.removeElement('owned-h'));
    rerender(<Harness id="removed" elementIds={['b']} onHook={onHook} />);

    expect(registry.getComponent('removed')?.elementIds).toEqual(['b']);
  });

  it('keeps owned elements when an inline elementIds array keeps its value', () => {
    const { rerender } = render(<Harness id="inline-ids" elementIds={['declared']} />);
    rerender(<Harness id="inline-ids" elementIds={['declared']} />);

    act(() => {
      registry.registerElement('owned-b', document.createElement('button'), {
        ownedByComponent: 'inline-ids',
      });
    });
    rerender(<Harness id="inline-ids" elementIds={['declared']} tick={1} />);
    rerender(
      <Harness id="inline-ids" elementIds={['declared']} tick={2} actions={[action('x')]} />
    );

    expect(registry.getComponent('inline-ids')?.elementIds).toEqual(['declared', 'owned-b']);
  });

  it('keeps an addElement write when an inline elementIds array keeps its value', () => {
    let hook!: UseUIComponentReturn;
    const onHook = (h: UseUIComponentReturn) => {
      hook = h;
    };
    const { rerender } = render(<Harness id="added" elementIds={['declared']} onHook={onHook} />);
    rerender(<Harness id="added" elementIds={['declared']} onHook={onHook} />);

    act(() => hook.addElement('imperative'));
    rerender(<Harness id="added" elementIds={['declared']} tick={1} onHook={onHook} />);
    // A published-option change is what writes the hook's list to the registry.
    rerender(
      <Harness
        id="added"
        elementIds={['declared']}
        tick={2}
        actions={[action('x')]}
        onHook={onHook}
      />
    );

    expect(registry.getComponent('added')?.elementIds).toEqual(['declared', 'imperative']);
  });

  it('keeps owned elements and the new value when elementIds changes value', () => {
    const { rerender } = render(<Harness id="new-ids" elementIds={['a']} />);
    rerender(<Harness id="new-ids" elementIds={['a']} />);

    act(() => {
      registry.registerElement('owned-c', document.createElement('button'), {
        ownedByComponent: 'new-ids',
      });
    });
    rerender(<Harness id="new-ids" elementIds={['a', 'b']} />);
    expect(registry.getComponent('new-ids')?.elementIds).toEqual(['a', 'b', 'owned-c']);

    // A later registration must not republish a list from before that change.
    act(() => {
      registry.registerElement('owned-d', document.createElement('button'), {
        ownedByComponent: 'new-ids',
      });
    });
    expect(registry.getComponent('new-ids')?.elementIds).toEqual(['a', 'b', 'owned-c', 'owned-d']);

    rerender(<Harness id="new-ids" elementIds={['b']} />);
    expect(registry.getComponent('new-ids')?.elementIds).toEqual(['b', 'owned-c', 'owned-d']);
  });

  it('does not carry owned elements across an id change', () => {
    const { rerender } = render(<Harness id="old-id" />);
    act(() => {
      registry.registerElement('owned-e', document.createElement('button'), {
        ownedByComponent: 'old-id',
      });
    });
    expect(registry.getComponent('old-id')?.elementIds).toEqual(['owned-e']);

    rerender(<Harness id="new-id" />);
    rerender(<Harness id="new-id" tick={1} />);

    expect(registry.getComponent('old-id')).toBeUndefined();
    expect(registry.getComponent('new-id')?.elementIds).toEqual([]);
  });

  it('keeps auto-tracked owned elements when an unrelated option churns', () => {
    const { rerender } = render(<Harness id="owner" />);

    act(() => {
      registry.registerElement('owned-a', document.createElement('button'), {
        ownedByComponent: 'owner',
      });
    });
    expect(registry.getComponent('owner')?.elementIds).toEqual(['owned-a']);

    // The inline `state` re-ran the refs-sync effect, which used to reset the
    // element list to the declared `[]` and publish that on the update effect.
    rerender(<Harness id="owner" tick={1} />);
    rerender(<Harness id="owner" tick={2} />);
    expect(registry.getComponent('owner')?.elementIds).toEqual(['owned-a']);

    // ...and a declaration change, which also writes the list, keeps it too.
    rerender(<Harness id="owner" tick={3} actions={[action('open')]} />);
    expect(registry.getComponent('owner')?.elementIds).toEqual(['owned-a']);
  });
});
