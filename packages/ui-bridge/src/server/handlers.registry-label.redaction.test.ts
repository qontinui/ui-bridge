/**
 * §4.6 on projections that read the registry's `label` directly.
 *
 * `RegisteredElement.label` is stored raw: the registry scrubs it only when it
 * serializes (`createSnapshot`), and `getAllElements()` hands back the raw row.
 * Several projections passed that raw label to the client:
 *
 * - `aiSemanticSearch` (server handlers) re-emitted it in `element.label`,
 *   `element.description` and `embeddedText`, and scored queries against it.
 * - every design/quality route built `ElementDesignData.label` from it via
 *   `getElementDesignData`.
 * - the server `visibility` route echoed it in `occlusions[].label`.
 * - the in-page dispatcher's `getDesignSnapshot`, and `elementToSnapshot`
 *   behind `saveBookmark` / `getBookmark`.
 *
 * A `data-bridge-redact` element's label therefore reached the client in
 * cleartext. Negative controls pin that a label outside a boundary stays raw.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { getGlobalRegistry, resetGlobalRegistry, REDACTED_VALUE } from '../core/registry';
import { getElementDesignData } from '../ai/design-inspector';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import { getGlobalBookmarkStore } from '../ai/bookmarks';

const SECRET = 'Card 4111 1111 1111 1111';
const PUBLIC = 'Save order';

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
    { consoleCapture: null as never, idleDetection: false } as never
  );
}

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

const mounted: HTMLElement[] = [];

function registerButton(id: string, label: string, redacted: boolean): HTMLElement {
  const host = document.createElement('div');
  if (redacted) host.setAttribute('data-bridge-redact', 'true');
  const button = document.createElement('button');
  button.textContent = 'Go';
  host.appendChild(button);
  document.body.appendChild(host);
  mounted.push(host);
  getGlobalRegistry().registerElement(id, button, { type: 'button', label });
  return button;
}

beforeEach(() => resetGlobalRegistry());
afterEach(() => {
  while (mounted.length) mounted.pop()?.remove();
  resetGlobalRegistry();
});

type SearchResult = {
  element: { id: string; label?: string; description?: string };
  embeddedText: string;
  similarity: number;
};

async function search(query: string, threshold?: number): Promise<SearchResult[]> {
  const res = (await makeHandlers().aiSemanticSearch!({ query, threshold })) as {
    success: boolean;
    data?: { results: SearchResult[] };
  };
  expect(res.success).toBe(true);
  return res.data!.results;
}

describe('aiSemanticSearch scrubs the registry label', () => {
  it('collapses a redacted element’s label in element and embeddedText', async () => {
    registerButton('pay', SECRET, true);
    const results = await search('card', 0);
    const hit = results.find((r) => r.element.id === 'pay');
    expect(hit).toBeDefined();
    expect(hit!.element.label).toBe(REDACTED_VALUE);
    expect(hit!.element.description).toBe(REDACTED_VALUE);
    expect(hit!.embeddedText).not.toContain('4111');
    expect(JSON.stringify(results)).not.toContain('4111');
  });

  it('does not let a query match on the redacted text (no search oracle)', async () => {
    registerButton('pay', SECRET, true);
    const results = await search('4111 1111');
    expect(results.find((r) => r.element.id === 'pay')).toBeUndefined();
  });

  it('keeps a label outside a boundary raw and searchable (negative control)', async () => {
    registerButton('save', PUBLIC, false);
    const results = await search('save order');
    const hit = results.find((r) => r.element.id === 'save');
    expect(hit).toBeDefined();
    expect(hit!.element.label).toBe(PUBLIC);
    expect(hit!.embeddedText).toContain(PUBLIC);
    expect(hit!.similarity).toBeGreaterThanOrEqual(0.9);
  });

  // Pins the scan width: the semantic snapshot path caps at 500 elements
  // (`SemanticSnapshotManager` `maxElements`), so a scrub that routed search
  // through it would silently drop matches past the cap.
  it('scans every registered element, not a capped snapshot', { timeout: 30_000 }, async () => {
    for (let i = 0; i < 501; i++) registerButton(`b${i}`, `Item ${i}`, false);
    const res = (await makeHandlers().aiSemanticSearch!({ query: 'item 500' })) as {
      data?: { scannedCount: number; results: SearchResult[] };
    };
    expect(res.data!.scannedCount).toBe(501);
    expect(res.data!.results.some((r) => r.element.id === 'b500')).toBe(true);
  });

  it('collapses a redacted SVG element’s label (an SVGElement is no HTMLElement)', async () => {
    const host = document.createElement('div');
    host.setAttribute('data-bridge-redact', 'true');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    host.appendChild(svg);
    document.body.appendChild(host);
    mounted.push(host);
    getGlobalRegistry().registerElement('qr', svg as unknown as HTMLElement, {
      type: 'generic',
      label: SECRET,
    });
    const results = await search('card', 0);
    const hit = results.find((r) => r.element.id === 'qr');
    expect(hit).toBeDefined();
    expect(hit!.element.label).toBe(REDACTED_VALUE);
    expect(JSON.stringify(results)).not.toContain('4111');
  });
});

describe('server design routes scrub the registry label', () => {
  it('getDesignSnapshot collapses a redacted label and keeps a public one', async () => {
    registerButton('pay', SECRET, true);
    registerButton('save', PUBLIC, false);
    const res = (await makeHandlers().getDesignSnapshot!()) as {
      success: boolean;
      data?: { elements: Array<{ elementId: string; label?: string }> };
    };
    expect(res.success).toBe(true);
    const byId = new Map(res.data!.elements.map((e) => [e.elementId, e.label]));
    expect(byId.get('pay')).toBe(REDACTED_VALUE);
    expect(byId.get('save')).toBe(PUBLIC);
  });

  it('getElementStyles collapses a redacted label', async () => {
    registerButton('pay', SECRET, true);
    const res = (await makeHandlers().getElementStyles!('pay')) as {
      success: boolean;
      data?: { label?: string };
    };
    expect(res.success).toBe(true);
    expect(res.data!.label).toBe(REDACTED_VALUE);
  });

  it('getElementDesignData leaves an absent label absent', () => {
    const button = registerButton('pay', SECRET, true);
    expect(getElementDesignData(button, { elementId: 'pay' }).label).toBeUndefined();
  });
});

describe('server visibility route scrubs the registry label', () => {
  it('an occluded redacted element reports a collapsed label', async () => {
    registerButton('pay', SECRET, true);
    registerButton('save', PUBLIC, false);
    const reg = getGlobalRegistry();
    // Stand the occlusion verdict in directly: jsdom has no layout, and the
    // route under test is the projection of the label, not the sweep.
    for (const id of ['pay', 'save']) {
      const el = reg.getElement(id)!;
      const original = el.getState;
      el.getState = () => ({ ...original(), occludedBy: 'chat-widget', occludedPct: 50 });
    }
    const res = (await makeHandlers().visibility!()) as {
      success: boolean;
      data?: unknown;
    };
    expect(res.success).toBe(true);
    const wire = JSON.stringify(res.data);
    expect(wire).toContain(PUBLIC);
    expect(wire).toContain(REDACTED_VALUE);
    expect(wire).not.toContain('4111');
  });
});

describe('in-page dispatcher scrubs the registry label', () => {
  it('getDesignSnapshot collapses a redacted label and keeps a public one', async () => {
    registerButton('pay', SECRET, true);
    registerButton('save', PUBLIC, false);
    const out = (await executeCommand('getDesignSnapshot', {}, emptyBridge)) as {
      elements: Array<{ id: string; label?: string }>;
    };
    const byId = new Map(out.elements.map((e) => [e.id, e.label]));
    expect(byId.get('pay')).toBe(REDACTED_VALUE);
    expect(byId.get('save')).toBe(PUBLIC);
  });

  it('a bookmark stores and returns the collapsed label', async () => {
    registerButton('pay', SECRET, true);
    registerButton('save', PUBLIC, false);
    const name = `redaction-${Math.random().toString(36).slice(2)}`;
    try {
      await executeCommand('saveBookmark', { name }, emptyBridge);
      const out = await executeCommand('getBookmark', { name }, emptyBridge);
      const wire = JSON.stringify(out);
      expect(wire).toContain(PUBLIC);
      expect(wire).toContain(REDACTED_VALUE);
      expect(wire).not.toContain('4111');
    } finally {
      getGlobalBookmarkStore().delete(name);
    }
  });
});
