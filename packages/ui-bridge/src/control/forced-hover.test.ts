/**
 * jsdom unit tests for the forced pseudo-state primitive: the selector
 * rewrite grammar and the hold bookkeeping (twin install/removal by identity,
 * chain marking, one-hold-at-a-time, TTL, `releaseAfter`).
 *
 * jsdom has no `:hover`, no CSS nesting, no `@layer` and no transitions, so
 * whether the twins make a real browser DRAW the hovered state is proven in
 * `forced-hover.smoke.test.ts` (real Chromium). jsdom does cascade plain
 * top-level rules in `getComputedStyle`, which is enough to check the
 * bookkeeping against computed style here.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  forcePseudoState,
  getForcedPseudoState,
  releaseAfter,
  releaseForcedPseudoState,
  releasesForcedPseudoState,
  rewritePseudoSelector,
  selectorHasPseudo,
  composedAncestry,
  __resetForcedPseudoStateForTest,
} from './forced-hover';

const ATTR = 'data-ui-bridge-pseudo-hover';

describe('rewritePseudoSelector — the rewrite grammar', () => {
  const table: Array<[string, string]> = [
    ['.a:hover', `.a[${ATTR}]`],
    ['.a:hover .b', `.a[${ATTR}] .b`],
    ['.x:is(:where(.group):hover *)', `.x:is(:where(.group)[${ATTR}] *)`],
    ['&:hover', `&[${ATTR}]`],
    ['.c:not(:hover)', `.c:not([${ATTR}])`],
    ['.a:has(.b:hover)', `.a:has(.b[${ATTR}])`],
    [':host(:hover) .x', `:host([${ATTR}]) .x`],
    ['.a:hover, .b:hover::after', `.a[${ATTR}], .b[${ATTR}]::after`],
    // Escaped colons are class-name characters, never the pseudo-class.
    [String.raw`.hover\:bg-x:hover`, String.raw`.hover\:bg-x[${ATTR}]`],
    [String.raw`.\[\&\:hover\]\:underline:hover`, String.raw`.\[\&\:hover\]\:underline[${ATTR}]`],
    [String.raw`.hover\:only-a-name`, String.raw`.hover\:only-a-name`],
    // Not the pseudo-class at all.
    ['.a:hover-intent', '.a:hover-intent'],
    ['.a:hovered', '.a:hovered'],
    ['.a:focus', '.a:focus'],
  ];
  for (const [input, output] of table) {
    it(`${input} -> ${output}`, () => {
      expect(rewritePseudoSelector(input, 'hover')).toBe(output);
      expect(selectorHasPseudo(input, 'hover')).toBe(input !== output);
    });
  }

  it(':active rewrites to its own attribute and leaves :hover alone', () => {
    expect(rewritePseudoSelector('.a:active:hover', 'active')).toBe(
      '.a[data-ui-bridge-pseudo-active]:hover'
    );
  });

  it('is stateless across calls (a global regex lastIndex never leaks)', () => {
    for (let i = 0; i < 3; i++) expect(selectorHasPseudo('.a:hover', 'hover')).toBe(true);
  });
});

describe('releasesForcedPseudoState — the effect class decides', () => {
  it('write-class verbs release; read-class and unknown verbs keep the hold', () => {
    for (const a of ['click', 'type', 'hoverClick', 'sendKeys', 'drag', 'submit']) {
      expect(releasesForcedPseudoState(a)).toBe(true);
    }
    for (const a of [
      'hover',
      'unhover',
      'scroll',
      'scrollIntoView',
      'focus',
      'blur',
      'rightClick',
      'myCustomVerb',
    ]) {
      expect(releasesForcedPseudoState(a)).toBe(false);
    }
  });
});

describe('forcePseudoState — bookkeeping (jsdom)', () => {
  let style: HTMLStyleElement | null = null;
  let root: HTMLDivElement | null = null;

  function setup(css: string): { group: HTMLElement; header: HTMLElement; tool: HTMLElement } {
    style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.innerHTML = `<div class="group" id="g"><span id="header">h</span><button id="tool" class="tool">t</button></div>`;
    document.body.appendChild(root);
    return {
      group: document.getElementById('g')!,
      header: document.getElementById('header')!,
      tool: document.getElementById('tool')!,
    };
  }

  const registry = {
    getAllElements: () =>
      ['header', 'tool'].map((id) => ({ id, element: document.getElementById(id) })),
  };

  afterEach(async () => {
    vi.useRealTimers();
    await __resetForcedPseudoStateForTest();
    style?.remove();
    root?.remove();
    style = null;
    root = null;
  });

  const sheetText = (): string =>
    Array.from((style!.sheet as CSSStyleSheet).cssRules)
      .map((r) => r.cssText)
      .join('\n');

  it('twins the :hover rule beside its original, marks the target and every ancestor, and reveals the group-hover child', async () => {
    const { group, header, tool } = setup(
      `.tool { pointer-events: none; } .group:hover .tool { pointer-events: auto; } .other { color: red; }`
    );
    expect(getComputedStyle(tool).pointerEvents).toBe('none');

    const report = await forcePseudoState(header, 'hover', { registry });

    expect(report.rulesCloned).toBe(1);
    expect(report.unreadableSheets).toBe(0);
    expect(report.settled).toBe('frame-only');
    expect(report.complete).toBe(true);
    const rules = Array.from((style!.sheet as CSSStyleSheet).cssRules).map(
      (r) => (r as CSSStyleRule).selectorText
    );
    expect(rules).toEqual(['.tool', '.group:hover .tool', `.group[${ATTR}] .tool`, '.other']);
    // Ancestor marking is what makes the group rule fire.
    for (const el of [header, group, document.body, document.documentElement]) {
      expect(el.hasAttribute(ATTR)).toBe(true);
    }
    expect(report.markedElements).toBe(composedAncestry(header).length);
    expect(getComputedStyle(tool).pointerEvents).toBe('auto');
    expect(report.revealed).toEqual([
      expect.objectContaining({
        id: 'tool',
        appeared: false,
        changes: [{ property: 'pointer-events', before: 'none', after: 'auto' }],
      }),
    ]);
    expect(getForcedPseudoState()).toMatchObject({ state: 'hover', target: 'span#header' });

    const release = await releaseForcedPseudoState('explicit');
    expect(release).toMatchObject({
      released: true,
      reason: 'explicit',
      rulesRemoved: 1,
      rulesAlreadyGone: 0,
      restore: 'verified',
      drift: [],
    });
    expect(sheetText()).not.toContain(ATTR);
    expect(document.querySelectorAll(`[${ATTR}]`)).toHaveLength(0);
    expect(getComputedStyle(tool).pointerEvents).toBe('none');
    expect(getForcedPseudoState()).toBeNull();
  });

  it('removes a twin by identity even after the rules before it shifted', async () => {
    const { header } = setup(`.a { color: red; } .group:hover .tool { color: blue; }`);
    await forcePseudoState(header, 'hover');
    const sheet = style!.sheet as CSSStyleSheet;
    sheet.insertRule('.inserted-first { color: green; }', 0);
    const release = await releaseForcedPseudoState();
    expect(release.rulesRemoved).toBe(1);
    expect(sheetText()).not.toContain(ATTR);
    expect(sheet.cssRules).toHaveLength(3);
  });

  it('counts a twin whose sheet was removed during the hold as already gone, not as an error', async () => {
    const { header } = setup(`.group:hover .tool { color: blue; }`);
    await forcePseudoState(header, 'hover');
    const sheet = style!.sheet as CSSStyleSheet;
    sheet.deleteRule(1);
    const release = await releaseForcedPseudoState();
    expect(release).toMatchObject({ released: true, rulesRemoved: 0, rulesAlreadyGone: 1 });
  });

  it('sends the leave events a real pointer would on release', async () => {
    const { group, header } = setup(`.group:hover .tool { color: blue; }`);
    const seen: string[] = [];
    group.addEventListener('mouseleave', () => seen.push('group:mouseleave'));
    group.addEventListener('pointerleave', () => seen.push('group:pointerleave'));
    group.addEventListener('mouseout', () => seen.push('group:mouseout(bubbled)'));
    await forcePseudoState(header, 'hover');
    expect(seen).toEqual([]);
    await releaseForcedPseudoState();
    expect(seen).toEqual(['group:mouseout(bubbled)', 'group:pointerleave', 'group:mouseleave']);
  });

  it('one hold at a time: a second apply releases the first and reports it', async () => {
    const { header, tool } = setup(`.group:hover .tool { color: blue; }`);
    await forcePseudoState(header, 'hover');
    const second = await forcePseudoState(tool, 'hover');
    expect(second.replaced).toMatchObject({ released: true, reason: 'replaced', rulesRemoved: 1 });
    expect(second.rulesCloned).toBe(1);
    expect(header.hasAttribute(ATTR)).toBe(false);
    expect(tool.hasAttribute(ATTR)).toBe(true);
    // Exactly one twin installed, never two.
    expect(sheetText().split(ATTR).length - 1).toBe(1);
  });

  it('release with nothing held is a safe no-op, every time', async () => {
    for (let i = 0; i < 2; i++) {
      expect(await releaseForcedPseudoState()).toEqual({
        released: false,
        reason: 'explicit',
        rulesRemoved: 0,
        rulesAlreadyGone: 0,
        unmarkedElements: 0,
        restore: 'nothing_held',
        drift: [],
      });
    }
  });

  it('the TTL releases the hold by itself; holdMs is clamped to the ceiling', async () => {
    const { header } = setup(`.group:hover .tool { color: blue; }`);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const applying = forcePseudoState(header, 'hover', { holdMs: 1_000 });
    await vi.advanceTimersByTimeAsync(10);
    const report = await applying;
    expect(report.holdMs).toBe(1_000);
    expect(getForcedPseudoState()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(getForcedPseudoState()).toBeNull();
    expect(document.querySelectorAll(`[${ATTR}]`)).toHaveLength(0);
    vi.useRealTimers();

    const clamped = await forcePseudoState(header, 'hover', { holdMs: 10_000_000 });
    expect(clamped.holdMs).toBe(300_000);
    const defaulted = await forcePseudoState(header, 'hover', { holdMs: -5 });
    expect(defaulted.holdMs).toBe(30_000);
  });

  it('a stale TTL from a replaced hold never releases its successor', async () => {
    const { header, tool } = setup(`.group:hover .tool { color: blue; }`);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const first = forcePseudoState(header, 'hover', { holdMs: 500 });
    await vi.advanceTimersByTimeAsync(10);
    await first;
    const second = forcePseudoState(tool, 'hover', { holdMs: 60_000 });
    await vi.advanceTimersByTimeAsync(10);
    await second;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(getForcedPseudoState()).toMatchObject({ target: 'button#tool' });
  });

  it('a restore whose page changed during the hold is restored_with_drift, naming the element', async () => {
    const { header, tool } = setup(
      `.tool { pointer-events: none; } .group:hover .tool { pointer-events: auto; }`
    );
    await forcePseudoState(header, 'hover', { registry });
    tool.style.pointerEvents = 'auto';
    const release = await releaseForcedPseudoState();
    expect(release.restore).toBe('restored_with_drift');
    expect(release.drift).toEqual([
      { id: 'tool', property: 'pointer-events', before: 'none', after: 'auto' },
    ]);
  });

  it('a :hover rule nested in @media is twinned inside the @media block', async () => {
    const { header, tool } = setup(
      `.tool { pointer-events: none; } @media screen { .group:hover .tool { pointer-events: auto; } }`
    );
    const report = await forcePseudoState(header, 'hover');
    expect(report.rulesCloned).toBe(1);
    const media = (style!.sheet as CSSStyleSheet).cssRules[1] as CSSMediaRule;
    expect(Array.from(media.cssRules).map((r) => (r as CSSStyleRule).selectorText)).toEqual([
      '.group:hover .tool',
      `.group[${ATTR}] .tool`,
    ]);
    expect(getComputedStyle(tool).pointerEvents).toBe('auto');
  });
});

describe('releaseAfter — which dispatches release the hold', () => {
  let root: HTMLDivElement | null = null;
  afterEach(async () => {
    await __resetForcedPseudoStateForTest();
    root?.remove();
    root = null;
  });

  async function held(): Promise<void> {
    root = document.createElement('div');
    root.innerHTML = `<span id="t">t</span>`;
    document.body.appendChild(root);
    await forcePseudoState(document.getElementById('t')!, 'hover');
  }

  it('a write-class action releases after it completes and reports the release', async () => {
    await held();
    let during: unknown = 'unset';
    const onRelease = vi.fn();
    const out = await releaseAfter(
      'click',
      () => {
        during = getForcedPseudoState();
        return 42;
      },
      { onRelease }
    );
    expect(out).toBe(42);
    expect(during).not.toBeNull(); // held while the click ran
    expect(getForcedPseudoState()).toBeNull();
    expect(onRelease).toHaveBeenCalledWith(
      expect.objectContaining({ released: true, reason: 'next-action' })
    );
  });

  it('a write-class action that threw after dispatch still releases', async () => {
    await held();
    await expect(
      releaseAfter('type', () => {
        throw new Error('handler blew up');
      })
    ).rejects.toThrow('handler blew up');
    expect(getForcedPseudoState()).toBeNull();
  });

  it('a refusal classified as not-dispatched keeps the hold', async () => {
    await held();
    class Refused extends Error {}
    await expect(
      releaseAfter(
        'click',
        () => {
          throw new Refused('pointer-events:none');
        },
        { notDispatched: (e) => e instanceof Refused }
      )
    ).rejects.toThrow();
    expect(getForcedPseudoState()).not.toBeNull();
  });

  it('read-class actions keep the hold', async () => {
    await held();
    for (const a of ['scroll', 'scrollIntoView', 'focus', 'blur', 'hover']) {
      await releaseAfter(a, () => undefined);
    }
    expect(getForcedPseudoState()).not.toBeNull();
  });

  it('with nothing held, a write action reports no release', async () => {
    const onRelease = vi.fn();
    await releaseAfter('click', () => undefined, { onRelease });
    expect(onRelease).not.toHaveBeenCalled();
  });
});
