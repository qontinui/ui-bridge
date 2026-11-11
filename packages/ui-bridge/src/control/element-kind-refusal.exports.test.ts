/**
 * The element-kind refusal is keyed on by callers — `failureDetails.context.refusal`
 * — so its marker and the executor's typed error are public: a caller compares
 * against the exported constant instead of the string `'element-kind'`.
 */

import { describe, it, expect } from 'vitest';
import * as root from '../index';
import * as control from './index';

describe('element-kind refusal exports', () => {
  it('the package root exports ELEMENT_KIND_REFUSAL beside ElementKindRefusalError', () => {
    expect(root.ELEMENT_KIND_REFUSAL).toBe('element-kind');
    expect(typeof root.ElementKindRefusalError).toBe('function');
    expect(control.ELEMENT_KIND_REFUSAL).toBe(root.ELEMENT_KIND_REFUSAL);
    expect(control.ElementKindRefusalError).toBe(root.ElementKindRefusalError);
  });

  it('the exported error carries the exported marker', () => {
    const error = new root.ElementKindRefusalError({
      ok: false,
      refusal: root.ELEMENT_KIND_REFUSAL,
      message: 'clear is not supported on <div>',
    });
    expect(error.refusal).toBe(root.ELEMENT_KIND_REFUSAL);
    expect(error.message).toBe('clear is not supported on <div>');
  });
});
