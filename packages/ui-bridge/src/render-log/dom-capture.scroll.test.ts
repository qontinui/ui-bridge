import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureDOMSnapshot } from './dom-capture';

describe('captureDOMSnapshot viewport scroll', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const el of [document.documentElement, document.body]) {
      el.style.overflowX = '';
      el.style.overflowY = '';
    }
    document.body.scrollTop = 0;
  });

  it('records the body offset where <body> scrolls itself (SPA / Tauri layout)', () => {
    // jsdom does not expand the `overflow` shorthand into its longhands.
    document.documentElement.style.overflowX = 'hidden';
    document.documentElement.style.overflowY = 'hidden';
    document.body.style.overflowX = 'auto';
    document.body.style.overflowY = 'auto';
    vi.spyOn(document.body, 'scrollHeight', 'get').mockReturnValue(2000);
    vi.spyOn(document.body, 'clientHeight', 'get').mockReturnValue(100);
    document.body.scrollTop = 640;

    const snapshot = captureDOMSnapshot();
    // A window-only read records 0 here: the window never moves.
    expect(window.scrollY).toBe(0);
    expect(snapshot.viewport.scrollY).toBe(640);
  });

  it('records the window offset where the viewport scrolls', () => {
    // The body overflows but does not scroll itself, so the viewport scrolls;
    // its own (stray) offset must not be reported.
    vi.spyOn(document.body, 'scrollHeight', 'get').mockReturnValue(2000);
    vi.spyOn(document.body, 'clientHeight', 'get').mockReturnValue(100);
    document.body.scrollTop = 77;
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(320);
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(15);

    const snapshot = captureDOMSnapshot();
    expect(snapshot.viewport.scrollY).toBe(320);
    expect(snapshot.viewport.scrollX).toBe(15);
  });
});
