import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { InspectorOverlay } from './inspector';

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
