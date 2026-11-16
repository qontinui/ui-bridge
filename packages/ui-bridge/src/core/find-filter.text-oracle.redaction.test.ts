/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { getGlobalRegistry } from './registry';
import { DefaultActionExecutor } from '../control/action-executor';
import { createHandlers, type RegistryLike } from '../server/handlers';

const SECRET = 'SECRET-oracle-8843';

beforeEach(() => getGlobalRegistry().clear());
afterEach(() => {
  document.body.innerHTML = '';
  getGlobalRegistry().clear();
});

/**
 * §4.6: a text predicate over a registry row compared against the node's RAW
 * `textContent`, so `find {text: <secret>}` answered whether a boundary below
 * the element held that string — an oracle on the find payload's row set.
 */
describe('find text predicate does not read through a redaction boundary', () => {
  function findIds(request: Record<string, unknown>): Promise<string[]> {
    const registry = getGlobalRegistry();
    const handlers = createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never
    );
    return handlers
      .find({ skipSettle: true, ...request })
      .then((res) => (res.data?.elements ?? []).map((e: { id: string }) => e.id));
  }

  beforeEach(() => {
    document.body.innerHTML = `<div id="card">Order <span data-bridge-redact="true">${SECRET}</span></div>`;
    getGlobalRegistry().registerElement('card', document.getElementById('card') as HTMLElement, {
      type: 'container',
    });
  });

  it('a find on the boundary text matches nothing', async () => {
    expect(await findIds({ text: SECRET })).toEqual([]);
    expect(await findIds({ exact_text: `Order ${SECRET}` })).toEqual([]);
  });

  it('[negative control] the visible text still matches', async () => {
    expect(await findIds({ text: 'Order' })).toContain('card');
  });
});
