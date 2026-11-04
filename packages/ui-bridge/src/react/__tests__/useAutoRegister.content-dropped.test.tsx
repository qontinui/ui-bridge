/**
 * An embedded `useAutoRegister` states how many content rows its cap refused
 * (plan 2026-11-02-text-over-image-contrast-cannot-see-what-the-snapshot-left-out,
 * Phase 1). Its `maxContentElements` cap (the runner and qontinui-web set 200)
 * returned silently, so a snapshot of a page past it looked like the whole page
 * and a check reading text rows passed on what remained. Now each refused element
 * is counted into the registry under this hook's own source, the count leaves
 * when the element gets a row or leaves the page, and the snapshot serves it as
 * `registration.contentDropped`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { UIBridgeRegistry } from '../../core/registry';
import { useAutoRegister } from '../useAutoRegister';
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
    contentDiscovery: { enabled: true, contentDebounceMs: 0, maxContentElements: 3 },
    mediaDiscovery: { enabled: false },
  });
  return null;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

describe('useAutoRegister: content rows a cap refused', () => {
  let registry: UIBridgeRegistry;
  const contentRows = () => registry.getAllElements().filter((e) => e.category === 'content');
  const dropped = () =>
    (registry.createSnapshot().registration as { contentDropped?: number }).contentDropped;
  const paragraphs = () => Array.from(document.querySelectorAll<HTMLElement>('p'));
  const hasRow = (el: HTMLElement) => contentRows().some((e) => e.element === el);

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

  it('under the cap, the snapshot states 0', async () => {
    document.body.innerHTML = '<p>One</p><p>Two</p>';
    render(<Harness />);
    await settle();
    expect(contentRows()).toHaveLength(2);
    expect(dropped()).toBe(0);
  });

  it('at the cap, the snapshot states exactly how many registrable rows were refused', async () => {
    document.body.innerHTML = '<p>One</p><p>Two</p><p>Three</p><p>Four</p><p>Five</p>';
    render(<Harness />);
    await settle();
    expect(contentRows()).toHaveLength(3);
    expect(dropped()).toBe(2);

    // A rescan that changes nothing counts the same two again, not four.
    document.body.setAttribute('class', 'rescan');
    await settle();
    expect(dropped()).toBe(2);

    // Text added past the cap is refused and counted too.
    const late = document.createElement('p');
    late.textContent = 'Six';
    document.body.appendChild(late);
    await settle();
    expect(hasRow(late)).toBe(false);
    expect(dropped()).toBe(3);
  });

  it('when the cap frees up, a refused row gets a row and leaves the count', async () => {
    document.body.innerHTML = '<p>One</p><p>Two</p><p>Three</p><p>Four</p><p>Five</p>';
    render(<Harness />);
    await settle();
    const refused = paragraphs().filter((el) => !hasRow(el));
    expect(refused).toHaveLength(2);
    expect(dropped()).toBe(2);

    // Removing a held row frees one place; a refused element takes it.
    paragraphs().find(hasRow)!.remove();
    await settle();
    expect(contentRows()).toHaveLength(3);
    expect(refused.filter(hasRow)).toHaveLength(1);
    expect(dropped()).toBe(1);

    // A refused element that leaves the page leaves the count.
    refused.find((el) => !hasRow(el))!.remove();
    await settle();
    expect(dropped()).toBe(0);
  });
});
