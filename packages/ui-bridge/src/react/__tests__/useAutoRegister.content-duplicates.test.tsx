/**
 * Two elements deriving one content id are two rows, however late the second
 * arrives (plan 2026-10-13-image-generation-and-visual-judgment, Phase 16). Before,
 * three gates asked whether the ID was held, so a second "Featured" heading mounted
 * after the first scan never got a row, and a check reading text over images could
 * pass on the first card alone. A row that does not exist is a text nothing reads.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { UIBridgeRegistry } from '../../core/registry';
import { useAutoRegister } from '../useAutoRegister';
import { registerContentInRegistry } from '../content-discovery';
import type { UIBridgeContextValue } from '../UIBridgeProvider';

let mockBridge: UIBridgeContextValue | null = null;
vi.mock('../UIBridgeProvider', () => ({
  useUIBridgeOptional: () => mockBridge,
}));

function Harness() {
  useAutoRegister({
    enabled: true,
    debounceMs: 0,
    includeHidden: true,
    contentDiscovery: { enabled: true, contentDebounceMs: 0 },
    mediaDiscovery: { enabled: false },
  });
  return null;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

describe('useAutoRegister: one content id, several elements', () => {
  let registry: UIBridgeRegistry;
  const contentRows = () => registry.getAllElements().filter((e) => e.category === 'content');

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    mockBridge = { registry } as unknown as UIBridgeContextValue;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      top: 0,
      left: 0,
      right: 100,
      bottom: 20,
      toJSON: () => ({}),
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mockBridge = null;
    document.body.innerHTML = '';
  });

  it('numbers duplicates present at the first scan', async () => {
    document.body.innerHTML = '<h3>Featured</h3><h3>Featured</h3>';
    render(<Harness />);
    await settle();
    expect(
      contentRows()
        .map((e) => e.id)
        .sort()
    ).toEqual(['heading-3-featured', 'heading-3-featured-2']);
  });

  it('gives a duplicate mounted after the first scan its own row', async () => {
    document.body.innerHTML = '<h3>Featured</h3>';
    render(<Harness />);
    await settle();
    expect(contentRows()).toHaveLength(1);

    const later = document.createElement('h3');
    later.textContent = 'Featured';
    document.body.appendChild(later);
    await settle();

    const rows = contentRows();
    expect(rows).toHaveLength(2);
    expect(rows.some((e) => e.element === later)).toBe(true);
  });

  it('gives a duplicate nested in a mounted subtree its own row', async () => {
    document.body.innerHTML = '<h3>Featured</h3>';
    render(<Harness />);
    await settle();

    const card = document.createElement('section');
    card.innerHTML = '<h3>Featured</h3>';
    document.body.appendChild(card);
    await settle();

    expect(contentRows().some((e) => e.element === card.firstElementChild)).toBe(true);
  });

  it('does not number an authored id: the second element gets no row', async () => {
    document.body.innerHTML =
      '<p data-content-id="price">One</p><p data-content-id="price">Two</p>';
    render(<Harness />);
    await settle();
    expect(contentRows().map((e) => e.id)).toEqual(['price']);
  });

  it('registering one element twice is one row', () => {
    document.body.innerHTML = '<h3>Featured</h3>';
    const el = document.querySelector('h3') as HTMLElement;
    expect(registerContentInRegistry(registry, el)).toBe('heading-3-featured');
    expect(registerContentInRegistry(registry, el)).toBeNull();
    expect(contentRows()).toHaveLength(1);
  });

  it('an empty data-content-id is no authored id: the element is still numbered', async () => {
    document.body.innerHTML = '<h3>Featured</h3><h3 data-content-id="">Featured</h3>';
    render(<Harness />);
    await settle();
    expect(
      contentRows()
        .map((e) => e.id)
        .sort()
    ).toEqual(['heading-3-featured', 'heading-3-featured-2']);
  });

  it('registers a surviving element once, however many scans see it', async () => {
    document.body.innerHTML = '<h3>Featured</h3>';
    render(<Harness />);
    await settle();
    // An attribute change on an ancestor rescans its descendants. Several guards
    // overlap here, so this pins the whole path; `registering one element twice is one row` pins the holder check.
    document.body.setAttribute('class', 'rescan');
    await settle();
    expect(contentRows()).toHaveLength(1);
  });
});
