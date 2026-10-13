/**
 * ARMING — plan 2026-10-13-image-generation-and-visual-judgment, Phase 5.
 *
 * Enters where an instrumented app's population enters: the app renders
 * `AutoRegisterProvider` with its media options. Before Phase 5 the provider
 * accepted `mediaDiscovery` by type and dropped it, so `includeBackgroundImages`
 * never reached the scanner; and the scanner skipped any image whose derived id
 * was taken, so two images sharing an alt registered once. Now both register,
 * and the background image registers with a measured observation that states
 * what CSS cannot tell it (its intrinsic size) as unmeasured. And inside a
 * `data-bridge-redact` boundary a media id slugged the alt, the file name or
 * an ancestor's aria-label — content no scrub reaches, since an id is an
 * address; now none of them names one.
 *
 * The host calls the provider inline (`AutoRegisterProvider({...})` inside its
 * own render): the same component code an app renders, run as part of the
 * host's render. It imports only modules that exist before Phase 5, so with
 * the phase's production hunks reverted it fails on its assertion, never on an
 * import — and each `waitFor` gives up (3s) before vitest's 5s test timeout,
 * so that failure is the assertion's message rather than a timeout.
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
    { timeout: 3000 }
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

it('the provider registers redacted media under ids that slug none of their content', async () => {
  // An id is an address: no scrub runs over it, so inside a redaction boundary
  // nothing the page wrote (alt, file name, an ancestor's aria-label) may
  // become part of one.
  const boundary = document.createElement('section');
  boundary.setAttribute('data-bridge-redact', 'true');
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Zephyrine Quill chart');
  boundary.appendChild(dialog);
  document.body.appendChild(boundary);

  const scan = laidOut(document.createElement('img'), 50, 50);
  scan.setAttribute('alt', 'Zephyrine Quill x-ray');
  scan.setAttribute('src', '/scans/zephyrine-quill.png');
  dialog.appendChild(scan);
  // No alt and no src: only its ancestors can name it.
  dialog.appendChild(laidOut(document.createElement('img'), 50, 50));
  const banner = laidOut(document.createElement('div'), 600, 200);
  banner.style.backgroundImage = 'url("/scans/zephyrine-banner.jpg")';
  dialog.appendChild(banner);

  render(<Host />);

  await waitFor(() => expect(registry.getAllMediaElements()).toHaveLength(3), { timeout: 3000 });
  for (const row of registry.getAllMediaElements()) {
    expect(row.id).not.toMatch(/zephyrine|quill/i);
  }
});
