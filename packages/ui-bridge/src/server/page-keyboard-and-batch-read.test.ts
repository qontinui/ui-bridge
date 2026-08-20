/**
 * Remediation coverage for two manual-test findings (plan
 * `2026-08-19-session-info-dropdown-mount-gaps-remediation.md`, D7 + D8).
 *
 * D7 — document-level key dispatch. `SessionInfoDropdown` closes on a
 * `document`-level `keydown` listener, which no element-scoped `sendKeys`
 * action can reach (the element advertises focus/blur/hover/click/… only), so
 * the Escape-to-close branch was untestable and could regress unnoticed.
 * `sendKeysToPage` dispatches at `document` / `window` / `body` /
 * `activeElement`.
 *
 * D8 — `readValue` silently ignored `all: true`: it returned ONE value where
 * the caller asked for every match, with nothing in the response saying the
 * parameter had been dropped. That is the "looks complete, isn't" failure
 * class. `all` is now honoured, and every malformed use is rejected BY NAME
 * rather than reinterpreted.
 *
 * Both dispatch paths are covered — the standalone server handlers
 * (`server/handlers.ts`) and the React relay dispatcher
 * (`react/commandHandlers.ts`) — since they are the two doors an external
 * caller can arrive through.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { getGlobalRegistry, resetGlobalRegistry, REDACTED_VALUE } from '../core/registry';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';

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

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
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

const listeners: Array<() => void> = [];
/** Register a `keydown` listener on an arbitrary target and collect its hits. */
function collectKeydown(target: EventTarget): KeyboardEvent[] {
  const seen: KeyboardEvent[] = [];
  const fn = (e: Event) => seen.push(e as KeyboardEvent);
  target.addEventListener('keydown', fn);
  listeners.push(() => target.removeEventListener('keydown', fn));
  return seen;
}

beforeEach(() => {
  resetGlobalRegistry();
});

afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
  for (const off of listeners.splice(0)) off();
  resetGlobalRegistry();
});

// ===========================================================================
// D7 — sendKeysToPage (document-level key dispatch)
// ===========================================================================

describe('handlers.sendKeysToPage — D7 document-level key dispatch', () => {
  it('a listener on `document` receives an Escape dispatched with no element target', async () => {
    const seen = collectKeydown(document);

    const resp = await makeHandlers().sendKeysToPage({ keys: 'Escape' });

    expect(resp.success).toBe(true);
    expect(resp.data!.dispatched).toBe(1);
    expect(resp.data!.target).toBe('document');
    expect(seen).toHaveLength(1);
    expect(seen[0].key).toBe('Escape');
    // The event must bubble/cancel like a real key press, or a component that
    // calls preventDefault() behaves differently under test than in the app.
    expect(seen[0].bubbles).toBe(true);
    expect(seen[0].cancelable).toBe(true);
  });

  it('reports back when a listener consumed the key (preventDefault)', async () => {
    const fn = (e: Event) => e.preventDefault();
    document.addEventListener('keydown', fn);
    listeners.push(() => document.removeEventListener('keydown', fn));

    const resp = await makeHandlers().sendKeysToPage({ keys: 'Escape' });

    expect(resp.success).toBe(true);
    expect(resp.data!.outcomes).toEqual([{ key: 'Escape', defaultPrevented: true }]);
  });

  it('closes the Escape-to-close branch end to end (the D7 scenario)', async () => {
    // Stand-in for SessionInfoDropdown: an open panel whose ONLY close path is
    // a document-level keydown listener.
    mount('<div id="panel"><span data-session-info-field>value</span></div>');
    const close = (e: Event) => {
      if ((e as KeyboardEvent).key === 'Escape') document.getElementById('panel')?.remove();
    };
    document.addEventListener('keydown', close);
    listeners.push(() => document.removeEventListener('keydown', close));

    expect(document.querySelectorAll('[data-session-info-field]')).toHaveLength(1);
    await makeHandlers().sendKeysToPage({ keys: 'Escape' });
    expect(document.querySelectorAll('[data-session-info-field]')).toHaveLength(0);
  });

  it('a document-level dispatch also reaches a window listener (bubbling)', async () => {
    const seen = collectKeydown(window);

    await makeHandlers().sendKeysToPage({ keys: 'Escape' });

    expect(seen.map((e) => e.key)).toEqual(['Escape']);
  });

  it('honours the modifier combo grammar', async () => {
    const seen = collectKeydown(document);

    const resp = await makeHandlers().sendKeysToPage({ keys: 'ctrl+shift+Enter' });

    expect(resp.success).toBe(true);
    expect(seen[0].key).toBe('Enter');
    expect(seen[0].ctrlKey).toBe(true);
    expect(seen[0].shiftKey).toBe(true);
    expect(seen[0].altKey).toBe(false);
  });

  it('dispatches an array of keys in order', async () => {
    const seen = collectKeydown(document);

    const resp = await makeHandlers().sendKeysToPage({ keys: ['ArrowDown', 'ArrowDown', 'Enter'] });

    expect(resp.success).toBe(true);
    expect(resp.data!.dispatched).toBe(3);
    expect(seen.map((e) => e.key)).toEqual(['ArrowDown', 'ArrowDown', 'Enter']);
  });

  it('targets window / body / activeElement when asked, and REJECTS an unknown target', async () => {
    const onBody = collectKeydown(document.body);
    const bodyResp = await makeHandlers().sendKeysToPage({ keys: 'Escape', target: 'body' });
    expect(bodyResp.success).toBe(true);
    expect(onBody.map((e) => e.key)).toEqual(['Escape']);

    const bad = await makeHandlers().sendKeysToPage({ keys: 'Escape', target: 'somewhere' });
    expect(bad.success).toBe(false);
    // Named, not silently coerced to `document` — a silent fallback is the
    // very defect class this remediation exists to remove.
    expect(bad.error).toContain('target');
  });

  it('rejects a misspelled key name instead of dispatching an unmatched key', async () => {
    const seen = collectKeydown(document);

    const resp = await makeHandlers().sendKeysToPage({ keys: 'Excape' });

    expect(resp.success).toBe(false);
    expect(resp.error).toContain('Excape');
    expect(seen).toHaveLength(0);
  });

  it('rejects a missing/empty keys parameter by name', async () => {
    const missing = await makeHandlers().sendKeysToPage({ keys: undefined });
    expect(missing.success).toBe(false);
    expect(missing.error).toContain('keys');

    const empty = await makeHandlers().sendKeysToPage({ keys: [] });
    expect(empty.success).toBe(false);
    expect(empty.error).toContain('keys');
  });

  it('accepts the explicit descriptor form for keys outside the known vocabulary', async () => {
    const seen = collectKeydown(document);

    const resp = await makeHandlers().sendKeysToPage({
      keys: [{ key: 'MediaPlayPause', modifiers: { alt: true } }],
    });

    expect(resp.success).toBe(true);
    expect(seen[0].key).toBe('MediaPlayPause');
    expect(seen[0].altKey).toBe(true);
  });
});

describe('commandHandlers.sendKeysToPage — D7 on the relay path', () => {
  it('dispatches at document level through the relay dispatcher', async () => {
    const seen = collectKeydown(document);

    const resp = (await executeCommand(
      'sendKeysToPage',
      { keys: 'Escape' },
      emptyBridge
    )) as { dispatched: number; target: string; keys: string[] };

    expect(resp.dispatched).toBe(1);
    expect(resp.target).toBe('document');
    expect(seen.map((e) => e.key)).toEqual(['Escape']);
  });

  it('surfaces a validation failure instead of dispatching', async () => {
    const seen = collectKeydown(document);

    const resp = (await executeCommand('sendKeysToPage', { keys: 'Excape' }, emptyBridge)) as {
      success?: boolean;
      error?: string;
    };

    expect(resp.success).toBe(false);
    expect(resp.error).toContain('Excape');
    expect(seen).toHaveLength(0);
  });
});

// ===========================================================================
// D8 — readValue honours `all: true`
// ===========================================================================

const THREE_FIELDS = `
  <div id="panel">
    <span data-session-info-field="a">alpha</span>
    <span data-session-info-field="b">bravo</span>
    <span data-session-info-field="c">charlie</span>
  </div>
`;

describe('handlers.readValue — D8 `all: true`', () => {
  it('returns EVERY match when all: true (was: one value, silently)', async () => {
    mount(THREE_FIELDS);

    const resp = await makeHandlers().readValue({
      selector: '[data-session-info-field]',
      all: true,
    });

    expect(resp.success).toBe(true);
    expect(resp.data!.totalMatches).toBe(3);
    expect(resp.data!.values).toHaveLength(3);
    expect(resp.data!.values!.map((v) => v.value)).toEqual(['alpha', 'bravo', 'charlie']);
    expect(resp.data!.values!.map((v) => v.index)).toEqual([0, 1, 2]);
    expect(resp.data!.values!.map((v) => v.length)).toEqual([5, 5, 7]);
  });

  it('without `all`, returns the single addressed value AND reports totalMatches', async () => {
    mount(THREE_FIELDS);

    const resp = await makeHandlers().readValue({ selector: '[data-session-info-field]' });

    expect(resp.success).toBe(true);
    expect(resp.data!.value).toBe('alpha');
    // The caller can now SEE that 2 further matches were not returned, instead
    // of inferring completeness from a shape that cannot express it.
    expect(resp.data!.totalMatches).toBe(3);
    expect(resp.data!.values).toBeUndefined();
  });

  it('`all` + `index` is rejected by name, never silently resolved to one of them', async () => {
    mount(THREE_FIELDS);

    const resp = await makeHandlers().readValue({
      selector: '[data-session-info-field]',
      index: 1,
      all: true,
    });

    expect(resp.success).toBe(false);
    expect(resp.error).toContain('all');
    expect(resp.error).toContain('index');
  });

  it('a non-boolean `all` is rejected by name', async () => {
    mount(THREE_FIELDS);

    const resp = await makeHandlers().readValue({
      selector: '[data-session-info-field]',
      all: 'yes' as unknown as boolean,
    });

    expect(resp.success).toBe(false);
    expect(resp.error).toContain('all');
  });

  it('all: true with no match is ELEMENT_NOT_FOUND — same rule as the singular read', async () => {
    const resp = await makeHandlers().readValue({ selector: '.nothing-here', all: true });

    expect(resp.success).toBe(false);
    expect(resp.code).toBeDefined();
  });

  it('§4.6: the per-element redaction gate still applies to every batched value', async () => {
    mount(`
      <div id="mixed">
        <input class="f" type="text" value="visible123" />
        <input class="f" type="password" />
      </div>
    `);
    (document.querySelectorAll('.f')[1] as HTMLInputElement).value = 'hunter2';

    const resp = await makeHandlers().readValue({ selector: '.f', all: true });

    expect(resp.success).toBe(true);
    expect(resp.data!.values!.map((v) => v.value)).toEqual(['visible123', REDACTED_VALUE]);
    expect(JSON.stringify(resp.data)).not.toContain('hunter2');
  });
});

describe('commandHandlers.readValue — D8 on the relay path', () => {
  it('returns every match through the relay dispatcher', async () => {
    mount(THREE_FIELDS);

    const resp = (await executeCommand(
      'readValue',
      { selector: '[data-session-info-field]', all: true },
      emptyBridge
    )) as { totalMatches: number; values: Array<{ value: string }> };

    expect(resp.totalMatches).toBe(3);
    expect(resp.values.map((v) => v.value)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('rejects `all` + `index` on the relay path too', async () => {
    mount(THREE_FIELDS);

    const resp = (await executeCommand(
      'readValue',
      { selector: '[data-session-info-field]', all: true, index: 1 },
      emptyBridge
    )) as { success?: boolean; error?: string };

    expect(resp.success).toBe(false);
    expect(resp.error).toContain('all');
  });
});
