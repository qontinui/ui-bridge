/**
 * `useAutoRegister` answers the registry's discovery rescan (plan
 * 2026-10-22-ui-bridge-hover-forces-the-css-hover-state, Phase 5a).
 *
 * A control hidden by its OWN style at rest (`opacity-0 group-hover:opacity-100`)
 * is not admitted by discovery, and a pure-CSS reveal changes no attribute the
 * MutationObserver watches. So a forced hover asks the registry for a rescan,
 * and the hook must register what is admissible NOW, before that rescan
 * resolves: no debounce, no timer. The debounce here is a minute long, so a
 * registration this test sees can only have come from the rescan's own flush.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { UIBridgeRegistry } from '../../core/registry';
import { useAutoRegister } from '../useAutoRegister';
import { MEDIA_SELECTORS } from '../media-discovery';
import type { UIBridgeContextValue } from '../UIBridgeProvider';

let mockBridge: UIBridgeContextValue | null = null;
vi.mock('../UIBridgeProvider', () => ({
  useUIBridgeOptional: () => mockBridge,
}));

function Harness() {
  useAutoRegister({
    enabled: true,
    // Long enough that no debounced flush can land during a test.
    debounceMs: 60_000,
    contentDiscovery: { enabled: false },
    mediaDiscovery: { enabled: false },
  });
  return null;
}

/** Media discovery ON, so the initial scan runs the media pass the rescan must skip. */
function MediaHarness() {
  useAutoRegister({
    enabled: true,
    debounceMs: 60_000,
    contentDiscovery: { enabled: false },
    mediaDiscovery: { enabled: true, mediaDebounceMs: 60_000 },
  });
  return null;
}

describe('useAutoRegister: the discovery rescan', () => {
  let registry: UIBridgeRegistry;
  let style: HTMLStyleElement;
  let button: HTMLButtonElement;

  /**
   * A pure-CSS reveal the way a forced hover makes one: mark the `.group` with
   * the forced-hover attribute, which a rule keys on. The observer's
   * attributeFilter does not watch that attribute, so nothing is queued.
   */
  const reveal = (): void => {
    document.querySelector('.group')!.setAttribute('data-ui-bridge-pseudo-hover', '');
  };
  const isRegistered = (): boolean =>
    registry.getAllElements().some((entry) => entry.element === button);

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    mockBridge = { registry } as unknown as UIBridgeContextValue;
    // jsdom has no layout; discovery's visibility test needs a box.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 100, 20)
    );
    style = document.createElement('style');
    style.textContent =
      '.reveal { opacity: 0; } .group[data-ui-bridge-pseudo-hover] .reveal { opacity: 1; }';
    document.head.appendChild(style);
    document.body.innerHTML = '<div class="group"><button class="reveal">Schedule</button></div>';
    button = document.querySelector('button')!;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mockBridge = null;
    style.remove();
    document.body.innerHTML = '';
  });

  it('registers a now-visible own-opacity button before the rescan resolves, with no timer advance', async () => {
    render(<Harness />);
    // At rest the button reads opacity 0: discovery does not admit it.
    expect(isRegistered()).toBe(false);
    reveal();
    // The reveal changed no attribute, so nothing queued it either.
    expect(isRegistered()).toBe(false);

    const pending = registry.requestDiscoveryRescan();
    // Registered synchronously, inside the rescan, not on the debounce.
    expect(isRegistered()).toBe(true);
    await expect(pending).resolves.toEqual({ rescanners: 1 });
    expect(button.getAttribute('data-ui-bridge-id')).toBeTruthy();
  });

  it('a rescan never re-registers or clears what is already registered', async () => {
    render(<Harness />);
    reveal();
    await registry.requestDiscoveryRescan();
    const ids = registry.getAllElements().map((e) => e.id);
    await registry.requestDiscoveryRescan();
    expect(registry.getAllElements().map((e) => e.id)).toEqual(ids);
  });

  it('keeps its rescanner across registry.clear()', async () => {
    render(<Harness />);
    registry.clear();
    reveal();
    await expect(registry.requestDiscoveryRescan()).resolves.toEqual({ rescanners: 1 });
    expect(isRegistered()).toBe(true);
  });

  it('skips the media pass: media can never reach revealed, so the rescan never walks it', async () => {
    const mediaQuery = MEDIA_SELECTORS.join(', ');
    const queried: string[] = [];
    const real = Element.prototype.querySelectorAll;
    vi.spyOn(Element.prototype, 'querySelectorAll').mockImplementation(function (
      this: Element,
      selectors: string
    ) {
      queried.push(selectors);
      return real.call(this, selectors);
    });
    render(<MediaHarness />);
    // The initial scan does run the media pass, so the spy can see one.
    expect(queried).toContain(mediaQuery);
    queried.length = 0;
    reveal();
    await registry.requestDiscoveryRescan();
    expect(isRegistered()).toBe(true);
    expect(queried.length).toBeGreaterThan(0);
    expect(queried).not.toContain(mediaQuery);
  });

  it('uninstalls its rescanner on unmount', async () => {
    const { unmount } = render(<Harness />);
    await expect(registry.requestDiscoveryRescan()).resolves.toEqual({ rescanners: 1 });
    unmount();
    await expect(registry.requestDiscoveryRescan()).resolves.toEqual({ rescanners: 0 });
  });
});
