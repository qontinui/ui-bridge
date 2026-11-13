/**
 * CTR auto-populate.
 *
 * `autoPopulateCtr` listens to `element:registered`, whose payload is
 * `{ id, type, label }` — not the registry row. It used to cast that payload
 * to `RegisteredElement`, so it never had a DOM element: no `data-testid`,
 * `data-awas-element` or `id` selector was ever built, only the `search`
 * fallback, and `filter` received an object with no `element`. It now
 * resolves the row by id. The `label` fallback for `metadata.description`
 * takes the §4.6 CONTENT scrub.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { UIBridgeRegistry, REDACTED_VALUE } from '../core/registry';
import { CentralTargetRegistry } from './registry';
import { autoPopulateCtr } from './auto-populate';

const mounted: HTMLElement[] = [];

function mountButton(opts: { testId?: string; awas?: string; domId?: string; redacted?: boolean }) {
  const host = document.createElement('div');
  if (opts.redacted) host.setAttribute('data-bridge-redact', 'true');
  const button = document.createElement('button');
  if (opts.testId) button.setAttribute('data-testid', opts.testId);
  if (opts.awas) button.setAttribute('data-awas-element', opts.awas);
  if (opts.domId) button.id = opts.domId;
  host.appendChild(button);
  document.body.appendChild(host);
  mounted.push(host);
  return button;
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.remove();
});

describe('autoPopulateCtr', () => {
  it('builds DOM selectors from the registered element, in priority order', () => {
    const registry = new UIBridgeRegistry();
    const ctr = new CentralTargetRegistry();
    const stop = autoPopulateCtr(registry, ctr);

    registry.registerElement(
      'save',
      mountButton({ testId: 'save-btn', awas: 'awas-save', domId: 'save-dom' }),
      { type: 'button', label: 'Save order' }
    );
    stop();

    const entry = ctr.get('save');
    expect(entry).toBeDefined();
    expect(entry!.selectors.map((s) => s.strategy)).toEqual([
      'data-testid',
      'data-awas-element',
      'id',
      'search',
    ]);
    expect(entry!.selectors[0].value).toBe('save-btn');
    expect(entry!.metadata?.description).toBe('Save order');
  });

  it('hands `filter` the registry row, DOM element included', () => {
    const registry = new UIBridgeRegistry();
    const ctr = new CentralTargetRegistry();
    const seen: Array<HTMLElement | undefined> = [];
    const stop = autoPopulateCtr(registry, ctr, {
      filter: (row) => {
        seen.push(row.element);
        return row.element?.getAttribute('data-testid') === 'keep';
      },
    });

    const keep = mountButton({ testId: 'keep' });
    registry.registerElement('a', keep, { type: 'button' });
    registry.registerElement('b', mountButton({ testId: 'drop' }), { type: 'button' });
    stop();

    expect(seen[0]).toBe(keep);
    expect(ctr.has('a')).toBe(true);
    expect(ctr.has('b')).toBe(false);
  });

  it('scrubs a boundary element’s label in the description fallback (§4.6)', () => {
    const registry = new UIBridgeRegistry();
    const ctr = new CentralTargetRegistry();
    const stop = autoPopulateCtr(registry, ctr);

    registry.registerElement('card', mountButton({ testId: 'card', redacted: true }), {
      type: 'button',
      label: 'Card 4111 1111 1111 1111',
    });
    stop();

    expect(ctr.get('card')?.metadata?.description).toBe(REDACTED_VALUE);
    expect(JSON.stringify(ctr.get('card'))).not.toContain('4111');
  });
});
