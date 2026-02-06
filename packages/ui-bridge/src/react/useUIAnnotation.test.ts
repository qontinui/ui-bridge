/**
 * useUIAnnotation Hook Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUIAnnotation } from './useUIAnnotation';
import { getGlobalAnnotationStore, resetGlobalAnnotationStore } from '../annotations';

describe('useUIAnnotation', () => {
  beforeEach(() => {
    resetGlobalAnnotationStore();
  });

  it('should register the annotation in the global store', () => {
    const annotation = { description: 'test button' };

    renderHook(() => useUIAnnotation('btn', annotation));

    const store = getGlobalAnnotationStore();
    expect(store.has('btn')).toBe(true);
    expect(store.get('btn')!.description).toBe('test button');
  });

  it('should not call set() again when re-rendering with the same annotation', () => {
    const store = getGlobalAnnotationStore();
    const setSpy = vi.spyOn(store, 'set');

    const annotation = { description: 'test' };

    const { rerender } = renderHook(({ id, ann }) => useUIAnnotation(id, ann), {
      initialProps: { id: 'btn', ann: annotation },
    });

    expect(setSpy).toHaveBeenCalledTimes(1);

    // Re-render with a new object that serializes identically
    rerender({ id: 'btn', ann: { description: 'test' } });

    // set() should NOT be called again because JSON.stringify matches
    expect(setSpy).toHaveBeenCalledTimes(1);

    setSpy.mockRestore();
  });

  it('should update the store when re-rendering with a different annotation', () => {
    const store = getGlobalAnnotationStore();
    const setSpy = vi.spyOn(store, 'set');

    const { rerender } = renderHook(({ id, ann }) => useUIAnnotation(id, ann), {
      initialProps: { id: 'btn', ann: { description: 'first' } },
    });

    expect(setSpy).toHaveBeenCalledTimes(1);

    rerender({ id: 'btn', ann: { description: 'second' } });

    expect(setSpy).toHaveBeenCalledTimes(2);
    expect(store.get('btn')!.description).toBe('second');

    setSpy.mockRestore();
  });
});
