/**
 * Annotation Types Tests
 */

import { describe, it, expect } from 'vitest';
import { ANNOTATION_CONFIG_VERSION } from './types';

describe('Annotation Types', () => {
  it('should have ANNOTATION_CONFIG_VERSION equal to 1.0.0', () => {
    expect(ANNOTATION_CONFIG_VERSION).toBe('1.0.0');
  });
});
