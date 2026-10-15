/**
 * ARMING — plan 2026-10-13-image-generation-and-visual-judgment, Phase 5.
 *
 * Enters where the injected runtime's population enters: `observeAndSeed`,
 * what the injected bootstrap (the bundle inject-cli adds to a page) runs to
 * keep its registry live. Before Phase 5 it registered interactive elements
 * only, so a page driven that way had no media rows at all; now every image
 * registers — two that share an alt included, a `<picture>` once — each
 * with a measured observation whose effective resolution reads the device
 * pixel ratio.
 *
 * A srcset image reports its FILE's pixels: the browser's `naturalWidth` is
 * density-corrected for the chosen candidate (a `2x` 800x600 file reads
 * 400x300), and the capture de-corrects it (Phase 7 review, M1).
 *
 * It imports only modules that exist before Phase 5, so with the phase's
 * production hunks reverted it fails on its assertion, never on an import.
 */

import { it, expect, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { observeAndSeed } from './seed-registry';

const restores: Array<() => void> = [];

/** An `<img>` jsdom reports as decoded at a known size, in a known box. */
function decodedImage(
  attrs: Record<string, string>,
  natural: [number, number],
  box: [number, number],
  parent: Element = document.body,
  currentSrc?: string
): HTMLImageElement {
  const img = document.createElement('img');
  for (const [k, v] of Object.entries(attrs)) img.setAttribute(k, v);
  const src = new URL(currentSrc ?? attrs.src ?? '', location.href).href;
  Object.defineProperty(img, 'complete', { configurable: true, get: () => true });
  Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => natural[0] });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, get: () => natural[1] });
  Object.defineProperty(img, 'currentSrc', { configurable: true, get: () => src });
  const rect = {
    x: 0,
    y: 0,
    width: box[0],
    height: box[1],
    top: 0,
    left: 0,
    right: box[0],
    bottom: box[1],
  };
  Object.defineProperty(img, 'getBoundingClientRect', { configurable: true, value: () => rect });
  parent.appendChild(img);
  return img;
}

afterEach(() => {
  while (restores.length) restores.pop()!();
  document.body.innerHTML = '';
});

it('the injected runtime registers every image with a DPR-aware observation', () => {
  const prior = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
  restores.push(() => {
    if (prior) Object.defineProperty(window, 'devicePixelRatio', prior);
  });

  // A 2x asset in a 100x100 CSS box at DPR 2: exactly the pixels shown.
  decodedImage({ alt: 'x', src: '/a.png' }, [200, 200], [100, 100]);
  decodedImage({ alt: 'x', src: '/b.png' }, [200, 200], [100, 100]);
  const picture = document.createElement('picture');
  picture.innerHTML = '<source srcset="/hero.avif" type="image/avif">';
  document.body.appendChild(picture);
  decodedImage({ alt: 'Pic', src: '/hero.png' }, [200, 200], [100, 100], picture);

  const registry = new UIBridgeRegistry();
  const stop = observeAndSeed(registry, document.body);
  stop();

  const media = registry.getAllMediaElements();
  // Every image — the same-alt pair under distinct ids, the picture once.
  expect(media.map((e) => e.id).sort()).toEqual(['img-pic', 'img-x', 'img-x-2']);
  for (const row of media) {
    const obs = row.mediaMetadata as unknown as {
      status: string;
      value: { devicePixelRatio?: number; effectiveResolution?: number };
    };
    expect(obs.status).toBe('measured');
    expect(obs.value.devicePixelRatio).toBe(2);
    expect(obs.value.effectiveResolution).toBe(1);
  }
  const pic = media.filter((e) => e.id === 'img-pic')[0];
  expect(pic.type).toBe('picture');
});

it('the injected runtime reports a 2x srcset image at its file pixels, not the corrected ones', () => {
  const prior = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
  restores.push(() => {
    if (prior) Object.defineProperty(window, 'devicePixelRatio', prior);
  });

  // The browser chose the 2x candidate and reports its 800x600 file as
  // 400x300; drawn in a 400x300 CSS box at DPR 2 it is exactly what is shown.
  decodedImage(
    { alt: 'Hero', src: '/hero-400.png', srcset: '/hero-400.png 1x, /hero-800.png 2x' },
    [400, 300],
    [400, 300],
    document.body,
    '/hero-800.png'
  );

  const registry = new UIBridgeRegistry();
  const stop = observeAndSeed(registry, document.body);
  stop();

  const media = registry.getAllMediaElements();
  expect(media.map((e) => e.id)).toEqual(['img-hero']);
  const obs = media[0].mediaMetadata as unknown as {
    status: string;
    value: { naturalWidth?: number; naturalHeight?: number; effectiveResolution?: number };
  };
  expect(obs.status).toBe('measured');
  expect([obs.value.naturalWidth, obs.value.naturalHeight]).toEqual([800, 600]);
  expect(obs.value.effectiveResolution).toBe(1);
});
