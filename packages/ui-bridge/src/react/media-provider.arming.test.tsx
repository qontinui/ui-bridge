/**
 * ARMING — plan 2026-10-13-image-generation-and-visual-judgment, Phase 5.
 *
 * Enters where an instrumented app's population enters: the app renders
 * `AutoRegisterProvider` with its media options. Before Phase 5 the provider
 * accepted `mediaDiscovery` by type and dropped it, so `includeBackgroundImages`
 * never reached the scanner; and the scanner skipped any image whose derived id
 * was taken, so two images sharing an alt registered once. Now both register,
 * and the background image registers with a measured observation that states
 * what CSS cannot tell it (its intrinsic size) as unmeasured.
 *
 * The host calls the provider inline (`AutoRegisterProvider({...})` inside its
 * own render): the same component code an app renders, run as part of the
 * host's render. It imports only modules that exist before Phase 5, so with
 * the phase's production hunks reverted it fails on its assertion, never on an
 * import.
 */

import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { UIBridgeRegistry } from '../core/registry';
import { AutoRegisterProvider } from './AutoRegisterProvider';
import type { UIBridgeContextValue } from './UIBridgeProvider';

let bridge: UIBridgeContextValue | null = null;
vi.mock('./UIBridgeProvider', () => ({ useUIBridgeOptional: () => bridge }));

/** Give `el` a laid-out box (jsdom does no layout). */
function laidOut<T extends Element>(el: T, width: number, height: number): T {
  const rect = { x: 0, y: 0, width, height, top: 0, left: 0, right: width, bottom: height };
  Object.defineProperty(el, 'getBoundingClientRect', { configurable: true, value: () => rect });
  return el;
}

function Host() {
  return AutoRegisterProvider({
    enabled: true,
    debounceMs: 0,
    mediaDiscovery: { includeBackgroundImages: true, mediaDebounceMs: 0 },
    children: null,
  });
}

let registry: UIBridgeRegistry;

beforeEach(() => {
  registry = new UIBridgeRegistry();
  bridge = { registry } as unknown as UIBridgeContextValue;
});

afterEach(() => {
  cleanup();
  bridge = null;
  document.body.innerHTML = '';
});

it('the provider forwards mediaDiscovery so background images and both same-alt images register', async () => {
  const banner = laidOut(document.createElement('div'), 600, 200);
  banner.style.backgroundImage = 'url("/bg/sunrise.jpg")';
  document.body.appendChild(banner);
  for (const src of ['/a.png', '/b.png']) {
    const img = laidOut(document.createElement('img'), 50, 50);
    img.setAttribute('alt', 'x');
    img.setAttribute('src', src);
    document.body.appendChild(img);
  }

  render(<Host />);

  await waitFor(
    () =>
      expect(
        registry
          .getAllMediaElements()
          .map((e) => e.id)
          .sort()
      ).toEqual(['bg-sunrise', 'img-x', 'img-x-2']),
    { timeout: 5000 }
  );
  const bg = registry.getAllMediaElements().filter((e) => e.id === 'bg-sunrise')[0];
  const obs = bg.mediaMetadata as unknown as {
    status: string;
    value: { mediaType: string };
    provenance: {
      coverage: { unmeasured: Array<{ dimension: string; count: number; code: string }> };
    };
  };
  expect(obs.status).toBe('measured');
  expect(obs.value.mediaType).toBe('background-image');
  expect(obs.provenance.coverage.unmeasured).toContainEqual({
    dimension: 'naturalWidth',
    count: 1,
    code: 'input_missing',
  });
});
