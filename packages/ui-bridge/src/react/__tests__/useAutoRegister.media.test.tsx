/**
 * Media registration — plan 2026-10-13-image-generation-and-visual-judgment,
 * Phase 5 steps 3 and 8.
 *
 * - EVERY image registers. Media ids derive from alt / aria-label / title /
 *   the source's file name, so two images sharing an alt derived one id and
 *   the second was skipped as a "duplicate" — invisible to every media find
 *   and audit. So was every alt-less `next/image` after the first: each
 *   `/_next/image?url=…` source collapsed to `img-image`.
 * - `AutoRegisterProvider` passes `mediaDiscovery` (and every other option)
 *   through; it used to accept them by type and drop them.
 * - Background images register on the mutation paths too, and only when
 *   `includeBackgroundImages` is on.
 * - The observer watches `src`, `srcset` and the image-slot marker.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { UIBridgeRegistry } from '../../core/registry';
import { useAutoRegister } from '../useAutoRegister';
import { AutoRegisterProvider } from '../AutoRegisterProvider';
import type { MediaDiscoveryOptions } from '../media-discovery';
import type { UIBridgeContextValue } from '../UIBridgeProvider';
import { makeImage, stubBox } from './media-fixture';

let mockBridge: UIBridgeContextValue | null = null;
vi.mock('../UIBridgeProvider', () => ({
  useUIBridgeOptional: () => mockBridge,
}));

function Harness({ media }: { media?: MediaDiscoveryOptions }) {
  useAutoRegister({
    enabled: true,
    debounceMs: 0,
    contentDiscovery: { enabled: false },
    mediaDiscovery: { mediaDebounceMs: 0, ...media },
  });
  return null;
}

/**
 * Let the debounced registration timers fire. Long enough that a NEGATIVE
 * assertion after it is meaningful on a loaded machine; positive assertions
 * poll with {@link expectMediaIds} instead of trusting a fixed delay.
 */
async function flush(ms = 60): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

/** Poll until the registered media ids are exactly `ids` (sorted). */
async function expectMediaIds(registry: UIBridgeRegistry, ids: string[]): Promise<void> {
  await waitFor(() => expect(mediaIds(registry)).toEqual(ids), { timeout: 3000 });
}

function mediaIds(registry: UIBridgeRegistry): string[] {
  return registry
    .getAllMediaElements()
    .map((e) => e.id)
    .sort();
}

describe('every image registers', () => {
  let registry: UIBridgeRegistry;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    mockBridge = { registry } as unknown as UIBridgeContextValue;
  });

  afterEach(() => {
    cleanup();
    mockBridge = null;
    document.body.innerHTML = '';
  });

  it('two <img alt="x"> both register, under distinct ids', async () => {
    const first = makeImage({ alt: 'x', src: '/a.png', natural: [10, 10] });
    const second = makeImage({ alt: 'x', src: '/b.png', natural: [10, 10] });

    render(<Harness />);
    await expectMediaIds(registry, ['img-x', 'img-x-2']);
    // Page order decides who keeps the bare id.
    expect(registry.getElement('img-x')?.element).toBe(first);
    expect(registry.getElement('img-x-2')?.element).toBe(second);
  });

  it('alt-less next/image sources no longer collapse to one img-image', async () => {
    makeImage({ alt: null, src: '/_next/image?url=%2Fimages%2Fhero.png&w=1920&q=75', natural: [10, 10] });
    makeImage({ alt: null, src: '/_next/image?url=%2Fimages%2Fteam.jpg&w=640&q=75', natural: [10, 10] });
    // The same source twice is still two images.
    makeImage({ alt: null, src: '/_next/image?url=%2Fimages%2Fteam.jpg&w=640&q=75', natural: [10, 10] });

    render(<Harness />);
    await expectMediaIds(registry, ['img-hero', 'img-team', 'img-team-2']);
  });

  it('a <picture> registers ONCE — its painting <img>, typed picture', async () => {
    const picture = document.createElement('picture');
    picture.innerHTML = '<source srcset="/hero.webp" type="image/webp" />';
    stubBox(picture, 800, 600);
    document.body.appendChild(picture);
    makeImage({ alt: 'Hero', src: '/hero.jpg', natural: [800, 600], parent: picture });

    render(<Harness />);
    await expectMediaIds(registry, ['img-hero']);

    const row = registry.getElement('img-hero')!;
    expect(row.type).toBe('picture');
    expect(row.element.tagName).toBe('IMG');
  });

  it('a re-scan does not re-register an image under a second id', async () => {
    makeImage({ alt: 'x', src: '/a.png', natural: [10, 10] });
    makeImage({ alt: 'x', src: '/b.png', natural: [10, 10] });

    const { rerender } = render(<Harness />);
    await expectMediaIds(registry, ['img-x', 'img-x-2']);
    // New options re-run the effect, which re-scans the whole document.
    rerender(<Harness media={{ maxMediaElements: 50 }} />);
    await flush();
    expect(mediaIds(registry)).toEqual(['img-x', 'img-x-2']);
  });

  it('an image swapped into place by a src change registers (the observer watches src)', async () => {
    // A lazy-load library's placeholder: 0x0 and complete, so not registerable.
    const img = makeImage({ alt: 'late', rendered: [0, 0] });

    render(<Harness />);
    await flush();
    expect(mediaIds(registry)).toEqual([]);

    stubBox(img, 120, 80);
    img.setAttribute('src', '/late.png');
    await expectMediaIds(registry, ['img-late']);
  });

  it('inside a redaction boundary the id never slugs the alt or the file name', async () => {
    const boundary = document.createElement('section');
    boundary.setAttribute('data-bridge-redact', 'true');
    document.body.appendChild(boundary);
    makeImage({ alt: 'QR for SECRET123', src: '/totp-SECRET123.png', natural: [10, 10], parent: boundary });

    render(<Harness />);
    await waitFor(() => expect(mediaIds(registry)).toHaveLength(1), { timeout: 3000 });

    const ids = mediaIds(registry);
    expect(ids[0].toLowerCase()).not.toContain('secret123');
  });
});

describe('background images on the mutation paths', () => {
  let registry: UIBridgeRegistry;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    mockBridge = { registry } as unknown as UIBridgeContextValue;
  });

  afterEach(() => {
    cleanup();
    mockBridge = null;
    document.body.innerHTML = '';
  });

  function addBanner(url: string): HTMLDivElement {
    const div = document.createElement('div');
    div.style.backgroundImage = `url("${url}")`;
    stubBox(div, 600, 200);
    document.body.appendChild(div);
    return div;
  }

  it('registers a background image ADDED after the initial scan', async () => {
    render(<Harness media={{ includeBackgroundImages: true }} />);
    await flush();

    addBanner('/bg/sunrise.jpg');
    await expectMediaIds(registry, ['bg-sunrise']);
  });

  it('registers one that APPEARS through a style change', async () => {
    const div = document.createElement('div');
    stubBox(div, 600, 200);
    document.body.appendChild(div);
    render(<Harness media={{ includeBackgroundImages: true }} />);
    await flush();
    expect(mediaIds(registry)).toEqual([]);

    div.style.backgroundImage = 'url("/bg/dusk.jpg")';
    await expectMediaIds(registry, ['bg-dusk']);
  });

  it('registers none when includeBackgroundImages is off — on any path', async () => {
    render(<Harness />);
    await flush();

    addBanner('/bg/sunrise.jpg');
    await flush();

    expect(mediaIds(registry)).toEqual([]);
  });
});

describe('AutoRegisterProvider passes every option through', () => {
  let registry: UIBridgeRegistry;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    mockBridge = { registry } as unknown as UIBridgeContextValue;
  });

  afterEach(() => {
    cleanup();
    mockBridge = null;
    document.body.innerHTML = '';
  });

  it('mediaDiscovery.enabled: false reaches the hook (no media registers)', async () => {
    makeImage({ alt: 'logo', src: '/logo.png', natural: [10, 10] });

    render(
      <AutoRegisterProvider enabled debounceMs={0} mediaDiscovery={{ enabled: false }}>
        <span />
      </AutoRegisterProvider>
    );
    await flush(250);

    expect(mediaIds(registry)).toEqual([]);
  });

  it('includeBackgroundImages reaches the hook', async () => {
    const div = document.createElement('div');
    div.style.backgroundImage = 'url("/bg/hero.png")';
    stubBox(div, 600, 200);
    document.body.appendChild(div);

    render(
      <AutoRegisterProvider
        enabled
        debounceMs={0}
        mediaDiscovery={{ includeBackgroundImages: true, mediaDebounceMs: 0 }}
      >
        <span />
      </AutoRegisterProvider>
    );
    await expectMediaIds(registry, ['bg-hero']);
  });
});
