import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry, computeInViewport } from './registry';
import type { NativeElementRef, NativeElementState } from './types';
import {
  projectVisionFields,
  projectMedia,
  resolveObjectFit,
  resolveImageLabel,
  resolveImageSource,
  deriveInteractable,
  deriveText,
  roleForType,
  parseColorToRgb,
  parseFontSizePx,
} from './vision-fields';

/**
 * THE shared `src_digest` vector: the same URL and digest are pinned in
 * vision-core (qontinui-schemas `rust-vision-core/src/element_media.rs`), in
 * qontinui-web's `tests/e2e/style-gate/normalize.test.ts` and in
 * qontinui-claude-config's `scripts/test-uibridge-to-elementsnapshot.py`. The
 * query is part of the input on purpose — stripped, every next/image is one
 * image.
 */
const SHARED_SRC = 'http://localhost:3001/_next/image?url=%2Fimages%2Fhero.png&w=1920&q=75';
const SHARED_DIGEST = 'a846bcf412cf708ec0a4ac6a972307cbcb250b75509765fd44c49caecbd01f94';

/**
 * The second shared vector: a lone surrogate digests as U+FFFD, which is what
 * `TextEncoder` — and so `sha256Hex` — does. Pinned in all four suites.
 */
const SHARED_SURROGATE_SRC = 'http://localhost:3001/img/\ud800.png';
const SHARED_SURROGATE_DIGEST = '6f45e1fb51856d9f4f25eea51558783cc2c060af2ba43ea46c8bdab5dbdf23a6';

function makeRef(): React.RefObject<NativeElementRef> {
  return { current: {} as NativeElementRef };
}

describe('deriveInteractable', () => {
  it('is true for interactive types regardless of handlers', () => {
    expect(deriveInteractable('button', [])).toBe(true);
    expect(deriveInteractable('input', [])).toBe(true);
    expect(deriveInteractable('switch', undefined)).toBe(true);
    expect(deriveInteractable('listItem', [])).toBe(true);
    expect(deriveInteractable('checkbox', undefined)).toBe(true);
    expect(deriveInteractable('radio', undefined)).toBe(true);
    expect(deriveInteractable('touchable', [])).toBe(true);
    expect(deriveInteractable('pressable', [])).toBe(true);
  });

  it('is true when a real interactive handler is wired on a plain type', () => {
    expect(deriveInteractable('view', ['onPress'])).toBe(true);
    expect(deriveInteractable('text', ['onLongPress'])).toBe(true);
    expect(deriveInteractable('image', ['onPress', 'onLayout'])).toBe(true);
    expect(deriveInteractable('view', ['onChangeText'])).toBe(true);
  });

  it('is false for a plain view/text/heading with no real handler', () => {
    // Even though inferActions would synthesize press/click onto these types,
    // deriveInteractable does NOT consult actions — only real handler names.
    expect(deriveInteractable('view', [])).toBe(false);
    expect(deriveInteractable('text', [])).toBe(false);
    expect(deriveInteractable('text', undefined)).toBe(false);
    expect(deriveInteractable('custom', undefined)).toBe(false);
    expect(deriveInteractable('scroll', [])).toBe(false);
    // Non-interactive handler props (layout/measurement) must not count.
    expect(deriveInteractable('view', ['onLayout', 'onScroll'])).toBe(false);
  });
});

describe('deriveText', () => {
  it('prefers state.value, then textContent, then label', () => {
    expect(deriveText({ value: 'typed', textContent: 'tc' }, 'lbl')).toBe('typed');
    expect(deriveText({ textContent: 'tc' }, 'lbl')).toBe('tc');
    expect(deriveText({}, 'lbl')).toBe('lbl');
  });

  it('trims and skips empty/whitespace strings', () => {
    expect(deriveText({ value: '   ' }, 'Save')).toBe('Save');
    expect(deriveText({ value: '  hi  ' }, undefined)).toBe('hi');
  });

  it('returns undefined when no text source carries content', () => {
    expect(deriveText({}, undefined)).toBeUndefined();
    expect(deriveText({ value: '' }, '')).toBeUndefined();
  });
});

describe('roleForType', () => {
  it('maps native types to the analyzer role vocabulary', () => {
    expect(roleForType('button')).toBe('button');
    expect(roleForType('pressable')).toBe('button');
    expect(roleForType('input')).toBe('textbox');
    expect(roleForType('text')).toBe('text');
    expect(roleForType('switch')).toBe('switch');
    expect(roleForType('image')).toBe('img');
    expect(roleForType('listItem')).toBe('listitem');
    expect(roleForType('modal')).toBe('dialog');
  });

  it('returns undefined for generic containers', () => {
    expect(roleForType('view')).toBeUndefined();
    expect(roleForType('scroll')).toBeUndefined();
    expect(roleForType('custom')).toBeUndefined();
  });
});

describe('parseColorToRgb', () => {
  it('parses 6-digit hex', () => {
    expect(parseColorToRgb('#3b82f6')).toEqual({ r: 0x3b, g: 0x82, b: 0xf6 });
    expect(parseColorToRgb('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('parses opaque 8-digit hex', () => {
    expect(parseColorToRgb('#1e293bff')).toEqual({ r: 0x1e, g: 0x29, b: 0x3b });
  });

  it('parses 3-digit and opaque 4-digit shorthand hex', () => {
    expect(parseColorToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColorToRgb('#f00f')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('parses rgb()/rgba() with ints and percents', () => {
    expect(parseColorToRgb('rgb(255, 0, 0)')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColorToRgb('rgba(0,0,0,1)')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseColorToRgb('rgba(0,0,0,100%)')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseColorToRgb('rgb(100%, 0%, 50%)')).toEqual({ r: 255, g: 0, b: 128 });
  });

  // Both of these used to come back as a colour: `transparent` as opaque
  // BLACK, and a translucent colour flattened to its opaque RGB. Light text
  // over an image could then PASS a contrast check against a black that is
  // not there. Each is unknown, so the field is omitted.
  it('reads transparent as UNKNOWN, never black', () => {
    expect(parseColorToRgb('transparent')).toBeUndefined();
    expect(parseColorToRgb('Transparent')).toBeUndefined();
  });

  it('reads any partial alpha as UNKNOWN, never flattened', () => {
    expect(parseColorToRgb('rgba(0,0,0,0.5)')).toBeUndefined();
    expect(parseColorToRgb('rgba(0, 0, 0, 0.999)')).toBeUndefined();
    expect(parseColorToRgb('rgba(255,255,255,0)')).toBeUndefined();
    expect(parseColorToRgb('rgba(0,0,0,50%)')).toBeUndefined();
    expect(parseColorToRgb('#f00a')).toBeUndefined();
    expect(parseColorToRgb('#0000')).toBeUndefined();
    expect(parseColorToRgb('#00000080')).toBeUndefined();
    expect(parseColorToRgb('#00000000')).toBeUndefined();
  });

  it('reads an unparseable alpha or a fifth component as UNKNOWN, not opaque', () => {
    expect(parseColorToRgb('rgba(0,0,0,x)')).toBeUndefined();
    expect(parseColorToRgb('rgba(0,0,0,1,1)')).toBeUndefined();
  });

  it('parses named colors', () => {
    expect(parseColorToRgb('red')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColorToRgb('White')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('returns undefined for non-strings and unrecognized formats', () => {
    expect(parseColorToRgb(undefined)).toBeUndefined();
    expect(parseColorToRgb(0xff0000)).toBeUndefined();
    expect(parseColorToRgb('not-a-color')).toBeUndefined();
    expect(parseColorToRgb('')).toBeUndefined();
  });
});

describe('parseFontSizePx', () => {
  it('accepts bare numbers', () => {
    expect(parseFontSizePx(16)).toBe(16);
    expect(parseFontSizePx(13.5)).toBe(13.5);
  });

  it('accepts numeric strings with/without px', () => {
    expect(parseFontSizePx('16px')).toBe(16);
    expect(parseFontSizePx('14')).toBe(14);
  });

  it('rejects non-positive / non-numeric', () => {
    expect(parseFontSizePx(0)).toBeUndefined();
    expect(parseFontSizePx(-2)).toBeUndefined();
    expect(parseFontSizePx('auto')).toBeUndefined();
    expect(parseFontSizePx(undefined)).toBeUndefined();
  });
});

describe('projectVisionFields', () => {
  it('populates colors/fonts from flatStyle when present', () => {
    const fields = projectVisionFields({
      type: 'text',
      label: 'Hello',
      handlerNames: undefined,
      state: {},
      flatStyle: {
        color: '#000000',
        backgroundColor: '#ffffff',
        fontSize: 18,
        fontFamily: 'Inter',
      },
    });
    expect(fields).toMatchObject({
      interactable: false,
      text: 'Hello',
      role: 'text',
      fg_color: { r: 0, g: 0, b: 0 },
      bg_color: { r: 255, g: 255, b: 255 },
      font_size_px: 18,
      font_family: 'Inter',
    });
  });

  it('omits a transparent or translucent background instead of reading it as black', () => {
    for (const backgroundColor of ['transparent', 'rgba(0,0,0,0.4)', '#00000066']) {
      const fields = projectVisionFields({
        type: 'text',
        label: 'Caption over a photo',
        handlerNames: undefined,
        state: {},
        flatStyle: { color: '#ffffff', backgroundColor },
      });
      expect(fields.bg_color).toBeUndefined();
      expect(fields.fg_color).toEqual({ r: 255, g: 255, b: 255 });
    }
  });

  it('omits visual fields when flatStyle is absent (analyzer soft-skips)', () => {
    const fields = projectVisionFields({
      type: 'button',
      label: 'Save',
      handlerNames: ['onPress'],
      state: {},
      flatStyle: undefined,
    });
    expect(fields.interactable).toBe(true);
    expect(fields.text).toBe('Save');
    expect(fields.role).toBe('button');
    expect(fields.fg_color).toBeUndefined();
    expect(fields.bg_color).toBeUndefined();
    expect(fields.font_size_px).toBeUndefined();
    expect(fields.font_family).toBeUndefined();
  });
});

describe('createSnapshot emits analyzer fields', () => {
  it('a press-action button is interactable with text + role', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('save-btn', makeRef(), {
      type: 'button',
      label: 'Save',
      actions: ['press', 'click'],
    });
    registry.updateElementStyle('save-btn', {
      backgroundColor: '#3b82f6',
      color: '#ffffff',
      fontSize: 16,
      fontFamily: 'System',
    });

    const snapshot = registry.createSnapshot();
    const el = snapshot.elements.find((e) => e.id === 'save-btn');
    expect(el).toBeDefined();
    expect(el!.interactable).toBe(true);
    expect(el!.text).toBe('Save');
    expect(el!.role).toBe('button');
    expect(el!.fg_color).toEqual({ r: 255, g: 255, b: 255 });
    expect(el!.bg_color).toEqual({ r: 0x3b, g: 0x82, b: 0xf6 });
    expect(el!.font_size_px).toBe(16);
    expect(el!.font_family).toBe('System');
  });

  it('a plain view is non-interactable with no role', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('container', makeRef(), {
      type: 'view',
      actions: ['focus', 'blur'],
    });
    const snapshot = registry.createSnapshot();
    const el = snapshot.elements.find((e) => e.id === 'container');
    expect(el!.interactable).toBe(false);
    expect(el!.role).toBeUndefined();
  });

  it('a plain view/text with inferred actions but NO real handler is non-interactable', () => {
    // Regression: registering without explicit `actions` makes the registry
    // default to `inferActions(type)`, which synthesizes press/click onto
    // text/view. The element must STILL be interactable:false because no real
    // onPress handler was wired — matching web's plain text node.
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('content-paragraph', makeRef(), {
      type: 'text',
      label: 'A long paragraph of body copy.',
      // no actions, no props → inferActions adds click/press, but no handler
    });
    registry.registerElement('layout-row', makeRef(), {
      type: 'view',
      // no actions, no props → inferActions adds click/press, but no handler
    });
    const snapshot = registry.createSnapshot();
    const para = snapshot.elements.find((e) => e.id === 'content-paragraph');
    const row = snapshot.elements.find((e) => e.id === 'layout-row');
    expect(para!.interactable).toBe(false);
    expect(row!.interactable).toBe(false);
  });

  it('a plain view with a real onPress handler IS interactable', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('tappable-card', makeRef(), {
      type: 'view',
      label: 'Tap me',
      props: { onPress: () => {}, onLayout: () => {} },
    });
    const snapshot = registry.createSnapshot();
    const el = snapshot.elements.find((e) => e.id === 'tappable-card');
    expect(el!.registeredHandlers).toContain('onPress');
    expect(el!.interactable).toBe(true);
  });

  it('a listItem and an input are interactable by type', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('row-0', makeRef(), { type: 'listItem', label: 'Row' });
    registry.registerElement('email', makeRef(), { type: 'input', label: 'Email' });
    const snapshot = registry.createSnapshot();
    expect(snapshot.elements.find((e) => e.id === 'row-0')!.interactable).toBe(true);
    expect(snapshot.elements.find((e) => e.id === 'email')!.interactable).toBe(true);
  });

  it('a text element surfaces its label as text', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('status', makeRef(), {
      type: 'text',
      label: 'Status: online',
    });
    const snapshot = registry.createSnapshot();
    const el = snapshot.elements.find((e) => e.id === 'status');
    expect(el!.text).toBe('Status: online');
    expect(el!.role).toBe('text');
  });
});

// ---------------------------------------------------------------------------
// Image media — vision-core `Element.media` (plan
// 2026-10-13-image-generation-and-visual-judgment, Phase 7)
// ---------------------------------------------------------------------------

const LAYOUT = { x: 0, y: 0, width: 120, height: 80, pageX: 10, pageY: 20 };

describe('resolveObjectFit — what an RN Image actually paints', () => {
  it('maps each resize mode to the object-fit that paints the same layout', () => {
    expect(resolveObjectFit({ resizeMode: 'cover' }, undefined)).toBe('cover');
    expect(resolveObjectFit({ resizeMode: 'contain' }, undefined)).toBe('contain');
    expect(resolveObjectFit({ resizeMode: 'stretch' }, undefined)).toBe('fill');
    // RN `center`: scale down if bigger, never up, centred — CSS scale-down.
    expect(resolveObjectFit({ resizeMode: 'center' }, undefined)).toBe('scale-down');
    expect(resolveObjectFit({ resizeMode: 'none' }, undefined)).toBe('none');
  });

  it('omits `repeat`, which tiles — no object-fit paints that', () => {
    expect(resolveObjectFit({ resizeMode: 'repeat' }, undefined)).toBeUndefined();
  });

  it("follows RN's precedence: objectFit style, then resizeMode prop, then style", () => {
    expect(resolveObjectFit({ resizeMode: 'stretch' }, { objectFit: 'cover' })).toBe('cover');
    expect(resolveObjectFit({ resizeMode: 'stretch' }, { resizeMode: 'contain' })).toBe('fill');
    expect(resolveObjectFit(undefined, { resizeMode: 'contain' })).toBe('contain');
    // RN does not implement scale-down: it paints `contain`, so that is the fit.
    expect(resolveObjectFit(undefined, { objectFit: 'scale-down' })).toBe('contain');
    expect(resolveObjectFit(undefined, { objectFit: 'fill' })).toBe('fill');
  });

  it("leaves an unset mode UNKNOWN rather than assuming RN's `cover` default", () => {
    // `type: 'image'` need not be RN's Image (expo-image, FastImage, an SVG).
    expect(resolveObjectFit(undefined, undefined)).toBeUndefined();
    expect(resolveObjectFit({}, {})).toBeUndefined();
    expect(resolveObjectFit({ resizeMode: '' }, { resizeMode: 'cover' })).toBe('cover');
  });
});

describe('resolveObjectFit — an expo-image `contentFit`', () => {
  it('reads contentFit as the CSS object-fit it already is', () => {
    expect(resolveObjectFit({ contentFit: 'cover' }, undefined)).toBe('cover');
    expect(resolveObjectFit({ contentFit: 'contain' }, undefined)).toBe('contain');
    expect(resolveObjectFit({ contentFit: 'fill' }, undefined)).toBe('fill');
    expect(resolveObjectFit({ contentFit: 'none' }, undefined)).toBe('none');
    // expo-image paints scale-down itself; only RN's Image degrades it to contain.
    expect(resolveObjectFit({ contentFit: 'scale-down' }, undefined)).toBe('scale-down');
  });

  it('wins over resizeMode and the style, as expo-image reads it first', () => {
    expect(
      resolveObjectFit({ contentFit: 'contain', resizeMode: 'cover' }, { objectFit: 'fill' })
    ).toBe('contain');
  });

  it('is UNKNOWN when set outside the vocabulary — never a fall-through', () => {
    expect(
      resolveObjectFit({ contentFit: 'stretch', resizeMode: 'cover' }, undefined)
    ).toBeUndefined();
    expect(resolveObjectFit({ contentFit: 'constructor' }, undefined)).toBeUndefined();
  });

  it('an empty contentFit is unset, so the resize mode decides', () => {
    expect(resolveObjectFit({ contentFit: '', resizeMode: 'cover' }, undefined)).toBe('cover');
  });

  it('reaches media.object_fit', () => {
    const media = projectMedia({
      layout: LAYOUT,
      props: { source: { uri: 'https://x/a.png' }, contentFit: 'cover' },
      flatStyle: undefined,
      accessibilityLabel: undefined,
      inViewport: true,
    });
    expect(media.object_fit).toBe('cover');
  });
});

describe('resolveImageSource — the URL an RN Image displays', () => {
  it('reads source.uri, a one-element source array, and src (which wins)', () => {
    expect(resolveImageSource({ source: { uri: SHARED_SRC } })).toBe(SHARED_SRC);
    expect(resolveImageSource({ source: [{ uri: SHARED_SRC }] })).toBe(SHARED_SRC);
    expect(resolveImageSource({ src: SHARED_SRC, source: { uri: '/other.png' } })).toBe(SHARED_SRC);
  });

  it('cannot name the displayed URL for a srcSet, several candidates, or a bundled asset', () => {
    expect(
      resolveImageSource({ srcSet: `${SHARED_SRC} 1x, /b.png 2x`, src: SHARED_SRC })
    ).toBeUndefined();
    expect(resolveImageSource({ source: [{ uri: '/a.png' }, { uri: '/b.png' }] })).toBeUndefined();
    expect(resolveImageSource({ source: 42 })).toBeUndefined(); // require('./hero.png')
    expect(resolveImageSource(undefined)).toBeUndefined();
  });
});

describe('projectMedia / projectVisionFields — image elements', () => {
  it('digests the source URL with the shared vector, query kept', () => {
    const media = projectMedia({
      layout: LAYOUT,
      props: { source: { uri: SHARED_SRC } },
      flatStyle: undefined,
      accessibilityLabel: undefined,
      inViewport: undefined,
    });
    expect(media.src_digest).toBe(SHARED_DIGEST);
    const stripped = projectMedia({
      layout: LAYOUT,
      props: { source: { uri: SHARED_SRC.slice(0, SHARED_SRC.indexOf('?')) } },
      flatStyle: undefined,
      accessibilityLabel: undefined,
      inViewport: undefined,
    });
    expect(stripped.src_digest).not.toBe(SHARED_DIGEST);
  });

  it('digests a lone surrogate as U+FFFD — the shared surrogate vector', () => {
    const digestOf = (uri: string) =>
      projectMedia({
        layout: LAYOUT,
        props: { source: { uri } },
        flatStyle: undefined,
        accessibilityLabel: undefined,
        inViewport: undefined,
      }).src_digest;
    expect(digestOf(SHARED_SURROGATE_SRC)).toBe(SHARED_SURROGATE_DIGEST);
    expect(digestOf(SHARED_SURROGATE_SRC.replace('\ud800', '\ufffd'))).toBe(
      SHARED_SURROGATE_DIGEST
    );
  });

  it('projects the laid-out size, fit, alt and viewport an image registry has', () => {
    const fields = projectVisionFields({
      type: 'image',
      label: 'Hero banner',
      handlerNames: undefined,
      state: { layout: LAYOUT },
      flatStyle: { resizeMode: 'stretch', backgroundColor: 'transparent' },
      // The host spread bridgeProps (accessibilityLabel) and captured them.
      props: { source: { uri: SHARED_SRC }, accessibilityLabel: 'Hero banner' },
      accessibilityLabel: 'Hero banner',
      inViewport: true,
    });
    expect(fields.media).toEqual({
      kind: 'img',
      rendered_px: { w: 120, h: 80 },
      object_fit: 'fill',
      alt: { decorative: false, text: 'Hero banner' },
      src_digest: SHARED_DIGEST,
      in_viewport: true,
    });
    expect(fields.bg_color).toBeUndefined(); // transparent, not black
  });

  it('never projects an image label as text — the label is its alt', () => {
    const fields = projectVisionFields({
      type: 'image',
      label: 'Company logo',
      handlerNames: undefined,
      state: { textContent: 'Company logo' },
      flatStyle: undefined,
      accessibilityLabel: 'Company logo',
    });
    expect(fields.text).toBeUndefined();
    expect(fields.media?.alt).toEqual({ decorative: false, text: 'Company logo' });
    expect(fields.role).toBe('img');
  });

  it('omits every fact it cannot measure, keeping only the kind', () => {
    const fields = projectVisionFields({
      type: 'image',
      label: undefined,
      handlerNames: undefined,
      state: { layout: null },
      flatStyle: undefined,
    });
    // No accessibility label: RN may simply not expose the image, so the alt
    // is UNKNOWN — neither "missing" nor "decorative".
    expect(fields.media).toEqual({ kind: 'img' });
  });

  it('gives a non-image element no media, and keeps its label as text', () => {
    const fields = projectVisionFields({
      type: 'text',
      label: 'Hello',
      handlerNames: undefined,
      state: { layout: LAYOUT },
      flatStyle: undefined,
      props: { source: { uri: SHARED_SRC } },
      accessibilityLabel: 'Hello',
      inViewport: true,
    });
    expect(fields.media).toBeUndefined();
    expect(fields.text).toBe('Hello');
  });
});

describe('projectMedia — alt: RN has no alt="" rule; decorative only from an explicit hide signal', () => {
  // `label` is the image's announced label: the registry's when no props were
  // recorded, else the captured `accessibilityLabel` prop (a host that spread
  // bridgeProps and captured them).
  const altOf = (
    label: string | undefined,
    props: Record<string, unknown> | undefined = undefined
  ) =>
    projectMedia({
      layout: LAYOUT,
      props:
        props === undefined || label === undefined
          ? props
          : { ...props, accessibilityLabel: label },
      flatStyle: undefined,
      accessibilityLabel: props === undefined ? label : undefined,
      inViewport: undefined,
    }).alt;

  it("strips HTML's ASCII whitespace but not NBSP", () => {
    expect(altOf(' \tHero\n')).toEqual({ decorative: false, text: 'Hero' });
    expect(altOf('\u00a0Hero')).toEqual({ decorative: false, text: '\u00a0Hero' });
  });

  it('omits the alt for an empty or whitespace-only label, as for a missing one', () => {
    expect(altOf(' \t\n\f\r ')).toBeUndefined();
    expect(altOf('')).toBeUndefined();
    expect(altOf(undefined)).toBeUndefined();
  });

  it.each([
    [{ accessible: false }],
    [{ importantForAccessibility: 'no' }],
    [{ importantForAccessibility: 'no-hide-descendants' }],
    [{ accessibilityElementsHidden: true }],
  ])('is decorative only on an explicit hide signal: %j', (props) => {
    expect(altOf(undefined, props)).toEqual({ decorative: true });
    expect(altOf('', props)).toEqual({ decorative: true });
    expect(altOf('Hero', props)).toEqual({ decorative: true });
  });

  it.each([
    [{ accessible: true }],
    [{ importantForAccessibility: 'yes' }],
    [{ importantForAccessibility: 'auto' }],
    [{ accessibilityElementsHidden: false }],
    [{ 'aria-hidden': 'true' }],
    [{}],
  ])('a non-hiding prop set keeps the label rule: %j', (props) => {
    expect(altOf('', props)).toBeUndefined();
    expect(altOf('Hero', props)).toEqual({ decorative: false, text: 'Hero' });
  });

  // RN `Image` never reads aria-hidden (only View maps it): still announced.
  it('aria-hidden does not hide an image', () => {
    expect(altOf('Hero', { 'aria-hidden': true })).toEqual({ decorative: false, text: 'Hero' });
    expect(altOf(undefined, { 'aria-hidden': true })).toBeUndefined();
  });

  // RN `Image`: accessible = props.alt !== undefined ? true : props.accessible.
  it('accessible={false} does not hide an image that has an alt', () => {
    expect(altOf(undefined, { accessible: false, alt: 'Hero' })).toEqual({
      decorative: false,
      text: 'Hero',
    });
    expect(altOf(undefined, { accessible: false, alt: '' })).toBeUndefined();
  });
});

describe('resolveImageLabel — RN precedence aria-label ?? accessibilityLabel ?? alt; the registry label only without props', () => {
  const altOf = (props: Record<string, unknown> | undefined, registryLabel?: string) =>
    projectMedia({
      layout: LAYOUT,
      props,
      flatStyle: undefined,
      accessibilityLabel: registryLabel,
      inViewport: undefined,
    }).alt;

  it('an image labelled only via alt gets its alt', () => {
    expect(altOf({ alt: 'Sunrise' })).toEqual({ decorative: false, text: 'Sunrise' });
  });

  it('aria-label beats accessibilityLabel beats alt; the registry label is never consulted beside props', () => {
    const all = { 'aria-label': 'A', accessibilityLabel: 'B', alt: 'C' };
    expect(altOf(all, 'R')).toEqual({ decorative: false, text: 'A' });
    expect(altOf({ accessibilityLabel: 'B', alt: 'C' }, 'R')).toEqual({
      decorative: false,
      text: 'B',
    });
    expect(altOf({ alt: 'C' }, 'R')).toEqual({ decorative: false, text: 'C' });
  });

  it('no props recorded at all: the registry label is the reading', () => {
    expect(altOf(undefined, 'R')).toEqual({ decorative: false, text: 'R' });
    expect(resolveImageLabel(undefined, 'R')).toBe('R');
  });

  // A host that does not spread bridgeProps onto the Image still has a
  // registry label; the image announces none, so no alt may be claimed.
  it('a props record with no label omits the alt even with a registry label', () => {
    expect(altOf({}, 'R')).toBeUndefined();
    expect(altOf({ source: { uri: SHARED_SRC } }, 'R')).toBeUndefined();
    expect(resolveImageLabel({}, 'R')).toBeUndefined();
  });

  it('a set-but-empty prop wins as RN `??` does, and then omits the alt', () => {
    expect(resolveImageLabel({ 'aria-label': '', alt: 'C' }, 'R')).toBe('');
    expect(altOf({ 'aria-label': '', alt: 'C' }, 'R')).toBeUndefined();
  });

  it('a null prop falls through; a non-string winner is unreadable', () => {
    expect(resolveImageLabel({ 'aria-label': null, alt: 'C' }, 'R')).toBe('C');
    expect(resolveImageLabel({ alt: 42 }, 'R')).toBeUndefined();
  });
});

describe('resolveObjectFit — own map entries only', () => {
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'a %j resize mode or objectFit style is unknown, never a prototype member',
    (key) => {
      expect(resolveObjectFit({ resizeMode: key }, undefined)).toBeUndefined();
      expect(resolveObjectFit(undefined, { resizeMode: key })).toBeUndefined();
      expect(resolveObjectFit(undefined, { objectFit: key })).toBeUndefined();
      // An unknown objectFit style falls through to the resizeMode prop, as RN does.
      expect(resolveObjectFit({ resizeMode: 'cover' }, { objectFit: key })).toBe('cover');
    }
  );
});

describe('computeInViewport — never promotes an unknown to "on screen"', () => {
  const shown = (pageY: number): NativeElementState => ({
    mounted: true,
    visible: true,
    enabled: true,
    focused: false,
    layout: { x: 0, y: pageY, width: 100, height: 40, pageX: 0, pageY },
  });
  const WINDOW_CLIP = { left: 0, top: 0, right: 393, bottom: 830 };

  it('answers from the measured rect against a known clip', () => {
    expect(computeInViewport(shown(100), WINDOW_CLIP)).toBe(true);
    expect(computeInViewport(shown(810), WINDOW_CLIP)).toBe(true); // straddling counts
    expect(computeInViewport(shown(900), WINDOW_CLIP)).toBe(false);
  });

  it('is UNKNOWN when the clip bounds are unknown — where computeVisibility says visible', () => {
    expect(computeInViewport(shown(9999), null)).toBeUndefined();
    expect(computeInViewport(shown(9999), undefined)).toBeUndefined();
  });

  it('is UNKNOWN for a hidden element or one with no page-space rect', () => {
    expect(computeInViewport({ ...shown(100), visible: false }, WINDOW_CLIP)).toBeUndefined();
    expect(computeInViewport({ ...shown(100), layout: null }, WINDOW_CLIP)).toBeUndefined();
    const parentRelative = shown(100);
    parentRelative.layout = { ...parentRelative.layout!, pageOriginUnmeasured: true };
    expect(computeInViewport(parentRelative, WINDOW_CLIP)).toBeUndefined();
  });

  it('reads an empty clip as off screen', () => {
    expect(computeInViewport(shown(100), { left: 0, top: 0, right: 0, bottom: 0 })).toBe(false);
  });
});

describe('createSnapshot emits image media', () => {
  it('an image carries media, no text, and no fabricated black background', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.setViewportProvider(() => ({ width: 393, height: 830 }));
    registry.registerElement('hero', makeRef(), {
      type: 'image',
      label: 'Hero',
      accessibilityLabel: 'Hero',
      props: { source: { uri: SHARED_SRC }, resizeMode: 'center', accessibilityLabel: 'Hero' },
      flatStyle: { backgroundColor: 'transparent' },
    });
    registry.updateElementState('hero', {
      visible: true,
      layout: { x: 0, y: 100, width: 393, height: 200, pageX: 0, pageY: 100 },
    });
    registry.registerElement('below-fold', makeRef(), { type: 'image', label: 'Footer art' });
    registry.updateElementState('below-fold', {
      visible: true,
      layout: { x: 0, y: 2000, width: 393, height: 200, pageX: 0, pageY: 2000 },
    });

    const snapshot = registry.createSnapshot();
    const hero = snapshot.elements.find((e) => e.id === 'hero');
    expect(hero!.media).toEqual({
      kind: 'img',
      rendered_px: { w: 393, h: 200 },
      object_fit: 'scale-down',
      alt: { decorative: false, text: 'Hero' },
      src_digest: SHARED_DIGEST,
      in_viewport: true,
    });
    expect(hero!.text).toBeUndefined();
    expect(hero!.bg_color).toBeUndefined();

    const belowFold = snapshot.elements.find((e) => e.id === 'below-fold');
    expect(belowFold!.media?.in_viewport).toBe(false);
    // Registered with a label but no accessibility label: alt UNKNOWN.
    expect(belowFold!.media?.alt).toBeUndefined();
  });
});
