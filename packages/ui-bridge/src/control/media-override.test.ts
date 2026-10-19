/**
 * In-situ asset override (plan 2026-10-13-image-generation-and-visual-judgment,
 * Phase 18 step 1): apply, confirm, restore EXACTLY.
 *
 * jsdom loads no images, so a tiny browser model stands in for the two things
 * the override reads back: `decode()` resolves (or rejects) and sets
 * `currentSrc` to the candidate the browser would pick — the first `<source>`
 * srcset URL inside a `<picture>`, else the first `<img srcset>` URL, else
 * `src`. Everything else — what is written, what is restored, what the DOM
 * reads back — is the real DOM.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyMediaOverride,
  listMediaOverrides,
  resetMediaOverridesForTest,
  restoreMediaOverrides,
  validateMediaOverrideRequest,
  type MediaOverrideFailure,
  type MediaOverrideRestoreSuccess,
  type MediaOverrideSuccess,
} from './media-override';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import { enableDevControls, resetDevControlsForTest } from '../core/dev-controls';
import { createHandlers } from '../server/handlers';
import { UIBridgeRegistry } from '../core/registry';
import { createActionExecutor } from './action-executor';

// ---------------------------------------------------------------------------
// A minimal browser model for decode()/currentSrc
// ---------------------------------------------------------------------------

type DecodeBehaviour = 'pick' | 'reject' | 'hang' | { stuckOn: string };
let decodeBehaviour: DecodeBehaviour = 'pick';
const CURRENT = Symbol('currentSrc');

function firstUrl(srcset: string | null): string | null {
  if (!srcset) return null;
  const first = srcset.split(/,\s+/)[0]?.trim().split(/\s+/)[0];
  return first ?? null;
}

function browserPick(img: HTMLImageElement): string {
  const parent = img.parentElement;
  if (parent && parent.tagName === 'PICTURE') {
    const source = parent.querySelector(':scope > source');
    const fromSource = firstUrl(source?.getAttribute('srcset') ?? null);
    if (fromSource) return new URL(fromSource, document.baseURI).href;
  }
  const fromSrcset = firstUrl(img.getAttribute('srcset'));
  if (fromSrcset) return new URL(fromSrcset, document.baseURI).href;
  const src = img.getAttribute('src');
  return src ? new URL(src, document.baseURI).href : '';
}

const originalDescriptor = Object.getOwnPropertyDescriptor(
  HTMLImageElement.prototype,
  'currentSrc'
);
const originalDecode = (HTMLImageElement.prototype as { decode?: unknown }).decode;

beforeEach(() => {
  decodeBehaviour = 'pick';
  Object.defineProperty(HTMLImageElement.prototype, 'currentSrc', {
    configurable: true,
    get(this: HTMLImageElement & { [CURRENT]?: string }) {
      return this[CURRENT] ?? '';
    },
  });
  (HTMLImageElement.prototype as { decode: () => Promise<void> }).decode = function (
    this: HTMLImageElement & { [CURRENT]?: string }
  ) {
    const b = decodeBehaviour;
    if (b === 'reject') return Promise.reject(new Error('EncodingError: broken image'));
    if (b === 'hang') return new Promise<void>(() => {});
    this[CURRENT] = typeof b === 'object' ? b.stuckOn : browserPick(this);
    return Promise.resolve();
  };
  resetMediaOverridesForTest();
  resetDevControlsForTest();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  resetMediaOverridesForTest();
  resetDevControlsForTest();
  if (originalDescriptor) {
    Object.defineProperty(HTMLImageElement.prototype, 'currentSrc', originalDescriptor);
  } else {
    delete (HTMLImageElement.prototype as { currentSrc?: unknown }).currentSrc;
  }
  (HTMLImageElement.prototype as { decode?: unknown }).decode = originalDecode;
});

const noElement = (): undefined => undefined;

function mount(html: string): void {
  document.body.innerHTML = html;
}

async function apply(req: Record<string, unknown>): Promise<MediaOverrideSuccess> {
  const res = await applyMediaOverride(req, noElement);
  if (!res.success) throw new Error(`override failed: ${res.code} ${res.error}`);
  return res;
}

function restoreAll(): MediaOverrideRestoreSuccess {
  const res = restoreMediaOverrides({});
  if (!res.success) throw new Error(`restore failed: ${res.code}`);
  return res;
}

const abs = (u: string): string => new URL(u, document.baseURI).href;

// ---------------------------------------------------------------------------
// The core property: override, then restore EXACTLY
// ---------------------------------------------------------------------------

describe('override and exact restore', () => {
  it('swaps an <img src>, confirms it decoded, and restores the DOM byte for byte', async () => {
    mount('<img data-ui-bridge-image-slot="hero" src="/orig.png" alt="hero" class="h">');
    const before = document.body.innerHTML;

    const res = await apply({ slotId: 'hero', src: '/candidate.png' });
    const img = document.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/candidate.png');
    expect(res.ready.currentSrc).toBe(abs('/candidate.png'));
    expect(res.originals['img.src']).toBe('/orig.png');
    expect(res.mode).toBe('image');
    expect(res.target).toMatchObject({ slotId: 'hero', tag: 'img', inPicture: false });
    expect(document.body.innerHTML).not.toBe(before);

    const restored = restoreAll();
    expect(restored.restored).toHaveLength(1);
    expect(restored.restored[0]).toMatchObject({ status: 'restored', verified: true, drift: [] });
    expect(restored.remaining).toBe(0);
    expect(document.body.innerHTML).toBe(before);
    expect(listMediaOverrides().active).toEqual([]);
  });

  it('src alone clears srcset/sizes (or the browser keeps choosing from them), and restores both', async () => {
    mount(
      '<img data-ui-bridge-image-slot="s" src="/a.png" srcset="/a-1x.png 1x, /a-2x.png 2x" sizes="50vw">'
    );
    const before = document.body.innerHTML;
    const res = await apply({ slotId: 's', src: '/c.png' });
    const img = document.querySelector('img')!;
    expect(img.hasAttribute('srcset')).toBe(false);
    expect(img.hasAttribute('sizes')).toBe(false);
    expect(res.ready.currentSrc).toBe(abs('/c.png'));
    restoreAll();
    expect(document.body.innerHTML).toBe(before);
  });

  it('an attribute that was ABSENT is removed on restore, never written as ""', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/a.png">');
    const before = document.body.innerHTML;
    await apply({ slotId: 's', srcset: '/c-1x.png 1x, /c-2x.png 2x', sizes: '100vw' });
    expect(document.querySelector('img')!.getAttribute('srcset')).toBe(
      '/c-1x.png 1x, /c-2x.png 2x'
    );
    restoreAll();
    const img = document.querySelector('img')!;
    expect(img.hasAttribute('srcset')).toBe(false);
    expect(img.hasAttribute('sizes')).toBe(false);
    expect(document.body.innerHTML).toBe(before);
  });

  it('overrides EVERY <source srcset> of a <picture>, so the original source cannot win', async () => {
    mount(
      '<picture data-ui-bridge-image-slot="p">' +
        '<source type="image/avif" srcset="/o.avif">' +
        '<source type="image/webp" srcset="/o.webp">' +
        '<img src="/o.png" alt="">' +
        '</picture>'
    );
    const before = document.body.innerHTML;
    const res = await apply({ slotId: 'p', src: '/c.png' });
    const sources = document.querySelectorAll('source');
    expect(sources[0]!.getAttribute('srcset')).toBe('/c.png');
    expect(sources[1]!.getAttribute('srcset')).toBe('/c.png');
    expect(res.target.inPicture).toBe(true);
    expect(res.ready.currentSrc).toBe(abs('/c.png'));
    restoreAll();
    expect(document.body.innerHTML).toBe(before);
  });

  it('matches per-type sources (the AVIF/WebP-plus-fallback shape) and falls back for the rest', async () => {
    mount(
      '<picture data-ui-bridge-image-slot="p">' +
        '<source type="image/avif" srcset="/o.avif">' +
        '<source type="image/webp" srcset="/o.webp">' +
        '<source type="image/jxl" srcset="/o.jxl">' +
        '<img src="/o.png">' +
        '</picture>'
    );
    const before = document.body.innerHTML;
    const res = await apply({
      slotId: 'p',
      src: '/c.png',
      sources: [
        { type: 'image/avif', srcset: '/c.avif' },
        { type: 'image/webp', srcset: '/c.webp' },
      ],
    });
    const s = document.querySelectorAll('source');
    expect(s[0]!.getAttribute('srcset')).toBe('/c.avif');
    expect(s[1]!.getAttribute('srcset')).toBe('/c.webp');
    expect(s[2]!.getAttribute('srcset')).toBe('/c.png');
    expect(res.ready.currentSrc).toBe(abs('/c.avif'));
    restoreAll();
    expect(document.body.innerHTML).toBe(before);
  });

  it('overrides a CSS background-image and restores the whole style attribute exactly', async () => {
    mount(
      '<div data-ui-bridge-image-slot="bg" style="color: red; background-image: url(/o.png)"></div>'
    );
    const before = document.body.innerHTML;
    const res = await apply({ slotId: 'bg', backgroundImage: '/c.png' });
    const div = document.querySelector('div')!;
    expect(div.style.getPropertyValue('background-image')).toContain('/c.png');
    expect(div.getAttribute('style')).toMatch(/background-image: url\("\/c\.png"\) !important;$/);
    expect(div.style.getPropertyValue('color')).toBe('red');
    expect(res.mode).toBe('background');
    restoreAll();
    expect(document.body.innerHTML).toBe(before);
  });

  it('a background override on an element with NO style attribute leaves none behind', async () => {
    mount('<section data-ui-bridge-image-slot="bg"></section>');
    const before = document.body.innerHTML;
    await apply({ slotId: 'bg', backgroundImage: '/c.png' });
    restoreAll();
    expect(document.querySelector('section')!.hasAttribute('style')).toBe(false);
    expect(document.body.innerHTML).toBe(before);
  });

  it('a chain of candidates on one slot restores to the PAGE original, not the previous candidate', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/orig.png">');
    const before = document.body.innerHTML;
    const first = await apply({ slotId: 's', src: '/c1.png' });
    const second = await apply({ slotId: 's', src: '/c2.png' });
    expect(second.overrideId).toBe(first.overrideId);
    expect(second.replaced).toBe(true);
    expect(second.originals['img.src']).toBe('/orig.png');
    expect(listMediaOverrides().active).toHaveLength(1);
    restoreAll();
    expect(document.body.innerHTML).toBe(before);
  });

  it('targets a registered element by elementId', async () => {
    mount('<img id="logo" src="/o.png">');
    const el = document.getElementById('logo')!;
    const res = await applyMediaOverride({ elementId: 'logo-el', src: '/c.png' }, (id) =>
      id === 'logo-el' ? el : undefined
    );
    expect(res.success).toBe(true);
    expect((res as MediaOverrideSuccess).target.elementId).toBe('logo-el');
    restoreAll();
    expect(el.getAttribute('src')).toBe('/o.png');
  });
});

// ---------------------------------------------------------------------------
// Never report ready before the browser shows the candidate
// ---------------------------------------------------------------------------

describe('decode and currentSrc confirmation', () => {
  it('a candidate the browser cannot decode is rolled back and answered DECODE_FAILED', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    const before = document.body.innerHTML;
    decodeBehaviour = 'reject';
    const res = (await applyMediaOverride(
      { slotId: 's', src: '/broken.png' },
      noElement
    )) as MediaOverrideFailure;
    expect(res.success).toBe(false);
    expect(res.code).toBe('DECODE_FAILED');
    expect(res.rolledBack).toMatchObject({
      status: 'restored',
      verified: true,
      trigger: 'rollback',
    });
    expect(document.body.innerHTML).toBe(before);
    expect(listMediaOverrides().active).toEqual([]);
  });

  it('a decode that never settles times out, typed, and is rolled back', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    const before = document.body.innerHTML;
    decodeBehaviour = 'hang';
    const res = (await applyMediaOverride(
      { slotId: 's', src: '/slow.png', decodeTimeoutMs: 20 },
      noElement
    )) as MediaOverrideFailure;
    expect(res.code).toBe('DECODE_TIMEOUT');
    expect(document.body.innerHTML).toBe(before);
  });

  it('decoded but showing something else (currentSrc is not a candidate) is CURRENT_SRC_MISMATCH', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    decodeBehaviour = { stuckOn: abs('/o.png') };
    const res = (await applyMediaOverride(
      { slotId: 's', src: '/c.png' },
      noElement
    )) as MediaOverrideFailure;
    expect(res.code).toBe('CURRENT_SRC_MISMATCH');
    expect(document.querySelector('img')!.getAttribute('src')).toBe('/o.png');
  });

  it('an engine with no decode() cannot confirm, so it answers capability_unavailable_in_build', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    (HTMLImageElement.prototype as { decode?: unknown }).decode = undefined;
    const res = (await applyMediaOverride(
      { slotId: 's', src: '/c.png' },
      noElement
    )) as MediaOverrideFailure;
    expect(res.code).toBe('capability_unavailable_in_build');
    expect(document.querySelector('img')!.getAttribute('src')).toBe('/o.png');
  });

  it('reports the candidate in pixels from a detached decode, not the slot’s density-scaled size', async () => {
    // Real Chromium keeps the slot's previous srcset density after a src-only
    // swap (the wrapper's real-browser smoke pins it). Model that: the slot
    // reads half its pixels, a detached decode reads all of them.
    const natural = (connected: number, detached: number) => ({
      configurable: true,
      get(this: HTMLImageElement) {
        return this.isConnected ? connected : detached;
      },
    });
    const proto = HTMLImageElement.prototype;
    const saved = (['naturalWidth', 'naturalHeight'] as const).map(
      (k) => [k, Object.getOwnPropertyDescriptor(proto, k)] as const
    );
    Object.defineProperty(proto, 'naturalWidth', natural(160, 320));
    Object.defineProperty(proto, 'naturalHeight', natural(90, 180));
    try {
      mount(
        '<img data-ui-bridge-image-slot="s" src="/o.png" srcset="/o.png 2048w" sizes="1024px">'
      );
      const res = await apply({ slotId: 's', src: '/c.png' });
      expect(res.ready).toMatchObject({ naturalWidth: 320, naturalHeight: 180 });
    } finally {
      for (const [k, d] of saved) {
        if (d) Object.defineProperty(proto, k, d);
        else delete (proto as unknown as Record<string, unknown>)[k];
      }
    }
  });
});

// ---------------------------------------------------------------------------
// A dead caller, and an app that moved on
// ---------------------------------------------------------------------------

describe('TTL and drift', () => {
  it('restores by itself when the TTL lapses, and says so', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    const before = document.body.innerHTML;
    const res = await apply({ slotId: 's', src: '/c.png', ttlMs: 1000 });
    vi.useFakeTimers();
    // The timer was armed before fake timers took over; re-arm under them.
    await apply({ slotId: 's', src: '/c.png', ttlMs: 1000 });
    vi.advanceTimersByTime(1001);
    expect(document.body.innerHTML).toBe(before);
    const list = listMediaOverrides();
    expect(list.active).toEqual([]);
    expect(list.recentlyExpired).toEqual([
      expect.objectContaining({ overrideId: res.overrideId, trigger: 'ttl', verified: true }),
    ]);
    const late = restoreMediaOverrides({ overrideId: res.overrideId }) as MediaOverrideFailure;
    expect(late.code).toBe('NOT_FOUND');
    expect(late.error).toContain('expired');
  });

  it('never clobbers an attribute the app rewrote after the override; reports it as drift', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    await apply({ slotId: 's', src: '/c.png' });
    const img = document.querySelector('img')!;
    img.setAttribute('src', '/app-newer.png');
    const res = restoreAll();
    expect(res.restored[0]!.drift).toContain('img.src');
    expect(img.getAttribute('src')).toBe('/app-newer.png');
  });

  it('a target that left the DOM is reported detached, never verified', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    await apply({ slotId: 's', src: '/c.png' });
    document.body.innerHTML = '';
    const res = restoreAll();
    expect(res.restored[0]).toMatchObject({ status: 'detached', verified: null });
  });
});

// ---------------------------------------------------------------------------
// Targets, validation, redaction
// ---------------------------------------------------------------------------

describe('targets and validation', () => {
  it('refuses a missing slot and an ambiguous one', async () => {
    mount(
      '<img data-ui-bridge-image-slot="d" src="/1.png"><img data-ui-bridge-image-slot="d" src="/2.png">'
    );
    expect(
      (
        (await applyMediaOverride(
          { slotId: 'x', src: '/c.png' },
          noElement
        )) as MediaOverrideFailure
      ).code
    ).toBe('TARGET_NOT_FOUND');
    expect(
      (
        (await applyMediaOverride(
          { slotId: 'd', src: '/c.png' },
          noElement
        )) as MediaOverrideFailure
      ).code
    ).toBe('AMBIGUOUS_TARGET');
  });

  it('refuses src on a container holding several images', async () => {
    mount('<div data-ui-bridge-image-slot="g"><img src="/1.png"><img src="/2.png"></div>');
    const res = (await applyMediaOverride(
      { slotId: 'g', src: '/c.png' },
      noElement
    )) as MediaOverrideFailure;
    expect(res.code).toBe('TARGET_NOT_AN_IMAGE');
  });

  it.each([
    [{}, 'exactly one of slotId or elementId'],
    [{ slotId: 'a', elementId: 'b', src: 'x' }, 'exactly one of slotId or elementId'],
    [{ slotId: 'a' }, 'one of src, srcset, sources or backgroundImage'],
    [{ slotId: 'a', src: 'x', backgroundImage: 'y' }, 'cannot be combined'],
    [{ slotId: 'a', src: 'x', sizes: '50vw' }, 'sizes needs srcset'],
    [{ slotId: 'a', sources: [{ srcset: 'x' }] }, 'also give src or srcset'],
    [{ slotId: 'a', src: 'x', ttlMs: 10 }, 'ttlMs must be an integer'],
    [{ slotId: 'a', src: '' }, 'src must be a non-empty string'],
  ])('rejects %j', (body, message) => {
    const res = validateMediaOverrideRequest(body);
    expect(typeof res).toBe('string');
    expect(res as string).toContain(message);
  });

  it('scrubs the ORIGINAL URLs of a target inside a data-bridge-redact boundary', async () => {
    mount(
      '<div data-bridge-redact="true"><img data-ui-bridge-image-slot="s" src="https://cdn/x.png?X-Amz-Signature=secret"></div>'
    );
    const res = await apply({ slotId: 's', src: '/c.png' });
    expect(JSON.stringify(res)).not.toContain('X-Amz-Signature');
    expect(res.originals['img.src']).toBe('[REDACTED]');
    expect(res.applied['img.src']).toBe('/c.png');
    restoreAll();
    expect(document.querySelector('img')!.getAttribute('src')).toContain('X-Amz-Signature=secret');
  });
});

// ---------------------------------------------------------------------------
// The dev-controls gate, on every transport
// ---------------------------------------------------------------------------

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

describe('dev-controls gate', () => {
  it('the dispatcher refuses every media-override command until the realm opts in', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    for (const action of ['mediaOverride', 'mediaOverrideRestore', 'mediaOverrideList']) {
      const res = (await executeCommand(action, { slotId: 's', src: '/c.png' }, emptyBridge)) as {
        success: boolean;
        code: string;
        reason: string;
      };
      expect(res).toMatchObject({
        success: false,
        code: 'capability_unavailable_in_build',
        reason: 'dev_controls_disabled',
      });
    }
    expect(document.querySelector('img')!.getAttribute('src')).toBe('/o.png');
  });

  it('once opted in, the dispatcher applies, lists and restores', async () => {
    enableDevControls('explicit');
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    const before = document.body.innerHTML;
    const applied = (await executeCommand(
      'mediaOverride',
      { slotId: 's', src: '/c.png' },
      emptyBridge
    )) as MediaOverrideSuccess;
    expect(applied.success).toBe(true);
    const listed = (await executeCommand('mediaOverrideList', {}, emptyBridge)) as {
      active: unknown[];
    };
    expect(listed.active).toHaveLength(1);
    const restored = (await executeCommand(
      'mediaOverrideRestore',
      { overrideId: applied.overrideId },
      emptyBridge
    )) as MediaOverrideRestoreSuccess;
    expect(restored.restored[0]!.verified).toBe(true);
    expect(document.body.innerHTML).toBe(before);
  });

  it('the Node-side direct handlers answer a typed capability statement, never a 2xx', async () => {
    const registry = new UIBridgeRegistry();
    const handlers = createHandlers(registry, createActionExecutor(registry));
    for (const res of [
      await handlers.mediaOverride({ slotId: 's', src: '/c.png' }),
      await handlers.mediaOverrideRestore({}),
      await handlers.mediaOverrideList(),
    ]) {
      expect(res.success).toBe(false);
      expect(res.code).toBe('UB-CAPABILITY-UNAVAILABLE');
      expect(res.data).toMatchObject({ code: 'capability_unavailable_in_build' });
    }
  });
});
