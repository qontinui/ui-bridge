/**
 * In-situ asset override (plan 2026-10-13-image-generation-and-visual-judgment,
 * Phase 18 step 1): apply, confirm, restore EXACTLY.
 *
 * jsdom loads no images, so a tiny browser model stands in for the two things
 * the override reads back: `decode()` resolves (or rejects) and sets
 * `currentSrc` to the candidate the browser would pick — the first `<source>`
 * srcset URL inside a `<picture>`, else the first `<img srcset>` URL, else
 * `src`. `currentSrc` changes ONLY when a decode settles, as a real image's
 * current request changes only once its load completes, so a restore that
 * does not wait for the original to load reads the candidate still current.
 * An `<img loading="lazy">` models an OFFSCREEN lazy image: it never loads,
 * so its decode never settles. Everything else — what is written, what is
 * restored, what the DOM reads back — is the real DOM.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyMediaOverride,
  cssUrl,
  listMediaOverrides,
  parseSrcsetUrls,
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

type DecodeBehaviour = 'pick' | 'reject' | 'hang' | 'deferred' | { stuckOn: string };
let decodeBehaviour: DecodeBehaviour = 'pick';
/** Decodes held by the 'deferred' behaviour; each call settles one. */
let pendingDecodes: Array<() => void> = [];
const CURRENT = Symbol('currentSrc');

function firstUrl(srcset: string | null): string | null {
  return parseSrcsetUrls(srcset ?? '')[0] ?? null;
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
    if ((this.getAttribute('loading') ?? '').toLowerCase() === 'lazy') {
      return new Promise<void>(() => {});
    }
    if (b === 'reject') return Promise.reject(new Error('EncodingError: broken image'));
    if (b === 'hang') return new Promise<void>(() => {});
    if (b === 'deferred') {
      return new Promise<void>((resolve) =>
        pendingDecodes.push(() => {
          this[CURRENT] = browserPick(this);
          resolve();
        })
      );
    }
    this[CURRENT] = typeof b === 'object' ? b.stuckOn : browserPick(this);
    return Promise.resolve();
  };
  pendingDecodes = [];
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

async function restoreAll(): Promise<MediaOverrideRestoreSuccess> {
  const res = await restoreMediaOverrides({});
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

    const restored = await restoreAll();
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
    await restoreAll();
    expect(document.body.innerHTML).toBe(before);
  });

  it('an attribute that was ABSENT is removed on restore, never written as ""', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/a.png">');
    const before = document.body.innerHTML;
    await apply({ slotId: 's', srcset: '/c-1x.png 1x, /c-2x.png 2x', sizes: '100vw' });
    expect(document.querySelector('img')!.getAttribute('srcset')).toBe(
      '/c-1x.png 1x, /c-2x.png 2x'
    );
    await restoreAll();
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
    await restoreAll();
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
    await restoreAll();
    expect(document.body.innerHTML).toBe(before);
  });

  it('overrides a CSS background-image and restores the style attribute exactly', async () => {
    mount(
      '<div data-ui-bridge-image-slot="bg" style="color: red; background-image: url(/o.png)"></div>'
    );
    const before = document.body.innerHTML;
    const res = await apply({ slotId: 'bg', backgroundImage: '/c.png' });
    const div = document.querySelector('div')!;
    expect(div.style.getPropertyValue('background-image')).toBe('url("/c.png")');
    expect(div.style.getPropertyPriority('background-image')).toBe('important');
    expect(div.style.getPropertyValue('color')).toBe('red');
    expect(res.mode).toBe('background');
    expect(res.originals).toEqual({ 'style.background-image': 'url("/o.png")' });
    await restoreAll();
    expect(document.body.innerHTML).toBe(before);
  });

  it('a background override on an element with NO style attribute leaves none behind', async () => {
    mount('<section data-ui-bridge-image-slot="bg"></section>');
    const before = document.body.innerHTML;
    await apply({ slotId: 'bg', backgroundImage: '/c.png' });
    await restoreAll();
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
    await restoreAll();
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
    await restoreAll();
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

  it('reports the candidate in pixels from the slot element itself, not its density-scaled size', async () => {
    // Real Chromium keeps the slot's previous srcset density after a src-only
    // swap (the wrapper's real-browser smoke pins it), so the slot's
    // naturalWidth reads half its pixels. createImageBitmap(slot) reads the
    // element's own decoded image at full size — and fetches nothing.
    const saved = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
      configurable: true,
      get: () => 160,
    });
    const bitmaps: unknown[] = [];
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async (source: unknown) => {
        bitmaps.push(source);
        return { width: 320, height: 180, close };
      })
    );
    try {
      mount(
        '<img data-ui-bridge-image-slot="s" src="/o.png" srcset="/o.png 2048w" sizes="1024px">'
      );
      const res = await apply({ slotId: 's', src: '/c.png' });
      expect(res.ready).toMatchObject({ naturalWidth: 320, naturalHeight: 180 });
      expect(bitmaps).toEqual([document.querySelector('img')]);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      if (saved) Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', saved);
      else delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).naturalWidth;
    }
  });

  it('an engine with no createImageBitmap reports the size unmeasured (null), never 0', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    const res = await apply({ slotId: 's', src: '/c.png' });
    expect(res.ready).toMatchObject({ naturalWidth: null, naturalHeight: null });
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
    await vi.advanceTimersByTimeAsync(1001);
    expect(document.body.innerHTML).toBe(before);
    const list = listMediaOverrides();
    expect(list.active).toEqual([]);
    expect(list.recentlyExpired).toEqual([
      expect.objectContaining({ overrideId: res.overrideId, trigger: 'ttl', verified: true }),
    ]);
    const late = (await restoreMediaOverrides({
      overrideId: res.overrideId,
    })) as MediaOverrideFailure;
    expect(late.code).toBe('NOT_FOUND');
    expect(late.error).toContain('expired');
  });

  it('never clobbers an attribute the app rewrote after the override; reports it as drift', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    await apply({ slotId: 's', src: '/c.png' });
    const img = document.querySelector('img')!;
    img.setAttribute('src', '/app-newer.png');
    const res = await restoreAll();
    expect(res.restored[0]!.drift).toContain('img.src');
    expect(img.getAttribute('src')).toBe('/app-newer.png');
    // The page is the app's now, not the original: never a verified restore.
    expect(res.restored[0]).toMatchObject({ status: 'restored_with_drift', verified: false });
  });

  it('a target that left the DOM is reported detached, never verified', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    await apply({ slotId: 's', src: '/c.png' });
    document.body.innerHTML = '';
    const res = await restoreAll();
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
    await restoreAll();
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

// ---------------------------------------------------------------------------
// The restore proof is about what the browser RENDERS (review r2, HIGH/MED)
// ---------------------------------------------------------------------------

describe('restore verification reads the rendered state', () => {
  it('a restore whose <img> still renders the candidate is NOT verified', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    await apply({ slotId: 's', src: '/c.png' });
    // The attributes go back, but the browser keeps showing the candidate.
    decodeBehaviour = { stuckOn: abs('/c.png') };
    const res = await restoreAll();
    expect(document.querySelector('img')!.getAttribute('src')).toBe('/o.png');
    expect(res.restored[0]).toMatchObject({ status: 'restored', verified: false });
    expect(res.restored[0]!.mismatches).toEqual([
      { key: 'rendered.currentSrc', expected: '', actual: abs('/c.png') },
    ]);
  });

  it('waits for the original to load before judging currentSrc', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    await apply({ slotId: 's', src: '/c.png' });
    decodeBehaviour = 'deferred';
    const pending = restoreMediaOverrides({});
    // The DOM is restored at once; the verdict waits for the load.
    expect(document.querySelector('img')!.getAttribute('src')).toBe('/o.png');
    await vi.waitFor(() => expect(pendingDecodes).toHaveLength(1));
    pendingDecodes.shift()!();
    const res = (await pending) as MediaOverrideRestoreSuccess;
    expect(res.restored[0]).toMatchObject({ status: 'restored', verified: true, mismatches: [] });
  });

  it('a background restore whose computed style still shows the candidate is NOT verified', async () => {
    mount('<div data-ui-bridge-image-slot="bg" style="background-image: url(/o.png)"></div>');
    await apply({ slotId: 'bg', backgroundImage: '/c.png' });
    const real = window.getComputedStyle.bind(window);
    const spy = vi
      .spyOn(window, 'getComputedStyle')
      .mockImplementation(
        (el: Element) =>
          ({ ...real(el), backgroundImage: `url("${abs('/c.png')}")` }) as CSSStyleDeclaration
      );
    try {
      const res = await restoreAll();
      expect(res.restored[0]).toMatchObject({ status: 'restored', verified: false });
      expect(res.restored[0]!.mismatches.map((m) => m.key)).toEqual(['rendered.background-image']);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('background arm owns only its own declaration', () => {
  it('keeps an inline style the app wrote while the override was up', async () => {
    mount(
      '<div data-ui-bridge-image-slot="bg" style="color: red; background-image: url(/o.png)"></div>'
    );
    await apply({ slotId: 'bg', backgroundImage: '/c.png' });
    const div = document.querySelector('div')!;
    div.style.setProperty('opacity', '0.5');
    div.style.setProperty('color', 'blue');
    const res = await restoreAll();
    expect(res.restored[0]).toMatchObject({ status: 'restored', verified: true, drift: [] });
    expect(div.style.getPropertyValue('opacity')).toBe('0.5');
    expect(div.style.getPropertyValue('color')).toBe('blue');
    expect(div.style.getPropertyValue('background-image')).toBe('url("/o.png")');
    expect(div.style.getPropertyPriority('background-image')).toBe('');
  });

  it('an element that had no style attribute keeps only what the app added', async () => {
    mount('<div data-ui-bridge-image-slot="bg"></div>');
    await apply({ slotId: 'bg', backgroundImage: '/c.png' });
    const div = document.querySelector('div')!;
    div.style.setProperty('opacity', '0.5');
    await restoreAll();
    expect(div.getAttribute('style')).toBe('opacity: 0.5;');
  });

  it('a background-image the app rewrote is drift, left as the app set it', async () => {
    mount('<div data-ui-bridge-image-slot="bg" style="background-image: url(/o.png)"></div>');
    await apply({ slotId: 'bg', backgroundImage: '/c.png' });
    const div = document.querySelector('div')!;
    div.style.setProperty('background-image', 'url("/app.png")');
    const res = await restoreAll();
    expect(res.restored[0]).toMatchObject({
      status: 'restored_with_drift',
      verified: false,
      drift: ['style.background-image'],
    });
    expect(div.style.getPropertyValue('background-image')).toBe('url("/app.png")');
  });
});

describe('one record per element written to', () => {
  it('a <picture> slot and its <img> by elementId are ONE override, restored to the page original', async () => {
    mount(
      '<picture data-ui-bridge-image-slot="p"><source type="image/webp" srcset="/o.webp">' +
        '<img id="pi" src="/o.png"></picture>'
    );
    const before = document.body.innerHTML;
    const img = document.getElementById('pi')!;
    const first = await apply({ slotId: 'p', src: '/c1.png' });
    const second = await applyMediaOverride({ elementId: 'pic-img', src: '/c2.png' }, (id) =>
      id === 'pic-img' ? img : undefined
    );
    expect(second).toMatchObject({ success: true, overrideId: first.overrideId, replaced: true });
    expect((second as MediaOverrideSuccess).originals['img.src']).toBe('/o.png');
    expect(listMediaOverrides().active).toHaveLength(1);
    const res = await restoreAll();
    expect(res.restored).toHaveLength(1);
    expect(res.restored[0]!.verified).toBe(true);
    expect(document.body.innerHTML).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Lazy offscreen slots (review r2)
// ---------------------------------------------------------------------------

describe('a loading="lazy" slot', () => {
  it('is loaded eagerly for the override, and gets its lazy attribute back on restore', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png" loading="lazy">');
    const before = document.body.innerHTML;
    const res = await apply({ slotId: 's', src: '/c.png', decodeTimeoutMs: 50 });
    const img = document.querySelector('img')!;
    expect(img.getAttribute('loading')).toBe('eager');
    expect(res.ready.currentSrc).toBe(abs('/c.png'));
    expect(res.originals['img.loading']).toBe('lazy');
    const restored = await restoreAll();
    // `lazy` goes back only AFTER the original rendered, or its load would be
    // deferred and currentSrc would stay on the candidate.
    expect(restored.restored[0]).toMatchObject({ status: 'restored', verified: true });
    expect(document.body.innerHTML).toBe(before);
  });

  it('a slot that is not lazy gets no loading attribute written', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    const res = await apply({ slotId: 's', src: '/c.png' });
    expect(Object.keys(res.applied)).not.toContain('img.loading');
    expect(document.querySelector('img')!.hasAttribute('loading')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// URLs: CSS escaping, the srcset grammar, the scheme allowlist (review r2)
// ---------------------------------------------------------------------------

describe('cssUrl', () => {
  it('hex-escapes every control character and every unsafe character', () => {
    expect(cssUrl('/a.png')).toBe('url("/a.png")');
    expect(cssUrl('/a\f.png')).toBe('url("/a\\c .png")');
    expect(cssUrl('/a\n\r\t\v\0\x7f.png')).toBe('url("/a\\a \\d \\9 \\b \\0 \\7f .png")');
    expect(cssUrl('/x") ; color: blue; ("')).toBe(
      'url("/x\\22 \\29 \\20 \\3b \\20 color:\\20 blue\\3b \\20 \\28 \\22 ")'
    );
    expect(cssUrl('/\\é.png')).toBe('url("/\\5c \\e9 .png")');
    expect(cssUrl('data:image/png;base64,AA==')).toBe('url("data:image/png\\3b base64,AA==")');
  });

  it('no candidate URL can break out of the background-image declaration', async () => {
    // jsdom's CSSOM does not parse an escaped url() faithfully (it keeps the
    // old value, so the apply answers CURRENT_SRC_MISMATCH and rolls back
    // whatever cssUrl did). So this test reads what the override WRITES: every
    // setProperty call it makes on the slot's inline style, captured before the
    // currentSrc check and independent of whether the apply succeeds.
    mount('<div data-ui-bridge-image-slot="bg" style="background-image: url(/o.png)"></div>');
    const before = document.body.innerHTML;
    const div = document.querySelector('div')!;
    const candidate = '/x\f"); color: blue; z-index: 9; ("';
    const writes: Array<{ property: string; value: string; priority: string }> = [];
    // Recorded and passed through, so jsdom still sees every write.
    const proto = Object.getPrototypeOf(div.style) as CSSStyleDeclaration;
    const realSetProperty = proto.setProperty;
    const setProperty = vi.spyOn(proto, 'setProperty').mockImplementation(function (
      this: CSSStyleDeclaration,
      property: string,
      value: string | null,
      priority?: string
    ) {
      if (this === div.style)
        writes.push({ property, value: value ?? '', priority: priority ?? '' });
      return realSetProperty.call(this, property, value, priority);
    });
    try {
      await applyMediaOverride({ slotId: 'bg', backgroundImage: candidate }, noElement);
    } finally {
      setProperty.mockRestore();
    }

    // The override writes ONE property, background-image, and nothing else.
    expect(writes.length).toBeGreaterThan(0);
    expect(new Set(writes.map((w) => w.property))).toEqual(new Set(['background-image']));
    // The apply's own write is the !important one (a rollback writes the
    // original back without it).
    const important = writes.filter((w) => w.priority === 'important');
    expect(important).toHaveLength(1);
    const applied = important[0]!;
    // The written value is one quoted url() token: no raw quote, backslash
    // other than a hex escape, parenthesis, semicolon, whitespace or control
    // character inside it, so it cannot end the string or the declaration.
    expect(applied.value).toMatch(
      /^url\("(?:[A-Za-z0-9\-._~:/?#[\]@!$&*+,=%]|\\[0-9a-f]{1,6} )*"\)$/
    );
    // ...and it still carries the candidate, byte for byte, once unescaped.
    const unescaped = applied.value
      .slice('url("'.length, -'")'.length)
      .replace(/\\([0-9a-f]{1,6}) /g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
    expect(unescaped).toBe(candidate);

    // Whatever jsdom made of it, nothing leaked into the element's style.
    expect(div.style.getPropertyValue('color')).toBe('');
    expect(div.style.getPropertyValue('z-index')).toBe('');
    // eslint-disable-next-line no-control-regex
    expect(div.getAttribute('style')).not.toMatch(/[\x00-\x1f]/);
    await restoreMediaOverrides({});
    expect(document.body.innerHTML).toBe(before);
  });
});

describe('parseSrcsetUrls (the HTML srcset grammar)', () => {
  it.each([
    ['/a.png 1x, /b.png 2x', ['/a.png', '/b.png']],
    ['/a.png 1x,/b.png 2x', ['/a.png', '/b.png']],
    ['/a.png 100w,/b.png 200w,/c.png 300w', ['/a.png', '/b.png', '/c.png']],
    ['/a.png,, /b.png', ['/a.png', '/b.png']],
    ['  /a.png  ', ['/a.png']],
    ['data:image/png;base64,AA== 1x, /b.png 2x', ['data:image/png;base64,AA==', '/b.png']],
    ['/a.png (x, y) 1x, /b.png', ['/a.png', '/b.png']],
    ['', []],
  ])('%j', (srcset, urls) => {
    expect(parseSrcsetUrls(srcset)).toEqual(urls);
  });

  it('a candidate after a comma with no space is accepted as the rendered one', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    decodeBehaviour = { stuckOn: abs('/c-2x.png') };
    const res = await applyMediaOverride(
      { slotId: 's', srcset: '/c-1x.png 1x,/c-2x.png 2x' },
      noElement
    );
    expect(res).toMatchObject({ success: true, ready: { currentSrc: abs('/c-2x.png') } });
  });
});

describe('candidate URL schemes', () => {
  it.each([
    [{ src: 'javascript:alert(1)' }],
    [{ src: 'file:///etc/passwd' }],
    [{ src: 'data:text/html,<script>1</script>' }],
    [{ srcset: '/ok.png 1x, ftp://h/x.png 2x' }],
    [{ src: '/ok.png', sources: [{ srcset: 'chrome://settings/x.png' }] }],
    [{ backgroundImage: 'JavaScript:alert(1)' }],
  ])('refuses %j, typed, before touching the page', async (fields) => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    const before = document.body.innerHTML;
    const res = (await applyMediaOverride(
      { slotId: 's', ...fields },
      noElement
    )) as MediaOverrideFailure;
    expect(res).toMatchObject({ success: false, code: 'UNSUPPORTED_URL_SCHEME' });
    expect(document.body.innerHTML).toBe(before);
  });

  it.each([
    'https://cdn.example/c.png',
    'http://127.0.0.1:8080/c.png',
    'blob:https://app.example/1b2c',
    'data:image/png;base64,iVBORw0KGgo=',
    '/c.png',
    '//cdn.example/c.png',
  ])('accepts %s', async (src) => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    const res = await applyMediaOverride({ slotId: 's', src }, noElement);
    expect(res).toMatchObject({ success: true });
  });
});

// ---------------------------------------------------------------------------
// A restore that lands while an apply still awaits its decode (review r2)
// ---------------------------------------------------------------------------

describe('a concurrent restore or override during an apply', () => {
  it('a DELETE while the apply awaits its decode makes the apply report OVERRIDE_CANCELLED', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    const before = document.body.innerHTML;
    decodeBehaviour = 'deferred';
    const applying = applyMediaOverride({ slotId: 's', src: '/c.png' }, noElement);
    await vi.waitFor(() => expect(pendingDecodes).toHaveLength(1));
    decodeBehaviour = 'pick';
    const restore = (await restoreMediaOverrides({})) as MediaOverrideRestoreSuccess;
    expect(restore.restored).toHaveLength(1);
    pendingDecodes.shift()!();
    const res = (await applying) as MediaOverrideFailure;
    expect(res).toMatchObject({ success: false, code: 'OVERRIDE_CANCELLED' });
    expect(res.error).toContain('trigger: request');
    expect(document.body.innerHTML).toBe(before);
    expect(listMediaOverrides().active).toEqual([]);
  });

  it('a later override on the same slot supersedes an awaiting one, which neither succeeds nor rolls it back', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    decodeBehaviour = 'deferred';
    const first = applyMediaOverride({ slotId: 's', src: '/c1.png' }, noElement);
    await vi.waitFor(() => expect(pendingDecodes).toHaveLength(1));
    const second = applyMediaOverride({ slotId: 's', src: '/c2.png' }, noElement);
    await vi.waitFor(() => expect(pendingDecodes).toHaveLength(2));
    pendingDecodes.shift()!();
    pendingDecodes.shift()!();
    expect(await first).toMatchObject({ success: false, code: 'OVERRIDE_CANCELLED' });
    expect(await second).toMatchObject({ success: true, ready: { currentSrc: abs('/c2.png') } });
    expect(document.querySelector('img')!.getAttribute('src')).toBe('/c2.png');
    expect(listMediaOverrides().active).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Review r3: the scheme the URL PARSER resolves, the restore's own bound, and
// the TTL during an apply
// ---------------------------------------------------------------------------

describe('candidate URL schemes are judged as the URL parser resolves them', () => {
  it.each([
    ['tab inside the scheme', 'java\tscript:alert(1)'],
    ['newline inside the scheme', 'java\nscript:alert(1)'],
    ['carriage return inside the scheme', 'javas\rcript:alert(1)'],
    ['leading C0 control', '\x01javascript:alert(1)'],
    ['leading NUL and space', '\x00 javascript:alert(1)'],
    ['tab inside a data: media type', 'data:text/\thtml,<b>x</b>'],
    ['tab inside an unlisted scheme', 'fi\tle:///etc/passwd'],
    [
      'an image media type that is not the data: URL’s own',
      'data:text/html;x=data:image/png,<b>x</b>',
    ],
  ])('refuses %s', async (_label, src) => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    const before = document.body.innerHTML;
    for (const body of [{ src }, { backgroundImage: src }]) {
      const res = (await applyMediaOverride(
        { slotId: 's', ...body },
        noElement
      )) as MediaOverrideFailure;
      expect(res).toMatchObject({ success: false, code: 'UNSUPPORTED_URL_SCHEME' });
    }
    expect(document.body.innerHTML).toBe(before);
  });

  it.each(['c.png', './c.png', '?v=2', '#frag', 'data:image/png;\tbase64,iVBORw0KGgo='])(
    'still accepts %j',
    async (src) => {
      mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
      const res = await applyMediaOverride({ slotId: 's', src }, noElement);
      expect(res).toMatchObject({ success: true });
    }
  );
});

describe('the restore wait is bounded by verifyTimeoutMs', () => {
  it('a restore that cannot see the original load answers, unverified, within verifyTimeoutMs', async () => {
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    await apply({ slotId: 's', src: '/c.png', decodeTimeoutMs: 60_000 });
    decodeBehaviour = 'hang';
    vi.useFakeTimers();
    let settled: MediaOverrideRestoreSuccess | null = null;
    void restoreMediaOverrides({ verifyTimeoutMs: 500 }).then(
      (r) => (settled = r as MediaOverrideRestoreSuccess)
    );
    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    expect(settled).not.toBeNull();
    expect(settled!.restored[0]).toMatchObject({ status: 'restored', verified: false });
    expect(document.querySelector('img')!.getAttribute('src')).toBe('/o.png');
  });

  it('refuses a verifyTimeoutMs out of range', async () => {
    const res = (await restoreMediaOverrides({ verifyTimeoutMs: -1 })) as MediaOverrideFailure;
    expect(res).toMatchObject({ success: false, code: 'INVALID_REQUEST' });
  });
});

describe('the TTL while an apply awaits its decode', () => {
  it('an abandoned apply whose decode hangs still ends with the page restored, at its bound, not the TTL', async () => {
    vi.useFakeTimers();
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    const before = document.body.innerHTML;
    decodeBehaviour = 'hang';
    // The caller fires the apply and dies: nobody awaits it.
    void applyMediaOverride(
      { slotId: 's', src: '/c.png', ttlMs: 1_000, decodeTimeoutMs: 5_000 },
      noElement
    );
    await vi.advanceTimersByTimeAsync(4_000);
    // The TTL is not allowed to cut the decode wait short.
    expect(document.querySelector('img')!.getAttribute('src')).toBe('/c.png');
    expect(listMediaOverrides().active).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(document.body.innerHTML).toBe(before);
    expect(listMediaOverrides().active).toEqual([]);
  });

  it('a re-override is not cancelled by the record’s earlier TTL lapsing mid-decode', async () => {
    vi.useFakeTimers();
    mount('<img data-ui-bridge-image-slot="s" src="/o.png">');
    const first = await apply({ slotId: 's', src: '/c1.png', ttlMs: 1_000 });
    await vi.advanceTimersByTimeAsync(900);
    decodeBehaviour = 'deferred';
    const second = applyMediaOverride({ slotId: 's', src: '/c2.png', ttlMs: 1_000 }, noElement);
    await vi.waitFor(() => expect(pendingDecodes).toHaveLength(1));
    // Past the first apply's TTL (armed at t=0 for 1 s).
    await vi.advanceTimersByTimeAsync(600);
    pendingDecodes.shift()!();
    expect(await second).toMatchObject({
      success: true,
      overrideId: first.overrideId,
      replaced: true,
      ready: { currentSrc: abs('/c2.png') },
    });
    expect(document.querySelector('img')!.getAttribute('src')).toBe('/c2.png');
    // ...and its own TTL still restores the page afterwards.
    decodeBehaviour = 'pick';
    await vi.advanceTimersByTimeAsync(1_001);
    expect(document.querySelector('img')!.getAttribute('src')).toBe('/o.png');
    expect(listMediaOverrides().recentlyExpired).toEqual([
      expect.objectContaining({ overrideId: first.overrideId, trigger: 'ttl' }),
    ]);
  });
});
