/**
 * The direct server transport (`createHandlers`) with a DOM: an empty
 * registry answers UNKNOWN on both inference routes, and `/design/audit`
 * resolves `rem` against the page's measured root font size — the figure
 * drift uses — rather than a fixed 16px. Plan:
 * 2026-11-13-ui-bridge-infers-a-draft-style-guide-and-token-drift-from-computed-styles.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { STYLE_GUIDE_VERSION, type StyleGuideConfig } from '../specs/style-types';

function registryOf(elements: Array<{ id: string; element: HTMLElement }>): RegistryLike {
  return {
    getAllElements: () => elements.map((e) => ({ ...e, type: 'div', label: e.id })),
  } as unknown as RegistryLike;
}

const guide: StyleGuideConfig = {
  version: STYLE_GUIDE_VERSION,
  name: 'rem',
  tokens: {
    colors: {},
    typography: {
      fontFamilies: {},
      fontSizes: {},
      fontWeights: {},
      lineHeights: {},
      letterSpacings: {},
    },
    spacing: { md: '1rem' },
    borderRadius: {},
    shadows: {},
    breakpoints: {},
  },
  rules: [
    {
      id: 'pad',
      constraints: [{ type: 'tokenRef', property: 'paddingTop', tokenPath: 'spacing.md' }],
    },
  ],
};

afterEach(() => {
  document.documentElement.style.fontSize = '';
  document.body.innerHTML = '';
});

describe('createHandlers style routes', () => {
  it('an empty registry answers status empty and verdict unknown', async () => {
    const handlers = createHandlers(registryOf([]), {} as never);
    const inferred = await handlers.inferStyleGuide!({});
    expect(inferred.success).toBe(true);
    expect((inferred.data as { status: string }).status).toBe('empty');
    const drift = await handlers.diffDesignTokens!({ tokens: { colors: { a: '#000000' } } });
    expect(drift.success).toBe(true);
    expect((drift.data as { verdict: string }).verdict).toBe('unknown');
  });

  it('the audit resolves rem at the measured root font size', async () => {
    document.documentElement.style.fontSize = '20px';
    const div = document.createElement('div');
    div.style.paddingTop = '20px';
    document.body.appendChild(div);
    const handlers = createHandlers(registryOf([{ id: 'a', element: div }]), {} as never);
    const report = await handlers.runDesignAudit!({ guide });
    expect(report.success).toBe(true);
    expect(report.data!.failedCount).toBe(0);
    expect(report.data!.passedCount).toBe(1);
  });

  it('a caller-supplied rootFontSizePx wins over the measured one', async () => {
    document.documentElement.style.fontSize = '20px';
    const div = document.createElement('div');
    div.style.paddingTop = '20px';
    document.body.appendChild(div);
    const handlers = createHandlers(registryOf([{ id: 'a', element: div }]), {} as never);
    const report = await handlers.runDesignAudit!({ guide, rootFontSizePx: 16 });
    expect(report.data!.failedCount).toBe(1);
  });
});
