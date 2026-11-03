import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { InspectorOverlay, useInspector } from './inspector';

describe('InspectorOverlay', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('draws over the element on a scrolled page (fixed box, viewport-relative rect)', () => {
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(15);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(320);
    const bounds = new DOMRect(40, 60, 100, 20);

    const { container } = render(<InspectorOverlay bounds={bounds} label="x" />);
    const box = container.firstElementChild as HTMLElement;

    expect(box.style.position).toBe('fixed');
    expect(box.style.left).toBe('40px');
    expect(box.style.top).toBe('60px');
  });
});

describe('useInspector bounds', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('re-reads the highlighted element bounds when the page scrolls under a still mouse', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    let top = 60;
    vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => new DOMRect(40, top, 100, 20));

    const { result } = renderHook(() => useInspector());
    act(() => result.current.toggle());
    act(() => result.current.setSelectedElement(el));
    expect(result.current.bounds?.top).toBe(60);

    top = -200; // the page scrolled; the mouse did not move
    act(() => {
      document.body.dispatchEvent(new Event('scroll'));
    });
    expect(result.current.bounds?.top).toBe(-200);
    el.remove();
  });
});
