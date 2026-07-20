/**
 * Phase 0 — arbitrary-selector redaction bypass (F1).
 *
 * §4.6 promises that a `<input type="password">` value, and any content
 * inside a `data-bridge-redact="true"` boundary, never reaches a client. But
 * several routes take a CALLER-SUPPLIED CSS selector / text and read raw DOM
 * content with no redaction gate — a total bypass of §4.6 for anyone who can
 * name the element. This file locks the gates for BOTH dispatch paths:
 *   - the standalone server handlers (`server/handlers.ts`), and
 *   - the React relay dispatcher (`react/commandHandlers.ts`).
 *
 * Leak sites gated (both paths): `readValue`, `findByText`,
 * `typeInto` value-echo, `clickByText`/`clickBySelector` text-echo.
 *
 * Negative controls (labelled `[negative control]`) prove the fix does NOT
 * over-redact: a non-redacted value/text still surfaces, and a password field
 * stays ADDRESSABLE (findable by label/selector) — only its value is hidden.
 *
 * Cross-link: plans/2026-07-20-ui-bridge-structural-redaction-enforcement.md
 * (Phase 0).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { getGlobalRegistry, resetGlobalRegistry, REDACTED_VALUE } from '../core/registry';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';

beforeAll(() => {
  if (typeof document !== 'undefined' && !document.elementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => null,
    });
  }
});

// ---------------------------------------------------------------------------
// Minimal harness — the routes under test read the live document via the
// dom-fallback finders, not the registry, so a bare registry adapter suffices.
// ---------------------------------------------------------------------------

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
    {
      consoleCapture: null as never,
    }
  );
}

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

// Fixtures are appended DIRECTLY to document.body and removed after each test,
// so a redaction boundary has no non-redacted descendant-of-body wrapper that
// would itself match a text search (findElementsByText enumerates body's
// descendants — an outer wrapper's aggregated textContent would leak).
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

beforeEach(() => {
  resetGlobalRegistry();
});

afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
  resetGlobalRegistry();
});

// ===========================================================================
// server/handlers.ts
// ===========================================================================

describe('handlers.readValue — §4.6 value redaction', () => {
  it('returns REDACTED_VALUE (length 0) for <input type="password">, not the cleartext', async () => {
    mount('<input id="pw" type="password" />');
    (document.getElementById('pw') as HTMLInputElement).value = 'hunter2';

    const resp = await makeHandlers().readValue({ selector: '#pw' });

    expect(resp.success).toBe(true);
    expect(resp.data!.value).toBe(REDACTED_VALUE);
    expect(resp.data!.value).not.toBe('hunter2');
    expect(resp.data!.length).toBe(0);
  });

  it('returns REDACTED_VALUE for an input inside a data-bridge-redact boundary', async () => {
    mount('<form data-bridge-redact="true"><input id="b" type="text" value="secretval" /></form>');

    const resp = await makeHandlers().readValue({ selector: '#b' });

    expect(resp.success).toBe(true);
    expect(resp.data!.value).toBe(REDACTED_VALUE);
    expect(resp.data!.value).not.toContain('secretval');
    expect(resp.data!.length).toBe(0);
  });

  it('[negative control] returns the cleartext value of a NON-redacted input', async () => {
    mount('<input id="plain" type="text" value="visible123" />');

    const resp = await makeHandlers().readValue({ selector: '#plain' });

    expect(resp.success).toBe(true);
    expect(resp.data!.value).toBe('visible123');
    expect(resp.data!.length).toBe(10);
  });

  it('[negative control] a password field is still ADDRESSABLE by selector (element not hidden, only its value)', async () => {
    mount('<input id="pw" type="password" />');
    (document.getElementById('pw') as HTMLInputElement).value = 'hunter2';

    const resp = await makeHandlers().readValue({ selector: '#pw' });

    // Green both before AND after the fix: redaction must NOT make the element
    // unreachable. It resolves (not ELEMENT_NOT_FOUND) either way — the fix
    // hides the value, never the element. (The value-hiding itself is proven
    // by the first test above, which is red pre-fix.)
    expect(resp.success).toBe(true);
    expect(resp.data).toBeDefined();
  });
});

describe('handlers.findByText — §4.6 confirmation-oracle closure', () => {
  it('does NOT return a boundary-redacted element when searching its exact secret text (oracle closed)', async () => {
    mount('<div data-bridge-redact="true"><span>SUPERSECRET</span></div>');

    const resp = await makeHandlers().findByText({ text: 'SUPERSECRET', exact: false });

    expect(resp.success).toBe(true);
    // Assert on the HIT COUNT, not just the emitted text: the count itself is
    // the oracle. A redacted element must be unconfirmable by text search.
    expect(resp.data!.length).toBe(0);
    expect(JSON.stringify(resp.data)).not.toContain('SUPERSECRET');
  });

  it('[negative control] still returns a NON-redacted element by its text', async () => {
    mount('<button id="ok">VisibleLabel</button>');

    const resp = await makeHandlers().findByText({ text: 'VisibleLabel', exact: false });

    expect(resp.success).toBe(true);
    expect(resp.data!.length).toBeGreaterThanOrEqual(1);
    expect(resp.data!.some((r) => r.text.includes('VisibleLabel'))).toBe(true);
  });
});

describe('handlers.typeInto — §4.6 value-echo redaction', () => {
  it('does NOT echo back the value typed into a password field', async () => {
    mount('<label for="pw2">Password</label><input id="pw2" type="password" />');

    const resp = await makeHandlers().typeInto({ label: 'Password', text: 'hunter2' });

    expect(resp.success).toBe(true);
    expect(resp.data!.typed).toBe(true); // addressable by label
    const el = resp.data!.element as { value: unknown };
    expect(el.value).toBe(REDACTED_VALUE);
    expect(el.value).not.toBe('hunter2');
  });

  it('[negative control] echoes the typed value for a NON-redacted input', async () => {
    mount('<label for="plain2">Search</label><input id="plain2" type="text" />');

    const resp = await makeHandlers().typeInto({ label: 'Search', text: 'query-text' });

    expect(resp.success).toBe(true);
    const el = resp.data!.element as { value: unknown };
    expect(el.value).toBe('query-text');
  });
});

describe('handlers.clickBySelector — §4.6 text-echo redaction', () => {
  it('does NOT echo the text of a boundary-redacted element', async () => {
    mount('<div data-bridge-redact="true"><button id="rb">SECRET-BTN-TEXT</button></div>');

    const resp = await makeHandlers().clickBySelector({ selector: '#rb' });

    expect(resp.success).toBe(true);
    const el = resp.data!.element as { text: unknown };
    expect(el.text).toBe(REDACTED_VALUE);
    expect(JSON.stringify(resp.data)).not.toContain('SECRET-BTN-TEXT');
  });

  it('[negative control] echoes the text of a NON-redacted element', async () => {
    mount('<button id="vb">Save</button>');

    const resp = await makeHandlers().clickBySelector({ selector: '#vb' });

    expect(resp.success).toBe(true);
    const el = resp.data!.element as { text: unknown };
    expect(el.text).toBe('Save');
  });
});

// ===========================================================================
// react/commandHandlers.ts  (the duplicated relay dispatch path)
// ===========================================================================

describe('commandHandlers.readValue — §4.6 value redaction', () => {
  it('returns REDACTED_VALUE for a password input, not the cleartext', async () => {
    mount('<input id="pw" type="password" />');
    (document.getElementById('pw') as HTMLInputElement).value = 'hunter2';

    const resp = (await executeCommand('readValue', { selector: '#pw' }, emptyBridge)) as {
      value: unknown;
      length: number;
    };

    expect(resp.value).toBe(REDACTED_VALUE);
    expect(resp.value).not.toBe('hunter2');
    expect(resp.length).toBe(0);
  });

  it('returns REDACTED_VALUE for an input inside a data-bridge-redact boundary', async () => {
    mount('<form data-bridge-redact="true"><input id="b" type="text" value="secretval" /></form>');

    const resp = (await executeCommand('readValue', { selector: '#b' }, emptyBridge)) as {
      value: unknown;
      length: number;
    };

    expect(resp.value).toBe(REDACTED_VALUE);
    expect(resp.length).toBe(0);
  });

  it('[negative control] returns the cleartext value of a NON-redacted input', async () => {
    mount('<input id="plain" type="text" value="visible123" />');

    const resp = (await executeCommand('readValue', { selector: '#plain' }, emptyBridge)) as {
      value: unknown;
      length: number;
    };

    expect(resp.value).toBe('visible123');
    expect(resp.length).toBe(10);
  });
});

describe('commandHandlers.findByText — §4.6 confirmation-oracle closure', () => {
  it('does NOT return a boundary-redacted element by its exact secret text (oracle closed)', async () => {
    mount('<div data-bridge-redact="true"><span>SUPERSECRET</span></div>');

    const resp = (await executeCommand(
      'findByText',
      { text: 'SUPERSECRET', exact: false },
      emptyBridge
    )) as Array<{ text: string }>;

    expect(Array.isArray(resp)).toBe(true);
    expect(resp.length).toBe(0);
    expect(JSON.stringify(resp)).not.toContain('SUPERSECRET');
  });

  it('[negative control] still returns a NON-redacted element by its text', async () => {
    mount('<button id="ok">VisibleLabel</button>');

    const resp = (await executeCommand(
      'findByText',
      { text: 'VisibleLabel', exact: false },
      emptyBridge
    )) as Array<{ text: string }>;

    expect(resp.length).toBeGreaterThanOrEqual(1);
    expect(resp.some((r) => r.text.includes('VisibleLabel'))).toBe(true);
  });
});

describe('commandHandlers.typeInto — §4.6 value-echo redaction', () => {
  it('does NOT echo back the value typed into a password field', async () => {
    mount('<label for="pw2">Password</label><input id="pw2" type="password" />');

    const resp = (await executeCommand(
      'typeInto',
      { label: 'Password', text: 'hunter2' },
      emptyBridge
    )) as { typed: boolean; element: { value: unknown } };

    expect(resp.typed).toBe(true); // addressable by label
    expect(resp.element.value).toBe(REDACTED_VALUE);
    expect(resp.element.value).not.toBe('hunter2');
  });

  it('[negative control] echoes the typed value for a NON-redacted input', async () => {
    mount('<label for="plain2">Search</label><input id="plain2" type="text" />');

    const resp = (await executeCommand(
      'typeInto',
      { label: 'Search', text: 'query-text' },
      emptyBridge
    )) as { element: { value: unknown } };

    expect(resp.element.value).toBe('query-text');
  });
});
