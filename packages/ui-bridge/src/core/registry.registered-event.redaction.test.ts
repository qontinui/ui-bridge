/**
 * §4.6 on the registry's `element:registered` event payload.
 *
 * `RegisteredElement.label` is stored raw and scrubbed only when the registry
 * serializes (`createSnapshot`). The `element:registered` event carried that
 * raw label out of the registry, to three consumers:
 *
 * - every `registry.on('element:registered', …)` listener;
 * - the per-element event log, whose entries keep `data` verbatim and are
 *   served by the `getElementHistory` route once an element's log level is
 *   `debug` (a re-registration under that level is ingested);
 * - the `verbose` console line, which console capture can serve.
 *
 * A `data-bridge-redact` element's label therefore left the registry in
 * cleartext. Negative controls pin that a label outside a boundary stays raw
 * and an absent label stays absent.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { UIBridgeRegistry, REDACTED_VALUE } from './registry';
import { ElementEventLog } from '../debug/element-event-log';
import type { BridgeEvent } from './types';

const SECRET = 'Card 4111 1111 1111 1111';
const PUBLIC = 'Save order';

const mounted: HTMLElement[] = [];

function mountButton(redacted: boolean): HTMLElement {
  const host = document.createElement('div');
  if (redacted) host.setAttribute('data-bridge-redact', 'true');
  const button = document.createElement('button');
  button.textContent = 'Go';
  host.appendChild(button);
  document.body.appendChild(host);
  mounted.push(host);
  return button;
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.remove();
  vi.restoreAllMocks();
});

function registeredPayload(
  registry: UIBridgeRegistry,
  id: string,
  el: HTMLElement,
  label: string | undefined
): { id?: string; label?: string } {
  const seen: BridgeEvent[] = [];
  const off = registry.on('element:registered', (e) => seen.push(e as BridgeEvent));
  registry.registerElement(id, el, { type: 'button', ...(label !== undefined ? { label } : {}) });
  off();
  expect(seen).toHaveLength(1);
  return seen[0].data as { id?: string; label?: string };
}

describe('element:registered payload (§4.6)', () => {
  it('collapses a boundary element’s label for listeners', () => {
    const registry = new UIBridgeRegistry();
    const data = registeredPayload(registry, 'card', mountButton(true), SECRET);
    expect(data.id).toBe('card');
    expect(data.label).toBe(REDACTED_VALUE);
    expect(JSON.stringify(data)).not.toContain('4111');
  });

  it('leaves a public label raw (negative control)', () => {
    const registry = new UIBridgeRegistry();
    const data = registeredPayload(registry, 'save', mountButton(false), PUBLIC);
    expect(data.label).toBe(PUBLIC);
  });

  it('leaves an absent label absent (negative control)', () => {
    const registry = new UIBridgeRegistry();
    const data = registeredPayload(registry, 'bare', mountButton(true), undefined);
    expect(data.label).toBeUndefined();
  });

  it('keeps the stored row raw for in-process matching (scope control)', () => {
    // The fix scrubs the PAYLOAD, not the row: in-process consumers that
    // match on the registry's own label (find, selector-match) still see it.
    const registry = new UIBridgeRegistry();
    registry.registerElement('card', mountButton(true), { type: 'button', label: SECRET });
    expect(registry.getElement('card')?.label).toBe(SECRET);
  });

  it('keeps the secret out of the element history the getElementHistory route serves', () => {
    const log = new ElementEventLog();
    const registry = new UIBridgeRegistry({ elementEventLog: log });
    const el = mountButton(true);
    registry.registerElement('card', el, { type: 'button', label: SECRET });
    // `useAutoRegister` raises the level after the first registration, so a
    // RE-registration is what the log ingests.
    registry.setElementLogLevel('card', 'debug');
    registry.registerElement('card', el, { type: 'button', label: SECRET });

    const history = registry.getElementHistory('card');
    const registered = history.filter((h) => h.eventType === 'element:registered');
    expect(registered).toHaveLength(1);
    expect((registered[0].data as { label?: string }).label).toBe(REDACTED_VALUE);
    expect(JSON.stringify(history)).not.toContain('4111');
  });

  it('keeps the secret out of the verbose console line', () => {
    const lines: unknown[][] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args);
    });
    const registry = new UIBridgeRegistry({ verbose: true });
    registry.registerElement('card', mountButton(true), { type: 'button', label: SECRET });
    const registeredLines = lines.filter((l) => l[1] === 'element:registered');
    expect(registeredLines.length).toBeGreaterThan(0);
    expect(JSON.stringify(lines)).not.toContain('4111');
  });
});
