/**
 * `CUSTOM_PROPERTY_METRICS` lists exactly the metrics that read custom properties.
 *
 * Reading an element's custom properties walks the page's stylesheets, so a
 * `/design/evaluate` whose context enables none of the listed metrics skips the
 * walk (`specs/quality-request.ts`). A metric that read custom properties
 * without being listed would then be scored on elements that carry none, and
 * nothing would say so. This test computes every metric twice, with and
 * without the elements' custom properties, and requires the list to be exactly
 * the metrics whose value changed.
 */

import { describe, expect, it } from 'vitest';
import { CUSTOM_PROPERTY_METRICS, METRIC_FUNCTIONS } from '../quality-metrics';
import type { ElementDesignData, ExtendedComputedStyles } from '../../core/types';
import type { QualityMetricId, ViewportDimensions } from '../quality-types';

const VIEWPORT: ViewportDimensions = { width: 1280, height: 800 };

function element(
  id: string,
  type: string,
  rect: ElementDesignData['rect'],
  styles: Partial<ExtendedComputedStyles>,
  customProperties: Record<string, string>
): ElementDesignData {
  return {
    elementId: id,
    type,
    rect,
    styles: {
      display: 'block',
      position: 'static',
      color: 'rgb(17, 24, 39)',
      backgroundColor: 'rgb(255, 255, 255)',
      fontSize: '16px',
      fontFamily: 'Inter',
      fontWeight: '400',
      lineHeight: '24px',
      paddingTop: '8px',
      paddingLeft: '16px',
      borderRadius: '6px',
      ...styles,
    } as ExtendedComputedStyles,
    customProperties,
  };
}

// Custom properties of every shape the metric could read: values that back the
// element's own colors, a variable resolving differently on two elements, and
// elements with none.
const ELEMENTS: ElementDesignData[] = [
  element(
    'title',
    'heading',
    { x: 24, y: 24, width: 600, height: 40 },
    { fontSize: '32px', fontWeight: '700' },
    { '--fg': 'rgb(17, 24, 39)', '--space': '8px' }
  ),
  element(
    'save',
    'button',
    { x: 24, y: 96, width: 120, height: 40 },
    { color: 'rgb(255, 255, 255)', backgroundColor: 'rgb(37, 99, 235)' },
    { '--primary': 'rgb(37, 99, 235)', '--space': '12px' }
  ),
  element(
    'cancel',
    'button',
    { x: 160, y: 96, width: 120, height: 40 },
    { color: 'rgb(37, 99, 235)', backgroundColor: 'rgb(255, 255, 255)' },
    { '--primary': 'rgb(37, 99, 235)' }
  ),
  element('name', 'input', { x: 24, y: 160, width: 320, height: 40 }, {}, {}),
  element(
    'body',
    'text',
    { x: 24, y: 220, width: 640, height: 120 },
    {},
    { '--fg': 'rgb(17, 24, 39)' }
  ),
  element('card', 'card', { x: 700, y: 96, width: 300, height: 240 }, {}, {}),
];

describe('CUSTOM_PROPERTY_METRICS', () => {
  it('lists exactly the metrics whose value reads custom properties', () => {
    const without = ELEMENTS.map(({ customProperties: _customProperties, ...rest }) => rest);
    const ids = Object.keys(METRIC_FUNCTIONS) as QualityMetricId[];
    const reading = ids.filter(
      (id) =>
        JSON.stringify(METRIC_FUNCTIONS[id](ELEMENTS, VIEWPORT)) !==
        JSON.stringify(METRIC_FUNCTIONS[id](without, VIEWPORT))
    );

    expect(ids).toHaveLength(28);
    expect(reading).toEqual([...CUSTOM_PROPERTY_METRICS]);
  });
});
