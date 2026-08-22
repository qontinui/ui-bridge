/**
 * Phase 4 — the NATIVE verb→effect map, the registry round-trip, and the
 * native wire projection, in `@qontinui/ui-bridge`'s `src/native/*` tree (the
 * six published `./native/*` subpath exports).
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phase 4.
 *
 * This subtree is EXCLUDED from `packages/ui-bridge/tsconfig.json` and built
 * with `dts: false`, so it is type-checked by NOTHING. These tests are the only
 * gate on the edits here — and the field-drop they guard against type-checks
 * perfectly anyway, so they would be the right instrument even if it were.
 *
 * Every expectation is a hand-written literal — never `IREffect`, never the
 * map constant, no `satisfies`, no type assertions.
 */

import { describe, it, expect } from 'vitest';
import {
  NATIVE_STANDARD_ACTION_EFFECTS,
  nativeStandardActionEffect,
  resolveActionEffect,
  standardActionEffect,
} from './action-effect';
import { NativeUIBridgeRegistry } from './registry';
import { createServerHandlers } from '../server/handlers';

describe('Phase 4 — NATIVE_STANDARD_ACTION_EFFECTS (ui-bridge/native)', () => {
  it('classifies every native verb exactly as written here', () => {
    expect(NATIVE_STANDARD_ACTION_EFFECTS).toEqual({
      press: 'write',
      longPress: 'read',
      doubleTap: 'write',
      type: 'write',
      clear: 'write',
      focus: 'read',
      blur: 'read',
      scroll: 'read',
      swipe: 'write',
      toggle: 'write',
    });
  });

  it('covers exactly 10 verbs', () => {
    expect(Object.keys(NATIVE_STANDARD_ACTION_EFFECTS)).toHaveLength(10);
  });

  it('never defaults a verb to destructive', () => {
    expect(Object.values(NATIVE_STANDARD_ACTION_EFFECTS)).not.toContain('destructive');
  });

  it('reads a representative read verb and write verb', () => {
    expect(nativeStandardActionEffect('scroll')).toBe('read');
    expect(nativeStandardActionEffect('press')).toBe('write');
  });

  it('classifies longPress as read and swipe as write', () => {
    // longPress reveals a menu; swipe can commit on the gesture itself.
    expect(nativeStandardActionEffect('longPress')).toBe('read');
    expect(nativeStandardActionEffect('swipe')).toBe('write');
  });

  it('returns undefined for a non-verb id', () => {
    expect(nativeStandardActionEffect('archiveInvoice')).toBeUndefined();
    expect(nativeStandardActionEffect('toString')).toBeUndefined();
  });

  it('resolves against the NATIVE verb map, not the web one', () => {
    // `press` exists only in the native union. Resolving it against the web
    // table would return undefined — a silent wrong answer.
    expect(resolveActionEffect({ id: 'press' })).toBe('write');
    expect(resolveActionEffect({ id: 'longPress' })).toBe('read');
    // `click` is a WEB verb and is absent from this tree's native union, so it
    // resolves to nothing here.
    expect(resolveActionEffect({ id: 'click' })).toBeUndefined();
  });

  it('lets an explicit effect override the native verb map', () => {
    expect(resolveActionEffect({ id: 'press', effect: 'destructive' })).toBe('destructive');
    expect(resolveActionEffect({ id: 'swipe', effect: 'read' })).toBe('read');
    expect(resolveActionEffect({ id: 'archiveInvoice' })).toBeUndefined();
  });

  it('still exposes the web verb table under its own name', () => {
    expect(standardActionEffect('rightClick')).toBe('read');
    expect(standardActionEffect('click')).toBe('write');
  });
});

describe('Phase 4 — effect survives the native registerComponent literal', () => {
  it('carries a declared effect into the registered component', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerComponent('invoice-row', {
      name: 'Invoice Row',
      actions: [
        { id: 'press', label: 'Delete', effect: 'destructive', handler: () => 'deleted' },
        { id: 'preview', label: 'Preview', effect: 'read', handler: () => 'previewed' },
        { id: 'rename', label: 'Rename', handler: () => 'renamed' },
      ],
    });

    const registered = registry.getComponent('invoice-row');
    expect(registered?.actions.map((a) => a.id)).toEqual(['press', 'preview', 'rename']);
    expect(registered?.actions[0].effect).toBe('destructive');
    expect(registered?.actions[1].effect).toBe('read');
    expect(registered?.actions[2].effect).toBeUndefined();
  });
});

describe('Phase 4 — effect on the native wire', () => {
  function handlersFor(registry: NativeUIBridgeRegistry) {
    return createServerHandlers(registry, {
      executeAction: async () => ({ success: true }),
      executeComponentAction: async () => ({ success: true }),
    } as never);
  }

  function seed(): NativeUIBridgeRegistry {
    const registry = new NativeUIBridgeRegistry();
    registry.registerComponent('invoice-row', {
      name: 'Invoice Row',
      actions: [
        {
          id: 'press',
          label: 'Delete',
          description: 'Permanently delete this invoice',
          effect: 'destructive',
          handler: () => 'deleted',
        },
        { id: 'rename', label: 'Rename', handler: () => 'renamed' },
      ],
    });
    return registry;
  }

  it('getComponents emits the annotation', async () => {
    const resp = (await handlersFor(seed()).getComponents()) as {
      success: boolean;
      data: { components: Array<{ id: string; actions: Array<Record<string, unknown>> }> };
    };
    const wire = JSON.parse(JSON.stringify(resp.data)) as {
      components: Array<{ id: string; actions: Array<Record<string, unknown>> }>;
    };
    const comp = wire.components.find((c) => c.id === 'invoice-row');

    expect(comp?.actions[0]).toEqual({ id: 'press', label: 'Delete', effect: 'destructive' });
    expect(comp?.actions[1]).toEqual({ id: 'rename', label: 'Rename' });
  });

  it('getComponent emits the annotation', async () => {
    const resp = (await handlersFor(seed()).getComponent({
      params: { id: 'invoice-row' },
    } as never)) as { success: boolean; data: { component: { actions: unknown[] } } };
    const wire = JSON.parse(JSON.stringify(resp.data)) as {
      component: { actions: Array<Record<string, unknown>> };
    };

    expect(wire.component.actions[0]).toEqual({
      id: 'press',
      label: 'Delete',
      description: 'Permanently delete this invoice',
      effect: 'destructive',
    });
    expect(wire.component.actions[1]).toEqual({ id: 'rename', label: 'Rename' });
  });
});
