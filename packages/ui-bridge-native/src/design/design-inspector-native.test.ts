import { describe, it, expect } from 'vitest';
import {
  mapNativeStyleToExtended,
  getNativeElementDesignData,
  captureNativeStateVariations,
  captureNativeResponsiveSnapshot,
} from './design-inspector-native';

describe('mapNativeStyleToExtended', () => {
  it('returns all empty strings for null/undefined input', () => {
    const result = mapNativeStyleToExtended(null);
    // display defaults to 'flex' (RN default)
    expect(result.display).toBe('flex');
    // position defaults to 'relative' (RN default)
    expect(result.position).toBe('relative');
    // most other properties empty
    expect(result.width).toBe('');
    expect(result.height).toBe('');
    expect(result.color).toBe('');
    expect(result.backgroundColor).toBe('');
    expect(result.fontFamily).toBe('');
  });

  it('converts numeric values to px strings', () => {
    const result = mapNativeStyleToExtended({
      width: 100,
      height: 50,
      fontSize: 16,
      lineHeight: 24,
      letterSpacing: 0.5,
    });
    expect(result.width).toBe('100px');
    expect(result.height).toBe('50px');
    expect(result.fontSize).toBe('16px');
    expect(result.lineHeight).toBe('24px');
    expect(result.letterSpacing).toBe('0.5px');
  });

  it('passes through string values', () => {
    const result = mapNativeStyleToExtended({
      width: '50%',
      height: 'auto',
      color: '#ff0000',
      backgroundColor: 'rgba(0,0,0,0.5)',
    });
    expect(result.width).toBe('50%');
    expect(result.height).toBe('auto');
    expect(result.color).toBe('#ff0000');
    expect(result.backgroundColor).toBe('rgba(0,0,0,0.5)');
  });

  it('maps textDecorationLine to textDecoration', () => {
    const result = mapNativeStyleToExtended({ textDecorationLine: 'underline' });
    expect(result.textDecoration).toBe('underline');
  });

  it('maps flexDirection and other flex properties', () => {
    const result = mapNativeStyleToExtended({
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      alignItems: 'flex-start',
      alignSelf: 'stretch',
    });
    expect(result.flexDirection).toBe('row');
    expect(result.flexWrap).toBe('wrap');
    expect(result.justifyContent).toBe('center');
    expect(result.alignItems).toBe('flex-start');
    expect(result.alignSelf).toBe('stretch');
  });

  it('sets CSS-only properties to empty string', () => {
    const result = mapNativeStyleToExtended({
      width: 100,
      color: 'red',
    });
    expect(result.boxSizing).toBe('');
    expect(result.cursor).toBe('');
    expect(result.visibility).toBe('');
    expect(result.gridTemplateColumns).toBe('');
    expect(result.gridTemplateRows).toBe('');
    expect(result.outline).toBe('');
    expect(result.transition).toBe('');
    expect(result.backgroundImage).toBe('');
    expect(result.overflowX).toBe('');
    expect(result.overflowY).toBe('');
  });

  describe('transform mapping', () => {
    it('converts RN transform array to CSS transform string', () => {
      const result = mapNativeStyleToExtended({
        transform: [{ translateX: 10 }, { translateY: 20 }],
      });
      expect(result.transform).toBe('translateX(10px) translateY(20px)');
    });

    it('handles scale transforms without px', () => {
      const result = mapNativeStyleToExtended({
        transform: [{ scale: 1.5 }],
      });
      expect(result.transform).toBe('scale(1.5)');
    });

    it('handles rotation with string values', () => {
      const result = mapNativeStyleToExtended({
        transform: [{ rotate: '45deg' }],
      });
      expect(result.transform).toBe('rotate(45deg)');
    });

    it('handles mixed transforms', () => {
      const result = mapNativeStyleToExtended({
        transform: [{ translateX: 10 }, { rotate: '90deg' }, { scale: 2 }],
      });
      expect(result.transform).toBe('translateX(10px) rotate(90deg) scale(2)');
    });

    it('returns empty string for no transforms', () => {
      const result = mapNativeStyleToExtended({});
      expect(result.transform).toBe('');
    });
  });

  describe('shadow mapping', () => {
    it('converts iOS shadow props to boxShadow string', () => {
      const result = mapNativeStyleToExtended({
        shadowColor: '#000000',
        shadowOffset: { width: 2, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
      });
      expect(result.boxShadow).toContain('2px 4px 8px #000000');
      expect(result.boxShadow).toContain('opacity: 0.25');
    });

    it('converts Android elevation to boxShadow', () => {
      const result = mapNativeStyleToExtended({ elevation: 5 });
      expect(result.boxShadow).toBe('elevation(5)');
    });

    it('includes both iOS shadow and elevation', () => {
      const result = mapNativeStyleToExtended({
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 1,
        shadowRadius: 4,
        elevation: 3,
      });
      expect(result.boxShadow).toContain('0px 2px 4px #000');
      expect(result.boxShadow).toContain('elevation(3)');
    });

    it('omits shadow when opacity is 0', () => {
      const result = mapNativeStyleToExtended({
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0,
        shadowRadius: 4,
      });
      expect(result.boxShadow).toBe('');
    });
  });

  describe('border mapping', () => {
    it('converts border width and color to shorthand', () => {
      const result = mapNativeStyleToExtended({
        borderWidth: 1,
        borderColor: '#ccc',
      });
      expect(result.border).toBe('1px solid #ccc');
    });

    it('handles missing border color', () => {
      const result = mapNativeStyleToExtended({ borderWidth: 2 });
      expect(result.border).toBe('2px solid transparent');
    });

    it('returns empty string with no border', () => {
      const result = mapNativeStyleToExtended({});
      expect(result.border).toBe('');
    });
  });

  describe('border radius mapping', () => {
    it('converts uniform borderRadius', () => {
      const result = mapNativeStyleToExtended({ borderRadius: 8 });
      expect(result.borderRadius).toBe('8px');
    });

    it('converts per-corner radii', () => {
      const result = mapNativeStyleToExtended({
        borderTopLeftRadius: 4,
        borderTopRightRadius: 8,
        borderBottomRightRadius: 12,
        borderBottomLeftRadius: 0,
      });
      expect(result.borderRadius).toBe('4px 8px 12px 0px');
    });
  });

  describe('margin/padding mapping', () => {
    it('converts individual margin values', () => {
      const result = mapNativeStyleToExtended({
        marginTop: 10,
        marginRight: 20,
        marginBottom: 30,
        marginLeft: 40,
      });
      expect(result.marginTop).toBe('10px');
      expect(result.marginRight).toBe('20px');
      expect(result.marginBottom).toBe('30px');
      expect(result.marginLeft).toBe('40px');
      expect(result.margin).toBe('10px 20px 30px 40px');
    });

    it('handles marginHorizontal/marginVertical', () => {
      const result = mapNativeStyleToExtended({
        marginHorizontal: 16,
        marginVertical: 8,
      });
      expect(result.marginTop).toBe('8px');
      expect(result.marginBottom).toBe('8px');
      expect(result.marginLeft).toBe('16px');
      expect(result.marginRight).toBe('16px');
    });

    it('handles uniform margin', () => {
      const result = mapNativeStyleToExtended({ margin: 12 });
      expect(result.margin).toBe('12px');
      expect(result.marginTop).toBe('12px');
      expect(result.marginRight).toBe('12px');
    });

    it('converts padding similarly', () => {
      const result = mapNativeStyleToExtended({
        paddingHorizontal: 16,
        paddingVertical: 8,
      });
      expect(result.paddingLeft).toBe('16px');
      expect(result.paddingRight).toBe('16px');
      expect(result.paddingTop).toBe('8px');
      expect(result.paddingBottom).toBe('8px');
    });
  });

  describe('gap mapping', () => {
    it('converts uniform gap', () => {
      const result = mapNativeStyleToExtended({ gap: 8 });
      expect(result.gap).toBe('8px');
    });

    it('converts rowGap and columnGap', () => {
      const result = mapNativeStyleToExtended({ rowGap: 8, columnGap: 16 });
      expect(result.gap).toBe('8px 16px');
    });
  });

  it('maps opacity to string', () => {
    const result = mapNativeStyleToExtended({ opacity: 0.5 });
    expect(result.opacity).toBe('0.5');
  });

  it('maps zIndex to string', () => {
    const result = mapNativeStyleToExtended({ zIndex: 10 });
    expect(result.zIndex).toBe('10');
  });

  it('maps pointerEvents', () => {
    const result = mapNativeStyleToExtended({ pointerEvents: 'none' });
    expect(result.pointerEvents).toBe('none');
  });

  it('maps overflow', () => {
    const result = mapNativeStyleToExtended({ overflow: 'hidden' });
    expect(result.overflow).toBe('hidden');
  });
});

describe('getNativeElementDesignData', () => {
  it('produces ElementDesignData with layout rect', () => {
    const data = getNativeElementDesignData(
      'btn-1',
      'Submit Button',
      'button',
      { backgroundColor: '#3b82f6', borderRadius: 8, padding: 12 },
      { x: 10, y: 20, width: 200, height: 48, pageX: 50, pageY: 100 }
    );
    expect(data.elementId).toBe('btn-1');
    expect(data.label).toBe('Submit Button');
    expect(data.type).toBe('button');
    expect(data.styles.backgroundColor).toBe('#3b82f6');
    expect(data.styles.borderRadius).toBe('8px');
    expect(data.rect).toEqual({ x: 50, y: 100, width: 200, height: 48 });
    expect(data.pseudoElements).toEqual([]);
  });

  it('handles null layout', () => {
    const data = getNativeElementDesignData('txt-1', 'Label', 'text', {}, null);
    expect(data.rect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('handles null style', () => {
    const data = getNativeElementDesignData('v-1', undefined, 'view', null, null);
    expect(data.styles.display).toBe('flex');
    expect(data.label).toBeUndefined();
  });
});

describe('captureNativeStateVariations', () => {
  it('returns only default state when no stateStyles', () => {
    const base = { backgroundColor: '#fff', fontSize: 16 };
    const variations = captureNativeStateVariations(base);
    expect(variations).toHaveLength(1);
    expect(variations[0].state).toBe('default');
    expect(variations[0].diffFromDefault).toEqual([]);
    expect(variations[0].styles.backgroundColor).toBe('#fff');
  });

  it('captures pressed state with diff', () => {
    const base = { backgroundColor: '#fff', opacity: 1 };
    const stateStyles = { pressed: { backgroundColor: '#eee', opacity: 0.8 } };
    const variations = captureNativeStateVariations(base, stateStyles);

    expect(variations).toHaveLength(2);
    expect(variations[0].state).toBe('default');
    expect(variations[1].state).toBe('pressed');
    expect(variations[1].diffFromDefault.length).toBeGreaterThan(0);

    const bgDiff = variations[1].diffFromDefault.find((d) => d.property === 'backgroundColor');
    expect(bgDiff).toBeDefined();
    expect(bgDiff!.defaultValue).toBe('#fff');
    expect(bgDiff!.stateValue).toBe('#eee');

    const opacityDiff = variations[1].diffFromDefault.find((d) => d.property === 'opacity');
    expect(opacityDiff).toBeDefined();
    expect(opacityDiff!.defaultValue).toBe('1');
    expect(opacityDiff!.stateValue).toBe('0.8');
  });

  it('captures multiple states', () => {
    const base = { backgroundColor: '#fff' };
    const stateStyles = {
      pressed: { backgroundColor: '#eee' },
      focused: { backgroundColor: '#ddd', borderWidth: 2, borderColor: '#00f' },
      disabled: { opacity: 0.5 },
    };
    const variations = captureNativeStateVariations(base, stateStyles);

    // default + pressed + focused + disabled
    expect(variations).toHaveLength(4);
    expect(variations.map((v) => v.state)).toEqual(['default', 'pressed', 'focused', 'disabled']);
  });

  it('skips states with no actual diff', () => {
    const base = { backgroundColor: '#fff' };
    // Same as base — no diff
    const stateStyles = { pressed: { backgroundColor: '#fff' } };
    const variations = captureNativeStateVariations(base, stateStyles);
    // Only default, pressed has no diff
    expect(variations).toHaveLength(1);
  });

  it('handles null base style', () => {
    const variations = captureNativeStateVariations(null, {
      pressed: { opacity: 0.5 },
    });
    expect(variations.length).toBeGreaterThanOrEqual(2);
    expect(variations[0].state).toBe('default');
  });
});

describe('captureNativeResponsiveSnapshot', () => {
  it('returns single snapshot at current dimensions', () => {
    const elements = [
      {
        id: 'el-1',
        label: 'Test',
        type: 'view',
        flatStyle: { width: 100, height: 50 },
        layout: { x: 0, y: 0, width: 100, height: 50, pageX: 0, pageY: 0 },
      },
    ];
    const snapshots = captureNativeResponsiveSnapshot(elements, {
      width: 390,
      height: 844,
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].viewportWidth).toBe(390);
    expect(snapshots[0].viewportLabel).toBe('current');
    expect(snapshots[0].elements).toHaveLength(1);
    expect(snapshots[0].elements[0].elementId).toBe('el-1');
    expect(snapshots[0].timestamp).toBeGreaterThan(0);
  });

  it('maps element styles correctly', () => {
    const elements = [
      {
        id: 'card',
        type: 'view',
        flatStyle: { backgroundColor: '#1e293b', borderRadius: 12 },
        layout: { x: 16, y: 100, width: 358, height: 200, pageX: 16, pageY: 100 },
      },
    ];
    const snapshots = captureNativeResponsiveSnapshot(elements, {
      width: 390,
      height: 844,
    });

    const el = snapshots[0].elements[0];
    expect(el.styles.backgroundColor).toBe('#1e293b');
    expect(el.styles.borderRadius).toBe('12px');
    expect(el.rect).toEqual({ x: 16, y: 100, width: 358, height: 200 });
  });
});
