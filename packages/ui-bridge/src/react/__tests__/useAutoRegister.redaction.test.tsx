/**
 * §4.6 F7 — SOURCE defense-in-depth for the label/content scrape.
 *
 * `useAutoRegister.getAccessibleLabel` scrapes `aria-label` / `title` /
 * `<label>` text / `innerText` / `placeholder` into `RegisteredElement.label`,
 * and the content-discovery path scrapes `textContent` into
 * `RegisteredElement.content` — both with NO `data-bridge-redact` check. So a
 * redacted element's secret was scraped into the registry AT THE SOURCE, then
 * shipped raw by every projection whose emission gate was missing.
 *
 * F7 gates the scrape: inside a boundary, `getAccessibleLabel` returns
 * `undefined` and the content-registration paths do not read text. This is the
 * SECOND layer — the emission scrub in `serializeRegisteredElement`
 * (`registry.snapshot-redaction.test.ts`) is the primary closure. BOTH must
 * hold: this file asserts the secret is absent at REGISTRATION, so it would
 * catch a regression even if the emission layer were removed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { UIBridgeRegistry } from '../../core/registry';
import { useAutoRegister } from '../useAutoRegister';
import { registerContentInRegistry } from '../content-discovery';
import type { UIBridgeContextValue } from '../UIBridgeProvider';

const SECRET = 'SECRET123';

function createMockBridge(registry: UIBridgeRegistry): UIBridgeContextValue {
  return {
    registry,
    relationshipTracker: undefined,
    dragDropDetector: undefined,
  } as unknown as UIBridgeContextValue;
}

let mockBridge: UIBridgeContextValue | null = null;
vi.mock('../UIBridgeProvider', () => ({
  useUIBridgeOptional: () => mockBridge,
}));

function Harness(props: { content?: boolean }) {
  useAutoRegister({
    enabled: true,
    debounceMs: 0,
    includeHidden: true,
    contentDiscovery: props.content ? { enabled: true } : { enabled: false },
    mediaDiscovery: { enabled: false },
  });
  return null;
}

/** Find the RegisteredElement whose live node is `node`. */
function regFor(registry: UIBridgeRegistry, node: HTMLElement) {
  return registry.getAllElements().find((e) => e.element === node);
}

describe('useAutoRegister §4.6 F7 — no scrape inside a boundary', () => {
  let registry: UIBridgeRegistry;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    mockBridge = createMockBridge(registry);
  });
  afterEach(() => {
    cleanup();
    mockBridge = null;
    document.body.innerHTML = '';
  });

  it('does NOT scrape a secret aria-label into label inside a boundary', async () => {
    const fixture = document.createElement('div');
    fixture.innerHTML = `
      <div data-bridge-redact="true">
        <button type="button" aria-label="token ${SECRET}"></button>
      </div>
    `;
    document.body.appendChild(fixture);

    render(<Harness />);
    await new Promise((r) => setTimeout(r, 5));

    const btn = fixture.querySelector('button')!;
    const reg = regFor(registry, btn);
    expect(reg).toBeDefined();
    // The secret was never scraped into the registry at all.
    expect(reg!.label ?? '').not.toContain(SECRET);
    // And it never reaches a client via the snapshot either.
    expect(JSON.stringify(registry.createSnapshot())).not.toContain(SECRET);
  });

  it('does NOT scrape secret textContent into content inside a boundary', async () => {
    const fixture = document.createElement('div');
    fixture.innerHTML = `
      <div data-bridge-redact="true">
        <h2>Recovery code ${SECRET}</h2>
      </div>
    `;
    document.body.appendChild(fixture);

    render(<Harness content />);
    await new Promise((r) => setTimeout(r, 5));

    const heading = fixture.querySelector('h2')!;
    const reg = regFor(registry, heading);
    // Either the heading was not content-registered, or it carries no secret.
    if (reg) {
      expect(reg.content ?? '').not.toContain(SECRET);
      expect(reg.label ?? '').not.toContain(SECRET);
    }
    expect(JSON.stringify(registry.createSnapshot())).not.toContain(SECRET);
  });

  it('[negative control] scrapes a normal aria-label OUTSIDE a boundary', async () => {
    const fixture = document.createElement('div');
    fixture.innerHTML = `<button type="button" aria-label="Save order"></button>`;
    document.body.appendChild(fixture);

    render(<Harness />);
    await new Promise((r) => setTimeout(r, 5));

    const btn = fixture.querySelector('button')!;
    const reg = regFor(registry, btn);
    expect(reg).toBeDefined();
    expect(reg!.label).toBe('Save order');
  });

  it('[negative control] a bare password field keeps its scraped label (addressability)', async () => {
    // A password field OUTSIDE a boundary is VALUE-redacted only, never
    // CONTENT-redacted — so its label is still scraped and it stays findable.
    const fixture = document.createElement('div');
    fixture.innerHTML = `<input type="password" aria-label="Password" />`;
    document.body.appendChild(fixture);

    render(<Harness />);
    await new Promise((r) => setTimeout(r, 5));

    const input = fixture.querySelector('input')!;
    const reg = regFor(registry, input);
    expect(reg).toBeDefined();
    expect(reg!.label).toBe('Password');
  });

  // A container is not INSIDE a boundary, so its own verdict is clean — but its
  // label, accessible name and visible text used to be read from a subtree, a
  // <label> or an aria-labelledby target that holds one, verbatim.
  it.each([
    ['a button wrapping a boundary', `<button type="button">Reveal <span data-bridge-redact="true">${SECRET}</span></button>`],
    ['an input named by <label for> holding a boundary', `<label for="card">Card <span data-bridge-redact="true">${SECRET}</span></label><input id="card">`],
    ['an input inside a wrapping <label> holding a boundary', `<label>PIN <b data-bridge-redact="true">${SECRET}</b><input></label>`],
    ['an input named by aria-labelledby pointing into a boundary', `<p id="lbl">Code <b data-bridge-redact="true">${SECRET}</b></p><input aria-labelledby="lbl">`],
  ])('%s: no snapshot field carries the boundary text', async (_case, html) => {
    const fixture = document.createElement('div');
    fixture.innerHTML = html;
    document.body.appendChild(fixture);

    render(<Harness />);
    await new Promise((r) => setTimeout(r, 5));

    expect(registry.getAllElements().length).toBeGreaterThan(0);
    for (const e of registry.getAllElements()) {
      expect(e.label ?? '').not.toContain(SECRET);
    }
    expect(JSON.stringify(registry.createSnapshot())).not.toContain(SECRET);
  });

  // Content discovery, semantic cards and <details> ids: a content row that
  // WRAPS a boundary used to scrape its text into label, content and the id.
  it.each([
    ['a semantic card wrapping a boundary', `<div data-ui-bridge-content="card">Token <span data-bridge-redact="true">${SECRET}</span></div>`],
    ['a <details> whose summary holds a boundary', `<details><summary>Key <span data-bridge-redact="true">${SECRET}</span></summary>x</details>`],
  ])('%s: no snapshot field or id carries the boundary text', async (_case, html) => {
    const fixture = document.createElement('div');
    fixture.innerHTML = html;
    document.body.appendChild(fixture);

    render(<Harness content />);
    // Content registration has its own debounce (~250ms).
    await new Promise((r) => setTimeout(r, 300));

    expect(registry.getAllElements().length).toBeGreaterThan(0);
    const lowered = SECRET.toLowerCase();
    for (const e of registry.getAllElements()) {
      expect(e.id.toLowerCase()).not.toContain(lowered);
      expect(e.label ?? '').not.toContain(SECRET);
    }
    expect(JSON.stringify(registry.createSnapshot()).toLowerCase()).not.toContain(lowered);
  });

  it.each([
    ['a heading', `<h2 id="t">Key <span data-bridge-redact="true">${SECRET}</span></h2>`],
    ['a paragraph', `<p id="t">Your code is <b data-bridge-redact="true">${SECRET}</b> today</p>`],
  ])('content discovery of %s holding a boundary: no label, content or id carries it', (_c, html) => {
    const fixture = document.createElement('div');
    fixture.innerHTML = html;
    document.body.appendChild(fixture);

    const id = registerContentInRegistry(registry, fixture.querySelector<HTMLElement>('#t')!);
    expect(id).not.toBeNull();
    const lowered = SECRET.toLowerCase();
    expect(id!.toLowerCase()).not.toContain(lowered);
    const reg = registry.getElement(id!)!;
    expect(reg.label ?? '').not.toContain(SECRET);
    expect(reg.content ?? '').not.toContain(SECRET);
    expect(reg.content ?? '').toContain('[REDACTED]');
    expect(JSON.stringify(registry.createSnapshot()).toLowerCase()).not.toContain(lowered);
  });

  it('a live region holding a boundary does not leak its prefix in contentMetadata', () => {
    const fixture = document.createElement('div');
    fixture.innerHTML = `<div id="t" role="status"><span data-bridge-redact="true">${SECRET}</span> refreshed just now</div>`;
    document.body.appendChild(fixture);
    const id = registerContentInRegistry(registry, fixture.querySelector<HTMLElement>('#t')!);
    expect(id).not.toBeNull();
    const snap = JSON.stringify(registry.createSnapshot());
    expect(snap).not.toContain(SECRET.slice(0, 6));
  });
});
