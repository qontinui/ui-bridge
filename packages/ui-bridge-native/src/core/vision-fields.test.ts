import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from './registry';
import type { NativeElementRef } from './types';
import {
  projectVisionFields,
  deriveInteractable,
  deriveText,
  roleForType,
  parseColorToRgb,
  parseFontSizePx,
} from './vision-fields';

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

  it('parses 8-digit hex (drops alpha)', () => {
    expect(parseColorToRgb('#1e293bff')).toEqual({ r: 0x1e, g: 0x29, b: 0x3b });
  });

  it('parses 3- and 4-digit shorthand hex', () => {
    expect(parseColorToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColorToRgb('#f00a')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('parses rgb()/rgba() with ints and percents', () => {
    expect(parseColorToRgb('rgb(255, 0, 0)')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColorToRgb('rgba(0,0,0,0.5)')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseColorToRgb('rgb(100%, 0%, 50%)')).toEqual({ r: 255, g: 0, b: 128 });
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
