/**
 * `captureMediaMetadata` — the media observation one image produces.
 *
 * Plan 2026-10-13-image-generation-and-visual-judgment, Phase 5 steps 4–5:
 * the capture is extended (object-fit, reserved dimensions, loading / decoding
 * / fetchpriority, DPR and a DPR-aware effective resolution, LCP / CLS, the
 * image slot, the weight as `encodedBodySize` keyed on `currentSrc`) and comes
 * back as ONE observation envelope whose provenance lists every fact it could
 * not measure, with the code — never a 0, never an absence that reads as
 * measured.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  captureMediaMetadata,
  captureBackgroundImageMetadata,
  computeEffectiveResolution,
  resetMediaPerfTrackerForTests,
  SDK_MEDIA_PRODUCER_ID,
} from './media-capture';
import { mediaFactsOf, unmeasuredMediaDimension } from '../core/media-observation';
import type { MediaFacts, MediaObservation } from '../core/types';
import { makeImage, setDevicePixelRatio, stubBox } from './__tests__/media-fixture';

function measured(obs: MediaObservation): MediaFacts {
  expect(obs.status).toBe('measured');
  return mediaFactsOf(obs)!;
}

const restores: Array<() => void> = [];

afterEach(() => {
  while (restores.length) restores.pop()!();
  document.body.innerHTML = '';
  resetMediaPerfTrackerForTests();
  vi.unstubAllGlobals();
});

describe('effective resolution is DPR-aware (the DPR fixture)', () => {
  it('a 2x image at DPR 2 reads effectiveResolution 1.0', () => {
    restores.push(setDevicePixelRatio(2));
    // 200x200 source pixels in a 100x100 CSS box: at DPR 2 the box IS
    // 200x200 device pixels, so the image carries exactly what is shown.
    const img = makeImage({ alt: 'retina', src: '/hero.png', natural: [200, 200], rendered: [100, 100] });

    const facts = measured(captureMediaMetadata(img));

    expect(facts.devicePixelRatio).toBe(2);
    expect(facts.effectiveResolution).toBe(1);
  });

  it('the same image at DPR 1 reads 2.0 — oversized for that screen', () => {
    restores.push(setDevicePixelRatio(1));
    const img = makeImage({ alt: 'retina', src: '/hero.png', natural: [200, 200], rendered: [100, 100] });

    expect(measured(captureMediaMetadata(img)).effectiveResolution).toBe(2);
  });

  it('a 1x image at DPR 2 reads 0.5 — upscaled, soft', () => {
    restores.push(setDevicePixelRatio(2));
    const img = makeImage({ alt: 'soft', src: '/soft.png', natural: [100, 100], rendered: [100, 100] });

    expect(measured(captureMediaMetadata(img)).effectiveResolution).toBe(0.5);
  });

  it('object-fit decides the displayed size: cover and contain differ, fill takes the limiting axis', () => {
    // 400x200 source in a 100x100 box at DPR 1.
    const natural = { width: 400, height: 200 };
    const box = { width: 100, height: 100 };
    // cover scales to 200x100 painted -> 2.0 source px per device px.
    expect(computeEffectiveResolution(natural, box, 1, 'cover')).toBe(2);
    // contain scales to 100x50 painted -> 4.0.
    expect(computeEffectiveResolution(natural, box, 1, 'contain')).toBe(4);
    // fill squeezes: 4.0 horizontally, 2.0 vertically -> the limiting 2.0.
    expect(computeEffectiveResolution(natural, box, 1, 'fill')).toBe(2);
    // none paints 1:1 regardless of the box.
    expect(computeEffectiveResolution(natural, box, 2, 'none')).toBe(0.5);
  });

  it('an image that has not decoded has its resolution UNMEASURED, never 0', () => {
    const img = makeImage({ alt: 'pending', src: '/slow.png', complete: false });
    const obs = captureMediaMetadata(img);
    const facts = measured(obs);

    expect(facts.loadingState).toBe('pending');
    expect(facts.naturalWidth).toBeUndefined();
    expect(facts.effectiveResolution).toBeUndefined();
    expect(unmeasuredMediaDimension(obs, 'effectiveResolution')).toBe('input_missing');
    expect(unmeasuredMediaDimension(obs, 'naturalWidth')).toBe('input_missing');
  });
});

describe('the envelope', () => {
  it('is one measured observation per element, with the producer and a sampled time', () => {
    const img = makeImage({ alt: 'logo', src: '/logo.png', natural: [10, 10] });
    const obs = captureMediaMetadata(img);

    expect(obs.status).toBe('measured');
    expect(obs.provenance.producer.id).toBe(SDK_MEDIA_PRODUCER_ID);
    expect(obs.provenance.observedAt).not.toBeNull();
    expect(obs.provenance.coverage.considered).toBe(1);
    // jsdom exposes no PerformanceObserver entry types, object-fit, or
    // computed-value API, so the observation is DEGRADED, and says exactly why.
    expect(obs.provenance.coverage.measured).toBe(0);
    for (const u of obs.provenance.coverage.unmeasured) {
      expect(u.count).toBe(1);
      expect(['input_missing', 'capability_unavailable_in_build']).toContain(u.code);
    }
  });

  it('every unmeasured dimension is a field the facts omit (dimension X unmeasured => field X absent)', () => {
    const img = makeImage({ alt: 'x', src: '/x.png', complete: false });
    const obs = captureMediaMetadata(img);
    const facts = measured(obs) as unknown as Record<string, unknown>;
    expect(obs.provenance.coverage.unmeasured.length).toBeGreaterThan(0);
    for (const u of obs.provenance.coverage.unmeasured) {
      expect(facts[u.dimension]).toBeUndefined();
    }
  });

  it('a capture that throws answers unknown{producer_failed} naming only the error class', () => {
    const img = makeImage({ alt: 'boom', src: '/boom.png' });
    Object.defineProperty(img, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        throw new TypeError('https://cdn.example/secret?token=abc');
      },
    });
    const obs = captureMediaMetadata(img);

    expect(obs.status).toBe('unknown');
    if (obs.status !== 'unknown') return;
    expect(obs.unknown.code).toBe('producer_failed');
    expect(obs.unknown.detail).toBe('media capture threw TypeError');
  });
});

describe('alt, decoration and the slot marker', () => {
  it('a MISSING alt is not decorative (img.alt reads "" for both)', () => {
    const facts = measured(captureMediaMetadata(makeImage({ alt: null, src: '/a.png', natural: [1, 1] })));
    expect(facts.altText).toBeUndefined();
    expect(facts.isDecorative).toBe(false);
  });

  it('an EMPTY alt is decorative', () => {
    const facts = measured(captureMediaMetadata(makeImage({ alt: '', src: '/a.png', natural: [1, 1] })));
    expect(facts.isDecorative).toBe(true);
  });

  it('reads the slot id and the placeholder marker, from the image or its <picture>', () => {
    const picture = document.createElement('picture');
    picture.setAttribute('data-ui-bridge-image-slot', 'hero');
    document.body.appendChild(picture);
    const img = makeImage({
      alt: 'hero',
      src: '/hero.png',
      natural: [10, 10],
      parent: picture,
      attrs: { 'data-ui-bridge-placeholder': 'true' },
    });

    const facts = measured(captureMediaMetadata(img));
    expect(facts.slotId).toBe('hero');
    expect(facts.placeholder).toBe(true);
  });
});

describe('loading, decoding, fetchpriority and reserved dimensions', () => {
  it('reports the effective attribute values, spec defaults included', () => {
    const lazy = makeImage({
      alt: 'a',
      src: '/a.png',
      natural: [1, 1],
      attrs: { loading: 'LAZY', decoding: 'async', fetchpriority: 'high' },
    });
    const plain = makeImage({ alt: 'b', src: '/b.png', natural: [1, 1] });

    expect(measured(captureMediaMetadata(lazy))).toMatchObject({
      loading: 'lazy',
      decoding: 'async',
      fetchPriority: 'high',
    });
    expect(measured(captureMediaMetadata(plain))).toMatchObject({
      loading: 'eager',
      decoding: 'auto',
      fetchPriority: 'auto',
    });
  });

  it('width + height attributes reserve the box', () => {
    const img = makeImage({ alt: 'a', src: '/a.png', attrs: { width: '1200', height: '800' } });
    const facts = measured(captureMediaMetadata(img));
    expect(facts.widthAttribute).toBe(1200);
    expect(facts.heightAttribute).toBe(800);
    expect(facts.dimsReserved).toBe(true);
  });

  it('with no attributes and no computed-value API, reservation is UNMEASURED — not false', () => {
    const obs = captureMediaMetadata(makeImage({ alt: 'a', src: '/a.png' }));
    expect(mediaFactsOf(obs)!.dimsReserved).toBeUndefined();
    expect(unmeasuredMediaDimension(obs, 'dimsReserved')).toBe('capability_unavailable_in_build');
  });

  it('reads computed width/height (not resolved px) where the engine exposes them', () => {
    const img = makeImage({ alt: 'a', src: '/a.png' });
    const computed: Record<string, string> = { width: 'auto', height: 'auto' };
    Object.defineProperty(img, 'computedStyleMap', {
      configurable: true,
      value: () => ({ get: (p: string) => ({ toString: () => computed[p] ?? 'auto' }) }),
    });
    expect(measured(captureMediaMetadata(img)).dimsReserved).toBe(false);

    computed.width = '320px';
    computed.height = '200px';
    expect(measured(captureMediaMetadata(img)).dimsReserved).toBe(true);
  });
});

describe('weight: encodedBodySize keyed on currentSrc', () => {
  function stubResourceEntries(entries: Record<string, Partial<PerformanceResourceTiming>>) {
    vi.spyOn(performance, 'getEntriesByName').mockImplementation(((name: string) =>
      entries[name] ? [entries[name] as PerformanceEntry] : []) as never);
  }

  afterEach(() => vi.restoreAllMocks());

  it('reads the entry for the URL actually displayed (currentSrc), not the src attribute', () => {
    stubResourceEntries({
      'http://localhost:3000/hero-1x.png': { encodedBodySize: 1000 },
      'http://localhost:3000/hero-2x.png': { encodedBodySize: 4000 },
    });
    const img = makeImage({
      alt: 'hero',
      src: '/hero-1x.png',
      currentSrc: 'http://localhost:3000/hero-2x.png',
      natural: [10, 10],
    });

    expect(measured(captureMediaMetadata(img)).encodedBodySize).toBe(4000);
  });

  it('a cross-origin entry with no Timing-Allow-Origin (size 0) is input_missing, never 0', () => {
    stubResourceEntries({
      'https://cdn.example/a.png': { encodedBodySize: 0, transferSize: 0 },
    });
    const img = makeImage({ alt: 'a', currentSrc: 'https://cdn.example/a.png', src: 'https://cdn.example/a.png', natural: [1, 1] });
    const obs = captureMediaMetadata(img);

    expect(mediaFactsOf(obs)!.encodedBodySize).toBeUndefined();
    expect(unmeasuredMediaDimension(obs, 'encodedBodySize')).toBe('input_missing');
  });

  it('a cache hit (transferSize 0) still has its weight', () => {
    stubResourceEntries({
      'http://localhost:3000/cached.png': { encodedBodySize: 2048, transferSize: 0 },
    });
    const img = makeImage({ alt: 'c', src: '/cached.png', natural: [1, 1] });

    expect(measured(captureMediaMetadata(img)).encodedBodySize).toBe(2048);
  });

  it('a data: URL weighs its payload', () => {
    // 8 base64 chars, one pad -> 5 bytes.
    const img = makeImage({ alt: 'dot', src: 'data:image/png;base64,iVBORw0=', natural: [1, 1] });
    const facts = measured(captureMediaMetadata(img));
    expect(facts.encodedBodySize).toBe(5);
    expect(facts.format).toBe('png');
  });

  it('the served format comes from the response content type when the entry carries one', () => {
    stubResourceEntries({
      'http://localhost:3000/_next/image?url=%2Fhero.png&w=640&q=75': {
        encodedBodySize: 900,
        contentType: 'image/webp',
      } as Partial<PerformanceResourceTiming>,
    });
    const img = makeImage({ alt: 'h', src: '/_next/image?url=%2Fhero.png&w=640&q=75', natural: [1, 1] });

    expect(measured(captureMediaMetadata(img)).format).toBe('webp');
  });

  it('an optimizer URL with no content type has its format UNMEASURED — it transcodes', () => {
    stubResourceEntries({});
    const img = makeImage({ alt: 'h', src: '/_next/image?url=%2Fhero.png&w=640&q=75', natural: [1, 1] });
    const obs = captureMediaMetadata(img);
    expect(mediaFactsOf(obs)!.format).toBeUndefined();
    expect(unmeasuredMediaDimension(obs, 'format')).toBe('input_missing');
  });
});

describe('LCP and layout shift', () => {
  /**
   * A PerformanceObserver stand-in serving buffered entries per type through
   * `takeRecords()` — the synchronous path the capture drains.
   */
  function installObserver(buffered: Record<string, PerformanceEntry[]>) {
    class FakeObserver {
      static supportedEntryTypes = Object.keys(buffered);
      private type = '';
      constructor(_cb: unknown) {}
      observe(opts: { type: string }) {
        this.type = opts.type;
      }
      takeRecords() {
        const out = buffered[this.type] ?? [];
        buffered[this.type] = [];
        return out;
      }
      disconnect() {}
    }
    vi.stubGlobal('PerformanceObserver', FakeObserver);
  }

  it('without the entry types, both are capability_unavailable_in_build', () => {
    installObserver({});
    const obs = captureMediaMetadata(makeImage({ alt: 'a', src: '/a.png', natural: [1, 1] }));
    expect(unmeasuredMediaDimension(obs, 'isLcpCandidate')).toBe('capability_unavailable_in_build');
    expect(unmeasuredMediaDimension(obs, 'clsSources')).toBe('capability_unavailable_in_build');
  });

  it('names the LCP element and the shifts that moved it', () => {
    const hero = makeImage({ alt: 'hero', src: '/hero.png', natural: [10, 10] });
    const other = makeImage({ alt: 'other', src: '/other.png', natural: [10, 10] });
    installObserver({
      'largest-contentful-paint': [{ element: hero, startTime: 900 } as unknown as PerformanceEntry],
      'layout-shift': [
        {
          value: 0.12,
          startTime: 1200,
          hadRecentInput: false,
          sources: [
            {
              node: hero,
              previousRect: { x: 0, y: 0, width: 100, height: 100 },
              currentRect: { x: 0, y: 80, width: 100, height: 100 },
            },
          ],
        } as unknown as PerformanceEntry,
      ],
    });

    const heroFacts = measured(captureMediaMetadata(hero));
    expect(heroFacts.isLcpCandidate).toBe(true);
    expect(heroFacts.clsSources).toEqual([
      {
        value: 0.12,
        startTime: 1200,
        hadRecentInput: false,
        previousRect: { x: 0, y: 0, width: 100, height: 100 },
        currentRect: { x: 0, y: 80, width: 100, height: 100 },
      },
    ]);

    const otherFacts = measured(captureMediaMetadata(other));
    expect(otherFacts.isLcpCandidate).toBe(false);
    // Measured, and nothing named it: an empty list, not an absence.
    expect(otherFacts.clsSources).toEqual([]);
  });

  it('no LCP entry yet is input_missing — which element it is cannot be known', () => {
    installObserver({ 'largest-contentful-paint': [], 'layout-shift': [] });
    const obs = captureMediaMetadata(makeImage({ alt: 'a', src: '/a.png', natural: [1, 1] }));
    expect(unmeasuredMediaDimension(obs, 'isLcpCandidate')).toBe('input_missing');
  });
});

describe('background images', () => {
  it('capture the url, and leave the intrinsic size unmeasured rather than guess it', () => {
    const div = document.createElement('div');
    div.style.backgroundImage = 'url("/bg/sunrise.jpg")';
    stubBox(div, 300, 200);
    document.body.appendChild(div);

    const obs = captureBackgroundImageMetadata(div)!;
    const facts = measured(obs);
    expect(facts.mediaType).toBe('background-image');
    expect(facts.src).toContain('/bg/sunrise.jpg');
    expect(facts.isDecorative).toBe(true);
    expect(facts.format).toBe('jpeg');
    expect(unmeasuredMediaDimension(obs, 'naturalWidth')).toBe('input_missing');
    expect(unmeasuredMediaDimension(obs, 'effectiveResolution')).toBe('input_missing');
  });

  it('an element with no url() background is not a background image', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(captureBackgroundImageMetadata(div)).toBeNull();
  });
});
