/**
 * Discovery id derivation for UNREGISTERED elements.
 *
 * `getElementId` names elements that `discover()`/`find()` meet without a
 * registry entry. Its slug fallback is only *mostly* stable — the collision
 * suffix is a first-free-integer assigned in DOM-walk order, so two same-slug
 * siblings swap ids the moment the DOM reorders, and callers are pushed into
 * matching on accessible name instead.
 *
 * `data-ui-bridge-test-id` is the SDK's pinning alias (already honoured by
 * `getBestIdentifier` and `useAutoRegister`'s id derivation, both of which rank
 * it above `data-testid`). These tests pin it on the discovery path too, and
 * fix the negative half of the contract: `data-ui-bridge-id` is an OUTPUT the
 * SDK stamps on elements it registered, not an identification input.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';
import { findElementByIdentifier } from '../core/element-identifier';

describe('control/action-executor — discovery id derivation', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  // jsdom reports zero-size rects, so nothing is "visible" — see the sibling
  // redaction suite for the same note.
  const OPTS = { includeHidden: true } as const;

  it('uses data-ui-bridge-test-id verbatim, ahead of data-testid and the HTML id', async () => {
    const btn = document.createElement('button');
    btn.setAttribute('data-ui-bridge-test-id', 'checkout-submit');
    btn.setAttribute('data-testid', 'legacy-testid');
    btn.id = 'legacy-html-id';
    btn.textContent = 'Place order';
    container.appendChild(btn);

    const res = await executor.find(OPTS);
    const ids = res.elements.map((e) => e.id);
    expect(ids).toContain('checkout-submit');
    expect(ids).not.toContain('legacy-testid');
    expect(ids).not.toContain('legacy-html-id');
  });

  it('pins the id across a DOM reorder that reshuffles the slug suffix', async () => {
    // Two same-slug siblings: without a pin, the second one is `button-open-1`
    // purely because it is walked second.
    const first = document.createElement('button');
    first.textContent = 'Open';
    const second = document.createElement('button');
    second.setAttribute('data-ui-bridge-test-id', 'open-details');
    second.textContent = 'Open';
    container.append(first, second);

    const before = await executor.find(OPTS);
    expect(before.elements.map((e) => e.id)).toContain('open-details');

    // Reorder — the pinned id must not move with the walk order.
    container.prepend(second);

    const after = await executor.find(OPTS);
    expect(after.elements.map((e) => e.id)).toContain('open-details');
  });

  it('ignores a whitespace-only pin and falls through to data-testid', async () => {
    const btn = document.createElement('button');
    btn.setAttribute('data-ui-bridge-test-id', '   ');
    btn.setAttribute('data-testid', 'real-testid');
    btn.textContent = 'Save';
    container.appendChild(btn);

    const res = await executor.find(OPTS);
    expect(res.elements.map((e) => e.id)).toContain('real-testid');
  });

  it('does NOT read data-ui-bridge-id — it is a registration output, not an input', async () => {
    // A hand-stamped `data-ui-bridge-id` on an element the SDK never
    // registered. Honouring it here would let one author-supplied value name
    // two elements with no collision counter to separate them, so the derived
    // id is used instead.
    const btn = document.createElement('button');
    btn.setAttribute('data-ui-bridge-id', 'terminal-session-info-1');
    btn.textContent = 'Session info';
    container.appendChild(btn);

    const res = await executor.find(OPTS);
    const ids = res.elements.map((e) => e.id);
    expect(ids).not.toContain('terminal-session-info-1');
    expect(ids).toContain('button-session-info');
  });

  it('resolves a pinned id back to its element (round-trip)', () => {
    const btn = document.createElement('button');
    btn.setAttribute('data-ui-bridge-test-id', 'checkout-submit');
    btn.setAttribute('data-testid', 'some-other-element');
    btn.textContent = 'Place order';

    const decoy = document.createElement('button');
    decoy.setAttribute('data-testid', 'checkout-submit');
    decoy.textContent = 'Decoy';

    // Decoy first in document order — a resolver that only knew `data-testid`
    // would return it.
    container.append(decoy, btn);

    expect(findElementByIdentifier('checkout-submit')).toBe(btn);
  });
});
