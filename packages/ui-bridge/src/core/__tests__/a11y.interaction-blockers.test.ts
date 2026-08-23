/**
 * `readInteractionBlockers` / `isInteractionBlocked` — the ONE predicate every
 * `ElementState.enabled` producer and the click-path pre-check consult.
 *
 * See `action-executor.pointer-events-enabled.test.ts` for the end-to-end
 * reader-vs-actor agreement; this file pins the predicate itself, including
 * that it does NOT collapse to "everything is blocked".
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { isInteractionBlocked, readInteractionBlockers } from '../a11y';

describe('readInteractionBlockers', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('reports nothing blocked for a plain button', () => {
    const b = document.createElement('button');
    container.appendChild(b);
    const blockers = readInteractionBlockers(b);
    expect(blockers).toEqual({
      disabled: false,
      ariaDisabled: false,
      pointerEvents: 'auto',
      pointerEventsNone: false,
    });
    expect(isInteractionBlocked(blockers)).toBe(false);
  });

  it('reports the native disabled IDL property', () => {
    const b = document.createElement('button');
    b.disabled = true;
    container.appendChild(b);
    const blockers = readInteractionBlockers(b);
    expect(blockers.disabled).toBe(true);
    expect(blockers.ariaDisabled).toBe(false);
    expect(blockers.pointerEventsNone).toBe(false);
    expect(isInteractionBlocked(blockers)).toBe(true);
  });

  it('reports aria-disabled="true" independently of the native property', () => {
    const b = document.createElement('button');
    b.setAttribute('aria-disabled', 'true');
    container.appendChild(b);
    const blockers = readInteractionBlockers(b);
    expect(blockers.disabled).toBe(false);
    expect(blockers.ariaDisabled).toBe(true);
    expect(blockers.pointerEventsNone).toBe(false);
    expect(isInteractionBlocked(blockers)).toBe(true);
  });

  it('reports pointer-events:none declared on the element', () => {
    const b = document.createElement('button');
    b.style.pointerEvents = 'none';
    container.appendChild(b);
    const blockers = readInteractionBlockers(b);
    expect(blockers.pointerEvents).toBe('none');
    expect(blockers.pointerEventsNone).toBe(true);
    expect(blockers.disabled).toBe(false);
    expect(blockers.ariaDisabled).toBe(false);
    expect(isInteractionBlocked(blockers)).toBe(true);
  });

  it('reports pointer-events:none INHERITED from an ancestor (computed, not inline)', () => {
    const wrap = document.createElement('div');
    wrap.style.pointerEvents = 'none';
    container.appendChild(wrap);
    const b = document.createElement('button');
    wrap.appendChild(b);

    // Nothing on the element itself — only the computed value shows the block.
    expect(b.style.pointerEvents).toBe('');
    const blockers = readInteractionBlockers(b);
    expect(blockers.pointerEventsNone).toBe(true);
    expect(isInteractionBlocked(blockers)).toBe(true);
  });

  it('reports pointer-events:none inherited through a stylesheet rule', () => {
    const style = document.createElement('style');
    style.textContent = '.pe-blocked { pointer-events: none; }';
    document.head.appendChild(style);
    try {
      const wrap = document.createElement('div');
      wrap.className = 'pe-blocked';
      container.appendChild(wrap);
      const b = document.createElement('button');
      wrap.appendChild(b);

      expect(isInteractionBlocked(readInteractionBlockers(b))).toBe(true);
    } finally {
      document.head.removeChild(style);
    }
  });

  it('an explicit pointer-events:auto child of a blocked ancestor is NOT blocked', () => {
    const wrap = document.createElement('div');
    wrap.style.pointerEvents = 'none';
    container.appendChild(wrap);
    const b = document.createElement('button');
    b.style.pointerEvents = 'auto';
    wrap.appendChild(b);

    const blockers = readInteractionBlockers(b);
    expect(blockers.pointerEvents).toBe('auto');
    expect(blockers.pointerEventsNone).toBe(false);
    expect(isInteractionBlocked(blockers)).toBe(false);
  });

  it('prefers a caller-supplied computed style over re-reading it', () => {
    const b = document.createElement('button');
    container.appendChild(b);
    const fake = { pointerEvents: 'none' } as unknown as CSSStyleDeclaration;
    expect(readInteractionBlockers(b, fake).pointerEventsNone).toBe(true);
    expect(readInteractionBlockers(b).pointerEventsNone).toBe(false);
  });

  it('treats an unreadable computed style as NO evidence, never as blocked', () => {
    const b = document.createElement('button');
    container.appendChild(b);
    const throwing = {
      get pointerEvents(): string {
        throw new Error('degraded DOM shim');
      },
    } as unknown as CSSStyleDeclaration;
    const blockers = readInteractionBlockers(b, throwing);
    expect(blockers.pointerEvents).toBe('');
    expect(blockers.pointerEventsNone).toBe(false);
    expect(isInteractionBlocked(blockers)).toBe(false);
  });
});
