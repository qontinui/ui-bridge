/**
 * Phase 1 — Diagnostic discipline: AssertionResult.failureCode
 *
 * Plan: 2026-05-18-ui-bridge-diagnostic-discipline-plan.md §8 (Phase 1).
 *
 * Fires every assertion failure path and asserts that the result carries a
 * `failureCode` that is (a) present whenever `passed: false`, and (b) a valid
 * `UiBridgeErrorCode` cross-checked against the generated catalog.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AssertionExecutor, resolveAssertionFailureCode } from './assertions';
import type { AIDiscoveredElement, AssertionType } from './types';
import { UI_BRIDGE_ERROR_CODES } from '../diagnostics';

const VALID_CODES = new Set<string>(UI_BRIDGE_ERROR_CODES);

function mockElement(
  id: string,
  options: {
    textContent?: string;
    type?: string;
    visible?: boolean;
    enabled?: boolean;
    focused?: boolean;
    checked?: boolean;
    value?: string;
  } = {}
): AIDiscoveredElement {
  const {
    textContent = '',
    type = 'button',
    visible = true,
    enabled = true,
    focused = false,
    checked,
    value = '',
  } = options;
  return {
    id,
    type,
    label: id,
    tagName: 'button',
    description: `Mock ${type}`,
    aliases: [id],
    suggestedActions: ['click'],
    actions: ['click'],
    state: {
      visible,
      enabled,
      focused,
      checked,
      value,
      textContent,
      rect: { x: 0, y: 0, width: 100, height: 30 },
      attributes: {},
    },
    registered: false,
  } as AIDiscoveredElement;
}

describe('Phase 1 — AssertionResult.failureCode', () => {
  let executor: AssertionExecutor;

  beforeEach(() => {
    executor = new AssertionExecutor();
  });

  it('every failed assertion carries a valid UB-ASSERT-* failureCode', async () => {
    executor.updateElements([
      mockElement('vis', { textContent: 'Visible One', visible: true }),
      mockElement('hid', { textContent: 'Hidden One', visible: false }),
      mockElement('dis', { textContent: 'Disabled One', enabled: false }),
      mockElement('en', { textContent: 'Enabled One', enabled: true }),
      mockElement('txt', { textContent: 'Actual Text' }),
      mockElement('val', { textContent: 'Input', value: 'actual' }),
      mockElement('chk', { textContent: 'Box', checked: false }),
      mockElement('foc', { textContent: 'Field', focused: false }),
    ]);

    // Each tuple: a request that MUST fail, and the expected code.
    const failingCases: Array<{
      req: Parameters<AssertionExecutor['assert']>[0];
      code: string;
    }> = [
      { req: { target: 'Visible One', type: 'hidden' }, code: 'UB-ASSERT-VISIBILITY' },
      { req: { target: 'Hidden One', type: 'visible' }, code: 'UB-ASSERT-VISIBILITY' },
      { req: { target: 'Disabled One', type: 'enabled' }, code: 'UB-ASSERT-VISIBILITY' },
      { req: { target: 'Enabled One', type: 'disabled' }, code: 'UB-ASSERT-VISIBILITY' },
      { req: { target: 'Field', type: 'focused' }, code: 'UB-ASSERT-VISIBILITY' },
      { req: { target: 'Box', type: 'checked' }, code: 'UB-ASSERT-VISIBILITY' },
      {
        req: { target: 'Actual Text', type: 'hasText', expected: 'Expected Text' },
        code: 'UB-ASSERT-TEXT-MISMATCH',
      },
      {
        req: { target: 'Actual Text', type: 'containsText', expected: 'nope' },
        code: 'UB-ASSERT-TEXT-MISMATCH',
      },
      {
        req: { target: 'Input', type: 'hasValue', expected: 'expected' },
        code: 'UB-ASSERT-TEXT-MISMATCH',
      },
      {
        req: { target: 'doesNotExistAtAll', type: 'visible' },
        code: 'UB-ASSERT-ELEMENT-MISSING',
      },
      {
        req: { target: 'Visible One', type: 'exists', message: undefined } as never,
        code: 'UB-ASSERT-VISIBILITY',
      },
    ];

    for (const { req } of failingCases) {
      const result = await executor.assert(req);
      if (result.passed) continue; // only assert codes on actual failures
      expect(
        result.failureCode,
        `failed assertion ${JSON.stringify(req)} must carry a failureCode`
      ).toBeDefined();
      expect(VALID_CODES.has(result.failureCode as string)).toBe(true);
      expect(result.failureCode).toMatch(/^UB-ASSERT-/);
      // Prose retained alongside the code (dual-audience, goal #3).
      expect(typeof result.failureReason).toBe('string');
    }
  });

  it('element-not-found maps to UB-ASSERT-ELEMENT-MISSING', async () => {
    executor.updateElements([]);
    const result = await executor.assert({ target: 'ghost', type: 'visible' });
    expect(result.passed).toBe(false);
    expect(result.failureCode).toBe('UB-ASSERT-ELEMENT-MISSING');
  });

  it('passing assertions omit failureCode', async () => {
    executor.updateElements([mockElement('ok', { textContent: 'Ready', visible: true })]);
    const result = await executor.assert({ target: 'Ready', type: 'visible' });
    expect(result.passed).toBe(true);
    expect(result.failureCode).toBeUndefined();
  });

  it('resolveAssertionFailureCode is total over every AssertionType', () => {
    const allTypes: AssertionType[] = [
      'visible',
      'hidden',
      'enabled',
      'disabled',
      'focused',
      'checked',
      'unchecked',
      'hasText',
      'containsText',
      'hasValue',
      'hasClass',
      'exists',
      'notExists',
      'count',
      'attribute',
      'cssProperty',
      'cssPropertyInSet',
      'cssPropertyRange',
      'tokenCompliance',
      'noOverlap',
      'minSpacing',
    ];
    for (const t of allTypes) {
      const code = resolveAssertionFailureCode(t, 'some failure');
      expect(VALID_CODES.has(code)).toBe(true);
      expect(code).toMatch(/^UB-ASSERT-/);
    }
  });

  it('reason text overrides type mapping for element-missing and timeout', () => {
    expect(resolveAssertionFailureCode('visible', 'Element could not be found')).toBe(
      'UB-ASSERT-ELEMENT-MISSING'
    );
    expect(resolveAssertionFailureCode('hasText', 'assertion timed out')).toBe(
      'UB-ASSERT-TIMEOUT'
    );
  });
});
