/**
 * Regression: the two action paths must not disagree about the same element.
 *
 * ## The defect this pins
 *
 * `serializeRegisteredElement` reports a Radix/shadcn `<SelectTrigger>` as
 * `role: "combobox", tagName: "button"`. `control/action-executor.ts` has
 * serviced that shape since 2026-03, but `react/commandHandlers.ts` — the path
 * the relay's `POST /control/element/<id>/action` actually reaches — handled
 * `HTMLSelectElement` only and answered `Cannot select on BUTTON`. So a driver
 * reading the payload could not tell which answer it would get, and the arm it
 * DID get was a dead end.
 *
 * Measured on `origin/main` at v0.26.0 before this fix: the React path returned
 * `{"success":false,"error":"Cannot select on BUTTON"}` for an element the same
 * snapshot described as a combobox.
 *
 * The second half is the false green: the old combobox implementation
 * `console.warn`ed and RESOLVED when the listbox never opened, so a caller
 * reported success over a control that had not moved.
 *
 * Plan: 2026-09-06-ui-bridge-element-metadata-is-stale-and-misdeclared
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UIBridgeRegistry, setGlobalRegistry } from '../core/registry';
import { executeCommand } from '../react/commandHandlers';
import { seedRegistryFromDom } from '../injected/seed-registry';
import { bridgeAccessOver } from '../injected/bridge-access';
import { comboboxSelect, isComboboxLike } from './combobox-select';

function makeAllVisible(): void {
  document.body.querySelectorAll<HTMLElement>('*').forEach((el) => {
    Object.defineProperty(el, 'offsetParent', { get: () => document.body, configurable: true });
  });
}

/** A Radix-shaped trigger: a `<button>` that declares `role="combobox"`. */
const TRIGGER_HTML = `
  <button id="trigger" role="combobox" aria-expanded="false"
          aria-controls="listbox" data-testid="coord-plans-status-select">status</button>`;

/**
 * Open a listbox on `pointerdown`, the way Radix does — NOT on `click`. A
 * fixture that opened on `click` would pass even against an implementation
 * that only calls `element.click()`, which is what the previous one did.
 */
function wirePointerDownOpensListbox(chosen: { value?: string }): void {
  const trigger = document.getElementById('trigger')!;
  trigger.addEventListener('pointerdown', () => {
    if (document.getElementById('listbox')) return;
    const listbox = document.createElement('div');
    listbox.id = 'listbox';
    listbox.setAttribute('role', 'listbox');
    for (const v of ['any', 'shipped', 'draft']) {
      const opt = document.createElement('div');
      opt.setAttribute('role', 'option');
      opt.setAttribute('data-value', v);
      opt.textContent = v;
      opt.addEventListener('click', () => {
        chosen.value = v;
      });
      listbox.appendChild(opt);
    }
    document.body.appendChild(listbox);
  });
}

describe('combobox select — one implementation behind both action paths', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('isComboboxLike accepts a role="combobox" button and rejects a plain one', () => {
    document.body.innerHTML = `${TRIGGER_HTML}<button id="plain">go</button>`;
    expect(isComboboxLike(document.getElementById('trigger')!)).toBe(true);
    expect(isComboboxLike(document.getElementById('plain')!)).toBe(false);
  });

  it('the REACT relay path selects on a role="combobox" button instead of refusing it', async () => {
    document.body.innerHTML = TRIGGER_HTML;
    const chosen: { value?: string } = {};
    wirePointerDownOpensListbox(chosen);

    const registry = new UIBridgeRegistry();
    setGlobalRegistry(registry);
    seedRegistryFromDom(registry, document.body);
    makeAllVisible();
    const bridge = bridgeAccessOver(registry);
    const entry = registry.getAllElements().find((e) => e.element.id === 'trigger')!;

    // The payload the driver reads advertises a combobox.
    const snapshotEntry = registry.createSnapshot().elements.find((e) => e.id === entry.id)!;
    expect(snapshotEntry.role).toBe('combobox');
    expect(snapshotEntry.tagName).toBe('button');

    const res = (await executeCommand(
      'executeElementAction',
      { id: entry.id, request: { action: 'select', value: 'shipped' } },
      bridge
    )) as { success: boolean; error?: string };

    expect(res.error).toBeUndefined();
    expect(res.success).toBe(true);
    // The round trip, not the action's own response: the option was actuated.
    expect(chosen.value).toBe('shipped');
  });

  it('a listbox that never opens is a TYPED FAILURE, not a resolved no-op', async () => {
    // No `pointerdown` handler at all — the trigger does not open.
    document.body.innerHTML = TRIGGER_HTML;
    document.getElementById('trigger')!.removeAttribute('aria-controls');

    const outcome = await comboboxSelect(document.getElementById('trigger')!, {
      value: 'shipped',
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toBe('dropdown-not-found');
    expect(outcome.ok === false && outcome.message).toContain('did not open');
  });

  it('an open listbox missing the requested option is a TYPED FAILURE', async () => {
    document.body.innerHTML = TRIGGER_HTML;
    wirePointerDownOpensListbox({});

    const outcome = await comboboxSelect(document.getElementById('trigger')!, {
      value: 'no-such-status',
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toBe('option-not-found');
  });

  it('the trigger is actuated with a POINTER sequence, not a bare click', async () => {
    document.body.innerHTML = TRIGGER_HTML;
    const seen: string[] = [];
    const trigger = document.getElementById('trigger')!;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      trigger.addEventListener(type, () => seen.push(type));
    }
    wirePointerDownOpensListbox({});

    await comboboxSelect(trigger, { value: 'shipped' });

    // `pointerdown` FIRST — Radix opens on it and never sees `click`.
    expect(seen[0]).toBe('pointerdown');
    expect(seen).toContain('pointerup');
    expect(seen).toContain('click');
  });

  it('a plain button is still refused, and the refusal says what would work', async () => {
    document.body.innerHTML = `<button id="plain" data-testid="plain">go</button>`;
    const registry = new UIBridgeRegistry();
    setGlobalRegistry(registry);
    seedRegistryFromDom(registry, document.body);
    makeAllVisible();
    const bridge = bridgeAccessOver(registry);
    const entry = registry.getAllElements().find((e) => e.element.id === 'plain')!;

    const res = (await executeCommand(
      'executeElementAction',
      { id: entry.id, request: { action: 'select', value: 'shipped' } },
      bridge
    )) as { success: boolean; error?: string };

    expect(res.success).toBe(false);
    expect(res.error).toContain('Cannot select on BUTTON');
    expect(res.error).toContain('role="combobox"');
  });

  it('no value supplied is a TYPED FAILURE rather than a silent match on undefined', async () => {
    document.body.innerHTML = TRIGGER_HTML;
    const outcome = await comboboxSelect(document.getElementById('trigger')!, {
      value: '',
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toBe('no-value');
  });
});
