/**
 * Phase 4 — the verb→effect map, the precedence rule, the registry round-trip
 * and the wire projection in `@qontinui/ui-bridge-native`.
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phase 4.
 *
 * This package cannot import from `@qontinui/ui-bridge` (an OPTIONAL peer), so
 * `IREffect`, the map and the resolver are DUPLICATED here on purpose. That
 * duplication is exactly what these literal assertions defend: a copy that
 * drifts is the defect class the whole plan exists to close.
 *
 * Note the native union here carries `click` and `setValue` that the
 * `@qontinui/ui-bridge` `native/core` copy does not — a real divergence
 * between the two native unions, asserted below so it stays deliberate.
 *
 * Every expectation is a hand-written literal — never the type, never the map
 * constant, no `satisfies`, no type assertions.
 */

import { describe, it, expect } from 'vitest';
import {
  NATIVE_STANDARD_ACTION_EFFECTS,
  nativeStandardActionEffect,
  resolveActionEffect,
} from './action-effect';
import { NativeUIBridgeRegistry } from './registry';
import { createServerHandlers } from '../server/handlers';

describe('Phase 4 — NATIVE_STANDARD_ACTION_EFFECTS (ui-bridge-native)', () => {
  it('classifies every native verb exactly as written here', () => {
    expect(NATIVE_STANDARD_ACTION_EFFECTS).toEqual({
      press: 'write',
      click: 'write',
      longPress: 'read',
      doubleTap: 'write',
      type: 'write',
      setValue: 'write',
      clear: 'write',
      focus: 'read',
      blur: 'read',
      scroll: 'read',
      swipe: 'write',
      toggle: 'write',
    });
  });

  it('covers exactly 12 verbs — two more than the ui-bridge/native copy', () => {
    expect(Object.keys(NATIVE_STANDARD_ACTION_EFFECTS)).toHaveLength(12);
    expect(nativeStandardActionEffect('click')).toBe('write');
    expect(nativeStandardActionEffect('setValue')).toBe('write');
  });

  it('never defaults a verb to destructive', () => {
    expect(Object.values(NATIVE_STANDARD_ACTION_EFFECTS)).not.toContain('destructive');
  });

  it('reads a representative read verb and write verb', () => {
    expect(nativeStandardActionEffect('scroll')).toBe('read');
    expect(nativeStandardActionEffect('press')).toBe('write');
  });

  it('classifies longPress as read and swipe as write', () => {
    expect(nativeStandardActionEffect('longPress')).toBe('read');
    expect(nativeStandardActionEffect('swipe')).toBe('write');
  });

  it('returns undefined for a non-verb id', () => {
    expect(nativeStandardActionEffect('archiveInvoice')).toBeUndefined();
    expect(nativeStandardActionEffect('toString')).toBeUndefined();
  });
});

describe('Phase 4 — resolveActionEffect precedence (ui-bridge-native)', () => {
  it('falls back to the verb map when nothing is declared', () => {
    expect(resolveActionEffect({ id: 'scroll' })).toBe('read');
    expect(resolveActionEffect({ id: 'press' })).toBe('write');
  });

  it('lets an explicit effect override the verb map', () => {
    expect(resolveActionEffect({ id: 'press', effect: 'destructive' })).toBe('destructive');
    expect(resolveActionEffect({ id: 'swipe', effect: 'read' })).toBe('read');
  });

  it('returns undefined when neither source has an answer', () => {
    expect(resolveActionEffect({ id: 'archiveInvoice' })).toBeUndefined();
  });
});

describe('Phase 4 — effect survives registerComponent (ui-bridge-native)', () => {
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

describe('Phase 4 — effect on the wire (ui-bridge-native)', () => {
  function seedAndHandlers() {
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
    return createServerHandlers(registry, {
      executeAction: async () => ({ success: true }),
      executeComponentAction: async () => ({ success: true }),
    } as never);
  }

  it('getComponents emits the annotation', async () => {
    const resp = (await seedAndHandlers().getComponents()) as { data: unknown };
    const wire = JSON.parse(JSON.stringify(resp.data)) as {
      components: Array<{ id: string; actions: Array<Record<string, unknown>> }>;
    };
    const comp = wire.components.find((c) => c.id === 'invoice-row');

    expect(comp?.actions[0]).toEqual({ id: 'press', label: 'Delete', effect: 'destructive' });
    expect(comp?.actions[1]).toEqual({ id: 'rename', label: 'Rename' });
  });

  it('getComponent emits the annotation', async () => {
    const resp = (await seedAndHandlers().getComponent({
      params: { id: 'invoice-row' },
    } as never)) as { data: unknown };
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
