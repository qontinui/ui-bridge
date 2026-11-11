/**
 * DOMChangeObserver records page changes. The registry's own
 * `data-ui-bridge-id` stamp, which `registerElement` writes on every
 * registration that carries none, is bookkeeping and is not one.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { DOMChangeObserver } from './dom-capture';
import { UIBridgeRegistry } from '../core/registry';

/** One macrotask: MutationObserver callbacks are delivered before it ends. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('DOMChangeObserver and the registry stamp', () => {
  let observer: DOMChangeObserver | undefined;

  afterEach(() => {
    observer?.stop();
    observer = undefined;
    document.body.innerHTML = '';
  });

  it('records an attribute change but not the stamp registerElement writes', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    observer = new DOMChangeObserver();
    observer.start(document.body);

    new UIBridgeRegistry().registerElement('stamped-node', el, { type: 'generic' });
    expect(el.getAttribute('data-ui-bridge-id')).toBe('stamped-node');
    el.setAttribute('data-state', 'open');
    await flush();

    expect(observer.getChanges().map((c) => c.details?.attributeName)).toEqual(['data-state']);
  });
});
