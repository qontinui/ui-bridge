/**
 * A combobox / autocomplete dead end throws a bare `Error` inside the
 * executor, and `executeAction` turns it into a failure RESULT. So it is a
 * returned failure, never a throw that reaches the server handler's
 * thrown-error arm (`codeOfThrown`), and needs no `code` of its own.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';

beforeAll(() => {
  if (!document.elementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
  }
});

function setup(html: string, id: string, type: string) {
  document.body.innerHTML = html;
  const el = document.getElementById(id)!;
  Object.defineProperty(el, 'offsetParent', { get: () => document.body, configurable: true });
  const registry = new UIBridgeRegistry();
  registry.registerElement(id, el, { type: type as never });
  return new DefaultActionExecutor(registry);
}

describe('executeAction · dead ends are returned failures, not throws', () => {
  it('a combobox whose listbox never opens', async () => {
    const executor = setup(
      '<button id="t" role="combobox" aria-expanded="false">status</button>',
      't',
      'button'
    );
    const result = await executor.executeAction('t', {
      action: 'select',
      params: { value: 'shipped' },
    } as never);
    expect(result.success).toBe(false);
    expect(result.error).toContain('did not open');
  });

  it('an autocomplete with no suggestions', async () => {
    const executor = setup('<input id="a" type="text" role="combobox" />', 'a', 'input');
    const result = await executor.executeAction('a', {
      action: 'autocomplete',
      params: { searchText: 'zzz', suggestionTimeout: 50 },
    } as never);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Autocomplete: no matching suggestion for "zzz" within 50ms');
  });
});
