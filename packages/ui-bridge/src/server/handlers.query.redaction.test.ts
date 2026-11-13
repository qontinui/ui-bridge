/**
 * §4.6 on the standalone server's `query` handler (`POST /control/query`).
 *
 * `query` takes a caller-supplied CSS selector and projects each match. Its
 * `textContent` and `value` were already gated, but `info.placeholder` and the
 * `info.attributes` record (`title`, `aria-label`, `placeholder`, ...) were
 * read raw. A caller could name an element inside a `data-bridge-redact`
 * boundary and read its accessible name and hint text in cleartext.
 *
 * Negative controls show the fix does not over-redact: outside a boundary,
 * and on a bare password input (VALUE-redacted only), those fields stay raw.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { getGlobalRegistry, REDACTED_VALUE } from '../core/registry';

function makeRegistryLike(): RegistryLike {
  const reg = getGlobalRegistry();
  return {
    getAllElements: () => reg.getAllElements(),
    getElement: (id) => reg.getElement(id),
    getAllComponents: () => reg.getAllComponents(),
    getComponent: (id) => reg.getComponent(id),
    getComponentState: (id) => reg.getComponentState?.(id) ?? null,
    createSnapshot: () => reg.createSnapshot() as ReturnType<RegistryLike['createSnapshot']>,
  };
}

function makeHandlers() {
  return createHandlers(
    makeRegistryLike(),
    { executeAction: async () => ({ success: true }) } as never,
    { consoleCapture: null as never }
  );
}

type QueryInfo = {
  placeholder?: string;
  value?: string;
  attributes?: Record<string, string>;
};

const mounted: HTMLElement[] = [];
function mount(html: string): void {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  for (const node of Array.from(tpl.content.childNodes)) {
    const el = node as HTMLElement;
    document.body.appendChild(el);
    mounted.push(el);
  }
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.remove();
});

async function queryOne(selector: string): Promise<QueryInfo> {
  const handlers = makeHandlers();
  const res = (await handlers.query!({ selector })) as {
    success: boolean;
    data?: { elements: QueryInfo[] };
  };
  expect(res.success).toBe(true);
  expect(res.data?.elements).toHaveLength(1);
  return res.data!.elements[0];
}

describe('query handler applies the §4.6 verdict to placeholder and attributes', () => {
  it('collapses title, aria-label and placeholder inside a boundary, keeping keys and addressing', async () => {
    mount(`
      <div data-bridge-redact="true">
        <input id="q-ssn" type="text" value="123-45-6789" role="textbox" data-tutorial-id="ssn"
          title="SSN 123-45-6789" aria-label="SSN for Jane Doe" placeholder="e.g. 123-45-6789" />
      </div>
    `);
    const info = await queryOne('#q-ssn');
    expect(info.value).toBe(REDACTED_VALUE);
    expect(info.placeholder).toBe(REDACTED_VALUE);
    expect(info.attributes).toEqual({
      // Addressing attributes stay raw so the element stays findable.
      role: 'textbox',
      'data-tutorial-id': 'ssn',
      title: REDACTED_VALUE,
      'aria-label': REDACTED_VALUE,
      placeholder: REDACTED_VALUE,
    });
  });

  it('[negative control] keeps the fields raw outside a boundary', async () => {
    mount(
      `<input id="q-plain" type="text" value="order-42" title="Order" placeholder="Order id" />`
    );
    const info = await queryOne('#q-plain');
    expect(info.value).toBe('order-42');
    expect(info.placeholder).toBe('Order id');
    expect(info.attributes).toEqual({ title: 'Order', placeholder: 'Order id' });
  });

  it('[negative control] keeps the old empty-placeholder wire shape', async () => {
    mount(`<input id="q-noph" type="text" value="a" />`);
    expect((await queryOne('#q-noph')).placeholder).toBe('');
  });

  it('[negative control] a bare password input hides only its value', async () => {
    mount(
      `<input id="q-pw" type="password" value="hunter2" aria-label="Password" placeholder="Password" />`
    );
    const info = await queryOne('#q-pw');
    expect(info.value).toBe(REDACTED_VALUE);
    expect(info.placeholder).toBe('Password');
    expect(info.attributes).toEqual({ 'aria-label': 'Password', placeholder: 'Password' });
  });
});
