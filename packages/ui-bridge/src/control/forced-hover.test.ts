/**
 * jsdom unit tests for the forced pseudo-state primitive: the selector
 * rewrite grammar and the hold bookkeeping (in-place selector rewrite and
 * restore, chain marking, one-hold-at-a-time, TTL, `releaseAfter`).
 *
 * jsdom has no `:hover`, no CSS nesting, no `@layer` and no transitions, so
 * whether the rewritten selectors make a real browser DRAW the hovered state is proven in
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
  releaseForcedPseudoStateIfOwner,
  releasesForcedPseudoState,
  rewritePseudoSelector,
  selectorHasPseudo,
  composedAncestry,
  __resetForcedPseudoStateForTest,
} from './forced-hover';

const ATTR = 'data-ui-bridge-pseudo-hover';
/** What every forceable `:hover` becomes. */
const H = `:is(:hover,[${ATTR}])`;

describe('rewritePseudoSelector — the rewrite grammar', () => {
  const table: Array<[string, string | null]> = [
    ['.a:hover', `.a${H}`],
    ['.a:hover .b', `.a${H} .b`],
    ['.x:is(:where(.group):hover *)', `.x:is(:where(.group)${H} *)`],
    ['&:hover', `&${H}`],
    ['.c:not(:hover)', `.c:not(${H})`],
    ['.a:has(.b:hover)', `.a:has(.b${H})`],
    [':host(:hover) .x', `:host(${H}) .x`],
    ['.a:hover, .b:hover::after', `.a${H}, .b${H}::after`],
    // Escaped colons are class-name characters, never the pseudo-class.
    [String.raw`.hover\:bg-x:hover`, String.raw`.hover\:bg-x` + H],
    [String.raw`.\[\&\:hover\]\:underline:hover`, String.raw`.\[\&\:hover\]\:underline` + H],
    [String.raw`.hover\:only-a-name`, String.raw`.hover\:only-a-name`],
    // Not the pseudo-class at all.
    ['.a:hover-intent', '.a:hover-intent'],
    ['.a:hovered', '.a:hovered'],
    ['.a:focus', '.a:focus'],
    // Scoped to a pseudo-element: cannot take an :is(), nothing to force.
    ['::-webkit-scrollbar-thumb:hover', null],
    ['.x::part(thumb):hover', null],
    ['::slotted(.y):hover', null],
    // ...but a sibling compound in the same selector list still is forceable.
    ['.a:hover, ::-webkit-scrollbar-thumb:hover', `.a${H}, ::-webkit-scrollbar-thumb:hover`],
    ['.a:hover::-webkit-scrollbar-thumb', `.a${H}::-webkit-scrollbar-thumb`],
  ];
  for (const [input, output] of table) {
    it(`${input} -> ${output}`, () => {
      expect(rewritePseudoSelector(input, 'hover')).toBe(output);
      expect(selectorHasPseudo(input, 'hover')).toBe(input !== output);
    });
  }

  it(':active rewrites to its own attribute and leaves :hover alone', () => {
    expect(rewritePseudoSelector('.a:active:hover', 'active')).toBe(
      '.a:is(:active,[data-ui-bridge-pseudo-active]):hover'
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

  it('rewrites the :hover rule in place, marks the target and every ancestor, and reveals the group-hover child', async () => {
    const { group, header, tool } = setup(
      `.tool { pointer-events: none; } .group:hover .tool { pointer-events: auto; } .other { color: red; }`
    );
    expect(getComputedStyle(tool).pointerEvents).toBe('none');

    const report = await forcePseudoState(header, 'hover', { registry });

    expect(report.rulesRewritten).toBe(1);
    expect(report.unreadableSheets).toBe(0);
    expect(report.settled).toBe('frame-only');
    expect(report.complete).toBe(true);
    const rules = Array.from((style!.sheet as CSSStyleSheet).cssRules).map(
      (r) => (r as CSSStyleRule).selectorText
    );
    // In place: no rule inserted, nothing shifted.
    expect(rules).toEqual(['.tool', `.group${H} .tool`, '.other']);
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
      rulesRestored: 1,
      rulesAlreadyGone: 0,
      restore: 'verified',
      drift: [],
    });
    expect(sheetText()).not.toContain(ATTR);
    expect(((style!.sheet as CSSStyleSheet).cssRules[1] as CSSStyleRule).selectorText).toBe(
      '.group:hover .tool'
    );
    expect(document.querySelectorAll(`[${ATTR}]`)).toHaveLength(0);
    expect(getComputedStyle(tool).pointerEvents).toBe('none');
    expect(getForcedPseudoState()).toBeNull();
  });

  it('never changes a sheet rule count or indices: an app inserting by index during the hold is unaffected', async () => {
    const { header } = setup(`.a { color: red; } .group:hover .tool { color: blue; }`);
    const sheet = style!.sheet as CSSStyleSheet;
    await forcePseudoState(header, 'hover');
    expect(sheet.cssRules).toHaveLength(2);
    sheet.insertRule('.inserted-first { color: green; }', 0);
    const release = await releaseForcedPseudoState();
    expect(release.rulesRestored).toBe(1);
    expect(sheetText()).not.toContain(ATTR);
    expect(Array.from(sheet.cssRules).map((r) => (r as CSSStyleRule).selectorText)).toEqual([
      '.inserted-first',
      '.a',
      '.group:hover .tool',
    ]);
  });

  it('a rewritten rule the app deleted during the hold is counted as already gone, not as an error', async () => {
    const { header } = setup(`.group:hover .tool { color: blue; }`);
    await forcePseudoState(header, 'hover');
    (style!.sheet as CSSStyleSheet).deleteRule(0);
    const release = await releaseForcedPseudoState();
    expect(release).toMatchObject({ released: true, rulesRestored: 0, rulesAlreadyGone: 1 });
  });

  it('a selector the app changed during the hold is left as the app set it and reported as drift', async () => {
    const { header } = setup(`.group:hover .tool { color: blue; }`);
    await forcePseudoState(header, 'hover');
    const rule = (style!.sheet as CSSStyleSheet).cssRules[0] as CSSStyleRule;
    rule.selectorText = '.app-changed';
    const release = await releaseForcedPseudoState();
    expect(release.restore).toBe('restored_with_drift');
    expect(release.selectorDrift).toEqual([
      { selector: '.app-changed', original: '.group:hover .tool' },
    ]);
    expect(rule.selectorText).toBe('.app-changed');
  });

  it('a pseudo-element-scoped :hover is not applicable, and does not make the reveal incomplete', async () => {
    const { header } = setup(
      `::-webkit-scrollbar-thumb:hover { color: red; } .group:hover .tool { color: blue; }`
    );
    const report = await forcePseudoState(header, 'hover');
    expect(report).toMatchObject({
      rulesRewritten: 1,
      rulesNotApplicable: 1,
      rulesFailed: 0,
      complete: true,
    });
  });

  it('a scan that throws part-way restores every selector it already rewrote', async () => {
    const { header } = setup(`.group:hover .tool { color: blue; } .b:hover { color: red; }`);
    const rules = (style!.sheet as CSSStyleSheet).cssRules;
    const second = rules[1] as CSSStyleRule;
    Object.defineProperty(second, 'selectorText', {
      configurable: true,
      get: () => '.b:hover',
      set: () => {
        throw new Error('setter blew up');
      },
    });
    await expect(forcePseudoState(header, 'hover')).rejects.toThrow('setter blew up');
    expect((rules[0] as CSSStyleRule).selectorText).toBe('.group:hover .tool');
    expect(getForcedPseudoState()).toBeNull();
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
    expect(second.replaced).toMatchObject({ released: true, reason: 'replaced', rulesRestored: 1 });
    expect(second.rulesRewritten).toBe(1);
    expect(header.hasAttribute(ATTR)).toBe(false);
    expect(tool.hasAttribute(ATTR)).toBe(true);
    // Rewritten once, never twice.
    expect(sheetText().split(ATTR).length - 1).toBe(1);
  });

  it('release with nothing held is a safe no-op, every time', async () => {
    for (let i = 0; i < 2; i++) {
      expect(await releaseForcedPseudoState()).toEqual({
        released: false,
        reason: 'explicit',
        rulesRestored: 0,
        rulesAlreadyGone: 0,
        selectorDrift: [],
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

  it('a :hover rule nested in @media is rewritten inside the @media block', async () => {
    const { header, tool } = setup(
      `.tool { pointer-events: none; } @media screen { .group:hover .tool { pointer-events: auto; } }`
    );
    const report = await forcePseudoState(header, 'hover');
    expect(report.rulesRewritten).toBe(1);
    const media = (style!.sheet as CSSStyleSheet).cssRules[1] as CSSMediaRule;
    expect(Array.from(media.cssRules).map((r) => (r as CSSStyleRule).selectorText)).toEqual([
      `.group${H} .tool`,
    ]);
    expect(getComputedStyle(tool).pointerEvents).toBe('auto');
  });
});

describe('the hold is one per page, not one per bundle', () => {
  afterEach(async () => {
    await __resetForcedPseudoStateForTest();
  });

  it('lives on globalThis under Symbol.for("ui-bridge.forcedPseudo"), so a second copy of the module shares it', async () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    try {
      await forcePseudoState(el, 'hover');
      const shared = (globalThis as unknown as Record<symbol, { hold: unknown }>)[
        Symbol.for('ui-bridge.forcedPseudo')
      ];
      expect(shared.hold).not.toBeNull();
      // A separately bundled entry point is a second evaluation of this module.
      vi.resetModules();
      const second = await import('./forced-hover');
      expect(second.getForcedPseudoState()).toMatchObject({ target: 'span' });
      const released = await second.releaseForcedPseudoState();
      expect(released.released).toBe(true);
      expect(getForcedPseudoState()).toBeNull();
    } finally {
      el.remove();
    }
  });

  it('releaseForcedPseudoStateIfOwner releases only the hold it names', async () => {
    const a = document.createElement('span');
    const b = document.createElement('i');
    document.body.append(a, b);
    try {
      const first = await forcePseudoState(a, 'hover');
      const second = await forcePseudoState(b, 'hover');
      expect((await releaseForcedPseudoStateIfOwner(first.holdId)).released).toBe(false);
      expect(getForcedPseudoState()).toMatchObject({ holdId: second.holdId });
      expect((await releaseForcedPseudoStateIfOwner(second.holdId)).released).toBe(true);
    } finally {
      a.remove();
      b.remove();
    }
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
