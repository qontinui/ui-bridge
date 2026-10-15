/**
 * `naturalWidth` / `naturalHeight` are the displayed FILE's pixels.
 *
 * A browser reports them density-corrected for a srcset candidate: the 800x600
 * file of a `2x` candidate reads 400x300 (Phase 1 measured exactly that on the
 * `<picture>` fixture), and an `800w` candidate laid out at a 400px source size
 * reads the same. The capture multiplies them back by the displayed
 * candidate's density; when that candidate cannot be resolved, the natural
 * size (and the effective resolution derived from it) is UNMEASURED with a
 * code — never the corrected number reported as the file's.
 *
 * jsdom loads no images, so the fixture stubs what a browser would report:
 * the density-CORRECTED `naturalWidth` and the chosen `currentSrc`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { captureMediaMetadata } from './media-capture';
import { parseSrcset, resolveSourceSize } from './srcset-density';
import { mediaFactsOf, unmeasuredMediaDimension } from '../core/media-observation';
import type { MediaFacts, MediaObservation } from '../core/types';
import { makeImage, setDevicePixelRatio } from './__tests__/media-fixture';

function measured(obs: MediaObservation): MediaFacts {
  expect(obs.status).toBe('measured');
  return mediaFactsOf(obs)!;
}

const restores: Array<() => void> = [];

afterEach(() => {
  while (restores.length) restores.pop()!();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

/**
 * A `matchMedia` that answers `(width: Npx)` / `(height: Npx)` for the given
 * viewport and the listed conditions as matching; everything else not.
 */
function stubMatchMedia(viewport: { width: number; height: number }, matching: string[] = []) {
  vi.stubGlobal('innerWidth', viewport.width);
  vi.stubGlobal('innerHeight', viewport.height);
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches:
      q === `(width: ${viewport.width}px)` ||
      q === `(height: ${viewport.height}px)` ||
      matching.includes(q),
    media: q,
  }));
}

const abs = (p: string) => new URL(p, location.href).href;

describe('x descriptors', () => {
  it('a 2x candidate reports the file pixels (800x600), not the corrected 400x300', () => {
    restores.push(setDevicePixelRatio(2));
    const img = makeImage({
      alt: 'hero',
      src: '/hero-400.png',
      currentSrc: abs('/hero-800.png'),
      natural: [400, 300], // what the browser reports for the 2x file
      rendered: [400, 300],
      attrs: { srcset: '/hero-400.png 1x, /hero-800.png 2x' },
    });

    const facts = measured(captureMediaMetadata(img));
    expect(facts.naturalWidth).toBe(800);
    expect(facts.naturalHeight).toBe(600);
    // 800 file px over 400 CSS px at DPR 2: exactly what the screen shows.
    expect(facts.effectiveResolution).toBe(1);
  });

  it('the same URL chosen as the 1x candidate stays 400x300', () => {
    const img = makeImage({
      alt: 'hero',
      src: '/hero-400.png',
      natural: [400, 300],
      rendered: [400, 300],
      attrs: { srcset: '/hero-400.png 1x, /hero-800.png 2x' },
    });
    expect(measured(captureMediaMetadata(img)).naturalWidth).toBe(400);
  });

  it('a <picture> <source> 2x candidate is resolved through the picture', () => {
    restores.push(setDevicePixelRatio(2));
    const picture = document.createElement('picture');
    const source = document.createElement('source');
    source.setAttribute('srcset', '/pic-400.webp 1x, /pic-800.webp 2x');
    source.setAttribute('type', 'image/webp');
    picture.appendChild(source);
    document.body.appendChild(picture);
    const img = makeImage({
      alt: 'pic',
      src: '/pic-400.png',
      currentSrc: abs('/pic-800.webp'),
      natural: [400, 300],
      rendered: [400, 300],
      parent: picture,
    });

    const facts = measured(captureMediaMetadata(img));
    expect(facts.naturalWidth).toBe(800);
    expect(facts.naturalHeight).toBe(600);
  });
});

describe('w descriptors', () => {
  it('an 800w candidate at sizes="400px" reports 800x600', () => {
    const img = makeImage({
      alt: 'w',
      src: '/w-400.png',
      currentSrc: abs('/w-800.png'),
      natural: [400, 300],
      rendered: [400, 300],
      attrs: { srcset: '/w-400.png 400w, /w-800.png 800w', sizes: '400px' },
    });
    const facts = measured(captureMediaMetadata(img));
    expect(facts.naturalWidth).toBe(800);
    expect(facts.naturalHeight).toBe(600);
  });

  it('the first sizes entry whose media condition matches decides the source size', () => {
    stubMatchMedia({ width: 1000, height: 800 }, ['(min-width: 900px)']);
    const img = makeImage({
      alt: 'w',
      src: '/w-400.png',
      currentSrc: abs('/w-1600.png'),
      // 1600w at 50vw of a 1000px viewport = 500px source size: density 3.2.
      natural: [500, 250],
      rendered: [500, 250],
      attrs: {
        srcset: '/w-400.png 400w, /w-1600.png 1600w',
        sizes: '(min-width: 900px) 50vw, 100vw',
      },
    });
    const facts = measured(captureMediaMetadata(img));
    expect(facts.naturalWidth).toBe(1600);
    expect(facts.naturalHeight).toBe(800);
  });

  it('an absent sizes is 100vw', () => {
    stubMatchMedia({ width: 800, height: 600 });
    const img = makeImage({
      alt: 'w',
      src: '/w-400.png',
      currentSrc: abs('/w-1600.png'),
      natural: [800, 400], // 1600w over an 800px source size: density 2
      rendered: [800, 400],
      attrs: { srcset: '/w-400.png 400w, /w-1600.png 1600w' },
    });
    expect(measured(captureMediaMetadata(img)).naturalWidth).toBe(1600);
  });
});

describe('an unresolvable candidate is UNMEASURED, never guessed', () => {
  it('currentSrc that matches no candidate: natural size and effective resolution unmeasured', () => {
    const img = makeImage({
      alt: 'u',
      src: '/u-400.png',
      currentSrc: abs('/elsewhere.png'),
      natural: [400, 300],
      rendered: [400, 300],
      attrs: { srcset: '/u-400.png 1x, /u-800.png 2x' },
    });
    const obs = captureMediaMetadata(img);
    const facts = measured(obs);
    expect(facts.naturalWidth).toBeUndefined();
    expect(facts.naturalHeight).toBeUndefined();
    expect(facts.effectiveResolution).toBeUndefined();
    expect(unmeasuredMediaDimension(obs, 'naturalWidth')).toBe('input_missing');
    expect(unmeasuredMediaDimension(obs, 'naturalHeight')).toBe('input_missing');
    expect(unmeasuredMediaDimension(obs, 'effectiveResolution')).toBe('input_missing');
  });

  it('a sizes length this build cannot evaluate (calc) is capability_unavailable_in_build', () => {
    const img = makeImage({
      alt: 'u',
      src: '/u-400.png',
      currentSrc: abs('/u-800.png'),
      natural: [400, 300],
      attrs: { srcset: '/u-400.png 400w, /u-800.png 800w', sizes: 'calc(100vw - 2rem)' },
    });
    const obs = captureMediaMetadata(img);
    expect(measured(obs).naturalWidth).toBeUndefined();
    expect(unmeasuredMediaDimension(obs, 'naturalWidth')).toBe('capability_unavailable_in_build');
  });

  it('a vw source size with no matchMedia to confirm the viewport is unmeasured', () => {
    vi.stubGlobal('matchMedia', undefined);
    const img = makeImage({
      alt: 'u',
      src: '/u-400.png',
      currentSrc: abs('/u-800.png'),
      natural: [400, 300],
      attrs: { srcset: '/u-400.png 400w, /u-800.png 800w' },
    });
    const obs = captureMediaMetadata(img);
    expect(measured(obs).naturalWidth).toBeUndefined();
    expect(unmeasuredMediaDimension(obs, 'naturalWidth')).toBe('capability_unavailable_in_build');
  });

  it('two candidates sharing currentSrc with different densities are ambiguous', () => {
    const img = makeImage({
      alt: 'u',
      src: '/same.png',
      currentSrc: abs('/same.png'),
      natural: [400, 300],
      // The srcset has no 1x and no w candidate, so `src` joins the img's
      // source set as its 1x candidate: one URL, two densities.
      attrs: { srcset: '/same.png 2x' },
    });
    const obs = captureMediaMetadata(img);
    expect(measured(obs).naturalWidth).toBeUndefined();
    expect(unmeasuredMediaDimension(obs, 'naturalWidth')).toBe('input_missing');
  });
});

describe('no srcset: the browser number is the file number', () => {
  it('a plain <img src> reports naturalWidth unchanged', () => {
    const img = makeImage({ alt: 'p', src: '/p.png', natural: [640, 480] });
    const facts = measured(captureMediaMetadata(img));
    expect(facts.naturalWidth).toBe(640);
    expect(facts.naturalHeight).toBe(480);
  });
});

describe('parseSrcset', () => {
  it('parses x, w and descriptor-less candidates, and URLs that contain commas', () => {
    expect(parseSrcset('a.png, b.png 2x, c.png 800w 600h,d.png 1.5x')).toEqual([
      { url: 'a.png', density: 1 },
      { url: 'b.png', density: 2 },
      { url: 'c.png', width: 800 },
      { url: 'd.png', density: 1.5 },
    ]);
    expect(parseSrcset('/img?a=1,2 2x')).toEqual([{ url: '/img?a=1,2', density: 2 }]);
    expect(parseSrcset('/x.png,')).toEqual([{ url: '/x.png', density: 1 }]);
  });

  it('drops a candidate whose descriptors are invalid, as the browser does', () => {
    expect(parseSrcset('a.png 2x 800w, b.png foo, c.png 0x, d.png 3x')).toEqual([
      { url: 'd.png', density: 3 },
    ]);
    // Not valid HTML floating-point numbers.
    expect(parseSrcset('a.png 1.x, b.png +2x, c.png 1.e2x, d.png .5x')).toEqual([
      { url: 'd.png', density: 0.5 },
    ]);
  });
});

describe('next/image shapes (src repeats a srcset candidate)', () => {
  const nx = (w: number) => `/_next/image?url=%2Fhero.png&w=${w}&q=75`;

  it('x-kind (`w=640 1x, w=1080 2x`, src = the 2x URL) at DPR 2 reads the 2x file', () => {
    restores.push(setDevicePixelRatio(2));
    const img = makeImage({
      alt: 'hero',
      src: nx(1080),
      currentSrc: abs(nx(1080)),
      natural: [540, 360], // the 1080x720 file, density-corrected by 2
      rendered: [540, 360],
      attrs: { srcset: `${nx(640)} 1x, ${nx(1080)} 2x` },
    });
    const facts = measured(captureMediaMetadata(img));
    // The srcset holds a 1x candidate, so src is NOT a second (1x) reading.
    expect([facts.naturalWidth, facts.naturalHeight]).toEqual([1080, 720]);
    expect(facts.effectiveResolution).toBe(1);
  });

  it('w-kind (src = the largest candidate) reads the file through the w descriptor', () => {
    stubMatchMedia({ width: 960, height: 800 });
    const img = makeImage({
      alt: 'hero',
      src: nx(1920),
      currentSrc: abs(nx(1920)),
      natural: [960, 540], // 1920w over a 100vw = 960px source size: density 2
      rendered: [960, 540],
      attrs: { srcset: `${nx(640)} 640w, ${nx(1080)} 1080w, ${nx(1920)} 1920w`, sizes: '100vw' },
    });
    const facts = measured(captureMediaMetadata(img));
    expect([facts.naturalWidth, facts.naturalHeight]).toEqual([1920, 1080]);
  });

  it('a <picture> <source> never takes the img src as a candidate', () => {
    restores.push(setDevicePixelRatio(2));
    const picture = document.createElement('picture');
    const source = document.createElement('source');
    source.setAttribute('srcset', '/p.webp 2x');
    picture.appendChild(source);
    document.body.appendChild(picture);
    // src names the same URL; it belongs to the img's own source set, which
    // has no srcset, so it is that set's 1x candidate — a different set.
    const img = makeImage({
      alt: 'p',
      src: '/p.png',
      currentSrc: abs('/p.webp'),
      natural: [200, 100],
      parent: picture,
    });
    expect(measured(captureMediaMetadata(img)).naturalWidth).toBe(400);
  });
});

describe('resolveSourceSize', () => {
  it('reads px, absolute units, and vw/vh against the confirmed viewport', () => {
    stubMatchMedia({ width: 1200, height: 900 });
    expect(resolveSourceSize('300px', undefined)).toEqual({ px: 300 });
    expect(resolveSourceSize('1in', undefined)).toEqual({ px: 96 });
    expect(resolveSourceSize('25vw', undefined)).toEqual({ px: 300 });
    expect(resolveSourceSize('(max-width: 10px) 5px, 50vh', undefined)).toEqual({ px: 450 });
  });

  it('honours sizes="auto" only as the first entry of a lazy image', () => {
    expect(resolveSourceSize('auto, 200px', 321, true)).toEqual({ px: 321 });
    // Not lazy: the auto entry is skipped and the next one is read.
    expect(resolveSourceSize('auto, 200px', 321, false)).toEqual({ px: 200 });
    // Not first: skipped even on a lazy image.
    stubMatchMedia({ width: 1200, height: 900 });
    expect(resolveSourceSize('(max-width: 1px) 5px, auto, 200px', 321, true)).toEqual({
      px: 200,
    });
  });

  it('skips an invalid entry and reads the next, as the browser does', () => {
    expect(resolveSourceSize('50%, 300px', undefined)).toEqual({ px: 300 });
    expect(resolveSourceSize('-10px, 200px', undefined)).toEqual({ px: 200 });
    expect(resolveSourceSize('12, banana, 10furlongs, 150px', undefined)).toEqual({ px: 150 });
  });

  it('refuses font-relative lengths and math functions rather than assuming a value', () => {
    expect(resolveSourceSize('20em', undefined)).toMatchObject({
      code: 'capability_unavailable_in_build',
    });
    expect(resolveSourceSize('calc(100vw - 2rem), 300px', undefined)).toMatchObject({
      code: 'capability_unavailable_in_build',
    });
  });
});
